import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncSourcemaps } from './sourcemaps-sync.mjs'

describe('sourcemaps-sync copy and 90-day retention pruning', () => {
  let root = ''

  afterEach(() => {
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('copies release maps and prunes only unreported folders older than 90 days', () => {
    root = mkdtempSync(join(tmpdir(), 'solva-maps-'))
    const releaseDir = join(root, 'release')
    const sourcemapDir = join(root, 'sourcemaps')
    mkdirSync(join(releaseDir, 'assets'), { recursive: true })
    writeFileSync(join(releaseDir, 'assets', 'main-123.js.map'), '{"version":3}')

    const nowMs = Date.UTC(2026, 11, 15, 0, 0, 0)
    const oldDate = new Date(nowMs - 95 * 86_400_000)
    const recentDate = new Date(nowMs - 30 * 86_400_000)

    const oldUnreported = join(sourcemapDir, 'v1.0.0')
    const oldReported = join(sourcemapDir, 'v1.1.0')
    const recentUnreported = join(sourcemapDir, 'v1.5.0')

    for (const [dir, date] of [
      [oldUnreported, oldDate],
      [oldReported, oldDate],
      [recentUnreported, recentDate],
    ]) {
      mkdirSync(dir, { recursive: true })
      const f = join(dir, 'app.js.map')
      writeFileSync(f, '{}')
      utimesSync(f, date, date)
      utimesSync(dir, date, date)
    }

    const res = syncSourcemaps({
      releaseDir,
      sourcemapDir,
      version: 'v1.6.0',
      reportedVersions: ['v1.1.0'],
      nowMs,
    })

    expect(res.copied).toBe(1)
    expect(res.pruned).toEqual(['v1.0.0'])
    expect(existsSync(join(sourcemapDir, 'v1.6.0', 'assets', 'main-123.js.map'))).toBe(true)
    expect(existsSync(oldUnreported)).toBe(false)
    expect(existsSync(oldReported)).toBe(true)
    expect(existsSync(recentUnreported)).toBe(true)
  })
})
