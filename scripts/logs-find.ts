import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  SEARCH_LEVEL_RANK,
  searchLogDirectory,
  type LogSearchFilters,
} from '~/server/logging/log-search'
import { todayUtc } from '~/server/logging/log-time'

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      level: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      tenant: { type: 'string' },
      'path-prefix': { type: 'string' },
      dir: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    process.stdout.write(
      'Usage: npm run logs:find -- --ref <id> [--level warn] [--from ISO] [--to ISO] [--tenant id] [--path-prefix /api] [--dir ./logs]\n',
    )
    return 0
  }

  if (values.level && !Object.hasOwn(SEARCH_LEVEL_RANK, values.level)) {
    process.stderr.write(`Invalid log level: ${values.level}\n`)
    return 1
  }

  const filters: LogSearchFilters = {
    ref: values.ref,
    level: values.level,
    from: values.from,
    to: values.to,
    tenantId: values.tenant,
    pathPrefix: values['path-prefix'],
  }

  const logDir = resolve(values.dir ?? (process.env.LOG_DIR || './logs'))
  const lines = await searchLogDirectory(logDir, filters, todayUtc())
  for (const line of lines) {
    process.stdout.write(`${line}\n`)
  }
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
