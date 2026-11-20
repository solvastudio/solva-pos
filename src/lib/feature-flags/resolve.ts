import type { FeatureFlagDefinition } from './registry'

export interface FeatureFlagRowState {
  readonly enabled: boolean
  readonly deleted: boolean
}

/**
 * Resolves a feature flag purely from its registry definition and latest synced row state.
 */
export function resolveFlag(
  def: FeatureFlagDefinition,
  row: FeatureFlagRowState | undefined,
): boolean {
  if (!row || row.deleted) {
    return def.default
  }
  return row.enabled
}

/**
 * Returns the fail-safe fallback value when flag state cannot be read.
 */
export function resolveFlagOnError(def: FeatureFlagDefinition): boolean {
  return def.failMode === 'open'
}
