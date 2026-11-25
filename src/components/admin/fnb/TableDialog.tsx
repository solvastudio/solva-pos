import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, Field, Input, Select, Switch, useToast } from '~/components/ui'
import { createTableFn, updateTableFn } from '~/functions/fnb/tables.fn'
import type { OutletSummaryView } from '~/modules/catalog/shared'
import type { FnbTableView } from '~/modules/fnb/shared'

export interface TableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantSlug: string
  outlets: readonly OutletSummaryView[]
  defaultOutletId?: string
  editing: FnbTableView | null
}

export function TableDialog({
  open,
  onOpenChange,
  tenantSlug,
  outlets,
  defaultOutletId,
  editing,
}: TableDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [outletId, setOutletId] = useState(defaultOutletId ?? outlets[0]?.id ?? '')
  const [code, setCode] = useState('')
  const [area, setArea] = useState('')
  const [capacityStr, setCapacityStr] = useState('')
  const [sortOrderStr, setSortOrderStr] = useState('0')
  const [isActive, setIsActive] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setOutletId(editing.outletId)
      setCode(editing.code)
      setArea(editing.area ?? '')
      setCapacityStr(editing.capacity === null ? '' : String(editing.capacity))
      setSortOrderStr(String(editing.sortOrder))
      setIsActive(editing.isActive)
    } else {
      setOutletId(defaultOutletId ?? outlets[0]?.id ?? '')
      setCode('')
      setArea('')
      setCapacityStr('')
      setSortOrderStr('0')
      setIsActive(true)
    }
    setErrorMsg(null)
  }, [open, editing, defaultOutletId, outlets])

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      const cap = capacityStr.trim() === '' ? null : Number.parseInt(capacityStr, 10)
      const sortOrder = sortOrderStr.trim() === '' ? 0 : Number.parseInt(sortOrderStr, 10)
      if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 1000)) {
        throw new Error('Capacity must be between 1 and 1000')
      }
      if (!Number.isInteger(sortOrder)) {
        throw new Error('Sort order must be an integer')
      }

      if (editing) {
        return updateTableFn({
          data: {
            id: editing.id,
            code: code.trim(),
            area: area.trim() === '' ? null : area.trim(),
            capacity: cap,
            sortOrder,
            isActive,
          },
        })
      }
      return createTableFn({
        data: {
          outletId,
          code: code.trim(),
          area: area.trim() === '' ? null : area.trim(),
          capacity: cap,
          sortOrder,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      queryClient.invalidateQueries({ queryKey: ['fnb', tenantSlug, 'tables'] })
      toast.show({ tone: 'success', message: t('admin.tables.saved') })
      onOpenChange(false)
    },
    onError: (err) => setErrorMsg(err.message),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        editing
          ? t('admin.tables.editTitle', { code: editing.code })
          : t('admin.tables.addTitle')
      }
      size="md"
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

        {!editing ? (
          <Field label={t('admin.tables.outletLabel')} htmlFor="table-outlet">
            <Select
              id="table-outlet"
              ariaLabel={t('admin.tables.outletLabel')}
              value={outletId}
              onValueChange={setOutletId}
              options={outlets.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` }))}
            />
          </Field>
        ) : null}

        <Field
          label={t('admin.tables.codeLabel')}
          htmlFor="table-code"
          hint={t('admin.tables.codeHint')}
        >
          <Input
            id="table-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={10}
            required
          />
        </Field>

        <Field label={t('admin.tables.areaLabel')} htmlFor="table-area">
          <Input
            id="table-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder={t('admin.tables.areaPlaceholder')}
            maxLength={40}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('admin.tables.capacityLabel')} htmlFor="table-capacity">
            <Input
              id="table-capacity"
              type="number"
              min={1}
              max={1000}
              value={capacityStr}
              onChange={(e) => setCapacityStr(e.target.value)}
            />
          </Field>
          <Field label={t('admin.tables.sortOrderLabel')} htmlFor="table-sort">
            <Input
              id="table-sort"
              type="number"
              value={sortOrderStr}
              onChange={(e) => setSortOrderStr(e.target.value)}
            />
          </Field>
        </div>

        {editing ? (
          <Switch
            id="table-active"
            label={t('admin.tables.activeLabel')}
            checked={isActive}
            disabled={editing.hasOpenBill && isActive}
            onCheckedChange={setIsActive}
          />
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saveMut.isPending} disabled={!outletId && !editing}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
