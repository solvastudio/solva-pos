import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, Switch, useToast } from '~/components/ui'
import { saveAvailabilityFn } from '~/functions/catalog/catalog-write.fn'
import type { AdminProductDetail, AvailabilityStatus } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface ProductAvailabilityTabProps {
  tenantSlug: string
  detail: AdminProductDetail
  scopedOutletIds: readonly string[] | null
}

export function ProductAvailabilityTab({
  tenantSlug,
  detail,
  scopedOutletIds,
}: ProductAvailabilityTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [expandedOutletId, setExpandedOutletId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const allowedSet = scopedOutletIds === null ? null : new Set(scopedOutletIds)

  const mut = useMutation({
    retry: 0,
    mutationFn: saveAvailabilityFn,
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: qk.productDetail(tenantSlug, detail.product.id) })
      toast.show({ tone: 'success', message: t('admin.availability.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  return (
    <div className="flex flex-col gap-4">
      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      <div className="divide-y divide-line rounded-md border border-line bg-surface">
        {detail.outlets.map((outlet) => {
          const editable = allowedSet === null || allowedSet.has(outlet.id)
          const prodRow = detail.availability.find(
            (a) => a.outletId === outlet.id && a.skuId === null,
          )
          const prodAvail = (prodRow?.status ?? 'AVAILABLE') === 'AVAILABLE'
          const skuOverrides = detail.availability.filter(
            (a) => a.outletId === outlet.id && a.skuId !== null,
          )
          const isExpanded = expandedOutletId === outlet.id

          return (
            <div key={outlet.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{outlet.name}</span>
                  <span className="font-mono text-caption text-ink-soft">{outlet.code}</span>
                  {!editable ? (
                    <Chip
                      status="lease_other"
                      label={t('admin.availability.lockedOutletLabel')}
                    />
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Switch
                    label={
                      prodAvail
                        ? t('admin.availability.statusAvailable')
                        : t('admin.availability.statusUnavailable')
                    }
                    checked={prodAvail}
                    disabled={!editable || mut.isPending}
                    onCheckedChange={(checked) =>
                      mut.mutate({
                        data: {
                          outletUpdates: [
                            {
                              outletId: outlet.id,
                              productId: detail.product.id,
                              skuId: null,
                              status: checked ? 'AVAILABLE' : 'UNAVAILABLE',
                            },
                          ],
                          clearOverrides: [],
                        },
                      })
                    }
                  />
                  {detail.skus.length > 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setExpandedOutletId(isExpanded ? null : outlet.id)}
                    >
                      {isExpanded
                        ? t('admin.availability.collapseSkus')
                        : t('admin.availability.expandSkus', { count: skuOverrides.length })}
                    </Button>
                  ) : null}
                </div>
              </div>

              {isExpanded ? (
                <div className="ml-4 flex flex-col gap-2 border-l border-line pl-4">
                  <h4 className="text-caption font-semibold text-ink-soft">
                    {t('admin.availability.skuOverridesTitle')}
                  </h4>
                  {detail.skus.map((s) => {
                    const ov = skuOverrides.find((a) => a.skuId === s.id)
                    const eff: AvailabilityStatus = ov ? ov.status : prodRow?.status ?? 'AVAILABLE'
                    return (
                      <div key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-body text-ink">
                            {s.variantLabel ? `${s.skuCode} (${s.variantLabel})` : s.skuCode}
                          </span>
                          {ov ? (
                            <Chip
                              status={ov.status === 'AVAILABLE' ? 'synced' : 'stock_estimate_low'}
                              label={
                                ov.status === 'AVAILABLE'
                                  ? t('admin.availability.statusAvailable')
                                  : t('admin.availability.statusUnavailable')
                              }
                            />
                          ) : null}
                        </div>

                        {editable ? (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={mut.isPending}
                              onClick={() =>
                                mut.mutate({
                                  data: {
                                    outletUpdates: [
                                      {
                                        outletId: outlet.id,
                                        productId: detail.product.id,
                                        skuId: s.id,
                                        status: eff === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
                                      },
                                    ],
                                    clearOverrides: [],
                                  },
                                })
                              }
                            >
                              {t('admin.availability.overrideButton')}
                            </Button>
                            {ov ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={mut.isPending}
                                onClick={() =>
                                  mut.mutate({
                                    data: {
                                      outletUpdates: [],
                                      clearOverrides: [
                                        {
                                          outletId: outlet.id,
                                          productId: detail.product.id,
                                          skuId: s.id,
                                        },
                                      ],
                                    },
                                  })
                                }
                              >
                                {t('admin.availability.clearOverrideButton')}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
