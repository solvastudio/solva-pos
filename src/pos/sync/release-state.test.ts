import { describe, expect, it } from 'vitest'
import type { ReleaseBlock } from '~/lib/contracts'
import { evaluateRelease } from './release-state'

function block(overrides?: Partial<ReleaseBlock>): ReleaseBlock {
  return {
    latest: '1.2.0',
    min_supported_app_version: '1.0.0',
    min_supported_schema_version: 1,
    is_mandatory: false,
    accept_previous_until: null,
    max_schema_version: 1,
    ...overrides,
  }
}

describe('evaluateRelease', () => {
  const now = Date.parse('2026-12-15T00:00:00.000Z')

  it('covers UP_TO_DATE, SOFT, HARD, REQUIRED, and SERVER_BEHIND cases', () => {
    expect(
      evaluateRelease(block(), { appVersion: '1.2.0', schemaVersion: 1 }, now),
    ).toBe('UP_TO_DATE')

    expect(
      evaluateRelease(block(), { appVersion: '1.2.0', schemaVersion: 1, hasWaitingWorker: true }, now),
    ).toBe('SOFT')

    expect(
      evaluateRelease(block(), { appVersion: '1.1.0', schemaVersion: 1 }, now),
    ).toBe('SOFT')

    expect(
      evaluateRelease(
        block({ is_mandatory: true }),
        { appVersion: '1.1.0', schemaVersion: 1 },
        now,
      ),
    ).toBe('HARD')

    expect(
      evaluateRelease(
        block({ min_supported_app_version: '1.1.5' }),
        { appVersion: '1.1.0', schemaVersion: 1 },
        now,
      ),
    ).toBe('REQUIRED')

    expect(
      evaluateRelease(
        block({ min_supported_schema_version: 2, max_schema_version: 2 }),
        { appVersion: '1.2.0', schemaVersion: 1 },
        now,
      ),
    ).toBe('REQUIRED')

    expect(
      evaluateRelease(
        block({ max_schema_version: 1 }),
        { appVersion: '1.3.0', schemaVersion: 2 },
        now,
      ),
    ).toBe('SERVER_BEHIND')
  })

  it('handles V-31 30-day compatibility window: contract 7 is SOFT until Dec 31, HARD after', () => {
    const decRelease = block({
      latest: '2.0.0',
      min_supported_app_version: '1.0.0',
      min_supported_schema_version: 7,
      max_schema_version: 8,
      is_mandatory: false,
      accept_previous_until: '2026-12-31T23:59:59.000Z',
    })

    // Contract 7 client on Dec 15 (within 30-day window) => SOFT
    expect(
      evaluateRelease(
        decRelease,
        { appVersion: '1.9.0', schemaVersion: 7 },
        Date.parse('2026-12-15T12:00:00.000Z'),
      ),
    ).toBe('SOFT')

    // Contract 7 client on Jan 1 (after Dec 31 deadline) => HARD
    expect(
      evaluateRelease(
        decRelease,
        { appVersion: '1.9.0', schemaVersion: 7 },
        Date.parse('2027-01-01T00:00:01.000Z'),
      ),
    ).toBe('HARD')

    // Already upgraded to contract 8 => UP_TO_DATE even after deadline
    expect(
      evaluateRelease(
        decRelease,
        { appVersion: '2.0.0', schemaVersion: 8 },
        Date.parse('2027-01-01T00:00:01.000Z'),
      ),
    ).toBe('UP_TO_DATE')
  })
})
