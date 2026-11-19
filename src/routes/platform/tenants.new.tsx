import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PlatformShell } from '~/components/layout/PlatformShell'
import { Button, Card, Check, CircleAlert, Field, Input } from '~/components/ui'
import { tenantHref } from '~/lib/tenancy/tenant-href'

interface CreatedTenantSummary {
  tenantId: string
  slug: string
  name: string
  ownerInvite: {
    codeId: string
    code: string
    expiresAt: string
    appUserId: string
  }
}

export const Route = createFileRoute('/platform/tenants/new')({
  component: PlatformNewTenantPage,
})

function PlatformNewTenantPage() {
  const { t } = useTranslation()
  const [operatorEmail, setOperatorEmail] = useState<string | null>(null)
  const [originPrefix, setOriginPrefix] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerDisplayName, setOwnerDisplayName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedTenantSummary | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginPrefix(window.location.origin)
    }
    void fetch('/platform/api/session', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { session?: { email: string } | null } | null) => {
        if (!data?.session) {
          window.location.assign('/platform/login')
          return
        }
        setOperatorEmail(data.session.email)
      })
      .catch(() => window.location.assign('/platform/login'))
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)

    try {
      const response = await fetch('/platform/api/tenants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug,
          ownerDisplayName,
          ownerEmail,
        }),
      })

      if (response.status === 401) {
        window.location.assign('/platform/login')
        return
      }

      if (!response.ok) {
        setErrorMessage(t('platform.create.failed'))
        return
      }

      const payload = (await response.json()) as CreatedTenantSummary
      setCreated(payload)
    } catch {
      setErrorMessage(t('platform.create.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const normalizedSlug = slug.trim().toLowerCase()
  const adminUrlPreview = `${originPrefix}${tenantHref(normalizedSlug || 'slug', '/admin')}`

  return (
    <PlatformShell operatorEmail={operatorEmail} activeSection="create">
      <div className="max-w-dialog-lg">
        <a
          href="/platform"
          className="text-body-sm font-medium text-ink-soft hover:text-ink hover:underline"
        >
          {t('platform.detail.backToList')}
        </a>
        <h1 className="mt-2 text-h1 font-semibold text-ink">{t('platform.create.title')}</h1>

        {created ? (
          <Card className="mt-6 p-6">
            <div className="flex items-start gap-2 text-success-ink">
              <Check className="mt-1 size-5 shrink-0" aria-hidden="true" />
              <div>
                <h2 className="text-title font-semibold text-ink">
                  {t('platform.create.createdTitle')}
                </h2>
                <p className="mt-1 text-body-sm text-ink-soft">
                  {t('platform.create.createdDesc')}
                </p>
              </div>
            </div>

            <dl className="mt-5 flex flex-col gap-3 rounded-control border border-line bg-surface-subtle p-4">
              <div>
                <dt className="text-caption text-ink-muted">
                  {t('platform.create.inviteUrlLabel')}
                </dt>
                <dd className="mt-0.5 font-mono text-body-sm text-ink">
                  {`${originPrefix}${tenantHref(created.slug, '/join')}`}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">
                  {t('platform.create.inviteCodeLabel')}
                </dt>
                <dd className="mt-0.5 font-mono text-h2 font-bold text-ink">
                  {created.ownerInvite.code}
                </dd>
              </div>
            </dl>

            <div className="mt-5">
              <a
                href={`/platform/tenants/${created.tenantId}`}
                className="inline-flex h-control-lg items-center justify-center rounded-control bg-action px-5 text-button-lg font-semibold text-on-action hover:bg-action-hover"
              >
                {t('platform.create.viewTenant')}
              </a>
            </div>
          </Card>
        ) : (
          <Card className="mt-6 p-6">
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
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
                label={t('platform.create.nameLabel')}
                hint={t('platform.create.nameHint')}
                htmlFor="tenant-name"
              >
                <Input
                  id="tenant-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                  maxLength={40}
                  required
                />
              </Field>

              <Field
                label={t('platform.create.slugLabel')}
                hint={t('platform.create.slugHint')}
                htmlFor="tenant-slug"
              >
                <Input
                  id="tenant-slug"
                  className="font-mono"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={submitting}
                  maxLength={30}
                  required
                />
              </Field>

              <div className="rounded-control border border-line bg-surface-subtle px-3.5 py-2.5">
                <p className="text-caption text-ink-muted">{t('platform.create.urlPreviewLabel')}</p>
                <p className="mt-0.5 truncate font-mono text-body-sm text-ink">{adminUrlPreview}</p>
              </div>

              <Field label={t('platform.create.ownerNameLabel')} htmlFor="owner-name">
                <Input
                  id="owner-name"
                  value={ownerDisplayName}
                  onChange={(e) => setOwnerDisplayName(e.target.value)}
                  disabled={submitting}
                  maxLength={80}
                  required
                />
              </Field>

              <Field label={t('platform.create.ownerEmailLabel')} htmlFor="owner-email">
                <Input
                  id="owner-email"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  disabled={submitting}
                  required
                />
              </Field>

              <Button type="submit" loading={submitting} className="mt-2">
                {t('platform.create.submit')}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </PlatformShell>
  )
}
