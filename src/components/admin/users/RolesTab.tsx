import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Card,
  Checkbox,
  CircleAlert,
  Info,
  Input,
  Skeleton,
  useToast,
} from '~/components/ui'
import { updateRoleFn } from '~/functions/identity/role.fn'
import {
  PERMISSION_CODES,
  type PermissionCode,
  type RoleMatrixView,
} from '~/modules/identity/shared'
import { rolesQueryOptions } from '~/queries/identity.queries'
import { qk } from '~/queries/keys'

export interface RolesTabProps {
  tenantSlug: string
  canEditRoles: boolean
}

interface RoleDraft {
  discountLimitPct: string
  permissions: Set<PermissionCode>
}

export function RolesTab({ tenantSlug, canEditRoles }: RolesTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: roles = [], isLoading } = useQuery(rolesQueryOptions(tenantSlug))

  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null)

  function getDraft(role: RoleMatrixView): RoleDraft {
    return (
      drafts[role.id] ?? {
        discountLimitPct: String(role.discountLimitPct),
        permissions: new Set(role.permissions),
      }
    )
  }

  function updateDiscount(role: RoleMatrixView, value: string) {
    const current = getDraft(role)
    setDrafts((prev) => ({
      ...prev,
      [role.id]: {
        ...current,
        discountLimitPct: value,
      },
    }))
  }

  function togglePerm(role: RoleMatrixView, code: PermissionCode, checked: boolean) {
    if (role.code === 'OWNER' || !canEditRoles) return
    const current = getDraft(role)
    const nextPerms = new Set(current.permissions)
    if (checked) {
      nextPerms.add(code)
    } else {
      nextPerms.delete(code)
    }
    setDrafts((prev) => ({
      ...prev,
      [role.id]: {
        ...current,
        permissions: nextPerms,
      },
    }))
  }

  const saveMutation = useMutation({
    retry: 0,
    mutationFn: async (role: RoleMatrixView) => {
      setSavingRoleId(role.id)
      setErrorMsg(null)
      const draft = getDraft(role)
      const numericDiscount = Number(draft.discountLimitPct)
      const discountLimitPct = Number.isFinite(numericDiscount)
        ? Math.min(100, Math.max(0, numericDiscount))
        : role.discountLimitPct
      return updateRoleFn({
        data: {
          roleId: role.id,
          discountLimitPct,
          permissions: role.code === 'OWNER' ? undefined : Array.from(draft.permissions),
        },
      })
    },
    onSuccess: (res, role) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[role.id]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.users.role.saved') })
    },
    onError: () => {
      setErrorMsg(t('admin.users.failed'))
    },
    onSettled: () => {
      setSavingRoleId(null)
    },
  })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={idx} className="h-11 w-full rounded-control" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-control border border-info-line bg-info-soft p-3 text-body-sm text-info-ink">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t('admin.users.role.ownerLockedHint')}</span>
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-label-sm font-semibold text-ink-soft">
              <th scope="col" className="sticky left-0 z-sticky bg-surface-subtle px-4 py-3">
                {t('admin.users.role.colPermissions')}
              </th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className="px-3 py-3 text-center whitespace-nowrap">
                  {t(`role.${r.code}`, { defaultValue: r.name })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            <tr className="bg-surface">
              <th
                scope="row"
                className="sticky left-0 bg-surface px-4 py-3 text-body font-medium text-ink whitespace-nowrap"
              >
                {t('admin.users.role.discountLabel')}
              </th>
              {roles.map((r) => {
                const draft = getDraft(r)
                return (
                  <td key={r.id} className="px-3 py-2 text-center">
                    <div className="mx-auto flex max-w-28 flex-col items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        controlSize="md"
                        className="text-right tabular-nums"
                        disabled={!canEditRoles}
                        value={draft.discountLimitPct}
                        aria-label={`${t(`role.${r.code}`, { defaultValue: r.name })} ${t('admin.users.role.discountLabel')}`}
                        onChange={(e) => updateDiscount(r, e.target.value)}
                      />
                      {canEditRoles ? (
                        <Button
                          variant="secondary"
                          size="md"
                          loading={savingRoleId === r.id && saveMutation.isPending}
                          onClick={() => saveMutation.mutate(r)}
                        >
                          {t('common.save')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                )
              })}
            </tr>
            {PERMISSION_CODES.map((code) => (
              <tr key={code} className="hover:bg-surface-hover">
                <th
                  scope="row"
                  className="sticky left-0 bg-surface px-4 py-2 text-body-sm font-normal text-ink"
                >
                  {t(`permission.${code}`)}
                </th>
                {roles.map((r) => {
                  const draft = getDraft(r)
                  const checked = draft.permissions.has(code)
                  const locked = r.code === 'OWNER' || !canEditRoles
                  return (
                    <td key={r.id} className="px-3 py-2 text-center">
                      <Checkbox
                        className="justify-center"
                        hideLabel
                        label={`${t(`role.${r.code}`, { defaultValue: r.name })}: ${t(`permission.${code}`)}`}
                        checked={checked}
                        disabled={locked}
                        onCheckedChange={(next) => togglePerm(r, code, next)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4 md:hidden">
        {roles.map((r) => {
          const draft = getDraft(r)
          const locked = r.code === 'OWNER' || !canEditRoles
          return (
            <Card key={r.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-h3 font-semibold text-ink">
                  {t(`role.${r.code}`, { defaultValue: r.name })}
                </h3>
                {canEditRoles ? (
                  <Button
                    variant="secondary"
                    size="md"
                    loading={savingRoleId === r.id && saveMutation.isPending}
                    onClick={() => saveMutation.mutate(r)}
                  >
                    {t('common.save')}
                  </Button>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-ink-soft">
                  {t('admin.users.role.discountLabel')}
                </span>
                <div className="w-28">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    controlSize="md"
                    className="text-right tabular-nums"
                    disabled={!canEditRoles}
                    value={draft.discountLimitPct}
                    aria-label={`${t(`role.${r.code}`, { defaultValue: r.name })} ${t('admin.users.role.discountLabel')}`}
                    onChange={(e) => updateDiscount(r, e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 border-t border-line-subtle pt-2">
                {PERMISSION_CODES.map((code) => (
                  <Checkbox
                    key={code}
                    label={t(`permission.${code}`)}
                    checked={draft.permissions.has(code)}
                    disabled={locked}
                    onCheckedChange={(next) => togglePerm(r, code, next)}
                  />
                ))}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
