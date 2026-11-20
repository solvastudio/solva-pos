import { afterEach, describe, expect, it } from 'vitest'
import { OpenShiftPayloadV1 } from '~/lib/contracts'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import type { ShiftRecord } from '../db/types'
import { listSendable } from './outbox.repo'
import {
  getOpenShiftForRegister,
  insertShiftAndOpenCommand,
  ShiftAlreadyOpenError,
} from './shift.repo'

const T1 = '0192a000-0000-7000-8000-00000000b101'
const OUT = '0192a000-0000-7000-8000-00000000b102'
const REG = '0192a000-0000-7000-8000-00000000b103'
const DEV = '0192a000-0000-7000-8000-00000000b104'
const STAFF = '0192a000-0000-7000-8000-00000000b105'
const SHIFT1 = '0192a000-0000-7000-8000-00000000b106'
const SHIFT2 = '0192a000-0000-7000-8000-00000000b107'
const CMD1 = '0192a000-0000-7000-8000-00000000b108'
const CMD2 = '0192a000-0000-7000-8000-00000000b109'

afterEach(async () => {
  await deleteTenantDbForTests(T1)
})

function makeShift(id: string): ShiftRecord {
  return {
    id,
    tenant_id: T1,
    outlet_id: OUT,
    register_id: REG,
    device_id: DEV,
    status: 'OPEN',
    opening_cash: 200_000,
    opened_by: STAFF,
    created_at_device: '2026-11-20T01:00:00.000Z',
    occurred_at: '2026-11-20T01:00:00.000Z',
    business_date: '2026-11-20',
    closed_at: null,
    counted_cash: null,
    sync_status: 'PENDING',
  }
}

describe('pos/data/shift.repo', () => {
  it('inserts shift + OpenShift outbox command atomically and prevents second OPEN shift', async () => {
    const db = await openTenantDb(T1)
    expect(await getOpenShiftForRegister(db, REG)).toBeNull()

    const payload: OpenShiftPayloadV1 = {
      shift: {
        id: SHIFT1,
        created_by: STAFF,
        created_at_device: '2026-11-20T01:00:00.000Z',
        clock_offset_ms: 0,
        occurred_at: '2026-11-20T01:00:00.000Z',
        business_date: '2026-11-20',
        opening_cash: 200_000,
      },
    }

    const res = await insertShiftAndOpenCommand(db, {
      shift: makeShift(SHIFT1),
      commandId: CMD1,
      createdAtDevice: '2026-11-20T01:00:00.000Z',
      payload,
    })

    expect(res.shift.id).toBe(SHIFT1)
    expect(res.command.type).toBe('OpenShift')
    expect(res.command.dependency_key).toBe(`shift:${SHIFT1}`)
    expect((await getOpenShiftForRegister(db, REG))?.id).toBe(SHIFT1)
    expect((await listSendable(db, { nowIso: '2026-11-20T01:01:00.000Z' }))).toHaveLength(1)

    await expect(
      insertShiftAndOpenCommand(db, {
        shift: makeShift(SHIFT2),
        commandId: CMD2,
        createdAtDevice: '2026-11-20T01:05:00.000Z',
        payload: { shift: { ...payload.shift, id: SHIFT2 } },
      }),
    ).rejects.toBeInstanceOf(ShiftAlreadyOpenError)

    expect(await db.shift.count()).toBe(1)
    expect(await db.outbox_command.count()).toBe(1)
  })
})
