import { describe, expect, it } from 'vitest'
import { parseQty } from '~/lib/kernel'
import { estimateStock, isEstimateLow } from './stock-estimate'

const q = (s: string) => parseQty(s)

describe('pos/domain/stock-estimate (BR-STK-005, FR-POS-011)', () => {
  it('contoh BR-STK-005: snapshot 20, penjualan lokal belum ACK 6 → estimasi 14', () => {
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

  it('penjualan yang sudah tercermin di snapshot (device_seq ≤ acked) tidak dikurangi lagi', () => {
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

  it('SKU tanpa snapshot menghasilkan null (tidak ditampilkan)', () => {
    const est = estimateStock({ skuId: 'sku-x', snapshotQty: null, ackedDeviceSeq: 0, localSales: [] })
    expect(est).toBeNull()
  })

  it('penjualan SKU lain tidak mengurangi estimasi', () => {
    const est = estimateStock({
      skuId: 'sku-a',
      snapshotQty: q('5'),
      ackedDeviceSeq: 0,
      localSales: [{ skuId: 'sku-b', qtyBase: q('3'), deviceSeq: 1 }],
    })
    expect(est).toBe('5')
  })

  it('isEstimateLow hanya true untuk estimasi ≤ 0 (bukan null)', () => {
    expect(isEstimateLow(q('0'))).toBe(true)
    expect(isEstimateLow(q('-2'))).toBe(true)
    expect(isEstimateLow(q('0.5'))).toBe(false)
    expect(isEstimateLow(null)).toBe(false)
  })
})
