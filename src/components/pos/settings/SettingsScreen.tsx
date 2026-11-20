import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip, type ChipStatus } from '~/components/ui/Chip'
import { Input } from '~/components/ui/Input'
import { Segmented } from '~/components/ui/Segmented'
import { Select } from '~/components/ui/Select'
import { useToast } from '~/components/ui/Toast'
import { Archive, Printer, RefreshCw } from '~/components/ui/icons'
import { APP_VERSION } from '~/lib/app-version'
import { SCHEMA_VERSION } from '~/lib/contracts'
import { changeLocale } from '~/i18n'
import type { LocaleId } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { dismissPrintJob } from '~/pos/data/print-job.repo'
import { getMeta, setMeta } from '~/pos/data/meta.repo'
import { useFailedPrintJobs } from '~/pos/hooks/use-print-jobs'
import { usePrinter, type PrinterConfig } from '~/pos/hooks/use-printer'
import { useSyncState } from '~/pos/hooks/use-sync-state'
import { refreshStorageMeta, type PersistStatus } from '~/pos/maintenance/storage'
import type { AdapterKind, PrinterState } from '~/pos/printing/adapters/types'
import {
  columnsForPaperWidth,
  findPrinterProfile,
  PRINTER_PROFILES,
} from '~/pos/printing/printer-profiles'
import { kickActivePrintQueue } from '~/pos/printing/runtime'
import { WedgeBuffer } from '~/pos/scanner/wedge-buffer'
import { detectCapabilities } from '~/pos/session/capabilities'
import { reprintCreditNote, reprintSale } from '~/pos/usecases/print/reprint'

export interface SettingsScreenProps {
  tenant: string
  bootResult: BootResult
}

function mapPrinterStateChip(state: PrinterState): ChipStatus {
  if (state === 'READY') return 'synced'
  if (state === 'BUSY') return 'syncing'
  if (state === 'ERROR') return 'needs_attention'
  if (state === 'DISCONNECTED') return 'offline'
  return 'pending'
}

export function SettingsScreen({ tenant, bootResult }: SettingsScreenProps) {
  const { t, i18n } = useTranslation()
  const locale: LocaleId = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const { syncState } = useSyncState()

  const caps = detectCapabilities()
  const printer = usePrinter(
    shell.db,
    shell.device?.outlet_id ?? null,
    shell.device?.register_id ?? null,
  )
  const failedJobs = useFailedPrintJobs(shell.db)

  const [adapter, setAdapter] = useState<AdapterKind>('browser-print')
  const [profileId, setProfileId] = useState<string>('escpos-80')
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(80)
  const [bleServiceUuid, setBleServiceUuid] = useState('')
  const [bleCharUuid, setBleCharUuid] = useState('')
  const [clockOffsetMs, setClockOffsetMs] = useState(0)

  const [storageInfo, setStorageInfo] = useState<{ persist: PersistStatus; usedPct: number }>({
    persist: 'UNKNOWN',
    usedPct: 0,
  })
  const [scanInput, setScanInput] = useState('')
  const [scanDetected, setScanDetected] = useState<{ len: number; term: string } | null>(null)
  const [wedgeTestBuf] = useState(() => new WedgeBuffer())

  useEffect(() => {
    if (!printer.config) {
      setPaperWidthMm(printer.defaultPaperWidthMm)
      return
    }
    const kind = (printer.config.adapter ?? 'browser-print') as AdapterKind
    setAdapter(kind)
    setProfileId(printer.config.profileId ?? (printer.defaultPaperWidthMm === 58 ? 'escpos-58' : 'escpos-80'))
    setPaperWidthMm(printer.config.paperWidthMm ?? printer.config.width_mm ?? printer.defaultPaperWidthMm)
    setBleServiceUuid(printer.config.serviceUuid ?? '')
    setBleCharUuid(printer.config.characteristicUuid ?? '')
  }, [printer.config, printer.defaultPaperWidthMm])

  useEffect(() => {
    if (!shell.db) return
    const db = shell.db
    let cancelled = false
    void Promise.all([refreshStorageMeta(db), getMeta(db, 'clock')]).then(([st, clock]) => {
      if (cancelled) return
      setStorageInfo({ persist: st.persist, usedPct: st.usedPct })
      if (clock) setClockOffsetMs(clock.offset_ms)
    })
    return () => {
      cancelled = true
    }
  }, [shell.db])

  async function applyPrinterChange(next: Partial<PrinterConfig>) {
    const chosenAdapter = (next.adapter ?? adapter) as AdapterKind
    const chosenProfile = findPrinterProfile(next.profileId ?? profileId)
    const width = next.paperWidthMm ?? paperWidthMm
    const cols = columnsForPaperWidth(width)
    const cfg: PrinterConfig = {
      adapter: chosenAdapter,
      mode: chosenAdapter === 'browser-print' ? 'browser' : 'escpos',
      profileId: chosenProfile.id,
      paperWidthMm: width,
      width_mm: width,
      columns: cols,
      codePage: chosenProfile.capabilities.codePage,
      canCut: chosenAdapter === 'browser-print' ? false : chosenProfile.capabilities.canCut,
      canOpenDrawer:
        chosenAdapter === 'browser-print' ? false : chosenProfile.capabilities.canOpenDrawer,
      drawerPulse: [...chosenProfile.drawerPulse] as [number, number, number],
      serviceUuid: next.serviceUuid ?? (bleServiceUuid || chosenProfile.bleServiceUuid),
      characteristicUuid:
        next.characteristicUuid ?? (bleCharUuid || chosenProfile.bleCharacteristicUuid),
    }
    await printer.saveConfig(cfg)
  }

  async function handleLanguageSelect(nextLocale: string) {
    const chosen: LocaleId = nextLocale === 'en-US' ? 'en-US' : 'id-ID'
    await changeLocale(chosen)
    if (shell.db) {
      await setMeta(shell.db, 'locale', chosen)
    }
  }

  async function handleTestPrint() {
    try {
      await printer.printTestPage(locale)
      showToast({ tone: 'success', message: t('pos.print.testSuccess') })
    } catch {
      showToast({ tone: 'danger', message: t('pos.print.testFailed') })
    }
  }

  async function handleOpenDrawer() {
    if (!shell.sessionStaff) return
    try {
      await printer.openDrawer(shell.sessionStaff.staffId)
      showToast({ tone: 'success', message: t('pos.print.drawerOpened') })
    } catch {
      showToast({ tone: 'danger', message: t('pos.print.drawerFailed') })
    }
  }

  async function handleRefreshStorage() {
    if (!shell.db) return
    const st = await refreshStorageMeta(shell.db)
    setStorageInfo({ persist: st.persist, usedPct: st.usedPct })
  }

  async function handleRetryFailedJob(jobId: string, kind: string, entityId: string) {
    if (!shell.db) return
    await dismissPrintJob(shell.db, jobId)
    if (kind === 'CREDIT_NOTE') {
      await reprintCreditNote(shell.db, entityId)
    } else {
      await reprintSale(shell.db, entityId)
    }
    void kickActivePrintQueue()
  }

  const appVersion = typeof APP_VERSION === 'string' ? APP_VERSION : 'dev'
  const canManualDrawer =
    Boolean(shell.sessionStaff?.permissions.has('drawer.open')) &&
    adapter !== 'browser-print'

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      activeNav="more"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-h2 font-semibold text-ink">{t('pos.settings.title')}</h1>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/more` })}
          >
            {t('pos.settings.backToMore')}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-h3 font-semibold text-ink">{t('pos.settings.languageHeading')}</h2>
            <p className="text-body text-ink-soft">{t('pos.settings.languageHint')}</p>
            <Segmented
              ariaLabel={t('pos.settings.languageHeading')}
              value={locale}
              onChange={(v) => void handleLanguageSelect(v)}
              options={[
                { value: 'id-ID', label: t('sys.lang.id') },
                { value: 'en-US', label: t('sys.lang.en') },
              ]}
            />
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-h3 font-semibold text-ink">{t('pos.settings.deviceHeading')}</h2>
            <dl className="flex flex-col gap-1.5 text-body">
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t('pos.settings.outletLabel')}</dt>
                <dd className="font-medium text-ink">{shell.outletLabel ?? '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t('pos.settings.versionLabel')}</dt>
                <dd className="font-mono text-ink">
                  {`Solva POS ${appVersion} · v${SCHEMA_VERSION}`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t('pos.settings.clockOffsetLabel')}</dt>
                <dd className="font-mono text-ink">{`${clockOffsetMs} ms`}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t('pos.settings.lastSyncLabel')}</dt>
                <dd className="text-ink">
                  {syncState.lastSuccessAt
                    ? new Date(syncState.lastSuccessAt).toLocaleString(locale)
                    : t('pos.settings.neverSynced')}
                </dd>
              </div>
            </dl>
          </Card>

          <Card className="flex flex-col gap-3 p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h3 font-semibold text-ink">{t('pos.settings.printerHeading')}</h2>
              <Chip
                status={mapPrinterStateChip(printer.printerState)}
                label={t(`pos.settings.printerState${printer.printerState}`)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-label font-medium text-ink" htmlFor="printer-adapter-select">
                  {t('pos.settings.adapterLabel')}
                </label>
                <Select
                  id="printer-adapter-select"
                  value={adapter}
                  onValueChange={(v) => {
                    const next = v as AdapterKind
                    setAdapter(next)
                    void applyPrinterChange({ adapter: next })
                  }}
                  options={[
                    { value: 'browser-print', label: t('pos.settings.adapterBrowser') },
                    ...(caps.webUsb ? [{ value: 'webusb', label: t('pos.settings.adapterUsb') }] : []),
                    ...(caps.webBluetooth
                      ? [{ value: 'webbluetooth', label: t('pos.settings.adapterBle') }]
                      : []),
                    { value: 'virtual', label: t('pos.settings.adapterVirtual') },
                  ]}
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink">{t('pos.settings.paperWidthLabel')}</span>
                <Segmented
                  ariaLabel={t('pos.settings.paperWidthLabel')}
                  value={String(paperWidthMm)}
                  onChange={(v) => {
                    const w: 58 | 80 = v === '58' ? 58 : 80
                    setPaperWidthMm(w)
                    void applyPrinterChange({ paperWidthMm: w })
                  }}
                  options={[
                    { value: '58', label: '58 mm' },
                    { value: '80', label: '80 mm' },
                  ]}
                />
              </div>
            </div>

            {adapter !== 'browser-print' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-label font-medium text-ink" htmlFor="printer-profile-select">
                    {t('pos.settings.profileLabel')}
                  </label>
                  <Select
                    id="printer-profile-select"
                    value={profileId}
                    onValueChange={(v) => {
                      setProfileId(v)
                      const p = findPrinterProfile(v)
                      setBleServiceUuid(p.bleServiceUuid ?? '')
                      setBleCharUuid(p.bleCharacteristicUuid ?? '')
                      void applyPrinterChange({ profileId: v })
                    }}
                    options={PRINTER_PROFILES.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </div>
              </div>
            ) : null}

            {adapter === 'webbluetooth' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-label font-medium text-ink" htmlFor="ble-svc-uuid">
                    {t('pos.settings.bleServiceUuidLabel')}
                  </label>
                  <Input
                    id="ble-svc-uuid"
                    value={bleServiceUuid}
                    onChange={(e) => {
                      setBleServiceUuid(e.target.value)
                      void applyPrinterChange({ serviceUuid: e.target.value })
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-label font-medium text-ink" htmlFor="ble-char-uuid">
                    {t('pos.settings.bleCharUuidLabel')}
                  </label>
                  <Input
                    id="ble-char-uuid"
                    value={bleCharUuid}
                    onChange={(e) => {
                      setBleCharUuid(e.target.value)
                      void applyPrinterChange({ characteristicUuid: e.target.value })
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {adapter !== 'browser-print' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  loading={printer.connecting}
                  onClick={() => void printer.connect().catch(() => {})}
                >
                  {t('pos.settings.connectButton')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="tonal"
                size="md"
                leadingIcon={<Printer className="size-4" />}
                onClick={() => void handleTestPrint()}
              >
                {t('pos.settings.testPrintButton')}
              </Button>
              {canManualDrawer ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  leadingIcon={<Archive className="size-4" />}
                  onClick={() => void handleOpenDrawer()}
                >
                  {t('pos.settings.openDrawerButton')}
                </Button>
              ) : null}
            </div>

            <div className="mt-2 border-t border-line pt-3">
              <h3 className="text-label font-semibold text-ink">{t('pos.settings.failedJobsHeading')}</h3>
              {failedJobs.length === 0 ? (
                <p className="mt-1 text-caption text-ink-soft">{t('pos.print.noFailedJobs')}</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {failedJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-2 text-body"
                    >
                      <div>
                        <span className="font-medium text-ink">
                          {t(`pos.print.jobKind${job.kind}`, { defaultValue: job.kind })}
                        </span>
                        {job.last_error ? (
                          <p className="text-caption text-danger-ink">{job.last_error}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="tonal"
                          size="sm"
                          onClick={() =>
                            void handleRetryFailedJob(job.id, job.kind, job.entity_id)
                          }
                        >
                          {t('pos.print.retryJob')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => shell.db && void dismissPrintJob(shell.db, job.id)}
                        >
                          {t('pos.print.dismissJob')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-h3 font-semibold text-ink">{t('pos.settings.scannerHeading')}</h2>
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-soft">{t('pos.settings.scannerCameraLabel')}</span>
              <Chip
                status={caps.barcodeDetector ? 'synced' : 'offline'}
                label={
                  caps.barcodeDetector
                    ? t('pos.settings.scannerSupported')
                    : t('pos.settings.scannerUnsupported')
                }
              />
            </div>
            <label className="text-label font-medium text-ink" htmlFor="scanner-test-input">
              {t('pos.settings.scannerTestLabel')}
            </label>
            <Input
              id="scanner-test-input"
              value={scanInput}
              placeholder={t('pos.settings.scannerTestPlaceholder')}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                const res = wedgeTestBuf.push({ key: e.key })
                if (res.matched) {
                  setScanDetected({ len: res.matched.length, term: e.key })
                  setScanInput(res.matched)
                }
              }}
            />
            {scanDetected ? (
              <p className="text-caption text-success-ink">
                {t('pos.settings.scannerTestResult', scanDetected)}
              </p>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-h3 font-semibold text-ink">{t('pos.settings.storageHeading')}</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<RefreshCw className="size-4" />}
                onClick={() => void handleRefreshStorage()}
              >
                {t('pos.settings.storageRefresh')}
              </Button>
            </div>
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-soft">{t('pos.settings.storagePersistLabel')}</span>
              <Chip
                status={storageInfo.persist === 'GRANTED' ? 'synced' : 'pending'}
                label={
                  storageInfo.persist === 'GRANTED'
                    ? t('pos.settings.storagePersistGranted')
                    : storageInfo.persist === 'DENIED'
                      ? t('pos.settings.storagePersistDenied')
                      : t('pos.settings.storagePersistUnknown')
                }
              />
            </div>
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-soft">{t('pos.settings.storageUsageLabel')}</span>
              <span className="font-mono text-ink">{`${storageInfo.usedPct.toFixed(1)}%`}</span>
            </div>
            {storageInfo.usedPct >= 70 ? (
              <p className="text-caption text-warning-ink">{t('pos.settings.storageWarning')}</p>
            ) : null}
          </Card>
        </div>
      </div>
    </PosWorkspaceShell>
  )
}
