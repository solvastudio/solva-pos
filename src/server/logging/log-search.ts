import '@tanstack/react-start/server-only'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { LOG_FILE_PATTERN } from './log-retention'
import { dayOfLogId } from './request-id'

export const SEARCH_LEVEL_RANK: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

export interface LogEntry {
  level: string
  time: string
  msg?: string
  [key: string]: unknown
}

export interface LogSearchFilters {
  ref?: string
  refLocal?: string
  level?: string
  from?: string
  to?: string
  tenantId?: string
  pathPrefix?: string
}

export function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null) return null
    const rec = parsed as Record<string, unknown>
    if (typeof rec.level !== 'string' || typeof rec.time !== 'string') return null
    return rec as LogEntry
  } catch {
    return null
  }
}

export function matchesLogFilters(entry: LogEntry, filters: LogSearchFilters): boolean {
  if (filters.ref) {
    const ref = filters.ref
    const matchesRef =
      entry.reqId === ref ||
      entry.commandId === ref ||
      entry.jobId === ref ||
      entry.parentReqId === ref ||
      entry.refLocal === ref
    if (!matchesRef) return false
  }

  if (filters.refLocal && entry.refLocal !== filters.refLocal) {
    return false
  }

  if (filters.level) {
    const minRank = SEARCH_LEVEL_RANK[filters.level] ?? 0
    const actualRank = SEARCH_LEVEL_RANK[entry.level] ?? 0
    if (actualRank < minRank) return false
  }

  if (filters.from && entry.time < filters.from) return false
  if (filters.to && entry.time > filters.to) return false
  if (filters.tenantId && entry.tenantId !== filters.tenantId) return false
  if (filters.pathPrefix) {
    if (typeof entry.path !== 'string' || !entry.path.startsWith(filters.pathPrefix)) {
      return false
    }
  }
  return true
}

function addUtcDays(isoDay: string, deltaDays: number): string {
  const ms = Date.parse(`${isoDay}T00:00:00.000Z`) + deltaDays * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function extractSearchDay(filters: Pick<LogSearchFilters, 'ref' | 'refLocal'>): string | null {
  const token = filters.refLocal ?? filters.ref
  if (!token) return null
  const localMatch = /^D-(\d{4})(\d{2})(\d{2})-/.exec(token)
  if (localMatch) {
    return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`
  }
  return dayOfLogId(token)
}

export function candidateLogFiles(
  fileNames: readonly string[],
  filters: Pick<LogSearchFilters, 'ref' | 'refLocal' | 'from' | 'to'>,
  todayUtcStr: string,
): string[] {
  const refDay = extractSearchDay(filters)
  const rawFrom = refDay ?? (filters.from ? filters.from.slice(0, 10) : addUtcDays(todayUtcStr, -1))
  const rawTo = refDay ?? (filters.to ? filters.to.slice(0, 10) : todayUtcStr)

  const fromDay = addUtcDays(rawFrom, -1)
  const toDay = addUtcDays(rawTo, 1)

  const matched: Array<{ name: string; day: string; num: number }> = []
  for (const name of fileNames) {
    const m = LOG_FILE_PATTERN.exec(name)
    if (!m) continue
    const day = m[1]!
    if (day < fromDay || day > toDay) continue
    matched.push({ name, day, num: Number(m[2]) })
  }

  matched.sort((a, b) => (a.day === b.day ? a.num - b.num : a.day < b.day ? -1 : 1))
  return matched.map((item) => item.name)
}

export async function searchLogDirectory(
  dir: string,
  filters: LogSearchFilters,
  todayUtcStr: string,
): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const files = candidateLogFiles(names, filters, todayUtcStr)
  const rawMatches: string[] = []

  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(join(dir, file), 'utf8'),
      crlfDelay: Infinity,
    })
    for await (const line of rl) {
      const entry = parseLogLine(line)
      if (!entry || !matchesLogFilters(entry, filters)) continue
      rawMatches.push(JSON.stringify(entry))
    }
  }

  return rawMatches
}
