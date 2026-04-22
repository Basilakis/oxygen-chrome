export const DB_NAME = 'oxygen_helper'
export const DB_VERSION = 2

export const STORES = {
  products: 'products',
  contacts: 'contacts',
  taxes: 'taxes',
  warehouses: 'warehouses',
  product_categories: 'product_categories',
  measurement_units: 'measurement_units',
  payment_methods: 'payment_methods',
  numbering_sequences: 'numbering_sequences',
  logos: 'logos',
  business_areas: 'business_areas',
  variations: 'variations',
  drafts: 'drafts',
  sync_meta: 'sync_meta',
} as const

export type StoreName = (typeof STORES)[keyof typeof STORES]

export const LOOKUP_STORES: StoreName[] = [
  STORES.taxes,
  STORES.warehouses,
  STORES.product_categories,
  STORES.measurement_units,
  STORES.payment_methods,
  STORES.numbering_sequences,
  STORES.logos,
  STORES.business_areas,
]

export const ALARM_INCREMENTAL_SYNC = 'oxygen-incremental-sync'

export const DEFAULT_VAT_RATE = 24

export const CTX_MENU_SEARCH = 'oxygen-ctx-search-selection'
export const CTX_MENU_PIN = 'oxygen-ctx-pin-selection'
export const CTX_MENU_PICK = 'oxygen-ctx-pick-product-from-page'

export const OXYGEN_HOST_MATCH = /(^|\.)oxygen\.gr$/i

export const MODAL_HEADING_GREEK = 'Προβολή Παραστατικού'
export const INJECT_BUTTON_LABEL = '➕ Δημιουργία νέων'

// Bump the version suffix whenever anything about the index layout or
// tokenization changes (fields, storeFields, processTerm, normalizeTerm).
// The old key becomes unreadable, so `ensureReady` falls back to a fresh
// rebuild from IDB — otherwise stale tokens keep leaking into searches.
export const SESSION_KEY_SEARCH_INDEX = 'search_index_serialized_v2'
export const STORAGE_KEY_SETTINGS = 'settings'
export const STORAGE_KEY_SYNC_STATE = 'sync_state'
export const STORAGE_KEY_AUTH_CHECK = 'auth_last_check'
