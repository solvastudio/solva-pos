import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  PushCommandEnvelope,
  hasRegisteredCommandSchema,
  parseCommandPayload,
} from '~/lib/contracts'
import { withTenantReadOnly } from '~/server/db'
import { AppError } from '~/server/error-classify'
import { createLogger } from '~/server/log'
import type { SyncDeviceIdentity } from '../domain/command-types'
import type { PendingImportErrorItem, PendingImportResult } from '../shared'
import { findDeviceAndRegisterForImport } from './attention.repo'
import { hasSyncActorPermission, type SyncAdminActor } from './attention.service'
import { processCommandAs } from './push.service'

const log = createLogger('sync.pending_import')

export const MAX_PENDING_IMPORT_BYTES = 5 * 1024 * 1024

const PendingHeaderSchema = z.object({
  device_id: z.string().uuid(),
  register_id: z.string().uuid(),
  app_version: z.string().min(1).max(30).optional().default('v1.0.0'),
  schema_version: z.number().int().positive(),
  exported_at: z.string().optional(),
  count: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
})

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Server-side importer for offline-exported `.jsonl` recovery files (`FLOW-16`).
 * Validates SHA-256 integrity, device/register ownership & outlet scope (allowing
 * revoked devices), validates each command envelope + Zod schema, skips stale
 * `ReportPinState` commands, and replays commands sequentially by `device_seq`.
 */
export async function importPendingFile(
  actor: SyncAdminActor,
  input: { fileText: string },
  deps?: { nowIso?: () => string; requestRef?: string },
): Promise<PendingImportResult> {
  if (!hasSyncActorPermission(actor, 'user.manage')) {
    throw new AppError('FORBIDDEN', 'Missing permission user.manage')
  }

  const byteLen = Buffer.byteLength(input.fileText, 'utf8')
  if (byteLen === 0) {
    throw new AppError('VALIDATION_FAILED', 'Pending export file is empty')
  }
  if (byteLen > MAX_PENDING_IMPORT_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Pending export file exceeds 5 MB limit')
  }

  const lines = input.fileText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Missing header line in pending export file')
  }

  let parsedHeaderRaw: unknown
  try {
    parsedHeaderRaw = JSON.parse(lines[0]!)
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Malformed JSON header line')
  }
  const headerParsed = PendingHeaderSchema.safeParse(parsedHeaderRaw)
  if (!headerParsed.success) {
    throw new AppError('VALIDATION_FAILED', 'Invalid pending export header structure')
  }
  const header = headerParsed.data

  const commandLines = lines.slice(1)
  if (commandLines.length !== header.count) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Command count mismatch: header claims ${header.count}, found ${commandLines.length}`,
    )
  }

  const actualSha256 = sha256Hex(commandLines.join('\n'))
  if (actualSha256 !== header.sha256.toLowerCase()) {
    throw new AppError('VALIDATION_FAILED', 'File SHA-256 checksum mismatch')
  }

  // Verify device + register belong to this tenant & are within actor's outlet scope.
  const deviceInfo = await withTenantReadOnly(actor.tenantId, (tx) =>
    findDeviceAndRegisterForImport(tx, actor.tenantId, header.device_id, header.register_id),
  )
  if (!deviceInfo) {
    throw new AppError('FORBIDDEN', 'Export file device/register does not belong to this tenant')
  }
  const allowedOutlets = actor.outletIds ?? null
  if (allowedOutlets !== null && !allowedOutlets.includes(deviceInfo.outletId)) {
    throw new AppError('FORBIDDEN', 'Export file outlet is outside manager scope')
  }

  const commands: PushCommandEnvelope[] = []
  for (let i = 0; i < commandLines.length; i += 1) {
    let rawCmd: unknown
    try {
      rawCmd = JSON.parse(commandLines[i]!)
    } catch {
      throw new AppError('VALIDATION_FAILED', `Malformed JSON at command line ${i + 2}`)
    }
    const envParsed = PushCommandEnvelope.safeParse(rawCmd)
    if (!envParsed.success) {
      throw new AppError('VALIDATION_FAILED', `Invalid command envelope at line ${i + 2}`)
    }
    const env = envParsed.data
    if (hasRegisteredCommandSchema(env.type)) {
      try {
        parseCommandPayload(env.type, env.schema_version, env.payload)
      } catch (err) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Invalid command payload for ${env.id}: ${err instanceof Error ? err.message : 'bad payload'}`,
        )
      }
    }
    commands.push(env)
  }

  commands.sort((a, b) => a.device_seq - b.device_seq)

  const identity: SyncDeviceIdentity = {
    tenantId: actor.tenantId,
    deviceId: deviceInfo.deviceId,
    registerId: deviceInfo.registerId,
    outletId: deviceInfo.outletId,
    registerType: deviceInfo.registerType,
  }

  const receivedAtIso = (deps?.nowIso ?? (() => new Date().toISOString()))()
  const requestRef = deps?.requestRef ?? `imp-${deviceInfo.deviceId.slice(0, 8)}`

  let acked = 0
  let replayed = 0
  let attention = 0
  let held = 0
  let skipped = 0
  const errors: PendingImportErrorItem[] = []

  for (const cmd of commands) {
    // Never overwrite fresh server staff_pin_state with stale offline ReportPinState rows
    if (cmd.type === 'ReportPinState') {
      skipped += 1
      continue
    }

    const res = await processCommandAs(identity, cmd, {
      receivedAtIso,
      appVersion: header.app_version,
      requestRef,
    })

    if (res.replay) {
      replayed += 1
    } else if (res.item.outcome === 'ACK') {
      acked += 1
    } else if (res.item.outcome === 'ATTENTION') {
      attention += 1
      errors.push({
        commandId: cmd.id,
        deviceSeq: cmd.device_seq,
        code: res.item.reason_code,
        message: `Ref ${res.item.ref}`,
      })
    } else if (res.item.outcome === 'HELD') {
      held += 1
      errors.push({
        commandId: cmd.id,
        deviceSeq: cmd.device_seq,
        code: 'HELD',
        message: 'Waiting for unresolved dependency',
      })
    }
  }

  log.info(
    {
      tenantId: actor.tenantId,
      deviceId: deviceInfo.deviceId,
      registerId: deviceInfo.registerId,
      outcome: 'IMPORTED',
    },
    'pending export file imported',
  )

  return {
    deviceId: deviceInfo.deviceId,
    registerId: deviceInfo.registerId,
    total: commands.length,
    acked,
    replayed,
    attention,
    held,
    skipped,
    errors,
  }
}
