import { describe, expect, it } from 'vitest'
import { parseQty } from '~/lib/kernel'
import { estimateStock, isEstimateLow } from './stock-estimate'

const q = (s: string) => parseQty(s)

describe('pos/domain/stock-estimate (BR-STK-005, FR-POS-011)', () => {
  it('BR-STK-005 example: snapshot 20, 6 local sales not yet ACKed → estimate 14', () => {
    const est = estimateStock({
      skuId: 'sku-a',
      snapshotQty: q('20'),
      ackedDeviceSeq: 10,
      localSales: [
        { skuId: 'sku-a', qtyBase: q('2'), deviceSeq: 11 },
        { skuId: 'sku-a', qtyBase: q('4'), deviceSeq: 12 },
      ],
    })
    expect(est).toBe('14')
  })

  it('sales already reflected in the snapshot (device_seq ≤ acked) are not subtracted again', () => {
    const est = estimateStock({
      skuId: 'sku-a',
      snapshotQty: q('20'),
      ackedDeviceSeq: 12,
      localSales: [
        { skuId: 'sku-a', qtyBase: q('2'), deviceSeq: 11 },
        { skuId: 'sku-a', qtyBase: q('4'), deviceSeq: 12 },
        { skuId: 'sku-a', qtyBase: q('1'), deviceSeq: 13 },
      ],
    })
    expect(est).toBe('19')
  })

  it('a SKU without a snapshot yields null (not shown)', () => {
    const est = estimateStock({ skuId: 'sku-x', snapshotQty: null, ackedDeviceSeq: 0, localSales: [] })
    expect(est).toBeNull()
  })

  it('sales of other SKUs do not reduce the estimate', () => {
    const est = estimateStock({
      skuId: 'sku-a',
      snapshotQty: q('5'),
      ackedDeviceSeq: 0,
      localSales: [{ skuId: 'sku-b', qtyBase: q('3'), deviceSeq: 1 }],
    })
    expect(est).toBe('5')
  })

  it('isEstimateLow is true only for estimate ≤ 0 (not null)', () => {
    expect(isEstimateLow(q('0'))).toBe(true)
    expect(isEstimateLow(q('-2'))).toBe(true)
    expect(isEstimateLow(q('0.5'))).toBe(false)
    expect(isEstimateLow(null)).toBe(false)
  })
})
