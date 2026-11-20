import { z } from 'zod'

export const SignalMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('pull'),
    v: z.number().int().nonnegative(),
  }),
  z.object({
    t: z.literal('release'),
  }),
  z.object({
    t: z.literal('bills'),
  }),
])

export type SignalMessage = z.infer<typeof SignalMessageSchema>
