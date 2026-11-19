export {
  __clearTenantCacheForTests,
  resolveTenantBySlug,
  type ResolveTenantDeps,
  type TenantResolution,
} from './server/tenant-resolver.service'
export * as authSchema from './server/auth-schema'
export { platformAuthTables as platformAuthSchema } from './server/platform-auth-schema'
export {
  checkActiveMembership,
  getTenantAuthMetadataById,
  getTenantAuthMetadataBySlug,
  loadMembership,
  revokeUserSessionsAcrossAllTenants,
  revokeUserSessionsForTenant,
  setAppUserPreferredLocale,
  type LoadedMembership,
  type TenantAuthMetadata,
} from './server/membership.service'
export type { IdentityAuthActor, IdentityServiceDeps } from './server/code-crypto'
export {
  cancelInvite,
  createInvite,
  listPendingInvites,
  reissueInvite,
  type CreateInviteInput,
  type CreateInviteResult,
  type PendingInviteItem,
  type ReissueInviteResult,
} from './server/invite.service'
export { issueResetCode, type IssueResetCodeResult } from './server/reset.service'
export { removeMember } from './server/member.service'
export {
  redeemInvite,
  redeemReset,
  type RedeemDeps,
  type RedeemInput,
  type RedeemResult,
} from './server/redeem.service'
export { purgeMemberCodes, type PurgeMemberCodesResult } from './server/member-cleanup'
export {
  createTenant,
  getTenantDetail,
  listTenants,
  renameTenant,
  setTenantStatus,
  validateTenantDisplayName,
  type CreateTenantDeps,
  type CreateTenantInput,
  type CreateTenantResult,
  type PlatformOperatorActor,
} from './server/tenant.service'
export type {
  PlatformTenantSummaryRow,
  TenantDetailRow,
  TenantLifecycleStatus,
  TenantMemberOverviewRow,
} from './server/tenant.repo'
export {
  cancelOwnerInvite,
  getPlatformTenantView,
  issueResetCodeAsOperator,
  listOwnerInvites,
  reissueOwnerInvite,
  type PlatformTenantView,
} from './server/operator.service'
export {
  createLegalEntity,
  createOutlet,
  listLegalEntities,
  listOutlets,
  registerOutletCreatedHook,
  updateLegalEntity,
  updateOutlet,
  type OutletCreatedHook,
} from './server/org.service'
export {
  changeInvoicePrefix,
  createRegister,
  listRegisters,
  updateRegister,
} from './server/register.service'
export {
  changeMemberRoleAndOutlets,
  listMembers,
  type ListMembersFilter,
} from './server/members-admin.service'
export { listRolesWithPermissions, updateRole } from './server/role.service'
export {
  __clearDeviceAuthCacheForTests,
  authenticateDevice,
  RateLimitRejectedError,
  type AuthenticateDeviceDeps,
  type DeviceContext,
} from './server/device-auth'
export {
  createPairingCode,
  enrollDevice,
  EnrollConflictError,
  extendCredentialIfNeeded,
  listDevices,
  revokeDevice,
  type CreatePairingCodeDeps,
  type EnrollConflictReason,
  type EnrollDeviceDeps,
} from './server/device.service'
