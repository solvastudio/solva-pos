import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  Input,
  Plus,
  Switch,
  Trash2,
  useToast,
} from '~/components/ui'
import { saveVariantsFn } from '~/functions/catalog/catalog-write.fn'
import type { AdminProductDetail } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface VariantsTabProps {
  tenantSlug: string
  detail: AdminProductDetail
  canEditMaster: boolean
}

export function VariantsTab({ tenantSlug, detail, canEditMaster }: VariantsTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [newValues, setNewValues] = useState<Record<string, string>>({})
  const [skuDrafts, setSkuDrafts] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const mutate = useMutation({
    retry: 0,
    mutationFn: saveVariantsFn,
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: qk.productDetail(tenantSlug, detail.product.id) })
      toast.show({ tone: 'success', message: t('admin.catalog.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-soft">{t('admin.catalog.variantModeHint')}</p>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      {detail.attributes.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {detail.attributes.map(({ attribute, values }) => (
            <div key={attribute.id} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
              <h3 className="text-h3 font-semibold text-ink">{attribute.name}</h3>
              <div className="flex flex-wrap gap-2">
                {values.map((val) => (
                  <span
                    key={val.id}
                    className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-sunken px-2 py-1 text-body text-ink"
                  >
                    {val.value}
                    {canEditMaster && values.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`${t('admin.catalog.deleteAction')} ${val.value}`}
                        disabled={mutate.isPending}
                        onClick={() =>
                          mutate.mutate({
                            data: {
                              action: 'removeValue',
                              productId: detail.product.id,
                              attributeValueId: val.id,
                            },
                          })
                        }
                        className="ml-1 text-ink-soft hover:text-danger-ink"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
              {canEditMaster && detail.skus.length < 100 ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={newValues[attribute.id] ?? ''}
                    aria-label={t('admin.catalog.variantAddValueLabel', { attribute: attribute.name })}
                    onChange={(e) =>
                      setNewValues((prev) => ({ ...prev, [attribute.id]: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    loading={mutate.isPending}
                    onClick={() => {
                      const val = (newValues[attribute.id] ?? '').trim()
                      if (!val) return
                      mutate.mutate({
                        data: {
                          action: 'addValue',
                          productId: detail.product.id,
                          attributeId: attribute.id,
                          value: val,
                        },
                      })
                      setNewValues((prev) => ({ ...prev, [attribute.id]: '' }))
                    }}
                  >
                    <Plus className="size-4" />
                    {t('admin.catalog.variantAddButton')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full text-left text-body">
          <thead className="border-b border-line bg-surface-sunken text-caption font-semibold text-ink-soft">
            <tr>
              <th className="px-4 py-3">{t('admin.catalog.skuCodeCol')}</th>
              <th className="px-4 py-3">{t('admin.catalog.variantLabelCol')}</th>
              <th className="px-4 py-3">{t('admin.catalog.skuStatusCol')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {detail.skus.map((s) => {
              const draft = skuDrafts[s.id] ?? s.skuCode
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    {canEditMaster ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={draft}
                          aria-label={`${t('admin.catalog.skuCodeCol')} ${s.variantLabel ?? s.skuCode}`}
                          onChange={(e) =>
                            setSkuDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))
                          }
                        />
                        {draft !== s.skuCode ? (
                          <Button
                            type="button"
                            size="sm"
                            loading={mutate.isPending}
                            onClick={() =>
                              mutate.mutate({
                                data: { action: 'updateSku', skuId: s.id, skuCode: draft.trim() },
                              })
                            }
                          >
                            {t('common.save')}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="font-mono">{s.skuCode}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink">
                    {s.variantLabel ?? (
                      <Chip status="base_unit" label={t('admin.catalog.baseUomRowBadge')} />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Switch
                      label={s.isActive ? t('common.active') : t('common.inactive')}
                      checked={s.isActive}
                      disabled={!canEditMaster || mutate.isPending}
                      onCheckedChange={(checked) =>
                        mutate.mutate({
                          data: { action: 'updateSku', skuId: s.id, isActive: checked },
                        })
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
