import { useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/Button'
import { Card } from '~/components/ui/Card'

const CALIBRATION_PARAMS = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
}

const SAMPLE_ROW = {
  device_salt: '_-7dzLuqmYh3ZlVEMyIRAA',
  kdf_algo: 'ARGON2ID' as const,
  kdf_params: CALIBRATION_PARAMS,
  kdf_salt: 'ABEiM0RVZneImaq7zN3u_w',
}

export const Route = createFileRoute('/$tenant/pos/_dev/argon-bench')({
  ssr: false,
  beforeLoad: () => {
    if (!import.meta.env.DEV && !import.meta.env.VITE_E2E) {
      throw notFound()
    }
  },
  component: ArgonBenchRouteComponent,
})

function ArgonBenchRouteComponent() {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const [doneCount, setDoneCount] = useState(0)
  const [stats, setStats] = useState<{ p50: number; p95: number } | null>(null)

  async function handleRun() {
    setRunning(true)
    setDoneCount(0)
    setStats(null)
    const timings: number[] = []

    try {
      const { computePinHash } = await import('~/pos/session/pin-kdf')
      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now()
        await computePinHash('4827', SAMPLE_ROW)
        timings.push(Math.round(performance.now() - t0))
        setDoneCount(i + 1)
      }
      timings.sort((a, b) => a - b)
      const p50 = timings[Math.floor(timings.length * 0.5)] ?? 0
      const p95 = timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)] ?? 0
      setStats({ p50, p95 })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="text-h2 font-semibold text-ink">{t('pos.argonBench.title')}</h1>
        <p className="text-body-sm text-ink-soft">{t('pos.argonBench.subtitle')}</p>
        <p className="text-caption text-ink-muted">
          {t('pos.argonBench.params', {
            mem: CALIBRATION_PARAMS.memorySize,
            iter: CALIBRATION_PARAMS.iterations,
            par: CALIBRATION_PARAMS.parallelism,
          })}
        </p>

        <div>
          <Button variant="primary" size="md" loading={running} onClick={() => void handleRun()}>
            {running
              ? t('pos.argonBench.running', { done: doneCount })
              : t('pos.argonBench.run')}
          </Button>
        </div>

        {stats ? (
          <div className="rounded-control border border-line bg-surface-subtle p-4 text-body">
            <p className="font-semibold text-ink">{t('pos.argonBench.p50', { ms: stats.p50 })}</p>
            <p className="text-ink-soft">{t('pos.argonBench.p95', { ms: stats.p95 })}</p>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
