import '@tanstack/react-start/server-only'

/** Current instant as ISO-8601: the injected clock when a test supplies one, otherwise the system clock. */
export function nowIsoFrom(deps?: { nowIso?: () => string }): string {
  return (deps?.nowIso ?? (() => new Date().toISOString()))()
}
