import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it, vi } from 'vitest'

// Each case spawns ESLint and/or dependency-cruiser; under the parallel unit run (100+ workers) the
// default and 15 s timeouts are not reliable, which made this file flaky.
vi.setConfig({ testTimeout: 60_000 })

const ROOT = resolve(import.meta.dirname, '../..')
const FIXTURES = resolve(import.meta.dirname, 'fixtures')
const ESLINT_CONFIG = resolve(ROOT, 'eslint.config.js')
const DEPCRUISE_CONFIG = resolve(ROOT, '.dependency-cruiser.cjs')
const DEPCRUISE_BIN = resolve(ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs')

async function lintFixture(name: string) {
  const cwd = resolve(FIXTURES, name)
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: ESLINT_CONFIG,
  })
  const results = await eslint.lintFiles(['src/**/*.ts'])
  return results.flatMap((r) => r.messages)
}

interface DepcruiseResult {
  summary: {
    violations: Array<{ rule: { name: string; severity: string }; from: string; to: string }>
  }
}

function depcruiseFixture(name: string): DepcruiseResult {
  const cwd = resolve(FIXTURES, name)
  try {
    const out = execFileSync(
      process.execPath,
      [DEPCRUISE_BIN, 'src', '--config', DEPCRUISE_CONFIG, '--output-type', 'json'],
      { cwd, encoding: 'utf8' },
    )
    return JSON.parse(out) as DepcruiseResult
  } catch (err) {
    const execErr = err as { stdout?: string }
    if (execErr.stdout) {
      return JSON.parse(execErr.stdout) as DepcruiseResult
    }
    throw err
  }
}

describe('architecture layering guardrails', () => {
  it('detects pos importing server via ESLint and dependency-cruiser', async () => {
    const messages = await lintFixture('pos-imports-server')
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true)

    const dc = depcruiseFixture('pos-imports-server')
    expect(dc.summary.violations.some((v) => v.rule.name === 'pos-no-server')).toBe(true)
  })

  it('detects kernel importing react via ESLint', async () => {
    const messages = await lintFixture('kernel-imports-react')
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true)
  })

  it('detects Date.now() in kernel via ESLint', async () => {
    const messages = await lintFixture('kernel-date-now')
    expect(messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true)
  })

  it('detects cross-module internal import via dependency-cruiser', () => {
    const dc = depcruiseFixture('cross-module-internal')
    expect(dc.summary.violations.some((v) => v.rule.name === 'module-cross-only-public')).toBe(true)
  })

  it('allows clean fixture with zero ESLint or dependency-cruiser violations', async () => {
    const messages = await lintFixture('clean')
    expect(messages).toHaveLength(0)

    const dc = depcruiseFixture('clean')
    expect(dc.summary.violations).toHaveLength(0)
  })
})
