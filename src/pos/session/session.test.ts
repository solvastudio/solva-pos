import { afterEach, describe, expect, it } from 'vitest'
import { deleteTenantDbForTests, openTenantDb } from '../db/solva-db'
import { permissionForAction } from './permissions'
import {
  clearSession,
  getSessionState,
  hasPermission,
  setPaymentInProgress,
  setSupervisorDialogOpen,
  startSession,
} from './session'

const TENANT_ID = '01950000-0000-7000-8000-00000000a201'
const OUTLET_ID = '01950000-0000-7000-8000-00000000b201'
const STAFF_ID = '01950000-0000-7000-8000-00000000c201'
const ROLE_ID = '01950000-0000-7000-8000-00000000d201'

afterEach(async () => {
  clearSession()
  await deleteTenantDbForTests(TENANT_ID)
})

describe('pos/session/session & permissions', () => {
  it('loads in-memory StaffSessionContext from Dexie role permissions and clears cleanly', async () => {
    const db = await openTenantDb(TENANT_ID)
    await db.app_user.put({ id: STAFF_ID, display_name: 'Kasir Ani', is_active: true, deleted_at: null })
    await db.staff_pin.put({
      id: '01950000-0000-7000-8000-00000000e201',
      user_id: STAFF_ID,
      device_salt: 'abc',
      pin_hash: 'def',
      kdf_algo: 'ARGON2ID',
      kdf_params: { memorySize: 1024, iterations: 1, parallelism: 1, hashLength: 32 },
      kdf_salt: 'ghi',
      pin_epoch: 1,
      deleted_at: null,
    })
    await db.role.put({
      id: ROLE_ID,
      code: 'CASHIER',
      name: 'Kasir',
      discount_limit_pct: '10.0000',
      deleted_at: null,
    })
    await db.role_permission.bulkPut([
      { id: 'rp1', role_id: ROLE_ID, permission_code: 'sale.create' },
      { id: 'rp2', role_id: ROLE_ID, permission_code: 'discount.manual' },
    ])
    await db.user_outlet.put({
      id: 'uo1',
      user_id: STAFF_ID,
      outlet_id: OUTLET_ID,
      role_id: ROLE_ID,
      deleted_at: null,
    })

    const session = await startSession(db, STAFF_ID, OUTLET_ID)
    expect(session.displayName).toBe('Kasir Ani')
    expect(session.discountLimitPct).toBe(10)
    expect(hasPermission(permissionForAction('createSale'))).toBe(true)
    expect(hasPermission(permissionForAction('voidSale'))).toBe(false)

    setPaymentInProgress(true)
    setSupervisorDialogOpen(true)
    expect(getSessionState().paymentInProgress).toBe(true)
    expect(getSessionState().supervisorDialogOpen).toBe(true)

    clearSession()
    expect(getSessionState().staff).toBeNull()
    expect(hasPermission('sale.create')).toBe(false)
  })
})
