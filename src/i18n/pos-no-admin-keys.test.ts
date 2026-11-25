import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The `admin` and `platform` namespaces are loaded on demand (`ensureAdminI18n`) and are NOT part of
 * the dictionary the offline POS ships with. POS-side code that reads those keys would render raw key
 * strings, so it must use `pos.*` / shared keys instead.
 */
const ROOT = join(process.cwd(), 'src')
const POS_SIDE_DIRS = ['pos', 'components/pos', 'components/ui', 'hooks', 'routes/$tenant/pos']
const POS_SIDE_FILES = [
  'components/layout/PosShell.tsx',
  'components/layout/SyncIndicator.tsx',
  'components/layout/Banners.tsx',
  'components/layout/RecoveryScreen.tsx',
  'components/layout/ErrorBoundaryArea.tsx',
  'components/layout/LangToggle.tsx',
]
const ADMIN_KEY = /['"`](admin|platform)\.[A-Za-z]/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('POS-side code does not read back-office translation keys', () => {
  it('uses no admin.* or platform.* keys', () => {
    const files = [
      ...POS_SIDE_DIRS.flatMap((d) => walk(join(ROOT, d))),
      ...POS_SIDE_FILES.map((f) => join(ROOT, f)),
    ]
    const offenders = files
      .filter((f) => ADMIN_KEY.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split('\\').join('/'))
    expect(offenders).toEqual([])
  })
})
