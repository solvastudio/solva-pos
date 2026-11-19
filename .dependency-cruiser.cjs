/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'pos-no-server',
      severity: 'error',
      from: { path: '^src/(pos|components|hooks|queries|routes/(?!api))' },
      to: { path: '^src/(server|modules/[^/]+/server)' },
    },
    {
      name: 'pos-entry-no-admin',
      severity: 'error',
      from: { path: '^src/pos' },
      to: { path: '^src/components/admin|^src/functions' },
    },
    {
      name: 'kernel-whitelist',
      severity: 'error',
      from: { path: '^src/lib/kernel', pathNot: '\\.test\\.ts$' },
      to: {
        dependencyTypes: ['npm'],
        pathNot: '^node_modules/(decimal\\.js|uuidv7)/',
      },
    },
    {
      name: 'lib-no-modules',
      severity: 'error',
      from: { path: '^src/lib/(kernel|sales-calc|contracts)' },
      to: { path: '^src/(modules|server|pos|components|routes)' },
    },
    {
      name: 'module-public-only',
      severity: 'error',
      from: { path: '^src/(functions|routes/api|server)' },
      to: { path: '^src/modules/[^/]+/(?!public\\.ts|shared\\.ts)' },
    },
    {
      name: 'module-cross-only-public',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/(?!$1/)[^/]+/(?!public\\.ts|shared\\.ts)' },
    },
    {
      name: 'module-direction',
      severity: 'error',
      from: { path: '^src/modules/identity/' },
      to: { path: '^src/modules/(catalog|inventory|shift|sales|fnb)/' },
    },
    {
      name: 'module-direction',
      severity: 'error',
      from: { path: '^src/modules/catalog/' },
      to: { path: '^src/modules/(inventory|shift|sales|fnb)/' },
    },
    {
      name: 'module-direction',
      severity: 'error',
      from: { path: '^src/modules/inventory/' },
      to: { path: '^src/modules/(shift|sales|fnb)/' },
    },
    {
      name: 'module-direction',
      severity: 'error',
      from: { path: '^src/modules/shift/' },
      to: { path: '^src/modules/(sales|fnb)/' },
    },
    {
      name: 'module-direction',
      severity: 'error',
      from: { path: '^src/modules/sales/' },
      to: { path: '^src/modules/fnb/' },
    },
    {
      name: 'sync-no-business',
      severity: 'error',
      from: { path: '^src/modules/sync' },
      to: { path: '^src/modules/(identity|catalog|sales|shift|inventory|fnb)' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'tests/arch/fixtures|routeTree\\.gen' },
  },
}
