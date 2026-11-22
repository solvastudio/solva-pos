import { lazy, Suspense, useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { Input } from '~/components/ui/Input'
import { MoneyInput } from '~/components/ui/MoneyInput'
import { TriangleAlert } from '~/components/ui/icons'
import { toMoney, ZERO } from '~/lib/kernel'
import { calcSale, checkDiscountLimit } from '~/lib/sales-calc'
import type { SolvaDb } from '~/pos/db/solva-db'
import {
  setBillDiscount as applyBillDiscountPure,
  setLineDiscount as applyLineDiscountPure,
  toCalcInput,
  type CartDiscount,
  type CartLine,
  type CartState,
} from '~/pos/domain/cart'

const LazySupervisorPinDialog = lazy(() =>
  import('../SupervisorPinDialog').then((m) => ({
    default: m.SupervisorPinDialog,
  })),
)

export type DiscountTarget =
  | { readonly kind: 'LINE'; readonly line: CartLine }
  | { readonly kind: 'BILL' }

export interface DiscountDialogProps {
  open: boolean
  target: DiscountTarget | null
  cart: CartState
  roleLimitPct: string
  db: SolvaDb | null
  outletId: string
  deviceId: string
  registerId: string
  requesterId: string
  trustedNowMs: number
  maxSeenMs: number
  onOpenChange: (open: boolean) => void
  onApply: (
    discount: CartDiscount | null,
    approval?: { approverId: string; reason: string },
  ) => void
}

export function DiscountDialog({
  open,
  target,
  cart,
  roleLimitPct,
  db,
  outletId,
  deviceId,
  registerId,
  requesterId,
  trustedNowMs,
  maxSeenMs,
  onOpenChange,
  onApply,
}: DiscountDialogProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const existing =
    target?.kind === 'LINE' ? target.line.discount : target?.kind === 'BILL' ? cart.billDiscount : undefined

  const [mode, setMode] = useState<'PERCENT' | 'NOMINAL'>(existing?.type ?? 'PERCENT')
  const [pctText, setPctText] = useState(existing?.type === 'PERCENT' ? existing.pct ?? '' : '')
  const [nominal, setNominal] = useState<number | null>(
    existing?.type === 'NOMINAL' ? existing.input ?? null : null,
  )
  const [pinDialogOpen, setPinDialogOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setPinDialogOpen(false)
      return
    }
    const cur =
      target?.kind === 'LINE'
        ? target.line.discount
        : target?.kind === 'BILL'
          ? cart.billDiscount
          : undefined
    setMode(cur?.type ?? 'PERCENT')
    setPctText(cur?.type === 'PERCENT' ? cur.pct ?? '' : '')
    setNominal(cur?.type === 'NOMINAL' ? cur.input ?? null : null)
  }, [cart.billDiscount, open, target])

  const proposedDiscount = useMemo<CartDiscount | null>(() => {
    if (mode === 'PERCENT') {
      const cleaned = pctText.trim().replace(',', '.')
      const n = Number(cleaned)
      if (!cleaned || !Number.isFinite(n) || n <= 0) return null
      return { type: 'PERCENT', pct: cleaned }
    }
    if (nominal === null || !Number.isSafeInteger(nominal) || nominal <= 0) return null
    return { type: 'NOMINAL', input: toMoney(nominal) }
  }, [mode, nominal, pctText])

  const limitEval = useMemo(() => {
    if (!target || cart.lines.length === 0) return null
    const nextRes =
      target.kind === 'LINE'
        ? applyLineDiscountPure(cart, target.line.id, proposedDiscount)
        : applyBillDiscountPure(cart, proposedDiscount)
    if (!nextRes.ok) return null
    try {
      const simulated = calcSale(toCalcInput(nextRes.cart))
      const s1 = toMoney(simulated.lines.reduce<number>((acc, l) => acc + l.lineNet, ZERO))
      return checkDiscountLimit({
        lines: simulated.lines.map((l) => ({
          lineGross: l.lineGross,
          lineDiscount: l.lineDiscount,
        })),
        billDiscount: simulated.billDiscountTotal,
        s1,
        roleLimitPct,
      })
    } catch {
      return null
    }
  }, [cart, proposedDiscount, roleLimitPct, target])

  if (!target) return null

  const title =
    target.kind === 'LINE'
      ? t('pos.cart.discountTitleLine', { name: target.line.itemName })
      : t('pos.cart.discountTitleBill')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!proposedDiscount) {
      onApply(null)
      onOpenChange(false)
      return
    }
    if (limitEval?.needsApproval) {
      setPinDialogOpen(true)
      return
    }
    onApply(proposedDiscount)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title={title} size="sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === 'PERCENT' ? 'primary' : 'secondary'}
              size="md"
              onClick={() => setMode('PERCENT')}
            >
              {t('pos.cart.discountTypePercent')}
            </Button>
            <Button
              type="button"
              variant={mode === 'NOMINAL' ? 'primary' : 'secondary'}
              size="md"
              onClick={() => setMode('NOMINAL')}
            >
              {t('pos.cart.discountTypeNominal')}
            </Button>
          </div>

          <Field htmlFor={inputId} label={t('pos.cart.discountValueLabel')}>
            {mode === 'PERCENT' ? (
              <Input
                id={inputId}
                type="text"
                inputMode="decimal"
                value={pctText}
                onChange={(e) => setPctText(e.target.value)}
              />
            ) : (
              <MoneyInput id={inputId} value={nominal} onChange={setNominal} />
            )}
          </Field>

          {limitEval?.needsApproval ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-card border border-warning-line bg-warning-soft p-3 text-caption text-warning-ink"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t('pos.cart.discountNeedsApproval', { limit: roleLimitPct })}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onApply(null)
                onOpenChange(false)
              }}
            >
              {t('pos.cart.discountRemove')}
            </Button>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" size="md">
                {t('pos.cart.discountApply')}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      {pinDialogOpen && db && proposedDiscount ? (
        <Suspense fallback={null}>
          <LazySupervisorPinDialog
            open={pinDialogOpen}
            onOpenChange={setPinDialogOpen}
            db={db}
            outletId={outletId}
            deviceId={deviceId}
            registerId={registerId}
            requesterId={requesterId}
            permission="discount.approve"
            requestedPct={limitEval?.requestedPct ?? '0'}
            trustedNowMs={trustedNowMs}
            maxSeenMs={maxSeenMs}
            onApproved={(res) => {
              onApply(proposedDiscount, { approverId: res.approverId, reason: res.reason })
              setPinDialogOpen(false)
              onOpenChange(false)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}
