import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  SEARCH_LEVEL_RANK,
  parseLogLine,
  searchLogDirectory,
  type LogSearchFilters,
} from '~/server/logging/log-search'
import { todayUtc } from '~/server/logging/log-time'
import {
  createDirectoryMapLoader,
  translateLogEntryStacks,
} from '~/server/logging/sourcemap-translate'

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      'ref-local': { type: 'string' },
      level: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      tenant: { type: 'string' },
      'path-prefix': { type: 'string' },
      dir: { type: 'string' },
      translate: { type: 'boolean', default: false },
      'sourcemap-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    process.stdout.write(
      'Usage: npm run logs:find -- [--ref <id>] [--ref-local <D-...>] [--level warn] [--from ISO] [--to ISO] [--tenant id] [--path-prefix /api] [--translate] [--dir ./logs]\n',
    )
    return 0
  }

  if (values.level && !Object.hasOwn(SEARCH_LEVEL_RANK, values.level)) {
    process.stderr.write(`Invalid log level: ${values.level}\n`)
    return 1
  }

  const filters: LogSearchFilters = {
    ref: values.ref,
    refLocal: values['ref-local'],
    level: values.level,
    from: values.from,
    to: values.to,
    tenantId: values.tenant,
    pathPrefix: values['path-prefix'],
  }

  const logDir = resolve(values.dir ?? (process.env.LOG_DIR || './logs'))
  const sourcemapDir = resolve(values['sourcemap-dir'] ?? (process.env.SOURCEMAP_DIR || './sourcemaps'))
  const loaderCache = new Map<string, ReturnType<typeof createDirectoryMapLoader>>()
  const getLoader = (version: string) => {
    let loader = loaderCache.get(version)
    if (!loader) {
      loader = createDirectoryMapLoader(sourcemapDir, version)
      loaderCache.set(version, loader)
    }
    return loader
  }

  const lines = await searchLogDirectory(logDir, filters, todayUtc())
  for (const line of lines) {
    if (!values.translate) {
      process.stdout.write(`${line}\n`)
      continue
    }
    const parsed = parseLogLine(line)
    if (!parsed) {
      process.stdout.write(`${line}\n`)
      continue
    }
    process.stdout.write(`${JSON.stringify(translateLogEntryStacks(parsed, getLoader))}\n`)
  }
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
