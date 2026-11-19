import { z } from 'zod'
import { ATTENTION_REASON_CLASS, COMMAND_TYPE } from './enums'

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    ref: z.string(),
    class: z.string().optional(),
  }),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>

export const PushCommandEnvelope = z.object({
  id: z.uuid(),
  type: z.enum(COMMAND_TYPE),
  schema_version: z.number().int().positive(),
  device_seq: z.number().int().nonnegative(),
  depends_on: z.array(z.uuid()).default([]),
  created_at_device: z.iso.datetime(),
  payload: z.unknown(),
})
export type PushCommandEnvelope = z.infer<typeof PushCommandEnvelope>

export const PushRequest = z.object({
  sent_at_device: z.iso.datetime(),
  clock_offset_ms: z.number().int(),
  commands: z.array(PushCommandEnvelope).max(50),
})
export type PushRequest = z.infer<typeof PushRequest>

export const PushResultItem = z.discriminatedUnion('outcome', [
  z.object({
    id: z.uuid(),
    outcome: z.literal('ACK'),
    result: z.record(z.string(), z.unknown()),
  }),
  z.object({
    id: z.uuid(),
    outcome: z.literal('ATTENTION'),
    reason_class: z.enum(ATTENTION_REASON_CLASS),
    reason_code: z.string().min(1),
    ref: z.string().min(1),
  }),
  z.object({
    id: z.uuid(),
    outcome: z.literal('RETRY'),
  }),
  z.object({
    id: z.uuid(),
    outcome: z.literal('HELD'),
  }),
])
export type PushResultItem = z.infer<typeof PushResultItem>

export const PushResponse = z.object({
  server_time: z.iso.datetime(),
  results: z.array(PushResultItem),
  max_schema_version: z.number().int().positive().optional(),
})
export type PushResponse = z.infer<typeof PushResponse>

export const PingResponse = z.object({
  ok: z.literal(true),
  server_time: z.number().int(),
  min_schema: z.number().int(),
  max_schema: z.number().int(),
})
export type PingResponse = z.infer<typeof PingResponse>
