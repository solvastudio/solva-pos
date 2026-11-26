import { afterAll, describe, expect, it } from 'vitest'
import { identityFeedSources } from '~/modules/identity/public'
import { getFeedSources, registerFeedSource } from '~/modules/sync/public'
import { composeServer, resetCompositionForTests } from '~/server/composition'
import { closePools } from '~/server/db'

describe('composeServer after dev HMR re-evaluation', () => {
  afterAll(async () => {
    resetCompositionForTests()
    await closePools()
  })

  it('does not throw when registries still hold entries from a previous composition', () => {
    resetCompositionForTests()
    // Simulates the registry module surviving an HMR reload while composition.ts restarts at composed=false.
    registerFeedSource(identityFeedSources()[0]!)

    expect(() => composeServer()).not.toThrow()

    const entities = getFeedSources().map((s) => s.entity)
    expect(new Set(entities).size).toBe(entities.length)
  })
})
