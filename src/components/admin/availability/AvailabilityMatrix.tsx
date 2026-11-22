import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Ban,
  Button,
  Check,
  Checkbox,
  CircleAlert,
  Dialog,
  EmptyState,
  Field,
  Lock,
  Select,
  StickyFooter,
  Store,
  Switch,
  useToast,
} from '~/components/ui'
import { saveAvailabilityFn } from '~/functions/catalog/catalog-write.fn'
import {
  effectiveAvailability,
  type AvailabilityMatrixResult,
  type AvailabilityStatus,
} from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface AvailabilityMatrixProps {
  tenantSlug: string
  data: AvailabilityMatrixResult
}

export function AvailabilityMatrix({ tenantSlug, data }: AvailabilityMatrixProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [prodDrafts, setProdDrafts] = useState<Record<string, AvailabilityStatus>>({})
  const [skuDrafts, setSkuDrafts] = useState<Record<string, AvailabilityStatus>>({})
  const [clearDrafts, setClearDrafts] = useState<Set<string>>(new Set())
  const [impactPending, setImpactPending] = useState<{
    productName: string
    outletName: string
    onConfirm: () => void
  } | null>(null)
  const [mobileProductId, setMobileProductId] = useState(data.rows[0]?.productId ?? '')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const allowedSet = data.scopedOutletIds === null ? null : new Set(data.scopedOutletIds)
  const editableOutlets = data.outlets.filter((o) => allowedSet === null || allowedSet.has(o.id))

  const dirtyCount = Object.keys(prodDrafts).length + Object.keys(skuDrafts).length + clearDrafts.size

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      const outletUpdates: Array<{
        outletId: string
        productId: string
        skuId?: string | null
        status: AvailabilityStatus
      }> = []
      for (const [key, status] of Object.entries(prodDrafts)) {
        const [productId, outletId] = key.split(':')
        outletUpdates.push({ outletId: outletId!, productId: productId!, skuId: null, status })
      }
      for (const [key, status] of Object.entries(skuDrafts)) {
        const [productId, outletId, skuId] = key.split(':')
        outletUpdates.push({ outletId: outletId!, productId: productId!, skuId: skuId!, status })
      }
      const clearOverrides = Array.from(clearDrafts).map((k) => {
        const [productId, outletId, skuId] = k.split(':')
        return { outletId: outletId!, productId: productId!, skuId: skuId! }
      })
      return saveAvailabilityFn({ data: { outletUpdates, clearOverrides } })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setProdDrafts({})
      setSkuDrafts({})
      setClearDrafts(new Set())
      setSelectedProducts(new Set())
      queryClient.invalidateQueries({ queryKey: qk.availabilityMatrix(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.availability.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  function stageProductStatus(
    productId: string,
    outletId: string,
    status: AvailabilityStatus,
  ) {
    setProdDrafts((prev) => ({ ...prev, [`${productId}:${outletId}`]: status }))
  }

  function applyBulkStatus(status: AvailabilityStatus) {
    if (selectedProducts.size === 0 || editableOutlets.length === 0) return
    const applyFn = () => {
      const next = { ...prodDrafts }
      for (const pid of selectedProducts) {
        for (const o of editableOutlets) {
          next[`${pid}:${o.id}`] = status
        }
      }
      setProdDrafts(next)
    }

    if (status === 'UNAVAILABLE') {
      setImpactPending({
        productName: `${selectedProducts.size}`,
        outletName: `${editableOutlets.length}`,
        onConfirm: () => {
          applyFn()
          setImpactPending(null)
        },
      })
    } else {
      applyFn()
    }
  }

  function applyBulkClearOverrides() {
    if (selectedProducts.size === 0) return
    const nextClear = new Set(clearDrafts)
    for (const row of data.rows) {
      if (!selectedProducts.has(row.productId)) continue
      for (const o of editableOutlets) {
        for (const s of row.skus) {
          if (row.skuOverrides[`${o.id}:${s.id}`]) {
            nextClear.add(`${row.productId}:${o.id}:${s.id}`)
          }
        }
      }
    }
    setClearDrafts(nextClear)
  }

  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={<Store className="size-10" />}
        title={t('admin.availability.emptyTitle')}
        description={t('admin.availability.emptyDesc')}
      />
    )
  }

  const mobileRow = data.rows.find((r) => r.productId === mobileProductId) ?? data.rows[0]!

  return (
    <div className="flex flex-col gap-4">
      {selectedProducts.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-sunken p-3">
          <Button type="button" size="sm" onClick={() => applyBulkStatus('AVAILABLE')}>
            <Check className="size-4" />
            {t('admin.availability.bulkAvailable')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={() => applyBulkStatus('UNAVAILABLE')}
          >
            <Ban className="size-4" />
            {t('admin.availability.bulkUnavailable')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={applyBulkClearOverrides}
          >
            {t('admin.availability.bulkClearOverrides')}
          </Button>
        </div>
      ) : null}

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      {/* Mobile view: pick product -> toggle outlets */}
      <div className="flex flex-col gap-3 md:hidden">
        <Field
          label={t('admin.availability.mobileProductLabel')}
          htmlFor={`${idPrefix}-mobile-product`}
        >
          <Select
            id={`${idPrefix}-mobile-product`}
            value={mobileRow.productId}
            onValueChange={setMobileProductId}
            options={data.rows.map((r) => ({ value: r.productId, label: r.productName }))}
          />
        </Field>
        <div className="divide-y divide-line rounded-md border border-line bg-surface">
          {data.outlets.map((o) => {
            const editable = allowedSet === null || allowedSet.has(o.id)
            const status =
              prodDrafts[`${mobileRow.productId}:${o.id}`] ??
              mobileRow.productStatuses[o.id] ??
              'AVAILABLE'
            return (
              <div key={o.id} className="flex items-center justify-between gap-3 p-3">
                <span className="font-medium text-ink">{o.name}</span>
                {editable ? (
                  <Switch
                    label={
                      status === 'AVAILABLE'
                        ? t('admin.availability.statusAvailable')
                        : t('admin.availability.statusUnavailable')
                    }
                    checked={status === 'AVAILABLE'}
                    onCheckedChange={(checked) =>
                      stageProductStatus(
                        mobileRow.productId,
                        o.id,
                        checked ? 'AVAILABLE' : 'UNAVAILABLE',
                      )
                    }
                  />
                ) : (
                  <span className="inline-flex items-center gap-1 text-caption text-ink-disabled">
                    <Lock className="size-4" />
                    {t('admin.availability.lockedOutletLabel')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Desktop matrix */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block">
        <table className="w-full text-left text-body">
          <thead className="border-b border-line bg-surface-subtle text-label-sm font-semibold text-ink-soft">
            <tr>
              <th className="w-12 px-3 py-3 text-center">
                <span className="sr-only">
                  {t('admin.availability.colSelect')}
                </span>
              </th>
              <th className="px-4 py-3">{t('admin.catalog.colName')}</th>
              {data.outlets.map((o) => (
                <th key={o.id} className="px-4 py-3 whitespace-nowrap">
                  {o.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => {
              const isSelected = selectedProducts.has(r.productId)
              const isExpanded = expandedProducts.has(r.productId)
              return (
                <Fragment key={r.productId}>
                  <tr className="hover:bg-surface-hover">
                    <td className="w-12 px-3 py-3 text-center">
                      <Checkbox
                        label={r.productName}
                        hideLabel
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedProducts)
                          if (checked) next.add(r.productId)
                          else next.delete(r.productId)
                          setSelectedProducts(next)
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-ink">{r.productName}</span>
                        <span className="font-mono text-caption text-ink-soft">{r.productCode}</span>
                        {r.skus.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Set(expandedProducts)
                              if (isExpanded) next.delete(r.productId)
                              else next.add(r.productId)
                              setExpandedProducts(next)
                            }}
                            className="w-fit text-caption font-medium text-action hover:underline"
                          >
                            {isExpanded
                              ? t('admin.availability.collapseSkus')
                              : t('admin.availability.expandSkus', { count: r.skus.length })}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    {data.outlets.map((o) => {
                      const editable = allowedSet === null || allowedSet.has(o.id)
                      const prodKey = `${r.productId}:${o.id}`
                      const prodStatus = prodDrafts[prodKey] ?? r.productStatuses[o.id] ?? 'AVAILABLE'
                      let availSkus = 0
                      for (const s of r.skus) {
                        const clearKey = `${r.productId}:${o.id}:${s.id}`
                        const ovStatus = clearDrafts.has(clearKey)
                          ? undefined
                          : (skuDrafts[clearKey] ?? r.skuOverrides[`${o.id}:${s.id}`])
                        const eff = effectiveAvailability({
                          productActive: r.isActive,
                          skuActive: s.isActive,
                          productRow: { productId: r.productId, skuId: null, status: prodStatus },
                          skuOverride: ovStatus
                            ? { productId: r.productId, skuId: s.id, status: ovStatus }
                            : undefined,
                        })
                        if (eff) availSkus += 1
                      }
                      const totalSkus = r.skus.length
                      const allAvail = availSkus === totalSkus && totalSkus > 0
                      const allUnavail = availSkus === 0

                      return (
                        <td key={o.id} className="px-4 py-3">
                          <button
                            type="button"
                            disabled={!editable}
                            aria-label={
                              editable
                                ? `${r.productName} ${o.name}`
                                : t('admin.availability.lockedOutletLabel')
                            }
                            onClick={() => {
                              const nextStatus: AvailabilityStatus =
                                prodStatus === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE'
                              if (nextStatus === 'UNAVAILABLE') {
                                setImpactPending({
                                  productName: r.productName,
                                  outletName: o.name,
                                  onConfirm: () => {
                                    stageProductStatus(r.productId, o.id, 'UNAVAILABLE')
                                    setImpactPending(null)
                                  },
                                })
                              } else {
                                stageProductStatus(r.productId, o.id, 'AVAILABLE')
                              }
                            }}
                            className="inline-flex min-h-control-md items-center gap-2 whitespace-nowrap rounded-control border border-line bg-surface px-3 py-1 text-body transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled"
                          >
                            {!editable ? (
                              <Lock className="size-4 text-ink-disabled" />
                            ) : allAvail ? (
                              <Check className="size-4 text-success-ink" />
                            ) : allUnavail ? (
                              <Ban className="size-4 text-danger-ink" />
                            ) : (
                              <CircleAlert className="size-4 text-warning-ink" />
                            )}
                            <span>
                              {allAvail
                                ? t('admin.availability.statusAvailable')
                                : allUnavail
                                  ? t('admin.availability.statusUnavailable')
                                  : t('admin.availability.statusPartial', {
                                      available: availSkus,
                                      total: totalSkus,
                                    })}
                            </span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>

                  {isExpanded
                    ? r.skus.map((s) => (
                        <tr key={`${r.productId}-${s.id}`} className="bg-surface-sunken">
                          <td />
                          <td className="px-6 py-2 text-caption text-ink-soft">
                            {s.variantLabel ? `${s.skuCode} — ${s.variantLabel}` : s.skuCode}
                          </td>
                          {data.outlets.map((o) => {
                            const editable = allowedSet === null || allowedSet.has(o.id)
                            const clearKey = `${r.productId}:${o.id}:${s.id}`
                            const prodStatus =
                              prodDrafts[`${r.productId}:${o.id}`] ??
                              r.productStatuses[o.id] ??
                              'AVAILABLE'
                            const ov = clearDrafts.has(clearKey)
                              ? undefined
                              : (skuDrafts[clearKey] ?? r.skuOverrides[`${o.id}:${s.id}`])
                            const eff = effectiveAvailability({
                              productActive: r.isActive,
                              skuActive: s.isActive,
                              productRow: { productId: r.productId, skuId: null, status: prodStatus },
                              skuOverride: ov
                                ? { productId: r.productId, skuId: s.id, status: ov }
                                : undefined,
                            })

                            return (
                              <td key={o.id} className="px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={!editable}
                                    onClick={() => {
                                      const nextSet = new Set(clearDrafts)
                                      nextSet.delete(clearKey)
                                      setClearDrafts(nextSet)
                                      setSkuDrafts((prev) => ({
                                        ...prev,
                                        [clearKey]: eff ? 'UNAVAILABLE' : 'AVAILABLE',
                                      }))
                                    }}
                                  >
                                    {eff ? <Check className="size-3.5" /> : <Ban className="size-3.5" />}
                                    {eff
                                      ? t('admin.availability.statusAvailable')
                                      : t('admin.availability.statusUnavailable')}
                                  </Button>
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {dirtyCount > 0 ? (
        <StickyFooter
          message={t('admin.availability.dirtySummary', { count: dirtyCount })}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setProdDrafts({})
                  setSkuDrafts({})
                  setClearDrafts(new Set())
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="button" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {t('admin.availability.saveAll')}
              </Button>
            </>
          }
        />
      ) : null}

      <Dialog
        open={Boolean(impactPending)}
        onOpenChange={(open) => {
          if (!open) setImpactPending(null)
        }}
        title={t('admin.availability.impactTitle')}
      >
        <p className="text-body text-ink-soft">
          {impactPending
            ? t('admin.availability.impactDesc', {
                product: impactPending.productName,
                outlet: impactPending.outletName,
              })
            : ''}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setImpactPending(null)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={() => impactPending?.onConfirm()}>
            {t('admin.availability.impactConfirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
