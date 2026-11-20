export const MAX_PRODUCT_ATTRIBUTES = 3
export const MAX_ACTIVE_SKUS_PER_PRODUCT = 100
export const MAX_SKU_CODE_LENGTH = 40

export type VariantErrorCode =
  | 'MAX_ATTRIBUTES_EXCEEDED'
  | 'MAX_SKUS_EXCEEDED'
  | 'DUPLICATE_ATTRIBUTE_NAME'
  | 'DUPLICATE_VALUE'

export class VariantLimitError extends Error {
  constructor(
    public readonly code: VariantErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'VariantLimitError'
  }
}

export interface VariantAttributeValueInput {
  id: string
  value: string
}

export interface VariantAttributeInput {
  name: string
  values: readonly VariantAttributeValueInput[]
}

export interface ExistingSkuCombo {
  combo: readonly string[]
  skuCode?: string
}

export interface GeneratedSkuSpec {
  valueIds: string[]
  skuCode: string
  variantLabel: string
}

/**
 * Strips non-alphanumeric characters, uppercases, and takes up to 3 characters.
 */
export function deriveValueCode(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (cleaned.length === 0) {
    return 'V'
  }
  return cleaned.slice(0, 3)
}

function comboKey(valueIds: readonly string[]): string {
  return [...valueIds].sort().join('|')
}

function fitSkuCode(prefix: string, segments: readonly string[], suffix = ''): string {
  const full = `${prefix}-${segments.join('-')}`
  const maxBodyLen = MAX_SKU_CODE_LENGTH - suffix.length
  const truncated = full.slice(0, Math.max(1, maxBodyLen)).replace(/-+$/g, '')
  return `${truncated}${suffix}`
}

/**
 * Generates missing cartesian SKU combinations in attribute & value order (BR-CAT-002/005),
 * enforcing <= 3 attributes and <= 100 active SKUs and deduplicating `skuCode` with `-2`, `-3`, ...
 */
export function generateSkus(input: {
  productCode: string
  attributes: readonly VariantAttributeInput[]
  existing: readonly ExistingSkuCombo[]
}): { create: GeneratedSkuSpec[] } {
  if (input.attributes.length > MAX_PRODUCT_ATTRIBUTES) {
    throw new VariantLimitError(
      'MAX_ATTRIBUTES_EXCEEDED',
      `Product attributes cannot exceed ${MAX_PRODUCT_ATTRIBUTES}`,
    )
  }

  const seenAttrNames = new Set<string>()
  for (const attr of input.attributes) {
    const normAttr = attr.name.trim().toLowerCase()
    if (seenAttrNames.has(normAttr)) {
      throw new VariantLimitError(
        'DUPLICATE_ATTRIBUTE_NAME',
        `Duplicate attribute name: ${attr.name}`,
      )
    }
    seenAttrNames.add(normAttr)

    const seenValues = new Set<string>()
    for (const v of attr.values) {
      const normVal = v.value.trim().toLowerCase()
      if (seenValues.has(normVal)) {
        throw new VariantLimitError('DUPLICATE_VALUE', `Duplicate value: ${v.value}`)
      }
      seenValues.add(normVal)
    }
  }

  if (input.attributes.length === 0 || input.attributes.some((a) => a.values.length === 0)) {
    return { create: [] }
  }

  const existingCombos = new Set<string>()
  const usedCodes = new Set<string>()
  for (const ex of input.existing) {
    existingCombos.add(comboKey(ex.combo))
    if (ex.skuCode) {
      usedCodes.add(ex.skuCode)
    }
  }

  // Build cartesian product cleanly without exceeding limit early.
  let combos: VariantAttributeValueInput[][] = [[]]
  for (const attr of input.attributes) {
    const next: VariantAttributeValueInput[][] = []
    for (const prefix of combos) {
      for (const val of attr.values) {
        next.push([...prefix, val])
        if (next.length > MAX_ACTIVE_SKUS_PER_PRODUCT) {
          throw new VariantLimitError(
            'MAX_SKUS_EXCEEDED',
            `Cartesian variant combinations cannot exceed ${MAX_ACTIVE_SKUS_PER_PRODUCT} SKUs`,
          )
        }
      }
    }
    combos = next
  }

  const create: GeneratedSkuSpec[] = []
  for (const combo of combos) {
    const valueIds = combo.map((c) => c.id)
    if (existingCombos.has(comboKey(valueIds))) {
      continue
    }

    const codeSegments = combo.map((c) => deriveValueCode(c.value))
    let candidate = fitSkuCode(input.productCode, codeSegments)
    if (usedCodes.has(candidate)) {
      let counter = 2
      while (usedCodes.has(fitSkuCode(input.productCode, codeSegments, `-${counter}`))) {
        counter += 1
      }
      candidate = fitSkuCode(input.productCode, codeSegments, `-${counter}`)
    }
    usedCodes.add(candidate)

    create.push({
      valueIds,
      skuCode: candidate,
      variantLabel: combo.map((c) => c.value).join(' / '),
    })
  }

  if (input.existing.length + create.length > MAX_ACTIVE_SKUS_PER_PRODUCT) {
    throw new VariantLimitError(
      'MAX_SKUS_EXCEEDED',
      `Total active SKUs cannot exceed ${MAX_ACTIVE_SKUS_PER_PRODUCT}`,
    )
  }

  return { create }
}
