import { resolve } from 'node:path'
import { Client } from 'pg'

const SEMVER_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/
const THIRTY_DAYS_MS = 30 * 86_400_000

export function parseReleaseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--mandatory') {
      args.mandatory = true
      continue
    }
    if (token && token.startsWith('--')) {
      const key = token.slice(2)
      const val = argv[i + 1]
      if (!val || val.startsWith('--')) {
        throw new Error(`Missing value for flag --${key}`)
      }
      args[key] = val
      i += 1
    }
  }
  return {
    version: args.version,
    schemaVersion: args.schema !== undefined ? Number(args.schema) : undefined,
    minSupportedSchemaVersion: args['min-schema'] !== undefined ? Number(args['min-schema']) : undefined,
    mandatory: Boolean(args.mandatory),
    minSupportedAppVersion: args['min-app'] ?? null,
    notes: args.notes ?? null,
    releasedAtIso: args['released-at'] ?? undefined,
  }
}

export function isValidAppVersion(value) {
  return typeof value === 'string' && value.length <= 30 && SEMVER_PATTERN.test(value)
}

/**
 * Computes and validates the database record for `app_release`, setting
 * `accept_previous_until = released_at + 30 days` (OQ-A19 / V-31).
 */
export function prepareReleaseRecord(input, deps = {}) {
  const releasedAtIso = input.releasedAtIso ?? (deps.nowIso ? deps.nowIso() : new Date().toISOString())
  const releasedAtMs = Date.parse(releasedAtIso)
  if (!Number.isFinite(releasedAtMs)) {
    throw new Error(`Invalid releasedAt timestamp: ${releasedAtIso}`)
  }

  if (!isValidAppVersion(input.version)) {
    throw new Error(`Invalid --version SemVer: ${input.version}`)
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new Error(`Invalid --schema version: ${input.schemaVersion}`)
  }
  if (
    !Number.isSafeInteger(input.minSupportedSchemaVersion) ||
    input.minSupportedSchemaVersion < 1 ||
    input.minSupportedSchemaVersion > input.schemaVersion
  ) {
    throw new Error(
      `Invalid --min-schema (${input.minSupportedSchemaVersion}): must be between 1 and ${input.schemaVersion}`,
    )
  }
  if (input.minSupportedAppVersion !== null && !isValidAppVersion(input.minSupportedAppVersion)) {
    throw new Error(`Invalid --min-app SemVer: ${input.minSupportedAppVersion}`)
  }

  const acceptPreviousUntil = new Date(releasedAtMs + THIRTY_DAYS_MS).toISOString()

  return {
    app_version: input.version,
    schema_version: input.schemaVersion,
    released_at: new Date(releasedAtMs).toISOString(),
    is_mandatory: Boolean(input.mandatory),
    min_supported_schema_version: input.minSupportedSchemaVersion,
    min_supported_app_version: input.minSupportedAppVersion,
    accept_previous_until: acceptPreviousUntil,
    notes: input.notes ?? null,
  }
}

export async function insertReleaseRecord(client, record) {
  const res = await client.query(
    `INSERT INTO app_release (
       app_version, schema_version, released_at, is_mandatory,
       min_supported_schema_version, min_supported_app_version, accept_previous_until, notes
     ) VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7::timestamptz, $8)
     RETURNING app_version`,
    [
      record.app_version,
      record.schema_version,
      record.released_at,
      record.is_mandatory,
      record.min_supported_schema_version,
      record.min_supported_app_version,
      record.accept_previous_until,
      record.notes,
    ],
  )
  return res.rows[0]
}

export async function registerRelease(argv, deps = {}) {
  const input = parseReleaseArgs(argv)
  const record = prepareReleaseRecord(input, deps)
  const ownerUrl = deps.databaseOwnerUrl ?? process.env.DATABASE_OWNER_URL
  if (!ownerUrl) {
    throw new Error('DATABASE_OWNER_URL is required to register a release')
  }

  const client = deps.createClient ? deps.createClient(ownerUrl) : new Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    await insertReleaseRecord(client, record)
    return record
  } finally {
    await client.end()
  }
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

if (isEntrypoint) {
  registerRelease(process.argv.slice(2))
    .then((rec) => {
      process.stdout.write(
        `Registered app_release ${rec.app_version} (schema ${rec.schema_version}, min ${rec.min_supported_schema_version}, previous accepted until ${rec.accept_previous_until})\n`,
      )
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    })
}
