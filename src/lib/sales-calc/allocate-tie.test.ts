import { describe, expect, it } from 'vitest'
import { toMoney } from '~/lib/kernel'
import { allocateComponentLR } from './allocate'

describe('LR tie-break by line number (BR-MNY-006 step 4)', () => {
  it('fractional ties go to the line with the smaller number, not the array position', () => {
    // Two equal weights (16 & 16), total 19 ⇒ base 9 + 9, remainder 1 goes to line number 1.
    const inOrder = allocateComponentLR(toMoney(19), [16, 16], [1, 2])
    const reversed = allocateComponentLR(toMoney(19), [16, 16], [2, 1])
    expect(inOrder).toEqual([toMoney(10), toMoney(9)])
    // Presentation order is reversed, but line number 1 still receives the remainder.
    expect(reversed).toEqual([toMoney(9), toMoney(10)])
  })

  it('without tieRank, the old behaviour (index order) still applies to existing callers', () => {
    expect(allocateComponentLR(toMoney(19), [16, 16])).toEqual([toMoney(10), toMoney(9)])
  })
})
