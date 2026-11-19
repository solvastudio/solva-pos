import '@tanstack/react-start/server-only'

export interface SerializedError {
  type: string
  message: string
  stack?: string
  cause?: SerializedError
}

const MAX_MESSAGE = 2000
const MAX_STACK = 8000
const MAX_CAUSE_DEPTH = 5

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function isPgLikeError(record: Record<string, unknown>): boolean {
  const hasFiveCharCode = typeof record.code === 'string' && record.code.length === 5
  const hasSeverity = typeof record.severity === 'string'
  return hasFiveCharCode || hasSeverity
}

function isFailedQueryError(record: Record<string, unknown>): boolean {
  return typeof record.query === 'string' && 'params' in record
}

function sanitizeDbMessage(record: Record<string, unknown>, rawMessage: string): string {
  const code = typeof record.code === 'string' ? record.code : 'UNKNOWN'
  const beforeQuote = rawMessage.split(/['"]/)[0]?.trim() ?? ''
  return beforeQuote.length > 0 ? `[db] ${code}: ${beforeQuote}` : `[db] ${code}`
}

function stackAtLines(stack: string): string | undefined {
  const atLines = stack.split(/\r?\n/).filter((line) => line.startsWith('    at '))
  if (atLines.length === 0) return undefined
  return truncate(atLines.join('\n'), MAX_STACK)
}

function describeNonError(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return `[${typeof value}]`
}

export function serializeError(e: unknown, depth = 0): SerializedError {
  if (!(e instanceof Error)) {
    return {
      type: 'NonError',
      message: truncate(describeNonError(e), MAX_MESSAGE),
    }
  }

  const record = e as unknown as Record<string, unknown>
  const type = e.constructor?.name || e.name || 'Error'

  let message: string
  if (isPgLikeError(record)) {
    // Fully redact detail, where, parameters, and quoted fragments from pg errors
    message = truncate(sanitizeDbMessage(record, e.message), MAX_MESSAGE)
  } else if (isFailedQueryError(record)) {
    message = 'Failed query'
  } else {
    message = truncate(e.message, MAX_MESSAGE)
  }

  const out: SerializedError = { type, message }

  if (typeof e.stack === 'string') {
    const stack = stackAtLines(e.stack)
    if (stack) out.stack = stack
  }

  if (depth < MAX_CAUSE_DEPTH && e.cause !== undefined) {
    out.cause = serializeError(e.cause, depth + 1)
  }

  return out
}
