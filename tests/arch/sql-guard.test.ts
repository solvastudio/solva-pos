import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

export interface SqlGuardViolation {
  file: string
  rule: 'no-select-star' | 'no-offset-in-feed' | 'no-raw-db-in-repo' | 'master-write-without-writer'
  detail: string
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectTsFiles(full, out)
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function findSchemaFiles(baseDir: string): string[] {
  const modulesDir = join(baseDir, 'src', 'modules')
  if (!existsSync(modulesDir)) return []
  const files: string[] = []
  for (const mod of readdirSync(modulesDir)) {
    const schemaPath = join(modulesDir, mod, 'server', 'schema.ts')
    if (existsSync(schemaPath)) {
      files.push(schemaPath)
    }
  }
  return files
}

async function discoverClassMTables(baseDir: string): Promise<Set<string>> {
  const names = new Set<string>()
  const schemaFiles = findSchemaFiles(baseDir)
  for (const schemaPath of schemaFiles) {
    const mod = (await import(schemaPath)) as Record<string, unknown>
    for (const [exportName, value] of Object.entries(mod)) {
      if (is(value, PgTable)) {
        const cfg = getTableConfig(value)
        const hasVersion = cfg.columns.some((col) => col.name === 'version')
        if (hasVersion && cfg.name !== 'tenant' && cfg.name !== 'tenant_sync') {
          names.add(exportName)
          names.add(cfg.name)
        }
      }
    }
  }
  return names
}

function splitExportedFunctions(source: string): Array<{ name: string; params: string; body: string }> {
  const results: Array<{ name: string; params: string; body: string }> = []
  const fnHeaderRegex = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g
  let match: RegExpExecArray | null

  while ((match = fnHeaderRegex.exec(source)) !== null) {
    const name = match[1]!
    let idx = match.index + match[0].length
    let parenDepth = 1
    while (idx < source.length && parenDepth > 0) {
      const ch = source[idx]
      if (ch === '(') parenDepth += 1
      else if (ch === ')') parenDepth -= 1
      idx += 1
    }
    const params = source.slice(match.index + match[0].length, idx - 1)
    const bodyStart = source.indexOf('{', idx)
    if (bodyStart === -1) continue

    let braceDepth = 1
    let bodyIdx = bodyStart + 1
    while (bodyIdx < source.length && braceDepth > 0) {
      const ch = source[bodyIdx]
      if (ch === '{') braceDepth += 1
      else if (ch === '}') braceDepth -= 1
      bodyIdx += 1
    }
    const body = source.slice(bodyStart, bodyIdx)
    results.push({ name, params, body })
  }

  return results
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function scanSqlGuardDirectory(
  baseDir: string,
  classMTables: ReadonlySet<string>,
): SqlGuardViolation[] {
  const violations: SqlGuardViolation[] = []

  const serverFiles = collectTsFiles(join(baseDir, 'src', 'server'))
  const moduleFiles: string[] = []
  const modulesDir = join(baseDir, 'src', 'modules')
  if (existsSync(modulesDir)) {
    for (const mod of readdirSync(modulesDir)) {
      const modServer = join(modulesDir, mod, 'server')
      for (const file of collectTsFiles(modServer)) {
        if (
          file.endsWith('.repo.ts') ||
          file.endsWith('.service.ts') ||
          /[\\/]feed[^\\/]*\.ts$/.test(file)
        ) {
          moduleFiles.push(file)
        }
      }
    }
  }

  const allTargets = [...serverFiles, ...moduleFiles]
  const tableAlternation = [...classMTables].map(escapeRegExp).join('|')
  const writePattern =
    classMTables.size > 0
      ? new RegExp(`\\.(?:insert|update)\\(\\s*(?:${tableAlternation})\\s*\\)`)
      : null

  for (const file of allTargets) {
    const rel = relative(baseDir, file).replace(/\\/g, '/')
    const source = readFileSync(file, 'utf8')

    // 1. Disallow SELECT * in SQL literals
    const sqlSelectStar = /[`'"][^`'"]*\bSELECT\s+\*(?:\s|,|FROM\b)/i
    if (sqlSelectStar.test(source)) {
      violations.push({
        file: rel,
        rule: 'no-select-star',
        detail: 'SELECT * is forbidden in server SQL queries',
      })
    }

    // 2. Disallow OFFSET / .offset( in feed*.ts files
    if (/\/feed[^/]*\.ts$/.test(rel) && (/\.offset\s*\(/.test(source) || /\bOFFSET\b/i.test(source))) {
      violations.push({
        file: rel,
        rule: 'no-offset-in-feed',
        detail: 'OFFSET pagination is forbidden in feed files; use keyset cursor',
      })
    }

    // 3. Disallow raw getDb / db imports inside *.repo.ts
    if (rel.endsWith('.repo.ts')) {
      const rawDbImport = /import\s*\{[^}]*\b(?:getDb|db)\b[^}]*\}\s*from\s*['"][^'"]*server\/db[^'"]*['"]/
      if (rawDbImport.test(source)) {
        violations.push({
          file: rel,
          rule: 'no-raw-db-in-repo',
          detail: 'Repository files must accept TenantTx instead of importing raw getDb/db',
        })
      }
    }

    // 4. Class M table writes in exported functions must require MasterWriter parameter
    if (writePattern) {
      for (const fn of splitExportedFunctions(source)) {
        if (writePattern.test(fn.body) && !/\bMasterWriter\b/.test(fn.params)) {
          violations.push({
            file: rel,
            rule: 'master-write-without-writer',
            detail: `Exported function "${fn.name}" writes to a Class M table without MasterWriter`,
          })
        }
      }
    }
  }

  return violations
}

describe('architecture SQL guardrails', () => {
  it('passes cleanly on the workspace src directory', async () => {
    const classMTables = await discoverClassMTables(ROOT)
    expect(classMTables.has('outlet')).toBe(true)
    expect(classMTables.has('paymentMethod')).toBe(true)

    const violations = scanSqlGuardDirectory(ROOT, classMTables)
    expect(violations).toEqual([])
  })

  it('detects all forbidden SQL and MasterWriter fixture violations', async () => {
    const classMTables = await discoverClassMTables(ROOT)
    const fixturesDir = resolve(ROOT, 'tests/arch/fixtures-sql')
    const violations = scanSqlGuardDirectory(fixturesDir, classMTables)

    expect(violations.some((v) => v.rule === 'no-select-star')).toBe(true)
    expect(violations.some((v) => v.rule === 'no-offset-in-feed')).toBe(true)
    expect(violations.some((v) => v.rule === 'no-raw-db-in-repo')).toBe(true)
    expect(violations.some((v) => v.rule === 'master-write-without-writer')).toBe(true)
  })
})
