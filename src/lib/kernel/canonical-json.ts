function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item))
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      const v = obj[k]
      if (v === undefined) continue
      out[k] = normalizeJsonValue(v)
    }
    return out
  }
  return null
}

/**
 * Serializes an arbitrary JSON value deterministically with lexicographically sorted keys,
 * zero whitespace, `-0 -> 0`, and `undefined -> null`.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value))
}
