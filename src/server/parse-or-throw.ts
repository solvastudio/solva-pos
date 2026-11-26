import '@tanstack/react-start/server-only'
import type { z } from 'zod'
import { AppError } from './error-classify'

/**
 * Parses `raw` with `schema`; on failure throws `AppError('VALIDATION_FAILED', <first issue message>)`,
 * falling back to `fallbackMessage` when the issue has no message.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  fallbackMessage: string,
): z.output<S> {
  const res = schema.safeParse(raw)
  if (!res.success) {
    throw new AppError('VALIDATION_FAILED', res.error.issues[0]?.message ?? fallbackMessage)
  }
  return res.data
}
