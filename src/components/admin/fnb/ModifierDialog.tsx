import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Dialog,
  Field,
  Input,
  Plus,
  Select,
  Switch,
  Trash2,
  useToast,
} from '~/components/ui'
import { createModifierFn, updateModifierFn } from '~/functions/catalog/modifier.fn'
import type { ModifierAdjustType } from '~/lib/contracts'
import type { IngredientOptionView, ModifierView } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'
import { IngredientPicker } from './IngredientPicker'

interface DraftIngredient {
  ingredientSkuId: string
  adjustType: ModifierAdjustType
  qty: string
}

export interface ModifierDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantSlug: string
  productId: string
  groupId: string
  editing: ModifierView | null
  ingredientOptions: readonly IngredientOptionView[]
}

export function ModifierDialog({
  open,
  onOpenChange,
  tenantSlug,
  productId,
  groupId,
  editing,
  ingredientOptions,
}: ModifierDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [priceDeltaStr, setPriceDeltaStr] = useState('0')
  const [sortOrderStr, setSortOrderStr] = useState('0')
  const [isActive, setIsActive] = useState(true)
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setName(editing.name)
      setPriceDeltaStr(String(editing.priceDelta))
      setSortOrderStr(String(editing.sortOrder))
      setIsActive(editing.isActive)
      setIngredients(
        editing.ingredients.map((i) => ({
          ingredientSkuId: i.ingredientSkuId,
          adjustType: i.adjustType,
          qty: i.qty ?? '',
        })),
      )
    } else {
      setName('')
      setPriceDeltaStr('0')
      setSortOrderStr('0')
      setIsActive(true)
      setIngredients([])
    }
    setErrorMsg(null)
  }, [open, editing])

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      const priceDelta = Number.parseInt(priceDeltaStr || '0', 10)
      const sortOrder = Number.parseInt(sortOrderStr || '0', 10)
      if (!Number.isSafeInteger(priceDelta)) {
        throw new Error('Price delta must be an integer')
      }
      if (!Number.isInteger(sortOrder)) {
        throw new Error('Sort order must be an integer')
      }
      const mappedIngredients = ingredients
        .filter((i) => i.ingredientSkuId.length > 0)
        .map((i) => ({
          ingredientSkuId: i.ingredientSkuId,
          adjustType: i.adjustType,
          qty: i.adjustType === 'REMOVE' ? null : i.qty.trim(),
        }))

      if (editing) {
        return updateModifierFn({
          data: {
            id: editing.id,
            name: name.trim(),
            priceDelta,
            sortOrder,
            isActive,
            ingredients: mappedIngredients,
          },
        })
      }
      return createModifierFn({
        data: {
          modifierGroupId: groupId,
          name: name.trim(),
          priceDelta,
          sortOrder,
          isActive,
          ingredients: mappedIngredients,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      queryClient.invalidateQueries({ queryKey: qk.productModifierGroups(tenantSlug, productId) })
      queryClient.invalidateQueries({ queryKey: qk.modifierGroups(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.modifier.saved') })
      onOpenChange(false)
    },
    onError: (err) => setErrorMsg(err.message),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t('admin.modifier.optionDialogEdit') : t('admin.modifier.optionDialogAdd')}
      size="lg"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          saveMut.mutate()
        }}
      >
        {errorMsg ? (
          <p role="alert" className="text-body text-danger-ink">
            {errorMsg}
          </p>
        ) : null}

        <Field label={t('admin.modifier.optionNameLabel')} htmlFor="mod-opt-name">
          <Input
            id="mod-opt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t('admin.modifier.priceDeltaLabel')}
            htmlFor="mod-opt-delta"
            hint={t('admin.modifier.priceDeltaHint')}
          >
            <Input
              id="mod-opt-delta"
              type="number"
              step={100}
              value={priceDeltaStr}
              onChange={(e) => setPriceDeltaStr(e.target.value)}
              required
            />
          </Field>
          <Field label={t('admin.modifier.sortOrderLabel')} htmlFor="mod-opt-sort">
            <Input
              id="mod-opt-sort"
              type="number"
              value={sortOrderStr}
              onChange={(e) => setSortOrderStr(e.target.value)}
            />
          </Field>
        </div>

        <Switch
          id="mod-opt-active"
          label={t('admin.modifier.activeLabel')}
          checked={isActive}
          onCheckedChange={setIsActive}
        />

        <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface-sunken p-3">
          <div className="flex items-center justify-between">
            <span className="text-body font-medium text-ink">
              {t('admin.modifier.ingredientsTitle')}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={ingredientOptions.length === 0}
              onClick={() =>
                setIngredients((prev) => [
                  ...prev,
                  {
                    ingredientSkuId: ingredientOptions[0]?.skuId ?? '',
                    adjustType: 'ADD',
                    qty: '1',
                  },
                ])
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>{t('admin.modifier.addIngredientButton')}</span>
            </Button>
          </div>

          {ingredients.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-center">
              <div className="md:col-span-5">
                <IngredientPicker
                  ariaLabel={t('admin.recipe.selectIngredient')}
                  options={ingredientOptions}
                  value={row.ingredientSkuId}
                  onValueChange={(skuId) =>
                    setIngredients((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, ingredientSkuId: skuId } : item)),
                    )
                  }
                />
              </div>
              <div className="md:col-span-4">
                <Select
                  size="md"
                  ariaLabel={t('admin.modifier.adjustTypeLabel')}
                  value={row.adjustType}
                  onValueChange={(val) =>
                    setIngredients((prev) =>
                      prev.map((item, i) =>
                        i === idx
                          ? {
                              ...item,
                              adjustType: val as ModifierAdjustType,
                              qty: val === 'REMOVE' ? '' : item.qty || '1',
                            }
                          : item,
                      ),
                    )
                  }
                  options={[
                    { value: 'ADD', label: t('admin.modifier.adjustADD') },
                    { value: 'REDUCE', label: t('admin.modifier.adjustREDUCE') },
                    { value: 'REMOVE', label: t('admin.modifier.adjustREMOVE') },
                  ]}
                />
              </div>
              <div className="md:col-span-2">
                <Input
                  type="text"
                  inputMode="decimal"
                  aria-label={t('admin.modifier.qtyLabel')}
                  disabled={row.adjustType === 'REMOVE'}
                  value={row.adjustType === 'REMOVE' ? '' : row.qty}
                  onChange={(e) =>
                    setIngredients((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, qty: e.target.value } : item)),
                    )
                  }
                />
              </div>
              <div className="flex justify-end md:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('admin.recipe.removeRow')}
                  onClick={() => setIngredients((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saveMut.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
