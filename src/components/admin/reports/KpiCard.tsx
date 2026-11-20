import { Card } from '~/components/ui'

export interface KpiCardProps {
  readonly label: string
  readonly value: string
  readonly subtitle?: string | null
}

export function KpiCard({ label, value, subtitle = null }: KpiCardProps) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-caption font-medium text-ink-soft">{label}</span>
      <span className="font-mono text-h2 font-bold tabular-nums text-ink">{value}</span>
      {subtitle ? <span className="text-caption text-ink-soft">{subtitle}</span> : null}
    </Card>
  )
}
