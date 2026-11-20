import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, MoneyInput, StickyFooter, useToast } from '~/components/ui'
import { savePricesFn } from '~/functions/catalog/catalog-write.fn'
import type { AdminProductDetail, UomView } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface ProductPricesTabProps {
  tenantSlug: string
  detail: AdminProductDetail
  uoms: readonly UomView[]
  canEditDefault: boolean
  scopedOutletIds: readonly string[] | null
}

export function ProductPricesTab({
  tenantSlug,
  detail,
  uoms,
  canEditDefault,
  scopedOutletIds,
}: ProductPricesTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const uomById = new Map(uoms.map((u) => [u.id, u]))
  const currentMap = new Map<string, number>()
  for (const p of detail.prices) {
    currentMap.set(`${p.skuId}:${p.uomId}:${p.outletId ?? 'DEFAULT'}`, p.price)
  }

  const rows: Array<{
    key: string
    skuId: string
    skuLabel: string
    uomId: string
    uomCode: string
  }> = []
  for (const s of detail.skus) {
    const skuUoms = detail.skuUoms.filter((su) => su.skuId === s.id)
    for (const su of skuUoms) {
      const u = uomById.get(su.uomId)
      rows.push({
        key: `${s.id}:${su.uomId}`,
        skuId: s.id,
        skuLabel: s.variantLabel ? `${s.skuCode} (${s.variantLabel})` : s.skuCode,
        uomId: su.uomId,
        uomCode: u?.code ?? su.uomId,
      })
    }
  }

  const dirtyCount = Object.keys(drafts).length
  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      const entries = Object.entries(drafts).map(([cellKey, price]) => {
        const [skuId, uomId, outletKey] = cellKey.split(':')
        return {
          skuId: skuId!,
          uomId: uomId!,
          outletId: outletKey === 'DEFAULT' ? null : outletKey!,
          price,
        }
      })
      return savePricesFn({ data: { entries } })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setDrafts({})
      queryClient.invalidateQueries({ queryKey: qk.productDetail(tenantSlug, detail.product.id) })
      toast.show({ tone: 'success', message: t('admin.prices.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const allowedSet = scopedOutletIds === null ? null : new Set(scopedOutletIds)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-soft">{t('admin.prices.auditNote')}</p>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full text-left text-body">
          <thead className="border-b border-line bg-surface-sunken text-caption font-semibold text-ink-soft">
            <tr>
              <th className="px-4 py-3">{t('admin.prices.colItem')}</th>
              <th className="px-4 py-3">{t('admin.prices.colUom')}</th>
              <th className="px-4 py-3">{t('admin.prices.colDefault')}</th>
              {detail.outlets.map((o) => (
                <th key={o.id} className="px-4 py-3">
                  {o.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const defKey = `${r.skuId}:${r.uomId}:DEFAULT`
              const defVal = drafts[defKey] ?? currentMap.get(defKey) ?? null
              return (
                <tr key={r.key}>
                  <td className="px-4 py-2 font-medium text-ink">{r.skuLabel}</td>
                  <td className="px-4 py-2 font-mono text-ink-soft">{r.uomCode}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-1">
                      <MoneyInput
                        value={defVal}
                        dirty={Object.hasOwn(drafts, defKey)}
                        disabled={!canEditDefault || saveMut.isPending}
                        ariaLabel={`${t('admin.prices.colDefault')} ${r.skuLabel} ${r.uomCode}`}
                        onChange={(val) => {
                          if (val === null) return
                          setDrafts((prev) => ({ ...prev, [defKey]: val }))
                        }}
                      />
                      {defVal === null && !detail.product.isOpenPrice ? (
                        <Chip status="stock_estimate_low" label={t('admin.prices.unsetChip')} />
                      ) : null}
                    </div>
                  </td>
                  {detail.outlets.map((o) => {
                    const cellKey = `${r.skuId}:${r.uomId}:${o.id}`
                    const cellVal = drafts[cellKey] ?? currentMap.get(cellKey) ?? null
                    const editable = allowedSet === null || allowedSet.has(o.id)
                    return (
                      <td key={o.id} className="px-4 py-2">
                        <MoneyInput
                          value={cellVal}
                          dirty={Object.hasOwn(drafts, cellKey)}
                          disabled={!editable || saveMut.isPending}
                          ariaLabel={`${o.name} ${r.skuLabel} ${r.uomCode}`}
                          onChange={(val) => {
                            if (val === null) return
                            setDrafts((prev) => ({ ...prev, [cellKey]: val }))
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {dirtyCount > 0 ? (
        <StickyFooter
          message={t('admin.prices.dirtySummary', { count: dirtyCount })}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={saveMut.isPending}
                onClick={() => setDrafts({})}
              >
                {t('admin.prices.discard')}
              </Button>
              <Button type="button" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {t('admin.prices.saveAll')}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  )
}
