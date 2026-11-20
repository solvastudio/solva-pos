import '@tanstack/react-start/server-only'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { getOutletLogoMeta } from '~/modules/identity/public'
import { getEnv } from '~/server/env'
import { withTenant } from '~/server/db'

const MAX_LOGO_BYTES = 200 * 1024

export interface LoadedLogoAsset {
  readonly bytes: Uint8Array
  readonly contentType: 'image/png' | 'image/jpeg'
  readonly sha256: string | null
}

function detectImageContentType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

/**
 * Resolves `objectKey` strictly within `assetsDir`; rejects traversal segments or escape via symlink-free check.
 */
export function resolveSafeAssetPath(assetsDir: string, objectKey: string): string | null {
  const cleanKey = objectKey.trim()
  if (!cleanKey || isAbsolute(cleanKey) || cleanKey.includes('\0')) {
    return null
  }
  const root = resolve(assetsDir)
  const target = resolve(root, cleanKey)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }
  return target
}

/**
 * Loads receipt logo binary for `outletId` restricted to `tenantId` (and safe under `ASSETS_DIR`).
 */
export async function loadOutletLogoAsset(params: {
  tenantId: string
  outletId: string
  assetsDir?: string
}): Promise<LoadedLogoAsset | null> {
  const meta = await withTenant(params.tenantId, (tx) =>
    getOutletLogoMeta(tx, params.outletId),
  )
  if (!meta?.logoObjectKey) {
    return null
  }

  const assetsDir = params.assetsDir ?? getEnv().ASSETS_DIR
  const safePath = resolveSafeAssetPath(assetsDir, meta.logoObjectKey)
  if (!safePath) {
    return null
  }

  let buf: Buffer
  try {
    buf = await readFile(safePath)
  } catch {
    return null
  }

  if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) {
    return null
  }

  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const contentType = detectImageContentType(bytes)
  if (!contentType) {
    return null
  }

  return {
    bytes,
    contentType,
    sha256: meta.logoSha256,
  }
}
