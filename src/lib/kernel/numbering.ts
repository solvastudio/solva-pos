export type DocKind = 'INVOICE' | 'CREDIT_NOTE'

export interface ParsedNo {
  prefix: string
  kind: DocKind
  period: string
  seq: number
  conflictIdx: number
}

const PREFIX_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const PERIOD_PATTERN = /^(?:0[1-9]|1[0-2])\d{2}$/
const SEQ_TOKEN_PATTERN = /^(?:\d{6}|[1-9]\d{6,})$/
const CONFLICT_TOKEN_PATTERN = /^D([1-9]\d*)$/

export function validateInvoicePrefix(
  prefix: string,
): { ok: true } | { ok: false; reason: 'FORMAT' | 'ENDS_WITH_NK' } {
  if (typeof prefix !== 'string' || prefix.length < 2 || prefix.length > 16 || !PREFIX_PATTERN.test(prefix)) {
    return { ok: false, reason: 'FORMAT' }
  }
  const segments = prefix.split('-')
  if (segments[segments.length - 1] === 'NK') {
    return { ok: false, reason: 'ENDS_WITH_NK' }
  }
  return { ok: true }
}

export function formatInvoiceNo(p: {
  prefix: string
  kind: DocKind
  period: string
  seq: number
  conflictIdx?: number
}): string {
  const prefixCheck = validateInvoicePrefix(p.prefix)
  if (!prefixCheck.ok) {
    throw new RangeError(`Invalid document number prefix (${prefixCheck.reason}): "${p.prefix}"`)
  }
  if (typeof p.period !== 'string' || !PERIOD_PATTERN.test(p.period)) {
    throw new RangeError(`Invalid MMYY period: "${String(p.period)}"`)
  }
  if (!Number.isSafeInteger(p.seq) || p.seq < 1) {
    throw new RangeError(`Sequence number must be an integer >= 1: ${p.seq}`)
  }
  const conflictIdx = p.conflictIdx ?? 0
  if (!Number.isSafeInteger(conflictIdx) || conflictIdx < 0) {
    throw new RangeError(`conflictIdx must be an integer >= 0: ${conflictIdx}`)
  }

  const seqPart = String(p.seq).padStart(6, '0')
  const base =
    p.kind === 'CREDIT_NOTE'
      ? `${p.prefix}-NK-${p.period}-${seqPart}`
      : `${p.prefix}-${p.period}-${seqPart}`
  return conflictIdx >= 1 ? `${base}-D${conflictIdx}` : base
}

export function parseInvoiceNo(no: string): ParsedNo | null {
  if (typeof no !== 'string' || no.length === 0) {
    return null
  }
  const tokens = no.split('-')
  if (tokens.some((t) => t.length === 0) || tokens.length < 3) {
    return null
  }

  let end = tokens.length
  let conflictIdx = 0

  const lastToken = tokens[end - 1]!
  const conflictMatch = CONFLICT_TOKEN_PATTERN.exec(lastToken)
  if (conflictMatch) {
    const parsedConflict = Number(conflictMatch[1])
    if (!Number.isSafeInteger(parsedConflict) || parsedConflict < 1) {
      return null
    }
    conflictIdx = parsedConflict
    end -= 1
  }

  if (end < 3) {
    return null
  }

  const seqToken = tokens[end - 1]!
  if (!SEQ_TOKEN_PATTERN.test(seqToken)) {
    return null
  }
  const seq = Number(seqToken)
  if (!Number.isSafeInteger(seq) || seq < 1) {
    return null
  }
  end -= 1

  const period = tokens[end - 1]!
  if (!PERIOD_PATTERN.test(period)) {
    return null
  }
  end -= 1

  let kind: DocKind = 'INVOICE'
  if (end >= 2 && tokens[end - 1] === 'NK') {
    kind = 'CREDIT_NOTE'
    end -= 1
  }

  if (end < 1) {
    return null
  }

  const prefix = tokens.slice(0, end).join('-')
  if (!validateInvoicePrefix(prefix).ok) {
    return null
  }

  return { prefix, kind, period, seq, conflictIdx }
}
