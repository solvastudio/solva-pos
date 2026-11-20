// @vitest-environment jsdom
import { changeLocale } from '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCodeBlock } from './index'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function expectZeroAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
    },
  })
  expect(results.violations).toEqual([])
}

describe('ErrorCodeBlock (CMP-36)', () => {
  it('displays formatted error code and local note, and copies cleanly to clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const { container } = render(
      <ErrorCodeBlock code="app_error" refId="D-20261120-080000-ab12c" />,
    )

    const codeEl = screen.getByTestId('error-code-value')
    expect(codeEl.textContent).toBe('APP_ERROR#d-20261120-080000-ab12c')
    expect(codeEl.className).toContain('whitespace-nowrap')
    expect(codeEl.className).toContain('break-keep')
    expect(screen.getByText(/Local device reference/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Copy code/i }))
    expect(writeText).toHaveBeenCalledWith('APP_ERROR#d-20261120-080000-ab12c')
    expect(screen.getAllByText('Copied').length).toBeGreaterThanOrEqual(1)

    await expectZeroAxeViolations(container)
  })

  it('selects code text and shows fallback guidance when clipboard write rejects', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard blocked'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const addRange = vi.fn()
    const removeAllRanges = vi.fn()
    vi.spyOn(window, 'getSelection').mockReturnValue({
      addRange,
      removeAllRanges,
    } as unknown as Selection)

    render(<ErrorCodeBlock code="INTERNAL_ERROR" refId="20261120-080000-xy99z" local={false} />)

    expect(screen.queryByText(/Local device reference/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: /Copy code/i }))
    expect(removeAllRanges).toHaveBeenCalled()
    expect(addRange).toHaveBeenCalled()
    expect(screen.getByText(/Code selected/i)).toBeTruthy()
  })
})
