import { z } from 'zod'

const jsonRecordNullable = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((v) => v ?? null)

export const AppendAuditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string().trim().min(1).max(80),
  entity_type: z.string().trim().min(1).max(60),
  entity_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  before_data: jsonRecordNullable,
  after_data: jsonRecordNullable,
  reason_code: z
    .string()
    .max(40)
    .nullish()
    .transform((v) => v ?? null),
  reason_text: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => v ?? null),
  actor_user_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  approver_user_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  occurred_at_device: z.iso
    .datetime()
    .nullish()
    .transform((v) => v ?? null),
  occurred_at: z.iso.datetime(),
  business_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  related_command_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export const AppendAuditPayloadV1 = z.object({
  entry: AppendAuditEntrySchema,
})

export type AppendAuditPayloadV1 = z.infer<typeof AppendAuditPayloadV1>
