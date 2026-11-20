import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/*/server/schema.ts',
    './src/modules/identity/server/auth-schema.ts',
    './src/modules/identity/server/device-schema.ts',
    './src/modules/identity/server/pin-schema.ts',
    './src/modules/identity/server/platform-auth-schema.ts',
  ],
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_OWNER_URL ??
      'postgres://solva_owner:solva_owner_dev@localhost:5432/solva',
  },
  strict: true,
  verbose: true,
})
