import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, buttonVariants, Check, Copy, Lock } from '~/components/ui'
import { cn } from '~/lib/cn'
import { SystemPage } from './SystemPage'
import { TenantBadge } from './TenantBadge'

export interface SessionMismatchProps {
  loginHref: string
  tenant?: { name: string; slug: string }
  errorRef?: string
}

export function SessionMismatch({ loginHref, tenant, errorRef }: SessionMismatchProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!errorRef || typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(errorRef)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write denied by browser
    }
  }

  return (
    <SystemPage>
      <div className="flex flex-col items-center text-center">
        {tenant && (
          <div className="mb-6 w-full text-left">
            <TenantBadge variant="hero" name={tenant.name} slug={tenant.slug} />
          </div>
        )}
        <Lock className="size-10 text-ink-muted" aria-hidden="true" />
        <h1 className="mt-4 text-h2 font-semibold text-ink">{t('sys.sessionMismatch.title')}</h1>
        <p className="mt-2 text-body-lg text-ink-soft">{t('sys.sessionMismatch.body')}</p>
        <div className="mt-6 w-full md:w-auto">
          <a
            href={loginHref}
            className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'w-full md:w-auto')}
          >
            {t('sys.sessionMismatch.signIn')}
          </a>
        </div>
        {errorRef && (
          <div className="mt-6 flex w-full flex-col items-center gap-2 rounded-lg border border-line bg-surface-subtle p-4">
            <span className="text-caption text-ink-muted">{t('sys.sessionMismatch.refLabel')}</span>
            <code className="font-mono text-body font-semibold text-ink">{errorRef}</code>
            <Button
              variant="tonal"
              size="sm"
              leadingIcon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => void handleCopy()}
            >
              {t('common.copy')}
            </Button>
          </div>
        )}
      </div>
    </SystemPage>
  )
}
