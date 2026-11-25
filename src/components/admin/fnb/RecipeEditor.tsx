import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  Package,
  Plus,
  Select,
  Trash2,
  TriangleAlert,
  useToast,
} from '~/components/ui'
import { saveRecipeFn } from '~/functions/catalog/recipe.fn'
import { formatMoney, toMoney, type LocaleId } from '~/lib/kernel'
import type { AdminProductDetail } from '~/modules/catalog/shared'
import { ingredientOptionsQueryOptions, recipeForSkuQueryOptions } from '~/queries/catalog.queries'
import { qk } from '~/queries/keys'
import { IngredientPicker } from './IngredientPicker'

interface DraftRecipeRow {
  ingredientSkuId: string
  qty: string
}

export interface RecipeEditorProps {
  tenantSlug: string
  detail: AdminProductDetail
  canEdit: boolean
}

export function RecipeEditor({ tenantSlug, detail, canEdit }: RecipeEditorProps) {
  const { t, i18n } = useTranslation()
  const locale: LocaleId = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const toast = useToast()
  const queryClient = useQueryClient()

  const activeSkus = useMemo(() => detail.skus, [detail.skus])
  const [selectedSkuId, setSelectedSkuId] = useState(activeSkus[0]?.id ?? '')

  useEffect(() => {
    if (activeSkus.length > 0 && !activeSkus.some((s) => s.id === selectedSkuId)) {
      setSelectedSkuId(activeSkus[0]!.id)
    }
  }, [activeSkus, selectedSkuId])

  const { data: recipe } = useQuery({
    ...recipeForSkuQueryOptions(tenantSlug, selectedSkuId),
    enabled: Boolean(selectedSkuId),
  })
  const { data: ingredientOptions = [] } = useQuery(
    ingredientOptionsQueryOptions(tenantSlug, selectedSkuId || undefined),
  )

  const [rows, setRows] = useState<DraftRecipeRow[]>([])
  const [pickSkuId, setPickSkuId] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (recipe) {
      setRows(recipe.items.map((i) => ({ ingredientSkuId: i.ingredientSkuId, qty: i.qty })))
      setErrorMsg(null)
    }
  }, [recipe])

  const optionBySkuId = useMemo(() => {
    const map = new Map(ingredientOptions.map((o) => [o.skuId, o]))
    if (recipe) {
      for (const item of recipe.items) {
        if (!map.has(item.ingredientSkuId)) {
          map.set(item.ingredientSkuId, {
            skuId: item.ingredientSkuId,
            skuCode: item.ingredientSkuCode,
            productId: '',
            productName: item.ingredientProductName,
            productType: 'RETAIL',
            trackStock: item.ingredientTrackStock,
            uomCode: item.uomCode,
          })
        }
      }
    }
    return map
  }, [ingredientOptions, recipe])

  const availableOptions = useMemo(() => {
    const used = new Set(rows.map((r) => r.ingredientSkuId))
    return ingredientOptions.filter((o) => !used.has(o.skuId))
  }, [ingredientOptions, rows])

  const hasUntrackedIngredient = rows.some(
    (r) => optionBySkuId.get(r.ingredientSkuId)?.trackStock === false,
  )

  const savedRowBySkuId = useMemo(
    () => new Map((recipe?.items ?? []).map((i) => [i.ingredientSkuId, i])),
    [recipe],
  )

  const saveMut = useMutation({
    retry: 0,
    mutationFn: () =>
      saveRecipeFn({
        data: {
          menuSkuId: selectedSkuId,
          items: rows.map((r) => ({
            ingredientSkuId: r.ingredientSkuId,
            qty: r.qty.trim(),
          })),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: qk.recipeForSku(tenantSlug, selectedSkuId) })
      toast.show({ tone: 'success', message: t('admin.recipe.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  if (!selectedSkuId) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-h3 font-semibold text-ink">{t('admin.recipe.title')}</h2>
          <p className="text-body text-ink-soft">{t('admin.recipe.subtitle')}</p>
        </div>
        {activeSkus.length > 1 ? (
          <div className="w-64">
            <Field label={t('admin.recipe.menuSkuLabel')} htmlFor="recipe-menu-sku">
              <Select
                id="recipe-menu-sku"
                size="md"
                ariaLabel={t('admin.recipe.menuSkuLabel')}
                value={selectedSkuId}
                onValueChange={setSelectedSkuId}
                options={activeSkus.map((s) => ({
                  value: s.id,
                  label: s.skuCode,
                }))}
              />
            </Field>
          </div>
        ) : null}
      </div>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      {hasUntrackedIngredient ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-sm border border-warning-line bg-warning-soft p-3 text-body-sm text-warning-ink"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>{t('admin.recipe.notTrackedWarning')}</span>
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full max-w-md">
            <IngredientPicker
              ariaLabel={t('admin.recipe.selectIngredient')}
              options={availableOptions}
              value={pickSkuId}
              onValueChange={setPickSkuId}
              disabled={availableOptions.length === 0}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!pickSkuId}
            onClick={() => {
              if (!pickSkuId) return
              setRows((prev) => [...prev, { ingredientSkuId: pickSkuId, qty: '1' }])
              setPickSkuId('')
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>{t('admin.recipe.addIngredient')}</span>
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Package className="size-6" aria-hidden="true" />}
          title={t('admin.recipe.emptyTitle')}
          description={t('admin.recipe.emptyDesc')}
        />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((row, idx) => {
            const meta = optionBySkuId.get(row.ingredientSkuId)
            const savedLine = savedRowBySkuId.get(row.ingredientSkuId)
            return (
              <div
                key={row.ingredientSkuId}
                className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-12 md:items-center"
              >
                <div className="md:col-span-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium text-ink">
                      {meta?.productName ?? row.ingredientSkuId}
                    </span>
                    <span className="font-mono text-caption text-ink-soft">
                      {meta?.skuCode ?? ''}
                    </span>
                    {meta && !meta.trackStock ? (
                      <Chip status="inactive" label={t('admin.recipe.notTrackedBadge')} />
                    ) : null}
                  </div>
                </div>
                <div className="md:col-span-3">
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${t('admin.recipe.qtyLabel')} ${meta?.productName ?? ''}`}
                    value={row.qty}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, qty: e.target.value } : item)),
                      )
                    }
                  />
                </div>
                <div className="text-body text-ink-soft md:col-span-1">
                  {meta?.uomCode ?? '—'}
                </div>
                <div className="text-right font-mono text-body-sm text-ink-soft md:col-span-2">
                  {savedLine && savedLine.estimatedLineCost !== null
                    ? formatMoney(toMoney(savedLine.estimatedLineCost), locale)
                    : '—'}
                </div>
                <div className="flex justify-end md:col-span-1">
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('admin.recipe.removeRow')}
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
        <div className="text-body text-ink-soft">
          {recipe && recipe.estimatedTotalCost !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span>{t('admin.recipe.estTotalCostLabel')}</span>
              <strong className="font-mono text-ink">
                {formatMoney(toMoney(recipe.estimatedTotalCost), locale)}
              </strong>
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <Button type="button" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {t('admin.recipe.saveButton')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
