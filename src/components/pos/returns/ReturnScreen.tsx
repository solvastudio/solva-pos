import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PosWorkspaceShell } from '~/components/pos/shell/PosWorkspaceShell'
import { usePosShellActions } from '~/components/pos/shell/use-pos-shell-actions'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { Chip } from '~/components/ui/Chip'
import { EmptyState } from '~/components/ui/EmptyState'
import { Input } from '~/components/ui/Input'
import { Segmented } from '~/components/ui/Segmented'
import { Select } from '~/components/ui/Select'
import { Check, Minus, Plus, Search, WifiOff } from '~/components/ui/icons'
import type { ReturnDisposition } from '~/lib/contracts'
import type { InvoiceLookupResponse } from '~/lib/contracts/invoice-lookup'
import {
  addQty,
  businessDate,
  cmpQty,
  formatMoney,
  normalizeQty,
  parseQty,
  toMoney,
  type CashRoundingUnit,
  type IsoInstant,
  type OutletTimezone,
} from '~/lib/kernel'
import { calcCreditNote, type ReturnLineInput } from '~/lib/sales-calc'
import type { BootResult } from '~/pos/boot/boot'
import { getLocalReturnedSumsBySaleLine } from '~/pos/data/credit-note.repo'
import { getOutlet, listActivePaymentMethods } from '~/pos/data/master.repo'
import { fetchRemoteInvoice } from '~/pos/data/remote-invoice'
import { findLocalSaleByInvoiceNo, getSaleWithDetails } from '~/pos/data/sale.repo'
import type { PaymentMethodRecord } from '~/pos/db/types'
import {
  checkReturnEligibility,
  computeRemainingReturnQty,
} from '~/pos/domain/return-eligibility'
import {
  createCreditNote,
  CreateCreditNoteError,
  type CreateCreditNoteResult,
} from '~/pos/usecases/sales/create-credit-note'

const LazySupervisorPinDialog = lazy(() =>
  import('~/components/pos/SupervisorPinDialog').then((m) => ({
    default: m.SupervisorPinDialog,
  })),
)

export interface ReturnScreenProps {
  tenant: string
  saleId: string
  initialInvoiceNo?: string
  bootResult: BootResult
}

interface NormalizedLine {
  saleLineId: string
  itemName: string
  uomCode: string
  soldQty: string
  returnedQty: string
  remainingQty: string
  returnedNet: number
  returnedSc: number
  returnedTax: number
  originalNet: number
  serviceAlloc: number
  taxAlloc: number
}

interface NormalizedSource {
  sourceKind: 'LOCAL' | 'REMOTE'
  localSaleId?: string
  remoteInvoice?: InvoiceLookupResponse
  invoiceNo: string
  status: 'PAID' | 'VOID'
  businessDate: string
  cashRoundingUnit: CashRoundingUnit
  priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'
  originalNonCashMethod: { id: string; code: string; name: string } | null
  lines: NormalizedLine[]
}

const RETURN_REASONS = [
  'DAMAGED',
  'EXPIRED',
  'WRONG_ITEM',
  'CUSTOMER_REQUEST',
  'OTHER',
] as const

export function ReturnScreen({
  tenant,
  saleId,
  initialInvoiceNo,
  bootResult,
}: ReturnScreenProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const shell = usePosShellActions(tenant, bootResult)

  const [lookupInput, setLookupInput] = useState(initialInvoiceNo ?? '')
  const [lookupStatus, setLookupStatus] = useState<
    'idle' | 'loading' | 'offline' | 'not_found' | 'error'
  >('idle')
  const [source, setSource] = useState<NormalizedSource | null>(null)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([])
  const [outletTimezone, setOutletTimezone] = useState<OutletTimezone>('Asia/Jakarta')
  const [outletCutoff, setOutletCutoff] = useState<string>('04:00')

  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})
  const [dispositions, setDispositions] = useState<Record<string, ReturnDisposition>>({})
  const [reasonCode, setReasonCode] = useState<string>('CUSTOMER_REQUEST')
  const [note, setNote] = useState('')
  const [refundChoice, setRefundChoice] = useState<'CASH' | 'ORIGINAL'>('CASH')
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [doneResult, setDoneResult] = useState<CreateCreditNoteResult | null>(null)

  useEffect(() => {
    if (!shell.db || !shell.device) return
    let cancelled = false
    void Promise.all([
      listActivePaymentMethods(shell.db),
      getOutlet(shell.db, shell.device.outlet_id),
    ]).then(([methods, outlet]) => {
      if (cancelled) return
      setPaymentMethods(methods)
      if (outlet?.timezone) {
        setOutletTimezone(outlet.timezone as OutletTimezone)
      }
      if (outlet?.day_cutoff_time) {
        setOutletCutoff(outlet.day_cutoff_time.slice(0, 5))
      }
    })
    return () => {
      cancelled = true
    }
  }, [shell.db, shell.device])

  async function loadLocalSaleSource(id: string) {
    if (!shell.db) return false
    const details = await getSaleWithDetails(shell.db, id)
    if (!details) return false
    const priorMap = await getLocalReturnedSumsBySaleLine(
      shell.db,
      details.lines.map((l) => l.id),
    )
    const nonCash = details.payments.find((p) => p.method_kind === 'NON_CASH') ?? null
    const lines: NormalizedLine[] = details.lines.map((l) => {
      const prior = priorMap.get(l.id) ?? { qty: '0', net: 0, sc: 0, tax: 0 }
      return {
        saleLineId: l.id,
        itemName: l.item_name,
        uomCode: l.uom_code,
        soldQty: l.qty,
        returnedQty: prior.qty,
        remainingQty: normalizeQty(computeRemainingReturnQty(l.qty, prior.qty)),
        returnedNet: prior.net,
        returnedSc: prior.sc,
        returnedTax: prior.tax,
        originalNet: l.line_net - l.bill_discount_alloc,
        serviceAlloc: l.service_alloc,
        taxAlloc: l.tax_alloc,
      }
    })
    setSource({
      sourceKind: 'LOCAL',
      localSaleId: details.sale.id,
      invoiceNo: details.sale.invoice_no,
      status: details.sale.status,
      businessDate: details.sale.business_date,
      cashRoundingUnit: details.sale.cash_rounding_unit as CashRoundingUnit,
      priceTaxMode: details.sale.price_tax_mode,
      originalNonCashMethod: nonCash
        ? { id: nonCash.method_id, code: nonCash.method_code, name: nonCash.method_name }
        : null,
      lines,
    })
    setQtyDrafts({})
    setDispositions({})
    setDoneResult(null)
    return true
  }

  async function runInvoiceLookup(invoiceNoRaw: string) {
    if (!shell.db) return
    const invoiceNo = invoiceNoRaw.trim()
    if (!invoiceNo) return
    setLookupStatus('loading')
    setErrorMsg(null)

    const local = await findLocalSaleByInvoiceNo(shell.db, invoiceNo)
    if (local) {
      const ok = await loadLocalSaleSource(local.id)
      setLookupStatus(ok ? 'idle' : 'not_found')
      return
    }

    const remote = await fetchRemoteInvoice(shell.db, invoiceNo)
    if (remote.kind === 'ok') {
      const inv = remote.data
      const nonCash = inv.sale.payments.find((p) => p.method_kind === 'NON_CASH') ?? null
      const lines: NormalizedLine[] = inv.lines.map((l) => ({
        saleLineId: l.id,
        itemName: l.item_name,
        uomCode: l.uom_code,
        soldQty: l.qty,
        returnedQty: l.returned_so_far.qty,
        remainingQty: normalizeQty(computeRemainingReturnQty(l.qty, l.returned_so_far.qty)),
        returnedNet: l.returned_so_far.net,
        returnedSc: l.returned_so_far.sc,
        returnedTax: l.returned_so_far.tax,
        originalNet: l.line_net - l.bill_discount_alloc,
        serviceAlloc: l.service_alloc,
        taxAlloc: l.tax_alloc,
      }))
      setSource({
        sourceKind: 'REMOTE',
        remoteInvoice: inv,
        invoiceNo: inv.sale.invoice_no,
        status: inv.sale.status,
        businessDate: inv.sale.business_date,
        cashRoundingUnit: inv.sale.cash_rounding_unit as CashRoundingUnit,
        priceTaxMode: inv.sale.price_tax_mode,
        originalNonCashMethod: nonCash
          ? { id: nonCash.method_id, code: nonCash.method_code, name: nonCash.method_name }
          : null,
        lines,
      })
      setQtyDrafts({})
      setDispositions({})
      setDoneResult(null)
      setLookupStatus('idle')
      return
    }

    setSource(null)
    if (remote.kind === 'offline') setLookupStatus('offline')
    else if (remote.kind === 'not_found') setLookupStatus('not_found')
    else setLookupStatus('error')
  }

  useEffect(() => {
    if (!shell.db) return
    if (saleId && saleId !== 'lookup') {
      void loadLocalSaleSource(saleId)
    } else if (initialInvoiceNo) {
      void runInvoiceLookup(initialInvoiceNo)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.db, saleId, initialInvoiceNo])

  const todayBusinessDate =
    shell.openShift?.business_date ??
    businessDate(
      new Date(shell.clockBounds.trustedNowMs).toISOString() as IsoInstant,
      outletTimezone,
      outletCutoff,
    )

  const eligibility = useMemo(() => {
    if (!source) return null
    return checkReturnEligibility({
      invoiceStatus: source.status,
      invoiceBusinessDate: source.businessDate,
      todayBusinessDate,
    })
  }, [source, todayBusinessDate])

  const cashMethod = useMemo(
    () => paymentMethods.find((m) => m.kind === 'CASH') ?? null,
    [paymentMethods],
  )

  const activeRefundMethod = useMemo(() => {
    if (refundChoice === 'ORIGINAL' && source?.originalNonCashMethod) {
      return {
        ...source.originalNonCashMethod,
        kind: 'NON_CASH' as const,
      }
    }
    if (cashMethod) {
      return {
        id: cashMethod.id,
        code: cashMethod.code,
        name: cashMethod.name,
        kind: 'CASH' as const,
      }
    }
    return null
  }, [refundChoice, source, cashMethod])

  const selectedLineInputs = useMemo((): ReturnLineInput[] => {
    if (!source) return []
    const out: ReturnLineInput[] = []
    for (const line of source.lines) {
      const raw = (qtyDrafts[line.saleLineId] ?? '0').trim()
      if (!raw || raw === '0') continue
      try {
        const parsed = parseQty(raw)
        if (cmpQty(parsed, parseQty('0')) <= 0) continue
        if (cmpQty(parsed, parseQty(line.remainingQty)) > 0) continue
        out.push({
          qtySold: parseQty(line.soldQty),
          qtyAlreadyReturned: parseQty(line.returnedQty),
          qtyReturn: parsed,
          originalNet: toMoney(line.originalNet),
          originalScAlloc: toMoney(line.serviceAlloc),
          originalTaxAlloc: toMoney(line.taxAlloc),
          returnedSoFar: {
            net: toMoney(line.returnedNet),
            sc: toMoney(line.returnedSc),
            tax: toMoney(line.returnedTax),
          },
        })
      } catch {
        // Ignore partial decimal drafts until valid.
      }
    }
    return out
  }, [source, qtyDrafts])

  const preview = useMemo(() => {
    if (!source || selectedLineInputs.length === 0) return null
    return calcCreditNote({
      lines: selectedLineInputs,
      priceTaxMode: source.priceTaxMode,
      refund: {
        method: activeRefundMethod?.kind === 'NON_CASH' ? 'ORIGINAL' : 'CASH',
        cashRoundingUnit: source.cashRoundingUnit,
      },
    })
  }, [source, selectedLineInputs, activeRefundMethod])

  function stepLineQty(line: NormalizedLine, delta: number) {
    const curStr = qtyDrafts[line.saleLineId] ?? '0'
    let cur: ReturnType<typeof parseQty>
    try {
      cur = parseQty(curStr || '0')
    } catch {
      cur = parseQty('0')
    }
    const max = parseQty(line.remainingQty)
    const nextRaw =
      delta > 0
        ? addQty(cur, parseQty(String(delta)))
        : parseQty(String(Math.max(0, Number(curStr || '0') + delta)))
    const clamped =
      cmpQty(nextRaw, parseQty('0')) < 0
        ? parseQty('0')
        : cmpQty(nextRaw, max) > 0
          ? max
          : nextRaw
    setQtyDrafts((prev) => ({ ...prev, [line.saleLineId]: normalizeQty(clamped) }))
  }

  async function handleApproved(res: { approverId: string; reason: string }) {
    if (!shell.db || !shell.sessionStaff || !source || !activeRefundMethod) return
    setErrorMsg(null)
    const linesReq = source.lines
      .map((l) => ({
        saleLineId: l.saleLineId,
        qtyReturn: (qtyDrafts[l.saleLineId] ?? '0').trim(),
        disposition: dispositions[l.saleLineId] ?? 'KEMBALI_STOK',
      }))
      .filter((x) => {
        try {
          return cmpQty(parseQty(x.qtyReturn), parseQty('0')) > 0
        } catch {
          return false
        }
      })

    try {
      const result = await createCreditNote(shell.db, {
        source:
          source.sourceKind === 'LOCAL'
            ? { kind: 'LOCAL', saleId: source.localSaleId! }
            : { kind: 'REMOTE', invoice: source.remoteInvoice! },
        lines: linesReq,
        reasonCode,
        reasonText: note.trim() || res.reason || null,
        staffId: shell.sessionStaff.staffId,
        approverId: res.approverId,
        refundMethod: activeRefundMethod,
      })
      setApprovalOpen(false)
      setDoneResult(result)
    } catch (err) {
      setApprovalOpen(false)
      if (err instanceof CreateCreditNoteError && err.code === 'SHIFT_REQUIRED') {
        setErrorMsg(t('pos.return.errorShiftRequired'))
      } else {
        setErrorMsg(err instanceof Error ? err.message : t('pos.return.errorGeneric'))
      }
    }
  }

  const previewTotal = preview ? (preview.refundCashApplied ?? preview.refundGross) : null

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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-h2 font-semibold text-ink">{t('pos.return.title')}</h1>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/history` })}
          >
            {t('pos.return.backToHistory')}
          </Button>
        </div>

        {doneResult ? (
          <Card className="flex flex-col items-center gap-4 p-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success-ink">
              <Check className="size-6" />
            </div>
            <h2 className="text-h2 font-semibold text-ink">{t('pos.return.doneTitle')}</h2>
            <div className="w-full max-w-sm rounded-card border border-line bg-surface-sunken p-4 text-body">
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">{t('pos.return.doneCnNo')}</span>
                <span className="font-mono font-semibold text-ink">{doneResult.creditNote.cn_no}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-ink-soft">{t('pos.return.doneTotalRefund')}</span>
                <span className="font-mono text-h3 font-semibold text-ink">
                  {formatMoney(doneResult.totalRefund, locale)}
                </span>
              </div>
            </div>
            <div className="flex w-full max-w-sm flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => {
                  setDoneResult(null)
                  setSource(null)
                  setLookupInput('')
                }}
              >
                {t('pos.return.newReturnButton')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => void shell.navigate({ href: `/${shell.cleanSlug}/pos/history` })}
              >
                {t('pos.return.viewHistoryButton')}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {saleId === 'lookup' ? (
              <Card className="flex flex-col gap-3 p-4">
                <label className="text-label font-medium text-ink" htmlFor="return-lookup-input">
                  {t('pos.return.lookupHeading')}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="return-lookup-input"
                    value={lookupInput}
                    onChange={(e) => setLookupInput(e.target.value)}
                    placeholder={t('pos.return.lookupPlaceholder')}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    loading={lookupStatus === 'loading'}
                    leadingIcon={<Search className="size-4" />}
                    onClick={() => void runInvoiceLookup(lookupInput)}
                  >
                    {t('pos.return.lookupButton')}
                  </Button>
                </div>
                {lookupStatus === 'not_found' ? (
                  <p className="text-body text-ink-soft">{t('pos.history.remoteNotFound')}</p>
                ) : null}
                {lookupStatus === 'error' ? (
                  <p className="text-body text-danger-ink">{t('pos.history.remoteError')}</p>
                ) : null}
              </Card>
            ) : null}

            {lookupStatus === 'offline' ? (
              <EmptyState
                icon={<WifiOff className="size-12" />}
                title={t('pos.return.offlineLookupTitle')}
                description={t('pos.return.offlineLookupDesc')}
                action={
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => void runInvoiceLookup(lookupInput)}
                  >
                    {t('pos.return.retryLookup')}
                  </Button>
                }
              />
            ) : null}

            {source ? (
              <>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <span className="text-caption text-ink-soft">{t('pos.return.invoiceHeading')}</span>
                    <p className="font-mono text-h3 font-semibold text-ink">{source.invoiceNo}</p>
                  </div>
                  <Chip
                    status={source.status === 'VOID' ? 'void' : 'synced'}
                    label={
                      source.status === 'VOID'
                        ? t('pos.history.filterVoid')
                        : t('pos.history.filterPaid')
                    }
                  />
                </Card>

                {eligibility && !eligibility.ok ? (
                  <Card className="border-danger-line bg-danger-soft p-4 text-body font-medium text-danger-ink">
                    {eligibility.reason === 'INVOICE_VOIDED'
                      ? t('pos.return.voidedBanner')
                      : t('pos.return.outsideWindowBanner')}
                  </Card>
                ) : null}

                {errorMsg ? <p className="text-body text-danger-ink">{errorMsg}</p> : null}

                <div className="flex flex-col gap-3">
                  {source.lines.map((line) => {
                    const exhausted = cmpQty(parseQty(line.remainingQty), parseQty('0')) <= 0
                    const disp = dispositions[line.saleLineId] ?? 'KEMBALI_STOK'
                    return (
                      <Card key={line.saleLineId} className="flex flex-col gap-3 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-label font-semibold text-ink">{line.itemName}</p>
                            <p className="text-caption text-ink-soft">
                              {t('pos.return.lineSoldLabel', {
                                sold: `${line.soldQty} ${line.uomCode}`,
                                returned: line.returnedQty,
                                remaining: `${line.remainingQty} ${line.uomCode}`,
                              })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={exhausted || !eligibility?.ok}
                              aria-label={`${t('pos.return.qtyReturnLabel')} -`}
                              onClick={() => stepLineQty(line, -1)}
                            >
                              <Minus className="size-4" />
                            </Button>
                            <Input
                              className="w-24 text-center font-mono"
                              disabled={exhausted || !eligibility?.ok}
                              value={qtyDrafts[line.saleLineId] ?? '0'}
                              aria-label={`${t('pos.return.qtyReturnLabel')} ${line.itemName}`}
                              onChange={(e) =>
                                setQtyDrafts((prev) => ({
                                  ...prev,
                                  [line.saleLineId]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={exhausted || !eligibility?.ok}
                              aria-label={`${t('pos.return.qtyReturnLabel')} +`}
                              onClick={() => stepLineQty(line, 1)}
                            >
                              <Plus className="size-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-caption text-ink-soft">
                            {t('pos.return.dispositionLabel')}
                          </span>
                          <Segmented
                            ariaLabel={`${t('pos.return.dispositionLabel')} ${line.itemName}`}
                            size="sm"
                            value={disp}
                            onChange={(v) =>
                              setDispositions((prev) => ({
                                ...prev,
                                [line.saleLineId]: v as ReturnDisposition,
                              }))
                            }
                            options={[
                              { value: 'KEMBALI_STOK', label: t('pos.return.dispositionRestock') },
                              { value: 'BUANG', label: t('pos.return.dispositionDiscard') },
                            ]}
                          />
                        </div>
                      </Card>
                    )
                  })}
                </div>

                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-label font-medium text-ink" htmlFor="return-reason-select">
                      {t('pos.return.reasonLabel')}
                    </label>
                    <Select
                      id="return-reason-select"
                      value={reasonCode}
                      onValueChange={setReasonCode}
                      options={RETURN_REASONS.map((code) => ({
                        value: code,
                        label: t(`pos.return.reasons.${code}`),
                      }))}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-label font-medium text-ink" htmlFor="return-note-input">
                      {t('pos.return.noteLabel')}
                    </label>
                    <Input
                      id="return-note-input"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('pos.return.notePlaceholder')}
                    />
                  </div>

                  {source.originalNonCashMethod ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-label font-medium text-ink">
                        {t('pos.return.refundMethodLabel')}
                      </span>
                      <Segmented
                        ariaLabel={t('pos.return.refundMethodLabel')}
                        size="sm"
                        value={refundChoice}
                        onChange={(v) => setRefundChoice(v as 'CASH' | 'ORIGINAL')}
                        options={[
                          { value: 'CASH', label: t('pos.return.refundCash') },
                          {
                            value: 'ORIGINAL',
                            label: t('pos.return.refundOriginal', {
                              name: source.originalNonCashMethod.name,
                            }),
                          },
                        ]}
                      />
                    </div>
                  ) : null}
                </Card>

                <Card className="flex flex-col gap-2 p-4 text-body">
                  <h2 className="text-h3 font-semibold text-ink">{t('pos.return.previewHeading')}</h2>
                  {preview && previewTotal !== null ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-ink-soft">{t('pos.return.previewNet')}</span>
                        <span className="font-mono text-ink">{formatMoney(preview.netTotal, locale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-soft">{t('pos.return.previewTax')}</span>
                        <span className="font-mono text-ink">{formatMoney(preview.taxTotal, locale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-soft">{t('pos.return.previewRounding')}</span>
                        <span className="font-mono text-ink">{formatMoney(preview.rounding, locale)}</span>
                      </div>
                      <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold text-ink">
                        <span>{t('pos.return.previewTotal')}</span>
                        <span className="font-mono text-h3">{formatMoney(previewTotal, locale)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-ink-soft">{t('pos.return.noLinesSelectedHint')}</p>
                  )}

                  <Button
                    type="button"
                    variant="primary"
                    size="xl"
                    fullWidth
                    disabled={!eligibility?.ok || !preview || !activeRefundMethod}
                    onClick={() => setApprovalOpen(true)}
                  >
                    {t('pos.return.submitButton')}
                  </Button>
                </Card>
              </>
            ) : null}
          </>
        )}
      </div>

      {approvalOpen && shell.db && shell.device && shell.sessionStaff ? (
        <Suspense fallback={null}>
          <LazySupervisorPinDialog
            open={approvalOpen}
            onOpenChange={setApprovalOpen}
            db={shell.db}
            outletId={shell.device.outlet_id}
            deviceId={shell.device.device_id}
            registerId={shell.device.register_id}
            requesterId={shell.sessionStaff.staffId}
            permission="return.approve"
            trustedNowMs={shell.clockBounds.trustedNowMs}
            maxSeenMs={shell.clockBounds.maxSeenMs}
            title={t('pos.return.approvalTitle')}
            onApproved={handleApproved}
          />
        </Suspense>
      ) : null}
    </PosWorkspaceShell>
  )
}
