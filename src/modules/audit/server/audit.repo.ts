import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import { auditChainHead, auditLog } from './schema'

export const GENESIS_HASH: Buffer = createHash('sha256')
  .update('solva-pos:audit:genesis')
  .digest()

export type AuditLogRow = typeof auditLog.$inferSelect
export type NewAuditLogRow = typeof auditLog.$inferInsert

const EXPLICIT_AUDIT_COLUMNS = {
  id: auditLog.id,
  tenantId: auditLog.tenantId,
  chainSeq: auditLog.chainSeq,
  outletId: auditLog.outletId,
  registerId: auditLog.registerId,
  deviceId: auditLog.deviceId,
  actorUserId: auditLog.actorUserId,
  approverUserId: auditLog.approverUserId,
  action: auditLog.action,
  entityType: auditLog.entityType,
  entityId: auditLog.entityId,
  beforeData: auditLog.beforeData,
  afterData: auditLog.afterData,
  reasonCode: auditLog.reasonCode,
  reasonText: auditLog.reasonText,
  occurredAtDevice: auditLog.occurredAtDevice,
  clockOffsetMs: auditLog.clockOffsetMs,
  occurredAt: auditLog.occurredAt,
  recordedAt: auditLog.recordedAt,
  businessDate: auditLog.businessDate,
  commandId: auditLog.commandId,
  requestRef: auditLog.requestRef,
  schemaVersion: auditLog.schemaVersion,
  appVersion: auditLog.appVersion,
  prevHash: auditLog.prevHash,
  rowHash: auditLog.rowHash,
}

export async function ensureHead(tx: TenantTx, tenantId: string): Promise<void> {
  await tx
    .insert(auditChainHead)
    .values({
      tenantId,
      lastSeq: 0,
      lastHash: GENESIS_HASH,
    })
    .onConflictDoNothing()
}

export async function lockHead(
  tx: TenantTx,
  tenantId: string,
): Promise<{ lastSeq: number; lastHash: Buffer } | null> {
  const rows = await tx
    .select({
      lastSeq: auditChainHead.lastSeq,
      lastHash: auditChainHead.lastHash,
    })
    .from(auditChainHead)
    .where(eq(auditChainHead.tenantId, tenantId))
    .for('update')
  return rows[0] ?? null
}

export async function findById(
  tx: TenantTx,
  id: string,
): Promise<{ id: string; chainSeq: number } | null> {
  const rows = await tx
    .select({
      id: auditLog.id,
      chainSeq: auditLog.chainSeq,
    })
    .from(auditLog)
    .where(eq(auditLog.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findByChainSeq(
  tx: TenantTx,
  tenantId: string,
  chainSeq: number,
): Promise<AuditLogRow | null> {
  const rows = await tx
    .select(EXPLICIT_AUDIT_COLUMNS)
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.chainSeq, chainSeq)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertEntry(tx: TenantTx, row: NewAuditLogRow): Promise<void> {
  await tx.insert(auditLog).values(row)
}

export async function updateHead(
  tx: TenantTx,
  tenantId: string,
  seq: number,
  hash: Buffer,
  nowIso: string,
): Promise<void> {
  await tx
    .update(auditChainHead)
    .set({
      lastSeq: seq,
      lastHash: hash,
      updatedAt: nowIso,
    })
    .where(eq(auditChainHead.tenantId, tenantId))
}

export async function readRange(
  tx: TenantTx,
  tenantId: string,
  fromSeq: number,
  toSeq: number | null,
  limit = 500,
): Promise<AuditLogRow[]> {
  const conditions = [eq(auditLog.tenantId, tenantId), gte(auditLog.chainSeq, fromSeq)]
  if (toSeq !== null) {
    conditions.push(lte(auditLog.chainSeq, toSeq))
  }

  return tx
    .select(EXPLICIT_AUDIT_COLUMNS)
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(asc(auditLog.chainSeq))
    .limit(limit)
}

export async function tenantUserExists(
  tx: TenantTx,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const res = await tx.execute(
    sql`SELECT 1 FROM app_user
        WHERE tenant_id = ${tenantId}::uuid
          AND id = ${userId}::uuid
          AND deleted_at IS NULL
        LIMIT 1`,
  )
  return res.rows.length > 0
}

export async function tenantCommandExists(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
): Promise<boolean> {
  const res = await tx.execute(
    sql`SELECT 1 FROM idempotency_command
        WHERE tenant_id = ${tenantId}::uuid
          AND command_id = ${commandId}::uuid
        LIMIT 1`,
  )
  return res.rows.length > 0
}
