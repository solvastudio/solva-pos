import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LangToggle } from '~/components/layout/LangToggle'
import { Button, Card, Check, CircleAlert, Field, Input } from '~/components/ui'
import { setPreferredLocaleFn } from '~/functions/auth/session.fn'
import { useCurrentTenant } from '~/hooks/use-current-tenant'
import type { Locale } from '~/i18n/resolve-locale'
import { tenantHref } from '~/lib/tenancy/tenant-href'

export const Route = createFileRoute('/$tenant/admin/_authed/account')({
  component: AdminAccountPage,
})

function AdminAccountPage() {
  const { t } = useTranslation()
  const { slug } = useCurrentTenant()
  const { session } = Route.useRouteContext()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [localeSaved, setLocaleSaved] = useState(false)

  if (!session) {
    return null
  }

  async function handleLocaleUpdate(locale: Locale) {
    setLocaleSaved(false)
    await setPreferredLocaleFn({ data: { locale } })
    setLocaleSaved(true)
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(false)

    if (newPassword.length < 8) {
      setPasswordError(t('account.password.minLength'))
      return
    }
    if (newPassword !== repeatPassword) {
      setPasswordError(t('account.password.mismatch'))
      return
    }

    setSavingPassword(true)
    try {
      const response = await fetch(tenantHref(slug, '/admin/api/auth/change-password'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { messageKey?: string }
        } | null
        if (body?.error?.messageKey === 'account.password.wrongCurrent') {
          setPasswordError(t('account.password.wrongCurrent'))
        } else {
          setPasswordError(t('account.password.failed'))
        }
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setRepeatPassword('')
      setPasswordSuccess(true)
    } catch {
      setPasswordError(t('account.password.failed'))
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="flex max-w-dialog-lg flex-col gap-6">
      <h1 className="text-h1 font-semibold text-ink">{t('account.title')}</h1>

      <Card className="p-6">
        <h2 className="text-title font-semibold text-ink">{t('account.profileTitle')}</h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-ink-muted">{t('account.nameLabel')}</dt>
            <dd className="mt-0.5 text-body font-medium text-ink">{session.displayName}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-muted">{t('account.emailLabel')}</dt>
            <dd className="mt-0.5 text-body font-medium text-ink">{session.email}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-caption text-ink-muted">{t('account.rolesLabel')}</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {session.roleCodes.map((code: string) => (
                <span
                  key={code}
                  className="inline-flex items-center rounded-md border border-line bg-surface-subtle px-2.5 py-1 text-label-sm font-medium text-ink"
                >
                  {code}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <h2 className="text-title font-semibold text-ink">{t('account.languageTitle')}</h2>
        <p className="mt-1 text-body-sm text-ink-soft">{t('account.languageDesc')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <LangToggle onLocaleChange={(loc) => handleLocaleUpdate(loc)} />
          {localeSaved ? (
            <span className="inline-flex items-center gap-1.5 text-body-sm text-success-ink">
              <Check className="size-4" aria-hidden="true" />
              <span>{t('account.languageSaved')}</span>
            </span>
          ) : null}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-title font-semibold text-ink">{t('account.passwordTitle')}</h2>
        <form
          onSubmit={(e) => void handlePasswordSubmit(e)}
          className="mt-4 flex max-w-dialog-md flex-col gap-4"
          noValidate
        >
          {passwordError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-body-sm text-danger-ink"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{passwordError}</span>
            </div>
          ) : null}

          {passwordSuccess ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-control border border-success-line bg-success-soft px-3.5 py-2.5 text-body-sm text-success-ink"
            >
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t('account.password.updated')}</span>
            </div>
          ) : null}

          <Field label={t('account.password.current')} htmlFor="account-current-password">
            <Input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={savingPassword}
              required
            />
          </Field>

          <Field label={t('account.password.new')} htmlFor="account-new-password">
            <Input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={savingPassword}
              required
            />
          </Field>

          <Field label={t('account.password.repeat')} htmlFor="account-repeat-password">
            <Input
              id="account-repeat-password"
              type="password"
              autoComplete="new-password"
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
              disabled={savingPassword}
              required
            />
          </Field>

          <div className="pt-1">
            <Button type="submit" loading={savingPassword}>
              {t('account.password.submit')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
