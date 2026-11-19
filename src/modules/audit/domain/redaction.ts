const SENSITIVE_KEY_PATTERN =
  /(^|_)(pin|password|passwd|secret|token|credential|hash|salt|otp|code_hash|customer_name|customer_phone|phone)(_|$)/i

export class SensitiveAuditDataError extends Error {
  readonly code = 'VALIDATION_FAILED' as const

  constructor(keyName: string) {
    super(`Sensitive field "${keyName}" is not allowed in audit payload`)
    this.name = 'SensitiveAuditDataError'
  }
}

function scanValue(value: unknown, seen: Set<object>): void {
  if (value === null || value === undefined || typeof value !== 'object') {
    return
  }
  if (seen.has(value)) {
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      scanValue(item, seen)
    }
    return
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new SensitiveAuditDataError(key)
    }
    scanValue(val, seen)
  }
}

/** Reject any sensitive key names anywhere inside audit before/after payloads. */
export function assertNoSensitive(data: unknown): void {
  scanValue(data, new Set<object>())
}
