import Decimal from 'decimal.js'

/** Instans `Decimal` terkonfigurasi lokal untuk kernel (tanpa mutasi global). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type KernelDecimal = InstanceType<typeof D>

declare const QtyBrand: unique symbol

/** Kuantitas desimal kanonik berskala maksimum 4 digit pecahan (BR-MNY-002/008). */
export type Qty = string & { readonly [QtyBrand]: true }

export const QTY_PATTERN: RegExp = /^-?\d+(\.\d{1,4})?$/

const RAW_DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/

export type QtyErrorCode = 'INVALID_FORMAT' | 'SCALE_EXCEEDED' | 'FRACTION_NOT_ALLOWED' | 'NOT_POSITIVE'

export class QtyError extends Error {
  constructor(
    public readonly code: QtyErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'QtyError'
  }
}

export function normalizeQty(q: Qty): Qty {
  const raw = q as string
  const dotIdx = raw.indexOf('.')
  let intPart = dotIdx === -1 ? raw : raw.slice(0, dotIdx)
  let fracPart = dotIdx === -1 ? '' : raw.slice(dotIdx + 1)

  if (fracPart.length > 0) {
    fracPart = fracPart.replace(/0+$/, '')
  }
  if (intPart === '-0' && fracPart.length === 0) {
    intPart = '0'
  }
  const normalized = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart
  return normalized as Qty
}

export function parseQty(input: string): Qty {
  if (typeof input !== 'string' || !RAW_DECIMAL_PATTERN.test(input)) {
    throw new QtyError('INVALID_FORMAT', `Format kuantitas tidak valid: "${String(input)}"`)
  }

  const unsigned = input.startsWith('-') ? input.slice(1) : input
  const dotIdx = unsigned.indexOf('.')
  const intPart = dotIdx === -1 ? unsigned : unsigned.slice(0, dotIdx)
  const fracPart = dotIdx === -1 ? '' : unsigned.slice(dotIdx + 1)

  // Nol di depan dilarang kecuali tepat "0" (mis. "01", "-00.5" ditolak)
  if (intPart.length > 1 && intPart.startsWith('0')) {
    throw new QtyError('INVALID_FORMAT', `Nol di depan tidak diizinkan pada kuantitas: "${input}"`)
  }

  if (fracPart.length > 4) {
    throw new QtyError(
      'SCALE_EXCEEDED',
      `Kuantitas melebihi batas 4 angka di belakang koma: "${input}"`,
    )
  }

  return normalizeQty(input as Qty)
}

function decimalToQty(value: KernelDecimal): Qty {
  if (value.decimalPlaces() > 4) {
    throw new QtyError(
      'SCALE_EXCEEDED',
      `Hasil perhitungan kuantitas melebihi skala 4: ${value.toFixed()}`,
    )
  }
  return normalizeQty(value.toFixed() as Qty)
}

export function qtyToDecimal(q: Qty): KernelDecimal {
  return new D(q)
}

export function addQty(a: Qty, b: Qty): Qty {
  return decimalToQty(qtyToDecimal(a).plus(qtyToDecimal(b)))
}

export function subQty(a: Qty, b: Qty): Qty {
  return decimalToQty(qtyToDecimal(a).minus(qtyToDecimal(b)))
}

export function mulQty(a: Qty, factor: Qty): Qty {
  return decimalToQty(qtyToDecimal(a).times(qtyToDecimal(factor)))
}

export function cmpQty(a: Qty, b: Qty): -1 | 0 | 1 {
  const res = qtyToDecimal(a).comparedTo(qtyToDecimal(b))
  if (res < 0) return -1
  if (res > 0) return 1
  return 0
}

export function isPositiveQty(q: Qty): boolean {
  return qtyToDecimal(q).gt(0)
}

export function isIntegerQty(q: Qty): boolean {
  return qtyToDecimal(q).isInteger()
}

export function qtyToBase(input: { qty: Qty; factor: Qty; allowFraction: boolean }): Qty {
  if (!isPositiveQty(input.qty) || !isPositiveQty(input.factor)) {
    throw new QtyError('NOT_POSITIVE', 'Kuantitas dan faktor konversi harus lebih besar dari 0')
  }

  const base = qtyToDecimal(input.qty).times(qtyToDecimal(input.factor))
  if (base.decimalPlaces() > 4) {
    throw new QtyError(
      'SCALE_EXCEEDED',
      `Hasil konversi UOM melebihi skala 4: ${base.toFixed()}`,
    )
  }
  if (!input.allowFraction && !base.isInteger()) {
    throw new QtyError(
      'FRACTION_NOT_ALLOWED',
      `Hasil konversi UOM harus berupa bilangan bulat: ${base.toFixed()}`,
    )
  }

  return normalizeQty(base.toFixed() as Qty)
}
