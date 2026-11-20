import { unwrapCsvFormulaEscape } from './csv-safe'

export const CSV_MAX_BYTES = 2 * 1024 * 1024
export const CSV_MAX_DATA_ROWS = 5_000
export const CSV_MAX_COLUMNS = 30
export const CSV_MAX_CELL_LENGTH = 500

export type CsvImportErrorCode = 'LIMIT_EXCEEDED' | 'EMPTY_FILE' | 'INVALID_CSV' | 'MISSING_HEADER'

export class CsvImportError extends Error {
  constructor(
    public readonly code: CsvImportErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CsvImportError'
  }
}

export interface ParsedCsvRow {
  rowNumber: number
  cells: Record<string, string>
}

export interface ParseCsvOptions<K extends string = string> {
  aliases: Readonly<Record<string, K>>
  requiredColumns?: readonly K[]
  maxBytes?: number
  maxRows?: number
  maxColumns?: number
  maxCellLength?: number
}

export interface ParseCsvResult<K extends string = string> {
  delimiter: ',' | ';'
  headers: string[]
  warnings: string[]
  rows: Array<{ rowNumber: number; cells: Partial<Record<K, string>> }>
}

export function normalizeCsvHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function detectDelimiterFromHeader(text: string): ',' | ';' {
  let inQuotes = false
  let commas = 0
  let semis = 0

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      break
    }
    if (!inQuotes) {
      if (ch === ',') commas += 1
      else if (ch === ';') semis += 1
    }
  }
  return semis > commas ? ';' : ','
}

function parseRawRecords(
  input: string,
  delimiter: ',' | ';',
  limits: { maxRows: number; maxColumns: number; maxCellLength: number },
): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let justClosedQuote = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
          justClosedQuote = true
        }
      } else {
        field += ch
      }
      if (field.length > limits.maxCellLength) {
        throw new CsvImportError(
          'LIMIT_EXCEEDED',
          `Cell length exceeds maximum ${limits.maxCellLength} characters (row ${records.length + 1})`,
        )
      }
      continue
    }

    if (ch === '"') {
      if (field.length === 0 && !justClosedQuote) {
        inQuotes = true
      } else {
        throw new CsvImportError(
          'INVALID_CSV',
          `Unexpected quote inside unquoted field at row ${records.length + 1}`,
        )
      }
      continue
    }

    justClosedQuote = false

    if (ch === delimiter) {
      row.push(field)
      if (row.length >= limits.maxColumns) {
        throw new CsvImportError(
          'LIMIT_EXCEEDED',
          `Column count exceeds maximum ${limits.maxColumns} columns`,
        )
      }
      field = ''
      continue
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') {
        i += 1
      }
      row.push(field)
      field = ''
      // Ignore completely empty lines between/after records
      if (!(row.length === 1 && row[0] === '')) {
        records.push(row)
        if (records.length - 1 > limits.maxRows) {
          throw new CsvImportError(
            'LIMIT_EXCEEDED',
            `Row count exceeds maximum ${limits.maxRows} data rows`,
          )
        }
      }
      row = []
      continue
    }

    field += ch
    if (field.length > limits.maxCellLength) {
      throw new CsvImportError(
        'LIMIT_EXCEEDED',
        `Cell length exceeds maximum ${limits.maxCellLength} characters (row ${records.length + 1})`,
      )
    }
  }

  if (inQuotes) {
    throw new CsvImportError('INVALID_CSV', 'Unclosed quoted field at end of CSV')
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (!(row.length === 1 && row[0] === '')) {
      records.push(row)
      if (records.length - 1 > limits.maxRows) {
        throw new CsvImportError(
          'LIMIT_EXCEEDED',
          `Row count exceeds maximum ${limits.maxRows} data rows`,
        )
      }
    }
  }

  return records
}

/**
 * Dependency-free RFC 4180 CSV parser supporting BOM stripping, `,`/`;` auto-detection,
 * quoted multiline cells, `""` escapes, size/row/column/cell limits, and header alias mapping.
 */
export function parseCsv<K extends string>(
  rawText: string,
  opts: ParseCsvOptions<K>,
): ParseCsvResult<K> {
  const maxBytes = opts.maxBytes ?? CSV_MAX_BYTES
  const maxRows = opts.maxRows ?? CSV_MAX_DATA_ROWS
  const maxColumns = opts.maxColumns ?? CSV_MAX_COLUMNS
  const maxCellLength = opts.maxCellLength ?? CSV_MAX_CELL_LENGTH

  const byteLen = Buffer.byteLength(rawText, 'utf8')
  if (byteLen > maxBytes) {
    throw new CsvImportError(
      'LIMIT_EXCEEDED',
      `CSV size (${byteLen} bytes) exceeds maximum ${maxBytes} bytes`,
    )
  }

  const cleanText = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText
  if (cleanText.trim().length === 0) {
    throw new CsvImportError('EMPTY_FILE', 'CSV file is empty')
  }

  const delimiter = detectDelimiterFromHeader(cleanText)
  const records = parseRawRecords(cleanText, delimiter, {
    maxRows,
    maxColumns,
    maxCellLength,
  })
  if (records.length === 0) {
    throw new CsvImportError('EMPTY_FILE', 'CSV header row is missing')
  }

  const rawHeaders = records[0]!
  if (rawHeaders.length > maxColumns) {
    throw new CsvImportError('LIMIT_EXCEEDED', `Column count exceeds maximum ${maxColumns}`)
  }

  const warnings: string[] = []
  const mappedHeaders: Array<K | null> = []
  const presentCanonical = new Set<K>()

  for (const h of rawHeaders) {
    const norm = normalizeCsvHeader(h)
    const canonical = Object.hasOwn(opts.aliases, norm) ? opts.aliases[norm]! : null
    if (canonical === null) {
      warnings.push(`Unknown column ignored: "${h.trim()}"`)
      mappedHeaders.push(null)
    } else if (presentCanonical.has(canonical)) {
      warnings.push(`Duplicate column ignored: "${h.trim()}"`)
      mappedHeaders.push(null)
    } else {
      presentCanonical.add(canonical)
      mappedHeaders.push(canonical)
    }
  }

  for (const req of opts.requiredColumns ?? []) {
    if (!presentCanonical.has(req)) {
      throw new CsvImportError('MISSING_HEADER', `Missing required column: ${req}`)
    }
  }

  const dataRecords = records.slice(1)
  const rows: Array<{ rowNumber: number; cells: Partial<Record<K, string>> }> = []
  for (let i = 0; i < dataRecords.length; i += 1) {
    const rec = dataRecords[i]!
    const cells: Partial<Record<K, string>> = {}
    for (let colIdx = 0; colIdx < mappedHeaders.length; colIdx += 1) {
      const canonical = mappedHeaders[colIdx]
      if (!canonical) continue
      const rawCell = rec[colIdx] ?? ''
      cells[canonical] = unwrapCsvFormulaEscape(rawCell).trim()
    }
    rows.push({
      rowNumber: i + 2, // 1-indexed with header at row 1
      cells,
    })
  }

  return {
    delimiter,
    headers: rawHeaders.map((h) => h.trim()),
    warnings,
    rows,
  }
}
