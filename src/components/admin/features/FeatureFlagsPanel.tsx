import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, EmptyState, Field, Input, Layers, Switch, useToast } from '~/components/ui'
import { clearFeatureFlagFn, setFeatureFlagFn } from '~/functions/catalog/catalog-write.fn'
import { FEATURE_FLAGS, type FeatureFlagDefinition } from '~/lib/feature-flags'
import type { FeatureFlagView } from '~/modules/catalog/shared'
import { qk } from '~/queries/keys'

export interface FeatureFlagsPanelProps {
  tenantSlug: string
  flags: readonly FeatureFlagView[]
  registry?: Readonly<Record<string, FeatureFlagDefinition>>
}

export function FeatureFlagsPanel({
  tenantSlug,
  flags,
  registry = FEATURE_FLAGS,
}: FeatureFlagsPanelProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const flagEntries = Object.entries(registry)
  const storedByKey = new Map(flags.map((f) => [f.flagKey, f]))

  const setMut = useMutation({
    retry: 0,
    mutationFn: setFeatureFlagFn,
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: qk.featureFlags(tenantSlug) })
      toast.show({ tone: 'success', message: t('admin.features.saved') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  const clearMut = useMutation({
    retry: 0,
    mutationFn: clearFeatureFlagFn,
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never))
        return
      }
      setErrorMsg(null)
      queryClient.invalidateQueries({ queryKey: qk.featureFlags(tenantSlug) })
      toast.show({ tone: 'info', message: t('admin.features.cleared') })
    },
    onError: (err) => setErrorMsg(err.message),
  })

  if (flagEntries.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="size-10" />}
        title={t('admin.features.emptyTitle')}
        description={t('admin.features.emptyDesc')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-soft">{t('admin.features.syncNotice')}</p>

      {errorMsg ? (
        <p role="alert" className="text-body text-danger-ink">
          {errorMsg}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {flagEntries.map(([key, def]) => {
          const row = storedByKey.get(key)
          const enabled = row ? row.enabled : def.default
          const noteVal = notes[key] ?? row?.note ?? ''
          return (
            <Card key={key} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-body font-semibold text-ink">{key}</span>
                  <span className="text-body text-ink-soft">{def.description}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Switch
                    label={enabled ? t('common.active') : t('common.inactive')}
                    checked={enabled}
                    disabled={setMut.isPending || clearMut.isPending}
                    onCheckedChange={(checked) =>
                      setMut.mutate({
                        data: { key, enabled: checked, note: noteVal.trim() || null },
                      })
                    }
                  />
                  {row ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={setMut.isPending || clearMut.isPending}
                      onClick={() => clearMut.mutate({ data: { key } })}
                    >
                      {t('admin.features.resetDefault')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <Field label={t('admin.features.noteLabel')} htmlFor={`${idPrefix}-${key}-note`}>
                <Input
                  id={`${idPrefix}-${key}-note`}
                  value={noteVal}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                  disabled={setMut.isPending || clearMut.isPending}
                />
              </Field>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
