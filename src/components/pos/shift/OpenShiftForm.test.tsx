// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLocale } from '~/i18n'
import { OpenShiftForm } from './OpenShiftForm'

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('OpenShiftForm (SCR-P03)', () => {
  it('submits quick-amount opening cash and passes axe a11y', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    const { container } = render(
      <OpenShiftForm
        staffName="Sari"
        outletName="Outlet Pusat"
        registerName="Kasir 1"
        onSubmit={onSubmit}
      />,
    )

    const twoHundredBtn = screen.getByRole('button', { name: /200/i })
    await user.click(twoHundredBtn)
    await user.click(screen.getByRole('button', { name: /Open Shift/i }))

    expect(onSubmit).toHaveBeenCalledWith(200_000)

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('disables submission and displays warning when mandatory update is pending', () => {
    render(
      <OpenShiftForm
        staffName="Sari"
        outletName="Outlet Pusat"
        registerName="Kasir 1"
        mandatoryUpdateBlocked
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('mandatory app update')
    expect((screen.getByRole('button', { name: /Open Shift/i }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
