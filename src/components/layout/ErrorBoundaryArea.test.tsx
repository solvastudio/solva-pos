// @vitest-environment jsdom
import { changeLocale } from '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientErrorBufferForTests,
  getClientErrorBufferForTests,
} from '~/lib/client-errors/report-schema'
import { ErrorBoundaryArea } from './ErrorBoundaryArea'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
  clearClientErrorBufferForTests()
  vi.restoreAllMocks()
})

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Synthetic UI boom')
  }
  return <p>Healthy child</p>
}

describe('ErrorBoundaryArea (CMP-37)', () => {
  it('catches child error, logs client ref D-..., allows Retry recovery, and shows manual Reload after 2 crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    const user = userEvent.setup()

    const { container, rerender } = render(
      <ErrorBoundaryArea area="pos-cart" homeHref="/pos" onError={onError}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundaryArea>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(onError).toHaveBeenCalledTimes(1)
    const ref1 = onError.mock.calls[0]?.[0] as string
    expect(ref1).toMatch(/^D-\d{8}-\d{6}-[a-z0-9]{5}$/)
    expect(screen.getByTestId('error-code-value').textContent).toBe(
      `APP_ERROR#${ref1.toLowerCase()}`,
    )
    expect(getClientErrorBufferForTests()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Reload App/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Back to Home/i }).getAttribute('href')).toBe('/pos')

    const axeResults = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeResults.violations).toEqual([])

    // Second consecutive crash on Retry exposes manual Reload button without auto-reloading.
    await user.click(screen.getByRole('button', { name: /Retry/i }))
    expect(onError).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /Reload App/i })).toBeTruthy()

    // Fix child and click Retry -> recovers cleanly.
    rerender(
      <ErrorBoundaryArea area="pos-cart" homeHref="/pos" onError={onError}>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundaryArea>,
    )
    await user.click(screen.getByRole('button', { name: /Retry/i }))
    expect(screen.getByText('Healthy child')).toBeTruthy()
  }, 15_000)
})
