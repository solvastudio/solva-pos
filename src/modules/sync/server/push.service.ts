import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { ZodError } from 'zod'
import {
  ContractError,
  hasRegisteredCommandSchema,
  parseCommandPayload,
  SUPPORTED_SCHEMA_VERSIONS,
  SCHEMA_VERSION,
  type PushCommandEnvelope,
  type PushRequest,
  type PushResponse,
  type PushResultItem,
} from '~/lib/contracts'
import { normalizeSemverAppVersion } from '~/lib/app-version'
import { canonicalJson } from '~/lib/kernel'
import { runtimeIdGenerator as syncIdGen } from '~/lib/runtime-id'
import { withTenant, type TenantTx } from '~/server/db'
import { getSyncPushMaxFailureAttempts, getSyncPushMaxTransientAttempts } from '~/server/env'
import { createLogger } from '~/server/log'
import { serializeError } from '~/server/logging/error-serializer'
import { getContext, runWithContext } from '~/server/logging/log-context'
import { getNotifier } from '~/server/notify/notifier'
import {
  CommandRejected,
  WAITER_FORBIDDEN_TYPES,
  type CommandContext,
  type SyncDeviceIdentity,
} from '../domain/command-types'
import { getCommandHandler, type ServerCommandHandler } from './command-registry'
import { getDeviceStatusPort } from './device-status-port'
import {
  evaluateClientVersion,
  getReleasePolicy,
  releaseBlock,
  UpdateRequiredError,
} from './release.service'
import {
  claimIdempotencyRow,
  type ExistingIdempotencyRow,
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

const TRANSIENT_PG_CODES = new Set(['55P03', '40001', '40P01', '57P01', '53300', '57014'])
const ONLINE_ONLY_COMMANDS = new Set(['HandOverBill', 'AcceptBill', 'CancelBillHandover'])

export interface PushRequestMeta {
  schemaVersion: number
  appVersion: string | null
  syncProtocol: number | null
  requestRef: string
}

export interface ProcessPushDeps {
  nowIso?: () => string
  lockTimeoutMs?: number
  /** Attempts before a deterministic/internal handler failure is escalated to the attention queue. */
  maxFailureAttempts?: number
  /** Much higher bound for transient DB failures (lock timeout, deadlock, connection loss). */
  maxTransientAttempts?: number
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

type ClaimParams = Parameters<typeof claimIdempotencyRow>[1]
type AttentionRecordParams = Parameters<typeof insertAttentionRecord>[1]

/** Claim parameters for a command that arrived through the outbox channel. */
function outboxClaimParams(args: {
  cmd: PushCommandEnvelope
  device: SyncDeviceIdentity
  payloadHash: string
  payloadSize: number
  requestRef: string
  appVersion: string | null
  receivedAtIso: string
}): ClaimParams {
  const { cmd, device } = args
  return {
    commandId: cmd.id,
    tenantId: device.tenantId,
    deviceId: device.deviceId,
    registerId: device.registerId,
    outletId: device.outletId,
    commandType: cmd.type,
    channel: 'OUTBOX',
    schemaVersion: cmd.schema_version,
    deviceSeq: cmd.device_seq,
    payloadHash: args.payloadHash,
    payloadSize: args.payloadSize,
    requestRef: args.requestRef,
    appVersion: args.appVersion,
    receivedAtIso: args.receivedAtIso,
  }
}

/**
 * Claims the idempotency row for a command, or loads the row that already exists for it.
 * A conflict without a visible row means the id belongs to another tenant (row-level security hides it).
 */
async function claimOrLoadExisting(
  tx: TenantTx,
  params: ClaimParams,
): Promise<{ claimed: true } | { claimed: false; existing: ExistingIdempotencyRow }> {
  if (await claimIdempotencyRow(tx, params)) {
    return { claimed: true }
  }
  const existing = await findIdempotencyByCommandId(tx, params.tenantId, params.commandId)
  if (!existing) {
    throw new Error('Missing existing idempotency row after conflict')
  }
  return { claimed: false, existing }
}

/** Result replayed to the device for a command that was already parked in the attention queue. */
async function attentionReplayItem(
  tx: TenantTx,
  tenantId: string,
  commandId: string,
  fallbackRef: string,
): Promise<PushResultItem> {
  const att = await findAttentionReasonByCommandId(tx, tenantId, commandId)
  return {
    id: commandId,
    outcome: 'ATTENTION',
    reason_class: att?.reasonClass === 'AUTHORIZATION' ? 'AUTHORIZATION' : 'STRUCTURAL',
    reason_code: att?.reasonCode ?? 'VALIDATION_FAILED',
    ref: att?.requestRef ?? fallbackRef,
  }
}

/** Parameters for the `idempotency_command` + `attention_item` rows written when a command is rejected. */
function attentionRecordParams(args: {
  cmd: PushCommandEnvelope
  device: SyncDeviceIdentity
  payloadHash: string
  payloadSize: number
  reasonClass: 'STRUCTURAL' | 'AUTHORIZATION'
  reasonCode: string
  detail: string | null | undefined
  requestRef: string
  appVersion: string | null
  receivedAtIso: string
  durationMs: number
  attemptCount?: number
}): AttentionRecordParams {
  const { cmd, device } = args
  return {
    attentionId: syncIdGen.newId(),
    commandId: cmd.id,
    tenantId: device.tenantId,
    deviceId: device.deviceId,
    registerId: device.registerId,
    outletId: device.outletId,
    commandType: cmd.type,
    schemaVersion: cmd.schema_version,
    deviceSeq: cmd.device_seq,
    payloadHash: args.payloadHash,
    payloadSize: args.payloadSize,
    rawPayload: cmd.payload ?? {},
    reasonClass: args.reasonClass,
    reasonCode: args.reasonCode,
    detail: sanitizeDetail(args.detail ?? undefined),
    blockedByCommandId: null,
    requestRef: args.requestRef,
    appVersion: args.appVersion,
    receivedAtIso: args.receivedAtIso,
    durationMs: args.durationMs,
    attemptCount: args.attemptCount,
  }
}


/**
 * Builds a DB-safe diagnostic string for `attention_item.detail` (shown to managers).
 * Never uses `Error.message` directly: Drizzle query errors embed SQL parameters
 * (customer names, phones, amounts) in their message. `serializeError` already redacts
 * those (NFR-OBS-002), so we reuse it and only keep type + sanitized message per cause level.
 */
export function safeFailureDetail(err: unknown): string {
  const parts: string[] = []
  let current: ReturnType<typeof serializeError> | undefined = serializeError(err)
  for (let depth = 0; current && depth < 3; depth += 1) {
    parts.push(`${current.type}: ${current.message}`)
    current = current.cause
  }
  return parts.join(' <- ')
}

/** Parses a command payload; every failure is reported as a `CommandRejected`, never another error type. */
function parseCommandOrReject(
  handler: ServerCommandHandler<unknown>,
  cmd: PushCommandEnvelope,
): unknown {
  try {
    const contractPayload = hasRegisteredCommandSchema(cmd.type)
      ? parseCommandPayload(cmd.type, cmd.schema_version, cmd.payload)
      : cmd.payload
    return handler.parse(contractPayload, cmd.schema_version)
  } catch (err: unknown) {
    if (err instanceof CommandRejected) throw err
    if (err instanceof ContractError) {
      const code = err.code === 'UPDATE_REQUIRED' ? 'SCHEMA_NOT_MIGRATABLE' : 'VALIDATION_FAILED'
      throw new CommandRejected('STRUCTURAL', code, err.message)
    }
    const msg =
      err instanceof ZodError
        ? err.issues[0]?.message ?? 'Invalid command payload'
        : err instanceof Error
          ? err.message
          : 'Invalid command payload'
    throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', msg)
  }
}

/** Holds the command while a parent is missing or in ATTENTION; rejects when a parent was dismissed. */
async function assertDependenciesSatisfied(
  tx: TenantTx,
  tenantId: string,
  dependsOn: readonly string[],
): Promise<void> {
  if (dependsOn.length === 0) return
  const parentMap = await findParentCommandStatuses(tx, tenantId, dependsOn)
  for (const depId of dependsOn) {
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

function assertCommandAllowedForDevice(
  cmd: PushCommandEnvelope,
  parsedPayload: unknown,
  device: SyncDeviceIdentity,
): void {
  assertPayloadMatchesDeviceScope(cmd.payload, device)
  assertPayloadMatchesDeviceScope(parsedPayload, device)
  if (device.registerType === 'WAITER' && WAITER_FORBIDDEN_TYPES.has(cmd.type)) {
    throw new CommandRejected(
      'AUTHORIZATION',
      'FORBIDDEN',
      `Waiter register cannot execute ${cmd.type}`,
    )
  }
}

function buildCommandContext(params: {
  cmd: PushCommandEnvelope
  appVersion: string | null
  clockOffsetMs: number
  receivedAtIso: string
  requestRef: string
  device: SyncDeviceIdentity
}): CommandContext {
  const { cmd } = params
  return {
    commandId: cmd.id,
    deviceSeq: cmd.device_seq,
    schemaVersion: cmd.schema_version,
    appVersion: params.appVersion,
    createdAtDevice: cmd.created_at_device,
    clockOffsetMs: params.clockOffsetMs,
    receivedAtIso: params.receivedAtIso,
    requestRef: params.requestRef,
    device: params.device,
  }
}

interface CommandFailureContext {
  cmd: PushCommandEnvelope
  device: SyncDeviceIdentity
  requestRef: string
  receivedAtIso: string
  startedAt: number
  maxFailureAttempts: number
  maxTransientAttempts: number
  recordAttention: (
    reasonClass: 'STRUCTURAL' | 'AUTHORIZATION',
    reasonCode: string,
    detail: string | null,
    attemptCount?: number,
  ) => Promise<PushResultItem>
}

/** Maps an error thrown while processing a pushed command to its result (ATTENTION, HELD or RETRY). */
async function resolveCommandFailure(
  err: unknown,
  failure: CommandFailureContext,
): Promise<PushResultItem> {
  const {
    cmd,
    device,
    receivedAtIso,
    startedAt,
    maxFailureAttempts,
    maxTransientAttempts,
    recordAttention,
  } = failure
  const meta = { requestRef: failure.requestRef }
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
  const safeDetail = safeFailureDetail(err)
  const attemptLimit = transientPg ? maxTransientAttempts : maxFailureAttempts

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

  if (attemptCount >= attemptLimit) {
    const detailPrefix = transientPg
      ? `Repeated transient DB failure (${trackedErrorCode})`
      : `Repeated internal handler error (${attemptCount} attempts)`
    const detail = `${detailPrefix}: ${safeDetail}`
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
        reason: `attempt_${attemptCount}_of_${attemptLimit}`,
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
      reason: `attempt_${attemptCount}_of_${attemptLimit}`,
      outcome: 'RETRY',
      durationMs,
    },
    'unexpected server error during command push',
  )
  return { id: cmd.id, outcome: 'RETRY' }
}

interface ProcessSingleCommandParams {
  device: SyncDeviceIdentity
  cmd: PushCommandEnvelope
  reqClockOffsetMs: number
  meta: { appVersion: string | null; requestRef: string }
  receivedAtIso: string
  lockTimeoutMs?: number
  maxFailureAttempts?: number
  maxTransientAttempts?: number
}

async function processSingleCommand(params: ProcessSingleCommandParams): Promise<PushResultItem> {
  const {
    device,
    cmd,
    reqClockOffsetMs,
    meta,
    receivedAtIso,
    lockTimeoutMs,
    maxFailureAttempts = 10,
    maxTransientAttempts = 200,
  } = params
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
            await insertAttentionRecord(
              tx,
              attentionRecordParams({
                cmd,
                device,
                payloadHash,
                payloadSize,
                reasonClass,
                reasonCode,
                detail,
                requestRef: meta.requestRef,
                appVersion: meta.appVersion,
                receivedAtIso,
                durationMs,
                attemptCount,
              }),
            )
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

      if (ONLINE_ONLY_COMMANDS.has(cmd.type)) {
        return recordAttention(
          'STRUCTURAL',
          'VALIDATION_FAILED',
          `Online-only command ${cmd.type} cannot be pushed via outbox`,
        )
      }

      const handler = getCommandHandler(cmd.type)
      if (!handler) {
        return recordAttention('STRUCTURAL', 'VALIDATION_FAILED', `unknown command type: ${cmd.type}`)
      }

      try {
        parsedPayload = parseCommandOrReject(handler, cmd)
      } catch (err: unknown) {
        if (err instanceof CommandRejected) {
          return recordAttention(err.reasonClass, err.reasonCode, err.detail ?? null)
        }
        throw err
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
            const claim = await claimOrLoadExisting(
              tx,
              outboxClaimParams({
                cmd,
                device,
                payloadHash,
                payloadSize,
                requestRef: meta.requestRef,
                appVersion: meta.appVersion,
                receivedAtIso,
              }),
            )

            if (!claim.claimed) {
              if (claim.existing.payloadHash !== payloadHash) {
                throw new HashMismatchReplayError()
              }

              await incrementAttemptCount(tx, device.tenantId, cmd.id)

              if (claim.existing.status === 'ACKED' || claim.existing.status === 'ACCEPTED_MANUAL') {
                return {
                  id: cmd.id,
                  outcome: 'ACK',
                  result: claim.existing.result,
                }
              }

              return attentionReplayItem(tx, device.tenantId, cmd.id, meta.requestRef)
            }

            await assertDependenciesSatisfied(tx, device.tenantId, cmd.depends_on)

            assertCommandAllowedForDevice(cmd, parsedPayload, device)

            const cmdCtx = buildCommandContext({
              cmd,
              appVersion: meta.appVersion,
              clockOffsetMs: reqClockOffsetMs,
              receivedAtIso,
              requestRef: meta.requestRef,
              device,
            })

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
        return resolveCommandFailure(err, {
          cmd,
          device,
          requestRef: meta.requestRef,
          receivedAtIso,
          startedAt,
          maxFailureAttempts,
          maxTransientAttempts,
          recordAttention,
        })
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
  const maxTransientAttempts = Math.max(
    maxFailureAttempts,
    deps?.maxTransientAttempts ?? getSyncPushMaxTransientAttempts(),
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

  const readClock = deps?.nowIso ?? (() => new Date().toISOString())

  for (const cmd of sorted) {
    // Server processing time is per command (BR-HPP-004, RSK-A31): a batch of many commands must not
    // share one request-level timestamp for `received_at` / `processed_at`.
    const commandReceivedAtIso = readClock()
    const item = await processSingleCommand({
      device,
      cmd,
      reqClockOffsetMs: req.clock_offset_ms,
      meta: { appVersion: safeAppVersion, requestRef: meta.requestRef },
      receivedAtIso: commandReceivedAtIso,
      lockTimeoutMs: deps?.lockTimeoutMs,
      maxFailureAttempts,
      maxTransientAttempts,
    })
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

export interface ProcessCommandAsOptions {
  tx?: TenantTx
  reqClockOffsetMs?: number
  receivedAtIso?: string
  appVersion?: string | null
  requestRef: string
  markStatus?: 'ACKED' | 'ACCEPTED_MANUAL'
  allowReplaceAttention?: boolean
  lockTimeoutMs?: number
}

export interface ProcessCommandAsResult {
  readonly item: PushResultItem
  readonly replay: boolean
}

/**
 * Executes a single command directly under a pre-resolved `SyncDeviceIdentity`
 * without verifying a live device Bearer token (used by `acceptManual` for revoked/
 * authorization-blocked items and `importPendingFile` for offline recovery files).
 */
export async function processCommandAs(
  identity: SyncDeviceIdentity,
  cmd: PushCommandEnvelope,
  opts: ProcessCommandAsOptions,
): Promise<ProcessCommandAsResult> {
  const startedAt = performance.now()
  const receivedAtIso = opts.receivedAtIso ?? new Date().toISOString()
  const safeAppVersion = normalizeSemverAppVersion(opts.appVersion ?? null)

  const handler = getCommandHandler(cmd.type)
  if (!handler) {
    throw new CommandRejected('STRUCTURAL', 'VALIDATION_FAILED', `unknown command type: ${cmd.type}`)
  }

  const parsedPayload = parseCommandOrReject(handler, cmd)

  const rawJsonText = JSON.stringify(cmd.payload ?? null) ?? 'null'
  const payloadSize = Buffer.byteLength(rawJsonText, 'utf8')
  const payloadHash = sha256Hex(
    canonicalJson({
      type: cmd.type,
      schema_version: cmd.schema_version,
      payload: parsedPayload,
    }),
  )

  const runInsideTx = async (tx: TenantTx): Promise<ProcessCommandAsResult> => {
    const claim = await claimOrLoadExisting(
      tx,
      outboxClaimParams({
        cmd,
        device: identity,
        payloadHash,
        payloadSize,
        requestRef: opts.requestRef,
        appVersion: safeAppVersion,
        receivedAtIso,
      }),
    )

    if (!claim.claimed) {
      const { existing } = claim
      if (existing.payloadHash !== payloadHash && !(opts.allowReplaceAttention && existing.status === 'ATTENTION')) {
        throw new HashMismatchReplayError()
      }

      if (existing.status === 'ACKED' || existing.status === 'ACCEPTED_MANUAL') {
        return {
          replay: true,
          item: { id: cmd.id, outcome: 'ACK', result: existing.result },
        }
      }

      if (!opts.allowReplaceAttention) {
        return {
          replay: true,
          item: await attentionReplayItem(tx, identity.tenantId, cmd.id, opts.requestRef),
        }
      }
    }

    await assertDependenciesSatisfied(tx, identity.tenantId, cmd.depends_on)

    assertCommandAllowedForDevice(cmd, parsedPayload, identity)

    const cmdCtx = buildCommandContext({
      cmd,
      appVersion: safeAppVersion,
      clockOffsetMs: opts.reqClockOffsetMs ?? 0,
      receivedAtIso,
      requestRef: opts.requestRef,
      device: identity,
    })

    const ackResult = await handler.handle(tx, cmdCtx, parsedPayload)
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    await completeIdempotencyAck(tx, {
      tenantId: identity.tenantId,
      commandId: cmd.id,
      status: opts.markStatus ?? 'ACKED',
      result: ackResult,
      processedAtIso: receivedAtIso,
      durationMs,
    })
    await deleteCommandFailureAttempt(tx, identity.tenantId, cmd.id)

    return {
      replay: false,
      item: {
        id: cmd.id,
        outcome: 'ACK',
        result: ackResult,
      },
    }
  }

  if (opts.tx) {
    return runInsideTx(opts.tx)
  }

  try {
    return await withTenant(identity.tenantId, runInsideTx, {
      statementTimeoutMs: 10_000,
      lockTimeoutMs: opts.lockTimeoutMs,
    })
  } catch (err: unknown) {
    if (err instanceof HoldDependencyError) {
      return { replay: false, item: { id: cmd.id, outcome: 'HELD' } }
    }
    if (err instanceof HashMismatchReplayError) {
      return {
        replay: false,
        item: {
          id: cmd.id,
          outcome: 'ATTENTION',
          reason_class: 'STRUCTURAL',
          reason_code: 'VALIDATION_FAILED',
          ref: opts.requestRef,
        },
      }
    }
    if (err instanceof CommandRejected) {
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
      await withTenant(identity.tenantId, async (tx) => {
        await insertAttentionRecord(
          tx,
          attentionRecordParams({
            cmd,
            device: identity,
            payloadHash,
            payloadSize,
            reasonClass: err.reasonClass,
            reasonCode: err.reasonCode,
            detail: err.detail,
            requestRef: opts.requestRef,
            appVersion: safeAppVersion,
            receivedAtIso,
            durationMs,
          }),
        )
      })
      return {
        replay: false,
        item: {
          id: cmd.id,
          outcome: 'ATTENTION',
          reason_class: err.reasonClass,
          reason_code: err.reasonCode,
          ref: opts.requestRef,
        },
      }
    }
    throw err
  }
}

export interface ExecuteOnlineCommandParams {
  device: SyncDeviceIdentity
  commandId: string
  commandType: 'HandOverBill' | 'AcceptBill' | 'CancelBillHandover'
  schemaVersion: number
  appVersion: string | null
  requestRef: string
  payload: unknown
  nowIso?: string
}

export interface OnlineCommandConflictError {
  readonly kind: 'HASH_MISMATCH' | 'UNSUPPORTED_SCHEMA'
  readonly message: string
}

/**
 * Executes a `channel='ONLINE'` command (`device_seq = NULL`) inside a single tenant transaction.
 * Only successful executions are persisted in `idempotency_command`; thrown errors roll back the claim.
 */
export async function executeOnlineCommand<TResult extends Record<string, unknown>>(
  params: ExecuteOnlineCommandParams,
  run: (tx: TenantTx, receivedAtIso: string) => Promise<TResult>,
): Promise<{ result: TResult; replay: boolean; serverTime: string }> {
  const startedAt = performance.now()
  const receivedAtIso = params.nowIso ?? new Date().toISOString()
  const safeAppVersion = normalizeSemverAppVersion(params.appVersion)
  const rawJsonText = JSON.stringify(params.payload ?? null) ?? 'null'
  const payloadSize = Buffer.byteLength(rawJsonText, 'utf8')
  const payloadHash = sha256Hex(
    canonicalJson({
      type: params.commandType,
      schema_version: params.schemaVersion,
      payload: params.payload ?? null,
    }),
  )

  return withTenant(
    params.device.tenantId,
    async (tx) => {
      const claim = await claimOrLoadExisting(tx, {
        commandId: params.commandId,
        tenantId: params.device.tenantId,
        deviceId: params.device.deviceId,
        registerId: params.device.registerId,
        outletId: params.device.outletId,
        commandType: params.commandType,
        channel: 'ONLINE',
        schemaVersion: params.schemaVersion,
        deviceSeq: null,
        payloadHash,
        payloadSize,
        requestRef: params.requestRef,
        appVersion: safeAppVersion,
        receivedAtIso,
      })

      if (!claim.claimed) {
        if (claim.existing.payloadHash !== payloadHash) {
          const err = new Error('Online idempotency key reused with mismatched payload')
          err.name = 'OnlineIdempotencyMismatchError'
          throw err
        }
        return {
          result: claim.existing.result as TResult,
          replay: true,
          serverTime: receivedAtIso,
        }
      }

      const ackResult = await run(tx, receivedAtIso)
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
      await completeIdempotencyAck(tx, {
        tenantId: params.device.tenantId,
        commandId: params.commandId,
        status: 'ACKED',
        result: ackResult,
        processedAtIso: receivedAtIso,
        durationMs,
      })

      return {
        result: ackResult,
        replay: false,
        serverTime: receivedAtIso,
      }
    },
    { statementTimeoutMs: 10_000 },
  )
}
