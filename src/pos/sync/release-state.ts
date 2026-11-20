import { compareSemver, parseSemver } from '~/lib/app-version'
import type { ReleaseBlock } from '~/lib/contracts'

export type ReleaseEvaluation = 'UP_TO_DATE' | 'SOFT' | 'HARD' | 'REQUIRED' | 'SERVER_BEHIND'

export interface EvaluateReleaseClient {
  readonly appVersion: string
  readonly schemaVersion: number
  readonly hasWaitingWorker?: boolean
}

function normalizeSemver(version: string | null | undefined): string | null {
  if (!version) return null
  const normalized = /^\d/.test(version) ? `v${version}` : version
  return parseSemver(normalized) ? normalized : null
}

/**
 * Pure release evaluator mapping server `release` block + client build metadata + trusted time
 * into update urgency (`UP_TO_DATE` | `SOFT` | `HARD` | `REQUIRED` | `SERVER_BEHIND`).
 */
export function evaluateRelease(
  block: ReleaseBlock | null | undefined,
  client: EvaluateReleaseClient,
  nowMs: number,
): ReleaseEvaluation {
  if (!block) {
    return client.hasWaitingWorker ? 'SOFT' : 'UP_TO_DATE'
  }

  if (client.schemaVersion > block.max_schema_version) {
    return 'SERVER_BEHIND'
  }

  if (client.schemaVersion < block.min_supported_schema_version) {
    return 'REQUIRED'
  }

  const clientAppNorm = normalizeSemver(client.appVersion)
  const minAppNorm = normalizeSemver(block.min_supported_app_version)
  const latestAppNorm = normalizeSemver(block.latest)

  if (clientAppNorm && minAppNorm && compareSemver(clientAppNorm, minAppNorm) < 0) {
    return 'REQUIRED'
  }

  const schemaBehindLatest = client.schemaVersion < block.max_schema_version
  const appBehindLatest =
    Boolean(clientAppNorm && latestAppNorm && compareSemver(clientAppNorm, latestAppNorm) < 0)
  const isOutdated = schemaBehindLatest || appBehindLatest || Boolean(client.hasWaitingWorker)

  if (!isOutdated && !block.is_mandatory) {
    return 'UP_TO_DATE'
  }

  if (block.is_mandatory) {
    return 'HARD'
  }

  if (block.accept_previous_until !== null) {
    const deadlineMs = Date.parse(block.accept_previous_until)
    if (Number.isFinite(deadlineMs) && nowMs > deadlineMs) {
      return isOutdated ? 'HARD' : 'UP_TO_DATE'
    }
  }

  return isOutdated ? 'SOFT' : 'UP_TO_DATE'
}
