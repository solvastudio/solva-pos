export interface MembersQueryFilter {
  search?: string
  roleId?: string
  outletId?: string
}

export const qk = {
  legalEntities: (tenantSlug: string) => ['identity', tenantSlug, 'legal-entities'] as const,
  outlets: (tenantSlug: string) => ['identity', tenantSlug, 'outlets'] as const,
  registers: (tenantSlug: string) => ['identity', tenantSlug, 'registers'] as const,
  members: (tenantSlug: string, filter?: MembersQueryFilter) =>
    ['identity', tenantSlug, 'members', filter ?? {}] as const,
  pendingInvites: (tenantSlug: string) => ['identity', tenantSlug, 'pending-invites'] as const,
  roles: (tenantSlug: string) => ['identity', tenantSlug, 'roles'] as const,
}
