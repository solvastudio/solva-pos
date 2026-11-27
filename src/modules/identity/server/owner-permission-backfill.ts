import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { runtimeIdGenerator } from '~/lib/runtime-id'
import { writeMaster } from '~/modules/sync/public'
import { withNoTenant, withTenant } from '~/server/db'
import { createLogger } from '~/server/log'
import { OWNER_ROLE_CODE } from '../domain/default-roles'
import { PERMISSION_CODES } from '../domain/permissions'
import { findRoleByCode, listRolePermissionCodes, syncRolePermissionsRows } from './role.repo'

const log = createLogger('jobs')

export interface OwnerPermissionBackfillDeps {
  tenantIds?: readonly string[]
}

export interface OwnerPermissionBackfillResult {
  tenantsChecked: number
  tenantsRepaired: number
}

/**
 * Makes the OWNER role of one tenant hold every permission in the code catalog.
 * Returns true when at least one permission had to be (re)granted.
 */
export async function ensureOwnerHasAllPermissionsForTenant(
  tenantId: string,
  nowIso: string = new Date().toISOString(),
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const owner = await findRoleByCode(tx, tenantId, OWNER_ROLE_CODE)
    if (!owner) {
      return false
    }
    const held = await listRolePermissionCodes(tx, tenantId, owner.id)
    if (PERMISSION_CODES.every((code) => held.has(code))) {
      return false
    }
    await writeMaster(tx, { actorUserId: null }, (w) =>
      syncRolePermissionsRows(tx, w, {
        roleId: owner.id,
        desiredCodes: new Set<string>(PERMISSION_CODES),
        newId: () => runtimeIdGenerator.newId(),
        nowIso,
      }),
    )
    return true
  })
}

/**
 * Sweeps every active tenant and repairs OWNER permissions (new catalog entries reach existing tenants).
 */
export async function ensureOwnerHasAllPermissions(
  deps?: OwnerPermissionBackfillDeps,
): Promise<OwnerPermissionBackfillResult> {
  const tenantIds =
    deps?.tenantIds ??
    (await withNoTenant(async (tx) => {
      const res = await tx.execute(sql`SELECT id FROM list_active_tenants()`)
      return res.rows.map((r) => String((r as { id: unknown }).id).toLowerCase())
    }))

  let tenantsRepaired = 0
  for (const tenantId of tenantIds) {
    try {
      if (await ensureOwnerHasAllPermissionsForTenant(tenantId)) {
        tenantsRepaired += 1
        log.info(
          { jobId: 'identity.ensure_owner_permissions', tenantId, outcome: 'ACK' },
          'owner permissions repaired',
        )
      }
    } catch (err: unknown) {
      log.warn(
        { err, jobId: 'identity.ensure_owner_permissions', tenantId },
        'owner permission repair failed',
      )
    }
  }
  return { tenantsChecked: tenantIds.length, tenantsRepaired }
}
