import { describe, expect, it } from 'vitest'
import { DEVICE_LOG_CODES, DeviceLogEntrySchema, DeviceLogRequestSchema } from './device-log'

describe('device-log contracts', () => {
  const validEntry = {
    ref_local: 'D-20261118-140322-m4k9q',
    created_at: '2026-11-18T14:03:22.000Z',
    clock_offset_ms: 0,
    level: 'error' as const,
    code: 'APP_ERROR',
    route: '/toko-a/pos',
    stack: 'Error: boom\n    at Cart (main.js:1:2)',
    ctx: { attempt: 1 },
    app_version: 'v1.0.0',
    schema_version: 1,
  }

  it('includes all ERROR_CODES plus DEVICE_LOG_EXTRA_CODES and validates valid requests', () => {
    expect(DEVICE_LOG_CODES).toContain('APP_ERROR')
    expect(DEVICE_LOG_CODES).toContain('SYNC_FAILED')
    expect(DEVICE_LOG_CODES).toContain('PERSIST_DENIED')

    expect(DeviceLogEntrySchema.parse(validEntry).ref_local).toBe(validEntry.ref_local)
    expect(DeviceLogRequestSchema.parse({ entries: [validEntry] }).entries).toHaveLength(1)
  })

  it('rejects oversized ctx (>2KB), >100 entries, and invalid ref_local', () => {
    expect(
      DeviceLogEntrySchema.safeParse({
        ...validEntry,
        ref_local: 'D-20261118-140322-iiiii', // i is excluded from alphabet
      }).success,
    ).toBe(false)

    expect(
      DeviceLogEntrySchema.safeParse({
        ...validEntry,
        ctx: { big: 'x'.repeat(2100) },
      }).success,
    ).toBe(false)

    expect(
      DeviceLogRequestSchema.safeParse({
        entries: Array.from({ length: 101 }, () => validEntry),
      }).success,
    ).toBe(false)
  })
})
