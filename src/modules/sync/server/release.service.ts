import '@tanstack/react-start/server-only'
import { APP_VERSION, compareSemver, isAppVersion } from '~/lib/app-version'
import { SCHEMA_VERSION, type ReleaseBlock } from '~/lib/contracts'
import { withNoTenant } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { findLatestAppRelease } from './release.repo'

const POLICY_CACHE_TTL_MS = 60_000

export interface ReleasePolicy {
  latest: string
  schema_version: number
  min_supported_schema_version: number
  min_supported_app_version: string | null
  is_mandatory: boolean
  accept_previous_until: string | null
}

export type VersionEvaluationResult =
  | { ok: true }
  | { ok: false; reason: 'SCHEMA_TOO_OLD' | 'APP_TOO_OLD' }

export class UpdateRequiredError extends AppError {
  constructor(
    public readonly release: ReleaseBlock,
    message = 'Client update required',
  ) {
    super('UPDATE_REQUIRED', message)
    this.name = 'UpdateRequiredError'
  }
}

let cachedPolicy: { value: ReleasePolicy; expiresAtMs: number } | null = null

export function defaultReleasePolicy(): ReleasePolicy {
  return {
    latest: APP_VERSION,
    schema_version: SCHEMA_VERSION,
    min_supported_schema_version: SCHEMA_VERSION,
    min_supported_app_version: null,
    is_mandatory: false,
    accept_previous_until: null,
  }
}

export async function getReleasePolicy(deps?: { nowMs?: () => number }): Promise<ReleasePolicy> {
  const nowMs = (deps?.nowMs ?? (() => Date.now()))()
  if (cachedPolicy && nowMs < cachedPolicy.expiresAtMs) {
    return cachedPolicy.value
  }

  const row = await withNoTenant((tx) => findLatestAppRelease(tx))
  const value: ReleasePolicy = row
    ? {
        latest: row.appVersion,
        schema_version: row.schemaVersion,
        min_supported_schema_version: row.minSupportedSchemaVersion,
        min_supported_app_version: row.minSupportedAppVersion,
        is_mandatory: row.isMandatory,
        accept_previous_until: row.acceptPreviousUntil,
      }
    : defaultReleasePolicy()

  cachedPolicy = {
    value,
    expiresAtMs: nowMs + POLICY_CACHE_TTL_MS,
  }
  return value
}

export function __clearReleasePolicyCacheForTests(): void {
  cachedPolicy = null
}

export function releaseBlock(policy: ReleasePolicy): ReleaseBlock {
  return {
    latest: policy.latest,
    min_supported_app_version: policy.min_supported_app_version,
    min_supported_schema_version: policy.min_supported_schema_version,
    is_mandatory: policy.is_mandatory,
    accept_previous_until: policy.accept_previous_until,
    max_schema_version: SCHEMA_VERSION,
  }
}

export function evaluateClientVersion(
  client: {
    appVersion: string | null
    schemaVersion: number
    nowIso?: string
  },
  policy: ReleasePolicy,
): VersionEvaluationResult {
  if (client.schemaVersion < policy.min_supported_schema_version) {
    return { ok: false, reason: 'SCHEMA_TOO_OLD' }
  }

  if (policy.min_supported_app_version !== null) {
    if (!client.appVersion || !isAppVersion(client.appVersion)) {
      return { ok: false, reason: 'APP_TOO_OLD' }
    }
    if (compareSemver(client.appVersion, policy.min_supported_app_version) < 0) {
      return { ok: false, reason: 'APP_TOO_OLD' }
    }
  }

  return { ok: true }
}
