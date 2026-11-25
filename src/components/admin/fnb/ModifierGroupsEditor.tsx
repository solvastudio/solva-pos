import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Input,
  PencilLine,
  Plus,
  Select,
  Switch,
  Trash2,
  TriangleAlert,
  Unlink,
  Utensils,
  useToast,
} from '~/components/ui'
import {
  createModifierGroupFn,
  deleteModifierFn,
  deleteModifierGroupFn,
  linkModifierGroupProductFn,
  unlinkModifierGroupProductFn,
  updateModifierGroupFn,
} from '~/functions/catalog/modifier.fn'
import type { ModifierSelectionType } from '~/lib/contracts'
import { formatMoney, toMoney, type LocaleId } from '~/lib/kernel'
import type { ModifierView, ProductModifierGroupView } from '~/modules/catalog/shared'
import {
  ingredientOptionsQueryOptions,
  modifierGroupsQueryOptions,
  productModifierGroupsQueryOptions,
} from '~/queries/catalog.queries'
import { qk } from '~/queries/keys'
import { ModifierDialog } from './ModifierDialog'

export interface ModifierGroupsEditorProps {
  tenantSlug: string
  productId: string
  canEdit: boolean
}

export function ModifierGroupsEditor({
  tenantSlug,
  productId,
  canEdit,
}: ModifierGroupsEditorProps) {
  const { t, i18n } = useTranslation()
  const locale: LocaleId = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: linkedGroups = [] } = useQuery(
    productModifierGroupsQueryOptions(tenantSlug, productId),
  )
  const { data: allGroups = [] } = useQuery(modifierGroupsQueryOptions(tenantSlug))
  const { data: ingredientOptions = [] } = useQuery(ingredientOptionsQueryOptions(tenantSlug))

  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ProductModifierGroupView | null>(null)
  const [groupName, setGroupName] = useState('')
  const [selectionType, setSelectionType] = useState<ModifierSelectionType>('MULTI')
  const [minSelectStr, setMinSelectStr] = useState('0')
  const [maxSelectStr, setMaxSelectStr] = useState('')
  const [groupActive, setGroupActive] = useState(true)

  const [modDialogOpen, setModDialogOpen] = useState(false)
  const [modDialogGroupId, setModDialogGroupId] = useState('')
  const [editingMod, setEditingMod] = useState<ModifierView | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const unlinkedGroups = useMemo(() => {
    const linkedSet = new Set(linkedGroups.map((g) => g.modifierGroupId))
    return allGroups.filter((g) => !linkedSet.has(g.id))
  }, [allGroups, linkedGroups])

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: qk.productModifierGroups(tenantSlug, productId) })
    queryClient.invalidateQueries({ queryKey: qk.modifierGroups(tenantSlug) })
  }

  const linkMut = useMutation({
    retry: 0,
    mutationFn: (groupId: string) =>
      linkModifierGroupProductFn({
        data: {
          modifierGroupId: groupId,
          productId,
          sortOrder: linkedGroups.length,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setSelectedGroupId('')
      invalidateAll()
      toast.show({ tone: 'success', message: t('admin.modifier.linked') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const unlinkMut = useMutation({
    retry: 0,
    mutationFn: (groupId: string) =>
      unlinkModifierGroupProductFn({ data: { modifierGroupId: groupId, productId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      invalidateAll()
      toast.show({ tone: 'success', message: t('admin.modifier.unlinked') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const saveGroupMut = useMutation({
    retry: 0,
    mutationFn: async () => {
      const minSelect = Number.parseInt(minSelectStr || '0', 10)
      const maxSelect = maxSelectStr.trim() === '' ? null : Number.parseInt(maxSelectStr, 10)
      if (!Number.isInteger(minSelect) || minSelect < 0) {
        throw new Error('minSelect must be >= 0')
      }
      if (maxSelect !== null && (!Number.isInteger(maxSelect) || maxSelect < minSelect)) {
        throw new Error('maxSelect must be >= minSelect')
      }

      if (editingGroup) {
        return updateModifierGroupFn({
          data: {
            id: editingGroup.modifierGroupId,
            name: groupName.trim(),
            selectionType,
            minSelect,
            maxSelect,
            isActive: groupActive,
          },
        })
      }
      const created = await createModifierGroupFn({
        data: {
          name: groupName.trim(),
          selectionType,
          minSelect,
          maxSelect,
          isActive: groupActive,
        },
      })
      if (!created.ok) return created
      const linked = await linkModifierGroupProductFn({
        data: {
          modifierGroupId: created.data.id,
          productId,
          sortOrder: linkedGroups.length,
        },
      })
      return linked
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      setGroupDialogOpen(false)
      invalidateAll()
      toast.show({ tone: 'success', message: t('admin.modifier.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const deleteGroupMut = useMutation({
    retry: 0,
    mutationFn: (id: string) => deleteModifierGroupFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      invalidateAll()
      toast.show({ tone: 'success', message: t('admin.modifier.deleted') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const deleteModMut = useMutation({
    retry: 0,
    mutationFn: (id: string) => deleteModifierFn({ data: { id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      invalidateAll()
      toast.show({ tone: 'success', message: t('admin.modifier.deleted') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const openNewGroupDialog = () => {
    setEditingGroup(null)
    setGroupName('')
    setSelectionType('MULTI')
    setMinSelectStr('0')
    setMaxSelectStr('')
    setGroupActive(true)
    setGroupDialogOpen(true)
  }

  const openEditGroupDialog = (g: ProductModifierGroupView) => {
    setEditingGroup(g)
    setGroupName(g.name)
    setSelectionType(g.selectionType)
    setMinSelectStr(String(g.minSelect))
    setMaxSelectStr(g.maxSelect === null ? '' : String(g.maxSelect))
    setGroupActive(g.isActive)
    setGroupDialogOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-h3 font-semibold text-ink">{t('admin.modifier.title')}</h2>
          <p className="text-body text-ink-soft">{t('admin.modifier.subtitle')}</p>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Select
                size="md"
                ariaLabel={t('admin.modifier.linkLabel')}
                placeholder={t('admin.modifier.selectGroup')}
                value={selectedGroupId}
                onValueChange={setSelectedGroupId}
                disabled={unlinkedGroups.length === 0}
                options={unlinkedGroups.map((g) => ({
                  value: g.id,
                  label: `${g.name} (${g.selectionType})`,
                }))}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!selectedGroupId}
              loading={linkMut.isPending}
              onClick={() => selectedGroupId && linkMut.mutate(selectedGroupId)}
            >
              {t('admin.modifier.linkButton')}
            </Button>
            <Button type="button" onClick={openNewGroupDialog}>
              <Plus className="size-4" aria-hidden="true" />
              <span>{t('admin.modifier.newGroupButton')}</span>
            </Button>
          </div>
        ) : null}
      </div>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      {linkedGroups.length === 0 ? (
        <EmptyState
          icon={<Utensils className="size-6" aria-hidden="true" />}
          title={t('admin.modifier.emptyLinkedTitle')}
          description={t('admin.modifier.emptyLinkedDesc')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {linkedGroups.map((group) => (
            <Card key={group.modifierGroupId} className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-h3 font-semibold text-ink">{group.name}</h3>
                  <Chip
                    status={group.isActive ? 'active' : 'inactive'}
                    label={
                      group.isActive
                        ? t('admin.tables.statusActive')
                        : t('admin.tables.statusInactive')
                    }
                  />
                  <span className="text-caption text-ink-soft">
                    {t('admin.modifier.ruleSummary', {
                      type: group.selectionType,
                      min: group.minSelect,
                      max: group.maxSelect === null ? '∞' : group.maxSelect,
                    })}
                  </span>
                </div>

                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setModDialogGroupId(group.modifierGroupId)
                        setEditingMod(null)
                        setModDialogOpen(true)
                      }}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      <span>{t('admin.modifier.addOptionButton')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditGroupDialog(group)}
                    >
                      <PencilLine className="size-4" aria-hidden="true" />
                      <span>{t('admin.modifier.editGroupButton')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => unlinkMut.mutate(group.modifierGroupId)}
                    >
                      <Unlink className="size-4" aria-hidden="true" />
                      <span>{t('admin.modifier.unlinkButton')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${t('admin.modifier.deleteGroupButton')} ${group.name}`}
                      onClick={() => deleteGroupMut.mutate(group.modifierGroupId)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>

              {group.negativeDeltaWarning ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-sm border border-warning-line bg-warning-soft p-3 text-body-sm text-warning-ink"
                >
                  <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                  <span>{t('admin.modifier.negativeDeltaWarning')}</span>
                </div>
              ) : null}

              {group.modifiers.length === 0 ? (
                <p className="text-body-sm text-ink-soft">{t('admin.modifier.noOptions')}</p>
              ) : (
                <div className="divide-y divide-line rounded-sm border border-line">
                  {group.modifiers.map((mod) => (
                    <div
                      key={mod.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-body font-medium text-ink">{mod.name}</span>
                          {!mod.isActive ? (
                            <Chip status="inactive" label={t('admin.tables.statusInactive')} />
                          ) : null}
                          <span className="font-mono text-body-sm text-ink-soft">
                            {mod.priceDelta > 0
                              ? `+${formatMoney(toMoney(mod.priceDelta), locale)}`
                              : formatMoney(toMoney(mod.priceDelta), locale)}
                          </span>
                        </div>
                        {mod.ingredients.length > 0 ? (
                          <p className="text-caption text-ink-soft">
                            {mod.ingredients
                              .map((ing) =>
                                ing.adjustType === 'REMOVE'
                                  ? `REMOVE ${ing.ingredientProductName}`
                                  : `${ing.adjustType} ${ing.qty ?? ''} ${ing.uomCode} ${ing.ingredientProductName}`,
                              )
                              .join(' · ')}
                          </p>
                        ) : null}
                      </div>

                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setModDialogGroupId(group.modifierGroupId)
                              setEditingMod(mod)
                              setModDialogOpen(true)
                            }}
                          >
                            <PencilLine className="size-4" aria-hidden="true" />
                            <span>{t('admin.modifier.editOptionButton')}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`${t('admin.modifier.deleteOptionButton')} ${mod.name}`}
                            onClick={() => deleteModMut.mutate(mod.id)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        title={
          editingGroup ? t('admin.modifier.groupDialogEdit') : t('admin.modifier.groupDialogAdd')
        }
        size="md"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            saveGroupMut.mutate()
          }}
        >
          <Field label={t('admin.modifier.groupNameLabel')} htmlFor="mod-grp-name">
            <Input
              id="mod-grp-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={60}
              required
            />
          </Field>

          <Field label={t('admin.modifier.selectionTypeLabel')} htmlFor="mod-grp-type">
            <Select
              id="mod-grp-type"
              ariaLabel={t('admin.modifier.selectionTypeLabel')}
              value={selectionType}
              onValueChange={(val) => setSelectionType(val as ModifierSelectionType)}
              options={[
                { value: 'SINGLE', label: t('admin.modifier.selectionSINGLE') },
                { value: 'MULTI', label: t('admin.modifier.selectionMULTI') },
              ]}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('admin.modifier.minSelectLabel')} htmlFor="mod-grp-min">
              <Input
                id="mod-grp-min"
                type="number"
                min={0}
                value={minSelectStr}
                onChange={(e) => setMinSelectStr(e.target.value)}
                required
              />
            </Field>
            <Field label={t('admin.modifier.maxSelectLabel')} htmlFor="mod-grp-max">
              <Input
                id="mod-grp-max"
                type="number"
                min={0}
                value={maxSelectStr}
                onChange={(e) => setMaxSelectStr(e.target.value)}
              />
            </Field>
          </div>

          <Switch
            id="mod-grp-active"
            label={t('admin.modifier.activeLabel')}
            checked={groupActive}
            onCheckedChange={setGroupActive}
          />

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setGroupDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saveGroupMut.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>

      <ModifierDialog
        open={modDialogOpen}
        onOpenChange={setModDialogOpen}
        tenantSlug={tenantSlug}
        productId={productId}
        groupId={modDialogGroupId}
        editing={editingMod}
        ingredientOptions={ingredientOptions}
      />
    </div>
  )
}
