export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  pre: readonly string[]
}

const APP_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.+-]+)?$/
const MAX_APP_VERSION_LEN = 30

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : (process.env.APP_VERSION ?? 'dev')

export function parseSemver(version: string): ParsedSemver | null {
  if (typeof version !== 'string' || version.length === 0 || version.length > MAX_APP_VERSION_LEN) {
    return null
  }
  const match = APP_VERSION_PATTERN.exec(version)
  if (!match) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null
  }

  const preRaw = match[4]
  const pre = preRaw ? preRaw.split('.') : []
  if (pre.some((id) => id.length === 0 || (/^\d+$/.test(id) && id.length > 1 && id.startsWith('0')))) {
    return null
  }

  return { major, minor, patch, pre }
}

export function isAppVersion(value: string): boolean {
  return parseSemver(value) !== null
}

function compareIdentifiers(a: string, b: string): -1 | 0 | 1 {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) {
    const diff = Number(a) - Number(b)
    return diff < 0 ? -1 : diff > 0 ? 1 : 0
  }
  if (aNum !== bNum) {
    return aNum ? -1 : 1
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Compares two SemVer app versions (`-1 | 0 | 1`). Throws `RangeError` if either is invalid.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) {
    throw new RangeError(`Invalid SemVer comparison: "${a}" vs "${b}"`)
  }

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1

  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1

  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i += 1) {
    const idA = pa.pre[i]
    const idB = pb.pre[i]
    if (idA === undefined) return -1
    if (idB === undefined) return 1
    const cmp = compareIdentifiers(idA, idB)
    if (cmp !== 0) return cmp
  }
  return 0
}

export function formatVersionFooter(
  appVersion: string,
  schemaVersion: number,
  opts?: { withContract?: boolean },
): string {
  if (opts?.withContract) {
    return `Solva POS ${appVersion} · kontrak ${schemaVersion}`
  }
  return `Solva POS ${appVersion}`
}
