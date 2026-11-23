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
  const svgHeight = 204
  const padLeft = 84
  const padRight = 16
  const padTop = 26
  const padBottom = 28
  const plotWidth = svgWidth - padLeft - padRight
  const chartHeight = svgHeight - padTop - padBottom
  const count = Math.max(1, points.length)
  const slotWidth = plotWidth / count
  const barWidth = Math.max(12, Math.min(52, Math.floor(slotWidth * 0.6)))
  const showValueLabels = points.length <= 7
  const yTicks = maxVal >= 2 ? [maxVal, Math.round(maxVal / 2), 0] : maxVal > 0 ? [maxVal, 0] : [0]

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
        {points.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowTable((prev) => !prev)}
          >
            {showTable ? t('admin.report.viewAsChart') : t('admin.report.viewAsTable')}
          </Button>
        ) : null}
      </div>

      {points.length === 0 ? (
        <p className="py-10 text-center text-body-sm text-ink-soft">
          {t('admin.report.sales.emptyTitle')}
        </p>
      ) : showTable ? (
        <div className="overflow-x-auto">{tableElement}</div>
      ) : (
        <div>
          <svg
            role="img"
            aria-label={ariaSummary}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="h-48 w-full overflow-visible"
          >
            <title>{ariaSummary}</title>
            {yTicks.map((tickVal) => {
              const tickRatio = maxVal > 0 ? tickVal / maxVal : 0
              const tickY = Math.round(padTop + chartHeight - tickRatio * chartHeight)
              return (
                <g key={tickVal}>
                  <line
                    x1={padLeft}
                    y1={tickY}
                    x2={svgWidth - padRight}
                    y2={tickY}
                    strokeDasharray={tickVal === 0 ? undefined : '4 4'}
                    className={tickVal === 0 ? 'stroke-line' : 'stroke-line-subtle'}
                  />
                  <text
                    x={padLeft - 8}
                    y={tickY + 4}
                    textAnchor="end"
                    className="fill-ink-muted font-mono text-caption tabular-nums"
                  >
                    {formatMoney(toMoney(tickVal), locale)}
                  </text>
                </g>
              )
            })}
            {points.map((pt, idx) => {
              const ratio = maxVal > 0 ? Math.max(0.04, Math.abs(pt.value) / maxVal) : 0.04
              const h = pt.value === 0 ? 2 : Math.round(ratio * chartHeight)
              const x = Math.round(padLeft + idx * slotWidth + (slotWidth - barWidth) / 2)
              const centerX = Math.round(padLeft + idx * slotWidth + slotWidth / 2)
              const y = padTop + (chartHeight - h)
              const isActive = idx === resolvedActiveIndex
              const formattedValue = formatMoney(toMoney(pt.value), locale)
              return (
                <g key={pt.label}>
                  <title>{`${pt.label}: ${formattedValue}`}</title>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    rx={4}
                    className={
                      isActive
                        ? 'fill-primary-700 transition-colors hover:fill-primary-800'
                        : 'fill-primary-300 transition-colors hover:fill-primary-500'
                    }
                  />
                  {showValueLabels ? (
                    <text
                      x={centerX}
                      y={y - 6}
                      textAnchor="middle"
                      className={
                        isActive
                          ? 'fill-ink font-mono text-caption font-semibold tabular-nums'
                          : 'fill-ink-soft font-mono text-caption tabular-nums'
                      }
                    >
                      {formattedValue}
                    </text>
                  ) : null}
                  <text
                    x={centerX}
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
