import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip } from '~/components/ui/Chip'
import { Select } from '~/components/ui/Select'
import { useToast } from '~/components/ui/Toast'
import { Ban, Printer, Undo2 } from '~/components/ui/icons'
import { formatMoney, toMoney } from '~/lib/kernel'
import type { BootResult } from '~/pos/boot/boot'
import { getSaleWithDetails } from '~/pos/data/sale.repo'
import type { SaleLineRecord, SalePaymentRecord, SaleRecord } from '~/pos/db/types'
import { kickActivePrintQueue } from '~/pos/printing/runtime'
import { kickActiveSync } from '~/pos/sync'
import { reprintSale } from '~/pos/usecases/print/reprint'
import { voidSale, VoidSaleError } from '~/pos/usecases/sales/void-sale'

type VoidReasonCode = 'MISTAKE' | 'CANCELLED' | 'DUPLICATE' | 'OTHER'

const LazySupervisorPinDialog = lazy(() =>
  import('~/components/pos/SupervisorPinDialog').then((m) => ({
    default: m.SupervisorPinDialog,
  })),
)

export interface SaleDetailScreenProps {
  tenant: string
  saleId: string
  bootResult: BootResult
}

function extractServerFlags(result: Record<string, unknown> | null): string[] {
  if (!result || !Array.isArray(result.flags)) return []
  return result.flags
    .map((f) => (typeof f === 'string' ? f : (f as { code?: string })?.code ?? ''))
    .filter((s) => s.length > 0)
}

export function SaleDetailScreen({ tenant, saleId, bootResult }: SaleDetailScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { show: showToast } = useToast()
  const shell = usePosShellActions(tenant, bootResult)

  const [sale, setSale] = useState<SaleRecord | null>(null)
  const [lines, setLines] = useState<SaleLineRecord[]>([])
  const [payments, setPayments] = useState<SalePaymentRecord[]>([])
  const [voidReasonCode, setVoidReasonCode] = useState<VoidReasonCode>('MISTAKE')
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!shell.db) return
    let cancelled = false
    void getSaleWithDetails(shell.db, saleId).then((details) => {
      if (cancelled || !details) return
      setSale(details.sale)
      setLines(details.lines)
      setPayments(details.payments)
    })
    return () => {
      cancelled = true
    }
  }, [shell.db, saleId])

  const sameOpenShift = Boolean(sale && shell.openShift && sale.shift_id === shell.openShift.id)
  const canVoid = Boolean(sale && sale.status === 'PAID' && sameOpenShift)
  const voidDisabledReason = !sale
    ? ''
    : sale.status === 'VOID'
      ? t('pos.history.voidDisabledAlreadyVoid')
      : !sameOpenShift
        ? t('pos.history.voidDisabledClosedShift')
        : ''

  async function handleVoidApproved(res: { approverId: string; reason: string }) {
    if (!shell.db || !shell.sessionStaff || !sale) return
    setErrorMsg(null)
    try {
      const updated = await voidSale(shell.db, {
        saleId: sale.id,
        requesterId: shell.sessionStaff.staffId,
        approverId: res.approverId,
        reasonCode: voidReasonCode,
        reasonText: res.reason,
      })
      setSale(updated)
      setVoidDialogOpen(false)
      showToast({ tone: 'success', message: t('pos.history.voidSuccess', { invoiceNo: updated.invoice_no }) })
      void kickActiveSync()
    } catch (err) {
      setErrorMsg(err instanceof VoidSaleError ? err.message : t('pos.history.notFound'))
    }
  }

  async function handleReprint() {
    if (!shell.db || !shell.device || !sale) return
    await reprintSale(shell.db, sale.id)
    void kickActivePrintQueue()
    showToast({ tone: 'info', message: t('pos.history.reprintQueued') })
  }

  const flags = sale ? extractServerFlags(sale.server_result) : []

  return (
    <PosWorkspaceShell
      tenantName={shell.tenantName}
      tenantSlug={shell.cleanSlug}
      outletLabel={shell.outletLabel}
      staffName={shell.staffName}
      shiftOpen={Boolean(shell.openShift)}
      activeNav="history"
      onSyncNow={shell.handleSyncNow}
      onLocaleChange={shell.handleLocaleChange}
      onLockScreen={() => void shell.handleLockScreen()}
      onSwitchStaff={shell.handleSwitchStaff}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/history` })}
          >
            {t('pos.history.backToList')}
          </Button>
          {sale ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="tonal"
                size="md"
                leadingIcon={<Printer className="size-4" />}
                onClick={() => void handleReprint()}
              >
                {t('pos.history.reprintButton')}
              </Button>
              {sale.status === 'PAID' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  leadingIcon={<Undo2 className="size-4" />}
                  onClick={() =>
                    void shell.navigate({ href: `/${shell.cleanSlug}/pos/return/${sale.id}` })
                  }
                >
                  {t('pos.history.returnButton')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="danger"
                size="md"
                disabled={!canVoid}
                leadingIcon={<Ban className="size-4" />}
                onClick={() => setVoidDialogOpen(true)}
              >
                {t('pos.history.voidButton')}
              </Button>
            </div>
          ) : null}
        </div>

        {!sale ? (
          <Card className="p-6 text-center text-body text-ink-soft">{t('pos.history.notFound')}</Card>
        ) : (
          <>
            {sale.status === 'VOID' && sale.voided_at ? (
              <Card className="border-danger-line bg-danger-soft p-4 text-body font-medium text-danger-ink">
                {t('pos.history.voidBanner', {
                  date: new Date(sale.voided_at).toLocaleString(locale),
                })}
                {sale.void_reason_text ? ` — ${sale.void_reason_text}` : ''}
              </Card>
            ) : null}

            {!canVoid && voidDisabledReason ? (
              <p className="text-caption text-ink-soft">{voidDisabledReason}</p>
            ) : null}

            {errorMsg ? <p className="text-body text-danger-ink">{errorMsg}</p> : null}

            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="font-mono text-h2 font-semibold text-ink">
                  {t('pos.history.detailTitle', { invoiceNo: sale.invoice_no })}
                </h1>
                <Chip
                  status={sale.status === 'VOID' ? 'void' : 'synced'}
                  label={
                    sale.status === 'VOID' ? t('pos.history.filterVoid') : t('pos.history.filterPaid')
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-body">
                <span className="text-ink-soft">{t('pos.history.cashierLabel')}</span>
                <span className="text-right font-medium text-ink">
                  {shell.staffMap.get(sale.created_by) ?? sale.created_by}
                </span>
                <span className="text-ink-soft">{t('pos.history.timeLabel')}</span>
                <span className="text-right text-ink">
                  {new Date(sale.occurred_at).toLocaleString(locale)}
                </span>
              </div>

              {flags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="text-caption text-ink-soft">{t('pos.history.serverFlagsHeading')}</span>
                  {flags.map((flag) => (
                    <Chip key={flag} status="needs_attention" label={flag} />
                  ))}
                </div>
              ) : null}
            </Card>

            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-h3 font-semibold text-ink">
                {t('pos.history.linesHeading', { count: lines.length })}
              </h2>
              <div className="flex flex-col gap-2">
                {lines.map((line) => (
                  <div key={line.id} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-b-0 last:pb-0">
                    <div>
                      <p className="text-label font-medium text-ink">{line.item_name}</p>
                      <p className="text-caption text-ink-soft">
                        {`${line.qty} ${line.uom_code} \u00d7 ${formatMoney(toMoney(line.unit_price), locale)}`}
                      </p>
                    </div>
                    <span className="font-mono text-label font-medium text-ink">
                      {formatMoney(toMoney(line.line_net), locale)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="flex flex-col gap-2 p-4 text-body">
              <h2 className="text-h3 font-semibold text-ink">{t('pos.history.paymentsHeading')}</h2>
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <span className="text-ink-soft">{p.method_name}</span>
                  <span className="font-mono text-ink">{formatMoney(toMoney(p.amount_applied), locale)}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-semibold text-ink">
                <span>{t('pos.history.totalLabel')}</span>
                <span className="font-mono text-h3">{formatMoney(toMoney(sale.total_due), locale)}</span>
              </div>
            </Card>

            {canVoid ? (
              <Card className="flex flex-col gap-2 p-4">
                <label className="text-label font-medium text-ink" htmlFor="void-reason-select">
                  {t('pos.history.voidReasonCodeLabel')}
                </label>
                <Select
                  id="void-reason-select"
                  value={voidReasonCode}
                  onValueChange={(v) => setVoidReasonCode(v as VoidReasonCode)}
                  options={[
                    { value: 'MISTAKE', label: t('pos.history.voidReasonOptions.MISTAKE') },
                    { value: 'CANCELLED', label: t('pos.history.voidReasonOptions.CANCELLED') },
                    { value: 'DUPLICATE', label: t('pos.history.voidReasonOptions.DUPLICATE') },
                    { value: 'OTHER', label: t('pos.history.voidReasonOptions.OTHER') },
                  ]}
                />
              </Card>
            ) : null}
          </>
        )}
      </div>

      {voidDialogOpen && shell.db && shell.device && shell.sessionStaff ? (
        <Suspense fallback={null}>
          <LazySupervisorPinDialog
            open={voidDialogOpen}
            onOpenChange={setVoidDialogOpen}
            db={shell.db}
            outletId={shell.device.outlet_id}
            deviceId={shell.device.device_id}
            registerId={shell.device.register_id}
            requesterId={shell.sessionStaff.staffId}
            permission="sale.void"
            trustedNowMs={shell.clockBounds.trustedNowMs}
            maxSeenMs={shell.clockBounds.maxSeenMs}
            title={t('pos.history.voidReasonTitle')}
            onApproved={handleVoidApproved}
          />
        </Suspense>
      ) : null}
    </PosWorkspaceShell>
  )
}
