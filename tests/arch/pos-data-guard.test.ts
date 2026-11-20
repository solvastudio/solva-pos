import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MASTER_STORE_NAMES, STORES_V1 } from '../../src/pos/db/schema-v1'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC_DIR = join(ROOT, 'src')
const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures-pos')

const MASTER_SET = new Set<string>(MASTER_STORE_NAMES)
const ALL_STORE_NAMES = Object.keys(STORES_V1)

const WRITE_METHOD_NAMES =
  'put|bulkPut|add|bulkAdd|update|delete|bulkDelete|clear|modify'

const MASTER_PROP_WRITE_RE = new RegExp(
  `\\.(${MASTER_STORE_NAMES.join('|')})\\s*\\.\\s*(?:${WRITE_METHOD_NAMES})\\s*\\(`,
  'g',
)

const MASTER_TABLE_WRITE_RE = new RegExp(
  `\\.table\\s*(?:<[^>]+>)?\\s*\\(\\s*['"](${MASTER_STORE_NAMES.join('|')})['"]\\s*\\)\\s*\\.\\s*(?:${WRITE_METHOD_NAMES})\\s*\\(`,
  'g',
)

const DIRECT_STORE_ACCESS_RE = new RegExp(
  `\\bdb\\s*\\.\\s*(${ALL_STORE_NAMES.join('|')})\\b`,
  'g',
)

const NEW_DEXIE_RE = /\bnew\s+Dexie\s*\(/g
const DEXIE_IMPORT_RE = /\bfrom\s+['"]dexie(?:\/[^'"]*)?['"]/g
const APPLY_MASTER_IMPORT_RE = /\bapplyMasterRows\b/g

export interface PosDataViolation {
  file: string
  rule: 'master-write' | 'applier-import' | 'direct-dexie'
  detail: string
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(?:ts|tsx)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

export function scanPosDataContent(relPath: string, content: string): PosDataViolation[] {
  const norm = relPath.replace(/\\/g, '/')
  const violations: PosDataViolation[] = []
  const isDbOrData = norm.startsWith('src/pos/db/') || norm.startsWith('src/pos/data/')
  const isMasterRepo = norm === 'src/pos/data/master.repo.ts'
  const isSyncApplier = norm === 'src/pos/sync/applier.ts'

  if (!isMasterRepo) {
    let m: RegExpExecArray | null
    MASTER_PROP_WRITE_RE.lastIndex = 0
    while ((m = MASTER_PROP_WRITE_RE.exec(content)) !== null) {
      if (MASTER_SET.has(m[1]!)) {
        violations.push({ file: norm, rule: 'master-write', detail: m[0] })
      }
    }
    MASTER_TABLE_WRITE_RE.lastIndex = 0
    while ((m = MASTER_TABLE_WRITE_RE.exec(content)) !== null) {
      if (MASTER_SET.has(m[1]!)) {
        violations.push({ file: norm, rule: 'master-write', detail: m[0] })
      }
    }
  }

  if (!isMasterRepo && !isSyncApplier) {
    if (APPLY_MASTER_IMPORT_RE.test(content)) {
      violations.push({
        file: norm,
        rule: 'applier-import',
        detail: 'applyMasterRows may only be imported by src/pos/sync/applier.ts',
      })
    }
    APPLY_MASTER_IMPORT_RE.lastIndex = 0
  }

  if (!isDbOrData) {
    if (NEW_DEXIE_RE.test(content)) {
      violations.push({ file: norm, rule: 'direct-dexie', detail: 'new Dexie(' })
    }
    NEW_DEXIE_RE.lastIndex = 0

    if (DEXIE_IMPORT_RE.test(content)) {
      violations.push({ file: norm, rule: 'direct-dexie', detail: 'import from dexie' })
    }
    DEXIE_IMPORT_RE.lastIndex = 0

    let dm: RegExpExecArray | null
    DIRECT_STORE_ACCESS_RE.lastIndex = 0
    while ((dm = DIRECT_STORE_ACCESS_RE.exec(content)) !== null) {
      violations.push({ file: norm, rule: 'direct-dexie', detail: dm[0] })
    }
  }

  return violations
}

describe('arch/pos-data-guard (AD-13, ARCH §8.5)', () => {
  it('enforces Dexie, master-store write, and applyMasterRows boundaries across src/', () => {
    const files = collectSourceFiles(SRC_DIR)
    const violations = files.flatMap((file) => {
      const rel = relative(ROOT, file)
      return scanPosDataContent(rel, readFileSync(file, 'utf8'))
    })
    expect(violations).toEqual([])
  })

  it('detects fixture violations for master writes, applyMasterRows misuse, and direct Dexie access', () => {
    const masterWrite = scanPosDataContent(
      'src/pos/data/sale.repo.ts',
      readFileSync(join(FIXTURES_DIR, 'bad-master-write.ts'), 'utf8'),
    )
    expect(masterWrite.some((v) => v.rule === 'master-write')).toBe(true)

    const badApplier = scanPosDataContent(
      'src/pos/ui/Checkout.tsx',
      readFileSync(join(FIXTURES_DIR, 'bad-applier-import.ts'), 'utf8'),
    )
    expect(badApplier.some((v) => v.rule === 'applier-import')).toBe(true)

    const badDirect = scanPosDataContent(
      'src/pos/cart/useCart.ts',
      readFileSync(join(FIXTURES_DIR, 'bad-direct-dexie.ts'), 'utf8'),
    )
    expect(badDirect.some((v) => v.rule === 'direct-dexie')).toBe(true)

    const clean = scanPosDataContent(
      'src/pos/data/sale.repo.ts',
      readFileSync(join(FIXTURES_DIR, 'clean-repo.ts'), 'utf8'),
    )
    expect(clean).toEqual([])
  })
})
