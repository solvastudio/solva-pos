// @vitest-environment jsdom
import { changeLocale } from '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PairingForm } from './PairingForm'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('PairingForm (SCR-P01)', () => {
  it('submits formatted 8-char code & device name cleanly and passes axe a11y', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    const { container } = render(
      <PairingForm
        tenantName="Acme Coffee"
        tenantSlug="acme"
        initialCode="AB23-CD45"
        initialDeviceName="Cashier 1"
        hasOtherTenants={true}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('heading', { name: /Pair device to Acme Coffee/i })).toBeTruthy()
    expect(screen.getByText(/also used for another business/i)).toBeTruthy()
    expect(screen.getByText(/Internet is required only once/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Pair Device/i }))
    expect(onSubmit).toHaveBeenCalledWith({ code: 'AB23CD45', deviceName: 'Cashier 1' })

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('displays error messages, progress bar, and locks inputs during rate limit', () => {
    render(
      <PairingForm
        tenantName="Acme"
        tenantSlug="acme"
        error="RATE_LIMITED"
        rateLimitedDisabled={true}
        progress={{ step: 1, total: 3 }}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Too many attempts')
    expect((screen.getByLabelText(/Pairing code/i) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Pair Device/i }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('Downloading data 1/3')).toBeTruthy()
  })
})
