import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { Button, Dialog, Field, Input, Select, Tabs, useToast, type DataTableColumn, type TabItem } from '~/components/ui'
import { listOutletsFn } from '~/functions/identity/org.fn'
import {
  getStocktakeFn,
  getTransferFn,
  listGrFn,
  listSkuOptionsFn,
  listStocktakesFn,
  listSuppliersFn,
  listTransfersFn,
} from '~/functions/inventory/stock-read.fn'
import {
  cancelStocktakeFn,
  createStocktakeFn,
  deleteSupplierFn,
  postGrFn,
  postStocktakeFn,
  receiveTransferFn,
  reverseGrFn,
  saveGrDraftFn,
  saveStocktakeCountsFn,
  saveSupplierFn,
  saveTransferDraftFn,
  sendTransferFn,
} from '~/functions/inventory/stock-write.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import type { GrRow, StocktakeRow, SupplierView, TransferRow } from './stock-doc-types'

/**
 * SCR-A06 — stock documents: goods receipt (GR), inter-outlet transfers, stocktake, and suppliers.
 * Every action calls a server service; validation and figures live entirely on the server.
 */

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** Money input: digits only, converted to an integer rupiah amount. */
function parseMoneyInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length === 0) return null
  return Number(digits)
}

function useStockInvalidate() {
  const queryClient = useQueryClient()
  const { slug } = useCurrentTenant()
  return () => queryClient.invalidateQueries({ queryKey: ['admin', slug, 'stock'] })
}

export function StockDocumentsPanel() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('receipts')

  const items: readonly TabItem[] = [
    { value: 'receipts', label: t('admin.stock.tabReceipts'), content: <ReceiptsTab /> },
    { value: 'transfers', label: t('admin.stock.tabTransfers'), content: <TransfersTab /> },
    { value: 'stocktakes', label: t('admin.stock.tabStocktakes'), content: <StocktakesTab /> },
    { value: 'suppliers', label: t('admin.stock.tabSuppliers'), content: <SuppliersTab /> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Tabs items={items} value={tab} onValueChange={setTab} size="md" ariaLabel={t('admin.stock.documentsLabel')} />
    </div>
  )
}

function useOutletOptions() {
  const { slug } = useCurrentTenant()
  const query = useQuery({ queryKey: ['admin', slug, 'outlets-list'], queryFn: () => listOutletsFn() })
  return query.data ?? []
}

function useSkuOptions() {
  const { slug } = useCurrentTenant()
  const query = useQuery({ queryKey: ['admin', slug, 'stock', 'skus'], queryFn: () => listSkuOptionsFn() })
  return query.data ?? []
}

/* ─────────────────────────── Goods receipt ─────────────────────────── */

interface GrDraftLine {
  skuId: string
  qty: string
  lineValue: string
}

function ReceiptsTab() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const invalidate = useStockInvalidate()
  const outlets = useOutletOptions()
  const skus = useSkuOptions()
  const suppliersQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'suppliers', false],
    queryFn: () => listSuppliersFn({ data: {} }),
  })
  const listQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'gr'],
    queryFn: () => listGrFn({ data: {} }),
  })

  const [outletId, setOutletId] = useState('')
  const [businessDate, setBusinessDate] = useState(todayIso())
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<GrDraftLine[]>([{ skuId: '', qty: '', lineValue: '' }])
  const [reverseTarget, setReverseTarget] = useState<GrRow | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  const outletLabel = (id: string) => outlets.find((o) => o.id === id)?.code ?? id

  const postMut = useMutation({
    mutationFn: async () => {
      const draft = await saveGrDraftFn({
        data: {
          outletId,
          businessDate,
          supplierId: supplierId || null,
          lines: lines
            .filter((l) => l.skuId)
            .map((l) => ({
              skuId: l.skuId,
              uomId: skus.find((s) => s.skuId === l.skuId)!.baseUomId,
              qty: l.qty.trim(),
              lineValue: parseMoneyInput(l.lineValue),
              unitCost: null,
            })),
        },
      })
      return postGrFn({ data: { id: draft.id } })
    },
    onSuccess: async (res) => {
      toast.show({ tone: 'success', message: t('admin.stock.grPosted', { docNo: res.docNo }) })
      setLines([{ skuId: '', qty: '', lineValue: '' }])
      await invalidate()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const reverseMut = useMutation({
    mutationFn: (row: GrRow) => reverseGrFn({ data: { id: row.id, reasonText: reverseReason.trim() } }),
    onSuccess: async (res) => {
      setReverseTarget(null)
      setReverseReason('')
      toast.show({ tone: 'success', message: t('admin.stock.grReversed', { docNo: res.docNo }) })
      await invalidate()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const canPost =
    outletId !== '' &&
    lines.some((l) => l.skuId && l.qty.trim() !== '' && parseMoneyInput(l.lineValue) !== null)

  const columns: readonly DataTableColumn<GrRow>[] = [
    { id: 'docNo', header: t('admin.stock.colDocNo'), cell: (r) => <span className="font-mono">{r.docNo}</span> },
    { id: 'outlet', header: t('admin.stock.colOutlet'), cell: (r) => outletLabel(r.outletId) },
    { id: 'date', header: t('admin.stock.colDate'), cell: (r) => r.businessDate },
    { id: 'type', header: t('admin.stock.colType'), cell: (r) => (r.docType === 'REVERSAL' ? t('admin.stock.typeReversal') : t('admin.stock.typeReceipt')) },
    { id: 'status', header: t('admin.stock.colStatus'), cell: (r) => r.status },
    {
      id: 'total',
      header: t('admin.stock.colValue'),
      align: 'right',
      numeric: true,
      cell: (r) => <span className="font-mono tabular-nums">{new Intl.NumberFormat(locale).format(r.totalValue)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: (r) =>
        r.docType === 'RECEIPT' && r.status === 'POSTED' ? (
          <Button variant="secondary" size="sm" onClick={() => setReverseTarget(r)}>
            {t('admin.stock.reverseAction')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="gr-form-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 id="gr-form-title" className="text-h3 font-semibold text-ink">{t('admin.stock.grFormTitle')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label={t('admin.stock.colOutlet')} htmlFor="gr-outlet">
            <Select
              id="gr-outlet"
              options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))]}
              value={outletId}
              onValueChange={setOutletId}
            />
          </Field>
          <Field label={t('admin.stock.colDate')} htmlFor="gr-date">
            <Input id="gr-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </Field>
          <Field label={t('admin.stock.colSupplier')} htmlFor="gr-supplier">
            <Select
              id="gr-supplier"
              options={[{ value: '', label: t('admin.stock.noSupplier') }, ...(suppliersQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
              value={supplierId}
              onValueChange={setSupplierId}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
              <Select
                ariaLabel={t('admin.stock.colItem')}
                options={[{ value: '', label: t('admin.stock.chooseItem') }, ...skus.map((s) => ({ value: s.skuId, label: `${s.skuCode} — ${s.productName}` }))]}
                value={line.skuId}
                onValueChange={(v) => setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, skuId: v } : l)))}
              />
              <Input
                aria-label={t('admin.stock.colQty')}
                inputMode="decimal"
                placeholder={t('admin.stock.colQty')}
                value={line.qty}
                onChange={(e) => setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, qty: e.target.value } : l)))}
              />
              <Input
                aria-label={t('admin.stock.colLineValue')}
                inputMode="numeric"
                placeholder={t('admin.stock.colLineValue')}
                value={line.lineValue}
                onChange={(e) => setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, lineValue: e.target.value } : l)))}
              />
              <Button variant="ghost" size="md" onClick={() => setLines((cur) => cur.filter((_, i) => i !== idx))} disabled={lines.length === 1}>
                {t('admin.stock.removeLine')}
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" size="md" onClick={() => setLines((cur) => [...cur, { skuId: '', qty: '', lineValue: '' }])}>
            {t('admin.stock.addLine')}
          </Button>
          <Button variant="primary" size="md" disabled={!canPost} loading={postMut.isPending} onClick={() => postMut.mutate()}>
            {t('admin.stock.postGrAction')}
          </Button>
        </div>
      </section>

      <DataTableCmp10
        caption={t('admin.stock.grListCaption')}
        columns={columns}
        rows={listQuery.data ?? []}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.stock.emptyTitle')}
      />

      <Dialog
        open={reverseTarget !== null}
        onOpenChange={(open) => !open && setReverseTarget(null)}
        title={t('admin.stock.reverseTitle')}
        description={t('admin.stock.reverseDescription')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setReverseTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={reverseReason.trim().length === 0}
              loading={reverseMut.isPending}
              onClick={() => reverseTarget && reverseMut.mutate(reverseTarget)}
            >
              {t('admin.stock.reverseConfirm')}
            </Button>
          </div>
        }
      >
        <Field label={t('admin.stock.reverseReason')} htmlFor="gr-reverse-reason">
          <Input id="gr-reverse-reason" value={reverseReason} maxLength={500} onChange={(e) => setReverseReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  )
}

/* ─────────────────────────── Inter-outlet transfer ─────────────────────────── */

function TransfersTab() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const invalidate = useStockInvalidate()
  const outlets = useOutletOptions()
  const skus = useSkuOptions()
  const listQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'transfers'],
    queryFn: () => listTransfersFn({ data: {} }),
  })

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [businessDate, setBusinessDate] = useState(todayIso())
  const [skuId, setSkuId] = useState('')
  const [qty, setQty] = useState('')
  const [receiveId, setReceiveId] = useState<string | null>(null)

  const outletLabel = (id: string) => outlets.find((o) => o.id === id)?.code ?? id

  const sendMut = useMutation({
    mutationFn: async () => {
      const sku = skus.find((s) => s.skuId === skuId)!
      const draft = await saveTransferDraftFn({
        data: {
          fromOutletId: fromId,
          toOutletId: toId,
          businessDate,
          lines: [{ skuId, uomId: sku.baseUomId, qtyInput: qty.trim() }],
        },
      })
      return sendTransferFn({ data: { id: draft.id } })
    },
    onSuccess: async (res) => {
      toast.show({ tone: 'success', message: t('admin.stock.transferSent', { docNo: res.docNo }) })
      setQty('')
      await invalidate()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const columns: readonly DataTableColumn<TransferRow>[] = [
    { id: 'docNo', header: t('admin.stock.colDocNo'), cell: (r) => <span className="font-mono">{r.docNo}</span> },
    { id: 'route', header: t('admin.stock.colRoute'), cell: (r) => `${outletLabel(r.fromOutletId)} → ${outletLabel(r.toOutletId)}` },
    { id: 'date', header: t('admin.stock.colDate'), cell: (r) => r.businessDate },
    { id: 'status', header: t('admin.stock.colStatus'), cell: (r) => r.status },
    {
      id: 'actions',
      header: '',
      cell: (r) =>
        r.status === 'SENT' ? (
          <Button variant="secondary" size="sm" onClick={() => setReceiveId(r.id)}>
            {t('admin.stock.receiveAction')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="tr-form-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 id="tr-form-title" className="text-h3 font-semibold text-ink">{t('admin.stock.transferFormTitle')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label={t('admin.stock.colFrom')} htmlFor="tr-from">
            <Select id="tr-from" options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))]} value={fromId} onValueChange={setFromId} />
          </Field>
          <Field label={t('admin.stock.colTo')} htmlFor="tr-to">
            <Select id="tr-to" options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))]} value={toId} onValueChange={setToId} />
          </Field>
          <Field label={t('admin.stock.colDate')} htmlFor="tr-date">
            <Input id="tr-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </Field>
          <Field label={t('admin.stock.colItem')} htmlFor="tr-sku">
            <Select id="tr-sku" options={[{ value: '', label: t('admin.stock.chooseItem') }, ...skus.map((s) => ({ value: s.skuId, label: `${s.skuCode} — ${s.productName}` }))]} value={skuId} onValueChange={setSkuId} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label={t('admin.stock.colQty')} htmlFor="tr-qty" className="max-w-xs">
            <Input id="tr-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            size="md"
            disabled={!fromId || !toId || fromId === toId || !skuId || qty.trim() === ''}
            loading={sendMut.isPending}
            onClick={() => sendMut.mutate()}
          >
            {t('admin.stock.sendTransferAction')}
          </Button>
        </div>
      </section>

      <DataTableCmp10
        caption={t('admin.stock.transferListCaption')}
        columns={columns}
        rows={listQuery.data ?? []}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.stock.emptyTitle')}
      />

      {receiveId ? <ReceiveTransferDialog transferId={receiveId} onClose={() => setReceiveId(null)} /> : null}
    </div>
  )
}

function ReceiveTransferDialog({ transferId, onClose }: { transferId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const invalidate = useStockInvalidate()
  const detailQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'transfer', transferId],
    queryFn: () => getTransferFn({ data: { id: transferId } }),
  })
  const skus = useSkuOptions()
  const [received, setReceived] = useState<Record<string, string>>({})
  const [closeReason, setCloseReason] = useState('')

  const receiveMut = useMutation({
    mutationFn: () => {
      const d = detailQuery.data!
      const allZero = d.lines.every((l) => Number(received[l.lineId] ?? '0') === 0)
      return receiveTransferFn({
        data: {
          id: d.id,
          lines: d.lines.map((l) => ({ lineId: l.lineId, qtyReceivedBase: (received[l.lineId] ?? '0').trim() || '0' })),
          closeReasonCode: allZero ? 'OTHER' : null,
          closeReasonText: allZero ? closeReason.trim() : null,
        },
      })
    },
    onSuccess: async (res) => {
      toast.show({ tone: 'success', message: t('admin.stock.transferReceived', { docNo: res.docNo }) })
      await invalidate()
      onClose()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const d = detailQuery.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.stock.receiveTitle')}
      description={d ? d.docNo : undefined}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" disabled={!d} loading={receiveMut.isPending} onClick={() => receiveMut.mutate()}>
            {t('admin.stock.receiveConfirm')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {(d?.lines ?? []).map((l) => {
          const sku = skus.find((s) => s.skuId === l.skuId)
          return (
            <Field key={l.lineId} label={`${sku?.skuCode ?? l.skuId} — ${t('admin.stock.sentQty', { qty: l.qtySentBase })}`} htmlFor={`rcv-${l.lineId}`}>
              <Input
                id={`rcv-${l.lineId}`}
                inputMode="decimal"
                value={received[l.lineId] ?? ''}
                onChange={(e) => setReceived((cur) => ({ ...cur, [l.lineId]: e.target.value }))}
              />
            </Field>
          )
        })}
        <Field label={t('admin.stock.closeReason')} htmlFor="rcv-reason" hint={t('admin.stock.closeReasonHint')}>
          <Input id="rcv-reason" value={closeReason} maxLength={200} onChange={(e) => setCloseReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

/* ─────────────────────────── Stocktake ─────────────────────────── */

function StocktakesTab() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const invalidate = useStockInvalidate()
  const outlets = useOutletOptions()
  const listQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'stocktakes'],
    queryFn: () => listStocktakesFn({ data: {} }),
  })
  const [outletId, setOutletId] = useState('')
  const [businessDate, setBusinessDate] = useState(todayIso())
  const [countId, setCountId] = useState<string | null>(null)

  const outletLabel = (id: string) => outlets.find((o) => o.id === id)?.code ?? id

  const createMut = useMutation({
    mutationFn: () => createStocktakeFn({ data: { outletId, businessDate, scope: 'ALL' } }),
    onSuccess: async (res) => {
      toast.show({ tone: 'success', message: t('admin.stock.stocktakeCreated', { docNo: res.docNo }) })
      await invalidate()
      setCountId(res.id)
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const [postId, setPostId] = useState<string | null>(null)
  const postMut = useMutation({
    mutationFn: (id: string) => postStocktakeFn({ data: { id } }),
    onSuccess: async (res) => {
      setPostId(null)
      toast.show({ tone: 'success', message: t('admin.stock.stocktakePosted', { docNo: res.docNo }) })
      await invalidate()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelStocktakeFn({ data: { id } }),
    onSuccess: async () => {
      toast.show({ tone: 'success', message: t('admin.stock.stocktakeCanceled') })
      await invalidate()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const columns: readonly DataTableColumn<StocktakeRow>[] = [
    { id: 'docNo', header: t('admin.stock.colDocNo'), cell: (r) => <span className="font-mono">{r.docNo}</span> },
    { id: 'outlet', header: t('admin.stock.colOutlet'), cell: (r) => outletLabel(r.outletId) },
    { id: 'date', header: t('admin.stock.colDate'), cell: (r) => r.businessDate },
    { id: 'status', header: t('admin.stock.colStatus'), cell: (r) => r.status },
    {
      id: 'actions',
      header: '',
      cell: (r) =>
        r.status === 'DRAFT' ? (
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCountId(r.id)}>
              {t('admin.stock.countAction')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setPostId(r.id)}>
              {t('admin.stock.postStocktakeAction')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cancelMut.mutate(r.id)}>
              {t('admin.stock.cancelAction')}
            </Button>
          </span>
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="sto-form-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 id="sto-form-title" className="text-h3 font-semibold text-ink">{t('admin.stock.stocktakeFormTitle')}</h2>
        <p className="text-body-sm text-ink-muted">{t('admin.stock.stocktakeHelp')}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label={t('admin.stock.colOutlet')} htmlFor="sto-outlet">
            <Select id="sto-outlet" options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))]} value={outletId} onValueChange={setOutletId} />
          </Field>
          <Field label={t('admin.stock.colDate')} htmlFor="sto-date">
            <Input id="sto-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" size="md" disabled={!outletId} loading={createMut.isPending} onClick={() => createMut.mutate()}>
              {t('admin.stock.createStocktakeAction')}
            </Button>
          </div>
        </div>
      </section>

      <DataTableCmp10
        caption={t('admin.stock.stocktakeListCaption')}
        columns={columns}
        rows={listQuery.data ?? []}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.stock.emptyTitle')}
      />

      {countId ? <CountDialog stocktakeId={countId} onClose={() => setCountId(null)} /> : null}

      <Dialog
        open={postId !== null}
        onOpenChange={(open) => !open && setPostId(null)}
        title={t('admin.stock.postStocktakeTitle')}
        description={t('admin.stock.postStocktakeDescription')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setPostId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="md" loading={postMut.isPending} onClick={() => postId && postMut.mutate(postId)}>
              {t('admin.stock.postStocktakeConfirm')}
            </Button>
          </div>
        }
      >
        <span />
      </Dialog>
    </div>
  )
}

function CountDialog({ stocktakeId, onClose }: { stocktakeId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const invalidate = useStockInvalidate()
  const skus = useSkuOptions()
  const detailQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'stocktake', stocktakeId],
    queryFn: () => getStocktakeFn({ data: { id: stocktakeId } }),
  })
  const [counts, setCounts] = useState<Record<string, string>>({})

  const saveMut = useMutation({
    mutationFn: () => {
      const d = detailQuery.data!
      const entries = d.lines
        .filter((l) => (counts[l.lineId] ?? '').trim() !== '')
        .map((l) => ({ lineId: l.lineId, countedQty: counts[l.lineId]!.trim() }))
      return saveStocktakeCountsFn({ data: { id: d.id, counts: entries } })
    },
    onSuccess: async () => {
      toast.show({ tone: 'success', message: t('admin.stock.countsSaved') })
      await invalidate()
      await detailQuery.refetch()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const d = detailQuery.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.stock.countTitle')}
      description={d ? d.docNo : undefined}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" size="md" disabled={!d} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {t('admin.stock.saveCountsAction')}
          </Button>
        </div>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
        {(d?.lines ?? []).map((l) => {
          const sku = skus.find((s) => s.skuId === l.skuId)
          return (
            <Field key={l.lineId} label={`${sku?.skuCode ?? l.skuId} — ${t('admin.stock.snapshotQty', { qty: l.snapshotQty })}`} htmlFor={`cnt-${l.lineId}`}>
              <Input
                id={`cnt-${l.lineId}`}
                inputMode="decimal"
                value={counts[l.lineId] ?? l.countedQty ?? ''}
                onChange={(e) => setCounts((cur) => ({ ...cur, [l.lineId]: e.target.value }))}
              />
            </Field>
          )
        })}
      </div>
    </Dialog>
  )
}

/* ─────────────────────────── Suppliers ─────────────────────────── */

function SuppliersTab() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const queryClient = useQueryClient()
  const listQuery = useQuery({
    queryKey: ['admin', slug, 'stock', 'suppliers', false],
    queryFn: () => listSuppliersFn({ data: {} }),
  })
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', slug, 'stock', 'suppliers'] })

  const saveMut = useMutation({
    mutationFn: () => saveSupplierFn({ data: { name: name.trim(), contact: contact.trim() || null } }),
    onSuccess: async () => {
      setName('')
      setContact('')
      toast.show({ tone: 'success', message: t('admin.stock.supplierSaved') })
      await refresh()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSupplierFn({ data: { id } }),
    onSuccess: async () => {
      toast.show({ tone: 'success', message: t('admin.stock.supplierDeleted') })
      await refresh()
    },
    onError: () => toast.show({ tone: 'danger', message: t('admin.stock.actionFailed') }),
  })

  const columns: readonly DataTableColumn<SupplierView>[] = [
    { id: 'name', header: t('admin.stock.colSupplierName'), cell: (r) => r.name },
    { id: 'contact', header: t('admin.stock.colContact'), cell: (r) => r.contact ?? t('common.dash') },
    {
      id: 'actions',
      header: '',
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(r.id)}>
          {t('admin.stock.deleteAction')}
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="sup-form-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 id="sup-form-title" className="text-h3 font-semibold text-ink">{t('admin.stock.supplierFormTitle')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label={t('admin.stock.colSupplierName')} htmlFor="sup-name">
            <Input id="sup-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('admin.stock.colContact')} htmlFor="sup-contact">
            <Input id="sup-contact" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" size="md" disabled={name.trim().length === 0} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {t('admin.stock.addSupplierAction')}
            </Button>
          </div>
        </div>
      </section>
      <DataTableCmp10
        caption={t('admin.stock.supplierListCaption')}
        columns={columns}
        rows={listQuery.data ?? []}
        getRowKey={(r) => r.id}
        emptyTitle={t('admin.stock.emptyTitle')}
      />
    </div>
  )
}
