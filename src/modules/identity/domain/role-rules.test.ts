import { describe, expect, it } from 'vitest'
import type { PermissionCode } from './permissions'
import { diffPermissionCodes, permissionsActorLacks, roleExceedsActor } from './role-rules'

const held = new Set<PermissionCode>(['bill.edit', 'report.view'])

describe('diffPermissionCodes', () => {
  it('returns sorted added and removed codes', () => {
    expect(diffPermissionCodes(new Set(['b', 'a']), new Set(['c', 'a']))).toEqual({
      added: ['c'],
      removed: ['b'],
    })
  })

  it('returns empty lists for equal sets', () => {
    expect(diffPermissionCodes(new Set(['a']), new Set(['a']))).toEqual({ added: [], removed: [] })
  })
})

describe('permissionsActorLacks', () => {
  it('lists the codes the actor does not hold', () => {
    expect(permissionsActorLacks(['bill.edit', 'flag.manage'], held)).toEqual(['flag.manage'])
    expect(permissionsActorLacks([], held)).toEqual([])
  })
})

describe('roleExceedsActor', () => {
  const actor = { permissions: held, discountLimitPct: 10 }

  it('is false for a subset of permissions with a discount limit that is not higher', () => {
    expect(roleExceedsActor({ permissions: ['bill.edit'], discountLimitPct: 10 }, actor)).toBe(false)
  })

  it('is true when the role has a permission the actor lacks', () => {
    expect(roleExceedsActor({ permissions: ['flag.manage'], discountLimitPct: 0 }, actor)).toBe(true)
  })

  it('is true when the role discount limit is higher than the actor limit', () => {
    expect(roleExceedsActor({ permissions: ['bill.edit'], discountLimitPct: 11 }, actor)).toBe(true)
  })
})
