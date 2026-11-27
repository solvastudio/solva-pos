import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  CircleAlert,
  Copy,
  Dialog,
  Field,
  Info,
  Input,
  Trash2,
  useToast,
} from '~/components/ui'
import { deleteRoleFn, updateRoleFn } from '~/functions/identity/role.fn'
import {
  diffPermissionCodes,
  roleExceedsActor,
  type PermissionCode,
  type RoleMatrixView,
} from '~/modules/identity/shared'
import { membersQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'
import { RolePermissionChecklist } from './RolePermissionChecklist'

export interface RoleDetailPanelProps {
  tenantSlug: string
  role: RoleMatrixView
  canEditRoles: boolean
  actorPermissions: ReadonlySet<PermissionCode>
  actorRoleCodes: readonly string[]
  actorDiscountLimitPct: number
  canViewMembers: boolean
  onDuplicate: (role: RoleMatrixView) => void
  onDeleted: () => void
}

export function RoleDetailPanel({
  tenantSlug,
  role,
  canEditRoles,
  actorPermissions,
  actorRoleCodes,
  actorDiscountLimitPct,
  canViewMembers,
  onDuplicate,
  onDeleted,
}: RoleDetailPanelProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const nameId = `${formIdPrefix}-role-name`
  const discountId = `${formIdPrefix}-role-discount`

  const isOwner = role.code === 'OWNER'
  const isOwnRole = actorRoleCodes.includes(role.code)
  const locked = !canEditRoles || isOwner || isOwnRole

  const [name, setName] = useState(role.name)
  const [discount, setDiscount] = useState(String(role.discountLimitPct))
  const [permissions, setPermissions] = useState<Set<PermissionCode>>(
    () => new Set(role.permissions),
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { data: members = [] } = useQuery({
    ...membersQueryOptions(tenantSlug, { roleId: role.id }),
    enabled: canViewMembers,
  })

  const trimmedName = name.trim()
  const discountNumber = Number(discount)
  const discountValid =
    discount.trim() !== '' &&
    Number.isFinite(discountNumber) &&
    discountNumber >= 0 &&
    discountNumber <= 100
  const nameChanged = trimmedName !== role.name
  const discountChanged = discountValid && discountNumber !== role.discountLimitPct
  const diff = diffPermissionCodes(new Set(role.permissions), permissions)
  const permsChanged = diff.added.length > 0 || diff.removed.length > 0
  const dirty = nameChanged || discountChanged || permsChanged

  const exceedsActor = roleExceedsActor(
    { permissions: role.permissions, discountLimitPct: role.discountLimitPct },
    { permissions: actorPermissions, discountLimitPct: actorDiscountLimitPct },
  )
  const canDuplicate = canEditRoles && !exceedsActor
  const hasUnheldPermission = role.permissions.some((code) => !actorPermissions.has(code))

  function handleFailure(errorKey: string) {
    const message = t(errorKey, { defaultValue: t('admin.users.failed') })
    setError(message)
    if (errorKey === 'admin.users.role.versionConflict') {
      // The refetch remounts the panel with the fresh version and drops local state, so also toast the reason.
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'danger', message })
    }
  }

  const saveMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      updateRoleFn({
        data: {
          roleId: role.id,
          expectedVersion: role.version,
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(discountChanged ? { discountLimitPct: discountNumber } : {}),
          ...(permsChanged ? { permissions: Array.from(permissions) } : {}),
        },
      }),
    onSuccess: (res) => {
      setConfirmOpen(false)
      if (!res.ok) {
        handleFailure(res.errorKey)
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.role.saved') })
    },
    onError: () => {
      setConfirmOpen(false)
      setError(t('admin.users.failed'))
    },
  })

  const deleteMutation = useMutation({
    retry: 0,
    mutationFn: () => deleteRoleFn({ data: { roleId: role.id, expectedVersion: role.version } }),
    onSuccess: (res) => {
      setDeleteOpen(false)
      if (!res.ok) {
        handleFailure(res.errorKey)
        return
      }
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.role.deleted') })
      onDeleted()
    },
    onError: () => {
      setDeleteOpen(false)
      setError(t('admin.users.failed'))
    },
  })

  function togglePermission(code: PermissionCode, checked: boolean) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(code)
      } else {
        next.delete(code)
      }
      return next
    })
  }

  function requestSave() {
    setError(null)
    if (!trimmedName) {
      setError(t('validation.fieldRequired', { field: t('admin.users.role.nameLabel') }))
      return
    }
    if (!discountValid) {
      setError(t('admin.users.role.discountInvalid'))
      return
    }
    if (discountChanged && discountNumber > actorDiscountLimitPct) {
      setError(t('admin.users.role.discountAboveOwn', { limit: actorDiscountLimitPct }))
      return
    }
    if (permissions.size === 0) {
      setError(t('admin.users.role.permissionsRequired'))
      return
    }
    if (role.memberCount > 0) {
      setConfirmOpen(true)
      return
    }
    saveMutation.mutate()
  }

  const hint = isOwner
    ? t('admin.users.role.ownerLockedHint')
    : !canEditRoles
      ? t('admin.users.role.readOnlyHint')
      : isOwnRole
        ? t('admin.users.role.selfEditHint')
        : null

  return (
    <Card padding="admin" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-3">
        <h3 className="text-h3 font-semibold text-ink">{role.name}</h3>
        <span className="rounded-md border border-line bg-surface-subtle px-2.5 py-0.5 text-label-sm font-medium text-ink-soft">
          {t('admin.users.role.memberCount', { count: role.memberCount })}
        </span>
      </div>

      {hint ? (
        <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{hint}</span>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label={t('admin.users.role.nameLabel')} htmlFor={nameId}>
          <Input
            id={nameId}
            controlSize="md"
            value={name}
            maxLength={60}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t('admin.users.role.discountLabel')} htmlFor={discountId}>
          <Input
            id={discountId}
            type="number"
            min={0}
            max={100}
            controlSize="md"
            className="text-right tabular-nums"
            value={discount}
            disabled={locked}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-ink">{t('admin.users.role.permissionsHeading')}</p>
        {!locked && hasUnheldPermission ? (
          <p className="text-body-sm text-ink-soft">{t('admin.users.role.lockedPermissionHint')}</p>
        ) : null}
        <RolePermissionChecklist
          selected={permissions}
          onToggle={togglePermission}
          isDisabled={(code) => locked || !actorPermissions.has(code)}
        />
      </div>

      <section className="flex flex-col gap-2 border-t border-line-subtle pt-4">
        <h4 className="text-label font-semibold text-ink">
          {t('admin.users.role.membersHeading')}
        </h4>
        {canViewMembers && members.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <li
                key={m.appUserId}
                className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2.5 py-1 text-body-sm text-ink"
              >
                {m.displayName}
              </li>
            ))}
          </ul>
        ) : null}
        {role.memberCount === 0 ? (
          <p className="text-body-sm text-ink-soft">{t('admin.users.role.membersEmpty')}</p>
        ) : null}
      </section>

      {canEditRoles ? (
        <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
          {!canDuplicate ? (
            <p className="text-body-sm text-ink-soft">{t('admin.users.role.duplicateBlocked')}</p>
          ) : null}
          {!role.isSystem && role.memberCount > 0 ? (
            <p className="text-body-sm text-ink-soft">
              {t('admin.users.role.deleteInUse', { members: role.memberCount })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={locked || !dirty}
              loading={saveMutation.isPending && !confirmOpen}
              onClick={requestSave}
            >
              {t('admin.users.role.save')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<Copy className="size-4" aria-hidden="true" />}
              disabled={!canDuplicate}
              onClick={() => onDuplicate(role)}
            >
              {t('admin.users.role.duplicate')}
            </Button>
            {!role.isSystem ? (
              <Button
                variant="danger-outline"
                size="md"
                className="sm:ml-auto"
                leadingIcon={<Trash2 className="size-4" aria-hidden="true" />}
                disabled={role.memberCount > 0}
                onClick={() => setDeleteOpen(true)}
              >
                {t('admin.users.role.deleteAction')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('admin.users.role.confirmSaveTitle', { name: role.name })}
        description={t('admin.users.role.confirmSaveDesc', { members: role.memberCount })}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {t('admin.users.role.confirmSaveAction')}
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-ink">
          {nameChanged ? (
            <li>{t('admin.users.role.changeName', { from: role.name, to: trimmedName })}</li>
          ) : null}
          {discountChanged ? (
            <li>
              {t('admin.users.role.changeDiscount', {
                from: role.discountLimitPct,
                to: discountNumber,
              })}
            </li>
          ) : null}
          {diff.added.length > 0 ? (
            <li>
              {t('admin.users.role.changeAdded', {
                list: diff.added.map((code) => t(`permission.${code}`)).join(', '),
              })}
            </li>
          ) : null}
          {diff.removed.length > 0 ? (
            <li>
              {t('admin.users.role.changeRemoved', {
                list: diff.removed.map((code) => t(`permission.${code}`)).join(', '),
              })}
            </li>
          ) : null}
        </ul>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('admin.users.role.deleteTitle', { name: role.name })}
        description={t('admin.users.role.deleteDesc')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {t('admin.users.role.deleteAction')}
            </Button>
          </>
        }
      >
        <div />
      </Dialog>
    </Card>
  )
}
