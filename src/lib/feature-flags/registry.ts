export interface FeatureFlagDefinition {
  readonly default: boolean
  readonly failMode: 'closed' | 'open'
  readonly description: string
}

const BASE_FEATURE_FLAGS = {} as const satisfies Record<string, FeatureFlagDefinition>

const E2E_FEATURE_FLAGS: Record<string, FeatureFlagDefinition> = {
  'e2e.sample': {
    default: false,
    failMode: 'closed',
    description: 'E2E acceptance test feature flag (active only under VITE_E2E=1).',
  },
}

function isE2eRegistryEnabled(): boolean {
  if (
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_E2E === '1'
  ) {
    return true
  }
  return typeof process !== 'undefined' && process.env?.VITE_E2E === '1'
}

/**
 * Closed compile-time registry of tenant feature flags.
 * Remains empty in unit tests and production builds; `e2e.sample` is exposed only when `VITE_E2E=1`.
 */
export const FEATURE_FLAGS: Readonly<Record<string, FeatureFlagDefinition>> =
  isE2eRegistryEnabled() ? E2E_FEATURE_FLAGS : BASE_FEATURE_FLAGS

export type FeatureKey = keyof typeof BASE_FEATURE_FLAGS
