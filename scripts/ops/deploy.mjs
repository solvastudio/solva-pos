const HEALTH_TIMEOUT_MS = 120_000
const HEALTH_POLL_INTERVAL_MS = 3_000

/**
 * Executes the deployment pipeline:
 * 1. Conditional full pg_dump backup if new migrations touch existing data (`-- touches-existing-data`).
 * 2. Run database migrator with the new image.
 * 3. Switch the app container to `newImage`.
 * 4. Poll `/health` until 200 ok matching `newVersion` within 120s.
 * 5. Automatic rollback to `prevImage` on health failure, refusing rollback (exitCode 2) if
 *    `prevImage` does not understand the highest client schema in `device_sync_status`.
 * 6. On success, sync sourcemaps and register release when callbacks are supplied.
 */
export async function deploy(ctx) {
  const newMigrations = ctx.newMigrations ?? []
  const now = ctx.now ?? (() => Date.now())
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const timeoutMs = ctx.timeoutMs ?? HEALTH_TIMEOUT_MS
  const pollIntervalMs = ctx.pollIntervalMs ?? HEALTH_POLL_INTERVAL_MS

  let backedUp = false
  const markedMigrations = newMigrations.filter(
    (m) => typeof m.content === 'string' && m.content.includes('-- touches-existing-data'),
  )
  if (markedMigrations.length > 0) {
    await ctx.backup({
      reason: 'touches-existing-data',
      migrations: markedMigrations.map((m) => m.name),
    })
    backedUp = true
  }

  await ctx.docker.runMigrator(ctx.newImage)
  await ctx.docker.switchApp(ctx.newImage)

  const deadline = now() + timeoutMs
  let healthy = false
  let lastReason = 'Health check timed out'

  while (true) {
    const probe = await ctx.health.check()
    if (probe.ok && probe.version === ctx.newVersion) {
      healthy = true
      break
    }
    if (!probe.ok) {
      lastReason = probe.error ?? `Unhealthy status: ${probe.status}`
    } else if (probe.version !== ctx.newVersion) {
      lastReason = `Version mismatch: expected ${ctx.newVersion}, got ${probe.version}`
    }

    if (now() >= deadline) {
      break
    }
    await sleep(pollIntervalMs)
  }

  if (!healthy) {
    const maxClientSchema = await ctx.db.getMaxDeviceSchemaVersion()
    const prevMaxSupported = await ctx.docker.getImageMaxSchemaVersion(ctx.prevImage)

    if (
      maxClientSchema !== null &&
      (prevMaxSupported === null || prevMaxSupported < maxClientSchema)
    ) {
      return {
        ok: false,
        exitCode: 2,
        rolledBack: false,
        backedUp,
        reason: 'ROLLBACK_BLOCKED_UNSUPPORTED_SCHEMA',
        warning: `Rollback to ${ctx.prevImage} refused: clients use schema_version=${maxClientSchema}, previous image supports up to ${prevMaxSupported}`,
      }
    }

    await ctx.docker.switchApp(ctx.prevImage)
    return {
      ok: false,
      exitCode: 1,
      rolledBack: true,
      backedUp,
      reason: lastReason,
    }
  }

  if (ctx.syncSourcemaps) {
    await ctx.syncSourcemaps({ version: ctx.newVersion })
  }
  if (ctx.registerRelease) {
    await ctx.registerRelease({ version: ctx.newVersion })
  }

  return {
    ok: true,
    exitCode: 0,
    rolledBack: false,
    backedUp,
  }
}
