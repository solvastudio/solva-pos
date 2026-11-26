import { useMutation } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Checkbox,
  CircleAlert,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
} from '~/components/ui'
import { createInviteFn } from '~/functions/identity/members.fn'

type RoleList = Awaited<ReturnType<typeof import('~/functions/identity/role.fn').listRolesWithPermissionsFn>>
type OutletList = Awaited<ReturnType<typeof import('~/functions/identity/org.fn').listOutletsFn>>

export interface InviteMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: RoleList
  outlets: OutletList
  canTenantWide: boolean
  onCreated: (res: { code: string; expiresAt: string }) => void
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  roles,
  outlets,
  canTenantWide,
  onCreated,
}: InviteMemberDialogProps) {
  const { t } = useTranslation()
  const formIdPrefix = useId()
  const invEmailId = `${formIdPrefix}-inv-email`
  const invNameId = `${formIdPrefix}-inv-name`
  const invRoleSelectId = `${formIdPrefix}-inv-role`

  const [invEmail, setInvEmail] = useState('')
  const [invDisplayName, setInvDisplayName] = useState('')
  const [invRoleId, setInvRoleId] = useState(roles[0]?.id ?? '')
  const [invAllOutlets, setInvAllOutlets] = useState(false)
  const [invOutletIds, setInvOutletIds] = useState<string[]>(outlets[0]?.id ? [outlets[0].id] : [])
  const [inviteFieldErrors, setInviteFieldErrors] = useState<Record<string, string>>({})
  const [inviteError, setInviteError] = useState<string | null>(null)

  const inviteMutation = useMutation({
    retry: 0,
    mutationFn: () =>
      createInviteFn({
        data: {
          email: invEmail.trim(),
          displayName: invDisplayName.trim(),
          roleId: invRoleId,
          outletIds: invAllOutlets ? null : invOutletIds,
        },
      }),
    onSuccess: (res) => {
      onCreated(res)
    },
    onError: () => {
      setInviteError(t('members.add.failed'))
    },
  })

  function toggleInviteOutlet(outletId: string, checked: boolean) {
    setInvOutletIds((prev) => {
      const next = checked ? Array.from(new Set([...prev, outletId])) : prev.filter((id) => id !== outletId)
      if (next.length > 0) {
        setInviteFieldErrors((errs) => {
          if (!errs.outlets) return errs
          const copy = { ...errs }
          delete copy.outlets
          return copy
        })
      }
      return next
    })
  }

  function clearInviteFieldError(field: string) {
    setInviteFieldErrors((prev) => {
      if (!prev[field]) return prev
      const copy = { ...prev }
      delete copy[field]
      return copy
    })
  }

  function handleInviteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setInviteError(null)
    const nextErrors: Record<string, string> = {}
    const cleanEmail = invEmail.trim()
    if (!cleanEmail) {
      nextErrors.email = t('validation.fieldRequired', {
        field: t('admin.users.invite.emailLabel'),
      })
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      nextErrors.email = t('validation.emailInvalid')
    }
    if (!invDisplayName.trim()) {
      nextErrors.displayName = t('validation.fieldRequired', {
        field: t('admin.users.invite.displayNameLabel'),
      })
    }
    if (!invRoleId) {
      nextErrors.roleId = t('validation.selectRequired', {
        field: t('admin.users.invite.roleLabel'),
      })
    }
    if (!invAllOutlets && invOutletIds.length === 0) {
      nextErrors.outlets = t('admin.users.editAccess.needOneOutlet')
    }
    if (Object.keys(nextErrors).length > 0) {
      setInviteFieldErrors(nextErrors)
      return
    }
    setInviteFieldErrors({})
    inviteMutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.users.invite.title')}
      size="md"
    >
      <form onSubmit={handleInviteSubmit} className="flex flex-col gap-4" noValidate>
        {inviteError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{inviteError}</span>
          </div>
        ) : null}

        <Field
          label={t('admin.users.invite.emailLabel')}
          htmlFor={invEmailId}
          error={inviteFieldErrors.email}
        >
          <Input
            id={invEmailId}
            controlSize="md"
            type="email"
            value={invEmail}
            invalid={Boolean(inviteFieldErrors.email)}
            onChange={(e) => {
              setInvEmail(e.target.value)
              clearInviteFieldError('email')
            }}
          />
        </Field>

        <Field
          label={t('admin.users.invite.displayNameLabel')}
          htmlFor={invNameId}
          error={inviteFieldErrors.displayName}
        >
          <Input
            id={invNameId}
            controlSize="md"
            value={invDisplayName}
            invalid={Boolean(inviteFieldErrors.displayName)}
            onChange={(e) => {
              setInvDisplayName(e.target.value)
              clearInviteFieldError('displayName')
            }}
            maxLength={80}
          />
        </Field>

        <Field
          label={t('admin.users.invite.roleLabel')}
          htmlFor={invRoleSelectId}
          error={inviteFieldErrors.roleId}
        >
          <Select
            id={invRoleSelectId}
            value={invRoleId}
            onValueChange={(v) => {
              setInvRoleId(v)
              clearInviteFieldError('roleId')
            }}
            invalid={Boolean(inviteFieldErrors.roleId)}
            options={roles.map((r) => ({
              value: r.id,
              label: t(`role.${r.code}`, { defaultValue: r.name }),
            }))}
            placeholder={t('admin.users.invite.rolePlaceholder')}
            size="md"
          />
        </Field>

        {canTenantWide ? (
          <div className="rounded-control border border-line bg-surface-subtle px-3 py-1">
            <Switch
              label={t('admin.users.invite.allOutletsLabel')}
              checked={invAllOutlets}
              onCheckedChange={(checked) => {
                setInvAllOutlets(checked)
                if (checked) clearInviteFieldError('outlets')
              }}
            />
          </div>
        ) : null}

        {!invAllOutlets ? (
          <div className="flex flex-col gap-2">
            <p className="text-label font-medium text-ink">
              {t('admin.users.invite.outletsLabel')}
            </p>
            <div
              className={
                inviteFieldErrors.outlets
                  ? 'flex flex-col gap-1 rounded-control border-2 border-danger-solid p-2'
                  : 'flex flex-col gap-1 rounded-control border border-line p-2'
              }
            >
              {outlets.map((o) => (
                <Checkbox
                  key={o.id}
                  label={`${o.code} · ${o.name}`}
                  checked={invOutletIds.includes(o.id)}
                  onCheckedChange={(checked) => toggleInviteOutlet(o.id, checked)}
                />
              ))}
            </div>
            {inviteFieldErrors.outlets ? (
              <p className="flex items-center gap-1.5 text-body-sm text-danger-ink">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                <span>{inviteFieldErrors.outlets}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" size="md" loading={inviteMutation.isPending}>
            {t('admin.users.invite.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
