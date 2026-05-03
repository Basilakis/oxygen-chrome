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
  | { type: 'sync/auto' }
  | { type: 'sync/status' }
  | { type: 'search/catalog'; query: string; limit?: number }
  | { type: 'search/catalog/local'; query: string; limit?: number }
  | { type: 'search/catalog/remote'; query: string; limit?: number }
  | { type: 'catalog/get-product'; id: Id }
  | { type: 'catalog/list-all' }
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
      /**
       * How many SKUs have already been "reserved" earlier in the current
       * batch. The generator adds this to its max+1 increment so sequential
       * calls during a multi-line AADE import each get a unique number.
       */
      offset?: number
    }
  | {
      /**
       * Look up a variation family for a product name. If a product matching
       * the name already exists in the catalog AND uses the `code.N` pattern
       * for its children, return the shared base (`code`) and the list of
       * existing suffixes so the caller can pick the next one.
       */
      type: 'flow1/find-variation-family'
      description: string
    }
  | { type: 'sku/preview'; categoryName?: string }
  | {
      type: 'flow1/create-products'
      supplier_id: Id
      products: Array<Partial<Product> & { name: string; code: string; sale_tax_id: Id; sale_net_amount: number }>
    }
  | {
      type: 'flow1/update-products'
      updates: Array<{
        product_id: Id
        add_to_warehouse_id?: Id
        add_quantity?: number
        new_purchase_net_amount?: number
        new_sale_net_amount?: number
      }>
    }
  | { type: 'flow1/scrape-detected'; invoice: ScrapedInvoice }
  | { type: 'products/bulk-deactivate'; ids: Id[] }
  | {
      /**
       * Look up the current Materials-Hub price-tracking state for a product.
       * If a local mapping exists we hit GET /prices/track/{id}. Otherwise,
       * if `search_query` is supplied, we consult the remote list endpoint
       * and try to recover an orphaned mapping by matching the query — this
       * heals the case where a previous session tracked the product under a
       * different local key (old code path, cleared storage, new device).
       */
      type: 'prices/status-for-product'
      product_key: string
      search_query?: string
    }
  | {
      /**
       * Registers a product with Materials Hub and returns the first set of
       * results in the same response. The mapping product_key → tracking_id
       * is persisted locally so subsequent `status-for-product` calls reuse
       * the same tracking row instead of re-registering.
       */
      type: 'prices/start-tracking'
      product_key: string
      search_query: string
      dimensions?: string
      country_code?: string
      refresh_interval_hours?: number
    }
  | {
      /** Force a fresh price refresh for the tracking row mapped to this product. */
      type: 'prices/refresh-for-product'
      product_key: string
    }
  | {
      /**
       * Stop tracking a product (DELETE /prices/track/{id}) and drop the
       * local mapping so the UI reverts to "not tracked" state.
       */
      type: 'prices/stop-for-product'
      product_key: string
    }
  | { type: 'prices/test-connection' }
  | {
      /**
       * Translate a short English UI string to Greek via the configured
       * Anthropic model. Cached per source-text in chrome.storage.local so
       * repeated views (same summary after a refresh) don't re-hit the API.
       * Safe no-op when no API key is configured — returns the input verbatim.
       */
      type: 'translate/to-greek'
      text: string
    }
  | { type: 'mentions/status-for-product'; product_key: string; subject_label?: string }
  | {
      type: 'mentions/start-tracking'
      product_key: string
      subject_label: string
      aliases?: string[]
      country_code?: string
    }
  | { type: 'mentions/refresh-for-product'; product_key: string; force?: boolean }
  | { type: 'mentions/stop-for-product'; product_key: string }
  | { type: 'mentions/feed-for-product'; product_key: string; limit?: number }
  | { type: 'mentions/summary-for-product'; product_key: string; days?: number }
  | { type: 'prices/exclusions/get'; product_key: string }
  | { type: 'prices/exclusions/add'; product_key: string; hostname: string }
  | { type: 'prices/exclusions/remove'; product_key: string; hostname: string }
  | { type: 'prices/exclusions/clear'; product_key: string }
  | {
      /**
       * v6: re-run Firecrawl-only verification on a tracked product. Either
       * targets specific rows by URL or the whole latest run. Much cheaper
       * than `prices/refresh-for-product` since it skips discovery.
       */
      type: 'prices/verify-for-product'
      product_key: string
      urls?: string[]
    }
  | {
      /** Full price history for a tracked product. Keyed by our local product_key. */
      type: 'prices/history-for-product'
      product_key: string
    }
  | { type: 'prices/list-tracked' }
  | { type: 'prices/refresh-by-id'; tracking_id: string }
  | { type: 'prices/stop-by-id'; tracking_id: string }
  | {
      type: 'prices/update-by-id'
      tracking_id: string
      patch: {
        refresh_interval_hours?: number
        country_code?: string
        verify_prices?: boolean
      }
    }
  | {
      /**
       * Fire a single no-tracking price lookup — used from the auto-badge
       * popover where the user just wants the current lowest market price
       * without committing to a tracking row.
       */
      type: 'prices/lookup-quick'
      search_query: string
      dimensions?: string
      country_code?: string
    }
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
