import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Checkbox,
  Chip,
  CircleAlert,
  DataTable,
  Dialog,
  Field,
  Input,
  KeyRound,
  Lock,
  Plus,
  Search,
  Select,
  Switch,
  Trash2,
  Users,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import {
  cancelInviteFn,
  createInviteFn,
  issueResetCodeFn,
  reissueInviteFn,
  removeMemberFn,
} from '~/functions/identity/members.fn'
import { changeMemberRoleAndOutletsFn } from '~/functions/identity/members-admin.fn'
import { formatDateTime } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import type { PendingInviteItem } from '~/modules/identity/public'
import type { MemberDirectoryView, PermissionCode } from '~/modules/identity/shared'
import {
  membersQueryOptions,
  outletsQueryOptions,
  pendingInvitesQueryOptions,
  rolesQueryOptions,
} from '~/queries/identity.queries'
import { qk } from '~/queries/keys'
import { OneTimeCodeDialog } from './OneTimeCodeDialog'
import { PinDialog } from './PinDialog'

const FILTER_ALL = '__ALL__'
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export interface UsersTabProps {
  tenantSlug: string
  tenantName: string
  permissions: readonly PermissionCode[]
  actorOutletIds: readonly string[] | null
}

function addSevenDaysIso(expiresAtIso: string): string {
  const ms = Date.parse(expiresAtIso)
  return Number.isFinite(ms) ? new Date(ms + SEVEN_DAYS_MS).toISOString() : expiresAtIso
}

export function UsersTab({
  tenantSlug,
  tenantName,
  permissions,
  actorOutletIds,
}: UsersTabProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const formIdPrefix = useId()
  const permSet = useMemo(() => new Set(permissions), [permissions])
  const canInvite = permSet.has('user.invite')
  const canReset = permSet.has('user.reset_password')
  const canRemove = permSet.has('user.remove')
  const canTenantWide = actorOutletIds === null

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState(FILTER_ALL)
  const [outletFilter, setOutletFilter] = useState(FILTER_ALL)

  const filterParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      roleId: roleFilter === FILTER_ALL ? undefined : roleFilter,
      outletId: outletFilter === FILTER_ALL ? undefined : outletFilter,
    }),
    [outletFilter, roleFilter, search],
  )

  const { data: members = [], isLoading: membersLoading } = useQuery(
    membersQueryOptions(tenantSlug, filterParams),
  )
  const { data: roles = [] } = useQuery(rolesQueryOptions(tenantSlug))
  const { data: outlets = [] } = useQuery(outletsQueryOptions(tenantSlug))
  const { data: pendingInvites = [] } = useQuery({
    ...pendingInvitesQueryOptions(tenantSlug),
    enabled: canInvite,
  })

  const roleCodeById = useMemo(
    () => new Map(roles.map((r) => [r.id, r.code])),
    [roles],
  )

  const [codeModal, setCodeModal] = useState<{
    kind: 'invite' | 'reset'
    title: string
    code: string
    url: string
    expiryNotice: string
  } | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [invEmail, setInvEmail] = useState('')
  const [invDisplayName, setInvDisplayName] = useState('')
  const [invRoleId, setInvRoleId] = useState('')
  const [invAllOutlets, setInvAllOutlets] = useState(false)
  const [invOutletIds, setInvOutletIds] = useState<string[]>([])
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [editingMember, setEditingMember] = useState<MemberDirectoryView | null>(null)
  const [accessAllOutlets, setAccessAllOutlets] = useState(false)
  const [accessTenantWideRoleId, setAccessTenantWideRoleId] = useState('')
  const [accessOutletRoles, setAccessOutletRoles] = useState<Record<string, string>>({})
  const [accessError, setAccessError] = useState<string | null>(null)

  const [resetTarget, setResetTarget] = useState<MemberDirectoryView | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

  const [removeTarget, setRemoveTarget] = useState<MemberDirectoryView | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [pinTarget, setPinTarget] = useState<MemberDirectoryView | null>(null)

  const originPrefix = typeof window !== 'undefined' ? window.location.origin : ''
  const localeForDate = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  function invalidateMemberQueries() {
    void queryClient.invalidateQueries({ queryKey: ['identity', tenantSlug, 'members'] })
    void queryClient.invalidateQueries({ queryKey: qk.pendingInvites(tenantSlug) })
  }

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
      invalidateMemberQueries()
      setInviteOpen(false)
      setCodeModal({
        kind: 'invite',
        title: t('admin.users.invite.codeTitle'),
        code: res.code,
        url: `${originPrefix}${tenantHref(tenantSlug, '/join')}`,
        expiryNotice: t('admin.users.invite.expiryNotice', {
          expiry: formatDateTime(res.expiresAt, 'Asia/Jakarta', localeForDate),
        }),
      })
    },
    onError: () => {
      setInviteError(t('members.add.failed'))
    },
  })

  const reissueMutation = useMutation({
    retry: 0,
    mutationFn: (appUserId: string) => reissueInviteFn({ data: { appUserId } }),
    onSuccess: (res) => {
      invalidateMemberQueries()
      setCodeModal({
        kind: 'invite',
        title: t('admin.users.pending.reissuedTitle'),
        code: res.code,
        url: `${originPrefix}${tenantHref(tenantSlug, '/join')}`,
        expiryNotice: t('admin.users.invite.expiryNotice', {
          expiry: formatDateTime(res.expiresAt, 'Asia/Jakarta', localeForDate),
        }),
      })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.users.failed') })
    },
  })

  const cancelInviteMutation = useMutation({
    retry: 0,
    mutationFn: (appUserId: string) => cancelInviteFn({ data: { appUserId } }),
    onSuccess: () => {
      invalidateMemberQueries()
      toast.show({ tone: 'success', message: t('admin.users.saved') })
    },
    onError: () => {
      toast.show({ tone: 'danger', message: t('admin.users.failed') })
    },
  })

  const accessMutation = useMutation({
    retry: 0,
    mutationFn: async () => {
      if (!editingMember) return { ok: false as const, errorKey: 'admin.users.failed' }
      const assignments = accessAllOutlets
        ? [{ outletId: null, roleId: accessTenantWideRoleId }]
        : Object.entries(accessOutletRoles).map(([outletId, roleId]) => ({ outletId, roleId }))
      return changeMemberRoleAndOutletsFn({
        data: {
          appUserId: editingMember.appUserId,
          assignments,
        },
      })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setAccessError(t(res.errorKey, { defaultValue: t('admin.users.failed') }))
        return
      }
      invalidateMemberQueries()
      toast.show({ tone: 'success', message: t('admin.users.saved') })
      setEditingMember(null)
    },
    onError: () => {
      setAccessError(t('admin.users.failed'))
    },
  })

  const resetMutation = useMutation({
    retry: 0,
    mutationFn: (appUserId: string) => issueResetCodeFn({ data: { appUserId } }),
    onSuccess: (res) => {
      setResetTarget(null)
      setCodeModal({
        kind: 'reset',
        title: t('admin.users.reset.resultTitle'),
        code: res.code,
        url: `${originPrefix}${tenantHref(tenantSlug, '/reset')}`,
        expiryNotice: t('admin.users.reset.expiryNotice', {
          expiry: formatDateTime(res.expiresAt, 'Asia/Jakarta', localeForDate),
        }),
      })
    },
    onError: () => {
      setResetError(t('admin.users.reset.denied'))
    },
  })

  const removeMutation = useMutation({
    retry: 0,
    mutationFn: (appUserId: string) => removeMemberFn({ data: { appUserId } }),
    onSuccess: () => {
      invalidateMemberQueries()
      setRemoveTarget(null)
      toast.show({ tone: 'success', message: t('admin.users.saved') })
    },
    onError: () => {
      setRemoveError(t('members.remove.lastOwner'))
    },
  })

  function openInviteDialog() {
    setInvEmail('')
    setInvDisplayName('')
    setInvRoleId(roles[0]?.id ?? '')
    setInvAllOutlets(false)
    setInvOutletIds(outlets[0]?.id ? [outlets[0].id] : [])
    setInviteError(null)
    setInviteOpen(true)
  }

  function openEditAccessDialog(member: MemberDirectoryView) {
    setEditingMember(member)
    setAccessError(null)
    const wide = member.assignments.find((a) => a.outletId === null)
    if (wide && canTenantWide) {
      setAccessAllOutlets(true)
      setAccessTenantWideRoleId(wide.roleId)
      setAccessOutletRoles({})
    } else {
      setAccessAllOutlets(false)
      setAccessTenantWideRoleId(roles[0]?.id ?? '')
      const map: Record<string, string> = {}
      for (const a of member.assignments) {
        if (a.outletId) map[a.outletId] = a.roleId
      }
      setAccessOutletRoles(map)
    }
  }

  function toggleInviteOutlet(outletId: string, checked: boolean) {
    setInvOutletIds((prev) =>
      checked ? Array.from(new Set([...prev, outletId])) : prev.filter((id) => id !== outletId),
    )
  }

  function toggleEditOutlet(outletId: string, checked: boolean) {
    setAccessOutletRoles((prev) => {
      const next = { ...prev }
      if (checked) {
        next[outletId] = next[outletId] ?? roles[0]?.id ?? ''
      } else {
        delete next[outletId]
      }
      return next
    })
  }

  function handleInviteSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setInviteError(null)
    if (!invEmail.trim() || !invDisplayName.trim() || !invRoleId) {
      setInviteError(t('members.add.failed'))
      return
    }
    if (!invAllOutlets && invOutletIds.length === 0) {
      setInviteError(t('admin.users.editAccess.needOneOutlet'))
      return
    }
    inviteMutation.mutate()
  }

  function handleEditAccessSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAccessError(null)
    if (!accessAllOutlets && Object.keys(accessOutletRoles).length === 0) {
      setAccessError(t('admin.users.editAccess.needOneOutlet'))
      return
    }
    accessMutation.mutate()
  }

  const roleOptions = [
    { value: FILTER_ALL, label: t('admin.users.filterRoleAll') },
    ...roles.map((r) => ({ value: r.id, label: t(`role.${r.code}`, { defaultValue: r.name }) })),
  ]

  const outletFilterOptions = [
    { value: FILTER_ALL, label: t('admin.users.filterOutletAll') },
    ...outlets.map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` })),
  ]

  const memberColumns: readonly DataTableColumn<MemberDirectoryView>[] = [
    {
      id: 'name',
      header: t('admin.users.colName'),
      stickyFirst: true,
      sortValue: (row) => row.displayName,
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{row.displayName}</span>
          {row.membershipStatus === 'PENDING' ? (
            <Chip status="invite_pending" label={t('admin.users.pendingBadge')} size="sm" />
          ) : null}
        </div>
      ),
    },
    {
      id: 'email',
      header: t('admin.users.colEmail'),
      cell: (row) => row.email ?? t('common.dash'),
    },
    {
      id: 'roles',
      header: t('admin.users.colRoles'),
      cell: (row) => {
        const uniqueCodes = Array.from(new Set(row.assignments.map((a) => a.roleCode)))
        return (
          <div className="flex flex-wrap gap-1">
            {uniqueCodes.map((code) => (
              <span
                key={code}
                className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-label-sm font-medium text-ink"
              >
                {t(`role.${code}`, { defaultValue: code })}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      id: 'outlets',
      header: t('admin.users.colOutlets'),
      cell: (row) =>
        row.assignments.some((a) => a.outletId === null)
          ? t('admin.users.allOutlets')
          : row.assignments
              .map((a) => a.outletCode ?? a.outletName)
              .filter(Boolean)
              .join(', ') || t('common.dash'),
    },
    {
      id: 'pin',
      header: t('admin.users.colPin'),
      cell: (row) => {
        if (row.membershipStatus !== 'ACTIVE') return t('common.dash')
        if (row.pinStatus === 'locked') {
          return (
            <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-danger-ink">
              <Lock className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t('admin.users.pinStatus.locked')}</span>
            </span>
          )
        }
        return row.pinStatus === 'active'
          ? t('admin.users.pinStatus.active')
          : t('admin.users.pinStatus.unset')
      },
    },
    {
      id: 'action',
      header: t('admin.users.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {row.membershipStatus === 'PENDING' && canInvite ? (
            <Button
              variant="ghost"
              size="md"
              onClick={() => cancelInviteMutation.mutate(row.appUserId)}
            >
              {t('admin.users.actionCancelInvite')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="md" onClick={() => setPinTarget(row)}>
                {row.pinStatus === 'unset'
                  ? t('admin.users.actionSetPin')
                  : t('admin.users.actionResetPin')}
              </Button>
              <Button variant="ghost" size="md" onClick={() => openEditAccessDialog(row)}>
                {t('admin.users.actionChangeAccess')}
              </Button>
              {canReset ? (
                <Button
                  variant="ghost"
                  size="md"
                  leadingIcon={<KeyRound className="size-4" aria-hidden="true" />}
                  onClick={() => {
                    setResetError(null)
                    setResetTarget(row)
                  }}
                >
                  {t('admin.users.actionReset')}
                </Button>
              ) : null}
              {canRemove ? (
                <Button
                  variant="ghost"
                  size="md"
                  leadingIcon={<Trash2 className="size-4" aria-hidden="true" />}
                  onClick={() => {
                    setRemoveError(null)
                    setRemoveTarget(row)
                  }}
                >
                  {t('admin.users.actionRemove', { tenant: tenantName })}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ]

  const pendingColumns: readonly DataTableColumn<PendingInviteItem>[] = [
    {
      id: 'email',
      header: t('admin.users.pending.colEmail'),
      stickyFirst: true,
      cell: (row) => row.email,
    },
    {
      id: 'role',
      header: t('admin.users.pending.colRole'),
      cell: (row) => {
        const code = row.roleId ? roleCodeById.get(row.roleId) : undefined
        return code ? t(`role.${code}`, { defaultValue: code }) : t('common.dash')
      },
    },
    {
      id: 'expires',
      header: t('admin.users.pending.colExpires'),
      cell: (row) => (
        <div className="flex flex-col">
          <span>{formatDateTime(row.expiresAt, 'Asia/Jakarta', localeForDate)}</span>
          {row.status === 'EXPIRED' ? (
            <span className="text-caption text-ink-soft">
              {t('admin.users.pending.reissuableUntil', {
                date: formatDateTime(addSevenDaysIso(row.expiresAt), 'Asia/Jakarta', localeForDate),
              })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: t('admin.users.pending.colStatus'),
      cell: (row) => (
        <Chip
          status={row.status === 'PENDING' ? 'invite_pending' : 'invite_expired'}
          label={
            row.status === 'PENDING'
              ? t('admin.users.pending.statusWaiting')
              : t('admin.users.pending.statusExpired')
          }
          size="sm"
        />
      ),
    },
    {
      id: 'action',
      header: t('admin.users.pending.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            loading={reissueMutation.isPending}
            onClick={() => reissueMutation.mutate(row.id)}
          >
            {t('admin.users.pending.reissue')}
          </Button>
          {row.status === 'PENDING' ? (
            <Button
              variant="ghost"
              size="md"
              loading={cancelInviteMutation.isPending}
              onClick={() => cancelInviteMutation.mutate(row.id)}
            >
              {t('admin.users.pending.cancel')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  const invEmailId = `${formIdPrefix}-inv-email`
  const invNameId = `${formIdPrefix}-inv-name`
  const invRoleSelectId = `${formIdPrefix}-inv-role`
  const editWideRoleId = `${formIdPrefix}-edit-wide-role`

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-52 flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.users.searchPlaceholder')}
              aria-label={t('admin.users.searchPlaceholder')}
              controlSize="md"
              prefix={<Search className="size-4 text-ink-soft" aria-hidden="true" />}
            />
          </div>
          <div className="w-44">
            <Select
              value={roleFilter}
              onValueChange={setRoleFilter}
              options={roleOptions}
              ariaLabel={t('admin.users.filterRoleAll')}
              size="md"
            />
          </div>
          <div className="w-52">
            <Select
              value={outletFilter}
              onValueChange={setOutletFilter}
              options={outletFilterOptions}
              ariaLabel={t('admin.users.filterOutletAll')}
              size="md"
            />
          </div>
          {canInvite ? (
            <Button
              variant="primary"
              size="md"
              leadingIcon={<Plus className="size-4" aria-hidden="true" />}
              onClick={openInviteDialog}
            >
              {t('admin.users.inviteButton')}
            </Button>
          ) : null}
        </div>

        <DataTable
          caption={t('admin.users.tabUsers')}
          columns={memberColumns}
          rows={members}
          loading={membersLoading}
          getRowKey={(r) => r.appUserId}
          emptyIcon={<Users className="size-8" aria-hidden="true" />}
          emptyTitle={t('admin.users.emptyTitle')}
          emptyDescription={t('admin.users.emptyDesc')}
          mobileActions={(row) => (
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="md" onClick={() => openEditAccessDialog(row)}>
                {t('common.edit')}
              </Button>
              {canReset && row.membershipStatus === 'ACTIVE' ? (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setResetError(null)
                    setResetTarget(row)
                  }}
                >
                  {t('admin.users.actionReset')}
                </Button>
              ) : null}
            </div>
          )}
        />
      </section>

      {canInvite ? (
        <section aria-labelledby="pending-invites-heading" className="flex flex-col gap-3">
          <h2 id="pending-invites-heading" className="text-h2 font-semibold text-ink">
            {t('admin.users.pending.title', { count: pendingInvites.length })}
          </h2>
          <DataTable
            caption={t('admin.users.pending.title', { count: pendingInvites.length })}
            columns={pendingColumns}
            rows={pendingInvites}
            getRowKey={(r) => r.id}
            emptyTitle={t('admin.users.pending.empty')}
            mobileActions={(row) => (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => reissueMutation.mutate(row.id)}
                >
                  {t('admin.users.pending.reissue')}
                </Button>
                {row.status === 'PENDING' ? (
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => cancelInviteMutation.mutate(row.id)}
                  >
                    {t('admin.users.pending.cancel')}
                  </Button>
                ) : null}
              </div>
            )}
          />
        </section>
      ) : null}

      <Dialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t('admin.users.invite.title')}
        size="md"
      >
        <form onSubmit={handleInviteSubmit} className="flex flex-col gap-4">
          {inviteError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{inviteError}</span>
            </div>
          ) : null}

          <Field label={t('admin.users.invite.emailLabel')} htmlFor={invEmailId}>
            <Input
              id={invEmailId}
              controlSize="md"
              type="email"
              value={invEmail}
              onChange={(e) => setInvEmail(e.target.value)}
            />
          </Field>

          <Field label={t('admin.users.invite.displayNameLabel')} htmlFor={invNameId}>
            <Input
              id={invNameId}
              controlSize="md"
              value={invDisplayName}
              onChange={(e) => setInvDisplayName(e.target.value)}
              maxLength={80}
            />
          </Field>

          <Field label={t('admin.users.invite.roleLabel')} htmlFor={invRoleSelectId}>
            <Select
              id={invRoleSelectId}
              value={invRoleId}
              onValueChange={setInvRoleId}
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
                onCheckedChange={setInvAllOutlets}
              />
            </div>
          ) : null}

          {!invAllOutlets ? (
            <div className="flex flex-col gap-2">
              <p className="text-label font-medium text-ink">
                {t('admin.users.invite.outletsLabel')}
              </p>
              <div className="flex flex-col gap-1 rounded-control border border-line p-2">
                {outlets.map((o) => (
                  <Checkbox
                    key={o.id}
                    label={`${o.code} · ${o.name}`}
                    checked={invOutletIds.includes(o.id)}
                    onCheckedChange={(checked) => toggleInviteOutlet(o.id, checked)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setInviteOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={inviteMutation.isPending}>
              {t('admin.users.invite.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(editingMember)}
        onOpenChange={(open) => !open && setEditingMember(null)}
        title={t('admin.users.editAccess.title', { name: editingMember?.displayName ?? '' })}
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
                onCheckedChange={setAccessAllOutlets}
              />
            </div>
          ) : null}

          {accessAllOutlets ? (
            <Field label={t('admin.users.editAccess.roleLabel')} htmlFor={editWideRoleId}>
              <Select
                id={editWideRoleId}
                value={accessTenantWideRoleId}
                onValueChange={setAccessTenantWideRoleId}
                options={roles.map((r) => ({
                  value: r.id,
                  label: t(`role.${r.code}`, { defaultValue: r.name }),
                }))}
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
                    className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-3"
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
                            .filter((r) => canTenantWide || r.code !== 'OWNER')
                            .map((r) => ({
                              value: r.id,
                              label: t(`role.${r.code}`, { defaultValue: r.name }),
                            }))}
                          ariaLabel={t('admin.users.editAccess.roleForOutlet', { outlet: o.code })}
                          size="md"
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setEditingMember(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={accessMutation.isPending}>
              {t('admin.users.editAccess.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={t('admin.users.reset.confirmTitle', { name: resetTarget?.displayName ?? '' })}
        description={t('admin.users.reset.confirmDesc')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setResetTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={resetMutation.isPending}
              onClick={() => resetTarget && resetMutation.mutate(resetTarget.appUserId)}
            >
              {t('admin.users.reset.confirmAction')}
            </Button>
          </>
        }
      >
        {resetError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{resetError}</span>
          </div>
        ) : (
          <div />
        )}
      </Dialog>

      <Dialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t('admin.users.remove.confirmTitle', {
          name: removeTarget?.displayName ?? '',
          tenant: tenantName,
        })}
        description={t('admin.users.remove.confirmDesc', {
          name: removeTarget?.displayName ?? '',
          tenant: tenantName,
        })}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setRemoveTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={removeMutation.isPending}
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.appUserId)}
            >
              {t('admin.users.remove.confirmAction')}
            </Button>
          </>
        }
      >
        {removeError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{removeError}</span>
          </div>
        ) : (
          <div />
        )}
      </Dialog>

      {pinTarget ? (
        <PinDialog
          tenantSlug={tenantSlug}
          target={pinTarget}
          onOpenChange={(open) => !open && setPinTarget(null)}
        />
      ) : null}

      {codeModal ? (
        <OneTimeCodeDialog
          open={Boolean(codeModal)}
          onOpenChange={(open) => !open && setCodeModal(null)}
          title={codeModal.title}
          codeLabel={
            codeModal.kind === 'invite'
              ? t('admin.users.invite.codeLabel')
              : t('admin.users.reset.codeLabel')
          }
          copyCodeLabel={t('admin.users.invite.copyCode')}
          urlLabel={
            codeModal.kind === 'invite'
              ? t('admin.users.invite.urlLabel')
              : t('admin.users.reset.urlLabel')
          }
          copyUrlLabel={t('admin.users.invite.copyUrl')}
          expiryNotice={codeModal.expiryNotice}
          onceNotice={
            codeModal.kind === 'invite'
              ? t('admin.users.invite.onceNotice')
              : t('admin.users.reset.onceNotice')
          }
          code={codeModal.code}
          url={codeModal.url}
        />
      ) : null}
    </div>
  )
}
