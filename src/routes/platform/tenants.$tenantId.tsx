import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PlatformShell } from '~/components/layout/PlatformShell'
import { Button, Card, Check, CircleAlert, Field, Input, Skeleton } from '~/components/ui'

interface TenantViewPayload {
  tenant: {
    id: string
    name: string
    slug: string
    status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  }
  members: Array<{
    id: string
    displayName: string
    membershipStatus: string
    isActive: boolean
    hasAuthAccount: boolean
    roleCodes: string[]
  }>
  pendingInvites: Array<{
    id: string
    email: string
    displayName: string
    expiresAt: string
    status: 'PENDING' | 'EXPIRED'
  }>
}

export const Route = createFileRoute('/platform/tenants/$tenantId')({
  component: PlatformTenantDetailPage,
})

function PlatformTenantDetailPage() {
  const { tenantId } = Route.useParams()
  const { t } = useTranslation()

  const [operatorEmail, setOperatorEmail] = useState<string | null>(null)
  const [data, setData] = useState<TenantViewPayload | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [issuedCode, setIssuedCode] = useState<{ label: string; code: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`/platform/api/tenants/${tenantId}`, { credentials: 'same-origin' })
    if (res.status === 401) {
      window.location.assign('/platform/login')
      return
    }
    if (res.ok) {
      const payload = (await res.json()) as TenantViewPayload
      setData(payload)
      setRenameValue(payload.tenant.name)
    }
  }, [tenantId])

  useEffect(() => {
    void fetch('/platform/api/session', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((s: { session?: { email: string } | null } | null) => {
        if (!s?.session) {
          window.location.assign('/platform/login')
          return
        }
        setOperatorEmail(s.session.email)
        void refresh()
      })
      .catch(() => window.location.assign('/platform/login'))
  }, [refresh])

  async function handleRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorMsg(null)
    setFeedback(null)
    setBusy(true)
    try {
      const res = await fetch(`/platform/api/tenants/${tenantId}/rename`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue }),
      })
      if (!res.ok) {
        setErrorMsg(t('platform.detail.actionFailed'))
        return
      }
      setFeedback(t('platform.detail.renameSaved'))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleStatus(status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED') {
    setErrorMsg(null)
    setFeedback(null)
    setBusy(true)
    try {
      const res = await fetch(`/platform/api/tenants/${tenantId}/status`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        setErrorMsg(t('platform.detail.actionFailed'))
        return
      }
      setFeedback(t('platform.detail.statusUpdated'))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleInviteAction(appUserId: string, action: 'cancel' | 'reissue') {
    setErrorMsg(null)
    setFeedback(null)
    setIssuedCode(null)
    setBusy(true)
    try {
      const res = await fetch(`/platform/api/tenants/${tenantId}/invites/${appUserId}/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        setErrorMsg(t('platform.detail.actionFailed'))
        return
      }
      if (action === 'reissue') {
        const body = (await res.json()) as { code: string }
        setIssuedCode({ label: t('platform.detail.reissuedCodeLabel'), code: body.code })
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function handleIssueReset(appUserId: string) {
    setErrorMsg(null)
    setFeedback(null)
    setIssuedCode(null)
    setBusy(true)
    try {
      const res = await fetch(`/platform/api/tenants/${tenantId}/reset-code`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appUserId }),
      })
      if (!res.ok) {
        setErrorMsg(t('platform.detail.actionFailed'))
        return
      }
      const body = (await res.json()) as { code: string }
      setIssuedCode({ label: t('platform.detail.resetCodeLabel'), code: body.code })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PlatformShell operatorEmail={operatorEmail} activeSection="tenants">
      <a
        href="/platform"
        className="text-body-sm font-medium text-ink-soft hover:text-ink hover:underline"
      >
        {t('platform.detail.backToList')}
      </a>

      {!data ? (
        <div className="mt-6 flex flex-col gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <h1 className="text-h1 font-semibold text-ink">{data.tenant.name}</h1>
            <p className="mt-1 font-mono text-body-sm text-ink-soft">
              /{data.tenant.slug} · {t(`platform.tenants.status${data.tenant.status}`)}
            </p>
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          ) : null}

          {feedback ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-control border border-success-line bg-success-soft px-3.5 py-2.5 text-body-sm text-success-ink"
            >
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{feedback}</span>
            </div>
          ) : null}

          {issuedCode ? (
            <Card className="border-success-line bg-success-soft p-4">
              <p className="text-caption text-success-ink">{issuedCode.label}</p>
              <p className="mt-1 font-mono text-h2 font-bold text-ink">{issuedCode.code}</p>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="p-6">
              <h2 className="text-title font-semibold text-ink">{t('platform.detail.renameTitle')}</h2>
              <form onSubmit={(e) => void handleRename(e)} className="mt-4 flex flex-col gap-3">
                <Field label={t('platform.create.nameLabel')} htmlFor="detail-rename">
                  <Input
                    id="detail-rename"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    maxLength={40}
                    disabled={busy}
                    required
                  />
                </Field>
                <div>
                  <Button type="submit" loading={busy}>
                    {t('platform.detail.renameSubmit')}
                  </Button>
                </div>
              </form>
            </Card>

            <Card className="p-6">
              <h2 className="text-title font-semibold text-ink">{t('platform.detail.statusTitle')}</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={busy || data.tenant.status === 'ACTIVE' || data.tenant.status === 'CLOSED'}
                  onClick={() => void handleStatus('ACTIVE')}
                >
                  {t('platform.detail.activate')}
                </Button>
                <Button
                  variant="tonal"
                  disabled={busy || data.tenant.status === 'SUSPENDED' || data.tenant.status === 'CLOSED'}
                  onClick={() => void handleStatus('SUSPENDED')}
                >
                  {t('platform.detail.suspend')}
                </Button>
                <Button
                  variant="danger-outline"
                  disabled={busy || data.tenant.status === 'CLOSED'}
                  onClick={() => void handleStatus('CLOSED')}
                >
                  {t('platform.detail.closePermanent')}
                </Button>
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h2 className="text-title font-semibold text-ink">{t('platform.detail.invitesTitle')}</h2>
            {data.pendingInvites.length === 0 ? (
              <p className="mt-2 text-body-sm text-ink-soft">{t('platform.detail.noInvites')}</p>
            ) : (
              <div className="mt-4 flex flex-col divide-y divide-line">
                {data.pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-body font-medium text-ink">{inv.displayName}</p>
                      <p className="text-body-sm text-ink-soft">
                        {inv.email} · {inv.status}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void handleInviteAction(inv.id, 'reissue')}
                      >
                        {t('platform.detail.reissue')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-outline"
                        disabled={busy}
                        onClick={() => void handleInviteAction(inv.id, 'cancel')}
                      >
                        {t('platform.detail.cancelInvite')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-title font-semibold text-ink">{t('platform.detail.membersTitle')}</h2>
            {data.members.length === 0 ? (
              <p className="mt-2 text-body-sm text-ink-soft">{t('platform.detail.noMembers')}</p>
            ) : (
              <div className="mt-4 flex flex-col divide-y divide-line">
                {data.members.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-body font-medium text-ink">{m.displayName}</p>
                      <p className="text-body-sm text-ink-soft">
                        {m.roleCodes.join(', ')} · {m.membershipStatus}
                      </p>
                    </div>
                    {m.isActive && m.membershipStatus === 'ACTIVE' && m.hasAuthAccount ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void handleIssueReset(m.id)}
                      >
                        {t('platform.detail.issueReset')}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </PlatformShell>
  )
}
