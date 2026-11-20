import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkBundleGuard } from './bundle-guard.mjs'

function createDistFixture(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'solva-bundle-guard-'))
  mkdirSync(join(dir, '.vite'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })

  writeFileSync(
    join(dir, 'assets', 'index-abc.js'),
    opts.posChunkCode ?? 'console.log("pos ready");',
    'utf8',
  )
  writeFileSync(join(dir, 'assets', 'app-abc.css'), 'body{color:black;}', 'utf8')
  writeFileSync(join(dir, 'pos-shell.html'), '<!doctype html><html></html>', 'utf8')
  writeFileSync(
    join(dir, 'sw.js'),
    opts.swCode ??
      'self.__WB_MANIFEST=[{url:"pos-shell.html",revision:"1"},{url:"assets/index-abc.js",revision:"1"}];',
    'utf8',
  )

  const manifest = opts.manifest ?? {
    'src/routes/$tenant/pos.tsx': {
      file: 'assets/index-abc.js',
      css: ['assets/app-abc.css'],
      isEntry: true,
    },
  }
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest), 'utf8')

  if (opts.extraMap) {
    writeFileSync(join(dir, 'assets', 'index-abc.js.map'), '{}', 'utf8')
  }

  return dir
}

describe('scripts/ci/bundle-guard', () => {
  it('passes on a clean dist/client fixture without forbidden markers, admin chunks, or sourcemaps', () => {
    const dir = createDistFixture()
    try {
      const res = checkBundleGuard(dir)
      expect(res.ok).toBe(true)
      expect(res.violations).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails when POS chunk contains server secret markers, admin chunks, or .map leaks', () => {
    const dirWithMarker = createDistFixture({ posChunkCode: 'const k="BETTER_AUTH_SECRET";' })
    const dirWithMap = createDistFixture({ extraMap: true })
    const dirWithAdminImport = createDistFixture({
      manifest: {
        'src/routes/$tenant/pos.tsx': {
          file: 'assets/index-abc.js',
          imports: ['src/routes/$tenant/admin.tsx'],
          isEntry: true,
        },
        'src/routes/$tenant/admin.tsx': {
          file: 'assets/admin-xyz.js',
        },
      },
    })
    const dirWithE2eMarker = createDistFixture({
      posChunkCode: 'const m="__solva_e2e_hooks_marker__";',
    })
    writeFileSync(join(dirWithAdminImport, 'assets', 'admin-xyz.js'), 'export const a=1;', 'utf8')

    try {
      expect(checkBundleGuard(dirWithMarker).ok).toBe(false)
      expect(checkBundleGuard(dirWithMap).ok).toBe(false)
      expect(checkBundleGuard(dirWithAdminImport).ok).toBe(false)
      expect(checkBundleGuard(dirWithE2eMarker).ok).toBe(false)
    } finally {
      rmSync(dirWithMarker, { recursive: true, force: true })
      rmSync(dirWithMap, { recursive: true, force: true })
      rmSync(dirWithAdminImport, { recursive: true, force: true })
      rmSync(dirWithE2eMarker, { recursive: true, force: true })
    }
  })

  it('excludes POS dynamicImports from initial budget while including app.css and still scanning lazy chunks', () => {
    const dir = createDistFixture({
      manifest: {
        'src/styles/app.css': {
          file: 'assets/app-abc.css',
        },
        'src/routes/$tenant/pos.tsx': {
          file: 'assets/index-abc.js',
          dynamicImports: ['src/pos/lazy-modal.ts'],
          isEntry: true,
        },
        'src/pos/lazy-modal.ts': {
          file: 'assets/lazy-modal.js',
        },
      },
    })
    writeFileSync(join(dir, 'assets', 'lazy-modal.js'), 'export const modal = "ok";'.repeat(50), 'utf8')

    try {
      const clean = checkBundleGuard(dir)
      expect(clean.ok).toBe(true)
      expect(clean.summary.some((s) => s.file === 'assets/app-abc.css')).toBe(true)
      expect(clean.summary.some((s) => s.file === 'assets/lazy-modal.js')).toBe(false)
      expect(clean.lazySummary.some((s) => s.file === 'assets/lazy-modal.js')).toBe(true)
      expect(clean.posLazyGzipBytes).toBeGreaterThan(0)

      writeFileSync(join(dir, 'assets', 'lazy-modal.js'), 'const secret = "BETTER_AUTH_SECRET";', 'utf8')
      const dirty = checkBundleGuard(dir)
      expect(dirty.ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
