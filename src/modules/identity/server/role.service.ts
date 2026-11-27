import '@tanstack/react-start/server-only'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { parseOrThrow } from '~/server/parse-or-throw'
import { nowIsoFrom } from '~/server/service-deps'
import { OWNER_ROLE_CODE } from '../domain/default-roles'
import type { PermissionCode } from '../domain/permissions'
import { deriveRoleCode } from '../domain/role-code'
import {
  computeRoleChange,
  permissionsActorLacks,
  roleExceedsActor,
  type RoleChange,
} from '../domain/role-rules'
import {
  createRoleSchema,
  deleteRoleSchema,
  duplicateRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type DeleteRoleInput,
  type DuplicateRoleInput,
  type RoleMatrixView,
  type UpdateRoleInput,
} from '../shared'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import {
  countActiveMembersByRole,
  countActiveMembersForRole,
  listActiveRolesOfUser,
} from './member-directory.repo'
import {
  findRoleById,
  findRoleNameConflict,
  insertRoleRow,
  listRolePermissionCodes,
  listRolePermissionRows,
  listRolesRows,
  softDeleteRoleRows,
  syncRolePermissionsRows,
  updateRoleRow,
  type RoleDbRow,
} from './role.repo'

function auditDeps(nowIso: string) {
  return { newId: () => identityIdGen.newId(), nowIso: () => nowIso }
}

function requireRoleManager(actor: IdentityAuthActor): void {
  requireActorPermission(actor, 'role.manage', { requireTenantWide: true })
}

function toView(
  row: RoleDbRow,
  permissions: Iterable<string>,
  memberCount: number,
  heldByActor: boolean,
): RoleMatrixView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isSystem: row.isSystem,
    discountLimitPct: Number(row.discountLimitPct),
    permissions: Array.from(permissions).sort() as PermissionCode[],
    memberCount,
    heldByActor,
    version: row.version,
  }
}

/** The actor's own active role ids and highest discount limit (0 when the actor has no role). */
async function loadActorLimits(tx: TenantTx, actor: IdentityAuthActor) {
  const actorRoles = await listActiveRolesOfUser(tx, actor.tenantId, actor.appUserId)
  return {
    roleIds: new Set(actorRoles.map((r) => r.roleId)),
    discountLimitPct: Math.max(0, ...actorRoles.map((r) => r.discountLimitPct)),
  }
}

export async function listRolesWithPermissions(
  actor: IdentityAuthActor,
): Promise<RoleMatrixView[]> {
  if (!actor.permissions.has('user.manage') && !actor.permissions.has('role.manage')) {
    throw new AppError('FORBIDDEN', 'Missing required permission: user.manage or role.manage')
  }
  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const roles = await listRolesRows(tx, actor.tenantId)
    const perms = await listRolePermissionRows(tx, actor.tenantId)
    const counts = await countActiveMembersByRole(tx, actor.tenantId)
    const heldRoleIds = new Set(
      (await listActiveRolesOfUser(tx, actor.tenantId, actor.appUserId)).map((r) => r.roleId),
    )
    const permsByRole = new Map<string, string[]>()
    for (const p of perms) {
      const list = permsByRole.get(p.roleId) ?? []
      list.push(p.permissionCode)
      permsByRole.set(p.roleId, list)
    }
    return roles.map((r) =>
      toView(r, permsByRole.get(r.id) ?? [], counts.get(r.id) ?? 0, heldRoleIds.has(r.id)),
    )
  })
}

type ActorLimits = Awaited<ReturnType<typeof loadActorLimits>>

/** OWNER is locked completely: permissions first (kept error key), then name and discount. */
function assertOwnerRoleUnchanged(change: RoleChange): void {
  if (change.permsChanged) {
    throw new AppError('VALIDATION_FAILED', 'admin.users.role.ownerPermissionsLocked')
  }
  if (change.metadataChanged) {
    throw new AppError('VALIDATION_FAILED', 'admin.users.role.ownerLocked')
  }
}

/** Escalation guards: an actor may only change what the actor itself holds. */
function assertActorMayApplyChange(
  actor: IdentityAuthActor,
  limits: ActorLimits,
  roleId: string,
  change: RoleChange,
): void {
  if (limits.roleIds.has(roleId)) {
    throw new AppError('FORBIDDEN', 'You cannot modify a role assigned to yourself')
  }
  const touched = [...change.permDiff.added, ...change.permDiff.removed]
  if (permissionsActorLacks(touched, actor.permissions).length > 0) {
    throw new AppError('FORBIDDEN', 'You cannot grant or revoke permissions you do not hold')
  }
  if (change.discountChanged && change.nextDiscount > limits.discountLimitPct) {
    throw new AppError('FORBIDDEN', 'Discount limit exceeds your own limit')
  }
}

/** Applies the change inside one master write and returns the new master version. */
async function writeRoleChange(
  tx: TenantTx,
  actor: IdentityAuthActor,
  existing: RoleDbRow,
  change: RoleChange,
  nowIso: string,
): Promise<number> {
  const { version } = await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
    // The name check runs after the master write lock so concurrent renames cannot collide.
    if (
      change.nameChanged &&
      (await findRoleNameConflict(tx, actor.tenantId, change.nextName, existing.id))
    ) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.nameTaken')
    }
    await updateRoleRow(tx, w, {
      roleId: existing.id,
      name: change.nextName,
      discountLimitPct: String(change.nextDiscount),
      nowIso,
    })
    if (change.permsChanged) {
      await syncRolePermissionsRows(tx, w, {
        roleId: existing.id,
        desiredCodes: change.desiredCodes,
        newId: () => identityIdGen.newId(),
        nowIso,
      })
    }
  })
  return version
}

async function auditRoleChange(
  tx: TenantTx,
  actor: IdentityAuthActor,
  existing: RoleDbRow,
  change: RoleChange,
  nowIso: string,
): Promise<void> {
  if (change.metadataChanged) {
    await appendAudit(
      tx,
      {
        action: 'role.changed',
        entityType: 'role',
        entityId: existing.id,
        beforeData: {
          roleCode: existing.code,
          name: existing.name,
          discountLimitPct: Number(existing.discountLimitPct),
        },
        afterData: {
          roleCode: existing.code,
          name: change.nextName,
          discountLimitPct: change.nextDiscount,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      auditDeps(nowIso),
    )
  }
  if (change.permsChanged) {
    await appendAudit(
      tx,
      {
        action: 'permission.changed',
        entityType: 'role',
        entityId: existing.id,
        afterData: {
          roleCode: existing.code,
          added: change.permDiff.added,
          removed: change.permDiff.removed,
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      auditDeps(nowIso),
    )
  }
}

export async function updateRole(
  actor: IdentityAuthActor,
  rawInput: UpdateRoleInput,
  deps?: IdentityServiceDeps,
): Promise<RoleMatrixView> {
  requireRoleManager(actor)
  const parsed = parseOrThrow(updateRoleSchema, rawInput, 'Invalid role update input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findRoleById(tx, actor.tenantId, parsed.roleId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.notFound')
    }
    if (existing.version !== parsed.expectedVersion) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.versionConflict')
    }

    const currentCodes = await listRolePermissionCodes(tx, actor.tenantId, existing.id)
    const change = computeRoleChange(
      { name: existing.name, discountLimitPct: Number(existing.discountLimitPct) },
      currentCodes,
      parsed,
    )
    if (existing.code === OWNER_ROLE_CODE) {
      assertOwnerRoleUnchanged(change)
    }

    const memberCount = await countActiveMembersForRole(tx, actor.tenantId, existing.id)
    const limits = await loadActorLimits(tx, actor)
    if (!change.metadataChanged && !change.permsChanged) {
      return toView(existing, currentCodes, memberCount, limits.roleIds.has(existing.id))
    }

    assertActorMayApplyChange(actor, limits, existing.id, change)
    const version = await writeRoleChange(tx, actor, existing, change, nowIso)
    await auditRoleChange(tx, actor, existing, change, nowIso)

    // Applying a change to a role the actor holds was rejected above, so it is never held here.
    return toView(
      {
        ...existing,
        name: change.nextName,
        discountLimitPct: String(change.nextDiscount),
        version,
      },
      change.desiredCodes,
      memberCount,
      false,
    )
  })
}

/** Inserts a custom (non-system) role plus its permission rows inside one master write. */
async function insertCustomRole(
  tx: TenantTx,
  actor: IdentityAuthActor,
  params: {
    name: string
    discountLimitPct: number
    desiredCodes: ReadonlySet<string>
    nowIso: string
    auditExtra?: Record<string, unknown>
  },
): Promise<RoleMatrixView> {
  const roleId = identityIdGen.newId()
  const { result: code, version } = await writeMaster(
    tx,
    { actorUserId: actor.appUserId },
    async (w) => {
      if (await findRoleNameConflict(tx, actor.tenantId, params.name)) {
        throw new AppError('VALIDATION_FAILED', 'admin.users.role.nameTaken')
      }
      const taken = new Set((await listRolesRows(tx, actor.tenantId)).map((r) => r.code))
      const derived = deriveRoleCode(params.name, taken)
      await insertRoleRow(tx, w, {
        id: roleId,
        code: derived,
        name: params.name,
        discountLimitPct: String(params.discountLimitPct),
        nowIso: params.nowIso,
      })
      await syncRolePermissionsRows(tx, w, {
        roleId,
        desiredCodes: params.desiredCodes,
        newId: () => identityIdGen.newId(),
        nowIso: params.nowIso,
      })
      return derived
    },
  )

  const permissions = Array.from(params.desiredCodes).sort() as PermissionCode[]
  await appendAudit(
    tx,
    {
      action: 'role.created',
      entityType: 'role',
      entityId: roleId,
      afterData: {
        roleCode: code,
        name: params.name,
        discountLimitPct: params.discountLimitPct,
        permissions,
        ...params.auditExtra,
      },
      actorUserId: actor.appUserId,
      occurredAt: params.nowIso,
    },
    auditDeps(params.nowIso),
  )

  return {
    id: roleId,
    code,
    name: params.name,
    isSystem: false,
    discountLimitPct: params.discountLimitPct,
    permissions,
    memberCount: 0,
    heldByActor: false,
    version,
  }
}

export async function createRole(
  actor: IdentityAuthActor,
  rawInput: CreateRoleInput,
  deps?: IdentityServiceDeps,
): Promise<RoleMatrixView> {
  requireRoleManager(actor)
  const parsed = parseOrThrow(createRoleSchema, rawInput, 'Invalid role input')
  const nowIso = nowIsoFrom(deps)
  const desiredCodes = new Set<string>(parsed.permissions)

  return withTenant(actor.tenantId, async (tx) => {
    const limits = await loadActorLimits(tx, actor)
    if (
      roleExceedsActor(
        { permissions: desiredCodes, discountLimitPct: parsed.discountLimitPct },
        { permissions: actor.permissions, discountLimitPct: limits.discountLimitPct },
      )
    ) {
      throw new AppError('FORBIDDEN', 'Role exceeds your own permissions or discount limit')
    }
    return insertCustomRole(tx, actor, {
      name: parsed.name,
      discountLimitPct: parsed.discountLimitPct,
      desiredCodes,
      nowIso,
    })
  })
}

export async function duplicateRole(
  actor: IdentityAuthActor,
  rawInput: DuplicateRoleInput,
  deps?: IdentityServiceDeps,
): Promise<RoleMatrixView> {
  requireRoleManager(actor)
  const parsed = parseOrThrow(duplicateRoleSchema, rawInput, 'Invalid role duplicate input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const source = await findRoleById(tx, actor.tenantId, parsed.sourceRoleId)
    if (!source) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.notFound')
    }
    const sourceCodes = await listRolePermissionCodes(tx, actor.tenantId, source.id)
    if (sourceCodes.size === 0) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.permissionsRequired')
    }
    const sourceDiscount = Number(source.discountLimitPct)
    const limits = await loadActorLimits(tx, actor)
    if (
      roleExceedsActor(
        { permissions: sourceCodes, discountLimitPct: sourceDiscount },
        { permissions: actor.permissions, discountLimitPct: limits.discountLimitPct },
      )
    ) {
      throw new AppError('FORBIDDEN', 'Cannot duplicate a role that exceeds your own permissions')
    }
    return insertCustomRole(tx, actor, {
      name: parsed.name,
      discountLimitPct: sourceDiscount,
      desiredCodes: sourceCodes,
      nowIso,
      auditExtra: { duplicatedFromRoleId: source.id },
    })
  })
}

export async function deleteRole(
  actor: IdentityAuthActor,
  rawInput: DeleteRoleInput,
  deps?: IdentityServiceDeps,
): Promise<{ id: string }> {
  requireRoleManager(actor)
  const parsed = parseOrThrow(deleteRoleSchema, rawInput, 'Invalid role delete input')
  const nowIso = nowIsoFrom(deps)

  return withTenant(actor.tenantId, async (tx) => {
    const existing = await findRoleById(tx, actor.tenantId, parsed.roleId)
    if (!existing) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.notFound')
    }
    if (existing.code === OWNER_ROLE_CODE) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.ownerLocked')
    }
    if (existing.isSystem) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.systemUndeletable')
    }
    if (existing.version !== parsed.expectedVersion) {
      throw new AppError('VALIDATION_FAILED', 'admin.users.role.versionConflict')
    }

    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      // Checked after the master write lock so a concurrent assignment cannot slip in.
      if ((await countActiveMembersForRole(tx, actor.tenantId, existing.id)) > 0) {
        throw new AppError('VALIDATION_FAILED', 'admin.users.role.inUse')
      }
      await softDeleteRoleRows(tx, w, { roleId: existing.id, nowIso })
    })

    await appendAudit(
      tx,
      {
        action: 'role.deleted',
        entityType: 'role',
        entityId: existing.id,
        beforeData: {
          roleCode: existing.code,
          name: existing.name,
          discountLimitPct: Number(existing.discountLimitPct),
        },
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
      },
      auditDeps(nowIso),
    )

    return { id: existing.id }
  })
}
