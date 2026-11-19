import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { parseIsoUtcMs } from '~/lib/kernel'
import type { TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { isAuditAction } from '../domain/actions'
import { canonicalizeAudit, type CanonicalAuditFields } from '../domain/canonical'
import { assertNoSensitive } from '../domain/redaction'
import {
  ensureHead,
  findByChainSeq,
  findById,
  GENESIS_HASH,
  insertEntry,
  lockHead,
  readRange,
  updateHead,
} from './audit.repo'

export interface AuditEntryInput {
  id?: string
  action: string
  entityType: string
  entityId?: string | null
  beforeData?: unknown
  afterData?: unknown
  reasonCode?: string | null
  reasonText?: string | null
  actorUserId?: string | null
  approverUserId?: string | null
  outletId?: string | null
  registerId?: string | null
  deviceId?: string | null
  occurredAtDevice?: string | null
  clockOffsetMs?: number | null
  occurredAt: string
  businessDate?: string | null
  commandId?: string | null
  requestRef?: string | null
  schemaVersion?: number | null
  appVersion?: string | null
}

export type VerifyAuditChainResult =
  | { ok: true; checked: number }
  | { ok: false; brokenAtSeq: number; reason: 'PREV_HASH' | 'ROW_HASH' | 'SEQ_GAP' }

const PAGE_SIZE = 500

function normalizeIsoMs(iso: string): string {
  const ms = parseIsoUtcMs(iso)
  return new Date(ms).toISOString()
}

function normalizeOptionalIsoMs(iso: string | null | undefined): string | null {
  if (iso === undefined || iso === null) return null
  return normalizeIsoMs(iso)
}

function computeRowHash(prevHash: Buffer, fields: CanonicalAuditFields): Buffer {
  const canonical = canonicalizeAudit(fields)
  return createHash('sha256')
    .update(prevHash)
    .update(Buffer.from(canonical, 'utf8'))
    .digest()
}

async function currentTenantId(tx: TenantTx): Promise<string> {
  const res = await tx.execute(
    sql`SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS tenant_id`,
  )
  const raw = (res.rows[0] as { tenant_id?: unknown } | undefined)?.tenant_id
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('FORBIDDEN', 'Missing tenant context for audit operation')
  }
  return raw.toLowerCase()
}

export async function appendAudit(
  tx: TenantTx,
  input: AuditEntryInput,
  deps: { newId: () => string; nowIso: () => string },
): Promise<{ id: string; chainSeq: number; replay: boolean }> {
  if (!isAuditAction(input.action)) {
    throw new AppError('VALIDATION_FAILED', `Unknown audit action: "${input.action}"`)
  }

  try {
    assertNoSensitive(input.beforeData)
    assertNoSensitive(input.afterData)
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', err instanceof Error ? err.message : 'Sensitive field rejected')
  }

  const actorUserId = input.actorUserId ?? null
  const approverUserId = input.approverUserId ?? null
  if (actorUserId !== null && approverUserId !== null && actorUserId === approverUserId) {
    throw new AppError('VALIDATION_FAILED', 'Approver must be different from actor')
  }

  const id = input.id ?? deps.newId()

  if (input.id) {
    const existing = await findById(tx, input.id)
    if (existing) {
      return { id: existing.id, chainSeq: existing.chainSeq, replay: true }
    }
  }

  const tenantId = await currentTenantId(tx)
  await ensureHead(tx, tenantId)
  const head = await lockHead(tx, tenantId)
  if (!head) {
    throw new AppError('INTERNAL_ERROR', 'Failed to lock audit chain head')
  }

  const chainSeq = head.lastSeq + 1
  const prevHash = head.lastHash
  const occurredAt = normalizeIsoMs(input.occurredAt)
  const occurredAtDevice = normalizeOptionalIsoMs(input.occurredAtDevice)
  const recordedAt = normalizeIsoMs(deps.nowIso())

  const canonicalFields: CanonicalAuditFields = {
    id,
    tenantId,
    chainSeq,
    outletId: input.outletId ?? null,
    registerId: input.registerId ?? null,
    deviceId: input.deviceId ?? null,
    actorUserId,
    approverUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeData: input.beforeData ?? null,
    afterData: input.afterData ?? null,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    occurredAtDevice,
    clockOffsetMs: input.clockOffsetMs ?? null,
    occurredAt,
    recordedAt,
    businessDate: input.businessDate ?? null,
    commandId: input.commandId ?? null,
    requestRef: input.requestRef ?? null,
    schemaVersion: input.schemaVersion ?? null,
    appVersion: input.appVersion ?? null,
  }

  const rowHash = computeRowHash(prevHash, canonicalFields)

  await insertEntry(tx, {
    ...canonicalFields,
    prevHash,
    rowHash,
  })
  await updateHead(tx, tenantId, chainSeq, rowHash, recordedAt)

  return { id, chainSeq, replay: false }
}

export async function verifyAuditChain(
  tx: TenantTx,
  opts?: { fromSeq?: number; toSeq?: number },
): Promise<VerifyAuditChainResult> {
  const tenantId = await currentTenantId(tx)
  const fromSeq = opts?.fromSeq ?? 1
  const toSeq = opts?.toSeq ?? null

  if (!Number.isSafeInteger(fromSeq) || fromSeq < 1) {
    throw new AppError('VALIDATION_FAILED', `Invalid fromSeq: ${fromSeq}`)
  }
  if (toSeq !== null && (!Number.isSafeInteger(toSeq) || toSeq < fromSeq)) {
    throw new AppError('VALIDATION_FAILED', `Invalid toSeq: ${toSeq}`)
  }

  let expectedSeq = fromSeq
  let expectedPrevHash: Buffer = GENESIS_HASH

  if (fromSeq > 1) {
    const anchor = await findByChainSeq(tx, tenantId, fromSeq - 1)
    if (!anchor) {
      const firstAfter = await readRange(tx, tenantId, fromSeq, toSeq, 1)
      if (firstAfter.length > 0) {
        return { ok: false, brokenAtSeq: fromSeq - 1, reason: 'SEQ_GAP' }
      }
      return { ok: true, checked: 0 }
    }
    expectedPrevHash = anchor.rowHash
  }

  let checked = 0
  let cursorSeq = fromSeq

  while (true) {
    const batch = await readRange(tx, tenantId, cursorSeq, toSeq, PAGE_SIZE)
    if (batch.length === 0) break

    for (const row of batch) {
      if (row.chainSeq !== expectedSeq) {
        return { ok: false, brokenAtSeq: expectedSeq, reason: 'SEQ_GAP' }
      }
      if (!row.prevHash.equals(expectedPrevHash)) {
        return { ok: false, brokenAtSeq: row.chainSeq, reason: 'PREV_HASH' }
      }

      const recomputed = computeRowHash(row.prevHash, {
        id: row.id,
        tenantId: row.tenantId,
        chainSeq: row.chainSeq,
        outletId: row.outletId,
        registerId: row.registerId,
        deviceId: row.deviceId,
        actorUserId: row.actorUserId,
        approverUserId: row.approverUserId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        beforeData: row.beforeData,
        afterData: row.afterData,
        reasonCode: row.reasonCode,
        reasonText: row.reasonText,
        occurredAtDevice: row.occurredAtDevice,
        clockOffsetMs: row.clockOffsetMs,
        occurredAt: row.occurredAt,
        recordedAt: row.recordedAt,
        businessDate: row.businessDate,
        commandId: row.commandId,
        requestRef: row.requestRef,
        schemaVersion: row.schemaVersion,
        appVersion: row.appVersion,
      })

      if (!row.rowHash.equals(recomputed)) {
        return { ok: false, brokenAtSeq: row.chainSeq, reason: 'ROW_HASH' }
      }

      checked += 1
      expectedSeq += 1
      expectedPrevHash = row.rowHash
    }

    cursorSeq = batch[batch.length - 1]!.chainSeq + 1
    if (batch.length < PAGE_SIZE || (toSeq !== null && cursorSeq > toSeq)) {
      break
    }
  }

  return { ok: true, checked }
}
