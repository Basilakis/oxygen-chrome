import { sendMessage } from '@/shared/messages'

/**
 * Shared Mention Monitoring renderer used by both shells (Chrome extension's
 * Περισσότερα tab section and the Vercel web app's per-hit panel). Same
 * pattern as price-monitoring's renderer — context-driven, dispatches via
 * sendMessage, no shell-specific assumptions.
 */

export interface MentionMonitoringContext {
  productKey: string
  productName: string
  /** Aliases to include alongside the product name (brand, supplier code, …). */
  aliases?: string[]
}

export async function renderMentionMonitoringInto(
  body: HTMLElement,
  ctx: MentionMonitoringContext,
): Promise<void> {
  renderMessage(body, 'Φόρτωση…')
  try {
    const res = (await sendMessage({
      type: 'mentions/status-for-product',
      product_key: ctx.productKey,
      subject_label: ctx.productName,
    })) as
      | { ok: true; tracked: boolean; record?: TrackedMentionShape }
      | { ok: false; error: string }
    if (!res.ok) {
      const err = (res as { error: string }).error
      if (/materials hub api key/i.test(err)) {
        renderNeedsKey(body)
        return
      }
      // 401/403 on this namespace usually means the `mention-monitoring`
      // module isn't enabled for the workspace (or the key was revoked).
      // Surface that as a workspace-config issue rather than a generic error.
      if (/\b40[13]\b/.test(err) || /unauthorized|forbidden/i.test(err)) {
        renderAuthError(body)
        return
      }
      renderMessage(body, `Σφάλμα: ${err}`, true)
      return
    }
    if (res.tracked && res.record) {
      renderTracked(body, ctx, res.record)
    } else {
      renderNotTracked(body, ctx)
    }
  } catch (err) {
    renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
  }
}

interface TrackedMentionShape {
  id?: string
  subject_label?: string
  current_mention_count_7d?: number
  current_mention_count_30d?: number
  current_sentiment_avg?: number | null
  current_top_outlets?: Array<{ domain: string; count: number }> | null
  last_refreshed_at?: string | null
  total_credits_used?: number
}

function renderMessage(body: HTMLElement, text: string, isError = false): void {
  body.innerHTML = ''
  const p = document.createElement('div')
  p.textContent = text
  p.style.color = isError ? '#b91c1c' : '#6b7280'
  p.style.padding = '8px 0'
  body.appendChild(p)
}

function renderNeedsKey(body: HTMLElement): void {
  body.innerHTML = ''
  const p = document.createElement('div')
  p.innerHTML =
    'Δεν έχει οριστεί Materials Hub API key. Προσθέστε το από τις <strong>Ρυθμίσεις → Βοηθός AI &amp; Price Monitoring</strong>.'
  p.style.color = '#6b7280'
  p.style.padding = '8px 0'
  body.appendChild(p)
}

function renderAuthError(body: HTMLElement): void {
  body.innerHTML = ''
  const p = document.createElement('div')
  p.innerHTML =
    'Το API key απορρίφθηκε από το Mention Monitoring (HTTP 401/403). ' +
    'Πιθανές αιτίες: το key έχει ανακληθεί, ή το <code>allowed_endpoints</code> ' +
    'restriction δεν περιλαμβάνει το <code>/api/v1/mentions/track/*</code>. ' +
    'Έλεγξε τις ρυθμίσεις του key στο Material KAI.'
  p.style.color = '#6b7280'
  p.style.padding = '8px 0'
  body.appendChild(p)
}

function renderNotTracked(body: HTMLElement, ctx: MentionMonitoringContext): void {
  body.innerHTML = ''
  const info = document.createElement('div')
  info.textContent =
    'Αυτό το προϊόν δεν παρακολουθείται για αναφορές. Ξεκινήστε για να εντοπίζετε αναφορές σε ειδήσεις, blogs, RSS και LLM απαντήσεις.'
  info.style.marginBottom = '10px'
  body.appendChild(info)
  const btn = buildButton('Παρακολούθηση αναφορών', 'primary')
  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Εκτέλεση…'
    try {
      const res = (await sendMessage({
        type: 'mentions/start-tracking',
        product_key: ctx.productKey,
        subject_label: ctx.productName,
        aliases: ctx.aliases,
      })) as
        | { ok: true; tracked: true; record: TrackedMentionShape }
        | { ok: false; error: string }
      if (!res.ok) {
        if (/materials hub api key/i.test(res.error)) {
          renderNeedsKey(body)
          return
        }
        if (/\b40[13]\b/.test(res.error) || /unauthorized|forbidden/i.test(res.error)) {
          renderAuthError(body)
          return
        }
        renderMessage(body, `Σφάλμα: ${res.error}`, true)
        return
      }
      renderTracked(body, ctx, res.record)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })
  body.appendChild(btn)
}

function renderTracked(
  body: HTMLElement,
  ctx: MentionMonitoringContext,
  record: TrackedMentionShape,
): void {
  body.innerHTML = ''

  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
    flexWrap: 'wrap',
  } as CSSStyleDeclaration)

  const meta = document.createElement('div')
  meta.style.fontSize = '12px'
  meta.style.color = '#6b7280'
  const last = record.last_refreshed_at
    ? new Date(record.last_refreshed_at).toLocaleString('el-GR')
    : '—'
  const sentiment =
    typeof record.current_sentiment_avg === 'number'
      ? formatSentiment(record.current_sentiment_avg)
      : '—'
  const c7 = record.current_mention_count_7d ?? 0
  const c30 = record.current_mention_count_30d ?? 0
  meta.innerHTML =
    `Τελευταία ενημέρωση: <strong>${last}</strong> · ` +
    `7 ημέρες: <strong>${c7}</strong> · 30 ημέρες: <strong>${c30}</strong> · ` +
    `Συναίσθημα: <strong>${sentiment}</strong>`
  header.appendChild(meta)

  const btns = document.createElement('div')
  btns.style.display = 'flex'
  btns.style.gap = '6px'
  const refreshBtn = buildButton('Ανανέωση', 'primary')
  const stopBtn = buildButton('Διακοπή', 'danger')
  btns.appendChild(refreshBtn)
  btns.appendChild(stopBtn)
  header.appendChild(btns)
  body.appendChild(header)

  // Top outlets pills
  if (record.current_top_outlets && record.current_top_outlets.length) {
    const outletsRow = document.createElement('div')
    outletsRow.style.display = 'flex'
    outletsRow.style.flexWrap = 'wrap'
    outletsRow.style.gap = '6px'
    outletsRow.style.marginBottom = '10px'
    for (const o of record.current_top_outlets.slice(0, 8)) {
      const pill = document.createElement('span')
      pill.textContent = `${o.domain} · ${o.count}`
      Object.assign(pill.style, {
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '999px',
        background: '#eef0f5',
        color: '#374151',
        whiteSpace: 'nowrap',
      } as CSSStyleDeclaration)
      outletsRow.appendChild(pill)
    }
    body.appendChild(outletsRow)
  }

  // Feed list (latest mentions). Async load since the status response
  // doesn't include the full row list.
  const feedMount = document.createElement('div')
  body.appendChild(feedMount)
  void loadFeed(feedMount, ctx)

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true
    refreshBtn.textContent = 'Ανανέωση…'
    try {
      const res = (await sendMessage({
        type: 'mentions/refresh-for-product',
        product_key: ctx.productKey,
      })) as
        | { ok: true; tracked: true; record: TrackedMentionShape }
        | { ok: false; error: string }
      if (!res.ok) {
        renderMessage(body, `Σφάλμα: ${res.error}`, true)
        return
      }
      renderTracked(body, ctx, res.record)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })

  stopBtn.addEventListener('click', async () => {
    if (!confirm('Διακοπή παρακολούθησης αναφορών για αυτό το προϊόν;')) return
    stopBtn.disabled = true
    try {
      await sendMessage({
        type: 'mentions/stop-for-product',
        product_key: ctx.productKey,
      })
      renderNotTracked(body, ctx)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })
}

interface MentionRowShape {
  url: string
  outlet_domain?: string | null
  outlet_name?: string | null
  outlet_type?: string | null
  title?: string | null
  excerpt?: string | null
  published_at?: string | null
  sentiment?: 'positive' | 'neutral' | 'negative' | null
  source?: string | null
  is_anomaly?: boolean
  match_note?: string | null
}

async function loadFeed(mount: HTMLElement, ctx: MentionMonitoringContext): Promise<void> {
  const placeholder = document.createElement('div')
  placeholder.textContent = 'Φόρτωση αναφορών…'
  placeholder.style.color = '#6b7280'
  placeholder.style.fontSize = '12px'
  placeholder.style.padding = '6px 0'
  mount.appendChild(placeholder)

  try {
    const res = (await sendMessage({
      type: 'mentions/feed-for-product',
      product_key: ctx.productKey,
      limit: 30,
    })) as { ok: true; feed: MentionRowShape[] } | { ok: false; error: string }
    mount.innerHTML = ''
    if (!res.ok) {
      mount.textContent = `Σφάλμα: ${res.error}`
      ;(mount.style as CSSStyleDeclaration).color = '#b91c1c'
      return
    }
    if (!res.feed.length) {
      mount.textContent = 'Δεν βρέθηκαν αναφορές ακόμη.'
      ;(mount.style as CSSStyleDeclaration).color = '#6b7280'
      return
    }
    mount.appendChild(buildFeedList(res.feed))
  } catch (err) {
    mount.innerHTML = ''
    mount.textContent = `Σφάλμα: ${(err as Error)?.message ?? err}`
    ;(mount.style as CSSStyleDeclaration).color = '#b91c1c'
  }
}

function buildFeedList(feed: MentionRowShape[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.maxHeight = '360px'
  wrap.style.overflow = 'auto'
  wrap.style.border = '1px solid #e4e7eb'
  wrap.style.borderRadius = '6px'

  for (const row of feed) {
    wrap.appendChild(buildFeedRow(row))
  }
  return wrap
}

function buildFeedRow(row: MentionRowShape): HTMLElement {
  const item = document.createElement('div')
  Object.assign(item.style, {
    padding: '10px 12px',
    borderBottom: '1px solid #edeff3',
    fontSize: '12.5px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  } as CSSStyleDeclaration)

  // Top line — outlet + sentiment + date
  const top = document.createElement('div')
  top.style.display = 'flex'
  top.style.gap = '6px'
  top.style.alignItems = 'center'
  top.style.color = '#6b7280'
  top.style.fontSize = '11px'

  const host = (() => {
    if (row.outlet_domain) return row.outlet_domain
    try { return new URL(row.url).hostname.replace(/^www\./, '') } catch { return '' }
  })()
  if (host) {
    const fav = document.createElement('img')
    fav.src = `https://www.google.com/s2/favicons?domain=${host}&sz=64`
    fav.alt = ''
    fav.loading = 'lazy'
    fav.referrerPolicy = 'no-referrer'
    Object.assign(fav.style, {
      width: '14px',
      height: '14px',
      borderRadius: '2px',
      flexShrink: '0',
    } as CSSStyleDeclaration)
    fav.addEventListener('error', () => fav.remove())
    top.appendChild(fav)
  }
  const outletText = document.createElement('span')
  outletText.textContent = row.outlet_name || host || '(unknown)'
  outletText.style.fontWeight = '600'
  outletText.style.color = '#374151'
  top.appendChild(outletText)

  if (row.outlet_type) {
    const t = document.createElement('span')
    t.textContent = `· ${translateOutletType(row.outlet_type)}`
    top.appendChild(t)
  }
  if (row.published_at) {
    const d = document.createElement('span')
    d.textContent = `· ${new Date(row.published_at).toLocaleDateString('el-GR')}`
    top.appendChild(d)
  }
  if (row.sentiment) {
    const s = buildSentimentPill(row.sentiment)
    s.style.marginInlineStart = 'auto'
    top.appendChild(s)
  }
  item.appendChild(top)

  // Title (linked)
  const title = document.createElement('a')
  title.href = row.url
  title.target = '_blank'
  title.rel = 'noopener noreferrer'
  title.textContent = row.title || row.url
  Object.assign(title.style, {
    color: '#1f2330',
    fontWeight: '500',
    textDecoration: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSStyleDeclaration)
  item.appendChild(title)

  // Excerpt
  if (row.excerpt) {
    const ex = document.createElement('div')
    ex.textContent = row.excerpt.slice(0, 240) + (row.excerpt.length > 240 ? '…' : '')
    ex.style.color = '#6b7280'
    ex.style.fontSize = '12px'
    ex.style.lineHeight = '1.4'
    item.appendChild(ex)
  }

  // Anomaly badge
  if (row.is_anomaly) {
    const a = document.createElement('span')
    a.textContent = '⚠ Ύποπτη αναφορά'
    a.title = row.match_note || 'Outlier vs trailing 7-day baseline'
    Object.assign(a.style, {
      fontSize: '10px',
      fontWeight: '700',
      color: '#b91c1c',
      background: '#fde2e2',
      padding: '1px 6px',
      borderRadius: '999px',
      alignSelf: 'flex-start',
      cursor: 'help',
    } as CSSStyleDeclaration)
    item.appendChild(a)
  }

  return item
}

function buildSentimentPill(s: 'positive' | 'neutral' | 'negative'): HTMLElement {
  const span = document.createElement('span')
  const map = {
    positive: { label: 'θετικό', bg: '#d6f0d9', fg: '#0c7b00' },
    negative: { label: 'αρνητικό', bg: '#fde2e2', fg: '#b91c1c' },
    neutral: { label: 'ουδέτερο', bg: '#eef0f5', fg: '#6b7280' },
  } as const
  const c = map[s]
  span.textContent = c.label
  Object.assign(span.style, {
    fontSize: '10px',
    fontWeight: '600',
    color: c.fg,
    background: c.bg,
    padding: '1px 8px',
    borderRadius: '999px',
  } as CSSStyleDeclaration)
  return span
}

function formatSentiment(v: number): string {
  if (v >= 0.2) return `θετικό (${v.toFixed(2)})`
  if (v <= -0.2) return `αρνητικό (${v.toFixed(2)})`
  return `ουδέτερο (${v.toFixed(2)})`
}

function translateOutletType(t: string): string {
  switch (t) {
    case 'news': return 'ειδήσεις'
    case 'blog': return 'blog'
    case 'youtube': return 'YouTube'
    case 'forum': return 'forum'
    case 'llm': return 'LLM'
    case 'rss': return 'RSS'
    case 'aggregator': return 'aggregator'
    default: return t
  }
}

function buildButton(label: string, variant: 'primary' | 'danger' | 'default' = 'default'): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  Object.assign(btn.style, {
    padding: '6px 12px',
    border: '1px solid #e4e7eb',
    borderRadius: '6px',
    background: variant === 'primary' ? '#2b87eb' : '#fff',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#e43f5a' : '#1f2330',
    borderColor: variant === 'primary' ? '#2b87eb' : '#e4e7eb',
    cursor: 'pointer',
    fontSize: '12.5px',
    fontFamily: 'inherit',
  } as CSSStyleDeclaration)
  return btn
}
