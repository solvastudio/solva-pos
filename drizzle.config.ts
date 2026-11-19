import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/modules/*/server/schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_OWNER_URL ??
      'postgres://solva_owner:solva_owner_dev@localhost:5432/solva',
  },
  strict: true,
  verbose: true,
})
