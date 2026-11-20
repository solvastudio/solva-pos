import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const POS_INITIAL_GZIP_LIMIT_BYTES = 350 * 1024
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

function isPosRootOrEntryKey(key, entry) {
  if (entry.isEntry) return true
  const normalized = key.replace(/\\/g, '/')
  return (
    normalized.includes('routes/__root') ||
    normalized.includes('routes/$tenant.tsx') ||
    normalized.includes('routes/$tenant/pos') ||
    normalized.startsWith('src/pos/') ||
    normalized.startsWith('src/pwa/')
  )
}

function collectPosGraph(manifest) {
  const queue = []
  for (const [key, entry] of Object.entries(manifest)) {
    if (isPosRootOrEntryKey(key, entry)) {
      queue.push(key)
    }
  }

  const visitedKeys = new Set()
  const files = new Set()
  const cssFiles = new Set()

  while (queue.length > 0) {
    const key = queue.shift()
    if (!key || visitedKeys.has(key)) continue
    visitedKeys.add(key)

    const entry = manifest[key]
    if (!entry) continue

    if (entry.file) {
      files.add(entry.file)
    }
    for (const css of entry.css ?? []) {
      cssFiles.add(css)
    }
    for (const imp of entry.imports ?? []) {
      if (!visitedKeys.has(imp)) {
        queue.push(imp)
      }
    }
    // Check dynamic imports ONLY when they come directly from POS/PWA modules,
    // never traversing lazy unrelated sibling routes referenced in router manifest.
    if (key.includes('$tenant/pos') || key.startsWith('src/pos/') || key.startsWith('src/pwa/')) {
      for (const dyn of entry.dynamicImports ?? []) {
        if (!visitedKeys.has(dyn)) {
          queue.push(dyn)
        }
      }
    }
  }

  return { visitedKeys, files, cssFiles }
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

  for (const key of graph.visitedKeys) {
    for (const pat of FORBIDDEN_ADMIN_CHUNK_PATTERNS) {
      if (pat.test(key)) {
        violations.push(`POS bundle graph must not depend on admin/chart chunk key: ${key}`)
      }
    }
  }

  const summary = []
  let posInitialGzipBytes = 0

  for (const relFile of [...graph.files, ...graph.cssFiles]) {
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
    const gzipBytes = gzipSync(buf).length
    posInitialGzipBytes += gzipBytes
    summary.push({ file: relFile, rawBytes: buf.length, gzipBytes })

    const text = buf.toString('utf8')
    for (const marker of FORBIDDEN_POS_MARKERS) {
      if (text.includes(marker)) {
        violations.push(`Forbidden server/secret/heavy marker "${marker}" found in POS asset ${relFile}`)
      }
    }
  }

  if (posInitialGzipBytes > POS_INITIAL_GZIP_LIMIT_BYTES) {
    violations.push(
      `POS initial JS+CSS gzip size (${posInitialGzipBytes} B) exceeds 350 KB (${POS_INITIAL_GZIP_LIMIT_BYTES} B)`,
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
    for (const u of precacheUrls) {
      const cleanRel = u.replace(/^\/+/, '')
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
    posInitialGzipBytes,
    totalPrecacheBytes,
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isEntrypoint) {
  const clientDirArg = process.argv[2] ? resolve(process.argv[2]) : resolve('dist/client')
  const result = checkBundleGuard(clientDirArg)

  const table = result.summary
    .map((row) => `  ${row.file.padEnd(48)} raw=${String(row.rawBytes).padStart(8)} B  gzip=${String(row.gzipBytes).padStart(7)} B`)
    .join('\n')

  process.stdout.write(
    `[bundle-guard] POS initial assets:\n${table}\n` +
      `  TOTAL POS initial gzip: ${(result.posInitialGzipBytes / 1024).toFixed(1)} KB / ${(POS_INITIAL_GZIP_LIMIT_BYTES / 1024).toFixed(0)} KB\n` +
      `  TOTAL SW precache raw:  ${(result.totalPrecacheBytes / 1024).toFixed(1)} KB / ${(TOTAL_PRECACHE_LIMIT_BYTES / 1024).toFixed(0)} KB\n`,
  )

  if (!result.ok) {
    process.stderr.write(`[bundle-guard] FAILED:\n- ${result.violations.join('\n- ')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('[bundle-guard] PASSED (0 violations)\n')
  }
}
