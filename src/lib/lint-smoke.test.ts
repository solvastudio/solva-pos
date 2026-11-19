import { describe, expect, it } from 'vitest'
import { add } from './lint-smoke'

describe('lint-smoke', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5)
  })
})
