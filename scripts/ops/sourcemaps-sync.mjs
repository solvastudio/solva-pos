import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const DEFAULT_RETENTION_DAYS = 90

function walkMapFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkMapFiles(full, out)
    } else if (entry.name.endsWith('.map')) {
      out.push(full)
    }
  }
  return out
}

function newestMtimeMs(dir) {
  let latest = statSync(dir).mtimeMs
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const st = statSync(full)
    if (st.isDirectory()) {
      const nested = newestMtimeMs(full)
      if (nested > latest) latest = nested
    } else if (st.mtimeMs > latest) {
      latest = st.mtimeMs
    }
  }
  return latest
}

/**
 * Copies release `.map` files into `<sourcemapDir>/<version>/` and prunes old version
 * folders that are NOT reported by any active device and older than 90 days.
 */
export function syncSourcemaps({
  releaseDir,
  sourcemapDir,
  version,
  reportedVersions = [],
  nowMs = Date.now(),
  retentionDays = DEFAULT_RETENTION_DAYS,
}) {
  if (!version || /[\\/]|\.\./.test(version)) {
    throw new Error(`Invalid version directory name: ${version}`)
  }

  const destVersionDir = join(sourcemapDir, version)
  mkdirSync(destVersionDir, { recursive: true })

  let copied = 0
  for (const srcFile of walkMapFiles(releaseDir)) {
    const rel = relative(releaseDir, srcFile)
    const destFile = join(destVersionDir, rel)
    mkdirSync(join(destFile, '..'), { recursive: true })
    cpSync(srcFile, destFile)
    copied += 1
  }

  const keepSet = new Set([version, ...reportedVersions])
  const cutoffMs = nowMs - retentionDays * 86_400_000
  const pruned = []

  if (existsSync(sourcemapDir)) {
    for (const entry of readdirSync(sourcemapDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (keepSet.has(entry.name)) continue
      const fullDir = join(sourcemapDir, entry.name)
      const mtime = newestMtimeMs(fullDir)
      if (mtime < cutoffMs) {
        rmSync(fullDir, { recursive: true, force: true })
        pruned.push(entry.name)
      }
    }
  }

  return { copied, pruned }
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

if (isEntrypoint) {
  const { values } = parseArgs({
    options: {
      'release-dir': { type: 'string' },
      version: { type: 'string' },
      'sourcemap-dir': { type: 'string' },
      'reported-versions': { type: 'string', default: '' },
      now: { type: 'string' },
    },
  })

  if (!values['release-dir'] || !values.version) {
    process.stderr.write('Usage: sourcemaps-sync.mjs --release-dir <dir> --version <tag> [--sourcemap-dir <dir>] [--reported-versions v1,v2]\n')
    process.exitCode = 1
  } else {
    const reported = values['reported-versions']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const nowMs = values.now ? Date.parse(values.now) : Date.now()
    const res = syncSourcemaps({
      releaseDir: resolve(values['release-dir']),
      sourcemapDir: resolve(values['sourcemap-dir'] ?? (process.env.SOURCEMAP_DIR || './sourcemaps')),
      version: values.version,
      reportedVersions: reported,
      nowMs,
    })
    process.stdout.write(`Synced ${res.copied} sourcemaps for ${values.version}; pruned: ${res.pruned.length}\n`)
  }
}
