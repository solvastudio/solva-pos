import '@tanstack/react-start/server-only'
import { createHash, webcrypto } from 'node:crypto'
import { ZodError } from 'zod'
import {
  SUPPORTED_SCHEMA_VERSIONS,
  SCHEMA_VERSION,
  type PushCommandEnvelope,
  type PushRequest,
  type PushResponse,
  type PushResultItem,
} from '~/lib/contracts'
import { canonicalJson, createIdGenerator } from '~/lib/kernel'
import { withTenant } from '~/server/db'
import { getSyncPushMaxFailureAttempts } from '~/server/env'
import { createLogger } from '~/server/log'
import { getContext, runWithContext } from '~/server/logging/log-context'
import { getNotifier } from '~/server/notify/notifier'
import {
  CommandRejected,
  WAITER_FORBIDDEN_TYPES,
  type CommandContext,
  type SyncDeviceIdentity,
} from '../domain/command-types'
import { getCommandHandler } from './command-registry'
import { getDeviceStatusPort } from './device-status-port'
import {
  evaluateClientVersion,
  getReleasePolicy,
  releaseBlock,
  UpdateRequiredError,
} from './release.service'
import {
  claimIdempotencyRow,
  completeIdempotencyAck,
  deleteCommandFailureAttempt,
  findAttentionReasonByCommandId,
  findIdempotencyByCommandId,
  findParentCommandStatuses,
  incrementAttemptCount,
  insertAttentionRecord,
  recordCommandFailureAttempt,
} from './idempotency.repo'

const log = createLogger('sync.push')

const syncIdGen = createIdGenerator({
  nowMs: () => Date.now(),
  nextUint32: () => {
    const buf = new Uint32Array(1)
    webcrypto.getRandomValues(buf)
    return buf[0]!
  },
})

const SEMVER_APP_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const TRANSIENT_PG_CODES = new Set(['55P03', '40001', '40P01', '57P01', '53300', '57014'])

export interface PushRequestMeta {
  schemaVersion: number
  appVersion: string | null
  syncProtocol: number | null
  requestRef: string
}

export interface ProcessPushDeps {
  nowIso?: () => string
  lockTimeoutMs?: number
  maxFailureAttempts?: number
}

class HoldDependencyError extends Error {
  constructor() {
    super('HELD')
    this.name = 'HoldDependencyError'
  }
}

class HashMismatchReplayError extends Error {
  constructor() {
    super('HASH_MISMATCH')
    this.name = 'HashMismatchReplayError'
  }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function normalizeSemverAppVersion(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > 30 || !SEMVER_APP_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

function extractPgErrorCode(err: unknown): string | null {
  let curr: unknown = err
  for (let i = 0; i < 5 && curr && typeof curr === 'object'; i += 1) {
    const rec = curr as { code?: unknown; cause?: unknown }
    if (typeof rec.code === 'string') {
      return rec.code
    }
    curr = rec.cause
  }
  return null
}

function isTransientPgError(err: unknown): boolean {
  const code = extractPgErrorCode(err)
  return code !== null && (TRANSIENT_PG_CODES.has(code) || code.startsWith('08'))
}

function assertPayloadMatchesDeviceScope(payload: unknown, device: SyncDeviceIdentity): void {
  if (!payload || typeof payload !== 'object') return
  const candidates: Array<Record<string, unknown>> = [payload as Record<string, unknown>]
  const nestedEntry = (payload as { entry?: unknown }).entry
  if (nestedEntry && typeof nestedEntry === 'object') {
    candidates.push(nestedEntry as Record<string, unknown>)
  }

  for (const obj of candidates) {
    if (typeof obj.device_id === 'string' && obj.device_id !== device.deviceId) {
      throw new CommandRejected('AUTHORIZATION', 'FORBIDDEN', 'device_id mismatch')
    }
    if (typeof obj.register_id === 'string' && obj.register_id !== device.registerId) {
      throw new CommandRejected('AUTHORIZATION', 'FORBIDDEN', 'register_id mismatch')
    }
    if (typeof obj.outlet_id === 'string' && obj.outlet_id !== device.outletId) {
      throw new CommandRejected('AUTHORIZATION', 'FORBIDDEN', 'outlet_id mismatch')
    }
  }
}

function sanitizeDetail(text: string | undefined): string | null {
  if (!text) return null
  return text.slice(0, 500)
}

async function processSingleCommand(
  device: SyncDeviceIdentity,
  cmd: PushCommandEnvelope,
  reqClockOffsetMs: number,
  meta: { appVersion: string | null; requestRef: string },
  receivedAtIso: string,
  lockTimeoutMs?: number,
  maxFailureAttempts = 10,
): Promise<PushResultItem> {
  const startedAt = performance.now()
  const parentCtx = getContext() ?? {
    reqId: meta.requestRef,
    env: process.env.APP_ENV ?? 'development',
    appVersion: meta.appVersion ?? 'v0.0.0-dev',
  }

  return runWithContext(
    {
      ...parentCtx,
      commandId: cmd.id,
      tenantId: device.tenantId,
      deviceId: device.deviceId,
      registerId: device.registerId,
    },
    async (): Promise<PushResultItem> => {
      const rawJsonText = JSON.stringify(cmd.payload ?? null) ?? 'null'
      const payloadSize = Buffer.byteLength(rawJsonText, 'utf8')
      let parsedPayload: unknown = null
      let payloadHash = sha256Hex(
        canonicalJson({
          type: cmd.type,
          schema_version: cmd.schema_version,
          payload: cmd.payload ?? null,
        }),
      )

      const recordAttention = async (
        reasonClass: 'STRUCTURAL' | 'AUTHORIZATION',
        reasonCode: string,
        detail: string | null,
        attemptCount?: number,
      ): Promise<PushResultItem> => {
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
        await withTenant(
          device.tenantId,
          async (tx) => {
            await insertAttentionRecord(tx, {
              attentionId: syncIdGen.newId(),
              commandId: cmd.id,
              tenantId: device.tenantId,
              deviceId: device.deviceId,
              registerId: device.registerId,
              outletId: device.outletId,
              commandType: cmd.type,
              schemaVersion: cmd.schema_version,
              deviceSeq: cmd.device_seq,
              payloadHash,
              payloadSize,
              rawPayload: cmd.payload ?? {},
              reasonClass,
              reasonCode,
              detail: sanitizeDetail(detail ?? undefined),
              blockedByCommandId: null,
              requestRef: meta.requestRef,
              appVersion: meta.appVersion,
              receivedAtIso,
              durationMs,
              attemptCount,
            })
            await deleteCommandFailureAttempt(tx, device.tenantId, cmd.id)
          },
          { statementTimeoutMs: 10_000, lockTimeoutMs },
        )

        log.error(
          {
            commandId: cmd.id,
            commandType: cmd.type,
            schemaVersion: cmd.schema_version,
            outcome: 'ATTENTION',
            reason: reasonCode,
            durationMs,
          },
          'command rejected to attention queue',
        )
        return {
          id: cmd.id,
          outcome: 'ATTENTION',
          reason_class: reasonClass,
          reason_code: reasonCode,
          ref: meta.requestRef,
        }
      }

      const handler = getCommandHandler(cmd.type)
      if (!handler) {
        return recordAttention('STRUCTURAL', 'VALIDATION_FAILED', `unknown command type: ${cmd.type}`)
      }

      try {
        parsedPayload = handler.parse(cmd.payload, cmd.schema_version)
      } catch (err: unknown) {
        if (err instanceof CommandRejected) {
          return recordAttention(err.reasonClass, err.reasonCode, err.detail ?? null)
        }
        const msg =
          err instanceof ZodError
            ? err.issues[0]?.message ?? 'Invalid command payload'
            : err instanceof Error
              ? err.message
              : 'Invalid command payload'
        return recordAttention('STRUCTURAL', 'VALIDATION_FAILED', msg)
      }

      payloadHash = sha256Hex(
        canonicalJson({
          type: cmd.type,
          schema_version: cmd.schema_version,
          payload: parsedPayload,
        }),
      )

      try {
        const txResult = await withTenant(
          device.tenantId,
          async (tx): Promise<PushResultItem> => {
            const claimed = await claimIdempotencyRow(tx, {
              commandId: cmd.id,
              tenantId: device.tenantId,
              deviceId: device.deviceId,
              registerId: device.registerId,
              outletId: device.outletId,
              commandType: cmd.type,
              channel: 'OUTBOX',
              schemaVersion: cmd.schema_version,
              deviceSeq: cmd.device_seq,
              payloadHash,
              payloadSize,
              requestRef: meta.requestRef,
              appVersion: meta.appVersion,
              receivedAtIso,
            })

            if (!claimed) {
              const existing = await findIdempotencyByCommandId(tx, device.tenantId, cmd.id)
              if (!existing) {
                throw new Error('Missing existing idempotency row after conflict')
              }
              if (existing.payloadHash !== payloadHash) {
                throw new HashMismatchReplayError()
              }

              await incrementAttemptCount(tx, device.tenantId, cmd.id)

              if (existing.status === 'ACKED' || existing.status === 'ACCEPTED_MANUAL') {
                return {
                  id: cmd.id,
                  outcome: 'ACK',
                  result: existing.result,
                }
              }

              const att = await findAttentionReasonByCommandId(tx, device.tenantId, cmd.id)
              return {
                id: cmd.id,
                outcome: 'ATTENTION',
                reason_class: att?.reasonClass === 'AUTHORIZATION' ? 'AUTHORIZATION' : 'STRUCTURAL',
                reason_code: att?.reasonCode ?? 'VALIDATION_FAILED',
                ref: att?.requestRef ?? meta.requestRef,
              }
            }

            if (cmd.depends_on.length > 0) {
              const parentMap = await findParentCommandStatuses(tx, device.tenantId, cmd.depends_on)
              for (const depId of cmd.depends_on) {
                const depStatus = parentMap.get(depId)
                if (!depStatus || depStatus === 'ATTENTION') {
                  throw new HoldDependencyError()
                }
                if (depStatus === 'DISMISSED') {
                  throw new CommandRejected(
                    'STRUCTURAL',
                    'UNKNOWN_REFERENCE',
                    `Dependency ${depId} was dismissed`,
                  )
                }
              }
            }

            assertPayloadMatchesDeviceScope(cmd.payload, device)
            assertPayloadMatchesDeviceScope(parsedPayload, device)
            if (device.registerType === 'WAITER' && WAITER_FORBIDDEN_TYPES.has(cmd.type)) {
              throw new CommandRejected(
                'AUTHORIZATION',
                'FORBIDDEN',
                `Waiter register cannot execute ${cmd.type}`,
              )
            }

            const cmdCtx: CommandContext = {
              commandId: cmd.id,
              deviceSeq: cmd.device_seq,
              schemaVersion: cmd.schema_version,
              appVersion: meta.appVersion,
              createdAtDevice: cmd.created_at_device,
              clockOffsetMs: reqClockOffsetMs,
              receivedAtIso,
              requestRef: meta.requestRef,
              device,
            }

            const ackResult = await handler.handle(tx, cmdCtx, parsedPayload)
            const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
            await completeIdempotencyAck(tx, {
              tenantId: device.tenantId,
              commandId: cmd.id,
              result: ackResult,
              processedAtIso: receivedAtIso,
              durationMs,
            })
            await deleteCommandFailureAttempt(tx, device.tenantId, cmd.id)

            return {
              id: cmd.id,
              outcome: 'ACK',
              result: ackResult,
            }
          },
          { statementTimeoutMs: 10_000, lockTimeoutMs },
        )

        const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
        log.info(
          {
            commandId: cmd.id,
            commandType: cmd.type,
            schemaVersion: cmd.schema_version,
            outcome: txResult.outcome,
            durationMs,
          },
          'command processed',
        )
        return txResult
      } catch (err: unknown) {
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt))

        if (err instanceof HashMismatchReplayError) {
          log.error(
            {
              commandId: cmd.id,
              commandType: cmd.type,
              schemaVersion: cmd.schema_version,
              outcome: 'ATTENTION',
              reason: 'payload_hash_mismatch',
              durationMs,
            },
            'idempotency key reused with mismatched payload',
          )
          return {
            id: cmd.id,
            outcome: 'ATTENTION',
            reason_class: 'STRUCTURAL',
            reason_code: 'VALIDATION_FAILED',
            ref: meta.requestRef,
          }
        }

        if (err instanceof HoldDependencyError) {
          log.info(
            {
              commandId: cmd.id,
              commandType: cmd.type,
              schemaVersion: cmd.schema_version,
              outcome: 'HELD',
              durationMs,
            },
            'command held on unmet dependency',
          )
          return { id: cmd.id, outcome: 'HELD' }
        }

        if (err instanceof CommandRejected) {
          return recordAttention(err.reasonClass, err.reasonCode, err.detail ?? null)
        }

        const transientPg = isTransientPgError(err)
        const pgCode = transientPg ? extractPgErrorCode(err) : null
        const trackedErrorCode = pgCode ?? 'INTERNAL_ERROR'
        const rawDetail = err instanceof Error ? err.message : String(err)

        let attemptCount: number
        try {
          attemptCount = await withTenant(
            device.tenantId,
            async (tx) =>
              recordCommandFailureAttempt(tx, {
                tenantId: device.tenantId,
                commandId: cmd.id,
                lastErrorCode: trackedErrorCode,
                updatedAtIso: receivedAtIso,
              }),
            { statementTimeoutMs: 5_000 },
          )
        } catch (trackErr: unknown) {
          log.warn(
            { err: trackErr, commandId: cmd.id, outcome: 'RETRY' },
            'failed to persist command failure attempt count',
          )
          return { id: cmd.id, outcome: 'RETRY' }
        }

        if (attemptCount >= maxFailureAttempts) {
          const detailPrefix = transientPg
            ? `Repeated transient DB failure (${trackedErrorCode})`
            : `Repeated internal handler error (${attemptCount} attempts)`
          const detail = `${detailPrefix}: ${rawDetail}`
          const attentionRes = await recordAttention(
            'STRUCTURAL',
            'INTERNAL_ERROR',
            detail,
            attemptCount,
          )
          getNotifier().notify('error_spike', {
            code: 'INTERNAL_ERROR',
            ref: meta.requestRef,
            count: attemptCount,
          })
          return attentionRes
        }

        if (transientPg) {
          log.warn(
            {
              commandId: cmd.id,
              commandType: cmd.type,
              schemaVersion: cmd.schema_version,
              reason: `attempt_${attemptCount}_of_${maxFailureAttempts}`,
              outcome: 'RETRY',
              durationMs,
            },
            'transient DB contention during command push',
          )
          return { id: cmd.id, outcome: 'RETRY' }
        }

        log.error(
          {
            err,
            commandId: cmd.id,
            commandType: cmd.type,
            schemaVersion: cmd.schema_version,
            reason: `attempt_${attemptCount}_of_${maxFailureAttempts}`,
            outcome: 'RETRY',
            durationMs,
          },
          'unexpected server error during command push',
        )
        return { id: cmd.id, outcome: 'RETRY' }
      }
    },
  )
}

export async function processPush(
  device: SyncDeviceIdentity,
  req: PushRequest,
  meta: PushRequestMeta,
  deps?: ProcessPushDeps,
): Promise<PushResponse> {
  const receivedAtIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const maxFailureAttempts = Math.max(
    1,
    deps?.maxFailureAttempts ?? getSyncPushMaxFailureAttempts(),
  )
  const policy = await getReleasePolicy()
  const release = releaseBlock(policy)

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(meta.schemaVersion)) {
    throw new UpdateRequiredError(release, `Unsupported schema version: ${meta.schemaVersion}`)
  }

  const safeAppVersion = normalizeSemverAppVersion(meta.appVersion)
  const versionEval = evaluateClientVersion(
    {
      appVersion: safeAppVersion,
      schemaVersion: meta.schemaVersion,
      nowIso: receivedAtIso,
    },
    policy,
  )
  if (!versionEval.ok) {
    throw new UpdateRequiredError(release, `Client rejected by release policy: ${versionEval.reason}`)
  }

  const sorted = [...req.commands].sort((a, b) => a.device_seq - b.device_seq)

  const results: PushResultItem[] = []
  let ackCount = 0
  let hasRetry = false

  for (const cmd of sorted) {
    const item = await processSingleCommand(
      device,
      cmd,
      req.clock_offset_ms,
      {
        appVersion: safeAppVersion,
        requestRef: meta.requestRef,
      },
      receivedAtIso,
      deps?.lockTimeoutMs,
      maxFailureAttempts,
    )
    if (item.outcome === 'ACK') ackCount += 1
    if (item.outcome === 'RETRY') hasRetry = true
    results.push(item)
  }

  const statusPort = getDeviceStatusPort()
  if (statusPort) {
    await withTenant(
      device.tenantId,
      async (tx) => {
        await statusPort.touchDeviceStatus(tx, device.tenantId, device.deviceId, {
          lastAttemptAt: receivedAtIso,
          lastPushAt: receivedAtIso,
          appVersion: safeAppVersion,
          schemaVersion: meta.schemaVersion,
          syncProtocolVersion: meta.syncProtocol,
          clockOffsetMs: req.clock_offset_ms,
          clockOffsetAt: receivedAtIso,
        })

        if (ackCount >= 1 && !hasRetry) {
          await statusPort.extendCredentialIfNeeded(tx, device.tenantId, device.deviceId, receivedAtIso)
        }
      },
      { statementTimeoutMs: 5_000 },
    )
  }

  return {
    server_time: receivedAtIso,
    results,
    max_schema_version: SCHEMA_VERSION,
    release,
  }
}
