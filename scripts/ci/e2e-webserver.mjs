import { spawn, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

const setupCode =
  spawnSync(
    process.execPath,
    [join(root, 'scripts', 'local.mjs'), 'tsx', join(root, 'tests', 'e2e', 'global-setup.ts')],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    },
  ).status ?? 1

if (setupCode !== 0) {
  process.exit(setupCode)
}

const server = spawn(process.execPath, [join(root, 'dist', 'ops', 'serve.mjs')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.kill(sig))
}

server.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
