import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Dialog } from '~/components/ui/Dialog'
import { Field } from '~/components/ui/Field'
import { Input } from '~/components/ui/Input'
import { Select } from '~/components/ui/Select'
import { CircleAlert } from '~/components/ui/icons'
import { listPosStaffWithPins, type PosStaffSummary } from '~/pos/data/pin.repo'
import type { SolvaDb } from '~/pos/db/solva-db'
import { requestSupervisorApproval, type ApprovalPermission } from '~/pos/session/approval'
import { verifyStaffPin } from '~/pos/session/pin-verify'
import { setSupervisorDialogOpen } from '~/pos/session/session'
import { isPermissionCode, type PermissionCode } from '~/modules/identity/shared'

export interface SupervisorPinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  db: SolvaDb
  outletId: string
  deviceId: string
  registerId: string
  requesterId: string
  permission: ApprovalPermission | 'screen.unlock_override'
  requestedPct?: string | number
  trustedNowMs: number
  maxSeenMs: number
  title?: string
  warningNotice?: string
  confirmLabel?: string
  requireReason?: boolean
  onApproved: (result: { approverId: string; displayName: string; reason: string }) => void | Promise<void>
}

export function SupervisorPinDialog({
  open,
  onOpenChange,
  db,
  outletId,
  deviceId,
  registerId,
  requesterId,
  permission,
  requestedPct,
  trustedNowMs,
  maxSeenMs,
  title,
  warningNotice,
  confirmLabel,
  requireReason = true,
  onApproved,
}: SupervisorPinDialogProps) {
  const { t } = useTranslation()
  const formId = useId()

  const [candidates, setCandidates] = useState<PosStaffSummary[]>([])
  const [approverId, setApproverId] = useState('')
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setSupervisorDialogOpen(open)
    return () => {
      setSupervisorDialogOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPin('')
    setReason('')
    setErrorMsg(null)

    void listPosStaffWithPins(db, outletId).then((all) => {
      if (cancelled) return
      const filtered = all.filter((s) => {
        if (s.userId === requesterId && permission !== 'screen.unlock_override') {
          return false
        }
        const permSet = new Set(s.permissions.filter(isPermissionCode) as PermissionCode[])
        if (!permSet.has(permission)) return false
        if (requestedPct !== undefined) {
          const req = typeof requestedPct === 'number' ? requestedPct : Number(requestedPct)
          if (!Number.isFinite(req) || s.discountLimitPct < req) return false
        }
        return true
      })
      setCandidates(filtered)
      setApproverId(filtered[0]?.userId ?? '')
    })

    return () => {
      cancelled = true
    }
  }, [db, open, outletId, permission, requestedPct, requesterId])

  const approverOptions = useMemo(
    () =>
      candidates.map((c) => ({
        value: c.userId,
        label: c.displayName,
      })),
    [candidates],
  )

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!approverId) {
      setErrorMsg(t('pos.supervisor.noEligible'))
      return
    }
    const cleanReason = reason.trim()
    if (requireReason && cleanReason.length === 0) {
      setErrorMsg(t('pos.supervisor.reasonRequired'))
      return
    }
    if (pin.length < 4) {
      setErrorMsg(t('admin.users.pin.policyLength'))
      return
    }

    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (permission === 'screen.unlock_override') {
        const approver = candidates.find((c) => c.userId === approverId)
        if (!approver) {
          setErrorMsg(t('pos.supervisor.noEligible'))
          return
        }
        const v = await verifyStaffPin(db, {
          userId: approverId,
          pin,
          deviceId,
          registerId,
          trustedNowMs,
          maxSeenMs,
        })
        if (!v.ok) {
          if (v.reason === 'LOCKED' && v.locked) {
            setErrorMsg(
              'needsReset' in v.locked
                ? t('pos.login.needsReset')
                : t('pos.login.pinLocked', { menit: v.locked.minutes }),
            )
          } else {
            setErrorMsg(t('pos.login.pinWrong', { n: v.remaining }))
          }
          setPin('')
          return
        }
        await onApproved({ approverId, displayName: approver.displayName, reason: cleanReason })
        onOpenChange(false)
        return
      }

      const res = await requestSupervisorApproval(db, {
        outletId,
        deviceId,
        registerId,
        requesterId,
        approverId,
        pin,
        permission,
        requestedPct,
        trustedNowMs,
        maxSeenMs,
      })

      if (!res.approved) {
        if (res.reason === 'SELF_APPROVAL_FORBIDDEN') {
          setErrorMsg(t('pos.supervisor.selfForbidden'))
        } else if (res.reason === 'MISSING_PERMISSION') {
          setErrorMsg(t('pos.supervisor.missingPermission'))
        } else if (res.reason === 'DISCOUNT_LIMIT_EXCEEDED') {
          setErrorMsg(t('pos.supervisor.limitExceeded'))
        } else if (res.verifyResult?.reason === 'LOCKED' && res.verifyResult.locked) {
          setErrorMsg(
            'needsReset' in res.verifyResult.locked
              ? t('pos.login.needsReset')
              : t('pos.login.pinLocked', { menit: res.verifyResult.locked.minutes }),
          )
        } else {
          setErrorMsg(t('pos.login.pinWrong', { n: res.verifyResult?.remaining ?? 0 }))
        }
        setPin('')
        return
      }

      await onApproved({ approverId: res.approverId, displayName: res.displayName, reason: cleanReason })
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t('pos.supervisor.title')}
      size="sm"
      overlayClassName="z-pin"
      contentClassName="z-pin"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={`${formId}-form`}
            variant={warningNotice ? 'danger' : 'primary'}
            size="md"
            loading={submitting}
            disabled={candidates.length === 0}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <form id={`${formId}-form`} onSubmit={handleSubmit} className="flex flex-col gap-4">
        {warningNotice ? (
          <div className="flex items-start gap-2 rounded-control border border-warning-solid bg-warning-soft p-3 text-body-sm text-warning-ink">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{warningNotice}</span>
          </div>
        ) : null}

        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-solid bg-danger-soft p-3 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {candidates.length === 0 ? (
          <p className="text-body-sm text-ink-soft">{t('pos.supervisor.noEligible')}</p>
        ) : (
          <>
            <Field label={t('pos.supervisor.approverLabel')} htmlFor={`${formId}-approver`}>
              <Select
                id={`${formId}-approver`}
                value={approverId}
                onValueChange={(v) => {
                  setApproverId(v)
                  setErrorMsg(null)
                }}
                options={approverOptions}
              />
            </Field>

            {requireReason ? (
              <Field label={t('pos.supervisor.reasonLabel')} htmlFor={`${formId}-reason`}>
                <Input
                  id={`${formId}-reason`}
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('pos.supervisor.reasonPlaceholder')}
                />
              </Field>
            ) : null}

            <Field label={t('admin.users.pin.inputLabel')} htmlFor={`${formId}-pin`}>
              <Input
                id={`${formId}-pin`}
                kind="pin"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
          </>
        )}
      </form>
    </Dialog>
  )
}
