import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { appendAudit } from '~/modules/audit/public'
import { writeMaster } from '~/modules/sync/public'
import { withTenant } from '~/server/db'
import { getEnv } from '~/server/env'
import { AppError } from '~/server/error-classify'
import { sniffImage } from '../domain/image-sniff'
import { uploadOutletLogoSchema } from '../shared'
import {
  identityIdGen,
  requireActorPermission,
  type IdentityAuthActor,
  type IdentityServiceDeps,
} from './code-crypto'
import { outlet, outletReceiptSetting } from './schema'

function decodeBase64Payload(raw: string): Buffer {
  const trimmed = raw.trim()
  const commaIdx = trimmed.indexOf(',')
  const b64 = trimmed.startsWith('data:') && commaIdx !== -1 ? trimmed.slice(commaIdx + 1) : trimmed
  return Buffer.from(b64, 'base64')
}

function resolveLogoDiskPath(
  assetsDir: string,
  tenantId: string,
  outletId: string,
  filename: string,
): { objectKey: string; diskPath: string } {
  const baseDir = path.resolve(assetsDir)
  const objectKey = path.posix.join(tenantId.toLowerCase(), outletId.toLowerCase(), filename)
  const diskPath = path.resolve(baseDir, objectKey)
  const relative = path.relative(baseDir, diskPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('VALIDATION_FAILED', 'Unsafe logo storage path')
  }
  return { objectKey, diskPath }
}

/**
 * Validates and persists an outlet receipt logo (PNG/JPEG <= 200 KB, <= 1024x1024),
 * derives a content-addressed filename `<tenant>/<outlet>/<sha256>.<ext>` (zero user path input),
 * and stamps `outlet_receipt_setting` via `writeMaster` + audit.
 */
export async function uploadOutletLogo(
  actor: IdentityAuthActor,
  rawInput: unknown,
  deps?: IdentityServiceDeps & { assetsDir?: string },
): Promise<{ logoObjectKey: string; logoSha256: string; width: number; height: number; version: number }> {
  const input = uploadOutletLogoSchema.parse(rawInput)
  requireActorPermission(actor, 'org.manage', { outletId: input.outletId })

  const bytes = decodeBase64Payload(input.base64Data)
  let sniffed
  try {
    sniffed = sniffImage(bytes)
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', err instanceof Error ? err.message : 'Invalid logo image')
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const filename = `${sha256}.${sniffed.ext}`
  const assetsDir = deps?.assetsDir ?? getEnv().ASSETS_DIR
  const { objectKey, diskPath } = resolveLogoDiskPath(assetsDir, actor.tenantId, input.outletId, filename)
  const ts = (deps?.nowIso ?? (() => new Date().toISOString()))()

  const { version } = await withTenant(actor.tenantId, async (tx) => {
    const outRows = await tx
      .select({ id: outlet.id })
      .from(outlet)
      .where(
        and(eq(outlet.tenantId, actor.tenantId), eq(outlet.id, input.outletId), isNull(outlet.deletedAt)),
      )
      .limit(1)

    if (!outRows[0]) {
      throw new AppError('VALIDATION_FAILED', 'Outlet not found')
    }

    // Write file atomically inside assets directory before committing master version bump.
    await mkdir(path.dirname(diskPath), { recursive: true })
    await writeFile(diskPath, bytes)

    const existingRows = await tx
      .select({
        id: outletReceiptSetting.id,
        logoSha256: outletReceiptSetting.logoSha256,
      })
      .from(outletReceiptSetting)
      .where(
        and(
          eq(outletReceiptSetting.tenantId, actor.tenantId),
          eq(outletReceiptSetting.outletId, input.outletId),
        ),
      )
      .limit(1)

    const existing = existingRows[0]
    const settingId = existing?.id ?? identityIdGen.newId()

    return writeMaster(tx, { actorUserId: actor.appUserId }, async (w) => {
      if (existing) {
        await tx
          .update(outletReceiptSetting)
          .set({
            logoObjectKey: objectKey,
            logoSha256: sha256,
            version: w.version,
            updatedAt: ts,
          })
          .where(
            and(
              eq(outletReceiptSetting.tenantId, actor.tenantId),
              eq(outletReceiptSetting.id, existing.id),
            ),
          )
      } else {
        await tx.insert(outletReceiptSetting).values({
          id: settingId,
          tenantId: actor.tenantId,
          outletId: input.outletId,
          receiptLocale: 'id-ID',
          logoObjectKey: objectKey,
          logoSha256: sha256,
          version: w.version,
          createdAt: ts,
          updatedAt: ts,
        })
      }

      await appendAudit(
        tx,
        {
          action: 'outlet.changed',
          entityType: 'outlet_receipt_setting',
          entityId: settingId,
          outletId: input.outletId,
          actorUserId: actor.appUserId,
          occurredAt: ts,
          beforeData: existing?.logoSha256 ? { logo_sha256: existing.logoSha256 } : null,
          afterData: {
            logo_sha256: sha256,
            mime_type: sniffed.mimeType,
            dimensions: `${sniffed.width}x${sniffed.height}`,
          },
        },
        { newId: () => identityIdGen.newId(), nowIso: () => ts },
      )
      return true
    })
  })

  return {
    logoObjectKey: objectKey,
    logoSha256: sha256,
    width: sniffed.width,
    height: sniffed.height,
    version,
  }
}
