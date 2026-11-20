import '@tanstack/react-start/server-only'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { originalPositionFor, TraceMap, type SourceMapInput } from '@jridgewell/trace-mapping'

const FRAME_PATTERN =
  /(?:https?:\/\/[^\s)]+?\/)?(?:[^\s():]*\/)?([A-Za-z0-9._-]+\.(?:m?js)):(\d+):(\d+)/g

/**
 * Parses raw `.map` JSON safely into a `TraceMap`, returning `null` if malformed.
 */
export function parseTraceMapSafe(rawJson: string): TraceMap | null {
  try {
    const parsed = JSON.parse(rawJson) as SourceMapInput
    return new TraceMap(parsed)
  } catch {
    return null
  }
}

/**
 * Translates compiled JS stack frames (`file-HASH.js:L:C`) using the injected map loader.
 * Unmapped frames retain their original text with `(no map)` appended; broken maps never throw.
 */
export function translateStack(
  stack: string,
  loadMap: (assetFile: string) => TraceMap | null,
): string {
  if (!stack) return stack

  return stack.replace(FRAME_PATTERN, (fullMatch, assetFile: string, lineStr: string, colStr: string) => {
    try {
      const map = loadMap(assetFile)
      if (!map) {
        return `${fullMatch} (no map)`
      }
      const line = Number(lineStr)
      const col = Number(colStr)
      const pos = originalPositionFor(map, {
        line: Number.isFinite(line) && line > 0 ? line : 1,
        column: Number.isFinite(col) && col > 0 ? col - 1 : 0,
      })
      if (!pos.source || pos.line === null) {
        return `${fullMatch} (no map)`
      }
      const outCol = (pos.column ?? 0) + 1
      const fnSuffix = pos.name ? ` (${pos.name})` : ''
      return `${pos.source}:${pos.line}:${outCol}${fnSuffix}`
    } catch {
      return `${fullMatch} (no map)`
    }
  })
}

function indexMapFiles(dir: string, out = new Map<string, string>()): Map<string, string> {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      indexMapFiles(full, out)
    } else if (entry.name.endsWith('.map')) {
      out.set(entry.name, full)
    }
  }
  return out
}

export function createDirectoryMapLoader(
  sourcemapRootDir: string,
  appVersion: string,
): (assetFile: string) => TraceMap | null {
  const versionDir = join(sourcemapRootDir, appVersion)
  const fileIndex = indexMapFiles(versionDir)
  const cache = new Map<string, TraceMap | null>()

  return (assetFile: string): TraceMap | null => {
    const key = `${basename(assetFile)}.map`
    if (cache.has(key)) {
      return cache.get(key) ?? null
    }
    const mapPath = fileIndex.get(key)
    if (!mapPath) {
      cache.set(key, null)
      return null
    }
    try {
      const parsed = parseTraceMapSafe(readFileSync(mapPath, 'utf8'))
      cache.set(key, parsed)
      return parsed
    } catch {
      cache.set(key, null)
      return null
    }
  }
}

export function translateLogEntryStacks<T extends Record<string, unknown>>(
  entry: T,
  loaderForVersion: (appVersion: string) => (assetFile: string) => TraceMap | null,
): T {
  const appVersion = typeof entry.appVersion === 'string' ? entry.appVersion : null
  if (!appVersion) return entry
  const loadMap = loaderForVersion(appVersion)
  const clone: Record<string, unknown> = { ...entry }

  if (entry.err && typeof entry.err === 'object') {
    const errObj = { ...(entry.err as Record<string, unknown>) }
    if (typeof errObj.stack === 'string') {
      errObj.stack = translateStack(errObj.stack, loadMap)
    }
    clone.err = errObj
  }

  if (entry.clientError && typeof entry.clientError === 'object') {
    const ceObj = { ...(entry.clientError as Record<string, unknown>) }
    if (typeof ceObj.stack === 'string') {
      ceObj.stack = translateStack(ceObj.stack, loadMap)
    }
    clone.clientError = ceObj
  }

  if (typeof entry.componentStack === 'string') {
    clone.componentStack = translateStack(entry.componentStack, loadMap)
  }

  return clone as T
}
