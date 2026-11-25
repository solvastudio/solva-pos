import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const POS_INITIAL_GZIP_LIMIT_BYTES = 350 * 1000
export const TOTAL_PRECACHE_LIMIT_BYTES = Math.floor(2.5 * 1024 * 1024)

export const FORBIDDEN_POS_MARKERS = [
  'drizzle-orm',
  'node-postgres',
  'better-auth/server',
  'pino-roll',
  '@jridgewell/trace-mapping',
  'qrcode',
  'BETTER_AUTH_SECRET',
  'DATABASE_URL',
  'TELEGRAM_BOT_TOKEN',
]

export const FORBIDDEN_ADMIN_CHUNK_PATTERNS = [
  /(?:^|\/)admin(?:[-/.]|$)/i,
  /recharts/i,
  /DataTable/i,
  /src\/components\/admin/i,
  /src\/routes\/\$tenant\/admin/i,
]

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function isPosRootOrEntryKey(key, entry, dynamicTargets) {
  if (entry.isEntry) return true
  const normalized = key.replace(/\\/g, '/')
  if (
    normalized === 'src/styles/app.css' ||
    normalized.endsWith('/src/styles/app.css') ||
    normalized.includes('routes/__root') ||
    normalized.includes('routes/$tenant.tsx') ||
    normalized.includes('routes/$tenant/pos')
  ) {
    return true
  }
  if (entry.isDynamicEntry || dynamicTargets.has(key)) {
    return false
  }
  return normalized.startsWith('src/pos/') || normalized.startsWith('src/pwa/')
}

function isPosDynamicOwnerKey(key) {
  const normalized = key.replace(/\\/g, '/')
  return (
    normalized.includes('$tenant/pos') ||
    normalized.startsWith('src/pos/') ||
    normalized.startsWith('src/pwa/')
  )
}

function collectPosGraph(manifest) {
  const dynamicTargets = new Set()
  for (const entry of Object.values(manifest)) {
    for (const dyn of entry?.dynamicImports ?? []) {
      dynamicTargets.add(dyn)
    }
  }

  const initialQueue = []
  for (const [key, entry] of Object.entries(manifest)) {
    if (isPosRootOrEntryKey(key, entry, dynamicTargets)) {
      initialQueue.push(key)
    }
  }

  const initialKeys = new Set()
  const initialFiles = new Set()
  const initialCssFiles = new Set()
  const lazyQueue = []

  // 1. Static initial POS graph (never traverses dynamicImports so lazy code-splits stay excluded).
  while (initialQueue.length > 0) {
    const key = initialQueue.shift()
    if (!key || initialKeys.has(key)) continue
    initialKeys.add(key)

    const entry = manifest[key]
    if (!entry) continue

    if (entry.file) {
      if (entry.file.endsWith('.css')) {
        initialCssFiles.add(entry.file)
      } else {
        initialFiles.add(entry.file)
      }
    }
    for (const css of entry.css ?? []) {
      initialCssFiles.add(css)
    }
    for (const imp of entry.imports ?? []) {
      if (!initialKeys.has(imp)) {
        initialQueue.push(imp)
      }
    }
    if (isPosDynamicOwnerKey(key)) {
      for (const dyn of entry.dynamicImports ?? []) {
        lazyQueue.push(dyn)
      }
    }
  }

  // 2. Reachable lazy POS chunks (scanned for forbidden markers/leaks, reported separately).
  const lazyKeys = new Set()
  const lazyFiles = new Set()
  const lazyCssFiles = new Set()

  while (lazyQueue.length > 0) {
    const key = lazyQueue.shift()
    if (!key || initialKeys.has(key) || lazyKeys.has(key)) continue
    lazyKeys.add(key)

    const entry = manifest[key]
    if (!entry) continue

    if (entry.file) {
      if (entry.file.endsWith('.css')) {
        if (!initialCssFiles.has(entry.file)) lazyCssFiles.add(entry.file)
      } else if (!initialFiles.has(entry.file)) {
        lazyFiles.add(entry.file)
      }
    }
    for (const css of entry.css ?? []) {
      if (!initialCssFiles.has(css)) lazyCssFiles.add(css)
    }
    for (const imp of entry.imports ?? []) {
      if (!initialKeys.has(imp) && !lazyKeys.has(imp)) {
        lazyQueue.push(imp)
      }
    }
    for (const dyn of entry.dynamicImports ?? []) {
      if (!initialKeys.has(dyn) && !lazyKeys.has(dyn)) {
        lazyQueue.push(dyn)
      }
    }
  }

  return {
    visitedKeys: initialKeys,
    files: initialFiles,
    cssFiles: initialCssFiles,
    lazyKeys,
    lazyFiles,
    lazyCssFiles,
  }
}

export function getPosInitialAssetPaths(clientDir = resolve('dist/client')) {
  const manifestPath = join(clientDir, '.vite', 'manifest.json')
  if (!existsSync(manifestPath)) {
    return []
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const graph = collectPosGraph(manifest)
  return [...graph.files, ...graph.cssFiles].map((relFile) => join(clientDir, relFile))
}

const NON_POS_ROUTE_KEY_PATTERNS = [
  /routes\/\$tenant\/admin/,
  /routes\/platform/,
  /routes\/\$tenant\/join/,
  /routes\/\$tenant\/reset/,
  // Back-office dictionary, loaded on demand by admin/platform routes only.
  /src\/i18n\/admin-resources/,
]
const ROUTER_FANOUT_KEY_PATTERNS = [/routeTree\.gen/, /src\/router\./]

/**
 * Every JS/CSS file the POS may need offline: the static initial graph plus all lazy chunks reachable
 * from it. Unlike the strict initial-budget graph, lazy imports are followed from any POS-side module
 * (e.g. `src/components/pos/**`), but never through the router fan-out (`routeTree.gen`, `router`) nor
 * into admin/platform/join/reset route modules, so those stay out of the device precache.
 */
function collectPosPrecacheFiles(manifest) {
  const graph = collectPosGraph(manifest)
  const seen = new Set([...graph.visitedKeys, ...graph.lazyKeys])
  const queue = [...seen]
  const files = new Set([
    ...graph.files,
    ...graph.cssFiles,
    ...graph.lazyFiles,
    ...graph.lazyCssFiles,
  ])

  while (queue.length > 0) {
    const key = queue.shift()
    const entry = key ? manifest[key] : undefined
    if (!entry) continue
    if (ROUTER_FANOUT_KEY_PATTERNS.some((re) => re.test(key))) continue
    const next = [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]
    for (const target of next) {
      if (seen.has(target)) continue
      if (NON_POS_ROUTE_KEY_PATTERNS.some((re) => re.test(target))) continue
      const t = manifest[target]
      if (!t) continue
      seen.add(target)
      queue.push(target)
      if (t.file) files.add(t.file)
      for (const css of t.css ?? []) files.add(css)
    }
  }
  return files
}

/** Relative JS/CSS files listed in the Vite manifest that the POS never needs (admin-only chunks). */
export function getNonPosManifestFiles(clientDir = resolve('dist/client')) {
  const manifestPath = join(clientDir, '.vite', 'manifest.json')
  if (!existsSync(manifestPath)) {
    return new Set()
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const pos = collectPosPrecacheFiles(manifest)
  const all = new Set()
  for (const entry of Object.values(manifest)) {
    if (entry?.file) all.add(entry.file)
    for (const css of entry?.css ?? []) all.add(css)
  }
  return new Set([...all].filter((f) => /\.(m?js|css)$/.test(f) && !pos.has(f)))
}

/**
 * Workbox `manifestTransforms` entry: drops precache entries for chunks only the admin/platform
 * routes use. Evaluated at SW generation time, after the Vite client manifest has been written.
 */
export function createPosPrecacheTransform(clientDir = resolve('dist/client')) {
  return async (entries) => {
    const nonPos = getNonPosManifestFiles(clientDir)
    const manifest = entries.filter((e) => !nonPos.has(e.url.replace(/^\/+/, '')))
    return { manifest, warnings: [] }
  }
}

function extractPrecacheUrlsFromSw(swContent) {
  const urls = new Set()
  const urlRe = /(?:["']url["']|\burl)\s*:\s*["']([^"']+)["']/g
  let m
  while ((m = urlRe.exec(swContent)) !== null) {
    urls.add(m[1])
  }
  return [...urls]
}

export function checkBundleGuard(clientDir = resolve('dist/client')) {
  const violations = []
  if (!existsSync(clientDir)) {
    return {
      ok: false,
      violations: [`Client build directory not found: ${clientDir}`],
      summary: [],
      posInitialGzipBytes: 0,
      totalPrecacheBytes: 0,
    }
  }

  // 1. Check all public assets for .map files, sourceMappingURL leaks, and E2E hooks in non-E2E builds.
  const isE2eBuild = process.env.VITE_E2E === '1' || process.env.VITE_E2E === 'true'
  const allPublicFiles = walkFiles(clientDir)
  for (const filePath of allPublicFiles) {
    const rel = relative(clientDir, filePath).replace(/\\/g, '/')
    if (rel.endsWith('.map')) {
      violations.push(`Public source map file forbidden in dist/client: ${rel}`)
      continue
    }
    if (/\.(m?js|css|html)$/.test(rel)) {
      const content = readFileSync(filePath, 'utf8')
      if (content.includes('sourceMappingURL')) {
        violations.push(`sourceMappingURL comment forbidden in public asset: ${rel}`)
      }
      if (
        !isE2eBuild &&
        (content.includes('e2e-hooks') || content.includes('__solva_e2e_hooks_marker__'))
      ) {
        violations.push(`E2E test hooks marker forbidden in non-E2E build asset: ${rel}`)
      }
    }
  }

  // 2. Read Vite manifest and inspect POS initial graph.
  const manifestPath = join(clientDir, '.vite', 'manifest.json')
  if (!existsSync(manifestPath)) {
    violations.push(`Vite client manifest missing at ${manifestPath}`)
    return { ok: false, violations, summary: [], posInitialGzipBytes: 0, totalPrecacheBytes: 0 }
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const graph = collectPosGraph(manifest)

  for (const key of [...graph.visitedKeys, ...graph.lazyKeys]) {
    for (const pat of FORBIDDEN_ADMIN_CHUNK_PATTERNS) {
      if (pat.test(key)) {
        violations.push(`POS bundle graph must not depend on admin/chart chunk key: ${key}`)
      }
    }
  }

  function inspectAssetList(relFiles) {
    const entries = []
    let gzipBytesTotal = 0
    for (const relFile of relFiles) {
      for (const pat of FORBIDDEN_ADMIN_CHUNK_PATTERNS) {
        if (pat.test(relFile)) {
          violations.push(`POS bundle graph must not load admin/chart asset: ${relFile}`)
        }
      }

      const abs = join(clientDir, relFile)
      if (!existsSync(abs)) {
        violations.push(`Manifest referenced missing asset file: ${relFile}`)
        continue
      }
      const buf = readFileSync(abs)
      // Level 9 matches @size-limit/file so guard:bundle and `npm run size` report identical byte totals.
      const gzipBytes = gzipSync(buf, { level: 9 }).length
      gzipBytesTotal += gzipBytes
      entries.push({ file: relFile, rawBytes: buf.length, gzipBytes })

      const text = buf.toString('utf8')
      for (const marker of FORBIDDEN_POS_MARKERS) {
        if (text.includes(marker)) {
          violations.push(`Forbidden server/secret/heavy marker "${marker}" found in POS asset ${relFile}`)
        }
      }
    }
    return { entries, gzipBytesTotal }
  }

  const initialRes = inspectAssetList([...graph.files, ...graph.cssFiles])
  const lazyRes = inspectAssetList([...graph.lazyFiles, ...graph.lazyCssFiles])
  const summary = initialRes.entries
  const lazySummary = lazyRes.entries
  const posInitialGzipBytes = initialRes.gzipBytesTotal
  const posLazyGzipBytes = lazyRes.gzipBytesTotal

  if (posInitialGzipBytes > POS_INITIAL_GZIP_LIMIT_BYTES) {
    violations.push(
      `POS initial static JS+CSS gzip size (${posInitialGzipBytes} B) exceeds 350 kB (${POS_INITIAL_GZIP_LIMIT_BYTES} B)`,
    )
  }

  // 3. Check total SW precache raw size <= 2.5 MB and ensure no admin/platform chunks are precached.
  const swPath = join(clientDir, 'sw.js')
  let totalPrecacheBytes = 0
  if (!existsSync(swPath)) {
    violations.push('Service worker bundle dist/client/sw.js not found')
  } else {
    const swText = readFileSync(swPath, 'utf8')
    const precacheUrls = extractPrecacheUrlsFromSw(swText)
    const nonPosFiles = getNonPosManifestFiles(clientDir)
    for (const u of precacheUrls) {
      const cleanRel = u.replace(/^\/+/, '')
      if (nonPosFiles.has(cleanRel)) {
        violations.push(
          `Service worker precache must not include admin-only chunk (not reachable from POS graph): ${cleanRel}`,
        )
      }
      for (const pat of FORBIDDEN_ADMIN_CHUNK_PATTERNS) {
        if (pat.test(cleanRel)) {
          violations.push(`Service worker precache must not include admin/chart chunk: ${cleanRel}`)
        }
      }
      const abs = join(clientDir, cleanRel)
      if (existsSync(abs)) {
        totalPrecacheBytes += readFileSync(abs).length
      }
    }
    if (totalPrecacheBytes > TOTAL_PRECACHE_LIMIT_BYTES) {
      violations.push(
        `Total precache size (${totalPrecacheBytes} B) exceeds 2.5 MB (${TOTAL_PRECACHE_LIMIT_BYTES} B)`,
      )
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    summary,
    lazySummary,
    posInitialGzipBytes,
    posLazyGzipBytes,
    totalPrecacheBytes,
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isEntrypoint) {
  const clientDirArg = process.argv[2] ? resolve(process.argv[2]) : resolve('dist/client')
  const result = checkBundleGuard(clientDirArg)

  const formatRows = (rows) =>
    rows
      .map(
        (row) =>
          `  ${row.file.padEnd(48)} raw=${String(row.rawBytes).padStart(8)} B  gzip=${String(row.gzipBytes).padStart(7)} B`,
      )
      .join('\n')

  const lazySection =
    result.lazySummary && result.lazySummary.length > 0
      ? `[bundle-guard] POS lazy assets (excluded from initial budget):\n${formatRows(result.lazySummary)}\n` +
        `  TOTAL POS lazy gzip:    ${(result.posLazyGzipBytes / 1000).toFixed(2)} kB\n`
      : '[bundle-guard] POS lazy assets: (none)\n'

  process.stdout.write(
    `[bundle-guard] POS initial static assets:\n${formatRows(result.summary)}\n` +
      lazySection +
      `  TOTAL POS initial gzip: ${(result.posInitialGzipBytes / 1000).toFixed(2)} kB / ${(POS_INITIAL_GZIP_LIMIT_BYTES / 1000).toFixed(0)} kB (${result.posInitialGzipBytes} B)\n` +
      `  TOTAL SW precache raw:  ${(result.totalPrecacheBytes / 1024).toFixed(1)} KiB / ${(TOTAL_PRECACHE_LIMIT_BYTES / 1024).toFixed(0)} KiB\n`,
  )

  if (!result.ok) {
    process.stderr.write(`[bundle-guard] FAILED:\n- ${result.violations.join('\n- ')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('[bundle-guard] PASSED (0 violations)\n')
  }
}
