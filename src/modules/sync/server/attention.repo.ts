import '@tanstack/react-start/server-only'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { attentionItem, idempotencyCommand } from './schema'

export interface AttentionDbRow {
  readonly id: string
  readonly tenantId: string
  readonly outletId: string
  readonly registerId: string
  readonly registerCode: string | null
  readonly deviceId: string
  readonly commandId: string
  readonly commandType: string
  readonly reasonClass: string
  readonly reasonCode: string
  readonly detail: string | null
  readonly payload: unknown
  readonly blockedByCommandId: string | null
  readonly status: string
  readonly resolutionNote: string | null
  readonly resolvedBy: string | null
  readonly resolvedAt: string | null
  readonly requestRef: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export async function listAttentionRows(
  tx: TenantTx,
  tenantId: string,
  filter: {
    statuses: readonly string[]
    outletId?: string | null
    allowedOutletIds: readonly string[] | null
  },
): Promise<AttentionDbRow[]> {
  const conditions = [eq(attentionItem.tenantId, tenantId)]
  if (filter.statuses.length > 0) {
    conditions.push(inArray(attentionItem.status, [...filter.statuses]))
  }
  if (filter.outletId) {
    conditions.push(eq(attentionItem.outletId, filter.outletId))
  } else if (filter.allowedOutletIds !== null) {
    if (filter.allowedOutletIds.length === 0) return []
    conditions.push(inArray(attentionItem.outletId, [...filter.allowedOutletIds]))
  }

  const rows = await tx
    .select({
      id: attentionItem.id,
      tenantId: attentionItem.tenantId,
      outletId: attentionItem.outletId,
      registerId: attentionItem.registerId,
      deviceId: attentionItem.deviceId,
      commandId: attentionItem.commandId,
      commandType: attentionItem.commandType,
      reasonClass: attentionItem.reasonClass,
      reasonCode: attentionItem.reasonCode,
      detail: attentionItem.detail,
      payload: attentionItem.payload,
      blockedByCommandId: attentionItem.blockedByCommandId,
      status: attentionItem.status,
      resolutionNote: attentionItem.resolutionNote,
      resolvedBy: attentionItem.resolvedBy,
      resolvedAt: attentionItem.resolvedAt,
      requestRef: attentionItem.requestRef,
      createdAt: attentionItem.createdAt,
      updatedAt: attentionItem.updatedAt,
    })
    .from(attentionItem)
    .where(and(...conditions))
    .orderBy(desc(attentionItem.createdAt))
    .limit(200)

  if (rows.length === 0) return []

  const regIds = [...new Set(rows.map((r) => r.registerId))]
  const regCodeMap = new Map<string, string>()
  const regIdList = sql.join(
    regIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )
  const regRes = await tx.execute(
    sql`SELECT id, code FROM cash_master WHERE tenant_id = ${tenantId}::uuid AND id IN (${regIdList})`,
  )
  for (const r of regRes.rows as Array<{ id: string; code: string }>) {
    regCodeMap.set(r.id.toLowerCase(), r.code)
  }

  return rows.map((r) => ({
    ...r,
    registerCode: regCodeMap.get(r.registerId.toLowerCase()) ?? null,
  }))
}

export interface LockedAttentionAndCommand {
  readonly item: typeof attentionItem.$inferSelect
  readonly command: typeof idempotencyCommand.$inferSelect
  readonly registerType: 'CASHIER' | 'WAITER'
}

export async function lockAttentionAndCommand(
  tx: TenantTx,
  tenantId: string,
  itemId: string,
): Promise<LockedAttentionAndCommand | null> {
  const items = await tx
    .select()
    .from(attentionItem)
    .where(and(eq(attentionItem.tenantId, tenantId), eq(attentionItem.id, itemId)))
    .for('update')
    .limit(1)

  const item = items[0]
  if (!item) return null

  const cmds = await tx
    .select()
    .from(idempotencyCommand)
    .where(
      and(
        eq(idempotencyCommand.tenantId, tenantId),
        eq(idempotencyCommand.commandId, item.commandId),
      ),
    )
    .for('update')
    .limit(1)

  const command = cmds[0]
  if (!command) return null

  const regRes = await tx.execute(
    sql`SELECT register_type FROM cash_master WHERE tenant_id = ${tenantId}::uuid AND id = ${item.registerId}::uuid LIMIT 1`,
  )
  const rawType = (regRes.rows[0] as { register_type?: unknown } | undefined)?.register_type
  const registerType: 'CASHIER' | 'WAITER' = rawType === 'WAITER' ? 'WAITER' : 'CASHIER'

  return { item, command, registerType }
}

export async function updateAttentionStatus(
  tx: TenantTx,
  tenantId: string,
  itemId: string,
  patch: {
    status: 'ACCEPTED' | 'DISMISSED' | 'ESCALATED'
    resolutionNote?: string | null
    resolvedBy?: string | null
    resolvedAt?: string | null
    updatedAt: string
  },
): Promise<void> {
  await tx
    .update(attentionItem)
    .set({
      status: patch.status,
      ...(patch.resolutionNote !== undefined ? { resolutionNote: patch.resolutionNote } : {}),
      ...(patch.resolvedBy !== undefined ? { resolvedBy: patch.resolvedBy } : {}),
      ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
      updatedAt: patch.updatedAt,
    })
    .where(and(eq(attentionItem.tenantId, tenantId), eq(attentionItem.id, itemId)))
}

export async function updateIdempotencyDismissed(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
  processedAtIso: string,
): Promise<void> {
  await tx
    .update(idempotencyCommand)
    .set({
      status: 'DISMISSED',
      processedAt: processedAtIso,
    })
    .where(
      and(
        eq(idempotencyCommand.tenantId, tenantId),
        eq(idempotencyCommand.commandId, commandId),
      ),
    )
}

export interface ImportDeviceInfo {
  readonly deviceId: string
  readonly registerId: string
  readonly outletId: string
  readonly registerType: 'CASHIER' | 'WAITER'
}

/**
 * Resolves `(deviceId, registerId)` inside `tenantId` for pending recovery file import.
 * Deliberately permits revoked devices so lost/revoked terminals' exported offline sales
 * can still be imported (FLOW-16), while strictly rejecting cross-tenant or mismatched IDs.
 */
export async function findDeviceAndRegisterForImport(
  tx: TenantTx,
  tenantId: string,
  deviceId: string,
  registerId: string,
): Promise<ImportDeviceInfo | null> {
  const res = await tx.execute(
    sql`
      SELECT d.id AS device_id, d.register_id, c.outlet_id, c.register_type
      FROM device d
      JOIN cash_master c
        ON c.tenant_id = d.tenant_id
       AND c.id = d.register_id
      WHERE d.tenant_id = ${tenantId}::uuid
        AND d.id = ${deviceId}::uuid
        AND d.register_id = ${registerId}::uuid
      LIMIT 1
    `,
  )
  const row = res.rows[0] as
    | {
        device_id: string
        register_id: string
        outlet_id: string
        register_type: string
      }
    | undefined

  if (!row) return null
  return {
    deviceId: row.device_id,
    registerId: row.register_id,
    outletId: row.outlet_id,
    registerType: row.register_type === 'WAITER' ? 'WAITER' : 'CASHIER',
  }
}
