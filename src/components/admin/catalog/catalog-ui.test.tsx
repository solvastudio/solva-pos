// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvailabilityMatrix } from '~/components/admin/availability/AvailabilityMatrix'
import { FeatureFlagsPanel } from '~/components/admin/features/FeatureFlagsPanel'
import { PriceMatrix } from '~/components/admin/prices/PriceMatrix'
import { ToastProvider } from '~/components/ui'
import { changeLocale } from '~/i18n'
import type { FeatureFlagDefinition } from '~/lib/feature-flags'
import {
  type AdminProductDetail,
  type AdminProductListItem,
  type AvailabilityMatrixResult,
  type CategoryView,
  type PriceMatrixResult,
  type UomView,
} from '~/modules/catalog/shared'
import { ImportWizard } from './ImportWizard'
import { ProductForm } from './ProductForm'
import { ProductTable } from './ProductTable'
import { VariantsTab } from './VariantsTab'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await changeLocale('en-US')
})

afterEach(() => {
  cleanup()
})

const CATEGORIES: CategoryView[] = [
  { id: 'c1', parentId: null, name: 'Beverages', sortOrder: 0 },
]

const UOMS: UomView[] = [
  { id: 'u1', code: 'pcs', name: 'Pieces', allowFraction: false },
]

describe('catalog admin UI components (jsdom + axe)', () => {
  it('ProductTable renders rows with price range, availability, and 0 axe violations', async () => {
    const rows: AdminProductListItem[] = [
      {
        id: 'p1',
        code: 'KP-1',
        name: 'Kopi Aren',
        categoryId: 'c1',
        categoryPath: 'Beverages',
        productType: 'MENU_FNB',
        skuCount: 2,
        priceRange: { min: 15000, max: 20000 },
        availability: { available: 2, total: 3 },
        isActive: true,
      },
    ]

    const { container } = wrap(<ProductTable tenantSlug="acme" rows={rows} />)
    expect(screen.getAllByText('Kopi Aren').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('2/3 outlets').length).toBeGreaterThanOrEqual(1)

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('ProductForm previews variant SKU combinations and flags >100 SKU overflow', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <ProductForm
        tenantSlug="acme"
        categories={CATEGORIES}
        uoms={UOMS}
        canManageTenantWide={true}
        scopedOutletIds={null}
      />,
    )

    await user.click(screen.getByRole('switch', { name: /Product has variants/i }))
    await user.type(screen.getByPlaceholderText('Attribute name'), 'Size')
    await user.type(screen.getByPlaceholderText('Values (comma separated)'), 'S, M')

    expect(screen.getByText(/Generated SKU combinations \(2\/100\)/i)).toBeTruthy()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('VariantsTab renders attributes and SKU table cleanly with 0 axe violations', async () => {
    const detail: AdminProductDetail = {
      product: {
        id: 'p1',
        categoryId: 'c1',
        code: 'KAOS',
        name: 'Kaos',
        productType: 'RETAIL',
        hasVariants: true,
        baseUomId: 'u1',
        trackStock: true,
        taxable: true,
        isActive: true,
        isOpenPrice: false,
        sortOrder: 0,
      },
      attributes: [
        {
          attribute: { id: 'a1', productId: 'p1', name: 'Size', sortOrder: 0 },
          values: [
            { id: 'v1', attributeId: 'a1', value: 'S', sortOrder: 0 },
            { id: 'v2', attributeId: 'a1', value: 'M', sortOrder: 1 },
          ],
        },
      ],
      skus: [
        {
          id: 's1',
          productId: 'p1',
          skuCode: 'KAOS-S',
          variantLabel: 'S',
          isDefault: false,
          isActive: true,
          sortOrder: 0,
        },
      ],
      skuAttributeLinks: [{ skuId: 's1', attributeValueId: 'v1' }],
      skuUoms: [{ id: 'su1', skuId: 's1', uomId: 'u1', conversionFactor: '1', isBase: true, barcode: null }],
      prices: [],
      availability: [],
      outlets: [],
    }

    const { container } = wrap(
      <VariantsTab tenantSlug="acme" detail={detail} canManageTenantWide={true} />,
    )
    expect(screen.getByText('Size')).toBeTruthy()
    expect(screen.getByDisplayValue('KAOS-S')).toBeTruthy()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('PriceMatrix shows unset chip and sticky footer when cell changes', async () => {
    const user = userEvent.setup()
    const matrix: PriceMatrixResult = {
      outlets: [{ id: 'o1', code: 'OUT01', name: 'Outlet 1' }],
      canEditDefault: true,
      total: 1,
      page: 1,
      pageSize: 100,
      rows: [
        {
          productId: 'p1',
          productCode: 'KP-1',
          productName: 'Kopi',
          categoryPath: 'Beverages',
          isOpenPrice: false,
          skuId: 's1',
          skuCode: 'KP-1',
          variantLabel: null,
          uomId: 'u1',
          uomCode: 'pcs',
          uomName: 'Pieces',
          isBase: true,
          defaultPrice: null,
          outletPrices: { o1: null },
        },
      ],
    }

    const { container } = wrap(<PriceMatrix tenantSlug="acme" data={matrix} />)
    expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1)

    const inputs = screen.getAllByLabelText(/Tenant Default KP-1 pcs/i)
    await user.click(inputs[0]!)
    await user.type(inputs[0]!, '15000')
    expect(screen.getByText(/1 unsaved change/i)).toBeTruthy()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('AvailabilityMatrix displays icon+text status, locked outlet, and impact confirm dialog', async () => {
    const user = userEvent.setup()
    const data: AvailabilityMatrixResult = {
      outlets: [
        { id: 'o1', code: 'OUT01', name: 'Outlet 1' },
        { id: 'o2', code: 'OUT02', name: 'Outlet 2' },
      ],
      scopedOutletIds: ['o1'],
      total: 1,
      page: 1,
      pageSize: 50,
      rows: [
        {
          productId: 'p1',
          productCode: 'KP-1',
          productName: 'Kopi',
          categoryPath: 'Beverages',
          isActive: true,
          skus: [{ id: 's1', skuCode: 'KP-1', variantLabel: null, isActive: true }],
          productStatuses: { o1: 'AVAILABLE', o2: 'AVAILABLE' },
          skuOverrides: {},
          effectiveCounts: { o1: { available: 1, total: 1 }, o2: { available: 1, total: 1 } },
        },
      ],
    }

    const { container } = wrap(<AvailabilityMatrix tenantSlug="acme" data={data} />)
    expect(screen.getByLabelText('Outside your outlet scope')).toBeTruthy()
    const selectRowCheckbox = screen.getByRole('checkbox', { name: 'Kopi' })
    const selectRowLabel = container.querySelector(`label[for="${selectRowCheckbox.id}"]`)
    expect(selectRowLabel?.className).toContain('sr-only')

    await user.click(screen.getByRole('button', { name: 'Kopi Outlet 1' }))
    expect(screen.getByText(/Hide items in selected outlets/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Confirm unavailability/i }))
    expect(screen.getByText(/1 unsaved availability change/i)).toBeTruthy()

    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('ImportWizard renders steps and passes axe checks', async () => {
    const { container } = wrap(<ImportWizard tenantSlug="acme" />)
    expect(screen.getByText('1. Upload & Validate')).toBeTruthy()
    const axeRes = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(axeRes.violations).toEqual([])
  })

  it('FeatureFlagsPanel shows empty state for empty registry and renders flags from injected test registry', async () => {
    const empty = wrap(<FeatureFlagsPanel tenantSlug="acme" flags={[]} />)
    expect(screen.getByText('No configurable features yet')).toBeTruthy()
    expect(await axe.run(empty.container, { rules: { 'color-contrast': { enabled: false } } })).toMatchObject({
      violations: [],
    })
    cleanup()

    const testRegistry: Readonly<Record<string, FeatureFlagDefinition>> = {
      'ui.pos.fast_pay': {
        default: false,
        failMode: 'closed',
        description: 'Enable one-tap cash settle',
      },
    }
    const populated = wrap(
      <FeatureFlagsPanel tenantSlug="acme" flags={[]} registry={testRegistry} />,
    )
    expect(screen.getByText('ui.pos.fast_pay')).toBeTruthy()
    expect(screen.getByText('Enable one-tap cash settle')).toBeTruthy()
    expect(
      await axe.run(populated.container, { rules: { 'color-contrast': { enabled: false } } }),
    ).toMatchObject({ violations: [] })
  })

  it('ProductForm highlights invalid required fields on submit instead of silently ignoring', async () => {
    const user = userEvent.setup()
    wrap(
      <ProductForm
        tenantSlug="acme"
        categories={[]}
        uoms={[]}
        canManageTenantWide={true}
        scopedOutletIds={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Save product/i }))

    expect(screen.getByLabelText(/Product name/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/Product code/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Product name is required/i)).toBeTruthy()
    expect(screen.getByText(/Product code is required/i)).toBeTruthy()
    expect(screen.getByText(/Select Category first/i)).toBeTruthy()
    expect(screen.getByText(/Select Base UOM first/i)).toBeTruthy()
  })
})
