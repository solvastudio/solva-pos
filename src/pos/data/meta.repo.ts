import type { Table, Transaction } from 'dexie'
import { SolvaDb } from '../db/solva-db'
import { META_SCHEMAS, type MetaKey, type MetaRow, type MetaValueMap } from '../db/types'

function resolveMetaTable(dbOrTx: SolvaDb | Transaction): Table<MetaRow, string> {
  if (dbOrTx instanceof SolvaDb) {
    return dbOrTx.meta
  }
  return dbOrTx.table<MetaRow, string>('meta')
}

export async function getMeta<K extends MetaKey>(
  dbOrTx: SolvaDb | Transaction,
  key: K,
): Promise<MetaValueMap[K] | null> {
  const row = await resolveMetaTable(dbOrTx).get(key)
  return row ? (row.value as MetaValueMap[K]) : null
}

/**
 * Validates `value` against the schema registered for `key` before persisting.
 */
export async function setMeta<K extends MetaKey>(
  dbOrTx: SolvaDb | Transaction,
  key: K,
  value: MetaValueMap[K],
): Promise<void> {
  const schema = META_SCHEMAS[key]
  const parsed = schema.parse(value) as MetaValueMap[K]
  await resolveMetaTable(dbOrTx).put({ key, value: parsed })
}

export async function deleteMeta(
  dbOrTx: SolvaDb | Transaction,
  key: MetaKey,
): Promise<void> {
  await resolveMetaTable(dbOrTx).delete(key)
}

/**
 * Loads multiple metadata keys in a single IndexedDB `bulkGet` batch (§3.1 step 5).
 */
export async function bulkGetMeta<const Keys extends readonly MetaKey[]>(
  db: SolvaDb,
  keys: Keys,
): Promise<Partial<Pick<MetaValueMap, Keys[number]>>> {
  const rows = await db.meta.bulkGet([...keys])
  const out: Partial<Record<MetaKey, unknown>> = {}
  keys.forEach((key, idx) => {
    const row = rows[idx]
    if (row) {
      out[key] = row.value
    }
  })
  return out as Partial<Pick<MetaValueMap, Keys[number]>>
}

/**
 * Atomically writes all device pairing metadata records inside a single Dexie `rw` transaction.
 */
export async function writePairingMeta(
  db: SolvaDb,
  input: {
    device: MetaValueMap['device']
    tenant: MetaValueMap['tenant']
    locale: MetaValueMap['locale']
    clock: MetaValueMap['clock']
  },
): Promise<void> {
  await db.transaction('rw', db.meta, async (tx) => {
    await setMeta(tx, 'device', input.device)
    await setMeta(tx, 'tenant', input.tenant)
    await setMeta(tx, 'locale', input.locale)
    await setMeta(tx, 'clock', input.clock)
    await setMeta(tx, 'dexie_version', 1)
    await setMeta(tx, 'device_flags', {
      revoked: false,
      credential_expired: false,
      tenant_suspended: false,
    })
  })
}
