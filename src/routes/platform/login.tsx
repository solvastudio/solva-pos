import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemPage } from '~/components/layout/SystemPage'
import { Button, CircleAlert, Eye, EyeOff, Field, IconButton, Input, Store } from '~/components/ui'

export const Route = createFileRoute('/platform/login')({
  component: PlatformLoginPage,
})

function PlatformLoginPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void fetch('/platform/api/session', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { session?: unknown } | null) => {
        if (data?.session) {
          window.location.assign('/platform')
        }
      })
      .catch(() => undefined)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)

    try {
      const response = await fetch('/platform/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
          setErrorMessage(t('platform.login.invalid'))
        }
        return
      }

      window.location.assign('/platform')
    } catch {
      setErrorMessage(t('platform.login.invalid'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SystemPage>
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-700 text-on-action">
          <Store className="size-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-h2 font-semibold text-ink">{t('platform.login.title')}</h1>
          <p className="text-body-sm text-ink-soft">{t('platform.login.subtitle')}</p>
        </div>
      </div>

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

        <Field label={t('platform.login.emailLabel')} htmlFor="platform-email">
          <Input
            id="platform-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('platform.login.emailPlaceholder')}
            disabled={submitting}
            required
          />
        </Field>

        <Field label={t('platform.login.passwordLabel')} htmlFor="platform-password">
          <Input
            id="platform-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
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
          {t('platform.login.submit')}
        </Button>
      </form>
    </SystemPage>
  )
}
