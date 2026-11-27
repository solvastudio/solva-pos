import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Chip,
  DataTable,
  IconButton,
  Input,
  KeyRound,
  Lock,
  Plus,
  Search,
  Select,
  Tooltip,
  Trash2,
  Users,
  useToast,
  type DataTableColumn,
} from '~/components/ui'
import { cancelInviteFn, reissueInviteFn } from '~/functions/identity/members.fn'
import { formatDateTime } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { roleExceedsActor } from '~/modules/identity/shared'
import type { MemberDirectoryView, PermissionCode } from '~/modules/identity/shared'
import {
  membersQueryOptions,
  outletsQueryOptions,
  pendingInvitesQueryOptions,
  rolesQueryOptions,
} from '~/queries/identity.queries'
import { qk } from '~/queries/keys'
import { EditMemberAccessDialog } from './EditMemberAccessDialog'
import { InviteMemberDialog } from './InviteMemberDialog'
import { MemberRemoveDialog } from './MemberRemoveDialog'
import { MemberResetDialog } from './MemberResetDialog'
import { OneTimeCodeDialog } from './OneTimeCodeDialog'
import { PendingInvitesSection } from './PendingInvitesSection'
import { PinDialog } from './PinDialog'

const FILTER_ALL = '__ALL__'

export interface UsersTabProps {
  tenantSlug: string
  tenantName: string
  permissions: readonly PermissionCode[]
  actorOutletIds: readonly string[] | null
  /** Highest discount limit of the signed-in member; when set, roles above it are not assignable. */
  actorDiscountLimitPct?: number
}

export function UsersTab({
  tenantSlug,
  tenantName,
  permissions,
  actorOutletIds,
  actorDiscountLimitPct,
}: UsersTabProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const permSet = useMemo(() => new Set(permissions), [permissions])
  // Undefined limit means "unknown": do not filter (tests and callers that do not pass it).
  const isRoleAssignable = useMemo(
    () =>
      actorDiscountLimitPct === undefined
        ? undefined
        : (r: { permissions: readonly string[]; discountLimitPct: number }) =>
            !roleExceedsActor(r, { permissions: permSet, discountLimitPct: actorDiscountLimitPct }),
    [actorDiscountLimitPct, permSet],
  )
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

  const roleNameById = useMemo(
    () => new Map(roles.map((r) => [r.id, r.name])),
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
  const [inviteSession, setInviteSession] = useState(0)

  const [editingMember, setEditingMember] = useState<MemberDirectoryView | null>(null)

  const [resetTarget, setResetTarget] = useState<MemberDirectoryView | null>(null)
  const [removeTarget, setRemoveTarget] = useState<MemberDirectoryView | null>(null)
  const [pinTarget, setPinTarget] = useState<MemberDirectoryView | null>(null)

  const originPrefix = typeof window !== 'undefined' ? window.location.origin : ''
  const localeForDate = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  function invalidateMemberQueries() {
    void queryClient.invalidateQueries({ queryKey: ['identity', tenantSlug, 'members'] })
    void queryClient.invalidateQueries({ queryKey: ['identity', tenantSlug, 'role-members'] })
    void queryClient.invalidateQueries({ queryKey: qk.roles(tenantSlug) })
    void queryClient.invalidateQueries({ queryKey: qk.pendingInvites(tenantSlug) })
  }

  /** Opens the one-time code dialog for an invite or reset code. */
  function showCode(
    kind: 'invite' | 'reset',
    title: string,
    path: '/join' | '/reset',
    res: { code: string; expiresAt: string },
  ) {
    setCodeModal({
      kind,
      title,
      code: res.code,
      url: `${originPrefix}${tenantHref(tenantSlug, path)}`,
      expiryNotice: t(
        kind === 'invite' ? 'admin.users.invite.expiryNotice' : 'admin.users.reset.expiryNotice',
        { expiry: formatDateTime(res.expiresAt, 'Asia/Jakarta', localeForDate) },
      ),
    })
  }

  const reissueMutation = useMutation({
    retry: 0,
    mutationFn: (appUserId: string) => reissueInviteFn({ data: { appUserId } }),
    onSuccess: (res) => {
      invalidateMemberQueries()
      showCode('invite', t('admin.users.pending.reissuedTitle'), '/join', res)
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

  function openInviteDialog() {
    setInviteSession((n) => n + 1)
    setInviteOpen(true)
  }

  function handleInviteCreated(res: { code: string; expiresAt: string }) {
    invalidateMemberQueries()
    setInviteOpen(false)
    showCode('invite', t('admin.users.invite.codeTitle'), '/join', res)
  }

  const roleOptions = [
    { value: FILTER_ALL, label: t('admin.users.filterRoleAll') },
    ...roles.map((r) => ({ value: r.id, label: r.name })),
  ]

  const outletFilterOptions = [
    { value: FILTER_ALL, label: t('admin.users.filterOutletAll') },
    ...outlets.map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` })),
  ]

  function renderMemberActions(row: MemberDirectoryView) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1 whitespace-nowrap">
        {row.membershipStatus === 'PENDING' && canInvite ? (
          <Button
            variant="ghost"
            size="md"
            className="px-3"
            onClick={() => cancelInviteMutation.mutate(row.appUserId)}
          >
            {t('admin.users.actionCancelInvite')}
          </Button>
        ) : (
          <>
            <Tooltip
              content={
                row.pinStatus === 'unset'
                  ? t('admin.users.actionSetPin')
                  : t('admin.users.actionResetPin')
              }
            >
              <Button
                variant="ghost"
                size="md"
                className="px-3"
                onClick={() => setPinTarget(row)}
              >
                {row.pinStatus === 'unset'
                  ? t('admin.users.actionSetPinShort')
                  : t('admin.users.actionResetPinShort')}
              </Button>
            </Tooltip>
            <Tooltip content={t('admin.users.actionChangeAccess')}>
              <Button
                variant="ghost"
                size="md"
                className="px-3"
                onClick={() => setEditingMember(row)}
              >
                {t('admin.users.actionChangeAccessShort')}
              </Button>
            </Tooltip>
            {canReset ? (
              <Tooltip content={t('admin.users.actionReset')}>
                <IconButton
                  variant="ghost"
                  size="md"
                  label={t('admin.users.actionReset')}
                  icon={<KeyRound className="size-4" />}
                  onClick={() => setResetTarget(row)}
                />
              </Tooltip>
            ) : null}
            {canRemove ? (
              <Tooltip content={t('admin.users.actionRemove', { tenant: tenantName })}>
                <IconButton
                  variant="danger-ghost"
                  size="md"
                  label={t('admin.users.actionRemove', { tenant: tenantName })}
                  icon={<Trash2 className="size-4" />}
                  onClick={() => setRemoveTarget(row)}
                />
              </Tooltip>
            ) : null}
          </>
        )}
      </div>
    )
  }

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
        const uniqueRoles = Array.from(new Map(row.assignments.map((a) => [a.roleId, a.roleName])))
        return (
          <div className="flex flex-wrap gap-1">
            {uniqueRoles.map(([roleId, roleName]) => (
              <span
                key={roleId}
                className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-label-sm font-medium text-ink"
              >
                {roleName}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      id: 'outlets',
      header: t('admin.users.colOutlets'),
      cell: (row) => {
        const isAllOutlets = row.assignments.some((a) => a.outletId === null)
        const outletCodes = row.assignments
          .map((a) => a.outletCode ?? a.outletName)
          .filter(Boolean)
        const label = isAllOutlets
          ? t('admin.users.allOutlets')
          : outletCodes.join(', ') || t('common.dash')
        return (
          <span className={isAllOutlets || outletCodes.length <= 2 ? 'whitespace-nowrap' : undefined}>
            {label}
          </span>
        )
      },
    },
    {
      id: 'pin',
      header: t('admin.users.colPin'),
      cell: (row) => {
        if (row.membershipStatus !== 'ACTIVE') return t('common.dash')
        if (row.pinStatus === 'locked') {
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm font-medium text-danger-ink">
              <Lock className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t('admin.users.pinStatus.locked')}</span>
            </span>
          )
        }
        return (
          <span className="whitespace-nowrap">
            {row.pinStatus === 'active'
              ? t('admin.users.pinStatus.active')
              : t('admin.users.pinStatus.unset')}
          </span>
        )
      },
    },
    {
      id: 'action',
      header: t('admin.users.colAction'),
      align: 'right',
      hideOnMobileCard: true,
      cell: renderMemberActions,
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-52 w-full flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.users.searchPlaceholder')}
              aria-label={t('admin.users.searchPlaceholder')}
              controlSize="md"
              prefix={<Search className="size-4 text-ink-soft" aria-hidden="true" />}
            />
          </div>
          <div className="min-w-36 flex-1 sm:w-44 sm:flex-none">
            <Select
              value={roleFilter}
              onValueChange={setRoleFilter}
              options={roleOptions}
              ariaLabel={t('admin.users.filterRoleAll')}
              size="md"
            />
          </div>
          <div className="min-w-36 flex-1 sm:w-52 sm:flex-none">
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
          mobileActions={renderMemberActions}
        />
      </section>

      {canInvite ? (
        <PendingInvitesSection
          invites={pendingInvites}
          roleNameById={roleNameById}
          reissuing={reissueMutation.isPending}
          canceling={cancelInviteMutation.isPending}
          onReissue={(inviteId) => reissueMutation.mutate(inviteId)}
          onCancel={(inviteId) => cancelInviteMutation.mutate(inviteId)}
        />
      ) : null}

      <InviteMemberDialog
        key={inviteSession}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
        outlets={outlets}
        canTenantWide={canTenantWide}
        isRoleAssignable={isRoleAssignable}
        onCreated={handleInviteCreated}
      />

      {editingMember ? (
        <EditMemberAccessDialog
          key={editingMember.appUserId}
          member={editingMember}
          roles={roles}
          outlets={outlets}
          canTenantWide={canTenantWide}
          isRoleAssignable={isRoleAssignable}
          onClose={() => setEditingMember(null)}
          onSaved={() => {
            invalidateMemberQueries()
            toast.show({ tone: 'success', message: t('admin.users.saved') })
            setEditingMember(null)
          }}
        />
      ) : null}

      {resetTarget ? (
        <MemberResetDialog
          key={resetTarget.appUserId}
          target={resetTarget}
          onClose={() => setResetTarget(null)}
          onIssued={(res) => showCode('reset', t('admin.users.reset.resultTitle'), '/reset', res)}
        />
      ) : null}

      {removeTarget ? (
        <MemberRemoveDialog
          key={removeTarget.appUserId}
          target={removeTarget}
          tenantName={tenantName}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            invalidateMemberQueries()
            setRemoveTarget(null)
            toast.show({ tone: 'success', message: t('admin.users.saved') })
          }}
        />
      ) : null}

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
