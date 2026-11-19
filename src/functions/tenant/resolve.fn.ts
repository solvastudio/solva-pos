import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { resolveTenantBySlug } from '~/modules/identity/public'
import { publicErrorMiddleware } from '../middleware'

export type ResolveTenantResult =
  | { kind: 'ok'; tenantId: string; slug: string; name: string }
  | { kind: 'suspended' }
  | { kind: 'not_found' }

const resolveTenantInputSchema = z.object({
  slug: z.string().max(64),
})

export const resolveTenantFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => resolveTenantInputSchema.parse(raw))
  .middleware([publicErrorMiddleware])
  .handler(async ({ data }): Promise<ResolveTenantResult> => {
    const found = await resolveTenantBySlug(data.slug)
    if (!found) {
      return { kind: 'not_found' }
    }
    if (found.status !== 'ACTIVE') {
      return { kind: 'suspended' }
    }
    return {
      kind: 'ok',
      tenantId: found.tenantId,
      slug: found.slug,
      name: found.name,
    }
  })
