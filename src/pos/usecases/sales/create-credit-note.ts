import {
  AppendAuditPayloadV1,
  FinalizeCreditNotePayloadV1,
  type ReturnDisposition,
} from '~/lib/contracts'
import type { InvoiceLookupResponse } from '~/lib/contracts/invoice-lookup'
import {
  addQty,
  businessDate,
  cmpQty,
  formatInvoiceNo,
  invoicePeriod,
  normalizeQty,
  parseQty,
  qtyToBase,
  toMoney,
  type Money,
  type OutletTimezone,
} from '~/lib/kernel'
import { runtimeIdGenerator as defaultIdGen } from '~/lib/runtime-id'
import { calcCreditNote, type ReturnLineInput } from '~/lib/sales-calc'
import {
  commitCreditNoteTransaction,
  getLocalReturnedSumsBySaleLine,
} from '../../data/credit-note.repo'
import {
  getOutlet,
  getOutletReceiptSetting,
  listRegisterPrefixes,
  listUoms,
} from '../../data/master.repo'
import { getMeta } from '../../data/meta.repo'
import {
  getSaleWithDetails,
  getUnackedFinalizeSaleCommandId,
} from '../../data/sale.repo'
import {
  getLatestClosedShiftForRegister,
  getOpenShiftForRegister,
} from '../../data/shift.repo'
import type { SolvaDb } from '../../db/solva-db'
import type {
  CreditNoteLineRecord,
  CreditNoteRecord,
  CreditNoteRefundRecord,
  PrintJobRecord,
} from '../../db/types'
import { effectivePrefix } from '../../domain/invoice-prefix'
import {
  checkReturnEligibility,
  computeRemainingReturnQty,
} from '../../domain/return-eligibility'
import { withResourceLock } from '../../locks/resource-lock'
import { trustedNowMs } from '../../session/device-state'
import { kickActiveSync } from '../../sync'

export type CreateCreditNoteErrorCode =
  | 'DEVICE_NOT_PAIRED'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_VOIDED'
  | 'OUTSIDE_RETURN_WINDOW'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'SHIFT_REQUIRED'
  | 'PREFIX_NOT_CONFIGURED'
  | 'EMPTY_RETURN'
  | 'EXCEEDS_REMAINING_QTY'
  | 'FRACTION_NOT_ALLOWED'
  | 'REASON_REQUIRED'

export class CreateCreditNoteError extends Error {
  readonly code: CreateCreditNoteErrorCode

  constructor(code: CreateCreditNoteErrorCode, message: string) {
    super(message)
    this.name = 'CreateCreditNoteError'
    this.code = code
  }
}

export interface CreditNoteReturnLineRequest {
  saleLineId: string
  qtyReturn: string
  disposition?: ReturnDisposition
}

export interface CreateCreditNoteInput {
  source:
    | { readonly kind: 'LOCAL'; readonly saleId: string }
    | { readonly kind: 'REMOTE'; readonly invoice: InvoiceLookupResponse }
  lines: readonly CreditNoteReturnLineRequest[]
  reasonCode: string
  reasonText?: string | null
  staffId: string
  approverId: string
  refundMethod: {
    id: string
    code: string
    name: string
    kind: 'CASH' | 'NON_CASH'
    reference?: string | null
  }
}

export interface CreateCreditNoteResult {
  creditNote: CreditNoteRecord
  lines: CreditNoteLineRecord[]
  refunds: CreditNoteRefundRecord[]
  totalRefund: Money
}

export async function createCreditNote(
  db: SolvaDb,
  input: CreateCreditNoteInput,
  deps: { nowMs?: () => number; newId?: () => string } = {},
): Promise<CreateCreditNoteResult> {
  if (input.approverId === input.staffId) {
    throw new CreateCreditNoteError(
      'SELF_APPROVAL_FORBIDDEN',
      'Supervisor approving return must differ from requester',
    )
  }
  if (!input.reasonCode.trim()) {
    throw new CreateCreditNoteError('REASON_REQUIRED', 'Return reason is required')
  }
  if (input.lines.length === 0) {
    throw new CreateCreditNoteError('EMPTY_RETURN', 'Select at least one item to return')
  }

  const device = await getMeta(db, 'device')
  if (!device) {
    throw new CreateCreditNoteError('DEVICE_NOT_PAIRED', 'Device is not paired')
  }

  return withResourceLock({
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    name: `finalize:${device.register_id}`,
    fn: async () => {
      const [outlet, clock, receiptSetting, prefixes, uoms, openShift] = await Promise.all([
        getOutlet(db, device.outlet_id),
        getMeta(db, 'clock'),
        getOutletReceiptSetting(db, device.outlet_id),
        listRegisterPrefixes(db, device.register_id),
        listUoms(db),
        getOpenShiftForRegister(db, device.register_id),
      ])

      if (!outlet) {
        throw new CreateCreditNoteError('DEVICE_NOT_PAIRED', 'Outlet missing')
      }

      let shift = openShift
      if (input.refundMethod.kind === 'CASH' && !shift) {
        throw new CreateCreditNoteError(
          'SHIFT_REQUIRED',
          'Cash refund requires an open shift on this register',
        )
      }
      if (!shift) {
        shift = await getLatestClosedShiftForRegister(db, device.register_id)
      }
      if (!shift) {
        throw new CreateCreditNoteError(
          'SHIFT_REQUIRED',
          'A shift record is required to record return',
        )
      }

      const nowMs = (deps.nowMs ?? Date.now)()
      const offsetMs = clock?.offset_ms ?? 0
      const maxSeenMs = clock ? Date.parse(clock.max_seen_time) || 0 : 0
      const occurredAt = new Date(
        trustedNowMs({ nowMs, clockOffsetMs: offsetMs, maxSeenMs }),
      ).toISOString()
      const createdAtDevice = new Date(nowMs).toISOString()
      const bDate = businessDate(
        occurredAt,
        outlet.timezone as OutletTimezone,
        outlet.day_cutoff_time,
      )
      const period = invoicePeriod(bDate)

      // Resolve source sale lines + cumulative prior returned sums
      let saleMeta: {
        id: string
        invoiceNo: string
        businessDate: string
        status: string
        priceTaxMode: 'INCLUSIVE' | 'EXCLUSIVE'
        cashRoundingUnit: 0 | 100 | 500 | 1000
        receiptLocale: 'id-ID' | 'en-US'
      }
      interface NormalizedSaleLine {
        id: string
        uomId: string | null
        qty: string
        conversionFactor: string
        originalNet: number
        originalSc: number
        originalTax: number
        returnedQty: string
        returnedNet: number
        returnedSc: number
        returnedTax: number
      }
      const lineById = new Map<string, NormalizedSaleLine>()

      if (input.source.kind === 'LOCAL') {
        const details = await getSaleWithDetails(db, input.source.saleId)
        if (!details) {
          throw new CreateCreditNoteError('INVOICE_NOT_FOUND', 'Original invoice not found')
        }
        const priorMap = await getLocalReturnedSumsBySaleLine(
          db,
          details.lines.map((l) => l.id),
        )
        saleMeta = {
          id: details.sale.id,
          invoiceNo: details.sale.invoice_no,
          businessDate: details.sale.business_date,
          status: details.sale.status,
          priceTaxMode: details.sale.price_tax_mode,
          cashRoundingUnit: details.sale.cash_rounding_unit as 0 | 100 | 500 | 1000,
          receiptLocale: details.sale.receipt_locale,
        }
        for (const l of details.lines) {
          const prev = priorMap.get(l.id)
          lineById.set(l.id, {
            id: l.id,
            uomId: l.uom_id,
            qty: l.qty,
            conversionFactor: l.conversion_factor,
            originalNet: l.line_net - l.bill_discount_alloc,
            originalSc: l.service_alloc,
            originalTax: l.tax_alloc,
            returnedQty: prev?.qty ?? '0',
            returnedNet: prev?.net ?? 0,
            returnedSc: prev?.sc ?? 0,
            returnedTax: prev?.tax ?? 0,
          })
        }
      } else {
        const remote = input.source.invoice
        const priorLocalMap = await getLocalReturnedSumsBySaleLine(
          db,
          remote.lines.map((l) => l.id),
        )
        saleMeta = {
          id: remote.sale.id,
          invoiceNo: remote.sale.invoice_no,
          businessDate: remote.sale.business_date,
          status: remote.sale.status,
          priceTaxMode: remote.sale.price_tax_mode,
          cashRoundingUnit: remote.sale.cash_rounding_unit,
          receiptLocale: remote.sale.receipt_locale,
        }
        for (const l of remote.lines) {
          const localExtra = priorLocalMap.get(l.id)
          lineById.set(l.id, {
            id: l.id,
            uomId: l.uom_id,
            qty: l.qty,
            conversionFactor: l.conversion_factor,
            originalNet: l.line_net - l.bill_discount_alloc,
            originalSc: l.service_alloc,
            originalTax: l.tax_alloc,
            returnedQty: localExtra
              ? normalizeQty(addQty(parseQty(l.returned_so_far.qty), parseQty(localExtra.qty)))
              : l.returned_so_far.qty,
            returnedNet: l.returned_so_far.net + (localExtra?.net ?? 0),
            returnedSc: l.returned_so_far.sc + (localExtra?.sc ?? 0),
            returnedTax: l.returned_so_far.tax + (localExtra?.tax ?? 0),
          })
        }
      }

      const eligibility = checkReturnEligibility({
        invoiceStatus: saleMeta.status,
        invoiceBusinessDate: saleMeta.businessDate,
        todayBusinessDate: bDate,
      })
      if (!eligibility.ok) {
        throw new CreateCreditNoteError(
          eligibility.reason,
          eligibility.reason === 'INVOICE_VOIDED'
            ? 'Voided invoice cannot be returned'
            : 'Invoice is outside the 3-month return window',
        )
      }

      const prefixRow = effectivePrefix(prefixes, bDate)
      if (!prefixRow) {
        throw new CreateCreditNoteError(
          'PREFIX_NOT_CONFIGURED',
          `Credit note prefix missing for ${bDate}`,
        )
      }

      const uomMap = new Map(uoms.map((u) => [u.id, u]))
      const calcInputs: ReturnLineInput[] = []
      const qtyMeta: { saleLineId: string; qtyReturn: string; qtyBase: string; disposition: ReturnDisposition }[] = []

      for (const reqLine of input.lines) {
        const src = lineById.get(reqLine.saleLineId)
        if (!src) {
          throw new CreateCreditNoteError('INVOICE_NOT_FOUND', `Line ${reqLine.saleLineId} not found`)
        }
        const qtyRet = parseQty(reqLine.qtyReturn.trim().replace(',', '.'))
        const remaining = computeRemainingReturnQty(src.qty, src.returnedQty)
        if (cmpQty(qtyRet, parseQty('0')) <= 0 || cmpQty(qtyRet, remaining) > 0) {
          throw new CreateCreditNoteError(
            'EXCEEDS_REMAINING_QTY',
            `Return qty ${qtyRet} exceeds remaining ${remaining}`,
          )
        }
        const uomRec = src.uomId ? uomMap.get(src.uomId) : undefined
        let qtyBase: string
        try {
          qtyBase = qtyToBase({
            qty: qtyRet,
            factor: parseQty(src.conversionFactor),
            allowFraction: uomRec?.allow_fraction ?? false,
          })
        } catch {
          throw new CreateCreditNoteError(
            'FRACTION_NOT_ALLOWED',
            'Fractional return quantity is not allowed for base unit',
          )
        }

        calcInputs.push({
          qtySold: parseQty(src.qty),
          qtyAlreadyReturned: parseQty(src.returnedQty),
          qtyReturn: qtyRet,
          originalNet: toMoney(src.originalNet),
          originalScAlloc: toMoney(src.originalSc),
          originalTaxAlloc: toMoney(src.originalTax),
          returnedSoFar: {
            net: toMoney(src.returnedNet),
            sc: toMoney(src.returnedSc),
            tax: toMoney(src.returnedTax),
          },
        })
        qtyMeta.push({
          saleLineId: src.id,
          qtyReturn: normalizeQty(qtyRet),
          qtyBase: normalizeQty(parseQty(qtyBase)),
          disposition: reqLine.disposition ?? 'KEMBALI_STOK',
        })
      }

      const calc = calcCreditNote({
        lines: calcInputs,
        priceTaxMode: saleMeta.priceTaxMode,
        refund: {
          method: input.refundMethod.kind === 'CASH' ? 'CASH' : 'ORIGINAL',
          cashRoundingUnit: saleMeta.cashRoundingUnit,
        },
      })

      const totalRefund = toMoney(calc.refundCashApplied ?? calc.refundGross)
      const receiptLocale: 'id-ID' | 'en-US' =
        receiptSetting?.receipt_locale === 'en-US' ? 'en-US' : saleMeta.receiptLocale

      const newId = deps.newId ?? (() => defaultIdGen.newId())
      const cnId = newId()
      const auditCmdId = newId()
      const placeholderCnNo = formatInvoiceNo({
        prefix: prefixRow.invoice_prefix,
        kind: 'CREDIT_NOTE',
        period,
        seq: 1,
      })

      const payloadLines = calc.lines.map((cl, i) => ({
        id: newId(),
        line_no: i + 1,
        sale_line_id: qtyMeta[i]!.saleLineId,
        qty_returned: qtyMeta[i]!.qtyReturn,
        qty_returned_base: qtyMeta[i]!.qtyBase,
        refund_net: cl.net,
        refund_service: cl.sc,
        refund_tax: cl.tax,
        is_final_return: cl.isLast,
        disposition: qtyMeta[i]!.disposition,
      }))

      const payloadRefunds = [
        {
          id: newId(),
          seq: 1,
          method_id: input.refundMethod.id,
          method_code: input.refundMethod.code,
          method_name: input.refundMethod.name,
          method_kind: input.refundMethod.kind,
          amount_applied: totalRefund,
          reference: input.refundMethod.reference?.trim() || null,
        },
      ]

      const payload = FinalizeCreditNotePayloadV1.parse({
        credit_note: {
          id: cnId,
          shift_id: shift.id,
          created_by: input.staffId,
          approved_by: input.approverId,
          created_at_device: createdAtDevice,
          clock_offset_ms: offsetMs,
          occurred_at: occurredAt,
          business_date: bDate,
          cn_no: placeholderCnNo,
          cn_prefix: prefixRow.invoice_prefix,
          cn_period: period,
          cn_seq: 1,
          original_sale_id: saleMeta.id,
          original_invoice_no: saleMeta.invoiceNo,
          reason_code: input.reasonCode.trim(),
          reason_text: input.reasonText?.trim() || null,
          price_tax_mode: saleMeta.priceTaxMode,
          cash_rounding_unit: saleMeta.cashRoundingUnit,
          receipt_locale: receiptLocale,
          net_total: calc.netTotal,
          service_total: calc.scTotal,
          tax_total: calc.taxTotal,
          refund_gross: calc.refundGross,
          rounding: calc.rounding,
        },
        lines: payloadLines,
        refunds: payloadRefunds,
      })

      const auditPayload = AppendAuditPayloadV1.parse({
        entry: {
          id: auditCmdId,
          action: 'return.created',
          entity_type: 'credit_note',
          entity_id: cnId,
          before_data: { original_sale_id: saleMeta.id },
          after_data: { total_refund: totalRefund, lines_count: payloadLines.length },
          reason_code: input.reasonCode.trim(),
          reason_text: input.reasonText?.trim() || null,
          actor_user_id: input.staffId,
          approver_user_id: input.approverId,
          occurred_at_device: createdAtDevice,
          occurred_at: occurredAt,
          business_date: bDate,
          related_command_id: cnId,
        },
      })

      const unackedOrigSaleCmdId = await getUnackedFinalizeSaleCommandId(db, saleMeta.id)

      const cnRecord: CreditNoteRecord = {
        ...payload.credit_note,
        tenant_id: device.tenant_id,
        outlet_id: device.outlet_id,
        register_id: device.register_id,
        device_id: device.device_id,
        sync_status: 'PENDING',
        print_state: 'QUEUED',
      }
      const cnLineRecords: CreditNoteLineRecord[] = payload.lines.map((l) => ({
        ...l,
        credit_note_id: cnId,
      }))
      const cnRefundRecords: CreditNoteRefundRecord[] = payload.refunds.map((r) => ({
        ...r,
        credit_note_id: cnId,
        shift_id: shift.id,
      }))

      const printJob: PrintJobRecord = {
        id: newId(),
        kind: 'CREDIT_NOTE',
        status: 'QUEUED',
        entity_id: cnId,
        receipt_locale: receiptLocale,
        attempts: 0,
        last_error: null,
        created_at: occurredAt,
        updated_at: occurredAt,
      }

      const committed = await commitCreditNoteTransaction(db, {
        creditNote: cnRecord,
        lines: cnLineRecords,
        refunds: cnRefundRecords,
        payload,
        auditCommandId: auditCmdId,
        auditPayload,
        printJob,
        cnPrefix: prefixRow.invoice_prefix,
        cnPeriod: period,
        registerId: device.register_id,
        createdAtDevice,
        dependsOnCommandIds: unackedOrigSaleCmdId ? [unackedOrigSaleCmdId] : [],
      })

      kickActiveSync('manual')

      return {
        creditNote: committed,
        lines: cnLineRecords,
        refunds: cnRefundRecords,
        totalRefund,
      }
    },
  })
}
