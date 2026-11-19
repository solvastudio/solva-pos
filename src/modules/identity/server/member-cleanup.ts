import '@tanstack/react-start/server-only'
import { writeMaster } from '~/modules/sync/public'
import { withNoTenant, withTenant } from '~/server/db'
import {
  deleteSettledOrOldMemberCodes,
  listActiveTenantIds,
  listOrphanPendingAppUsers,
  softDeleteAppUserAndOutlets,
} from './member-code.repo'

const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface PurgeMemberCodesResult {
  tenantsProcessed: number
  codesDeleted: number
  orphanProfilesDeleted: number
}

/**
 * Purges settled/expired `member_code` rows older than 7 days and soft-deletes
 * orphan `PENDING` `app_user` profiles that no longer have any code history.
 */
export async function purgeMemberCodes(
  nowIso: string = new Date().toISOString(),
): Promise<PurgeMemberCodesResult> {
  const cutoffIso = new Date(Date.parse(nowIso) - CLEANUP_RETENTION_MS).toISOString()
  const tenantIds = await withNoTenant((tx) => listActiveTenantIds(tx))

  let codesDeleted = 0
  let orphanProfilesDeleted = 0

  for (const tenantId of tenantIds) {
    await withTenant(tenantId, async (tx) => {
      codesDeleted += await deleteSettledOrOldMemberCodes(tx, tenantId, cutoffIso)
      const orphanIds = await listOrphanPendingAppUsers(tx, tenantId)
      if (orphanIds.length > 0) {
        await writeMaster(tx, { actorUserId: null }, async (w) => {
          for (const orphanId of orphanIds) {
            await softDeleteAppUserAndOutlets(tx, w, orphanId, nowIso)
          }
          return true
        })
        orphanProfilesDeleted += orphanIds.length
      }
    })
  }

  return {
    tenantsProcessed: tenantIds.length,
    codesDeleted,
    orphanProfilesDeleted,
  }
}
