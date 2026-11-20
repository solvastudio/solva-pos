import { describe, expect, it } from 'vitest'
import {
  formatRcTag,
  isStagingRcTag,
  nextVersion,
  parseReleaseTag,
} from './version-rules.mjs'

describe('version-rules Conventional Commits calculation', () => {
  it('computes next version from >= 1.0 tags accurately', () => {
    expect(nextVersion('v1.5.0', ['fix: adjust label', 'feat(pos): hold cart'])).toEqual({
      next: 'v1.6.0',
      bump: 'minor',
    })
    expect(nextVersion('v1.5.0', ['fix: minor bug', 'perf: index lookup'])).toEqual({
      next: 'v1.5.1',
      bump: 'patch',
    })
    expect(nextVersion('v1.5.0', ['feat!: new envelope format'])).toEqual({
      next: 'v2.0.0',
      bump: 'major',
    })
    expect(nextVersion('v1.5.0', ['chore: update docs', 'test: add case'])).toEqual({
      next: 'v1.5.0',
      bump: 'none',
    })
    expect(nextVersion('v1.5.0', [])).toEqual({
      next: 'v1.5.0',
      bump: 'none',
    })
  })

  it('keeps 0.x breaking changes on minor bump without jumping to 1.0.0', () => {
    expect(nextVersion('v0.4.2', ['feat!: breaking schema adjustment'])).toEqual({
      next: 'v0.5.0',
      bump: 'minor',
    })
    expect(nextVersion('v0.4.2', ['feat: add command'])).toEqual({
      next: 'v0.5.0',
      bump: 'minor',
    })
    expect(nextVersion('v0.4.2', ['refactor: simplify query'])).toEqual({
      next: 'v0.4.3',
      bump: 'patch',
    })
  })

  it('parses and formats staging rc tags', () => {
    expect(formatRcTag('v1.6.0', 2)).toBe('v1.6.0-rc.2')
    expect(isStagingRcTag('v1.6.0-rc.2')).toBe(true)
    expect(isStagingRcTag('v1.6.0')).toBe(false)
    expect(parseReleaseTag('v1.6.0-rc.2')).toEqual({
      major: 1,
      minor: 6,
      patch: 0,
      prerelease: 'rc.2',
    })
  })
})
