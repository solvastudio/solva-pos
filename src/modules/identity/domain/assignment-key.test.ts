import { describe, expect, it } from 'vitest'
import { ALL_OUTLETS_KEY, assignmentOutletKey } from './assignment-key'

describe('assignmentOutletKey', () => {
  it('maps null to the all-outlets key and keeps outlet ids unchanged', () => {
    expect(assignmentOutletKey(null)).toBe(ALL_OUTLETS_KEY)
    expect(assignmentOutletKey('0190a1b2-0000-7000-8000-000000000001')).toBe(
      '0190a1b2-0000-7000-8000-000000000001',
    )
  })
})
