import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import {
  CODE_LENGTH_MEMBER,
  formatCode,
  generateCode,
  normalizeCode,
} from '~/lib/kernel'
import { runtimeIdGenerator } from '~/lib/runtime-id'
import { AppError } from '~/server/error-classify'
import type { PermissionCode } from '../domain/permissions'

export interface IdentityAuthActor {
  tenantId: string
  tenantSlug: string
  authOrgId: string
  appUserId: string
  permissions: ReadonlySet<PermissionCode>
  /** `null` grants tenant-wide outlet access; `string[]` restricts to listed outlets; `undefined` fails closed for scoped ops. */
  outletIds?: readonly string[] | null
  roleCodes?: readonly string[]
}

export interface IdentityServiceDeps {
  nowIso?: () => string
  randomCodeBytes?: (length: number) => Uint8Array
}

export const identityIdGen = runtimeIdGenerator

export function requireActorPermission(
  actor: IdentityAuthActor,
  permission: PermissionCode,
  scope?: { requireTenantWide?: boolean; outletId?: string },
): void {
  if (!actor.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing required permission: ${permission}`)
  }
  if (!scope) {
    return
  }
  if (scope.requireTenantWide) {
    if (actor.outletIds !== null) {
      throw new AppError('FORBIDDEN', 'Tenant-wide outlet access required')
    }
    return
  }
  if (scope.outletId !== undefined) {
    if (actor.outletIds === null) {
      return
    }
    if (!Array.isArray(actor.outletIds) || !actor.outletIds.includes(scope.outletId)) {
      throw new AppError('FORBIDDEN', 'Outlet is outside your assigned scope')
    }
  }
}

/** Passes when the actor holds at least one of the given permissions. */
export function requireActorAnyPermission(
  actor: IdentityAuthActor,
  permissions: readonly PermissionCode[],
): void {
  if (!permissions.some((permission) => actor.permissions.has(permission))) {
    throw new AppError('FORBIDDEN', `Missing required permission: ${permissions.join(' or ')}`)
  }
}

export function hashMemberCode(normalizedCode: string): Buffer {
  return createHash('sha256').update(normalizedCode, 'utf8').digest()
}

export function generateOneTimeMemberCode(deps?: IdentityServiceDeps): {
  plain: string
  formatted: string
  codeHash: Buffer
} {
  const bytes = deps?.randomCodeBytes
    ? deps.randomCodeBytes(CODE_LENGTH_MEMBER)
    : randomBytes(CODE_LENGTH_MEMBER)
  const plain = generateCode(bytes, CODE_LENGTH_MEMBER)
  const normalized = normalizeCode(plain)
  return {
    plain,
    formatted: formatCode(plain),
    codeHash: hashMemberCode(normalized),
  }
}

export function addHoursIso(baseIso: string, hours: number): string {
  const ms = Date.parse(baseIso) + hours * 3_600_000
  return new Date(ms).toISOString()
}
