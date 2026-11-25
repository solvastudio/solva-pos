import 'i18next'
import type idAdmin from './locales/id.admin.json'
import type id from './locales/id.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      // Core + back-office namespaces are merged at runtime (`ensureAdminI18n`); typed as one dictionary.
      translation: typeof id & typeof idAdmin
    }
  }
}
