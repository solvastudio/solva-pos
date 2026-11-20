import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PosShell } from '~/components/layout/PosShell'
import { Numpad } from '~/components/pos/Numpad'
import { PinDots } from '~/components/pos/PinDots'
import { StaffPicker } from '~/components/pos/StaffPicker'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'
import { CircleAlert, Lock, LockKeyhole } from '~/components/ui/icons'
import { APP_VERSION } from '~/lib/app-version'
import { getOutlet, listRegisters } from '~/pos/data/master.repo'
import { getMeta, setMeta } from '~/pos/data/meta.repo'
import {
  getStaffPinRecord,
  listPosStaffWithPins,
  listStaffPinStatesForDevice,
  type PosStaffSummary,
} from '~/pos/data/pin.repo'
import type { StaffPinStateRecord } from '~/pos/db/types'
import { applyEpoch, createInitialPinState, isLocked } from '~/pos/session/pin-state'
import { clearSession, startSession } from '~/pos/session/session'

const LazySupervisorPinDialog = lazy(() =>
  import('~/components/pos/SupervisorPinDialog').then((m) => ({
    default: m.SupervisorPinDialog,
  })),
)

export const Route = createFileRoute('/$tenant/pos/login')({
  ssr: false,
  component: PosLoginRouteComponent,
})

function computeEffectiveClock(
  clock: { offset_ms: number; max_seen_time: string } | null,
): { trustedNowMs: number; maxSeenMs: number } {
  const now = Date.now()
  const trustedNowMs = now + (clock?.offset_ms ?? 0)
  const parsedMax = clock?.max_seen_time ? Date.parse(clock.max_seen_time) : Number.NaN
  const maxSeenMs = Number.isFinite(parsedMax) ? Math.max(parsedMax, trustedNowMs) : trustedNowMs
  return { trustedNowMs, maxSeenMs }
}

function PosLoginRouteComponent() {
  const { tenant } = Route.useParams()
  const { bootResult } = Route.useRouteContext()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [staff, setStaff] = useState<PosStaffSummary[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [registerLabel, setRegisterLabel] = useState<string | undefined>(undefined)
  const [idleLockStaffId, setIdleLockStaffId] = useState<string | null>(null)
  const [lockStates, setLockStates] = useState<Map<string, StaffPinStateRecord>>(new Map())
  const [epochByUser, setEpochByUser] = useState<Map<string, number>>(new Map())
  const [clockMeta, setClockMeta] = useState<{ offset_ms: number; max_seen_time: string } | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [minuteTick, setMinuteTick] = useState(0)

  const tenantName =
    bootResult.kind === 'READY' && bootResult.tenant?.name ? bootResult.tenant.name : tenant
  const appVersion = typeof APP_VERSION === 'string' ? APP_VERSION : 'dev'

  const loadLoginState = useCallback(async () => {
    if (bootResult.kind !== 'READY') return
    const { db, device } = bootResult

    const [staffList, states, idleMeta, clock, outlet, regs] = await Promise.all([
      listPosStaffWithPins(db, device.outlet_id),
      listStaffPinStatesForDevice(db, device.device_id),
      getMeta(db, 'idle_lock'),
      getMeta(db, 'clock'),
      getOutlet(db, device.outlet_id),
      listRegisters(db, device.outlet_id),
    ])

    const epochs = new Map<string, number>()
    for (const s of staffList) {
      const rec = await getStaffPinRecord(db, s.userId)
      if (rec) epochs.set(s.userId, rec.pin_epoch)
    }

    const reg = regs.find((r) => r.id === device.register_id)
    if (outlet && reg) {
      setRegisterLabel(`${outlet.code} · ${reg.code}`)
    }

    setClockMeta(clock ? { offset_ms: clock.offset_ms, max_seen_time: clock.max_seen_time } : null)
    setEpochByUser(epochs)
    setLockStates(states)
    setStaff(staffList)

    if (idleMeta?.locked && idleMeta.locked_staff_id) {
      setIdleLockStaffId(idleMeta.locked_staff_id)
      setSelectedUserId(idleMeta.locked_staff_id)
    } else {
      setIdleLockStaffId(null)
    }
  }, [bootResult])

  useEffect(() => {
    void loadLoginState()
  }, [loadLoginState])

  // Refresh remaining lock minutes once per minute without displaying wall-clock seconds
  useEffect(() => {
    const id = setInterval(() => {
      setMinuteTick((n) => n + 1)
    }, 60_000)
    return () => {
      clearInterval(id)
    }
  }, [])

  const { trustedNowMs, maxSeenMs } = useMemo(
    () => computeEffectiveClock(clockMeta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clockMeta, minuteTick, statusError],
  )

  const selectedLockEval = useMemo(() => {
    if (bootResult.kind !== 'READY' || !selectedUserId) {
      return { locked: false, minutesLeft: 0, needsReset: false }
    }
    const raw =
      lockStates.get(selectedUserId) ??
      createInitialPinState(
        selectedUserId,
        bootResult.device.device_id,
        epochByUser.get(selectedUserId) ?? 1,
      )
    const ep = epochByUser.get(selectedUserId) ?? 1
    const afterEp = applyEpoch(raw, ep).state
    return isLocked(afterEp, trustedNowMs, maxSeenMs)
  }, [bootResult, epochByUser, lockStates, maxSeenMs, selectedUserId, trustedNowMs])

  const lockedUserIds = useMemo(() => {
    const out = new Set<string>()
    if (bootResult.kind !== 'READY') return out
    for (const member of staff) {
      const raw = lockStates.get(member.userId)
      if (!raw) continue
      const ep = epochByUser.get(member.userId) ?? 1
      const afterEp = applyEpoch(raw, ep).state
      if (isLocked(afterEp, trustedNowMs, maxSeenMs).locked) {
        out.add(member.userId)
      }
    }
    return out
  }, [bootResult, epochByUser, lockStates, maxSeenMs, staff, trustedNowMs])

  const selectedStaff = useMemo(
    () => staff.find((s) => s.userId === selectedUserId) ?? null,
    [selectedUserId, staff],
  )

  const lockBannerMessage = useMemo(() => {
    if (!selectedLockEval.locked) return null
    return selectedLockEval.needsReset
      ? t('pos.login.needsReset')
      : t('pos.login.pinLocked', { menit: selectedLockEval.minutesLeft })
  }, [selectedLockEval, t])

  const handleDigit = useCallback(
    (d: string) => {
      if (verifying || selectedLockEval.locked || !selectedUserId) return
      setStatusError(null)
      setPin((prev) => (prev.length >= 6 ? prev : prev + d))
    },
    [selectedLockEval.locked, selectedUserId, verifying],
  )

  const handleBackspace = useCallback(() => {
    if (verifying || selectedLockEval.locked || !selectedUserId) return
    setPin((prev) => prev.slice(0, -1))
  }, [selectedLockEval.locked, selectedUserId, verifying])

  const handleSubmitPin = useCallback(async () => {
    if (bootResult.kind !== 'READY' || !selectedUserId || pin.length < 4 || verifying) return
    setVerifying(true)
    setStatusError(null)

    try {
      const { db, device } = bootResult
      const clock = await getMeta(db, 'clock')
      const { trustedNowMs: nowMs, maxSeenMs: maxMs } = computeEffectiveClock(
        clock ? { offset_ms: clock.offset_ms, max_seen_time: clock.max_seen_time } : null,
      )

      const { verifyStaffPin } = await import('~/pos/session/pin-verify')
      const res = await verifyStaffPin(db, {
        userId: selectedUserId,
        pin,
        deviceId: device.device_id,
        registerId: device.register_id,
        trustedNowMs: nowMs,
        maxSeenMs: maxMs,
      })

      await loadLoginState()

      if (res.ok) {
        await startSession(db, res.staffId, device.outlet_id)
        await setMeta(db, 'idle_lock', {
          locked: false,
          locked_staff_id: null,
          locked_at: null,
        })
        setPin('')
        void navigate({ href: `/${tenant.toLowerCase()}/pos/` })
        return
      }

      setPin('')
      if (res.reason === 'LOCKED' && res.locked) {
        setStatusError(
          'needsReset' in res.locked
            ? t('pos.login.needsReset')
            : t('pos.login.pinLocked', { menit: res.locked.minutes }),
        )
      } else if (res.reason === 'CRYPTO_FAILED') {
        setStatusError(t('pos.login.cryptoFailed', { ref: 'APP_ERROR' }))
      } else {
        setStatusError(t('pos.login.pinWrong', { n: res.remaining }))
      }
    } finally {
      setVerifying(false)
    }
  }, [bootResult, loadLoginState, navigate, pin, selectedUserId, t, tenant, verifying])

  function handleLocaleChange(nextLocale: 'id-ID' | 'en-US') {
    if (bootResult.kind === 'READY') {
      void setMeta(bootResult.db, 'locale', nextLocale)
    }
  }

  async function handleUnlockOverrideConfirmed(res: { approverId: string; reason: string }) {
    if (bootResult.kind !== 'READY') return
    const { db, device } = bootResult
    const { discardOpenCartDrafts } = await import('~/pos/data/pin.repo')
    const { enqueueAudit } = await import('~/pos/usecases/audit/enqueue-audit')
    const discardedDrafts = await discardOpenCartDrafts(db)
    const clock = await getMeta(db, 'clock')
    const { trustedNowMs: nowMs } = computeEffectiveClock(
      clock ? { offset_ms: clock.offset_ms, max_seen_time: clock.max_seen_time } : null,
    )
    const occurredAtIso = new Date(nowMs).toISOString()

    await enqueueAudit(db, {
      action: 'screen.unlock_override',
      entityType: 'device',
      entityId: device.device_id,
      registerId: device.register_id,
      actorUserId: idleLockStaffId ?? res.approverId,
      approverUserId: res.approverId,
      reasonText: res.reason,
      afterData: { discarded_draft_count: discardedDrafts },
      occurredAtIso,
    })

    await setMeta(db, 'idle_lock', {
      locked: false,
      locked_staff_id: null,
      locked_at: null,
    })
    clearSession()
    await startSession(db, res.approverId, device.outlet_id)
    setIdleLockStaffId(null)
    void navigate({ href: `/${tenant.toLowerCase()}/pos/?closeShift=1` })
  }

  const leaseDaysLeft =
    bootResult.kind === 'READY' && bootResult.state.kind === 'LEASE_WARNING'
      ? Math.max(1, Math.ceil(bootResult.state.hoursLeft / 24))
      : null

  const activeError = lockBannerMessage ?? statusError
  const isLockedScreen = idleLockStaffId !== null

  return (
    <PosShell
      tenantName={tenantName}
      tenantSlug={tenant}
      registerName={registerLabel}
      onLocaleChange={handleLocaleChange}
    >
      {leaseDaysLeft !== null ? (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-line bg-warning-soft px-4 py-2 text-caption font-medium text-warning-ink"
        >
          <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
          <span>{t('pos.login.leaseWarning', { days: leaseDaysLeft })}</span>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-6">
        <Card className="p-5 md:p-7">
          {isLockedScreen ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-5 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-surface-subtle text-ink">
                <Lock className="size-6" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-h2 font-semibold text-ink">{t('pos.lock.title')}</h1>
                <p className="mt-1 text-body-sm text-ink-soft">
                  {t('pos.lock.subtitle', {
                    name: selectedStaff?.displayName ?? '',
                    tenant: tenantName,
                  })}
                </p>
              </div>

              {activeError ? (
                <div
                  role="alert"
                  className="flex w-full items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-left text-body-sm text-danger-ink"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{activeError}</span>
                </div>
              ) : null}

              <PinDots length={pin.length} maxLength={6} invalid={Boolean(activeError)} />

              <div className="w-full max-w-xs">
                <Numpad
                  onDigit={handleDigit}
                  onBackspace={handleBackspace}
                  onSubmit={() => void handleSubmitPin()}
                  disabled={verifying || selectedLockEval.locked}
                  submitDisabled={pin.length < 4}
                />
              </div>

              {bootResult.kind === 'READY' ? (
                <Button variant="ghost" size="md" onClick={() => setOverrideOpen(true)}>
                  {t('pos.lock.overrideButton')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className={selectedUserId ? 'hidden md:block' : 'block'}>
                <h1 className="text-h2 font-semibold text-ink">{t('pos.login.title')}</h1>
                <p className="mt-1 mb-4 text-body-sm text-ink-soft">{t('pos.login.subtitle')}</p>
                <StaffPicker
                  staff={staff}
                  selectedUserId={selectedUserId}
                  lockedUserIds={lockedUserIds}
                  onSelect={(uid) => {
                    setSelectedUserId(uid)
                    setPin('')
                    setStatusError(null)
                  }}
                />
              </div>

              <div className={selectedUserId ? 'flex flex-col items-center gap-5' : 'hidden md:flex md:flex-col md:items-center md:justify-center'}>
                {selectedStaff ? (
                  <>
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-body font-semibold text-ink">
                        {t('pos.login.selectedStaffLabel', { name: selectedStaff.displayName })}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="md:hidden"
                        onClick={() => {
                          setSelectedUserId(null)
                          setPin('')
                          setStatusError(null)
                        }}
                      >
                        {t('pos.login.changeStaff')}
                      </Button>
                    </div>

                    {activeError ? (
                      <div
                        role="alert"
                        className="flex w-full items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
                      >
                        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>{activeError}</span>
                      </div>
                    ) : null}

                    <PinDots length={pin.length} maxLength={6} invalid={Boolean(activeError)} />

                    <div className="w-full max-w-xs">
                      <Numpad
                        onDigit={handleDigit}
                        onBackspace={handleBackspace}
                        onSubmit={() => void handleSubmitPin()}
                        disabled={verifying || selectedLockEval.locked}
                        submitDisabled={pin.length < 4}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-body-sm text-ink-soft">{t('pos.login.selectStaff')}</p>
                )}
              </div>
            </div>
          )}

          <footer className="mt-6 border-t border-line pt-4 text-center text-caption text-ink-muted">
            {t('pos.login.appVersion', { version: appVersion })}
          </footer>
        </Card>
      </div>

      {bootResult.kind === 'READY' && isLockedScreen && overrideOpen ? (
        <Suspense fallback={null}>
          <LazySupervisorPinDialog
            open={overrideOpen}
            onOpenChange={setOverrideOpen}
            db={bootResult.db}
            outletId={bootResult.device.outlet_id}
            deviceId={bootResult.device.device_id}
            registerId={bootResult.device.register_id}
            requesterId={idleLockStaffId ?? ''}
            permission="screen.unlock_override"
            trustedNowMs={trustedNowMs}
            maxSeenMs={maxSeenMs}
            title={t('pos.lock.overrideTitle')}
            warningNotice={t('pos.lock.overrideWarning')}
            confirmLabel={t('pos.lock.overrideConfirmLabel')}
            onApproved={handleUnlockOverrideConfirmed}
          />
        </Suspense>
      ) : null}
    </PosShell>
  )
}
