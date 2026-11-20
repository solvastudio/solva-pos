export type ReceiptAlign = 'left' | 'center' | 'right'
export type ReceiptTextSize = 'normal' | 'double'

export type ReceiptNode =
  | {
      readonly t: 'text'
      readonly text: string
      readonly align?: ReceiptAlign
      readonly bold?: boolean
      readonly size?: ReceiptTextSize
    }
  | {
      readonly t: 'row'
      readonly left: string
      readonly right: string
      readonly bold?: boolean
    }
  | { readonly t: 'sep' }
  | { readonly t: 'image'; readonly ref: 'logo' }
  | { readonly t: 'qr'; readonly data: string }
  | { readonly t: 'feed'; readonly lines: number }
  | { readonly t: 'cut' }
  | { readonly t: 'drawer' }

export type ReceiptDoc = readonly ReceiptNode[]

export interface RasterAsset {
  readonly width: number
  readonly height: number
  readonly bits: Uint8Array
}
