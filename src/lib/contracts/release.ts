import { z } from 'zod'

export const ReleaseBlockSchema = z.object({
  latest: z.string().min(1).max(30),
  min_supported_app_version: z.string().min(1).max(30).nullable(),
  min_supported_schema_version: z.number().int().positive(),
  is_mandatory: z.boolean(),
  accept_previous_until: z.iso.datetime().nullable(),
  max_schema_version: z.number().int().positive(),
})
export type ReleaseBlock = z.infer<typeof ReleaseBlockSchema>

export const ReleaseResponseSchema = z.object({
  release: ReleaseBlockSchema,
})
export type ReleaseResponse = z.infer<typeof ReleaseResponseSchema>
