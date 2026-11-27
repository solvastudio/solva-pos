import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, CircleAlert, Copy, Field, Info, Input, Trash2 } from '~/components/ui'
import {
  OWNER_ROLE_CODE,
  ROLE_DISCOUNT_MAX,
  ROLE_DISCOUNT_MIN,
  ROLE_NAME_MAX_LENGTH,
  roleExceedsActor,
  validateRoleDraft,
  type RoleMatrixView,
} from '~/modules/identity/shared'
import { RoleDeleteDialog } from './RoleDeleteDialog'
import { RoleMembersSection } from './RoleMembersSection'
import { RolePermissionChecklist } from './RolePermissionChecklist'
import { RoleSaveConfirmDialog } from './RoleSaveConfirmDialog'
import { roleDraftIssueMessage } from './roleDraftMessage'
import { useRoleActor } from './role-actor-context'
import { useRoleChangeMutations } from './useRoleChangeMutations'
import { useRoleDraft } from './useRoleDraft'

export interface RoleDetailPanelProps {
  tenantSlug: string
  role: RoleMatrixView
  onDuplicate: (role: RoleMatrixView) => void
  onDeleted: () => void
}

type LockHintKey =
  | 'admin.users.role.ownerLockedHint'
  | 'admin.users.role.readOnlyHint'
  | 'admin.users.role.selfEditHint'

/** i18n key of the hint explaining why a role cannot be edited, or null when it can. */
function lockHintKey(role: RoleMatrixView, canEditRoles: boolean): LockHintKey | null {
  if (role.code === OWNER_ROLE_CODE) {
    return 'admin.users.role.ownerLockedHint'
  }
  if (!canEditRoles) {
    return 'admin.users.role.readOnlyHint'
  }
  if (role.heldByActor) {
    return 'admin.users.role.selfEditHint'
  }
  return null
}

export function RoleDetailPanel({ tenantSlug, role, onDuplicate, onDeleted }: RoleDetailPanelProps) {
  const { t } = useTranslation()
  const actor = useRoleActor()
  const formIdPrefix = useId()
  const nameId = `${formIdPrefix}-role-name`
  const discountId = `${formIdPrefix}-role-discount`

  const draft = useRoleDraft(role)
  const { error, setError, save, remove } = useRoleChangeMutations({
    tenantSlug,
    role,
    changes: draft.changes,
    onDeleted,
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const locked =
    !actor.canEditRoles || role.code === OWNER_ROLE_CODE || role.heldByActor
  const exceedsActor = roleExceedsActor(
    { permissions: role.permissions, discountLimitPct: role.discountLimitPct },
    { permissions: actor.permissions, discountLimitPct: actor.discountLimitPct },
  )
  const canDuplicate = actor.canEditRoles && !exceedsActor
  const hasUnheldPermission = role.permissions.some((code) => !actor.permissions.has(code))
  const hintKey = lockHintKey(role, actor.canEditRoles)

  function submitSave() {
    save.mutate(undefined, { onSettled: () => setConfirmOpen(false) })
  }

  function requestSave() {
    setError(null)
    const issues = validateRoleDraft(
      { name: draft.name, discountInput: draft.discount, permissionCount: draft.permissions.size },
      {
        actorDiscountLimitPct: actor.discountLimitPct,
        enforceActorLimit: draft.discountChanged,
        checkDiscount: true,
        checkPermissions: true,
      },
    )
    const [firstIssue] = issues
    if (firstIssue) {
      setError(roleDraftIssueMessage(t, firstIssue))
      return
    }
    if (role.memberCount > 0) {
      setConfirmOpen(true)
      return
    }
    submitSave()
  }

  return (
    <Card padding="admin" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-3">
        <h3 className="text-h3 font-semibold text-ink">{role.name}</h3>
        <span className="rounded-md border border-line bg-surface-subtle px-2.5 py-0.5 text-label-sm font-medium text-ink-soft">
          {t('admin.users.role.memberCount', { count: role.memberCount })}
        </span>
      </div>

      {hintKey ? (
        <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t(hintKey)}</span>
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
            value={draft.name}
            maxLength={ROLE_NAME_MAX_LENGTH}
            disabled={locked}
            onChange={(e) => draft.setName(e.target.value)}
          />
        </Field>

        <Field label={t('admin.users.role.discountLabel')} htmlFor={discountId}>
          <Input
            id={discountId}
            type="number"
            min={ROLE_DISCOUNT_MIN}
            max={ROLE_DISCOUNT_MAX}
            controlSize="md"
            className="text-right tabular-nums"
            value={draft.discount}
            disabled={locked}
            onChange={(e) => draft.setDiscount(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-ink">{t('admin.users.role.permissionsHeading')}</p>
        {!locked && hasUnheldPermission ? (
          <p className="text-body-sm text-ink-soft">{t('admin.users.role.lockedPermissionHint')}</p>
        ) : null}
        <RolePermissionChecklist
          selected={draft.permissions}
          onToggle={draft.togglePermission}
          isDisabled={(code) => locked || !actor.permissions.has(code)}
        />
      </div>

      <RoleMembersSection tenantSlug={tenantSlug} roleId={role.id} memberCount={role.memberCount} />

      {actor.canEditRoles ? (
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
              disabled={locked || !draft.dirty}
              loading={save.isPending && !confirmOpen}
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

      <RoleSaveConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        role={role}
        draft={draft}
        loading={save.isPending}
        onConfirm={submitSave}
      />

      <RoleDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        roleName={role.name}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSettled: () => setDeleteOpen(false) })}
      />
    </Card>
  )
}
