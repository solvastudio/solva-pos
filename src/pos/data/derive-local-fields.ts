import { buildSearchTokens } from '~/modules/catalog/shared'

const INT_STRING_PATTERN = /^-?\d+$/

/**
 * Pure per-entity field derivation executed by the pull applier before writing master
 * rows into Dexie (`docs/SCHEMA.md` §6.3, BR-CAT-013/014, RSK-A04).
 */
export function deriveLocalFields(
  entity: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }

  switch (entity) {
    case 'product': {
      const name = typeof out.name === 'string' ? out.name : ''
      const code = typeof out.code === 'string' ? out.code : ''
      out.search_tokens = buildSearchTokens(name, code)
      return out
    }

    case 'price_entry': {
      out.outlet_key =
        typeof out.outlet_id === 'string' && out.outlet_id.length > 0 ? out.outlet_id : '*'
      if (typeof out.price === 'string' && INT_STRING_PATTERN.test(out.price)) {
        out.price = Number(out.price)
      }
      return out
    }

    case 'item_outlet_availability': {
      out.sku_key =
        typeof out.sku_id === 'string' && out.sku_id.length > 0 ? out.sku_id : '*'
      return out
    }

    case 'tax_rate_history': {
      out.outlet_key =
        typeof out.outlet_id === 'string' && out.outlet_id.length > 0 ? out.outlet_id : '*'
      return out
    }

    case 'sku_uom': {
      if (out.barcode === null || out.barcode === undefined) {
        // IndexedDB cannot index null/empty strings under a unique index without colliding across rows.
        delete out.barcode
      } else if (typeof out.barcode === 'string') {
        const trimmed = out.barcode.trim()
        if (trimmed.length === 0) {
          delete out.barcode
        } else {
          out.barcode = trimmed
        }
      }
      if (typeof out.conversion_factor === 'number') {
        out.conversion_factor = String(out.conversion_factor)
      }
      return out
    }

    case 'register_invoice_prefix':
    case 'outlet_receipt_setting':
    default:
      return out
  }
}
