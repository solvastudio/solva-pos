import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function parseColorVars(css: string): Map<string, string> {
  const vars = new Map<string, string>()
  const re = /(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    vars.set(m[1]!, m[2]!.trim())
  }
  return vars
}

function resolveColorVar(vars: Map<string, string>, name: string, depth = 0): string {
  if (depth > 5) throw new Error(`Cyclic token ref: ${name}`)
  const val = vars.get(name)
  if (!val) throw new Error(`Missing token: ${name}`)
  const varRef = /^var\((--color-[a-z0-9-]+)\)$/.exec(val)
  if (varRef) {
    return resolveColorVar(vars, varRef[1]!, depth + 1)
  }
  return val.toUpperCase()
}

describe('styles/tokens.css against DESIGN Appendix C', () => {
  const tokensCss = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8')
  const vars = parseColorVars(tokensCss)

  it('matches Appendix C hex values and resolves L2 semantic roles to L1 consistently', () => {
    expect(resolveColorVar(vars, '--color-action')).toBe('#46780D')
    expect(resolveColorVar(vars, '--color-primary-700')).toBe('#46780D')
    expect(resolveColorVar(vars, '--color-primary-500')).toBe('#76B617')
    expect(resolveColorVar(vars, '--color-neutral-900')).toBe('#1B1D21')
    expect(resolveColorVar(vars, '--color-line-input')).toBe('#8E929C')
    expect(resolveColorVar(vars, '--color-success-solid')).toBe('#1A7F46')
    expect(resolveColorVar(vars, '--color-warning-solid')).toBe('#9A5200')
    expect(resolveColorVar(vars, '--color-warning-ink')).toBe('#8A4A00')
    expect(resolveColorVar(vars, '--color-danger-solid')).toBe('#C0281C')
    expect(resolveColorVar(vars, '--color-info-solid')).toBe('#1F6FBA')
    expect(resolveColorVar(vars, '--color-violet-solid')).toBe('#6444B8')
    expect(resolveColorVar(vars, '--color-teal-solid')).toBe('#0F766E')
  })

  it('clears default color palette, excludes --color-tenant*, and omits dark theme (T-16)', () => {
    expect(tokensCss).toContain('--color-*: initial;')
    for (const key of vars.keys()) {
      expect(key.startsWith('--color-tenant')).toBe(false)
    }
    expect(tokensCss).not.toContain('[data-theme="dark"]')
    expect(tokensCss).not.toContain('prefers-color-scheme: dark')
  })
})
