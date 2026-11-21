import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkBundleGuard,
  createPosPrecacheTransform,
  getNonPosManifestFiles,
} from './bundle-guard.mjs'

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

describe('scripts/ci/bundle-guard precache filtering', () => {
  const manifest = {
    'src/routes/$tenant/pos.tsx': {
      file: 'assets/index-abc.js',
      css: ['assets/app-abc.css'],
      isEntry: true,
      imports: ['_shared-abc.js', 'src/components/pos/Scanner.tsx'],
    },
    '_shared-abc.js': { file: 'assets/shared-abc.js' },
    // Lazy chunk imported dynamically from a POS component (not an owner module): must stay.
    'src/components/pos/Scanner.tsx': {
      file: 'assets/scanner-abc.js',
      dynamicImports: ['src/components/pos/scan-wasm.ts'],
    },
    'src/components/pos/scan-wasm.ts': { file: 'assets/scan-wasm-abc.js' },
    // Router fan-out: lazily references every route, including admin. Must not be followed.
    'src/routeTree.gen.ts': {
      file: 'assets/route-tree-abc.js',
      dynamicImports: ['src/routes/$tenant/admin/_authed/users.tsx?tsr-split=component'],
    },
    // Admin route chunk named by component (users-*.js), invisible to the old name globs.
    'src/routes/$tenant/admin/_authed/users.tsx?tsr-split=component': {
      file: 'assets/users-xyz.js',
      imports: ['_admin-only-abc.js', '_shared-abc.js'],
    },
    '_admin-only-abc.js': { file: 'assets/admin-only-abc.js' },
  }

  function fixture(extraSwUrls = []) {
    const dir = mkdtempSync(join(tmpdir(), 'solva-bundle-guard-pc-'))
    mkdirSync(join(dir, '.vite'), { recursive: true })
    mkdirSync(join(dir, 'assets'), { recursive: true })
    for (const f of [
      'index-abc',
      'shared-abc',
      'scanner-abc',
      'scan-wasm-abc',
      'route-tree-abc',
      'users-xyz',
      'admin-only-abc',
    ]) {
      writeFileSync(join(dir, 'assets', `${f}.js`), `export const x="${f}";`, 'utf8')
    }
    writeFileSync(join(dir, 'assets', 'app-abc.css'), 'body{color:black;}', 'utf8')
    writeFileSync(join(dir, 'pos-shell.html'), '<!doctype html><html></html>', 'utf8')
    const urls = ['pos-shell.html', 'assets/index-abc.js', 'assets/scan-wasm-abc.js', ...extraSwUrls]
    writeFileSync(
      join(dir, 'sw.js'),
      `self.__WB_MANIFEST=[${urls.map((u) => `{url:"${u}",revision:"1"}`).join(',')}];`,
      'utf8',
    )
    writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest), 'utf8')
    return dir
  }

  it('classifies chunks only reachable from admin routes as non-POS, keeping shared and POS-lazy chunks', () => {
    const dir = fixture()
    try {
      const nonPos = getNonPosManifestFiles(dir)
      expect([...nonPos].sort()).toEqual(
        ['assets/admin-only-abc.js', 'assets/route-tree-abc.js', 'assets/users-xyz.js'].sort(),
      )
      expect(nonPos.has('assets/shared-abc.js')).toBe(false)
      expect(nonPos.has('assets/scan-wasm-abc.js')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('transform drops admin-only precache entries and keeps everything else (html, fonts, POS chunks)', async () => {
    const dir = fixture()
    try {
      const transform = createPosPrecacheTransform(dir)
      const entries = [
        { url: 'pos-shell.html', revision: '1', size: 10 },
        { url: 'assets/index-abc.js', revision: null, size: 10 },
        { url: 'assets/users-xyz.js', revision: null, size: 10 },
        { url: 'assets/admin-only-abc.js', revision: null, size: 10 },
        { url: 'assets/font-abc.woff2', revision: null, size: 10 },
      ]
      const res = await transform(entries)
      expect(res.manifest.map((e) => e.url)).toEqual([
        'pos-shell.html',
        'assets/index-abc.js',
        'assets/font-abc.woff2',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails the guard when the service worker precaches an admin-only chunk with a non-admin file name', () => {
    const clean = fixture()
    const dirty = fixture(['assets/users-xyz.js'])
    try {
      expect(checkBundleGuard(clean).violations.filter((v) => v.includes('admin-only'))).toEqual([])
      const res = checkBundleGuard(dirty)
      expect(res.ok).toBe(false)
      expect(res.violations.some((v) => v.includes('assets/users-xyz.js'))).toBe(true)
    } finally {
      rmSync(clean, { recursive: true, force: true })
      rmSync(dirty, { recursive: true, force: true })
    }
  })
})
