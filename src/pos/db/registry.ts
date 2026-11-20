import Dexie, { type Table } from 'dexie'
import { REGISTRY_DB_NAME } from '../locks/names'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TenantDirectoryRow {
  tenant_id: string
  slug: string
  last_opened_at: string
}

class SolvaRegistryDb extends Dexie {
  tenant_directory!: Table<TenantDirectoryRow, string>

  constructor() {
    super(REGISTRY_DB_NAME)
    this.version(1).stores({
      tenant_directory: 'tenant_id, &slug',
    })
  }
}

let registryInstance: SolvaRegistryDb | null = null

export function getRegistryDb(): SolvaRegistryDb {
  if (!registryInstance) {
    registryInstance = new SolvaRegistryDb()
  }
  return registryInstance
}

export function closeRegistryDbForTests(): void {
  if (registryInstance) {
    registryInstance.close()
    registryInstance = null
  }
}

function normalizeSlugInput(slug: string): string {
  const s = slug.trim().toLowerCase()
  if (!s) {
    throw new Error('Tenant slug cannot be empty')
  }
  return s
}

/**
 * Registers or updates a permanent `slug -> tenant_id` mapping in `solva-registry`
 * without storing tenant display names, credentials, or business data.
 */
export async function rememberTenant(input: {
  tenantId: string
  slug: string
  nowIso: string
}): Promise<TenantDirectoryRow> {
  if (!UUID_PATTERN.test(input.tenantId)) {
    throw new Error(`Invalid tenant UUID for registry: ${input.tenantId}`)
  }
  const normalizedSlug = normalizeSlugInput(input.slug)
  const db = getRegistryDb()

  return db.transaction('rw', db.tenant_directory, async () => {
    const byId = await db.tenant_directory.get(input.tenantId)
    if (byId && byId.slug !== normalizedSlug) {
      throw new Error(
        `Tenant ${input.tenantId} already registered under slug "${byId.slug}", cannot reassign to "${normalizedSlug}"`,
      )
    }

    const bySlug = await db.tenant_directory.where('slug').equals(normalizedSlug).first()
    if (bySlug && bySlug.tenant_id !== input.tenantId) {
      throw new Error(
        `Slug "${normalizedSlug}" is already bound to another tenant (${bySlug.tenant_id})`,
      )
    }

    const row: TenantDirectoryRow = {
      tenant_id: input.tenantId,
      slug: normalizedSlug,
      last_opened_at: input.nowIso,
    }
    await db.tenant_directory.put(row)
    return row
  })
}

export async function findTenantIdBySlug(slug: string): Promise<string | null> {
  const normalizedSlug = slug.trim().toLowerCase()
  if (!normalizedSlug) return null
  const db = getRegistryDb()
  const row = await db.tenant_directory.where('slug').equals(normalizedSlug).first()
  return row ? row.tenant_id : null
}

export async function touchTenant(tenantId: string, nowIso: string): Promise<void> {
  const db = getRegistryDb()
  await db.tenant_directory.update(tenantId, { last_opened_at: nowIso })
}

export async function listTenants(): Promise<TenantDirectoryRow[]> {
  const db = getRegistryDb()
  return db.tenant_directory.toArray()
}

export async function forgetTenantFromRegistry(tenantId: string): Promise<void> {
  const db = getRegistryDb()
  await db.tenant_directory.delete(tenantId)
}
