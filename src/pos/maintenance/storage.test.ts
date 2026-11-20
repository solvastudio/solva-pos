import { afterEach, describe, expect, it } from 'vitest'
import { getMeta } from '../data/meta.repo'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import {
  estimateUsage,
  levelFor,
  refreshStorageMeta,
  requestPersist,
} from './storage'

const T = '0192a000-0000-7000-8000-00000000a001'

afterEach(async () => {
  await deleteTenantDbForTests(T)
})

describe('pos/maintenance/storage', () => {
  it('evaluates levelFor thresholds (>70 warn, >85 prune) cleanly', () => {
    expect(levelFor(0)).toBe('ok')
    expect(levelFor(70)).toBe('ok')
    expect(levelFor(71)).toBe('warn')
    expect(levelFor(85)).toBe('warn')
    expect(levelFor(86)).toBe('prune')
  })

  it('persists denied persist() state and quota percentage via meta.storage', async () => {
    const db = await openTenantDb(T)

    const status = await requestPersist(db, {
      persist: async () => false,
    })
    expect(status).toBe('DENIED')
    expect((await getMeta(db, 'storage'))?.persist).toBe('DENIED')

    const warnEst = await estimateUsage({
      estimate: async () => ({ usage: 71, quota: 100 }),
    })
    expect(warnEst.usedPct).toBe(71)
    expect(levelFor(warnEst.usedPct)).toBe('warn')

    const pruneRes = await refreshStorageMeta(db, {
      estimate: async () => ({ usage: 86, quota: 100 }),
    })
    expect(pruneRes).toEqual({ persist: 'DENIED', usedPct: 86, level: 'prune' })
    expect(await getMeta(db, 'storage')).toEqual({ persist: 'DENIED', used_pct: 86 })
  })
})
