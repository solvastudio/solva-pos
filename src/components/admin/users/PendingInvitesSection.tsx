import { useTranslation } from 'react-i18next'
import { Button, Chip, DataTable, Inbox, type DataTableColumn } from '~/components/ui'
import { formatDateTime } from '~/lib/kernel'
import type { PendingInviteItem } from '~/modules/identity/public'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function addSevenDaysIso(expiresAtIso: string): string {
  const ms = Date.parse(expiresAtIso)
  return Number.isFinite(ms) ? new Date(ms + SEVEN_DAYS_MS).toISOString() : expiresAtIso
}

export interface PendingInvitesSectionProps {
  invites: readonly PendingInviteItem[]
  roleNameById: ReadonlyMap<string, string>
  reissuing: boolean
  canceling: boolean
  onReissue: (inviteId: string) => void
  onCancel: (inviteId: string) => void
}

/** Table of invitations that have not been redeemed yet, with reissue and cancel actions. */
export function PendingInvitesSection({
  invites,
  roleNameById,
  reissuing,
  canceling,
  onReissue,
  onCancel,
}: PendingInvitesSectionProps) {
  const { t, i18n } = useTranslation()
  const localeForDate = i18n.language === 'en-US' ? 'en-US' : 'id-ID'

  const columns: readonly DataTableColumn<PendingInviteItem>[] = [
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
        const roleName = row.roleId ? roleNameById.get(row.roleId) : undefined
        return roleName ?? t('common.dash')
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
            loading={reissuing}
            onClick={() => onReissue(row.id)}
          >
            {t('admin.users.pending.reissue')}
          </Button>
          {row.status === 'PENDING' ? (
            <Button variant="ghost" size="md" loading={canceling} onClick={() => onCancel(row.id)}>
              {t('admin.users.pending.cancel')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <section aria-labelledby="pending-invites-heading" className="flex flex-col gap-3">
      <h2 id="pending-invites-heading" className="text-h2 font-semibold text-ink">
        {t('admin.users.pending.title', { count: invites.length })}
      </h2>
      <DataTable
        caption={t('admin.users.pending.title', { count: invites.length })}
        columns={columns}
        rows={invites}
        getRowKey={(r) => r.id}
        emptyIcon={<Inbox className="size-8" aria-hidden="true" />}
        emptyTitle={t('admin.users.pending.empty')}
        mobileActions={(row) => (
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={() => onReissue(row.id)}>
              {t('admin.users.pending.reissue')}
            </Button>
            {row.status === 'PENDING' ? (
              <Button variant="ghost" size="md" onClick={() => onCancel(row.id)}>
                {t('admin.users.pending.cancel')}
              </Button>
            ) : null}
          </div>
        )}
      />
    </section>
  )
}
