import { getSettings } from '@/background/storage/settings'

/**
 * Thin client for the Materials Hub Price Monitoring API.
 * Auth is a single Bearer token stored per-user in Settings; requests go
 * directly from the service worker to the Materials Hub backend.
 */

const BASE_URL = 'https://v1api.materialshub.gr/api/v1'

export interface PriceResult {
  retailer_name: string
  product_url: string
  price: number
  currency: string
  price_unit?: string
  availability?: string
  city?: string | null
  ships_from_abroad?: boolean
  source?: string
  image_url?: string | null
  rating_value?: number | null
  rating_votes?: number | null
  last_verified?: string
  // ---- v3 (2026-04-25) additive fields ----
  /** true when Firecrawl actually re-read the retailer page and confirmed the price. */
  verified?: boolean
  /** Retailer's original "was" price when a promo is showing (strikethrough in the UI). */
  original_price?: number | null
  /** Diagnostic text — e.g. "verify: was perplexity=€X, actual on page=€Y". Render as tooltip. */
  notes?: string | null
  // ---- v4 (2026-04-25 evening) additive fields ----
  /**
   * Product-identity match quality. `exact` = scraped page matches the
   * requested product. `variant` = same model, different finish/color/size
   * (still useful, but excluded from price stats). `unverifiable` = couldn't
   * tell from the page. Null on rows created before v4. Server-side already
   * drops `mismatch` / `family` (wrong product) so we never see those.
   */
  /**
   * v6 (2026-04-27): `family` is now kept and returned (was previously
   * dropped server-side). Render under a "Similar in series" heading,
   * never feed into charts/medians/alerts.
   */
  match_kind?: 'exact' | 'variant' | 'unverifiable' | 'family' | null
  /** Classifier confidence for `match_kind`, 0–100. */
  match_score?: number | null
  /** Human-readable facet diff for non-exact matches (e.g. color differs). */
  match_note?: string | null
  /**
   * Exact product name from the retailer's page (Shopping-feed title or
   * Firecrawl extraction). Useful as a subtitle when one retailer surfaces
   * multiple rows for different SKU variants.
   */
  product_title?: string | null
  // ---- v5 (2026-04-26) additive fields ----
  /**
   * Outlier flag from the 7-day rolling-median sanity band. True when the
   * scraped price is ≥3× or ≤0.33× the rolling median; treat as suspect
   * (still rendered so the user can spot it; excluded from medians upstream).
   */
  is_anomaly?: boolean | null
  /** The rolling median at the moment the price was checked — for tooltips. */
  rolling_median_at_check?: number | null
}

export interface TrackingRecord {
  tracking_id: string
  search_query?: string
  dimensions?: string
  country_code?: string
  refresh_interval_hours?: number
  results?: PriceResult[]
  summary?: string
  last_refreshed_at?: string
  credits_used?: number
  latency_ms?: number
  total_results?: number
  /** v3: whether Firecrawl verification is enabled on this tracked query. */
  verify_prices?: boolean
}

export interface TrackInput {
  search_query: string
  dimensions?: string
  country_code?: string
  refresh_interval_hours?: number
  /**
   * v3: opt out of Firecrawl verification to get the v2-era snippet-only
   * pricing (~3× cheaper, ~30s faster). Default on the server is `true`.
   */
  verify_prices?: boolean
  // ---- v5 (2026-04-26) opt-in price-alert fields ----
  /** "bell" (free, in-app), "email" (1 credit/send), "webhook" (free, per-query). */
  alert_channels?: Array<'bell' | 'email' | 'webhook'>
  alert_on_price_drop?: boolean
  alert_on_new_retailer?: boolean
  alert_on_promo?: boolean
  /** Required when `alert_channels` includes "webhook". */
  alert_webhook_url?: string
}

export class MaterialsHubError extends Error {
  public status: number
  public body: unknown
  constructor(status: number, body: unknown) {
    let msg = `Materials Hub API error (${status})`
    if (body && typeof body === 'object') {
      const err = (body as { error?: { message?: string }; message?: string }).error
      const topMsg = (body as { message?: string }).message
      if (err && typeof err.message === 'string' && err.message) msg = err.message
      else if (typeof topMsg === 'string' && topMsg) msg = topMsg
    }
    super(msg)
    this.name = 'MaterialsHubError'
    this.status = status
    this.body = body
  }
}

async function bearerToken(): Promise<string> {
  const settings = await getSettings()
  const key = settings.materials_hub_api_key
  if (!key) {
    throw new Error(
      'Δεν έχει οριστεί Materials Hub API key στις Ρυθμίσεις → Βοηθός AI & Price Monitoring.',
    )
  }
  return key
}

export async function defaultCountryCode(): Promise<string> {
  const settings = await getSettings()
  return (settings.materials_hub_country_code ?? 'GR').toUpperCase()
}

/**
 * v3 verification toggle resolved from settings. Undefined (= server default
 * `true`) when the user hasn't explicitly opted out; explicit `false` when
 * they enabled "fast check" mode for heavy refresh paths.
 */
export async function defaultVerifyPrices(): Promise<boolean | undefined> {
  const settings = await getSettings()
  const v = settings.materials_hub_verify_prices
  if (v === false) return false
  // Leave undefined when true/unset so we don't spam the parameter when the
  // server default already does the right thing.
  return undefined
}

/**
 * v5 alert defaults resolved from settings. Returns only the fields that
 * are actually opted-in so we don't blast the API with explicit `false`
 * values on every track call. Webhook URL is only included when the
 * webhook channel is enabled.
 */
export async function defaultAlertConfig(): Promise<Partial<TrackInput>> {
  const settings = await getSettings()
  const channels: Array<'bell' | 'email' | 'webhook'> = []
  if (settings.materials_hub_alert_bell) channels.push('bell')
  if (settings.materials_hub_alert_email) channels.push('email')
  if (settings.materials_hub_alert_webhook && settings.materials_hub_alert_webhook_url) {
    channels.push('webhook')
  }
  const out: Partial<TrackInput> = {}
  if (channels.length) out.alert_channels = channels
  if (settings.materials_hub_alert_on_price_drop) out.alert_on_price_drop = true
  if (settings.materials_hub_alert_on_new_retailer) out.alert_on_new_retailer = true
  if (settings.materials_hub_alert_on_promo) out.alert_on_promo = true
  if (channels.includes('webhook') && settings.materials_hub_alert_webhook_url) {
    out.alert_webhook_url = settings.materials_hub_alert_webhook_url
  }
  return out
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`
  const method = init.method ?? 'GET'
  const hasBody = init.body !== undefined && init.body !== null
  const key = await bearerToken()
  // Only send `content-type: application/json` when there's actually a JSON
  // body. Adding it to GET requests marks the request as "non-simple" for
  // CORS, which forces a preflight OPTIONS round-trip that some servers
  // reject — then the fetch fails as a vague "Failed to fetch" with no
  // useful status code.
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${key}`,
  }
  if (hasBody) headers['content-type'] = 'application/json'

  console.debug('[oxygen-helper:materials-hub] request', { method, url, hasBody })
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    })
  } catch (err) {
    // `fetch()` throws TypeError for network-level failures (DNS, TLS,
    // CORS-preflight rejection, offline). Log the full error before we
    // re-throw so the SW console shows the root cause — the options-page
    // status line only gets the short message.
    console.error('[oxygen-helper:materials-hub] fetch failed', {
      url,
      method,
      error: err,
      message: (err as Error)?.message,
    })
    throw new Error(
      `Αδυναμία σύνδεσης με το Materials Hub (${(err as Error)?.message ?? 'network error'}). ` +
        'Δες το service worker console για λεπτομέρειες.',
    )
  }
  const raw = await res.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = raw
  }
  if (res.status >= 200 && res.status < 300) return parsed as T
  console.warn('[oxygen-helper:materials-hub] non-2xx response', {
    url,
    method,
    status: res.status,
    body: parsed,
  })
  throw new MaterialsHubError(res.status, parsed)
}

export function track(input: TrackInput): Promise<TrackingRecord> {
  return request<TrackingRecord>('/prices/track', { method: 'POST', body: input })
}

/**
 * One-shot lookup — same payload as /track but no persistence. Used by the
 * auto-badge popover's "Fetch lowest price" action where the user just
 * wants a quick competitive comparison without burning a tracking slot.
 */
export function lookup(input: TrackInput): Promise<TrackingRecord> {
  return request<TrackingRecord>('/prices/lookup', { method: 'POST', body: input })
}

export function getTracking(id: string): Promise<TrackingRecord> {
  return request<TrackingRecord>(`/prices/track/${encodeURIComponent(id)}`)
}

export function refreshTracking(id: string): Promise<TrackingRecord> {
  return request<TrackingRecord>(`/prices/track/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
  })
}

export interface TrackingUpdate {
  refresh_interval_hours?: number
  country_code?: string
  preferred_retailers?: string[]
  /** v3: flip Firecrawl verification on/off for an existing tracked row. */
  verify_prices?: boolean
}

export function updateTracking(id: string, patch: TrackingUpdate): Promise<TrackingRecord> {
  return request<TrackingRecord>(`/prices/track/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: patch,
  })
}

export interface HistoryPoint {
  /** ISO timestamp (any of several fields the API might use — normalized in the UI). */
  captured_at?: string
  refreshed_at?: string
  recorded_at?: string
  timestamp?: string
  created_at?: string
  /** Aggregates the backend might send back alongside per-row history. */
  price?: number
  lowest_price?: number
  min_price?: number
  median_price?: number
  average_price?: number
  currency?: string
  retailer_name?: string
}

export interface HistoryResponse {
  history?: HistoryPoint[]
  items?: HistoryPoint[]
  points?: HistoryPoint[]
  currency?: string
}

export function getHistory(id: string): Promise<HistoryResponse | HistoryPoint[]> {
  return request<HistoryResponse | HistoryPoint[]>(
    `/prices/track/${encodeURIComponent(id)}/history`,
  )
}

export function stopTracking(id: string): Promise<unknown> {
  return request(`/prices/track/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * List every tracked product registered under the current API key. Used by
 * the status handler to auto-recover when the local product_key → tracking_id
 * map is missing (old key format, cleared storage, new device, etc.).
 */
export function listTracked(): Promise<unknown> {
  return request<unknown>('/prices/track')
}

/* ---- v6 (2026-04-28) — server-side per-tracking exclusions ----- */

export interface ExclusionPayload {
  url?: string
  domain?: string
  reason?: string
}

export function excludeRetailer(
  trackingId: string,
  payload: ExclusionPayload,
): Promise<unknown> {
  return request<unknown>(
    `/prices/track/${encodeURIComponent(trackingId)}/exclude`,
    { method: 'POST', body: payload },
  )
}

export function includeRetailer(
  trackingId: string,
  payload: ExclusionPayload,
): Promise<unknown> {
  return request<unknown>(
    `/prices/track/${encodeURIComponent(trackingId)}/include`,
    { method: 'POST', body: payload },
  )
}

export interface ExclusionRecord {
  url?: string
  domain?: string
  reason?: string
  excluded_at?: string
}

export function getExclusions(trackingId: string): Promise<unknown> {
  return request<unknown>(`/prices/track/${encodeURIComponent(trackingId)}/exclusions`)
}

/**
 * v6 (2026-04-28) — re-verify prices on existing rows without doing full
 * discovery. Cheap (~1 Firecrawl credit per URL) compared to /refresh
 * (~10–30 credits). Pass `{ urls: [...] }` to retry specific rows whose
 * `verified: false` was due to a transient block/captcha; pass `{}` to
 * re-verify the whole latest run.
 */
export function verifyTracking(
  trackingId: string,
  payload: { urls?: string[] } = {},
): Promise<unknown> {
  return request<unknown>(
    `/prices/track/${encodeURIComponent(trackingId)}/verify`,
    { method: 'POST', body: payload },
  )
}

/**
 * Cheap key-validation call — GET /prices/track is a DB read with no
 * Perplexity/DataForSEO credits charged, so it's safe to use as a "test
 * key" handshake. A 200 means the Bearer token is valid and routed to a
 * real workspace; 401 means the key is bad or revoked.
 */
export async function testConnection(): Promise<{ ok: true; message: string }> {
  const res = await request<unknown>('/prices/track')
  const count =
    Array.isArray(res) ? res.length
      : res && typeof res === 'object' && Array.isArray((res as { items?: unknown[] }).items)
        ? (res as { items: unknown[] }).items.length
        : undefined
  return {
    ok: true,
    message:
      count === undefined
        ? 'Το κλειδί λειτουργεί.'
        : `Το κλειδί λειτουργεί (παρακολουθούνται ${count} προϊόντα).`,
  }
}
