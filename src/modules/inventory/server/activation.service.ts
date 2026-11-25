import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { isUuid } from '~/lib/kernel'
import { requireActorPermission, type IdentityAuthActor } from '~/modules/identity/public'
import { writeMaster } from '~/modules/sync/public'
import { AppError } from '~/server/error-classify'
import { withTenant } from '~/server/db'
import { auditInventoryEvent } from './audit'

/**
 * Enables outlet stock tracking (BR-STK-004). Cannot be disabled again in the MVP.
 * Applied through `writeMaster` (outlet = class M master) so devices receive the change.
 */
export async function enableOutletTracking(actor: IdentityAuthActor, outletId: string): Promise<{ enabledAt: string }> {
  if (!isUuid(outletId)) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.outletInvalid')
  requireActorPermission(actor, 'inventory.manage', { outletId })
  return withTenant(actor.tenantId, async (tx) => {
    const cur = await tx.execute<{ inventory_enabled_at: string | null }>(sql`
      SELECT inventory_enabled_at::text AS inventory_enabled_at FROM outlet
      WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${outletId}::uuid
      FOR UPDATE
    `)
    const row = cur.rows[0]
    if (!row) throw new AppError('VALIDATION_FAILED', 'admin.stock.err.outletNotFound')
    if (row.inventory_enabled_at) {
      // Postgres text format is not ISO; return ISO UTC so it matches the first call.
      return { enabledAt: new Date(row.inventory_enabled_at).toISOString() }
    }
    const enabledAt = new Date().toISOString()
    await writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      await tx.execute(sql`
        UPDATE outlet
        SET inventory_enabled_at = ${enabledAt}::timestamptz, version = ${w.version}, updated_at = now(), updated_by = ${actor.appUserId}::uuid
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${outletId}::uuid
      `)
    })
    await auditInventoryEvent(tx, {
      action: 'outlet.changed',
      entityType: 'outlet',
      entityId: outletId,
      outletId,
      actorUserId: actor.appUserId,
      afterData: { inventory_enabled_at: enabledAt },
    })
    return { enabledAt }
  })
}
