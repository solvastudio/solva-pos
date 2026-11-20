const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const COMMIT_HEADER_RE = /^([a-z]+)(?:\([^)]*\))?(!)?:\s+.+$/

/**
 * Parses a git release tag (`vX.Y.Z` or `vX.Y.Z-rc.N`) into numeric components.
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string') return null
  const match = TAG_PATTERN.exec(tag.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

export function isStagingRcTag(tag) {
  const parsed = parseReleaseTag(tag)
  return Boolean(parsed && parsed.prerelease && /^rc\.\d+$/.test(parsed.prerelease))
}

/**
 * Classifies an array of Conventional Commit messages into the highest required bump level.
 */
export function classifyCommits(commits) {
  let bump = 'none'
  for (const raw of commits) {
    const msg = String(raw ?? '').trim()
    if (!msg) continue
    const firstLine = msg.split(/\r?\n/, 1)[0] ?? ''
    const headerMatch = COMMIT_HEADER_RE.exec(firstLine)
    const hasBreakingFooter = /^BREAKING CHANGE:\s+/m.test(msg)
    if (headerMatch?.[2] === '!' || hasBreakingFooter) {
      return 'major'
    }
    const type = headerMatch?.[1]
    if (type === 'feat') {
      bump = 'minor'
    } else if ((type === 'fix' || type === 'perf' || type === 'refactor') && bump === 'none') {
      bump = 'patch'
    }
  }
  return bump
}

/**
 * Computes the next SemVer tag from `currentTag` and Conventional Commits, applying 0.x rules:
 * while major === 0, breaking changes (`major`) bump minor (`0.(minor+1).0`) instead of `1.0.0`.
 */
export function nextVersion(currentTag, commits) {
  const baseTag = currentTag ?? 'v0.0.0'
  const parsed = parseReleaseTag(baseTag)
  if (!parsed) {
    throw new RangeError(`Invalid release tag: ${baseTag}`)
  }

  const rawBump = classifyCommits(commits)
  if (rawBump === 'none') {
    return { next: baseTag, bump: 'none' }
  }

  if (parsed.major === 0) {
    if (rawBump === 'major' || rawBump === 'minor') {
      return {
        next: `v0.${parsed.minor + 1}.0`,
        bump: 'minor',
      }
    }
    return {
      next: `v0.${parsed.minor}.${parsed.patch + 1}`,
      bump: 'patch',
    }
  }

  if (rawBump === 'major') {
    return { next: `v${parsed.major + 1}.0.0`, bump: 'major' }
  }
  if (rawBump === 'minor') {
    return { next: `v${parsed.major}.${parsed.minor + 1}.0`, bump: 'minor' }
  }
  return { next: `v${parsed.major}.${parsed.minor}.${parsed.patch + 1}`, bump: 'patch' }
}

export function formatRcTag(stableTag, rcNumber) {
  const parsed = parseReleaseTag(stableTag)
  if (!parsed || parsed.prerelease !== null) {
    throw new RangeError(`Expected base vX.Y.Z tag for rc formatting, got: ${stableTag}`)
  }
  if (!Number.isSafeInteger(rcNumber) || rcNumber < 1) {
    throw new RangeError(`Invalid rc number: ${rcNumber}`)
  }
  return `v${parsed.major}.${parsed.minor}.${parsed.patch}-rc.${rcNumber}`
}
