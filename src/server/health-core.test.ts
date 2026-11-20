import { describe, expect, it } from 'vitest'
import { computeHealth } from './health-core'

describe('computeHealth pure evaluation', () => {
  it('returns 503 down when database is unreachable', () => {
    expect(
      computeHealth({ dbOk: false, appliedMigrations: null, expectedMigrations: 24, version: 'v1.0.0' }),
    ).toEqual({
      httpStatus: 503,
      body: { status: 'down', version: 'v1.0.0', db: 'down', migrations: 'unknown' },
    })
  })

  it('returns 503 degraded when migration count is unknown', () => {
    expect(
      computeHealth({ dbOk: true, appliedMigrations: null, expectedMigrations: 24, version: 'v1.0.0' }),
    ).toEqual({
      httpStatus: 503,
      body: { status: 'degraded', version: 'v1.0.0', db: 'up', migrations: 'unknown' },
    })
  })

  it('returns 503 degraded when applied migrations lag expected count', () => {
    expect(
      computeHealth({ dbOk: true, appliedMigrations: 22, expectedMigrations: 24, version: 'v1.0.0' }),
    ).toEqual({
      httpStatus: 503,
      body: { status: 'degraded', version: 'v1.0.0', db: 'up', migrations: 'behind' },
    })
  })

  it('returns 200 ok when database is reachable and migrations are current', () => {
    expect(
      computeHealth({ dbOk: true, appliedMigrations: 24, expectedMigrations: 24, version: 'v1.0.0' }),
    ).toEqual({
      httpStatus: 200,
      body: { status: 'ok', version: 'v1.0.0', db: 'up', migrations: 'current' },
    })
  })
})
