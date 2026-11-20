import { z } from 'zod'
import { DEVICE_LOG_EXTRA_CODES, ERROR_CODES } from './error-codes'

export const DEVICE_LOG_CODES = [
  ...Object.keys(ERROR_CODES),
  ...DEVICE_LOG_EXTRA_CODES,
] as const

export const LOCAL_REF_PATTERN = /^D-\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/
export const MAX_DEVICE_LOG_BODY_BYTES = 256 * 1024
export const MAX_DEVICE_LOG_CTX_BYTES = 2048

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).length
}

export const DeviceLogEntrySchema = z.object({
  ref_local: z.string().regex(LOCAL_REF_PATTERN),
  created_at: z.iso.datetime(),
  clock_offset_ms: z.number().int().nullable(),
  level: z.enum(['info', 'warn', 'error']),
  code: z.string().min(1).max(40),
  route: z.string().max(200).nullable(),
  stack: z.string().max(4000).nullable(),
  component_stack: z.string().max(4000).nullable().optional(),
  ctx: z
    .record(z.string(), z.unknown())
    .default({})
    .refine(
      (obj) => byteLengthUtf8(JSON.stringify(obj)) <= MAX_DEVICE_LOG_CTX_BYTES,
      'Device log ctx must be <= 2 KB serialized',
    ),
  app_version: z.string().min(1).max(30),
  schema_version: z.number().int().positive(),
})
export type DeviceLogEntry = z.infer<typeof DeviceLogEntrySchema>

export const DeviceLogRequestSchema = z.object({
  entries: z.array(DeviceLogEntrySchema).min(1).max(100),
})
export type DeviceLogRequest = z.infer<typeof DeviceLogRequestSchema>

export const DeviceLogResponseSchema = z.object({
  received: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative().optional(),
})
export type DeviceLogResponse = z.infer<typeof DeviceLogResponseSchema>
