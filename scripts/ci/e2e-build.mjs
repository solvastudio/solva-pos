import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

function resolveBin(pkgName) {
  const pkgPath = join(root, 'node_modules', pkgName, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`Missing package ${pkgName} in node_modules`)
  }
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const binRel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[pkgName]
  if (!binRel) {
    throw new Error(`Unable to resolve binary for ${pkgName}`)
  }
  return join(root, 'node_modules', pkgName, binRel)
}

const env = {
  ...process.env,
  VITE_E2E: '1',
  APP_VERSION: process.env.APP_VERSION || 'v0.1.0-e2e',
}

process.stdout.write('[e2e:build] Building app with VITE_E2E=1...\n')
execFileSync(process.execPath, [resolveBin('vite'), 'build'], {
  cwd: root,
  env,
  stdio: 'inherit',
})

process.stdout.write('[e2e:build] Building ops server bundle...\n')
execFileSync(process.execPath, [join(root, 'scripts', 'build-ops.mjs')], {
  cwd: root,
  env,
  stdio: 'inherit',
})
