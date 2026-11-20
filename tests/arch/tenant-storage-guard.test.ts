import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC_DIR = join(ROOT, 'src')

const RAW_BROWSER_PATTERNS: Array<{ rule: string; re: RegExp }> = [
  { rule: 'raw-localStorage', re: /\blocalStorage\b/ },
  { rule: 'raw-sessionStorage', re: /\bsessionStorage\b/ },
  { rule: 'raw-BroadcastChannel', re: /\bnew\s+BroadcastChannel\s*\(/ },
  { rule: 'raw-navigator-locks', re: /\bnavigator\.locks\b/ },
]

function collectSrcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectSrcFiles(full, out)
    } else if (/\.(?:ts|tsx)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function stripAllowedBootWatchdogScript(normPath: string, content: string): string {
  if (normPath !== 'src/routes/__root.tsx') {
    return content
  }
  // Pre-hydration inline HTML watchdog runs before ES modules load; strip only that string literal.
  return content.replace(/const POS_BOOT_WATCHDOG_SCRIPT = `[\s\S]*?`/, '')
}

export function scanTenantStorageContent(
  relPath: string,
  rawContent: string,
): Array<{ file: string; line: number; rule: string }> {
  const norm = relPath.replace(/\\/g, '/')
  if (norm.startsWith('src/pos/locks/')) {
    return []
  }

  const content = stripAllowedBootWatchdogScript(norm, rawContent)
  const lines = content.split(/\r?\n/)
  const hits: Array<{ file: string; line: number; rule: string }> = []

  lines.forEach((line, idx) => {
    for (const { rule, re } of RAW_BROWSER_PATTERNS) {
      if (re.test(line)) {
        hits.push({ file: norm, line: idx + 1, rule })
      }
    }
  })

  return hits
}

describe('arch/tenant-storage-guard (DB-12 / tenant-scoped browser primitives)', () => {
  it('forbids raw localStorage, sessionStorage, BroadcastChannel, and navigator.locks outside src/pos/locks/**', () => {
    const files = collectSrcFiles(SRC_DIR)
    const violations = files.flatMap((file) => {
      const rel = relative(ROOT, file)
      return scanTenantStorageContent(rel, readFileSync(file, 'utf8'))
    })
    expect(violations).toEqual([])
  })

  it('catches direct raw API usage in sample code', () => {
    const sample = [
      'const x = localStorage.getItem("k")',
      'const y = sessionStorage.getItem("k")',
      'const c = new BroadcastChannel("raw")',
      'void navigator.locks.request("x", () => {})',
    ].join('\n')

    const hits = scanTenantStorageContent('src/routes/bad.ts', sample)
    expect(hits.map((h) => h.rule)).toEqual([
      'raw-localStorage',
      'raw-sessionStorage',
      'raw-BroadcastChannel',
      'raw-navigator-locks',
    ])
  })
})
