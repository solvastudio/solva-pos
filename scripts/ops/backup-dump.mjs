import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

function defaultRun(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export async function runBackupDump(options) {
  const databaseUrl = options.databaseUrl
  const outPath = options.outPath
  const run = options.run ?? defaultRun

  if (!databaseUrl) {
    throw new Error('DATABASE_OWNER_URL or databaseUrl is required for backup-dump')
  }
  if (!outPath) {
    throw new Error('outPath is required for backup-dump')
  }

  run('pg_dump', ['-Fc', '-f', outPath, databaseUrl])
  return { outPath }
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

if (isEntrypoint) {
  const databaseUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = process.argv[2] || `/tmp/solva-backup-${stamp}.dump`
  runBackupDump({ databaseUrl, outPath })
    .then((res) => {
      process.stdout.write(`Backup written to ${res.outPath}\n`)
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
