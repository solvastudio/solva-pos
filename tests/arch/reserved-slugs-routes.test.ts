import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS } from '~/lib/kernel'

const ROOT = resolve(import.meta.dirname, '../..')
const ROUTES_DIR = resolve(ROOT, 'src/routes')
const FIXTURE_ROUTES_DIR = resolve(ROOT, 'tests/arch/fixtures-routes')

const RESERVED_SET = new Set<string>(RESERVED_SLUGS)

function extractTopLevelStaticSegments(routesDir: string): string[] {
  const segments: string[] = []
  for (const entry of readdirSync(routesDir)) {
    if (entry.startsWith('$') || entry.startsWith('__') || entry === 'index.tsx' || /\.gen\./.test(entry)) {
      continue
    }
    const base = entry.replace(/\.(?:tsx|ts|jsx|js)$/, '')
    if (!base || base === 'index') continue
    segments.push(base.toLowerCase())
  }
  return segments
}

function isSegmentProtected(segment: string): boolean {
  if (RESERVED_SET.has(segment)) return true
  if (segment.startsWith('_') && RESERVED_SET.has(segment.slice(1))) return true
  return false
}

function findUnreservedSegments(routesDir: string): string[] {
  return extractTopLevelStaticSegments(routesDir).filter((seg) => !isSegmentProtected(seg))
}

describe('architecture reserved slug vs static route guard', () => {
  it('ensures every top-level static route segment is covered by RESERVED_SLUGS', () => {
    const unreserved = findUnreservedSegments(ROUTES_DIR)
    expect(unreserved).toEqual([])
  })

  it('ensures $tenant child static segments are unique', () => {
    const tenantDir = join(ROUTES_DIR, '$tenant')
    if (!existsSync(tenantDir)) return
    const childNames = readdirSync(tenantDir).map((entry) => {
      const st = statSync(join(tenantDir, entry))
      return st.isDirectory() ? entry : entry.replace(/\.(?:tsx|ts|jsx|js)$/, '')
    })
    expect(new Set(childNames).size).toBe(childNames.length)
    expect(childNames).toContain('api')
    expect(childNames).toContain('join')
    expect(childNames).toContain('reset')
  })

  it('detects unreserved top-level route segment in fixture directory', () => {
    const unreserved = findUnreservedSegments(FIXTURE_ROUTES_DIR)
    expect(unreserved).toEqual(['zzz'])
  })
})
