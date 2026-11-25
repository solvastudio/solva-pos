import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { BillItemModifierInput } from '~/lib/contracts'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { Input } from '~/components/ui/Input'
import { formatMoney, toMoney } from '~/lib/kernel'
import { computeModifierDeltaSum } from '~/modules/fnb/shared'
import type { ProductModifierGroupWithOptions } from '~/pos/data/table.repo'
import type { ModifierGroupRecord, ModifierRecord } from '~/pos/db/types'

export interface ModifierSheetProps {
  open: boolean
  mode: 'ADD' | 'EDIT'
  itemName: string
  baseUnitPrice: number
  groups: readonly ProductModifierGroupWithOptions[]
  initialSelected?: readonly BillItemModifierInput[]
  initialQty?: string
  initialNote?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (selection: {
    modifiers: BillItemModifierInput[]
    qtyInput: string
    note: string
  }) => void | Promise<void>
}

function formatDeltaLabel(delta: number, locale: 'id-ID' | 'en-US'): string {
  if (delta === 0) return ''
  const abs = formatMoney(toMoney(Math.abs(delta)), locale)
  return delta > 0 ? `+${abs}` : `-${abs}`
}

export function validateModifierSelections(
  groups: readonly ProductModifierGroupWithOptions[],
  selectedByModId: ReadonlyMap<string, number>,
): boolean {
  for (const { group, options } of groups) {
    let count = 0
    for (const opt of options) {
      if ((selectedByModId.get(opt.id) ?? 0) > 0) count += 1
    }
    const minReq = group.min_select
    if (count < minReq) return false
    if (group.selection_type === 'SINGLE' && count > 1) return false
    if (group.max_select !== null && count > group.max_select) return false
  }
  return true
}

const EMPTY_SELECTED: readonly BillItemModifierInput[] = []

export function ModifierSheet({
  open,
  mode,
  itemName,
  baseUnitPrice,
  groups,
  initialSelected = EMPTY_SELECTED,
  initialQty = '1',
  initialNote = '',
  onOpenChange,
  onSubmit,
}: ModifierSheetProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const noteId = useId()

  const [selected, setSelected] = useState<Map<string, number>>(new Map())
  const [qtyInput, setQtyInput] = useState(initialQty)
  const [note, setNote] = useState(initialNote)

  useEffect(() => {
    if (!open) return
    const next = new Map<string, number>()
    for (const m of initialSelected) {
      next.set(m.modifier_id, m.qty)
    }
    setSelected(next)
    setQtyInput(initialQty)
    setNote(initialNote)
  }, [initialNote, initialQty, initialSelected, open])

  const optionById = useMemo(() => {
    const map = new Map<string, { group: ModifierGroupRecord; mod: ModifierRecord }>()
    for (const entry of groups) {
      for (const opt of entry.options) {
        map.set(opt.id, { group: entry.group, mod: opt })
      }
    }
    return map
  }, [groups])

  const selectedList: BillItemModifierInput[] = useMemo(() => {
    const list: BillItemModifierInput[] = []
    for (const [modId, qty] of selected.entries()) {
      if (qty <= 0) continue
      const found = optionById.get(modId)
      if (!found) continue
      list.push({
        modifier_id: modId,
        name: found.mod.name,
        price_delta: toMoney(found.mod.price_delta),
        qty,
      })
    }
    return list
  }, [optionById, selected])

  const unitPrice = useMemo(() => {
    const delta = computeModifierDeltaSum(selectedList)
    return Math.max(0, baseUnitPrice + delta)
  }, [baseUnitPrice, selectedList])

  const valid = validateModifierSelections(groups, selected)

  function toggleOption(groupEntry: ProductModifierGroupWithOptions, mod: ModifierRecord) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (groupEntry.group.selection_type === 'SINGLE') {
        for (const opt of groupEntry.options) {
          next.delete(opt.id)
        }
        next.set(mod.id, 1)
        return next
      }

      const cur = next.get(mod.id) ?? 0
      if (cur > 0) {
        next.delete(mod.id)
        return next
      }
      let currentCount = 0
      for (const opt of groupEntry.options) {
        if ((next.get(opt.id) ?? 0) > 0) currentCount += 1
      }
      if (groupEntry.group.max_select !== null && currentCount >= groupEntry.group.max_select) {
        return next
      }
      next.set(mod.id, 1)
      return next
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    void onSubmit({ modifiers: selectedList, qtyInput, note: note.trim() })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pos.bill.modifierTitle', { name: itemName })}
      size="md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex max-h-80 flex-col gap-4 overflow-y-auto pr-1">
          {groups.map((entry) => {
            const minReq = entry.group.min_select
            return (
              <fieldset key={entry.group.id} className="flex flex-col gap-2">
                <legend className="flex items-center gap-2 text-label font-semibold text-ink">
                  <span>{entry.group.name}</span>
                  {minReq > 0 ? (
                    <span className="text-caption font-normal text-warning-ink">
                      {t('pos.bill.modifierRequiredHint', { min: minReq })}
                    </span>
                  ) : null}
                  {entry.group.max_select !== null ? (
                    <span className="text-caption font-normal text-ink-soft">
                      {t('pos.bill.modifierMaxHint', { max: entry.group.max_select })}
                    </span>
                  ) : null}
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {entry.options.map((mod) => {
                    const checked = (selected.get(mod.id) ?? 0) > 0
                    const deltaTxt = formatDeltaLabel(mod.price_delta, locale)
                    return (
                      <label
                        key={mod.id}
                        className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2 text-body-sm hover:border-action has-[:checked]:border-action has-[:checked]:bg-primary-50"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type={entry.group.selection_type === 'SINGLE' ? 'radio' : 'checkbox'}
                            name={`mod-group-${entry.group.id}`}
                            checked={checked}
                            onChange={() => toggleOption(entry, mod)}
                            className="size-4 accent-action"
                          />
                          <span className="font-medium text-ink">{mod.name}</span>
                        </span>
                        {deltaTxt ? (
                          <span className="font-mono text-caption text-ink-soft tabular-nums">
                            {deltaTxt}
                          </span>
                        ) : null}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )
          })}

          {mode === 'ADD' ? (
            <Field htmlFor={noteId} label={t('pos.bill.modifierNoteLabel')}>
              <Input
                id={noteId}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-line pt-3">
          <div className="font-mono text-h3 font-semibold text-ink tabular-nums">
            {formatMoney(toMoney(unitPrice), locale)}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="md" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={!valid}>
              {mode === 'ADD' ? t('pos.bill.modifierAddButton') : t('pos.bill.modifierSaveButton')}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
