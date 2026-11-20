import { describe, expect, it } from 'vitest'
import { csvSafeCell, toCsv, unwrapCsvFormulaEscape } from './csv-safe'
import { parseCsv } from './parse-csv'

describe('csv-safe', () => {
  it('prefixes formula-trigger characters on export and preserves normal text', () => {
    expect(csvSafeCell('=1+1')).toBe("'=1+1")
    expect(csvSafeCell('+cmd|calc')).toBe("'+cmd|calc")
    expect(csvSafeCell('-100')).toBe("'-100")
    expect(csvSafeCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)")
    expect(csvSafeCell('\twhoami')).toBe("'\twhoami")
    expect(csvSafeCell('\rabc')).toBe("'\rabc")
    expect(csvSafeCell('Kopi Susu')).toBe('Kopi Susu')
    expect(csvSafeCell("'O'Brien")).toBe("'O'Brien")
    expect(csvSafeCell(null)).toBe('')
  })

  it('quotes cells containing delimiter, quotes, or newlines and round-trips formula cells safely', () => {
    const csv = toCsv(
      [
        ['KOP-1', '=SUM(1,2)', 'Say "Hi"\nLine2', "'NormalQuote"],
      ],
      ['kode', 'nama', 'catatan', 'quote'],
    )

    expect(csv).toContain("'=SUM(1,2)")
    expect(csv).toContain('"Say ""Hi""\nLine2"')

    const parsed = parseCsv(csv, {
      requiredColumns: ['kode', 'nama'],
      aliases: {
        kode: 'kode',
        nama: 'nama',
        catatan: 'catatan',
        quote: 'quote',
      },
    })
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]!.cells.nama).toBe('=SUM(1,2)')
    expect(parsed.rows[0]!.cells.catatan).toBe('Say "Hi"\nLine2')
    expect(parsed.rows[0]!.cells.quote).toBe("'NormalQuote")
    expect(unwrapCsvFormulaEscape("'hello")).toBe("'hello")
  })
})
