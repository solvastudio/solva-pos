import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseBlock } from '~/lib/contracts'
import { getMeta } from '../data/meta.repo'
import { enqueueCommandStandalone, markSendingSchemaHeld } from '../data/outbox.repo'
import { deleteTenantDbForTests, openTenantDb, type SolvaDb } from '../db/solva-db'
import { computeDeviceState, LEASE_MS } from '../session/device-state'
import {
  createPersistentUpdateController,
  isSafeMoment,
  UPDATE_SNOOZE_MS,
} from './update-manager'

const TENANT_ID = '01950000-0000-7000-8000-000000000054'
let openedDb: SolvaDb | null = null

afterEach(async () => {
  vi.useRealTimers()
  if (openedDb) {
    openedDb.close()
    openedDb = null
  }
  await deleteTenantDbForTests(TENANT_ID)
})

function softRelease(): ReleaseBlock {
  return {
    latest: '1.5.0',
    min_supported_app_version: '1.0.0',
    min_supported_schema_version: 1,
    is_mandatory: false,
    accept_previous_until: null,
    max_schema_version: 2,
  }
}

function hardRelease(): ReleaseBlock {
  return {
    latest: '2.0.0',
    min_supported_app_version: '1.0.0',
    min_supported_schema_version: 1,
    is_mandatory: true,
    accept_previous_until: null,
    max_schema_version: 2,
  }
}

describe('update-manager (SafeMoment, persistent 2h snooze, BR-VER-012 TAB-01/TAB-02)', () => {
  it('verifies all 16 boolean combinations of isSafeMoment', () => {
    const bools = [false, true] as const
    for (const cartActive of bools) {
      for (const paymentActive of bools) {
        for (const shiftOpen of bools) {
          for (const hasQueue of bools) {
            const expected = !cartActive && !paymentActive && !shiftOpen && !hasQueue
            expect(
              isSafeMoment({
                cartActive,
                paymentActive,
                shiftOpen,
                queueNonAcked: hasQueue ? 1 : 0,
              }),
            ).toBe(expected)
          }
        }
      }
    }
  })

  it('persists 2-hour soft update snooze across reload using injectable clock', async () => {
    let fakeNowMs = Date.parse('2026-11-20T10:00:00.000Z')

    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb

    const ctrl1 = createPersistentUpdateController({
      db,
      appVersion: '1.2.0',
      schemaVersion: 1,
      nowMs: () => fakeNowMs,
    })

    const s1 = await ctrl1.evaluate({
      release: softRelease(),
      hasWaitingWorker: true,
      context: { cartActive: false, paymentActive: false, shiftOpen: true },
    })
    expect(s1.status).toBe('available')
    expect(s1.promptVisible).toBe(true)
    expect(s1.canSnooze).toBe(true)

    // User clicks "Nanti" -> snooze 2 hours
    const s2 = await ctrl1.snooze()
    expect(s2.promptVisible).toBe(false)

    // Reload: brand new controller instance reads persisted meta.update
    const ctrl2 = createPersistentUpdateController({
      db,
      appVersion: '1.2.0',
      schemaVersion: 1,
      nowMs: () => fakeNowMs,
    })
    fakeNowMs += 60 * 60 * 1000 // +1h: still snoozed
    const s3 = await ctrl2.evaluate({
      release: softRelease(),
      hasWaitingWorker: true,
      context: { cartActive: false, paymentActive: false, shiftOpen: false },
    })
    expect(s3.promptVisible).toBe(false)

    // +1h more (>= 2h total): prompt reappears!
    fakeNowMs += UPDATE_SNOOZE_MS / 2 + 1000
    const s4 = await ctrl2.evaluate({
      release: softRelease(),
      hasWaitingWorker: true,
      context: { cartActive: false, paymentActive: false, shiftOpen: false },
    })
    expect(s4.promptVisible).toBe(true)

    // Hidden again during checkout/payment
    const s5 = await ctrl2.evaluate({
      release: softRelease(),
      hasWaitingWorker: true,
      context: { cartActive: true, paymentActive: true, shiftOpen: true },
    })
    expect(s5.promptVisible).toBe(false)

    const logs = await db.device_log.toArray()
    expect(logs.some((l) => l.code === 'UPDATE_REJECTED')).toBe(true)
  })

  it('defers hard updates mid-shift/non-SCHEMA queue and excludes SCHEMA-held commands from blocking safe moment', async () => {
    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb

    const sendSkipWaiting = vi.fn()
    const reloadPage = vi.fn()
    const ctrl = createPersistentUpdateController({
      db,
      appVersion: '1.2.0',
      schemaVersion: 1,
      transport: { sendSkipWaiting, reloadPage },
    })

    // Seed a SCHEMA-held command (must NOT deadlock updates, ARCH §9.6.4)
    const heldCmd = await enqueueCommandStandalone(db, {
      type: 'AppendAudit',
      payload: { entry: { id: 'a-held' } },
      schemaVersion: 1,
      registerId: 'reg-1',
      createdAtDevice: '2026-11-20T01:00:00.000Z',
    })
    await markSendingSchemaHeld(db, [heldCmd.id], 'UPDATE_REQUIRED')

    // Shift open => hard update stays PENDING_APPLY and does NOT trigger skipWaiting
    const midShift = await ctrl.evaluate({
      release: hardRelease(),
      context: { cartActive: false, paymentActive: false, shiftOpen: true },
    })
    expect(midShift.status).toBe('pending_apply')
    expect(midShift.canSnooze).toBe(false)
    expect(sendSkipWaiting).not.toHaveBeenCalled()

    // Shift closes, only SCHEMA-held item in outbox => safe moment applies immediately!
    const safeRes = await ctrl.evaluate({
      release: hardRelease(),
      context: { cartActive: false, paymentActive: false, shiftOpen: false },
    })
    expect(safeRes.status).toBe('applying')
    expect(sendSkipWaiting).toHaveBeenCalledTimes(1)

    expect(ctrl.handleControllerChange()).toBe(true)
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('satisfies BR-VER-012 TAB-01 (lease lock is not treated as outdated client) & TAB-02 (idle lock vs open shift + N-1 preserved)', async () => {
    openedDb = await openTenantDb(TENANT_ID)
    const db = openedDb

    // TAB-01: device past 7-day lease fails into LOCKED_LEASE, not UPDATE_REQUIRED
    const t0 = Date.parse('2026-11-01T00:00:00.000Z')
    const state = computeDeviceState({
      hasDevice: true,
      trustedNowMs: t0 + LEASE_MS + 10_000,
      lastSuccessSyncAtMs: t0,
      maxSeenTimeMs: t0,
      flags: { updateRequired: false },
    })
    expect(state.kind).toBe('LOCKED_LEASE')

    // TAB-02: idle-locked while shiftOpen=true MUST NOT auto-apply hard update,
    // and manual apply while shiftOpen=true returns false; pending N-1 commands remain intact.
    const pendingNMinus1 = await enqueueCommandStandalone(db, {
      type: 'AppendAudit',
      payload: { entry: { id: 'keep-n-1' } },
      schemaVersion: 1,
      registerId: 'reg-1',
      createdAtDevice: '2026-11-20T01:00:00.000Z',
    })

    const sendSkipWaiting = vi.fn()
    const ctrl = createPersistentUpdateController({
      db,
      appVersion: '1.2.0',
      schemaVersion: 1,
      transport: { sendSkipWaiting },
    })

    const sLockedOpenShift = await ctrl.evaluate({
      release: hardRelease(),
      context: {
        cartActive: false,
        paymentActive: false,
        shiftOpen: true,
        idleLocked: true,
      },
    })
    expect(sLockedOpenShift.status).toBe('pending_apply')
    expect(sendSkipWaiting).not.toHaveBeenCalled()

    // Manual button click with shift closed & empty queue works on locked screen
    await db.outbox_command.update(pendingNMinus1.id, { status: 'ACKED' })
    const applied = await ctrl.applyNow({
      context: {
        cartActive: false,
        paymentActive: false,
        shiftOpen: false,
        idleLocked: true,
      },
    })
    expect(applied).toBe(true)
    expect(sendSkipWaiting).toHaveBeenCalledTimes(1)
    expect((await getMeta(db, 'update'))?.status).toBe('APPLYING')
    expect(await db.outbox_command.get(pendingNMinus1.id)).toBeDefined()
  })
})
