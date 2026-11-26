import { describe, expect, it } from 'vitest'
import { isUuid } from '~/lib/kernel'
import { runtimeIdGenerator } from './runtime-id'

describe('lib/runtime-id', () => {
  it('generates unique, lowercase, time-ordered UUIDv7 values', () => {
    const ids = Array.from({ length: 1_000 }, () => runtimeIdGenerator.newId())
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => isUuid(id))).toBe(true)
    expect([...ids].sort()).toEqual(ids)
  })
})
