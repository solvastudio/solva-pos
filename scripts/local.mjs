import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envLocalPath = join(root, '.env.local')

if (existsSync(envLocalPath)) {
  const lines = readFileSync(envLocalPath, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

const [tool, ...toolArgs] = process.argv.slice(2)
if (!tool) {
  console.error('Usage: node scripts/local.mjs <tool> [arguments...]')
  process.exit(2)
}

function resolveBin(toolName) {
  const pkgPath = join(root, 'node_modules', toolName, 'package.json')
  if (existsSync(pkgPath)) {
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const binRel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[toolName]
    if (binRel) return join(root, 'node_modules', toolName, binRel)
  }
  return null
}

let child
if (tool === 'node') {
  child = spawn(process.execPath, toolArgs, { stdio: 'inherit', env: process.env })
} else {
  const binPath = resolveBin(tool)
  if (binPath) {
    child = spawn(process.execPath, [binPath, ...toolArgs], { stdio: 'inherit', env: process.env })
  } else {
    child = spawn(tool, toolArgs, {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    })
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(`Failed to start "${tool}": ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
