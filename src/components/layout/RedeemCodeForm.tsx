import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Check, CircleAlert, Eye, EyeOff, Field, IconButton, Input } from '~/components/ui'
import { formatCode, normalizeCode } from '~/lib/kernel'
import { tenantHref } from '~/lib/tenancy/tenant-href'
import { SystemPage } from './SystemPage'
import { TenantBadge } from './TenantBadge'

export interface RedeemCodeFormProps {
  kind: 'join' | 'reset'
  tenantName: string
  tenantSlug: string
}

export function RedeemCodeForm({ kind, tenantName, tenantSlug }: RedeemCodeFormProps) {
  const { t } = useTranslation()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [doneNext, setDoneNext] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Extract optional `#code=...` fragment into form state and remove it from URL immediately.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash) {
      return
    }
    const params = new URLSearchParams(window.location.hash.slice(1))
    const hashCode = params.get('code')
    if (hashCode) {
      const normalized = normalizeCode(hashCode)
      setCode(normalized ? formatCode(normalized) : hashCode.toUpperCase())
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  function handleCodeChange(raw: string) {
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    setCode(cleaned)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)

    try {
      const endpoint = tenantHref(tenantSlug, kind === 'join' ? '/api/join' : '/api/reset')
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code,
          password,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string }
          retry_after_minutes?: number
        } | null
        if (response.status === 429 && body?.error?.code === 'RATE_LIMITED') {
          const menit =
            typeof body.retry_after_minutes === 'number' && body.retry_after_minutes >= 1
              ? body.retry_after_minutes
              : 1
          setErrorMessage(t('error.RATE_LIMITED.actionMinutes', { menit }))
        } else {
          setErrorMessage(t('sys.code.invalid'))
        }
        return
      }

      const okBody = (await response.json().catch(() => null)) as {
        ok?: boolean
        next?: string
      } | null
      const nextUrl = okBody?.next ?? tenantHref(tenantSlug, '/admin/login')
      if (kind === 'join' && okBody?.next === tenantHref(tenantSlug, '/admin')) {
        window.location.assign(nextUrl)
        return
      }
      setDoneNext(nextUrl)
    } catch {
      setErrorMessage(t('sys.code.invalid'))
    } finally {
      setSubmitting(false)
    }
  }

  const titleText =
    kind === 'join'
      ? t('join.title', { tenant: tenantName })
      : t('reset.title', { tenant: tenantName })

  return (
    <SystemPage>
      <TenantBadge variant="hero" name={tenantName} slug={tenantSlug} />
      <h1 className="mt-5 text-h2 font-semibold text-ink">{titleText}</h1>

      {doneNext ? (
        <div className="mt-6 flex flex-col gap-4">
          <div
            role="status"
            className="flex items-start gap-2 rounded-control border border-success-line bg-success-soft px-3.5 py-3 text-body-sm text-success-ink"
          >
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {kind === 'join'
                ? t('join.done', { tenant: tenantName })
                : t('reset.done')}
            </span>
          </div>
          <a
            href={doneNext}
            className="inline-flex h-control-lg w-full items-center justify-center rounded-control bg-action px-5 text-button-lg font-semibold text-on-action transition-colors hover:bg-action-hover"
          >
            {kind === 'join' ? t('join.toLogin') : t('reset.toLogin')}
          </a>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 flex flex-col gap-4" noValidate>
          {errorMessage ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <Field
            label={t(kind === 'join' ? 'join.emailLabel' : 'reset.emailLabel')}
            htmlFor={`${kind}-email`}
          >
            <Input
              id={`${kind}-email`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(kind === 'join' ? 'join.emailPlaceholder' : 'reset.emailPlaceholder')}
              disabled={submitting}
              required
            />
          </Field>

          <Field
            label={t(kind === 'join' ? 'join.code' : 'reset.code')}
            htmlFor={`${kind}-code`}
          >
            <Input
              id={`${kind}-code`}
              type="text"
              autoComplete="off"
              className="font-mono uppercase"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder={t(kind === 'join' ? 'join.codePlaceholder' : 'reset.codePlaceholder')}
              disabled={submitting}
              required
            />
          </Field>

          <Field
            label={t(kind === 'join' ? 'join.passwordLabel' : 'reset.passwordLabel')}
            hint={t(kind === 'join' ? 'join.passwordHint' : 'reset.passwordHint')}
            htmlFor={`${kind}-password`}
          >
            <Input
              id={`${kind}-password`}
              type={showPassword ? 'text' : 'password'}
              autoComplete={kind === 'reset' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              suffix={
                <IconButton
                  label={
                    showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')
                  }
                  icon={showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  variant="ghost"
                  size="md"
                  onClick={() => setShowPassword((prev) => !prev)}
                />
              }
            />
          </Field>

          <Button type="submit" fullWidth loading={submitting} className="mt-2">
            {t(kind === 'join' ? 'join.submit' : 'reset.submit')}
          </Button>
        </form>
      )}
    </SystemPage>
  )
}
