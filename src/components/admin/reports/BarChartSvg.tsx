import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card } from '~/components/ui'
import { formatMoney, toMoney } from '~/lib/kernel'

export interface BarChartPoint {
  readonly label: string
  readonly value: number
}

export interface BarChartSvgProps {
  readonly title: string
  readonly points: readonly BarChartPoint[]
  readonly activeIndex?: number
  readonly colLabelHeader?: string
  readonly colValueHeader?: string
}

export function BarChartSvg({
  title,
  points,
  activeIndex,
  colLabelHeader,
  colValueHeader,
}: BarChartSvgProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en-US' ? 'en-US' : 'id-ID'
  const [showTable, setShowTable] = useState(false)

  const resolvedActiveIndex =
    activeIndex !== undefined ? activeIndex : Math.max(0, points.length - 1)

  const maxVal = points.reduce((acc, p) => Math.max(acc, Math.abs(p.value)), 0)
  const totalVal = points.reduce((acc, p) => acc + p.value, 0)

  const ariaSummary = t('admin.report.chartAriaSummary', {
    title,
    count: points.length,
    max: formatMoney(toMoney(maxVal), locale),
    total: formatMoney(toMoney(totalVal), locale),
  })

  const svgWidth = 600
  const svgHeight = 180
  const padTop = 16
  const padBottom = 28
  const chartHeight = svgHeight - padTop - padBottom
  const count = Math.max(1, points.length)
  const slotWidth = svgWidth / count
  const barWidth = Math.max(12, Math.min(48, Math.floor(slotWidth * 0.65)))

  const tableElement = (
    <table className="w-full border-collapse text-left text-body-sm">
      <caption className="sr-only">{title}</caption>
      <thead>
        <tr className="border-b border-line text-caption font-semibold text-ink-soft">
          <th scope="col" className="px-3 py-2">
            {colLabelHeader ?? t('admin.report.sales.colPeriod')}
          </th>
          <th scope="col" className="px-3 py-2 text-right">
            {colValueHeader ?? t('admin.report.sales.colNetSales')}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-subtle">
        {points.map((pt) => (
          <tr key={pt.label}>
            <td className="px-3 py-2 font-mono">{pt.label}</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">
              {formatMoney(toMoney(pt.value), locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold text-ink">{title}</h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setShowTable((prev) => !prev)}
        >
          {showTable ? t('admin.report.viewAsChart') : t('admin.report.viewAsTable')}
        </Button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">{tableElement}</div>
      ) : (
        <div>
          <svg
            role="img"
            aria-label={ariaSummary}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="h-44 w-full overflow-visible"
          >
            <title>{ariaSummary}</title>
            {points.map((pt, idx) => {
              const ratio = maxVal > 0 ? Math.max(0.04, Math.abs(pt.value) / maxVal) : 0.04
              const h = Math.round(ratio * chartHeight)
              const x = Math.round(idx * slotWidth + (slotWidth - barWidth) / 2)
              const y = padTop + (chartHeight - h)
              const isActive = idx === resolvedActiveIndex
              return (
                <g key={pt.label}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    rx={4}
                    className={isActive ? 'fill-success-solid' : 'fill-ink-muted'}
                  />
                  <text
                    x={Math.round(idx * slotWidth + slotWidth / 2)}
                    y={svgHeight - 8}
                    textAnchor="middle"
                    className="fill-ink-soft font-mono text-caption"
                  >
                    {pt.label.slice(-5)}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="sr-only">{tableElement}</div>
        </div>
      )}
    </Card>
  )
}
