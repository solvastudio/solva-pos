import { describe, expect, it } from 'vitest'
import { prependChangelog, renderChangelogEntry } from './changelog.mjs'
import { checkReleaseNotes } from './release-notes-check.mjs'

describe('changelog & numerical release notes check', () => {
  it('renders and prepends conventional commits cleanly', () => {
    const entry = renderChangelogEntry('v1.6.0', '2026-12-01T00:00:00.000Z', [
      'feat(sync): add release endpoint',
      'fix(tax): fix rounding half-up boundary',
    ])
    expect(entry).toContain('## v1.6.0 (2026-12-01)')
    expect(entry).toContain('### Features')
    expect(entry).toContain('- feat(sync): add release endpoint')
    expect(entry).toContain('### Fixes & Improvements')

    const combined = prependChangelog('# Changelog\n\n## v1.5.0 (2026-11-01)\n', entry)
    expect(combined.indexOf('## v1.6.0')).toBeLessThan(combined.indexOf('## v1.5.0'))
  })

  it('requires docs/releases/<tag>.md with "## Perubahan angka" when rounding/costing/sales-calc change', () => {
    expect(
      checkReleaseNotes({
        tag: 'v1.6.0',
        changedFiles: ['src/routes/api/pos/v1/pull.ts'],
        readReleaseNote: () => null,
      }),
    ).toEqual({ required: false, ok: true })

    expect(
      checkReleaseNotes({
        tag: 'v1.6.0',
        changedFiles: ['src/lib/sales-calc/totals.ts'],
        readReleaseNote: () => null,
      }),
    ).toMatchObject({ required: true, ok: false })

    expect(
      checkReleaseNotes({
        tag: 'v1.6.0',
        changedFiles: ['src/lib/kernel/rounding.ts'],
        readReleaseNote: () => '# v1.6.0\n\n## Perubahan angka\n\n\n## Notes\nOther\n',
      }),
    ).toMatchObject({ required: true, ok: false })

    expect(
      checkReleaseNotes({
        tag: 'v1.6.0',
        changedFiles: ['src/lib/kernel/rounding.ts'],
        readReleaseNote: () =>
          '# v1.6.0\n\n## Perubahan angka\nUpdated PB1 half-up calculation.\n',
      }),
    ).toEqual({ required: true, ok: true })
  })
})
