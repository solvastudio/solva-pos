import { describe, expect, it } from 'vitest'
import { ROLE_DEFAULTS } from './default-roles'
import { isPermissionCode, PERMISSION_CODES, PERMISSION_DEFINITIONS } from './permissions'

describe('identity/domain default roles and permission matrix', () => {
  it('defines matching PERMISSION_CODES and PERMISSION_DEFINITIONS without duplicates', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
    expect(PERMISSION_DEFINITIONS.map((d) => d.code)).toEqual([...PERMISSION_CODES])
    for (const def of PERMISSION_DEFINITIONS) {
      expect(isPermissionCode(def.code)).toBe(true)
      expect(def.description).toBe(`permission.${def.code}`)
    }
    expect(isPermissionCode('nonexistent.perm')).toBe(false)
  })

  it('ensures every role permission belongs to PERMISSION_CODES and no permission is orphaned', () => {
    const used = new Set<string>()
    for (const role of ROLE_DEFAULTS) {
      for (const perm of role.permissions) {
        expect(isPermissionCode(perm)).toBe(true)
        used.add(perm)
      }
    }

    for (const code of PERMISSION_CODES) {
      expect(used.has(code), `Orphaned permission: ${code}`).toBe(true)
    }
  })

  it('grants OWNER all permissions and verifies discount limits and WAITER boundaries', () => {
    const byCode = new Map(ROLE_DEFAULTS.map((r) => [r.code, r]))

    const owner = byCode.get('OWNER')!
    expect(owner.discountLimitPct).toBe('100.0000')
    expect(new Set(owner.permissions)).toEqual(new Set(PERMISSION_CODES))

    const manager = byCode.get('MANAGER')!
    expect(manager.discountLimitPct).toBe('50.0000')
    expect(manager.permissions).not.toContain('user.invite')
    expect(manager.permissions).not.toContain('flag.manage')
    expect(manager.permissions).toContain('role.manage')

    const supervisor = byCode.get('SUPERVISOR')!
    expect(supervisor.permissions).not.toContain('role.manage')

    const cashier = byCode.get('CASHIER')!
    expect(cashier.discountLimitPct).toBe('5.0000')
    expect(cashier.permissions).toContain('bill.accept')
    expect(cashier.permissions).not.toContain('bill.handover')

    const waiter = byCode.get('WAITER')!
    expect(waiter.discountLimitPct).toBe('0.0000')
    expect(waiter.permissions).not.toContain('sale.create')
    expect(waiter.permissions).not.toContain('shift.open_close')
    expect(waiter.permissions).not.toContain('cash.in_out')
    expect(waiter.permissions).toContain('bill.handover')
  })
})
