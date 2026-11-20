import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { useToast } from '~/components/ui/Toast'
import {
  Archive,
  Banknote,
  Clock,
  Lock,
  ReceiptText,
  Settings,
  Undo2,
} from '~/components/ui/icons'
import type { BootResult } from '~/pos/boot/boot'
import { usePrinter } from '~/pos/hooks/use-printer'
import { useSyncState } from '~/pos/hooks/use-sync-state'

export interface MoreScreenProps {
  tenant: string
  bootResult: BootResult
}

export function MoreScreen({ tenant, bootResult }: MoreScreenProps) {
  const { t } = useTranslation()
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)
  const { syncState } = useSyncState()
  const printer = usePrinter(
    shell.db,
    shell.device?.outlet_id ?? null,
    shell.device?.register_id ?? null,
  )
  const [openingDrawer, setOpeningDrawer] = useState(false)

  const canOpenDrawer =
    Boolean(shell.sessionStaff?.permissions.has('drawer.open')) &&
    printer.capabilities.canOpenDrawer

  async function handleManualDrawer() {
    if (!shell.sessionStaff) return
    setOpeningDrawer(true)
    try {
      await printer.openDrawer(shell.sessionStaff.staffId)
      showToast({ tone: 'success', message: t('pos.print.drawerOpened') })
    } catch {
      showToast({ tone: 'danger', message: t('pos.print.drawerFailed') })
    } finally {
      setOpeningDrawer(false)
    }
  }

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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-h2 font-semibold text-ink">{t('pos.more.title')}</h1>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <Banknote className="mt-0.5 size-5 text-ink-brand" />
              <div>
                <h2 className="text-h3 font-semibold text-ink">{t('pos.cash.title')}</h2>
                <p className="text-body text-ink-soft">{t('pos.more.cashDesc')}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/cash` })}
            >
              {t('pos.cash.title')}
            </Button>
          </Card>

          <Card className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <Undo2 className="mt-0.5 size-5 text-ink-brand" />
              <div>
                <h2 className="text-h3 font-semibold text-ink">{t('pos.more.returnTitle')}</h2>
                <p className="text-body text-ink-soft">{t('pos.more.returnDesc')}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/return/lookup` })}
            >
              {t('pos.return.lookupButton')}
            </Button>
          </Card>

          <Card className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 size-5 text-ink-brand" />
              <div>
                <h2 className="text-h3 font-semibold text-ink">
                  {shell.openShift ? t('pos.more.closeShiftTitle') : t('pos.closeShift.openShiftButton')}
                </h2>
                <p className="text-body text-ink-soft">
                  {shell.openShift ? t('pos.more.closeShiftDesc') : t('pos.more.openShiftDesc')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() =>
                void shell.navigate({
                  href: shell.openShift
                    ? `/${shell.cleanSlug}/pos/shift/close`
                    : `/${shell.cleanSlug}/pos/shift/open`,
                })
              }
            >
              {shell.openShift ? t('pos.more.closeShiftTitle') : t('pos.closeShift.openShiftButton')}
            </Button>
          </Card>

          <Card className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <ReceiptText className="mt-0.5 size-5 text-ink-brand" />
              <div>
                <h2 className="text-h3 font-semibold text-ink">{t('pos.history.title')}</h2>
                <p className="text-body text-ink-soft">
                  {t('pos.more.syncQueueDesc', { count: syncState.queue.pending })}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/history` })}
            >
              {t('pos.history.title')}
            </Button>
          </Card>

          <Card className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <Settings className="mt-0.5 size-5 text-ink-brand" />
              <div>
                <h2 className="text-h3 font-semibold text-ink">{t('pos.more.settingsTitle')}</h2>
                <p className="text-body text-ink-soft">{t('pos.more.settingsDesc')}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/settings` })}
            >
              {t('pos.more.settingsTitle')}
            </Button>
          </Card>

          <Card className="flex flex-col justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <ReceiptText className="mt-0.5 size-5 text-ink-brand" />
              <div>
                <h2 className="text-h3 font-semibold text-ink">{t('pos.queue.title')}</h2>
                <p className="text-body text-ink-soft">
                  {t('pos.more.syncQueueDesc', { count: syncState.queue.pending })}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/queue` })}
            >
              {t('pos.queue.title')}
            </Button>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          {canOpenDrawer ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              loading={openingDrawer}
              leadingIcon={<Archive className="size-4" />}
              onClick={() => void handleManualDrawer()}
            >
              {t('pos.more.openDrawerButton')}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="tonal"
            size="lg"
            leadingIcon={<Lock className="size-4" />}
            onClick={() => void shell.handleLockScreen()}
          >
            {t('pos.more.lockButton')}
          </Button>
        </div>
      </div>
    </PosWorkspaceShell>
  )
}
