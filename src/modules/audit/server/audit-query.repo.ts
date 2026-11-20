import '@tanstack/react-start/server-only'
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { TenantTx } from '~/server/db'
import type { AuditJsonValue, AuditLogView, AuditQueryFilter } from '../shared'
import { auditLog } from './schema'

function normalizeStartBound(raw: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw
}

function normalizeEndBound(raw: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw
}

export async function queryAuditRows(
  tx: TenantTx,
  tenantId: string,
  filter: AuditQueryFilter & { allowedOutletIds: readonly string[] | null },
): Promise<AuditLogView[]> {
  const conditions: SQL[] = [eq(auditLog.tenantId, tenantId)]

  if (filter.outletId) {
    conditions.push(eq(auditLog.outletId, filter.outletId))
  } else if (filter.allowedOutletIds !== null) {
    if (filter.allowedOutletIds.length === 0) return []
    conditions.push(
      or(isNull(auditLog.outletId), inArray(auditLog.outletId, [...filter.allowedOutletIds]))!,
    )
  }

  if (filter.actorUserId) {
    conditions.push(eq(auditLog.actorUserId, filter.actorUserId))
  }
  if (filter.action) {
    conditions.push(eq(auditLog.action, filter.action))
  }
  if (filter.fromDate) {
    conditions.push(gte(auditLog.occurredAt, normalizeStartBound(filter.fromDate)))
  }
  if (filter.toDate) {
    conditions.push(lte(auditLog.occurredAt, normalizeEndBound(filter.toDate)))
  }

  const limit = Math.max(1, Math.min(500, filter.limit ?? 100))
  const offset = Math.max(0, filter.offset ?? 0)
  const orderClause = filter.sort === 'asc' ? asc(auditLog.chainSeq) : desc(auditLog.chainSeq)

  const rows = await tx
    .select({
      id: auditLog.id,
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
      occurredAt: auditLog.occurredAt,
      recordedAt: auditLog.recordedAt,
      businessDate: auditLog.businessDate,
    })
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(orderClause)
    .limit(limit)
    .offset(offset)

  if (rows.length === 0) return []

  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.actorUserId, r.approverUserId])
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const outletIds = [
    ...new Set(rows.map((r) => r.outletId).filter((id): id is string => Boolean(id))),
  ]

  const userNameMap = new Map<string, string>()
  if (userIds.length > 0) {
    const userIdList = sql.join(
      userIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )
    const userRes = await tx.execute(
      sql`SELECT id, display_name FROM app_user WHERE tenant_id = ${tenantId}::uuid AND id IN (${userIdList})`,
    )
    for (const u of userRes.rows as Array<{ id: string; display_name: string }>) {
      userNameMap.set(u.id.toLowerCase(), u.display_name)
    }
  }

  const outletMap = new Map<string, { name: string; timezone: string }>()
  if (outletIds.length > 0) {
    const outletIdList = sql.join(
      outletIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )
    const outletRes = await tx.execute(
      sql`SELECT id, name, timezone FROM outlet WHERE tenant_id = ${tenantId}::uuid AND id IN (${outletIdList})`,
    )
    for (const o of outletRes.rows as Array<{ id: string; name: string; timezone: string }>) {
      outletMap.set(o.id.toLowerCase(), { name: o.name, timezone: o.timezone })
    }
  }

  return rows.map((r) => {
    const outInfo = r.outletId ? outletMap.get(r.outletId.toLowerCase()) : undefined
    return {
      ...r,
      beforeData: (r.beforeData ?? null) as AuditJsonValue,
      afterData: (r.afterData ?? null) as AuditJsonValue,
      actorName: r.actorUserId ? (userNameMap.get(r.actorUserId.toLowerCase()) ?? null) : null,
      approverName: r.approverUserId
        ? (userNameMap.get(r.approverUserId.toLowerCase()) ?? null)
        : null,
      outletName: outInfo?.name ?? null,
      outletTimezone: outInfo?.timezone ?? null,
    }
  })
}
