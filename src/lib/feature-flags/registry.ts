export interface FeatureFlagDefinition {
  readonly default: boolean
  readonly failMode: 'closed' | 'open'
  readonly description: string
}

/**
 * Closed compile-time registry of tenant feature flags.
 * Remains empty until the downstream phases that introduce specific flags.
 */
export const FEATURE_FLAGS = {} as const satisfies Record<string, FeatureFlagDefinition>

export type FeatureKey = keyof typeof FEATURE_FLAGS
