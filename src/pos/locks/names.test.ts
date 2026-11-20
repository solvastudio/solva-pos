import { describe, expect, it } from 'vitest'
import {
  channelName,
  lockName,
  printLockName,
  REGISTRY_DB_NAME,
  resourceLockName,
  storageKey,
  tenantDbName,
} from './names'

describe('pos/locks/names', () => {
  it('formats tenant-isolated names cleanly and keeps printLock origin-wide', () => {
    const tid = '0192a000-0000-7000-8000-00000000a001'
    const did = '0192a000-0000-7000-8000-00000000d001'

    expect(REGISTRY_DB_NAME).toBe('solva-registry')
    expect(tenantDbName(tid)).toBe(`solva-pos:${tid}`)
    expect(lockName(tid, did)).toBe(`solva:${tid}:instance:${did}`)
    expect(resourceLockName(tid, did, 'finalize:reg1')).toBe(
      `solva:${tid}:res:${did}:finalize:reg1`,
    )
    expect(channelName(tid, did)).toBe(`solva:${tid}:${did}`)
    expect(storageKey(tid, 'bootfail')).toBe(`solva:${tid}:bootfail`)
    expect(storageKey(tid, 'draft', 'ui')).toBe(`solva:${tid}:draft:ui`)
    expect(printLockName('usb-01')).toBe('print:usb-01')
  })
})
