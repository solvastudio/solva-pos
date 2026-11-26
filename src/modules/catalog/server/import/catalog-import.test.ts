import { describe, expect, it } from 'vitest'
import { parseAndValidateCatalogCsvRows } from './catalog-csv'

describe('catalog-import row validation', () => {
  it('validates fields and maps all structural row error codes cleanly', () => {
    const csv = [
      'kategori,kode_produk,nama_produk,tipe,uom_dasar,kode_sku,label_varian,barcode,harga_default,pajak,lacak_stok,open_price,aktif',
      'Minuman > Kopi,KP-1,Kopi Susu,RETAIL,pcs,KP-1,,899001,15000,Y,Y,N,Y',
      ',BAD CODE!,Missing Cat,INVALID,P$C,,Reg,,abc,MAYBE,X,Z,?',
      'A > B > C,KP-2,Depth 3,RETAIL,pcs,KP-2,,, -5,Y,Y,N,Y',
    ].join('\n')

    const res = parseAndValidateCatalogCsvRows(csv)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]!.categorySegments).toEqual(['Minuman', 'Kopi'])
    expect(res.totalErrors).toBeGreaterThanOrEqual(8)

    const codes = new Set(res.errors.map((e) => e.code))
    expect(codes.has('REQUIRED')).toBe(true)
    expect(codes.has('INVALID_FORMAT')).toBe(true)
    expect(codes.has('CATEGORY_DEPTH')).toBe(true)
    expect(codes.has('PRICE_RANGE')).toBe(true)
  })
})
