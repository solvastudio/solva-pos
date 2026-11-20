import { describe, expect, it } from 'vitest'
import { CsvImportError, parseCsv } from './parse-csv'

const TEST_ALIASES = {
  kode_produk: 'kode_produk',
  product_code: 'kode_produk',
  nama_produk: 'nama_produk',
  catatan: 'catatan',
} as const

describe('parse-csv', () => {
  it('handles UTF-8 BOM, semicolon delimiters, nested quotes, CRLF, and multiline quoted cells', () => {
    const raw =
      '\uFEFFproduct_code;nama_produk;catatan;extra_col\r\n' +
      '"KP-1";"Kopi ""Spesial""";"Line 1\nLine 2";ignored\r\n' +
      '"KP-2";Teh;"Plain";ignored2\r\n'

    const parsed = parseCsv(raw, {
      aliases: TEST_ALIASES,
      requiredColumns: ['kode_produk', 'nama_produk'],
    })

    expect(parsed.delimiter).toBe(';')
    expect(parsed.warnings).toEqual(['Unknown column ignored: "extra_col"'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toEqual({
      rowNumber: 2,
      cells: {
        kode_produk: 'KP-1',
        nama_produk: 'Kopi "Spesial"',
        catatan: 'Line 1\nLine 2',
      },
    })
    expect(parsed.rows[1]).toEqual({
      rowNumber: 3,
      cells: {
        kode_produk: 'KP-2',
        nama_produk: 'Teh',
        catatan: 'Plain',
      },
    })
  })

  it('rejects files exceeding row, size, column, or cell limits with LIMIT_EXCEEDED', () => {
    const tooManyRows = ['kode_produk,nama_produk']
    for (let i = 1; i <= 5001; i += 1) {
      tooManyRows.push(`P-${i},Product ${i}`)
    }
    expect(() =>
      parseCsv(tooManyRows.join('\n'), {
        aliases: TEST_ALIASES,
        requiredColumns: ['kode_produk', 'nama_produk'],
      }),
    ).toThrowError(new CsvImportError('LIMIT_EXCEEDED', 'Row count exceeds maximum 5000 data rows'))

    const longCell = 'x'.repeat(501)
    expect(() =>
      parseCsv(`kode_produk,nama_produk\nP-1,${longCell}`, {
        aliases: TEST_ALIASES,
        requiredColumns: ['kode_produk', 'nama_produk'],
      }),
    ).toThrowError(CsvImportError)

    expect(() =>
      parseCsv('kode_produk,nama_produk\nP-1', {
        aliases: TEST_ALIASES,
        requiredColumns: ['kode_produk', 'nama_produk'],
        maxBytes: 10,
      }),
    ).toThrowError(CsvImportError)
  })

  it('throws MISSING_HEADER when required canonical columns are absent and INVALID_CSV on unclosed quotes', () => {
    expect(() =>
      parseCsv('kode_produk,other\nP-1,foo', {
        aliases: TEST_ALIASES,
        requiredColumns: ['kode_produk', 'nama_produk'],
      }),
    ).toThrowError(CsvImportError)

    expect(() =>
      parseCsv('kode_produk,nama_produk\nP-1,"unclosed', {
        aliases: TEST_ALIASES,
        requiredColumns: ['kode_produk', 'nama_produk'],
      }),
    ).toThrowError(CsvImportError)
  })
})
