import '@tanstack/react-start/server-only'
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const LOG_FILE_PATTERN = /^app\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log$/
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000

function cutoffUtcDay(retentionDays: number, nowMs: number): string {
  const cutoffMs = nowMs - retentionDays * 86_400_000
  return new Date(cutoffMs).toISOString().slice(0, 10)
}

export async function pruneLogs(
  dir: string,
  retentionDays: number,
  nowMs: number,
  deps?: {
    list?: (d: string) => Promise<string[]>
    remove?: (p: string) => Promise<void>
  },
): Promise<string[]> {
  const list = deps?.list ?? ((d: string) => readdir(d))
  const remove = deps?.remove ?? ((p: string) => unlink(p))

  let names: string[]
  try {
    names = await list(dir)
  } catch {
    return []
  }

  const cutoff = cutoffUtcDay(retentionDays, nowMs)
  const removed: string[] = []

  for (const name of names) {
    const match = LOG_FILE_PATTERN.exec(name)
    if (!match) continue
    const fileDay = match[1]!
    if (fileDay >= cutoff) continue
    try {
      await remove(join(dir, name))
      removed.push(name)
    } catch {
      /* lewati bila sedang dipakai atau sudah terhapus */
    }
  }

  return removed
}

declare global {
  var __solvaLogRetentionTimer: ReturnType<typeof setInterval> | undefined
}

export function startLogRetention(dir: string, retentionDays: number): void {
  if (globalThis.__solvaLogRetentionTimer) return
  void pruneLogs(dir, retentionDays, Date.now())
  const timer = setInterval(() => {
    void pruneLogs(dir, retentionDays, Date.now())
  }, PRUNE_EVERY_MS)
  timer.unref()
  globalThis.__solvaLogRetentionTimer = timer
}
