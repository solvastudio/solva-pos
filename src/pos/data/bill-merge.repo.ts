import type { Table } from 'dexie'
import { SCHEMA_VERSION, type AppendBillEventsPayloadV1 } from '~/lib/contracts'
import { mergeSimilarItems, type BillEventEnvelopeV1, type BillProjectionItem } from '~/modules/fnb/shared'
import type { SolvaDb } from '../db/solva-db'
import type {
  BillEventRecord,
  BillItemModifierRecord,
  BillItemRecord,
  BillRecord,
  OutboxCommandRow,
} from '../db/types'
import { canEditBill } from '../domain/bill-guards'
import { BillRepoError, readEnvForBillAction, type BillMutationDeps } from './bill.repo'
import { billSeqCounterKey, DEVICE_SEQ_KEY, nextSeq } from './counter.repo'
import { enqueueCommand } from './outbox.repo'
import { kickActiveSync } from '../sync'

/**
 * Atomically merges one or more open bills held by this device into `targetBillId`,
 * consolidating identical items via `mergeSimilarItems` and enqueuing `BILL_MERGED`.
 */
export async function mergeBillsLocal(
  db: SolvaDb,
  input: {
    targetBillId: string
    sourceBillIds: readonly string[]
    staffId: string
  },
  deps: BillMutationDeps = {},
): Promise<{ target: BillRecord; event: BillEventEnvelopeV1 }> {
  const uniqueSources = [...new Set(input.sourceBillIds)].filter((id) => id !== input.targetBillId)
  if (uniqueSources.length === 0) {
    throw new BillRepoError('CANNOT_EDIT', 'Merge requires at least one source bill')
  }
  const env = await readEnvForBillAction(db, deps)

  return db.transaction(
    'rw',
    [db.bill, db.bill_item, db.bill_item_modifier, db.bill_event, db.outbox_command, db.local_counter],
    async (tx) => {
      const billTable: Table<BillRecord, string> = tx.table('bill')
      const itemTable: Table<BillItemRecord, string> = tx.table('bill_item')
      const modTable: Table<BillItemModifierRecord, string> = tx.table('bill_item_modifier')
      const eventTable: Table<BillEventRecord, string> = tx.table('bill_event')

      const target = await billTable.get(input.targetBillId)
      if (!target) throw new BillRepoError('BILL_NOT_FOUND', 'Target bill not found')
      const editTarget = canEditBill(target, env.device.device_id)
      if (!editTarget.ok || target.parent_bill_id !== null) {
        throw new BillRepoError('CANNOT_EDIT', 'Target bill cannot be merged')
      }

      const targetItems = await itemTable.where('bill_id').equals(target.id).toArray()
      const targetMods =
        targetItems.length > 0
          ? await modTable.where('bill_item_id').anyOf(targetItems.map((i) => i.id)).toArray()
          : []
      const modsByItem = new Map<string, BillItemModifierRecord[]>()
      for (const m of targetMods) {
        const arr = modsByItem.get(m.bill_item_id) ?? []
        arr.push(m)
        modsByItem.set(m.bill_item_id, arr)
      }

      const toProjItem = (
        it: BillItemRecord,
        mods: readonly BillItemModifierRecord[],
      ): BillProjectionItem => ({
        id: it.id,
        lineNo: it.line_no,
        skuId: it.sku_id,
        uomId: it.uom_id,
        skuCode: it.sku_code,
        itemName: it.item_name,
        uomCode: it.uom_code,
        qty: it.qty,
        conversionFactor: it.conversion_factor,
        unitPrice: it.unit_price,
        priceSource: it.price_source,
        isOpenPrice: it.is_open_price,
        taxable: it.taxable,
        discountType: it.discount_type,
        discountPct: it.discount_pct,
        discountInput: it.discount_input,
        discountApprovedBy: it.discount_approved_by,
        note: it.note,
        status: it.status,
        voidReasonCode: it.void_reason_code ?? null,
        voidReasonText: it.void_reason_text ?? null,
        createdEventId: it.created_event_id,
        modifiers: mods.map((m) => ({
          modifierId: m.modifier_id,
          name: m.name,
          priceDelta: m.price_delta,
          qty: m.qty,
        })),
      })

      const incoming: {
        originBillId: string
        originItemId: string
        newItemId: string
        item: BillProjectionItem
        productId: string | null
      }[] = []
      const movedItemTargets: Record<string, string> = {}
      const sourceEventIds: Record<string, string> = {}
      const sourceDeviceSeqs: Record<string, number> = {}
      const dependsOnIds: string[] = []
      const sourcesToClose: { bill: BillRecord; activeIds: string[]; seq: number }[] = []

      for (const srcId of uniqueSources) {
        const src = await billTable.get(srcId)
        if (!src) throw new BillRepoError('BILL_NOT_FOUND', `Source bill ${srcId} not found`)
        const editSrc = canEditBill(src, env.device.device_id)
        if (!editSrc.ok || src.parent_bill_id !== null) {
          throw new BillRepoError('CANNOT_EDIT', `Source bill ${src.bill_ref} cannot be merged`)
        }

        const srcItems = await itemTable.where('bill_id').equals(srcId).toArray()
        const srcMods =
          srcItems.length > 0
            ? await modTable.where('bill_item_id').anyOf(srcItems.map((i) => i.id)).toArray()
            : []
        const srcModMap = new Map<string, BillItemModifierRecord[]>()
        for (const m of srcMods) {
          const arr = srcModMap.get(m.bill_item_id) ?? []
          arr.push(m)
          srcModMap.set(m.bill_item_id, arr)
        }

        const activeIds: string[] = []
        for (const it of srcItems) {
          if (it.status !== 'ACTIVE') continue
          activeIds.push(it.id)
          const newId = env.newId()
          movedItemTargets[it.id] = newId
          incoming.push({
            originBillId: srcId,
            originItemId: it.id,
            newItemId: newId,
            productId: it.product_id ?? null,
            item: toProjItem(it, srcModMap.get(it.id) ?? []),
          })
        }

        sourceEventIds[srcId] = env.newId()
        sourceDeviceSeqs[srcId] = await nextSeq(tx, DEVICE_SEQ_KEY, {
          registerId: env.device.register_id,
          updatedAt: env.createdAtDevice,
        })
        const nextSrcSeq = await nextSeq(tx, billSeqCounterKey(srcId), {
          registerId: env.device.register_id,
          docType: 'BILL_SEQ',
          updatedAt: env.createdAtDevice,
        })
        sourcesToClose.push({ bill: src, activeIds, seq: nextSrcSeq })

        const srcPending = await tx
          .table<OutboxCommandRow, string>('outbox_command')
          .where('dependency_key')
          .equals(`bill:${srcId}`)
          .toArray()
        const latestSrc = srcPending
          .filter((c) => c.status !== 'ACKED' && c.status !== 'DISMISSED')
          .sort((a, b) => b.device_seq - a.device_seq)[0]
        if (latestSrc) dependsOnIds.push(latestSrc.id)
      }

      const targetSeq = await nextSeq(tx, billSeqCounterKey(target.id), {
        registerId: env.device.register_id,
        docType: 'BILL_SEQ',
        updatedAt: env.createdAtDevice,
      })
      const targetDevSeq = await nextSeq(tx, DEVICE_SEQ_KEY, {
        registerId: env.device.register_id,
        updatedAt: env.createdAtDevice,
      })
      const mergeEvt: BillEventEnvelopeV1 = {
        id: env.newId(),
        bill_id: target.id,
        bill_seq: targetSeq,
        device_id: env.device.device_id,
        register_id: env.device.register_id,
        device_seq: targetDevSeq,
        staff_id: input.staffId,
        event_type: 'BILL_MERGED',
        payload: {
          source_bill_ids: uniqueSources,
          source_event_ids: sourceEventIds,
          source_device_seqs: sourceDeviceSeqs,
          moved_item_targets: movedItemTargets,
        },
        created_at_device: env.createdAtDevice,
        clock_offset_ms: env.offsetMs,
        occurred_at: env.occurredAt,
        business_date: env.businessDate,
        schema_version: SCHEMA_VERSION,
        app_version: env.appVersion,
      }

      await eventTable.add({
        id: mergeEvt.id,
        bill_id: mergeEvt.bill_id,
        bill_seq: mergeEvt.bill_seq,
        device_id: mergeEvt.device_id,
        register_id: mergeEvt.register_id,
        device_seq: mergeEvt.device_seq,
        staff_id: mergeEvt.staff_id,
        event_type: mergeEvt.event_type,
        payload: mergeEvt.payload,
        reason_code: null,
        reason_text: null,
        created_at_device: mergeEvt.created_at_device,
        clock_offset_ms: mergeEvt.clock_offset_ms,
        occurred_at: mergeEvt.occurred_at,
        business_date: mergeEvt.business_date,
        schema_version: mergeEvt.schema_version,
        app_version: mergeEvt.app_version ?? null,
      })

      const targetProjItems = targetItems.map((it) => toProjItem(it, modsByItem.get(it.id) ?? []))
      const merged = mergeSimilarItems(targetProjItems, incoming)
      const incomingByNewId = new Map(incoming.map((inc) => [inc.newItemId, inc] as const))

      for (const upd of merged.updatedExisting) {
        await itemTable.update(upd.id, { qty: upd.nextQty })
      }
      for (const added of merged.insertedNew) {
        const incMeta = incomingByNewId.get(added.id)
        await itemTable.put({
          id: added.id,
          bill_id: target.id,
          line_no: added.lineNo,
          product_id: incMeta?.productId ?? null,
          sku_id: added.skuId,
          uom_id: added.uomId,
          sku_code: added.skuCode,
          item_name: added.itemName,
          uom_code: added.uomCode,
          qty: added.qty,
          conversion_factor: added.conversionFactor,
          unit_price: added.unitPrice,
          price_source: added.priceSource,
          is_open_price: added.isOpenPrice,
          taxable: added.taxable,
          discount_type: added.discountType,
          discount_pct: added.discountPct,
          discount_input: added.discountInput,
          discount_approved_by: added.discountApprovedBy,
          note: added.note,
          status: 'ACTIVE',
          void_reason_code: null,
          void_reason_text: null,
          created_event_id: mergeEvt.id,
        })
        if (added.modifiers.length > 0) {
          await modTable.bulkPut(
            added.modifiers.map((m) => ({
              id: `${added.id}:${m.modifierId}`,
              bill_item_id: added.id,
              modifier_id: m.modifierId,
              name: m.name,
              price_delta: m.priceDelta,
              qty: m.qty,
            })),
          )
        }
      }

      for (const sc of sourcesToClose) {
        for (const itemId of sc.activeIds) {
          await itemTable.update(itemId, { status: 'MOVED' })
        }
        await billTable.update(sc.bill.id, {
          status: 'MERGED',
          handover_status: 'NONE',
          handover_target_register_id: null,
          handover_event_id: null,
          handover_requested_at: null,
          last_event_seq: sc.seq,
          last_event_at: env.occurredAt,
          closed_at: env.occurredAt,
          sync_status: 'PENDING',
        })
      }

      const updatedTarget: BillRecord = {
        ...target,
        last_content_seq: targetSeq,
        last_event_seq: targetSeq,
        last_event_at: env.occurredAt,
        sync_status: 'PENDING',
      }
      await billTable.put(updatedTarget)

      const cmdId = env.newId()
      const payload: AppendBillEventsPayloadV1 = {
        bill_id: target.id,
        events: [mergeEvt],
      }
      await enqueueCommand(tx, {
        id: cmdId,
        type: 'AppendBillEvents',
        payload,
        schemaVersion: SCHEMA_VERSION,
        registerId: env.device.register_id,
        dependencyKey: `bill:${target.id}`,
        ...(dependsOnIds.length > 0 ? { dependsOn: dependsOnIds } : {}),
        createdAtDevice: env.createdAtDevice,
      })

      return { target: updatedTarget, event: mergeEvt }
    },
  ).then((res) => {
    kickActiveSync()
    return res
  })
}
