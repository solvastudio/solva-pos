// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BarChartSvg } from '~/components/admin/reports/BarChartSvg'
import { KpiCard } from '~/components/admin/reports/KpiCard'
import { ReportBusy } from '~/components/admin/reports/ReportBusy'
import { ReportFilters } from '~/components/admin/reports/ReportFilters'
import { ShiftVarianceCell } from '~/components/admin/reports/ShiftVarianceCell'
import '~/i18n'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Admin Reporting UI components (SCR-A02, R-01, R-03, R-04)', () => {
  it('renders KpiCard and BarChartSvg with accessible summary and table toggle and passes axe', async () => {
    const { container } = render(
      <div>
        <KpiCard label="Penjualan Neto" value="Rp 170.100" subtitle="VOID: 1" />
        <BarChartSvg
          title="Penjualan Neto Harian"
          points={[
            { label: '2026-11-16', value: 120_000 },
            { label: '2026-11-17', value: 170_100 },
          ]}
        />
      </div>,
    )

    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toContain('Penjualan Neto Harian')

    const results = await axe.run(container)
    expect(results.violations).toEqual([])

    // Toggle to table view
    const toggleBtn = screen.getByRole('button', { name: /lihat sebagai tabel/i })
    fireEvent.click(toggleBtn)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('renders ShiftVarianceCell with divergent palette, directional sign, and passes axe', async () => {
    const { container } = render(
      <div>
        <ShiftVarianceCell variance={-2100} />
        <ShiftVarianceCell variance={1500} />
        <ShiftVarianceCell variance={0} />
        <ShiftVarianceCell variance={null} />
      </div>,
    )

    expect(screen.getByText(/−Rp\s*2\.100/)).toBeTruthy()
    expect(screen.getByText(/\+Rp\s*1\.500/)).toBeTruthy()
    expect(screen.getByText(/Rp 0/)).toBeTruthy()
    expect(screen.getByText(/Belum dihitung/)).toBeTruthy()

    const results = await axe.run(container)
    expect(results.violations).toEqual([])
  })

  it('renders ReportFilters and ReportBusy with 5s cooldown before enabling retry', async () => {
    vi.useFakeTimers()
    const onRetry = vi.fn()

    render(
      <div>
        <ReportFilters
          outlets={[{ id: '11111111-1111-4111-8111-111111111111', code: 'OUT01', name: 'Utama' }]}
          selectedOutletId=""
          from="2026-11-01"
          to="2026-11-17"
          showGroupBy={true}
          onOutletChange={vi.fn()}
          onFromChange={vi.fn()}
          onToChange={vi.fn()}
          onGroupByChange={vi.fn()}
          onSubmit={vi.fn()}
          onExportCsv={vi.fn()}
        />
        <ReportBusy onRetry={onRetry} cooldownMs={5000} />
      </div>,
    )

    const retryBtn = screen.getByRole('button', { name: /coba lagi/i }) as HTMLButtonElement
    expect(retryBtn.disabled).toBe(true)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(retryBtn.disabled).toBe(false)
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
