/**
 * Back-office-only translation namespaces (`admin`, `platform`), kept in their own JSON files so
 * the bundler places them in a lazy chunk instead of the precached POS shell. Loaded through
 * `ensureAdminI18n` in `./index`.
 */
import adminEn from './locales/en.admin.json'
import adminId from './locales/id.admin.json'

export const adminResources = {
  'id-ID': adminId,
  'en-US': adminEn,
} as const
