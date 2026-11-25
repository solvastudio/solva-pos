import '@tanstack/react-start/server-only'
import { parseCommandPayload, type AppendBillEventsPayloadV1 } from '~/lib/contracts'
import { toMoney } from '~/lib/kernel'
import { filterMissingCatalogRefs, findMissingModifierId } from '~/modules/catalog/public'
import { findMissingAppUserId } from '~/modules/identity/public'
import {
  CommandRejected,
  createDataFlag,
  publishBillsChanged,
  type CommandContext,
  type CommandHandler,
} from '~/modules/sync/public'
import { registerAfterCommit, type TenantTx } from '~/server/db'
import {
  applyBillEvent,
  BillMergedPayloadSchema,
  BillOpenedPayloadSchema,
  BillProjectionError,
  BillSplitPayloadSchema,
  emptyBill,
  ItemAddedPayloadSchema,
  ModifierSetPayloadSchema,
  TableSetPayloadSchema,
  verifyBillItemUnitPrice,
  type BillEventEnvelopeV1,
  type BillProjectionState,
} from '../shared'
import { flagDoubleTableBillsIfNeeded } from './bill-flags.service'
import {
  closeSplitParentIfAllChildrenSettled,
  envelopeToInsertRow,
  findBillEventSeqConflicts,
  findMissingTablesInOutlet,
  insertBillEvents,
  insertInitialBillRow,
  loadBillProjectionState,
  loadExistingBillEventIds,
  lockBillsForUpdate,
  persistBillProjectionDiff,
  readBillLastEventSeq,
  type BillRow,
} from './bill.repo'
import { executeBillMerge, executeBillSplit } from './split-merge.service'

const SERVER_ONLY_EVENT_TYPES = new Set([
  'BILL_HANDED_OVER',
  'BILL_ACCEPTED',
  'BILL_HANDOVER_CANCELED',
])

/**
 * Handles `AppendBillEvents` inside a single tenant transaction (ARCH §5.2, BR-FNB-005/010/012):
 * `idempotency_command` -> `bill FOR UPDATE` -> `bill_event` insert -> projection update -> flags.
 */
export const appendBillEventsCommandHandler: CommandHandler<AppendBillEventsPayloadV1, TenantTx> = {
  type: 'AppendBillEvents',

  parse(payload: unknown, schemaVersion: number): AppendBillEventsPayloadV1 {
    return parseCommandPayload('AppendBillEvents', schemaVersion, payload) as AppendBillEventsPayloadV1
  },

  async handle(
    tx: TenantTx,
    ctx: CommandContext,
    payload: AppendBillEventsPayloadV1,
  ): Promise<Record<string, unknown>> {
    const tenantId = ctx.device.tenantId
    const outletId = ctx.device.outletId

    // 1. Envelope scope, event-type boundary, and reference checks
    const staffIds: string[] = []
    const tableIds: string[] = []
    const skuIds: string[] = []
    const uomIds: string[] = []
    const modifierIds: string[] = []

    for (const evt of payload.events) {
      if (evt.bill_id !== payload.bill_id) {
        throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', 'Event bill_id mismatch')
      }
      if (evt.device_id !== ctx.device.deviceId || evt.register_id !== ctx.device.registerId) {
        throw new CommandRejected(
          'AUTHORIZATION',
          'FORBIDDEN',
          'Bill event device_id/register_id does not match authenticated device',
        )
      }
      if (SERVER_ONLY_EVENT_TYPES.has(evt.event_type)) {
        throw new CommandRejected(
          'STRUCTURAL',
          'VALIDATION_FAILED',
          `Event ${evt.event_type} cannot be appended via AppendBillEvents`,
        )
      }
      staffIds.push(evt.staff_id)
      if (evt.event_type === 'BILL_OPENED') {
        tableIds.push(BillOpenedPayloadSchema.parse(evt.payload).table_id)
      } else if (evt.event_type === 'TABLE_SET') {
        tableIds.push(TableSetPayloadSchema.parse(evt.payload).table_id)
      } else if (evt.event_type === 'ITEM_ADDED') {
        const p = ItemAddedPayloadSchema.parse(evt.payload)
        skuIds.push(p.sku_id)
        uomIds.push(p.uom_id)
        for (const m of p.modifiers) modifierIds.push(m.modifier_id)
      } else if (evt.event_type === 'MODIFIER_SET') {
        const p = ModifierSetPayloadSchema.parse(evt.payload)
        for (const m of p.modifiers) modifierIds.push(m.modifier_id)
      }
    }

    const missingUser = await findMissingAppUserId(tx, tenantId, staffIds)
    if (missingUser) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown staff_id ${missingUser}`)
    }
    const missingTable = await findMissingTablesInOutlet(tx, tenantId, outletId, tableIds)
    if (missingTable) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown table_id ${missingTable}`)
    }
    const catCheck = await filterMissingCatalogRefs(tx, { tenantId, skuIds, uomIds })
    if (catCheck.missingSkuId) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown sku_id ${catCheck.missingSkuId}`)
    }
    if (catCheck.missingUomId) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown uom_id ${catCheck.missingUomId}`)
    }
    const missingMod = await findMissingModifierId(tx, tenantId, modifierIds)
    if (missingMod) {
      throw new CommandRejected('STRUCTURAL', 'UNKNOWN_REFERENCE', `Unknown modifier_id ${missingMod}`)
    }

    // 2. Event-level idempotency check
    const existingById = await loadExistingBillEventIds(
      tx,
      tenantId,
      payload.events.map((e) => e.id),
    )

    const pendingEvents: BillEventEnvelopeV1[] = []
    for (const evt of payload.events) {
      const prior = existingById.get(evt.id)
      if (prior) {
        if (prior.billId !== evt.bill_id || prior.billSeq !== evt.bill_seq) {
          throw new CommandRejected(
            'STRUCTURAL',
            'BILL_SEQ_CONFLICT',
            `Event ${evt.id} already exists for a different bill or sequence`,
          )
        }
        continue
      }
      pendingEvents.push(evt)
    }

    if (pendingEvents.length === 0) {
      const currentSeq = (await readBillLastEventSeq(tx, tenantId, payload.bill_id)) ?? 0
      return {
        bill_id: payload.bill_id,
        last_event_seq: currentSeq,
        applied: 0,
        skipped: payload.events.length,
      }
    }

    // 3. Collect all referenced bill IDs and lock existing rows FOR UPDATE in deterministic ID order
    const billIdsToLock = new Set<string>([payload.bill_id])
    const mergeSourceIds = new Set<string>()
    for (const evt of pendingEvents) {
      if (evt.event_type === 'BILL_SPLIT') {
        const sp = BillSplitPayloadSchema.parse(evt.payload)
        for (const c of sp.children) {
          billIdsToLock.add(c.child_bill_id)
        }
      } else if (evt.event_type === 'BILL_MERGED') {
        const mg = BillMergedPayloadSchema.parse(evt.payload)
        for (const srcId of mg.source_bill_ids) {
          billIdsToLock.add(srcId)
          mergeSourceIds.add(srcId)
        }
      }
    }

    const lockedBills = await lockBillsForUpdate(tx, tenantId, [...billIdsToLock])
    const lockedRow = lockedBills.get(payload.bill_id) ?? null
    let prevState: BillProjectionState

    if (!lockedRow) {
      const first = pendingEvents[0]!
      if (first.event_type !== 'BILL_OPENED') {
        throw new CommandRejected(
          'STRUCTURAL',
          'UNKNOWN_REFERENCE',
          `Bill ${payload.bill_id} does not exist yet`,
        )
      }
      if (first.bill_seq !== 1) {
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_SEQ_GAP',
          `BILL_OPENED must start at bill_seq 1, got ${first.bill_seq}`,
        )
      }
      const opened = BillOpenedPayloadSchema.parse(first.payload)
      await insertInitialBillRow(tx, {
        billId: payload.bill_id,
        tenantId,
        outletId,
        registerId: ctx.device.registerId,
        deviceId: ctx.device.deviceId,
        tableId: opened.table_id,
        billRef: opened.bill_ref,
        createdBy: first.staff_id,
        createdAtDevice: first.created_at_device,
        clockOffsetMs: first.clock_offset_ms,
        occurredAt: first.occurred_at,
        businessDate: first.business_date,
        receivedAtIso: ctx.receivedAtIso,
        commandId: ctx.commandId,
        schemaVersion: first.schema_version,
        appVersion: first.app_version ?? ctx.appVersion,
      })
      prevState = emptyBill(payload.bill_id)
    } else {
      // Lease & status validation for unapplied events (FR-FNB-002, BR-FNB-003/012)
      if (lockedRow.status !== 'OPEN') {
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_CLOSED',
          `Bill ${payload.bill_id} is ${lockedRow.status}`,
        )
      }
      if (lockedRow.leaseDeviceId !== ctx.device.deviceId) {
        throw new CommandRejected(
          'AUTHORIZATION',
          'NOT_LEASE_HOLDER',
          'Device is not the active lease holder of this bill',
        )
      }
      if (lockedRow.handoverStatus === 'PENDING') {
        throw new CommandRejected(
          'AUTHORIZATION',
          'BILL_READ_ONLY',
          'Bill is pending handover acceptance and cannot be edited',
        )
      }
      prevState = await loadBillProjectionState(tx, tenantId, lockedRow)
    }

    // 4. Sequence conflict & gap checks
    const seqConflicts = await findBillEventSeqConflicts(
      tx,
      tenantId,
      payload.bill_id,
      pendingEvents.map((e) => e.bill_seq),
    )
    for (const evt of pendingEvents) {
      const conflictEventId = seqConflicts.get(evt.bill_seq)
      if (conflictEventId && conflictEventId !== evt.id) {
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_SEQ_CONFLICT',
          `bill_seq ${evt.bill_seq} already occupied by event ${conflictEventId}`,
        )
      }
    }

    let expectedSeq = prevState.lastEventSeq + 1
    for (const evt of pendingEvents) {
      if (evt.bill_seq < expectedSeq) {
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_SEQ_CONFLICT',
          `bill_seq ${evt.bill_seq} is behind expected ${expectedSeq}`,
        )
      }
      if (evt.bill_seq > expectedSeq) {
        throw new CommandRejected(
          'STRUCTURAL',
          'BILL_SEQ_GAP',
          `bill_seq ${evt.bill_seq} skips expected ${expectedSeq}`,
        )
      }
      expectedSeq += 1
    }

    // 5. Insert incoming bill_event rows BEFORE projection diff / split / merge
    //    so fk_bill_item__created_event is satisfied (rollback on any subsequent error).
    await insertBillEvents(
      tx,
      pendingEvents.map((evt) =>
        envelopeToInsertRow(evt, {
          tenantId,
          outletId,
          commandId: ctx.commandId,
          receivedAtIso: ctx.receivedAtIso,
          appVersion: ctx.appVersion,
        }),
      ),
    )

    // 6. Apply pure projection reducer and execute any server-atomic BILL_SPLIT / BILL_MERGED
    const sourceStatesById = new Map<string, BillProjectionState>()
    for (const srcId of mergeSourceIds) {
      const srcRow: BillRow | undefined = lockedBills.get(srcId)
      if (srcRow) {
        sourceStatesById.set(srcId, await loadBillProjectionState(tx, tenantId, srcRow))
      }
    }

    let nextState = prevState
    let hasPrebillPrinted = false
    let tableChangeEvent: BillEventEnvelopeV1 | null = null
    let handledSplitOrMerge = false

    for (const evt of pendingEvents) {
      if (evt.event_type === 'BILL_SPLIT') {
        if (nextState !== prevState) {
          await persistBillProjectionDiff(tx, {
            tenantId,
            outletId,
            prevState,
            nextState,
            receivedAtIso: ctx.receivedAtIso,
            hasPrebillPrinted,
          })
          hasPrebillPrinted = false
        }
        await executeBillSplit(tx, ctx, {
          parentState: nextState,
          parentRow: lockedRow,
          evt,
          lockedBills,
        })
        nextState = applyBillEvent(nextState, evt)
        prevState = nextState
        handledSplitOrMerge = true
        continue
      }

      if (evt.event_type === 'BILL_MERGED') {
        if (nextState !== prevState) {
          await persistBillProjectionDiff(tx, {
            tenantId,
            outletId,
            prevState,
            nextState,
            receivedAtIso: ctx.receivedAtIso,
            hasPrebillPrinted,
          })
          hasPrebillPrinted = false
        }
        await executeBillMerge(tx, ctx, {
          targetState: nextState,
          targetRow: lockedRow,
          evt,
          lockedBills,
          sourceStates: sourceStatesById,
        })
        const refreshed = await lockBillsForUpdate(tx, tenantId, [payload.bill_id])
        const refreshedTarget = refreshed.get(payload.bill_id)
        nextState = refreshedTarget
          ? await loadBillProjectionState(tx, tenantId, refreshedTarget)
          : applyBillEvent(nextState, evt)
        prevState = nextState
        handledSplitOrMerge = true
        continue
      }

      try {
        nextState = applyBillEvent(nextState, evt)
      } catch (err) {
        if (err instanceof BillProjectionError) {
          const code = err.code === 'BILL_CLOSED' ? 'BILL_CLOSED' : 'VALIDATION_FAILED'
          throw new CommandRejected('STRUCTURAL', code, err.message)
        }
        throw err
      }
      if (evt.event_type === 'PREBILL_PRINTED') hasPrebillPrinted = true
      if (evt.event_type === 'BILL_OPENED' || evt.event_type === 'TABLE_SET') {
        tableChangeEvent = evt
      }
    }

    if (!handledSplitOrMerge || nextState !== prevState || hasPrebillPrinted) {
      await persistBillProjectionDiff(tx, {
        tenantId,
        outletId,
        prevState,
        nextState,
        receivedAtIso: ctx.receivedAtIso,
        hasPrebillPrinted,
      })
    }

    if (nextState.status === 'CANCELED' && lockedRow?.parentBillId) {
      await closeSplitParentIfAllChildrenSettled(
        tx,
        tenantId,
        lockedRow.parentBillId,
        ctx.receivedAtIso,
      )
    }

    // 7. Non-blocking unit_price modifier consistency verification (BR-PRC-006)
    for (const evt of pendingEvents) {
      if (evt.event_type === 'ITEM_ADDED') {
        const p = ItemAddedPayloadSchema.parse(evt.payload)
        if (p.base_unit_price !== undefined) {
          const check = verifyBillItemUnitPrice(
            toMoney(p.base_unit_price),
            p.modifiers,
            toMoney(p.unit_price),
          )
          if (!check.ok) {
            await createDataFlag(tx, {
              tenantId,
              outletId,
              businessDate: evt.business_date,
              flagCode: 'SELISIH_HITUNG',
              entityType: 'BILL',
              entityId: payload.bill_id,
              diffAmount: check.diffAmount,
              commandId: ctx.commandId,
              detail: {
                event_id: evt.id,
                item_id: p.item_id,
                expected_unit_price: check.expectedUnitPrice,
                actual_unit_price: p.unit_price,
              },
            })
          }
        }
      } else if (evt.event_type === 'MODIFIER_SET') {
        const p = ModifierSetPayloadSchema.parse(evt.payload)
        if (p.base_unit_price !== undefined) {
          const check = verifyBillItemUnitPrice(
            toMoney(p.base_unit_price),
            p.modifiers,
            toMoney(p.unit_price),
          )
          if (!check.ok) {
            await createDataFlag(tx, {
              tenantId,
              outletId,
              businessDate: evt.business_date,
              flagCode: 'SELISIH_HITUNG',
              entityType: 'BILL',
              entityId: payload.bill_id,
              diffAmount: check.diffAmount,
              commandId: ctx.commandId,
              detail: {
                event_id: evt.id,
                item_id: p.item_id,
                expected_unit_price: check.expectedUnitPrice,
                actual_unit_price: p.unit_price,
              },
            })
          }
        }
      }
    }

    // 8. Double-bill table flag (EC-015)
    if (tableChangeEvent && nextState.tableId && nextState.status === 'OPEN') {
      await flagDoubleTableBillsIfNeeded(tx, {
        tenantId,
        outletId,
        billId: payload.bill_id,
        tableId: nextState.tableId,
        businessDate: tableChangeEvent.business_date,
        commandId: ctx.commandId,
      })
    }

    registerAfterCommit(tx, () => publishBillsChanged(tenantId, outletId))

    return {
      bill_id: payload.bill_id,
      last_event_seq: nextState.lastEventSeq,
      applied: pendingEvents.length,
      skipped: payload.events.length - pendingEvents.length,
    }
  },
}
