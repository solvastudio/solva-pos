import { AppendAuditPayloadV1, type AppendAuditPayloadV1 as AppendAuditPayloadV1Type } from '~/lib/contracts'
import {
  businessDate,
  createIdGenerator,
  formatInvoiceNo,
  invoicePeriod,
  toMoney,
  type Money,
  type OutletTimezone,
} from '~/lib/kernel'
import {
  getLegalEntity,
  getOutlet,
  getOutletReceiptSetting,
  listRegisterPrefixes,
} from '../../data/master.repo'
import { getMeta, setMeta } from '../../data/meta.repo'
import {
  commitAtomicSaleTransaction,
  getSaleWithDetails,
  getUnackedOpenShiftCommandId,
} from '../../data/sale.repo'
import { getOpenShiftForRegister } from '../../data/shift.repo'
import type { SolvaDb } from '../../db/solva-db'
import type { PrintJobRecord } from '../../db/types'
import {
  buildFinalizeSalePayload,
  type DetailedPaymentEntry,
} from '../../domain/build-finalize-payload'
import type { CartState } from '../../domain/cart'
import { buildConfigSnapshot } from '../../domain/config-snapshot'
import { effectivePrefix } from '../../domain/invoice-prefix'
import type { LockManagerLike } from '../../locks/instance-lock'
import { withResourceLock } from '../../locks/resource-lock'
import { trustedNowMs } from '../../session/device-state'
import { setPaymentInProgress } from '../../session/session'
import { emitPosEvent } from '../../state/events'
import { kickActiveSync } from '../../sync'

export type FinalizeSaleErrorCode =
  | 'DEVICE_NOT_PAIRED'
  | 'SHIFT_REQUIRED'
  | 'EMPTY_CART'
  | 'OUTLET_NOT_FOUND'
  | 'TAX_NOT_CONFIGURED'
  | 'PREFIX_NOT_CONFIGURED'
  | 'PAYMENT_INVALID'
  | 'APP_ERROR'

export class FinalizeSaleError extends Error {
  readonly code: FinalizeSaleErrorCode

  constructor(code: FinalizeSaleErrorCode, message: string) {
    super(message)
    this.name = 'FinalizeSaleError'
    this.code = code
  }
}

export interface SaleApprovalInput {
  action: string
  approverId: string
  reasonCode?: string | null
  reasonText?: string | null
  beforeData?: Record<string, unknown> | null
  afterData?: Record<string, unknown> | null
}

export interface FinalizeSaleInput {
  cart: CartState
  payments: readonly DetailedPaymentEntry[]
  staffId: string
  approvals?: readonly SaleApprovalInput[]
}

export interface FinalizeSaleDeps {
  nowMs?: () => number
  newId?: () => string
  locks?: LockManagerLike | null
  onFinalized?: (saleId: string) => void
  beforeCommitHookForTest?: () => Promise<void> | void
}

export interface FinalizeSaleResult {
  saleId: string
  invoiceNo: string
  change: Money
}

const defaultIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return buf[0]!
  },
})

function computeTotalChange(
  payments: readonly { change_given: number | null }[],
): Money {
  let total = 0
  for (const p of payments) {
    if (p.change_given && p.change_given > 0) {
      total += p.change_given
    }
  }
  return toMoney(total)
}

/**
 * Atomic 3-stage offline sale finalization (AD-14):
 * - Stage A: resource lock, finalize_id idempotency check, config/prefix snapshot, calcAndSettle + verifySale
 * - Stage B: single strict `rw` IndexedDB transaction (`local_counter`, `sale*`, `outbox_command`, `print_job`, `cart_draft`)
 * - Stage C: emit finalized event, kick sync engine, update `max_seen_time`, clear payment lock
 */
export async function finalizeSale(
  db: SolvaDb,
  input: FinalizeSaleInput,
  deps: FinalizeSaleDeps = {},
): Promise<FinalizeSaleResult> {
  const device = await getMeta(db, 'device')
  if (!device) {
    throw new FinalizeSaleError('DEVICE_NOT_PAIRED', 'Device is not paired')
  }

  return withResourceLock({
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    name: `finalize:${device.register_id}`,
    locks: deps.locks,
    fn: async () => {
      // 1. Idempotency check by finalizeId (crash recovery / double click)
      const already = await getSaleWithDetails(db, input.cart.finalizeId)
      if (already) {
        return {
          saleId: already.sale.id,
          invoiceNo: already.sale.invoice_no,
          change: computeTotalChange(already.payments),
        }
      }

      if (input.cart.lines.length === 0) {
        throw new FinalizeSaleError('EMPTY_CART', 'Cart has no lines to finalize')
      }
      if (input.payments.length === 0) {
        throw new FinalizeSaleError('PAYMENT_INVALID', 'At least one payment is required')
      }

      const shift = await getOpenShiftForRegister(db, device.register_id)
      if (!shift) {
        throw new FinalizeSaleError('SHIFT_REQUIRED', 'An open shift is required before paying')
      }

      const [outlet, clock, catalogCursor, receiptSetting, prefixes] = await Promise.all([
        getOutlet(db, device.outlet_id),
        getMeta(db, 'clock'),
        getMeta(db, 'catalog_cursor'),
        getOutletReceiptSetting(db, device.outlet_id),
        listRegisterPrefixes(db, device.register_id),
      ])

      if (!outlet) {
        throw new FinalizeSaleError('OUTLET_NOT_FOUND', 'Outlet record is missing')
      }

      const legalEntity = await getLegalEntity(db, outlet.legal_entity_id)

      const nowMs = (deps.nowMs ?? Date.now)()
      const offsetMs = clock?.offset_ms ?? 0
      const maxSeenMs = clock ? Date.parse(clock.max_seen_time) || 0 : 0
      const correctedMs = trustedNowMs({ nowMs, clockOffsetMs: offsetMs, maxSeenMs })

      const createdAtDevice = new Date(nowMs).toISOString()
      const occurredAt = new Date(correctedMs).toISOString()
      const bDate = businessDate(occurredAt, outlet.timezone as OutletTimezone, outlet.day_cutoff_time)
      const period = invoicePeriod(bDate)

      // Refresh tax/rounding config if business_date rolled over since cart creation
      const cartBDate = businessDate(
        input.cart.createdAt,
        outlet.timezone as OutletTimezone,
        outlet.day_cutoff_time,
      )
      let effectiveCart: CartState = { ...input.cart, shiftId: shift.id }
      if (bDate !== cartBDate) {
        const refreshed = await buildConfigSnapshot(db, {
          outletId: outlet.id,
          businessDate: bDate,
        })
        if (!refreshed.ok) {
          throw new FinalizeSaleError(
            'TAX_NOT_CONFIGURED',
            'No active tax rate covers current business date',
          )
        }
        effectiveCart = {
          ...effectiveCart,
          config: refreshed.config,
          cashRoundingUnit: refreshed.cashRoundingUnit,
          taxRateId: refreshed.taxRateId,
        }
      }

      const prefixRow = effectivePrefix(prefixes, bDate)
      if (!prefixRow) {
        throw new FinalizeSaleError(
          'PREFIX_NOT_CONFIGURED',
          `Invoice prefix not configured for ${bDate}`,
        )
      }

      const newId = deps.newId ?? (() => defaultIdGen.newId())
      const saleId = effectiveCart.finalizeId
      const lineIds = effectiveCart.lines.map(() => newId())
      const paymentIds = input.payments.map(() => newId())

      const placeholderNo = formatInvoiceNo({
        prefix: prefixRow.invoice_prefix,
        kind: 'INVOICE',
        period,
        seq: 1,
      })

      const receiptLocale: 'id-ID' | 'en-US' =
        receiptSetting?.receipt_locale === 'en-US' ? 'en-US' : 'id-ID'

      let built
      try {
        built = buildFinalizeSalePayload({
          cart: effectiveCart,
          payments: input.payments,
          saleId,
          lineIds,
          paymentIds,
          invoice: {
            invoiceNo: placeholderNo,
            prefix: prefixRow.invoice_prefix,
            period,
            seq: 1,
          },
          deviceMeta: {
            tenantId: device.tenant_id,
            outletId: device.outlet_id,
            registerId: device.register_id,
            deviceId: device.device_id,
            shiftId: shift.id,
            staffId: input.staffId,
            createdAtDevice,
            occurredAt,
            businessDate: bDate,
            clockOffsetMs: offsetMs,
            catalogCursor: catalogCursor ?? null,
          },
          outletMeta: {
            legalEntityId: legalEntity?.id ?? outlet.legal_entity_id,
            legalEntityNpwp: legalEntity?.npwp ?? null,
            legalEntityIsPkp: Boolean(legalEntity?.is_pkp),
            receiptLocale,
          },
        })
      } catch (err) {
        throw new FinalizeSaleError(
          'APP_ERROR',
          err instanceof Error ? err.message : 'Failed to build canonical FinalizeSale payload',
        )
      }

      if (!built.verifyResult.ok) {
        throw new FinalizeSaleError(
          'APP_ERROR',
          `verifySale failed: ${built.verifyResult.diffs.map((d) => d.path).join(', ')}`,
        )
      }

      const shiftOpenCommandId = await getUnackedOpenShiftCommandId(db, shift)

      const auditEntries: { id: string; payload: AppendAuditPayloadV1Type }[] = (
        input.approvals ?? []
      ).map((a) => {
        const auditCmdId = newId()
        const payload = AppendAuditPayloadV1.parse({
          entry: {
            id: auditCmdId,
            action: a.action,
            entity_type: 'sale',
            entity_id: saleId,
            before_data: a.beforeData ?? null,
            after_data: a.afterData ?? null,
            reason_code: a.reasonCode ?? null,
            reason_text: a.reasonText ?? null,
            actor_user_id: input.staffId,
            approver_user_id: a.approverId,
            occurred_at_device: createdAtDevice,
            occurred_at: occurredAt,
            business_date: bDate,
            related_command_id: saleId,
          },
        })
        return { id: auditCmdId, payload }
      })

      const printJob: PrintJobRecord = {
        id: newId(),
        kind: 'RECEIPT',
        status: 'QUEUED',
        entity_id: saleId,
        receipt_locale: receiptLocale,
        attempts: 0,
        last_error: null,
        created_at: occurredAt,
        updated_at: occurredAt,
      }

      // Stage B: single strict atomic Dexie transaction
      const committed = await commitAtomicSaleTransaction(db, {
        saleRecord: built.saleRecord,
        lineRecords: built.lineRecords,
        paymentRecords: built.paymentRecords,
        payload: built.payload,
        auditEntries,
        printJob,
        invoicePrefix: prefixRow.invoice_prefix,
        invoicePeriod: period,
        registerId: device.register_id,
        staffId: input.staffId,
        createdAtDevice,
        shiftOpenCommandId,
        beforeCommitHookForTest: deps.beforeCommitHookForTest,
      })

      // Stage C: post-commit side effects (never rollback sale)
      if (!committed.alreadyCommitted) {
        emitPosEvent('finalized', { saleId: committed.sale.id })
        deps.onFinalized?.(committed.sale.id)
        kickActiveSync('finalized')

        if (clock && correctedMs > maxSeenMs) {
          await setMeta(db, 'clock', {
            ...clock,
            max_seen_time: occurredAt,
          })
        }
        setPaymentInProgress(false)
      }

      return {
        saleId: committed.sale.id,
        invoiceNo: committed.sale.invoice_no,
        change: computeTotalChange(committed.payments),
      }
    },
  })
}
