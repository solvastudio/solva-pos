import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { roleMembersQueryOptions } from '~/queries/identity.queries'
import { useRoleActor } from './role-actor-context'

export interface RoleMembersSectionProps {
  tenantSlug: string
  roleId: string
  memberCount: number
}

/** Names of the members using a role (only for actors allowed to see the member list). */
export function RoleMembersSection({ tenantSlug, roleId, memberCount }: RoleMembersSectionProps) {
  const { t } = useTranslation()
  const { canViewMembers } = useRoleActor()
  const { data: members = [] } = useQuery({
    ...roleMembersQueryOptions(tenantSlug, roleId),
    enabled: canViewMembers,
  })

  return (
    <section className="flex flex-col gap-2 border-t border-line-subtle pt-4">
      <h4 className="text-label font-semibold text-ink">{t('admin.users.role.membersHeading')}</h4>
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
      {memberCount === 0 ? (
        <p className="text-body-sm text-ink-soft">{t('admin.users.role.membersEmpty')}</p>
      ) : null}
    </section>
  )
}
