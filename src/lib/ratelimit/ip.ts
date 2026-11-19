const IPV4_MAPPED_PREFIX = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i
const IPV4_SEGMENT_RE = /^(?:0|[1-9]\d{0,2})$/

function parseIpv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }
  let acc = 0n
  for (const part of parts) {
    if (!IPV4_SEGMENT_RE.test(part)) {
      return null
    }
    const num = Number(part)
    if (num < 0 || num > 255) {
      return null
    }
    acc = (acc << 8n) + BigInt(num)
  }
  return acc
}

function parseIpv6ToBigInt(ip: string): bigint | null {
  let normalized = ip.toLowerCase()
  const zoneIdx = normalized.indexOf('%')
  if (zoneIdx !== -1) {
    normalized = normalized.slice(0, zoneIdx)
  }
  const doubleColonParts = normalized.split('::')
  if (doubleColonParts.length > 2) {
    return null
  }

  const expandGroupList = (segment: string): number[] | null => {
    if (segment === '') return []
    const items = segment.split(':')
    const out: number[] = []
    for (let i = 0; i < items.length; i += 1) {
      const token = items[i]!
      if (token.includes('.')) {
        if (i !== items.length - 1) return null
        const v4 = parseIpv4ToBigInt(token)
        if (v4 === null) return null
        out.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn))
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null
        out.push(Number.parseInt(token, 16))
      }
    }
    return out
  }

  const left = expandGroupList(doubleColonParts[0]!)
  if (left === null) return null

  let groups: number[]
  if (doubleColonParts.length === 2) {
    const right = expandGroupList(doubleColonParts[1]!)
    if (right === null) return null
    const missing = 8 - (left.length + right.length)
    if (missing < 1) return null
    groups = [...left, ...new Array<number>(missing).fill(0), ...right]
  } else {
    if (left.length !== 8) return null
    groups = left
  }

  let acc = 0n
  for (const g of groups) {
    acc = (acc << 16n) + BigInt(g)
  }
  return acc
}

function parseIp(
  raw: string,
): { family: 4; value: bigint } | { family: 6; value: bigint } | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const mappedMatch = IPV4_MAPPED_PREFIX.exec(trimmed)
  if (mappedMatch) {
    const v4 = parseIpv4ToBigInt(mappedMatch[1]!)
    return v4 !== null ? { family: 4, value: v4 } : null
  }

  if (trimmed.includes('.')) {
    const v4 = parseIpv4ToBigInt(trimmed)
    if (v4 !== null) {
      return { family: 4, value: v4 }
    }
  }

  if (trimmed.includes(':')) {
    const v6 = parseIpv6ToBigInt(trimmed)
    if (v6 !== null) {
      // Canonical IPv4-mapped range ::ffff:0:0/96
      if (v6 >= 0x0000_ffff_0000_0000n && v6 <= 0x0000_ffff_ffff_ffffn) {
        return { family: 4, value: v6 & 0xffff_ffffn }
      }
      return { family: 6, value: v6 }
    }
  }

  return null
}

function formatIpv4(value: bigint): string {
  return [
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  ].join('.')
}

export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') {
    return null
  }
  const parsed = parseIp(raw)
  if (!parsed) {
    return null
  }
  if (parsed.family === 4) {
    return formatIpv4(parsed.value)
  }
  return raw.trim().toLowerCase()
}

export function ipInCidr(rawIp: string, rawCidr: string): boolean {
  const ip = parseIp(rawIp)
  if (!ip) {
    return false
  }

  const [networkStr, prefixStr] = rawCidr.trim().split('/')
  if (!networkStr) {
    return false
  }
  const network = parseIp(networkStr)
  if (!network || network.family !== ip.family) {
    return false
  }

  const maxBits = ip.family === 4 ? 32 : 128
  const prefix =
    prefixStr === undefined ? maxBits : Number.parseInt(prefixStr, 10)
  if (
    prefixStr !== undefined &&
    (!/^\d+$/.test(prefixStr) || prefix < 0 || prefix > maxBits)
  ) {
    return false
  }

  if (prefix === 0) {
    return true
  }

  const hostBits = BigInt(maxBits - prefix)
  return (ip.value >> hostBits) === (network.value >> hostBits)
}

export interface ResolveClientIpInput {
  remoteAddress?: string | null
  xRealIp?: string | null
  trustedCidrs: readonly string[]
}

/**
 * Resolves the client IP solely from the direct remote socket address and
 * `X-Real-IP` when the remote socket is within `trustedCidrs`.
 * Never reads `X-Forwarded-For` to prevent spoofing.
 */
export function resolveClientIp(input: ResolveClientIpInput): string | undefined {
  const remote = normalizeIp(input.remoteAddress)
  if (!remote) {
    return undefined
  }

  const isTrustedProxy = input.trustedCidrs.some((cidr) => ipInCidr(remote, cidr))
  if (!isTrustedProxy) {
    return remote
  }

  const realIp = normalizeIp(input.xRealIp)
  return realIp ?? remote
}
