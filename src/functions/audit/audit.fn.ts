import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { exportAuditCsv, listAudit, verifyTenantAuditChain } from '~/modules/audit/public'
import type { AuditLogView, VerifyChainStatus } from '~/modules/audit/shared'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const auditFilterSchema = z
  .object({
    actorUserId: z.string().uuid().nullable().optional(),
    action: z.string().max(60).nullable().optional(),
    outletId: z.string().uuid().nullable().optional(),
    fromDate: z.string().max(32).nullable().optional(),
    toDate: z.string().max(32).nullable().optional(),
    sort: z.enum(['asc', 'desc']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional()

export const listAuditFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => auditFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('audit.view')])
  .handler(async ({ data, context }): Promise<AuditLogView[]> => {
    return listAudit(context.auth, data ?? {})
  })

export const exportAuditCsvFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => auditFilterSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('audit.view')])
  .handler(
    async ({
      data,
      context,
    }): Promise<MutationActionResult<{ filename: string; csv: string; count: number }>> => {
      return runValidatedAction(() => exportAuditCsv(context.auth, data ?? {}))
    },
  )

export const verifyAuditChainFn = createServerFn({ method: 'POST' })
  .middleware([publicErrorMiddleware, requirePermission('audit.view')])
  .handler(async ({ context }): Promise<MutationActionResult<VerifyChainStatus>> => {
    return runValidatedAction(() => verifyTenantAuditChain(context.auth))
  })
