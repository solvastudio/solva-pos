import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const CLIENT_SERVER_PATTERNS = [
  {
    group: ['~/server', '~/server/**'],
    message: 'Client code must not import server code (ARCHITECTURE §8.4)',
  },
  {
    group: ['~/modules/*/server', '~/modules/*/server/**'],
    message: 'Client code must not import server code (ARCHITECTURE §8.4)',
  },
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message: 'Client code must not import server code (ARCHITECTURE §8.4)',
  },
  {
    group: ['pg', 'pg/*'],
    message: 'Client code must not import server code (ARCHITECTURE §8.4)',
  },
  {
    group: ['better-auth', 'better-auth/*'],
    message: 'Client code must not import server code (ARCHITECTURE §8.4)',
  },
  {
    group: ['pino', 'pino-roll'],
    message: 'Client code must not import server code (ARCHITECTURE §8.4)',
  },
  {
    group: ['rate-limiter-flexible', 'rate-limiter-flexible/*'],
    message: 'rate-limiter-flexible is only allowed in server code (ARCHITECTURE §6.9.4 / OQ-A26)',
  },
]

const PURE_FORBIDDEN_PATTERNS = [
  ...CLIENT_SERVER_PATTERNS,
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@tanstack/*'],
    message: 'Pure packages must not import React or TanStack (ARCHITECTURE §8.4)',
  },
  {
    group: ['node:*'],
    message: 'Pure packages must not import Node modules (ARCHITECTURE §8.4)',
  },
]

const DETERMINISM_SELECTORS = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Time/randomness must be injected (AP-06)',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Time/randomness must be injected (AP-06)',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Time/randomness must be injected (AP-06)',
  },
  {
    selector: "CallExpression[callee.property.name='randomUUID']",
    message: 'Time/randomness must be injected (AP-06)',
  },
]

const NO_ENUM_SELECTOR = {
  selector: 'TSEnumDeclaration',
  message: 'Enums are forbidden; use literal union types instead (CLAUDE.md)',
}

const ALLOWED_JSX_STRINGS = new Set(['·', '/', '-', '—', '…', '%', '(', ')'])
const solvaPlugin = {
  rules: {
    'jsx-no-literals': {
      meta: {
        type: 'problem',
        docs: { description: 'Disallow literal UI strings in JSX (FR-I18N-001)' },
        schema: [],
      },
      create(context) {
        function checkText(node, raw) {
          const trimmed = raw.trim()
          if (trimmed.length === 0 || ALLOWED_JSX_STRINGS.has(trimmed)) return
          context.report({
            node,
            message: 'Literal UI text is forbidden in JSX; use i18n key t(...)',
          })
        }
        return {
          JSXText(node) {
            checkText(node, node.value)
          },
          'JSXElement > JSXExpressionContainer > Literal, JSXFragment > JSXExpressionContainer > Literal'(
            node,
          ) {
            if (typeof node.value === 'string') {
              checkText(node, node.value)
            }
          },
        }
      },
    },
  },
}

export default defineConfig(
  globalIgnores([
    'dist/**',
    '.output/**',
    '.vinxi/**',
    '.tanstack/**',
    'src/routeTree.gen.ts',
    'node_modules/**',
    'tests/arch/fixtures/**',
    'tests/arch/fixtures-token/**',
    'tests/arch/fixtures-sql/**',
    'tests/arch/fixtures-routes/**',
    'playwright-report/**',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-restricted-syntax': ['error', NO_ENUM_SELECTOR],
    },
  },

  // 4. Server no-console
  {
    files: ['src/server/**', 'src/functions/**', 'src/modules/**/server/**', 'src/routes/api/**', 'src/routes/*/api/**', 'src/routes/*/admin/api/**'],
    rules: {
      'no-console': 'error',
    },
  },

  // 5. Client layering
  {
    files: ['src/pos/**', 'src/components/**', 'src/hooks/**', 'src/queries/**', 'src/routes/**', 'src/lib/**'],
    ignores: ['src/routes/api/**', 'src/routes/*/api/**', 'src/routes/*/admin/api/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: CLIENT_SERVER_PATTERNS }],
    },
  },

  // 6. hash-wasm only allowed in src/pos/session/** and src/modules/identity/**
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      'src/pos/session/**',
      'src/modules/identity/**',
      'src/pos/**',
      'src/components/**',
      'src/hooks/**',
      'src/queries/**',
      'src/routes/**',
      'src/lib/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['hash-wasm', 'hash-wasm/*'], message: 'hash-wasm is only allowed in pos/session and modules/identity' }],
        },
      ],
    },
  },

  // 7. Pure packages: kernel (decimal.js allowed)
  {
    files: ['src/lib/kernel/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...PURE_FORBIDDEN_PATTERNS,
            { group: ['hash-wasm', 'hash-wasm/*'], message: 'hash-wasm is only allowed in pos/session and modules/identity' },
          ],
        },
      ],
      'no-restricted-syntax': ['error', NO_ENUM_SELECTOR, ...DETERMINISM_SELECTORS],
    },
  },

  // 7b. Pure packages: contracts & domain (decimal.js forbidden)
  {
    files: ['src/lib/contracts/**', 'src/modules/*/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...PURE_FORBIDDEN_PATTERNS,
            { group: ['decimal.js', 'decimal.js/*'], message: 'decimal.js is only allowed in src/lib/kernel' },
            { group: ['hash-wasm', 'hash-wasm/*'], message: 'hash-wasm is only allowed in pos/session and modules/identity' },
          ],
        },
      ],
      'no-restricted-syntax': ['error', NO_ENUM_SELECTOR, ...DETERMINISM_SELECTORS],
    },
  },

  // 9. sales-calc: determinism + only ~/lib/kernel/* (and vitest/fast-check in tests)
  {
    files: ['src/lib/sales-calc/**'],
    ignores: ['src/lib/sales-calc/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!~/lib/kernel|\\.)',
              message: 'src/lib/sales-calc may only import ~/lib/kernel/*',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', NO_ENUM_SELECTOR, ...DETERMINISM_SELECTORS],
    },
  },
  {
    files: ['src/lib/sales-calc/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...PURE_FORBIDDEN_PATTERNS,
            { group: ['decimal.js', 'decimal.js/*'], message: 'decimal.js is only allowed in src/lib/kernel' },
          ],
        },
      ],
      'no-restricted-syntax': ['error', NO_ENUM_SELECTOR, ...DETERMINISM_SELECTORS],
    },
  },

  // 10. UI primitives free of domain
  {
    files: ['src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...CLIENT_SERVER_PATTERNS,
            { group: ['hash-wasm', 'hash-wasm/*'], message: 'hash-wasm is only allowed in pos/session and modules/identity' },
            {
              group: ['~/pos', '~/pos/**', '~/modules', '~/modules/**', '~/functions', '~/functions/**'],
              message: 'src/components/ui must stay domain-free',
            },
          ],
        },
      ],
    },
  },

  // Enforce hash-wasm ban in client folders outside pos/session
  {
    files: ['src/pos/**', 'src/components/**', 'src/hooks/**', 'src/queries/**', 'src/routes/**'],
    ignores: ['src/pos/session/**', 'src/routes/api/**', 'src/routes/*/api/**', 'src/routes/*/admin/api/**', 'src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...CLIENT_SERVER_PATTERNS,
            { group: ['hash-wasm', 'hash-wasm/*'], message: 'hash-wasm is only allowed in pos/session and modules/identity' },
          ],
        },
      ],
    },
  },

  // 11. i18n no literal UI strings in JSX components/routes
  {
    files: ['src/components/**/*.tsx', 'src/routes/**/*.tsx'],
    ignores: ['src/routes/api/**', '**/*.test.tsx'],
    plugins: {
      solva: solvaPlugin,
    },
    rules: {
      'solva/jsx-no-literals': 'error',
    },
  },
)
