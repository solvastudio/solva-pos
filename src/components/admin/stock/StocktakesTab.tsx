import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableCmp10 } from '~/components/admin/reports/DataTableCmp10'
import { Button, Dialog, Field, Input, Select, useToast, type DataTableColumn } from '~/components/ui'
import { getStocktakeFn, listStocktakesFn } from '~/functions/inventory/stock-read.fn'
import {
  cancelStocktakeFn,
  createStocktakeFn,
  postStocktakeFn,
  saveStocktakeCountsFn,
} from '~/functions/inventory/stock-write.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import type { StocktakeRow } from './stock-doc-types'
import {
  formatOutletName,
  todayIso,
  useOutletOptions,
  useSkuOptions,
  useStockInvalidate,
} from './stock-shared'

export function StocktakesTab() {
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

  const outletLabel = (id: string) => formatOutletName(outlets, id)

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
            <Select id="sto-outlet" options={[{ value: '', label: t('admin.stock.chooseOutlet') }, ...outlets.map((o) => ({ value: o.id, label: o.name || o.code }))]} value={outletId} onValueChange={setOutletId} />
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
