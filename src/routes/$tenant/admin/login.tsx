import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SystemPage } from '~/components/layout/SystemPage'
import { TenantBadge } from '~/components/layout/TenantBadge'
import { Button, CircleAlert, Eye, EyeOff, Field, IconButton, Input } from '~/components/ui'
import { getSessionFn } from '~/functions/auth/session.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import { APP_VERSION } from '~/lib/app-version'
import { formatAppTitle } from '~/lib/brand'
import { safeReturnTo } from '~/lib/safe-redirect'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/admin/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined,
  }),
  beforeLoad: async ({ params, search, context }) => {
    if (!('tenantStatus' in context) || context.tenantStatus !== 'active') {
      return
    }
    const session = await getSessionFn({ data: { slug: params.tenant } })
    if (session) {
      throw redirect({
        href: safeReturnTo(search.returnTo, session.tenantSlug),
      })
    }
  },
  head: ({ match }) => {
    const ctx = match.context as { tenant?: { name?: string } | null } | undefined
    return {
      meta: [{ title: formatAppTitle('admin', ctx?.tenant?.name) }],
    }
  },
  component: AdminLoginPage,
})

function AdminLoginPage() {
  const { t } = useTranslation()
  const { name, slug } = useCurrentTenant()
  const { returnTo } = Route.useSearch()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const appVersion = typeof APP_VERSION === 'string' ? APP_VERSION : 'dev'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)

    try {
      const response = await fetch(tenantHref(slug, '/admin/api/auth/sign-in/email'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          rememberMe: true,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string; messageKey?: string }
          retry_after_minutes?: number
        } | null
        if (response.status === 429 && body?.error?.code === 'RATE_LIMITED') {
          const minutes =
            typeof body.retry_after_minutes === 'number' && body.retry_after_minutes >= 1
              ? body.retry_after_minutes
              : 1
          setErrorMessage(t('error.RATE_LIMITED.actionMinutes', { menit: minutes }))
        } else if (response.status === 403 && body?.error?.code === 'TENANT_SUSPENDED') {
          setErrorMessage(t('auth.login.suspended'))
        } else {
          setErrorMessage(t('auth.login.invalid'))
        }
        return
      }

      window.location.assign(safeReturnTo(returnTo, slug))
    } catch {
      setErrorMessage(t('auth.login.invalid'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SystemPage>
      <div className="border-b border-line-subtle pb-5">
        <TenantBadge variant="hero" name={name} slug={slug} />
      </div>
      <h1 className="mt-5 text-h2 font-semibold text-ink">
        {t('tenant.login.title', { tenant: name })}
      </h1>
      <p className="mt-1 text-body-sm text-ink-soft">
        {t('tenant.login.notYours', { tenant: name })}
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 flex flex-col gap-4" noValidate>
        {errorMessage ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-body-sm text-danger-ink"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <Field label={t('auth.login.emailLabel')} htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.login.emailPlaceholder')}
            invalid={Boolean(errorMessage)}
            disabled={submitting}
            required
          />
        </Field>

        <Field label={t('auth.login.passwordLabel')} htmlFor="login-password">
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.login.passwordPlaceholder')}
            invalid={Boolean(errorMessage)}
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
                className="-mr-1.5"
                onClick={() => setShowPassword((prev) => !prev)}
              />
            }
          />
        </Field>

        <Button type="submit" fullWidth loading={submitting} className="mt-2">
          {t('auth.login.submit')}
        </Button>
      </form>

      <p className="mt-6 border-t border-line-subtle pt-4 text-body-sm leading-relaxed text-ink-soft">
        {t('auth.login.forgotHint')}
      </p>
      <footer className="mt-4 text-center font-mono text-caption text-ink-muted">
        {t('admin.shell.footerVersion', { version: appVersion })}
      </footer>
    </SystemPage>
  )
}
