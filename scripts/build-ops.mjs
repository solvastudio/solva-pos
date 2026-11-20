import { builtinModules } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, out)
    } else if (/\.(m?js|cjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope && name ? `${scope}/${name}` : specifier
  }
  return specifier.split('/')[0]
}

export function verifyBundleImports(serverDir, pkgJson, rootDir = resolve('.')) {
  if (!existsSync(serverDir)) {
    return []
  }
  const prodDeps = new Set(Object.keys(pkgJson.dependencies ?? {}))
  const devDeps = new Set(Object.keys(pkgJson.devDependencies ?? {}))

  // Transitive runtime packages installed by `npm ci --omit=dev` appear in package-lock without `dev: true`.
  const lockPath = join(rootDir, 'package-lock.json')
  const runtimeLockDeps = new Set()
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    for (const [pkgPath, meta] of Object.entries(lock.packages ?? {})) {
      if (!pkgPath.includes('node_modules/') || meta.dev === true) continue
      const name = pkgPath.split('node_modules/').pop()
      if (name) runtimeLockDeps.add(name)
    }
  }

  const importRegex = /(?:import\s+[^'"]*?\s+from\s+|import\s*\(|createRequire[^)]*\)\s*|from\s+)['"]([^'"]+)['"]/g
  const offenders = []

  for (const file of walkFiles(serverDir)) {
    const content = readFileSync(file, 'utf8')
    let match
    while ((match = importRegex.exec(content)) !== null) {
      const spec = match[1]
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#') || BUILTINS.has(spec)) {
        continue
      }
      const pkgName = packageNameFromSpecifier(spec)
      if (!prodDeps.has(pkgName) && !runtimeLockDeps.has(pkgName)) {
        offenders.push({
          file,
          pkgName,
          inDevDeps: devDeps.has(pkgName),
        })
      }
    }
  }
  return offenders
}

export async function buildOpsBundles(rootDir = resolve('.')) {
  const outDir = join(rootDir, 'dist', 'ops')
  mkdirSync(outDir, { recursive: true })

  const targets = [
    { entry: join(rootDir, 'scripts', 'db-migrate.ts'), outfile: join(outDir, 'db-migrate.mjs') },
    { entry: join(rootDir, 'scripts', 'ops', 'serve.mjs'), outfile: join(outDir, 'serve.mjs') },
    { entry: join(rootDir, 'scripts', 'ops', 'health-check.mjs'), outfile: join(outDir, 'health-check.mjs') },
    { entry: join(rootDir, 'scripts', 'ops', 'backup-dump.mjs'), outfile: join(outDir, 'backup-dump.mjs') },
    { entry: join(rootDir, 'scripts', 'ops', 'deploy.mjs'), outfile: join(outDir, 'deploy.mjs') },
    { entry: join(rootDir, 'scripts', 'ops', 'release-register.mjs'), outfile: join(outDir, 'release-register.mjs') },
  ]

  for (const target of targets) {
    await build({
      entryPoints: [target.entry],
      outfile: target.outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['pg', 'drizzle-orm'],
    })
  }

  const pkgJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  const offenders = verifyBundleImports(join(rootDir, 'dist', 'server'), pkgJson, rootDir)
  if (offenders.length > 0) {
    const summary = offenders.map((o) => `${o.pkgName} (${o.file})`).join(', ')
    throw new Error(`Production server imports packages missing from dependencies: ${summary}`)
  }
}

const isEntrypoint = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  buildOpsBundles()
    .then(() => {
      process.stdout.write('Built ops bundles in dist/ops\n')
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
