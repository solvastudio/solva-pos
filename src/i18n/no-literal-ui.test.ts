import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SCAN_DIRS = ['src/components', 'src/routes']
const UI_ATTR_LITERAL = /\b(?:aria-label|placeholder|title|alt)\s*=\s*"([^"]+)"/g

function collectTsxFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const out: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      const rel = relative(ROOT, full).replace(/\\/g, '/')
      if (rel === 'src/routes/api' || rel.startsWith('src/routes/api/')) continue
      out.push(...collectTsxFiles(full))
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('i18n/no-literal-ui (FR-I18N-001)', () => {
  it('forbids literal UI attributes (aria-label/placeholder/title/alt) in components/routes', () => {
    const violations: string[] = []
    for (const relDir of SCAN_DIRS) {
      const files = collectTsxFiles(join(ROOT, relDir))
      for (const file of files) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/)
        const relPath = relative(ROOT, file).replace(/\\/g, '/')
        lines.forEach((line, idx) => {
          UI_ATTR_LITERAL.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = UI_ATTR_LITERAL.exec(line)) !== null) {
            const val = (m[1] ?? '').trim()
            if (val.length > 0) {
              violations.push(`${relPath}:${idx + 1}: ${m[0]}`)
            }
          }
        })
      }
    }

    expect(
      violations,
      `Literal UI attributes found (use i18n t(...) keys):\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
