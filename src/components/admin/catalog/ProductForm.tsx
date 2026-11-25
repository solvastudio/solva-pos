import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  Input,
  Plus,
  Segmented,
  Select,
  Switch,
  Tabs,
  Trash2,
  useToast,
  type TabItem,
} from '~/components/ui'
import {
  createProductFn,
  deactivateProductFn,
  updateProductFn,
} from '~/functions/catalog/catalog-write.fn'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import {
  generateSkus,
  VariantLimitError,
  type AdminProductDetail,
  type CategoryView,
  type ProductType,
  type UomView,
} from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'
import { ModifierGroupsEditor } from '../fnb/ModifierGroupsEditor'
import { RecipeEditor } from '../fnb/RecipeEditor'
import { ProductAvailabilityTab } from './ProductAvailabilityTab'
import { ProductPricesTab } from './ProductPricesTab'
import { UomBarcodeTab } from './UomBarcodeTab'
import { VariantsTab } from './VariantsTab'

export interface ProductFormProps {
  tenantSlug: string
  detail?: AdminProductDetail | null
  categories: readonly CategoryView[]
  uoms: readonly UomView[]
  canManageTenantWide: boolean
  scopedOutletIds: readonly string[] | null
}

interface DraftAttribute {
  id: string
  name: string
  valuesRaw: string
}

export function ProductForm({
  tenantSlug,
  detail,
  categories,
  uoms,
  canManageTenantWide,
  scopedOutletIds,
}: ProductFormProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditing = Boolean(detail)
  const prod = detail?.product ?? null

  const [activeTab, setActiveTab] = useState('info')
  const [name, setName] = useState(prod?.name ?? '')
  const [code, setCode] = useState(prod?.code ?? '')
  const [categoryId, setCategoryId] = useState(prod?.categoryId ?? categories[0]?.id ?? '')
  const [productType, setProductType] = useState<ProductType>(prod?.productType ?? 'RETAIL')
  const [baseUomId, setBaseUomId] = useState(prod?.baseUomId ?? uoms[0]?.id ?? '')
  const [barcode, setBarcode] = useState('')
  const [trackStock, setTrackStock] = useState(prod?.trackStock ?? true)
  const [taxable, setTaxable] = useState(prod?.taxable ?? true)
  const [isOpenPrice, setIsOpenPrice] = useState(prod?.isOpenPrice ?? false)
  const [isActive, setIsActive] = useState(prod?.isActive ?? true)
  const [hasVariants, setHasVariants] = useState(prod?.hasVariants ?? false)
  const [draftAttrs, setDraftAttrs] = useState<DraftAttribute[]>([
    { id: 'attr-1', name: '', valuesRaw: '' },
  ])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const categoryOptions = categories.map((c) => {
    const parent = c.parentId ? catMap.get(c.parentId) : null
    return {
      value: c.id,
      label: parent ? `${parent.name} > ${c.name}` : c.name,
    }
  })

  const variantPreview = useMemo(() => {
    if (isEditing || !hasVariants) return { specs: [], error: null as string | null }
    const validAttrs = draftAttrs
      .map((a) => ({
        name: a.name.trim(),
        values: a.valuesRaw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v, i) => ({ id: `${a.id}-${i}`, value: v })),
      }))
      .filter((a) => a.name.length > 0 && a.values.length > 0)

    if (validAttrs.length === 0) return { specs: [], error: null }
    try {
      const res = generateSkus({
        productCode: code.trim() || 'SKU',
        attributes: validAttrs,
        existing: [],
      })
      return { specs: res.create, error: null }
    } catch (err) {
      if (err instanceof VariantLimitError) {
        return { specs: [], error: err.message }
      }
      return { specs: [], error: t('admin.catalog.maxSkusError') }
    }
  }, [isEditing, hasVariants, draftAttrs, code, t])

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      if (prod) {
        return updateProductFn({
          data: {
            id: prod.id,
            categoryId,
            code: code.trim(),
            name: name.trim(),
            baseUomId,
            trackStock,
            taxable,
            isActive,
            isOpenPrice,
          },
        })
      }
      const attrsPayload = hasVariants
        ? draftAttrs
            .map((a) => ({
              name: a.name.trim(),
              values: a.valuesRaw
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
            }))
            .filter((a) => a.name.length > 0 && a.values.length > 0)
        : undefined
      return createProductFn({
        data: {
          categoryId,
          code: code.trim(),
          name: name.trim(),
          productType,
          hasVariants,
          baseUomId,
          trackStock,
          taxable,
          isOpenPrice,
          isActive,
          barcode: !hasVariants && barcode.trim() ? barcode.trim() : null,
          attributes: attrsPayload,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey as never))
        return
      }
      setFormError(null)
      queryClient.invalidateQueries({ queryKey: qk.products(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.catalog.saved') })
      if (!prod && res.data && 'product' in res.data) {
        navigate({ to: tenantHref(tenantSlug, `/admin/catalog/${res.data.product.id}`) })
      } else if (prod) {
        queryClient.invalidateQueries({ queryKey: qk.productDetail(tenantSlug, prod.id) })
      }
    },
    onError: (err) => setFormError(err.message),
  })

  const deactivateMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      if (!prod) throw new Error('Missing product')
      return deactivateProductFn({ data: { id: prod.id } })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey as never))
        setConfirmDeactivate(false)
        return
      }
      setConfirmDeactivate(false)
      setIsActive(false)
      queryClient.invalidateQueries({ queryKey: qk.products(tenantSlug) })
      if (prod) {
        queryClient.invalidateQueries({ queryKey: qk.productDetail(tenantSlug, prod.id) })
      }
      toast.show({ tone: 'info', message: t('admin.catalog.deactivated') })
    },
    onError: (err) => {
      setFormError(err.message)
      setConfirmDeactivate(false)
    },
  })

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev
      const copy = { ...prev }
      delete copy[field]
      return copy
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) {
      nextErrors.name = t('validation.fieldRequired', { field: t('admin.catalog.nameLabel') })
    }
    if (!code.trim()) {
      nextErrors.code = t('validation.fieldRequired', { field: t('admin.catalog.codeLabel') })
    }
    if (!categoryId) {
      nextErrors.categoryId = t('validation.selectRequired', {
        field: t('admin.catalog.categoryLabel'),
      })
    }
    if (!baseUomId) {
      nextErrors.baseUomId = t('validation.selectRequired', {
        field: t('admin.catalog.baseUomLabel'),
      })
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
    }
    setFieldErrors({})
    saveMut.mutate()
  }

  const infoContent = (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3"
    >
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('admin.catalog.nameLabel')}
            htmlFor={`${idPrefix}-name`}
            error={fieldErrors.name}
          >
            <Input
              id={`${idPrefix}-name`}
              value={name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(e) => {
                setName(e.target.value)
                clearFieldError('name')
              }}
              disabled={!canManageTenantWide || saveMut.isPending}
            />
          </Field>
          <Field
            label={t('admin.catalog.codeLabel')}
            htmlFor={`${idPrefix}-code`}
            hint={t('admin.catalog.codeHint')}
            error={fieldErrors.code}
          >
            <Input
              id={`${idPrefix}-code`}
              value={code}
              invalid={Boolean(fieldErrors.code)}
              onChange={(e) => {
                setCode(e.target.value)
                clearFieldError('code')
              }}
              disabled={!canManageTenantWide || saveMut.isPending}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('admin.catalog.categoryLabel')}
            htmlFor={`${idPrefix}-category`}
            error={fieldErrors.categoryId}
          >
            <Select
              id={`${idPrefix}-category`}
              value={categoryId}
              onValueChange={(v) => {
                setCategoryId(v)
                clearFieldError('categoryId')
              }}
              invalid={Boolean(fieldErrors.categoryId)}
              placeholder={t('admin.catalog.selectCategory')}
              options={categoryOptions}
              disabled={!canManageTenantWide || saveMut.isPending}
            />
          </Field>
          <Field
            label={t('admin.catalog.baseUomLabel')}
            htmlFor={`${idPrefix}-base-uom`}
            error={fieldErrors.baseUomId}
          >
            <Select
              id={`${idPrefix}-base-uom`}
              value={baseUomId}
              onValueChange={(v) => {
                setBaseUomId(v)
                clearFieldError('baseUomId')
              }}
              invalid={Boolean(fieldErrors.baseUomId)}
              placeholder={t('admin.catalog.selectUom')}
              options={uoms.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
              disabled={!canManageTenantWide || saveMut.isPending}
            />
          </Field>
        </div>

        <Field label={t('admin.catalog.typeLabel')} htmlFor={`${idPrefix}-type`}>
          <div id={`${idPrefix}-type`}>
            <Segmented
              value={productType}
              onChange={(v) => setProductType(v as ProductType)}
              ariaLabel={t('admin.catalog.typeLabel')}
              options={[
                { value: 'RETAIL', label: t('admin.catalog.typeRETAIL') },
                { value: 'MENU_FNB', label: t('admin.catalog.typeMENU_FNB') },
              ]}
            />
          </div>
        </Field>

        {!isEditing && !hasVariants ? (
          <Field label={t('admin.catalog.barcodeLabel')} htmlFor={`${idPrefix}-barcode`}>
            <Input
              id={`${idPrefix}-barcode`}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              disabled={!canManageTenantWide || saveMut.isPending}
            />
          </Field>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Switch
            label={t('admin.catalog.trackStockLabel')}
            checked={trackStock}
            disabled={!canManageTenantWide || saveMut.isPending}
            onCheckedChange={setTrackStock}
          />
          <Switch
            label={t('admin.catalog.taxableLabel')}
            checked={taxable}
            disabled={!canManageTenantWide || saveMut.isPending}
            onCheckedChange={setTaxable}
          />
          <Switch
            label={t('admin.catalog.isOpenPriceLabel')}
            checked={isOpenPrice}
            disabled={!canManageTenantWide || saveMut.isPending}
            onCheckedChange={setIsOpenPrice}
          />
          <Switch
            label={t('admin.catalog.isActiveLabel')}
            checked={isActive}
            disabled={!canManageTenantWide || saveMut.isPending}
            onCheckedChange={setIsActive}
          />
        </div>

        {!isEditing ? (
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
            <Switch
              label={t('admin.catalog.hasVariantsLabel')}
              checked={hasVariants}
              disabled={!canManageTenantWide || saveMut.isPending}
              onCheckedChange={setHasVariants}
            />
            {hasVariants ? (
              <div className="flex flex-col gap-3">
                <p className="text-caption text-ink-soft">{t('admin.catalog.variantModeHint')}</p>
                {draftAttrs.map((attr, idx) => (
                  <div key={attr.id} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                    <div className="sm:col-span-2">
                      <Input
                        value={attr.name}
                        aria-label={t('admin.catalog.attributeNameLabel')}
                        placeholder={t('admin.catalog.attributeNameLabel')}
                        onChange={(e) =>
                          setDraftAttrs((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)),
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        value={attr.valuesRaw}
                        aria-label={t('admin.catalog.attributeValuesLabel')}
                        placeholder={t('admin.catalog.attributeValuesLabel')}
                        onChange={(e) =>
                          setDraftAttrs((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, valuesRaw: e.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center">
                      {draftAttrs.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDraftAttrs((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {draftAttrs.length < 3 ? (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setDraftAttrs((prev) => [
                          ...prev,
                          { id: `attr-${prev.length + 1}`, name: '', valuesRaw: '' },
                        ])
                      }
                    >
                      <Plus className="size-4" />
                      {t('admin.catalog.addAttribute')}
                    </Button>
                  </div>
                ) : null}

                {variantPreview.error ? (
                  <p role="alert" className="text-body text-danger-ink">
                    {variantPreview.error}
                  </p>
                ) : variantPreview.specs.length > 0 ? (
                  <div className="rounded-sm bg-surface-sunken p-3">
                    <p className="mb-2 text-caption font-semibold text-ink">
                      {t('admin.catalog.previewCombinations', {
                        count: variantPreview.specs.length,
                      })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {variantPreview.specs.slice(0, 12).map((s) => (
                        <Chip key={s.skuCode} status="tag" label={`${s.skuCode}: ${s.variantLabel}`} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="text-body text-danger-ink">
            {formError}
          </p>
        ) : null}

        {canManageTenantWide ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saveMut.isPending} disabled={Boolean(variantPreview.error)}>
              {t('admin.catalog.saveProduct')}
            </Button>
            {prod && isActive ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => setConfirmDeactivate(true)}
              >
                {t('admin.catalog.deactivateButton')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div>
        <Card className="flex flex-col gap-2 p-4">
          <h3 className="text-caption font-semibold uppercase text-ink-soft">
            {t('admin.catalog.posPreviewTitle')}
          </h3>
          <div className="rounded-md border border-line bg-surface-sunken p-4">
            <p className="text-body font-semibold text-ink">
              {name.trim() || t('admin.catalog.nameLabel')}
            </p>
            <p className="font-mono text-caption text-ink-soft">{code.trim() || 'SKU'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip
                status={productType === 'MENU_FNB' ? 'type_fnb' : 'type_retail'}
                label={t(`admin.catalog.type${productType}`)}
              />
              {isOpenPrice ? (
                <Chip status="open_price" label={t('admin.catalog.openPriceBadge')} />
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      <Dialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={t('admin.catalog.deactivateTitle', { name: prod?.name ?? '' })}
      >
        <p className="text-body text-ink-soft">{t('admin.catalog.deactivateDesc')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmDeactivate(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={deactivateMut.isPending}
            onClick={() => deactivateMut.mutate()}
          >
            {t('admin.catalog.deactivateConfirm')}
          </Button>
        </div>
      </Dialog>
    </form>
  )

  if (!detail) {
    return infoContent
  }

  const tabs: readonly TabItem[] = [
    { value: 'info', label: t('admin.catalog.tabInfo'), content: infoContent },
    {
      value: 'variants',
      label: t('admin.catalog.tabVariants'),
      content: (
        <div className="mt-6">
          <VariantsTab
            tenantSlug={tenantSlug}
            detail={detail}
            canManageTenantWide={canManageTenantWide}
          />
        </div>
      ),
    },
    {
      value: 'uoms',
      label: t('admin.catalog.tabUoms'),
      content: (
        <div className="mt-6">
          <UomBarcodeTab
            tenantSlug={tenantSlug}
            detail={detail}
            uoms={uoms}
            canManageTenantWide={canManageTenantWide}
          />
        </div>
      ),
    },
    {
      value: 'prices',
      label: t('admin.catalog.tabPrices'),
      content: (
        <div className="mt-6">
          <ProductPricesTab
            tenantSlug={tenantSlug}
            detail={detail}
            uoms={uoms}
            canEditDefault={canManageTenantWide}
            scopedOutletIds={scopedOutletIds}
          />
        </div>
      ),
    },
    {
      value: 'availability',
      label: t('admin.catalog.tabAvailability'),
      content: (
        <div className="mt-6">
          <ProductAvailabilityTab
            tenantSlug={tenantSlug}
            detail={detail}
            scopedOutletIds={scopedOutletIds}
          />
        </div>
      ),
    },
    ...(detail.product.productType === 'MENU_FNB'
      ? [
          {
            value: 'modifiers',
            label: t('admin.catalog.tabModifiers'),
            content: (
              <div className="mt-6">
                <ModifierGroupsEditor
                  tenantSlug={tenantSlug}
                  productId={detail.product.id}
                  canEdit={canManageTenantWide}
                />
              </div>
            ),
          },
          {
            value: 'recipe',
            label: t('admin.catalog.tabRecipe'),
            content: (
              <div className="mt-6">
                <RecipeEditor
                  tenantSlug={tenantSlug}
                  detail={detail}
                  canEdit={canManageTenantWide}
                />
              </div>
            ),
          },
        ]
      : []),
  ]

  return (
    <Tabs
      items={tabs}
      value={activeTab}
      onValueChange={setActiveTab}
      size="md"
      ariaLabel={t('admin.catalog.tabsLabel')}
    />
  )
}
