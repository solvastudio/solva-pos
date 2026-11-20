import { describe, expect, it } from 'vitest'
import { FEATURE_FLAGS, type FeatureFlagDefinition } from './registry'
import { resolveFlag, resolveFlagOnError } from './resolve'

describe('feature-flags resolution', () => {
  const closedFlag: FeatureFlagDefinition = {
    default: false,
    failMode: 'closed',
    description: 'Closed default flag',
  }
  const openFlag: FeatureFlagDefinition = {
    default: true,
    failMode: 'open',
    description: 'Open default flag',
  }

  it('starts with an empty registry in Fase 24', () => {
    expect(Object.keys(FEATURE_FLAGS)).toEqual([])
  })

  it('resolves active, deleted, missing, and error states per definition', () => {
    expect(resolveFlag(closedFlag, undefined)).toBe(false)
    expect(resolveFlag(openFlag, undefined)).toBe(true)

    expect(resolveFlag(closedFlag, { enabled: true, deleted: false })).toBe(true)
    expect(resolveFlag(closedFlag, { enabled: true, deleted: true })).toBe(false)
    expect(resolveFlag(openFlag, { enabled: false, deleted: false })).toBe(false)
    expect(resolveFlag(openFlag, { enabled: false, deleted: true })).toBe(true)

    expect(resolveFlagOnError(closedFlag)).toBe(false)
    expect(resolveFlagOnError(openFlag)).toBe(true)
  })
})
