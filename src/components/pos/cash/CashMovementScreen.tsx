import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip } from '~/components/ui/Chip'
import { EmptyState } from '~/components/ui/EmptyState'
import { Input } from '~/components/ui/Input'
import { MoneyInput } from '~/components/ui/MoneyInput'
import { Segmented } from '~/components/ui/Segmented'
import { Select } from '~/components/ui/Select'
import { useToast } from '~/components/ui/Toast'
import { Banknote } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { observeCashMovementsForShift } from '~/pos/data/cash-movement.repo'
import type { CashMovementRecord } from '~/pos/db/types'
import { recordCashMovement } from '~/pos/usecases/shift/record-cash-movement'

export interface CashMovementScreenProps {
  tenant: string
  bootResult: BootResult
}

const QUICK_AMOUNTS = [10_000, 50_000, 100_000, 500_000] as const
const REASON_CODES = ['TOPUP', 'PETTY', 'SUPPLIER', 'DROP', 'OTHER'] as const

export function CashMovementScreen({ tenant, bootResult }: CashMovementScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)

  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT')
  const [amount, setAmount] = useState<number | null>(null)
  const [reasonCode, setReasonCode] = useState<string>('PETTY')
  const [reasonText, setReasonText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [movements, setMovements] = useState<CashMovementRecord[]>([])

  const shiftId = shell.openShift?.id ?? null

  useEffect(() => {
    if (!shell.db || !shiftId) {
      setMovements([])
      return
    }
    const sub = observeCashMovementsForShift(shell.db, shiftId).subscribe({
      next(rows) {
        setMovements(rows)
      },
    })
    return () => sub.unsubscribe()
  }, [shell.db, shiftId])

  const hasPermission = shell.sessionStaff?.permissions.has('cash.in_out') ?? false

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!shell.db || !shell.sessionStaff || !amount || amount <= 0 || !reasonText.trim()) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      await recordCashMovement(shell.db, {
        direction,
        amount,
        reasonCode,
        reasonText: reasonText.trim(),
        staffId: shell.sessionStaff.staffId,
      })
      setAmount(null)
      setReasonText('')
      showToast({ tone: 'success', message: t('pos.cash.savedToast') })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('pos.cash.errorGeneric'))
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <h1 className="text-h2 font-semibold text-ink">{t('pos.cash.title')}</h1>

        {!shell.openShift ? (
          <EmptyState
            icon={<Banknote className="size-12" />}
            title={t('pos.cash.noShiftTitle')}
            description={t('pos.cash.noShiftDesc')}
            action={
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/shift/open` })}
              >
                {t('pos.cash.openShiftCta')}
              </Button>
            }
          />
        ) : !hasPermission ? (
          <Card className="border-warning-line bg-warning-soft p-4 text-body text-warning-ink">
            {t('pos.cash.noPermissionBanner')}
          </Card>
        ) : (
          <Card className="p-4">
            <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
              <div className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink">{t('pos.cash.directionLabel')}</span>
                <Segmented
                  ariaLabel={t('pos.cash.directionLabel')}
                  value={direction}
                  onChange={(v) => setDirection(v as 'IN' | 'OUT')}
                  options={[
                    { value: 'IN', label: t('pos.cash.dirIn') },
                    { value: 'OUT', label: t('pos.cash.dirOut') },
                  ]}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-label font-medium text-ink" htmlFor="cash-amount-input">
                  {t('pos.cash.amountLabel')}
                </label>
                <MoneyInput
                  id="cash-amount-input"
                  value={amount}
                  onChange={setAmount}
                  ariaLabel={t('pos.cash.amountLabel')}
                />
                <div className="mt-1 flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map((quick) => (
                    <Button
                      key={quick}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setAmount(quick)}
                    >
                      {formatMoney(toMoney(quick), locale)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-label font-medium text-ink" htmlFor="cash-reason-select">
                  {t('pos.cash.reasonCodeLabel')}
                </label>
                <Select
                  id="cash-reason-select"
                  value={reasonCode}
                  onValueChange={setReasonCode}
                  options={REASON_CODES.map((c) => ({
                    value: c,
                    label: t(`pos.cash.reasonCodes.${c}`),
                  }))}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-label font-medium text-ink" htmlFor="cash-reason-text">
                  {t('pos.cash.reasonTextLabel')}
                </label>
                <Input
                  id="cash-reason-text"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder={t('pos.cash.reasonTextPlaceholder')}
                />
              </div>

              {errorMsg ? <p className="text-body text-danger-ink">{errorMsg}</p> : null}

              <Button
                type="submit"
                variant="primary"
                size="xl"
                fullWidth
                loading={submitting}
                disabled={!amount || amount <= 0 || !reasonText.trim()}
              >
                {t('pos.cash.submitButton')}
              </Button>
            </form>
          </Card>
        )}

        {shell.openShift ? (
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-h3 font-semibold text-ink">{t('pos.cash.listHeading')}</h2>
            {movements.length === 0 ? (
              <p className="text-body text-ink-soft">{t('pos.cash.emptyList')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {movements.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <p className="text-label font-medium text-ink">{m.reason_text}</p>
                      <p className="text-caption text-ink-soft">
                        {t(`pos.cash.reasonCodes.${m.reason_code}`, { defaultValue: m.reason_code })} ·{' '}
                        {new Date(m.occurred_at).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip
                        status={m.direction === 'IN' ? 'synced' : 'pending'}
                        label={m.direction === 'IN' ? t('pos.cash.dirIn') : t('pos.cash.dirOut')}
                      />
                      <span className="font-mono text-label font-semibold text-ink">
                        {formatMoney(toMoney(m.amount), locale)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </PosWorkspaceShell>
  )
}
