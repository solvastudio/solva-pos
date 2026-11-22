import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Chip, Dialog, Field, Input, PencilLine, Plus, Select, Trash2, useToast } from '~/components/ui'
import { deleteCategoryFn, saveCategoryFn } from '~/functions/catalog/catalog-write.fn'
import type { CategoryView } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface CategoryManagerProps {
  tenantSlug: string
  categories: readonly CategoryView[]
  canManage: boolean
}

export function CategoryManager({ tenantSlug, categories, canManage }: CategoryManagerProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const idPrefix = useId()
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [editing, setEditing] = useState<CategoryView | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<CategoryView | null>(null)

  const roots = categories.filter((c) => c.parentId === null)
  const catMap = new Map(categories.map((c) => [c.id, c]))

  const saveMut = useMutation({
    retry: 0,
    mutationFn: async () =>
      saveCategoryFn({
        data: editing
          ? { id: editing.id, name: name.trim(), parentId: parentId || null }
          : { name: name.trim(), parentId: parentId || null, sortOrder: categories.length },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey as never))
        return
      }
      setFormError(null)
      setEditing(null)
      setName('')
      setParentId('')
      queryClient.invalidateQueries({ queryKey: qk.categories(tenantSlug) })
      toast.show({ tone: 'success', message: t('common.save') })
    },
    onError: (err) => setFormError(err.message),
  })

  const deleteMut = useMutation({
    retry: 0,
    mutationFn: async (id: string) => deleteCategoryFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setFormError(t(res.errorKey as never))
        setDeleting(null)
        return
      }
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: qk.categories(tenantSlug) })
    },
    onError: (err) => {
      setFormError(err.message)
      setDeleting(null)
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setNameError(
        t('validation.fieldRequired', { field: t('admin.catalog.categoryNameLabel') }),
      )
      return
    }
    setNameError(null)
    saveMut.mutate()
  }

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold text-ink">{t('admin.catalog.categorySectionTitle')}</h3>
      {canManage ? (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <Field
            label={t('admin.catalog.categoryNameLabel')}
            htmlFor={`${idPrefix}-name`}
            error={nameError ?? undefined}
            className="min-w-0"
          >
            <Input
              id={`${idPrefix}-name`}
              value={name}
              invalid={Boolean(nameError)}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
              }}
              disabled={saveMut.isPending}
            />
          </Field>
          <Field
            label={t('admin.catalog.parentCategoryLabel')}
            htmlFor={`${idPrefix}-parent`}
            className="min-w-0"
          >
            <Select
              id={`${idPrefix}-parent`}
              value={parentId}
              onValueChange={setParentId}
              options={[
                { value: '', label: t('admin.catalog.noParent') },
                ...roots
                  .filter((r) => !editing || r.id !== editing.id)
                  .map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </Field>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="submit"
              loading={saveMut.isPending}
              leadingIcon={!editing ? <Plus className="size-4" aria-hidden="true" /> : undefined}
            >
              {editing ? t('common.save') : t('admin.catalog.addCategory')}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null)
                  setName('')
                  setParentId('')
                }}
              >
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {formError ? (
        <p role="alert" className="text-body text-danger-ink">
          {formError}
        </p>
      ) : null}

      <ul className="divide-y divide-line rounded-sm border border-line bg-surface">
        {categories.map((cat) => {
          const parent = cat.parentId ? catMap.get(cat.parentId) : null
          return (
            <li key={cat.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-body font-medium text-ink">{cat.name}</span>
                {parent ? <Chip status="tag" size="sm" label={parent.name} /> : null}
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(cat)
                      setName(cat.name)
                      setParentId(cat.parentId ?? '')
                    }}
                  >
                    <PencilLine className="size-4" />
                    {t('common.edit')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(cat)}
                  >
                    <Trash2 className="size-4" />
                    {t('admin.catalog.deleteAction')}
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('admin.catalog.deleteAction')}
      >
        <p className="text-body text-ink-soft">{deleting?.name}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={deleteMut.isPending}
            onClick={() => deleting && deleteMut.mutate(deleting.id)}
          >
            {t('admin.catalog.deleteAction')}
          </Button>
        </div>
      </Dialog>
    </section>
  )
}
