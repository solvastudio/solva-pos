import { allocateLR, ZERO, type Money } from '~/lib/kernel'

/**
 * Allocates an integer rupiah component across weighted slots using Largest Remainder (BR-MNY-006).
 * Returns all zeros cleanly when `total === 0` or when all weights sum to 0 (with `total === 0`).
 */
export function allocateComponentLR(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    return []
  }
  if (total === 0) {
    return weights.map(() => ZERO)
  }
  return allocateLR(total, weights)
}
