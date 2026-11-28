import '@tanstack/react-start/server-only'
import type { PushCommandEnvelope } from '~/lib/contracts'
import { isUuid } from '~/lib/kernel'
import { runtimeIdGenerator as attentionIdGen } from '~/lib/runtime-id'
import { withTenant, withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { CommandRejected, type SyncDeviceIdentity } from '../domain/command-types'
import type { AttentionItemView, AttentionPayloadSummary, SyncJsonValue } from '../shared'
import {
  listAttentionRows,
  lockAttentionAndCommand,
  updateAttentionStatus,
  updateIdempotencyDismissed,
} from './attention.repo'
import { getSyncAuditWriter } from './device-status-port'
import { processCommandAs } from './push.service'

export interface SyncAdminActor {
  readonly tenantId: string
  readonly appUserId: string
  readonly outletIds?: readonly string[] | null
  readonly permissions: ReadonlySet<string> | readonly string[]
}

export function hasSyncActorPermission(actor: SyncAdminActor, code: string): boolean {
  return actor.permissions instanceof Set
    ? actor.permissions.has(code)
    : (actor.permissions as readonly string[]).includes(code)
}

function assertAttentionPermission(actor: SyncAdminActor, outletId?: string | null): void {
  if (!hasSyncActorPermission(actor, 'user.manage')) {
    throw new AppError('FORBIDDEN', 'Missing permission user.manage')
  }
  // Only `null` grants every outlet; a missing scope (undefined) fails closed to no outlets.
  const outletIds = actor.outletIds === undefined ? [] : actor.outletIds
  if (outletId && outletIds !== null && !outletIds.includes(outletId)) {
    throw new AppError('FORBIDDEN', 'Outlet outside actor scope')
  }
}

export function canAcceptManualReason(reasonClass: string, reasonCode: string): boolean {
  if (reasonClass === 'AUTHORIZATION') return true
  return reasonClass === 'STRUCTURAL' && reasonCode === 'UNKNOWN_REFERENCE'
}

/**
 * Builds a sanitized display summary from command payload strictly omitting sensitive
 * PII fields such as `customer_name` and `customer_phone`.
 */
export function buildAttentionSummary(
  commandType: string,
  rawPayload: unknown,
): AttentionPayloadSummary {
  if (!rawPayload || typeof rawPayload !== 'object') return {}
  const p = rawPayload as Record<string, unknown>

  if (commandType === 'FinalizeSale' && p.sale && typeof p.sale === 'object') {
    const s = p.sale as Record<string, unknown>
    const lines = Array.isArray(p.lines) ? p.lines.length : null
    const amt =
      typeof s.total_due === 'number'
        ? s.total_due
        : typeof s.grand_total === 'number'
          ? s.grand_total
          : null
    return {
      invoiceNo: typeof s.invoice_no === 'string' ? s.invoice_no : null,
      totalDue: amt,
      lineCount: lines,
      shiftId: typeof s.shift_id === 'string' ? s.shift_id : null,
    }
  }
  if (commandType === 'FinalizeCreditNote' && p.credit_note && typeof p.credit_note === 'object') {
    const cn = p.credit_note as Record<string, unknown>
    const lines = Array.isArray(p.lines) ? p.lines.length : null
    return {
      cnNo: typeof cn.cn_no === 'string' ? cn.cn_no : null,
      invoiceNo: typeof cn.original_invoice_no === 'string' ? cn.original_invoice_no : null,
      totalDue: typeof cn.refund_gross === 'number' ? cn.refund_gross : null,
      lineCount: lines,
    }
  }
  if (commandType === 'RecordCashMovement' && p.movement && typeof p.movement === 'object') {
    const m = p.movement as Record<string, unknown>
    return {
      direction: typeof m.direction === 'string' ? m.direction : null,
      totalDue: typeof m.amount === 'number' ? m.amount : null,
      shiftId: typeof m.shift_id === 'string' ? m.shift_id : null,
    }
  }
  if ((commandType === 'OpenShift' || commandType === 'CloseShift') && typeof p === 'object') {
    const s = (p.shift ?? p.close) as Record<string, unknown> | undefined
    return {
      shiftId: typeof (s?.id ?? s?.shift_id) === 'string' ? String(s?.id ?? s?.shift_id) : null,
    }
  }
  return {}
}

export async function listAttention(
  actor: SyncAdminActor,
  filter?: { status?: string; outletId?: string | null },
): Promise<AttentionItemView[]> {
  assertAttentionPermission(actor, filter?.outletId)
  const statuses =
    filter?.status === 'ALL'
      ? ['OPEN', 'ESCALATED', 'ACCEPTED', 'DISMISSED']
      : filter?.status
        ? [filter.status]
        : ['OPEN', 'ESCALATED']

  const rows = await withTenantReadOnly(actor.tenantId, (tx) =>
    listAttentionRows(tx, actor.tenantId, {
      statuses,
      outletId: filter?.outletId ?? null,
      allowedOutletIds: actor.outletIds === undefined ? [] : actor.outletIds,
    }),
  )

  const canViewRaw = hasSyncActorPermission(actor, 'user.manage')
  return rows.map((r) => ({
    id: r.id,
    outletId: r.outletId,
    registerId: r.registerId,
    registerCode: r.registerCode,
    deviceId: r.deviceId,
    commandId: r.commandId,
    commandType: r.commandType,
    reasonClass: r.reasonClass === 'AUTHORIZATION' ? 'AUTHORIZATION' : 'STRUCTURAL',
    reasonCode: r.reasonCode,
    detail: r.detail,
    blockedByCommandId: r.blockedByCommandId,
    status: (r.status as AttentionItemView['status']) ?? 'OPEN',
    canAcceptManual:
      (r.status === 'OPEN' || r.status === 'ESCALATED') &&
      canAcceptManualReason(r.reasonClass, r.reasonCode),
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
    requestRef: r.requestRef,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    summary: buildAttentionSummary(r.commandType, r.payload),
    rawPayload: (canViewRaw ? (r.payload ?? null) : null) as SyncJsonValue,
  }))
}

export async function acceptManual(
  actor: SyncAdminActor,
  itemId: string,
  deps?: { nowIso?: () => string; requestRef?: string },
): Promise<{ id: string; status: 'ACCEPTED'; replay: boolean }> {
  assertAttentionPermission(actor)
  if (!isUuid(itemId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid attention itemId')
  }
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const requestRef = deps?.requestRef ?? `man-${itemId.slice(0, 8)}`

  return withTenant(actor.tenantId, async (tx) => {
    const locked = await lockAttentionAndCommand(tx, actor.tenantId, itemId)
    if (!locked) {
      throw new AppError('VALIDATION_FAILED', 'Attention item not found')
    }
    const { item, command, registerType } = locked
    assertAttentionPermission(actor, item.outletId)

    if (item.status === 'ACCEPTED' || command.status === 'ACCEPTED_MANUAL' || command.status === 'ACKED') {
      return { id: item.id, status: 'ACCEPTED', replay: true }
    }
    if (item.status === 'DISMISSED') {
      throw new AppError('VALIDATION_FAILED', 'Dismissed items cannot be accepted manually')
    }
    if (!canAcceptManualReason(item.reasonClass, item.reasonCode)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Reason ${item.reasonCode} cannot be accepted manually; dismiss or escalate`,
      )
    }

    const identity: SyncDeviceIdentity = {
      tenantId: item.tenantId,
      deviceId: item.deviceId,
      registerId: item.registerId,
      outletId: item.outletId,
      registerType,
    }

    const dependsOn: string[] = []
    if (item.blockedByCommandId) {
      dependsOn.push(item.blockedByCommandId)
    }

    const cmd: PushCommandEnvelope = {
      id: item.commandId,
      type: item.commandType as PushCommandEnvelope['type'],
      schema_version: command.schemaVersion,
      device_seq: command.deviceSeq ?? 0,
      depends_on: dependsOn,
      created_at_device:
        typeof (item.payload as { sale?: { created_at_device?: string } })?.sale?.created_at_device === 'string'
          ? (item.payload as { sale: { created_at_device: string } }).sale.created_at_device
          : item.createdAt,
      payload: item.payload,
    }

    try {
      await processCommandAs(identity, cmd, {
        tx,
        receivedAtIso: nowIso,
        appVersion: command.appVersion,
        requestRef: item.requestRef ?? requestRef,
        markStatus: 'ACCEPTED_MANUAL',
        allowReplaceAttention: true,
      })
    } catch (err) {
      if (err instanceof CommandRejected) {
        throw new AppError('VALIDATION_FAILED', `${err.reasonCode}: ${err.detail ?? err.message}`)
      }
      throw err
    }

    await updateAttentionStatus(tx, actor.tenantId, item.id, {
      status: 'ACCEPTED',
      resolvedBy: actor.appUserId,
      resolvedAt: nowIso,
      updatedAt: nowIso,
    })

    const auditWriter = getSyncAuditWriter()
    if (auditWriter) {
      await auditWriter(
        tx,
        {
          action: 'attention.resolved',
          entityType: 'attention_item',
          entityId: item.id,
          outletId: item.outletId,
          registerId: item.registerId,
          deviceId: item.deviceId,
          commandId: item.commandId,
          reasonCode: item.reasonCode,
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
          beforeData: { status: item.status, reason_code: item.reasonCode },
          afterData: {
            decision: 'ACCEPTED_MANUAL',
            status: 'ACCEPTED',
            command_id: item.commandId,
          },
        },
        { newId: () => attentionIdGen.newId(), nowIso: () => nowIso },
      )
    }

    return { id: item.id, status: 'ACCEPTED', replay: false }
  })
}

export async function dismissAttention(
  actor: SyncAdminActor,
  itemId: string,
  reasonText: string,
  deps?: { nowIso?: () => string },
): Promise<{ id: string; status: 'DISMISSED' }> {
  assertAttentionPermission(actor)
  if (!isUuid(itemId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid attention itemId')
  }
  const note = reasonText.trim()
  if (note.length === 0 || note.length > 500) {
    throw new AppError('VALIDATION_FAILED', 'Dismiss reason text is required (1..500 chars)')
  }
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  await withTenant(actor.tenantId, async (tx) => {
    const locked = await lockAttentionAndCommand(tx, actor.tenantId, itemId)
    if (!locked) {
      throw new AppError('VALIDATION_FAILED', 'Attention item not found')
    }
    const { item } = locked
    assertAttentionPermission(actor, item.outletId)

    if (item.status === 'ACCEPTED' || item.status === 'DISMISSED') {
      throw new AppError('VALIDATION_FAILED', `Attention item already finalized (${item.status})`)
    }

    await updateAttentionStatus(tx, actor.tenantId, item.id, {
      status: 'DISMISSED',
      resolutionNote: note,
      resolvedBy: actor.appUserId,
      resolvedAt: nowIso,
      updatedAt: nowIso,
    })
    await updateIdempotencyDismissed(tx, actor.tenantId, item.commandId, nowIso)

    const auditWriter = getSyncAuditWriter()
    if (auditWriter) {
      await auditWriter(
        tx,
        {
          action: 'attention.resolved',
          entityType: 'attention_item',
          entityId: item.id,
          outletId: item.outletId,
          registerId: item.registerId,
          deviceId: item.deviceId,
          commandId: item.commandId,
          reasonCode: item.reasonCode,
          reasonText: note,
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
          beforeData: { status: item.status },
          afterData: { decision: 'DISMISSED', status: 'DISMISSED', command_id: item.commandId },
        },
        { newId: () => attentionIdGen.newId(), nowIso: () => nowIso },
      )
    }
  })

  return { id: itemId, status: 'DISMISSED' }
}

export async function escalateAttention(
  actor: SyncAdminActor,
  itemId: string,
  note?: string | null,
  deps?: { nowIso?: () => string },
): Promise<{ id: string; status: 'ESCALATED' }> {
  assertAttentionPermission(actor)
  if (!isUuid(itemId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid attention itemId')
  }
  const trimmedNote = note?.trim() ? note.trim().slice(0, 500) : null
  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  await withTenant(actor.tenantId, async (tx) => {
    const locked = await lockAttentionAndCommand(tx, actor.tenantId, itemId)
    if (!locked) {
      throw new AppError('VALIDATION_FAILED', 'Attention item not found')
    }
    const { item } = locked
    assertAttentionPermission(actor, item.outletId)

    if (item.status === 'ACCEPTED' || item.status === 'DISMISSED') {
      throw new AppError('VALIDATION_FAILED', `Attention item already finalized (${item.status})`)
    }

    await updateAttentionStatus(tx, actor.tenantId, item.id, {
      status: 'ESCALATED',
      ...(trimmedNote !== null ? { resolutionNote: trimmedNote } : {}),
      updatedAt: nowIso,
    })

    const auditWriter = getSyncAuditWriter()
    if (auditWriter) {
      await auditWriter(
        tx,
        {
          action: 'attention.resolved',
          entityType: 'attention_item',
          entityId: item.id,
          outletId: item.outletId,
          registerId: item.registerId,
          deviceId: item.deviceId,
          commandId: item.commandId,
          reasonCode: item.reasonCode,
          reasonText: trimmedNote,
          actorUserId: actor.appUserId,
          occurredAt: nowIso,
          beforeData: { status: item.status },
          afterData: { decision: 'ESCALATED', status: 'ESCALATED', command_id: item.commandId },
        },
        { newId: () => attentionIdGen.newId(), nowIso: () => nowIso },
      )
    }
  })

  return { id: itemId, status: 'ESCALATED' }
}
