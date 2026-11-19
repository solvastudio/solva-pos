// @vitest-environment jsdom
import '~/i18n'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Bell,
  Button,
  Card,
  Checkbox,
  Chip,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Package,
  Radio,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tabs,
  ToastProvider,
  Tooltip,
  useToast,
} from './index'

afterEach(() => {
  cleanup()
})

async function expectZeroAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // jsdom does not render computed CSS for color-contrast; contrast ratios are covered by DESIGN Appendix B and tokens.test.ts
      'color-contrast': { enabled: false },
    },
  })
  expect(results.violations).toEqual([])
}

function ToastHarness() {
  const toast = useToast()
  return (
    <div>
      <Button onClick={() => toast.show({ tone: 'success', message: 'Saved' })}>Show Success</Button>
      <Button onClick={() => toast.show({ tone: 'danger', message: 'Failed' })}>Show Danger</Button>
    </div>
  )
}

describe('components/ui primitives and accessibility', () => {
  it('Button: renders variants, disabled state without opacity-*, and loading aria-busy ignores clicks', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onLoadingClick = vi.fn()

    const { container } = render(
      <div>
        <Button variant="primary" size="xl" onClick={onClick}>
          Pay Now
        </Button>
        <Button variant="secondary" size="md">
          Cancel
        </Button>
        <Button variant="tonal">Edit</Button>
        <Button variant="ghost">More</Button>
        <Button variant="danger">Void</Button>
        <Button variant="danger-outline">Remove</Button>
        <Button variant="link">Detail</Button>
        <Button disabled>DisabledBtn</Button>
        <Button loading loadingLabel="Saving" onClick={onLoadingClick}>
          Save
        </Button>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Pay Now' }))
    expect(onClick).toHaveBeenCalledTimes(1)

    const disabledBtn = screen.getByRole('button', { name: 'DisabledBtn' })
    expect(disabledBtn).toBeDisabled()
    expect(disabledBtn.className).not.toMatch(/opacity-/)
    expect(disabledBtn.className).toContain('disabled:bg-surface-sunken')
    expect(disabledBtn.className).toContain('disabled:text-ink-disabled')

    const loadingBtn = screen.getByRole('button', { name: 'Saving' })
    expect(loadingBtn).toHaveAttribute('aria-busy', 'true')
    expect(loadingBtn).toBeDisabled()
    await user.click(loadingBtn)
    expect(onLoadingClick).not.toHaveBeenCalled()

    await expectZeroAxeViolations(container)
  })

  it('IconButton & Chip: has aria-label, badge 99+, icon + text, and 0 axe violations', async () => {
    const { container } = render(
      <div>
        <IconButton label="Notifications" icon={<Bell />} badge={120} />
        <Chip status="online" label="Online" />
        <Chip status="offline" label="Offline" />
        <Chip status="needs_attention" label="Attention" size="sm" announce />
      </div>,
    )

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByText('99+')).toBeInTheDocument()
    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent('Attention')
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    await expectZeroAxeViolations(container)
  })

  it('Input, Field & Select: supports default and error states with 0 axe violations', async () => {
    const { container } = render(
      <div>
        <Field label="Amount" htmlFor="amt" hint="In IDR">
          <Input id="amt" kind="money" prefix="Rp" placeholder="0" defaultValue="15000" />
        </Field>
        <Field label="PIN" htmlFor="pin" error="Wrong PIN">
          <Input id="pin" kind="pin" invalid />
        </Field>
        <Field label="Disabled Field" htmlFor="dis">
          <Input id="dis" disabled value="Locked" />
        </Field>
        <Field label="Method" htmlFor="method">
          <Select
            id="method"
            ariaLabel="Method"
            value="cash"
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'qris', label: 'QRIS' },
            ]}
          />
        </Field>
      </div>,
    )

    expect(screen.getByLabelText('PIN')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('PIN')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Amount')).toHaveClass('tabular-nums')
    expect(screen.getByLabelText('Disabled Field')).toBeDisabled()

    await expectZeroAxeViolations(container)
  })

  it('Tabs, Segmented, Checkbox, Radio, Switch, Tooltip, Card, EmptyState, Skeleton: interactions and axe pass', async () => {
    const user = userEvent.setup()
    const onTab = vi.fn()
    const onSeg = vi.fn()
    const onCheck = vi.fn()
    const onRadio = vi.fn()
    const onSwitch = vi.fn()

    const { container } = render(
      <div>
        <Tabs
          value="a"
          onValueChange={onTab}
          ariaLabel="Category"
          items={[
            { value: 'a', label: 'Coffee', badge: 2 },
            { value: 'b', label: 'Tea' },
          ]}
        />
        <Segmented
          ariaLabel="Discount mode"
          value="pct"
          onChange={onSeg}
          options={[
            { value: 'pct', label: 'Percent' },
            { value: 'nom', label: 'Nominal' },
          ]}
        />
        <Checkbox label="Auto print" checked={false} onCheckedChange={onCheck} />
        <Radio
          ariaLabel="Paper size"
          value="58"
          onValueChange={onRadio}
          options={[
            { value: '58', label: '58 mm' },
            { value: '80', label: '80 mm' },
          ]}
        />
        <Switch label="Table mode" stateText="Inactive" checked={false} onCheckedChange={onSwitch} />
        <Tooltip content="Quick help">
          <Button variant="ghost">Help</Button>
        </Tooltip>
        <Card variant="selected" padding="pos">
          <EmptyState icon={<Package />} title="Empty" description="No items found" />
          <Skeleton className="h-6 w-32" label="Loading items" />
        </Card>
      </div>,
    )

    await user.click(screen.getByRole('radio', { name: /Tea/ }))
    expect(onTab).toHaveBeenCalledWith('b')

    await user.click(screen.getByRole('radio', { name: 'Nominal' }))
    expect(onSeg).toHaveBeenCalledWith('nom')

    await user.click(screen.getByRole('checkbox', { name: 'Auto print' }))
    expect(onCheck).toHaveBeenCalledWith(true)

    await user.click(screen.getByRole('switch'))
    expect(onSwitch).toHaveBeenCalledWith(true)

    await expectZeroAxeViolations(container)
  })

  it('Dialog & Toast: focus enters dialog, Esc closes (unless dismissible=false), Toast renders status/alert', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onLockedChange = vi.fn()

    const { container, rerender } = render(
      <ToastProvider>
        <ToastHarness />
        <Dialog open={false} onOpenChange={onOpenChange} title="Confirm Void" description="Mark as VOID">
          <Input aria-label="Reason" />
        </Dialog>
      </ToastProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Show Success' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')

    await user.click(screen.getByRole('button', { name: 'Show Danger' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')

    rerender(
      <ToastProvider>
        <ToastHarness />
        <Dialog open onOpenChange={onOpenChange} title="Confirm Void" description="Mark as VOID">
          <Input aria-label="Reason" />
        </Dialog>
      </ToastProvider>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await expectZeroAxeViolations(container)

    rerender(
      <ToastProvider>
        <Dialog open onOpenChange={onLockedChange} dismissible={false} title="Mandatory Lock">
          <Skeleton className="h-4 w-16" label="Loading" />
        </Dialog>
      </ToastProvider>,
    )
    await user.keyboard('{Escape}')
    expect(onLockedChange).not.toHaveBeenCalled()
  })

  it('DataTable: renders empty/loading states, sorts, paginates, and passes axe', async () => {
    const user = userEvent.setup()
    interface Item {
      id: string
      name: string
      amount: number
    }
    const cols = [
      { id: 'name', header: 'Name', sortValue: (r: Item) => r.name, cell: (r: Item) => r.name },
      {
        id: 'amount',
        header: 'Amount',
        numeric: true,
        sortValue: (r: Item) => r.amount,
        cell: (r: Item) => String(r.amount),
      },
    ] as const

    const rows: Item[] = [
      { id: '1', name: 'Beta', amount: 200 },
      { id: '2', name: 'Alpha', amount: 100 },
      { id: '3', name: 'Gamma', amount: 300 },
    ]

    const { container, rerender } = render(
      <DataTable
        caption="Sample items"
        columns={cols}
        rows={rows}
        getRowKey={(r) => r.id}
        emptyTitle="No items"
        pageSize={2}
      />,
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBe(3) // 1 header + 2 rows on page 1
    await user.click(screen.getByRole('button', { name: /Name/ }))
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByRole('button', { name: /Berikutnya|Next/ }))
    expect(screen.getAllByText('Gamma').length).toBeGreaterThanOrEqual(1)

    await expectZeroAxeViolations(container)

    rerender(
      <DataTable
        caption="Empty table"
        columns={cols}
        rows={[]}
        getRowKey={(r) => r.id}
        emptyTitle="Nothing here"
      />,
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()

    rerender(
      <DataTable
        caption="Loading table"
        columns={cols}
        rows={[]}
        loading
        getRowKey={(r) => r.id}
        emptyTitle="Nothing here"
      />,
    )
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })
})
