import { useMutation } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Checkbox,
  CircleAlert,
  Dialog,
  Field,
  Select,
  Switch,
} from '~/components/ui'
import { changeMemberRoleAndOutletsFn } from '~/functions/identity/members-admin.fn'
import { OWNER_ROLE_CODE, type MemberDirectoryView } from '~/modules/identity/shared'

type RoleList = Awaited<ReturnType<typeof import('~/functions/identity/role.fn').listRolesWithPermissionsFn>>
type OutletList = Awaited<ReturnType<typeof import('~/functions/identity/org.fn').listOutletsFn>>

export interface EditMemberAccessDialogProps {
  member: MemberDirectoryView
  roles: RoleList
  outlets: OutletList
  canTenantWide: boolean
  isRoleAssignable?: (role: RoleList[number]) => boolean
  onClose: () => void
  onSaved: () => void
}

export function EditMemberAccessDialog({
  member,
  roles,
  outlets,
  canTenantWide,
  isRoleAssignable,
  onClose,
  onSaved,
}: EditMemberAccessDialogProps) {
  const { t } = useTranslation()
  const formIdPrefix = useId()
  const editWideRoleId = `${formIdPrefix}-edit-wide-role`
  const canAssign = (r: RoleList[number]) => !isRoleAssignable || isRoleAssignable(r)
  const defaultRoleId = (roles.find(canAssign) ?? roles[0])?.id ?? ''

  const wide = member.assignments.find((a) => a.outletId === null)
  const startsWide = Boolean(wide) && canTenantWide
  const [accessAllOutlets, setAccessAllOutlets] = useState(startsWide)
  const [accessTenantWideRoleId, setAccessTenantWideRoleId] = useState(
    startsWide ? wide!.roleId : defaultRoleId,
  )
  const [accessOutletRoles, setAccessOutletRoles] = useState<Record<string, string>>(() => {
    if (startsWide) return {}
    const map: Record<string, string> = {}
    for (const a of member.assignments) {
      if (a.outletId) map[a.outletId] = a.roleId
    }
    return map
  })
  const [accessOutletsError, setAccessOutletsError] = useState<string | null>(null)
  const [accessError, setAccessError] = useState<string | null>(null)

  const accessMutation = useMutation({
    retry: 0,
    mutationFn: async () => {
      const assignments = accessAllOutlets
        ? [{ outletId: null, roleId: accessTenantWideRoleId }]
        : Object.entries(accessOutletRoles).map(([outletId, roleId]) => ({ outletId, roleId }))
      return changeMemberRoleAndOutletsFn({
        data: {
          appUserId: member.appUserId,
          assignments,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setAccessError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      onSaved()
    },
    onError: () => {
      setAccessError(t('admin.users.failed'))
    },
  })

  function toggleEditOutlet(outletId: string, checked: boolean) {
    setAccessOutletRoles((prev) => {
      const next = { ...prev }
      if (checked) {
        next[outletId] = next[outletId] ?? defaultRoleId
        setAccessOutletsError(null)
      } else {
        delete next[outletId]
      }
      return next
    })
  }

  function handleEditAccessSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAccessError(null)
    setAccessOutletsError(null)
    if (!accessAllOutlets && Object.keys(accessOutletRoles).length === 0) {
      setAccessOutletsError(t('admin.users.editAccess.needOneOutlet'))
      return
    }
    accessMutation.mutate()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('admin.users.editAccess.title', { name: member.displayName })}
      size="md"
    >
      <form onSubmit={handleEditAccessSubmit} className="flex flex-col gap-4">
        {accessError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{accessError}</span>
          </div>
        ) : null}

        {canTenantWide ? (
          <div className="rounded-control border border-line bg-surface-subtle px-3 py-1">
            <Switch
              label={t('admin.users.editAccess.scopeModeAll')}
              checked={accessAllOutlets}
              onCheckedChange={(checked) => {
                setAccessAllOutlets(checked)
                if (checked) setAccessOutletsError(null)
              }}
            />
          </div>
        ) : null}

        {accessAllOutlets ? (
          <Field label={t('admin.users.editAccess.roleLabel')} htmlFor={editWideRoleId}>
            <Select
              id={editWideRoleId}
              value={accessTenantWideRoleId}
              onValueChange={setAccessTenantWideRoleId}
              options={roles
                .filter((r) => r.id === accessTenantWideRoleId || canAssign(r))
                .map((r) => ({ value: r.id, label: r.name }))}
              size="md"
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-label font-medium text-ink">
              {t('admin.users.editAccess.outletsLabel')}
            </p>
            {outlets.map((o) => {
              const assignedRoleId = accessOutletRoles[o.id]
              const checked = Boolean(assignedRoleId)
              return (
                <div
                  key={o.id}
                  className={
                    accessOutletsError
                      ? 'flex flex-wrap items-center justify-between gap-3 rounded-control border-2 border-danger-solid p-3'
                      : 'flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-3'
                  }
                >
                  <Checkbox
                    label={`${o.code} · ${o.name}`}
                    checked={checked}
                    onCheckedChange={(next) => toggleEditOutlet(o.id, next)}
                  />
                  {checked ? (
                    <div className="w-44">
                      <Select
                        value={assignedRoleId}
                        onValueChange={(nextRole) =>
                          setAccessOutletRoles((prev) => ({ ...prev, [o.id]: nextRole }))
                        }
                        options={roles
                          .filter((r) => canTenantWide || r.code !== OWNER_ROLE_CODE)
                          .filter((r) => r.id === assignedRoleId || canAssign(r))
                          .map((r) => ({ value: r.id, label: r.name }))}
                        ariaLabel={t('admin.users.editAccess.roleForOutlet', { outlet: o.code })}
                        size="md"
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
            {accessOutletsError ? (
              <p className="flex items-center gap-1.5 text-body-sm text-danger-ink">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                <span>{accessOutletsError}</span>
              </p>
            ) : null}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" size="md" loading={accessMutation.isPending}>
            {t('admin.users.editAccess.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
