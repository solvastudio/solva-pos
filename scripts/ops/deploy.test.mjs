import { describe, expect, it } from 'vitest'
import { deploy } from './deploy.mjs'
import { runBackupDump } from './backup-dump.mjs'
import { probeHealth } from './health-check.mjs'
import { parseReleaseArgs, prepareReleaseRecord } from './release-register.mjs'

describe('ops deploy, health-check, backup-dump, and release-register', () => {
  it('completes full deploy cleanly without backup for additive migrations', async () => {
    const events = []
    let t = 0
    let polls = 0

    const res = await deploy({
      newImage: 'solva-pos:v1.8.0',
      newVersion: 'v1.8.0',
      prevImage: 'solva-pos:v1.7.0',
      newMigrations: [{ name: '0022_add_col.sql', content: 'ALTER TABLE t ADD COLUMN x text;' }],
      now: () => t,
      sleep: async (ms) => {
        t += ms
      },
      backup: async () => {
        events.push('backup')
      },
      db: {
        getMaxDeviceSchemaVersion: async () => 7,
      },
      docker: {
        runMigrator: async (img) => events.push(`migrate:${img}`),
        switchApp: async (img) => events.push(`switch:${img}`),
        getImageMaxSchemaVersion: async () => 7,
      },
      health: {
        check: async () => {
          polls += 1
          return polls < 2
            ? { ok: false, status: 503, version: 'v1.7.0' }
            : { ok: true, status: 200, version: 'v1.8.0' }
        },
      },
      syncSourcemaps: async ({ version }) => events.push(`sourcemaps:${version}`),
      registerRelease: async ({ version }) => events.push(`register:${version}`),
    })

    expect(res).toEqual({
      ok: true,
      exitCode: 0,
      rolledBack: false,
      backedUp: false,
    })
    expect(events).toEqual([
      'migrate:solva-pos:v1.8.0',
      'switch:solva-pos:v1.8.0',
      'sourcemaps:v1.8.0',
      'register:v1.8.0',
    ])
  })

  it('triggers pg_dump backup ONLY when migration contains -- touches-existing-data', async () => {
    const events = []
    let t = 0

    const res = await deploy({
      newImage: 'solva-pos:v1.8.0',
      newVersion: 'v1.8.0',
      prevImage: 'solva-pos:v1.7.0',
      newMigrations: [
        {
          name: '0023_backfill.sql',
          content: '-- touches-existing-data\nUPDATE outlet SET cash_rounding_unit = 100;',
        },
      ],
      now: () => t,
      sleep: async (ms) => {
        t += ms
      },
      backup: async ({ migrations }) => {
        events.push(`backup:${migrations.join(',')}`)
      },
      db: { getMaxDeviceSchemaVersion: async () => 7 },
      docker: {
        runMigrator: async () => events.push('migrate'),
        switchApp: async () => events.push('switch'),
        getImageMaxSchemaVersion: async () => 7,
      },
      health: { check: async () => ({ ok: true, status: 200, version: 'v1.8.0' }) },
    })

    expect(res.ok).toBe(true)
    expect(res.backedUp).toBe(true)
    expect(events).toEqual(['backup:0023_backfill.sql', 'migrate', 'switch'])
  })

  it('automatically rolls back to prevImage when /health fails within timeout', async () => {
    const switched = []
    let t = 0

    const res = await deploy({
      newImage: 'solva-pos:v1.8.0',
      newVersion: 'v1.8.0',
      prevImage: 'solva-pos:v1.7.0',
      newMigrations: [],
      now: () => t,
      sleep: async (ms) => {
        t += ms
      },
      timeoutMs: 9_000,
      pollIntervalMs: 3_000,
      backup: async () => {},
      db: { getMaxDeviceSchemaVersion: async () => 7 },
      docker: {
        runMigrator: async () => {},
        switchApp: async (img) => switched.push(img),
        getImageMaxSchemaVersion: async () => 7,
      },
      health: { check: async () => ({ ok: false, status: 503, version: 'v1.8.0' }) },
    })

    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(1)
    expect(res.rolledBack).toBe(true)
    expect(switched).toEqual(['solva-pos:v1.8.0', 'solva-pos:v1.7.0'])
  })

  it('refuses rollback with exitCode 2 when clients use a schema higher than prevImage supports', async () => {
    const switched = []
    let t = 0

    const res = await deploy({
      newImage: 'solva-pos:v1.9.0',
      newVersion: 'v1.9.0',
      prevImage: 'solva-pos:v1.8.0',
      newMigrations: [],
      now: () => t,
      sleep: async (ms) => {
        t += ms
      },
      timeoutMs: 6_000,
      pollIntervalMs: 3_000,
      backup: async () => {},
      db: { getMaxDeviceSchemaVersion: async () => 9 },
      docker: {
        runMigrator: async () => {},
        switchApp: async (img) => switched.push(img),
        getImageMaxSchemaVersion: async () => 8,
      },
      health: { check: async () => ({ ok: false, status: 503, version: 'v1.9.0' }) },
    })

    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(2)
    expect(res.rolledBack).toBe(false)
    expect(res.reason).toBe('ROLLBACK_BLOCKED_UNSUPPORTED_SCHEMA')
    expect(res.warning).toContain('schema_version=9')
    // Leaves newImage in place instead of rolling back
    expect(switched).toEqual(['solva-pos:v1.9.0'])
  })

  it('validates probeHealth, backupDump, and V-31 release-register 30-day window arithmetic', async () => {
    const healthy = await probeHealth('http://localhost/health', {
      expectedVersion: 'v1.8.0',
      fetch: async () =>
        new Response(JSON.stringify({ status: 'ok', version: 'v1.8.0' }), { status: 200 }),
    })
    expect(healthy.ok).toBe(true)

    const mismatch = await probeHealth('http://localhost/health', {
      expectedVersion: 'v1.8.0',
      fetch: async () =>
        new Response(JSON.stringify({ status: 'ok', version: 'v1.7.0' }), { status: 200 }),
    })
    expect(mismatch.ok).toBe(false)

    const calls = []
    await runBackupDump({
      databaseUrl: 'postgres://owner@localhost/solva',
      outPath: '/tmp/test.dump',
      run: (cmd, args) => calls.push([cmd, ...args]),
    })
    expect(calls).toEqual([['pg_dump', '-Fc', '-f', '/tmp/test.dump', 'postgres://owner@localhost/solva']])

    // V-31: Dec 1 release -> accept_previous_until is Dec 31
    const parsed = parseReleaseArgs([
      '--version',
      'v1.8.0',
      '--schema',
      '8',
      '--min-schema',
      '7',
      '--mandatory',
      '--min-app',
      'v1.6.0',
      '--released-at',
      '2026-12-01T00:00:00.000Z',
    ])
    const row = prepareReleaseRecord(parsed)
    expect(row.app_version).toBe('v1.8.0')
    expect(row.schema_version).toBe(8)
    expect(row.min_supported_schema_version).toBe(7)
    expect(row.min_supported_app_version).toBe('v1.6.0')
    expect(row.is_mandatory).toBe(true)
    expect(row.accept_previous_until).toBe('2026-12-31T00:00:00.000Z')

    expect(() =>
      prepareReleaseRecord({
        version: 'v1.8.0',
        schemaVersion: 7,
        minSupportedSchemaVersion: 8,
        minSupportedAppVersion: null,
      }),
    ).toThrow(/min-schema/i)
  })
})
