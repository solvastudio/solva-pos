import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

const FORBIDDEN_PATTERNS = [
  /\bambil[_\s-]*alih\b/i,
  /\btutup[_\s-]*paksa\b/i,
  /\btake[_\s-]*over\b/i,
  /\bforce[_\s-]*close[_\s-]*bill\b/i,
  /\brelease[_\s-]*bill[_\s-]*lease\b/i,
]

const ALLOWED_CONTAINS_EXPLANATION = /Tidak ada pengambilalihan|Tutup paksa shift/i

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx|json)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('arch/no-takeover (FR-FNB-003, BR-FNB-003)', () => {
  it('contains zero bill takeover or force-close routes, buttons, or i18n keys', () => {
    const files = [
      ...walk(join(ROOT, 'src/components/pos/fnb')),
      ...walk(join(ROOT, 'src/modules/fnb')),
      ...walk(join(ROOT, 'src/routes/api/pos/v1/bills')),
      join(ROOT, 'src/i18n/locales/id.json'),
      join(ROOT, 'src/i18n/locales/en.json'),
    ]

    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split(/\r?\n/)
      lines.forEach((line, idx) => {
        if (ALLOWED_CONTAINS_EXPLANATION.test(line)) return
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(line)) {
            hits.push({
              file: relative(ROOT, file).replace(/\\/g, '/'),
              line: idx + 1,
              text: line.trim(),
            })
          }
        }
      })
    }

    expect(hits).toEqual([])
  })
})
