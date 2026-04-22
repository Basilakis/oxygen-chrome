import type {
  Contact,
  Draft,
  DraftLine,
  Id,
  Product,
  Settings,
  VatCheckResult,
} from './types'

export type ScrapedInvoiceLine = {
  supplier_code?: string
  description: string
  unit_label?: string
  quantity: number
  unit_price: number
  line_net?: number
  vat_percent?: number
  line_total?: number
}

export type ScrapedInvoice = {
  supplier_vat: string
  document_type?: string
  series?: string
  number?: string
  date?: string
  mark?: string
  uid?: string
  lines: ScrapedInvoiceLine[]
  totals?: { net?: number; vat?: number; gross?: number }
}

export type CatalogSearchHit = {
  product: Product
  tier: 'exact' | 'fuzzy'
  score: number
  matched_field?: string
}

export type SearchResults = {
  query: string
  exact: CatalogSearchHit[]
  fuzzy: CatalogSearchHit[]
}

export type SyncStatus = {
  running: boolean
  last_bootstrap_at?: number
  last_incremental_at?: number
  counts: {
    products: number
    contacts: number
    taxes: number
    warehouses: number
    product_categories: number
    measurement_units: number
    payment_methods: number
    numbering_sequences: number
    logos: number
    business_areas: number
    variations: number
    drafts: number
  }
  last_error?: string
}

export type AuthStatus = {
  has_token: boolean
  mode: 'sandbox' | 'production'
  base_url: string
  last_connect_check?: { ok: boolean; at: number; message?: string }
}

export type Message =
  | { type: 'ping' }
  | { type: 'auth/get-status' }
  | { type: 'auth/set-token'; token: string }
  | { type: 'auth/clear-token' }
  | { type: 'auth/test-connection' }
  | { type: 'settings/get' }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'sync/bootstrap' }
  | { type: 'sync/incremental' }
  | { type: 'sync/status' }
  | { type: 'search/catalog'; query: string; limit?: number }
  | { type: 'catalog/get-product'; id: Id }
  | { type: 'lookups/get-taxes' }
  | { type: 'lookups/get-warehouses' }
  | { type: 'lookups/get-categories' }
  | { type: 'lookups/get-measurement-units' }
  | { type: 'lookups/get-payment-methods' }
  | { type: 'lookups/get-numbering-sequences' }
  | { type: 'lookups/get-logos' }
  | { type: 'lookups/get-business-areas' }
  | { type: 'lookups/get-variations' }
  | { type: 'contacts/find-by-vat'; vat: string }
  | { type: 'contacts/vat-check'; vat: string }
  | { type: 'contacts/create'; contact: Partial<Contact> }
  | { type: 'contacts/search'; query: string; limit?: number }
  | { type: 'contacts/get'; id: Id }
  | { type: 'flow1/resolve-supplier'; vat: string; autoCreate?: boolean }
  | {
      type: 'flow1/suggest-sku'
      description: string
      categoryName?: string
    }
  | { type: 'sku/preview'; categoryName?: string }
  | {
      type: 'flow1/create-products'
      supplier_id: Id
      products: Array<Partial<Product> & { name: string; code: string; sale_tax_id: Id; sale_net_amount: number }>
    }
  | { type: 'flow1/scrape-detected'; invoice: ScrapedInvoice }
  | { type: 'drafts/list' }
  | { type: 'drafts/get'; id: string }
  | { type: 'drafts/get-active' }
  | { type: 'drafts/create'; header?: Partial<Draft> }
  | { type: 'drafts/set-active'; id: string | null }
  | { type: 'drafts/update'; id: string; patch: Partial<Draft> }
  | { type: 'drafts/delete'; id: string }
  | {
      type: 'drafts/add-line'
      draft_id: string
      line: Partial<DraftLine> & { source: DraftLine['source'] }
    }
  | {
      type: 'drafts/update-line'
      draft_id: string
      line_id: string
      patch: Partial<DraftLine>
    }
  | { type: 'drafts/remove-line'; draft_id: string; line_id: string }
  | { type: 'drafts/match-line'; draft_id: string; line_id: string; product_id: Id }
  | { type: 'drafts/submit'; draft_id: string }
  | { type: 'drafts/convert-to-invoice'; draft_id: string }
  | { type: 'diagnostics/reset' }
  | { type: 'diagnostics/snapshot' }
  | {
      type: 'agent/ask'
      text: string
      attachments?: Array<{ fileName: string; mimeType: string; dataBase64: string }>
      history?: Array<{ role: 'user' | 'assistant'; content: unknown }>
    }
  | { type: 'agent/test-connection' }
  | { type: 'agent/sessions/list' }
  | { type: 'agent/sessions/get'; id: string }
  | { type: 'agent/sessions/save'; session: unknown }
  | { type: 'agent/sessions/delete'; id: string }
  | { type: 'agent/sessions/clear' }
  | { type: 'contextmenu/search-selection'; text: string }
  | { type: 'contextmenu/pin-selection'; text: string; url: string; title: string }
  | { type: 'picker/activate'; mode?: 'lookup-card' | 'return-to-popup' }
  | { type: 'picker/picked'; text: string }

export type DOMRectLike = { top: number; left: number; width: number; height: number }

export type ErrRes = { ok: false; error: string; detail?: unknown }
export type OkRes<T = undefined> = T extends undefined
  ? { ok: true }
  : { ok: true } & T

export type MessageResponse<T = unknown> =
  | (OkRes & T)
  | ErrRes
  | { ok: true; pong: number }
  | { ok: true; results: SearchResults }
  | { ok: true; status: SyncStatus }
  | { ok: true; auth: AuthStatus }
  | { ok: true; settings: Settings }
  | { ok: true; products: Product[] }
  | { ok: true; product: Product }
  | { ok: true; contacts: Contact[] }
  | { ok: true; contact: Contact }
  | { ok: true; vat: VatCheckResult }
  | { ok: true; sku: string }
  | { ok: true; drafts: Draft[] }
  | { ok: true; draft: Draft | null }
  | { ok: true; taxes: import('./types').Tax[] }
  | { ok: true; warehouses: import('./types').Warehouse[] }
  | { ok: true; categories: import('./types').ProductCategory[] }
  | { ok: true; measurement_units: import('./types').MeasurementUnit[] }
  | { ok: true; payment_methods: import('./types').PaymentMethod[] }
  | { ok: true; numbering_sequences: import('./types').NumberingSequence[] }
  | { ok: true; logos: import('./types').Logo[] }
  | { ok: true; business_areas: import('./types').BusinessArea[] }
  | { ok: true; variations: import('./types').Variation[] }

/**
 * Thrown by `sendMessage` when the extension has been reloaded but the caller
 * (typically a content script or overlay) is still running in its pre-reload
 * context. The fix is always: reload the page the script is running on.
 */
export class ExtensionReloadedError extends Error {
  constructor() {
    super(
      'Η επέκταση Oxygen Helper επαναφορτώθηκε. Ανανέωσε τη σελίδα (F5) για να συνεχίσει να λειτουργεί.',
    )
    this.name = 'ExtensionReloadedError'
  }
}

/**
 * Optional in-process dispatcher. When set (by the web shell at startup), all
 * sendMessage calls go here directly without a chrome.runtime round-trip.
 * Lets the same popup tab code work in both the extension and the web app.
 */
let localDispatcher: ((message: Message) => Promise<unknown>) | null = null

export function setLocalDispatcher(
  fn: ((message: Message) => Promise<unknown>) | null,
): void {
  localDispatcher = fn
}

export async function sendMessage<R = MessageResponse>(message: Message): Promise<R> {
  // Web shell mode: call the handler directly.
  if (localDispatcher) {
    return (await localDispatcher(message)) as R
  }

  // Extension mode: go through chrome.runtime.
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    throw new ExtensionReloadedError()
  }
  try {
    return (await chrome.runtime.sendMessage(message)) as R
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    if (
      msg.includes('Extension context invalidated') ||
      msg.includes('message port closed') ||
      msg.includes('Could not establish connection')
    ) {
      throw new ExtensionReloadedError()
    }
    throw err
  }
}
