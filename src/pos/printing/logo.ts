import {
  deleteCachedAsset,
  getCachedAsset,
  putCachedAsset,
} from '../data/asset-cache.repo'
import { getMeta } from '../data/meta.repo'
import type { SolvaDb } from '../db/solva-db'
import type { OutletReceiptSettingRecord } from '../db/types'
import type { RasterAsset } from './receipt-doc'

const LOGO_CACHE_KEY = 'logo'

/**
 * Converts RGBA pixels (width x height) to 1-bit MSB-first monochrome bitmap packed
 * row-by-row for ESC/POS `GS v 0` using luminance threshold `< 128` (dark printed = bit 1).
 */
export function rgbaTo1BitRaster(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 128,
): RasterAsset {
  const bytesPerRow = Math.ceil(width / 8)
  const bits = new Uint8Array(bytesPerRow * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = rgba[idx] ?? 255
      const g = rgba[idx + 1] ?? 255
      const b = rgba[idx + 2] ?? 255
      const a = rgba[idx + 3] ?? 0
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      if (a >= 128 && lum < threshold) {
        const byteIdx = y * bytesPerRow + (x >> 3)
        bits[byteIdx] = (bits[byteIdx] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }

  return { width, height, bits }
}

async function decodeBlobToRaster(
  blob: Blob,
  maxWidthDots: number,
): Promise<RasterAsset | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return null
  }
  const bmp = await createImageBitmap(blob)
  try {
    const scale = bmp.width > maxWidthDots ? maxWidthDots / bmp.width : 1
    const w = Math.max(8, Math.floor((bmp.width * scale) / 8) * 8)
    const h = Math.max(1, Math.round(bmp.height * (w / bmp.width)))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    const imgData = ctx.getImageData(0, 0, w, h)
    return rgbaTo1BitRaster(imgData.data, w, h)
  } finally {
    bmp.close?.()
  }
}

export interface EnsureLogoDeps {
  fetchFn?: typeof fetch
  decodeRaster?: (blob: Blob, maxWidthDots: number) => Promise<RasterAsset | null>
  nowIso?: () => string
}

/**
 * Ensures cached 1-bit logo in `asset_cache` matches `setting.logo_sha256`.
 * Non-fatal by design: download or decode errors leave receipt printing unblocked without logo.
 */
export async function ensureLogo(
  db: SolvaDb,
  setting: Pick<OutletReceiptSettingRecord, 'outlet_id' | 'logo_sha256'> | null,
  maxWidthDots: number = 384,
  deps: EnsureLogoDeps = {},
): Promise<RasterAsset | null> {
  const targetSha = setting?.logo_sha256 ?? null
  if (!setting || !targetSha) {
    await deleteCachedAsset(db, LOGO_CACHE_KEY)
    return null
  }

  const cached = await getCachedAsset(db, LOGO_CACHE_KEY)
  if (cached && cached.sha256 === targetSha) {
    return { width: cached.width, height: cached.height, bits: cached.bits }
  }

  try {
    const device = await getMeta(db, 'device')
    const fetchImpl = deps.fetchFn ?? globalThis.fetch
    if (!device || !fetchImpl) {
      return null
    }
    const res = await fetchImpl(
      `/api/pos/v1/assets/logo/${encodeURIComponent(setting.outlet_id)}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${device.credential}`,
        },
      },
    )
    if (!res.ok) {
      return null
    }
    const blob = await res.blob()
    const decode = deps.decodeRaster ?? decodeBlobToRaster
    const raster = await decode(blob, maxWidthDots)
    if (!raster) {
      return null
    }
    await putCachedAsset(db, {
      key: LOGO_CACHE_KEY,
      sha256: targetSha,
      width: raster.width,
      height: raster.height,
      bits: raster.bits,
      updated_at: deps.nowIso?.() ?? new Date().toISOString(),
    })
    return raster
  } catch {
    return null
  }
}
