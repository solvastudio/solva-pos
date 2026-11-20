const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/
const NEEDS_QUOTING_RE = /[",\r\n;]/

/**
 * Mitigates CSV/spreadsheet formula injection (ARCHITECTURE §9.4):
 * prefixes cells beginning with `=`, `+`, `-`, `@`, tab, or CR with a single quote `'`.
 */
export function csvSafeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }
  const str = String(value)
  if (str.length > 0 && FORMULA_PREFIX_RE.test(str)) {
    return `'${str}`
  }
  return str
}

/**
 * Reverses `csvSafeCell` only when the cell starts with `'` immediately followed by a formula
 * character, preserving literal strings that start with `'` otherwise (safe round-trip).
 */
export function unwrapCsvFormulaEscape(value: string): string {
  if (value.length >= 2 && value[0] === "'" && FORMULA_PREFIX_RE.test(value.slice(1))) {
    return value.slice(1)
  }
  return value
}

function formatQuotedField(raw: string, delimiter: ',' | ';'): string {
  const needsQuotes = raw.includes(delimiter) || NEEDS_QUOTING_RE.test(raw)
  if (!needsQuotes) {
    return raw
  }
  return `"${raw.replace(/"/g, '""')}"`
}

export interface ToCsvOptions {
  delimiter?: ',' | ';'
}

/**
 * Serializes headers + rows into an RFC 4180 CSV string with formula-injection protection.
 */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
  headers: readonly string[],
  opts?: ToCsvOptions,
): string {
  const delimiter = opts?.delimiter ?? ','
  const lines: string[] = [
    headers.map((h) => formatQuotedField(csvSafeCell(h), delimiter)).join(delimiter),
  ]
  for (const row of rows) {
    lines.push(row.map((cell) => formatQuotedField(csvSafeCell(cell), delimiter)).join(delimiter))
  }
  return lines.join('\n')
}
