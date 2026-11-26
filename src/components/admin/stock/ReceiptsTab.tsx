import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { Button, Dialog, Field, Input, Select, useToast, type DataTableColumn } from '~/components/ui'
import { listGrFn, listSuppliersFn } from '~/functions/inventory/stock-read.fn'
import { postGrFn, reverseGrFn, saveGrDraftFn } from '~/functions/inventory/stock-write.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import type { GrRow } from './stock-doc-types'
import {
  formatOutletName,
  parseMoneyInput,
  todayIso,
  useOutletOptions,
  useSkuOptions,
  useStockInvalidate,
  type GrDraftLine,
} from './stock-shared'

export function ReceiptsTab() {
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

  const outletLabel = (id: string) => formatOutletName(outlets, id)

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
              options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: o.name || o.code }))]}
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
