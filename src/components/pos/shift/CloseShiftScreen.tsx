import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip } from '~/components/ui/Chip'
import { Dialog } from '~/components/ui/Dialog'
import { EmptyState } from '~/components/ui/EmptyState'
import { Input } from '~/components/ui/Input'
import { MoneyInput } from '~/components/ui/MoneyInput'
import { Check, Clock } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { closeShift, type CloseShiftResult } from '~/pos/usecases/shift/close-shift'

export interface CloseShiftScreenProps {
  tenant: string
  bootResult: BootResult
}

export function CloseShiftScreen({ tenant, bootResult }: CloseShiftScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const shell = usePosShellActions(tenant, bootResult)

  const [countedCash, setCountedCash] = useState<number | null>(null)
  const [closeNote, setCloseNote] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [closedResult, setClosedResult] = useState<CloseShiftResult | null>(null)

  async function handleConfirmClose() {
    if (!shell.db || !shell.sessionStaff || countedCash === null || countedCash < 0) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await closeShift(shell.db, {
        countedCash,
        staffId: shell.sessionStaff.staffId,
        closeNote: closeNote.trim() || null,
      })
      setConfirmOpen(false)
      setClosedResult(res)
    } catch (err) {
      setConfirmOpen(false)
      setErrorMsg(err instanceof Error ? err.message : t('pos.closeShift.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      activeNav="shift"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
        <h1 className="text-h2 font-semibold text-ink">{t('pos.closeShift.closeActionTitle')}</h1>

        {closedResult ? (
          <Card className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-ink">
                <Check className="size-6" />
              </div>
              <p className="text-body font-medium text-ink">{t('pos.closeShift.lockedBanner')}</p>
            </div>

            <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-sunken p-4 text-body">
              <div className="flex justify-between">
                <span className="text-ink-soft">{t('pos.closeShift.expectedCashLabel')}</span>
                <span className="font-mono font-semibold text-ink">
                  {formatMoney(closedResult.expectedCash, locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">{t('pos.closeShift.countedCashLabel')}</span>
                <span className="font-mono font-semibold text-ink">
                  {formatMoney(toMoney(closedResult.shift.counted_cash ?? 0), locale)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-line pt-2">
                <span className="font-semibold text-ink">{t('pos.closeShift.varianceLabel')}</span>
                <div className="flex items-center gap-2">
                  <Chip
                    status={closedResult.variance === 0 ? 'synced' : 'needs_attention'}
                    label={
                      closedResult.variance === 0
                        ? t('pos.closeShift.varianceMatch')
                        : closedResult.variance > 0
                          ? t('pos.closeShift.varianceOver')
                          : t('pos.closeShift.varianceShort')
                    }
                  />
                  <span className="font-mono text-h3 font-semibold text-ink">
                    {formatMoney(closedResult.variance, locale)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-body">
              <h2 className="text-h3 font-semibold text-ink">{t('pos.closeShift.nonCashHeading')}</h2>
              {closedResult.recap.methods.filter((m) => m.kind === 'NON_CASH').length === 0 ? (
                <p className="text-ink-soft">{t('pos.closeShift.noNonCash')}</p>
              ) : (
                closedResult.recap.methods
                  .filter((m) => m.kind === 'NON_CASH')
                  .map((m) => (
                    <div key={m.methodCode} className="flex justify-between">
                      <span className="text-ink-soft">{m.methodName}</span>
                      <span className="font-mono text-ink">{formatMoney(m.totalApplied, locale)}</span>
                    </div>
                  ))
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/history` })}
              >
                {t('pos.closeShift.historyButton')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/shift/open` })}
              >
                {t('pos.closeShift.openNextShiftButton')}
              </Button>
            </div>
          </Card>
        ) : !shell.openShift ? (
          <EmptyState
            icon={<Clock className="size-12" />}
            title={t('pos.closeShift.noOpenShiftTitle')}
            description={t('pos.closeShift.noOpenShiftDesc')}
            action={
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/shift/open` })}
              >
                {t('pos.closeShift.openShiftButton')}
              </Button>
            }
          />
        ) : (
          <Card className="flex flex-col gap-4 p-5">
            <p className="text-body text-ink-soft">{t('pos.closeShift.blindHint')}</p>

            <div className="flex flex-col gap-1">
              <label className="text-label font-medium text-ink" htmlFor="counted-cash-input">
                {t('pos.closeShift.countedInputLabel')}
              </label>
              <MoneyInput
                id="counted-cash-input"
                value={countedCash}
                onChange={setCountedCash}
                disabled={submitting}
                ariaLabel={t('pos.closeShift.countedInputLabel')}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-label font-medium text-ink" htmlFor="close-note-input">
                {t('pos.closeShift.noteLabel')}
              </label>
              <Input
                id="close-note-input"
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                disabled={submitting}
                placeholder={t('pos.closeShift.notePlaceholder')}
              />
            </div>

            {errorMsg ? <p className="text-body text-danger-ink">{errorMsg}</p> : null}

            <Button
              type="button"
              variant="primary"
              size="xl"
              fullWidth
              disabled={countedCash === null || countedCash < 0 || submitting}
              onClick={() => setConfirmOpen(true)}
            >
              {t('pos.closeShift.submitButton')}
            </Button>
          </Card>
        )}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('pos.closeShift.confirmTitle', {
          amount: countedCash !== null ? formatMoney(toMoney(countedCash), locale) : '',
        })}
        description={t('pos.closeShift.confirmDesc')}
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={submitting}
              onClick={() => void handleConfirmClose()}
            >
              {t('pos.closeShift.confirmSubmit')}
            </Button>
          </div>
        }
      >
        {null}
      </Dialog>
    </PosWorkspaceShell>
  )
}
