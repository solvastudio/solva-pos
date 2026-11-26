import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AttentionReasonClass, CommandType, FlagCode } from '~/lib/contracts'
import { runtimeIdGenerator as syncRepoIdGen } from '~/lib/runtime-id'
import type { TenantTx } from '~/server/db'
import type { CommandContext } from '../domain/command-types'
import { attentionItem, commandFailureAttempt, dataFlag, idempotencyCommand } from './schema'

export interface ExistingIdempotencyRow {
  commandId: string
  commandType: string
  payloadHash: string
  status: string
  result: Record<string, unknown>
}

export async function claimIdempotencyRow(
  tx: TenantTx,
  params: {
    commandId: string
    tenantId: string
    deviceId: string
    registerId: string
    outletId: string
    commandType: string
    channel: 'OUTBOX' | 'ONLINE'
    schemaVersion: number
    deviceSeq: number | null
    payloadHash: string
    payloadSize: number
    requestRef: string | null
    appVersion: string | null
    receivedAtIso: string
  },
): Promise<boolean> {
  const res = await tx
    .insert(idempotencyCommand)
    .values({
      commandId: params.commandId,
      tenantId: params.tenantId,
      deviceId: params.deviceId,
      registerId: params.registerId,
      outletId: params.outletId,
      commandType: params.commandType,
      channel: params.channel,
      schemaVersion: params.schemaVersion,
      deviceSeq: params.deviceSeq,
      payloadHash: params.payloadHash,
      status: 'ACKED',
      result: {},
      payloadSize: params.payloadSize,
      receivedAt: params.receivedAtIso,
      attemptCount: 1,
      requestRef: params.requestRef,
      appVersion: params.appVersion,
    })
    .onConflictDoNothing({ target: idempotencyCommand.commandId })
    .returning({ commandId: idempotencyCommand.commandId })
  return res.length === 1
}

export async function findIdempotencyByCommandId(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
): Promise<ExistingIdempotencyRow | null> {
  const rows = await tx
    .select({
      commandId: idempotencyCommand.commandId,
      commandType: idempotencyCommand.commandType,
      payloadHash: idempotencyCommand.payloadHash,
      status: idempotencyCommand.status,
      result: idempotencyCommand.result,
    })
    .from(idempotencyCommand)
    .where(
      and(
        eq(idempotencyCommand.tenantId, tenantId),
        eq(idempotencyCommand.commandId, commandId),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findAttentionReasonByCommandId(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
): Promise<{ reasonClass: string; reasonCode: string; requestRef: string | null } | null> {
  const rows = await tx
    .select({
      reasonClass: attentionItem.reasonClass,
      reasonCode: attentionItem.reasonCode,
      requestRef: attentionItem.requestRef,
    })
    .from(attentionItem)
    .where(and(eq(attentionItem.tenantId, tenantId), eq(attentionItem.commandId, commandId)))
    .limit(1)
  return rows[0] ?? null
}

export async function incrementAttemptCount(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
): Promise<void> {
  await tx
    .update(idempotencyCommand)
    .set({
      attemptCount: sql`${idempotencyCommand.attemptCount} + 1`,
    })
    .where(
      and(
        eq(idempotencyCommand.tenantId, tenantId),
        eq(idempotencyCommand.commandId, commandId),
      ),
    )
}

export async function findParentCommandStatuses(
  tx: TenantTx,
  tenantId: string,
  commandIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (commandIds.length === 0) return out
  const rows = await tx
    .select({
      commandId: idempotencyCommand.commandId,
      status: idempotencyCommand.status,
    })
    .from(idempotencyCommand)
    .where(
      and(
        eq(idempotencyCommand.tenantId, tenantId),
        inArray(idempotencyCommand.commandId, [...commandIds]),
      ),
    )
  for (const r of rows) {
    out.set(r.commandId, r.status)
  }
  return out
}

export async function completeIdempotencyAck(
  tx: TenantTx,
  params: {
    tenantId: string
    commandId: string
    status?: 'ACKED' | 'ACCEPTED_MANUAL'
    result: Record<string, unknown>
    processedAtIso: string
    durationMs: number
  },
): Promise<void> {
  await tx
    .update(idempotencyCommand)
    .set({
      status: params.status ?? 'ACKED',
      result: params.result,
      processedAt: params.processedAtIso,
      durationMs: params.durationMs,
    })
    .where(
      and(
        eq(idempotencyCommand.tenantId, params.tenantId),
        eq(idempotencyCommand.commandId, params.commandId),
      ),
    )
}

export async function insertAttentionRecord(
  tx: TenantTx,
  params: {
    attentionId: string
    commandId: string
    tenantId: string
    deviceId: string
    registerId: string
    outletId: string
    commandType: string
    schemaVersion: number
    deviceSeq: number
    payloadHash: string
    payloadSize: number
    rawPayload: unknown
    reasonClass: 'STRUCTURAL' | 'AUTHORIZATION'
    reasonCode: string
    detail: string | null
    blockedByCommandId: string | null
    requestRef: string
    appVersion: string | null
    receivedAtIso: string
    durationMs: number
    attemptCount?: number
  },
): Promise<void> {
  await tx
    .insert(idempotencyCommand)
    .values({
      commandId: params.commandId,
      tenantId: params.tenantId,
      deviceId: params.deviceId,
      registerId: params.registerId,
      outletId: params.outletId,
      commandType: params.commandType,
      channel: 'OUTBOX',
      schemaVersion: params.schemaVersion,
      deviceSeq: params.deviceSeq,
      payloadHash: params.payloadHash,
      status: 'ATTENTION',
      result: {},
      payloadSize: params.payloadSize,
      receivedAt: params.receivedAtIso,
      processedAt: params.receivedAtIso,
      durationMs: params.durationMs,
      attemptCount: Math.max(1, params.attemptCount ?? 1),
      requestRef: params.requestRef,
      appVersion: params.appVersion,
    })
    .onConflictDoNothing({ target: idempotencyCommand.commandId })

  await tx
    .insert(attentionItem)
    .values({
      id: params.attentionId,
      tenantId: params.tenantId,
      outletId: params.outletId,
      registerId: params.registerId,
      deviceId: params.deviceId,
      commandId: params.commandId,
      commandType: params.commandType,
      reasonClass: params.reasonClass,
      reasonCode: params.reasonCode,
      detail: params.detail,
      payload: params.rawPayload ?? {},
      blockedByCommandId: params.blockedByCommandId,
      status: 'OPEN',
      requestRef: params.requestRef,
      createdAt: params.receivedAtIso,
      updatedAt: params.receivedAtIso,
    })
    .onConflictDoNothing({ target: attentionItem.commandId })
}

export async function recordCommandFailureAttempt(
  tx: TenantTx,
  params: {
    tenantId: string
    commandId: string
    lastErrorCode: string
    updatedAtIso: string
  },
): Promise<number> {
  const rows = await tx
    .insert(commandFailureAttempt)
    .values({
      commandId: params.commandId,
      tenantId: params.tenantId,
      attemptCount: 1,
      lastErrorCode: params.lastErrorCode,
      updatedAt: params.updatedAtIso,
    })
    .onConflictDoUpdate({
      target: commandFailureAttempt.commandId,
      where: eq(commandFailureAttempt.tenantId, params.tenantId),
      set: {
        attemptCount: sql`${commandFailureAttempt.attemptCount} + 1`,
        lastErrorCode: params.lastErrorCode,
        updatedAt: params.updatedAtIso,
      },
    })
    .returning({ attemptCount: commandFailureAttempt.attemptCount })

  return rows[0]?.attemptCount ?? 1
}

export async function deleteCommandFailureAttempt(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
): Promise<void> {
  await tx
    .delete(commandFailureAttempt)
    .where(
      and(
        eq(commandFailureAttempt.tenantId, tenantId),
        eq(commandFailureAttempt.commandId, commandId),
      ),
    )
}

export async function findCommandStatusesForDevice(
  tx: TenantTx,
  tenantId: string,
  deviceId: string,
  commandIds: readonly string[],
): Promise<Array<{ id: string; status: string }>> {
  if (commandIds.length === 0) return []
  const rows = await tx
    .select({
      id: idempotencyCommand.commandId,
      status: idempotencyCommand.status,
    })
    .from(idempotencyCommand)
    .where(
      and(
        eq(idempotencyCommand.tenantId, tenantId),
        eq(idempotencyCommand.deviceId, deviceId),
        inArray(idempotencyCommand.commandId, [...commandIds]),
      ),
    )
  return rows.map((r) => ({ id: r.id, status: r.status }))
}

/**
 * Inserts an informational `attention_item` inside an ACKed command transaction (e.g. SERIES_CONFLICT)
 * without altering the parent `idempotency_command` status.
 */
export async function createAttentionItem(
  tx: TenantTx,
  ctx: CommandContext,
  params: {
    commandType?: CommandType
    reasonClass: AttentionReasonClass
    reasonCode: string
    detail?: string | null
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const safeDetail = params.detail ? params.detail.slice(0, 500) : null
  await tx
    .insert(attentionItem)
    .values({
      id: syncRepoIdGen.newId(),
      tenantId: ctx.device.tenantId,
      outletId: ctx.device.outletId,
      registerId: ctx.device.registerId,
      deviceId: ctx.device.deviceId,
      commandId: ctx.commandId,
      commandType: params.commandType ?? 'FinalizeSale',
      reasonClass: params.reasonClass,
      reasonCode: params.reasonCode,
      detail: safeDetail,
      payload: params.payload ?? {},
      blockedByCommandId: null,
      status: 'OPEN',
      requestRef: ctx.requestRef,
      createdAt: ctx.receivedAtIso,
      updatedAt: ctx.receivedAtIso,
    })
    .onConflictDoNothing({ target: attentionItem.commandId })
}

export type DataFlagEntityType =
  | 'SALE'
  | 'SALE_LINE'
  | 'CREDIT_NOTE'
  | 'STOCK_MOVEMENT'
  | 'BILL'
  | 'TRANSFER_LINE'

/**
 * Idempotently records a non-blocking business/accounting discrepancy in `data_flag`
 * (`UNIQUE (tenant_id, entity_type, entity_id, flag_code)`).
 */
export async function createDataFlag(
  tx: TenantTx,
  params: {
    tenantId?: string
    outletId: string
    businessDate: string
    flagCode: FlagCode
    severity?: 'INFO' | 'WARN'
    entityType: DataFlagEntityType
    entityId: string
    parentId?: string | null
    diffAmount?: number | null
    detail?: Record<string, unknown> | null
    commandId?: string | null
  },
): Promise<boolean> {
  let tenantId = params.tenantId
  if (!tenantId) {
    const res = await tx.execute(
      sql`SELECT NULLIF(current_setting('app.tenant_id', true), '')::text AS tid`,
    )
    tenantId = (res.rows[0] as { tid?: string | null } | undefined)?.tid ?? undefined
    if (!tenantId) {
      throw new Error('createDataFlag requires active tenant context or tenantId')
    }
  }

  const inserted = await tx
    .insert(dataFlag)
    .values({
      id: syncRepoIdGen.newId(),
      tenantId,
      outletId: params.outletId,
      businessDate: params.businessDate,
      flagCode: params.flagCode,
      severity: params.severity ?? 'WARN',
      entityType: params.entityType,
      entityId: params.entityId,
      parentId: params.parentId ?? null,
      diffAmount: params.diffAmount ?? null,
      detail: params.detail ?? null,
      commandId: params.commandId ?? null,
      status: 'OPEN',
    })
    .onConflictDoNothing({
      target: [dataFlag.tenantId, dataFlag.entityType, dataFlag.entityId, dataFlag.flagCode],
    })
    .returning({ id: dataFlag.id })

  return inserted.length === 1
}
