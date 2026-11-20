import '@tanstack/react-start/server-only'
import { ZodError } from 'zod'
import {
  ERROR_CODES,
  type ErrorClass,
  type ErrorCode,
} from '~/lib/contracts/error-codes'

export interface Classified {
  code: ErrorCode
  class: ErrorClass
  status: number
  retriable: boolean
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly meta?: Readonly<Record<string, unknown>>,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }
}

const MAX_CAUSE_DEPTH = 5

const TRANSIENT_PG_CODES = new Set(['55P03', '40001', '40P01', '57P01', '53300'])

function fromErrorCode(code: ErrorCode): Classified {
  const entry = ERROR_CODES[code]
  return {
    code,
    class: entry.class,
    status: entry.http ?? 500,
    retriable: entry.class === 'transient',
  }
}

function classifySingle(err: unknown): Classified | null {
  if (err instanceof AppError) {
    return fromErrorCode(err.code)
  }

  if (err instanceof ZodError || (err instanceof Error && err.name === 'ZodError')) {
    return fromErrorCode('VALIDATION_FAILED')
  }

  if (typeof err === 'object' && err !== null && 'code' in err) {
    const rawCode = (err as { code?: unknown }).code
    if (typeof rawCode === 'string') {
      if (rawCode === '57014') {
        return fromErrorCode('TIMEOUT')
      }
      if (TRANSIENT_PG_CODES.has(rawCode) || rawCode.startsWith('08')) {
        return fromErrorCode('DB_UNAVAILABLE')
      }
    }
  }

  return null
}

export function classifyError(err: unknown): Classified {
  let current: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    const matched = classifySingle(current)
    if (matched) return matched
    if (typeof current === 'object' && 'cause' in current) {
      current = (current as { cause?: unknown }).cause
    } else {
      break
    }
  }
  return fromErrorCode('INTERNAL_ERROR')
}
