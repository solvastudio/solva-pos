import { z } from 'zod'
import { REGISTER_TYPE } from './enums'

export const EnrollRequest = z.object({
  slug: z.string().trim().min(1).max(64),
  code: z.string().trim().min(1).max(16),
  device_name: z.string().trim().min(1).max(80),
  user_agent: z.string().trim().max(300).optional(),
})
export type EnrollRequest = z.infer<typeof EnrollRequest>

export const EnrollResponse = z.object({
  device_id: z.uuid(),
  credential: z.string().min(1),
  credential_expires_at: z.iso.datetime(),
  tenant: z.object({
    id: z.uuid(),
    slug: z.string().min(1),
    name: z.string().min(1),
    default_locale: z.enum(['id-ID', 'en-US']),
  }),
  outlet: z.object({
    id: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    timezone: z.string().min(1),
    day_cutoff_time: z.string().min(1),
  }),
  register: z.object({
    id: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    register_type: z.enum(REGISTER_TYPE),
    paper_width_mm: z.union([z.literal(58), z.literal(80)]),
  }),
  server_time: z.number().int().positive(),
})
export type EnrollResponse = z.infer<typeof EnrollResponse>
