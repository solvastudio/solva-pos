import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { BootResult } from '~/pos/boot/boot'
import { getOutlet, listActiveStaff, listRegisters } from '~/pos/data/master.repo'
import { getMeta, setMeta } from '~/pos/data/meta.repo'
import { useShift } from '~/pos/hooks/use-shift'
import { clearSession, getSessionState } from '~/pos/session/session'
import { kickActiveSync } from '~/pos/sync'

export interface ClockBounds {
  trustedNowMs: number
  maxSeenMs: number
}

export function formatPosOutletLabel(
  outlet: { name: string; code: string },
  register: { name: string; code: string },
): string {
  return `${outlet.name || outlet.code} · ${register.name || register.code}`
}

export function usePosShellActions(tenant: string, bootResult: BootResult) {
  const navigate = useNavigate()
  const cleanSlug = tenant.toLowerCase()
  const sessionStaff = getSessionState().staff

  const db = bootResult.kind === 'READY' ? bootResult.db : null
  const device = bootResult.kind === 'READY' ? bootResult.device : null
  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant

  const { openShift } = useShift(db, device?.register_id ?? null)

  const [staffName, setStaffName] = useState('')
  const [staffMap, setStaffMap] = useState<ReadonlyMap<string, string>>(new Map())
  const [outletLabel, setOutletLabel] = useState<string | undefined>(undefined)
  const [clockBounds, setClockBounds] = useState<ClockBounds>(() => ({
    trustedNowMs: Date.now(),
    maxSeenMs: Date.now(),
  }))

  useEffect(() => {
    if (!db || !device || !sessionStaff) return
    let cancelled = false
    void Promise.all([
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
      listActiveStaff(db),
      getMeta(db, 'clock'),
    ]).then(([outlet, regs, staff, clockMeta]) => {
      if (cancelled) return
      const map = new Map<string, string>()
      for (const s of staff) {
        map.set(s.id, s.display_name)
      }
      setStaffMap(map)
      setStaffName(map.get(sessionStaff.staffId) ?? '')
      const reg = regs.find((r) => r.id === device.register_id)
      if (outlet && reg) {
        setOutletLabel(formatPosOutletLabel(outlet, reg))
      }
      const now = Date.now()
      const trustedNowMs = now + (clockMeta?.offset_ms ?? 0)
      const parsedMax = clockMeta?.max_seen_time ? Date.parse(clockMeta.max_seen_time) : Number.NaN
      const maxSeenMs = Number.isFinite(parsedMax) ? Math.max(parsedMax, trustedNowMs) : trustedNowMs
      setClockBounds({ trustedNowMs, maxSeenMs })
    })
    return () => {
      cancelled = true
    }
  }, [db, device, sessionStaff])

  function handleLocaleChange(next: 'id-ID' | 'en-US') {
    if (db) void setMeta(db, 'locale', next)
  }

  async function handleLockScreen() {
    if (db && sessionStaff) {
      await setMeta(db, 'idle_lock', {
        locked: true,
        locked_staff_id: sessionStaff.staffId,
        locked_at: new Date().toISOString(),
      })
    }
    clearSession()
    void navigate({ href: `/${cleanSlug}/pos/login` })
  }

  function handleSwitchStaff() {
    clearSession()
    void navigate({ href: `/${cleanSlug}/pos/login` })
  }

  function handleSyncNow() {
    void kickActiveSync()
  }

  return {
    db,
    device,
    tenantName,
    cleanSlug,
    sessionStaff,
    staffName: staffName || sessionStaff?.staffId || '',
    staffMap,
    outletLabel,
    openShift,
    clockBounds,
    handleLocaleChange,
    handleLockScreen,
    handleSwitchStaff,
    handleSyncNow,
    navigate,
  }
}
