import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const MODULES_DIR = join(ROOT, 'src/modules')

/**
 * Symbols business modules may take from `~/modules/sync/public`.
 * Growing this list widens the dependency of every business module on sync internals;
 * it needs an architecture decision, not a drive-by edit.
 */
const ALLOWED_SYNC_SYMBOLS: ReadonlySet<string> = new Set([
  'writeMaster',
  'MasterWriter',
  'CommandContext',
  'CommandRejected',
  'CommandHandler',
  'createDataFlag',
  'buildFeedSource',
  'omitWireColumns',
  'FeedSource',
  'publishBillsChanged',
  'createAttentionItem',
  'executeOnlineCommand',
  'SyncDeviceIdentity',
  'resolveStockMinusFlags',
])

const SYNC_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'~\/modules\/sync\/public'/g

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function findSyncSurfaceViolations(files: readonly string[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/')
    if (rel.startsWith('src/modules/sync/')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(SYNC_IMPORT_RE)) {
      const names = match[1]!
        .split(',')
        .map((n) => n.trim().replace(/^type\s+/, ''))
        .filter(Boolean)
      for (const name of names) {
        if (!ALLOWED_SYNC_SYMBOLS.has(name)) violations.push(`${rel}: ${name}`)
      }
    }
  }
  return violations
}

describe('sync public surface used by business modules', () => {
  it('only takes allow-listed symbols from ~/modules/sync/public', () => {
    expect(findSyncSurfaceViolations(listSourceFiles(MODULES_DIR))).toEqual([])
  })

  it('flags a symbol outside the allow-list', () => {
    // The detector itself: an unknown symbol must be reported.
    const sample = "import { writeMaster, somethingNew } from '~/modules/sync/public'"
    const names = [...sample.matchAll(SYNC_IMPORT_RE)][0]![1]!
      .split(',')
      .map((n) => n.trim())
    expect(names.filter((n) => !ALLOWED_SYNC_SYMBOLS.has(n))).toEqual(['somethingNew'])
  })
})
