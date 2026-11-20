import { z } from 'zod'
import { zIso, zUuid } from '../primitives'

export const VoidSalePayloadV1 = z
  .object({
    sale_id: zUuid,
    voided_at: zIso,
    voided_by: zUuid,
    void_approved_by: zUuid,
    reason_code: z.string().min(1).max(40),
    reason_text: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.void_approved_by === payload.voided_by) {
      ctx.addIssue({
        code: 'custom',
        path: ['void_approved_by'],
        message: 'void_approved_by must differ from voided_by',
      })
    }
  })

export type VoidSalePayloadV1 = z.infer<typeof VoidSalePayloadV1>
