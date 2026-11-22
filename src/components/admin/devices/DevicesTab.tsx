import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  CircleAlert,
  DataTable,
  Dialog,
  Field,
  Input,
  Plus,
  Radio,
  Select,
  TabletSmartphone,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import { createPairingCodeFn, revokeDeviceFn } from '~/functions/identity/device.fn'
import { forceCloseShiftFn, listOpenShiftsForAdminFn } from '~/functions/shift/force-close.fn'
import { formatDateTime } from '~/lib/kernel'
import {
  DEVICE_REVOKE_REASONS,
  type CreatePairingCodeResult,
  type DeviceRevokeReason,
  type DeviceView,
} from '~/modules/identity/shared'
import { devicesQueryOptions, registersQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'
import { PairingDialog } from './PairingDialog'
import { RecoverRegisterWizard } from './RecoverRegisterWizard'

export interface DevicesTabProps {
  tenantSlug: string
}

const TEN_MINUTES_MS = 10 * 60 * 1000

function formatOffsetLabel(offsetMs: number | null): string {
  if (offsetMs === null) return '-'
  const sign = offsetMs >= 0 ? '+' : '-'
  const absSec = Math.round(Math.abs(offsetMs) / 1000)
  if (absSec < 60) {
    return `${sign}${absSec}s`
  }
  const mins = Math.round(absSec / 60)
  return `${sign}${mins}m`
}

export function DevicesTab({ tenantSlug }: DevicesTabProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()

  const { data: devices = [], isLoading } = useQuery(devicesQueryOptions(tenantSlug))
  const { data: registers = [] } = useQuery(registersQueryOptions(tenantSlug))
  const { data: openShifts = [] } = useQuery({
    queryKey: ['admin', tenantSlug, 'open-shifts'],
    queryFn: () => listOpenShiftsForAdminFn(),
  })

  const [selectRegOpen, setSelectRegOpen] = useState(false)
  const [selectedRegisterId, setSelectedRegisterId] = useState('')
  const [pairError, setPairError] = useState<string | null>(null)
  const [pairingResult, setPairingResult] = useState<CreatePairingCodeResult | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<DeviceView | null>(null)
  const [revokeReason, setRevokeReason] = useState<DeviceRevokeReason>('REPLACED')
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [recoverTarget, setRecoverTarget] = useState<DeviceView | null>(null)
  const [forceCloseShiftId, setForceCloseShiftId] = useState<string | null>(null)
  const [forceCloseCash, setForceCloseCash] = useState('0')
  const [forceCloseReason, setForceCloseReason] = useState('')
  const [forceCloseError, setForceCloseError] = useState<string | null>(null)

  const openShiftByRegister = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of openShifts) {
      map.set(s.registerId, s.id)
    }
    return map
  }, [openShifts])

  const forceCloseMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      forceCloseShiftFn({
        data: {
          shiftId: forceCloseShiftId ?? '',
          countedCash: Math.max(0, Number.parseInt(forceCloseCash, 10) || 0),
          reasonText: forceCloseReason,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setForceCloseError(t(res.errorKey, { defaultValue: t('admin.settings.failed') }))
        return
      }
      setForceCloseShiftId(null)
      toast.show({ tone: 'success', message: t('admin.attention.forceClose.successToast') })
      void queryClient.invalidateQueries({ queryKey: ['admin', tenantSlug, 'open-shifts'] })
    },
  })

  const activeDeviceRegisters = useMemo(() => {
    const busy = new Set<string>()
    for (const d of devices) {
      if (d.revokedAt === null) busy.add(d.registerId)
    }
    return busy
  }, [devices])

  const pairableRegisters = useMemo(
    () => registers.filter((r) => r.status === 'ACTIVE' && !activeDeviceRegisters.has(r.id)),
    [activeDeviceRegisters, registers],
  )

  const localeForDate = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  const pairMutation = useMutation({
    retry: 0,
    mutationFn: () => createPairingCodeFn({ data: { registerId: selectedRegisterId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setPairError(t(res.errorKey, { defaultValue: t('admin.devices.pairFailed') }))
        return
      }
      setSelectRegOpen(false)
      setPairingResult(res.data)
    },
    onError: () => {
      setPairError(t('admin.devices.pairFailed'))
    },
  })

  const revokeMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      revokeDeviceFn({
        data: {
          deviceId: revokeTarget!.id,
          reasonCode: revokeReason,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setRevokeError(t(res.errorKey, { defaultValue: t('admin.devices.revoke.failed') }))
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.devices(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.devices.revoke.succeeded') })
      setRevokeTarget(null)
    },
    onError: () => {
      setRevokeError(t('admin.devices.revoke.failed'))
    },
  })

  function openPairChooser() {
    setPairError(null)
    setSelectedRegisterId(pairableRegisters[0]?.id ?? '')
    setSelectRegOpen(true)
  }

  function handlePairSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedRegisterId) {
      setPairError(t('admin.devices.pairFailed'))
      return
    }
    setPairError(null)
    pairMutation.mutate()
  }

  const columns: readonly DataTableColumn<DeviceView>[] = [
    {
      id: 'name',
      header: t('admin.devices.colName'),
      stickyFirst: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="flex flex-col">
          <span>{r.name}</span>
          {r.neverSynced ? (
            <span className="text-caption text-ink-soft">{t('admin.devices.neverSynced')}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'register',
      header: t('admin.devices.colRegister'),
      cell: (r) => <span className="font-mono text-body-sm">{`${r.outletCode}-${r.registerCode}`}</span>,
    },
    {
      id: 'status',
      header: t('admin.devices.colStatus'),
      cell: (r) =>
        r.revokedAt ? (
          <Chip status="void" label={t('admin.devices.statusRevoked')} size="sm" />
        ) : (
          <Chip status="active" label={t('admin.devices.statusActive')} size="sm" />
        ),
    },
    {
      id: 'lastSync',
      header: t('admin.devices.colLastSync'),
      cell: (r) =>
        r.lastSuccessSyncAt
          ? formatDateTime(r.lastSuccessSyncAt, 'Asia/Jakarta', localeForDate)
          : t('admin.devices.neverSynced'),
    },
    {
      id: 'pending',
      header: t('admin.devices.colPending'),
      numeric: true,
      cell: (r) =>
        r.pendingCount > 0 ? (
          <Chip status="pending" label={String(r.pendingCount)} size="sm" />
        ) : (
          <span className="tabular-nums text-ink-soft">{r.pendingCount}</span>
        ),
    },
    {
      id: 'clock',
      header: t('admin.devices.colClockOffset'),
      cell: (r) => {
        const label = formatOffsetLabel(r.clockOffsetMs)
        if (r.clockOffsetMs !== null && Math.abs(r.clockOffsetMs) > TEN_MINUTES_MS) {
          return <Chip status="lease_warning" label={label} size="sm" />
        }
        return <span className="tabular-nums text-ink-soft">{label}</span>
      },
    },
    {
      id: 'persist',
      header: t('admin.devices.colPersist'),
      cell: (r) => t(`admin.devices.persist${r.storagePersist}`),
    },
    {
      id: 'version',
      header: t('admin.devices.colVersion'),
      cell: (r) =>
        r.appVersion
          ? r.appVersion
          : r.schemaVersion !== null
            ? `v${r.schemaVersion}`
            : t('common.dash'),
    },
    {
      id: 'action',
      header: t('admin.devices.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (r) => {
        const openShiftId = openShiftByRegister.get(r.registerId) ?? null
        return r.revokedAt === null ? (
          <div className="flex justify-end gap-2">
            {openShiftId ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setForceCloseError(null)
                  setForceCloseCash('0')
                  setForceCloseReason('')
                  setForceCloseShiftId(openShiftId)
                }}
              >
                {t('admin.attention.forceClose.button')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="md"
              onClick={() => setRecoverTarget(r)}
            >
              {t('admin.devices.actionRecover')}
            </Button>
            <Button
              variant="danger-outline"
              size="md"
              onClick={() => {
                setRevokeError(null)
                setRevokeReason('REPLACED')
                setRevokeTarget(r)
              }}
            >
              {t('admin.devices.actionRevoke')}
            </Button>
          </div>
        ) : null
      },
    },
  ]

  const registerSelectId = `${formIdPrefix}-pair-reg`

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="md"
          leadingIcon={<Plus className="size-4" aria-hidden="true" />}
          onClick={openPairChooser}
        >
          {t('admin.devices.pairButton')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.users.tabDevices')}
        columns={columns}
        rows={devices}
        loading={isLoading}
        getRowKey={(r) => r.id}
        emptyIcon={<TabletSmartphone className="size-8" aria-hidden="true" />}
        emptyTitle={t('admin.devices.emptyTitle')}
        emptyDescription={t('admin.devices.emptyDesc')}
        mobileActions={(r) =>
          r.revokedAt === null ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="md" onClick={() => setRecoverTarget(r)}>
                {t('admin.devices.actionRecover')}
              </Button>
              <Button
                variant="danger-outline"
                size="md"
                onClick={() => {
                  setRevokeError(null)
                  setRevokeReason('REPLACED')
                  setRevokeTarget(r)
                }}
              >
                {t('admin.devices.actionRevoke')}
              </Button>
            </div>
          ) : null
        }
      />

      <Dialog
        open={selectRegOpen}
        onOpenChange={setSelectRegOpen}
        title={t('admin.devices.pairDialogTitle')}
        size="sm"
      >
        <form onSubmit={handlePairSubmit} className="flex flex-col gap-4">
          {pairError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{pairError}</span>
            </div>
          ) : null}

          {pairableRegisters.length === 0 ? (
            <p className="text-body text-ink-soft">{t('admin.devices.noAvailableRegisters')}</p>
          ) : (
            <Field label={t('admin.devices.selectRegisterLabel')} htmlFor={registerSelectId}>
              <Select
                id={registerSelectId}
                value={selectedRegisterId}
                onValueChange={setSelectedRegisterId}
                options={pairableRegisters.map((r) => ({
                  value: r.id,
                  label: `${r.outletCode}-${r.code} · ${r.name}`,
                }))}
                placeholder={t('admin.devices.selectRegisterPlaceholder')}
                size="md"
              />
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setSelectRegOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            {pairableRegisters.length > 0 ? (
              <Button type="submit" variant="primary" size="md" loading={pairMutation.isPending}>
                {t('admin.devices.pairing.submitGenerate')}
              </Button>
            ) : null}
          </div>
        </form>
      </Dialog>

      <PairingDialog
        open={Boolean(pairingResult)}
        onOpenChange={(open) => !open && setPairingResult(null)}
        pairing={pairingResult}
      />

      <Dialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('admin.devices.revoke.confirmTitle', { name: revokeTarget?.name ?? '' })}
        description={t('admin.devices.revoke.confirmDesc')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setRevokeTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate()}
            >
              {t('admin.devices.revoke.confirmAction')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {revokeError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{revokeError}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <p className="text-label font-medium text-ink">
              {t('admin.devices.revoke.reasonLabel')}
            </p>
            <Radio
              ariaLabel={t('admin.devices.revoke.reasonLabel')}
              value={revokeReason}
              onValueChange={(v) => setRevokeReason(v as DeviceRevokeReason)}
              options={DEVICE_REVOKE_REASONS.map((code) => ({
                value: code,
                label: t(`admin.devices.revoke.reason${code}`),
              }))}
            />
          </div>
        </div>
      </Dialog>
      <RecoverRegisterWizard
        tenantSlug={tenantSlug}
        target={recoverTarget}
        onOpenChange={(open) => !open && setRecoverTarget(null)}
      />
      <Dialog
        open={Boolean(forceCloseShiftId)}
        onOpenChange={(open) => !open && setForceCloseShiftId(null)}
        title={t('admin.attention.forceClose.dialogTitle')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setForceCloseShiftId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={forceCloseMutation.isPending}
              disabled={forceCloseReason.trim().length === 0}
              onClick={() => forceCloseMutation.mutate()}
            >
              {t('admin.attention.forceClose.confirmButton')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {forceCloseError ? (
            <div
              role="alert"
              className="rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <span>{forceCloseError}</span>
            </div>
          ) : null}
          <Field
            label={t('admin.attention.forceClose.countedCashLabel')}
            htmlFor={`${formIdPrefix}-fc-cash`}
          >
            <Input
              id={`${formIdPrefix}-fc-cash`}
              type="number"
              min={0}
              value={forceCloseCash}
              onChange={(e) => setForceCloseCash(e.target.value)}
            />
          </Field>
          <Field
            label={t('admin.attention.forceClose.reasonLabel')}
            htmlFor={`${formIdPrefix}-fc-reason`}
          >
            <Input
              id={`${formIdPrefix}-fc-reason`}
              value={forceCloseReason}
              onChange={(e) => setForceCloseReason(e.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
