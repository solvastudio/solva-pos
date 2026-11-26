import '@tanstack/react-start/server-only'
import type { FinalizeSalePayloadV1, FlagCode } from '~/lib/contracts'
import { parseIsoUtcMs, parseQty, ratioRound, toMoney } from '~/lib/kernel'
import { selectTaxRate } from '~/lib/sales-calc'
import {
  getCurrentPrices,
  getEffectiveAvailabilityRows,
  getProductSkuStates,
} from '~/modules/catalog/public'
import { getTaxRateHistory } from '~/modules/identity/public'
import { createDataFlag, type CommandContext } from '~/modules/sync/public'
import type { TenantTx } from '~/server/db'

/**
 * Evaluates non-blocking business discrepancy flags (`HARGA_STALE`, `ITEM_NONAKTIF`,
 * `ITEM_TIDAK_TERSEDIA`, `TARIF_BERBEDA`) for a persisted sale without altering client values.
 */
export async function evaluateSaleBusinessFlags(
  tx: TenantTx,
  ctx: CommandContext,
  payload: FinalizeSalePayloadV1,
): Promise<FlagCode[]> {
  const raisedFlags = new Set<FlagCode>()
  const s = payload.sale
  const tenantId = ctx.device.tenantId
  const outletId = ctx.device.outletId
  const occurredMs = parseIsoUtcMs(s.occurred_at)

  const eligibleLines = payload.lines.filter(
    (line): line is typeof line & { sku_id: string } =>
      line.line_kind !== 'SHARE' && line.line_kind !== 'STOCK_BASIS' && Boolean(line.sku_id),
  )
  const skuStates = await getProductSkuStates(
    tx,
    eligibleLines.map((line) => line.sku_id),
  )
  const priceChecked = eligibleLines.filter(
    (line): line is typeof line & { uom_id: string } =>
      line.price_source !== 'OPEN_PRICE' && !line.is_open_price && Boolean(line.uom_id),
  )
  const currentPrices = await getCurrentPrices(tx, {
    outletId,
    pairs: priceChecked.map((line) => ({ skuId: line.sku_id, uomId: line.uom_id })),
    states: skuStates,
  })
  const availabilityByKey = await getEffectiveAvailabilityRows(tx, {
    outletId,
    items: eligibleLines.map((line) => ({ productId: line.product_id, skuId: line.sku_id })),
    states: skuStates,
  })

  for (const line of eligibleLines) {
    const skuState = skuStates.get(line.sku_id) ?? null
    if (!skuState || !skuState.productActive || !skuState.skuActive) {
      await createDataFlag(tx, {
        tenantId,
        outletId,
        businessDate: s.business_date,
        flagCode: 'ITEM_NONAKTIF',
        entityType: 'SALE_LINE',
        entityId: line.id,
        parentId: s.id,
        commandId: ctx.commandId,
        detail: { sku_id: line.sku_id },
      })
      raisedFlags.add('ITEM_NONAKTIF')
    }

    if (line.price_source !== 'OPEN_PRICE' && !line.is_open_price && line.uom_id) {
      const priceRes = currentPrices.get(`${line.sku_id}:${line.uom_id}`)
      if (priceRes && priceRes.kind === 'PRICE' && priceRes.price !== line.unit_price) {
        const diffMag = ratioRound(
          toMoney(Math.abs(line.unit_price - priceRes.price)),
          parseQty(line.qty),
          parseQty('1'),
        )
        const signedDiff = line.unit_price < priceRes.price ? -diffMag : diffMag
        await createDataFlag(tx, {
          tenantId,
          outletId,
          businessDate: s.business_date,
          flagCode: 'HARGA_STALE',
          entityType: 'SALE_LINE',
          entityId: line.id,
          parentId: s.id,
          diffAmount: signedDiff,
          commandId: ctx.commandId,
          detail: {
            sold_price: line.unit_price,
            latest_price: priceRes.price,
          },
        })
        raisedFlags.add('HARGA_STALE')
      }
    }

    const avail = availabilityByKey.get(`${line.product_id ?? skuState?.productId ?? null}:${line.sku_id}`)
    if (avail && avail.status === 'UNAVAILABLE') {
      const afterCursor = s.catalog_cursor === null || avail.version > s.catalog_cursor
      const changedMs = parseIsoUtcMs(avail.changedAt)
      if (afterCursor && occurredMs >= changedMs) {
        await createDataFlag(tx, {
          tenantId,
          outletId,
          businessDate: s.business_date,
          flagCode: 'ITEM_TIDAK_TERSEDIA',
          entityType: 'SALE_LINE',
          entityId: line.id,
          parentId: s.id,
          commandId: ctx.commandId,
          detail: {
            changed_version: avail.version,
            catalog_cursor: s.catalog_cursor,
          },
        })
        raisedFlags.add('ITEM_TIDAK_TERSEDIA')
      }
    }
  }

  if (s.tax_profile !== 'NONE') {
    const history = await getTaxRateHistory(tx, outletId)
    const expected = selectTaxRate(history, s.tax_profile, outletId, s.business_date)
    const expectedRateStr = expected ? expected.rate : '0.0000'
    if (Number(expectedRateStr) !== Number(s.tax_rate)) {
      await createDataFlag(tx, {
        tenantId,
        outletId,
        businessDate: s.business_date,
        flagCode: 'TARIF_BERBEDA',
        entityType: 'SALE',
        entityId: s.id,
        commandId: ctx.commandId,
        detail: {
          expected_rate: expectedRateStr,
          actual_rate: s.tax_rate,
        },
      })
      raisedFlags.add('TARIF_BERBEDA')
    }
  }

  return [...raisedFlags]
}
