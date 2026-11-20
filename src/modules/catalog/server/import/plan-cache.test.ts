import { beforeEach, describe, expect, it } from 'vitest'
import {
  __clearImportPlansForTests,
  consumeImportPlan,
  IMPORT_PLAN_TTL_MS,
  storeImportPlan,
} from './plan-cache'

describe('import plan-cache', () => {
  beforeEach(() => {
    __clearImportPlansForTests()
  })

  it('binds plans to tenant and user, expires after TTL, and enforces max 5 active plans per user', () => {
    const baseMs = 1_700_000_000_000

    for (let i = 1; i <= 6; i += 1) {
      storeImportPlan({
        token: `tok-${i}`,
        tenantId: 't1',
        userId: 'u1',
        kind: 'catalog',
        plan: { n: i },
        nowMs: baseMs + i,
      })
    }

    // Oldest plan (tok-1) evicted
    expect(() =>
      consumeImportPlan({
        token: 'tok-1',
        tenantId: 't1',
        userId: 'u1',
        kind: 'catalog',
        nowMs: baseMs + 10,
      }),
    ).toThrow(/missing or expired/)

    // Other user / tenant blocked
    expect(() =>
      consumeImportPlan({
        token: 'tok-2',
        tenantId: 't1',
        userId: 'u2',
        kind: 'catalog',
        nowMs: baseMs + 10,
      }),
    ).toThrow(/another user/)

    // Valid consume succeeds once (one-shot)
    expect(
      consumeImportPlan<{ n: number }>({
        token: 'tok-2',
        tenantId: 't1',
        userId: 'u1',
        kind: 'catalog',
        nowMs: baseMs + 10,
      }),
    ).toEqual({ n: 2 })
    expect(() =>
      consumeImportPlan({
        token: 'tok-2',
        tenantId: 't1',
        userId: 'u1',
        kind: 'catalog',
        nowMs: baseMs + 10,
      }),
    ).toThrow(/missing or expired/)

    // TTL expiration
    expect(() =>
      consumeImportPlan({
        token: 'tok-3',
        tenantId: 't1',
        userId: 'u1',
        kind: 'catalog',
        nowMs: baseMs + 3 + IMPORT_PLAN_TTL_MS,
      }),
    ).toThrow(/missing or expired/)
  })
})
