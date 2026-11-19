import '@tanstack/react-start/server-only'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { PERMISSION_CODES, type PermissionCode } from '../domain/permissions'
import { updateRoleSchema, type RoleMatrixView, type UpdateRoleInput } from '../shared'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  findRoleById,
  listRolePermissionRows,
  listRolesRows,
  syncRolePermissionsRows,
  updateRoleRow,
} from './role.repo'

function nowIsoFrom(deps?: IdentityServiceDeps): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}

export async function listRolesWithPermissions(
  actor: IdentityAuthActor,
): Promise<RoleMatrixView[]> {
  requireActorPermission(actor, 'user.manage')
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const roles = await listRolesRows(tx, actor.tenantId)
    const perms = await listRolePermissionRows(tx, actor.tenantId)
    const permsByRole = new Map<string, PermissionCode[]>()
    for (const p of perms) {
      const list = permsByRole.get(p.roleId) ?? []
      list.push(p.permissionCode as PermissionCode)
      permsByRole.set(p.roleId, list)
    }

    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      discountLimitPct: Number(r.discountLimitPct),
      permissions: permsByRole.get(r.id) ?? [],
      version: r.version,
    }))
  })
}

export async function updateRole(
  actor: IdentityAuthActor,
  rawInput: UpdateRoleInput,
  deps?: IdentityServiceDeps,
): Promise<RoleMatrixView> {
  requireActorPermission(actor, 'user.manage', { requireTenantWide: true })
  const parsedRes = updateRoleSchema.safeParse(rawInput)
  if (!parsedRes.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsedRes.error.issues[0]?.message ?? 'Invalid role update input',
    )
  }
  const parsed = parsedRes.data
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findRoleById(tx, actor.tenantId, parsed.roleId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'Role not found')
    }

    const currentPermsRows = (await listRolePermissionRows(tx, actor.tenantId)).filter(
      (p) => p.roleId === existing.id,
    )
    const currentCodes = new Set(currentPermsRows.map((p) => p.permissionCode))

    if (existing.code === 'OWNER' && parsed.permissions !== undefined) {
      const desiredSet = new Set(parsed.permissions)
      const allPresent = PERMISSION_CODES.every((code) => desiredSet.has(code))
      if (!allPresent || desiredSet.size !== PERMISSION_CODES.length) {
        throw new AppError('VALIDATION_FAILED', 'admin.users.role.ownerPermissionsLocked')
      }
    }

    const nextName = parsed.name ?? existing.name
    const prevDiscount = Number(existing.discountLimitPct)
    const nextDiscount = parsed.discountLimitPct ?? prevDiscount
    const metadataChanged = nextName !== existing.name || nextDiscount !== prevDiscount
    const permUpdateRequested = parsed.permissions !== undefined && existing.code !== 'OWNER'
    const desiredCodes = new Set<string>(parsed.permissions ?? currentCodes)

    const permDiffPreview = permUpdateRequested
      ? {
          willChange:
            Array.from(desiredCodes).some((c) => !currentCodes.has(c)) ||
            Array.from(currentCodes).some((c) => !desiredCodes.has(c)),
        }
      : { willChange: false }

    if (!metadataChanged && !permDiffPreview.willChange) {
      return {
        id: existing.id,
        code: existing.code,
        name: existing.name,
        isSystem: existing.isSystem,
        discountLimitPct: prevDiscount,
        permissions: Array.from(currentCodes).sort() as PermissionCode[],
        version: existing.version,
      }
    }

    const { result: permDiff, version } = await writeMaster(
      tx,
      { actorUserId: actor.appUserId },
      async (w) => {
        if (metadataChanged) {
          await updateRoleRow(tx, w, {
            roleId: existing.id,
            name: nextName,
            discountLimitPct: String(nextDiscount),
            nowIso,
          })
        }
        if (permUpdateRequested) {
          return syncRolePermissionsRows(tx, w, {
            roleId: existing.id,
            desiredCodes,
            newId: () => identityIdGen.newId(),
            nowIso,
          })
        }
        return { added: [] as string[], removed: [] as string[] }
      },
    )

    if (metadataChanged) {
      await appendAudit(
        tx,
        {
          action: 'role.changed',
          entityType: 'role',
          entityId: existing.id,
          beforeData: {
            roleCode: existing.code,
            name: existing.name,
            discountLimitPct: prevDiscount,
          },
          afterData: {
            roleCode: existing.code,
            name: nextName,
            discountLimitPct: nextDiscount,
          },
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )
    }

    if (permDiff.added.length > 0 || permDiff.removed.length > 0) {
      await appendAudit(
        tx,
        {
          action: 'permission.changed',
          entityType: 'role',
          entityId: existing.id,
          afterData: {
            roleCode: existing.code,
            added: permDiff.added,
            removed: permDiff.removed,
          },
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
        },
        { newId: () => identityIdGen.newId(), nowIso: () => nowIso },
      )
    }

    return {
      id: existing.id,
      code: existing.code,
      name: nextName,
      isSystem: existing.isSystem,
      discountLimitPct: nextDiscount,
      permissions: Array.from(desiredCodes).sort() as PermissionCode[],
      version,
    }
  })
}
