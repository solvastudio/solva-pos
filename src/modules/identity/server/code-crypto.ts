import '@tanstack/react-start/server-only'
import { createHash, randomBytes, webcrypto } from 'node:crypto'
import {
  CODE_LENGTH_MEMBER,
  createIdGenerator,
  formatCode,
  generateCode,
  normalizeCode,
} from '~/lib/kernel'
import { AppError } from '~/server/error-classify'
import type { PermissionCode } from '../domain/permissions'

export interface IdentityAuthActor {
  tenantId: string
  tenantSlug: string
  authOrgId: string
  appUserId: string
  permissions: ReadonlySet<PermissionCode>
}

export interface IdentityServiceDeps {
  nowIso?: () => string
  randomCodeBytes?: (length: number) => Uint8Array
}

export const identityIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

export function requireActorPermission(actor: IdentityAuthActor, permission: PermissionCode): void {
  if (!actor.permissions.has(permission)) {
    throw new AppError('FORBIDDEN', `Missing required permission: ${permission}`)
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
