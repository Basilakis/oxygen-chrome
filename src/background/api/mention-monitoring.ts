import { getSettings } from '@/background/storage/settings'

/**
 * Materials Hub Mention Monitoring API client. Mirrors the price-monitoring
 * client in shape, hits the public `/mentions` partner namespace.
 *
 * Auth: same `kai_*` integration key as price-monitoring. The legacy
 * `/mention-monitoring/*` namespace required a Supabase session JWT and
 * is documented as "for reference only" going forward.
 */

const BASE_URL = 'https://v1api.materialshub.gr/api/v1/mentions'

export interface MentionRow {
  id: string
  tracked_mention_id: string
  refresh_run_id: string
  url: string
  canonical_url: string | null
  outlet_domain: string | null
  outlet_name: string | null
  outlet_type:
    | 'news' | 'blog' | 'youtube' | 'forum' | 'llm' | 'rss' | 'aggregator' | 'other'
  title: string | null
  excerpt: string | null
  body_md: string | null
  language_code: string | null
  country_code: string | null
  author: string | null
  published_at: string | null
  discovered_at: string
  sentiment: 'positive' | 'neutral' | 'negative' | null
  sentiment_score: number | null
  relevance: 'exact' | 'tangential' | 'mismatch' | 'unverifiable' | null
  relevance_score: number | null
  match_note: string | null
  engagement: { upvotes?: number; comments?: number; views?: number } | null
  is_anomaly: boolean
  anomaly_reason: string | null
  manual_override: boolean
  source: 'dataforseo_news' | 'perplexity_sonar' | 'rss' | 'youtube'
  classifier_cached: boolean
}

export interface TrackedMention {
  id: string
  subject_type: 'product' | 'brand' | 'keyword'
  subject_label: string
  aliases: string[]
  sources_enabled: Record<string, boolean>
  language_codes: string[]
  country_codes: string[]
  refresh_interval_hours: number
  last_refreshed_at: string | null
  total_credits_used: number
  current_mention_count_7d: number
  current_mention_count_30d: number
  current_sentiment_avg: number | null
  current_share_of_voice: number | null
  current_top_outlets: Array<{ domain: string; count: number }> | null
  alert_on_spike: boolean
  alert_on_negative_sentiment: boolean
  alert_on_new_outlet: boolean
  alert_on_llm_visibility_change: boolean
  alert_channels: string[]
  is_active: boolean
}

export interface MentionTrackInput {
  subject_type: 'product' | 'brand' | 'keyword'
  subject_label: string
  brand_name?: string
  aliases?: string[]
  sources_enabled?: Record<string, boolean>
  language_codes?: string[]
  country_codes?: string[]
  refresh_interval_hours?: number
  alert_on_spike?: boolean
  alert_on_negative_sentiment?: boolean
  alert_on_new_outlet?: boolean
  alert_on_llm_visibility_change?: boolean
  alert_channels?: Array<'bell' | 'email' | 'webhook'>
  alert_webhook_url?: string
  run_first_refresh?: boolean
}

export interface RefreshOutcome {
  status: string
  credits_used: number
  hits_count: number
  refresh_run_id: string
  by_source: Record<string, number>
  errors: Record<string, unknown>
  results: MentionRow[]
  sentiment_avg: number | null
  top_outlets: Array<[string, number]>
}

export class MentionHubError extends Error {
  public status: number
  public body: unknown
  constructor(status: number, body: unknown) {
    let msg = `Mention Monitoring API error (${status})`
    if (body && typeof body === 'object') {
      const err = (body as { error?: { message?: string }; message?: string })
      if (err?.error?.message) msg = err.error.message
      else if (err?.message) msg = err.message
    }
    super(msg)
    this.name = 'MentionHubError'
    this.status = status
    this.body = body
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const settings = await getSettings()
  const key = settings.materials_hub_api_key
  if (!key) {
    throw new Error(
      'Δεν έχει οριστεί Materials Hub API key στις Ρυθμίσεις → Βοηθός AI & Price Monitoring.',
    )
  }
  const method = init.method ?? 'GET'
  const hasBody = init.body !== undefined && init.body !== null
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${key}`,
  }
  if (hasBody) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    })
  } catch (err) {
    throw new Error(
      `Αδυναμία σύνδεσης (${(err as Error)?.message ?? 'network error'}).`,
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
  throw new MentionHubError(res.status, parsed)
}

/* -------- Subject-scoped endpoints (we use these — they don't require
 *           binding to a Material KAI catalog product). -------- */

export function trackSubject(input: MentionTrackInput): Promise<TrackedMention> {
  return request<TrackedMention>('/track', { method: 'POST', body: input })
}

export function getSubject(id: string): Promise<TrackedMention> {
  return request<TrackedMention>(`/track/${encodeURIComponent(id)}`)
}

export function deleteSubject(id: string): Promise<unknown> {
  return request<unknown>(`/track/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function refreshSubject(id: string, force = false): Promise<RefreshOutcome> {
  return request<RefreshOutcome>(`/track/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
    body: { force },
  })
}

export function getSubjectFeed(id: string, limit = 100): Promise<MentionRow[]> {
  return request<MentionRow[]>(`/track/${encodeURIComponent(id)}/feed?limit=${limit}`)
}

export interface MentionSummary {
  total_count: number
  sentiment_breakdown: { positive: number; neutral: number; negative: number }
  top_outlets: Array<{ domain: string; count: number }>
  by_source?: Record<string, number>
  by_outlet_type?: Record<string, number>
}

export function getSubjectSummary(id: string, days = 30): Promise<MentionSummary> {
  return request<MentionSummary>(
    `/track/${encodeURIComponent(id)}/summary?days=${days}`,
  )
}
