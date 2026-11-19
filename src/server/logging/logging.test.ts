import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serializeError } from './error-serializer'
import { createFileSink } from './file-destination'
import { LOG_FIELD_NAMES } from './log-fields'
import { pruneLogs } from './log-retention'
import { candidateLogFiles, matchesLogFilters, parseLogLine } from './log-search'
import { jobRefId, newRefId, REF_ID_PATTERN } from './log-time'
import { captureLogs } from './logger-core'
import { installProcessHandlers } from './process-handlers'
import { resolveRequestId } from './request-id'

describe('server/logging core modules', () => {
  it('generates UTC refId & jobId matching pattern', () => {
    const id = newRefId(Date.UTC(2026, 10, 19, 14, 5, 9))
    expect(id).toMatch(REF_ID_PATTERN)
    expect(id.startsWith('20261119-140509-')).toBe(true)

    const jobId = jobRefId(Date.UTC(2026, 10, 19, 14, 5, 9))
    expect(jobId).toMatch(/^job-\d{8}-\d{6}-[a-hj-km-np-z2-9]{5}$/)
  })

  it('resolveRequestId accepts valid headers and rejects invalid headers', () => {
    expect(resolveRequestId('req-abc_12.3')).toBe('req-abc_12.3')
    expect(resolveRequestId('x'.repeat(65))).toMatch(REF_ID_PATTERN)
    expect(resolveRequestId('bad header/with space')).toMatch(REF_ID_PATTERN)
    expect(resolveRequestId(null)).toMatch(REF_ID_PATTERN)
  })

  it('closed LOG_FIELD_NAMES registry matches snapshot', () => {
    expect(LOG_FIELD_NAMES).toMatchInlineSnapshot(`
      [
        "err",
        "reason",
        "label",
        "durationMs",
        "fn",
        "publicCode",
        "method",
        "path",
        "status",
        "ip",
        "commandId",
        "commandType",
        "outcome",
        "saleId",
        "invoiceNo",
        "outletId",
        "cursorFrom",
        "cursorTo",
        "rowCount",
        "schemaVersion",
        "appVersion",
        "origin",
        "route",
        "userAgent",
        "componentStack",
        "clientError",
        "usernameHash",
        "usernameLength",
        "refLocal",
        "errorClass",
        "notifyKind",
        "idempotencyKey",
        "scope",
        "tenantId",
        "userId",
        "deviceId",
        "registerId",
        "reqId",
        "jobId",
        "parentReqId",
        "env",
      ]
    `)
  })

  it('error-serializer strips pg detail/where/parameters and bounds stack/cause', () => {
    const leaf = Object.assign(new Error('duplicate key value violates "1234"'), {
      code: '23505',
      severity: 'ERROR',
      detail: 'Key (pin)=(1234) already exists',
      where: 'PL/pgSQL function',
      parameters: ['1234'],
    })
    const wrapped = new Error('wrapper', { cause: leaf })

    const serialized = serializeError(wrapped)
    expect(serialized.message).toBe('wrapper')
    expect(serialized.cause?.message).toBe('[db] 23505: duplicate key value violates')
    expect(JSON.stringify(serialized)).not.toContain('1234')
    expect(JSON.stringify(serialized)).not.toContain('Key (pin)')
    if (serialized.stack) {
      for (const line of serialized.stack.split('\n')) {
        expect(line.startsWith('    at ')).toBe(true)
      }
    }
  })

  it('pruneLogs deletes only app.<YYYY-MM-DD>.<n>.log files past retention', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'solva-log-ret-'))
    try {
      await writeFile(join(dir, 'app.2026-10-01.1.log'), 'old\n')
      await writeFile(join(dir, 'app.2026-11-18.1.log'), 'recent\n')
      await writeFile(join(dir, 'unrelated.2020-01-01.log'), 'keep\n')

      const removed = await pruneLogs(dir, 30, Date.UTC(2026, 10, 19))
      expect(removed).toEqual(['app.2026-10-01.1.log'])

      const remaining = (await readdir(dir)).sort()
      expect(remaining).toEqual(['app.2026-11-18.1.log', 'unrelated.2020-01-01.log'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('file-destination does not crash the process when opening the log file fails', async () => {
    const problems: string[] = []
    const sink = createFileSink({
      dir: '/nonexistent',
      reopenDelayMs: 60_000,
      build: async () => {
        throw new Error('disk full')
      },
      onProblem: (msg) => problems.push(msg),
    })

    await sink.whenOpen()
    sink.write('{"level":"info"}\n')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('disk full')
  })

  it('installProcessHandlers logs fatal, flushes, and calls exit only in production', () => {
    const cap = captureLogs('debug')
    try {
      const target = new EventEmitter()
      let flushed = 0
      let exitCode: number | null = null

      installProcessHandlers({
        target: target as unknown as Pick<NodeJS.Process, 'on'>,
        flush: () => {
          flushed += 1
        },
        exitOnFatal: true,
        exit: (c) => {
          exitCode = c
        },
      })

      target.emit('uncaughtException', new Error('boom'))
      expect(flushed).toBe(1)
      expect(exitCode).toBe(1)
      expect(cap.entries().some((e) => e.level === 'fatal' && e.reason === 'uncaughtException')).toBe(
        true,
      )
    } finally {
      cap.stop()
    }
  })

  it('log-search selects candidate files and filters JSON entries accurately', () => {
    const files = candidateLogFiles(
      ['app.2026-11-10.1.log', 'app.2026-11-19.1.log', 'README.txt'],
      { ref: '20261119-140500-k7q2m' },
      '2026-11-19',
    )
    expect(files).toEqual(['app.2026-11-19.1.log'])

    const e = parseLogLine(
      JSON.stringify({
        level: 'warn',
        time: '2026-11-19T14:05:00.000Z',
        reqId: '20261119-140500-k7q2m',
        tenantId: 't-1',
        path: '/api/pos/v1/push',
      }),
    )
    expect(e).not.toBeNull()
    expect(
      matchesLogFilters(e!, {
        ref: '20261119-140500-k7q2m',
        level: 'warn',
        tenantId: 't-1',
        pathPrefix: '/api',
      }),
    ).toBe(true)
    expect(matchesLogFilters(e!, { level: 'error' })).toBe(false)
  })
})
