import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

// T-01 static fallback exception: zero-bundle fallback page cannot consume Tailwind tokens.css.
export const TOKEN_GUARD_STATIC_EXCLUSIONS = ['public/recovery.html'] as const

const RULES: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'hardcoded-color',
    pattern: /#[0-9A-Fa-f]{3,8}\b|\brgb\s*\(|\bhsl\s*\(/,
  },
  {
    name: 'arbitrary-px-rem',
    pattern: /\b[a-z-]+-\[\d+(?:\.\d+)?(?:px|rem)\]/,
  },
  {
    name: 'default-tailwind-palette',
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke)-(?:(?:red|green|blue|gray|slate|zinc|stone|orange|amber|yellow|lime|emerald|cyan|sky|indigo|purple|fuchsia|pink|rose|teal|violet|neutral)-\d+|white|black)\b/,
  },
  {
    name: 'disabled-opacity',
    pattern: /\bdisabled:opacity-\d+\b/,
  },
]

function scanFile(filePath: string): Array<{ file: string; line: number; rule: string; snippet: string }> {
  const rel = relative(ROOT, filePath).replace(/\\/g, '/')
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  const out: Array<{ file: string; line: number; rule: string; snippet: string }> = []

  lines.forEach((line, idx) => {
    for (const rule of RULES) {
      const m = rule.pattern.exec(line)
      if (m) {
        out.push({ file: rel, line: idx + 1, rule: rule.name, snippet: m[0] })
      }
    }
  })
  return out
}

function collectTsx(dir: string): string[] {
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
      out.push(...collectTsx(full))
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('arch/token-guard (DP-10, T-01..T-09)', () => {
  it('src/components and src/routes are free of hardcoded hex, arbitrary px/rem, default palette, and disabled:opacity', () => {
    const files = [...collectTsx(join(ROOT, 'src/components')), ...collectTsx(join(ROOT, 'src/routes'))]
    const violations = files.flatMap(scanFile)
    expect(violations).toEqual([])
  })

  it('detects all four token violation fixtures in tests/arch/fixtures-token', () => {
    const fxDir = resolve(import.meta.dirname, 'fixtures-token')
    expect(scanFile(join(fxDir, 'bad-color.tsx')).some((v) => v.rule === 'hardcoded-color')).toBe(true)
    expect(scanFile(join(fxDir, 'bad-px.tsx')).some((v) => v.rule === 'arbitrary-px-rem')).toBe(true)
    expect(
      scanFile(join(fxDir, 'bad-palette.tsx')).some((v) => v.rule === 'default-tailwind-palette'),
    ).toBe(true)
    expect(scanFile(join(fxDir, 'bad-opacity.tsx')).some((v) => v.rule === 'disabled-opacity')).toBe(
      true,
    )
  })
})
