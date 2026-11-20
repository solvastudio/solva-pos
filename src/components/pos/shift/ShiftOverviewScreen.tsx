import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { EmptyState } from '~/components/ui/EmptyState'
import { Clock } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { listCashMovementsForShift } from '~/pos/data/cash-movement.repo'
import { listCreditNoteRefundsForShift } from '~/pos/data/credit-note.repo'
import { listSalePaymentsForShift, listSalesForShift } from '~/pos/data/sale.repo'
import { computeLocalShiftRecap, type LocalShiftRecap } from '~/pos/domain/local-shift-recap'

export interface ShiftOverviewScreenProps {
  tenant: string
  bootResult: BootResult
}

export function ShiftOverviewScreen({ tenant, bootResult }: ShiftOverviewScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const shell = usePosShellActions(tenant, bootResult)
  const [recap, setRecap] = useState<LocalShiftRecap | null>(null)

  useEffect(() => {
    if (!shell.db || !shell.openShift) {
      setRecap(null)
      return
    }
    const shift = shell.openShift
    const db = shell.db
    let cancelled = false
    void Promise.all([
      listSalesForShift(db, shift.id),
      listSalePaymentsForShift(db, shift.id),
      listCashMovementsForShift(db, shift.id),
      listCreditNoteRefundsForShift(db, shift.id),
    ]).then(([sales, salePayments, cashMovements, creditNoteRefunds]) => {
      if (cancelled) return
      setRecap(computeLocalShiftRecap({ shift, sales, salePayments, cashMovements, creditNoteRefunds }))
    })
    return () => {
      cancelled = true
    }
  }, [shell.db, shell.openShift])

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
        <h1 className="text-h2 font-semibold text-ink">{t('pos.closeShift.title')}</h1>

        {!shell.openShift ? (
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
          <>
            <Card className="flex flex-col gap-2 p-4 text-body">
              <div className="flex justify-between">
                <span className="text-ink-soft">{t('pos.closeShift.openedAtLabel')}</span>
                <span className="text-ink">
                  {new Date(shell.openShift.occurred_at).toLocaleString(locale)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-soft">{t('pos.closeShift.openingCashLabel')}</span>
                <span className="font-mono text-ink">
                  {formatMoney(toMoney(shell.openShift.opening_cash), locale)}
                </span>
              </div>
              {recap ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{t('pos.closeShift.cashSalesLabel')}</span>
                    <span className="font-mono text-ink">{formatMoney(recap.cashSalesTotal, locale)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{t('pos.closeShift.cashInLabel')}</span>
                    <span className="font-mono text-ink">{formatMoney(recap.cashInTotal, locale)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{t('pos.closeShift.cashOutLabel')}</span>
                    <span className="font-mono text-ink">{formatMoney(recap.cashOutTotal, locale)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">{t('pos.closeShift.cashRefundsLabel')}</span>
                    <span className="font-mono text-ink">{formatMoney(recap.cashRefundsTotal, locale)}</span>
                  </div>
                </>
              ) : null}
            </Card>

            {recap ? (
              <Card className="flex flex-col gap-2 p-4 text-body">
                <h2 className="text-h3 font-semibold text-ink">{t('pos.closeShift.nonCashHeading')}</h2>
                {recap.methods.filter((m) => m.kind === 'NON_CASH').length === 0 ? (
                  <p className="text-ink-soft">{t('pos.closeShift.noNonCash')}</p>
                ) : (
                  recap.methods
                    .filter((m) => m.kind === 'NON_CASH')
                    .map((m) => (
                      <div key={m.methodCode} className="flex justify-between">
                        <span className="text-ink-soft">{m.methodName}</span>
                        <span className="font-mono text-ink">{formatMoney(m.totalApplied, locale)}</span>
                      </div>
                    ))
                )}
              </Card>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                size="xl"
                className="flex-1"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/cash` })}
              >
                {t('pos.cash.title')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="xl"
                className="flex-1"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/shift/close` })}
              >
                {t('pos.closeShift.closeActionTitle')}
              </Button>
            </div>
          </>
        )}
      </div>
    </PosWorkspaceShell>
  )
}
