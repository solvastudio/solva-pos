import type { SolvaDb } from '../db/solva-db'
import type { AssetCacheRecord } from '../db/types'

export async function getCachedAsset(
  db: SolvaDb,
  key: string,
): Promise<AssetCacheRecord | null> {
  const row = await db.asset_cache.get(key)
  return row ?? null
}

export async function putCachedAsset(
  db: SolvaDb,
  record: AssetCacheRecord,
): Promise<void> {
  await db.asset_cache.put(record)
}

export async function deleteCachedAsset(db: SolvaDb, key: string): Promise<void> {
  await db.asset_cache.delete(key)
}
