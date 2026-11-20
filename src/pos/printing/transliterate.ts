/**
 * Transliterates Unicode text to printable ASCII (`0x20..0x7E` plus `\n`) for ESC/POS
 * printers without modifying persisted documents (BR-I18N-008):
 * - Decomposes via NFD and strips combining diacritical marks (`Cafe Creme`)
 * - Normalizes common typographic punctuation (`−`, `–`, `—`, `×`, curly quotes, NBSP)
 * - Replaces any remaining outside-ASCII codepoint with `?`
 */
export function transliterateToAscii(input: string): string {
  const normalized = input
    .replace(/\u2212|\u2013|\u2014/g, '-')
    .replace(/\u00d7/g, 'x')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0|\u202f/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  let out = ''
  for (const ch of normalized) {
    if (ch === '\n') {
      out += '\n'
      continue
    }
    const code = ch.charCodeAt(0)
    if (code >= 0x20 && code <= 0x7e) {
      out += ch
    } else {
      out += '?'
    }
  }
  return out
}
