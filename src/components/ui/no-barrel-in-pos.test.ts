import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `~/components/ui` re-exports every primitive, including the Radix-backed ones (Dialog, Select,
 * Tabs, Tooltip, ...). Importing the barrel from code that ships in the initial POS graph keeps all of
 * Radix in the precached initial bundle (measured: ~40 kB gzip of the 350 kB budget). POS-path code
 * must import primitives from their own module, e.g. `~/components/ui/Button`.
 */
const ROOT = join(process.cwd(), 'src')
const POS_PATH_DIRS = ['components/layout', 'components/pos', 'routes/$tenant/pos']
const POS_PATH_FILES = ['routes/__root.tsx', 'routes/$tenant.tsx', 'routes/$tenant/index.tsx', 'routes/index.tsx']
const BARREL_IMPORT = /from\s+['"]~\/components\/ui['"]/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('POS initial graph does not import the UI barrel', () => {
  it('uses direct ~/components/ui/<Module> imports', () => {
    const files = [
      ...POS_PATH_DIRS.flatMap((d) => walk(join(ROOT, d))),
      ...POS_PATH_FILES.map((f) => join(ROOT, f)).filter((f) => {
        try {
          return statSync(f).isFile()
        } catch {
          return false
        }
      }),
    ]
    expect(files.length).toBeGreaterThan(10)

    const offenders = files
      .filter((f) => BARREL_IMPORT.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split('\\').join('/'))

    expect(offenders).toEqual([])
  })
})
