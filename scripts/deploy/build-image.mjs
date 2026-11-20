import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isStagingRcTag, parseReleaseTag } from '../lib/version-rules.mjs'

function defaultRun(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
}

function walkAllFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkAllFiles(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

export function harvestSourcemaps(outputDir, archiveDir) {
  const moved = []
  mkdirSync(archiveDir, { recursive: true })
  for (const file of walkAllFiles(outputDir)) {
    if (file.endsWith('.map')) {
      const rel = relative(outputDir, file)
      const dest = join(archiveDir, rel)
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(file, dest)
      rmSync(file)
      moved.push(rel)
    }
  }
  return moved
}

export function findSourceMapUrlLeaks(publicDir) {
  const leaks = []
  for (const file of walkAllFiles(publicDir)) {
    if (file.endsWith('.map')) {
      leaks.push(file)
      continue
    }
    if (/\.(m?js|css|html)$/.test(file)) {
      const text = readFileSync(file, 'utf8')
      if (text.includes('sourceMappingURL')) {
        leaks.push(file)
      }
    }
  }
  return leaks
}

/**
 * Validates clean git tag state, runs local release gate tests, builds & checks hidden sourcemaps,
 * and compiles the production Docker image tagged `solva-pos:<tag>`.
 */
export async function buildReleaseImage(options = {}) {
  const target = options.target ?? 'staging'
  const rootDir = resolve(options.rootDir ?? '.')
  const run = options.run ?? defaultRun
  const harvest = options.harvestSourcemaps ?? harvestSourcemaps
  const checkLeaks = options.findSourceMapUrlLeaks ?? findSourceMapUrlLeaks

  if (target !== 'staging' && target !== 'production') {
    throw new Error(`Invalid build target: ${target}`)
  }

  const dirty = String(run('git', ['status', '--porcelain'], { cwd: rootDir }) ?? '').trim()
  if (dirty.length > 0) {
    throw new Error('Working tree is dirty; commit or clean changes before building a release image')
  }

  const rawTags = String(run('git', ['tag', '--points-at', 'HEAD'], { cwd: rootDir }) ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (rawTags.length !== 1) {
    throw new Error(`HEAD must have exactly one git tag, found ${rawTags.length}`)
  }

  const tag = rawTags[0]
  if (!parseReleaseTag(tag)) {
    throw new Error(`Invalid SemVer release tag on HEAD: ${tag}`)
  }

  if (target === 'production' && isStagingRcTag(tag)) {
    throw new Error(`Pre-release rc tag "${tag}" cannot be built for production`)
  }

  // Local mandatory gate before Docker image creation
  run('npm', ['run', 'test:unit', '--', 'src/lib/kernel'], { cwd: rootDir })
  run('npm', ['run', 'test:db'], { cwd: rootDir })

  run('npm', ['run', 'build'], {
    cwd: rootDir,
    env: { ...process.env, APP_VERSION: tag },
  })
  run('npm', ['run', 'build:ops'], { cwd: rootDir })

  const distDir = join(rootDir, 'dist')
  const archiveDir = join(rootDir, 'dist-release', tag, 'sourcemaps')
  const archivedMaps = harvest(distDir, archiveDir)

  const leaks = checkLeaks(join(distDir, 'client'))
  if (leaks.length > 0) {
    throw new Error(`Source map leak detected in public assets: ${leaks.join(', ')}`)
  }

  const imageTag = `solva-pos:${tag}`
  run(
    'docker',
    ['build', '--build-arg', `APP_VERSION=${tag}`, '-t', imageTag, '.'],
    { cwd: rootDir },
  )

  return {
    tag,
    imageTag,
    target,
    archivedMaps,
  }
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

if (isEntrypoint) {
  const targetFlagIdx = process.argv.indexOf('--target')
  const target = targetFlagIdx !== -1 ? process.argv[targetFlagIdx + 1] : 'staging'
  buildReleaseImage({ target })
    .then((res) => {
      process.stdout.write(`Built ${res.imageTag} (sourcemaps archived: ${res.archivedMaps.length})\n`)
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
