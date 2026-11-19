import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

const LITERAL_TENANT_PATH_PATTERN =
  /(?:href\s*=\s*|to\s*[:=]\s*|navigate\s*\(\s*(?:\{\s*to\s*:\s*)?)(?:['"`])\/(?:pos|admin)(?:\/|['"`?#])/

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.test.tsx') &&
      !full.endsWith('routeTree.gen.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

export function scanLiteralTenantLinks(srcDir: string): Array<{ file: string; line: number; text: string }> {
  const violations: Array<{ file: string; line: number; text: string }> = []
  for (const file of collectSourceFiles(srcDir)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (rel.startsWith('src/lib/tenancy/')) continue

    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, idx) => {
      if (LITERAL_TENANT_PATH_PATTERN.test(line)) {
        violations.push({ file: rel, line: idx + 1, text: line.trim() })
      }
    })
  }
  return violations
}

describe('architecture tenantHref link guard', () => {
  it('src contains no hardcoded /pos or /admin literals in href, to, or navigate()', () => {
    expect(scanLiteralTenantLinks(join(ROOT, 'src'))).toEqual([])
  })

  it('catches literal /pos and /admin navigation patterns', () => {
    expect(LITERAL_TENANT_PATH_PATTERN.test('<a href="/pos">POS</a>')).toBe(true)
    expect(LITERAL_TENANT_PATH_PATTERN.test("<Link to='/admin/users' />")).toBe(true)
    expect(LITERAL_TENANT_PATH_PATTERN.test("navigate({ to: '/pos' })")).toBe(true)
    expect(LITERAL_TENANT_PATH_PATTERN.test('<a href={tenantHref(slug, \'/pos\')}>OK</a>')).toBe(
      false,
    )
  })
})
