import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, Field, Input, Plus, Select, Trash2, useToast } from '~/components/ui'
import { saveSkuUomsFn } from '~/functions/catalog/catalog-write.fn'
import type { AdminProductDetail, UomView } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface UomBarcodeTabProps {
  tenantSlug: string
  detail: AdminProductDetail
  uoms: readonly UomView[]
  canManageTenantWide: boolean
}

export function UomBarcodeTab({
  tenantSlug,
  detail,
  uoms,
  canManageTenantWide,
}: UomBarcodeTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const [selectedSkuId, setSelectedSkuId] = useState(detail.skus[0]?.id ?? '')
  const [addUomId, setAddUomId] = useState('')
  const [factor, setFactor] = useState('12')
  const [barcode, setBarcode] = useState('')
  const [barcodeDrafts, setBarcodeDrafts] = useState<Record<string, string>>({})
  const [addFieldErrors, setAddFieldErrors] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const uomById = new Map(uoms.map((u) => [u.id, u]))
  const activeSkuUoms = detail.skuUoms.filter((su) => su.skuId === selectedSkuId)
  const attachedUomIds = new Set(activeSkuUoms.map((su) => su.uomId))
  const availableExtraUoms = uoms.filter((u) => !attachedUomIds.has(u.id))

  const mut = useMutation({
    retry: 0,
    mutationFn: saveSkuUomsFn,
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setAddUomId('')
      setBarcode('')
      queryClient.invalidateQueries({ queryKey: qk.productDetail(tenantSlug, detail.product.id) })
      toast.show({ tone: 'success', message: t('admin.catalog.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (!addUomId) {
      nextErrors.uomId = t('validation.selectRequired', { field: t('admin.catalog.uomLabel') })
    }
    const cleanFactor = factor.trim()
    const factorNum = Number(cleanFactor)
    if (!cleanFactor) {
      nextErrors.factor = t('validation.fieldRequired', {
        field: t('admin.catalog.conversionFactorLabel'),
      })
    } else if (!Number.isFinite(factorNum) || factorNum <= 0) {
      nextErrors.factor = t('validation.positiveNumber')
    }
    if (Object.keys(nextErrors).length > 0) {
      setAddFieldErrors(nextErrors)
      return
    }
    setAddFieldErrors({})
    if (!selectedSkuId) return
    mut.mutate({
      data: {
        action: 'add',
        skuId: selectedSkuId,
        uomId: addUomId,
        conversionFactor: cleanFactor,
        barcode: barcode.trim() || null,
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {detail.skus.length > 1 ? (
        <Field label={t('admin.catalog.selectSkuLabel')} htmlFor={`${idPrefix}-sku`}>
          <Select
            id={`${idPrefix}-sku`}
            value={selectedSkuId}
            onValueChange={setSelectedSkuId}
            options={detail.skus.map((s) => ({
              value: s.id,
              label: s.variantLabel ? `${s.skuCode} (${s.variantLabel})` : s.skuCode,
            }))}
          />
        </Field>
      ) : null}

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      <div className="divide-y divide-line rounded-md border border-line bg-surface">
        {activeSkuUoms.map((su) => {
          const u = uomById.get(su.uomId)
          const draft = barcodeDrafts[su.id] ?? su.barcode ?? ''
          return (
            <div key={su.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-body font-semibold text-ink">{u?.code ?? su.uomId}</span>
                <span className="text-body text-ink-soft">{u?.name}</span>
                {su.isBase ? (
                  <Chip status="base_unit" label={t('admin.catalog.baseUomRowBadge')} />
                ) : (
                  <Chip status="tag" label={`× ${su.conversionFactor}`} />
                )}
                {u?.allowFraction ? (
                  <Chip status="synced" label={t('admin.catalog.allowFractionLabel')} />
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={draft}
                  aria-label={`${t('admin.catalog.barcodeLabel')} ${u?.code ?? ''}`}
                  disabled={!canManageTenantWide || mut.isPending}
                  onChange={(e) =>
                    setBarcodeDrafts((prev) => ({ ...prev, [su.id]: e.target.value }))
                  }
                />
                {canManageTenantWide && draft !== (su.barcode ?? '') ? (
                  <Button
                    type="button"
                    size="sm"
                    loading={mut.isPending}
                    onClick={() =>
                      mut.mutate({
                        data: {
                          action: 'update',
                          id: su.id,
                          barcode: draft.trim() || null,
                        },
                      })
                    }
                  >
                    {t('common.save')}
                  </Button>
                ) : null}
                {canManageTenantWide && !su.isBase ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={mut.isPending}
                    onClick={() => mut.mutate({ data: { action: 'remove', id: su.id } })}
                  >
                    <Trash2 className="size-4" />
                    {t('admin.catalog.removeUom')}
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {canManageTenantWide && availableExtraUoms.length > 0 ? (
        <form onSubmit={handleAdd} noValidate className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
          <h4 className="text-h3 font-semibold text-ink">{t('admin.catalog.addUomTitle')}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              label={t('admin.catalog.uomLabel')}
              htmlFor={`${idPrefix}-uom`}
              error={addFieldErrors.uomId}
            >
              <Select
                id={`${idPrefix}-uom`}
                value={addUomId}
                onValueChange={(v) => {
                  setAddUomId(v)
                  setAddFieldErrors((prev) => (prev.uomId ? { ...prev, uomId: '' } : prev))
                }}
                invalid={Boolean(addFieldErrors.uomId)}
                placeholder={t('admin.catalog.selectUom')}
                options={availableExtraUoms.map((u) => ({
                  value: u.id,
                  label: `${u.code} — ${u.name}`,
                }))}
              />
            </Field>
            <Field
              label={t('admin.catalog.conversionFactorLabel')}
              htmlFor={`${idPrefix}-factor`}
              hint={t('admin.catalog.conversionFactorHint')}
              error={addFieldErrors.factor}
            >
              <Input
                id={`${idPrefix}-factor`}
                value={factor}
                invalid={Boolean(addFieldErrors.factor)}
                onChange={(e) => {
                  setFactor(e.target.value)
                  setAddFieldErrors((prev) => (prev.factor ? { ...prev, factor: '' } : prev))
                }}
              />
            </Field>
            <Field label={t('admin.catalog.barcodeLabel')} htmlFor={`${idPrefix}-barcode`}>
              <Input
                id={`${idPrefix}-barcode`}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </Field>
          </div>
          <div>
            <Button type="submit" loading={mut.isPending}>
              <Plus className="size-4" />
              {t('admin.catalog.addUomTitle')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
