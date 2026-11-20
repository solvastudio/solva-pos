import {
  FEATURE_FLAGS,
  resolveFlag,
  type FeatureFlagDefinition,
  type FeatureKey,
} from '~/lib/feature-flags'
import type { SolvaDb } from '../db/solva-db'
import type { FeatureFlagRecord } from '../db/types'

/**
 * Returns all synced tenant feature flag rows from Dexie (read-only on POS; never writes flags).
 */
export async function getFlagRows(db: SolvaDb): Promise<FeatureFlagRecord[]> {
  return db.feature_flag.toArray()
}

/**
 * Reads the effective boolean state of a known feature flag purely offline from Dexie.
 * Keys unknown to the active registry are ignored (`false`).
 */
export async function featureEnabled(
  db: SolvaDb,
  key: FeatureKey | (string & {}),
  registry: Readonly<Record<string, FeatureFlagDefinition>> = FEATURE_FLAGS,
): Promise<boolean> {
  const def = registry[key]
  if (!def) {
    return false
  }
  const row = await db.feature_flag.where('flag_key').equals(key).first()
  return resolveFlag(
    def,
    row ? { enabled: Boolean(row.enabled), deleted: Boolean(row.deleted_at) } : undefined,
  )
}
