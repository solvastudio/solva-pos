import { parseQty, toMoney } from '~/lib/kernel'
import type { SaleCalc, SaleCalcInput } from './types'

export interface SalesCalcVector {
  readonly id: string
  readonly description: string
  readonly input: SaleCalcInput
  readonly expected: Partial<Pick<
    SaleCalc,
    | 'grossTotal'
    | 'lineDiscountTotal'
    | 'billDiscountTotal'
    | 'netSubtotal'
    | 'serviceCharge'
    | 'taxBase'
    | 'taxAmount'
    | 'dpp'
    | 'grandTotal'
  >> & {
    readonly lineGrosses?: readonly number[]
    readonly lineDiscounts?: readonly number[]
    readonly billDiscountAllocs?: readonly number[]
    readonly taxAllocs?: readonly number[]
  }
}

const V04_LINES: SaleCalcInput['lines'] = [
  {
    lineNo: 1,
    skuId: 'sku-kopi',
    uomId: 'uom-pcs',
    qty: parseQty('2'),
    unitPrice: toMoney(18500),
    taxable: true,
  },
  {
    lineNo: 2,
    skuId: 'sku-gula',
    uomId: 'uom-pcs',
    qty: parseQty('1'),
    unitPrice: toMoney(16000),
    taxable: true,
  },
  {
    lineNo: 3,
    skuId: 'sku-susu',
    uomId: 'uom-pcs',
    qty: parseQty('3'),
    unitPrice: toMoney(17900),
    taxable: true,
    discount: { kind: 'PERCENT', percent: '10.0000' },
  },
]

const V06_LINES: SaleCalcInput['lines'] = [
  {
    lineNo: 1,
    skuId: 'sku-nasgor',
    uomId: 'uom-porsi',
    qty: parseQty('2'),
    unitPrice: toMoney(35000),
    taxable: true,
  },
  {
    lineNo: 2,
    skuId: 'sku-esteh',
    uomId: 'uom-gelas',
    qty: parseQty('2'),
    unitPrice: toMoney(8000),
    taxable: true,
  },
  {
    lineNo: 3,
    skuId: 'sku-ayam',
    uomId: 'uom-porsi',
    qty: parseQty('1'),
    unitPrice: toMoney(44500),
    taxable: true,
  },
]

export const SALES_CALC_VECTORS: readonly SalesCalcVector[] = [
  {
    id: 'V-04',
    description: 'Contoh 1: Exclusive PPN 11%, line discount 10% on Susu, no SC',
    input: {
      lines: V04_LINES,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    },
    expected: {
      lineGrosses: [37000, 16000, 53700],
      lineDiscounts: [0, 0, 5370],
      grossTotal: toMoney(106700),
      lineDiscountTotal: toMoney(5370),
      netSubtotal: toMoney(101330),
      taxBase: toMoney(101330),
      taxAmount: toMoney(11146),
      dpp: toMoney(101330),
      grandTotal: toMoney(112476),
    },
  },
  {
    id: 'V-05',
    description: 'Contoh 2: Inclusive PPN 11% extracted with ratioRound',
    input: {
      lines: V04_LINES,
      config: {
        priceTaxMode: 'INCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    },
    expected: {
      netSubtotal: toMoney(101330),
      taxBase: toMoney(101330),
      taxAmount: toMoney(10042),
      dpp: toMoney(91288),
      grandTotal: toMoney(101330),
    },
  },
  {
    id: 'V-06',
    description: 'Contoh 3a: Bill discount 10%, SC 5% taxable, Exclusive PB1 10%',
    input: {
      lines: V06_LINES,
      billDiscount: { kind: 'PERCENT', percent: '10.0000' },
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10.0000',
        serviceChargeEnabled: true,
        serviceChargeRate: '5.0000',
        serviceChargeTaxable: true,
      },
    },
    expected: {
      grossTotal: toMoney(130500),
      billDiscountTotal: toMoney(13050),
      netSubtotal: toMoney(117450),
      serviceCharge: toMoney(5873),
      taxBase: toMoney(123323),
      taxAmount: toMoney(12332),
      dpp: toMoney(123323),
      grandTotal: toMoney(135655),
    },
  },
  {
    id: 'V-07',
    description: 'Contoh 3b: SC 5% NOT taxable, Exclusive PB1 10%',
    input: {
      lines: V06_LINES,
      billDiscount: { kind: 'PERCENT', percent: '10.0000' },
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10.0000',
        serviceChargeEnabled: true,
        serviceChargeRate: '5.0000',
        serviceChargeTaxable: false,
      },
    },
    expected: {
      billDiscountTotal: toMoney(13050),
      netSubtotal: toMoney(117450),
      serviceCharge: toMoney(5873),
      taxBase: toMoney(117450),
      taxAmount: toMoney(11745),
      dpp: toMoney(117450),
      grandTotal: toMoney(135068),
    },
  },
  {
    id: 'V-08',
    description: 'Contoh 4: Inclusive PB1 10% with taxable SC 5%',
    input: {
      lines: V06_LINES,
      billDiscount: { kind: 'PERCENT', percent: '10.0000' },
      config: {
        priceTaxMode: 'INCLUSIVE',
        taxProfile: 'PB1',
        taxRate: '10.0000',
        serviceChargeEnabled: true,
        serviceChargeRate: '5.0000',
        serviceChargeTaxable: true,
      },
    },
    expected: {
      netSubtotal: toMoney(117450),
      serviceCharge: toMoney(5873),
      taxBase: toMoney(123323),
      taxAmount: toMoney(11211),
      dpp: toMoney(112112),
      grandTotal: toMoney(123323),
    },
  },
  {
    id: 'V-09',
    description: 'Contoh 5: LR tax allocation on V-04',
    input: {
      lines: V04_LINES,
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    },
    expected: {
      taxAmount: toMoney(11146),
      taxAllocs: [4070, 1760, 5316],
    },
  },
  {
    id: 'V-30',
    description: 'Open price line alongside normal item, Exclusive PPN 11%',
    input: {
      lines: [
        {
          lineNo: 1,
          skuId: 'sku-kopi',
          uomId: 'uom-pcs',
          qty: parseQty('2'),
          unitPrice: toMoney(18500),
          taxable: true,
        },
        {
          lineNo: 2,
          skuId: 'sku-open',
          uomId: 'uom-pcs',
          qty: parseQty('1'),
          unitPrice: toMoney(12500),
          taxable: true,
          isOpenPrice: true,
        },
      ],
      config: {
        priceTaxMode: 'EXCLUSIVE',
        taxProfile: 'PPN',
        taxRate: '11.0000',
        serviceChargeEnabled: false,
        serviceChargeRate: '0.0000',
        serviceChargeTaxable: true,
      },
    },
    expected: {
      grossTotal: toMoney(49500),
      netSubtotal: toMoney(49500),
      taxAmount: toMoney(5445),
      grandTotal: toMoney(54945),
    },
  },
]
