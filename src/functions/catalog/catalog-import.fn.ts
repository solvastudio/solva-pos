import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  commitAvailabilityImport,
  commitCatalogImport,
  commitPriceImport,
  exportCatalogCsv,
  getIdempotentImportResult,
  previewAvailabilityImport,
  previewCatalogImport,
  previewPriceImport,
  storeIdempotentImportResult,
  type CommitImportResult,
  type ImportReport,
} from '~/modules/catalog/public'
import type { MutationActionResult } from '~/modules/identity/shared'
import { requirePermission } from '~/server/auth/auth-middleware'
import { publicErrorMiddleware, runValidatedAction } from '../middleware'

const MAX_CSV_BODY_BYTES = 2 * 1024 * 1024

const importKindSchema = z.enum(['catalog', 'price', 'availability'])

const previewImportInputSchema = z.object({
  kind: importKindSchema,
  csvText: z
    .string()
    .refine((val) => Buffer.byteLength(val, 'utf8') <= MAX_CSV_BODY_BYTES, {
      message: 'CSV file size exceeds 2 MB limit',
    }),
  fileName: z.string().trim().min(1).max(160),
})

const commitImportInputSchema = z.object({
  kind: importKindSchema,
  token: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
})

const exportCatalogInputSchema = z.object({
  outletCode: z.string().trim().min(1).max(30).optional(),
})

export const previewImportFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => previewImportInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<ImportReport>> => {
    return runValidatedAction(() => {
      if (data.kind === 'catalog') {
        return previewCatalogImport(context.auth, data.csvText, data.fileName)
      }
      if (data.kind === 'price') {
        return previewPriceImport(context.auth, data.csvText, data.fileName)
      }
      return previewAvailabilityImport(context.auth, data.csvText, data.fileName)
    })
  })

export const commitImportFn = createServerFn({ method: 'POST' })
  .validator((raw: unknown) => commitImportInputSchema.parse(raw))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<MutationActionResult<CommitImportResult>> => {
    return runValidatedAction(async () => {
      if (data.idempotencyKey) {
        const cached = getIdempotentImportResult({
          idempotencyKey: data.idempotencyKey,
          tenantId: context.auth.tenantId,
          userId: context.auth.appUserId,
          kind: data.kind,
        })
        if (cached) {
          return cached
        }
      }

      const res =
        data.kind === 'catalog'
          ? await commitCatalogImport(context.auth, data.token)
          : data.kind === 'price'
            ? await commitPriceImport(context.auth, data.token)
            : await commitAvailabilityImport(context.auth, data.token)

      if (data.idempotencyKey) {
        storeIdempotentImportResult({
          idempotencyKey: data.idempotencyKey,
          tenantId: context.auth.tenantId,
          userId: context.auth.appUserId,
          kind: data.kind,
          result: res,
        })
      }
      return res
    })
  })

export const exportCatalogCsvFn = createServerFn({ method: 'GET' })
  .validator((raw: unknown) => exportCatalogInputSchema.parse(raw ?? {}))
  .middleware([publicErrorMiddleware, requirePermission('catalog.manage')])
  .handler(async ({ data, context }): Promise<{ csvText: string }> => {
    const csvText = await exportCatalogCsv(context.auth, { outletCode: data.outletCode })
    return { csvText }
  })
