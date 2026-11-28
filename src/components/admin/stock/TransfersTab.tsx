import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { Button, Dialog, Field, Input, Select, useToast, type DataTableColumn } from '~/components/ui'
import { getTransferFn, listTransfersFn } from '~/functions/inventory/stock-read.fn'
import { receiveTransferFn, saveTransferDraftFn, sendTransferFn } from '~/functions/inventory/stock-write.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import type { TransferRow } from './stock-doc-types'
import {
  formatOutletName,
  todayIso,
  useOutletOptions,
  useSkuOptions,
  useStockInvalidate,
  useTransferDestinations,
} from './stock-shared'

export function TransfersTab() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const toast = useToast()
  const invalidate = useStockInvalidate()
  const outlets = useOutletOptions()
  const destinations = useTransferDestinations()
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

  const outletLabel = (id: string) =>
    formatOutletName([...destinations, ...outlets], id, t('admin.stock.otherOutlet'))

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
      // Receiving needs access to the destination outlet, so offer it only when that outlet is one of the actor's own.
      cell: (r) =>
        r.status === 'SENT' && outlets.some((o) => o.id === r.toOutletId) ? (
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
            <Select id="tr-from" options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: o.name || o.code }))]} value={fromId} onValueChange={setFromId} />
          </Field>
          <Field label={t('admin.stock.colTo')} htmlFor="tr-to">
            <Select id="tr-to" options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...destinations.map((o) => ({ value: o.id, label: o.name || o.code }))]} value={toId} onValueChange={setToId} />
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
