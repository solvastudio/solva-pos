import { useLiveQuery } from 'dexie-react-hooks'
import type { FeatureFlagDefinition, FeatureKey } from '~/lib/feature-flags'
import { featureEnabled } from '../data/feature-flag.repo'
import type { SolvaDb } from '../db/solva-db'

/**
 * Live read-only subscription to a synced tenant feature flag in local Dexie.
 */
export function useFeatureFlag(
  db: SolvaDb | null,
  key: FeatureKey | (string & {}),
  registry?: Readonly<Record<string, FeatureFlagDefinition>>,
): boolean {
  const val = useLiveQuery(
    () => (db ? featureEnabled(db, key, registry) : Promise.resolve(false)),
    [db, key, registry],
  )
  return val ?? false
}
