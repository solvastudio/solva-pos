import { queryOptions } from '@tanstack/react-query'
import { listDevicesFn } from '~/functions/identity/device.fn'
import { listMembersFn } from '~/functions/identity/members-admin.fn'
import { listPendingInvitesFn } from '~/functions/identity/members.fn'
import { listLegalEntitiesFn, listOutletsFn } from '~/functions/identity/org.fn'
import { listRegistersFn } from '~/functions/identity/register.fn'
import { listRolesWithPermissionsFn } from '~/functions/identity/role.fn'
import { qk, type MembersQueryFilter } from './keys'

export function legalEntitiesQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.legalEntities(tenantSlug),
    queryFn: () => listLegalEntitiesFn(),
  })
}

export function outletsQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.outlets(tenantSlug),
    queryFn: () => listOutletsFn(),
  })
}

export function registersQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.registers(tenantSlug),
    queryFn: () => listRegistersFn(),
  })
}

export function membersQueryOptions(tenantSlug: string, filter?: MembersQueryFilter) {
  return queryOptions({
    queryKey: qk.members(tenantSlug, filter),
    queryFn: () => listMembersFn({ data: filter }),
  })
}

export function pendingInvitesQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.pendingInvites(tenantSlug),
    queryFn: () => listPendingInvitesFn(),
  })
}

export function rolesQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.roles(tenantSlug),
    queryFn: () => listRolesWithPermissionsFn(),
  })
}

export function devicesQueryOptions(tenantSlug: string) {
  return queryOptions({
    queryKey: qk.devices(tenantSlug),
    queryFn: () => listDevicesFn(),
  })
}
