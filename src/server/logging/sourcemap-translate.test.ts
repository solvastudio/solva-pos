import { TraceMap } from '@jridgewell/trace-mapping'
import { describe, expect, it } from 'vitest'
import { parseTraceMapSafe, translateLogEntryStacks, translateStack } from './sourcemap-translate'

const SAMPLE_V3_MAP = JSON.stringify({
  version: 3,
  file: 'main-ABC123.js',
  sources: ['src/pos/CartPanel.tsx'],
  names: ['checkout', 'applyDiscount'],
  // Minimal VLQ mappings: line 1 col 10 -> src 0, line 11 (0-based 10), col 0 (name 0);
  // line 2 col 20 -> src 0, line 25 (0-based 24), col 1 (name 1)
  mappings: 'UAUAA;oBAcCC',
})

describe('sourcemap-translate stack translator', () => {
  it('translates mapped frames to original source:line:col and marks unmapped frames', () => {
    const map = new TraceMap(SAMPLE_V3_MAP)
    const stack = [
      'Error: invalid quantity',
      '    at Object.a (https://app.solva.test/assets/main-ABC123.js:1:11)',
      '    at Object.b (https://app.solva.test/assets/main-ABC123.js:2:21)',
      '    at vendor (https://app.solva.test/assets/vendor-999.js:5:12)',
    ].join('\n')

    const translated = translateStack(stack, (asset) => (asset === 'main-ABC123.js' ? map : null))
    expect(translated).toContain('src/pos/CartPanel.tsx:11:1 (checkout)')
    expect(translated).toContain('src/pos/CartPanel.tsx:25:2 (applyDiscount)')
    expect(translated).toContain('vendor-999.js:5:12 (no map)')
  })

  it('never throws on malformed or corrupt map files', () => {
    expect(parseTraceMapSafe('{broken json')).toBeNull()

    const corruptedLoader = () => ({}) as unknown as TraceMap
    const out = translateStack('at x (https://x/assets/app.js:1:2)', corruptedLoader)
    expect(out).toContain('(no map)')

    const entry = translateLogEntryStacks(
      {
        appVersion: 'v1.0.0',
        clientError: {
          name: 'APP_ERROR',
          message: 'fail',
          stack: 'at a (https://x/assets/main-ABC123.js:1:11)',
        },
      },
      () => () => new TraceMap(SAMPLE_V3_MAP),
    )
    expect((entry.clientError as { stack: string }).stack).toContain('src/pos/CartPanel.tsx:11:1')
  })
})
