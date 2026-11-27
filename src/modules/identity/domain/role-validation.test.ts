import { describe, expect, it } from 'vitest'
import { parseDiscountInput, validateRoleDraft } from './role-validation'

describe('parseDiscountInput', () => {
  it('parses numbers inside 0..100', () => {
    expect(parseDiscountInput('0')).toBe(0)
    expect(parseDiscountInput(' 12.5 ')).toBe(12.5)
    expect(parseDiscountInput('100')).toBe(100)
  })

  it('rejects empty, non-numeric and out-of-range input', () => {
    for (const value of ['', '  ', 'abc', '-1', '100.1']) {
      expect(parseDiscountInput(value)).toBeNull()
    }
  })
})

describe('validateRoleDraft', () => {
  const base = { name: 'Kasir', discountInput: '5', permissionCount: 2 }
  const rules = {
    actorDiscountLimitPct: 10,
    enforceActorLimit: true,
    checkDiscount: true,
    checkPermissions: true,
  }

  it('accepts a complete draft', () => {
    expect(validateRoleDraft(base, rules)).toEqual([])
  })

  it('reports every problem in field order', () => {
    expect(validateRoleDraft({ name: ' ', discountInput: 'x', permissionCount: 0 }, rules)).toEqual([
      { field: 'name' },
      { field: 'discount', reason: 'invalid' },
      { field: 'permissions' },
    ])
  })

  it('rejects a discount above the actor limit only when enforced', () => {
    const draft = { ...base, discountInput: '20' }
    expect(validateRoleDraft(draft, rules)).toEqual([
      { field: 'discount', reason: 'aboveActor', limit: 10 },
    ])
    expect(validateRoleDraft(draft, { ...rules, enforceActorLimit: false })).toEqual([])
  })

  it('skips discount and permission checks when they are disabled', () => {
    const draft = { name: 'Salinan', discountInput: '', permissionCount: 0 }
    expect(
      validateRoleDraft(draft, { ...rules, checkDiscount: false, checkPermissions: false }),
    ).toEqual([])
  })
})
