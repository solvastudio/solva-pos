import { describe, expect, it } from 'vitest'
import { toMoney, ZERO } from '~/lib/kernel'
import { allocateComponentLR } from './allocate'

describe('sales-calc/allocate', () => {
  it('allocates zero cleanly and matches V-03 LR remainder ordering', () => {
    expect(allocateComponentLR(ZERO, [100, 200])).toEqual([0, 0])
    expect(allocateComponentLR(toMoney(100), [])).toEqual([])
    expect(allocateComponentLR(toMoney(10000), [70000, 16000, 44500])).toEqual([5364, 1226, 3410])
    expect(allocateComponentLR(toMoney(11146), [37000, 16000, 48330])).toEqual([4070, 1760, 5316])
  })
})
