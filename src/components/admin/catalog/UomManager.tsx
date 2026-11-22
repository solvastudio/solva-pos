import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, Field, Input, PencilLine, Plus, Switch, Trash2, useToast } from '~/components/ui'
import { deleteUomFn, saveUomFn } from '~/functions/catalog/catalog-write.fn'
import type { UomView } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface UomManagerProps {
  tenantSlug: string
  uoms: readonly UomView[]
  canManage: boolean
}

export function UomManager({ tenantSlug, uoms, canManage }: UomManagerProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [allowFraction, setAllowFraction] = useState(false)
  const [editing, setEditing] = useState<UomView | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () =>
      saveUomFn({
        data: editing
          ? { id: editing.id, code: code.trim().toLowerCase(), name: name.trim(), allowFraction }
          : { code: code.trim().toLowerCase(), name: name.trim(), allowFraction },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey as never))
        return
      }
      setFormError(null)
      setEditing(null)
      setCode('')
      setName('')
      setAllowFraction(false)
      queryClient.invalidateQueries({ queryKey: qk.uoms(tenantSlug) })
      toast.show({ tone: 'success', message: t('common.save') })
    },
    onError: (err) => setFormError(err.message),
  })

  const deleteMut = useMutation({
    retry: 0,
    mutationFn: async (id: string) => deleteUomFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey as never))
        return
      }
      setFormError(null)
      queryClient.invalidateQueries({ queryKey: qk.uoms(tenantSlug) })
    },
    onError: (err) => setFormError(err.message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim() || !name.trim()) return
    saveMut.mutate()
  }

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold text-ink">{t('admin.catalog.uomSectionTitle')}</h3>
      {canManage ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('admin.catalog.uomCodeLabel')} htmlFor={`${idPrefix}-code`}>
              <Input
                id={`${idPrefix}-code`}
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                disabled={saveMut.isPending}
              />
            </Field>
            <Field label={t('admin.catalog.uomNameLabel')} htmlFor={`${idPrefix}-name`}>
              <Input
                id={`${idPrefix}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saveMut.isPending}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Switch
              label={t('admin.catalog.allowFractionLabel')}
              checked={allowFraction}
              onCheckedChange={setAllowFraction}
            />
            <div className="flex items-center gap-2">
              {editing ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null)
                    setCode('')
                    setName('')
                    setAllowFraction(false)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              ) : null}
              <Button
                type="submit"
                loading={saveMut.isPending}
                leadingIcon={!editing ? <Plus className="size-4" aria-hidden="true" /> : undefined}
              >
                {editing ? t('common.save') : t('admin.catalog.addUom')}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {formError ? (
        <p role="alert" className="text-body text-danger-ink">
          {formError}
        </p>
      ) : null}

      <ul className="divide-y divide-line rounded-sm border border-line bg-surface">
        {uoms.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-body font-semibold text-ink">{u.code}</span>
              <span className="truncate text-body text-ink-soft">{u.name}</span>
              {u.allowFraction ? (
                <Chip status="synced" size="sm" label={t('admin.catalog.allowFractionLabel')} />
              ) : null}
            </div>
            {canManage ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(u)
                    setCode(u.code)
                    setName(u.name)
                    setAllowFraction(u.allowFraction)
                  }}
                >
                  <PencilLine className="size-4" />
                  {t('common.edit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteMut.mutate(u.id)}
                >
                  <Trash2 className="size-4" />
                  {t('admin.catalog.deleteAction')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
