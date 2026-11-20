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

function formatQuotedField(raw: string, delimiter: ',' | ';'): string {
  const needsQuotes = raw.includes(delimiter) || NEEDS_QUOTING_RE.test(raw)
  if (!needsQuotes) {
    return raw
  }
  return `"${raw.replace(/"/g, '""')}"`
}

export interface ToCsvOptions {
  delimiter?: ',' | ';'
  withBom?: boolean
}

/**
 * Serializes headers + rows into an RFC 4180 CSV string with formula-injection protection
 * and optional UTF-8 BOM (`\uFEFF`, default `true` for report downloads).
 */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
  headers: readonly string[],
  opts?: ToCsvOptions,
): string {
  const delimiter = opts?.delimiter ?? ','
  const withBom = opts?.withBom ?? true
  const lines: string[] = [
    headers.map((h) => formatQuotedField(csvSafeCell(h), delimiter)).join(delimiter),
  ]
  for (const row of rows) {
    lines.push(row.map((cell) => formatQuotedField(csvSafeCell(cell), delimiter)).join(delimiter))
  }
  const body = `${lines.join('\n')}\n`
  return withBom ? `\uFEFF${body}` : body
}
