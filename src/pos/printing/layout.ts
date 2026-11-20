import type { ReceiptDoc } from './receipt-doc'
import { transliterateToAscii } from './transliterate'

export function wrapText(text: string, columns: number): string[] {
  const clean = transliterateToAscii(text)
  const paragraphs = clean.split('\n')
  const lines: string[] = []

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push('')
      continue
    }
    let remaining = para
    while (remaining.length > columns) {
      let splitAt = remaining.lastIndexOf(' ', columns)
      if (splitAt <= 0) {
        splitAt = columns
      }
      lines.push(remaining.slice(0, splitAt).trimEnd())
      remaining = remaining.slice(splitAt).trimStart()
    }
    lines.push(remaining)
  }

  return lines
}

export function alignLine(
  line: string,
  columns: number,
  align: 'left' | 'center' | 'right',
): string {
  if (align === 'left' || line.length >= columns) {
    return line
  }
  const pad = columns - line.length
  if (align === 'right') {
    return ' '.repeat(pad) + line
  }
  const leftPad = Math.floor(pad / 2)
  return ' '.repeat(leftPad) + line
}

/**
 * Formats a two-column left/right line of exact width `columns`, keeping `right` un-truncated
 * and truncating or wrapping `left` when combined length exceeds `columns`.
 */
export function rowLeftRight(
  left: string,
  right: string,
  columns: number,
): string[] {
  const cleanLeft = transliterateToAscii(left)
  const cleanRight = transliterateToAscii(right)
  const minGap = 1
  if (cleanLeft.length + minGap + cleanRight.length <= columns) {
    const spaces = columns - cleanLeft.length - cleanRight.length
    return [`${cleanLeft}${' '.repeat(spaces)}${cleanRight}`]
  }

  const maxFirstLeft = Math.max(0, columns - cleanRight.length - minGap)
  if (maxFirstLeft === 0) {
    return [cleanLeft, alignLine(cleanRight, columns, 'right')]
  }
  const wrappedLeft = wrapText(cleanLeft, maxFirstLeft)
  if (wrappedLeft.length === 1) {
    const part = wrappedLeft[0]!
    const spaces = columns - part.length - cleanRight.length
    return [`${part}${' '.repeat(Math.max(1, spaces))}${cleanRight}`]
  }
  const head = wrappedLeft.slice(0, -1)
  const tail = wrappedLeft[wrappedLeft.length - 1]!
  const spaces = Math.max(1, columns - tail.length - cleanRight.length)
  return [...head, `${tail}${' '.repeat(spaces)}${cleanRight}`]
}

export function separatorLine(columns: number): string {
  return '-'.repeat(columns)
}

/**
 * Pure monochrome text renderer for `ReceiptDoc` used for golden assertions and diagnostics.
 */
export function renderReceiptDocText(
  doc: ReceiptDoc,
  columns: 32 | 48 = 32,
): string {
  const out: string[] = []
  for (const node of doc) {
    switch (node.t) {
      case 'text': {
        const effCols = node.size === 'double' ? Math.max(1, Math.floor(columns / 2)) : columns
        for (const line of wrapText(node.text, effCols)) {
          out.push(alignLine(line, effCols, node.align ?? 'left'))
        }
        break
      }
      case 'row': {
        for (const r of rowLeftRight(node.left, node.right, columns)) {
          out.push(r)
        }
        break
      }
      case 'sep': {
        out.push(separatorLine(columns))
        break
      }
      case 'feed':
      case 'cut':
      case 'drawer':
      case 'image':
      case 'qr':
        break
    }
  }
  return out.join('\n')
}
