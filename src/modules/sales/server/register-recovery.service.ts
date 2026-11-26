import '@tanstack/react-start/server-only'
import { webcrypto } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  businessDate,
  createIdGenerator,
  formatInvoiceNo,
  invoicePeriod,
  isUuid,
  type OutletTimezone,
} from '~/lib/kernel'
import { appendAudit } from '~/modules/audit/public'
import {
  findRegisterPrefixForBusinessDate,
  getRegisterRecoveryContext,
  invalidateRevokedDeviceAuthCaches,
  requireActorPermission,
  revokeDeviceInTx,
  type EnrollmentInvoiceCounter,
  type IdentityAuthActor,
} from '~/modules/identity/public'
import type { DeviceRevokeReason } from '~/modules/identity/shared'
import { withTenant, withTenantReadOnly, type TenantTx } from '~/server/db'
import { AppError } from '~/server/error-classify'
import type { DocType } from './invoice-series.repo'
import { invoiceGap, invoiceSeries, registerRecovery } from './schema'

const recoveryIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

export interface RecoverySeriesPreview {
  readonly docType: DocType
  readonly highestReceivedSeq: number
  readonly declaredLastSeq: number | null
  readonly nextSeq: number
  readonly nextFormattedNo: string | null
  readonly gapRange: { readonly seqFrom: number; readonly seqTo: number } | null
}

export interface RecoverRegisterPreview {
  readonly registerId: string
  readonly outletId: string
  readonly outletCode: string
  readonly registerCode: string
  readonly period: string
  readonly hasActiveDevice: boolean
  readonly invoice: RecoverySeriesPreview
  readonly creditNote: RecoverySeriesPreview
}

export interface RecoverRegisterInput {
  registerId: string
  reasonCode?: DeviceRevokeReason
  declaredLastInvoiceSeq?: number | null
  declaredLastCreditSeq?: number | null
  reasonText?: string | null
}

export interface RecoverRegisterResult {
  readonly registerId: string
  readonly period: string
  readonly revokedDeviceId: string | null
  readonly counters: readonly EnrollmentInvoiceCounter[]
  readonly createdGaps: Array<{ docType: DocType; seqFrom: number; seqTo: number }>
}

async function readHighestSeq(
  tx: TenantTx,
  registerId: string,
  docType: DocType,
  period: string,
): Promise<number> {
  const rows = await tx
    .select({ maxSeqReceived: invoiceSeries.maxSeqReceived })
    .from(invoiceSeries)
    .where(
      and(
        eq(invoiceSeries.registerId, registerId),
        eq(invoiceSeries.docType, docType),
        eq(invoiceSeries.period, period),
      ),
    )
    .limit(1)
  return rows[0]?.maxSeqReceived ?? 0
}

function buildSeriesPlan(
  docType: DocType,
  prefix: string | null,
  period: string,
  highest: number,
  declared: number | null | undefined,
): RecoverySeriesPreview {
  const cleanDeclared = declared ?? null
  if (cleanDeclared !== null) {
    if (!Number.isSafeInteger(cleanDeclared) || cleanDeclared < highest) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Declared last ${docType} seq (${cleanDeclared}) must be >= highest received (${highest})`,
      )
    }
  }
  const base = cleanDeclared ?? highest
  const nextSeq = base + 1
  const gapRange =
    cleanDeclared !== null && cleanDeclared > highest
      ? { seqFrom: highest + 1, seqTo: cleanDeclared }
      : null

  let nextFormattedNo: string | null = null
  if (prefix) {
    try {
      nextFormattedNo = formatInvoiceNo({ prefix, kind: docType, period, seq: nextSeq })
    } catch {
      nextFormattedNo = null
    }
  }

  return {
    docType,
    highestReceivedSeq: highest,
    declaredLastSeq: cleanDeclared,
    nextSeq,
    nextFormattedNo,
    gapRange,
  }
}

async function readPrefixForPreview(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
  bd: string,
): Promise<string | null> {
  return findRegisterPrefixForBusinessDate(tx, tenantId, registerId, bd)
}

/**
 * Pure read-only preview of gaps and initial replacement counters for a register recovery (FLOW-16).
 */
export async function previewRegisterRecovery(
  actor: IdentityAuthActor,
  input: {
    registerId: string
    declaredLastInvoiceSeq?: number | null
    declaredLastCreditSeq?: number | null
  },
  deps?: { nowIso?: () => string },
): Promise<RecoverRegisterPreview> {
  requireActorPermission(actor, 'user.manage')
  if (!isUuid(input.registerId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid registerId')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()

  return withTenantReadOnly(actor.tenantId, async (tx) => {
    const reg = await getRegisterRecoveryContext(tx, actor.tenantId, input.registerId)
    if (!reg) {
      throw new AppError('VALIDATION_FAILED', 'Register not found')
    }
    requireActorPermission(actor, 'user.manage', { outletId: reg.outletId })

    const bd = businessDate(
      nowIso,
      reg.outletTimezone as OutletTimezone,
      reg.outletDayCutoffTime.slice(0, 5),
    )
    const period = invoicePeriod(bd)
    const prefix = await readPrefixForPreview(tx, actor.tenantId, reg.registerId, bd)

    const highInv = await readHighestSeq(tx, reg.registerId, 'INVOICE', period)
    const highCn = await readHighestSeq(tx, reg.registerId, 'CREDIT_NOTE', period)

    return {
      registerId: reg.registerId,
      outletId: reg.outletId,
      outletCode: reg.outletCode,
      registerCode: reg.registerCode,
      period,
      hasActiveDevice: reg.activeDeviceId !== null,
      invoice: buildSeriesPlan('INVOICE', prefix, period, highInv, input.declaredLastInvoiceSeq),
      creditNote: buildSeriesPlan(
        'CREDIT_NOTE',
        prefix,
        period,
        highCn,
        input.declaredLastCreditSeq,
      ),
    }
  })
}

/**
 * Atomically revokes any active device, records `register_recovery` lines per doc_type,
 * declares any manual gap range `RECOVERY_DECLARED`, and logs `register.recovered` audit (BR-INV-008, V-29).
 */
export async function recoverRegister(
  actor: IdentityAuthActor,
  input: RecoverRegisterInput,
  deps?: { nowIso?: () => string },
): Promise<RecoverRegisterResult> {
  requireActorPermission(actor, 'user.manage')
  if (!isUuid(input.registerId)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid registerId')
  }

  const nowIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const reasonCode: DeviceRevokeReason = input.reasonCode ?? 'LOST'
  const reasonText = input.reasonText?.trim() || null

  let revokedDeviceId: string | null = null
  let revokedCredHash: Buffer | null = null

  const result = await withTenant(actor.tenantId, async (tx) => {
    const reg = await getRegisterRecoveryContext(tx, actor.tenantId, input.registerId)
    if (!reg) {
      throw new AppError('VALIDATION_FAILED', 'Register not found')
    }
    requireActorPermission(actor, 'user.manage', { outletId: reg.outletId })

    const oldDeviceId = reg.activeDeviceId ?? reg.latestDeviceId
    if (!oldDeviceId) {
      throw new AppError('VALIDATION_FAILED', 'Register has no prior device to recover from')
    }

    if (reg.activeDeviceId) {
      revokedDeviceId = reg.activeDeviceId
      const revoked = await revokeDeviceInTx(tx, actor, {
        deviceId: reg.activeDeviceId,
        reasonCode,
        nowIso,
      })
      revokedCredHash = revoked.credentialHash
    }

    const bd = businessDate(
      nowIso,
      reg.outletTimezone as OutletTimezone,
      reg.outletDayCutoffTime.slice(0, 5),
    )
    const period = invoicePeriod(bd)

    const highInv = await readHighestSeq(tx, reg.registerId, 'INVOICE', period)
    const highCn = await readHighestSeq(tx, reg.registerId, 'CREDIT_NOTE', period)

    const plans = [
      buildSeriesPlan('INVOICE', null, period, highInv, input.declaredLastInvoiceSeq),
      buildSeriesPlan('CREDIT_NOTE', null, period, highCn, input.declaredLastCreditSeq),
    ]

    const createdGaps: Array<{ docType: DocType; seqFrom: number; seqTo: number }> = []
    const counters: EnrollmentInvoiceCounter[] = []

    for (const plan of plans) {
      const recoveryId = recoveryIdGen.newId()
      await tx.insert(registerRecovery).values({
        id: recoveryId,
        tenantId: actor.tenantId,
        outletId: reg.outletId,
        registerId: reg.registerId,
        docType: plan.docType,
        period,
        oldDeviceId,
        newDeviceId: null,
        highestReceivedSeq: plan.highestReceivedSeq,
        declaredLastSeq: plan.declaredLastSeq,
        nextSeq: plan.nextSeq,
        reasonText,
        performedBy: actor.appUserId,
        performedAt: nowIso,
      })

      if (plan.gapRange) {
        await tx.insert(invoiceGap).values({
          id: recoveryIdGen.newId(),
          tenantId: actor.tenantId,
          outletId: reg.outletId,
          registerId: reg.registerId,
          docType: plan.docType,
          period,
          seqFrom: plan.gapRange.seqFrom,
          seqTo: plan.gapRange.seqTo,
          origin: 'RECOVERY_DECLARED',
          status: 'OPEN',
          reasonCode: 'DEVICE_LOST',
          reasonText,
          detectedAt: nowIso,
          registerRecoveryId: recoveryId,
        })
        createdGaps.push({
          docType: plan.docType,
          seqFrom: plan.gapRange.seqFrom,
          seqTo: plan.gapRange.seqTo,
        })
      }

      counters.push({
        doc_type: plan.docType,
        period,
        next_seq: plan.nextSeq,
      })
    }

    await appendAudit(
      tx,
      {
        action: 'register.recovered',
        entityType: 'cash_master',
        entityId: reg.registerId,
        outletId: reg.outletId,
        registerId: reg.registerId,
        deviceId: oldDeviceId,
        reasonCode,
        reasonText,
        actorUserId: actor.appUserId,
        occurredAt: nowIso,
        afterData: {
          period,
          counters,
          created_gaps: createdGaps,
        },
      },
      { newId: () => recoveryIdGen.newId(), nowIso: () => nowIso },
    )

    return {
      registerId: reg.registerId,
      period,
      revokedDeviceId,
      counters,
      createdGaps,
    }
  })

  if (revokedDeviceId) {
    invalidateRevokedDeviceAuthCaches(revokedDeviceId, revokedCredHash)
  }

  return result
}

/**
 * Port implementation wired into `identity` so enrolling a replacement device receives
 * its authoritative starting `next_seq` counters and binds `new_device_id`.
 */
export async function getRecoveryCountersAndBindDevice(
  tx: TenantTx,
  tenantId: string,
  registerId: string,
  newDeviceId: string,
): Promise<EnrollmentInvoiceCounter[]> {
  const out: EnrollmentInvoiceCounter[] = []

  for (const docType of ['INVOICE', 'CREDIT_NOTE'] as const) {
    const rows = await tx
      .select({
        id: registerRecovery.id,
        period: registerRecovery.period,
        nextSeq: registerRecovery.nextSeq,
      })
      .from(registerRecovery)
      .where(
        and(
          eq(registerRecovery.tenantId, tenantId),
          eq(registerRecovery.registerId, registerId),
          eq(registerRecovery.docType, docType),
          isNull(registerRecovery.newDeviceId),
        ),
      )
      .orderBy(desc(registerRecovery.performedAt))
      .limit(1)

    const row = rows[0]
    if (row) {
      await tx
        .update(registerRecovery)
        .set({ newDeviceId })
        .where(eq(registerRecovery.id, row.id))
      out.push({
        doc_type: docType,
        period: row.period,
        next_seq: row.nextSeq,
      })
    }
  }

  return out
}
