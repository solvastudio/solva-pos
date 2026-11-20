import '@tanstack/react-start/server-only'
import { desc } from 'drizzle-orm'
import type { NoTenantTx } from '~/server/db'
import { appRelease } from './schema'

export interface AppReleaseDbRow {
  appVersion: string
  schemaVersion: number
  releasedAt: string
  isMandatory: boolean
  minSupportedSchemaVersion: number
  minSupportedAppVersion: string | null
  acceptPreviousUntil: string | null
}

export async function findLatestAppRelease(tx: NoTenantTx): Promise<AppReleaseDbRow | null> {
  const rows = await tx
    .select({
      appVersion: appRelease.appVersion,
      schemaVersion: appRelease.schemaVersion,
      releasedAt: appRelease.releasedAt,
      isMandatory: appRelease.isMandatory,
      minSupportedSchemaVersion: appRelease.minSupportedSchemaVersion,
      minSupportedAppVersion: appRelease.minSupportedAppVersion,
      acceptPreviousUntil: appRelease.acceptPreviousUntil,
    })
    .from(appRelease)
    .orderBy(desc(appRelease.releasedAt))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    appVersion: row.appVersion,
    schemaVersion: Number(row.schemaVersion),
    releasedAt: row.releasedAt,
    isMandatory: Boolean(row.isMandatory),
    minSupportedSchemaVersion: Number(row.minSupportedSchemaVersion),
    minSupportedAppVersion: row.minSupportedAppVersion ?? null,
    acceptPreviousUntil: row.acceptPreviousUntil ?? null,
  }
}
