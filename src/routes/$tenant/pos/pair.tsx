import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PairingForm, type PairingErrorKey } from '~/components/pos/pairing/PairingForm'
import { parsePairInput, stripPairFragment } from '~/pos/boot/pair-fragment'
import { listTenants } from '~/pos/db/registry'
import { invalidateBootPosCache } from '~/pos/hooks/use-boot'
import { useTenantPreview } from '~/pos/hooks/use-tenant-preview'
import { defaultDeviceName, pairDevice } from '~/pos/usecases/identity/pair-device'

export const Route = createFileRoute('/$tenant/pos/pair')({
  ssr: false,
  component: PairScreenRouteComponent,
})

function PairScreenRouteComponent() {
  const { tenant } = Route.useParams()
  const navigate = useNavigate()
  const preview = useTenantPreview(tenant)

  const [initialState] = useState<{ code: string; error: PairingErrorKey | null }>(() => {
    if (typeof window === 'undefined' || !window.location.hash) {
      return { code: '', error: null }
    }
    const parsed = parsePairInput(window.location.hash, tenant)
    if (parsed.ok) {
      return { code: parsed.code, error: null }
    }
    return {
      code: '',
      error: parsed.reason === 'WRONG_ADDRESS' ? 'WRONG_ADDRESS' : 'INVALID',
    }
  })

  const [hasOtherTenants, setHasOtherTenants] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ step: number; total: number } | null>(null)
  const [error, setError] = useState<PairingErrorKey | null>(initialState.error)
  const [rateLimitedDisabled, setRateLimitedDisabled] = useState(false)

  useEffect(() => {
    stripPairFragment()
  }, [])

  useEffect(() => {
    let cancelled = false
    void listTenants()
      .then((rows) => {
        if (cancelled) return
        const clean = tenant.trim().toLowerCase()
        setHasOtherTenants(rows.some((r) => r.slug.toLowerCase() !== clean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tenant])

  async function handleSubmit(values: { code: string; deviceName: string }) {
    setError(null)
    setSubmitting(true)
    setProgress(null)

    const result = await pairDevice({
      slug: tenant,
      code: values.code,
      deviceName: values.deviceName || defaultDeviceName(),
    })

    if (!result.ok) {
      setSubmitting(false)
      setError(result.error)
      if (result.error === 'RATE_LIMITED') {
        setRateLimitedDisabled(true)
        setTimeout(() => setRateLimitedDisabled(false), 10_000)
      }
      return
    }

    const unsub = result.syncHandle.subscribe((p) => {
      setProgress({ step: p.step, total: p.total })
    })
    await result.syncHandle.done
    unsub()

    invalidateBootPosCache(tenant)
    setSubmitting(false)
    await navigate({
      to: '/$tenant/pos/login',
      params: { tenant },
    })
  }

  return (
    <PairingForm
      tenantName={preview.name}
      tenantSlug={preview.slug}
      initialCode={initialState.code}
      initialDeviceName={defaultDeviceName()}
      hasOtherTenants={hasOtherTenants}
      submitting={submitting}
      progress={progress}
      error={error}
      rateLimitedDisabled={rateLimitedDisabled}
      onSubmit={(vals) => {
        void handleSubmit(vals)
      }}
    />
  )
}
