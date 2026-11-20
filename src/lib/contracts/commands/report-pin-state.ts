import { z } from 'zod'
import { zIso, zSafePosInt, zUuid } from '../primitives'

export const ReportPinStatePayloadV1 = z
  .object({
    user_id: zUuid,
    failed_count: z.number().int().min(0).max(15),
    lock_tier: z.number().int().min(0).max(3),
    locked_until: zIso.nullable(),
    last_failed_at: zIso.nullable(),
    pin_epoch_seen: zSafePosInt,
  })
  .strict()
  .superRefine((val, ctx) => {
    if ((val.lock_tier === 0 || val.lock_tier === 3) && val.locked_until !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['locked_until'],
        message: 'locked_until must be null when lock_tier is 0 or 3',
      })
    }
    if ((val.lock_tier === 1 || val.lock_tier === 2) && val.locked_until === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['locked_until'],
        message: 'locked_until is required when lock_tier is 1 or 2',
      })
    }
  })

export type ReportPinStatePayloadV1 = z.infer<typeof ReportPinStatePayloadV1>
