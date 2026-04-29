import { sendMessage } from '@/shared/messages'

/**
 * Shared Price Monitoring renderer used by both shells (Chrome extension's
 * Κέρδος-tab section and the Vercel web app's search expansion). All
 * presentation logic lives here so the two surfaces stay in lockstep —
 * change a column once, both shells update.
 *
 * The module is shell-agnostic: it takes a mount element + a context object,
 * and dispatches all backend interactions via `sendMessage`. Both shells
 * have a sendMessage transport (chrome.runtime in the extension, an
 * in-process dispatcher in the web app) so the same calls work in both.
 *
 * Entry point: `renderPriceMonitoringInto(mount, ctx)`.
 */

export interface PriceMonitoringContext {
  productKey: string
  productName: string
  dimensions?: string
  /** Our purchase cost (net, EUR) — used for profit-margin columns. */
  purchaseNet?: number
  /** Our retail price (net, EUR) — used as a secondary comparison anchor. */
  saleNet?: number
  /**
   * Composite search query shipped to the Materials Hub API. Starts from
   * the product name; dimensions / category / SKU appended where useful.
   */
  searchQuery: string
}

interface HistorySample {
  t: number
  price: number
  currency: string
}

/* =================================================================
 * Public API
 * ================================================================= */

export async function renderPriceMonitoringInto(
  body: HTMLElement,
  ctx: PriceMonitoringContext,
): Promise<void> {
  renderMessage(body, 'Φόρτωση…')
  try {
    const res = (await sendMessage({
      type: 'prices/status-for-product',
      product_key: ctx.productKey,
      // Enables the background handler to recover an orphaned tracking row
      // from the remote list when the local mapping is missing.
      search_query: ctx.searchQuery,
    })) as
      | { ok: true; tracked: boolean; record?: unknown; recovered?: boolean }
      | { ok: false; error: string }
    if (!res.ok) {
      const err = (res as { error: string }).error
      if (/materials hub api key/i.test(err)) {
        renderNeedsKey(body)
        return
      }
      renderMessage(body, `Σφάλμα: ${err}`, true)
      return
    }
    if (res.tracked && res.record) {
      renderResults(body, ctx, res.record as never)
    } else {
      renderNotTracked(body, ctx)
    }
  } catch (err) {
    renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
  }
}

/* =================================================================
 * State renderers
 * ================================================================= */

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

function renderNotTracked(body: HTMLElement, ctx: PriceMonitoringContext): void {
  body.innerHTML = ''
  const info = document.createElement('div')
  info.textContent =
    'Αυτό το προϊόν δεν παρακολουθείται ακόμη. Ξεκινήστε την παρακολούθηση για να δείτε πραγματικές τιμές αγοράς από ανταγωνιστές.'
  info.style.marginBottom = '10px'
  body.appendChild(info)

  const btn = buildPmButton('Παρακολούθηση τιμών', 'primary')
  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Εκτέλεση…'
    try {
      const res = (await sendMessage({
        type: 'prices/start-tracking',
        product_key: ctx.productKey,
        search_query: ctx.searchQuery,
        dimensions: ctx.dimensions,
      })) as
        | { ok: true; tracked: true; record: unknown }
        | { ok: false; error: string }
      if (!res.ok) {
        const err = (res as { error: string }).error
        if (/materials hub api key/i.test(err)) {
          renderNeedsKey(body)
          return
        }
        renderMessage(body, `Σφάλμα: ${err}`, true)
        return
      }
      renderResults(body, ctx, res.record as never)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })
  body.appendChild(btn)
}

function renderResults(
  body: HTMLElement,
  ctx: PriceMonitoringContext,
  record: {
    tracking_id?: string
    results?: Array<Record<string, unknown>>
    summary?: string
    last_refreshed_at?: string
    total_results?: number
  },
  options: { showHidden?: boolean } = {},
): void {
  body.innerHTML = ''

  const headerRow = document.createElement('div')
  Object.assign(headerRow.style, {
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
  const lastRefreshed = record.last_refreshed_at
    ? new Date(record.last_refreshed_at).toLocaleString('el-GR')
    : '—'
  const count = record.results?.length ?? record.total_results ?? 0
  meta.innerHTML = `Τελευταία ενημέρωση: <strong>${lastRefreshed}</strong> · Αποτελέσματα: <strong>${count}</strong>`
  headerRow.appendChild(meta)

  const btns = document.createElement('div')
  btns.style.display = 'flex'
  btns.style.gap = '6px'
  const refreshBtn = buildPmButton('Ανανέωση', 'primary')
  // v6: re-verify rerun is much cheaper than full refresh — only re-runs
  // Firecrawl on the URLs we already have (~1 credit/URL vs ~10–30 for
  // /refresh's full discovery). Useful when one or more rows came back
  // verified=false because of a transient block/captcha.
  const verifyBtn = buildPmButton('Επαναξακρίβωση', 'default')
  verifyBtn.title =
    'Επαναξακρίβωση τιμών (Firecrawl-only, χωρίς νέα αναζήτηση — οικονομικότερο)'
  const stopBtn = buildPmButton('Διακοπή', 'danger')
  btns.appendChild(refreshBtn)
  btns.appendChild(verifyBtn)
  btns.appendChild(stopBtn)
  headerRow.appendChild(btns)
  body.appendChild(headerRow)

  const summary = typeof record.summary === 'string' && record.summary.trim().length > 0
    ? record.summary
    : undefined
  if (summary) {
    const s = document.createElement('div')
    s.textContent = summary
    Object.assign(s.style, {
      fontSize: '12.5px',
      color: '#374151',
      padding: '8px 10px',
      background: '#f5f6fa',
      borderRadius: '6px',
      marginBottom: '10px',
      lineHeight: '1.45',
    } as CSSStyleDeclaration)
    body.appendChild(s)
    void translateSummaryInto(summary, s)
  }

  const chartMount = document.createElement('div')
  body.appendChild(chartMount)
  void loadAndRenderPriceChart(chartMount, ctx)

  // Family rows (sibling SKUs) are kept by the API but excluded from
  // stats/charts/medians. Filter them out of the main pool here so they
  // render under the dedicated "Παρόμοια προϊόντα" section.
  const allRows = record.results ?? []
  const familyRowsAll = allRows.filter((r) => r.match_kind === 'family')
  const mainRowsAll = allRows.filter((r) => r.match_kind !== 'family')

  // Per-product retailer exclusions — rendered with a ✕ button on each row
  // and toggleable via "Εμφάνιση κρυμμένων" link. Stored in
  // chrome.storage.local under the product_key, so they persist per
  // product and across modal opens.
  const exclusionsMount = document.createElement('div')
  body.appendChild(exclusionsMount)
  void renderWithExclusions(
    exclusionsMount,
    ctx,
    mainRowsAll,
    familyRowsAll,
    options.showHidden === true,
    (showHidden) => renderResults(body, ctx, record, { showHidden }),
  )


  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true
    verifyBtn.textContent = 'Έλεγχος…'
    try {
      const res = (await sendMessage({
        type: 'prices/verify-for-product',
        product_key: ctx.productKey,
      })) as
        | { ok: true; tracked: true; record: unknown }
        | { ok: false; error: string }
      if (!res.ok) {
        renderMessage(body, `Σφάλμα επαναξακρίβωσης: ${(res as { error: string }).error}`, true)
        return
      }
      renderResults(body, ctx, res.record as never)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true
    refreshBtn.textContent = 'Ανανέωση…'
    try {
      const res = (await sendMessage({
        type: 'prices/refresh-for-product',
        product_key: ctx.productKey,
      })) as
        | { ok: true; tracked: true; record: unknown }
        | { ok: false; error: string }
      if (!res.ok) {
        renderMessage(body, `Σφάλμα ανανέωσης: ${(res as { error: string }).error}`, true)
        return
      }
      renderResults(body, ctx, res.record as never)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })

  stopBtn.addEventListener('click', async () => {
    if (!confirm('Διακοπή παρακολούθησης τιμών για αυτό το προϊόν;')) return
    stopBtn.disabled = true
    try {
      await sendMessage({ type: 'prices/stop-for-product', product_key: ctx.productKey })
      renderNotTracked(body, ctx)
    } catch (err) {
      renderMessage(body, `Σφάλμα: ${(err as Error)?.message ?? err}`, true)
    }
  })
}

/* =================================================================
 * Exclusions wrapper — fetches per-product hidden retailers, filters
 * the main / family pools accordingly, renders the full table set,
 * plus a "Εμφάνιση κρυμμένων" / "Απόκρυψη κρυμμένων" toggle and a
 * "Επαναφορά όλων" link when ≥1 retailer is hidden.
 * ================================================================= */

interface ExclusionsResponse {
  ok: true
  hostnames: string[]
}

async function renderWithExclusions(
  mount: HTMLElement,
  ctx: PriceMonitoringContext,
  mainRowsAll: Array<Record<string, unknown>>,
  familyRowsAll: Array<Record<string, unknown>>,
  showHidden: boolean,
  rerender: (showHidden: boolean) => void,
): Promise<void> {
  // Fetch the user's hidden-retailer list for this product. Failures are
  // non-fatal — we just render everything if the storage call errors out.
  let hidden: string[] = []
  try {
    const res = (await sendMessage({
      type: 'prices/exclusions/get',
      product_key: ctx.productKey,
    })) as ExclusionsResponse | { ok: false; error: string }
    if (res.ok) hidden = res.hostnames
  } catch {
    /* ignore */
  }

  const hiddenSet = new Set(hidden)
  const isHidden = (r: Record<string, unknown>): boolean => {
    const url = String(r.product_url ?? '')
    if (!url) return false
    let host = ''
    try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { /* */ }
    return host ? hiddenSet.has(host) : false
  }

  // When the user toggles "Εμφάνιση κρυμμένων" on, we still split visible
  // (= non-excluded) rows from the dedicated "Hidden" section below — that
  // way un-hiding from the bottom panel keeps obvious affordance, and the
  // top tables stay free of the rows the user already removed.
  const mainVisible = mainRowsAll.filter((r) => !isHidden(r))
  const familyVisible = familyRowsAll.filter((r) => !isHidden(r))

  const onHide = async (hostname: string) => {
    await sendMessage({
      type: 'prices/exclusions/add',
      product_key: ctx.productKey,
      hostname,
    })
    rerender(showHidden)
  }
  const onUnhide = async (hostname: string) => {
    await sendMessage({
      type: 'prices/exclusions/remove',
      product_key: ctx.productKey,
      hostname,
    })
    rerender(showHidden)
  }
  // Per-row verify is intentionally NOT a callback that triggers a full
  // re-render — that would be both wasteful and visually disruptive. The
  // row builder owns its own ↻ click handler (see buildResultsSection)
  // which spins the icon, calls the API, and surgically swaps just the
  // affected row's price cell. Nothing for renderWithExclusions to do.
  const onVerifyOne = undefined

  mount.innerHTML = ''

  // Toggle / clear-all bar — only when at least one retailer is hidden.
  if (hidden.length > 0) {
    const bar = document.createElement('div')
    Object.assign(bar.style, {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      fontSize: '11.5px',
      color: '#6b7280',
      margin: '4px 0 6px',
    } as CSSStyleDeclaration)
    const label = document.createElement('span')
    label.textContent = `${hidden.length} ${hidden.length === 1 ? 'εμπόρος κρυμμένος' : 'έμποροι κρυμμένοι'}`
    bar.appendChild(label)

    const toggle = document.createElement('a')
    toggle.href = 'javascript:void(0)'
    toggle.textContent = showHidden ? 'Απόκρυψη κρυμμένων' : 'Εμφάνιση κρυμμένων'
    toggle.style.color = '#2b87eb'
    toggle.style.textDecoration = 'none'
    toggle.addEventListener('click', (e) => {
      e.preventDefault()
      rerender(!showHidden)
    })
    bar.appendChild(toggle)

    const clearAll = document.createElement('a')
    clearAll.href = 'javascript:void(0)'
    clearAll.textContent = 'Επαναφορά όλων'
    clearAll.style.color = '#b91c1c'
    clearAll.style.textDecoration = 'none'
    clearAll.addEventListener('click', async (e) => {
      e.preventDefault()
      await sendMessage({ type: 'prices/exclusions/clear', product_key: ctx.productKey })
      rerender(false)
    })
    bar.appendChild(clearAll)

    mount.appendChild(bar)
  }

  if (mainVisible.length === 0 && familyVisible.length === 0) {
    const empty = document.createElement('div')
    empty.textContent = hidden.length
      ? 'Όλα τα αποτελέσματα είναι κρυμμένα. Πάτησε «Εμφάνιση κρυμμένων» για να επανέλθουν.'
      : 'Δεν βρέθηκαν αποτελέσματα ακόμη.'
    empty.style.color = '#6b7280'
    mount.appendChild(empty)
    return
  }

  const merchants = mainVisible.filter((r) => sourceCategory(r.source) === 'merchants')
  const skroutz = mainVisible.filter((r) => sourceCategory(r.source) === 'skroutz')
  const scraping = mainVisible.filter((r) => sourceCategory(r.source) === 'scraping')
  const unknown = mainVisible.filter((r) => sourceCategory(r.source) === 'other')

  const sectionOpts = { onHide, isHidden, hiddenSet, onVerifyOne }
  if (merchants.length) mount.appendChild(buildResultsSection('Merchants', merchants, ctx, sectionOpts))
  if (skroutz.length) mount.appendChild(buildResultsSection('Skroutz', skroutz, ctx, sectionOpts))
  if (scraping.length) mount.appendChild(buildResultsSection('Scraping', scraping, ctx, sectionOpts))
  if (unknown.length) mount.appendChild(buildResultsSection('Άλλα', unknown, ctx, sectionOpts))

  if (familyVisible.length) {
    const divider = document.createElement('div')
    divider.style.borderTop = '1px dashed #e4e7eb'
    divider.style.margin = '16px 0 4px'
    mount.appendChild(divider)
    const banner = document.createElement('div')
    banner.textContent =
      'Παρόμοια προϊόντα στη σειρά (διαφορετικό SKU — δεν συμμετέχουν σε στατιστικά/διάγραμμα)'
    Object.assign(banner.style, {
      fontSize: '12px',
      color: '#6b7280',
      margin: '4px 0 8px',
    } as CSSStyleDeclaration)
    mount.appendChild(banner)
    const familyCtx: PriceMonitoringContext = { ...ctx, purchaseNet: undefined }
    mount.appendChild(
      buildResultsSection('Similar in series', familyVisible, familyCtx, sectionOpts),
    )
  }

  // If showHidden is true, render an extra section with all the rows the
  // user previously hid — each row carries an "Επαναφορά" pill instead of
  // the ✕ so they can put it back individually.
  if (showHidden && hidden.length > 0) {
    const hiddenMain = mainRowsAll.filter((r) => isHidden(r))
    const hiddenFamily = familyRowsAll.filter((r) => isHidden(r))
    const allHidden = [...hiddenMain, ...hiddenFamily]
    if (allHidden.length) {
      const divider = document.createElement('div')
      divider.style.borderTop = '2px dotted #fdecc8'
      divider.style.margin = '20px 0 6px'
      mount.appendChild(divider)
      const banner = document.createElement('div')
      banner.textContent = `Κρυμμένοι έμποροι (${allHidden.length})`
      Object.assign(banner.style, {
        fontSize: '12px',
        fontWeight: '600',
        color: '#a15c00',
        margin: '4px 0 8px',
      } as CSSStyleDeclaration)
      mount.appendChild(banner)
      mount.appendChild(
        buildResultsSection('Hidden', allHidden, ctx, { onUnhide, isHidden, hiddenSet }),
      )
    }
  }
}

/* =================================================================
 * Results table
 * ================================================================= */

interface SectionHideOptions {
  /** Called when the user clicks ✕ on a visible row. */
  onHide?: (hostname: string) => void | Promise<void>
  /** Called when the user clicks ↺ on a row inside the "Hidden" section. */
  onUnhide?: (hostname: string) => void | Promise<void>
  /** Predicate so the row knows which control to show. */
  isHidden?: (r: Record<string, unknown>) => boolean
  /** Lookup set used by the row builder to render the unhide control. */
  hiddenSet?: Set<string>
  /** v6: re-verify a single row's URL via Firecrawl. Only shown on verified=false rows. */
  onVerifyOne?: (url: string) => void | Promise<void>
}

function buildResultsSection(
  title: string,
  rows: Array<Record<string, unknown>>,
  ctx: PriceMonitoringContext,
  hideOpts: SectionHideOptions = {},
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.marginBottom = '12px'

  const head = document.createElement('div')
  head.textContent = `${title} (${rows.length})`
  Object.assign(head.style, {
    fontSize: '12.5px',
    fontWeight: '600',
    color: '#374151',
    margin: '6px 0',
  } as CSSStyleDeclaration)
  wrap.appendChild(head)

  const scroll = document.createElement('div')
  scroll.style.maxHeight = '280px'
  scroll.style.overflow = 'auto'
  scroll.style.border = '1px solid #e4e7eb'
  scroll.style.borderRadius = '6px'

  const table = document.createElement('table')
  table.style.width = '100%'
  table.style.borderCollapse = 'collapse'
  table.style.fontSize = '12.5px'

  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  const showProfit = typeof ctx.purchaseNet === 'number' && ctx.purchaseNet > 0
  const headerDefs: Array<[string, 'left' | 'right' | 'center']> = showProfit
    ? [
        ['Retailer', 'left'],
        ['Τιμή', 'right'],
        ['Κέρδος vs κόστος', 'right'],
        ['Μονάδα', 'left'],
        ['Διαθεσ.', 'left'],
        ['', 'center'],
      ]
    : [
        ['Retailer', 'left'],
        ['Τιμή', 'right'],
        ['Μονάδα', 'left'],
        ['Διαθεσ.', 'left'],
        ['', 'center'],
      ]
  for (const [label, align] of headerDefs) {
    const th = document.createElement('th')
    th.textContent = label
    Object.assign(th.style, {
      position: 'sticky',
      top: '0',
      background: '#eef0f5',
      padding: '6px 8px',
      textAlign: align,
      fontWeight: '600',
      color: '#6b7280',
      borderBottom: '1px solid #e4e7eb',
      whiteSpace: 'nowrap',
    } as CSSStyleDeclaration)
    hr.appendChild(th)
  }
  thead.appendChild(hr)
  table.appendChild(thead)

  // Two-key sort: confidence tier first (exact rows on top, variants and
  // unverifiable rows pushed down), then price ascending within each tier.
  // Lets the user trust the first rows they see and treat the rest with
  // the warning the badges already imply.
  const tierRank = (kind: unknown): number => {
    switch (kind) {
      case 'exact': return 0
      case 'variant': return 1
      case 'unverifiable': return 2
      default: return 0  // missing/null defaults to "good" — pre-v4 rows
    }
  }
  const sorted = [...rows].sort((a, b) => {
    const ta = tierRank(a.match_kind)
    const tb = tierRank(b.match_kind)
    if (ta !== tb) return ta - tb
    const pa = Number(a.price) || Number.POSITIVE_INFINITY
    const pb = Number(b.price) || Number.POSITIVE_INFINITY
    return pa - pb
  })
  const firstCat = rows.length > 0 ? sourceCategory(rows[0]!.source) : 'other'
  const isDataForSeo = firstCat === 'merchants' || firstCat === 'skroutz'
  const tbody = document.createElement('tbody')
  let prevTier: number | null = null
  for (const r of sorted) {
    const curTier = tierRank(r.match_kind)
    // Insert a "Λιγότερο βέβαια" separator row at the boundary between
    // exact (or default-good) rows and the variant/unverifiable tier.
    if (prevTier !== null && prevTier < 1 && curTier >= 1) {
      const sepTr = document.createElement('tr')
      const sepTd = document.createElement('td')
      sepTd.colSpan = showProfit ? 6 : 5
      sepTd.textContent = 'Λιγότερο βέβαια αποτελέσματα'
      Object.assign(sepTd.style, {
        padding: '8px 10px 4px',
        fontSize: '11px',
        fontWeight: '600',
        color: '#a15c00',
        background: '#fef9ec',
        borderTop: '1px solid #f4d28a',
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
      } as CSSStyleDeclaration)
      sepTr.appendChild(sepTd)
      tbody.appendChild(sepTr)
    }
    prevTier = curTier
    const tr = document.createElement('tr')
    const retailer = String(r.retailer_name ?? '')
    const city = r.city ? ` · ${r.city}` : ''
    const fromAbroad = r.ships_from_abroad ? ' 🌐' : ''
    // Only extract row-level fields the row builder uses directly. Price /
    // strikethrough / verified-badge / anomaly are owned by
    // fillPriceCellContent which re-reads them from `r`.
    const price = Number(r.price)
    const currency = String(r.currency ?? 'EUR')
    const unit = translateUnit(String(r.price_unit ?? ''))
    const avail = translateAvailability(String(r.availability ?? ''))
    const url = String(r.product_url ?? '')
    const verified = r.verified === true
    const imageUrl = typeof r.image_url === 'string' ? r.image_url : ''
    const rating = Number(r.rating_value)
    const ratingVotes = Number(r.rating_votes)
    const matchKind = typeof r.match_kind === 'string' ? (r.match_kind as string) : ''
    const matchNote = typeof r.match_note === 'string' ? (r.match_note as string) : ''
    const productTitle = typeof r.product_title === 'string' ? (r.product_title as string) : ''

    const retailerCell = td('')
    retailerCell.style.verticalAlign = 'middle'
    const retailerInner = document.createElement('div')
    retailerInner.style.display = 'flex'
    retailerInner.style.gap = '8px'
    retailerInner.style.alignItems = 'center'

    const favHost = (() => {
      try { return url ? new URL(url).hostname : '' } catch { return '' }
    })()
    if (favHost) {
      const fav = document.createElement('img')
      fav.src = `https://www.google.com/s2/favicons?domain=${favHost}&sz=64`
      fav.alt = ''
      fav.loading = 'lazy'
      fav.referrerPolicy = 'no-referrer'
      Object.assign(fav.style, {
        width: '18px',
        height: '18px',
        flexShrink: '0',
        borderRadius: '3px',
      } as CSSStyleDeclaration)
      fav.addEventListener('error', () => fav.remove())
      retailerInner.appendChild(fav)
    }

    if (isDataForSeo && imageUrl) {
      const img = document.createElement('img')
      img.src = imageUrl
      img.alt = ''
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      Object.assign(img.style, {
        width: '28px',
        height: '28px',
        objectFit: 'contain',
        borderRadius: '4px',
        background: '#fff',
        border: '1px solid #e4e7eb',
        flexShrink: '0',
      } as CSSStyleDeclaration)
      img.addEventListener('error', () => img.remove())
      retailerInner.appendChild(img)
    }
    const textStack = document.createElement('div')
    textStack.style.display = 'flex'
    textStack.style.flexDirection = 'column'
    textStack.style.minWidth = '0'

    const nameLine = document.createElement('div')
    nameLine.style.whiteSpace = 'nowrap'
    nameLine.style.overflow = 'hidden'
    nameLine.style.textOverflow = 'ellipsis'
    const nameSpan = document.createElement('span')
    nameSpan.textContent = retailer + city + fromAbroad
    nameLine.appendChild(nameSpan)
    if (matchKind === 'variant' || matchKind === 'unverifiable') {
      const matchBadge = document.createElement('span')
      matchBadge.textContent = matchKind === 'variant' ? 'Variant' : 'Unverified'
      matchBadge.title =
        matchNote ||
        (matchKind === 'variant'
          ? 'Παραλλαγή: ίδιο μοντέλο, διαφορετικό χρώμα/μέγεθος/φινίρισμα'
          : 'Δεν κατέστη δυνατή η ταυτοποίηση του προϊόντος από τη σελίδα του εμπόρου')
      Object.assign(matchBadge.style, {
        display: 'inline-block',
        marginInlineStart: '6px',
        padding: '1px 6px',
        borderRadius: '10px',
        background: matchKind === 'variant' ? '#fdecc8' : '#eef0f5',
        color: matchKind === 'variant' ? '#a15c00' : '#6b7280',
        fontSize: '10px',
        fontWeight: '600',
        lineHeight: '14px',
        cursor: 'help',
      } as CSSStyleDeclaration)
      nameLine.appendChild(matchBadge)
    }
    textStack.appendChild(nameLine)

    if (productTitle && productTitle.toLowerCase() !== retailer.toLowerCase()) {
      const subtitle = document.createElement('div')
      subtitle.textContent = productTitle
      subtitle.title = productTitle
      Object.assign(subtitle.style, {
        fontSize: '11px',
        color: '#6b7280',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '320px',
      } as CSSStyleDeclaration)
      textStack.appendChild(subtitle)
    }

    if (isDataForSeo && Number.isFinite(rating) && rating > 0) {
      const rLine = document.createElement('div')
      rLine.style.fontSize = '11px'
      rLine.style.color = '#6b7280'
      rLine.textContent = Number.isFinite(ratingVotes) && ratingVotes > 0
        ? `★ ${rating.toFixed(1)} (${ratingVotes})`
        : `★ ${rating.toFixed(1)}`
      textStack.appendChild(rLine)
    }
    retailerInner.appendChild(textStack)
    retailerCell.appendChild(retailerInner)
    tr.appendChild(retailerCell)

    const priceCell = td('', { textAlign: 'right', fontVariantNumeric: 'tabular-nums' })
    priceCell.style.whiteSpace = 'nowrap'
    fillPriceCellContent(priceCell, r)
    tr.appendChild(priceCell)

    if (showProfit) {
      tr.appendChild(buildProfitCell(price, ctx.purchaseNet!, currency))
    }
    tr.appendChild(td(unit))
    tr.appendChild(td(avail))
    const linkCell = td('', { textAlign: 'center' })
    linkCell.style.whiteSpace = 'nowrap'
    if (url) {
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = '↗'
      a.style.textDecoration = 'none'
      a.style.color = '#2b87eb'
      a.title = 'Άνοιγμα σελίδας προϊόντος'
      a.style.marginInlineEnd = '6px'
      linkCell.appendChild(a)
    }
    // Per-row hide / unhide control. Hide ✕ on normal rows, ↺ on rows
    // shown via "Εμφάνιση κρυμμένων". Skipped entirely when no callback
    // was supplied (defensive — e.g. older render paths).
    const rowHost = (() => {
      try {
        return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : ''
      } catch { return '' }
    })()
    // v6: per-row re-verify on rows whose verified flag is false (transient
    // block / captcha / extraction failure). Calls Firecrawl on just this
    // URL (~1 credit). The icon spins while the API resolves, then we
    // refill ONLY this row's price cell from the response — no re-render
    // of the surrounding table. If the row comes back verified=true, the
    // ↻ button is removed automatically.
    if (url && !verified) {
      const verifyOneBtn = document.createElement('button')
      verifyOneBtn.type = 'button'
      verifyOneBtn.textContent = '↻'
      verifyOneBtn.title = 'Επαναξακρίβωση αυτής της τιμής (Firecrawl)'
      Object.assign(verifyOneBtn.style, {
        width: '20px',
        height: '20px',
        padding: '0',
        border: '1px solid transparent',
        borderRadius: '4px',
        background: 'transparent',
        color: '#1e73cc',
        cursor: 'pointer',
        fontSize: '13px',
        fontFamily: 'inherit',
        lineHeight: '18px',
        marginInlineEnd: '4px',
        display: 'inline-block',
      } as CSSStyleDeclaration)
      // No hover background on the ↻ — keep the icon flush with the row
      // so it feels like an inline glyph, not a chunky button.
      verifyOneBtn.addEventListener('click', async () => {
        if (verifyOneBtn.disabled) return
        verifyOneBtn.disabled = true
        verifyOneBtn.style.cursor = 'progress'
        // Continuous rotation via Web Animations API — no global CSS
        // injection needed, cancellable inline.
        const anim = verifyOneBtn.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
          { duration: 900, iterations: Infinity },
        )
        try {
          const res = (await sendMessage({
            type: 'prices/verify-for-product',
            product_key: ctx.productKey,
            urls: [url],
          })) as
            | { ok: true; tracked: true; record: { results?: Array<Record<string, unknown>> } }
            | { ok: false; error: string }
          if (!res.ok) {
            console.warn('[oxygen-helper] per-row verify failed:', res.error)
            // If the endpoint isn't available, hide the per-row ↻ for the
            // rest of the session — clicking it again would just 404
            // again. The bulk Επαναξακρίβωση button keeps the same caveat
            // and the user can fall back to Ανανέωση.
            if (/δεν είναι διαθέσιμη/i.test(res.error)) {
              verifyOneBtn.title = res.error
              verifyOneBtn.style.opacity = '0.4'
              verifyOneBtn.style.cursor = 'not-allowed'
              verifyOneBtn.disabled = true
              anim.cancel()
              return
            }
            verifyOneBtn.title = `Σφάλμα: ${res.error}`
            return
          }
          // Find the matching row in the response by URL and refresh the
          // price cell content. The match is exact-string — the API
          // returns the same product_url it received.
          const updated = (res.record.results ?? []).find(
            (row) => String(row.product_url ?? '') === url,
          )
          if (updated) {
            fillPriceCellContent(priceCell, updated)
            if (updated.verified === true) {
              // Row is now confirmed — drop the ↻ button entirely.
              verifyOneBtn.remove()
              return
            }
          }
        } catch (err) {
          console.warn('[oxygen-helper] per-row verify error:', err)
          verifyOneBtn.title = `Σφάλμα: ${(err as Error)?.message ?? err}`
        } finally {
          anim.cancel()
          verifyOneBtn.disabled = false
          verifyOneBtn.style.cursor = 'pointer'
        }
      })
      linkCell.appendChild(verifyOneBtn)
    }
    if (rowHost) {
      const isRowHidden = hideOpts.hiddenSet?.has(rowHost) === true
      if (!isRowHidden && hideOpts.onHide) {
        const hideBtn = document.createElement('button')
        hideBtn.type = 'button'
        hideBtn.textContent = '✕'
        hideBtn.title = `Απόκρυψη ${rowHost} από αυτό το προϊόν`
        Object.assign(hideBtn.style, {
          width: '20px',
          height: '20px',
          padding: '0',
          border: '1px solid transparent',
          borderRadius: '4px',
          background: 'transparent',
          color: '#9aa0a6',
          cursor: 'pointer',
          fontSize: '11px',
          fontFamily: 'inherit',
          lineHeight: '18px',
        } as CSSStyleDeclaration)
        hideBtn.addEventListener('mouseenter', () => {
          hideBtn.style.background = '#fde2e2'
          hideBtn.style.color = '#b91c1c'
          hideBtn.style.borderColor = '#fbcaca'
        })
        hideBtn.addEventListener('mouseleave', () => {
          hideBtn.style.background = 'transparent'
          hideBtn.style.color = '#9aa0a6'
          hideBtn.style.borderColor = 'transparent'
        })
        hideBtn.addEventListener('click', () => {
          void hideOpts.onHide!(rowHost)
        })
        linkCell.appendChild(hideBtn)
      } else if (isRowHidden && hideOpts.onUnhide) {
        const unhideBtn = document.createElement('button')
        unhideBtn.type = 'button'
        unhideBtn.textContent = '↺'
        unhideBtn.title = `Επαναφορά ${rowHost}`
        Object.assign(unhideBtn.style, {
          width: '20px',
          height: '20px',
          padding: '0',
          border: '1px solid transparent',
          borderRadius: '4px',
          background: 'transparent',
          color: '#0c7b00',
          cursor: 'pointer',
          fontSize: '12px',
          fontFamily: 'inherit',
          lineHeight: '18px',
        } as CSSStyleDeclaration)
        unhideBtn.addEventListener('click', () => {
          void hideOpts.onUnhide!(rowHost)
        })
        linkCell.appendChild(unhideBtn)
      }
    }
    tr.appendChild(linkCell)
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  scroll.appendChild(table)
  wrap.appendChild(scroll)
  return wrap
}

/**
 * Fill (or refill, after a per-row verify) a price cell from the row's
 * raw API record. Empties the cell first, so it's safe to call repeatedly
 * — the per-row ↻ button uses this to swap the content in place without
 * touching the rest of the table.
 */
function fillPriceCellContent(
  priceCell: HTMLTableCellElement,
  r: Record<string, unknown>,
): void {
  const price = Number(r.price)
  const originalPrice = Number(r.original_price)
  const hasOriginal =
    Number.isFinite(originalPrice) && originalPrice > 0 && originalPrice > price
  const currency = String(r.currency ?? 'EUR')
  const verified = r.verified === true
  const isAnomaly = r.is_anomaly === true
  const rollingMedian = Number(r.rolling_median_at_check)

  priceCell.innerHTML = ''
  if (!Number.isFinite(price)) {
    priceCell.textContent = '—'
    return
  }
  const priceWrap = document.createElement('span')
  priceWrap.style.display = 'inline-flex'
  priceWrap.style.alignItems = 'baseline'
  priceWrap.style.gap = '4px'
  priceWrap.style.justifyContent = 'flex-end'

  if (hasOriginal) {
    const oldPrice = document.createElement('span')
    oldPrice.textContent = formatMoneyWithSymbol(originalPrice, currency)
    oldPrice.style.textDecoration = 'line-through'
    oldPrice.style.color = '#9aa0a6'
    oldPrice.style.fontSize = '11px'
    oldPrice.title = 'Αρχική τιμή (πριν την έκπτωση)'
    priceWrap.appendChild(oldPrice)
  }
  const cur = document.createElement('strong')
  cur.textContent = formatMoneyWithSymbol(price, currency)
  cur.style.fontWeight = '600'
  priceWrap.appendChild(cur)
  const badge = document.createElement('span')
  badge.textContent = verified ? '✓' : '?'
  badge.title = verified ? 'Επαληθευμένη Τιμή' : 'Μη Επαληθευμένη Τιμή'
  Object.assign(badge.style, {
    display: 'inline-block',
    marginInlineStart: '2px',
    background: verified ? '#d6f0d9' : '#fdecc8',
    color: verified ? '#0c7b00' : '#a15c00',
    borderRadius: '999px',
    width: '14px',
    height: '14px',
    lineHeight: '14px',
    textAlign: 'center',
    fontSize: '10px',
    fontWeight: '700',
    cursor: 'help',
  } as CSSStyleDeclaration)
  priceWrap.appendChild(badge)

  if (isAnomaly) {
    const anomBadge = document.createElement('span')
    anomBadge.textContent = '⚠'
    const medianTip =
      Number.isFinite(rollingMedian) && rollingMedian > 0
        ? ` (διάμεσος 7 ημερών: ${formatMoneyWithSymbol(rollingMedian, currency)})`
        : ''
    anomBadge.title = `Ύποπτη τιμή — εκτός φυσιολογικού εύρους${medianTip}`
    Object.assign(anomBadge.style, {
      display: 'inline-block',
      marginInlineStart: '2px',
      background: '#fde2e2',
      color: '#b91c1c',
      borderRadius: '999px',
      width: '14px',
      height: '14px',
      lineHeight: '14px',
      textAlign: 'center',
      fontSize: '10px',
      fontWeight: '700',
      cursor: 'help',
    } as CSSStyleDeclaration)
    priceWrap.appendChild(anomBadge)
  }
  priceCell.appendChild(priceWrap)
}

function buildProfitCell(
  price: number,
  cost: number,
  currency: string,
): HTMLTableCellElement {
  if (!Number.isFinite(price) || price <= 0 || cost <= 0) {
    return td('—', { textAlign: 'right' })
  }
  const diff = price - cost
  const pct = (diff / cost) * 100
  const sign = diff > 0 ? '+' : ''
  const color = diff > 0 ? '#0c7b00' : diff < 0 ? '#b91c1c' : '#6b7280'
  const cell = td(
    `${sign}${formatMoneyWithSymbol(diff, currency)} (${sign}${pct.toFixed(1)}%)`,
    { textAlign: 'right', fontVariantNumeric: 'tabular-nums', color },
  )
  cell.title = `Τιμή ανταγωνιστή ${formatMoneyWithSymbol(price, currency)} − κόστος μας ${formatMoneyWithSymbol(cost, currency)}`
  return cell
}

/* =================================================================
 * Source bucketing + small helpers
 * ================================================================= */

function normalizeSource(v: unknown): string {
  return String(v ?? '').toLowerCase().trim()
}

function sourceCategory(v: unknown): 'merchants' | 'skroutz' | 'scraping' | 'other' {
  const s = normalizeSource(v)
  // Direct-merchant URLs: Google Shopping + Greek/EU marketplace fanout.
  // Idealo is opt-in per workspace (DACH/IT/UK/ES/FR).
  if (
    s === 'dataforseo' ||
    s === 'marketplace_bestprice' ||
    s === 'marketplace_shopflix' ||
    s === 'idealo'
  ) {
    return 'merchants'
  }
  if (s === 'marketplace_skroutz') return 'skroutz'
  if (s === 'perplexity') return 'scraping'
  return 'other'
}

function currencySymbol(code: string): string {
  switch (code.toUpperCase()) {
    case 'EUR': return '€'
    case 'USD': return '$'
    case 'GBP': return '£'
    case 'CHF': return 'Fr.'
    case 'JPY': return '¥'
    default: return code
  }
}

function formatMoneyWithSymbol(n: number, currency: string): string {
  return `${formatPriceNumber(n)} ${currencySymbol(currency)}`
}

function formatPriceNumber(n: number): string {
  return n.toFixed(2)
}

function td(text: string, style?: Partial<CSSStyleDeclaration>): HTMLTableCellElement {
  const c = document.createElement('td')
  c.textContent = text
  Object.assign(c.style, {
    padding: '6px 8px',
    borderBottom: '1px solid #edeff3',
  } as CSSStyleDeclaration)
  if (style) Object.assign(c.style, style)
  return c
}

function translateAvailability(v: string): string {
  switch (v) {
    case 'in_stock': return 'διαθέσιμο'
    case 'out_of_stock': return 'εξαντλ.'
    case 'limited': return 'περιορ.'
    case 'unknown': return '—'
    default: return v || '—'
  }
}

export function translateUnit(v: string): string {
  const key = v.trim().toLowerCase().replace(/[\s-]+/g, '_')
  switch (key) {
    case 'piece':
    case 'pieces':
    case 'item':
    case 'unit':
      return 'τεμ.'
    case 'm2':
    case 'sqm':
    case 'square_meter':
    case 'square_metre':
      return 'τ.μ.'
    case 'm':
    case 'meter':
    case 'metre':
    case 'linear_meter':
    case 'linear_metre':
    case 'lm':
      return 'τρ.μ.'
    case 'm3':
    case 'cubic_meter':
    case 'cubic_metre':
      return 'κ.μ.'
    case 'box':
    case 'boxes':
      return 'κιβ.'
    case 'pallet':
    case 'pallets':
      return 'παλ.'
    case 'pack':
    case 'package':
    case 'packs':
      return 'πακ.'
    case 'set':
    case 'sets':
      return 'σετ'
    case 'pair':
    case 'pairs':
      return 'ζεύγ.'
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      return 'κιλ.'
    case 'liter':
    case 'litre':
    case 'l':
      return 'λτ.'
    case 'roll':
    case 'rolls':
      return 'ρολ.'
    case 'bag':
    case 'bags':
      return 'σακ.'
    case '':
    case 'unknown':
      return '—'
    default:
      return v || '—'
  }
}

async function translateSummaryInto(src: string, mount: HTMLElement): Promise<void> {
  try {
    const res = (await sendMessage({ type: 'translate/to-greek', text: src })) as
      | { ok: true; text: string }
      | { ok: false; error: string }
    if (!res.ok) return
    if (!res.text || res.text === src) return
    if (mount.textContent === src) mount.textContent = res.text
  } catch {
    /* best-effort */
  }
}

function buildPmButton(
  label: string,
  variant: 'primary' | 'danger' | 'default' = 'default',
): HTMLButtonElement {
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

/* =================================================================
 * Price history chart
 * ================================================================= */

async function loadAndRenderPriceChart(
  mount: HTMLElement,
  ctx: PriceMonitoringContext,
): Promise<void> {
  mount.innerHTML = ''
  const placeholder = document.createElement('div')
  placeholder.textContent = 'Φόρτωση ιστορικού τιμής…'
  placeholder.style.color = '#6b7280'
  placeholder.style.fontSize = '12px'
  placeholder.style.padding = '6px 0 10px'
  mount.appendChild(placeholder)

  let raw: unknown
  try {
    const res = (await sendMessage({
      type: 'prices/history-for-product',
      product_key: ctx.productKey,
    })) as { ok: true; history: unknown } | { ok: false; error: string }
    if (!res.ok) {
      mount.innerHTML = ''
      return
    }
    raw = res.history
  } catch {
    mount.innerHTML = ''
    return
  }

  // Parse rows: { scraped_at, price, currency } per docs. Then collapse
  // multi-retailer snapshots within a 5-min window to one min-price point
  // so the chart line shows lowest-competitor-price-over-time, not stacks.
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { history?: unknown[] } | null)?.history)
      ? ((raw as { history: unknown[] }).history)
      : []
  const samples: HistorySample[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as { scraped_at?: string; price?: unknown; currency?: string }
    const t = Date.parse(String(r.scraped_at ?? ''))
    const price = typeof r.price === 'number' ? r.price : parseFloat(String(r.price ?? ''))
    if (!Number.isFinite(t) || !Number.isFinite(price) || price <= 0) continue
    samples.push({ t, price, currency: r.currency ?? 'EUR' })
  }
  const BUCKET_MS = 5 * 60 * 1000
  const buckets = new Map<number, HistorySample>()
  for (const s of samples) {
    const k = Math.round(s.t / BUCKET_MS) * BUCKET_MS
    const cur = buckets.get(k)
    if (!cur || s.price < cur.price) buckets.set(k, s)
  }
  const points = Array.from(buckets.values()).sort((a, b) => a.t - b.t)

  mount.innerHTML = ''
  if (points.length < 2) {
    const wrap = document.createElement('div')
    Object.assign(wrap.style, {
      background: '#fff',
      border: '1px dashed #e4e7eb',
      borderRadius: '10px',
      padding: '18px 16px',
      margin: '6px 0 14px',
    } as CSSStyleDeclaration)
    const title = document.createElement('div')
    title.textContent = 'Εξέλιξη τιμής'
    Object.assign(title.style, {
      fontSize: '14px',
      fontWeight: '700',
      color: '#1f2330',
      marginBottom: '6px',
    } as CSSStyleDeclaration)
    wrap.appendChild(title)
    const msg = document.createElement('div')
    msg.textContent = points.length === 0
      ? 'Δεν υπάρχει ιστορικό ακόμη.'
      : 'Μόνο 1 καταγραφή. Το διάγραμμα θα εμφανιστεί μετά την επόμενη ανανέωση.'
    msg.style.color = '#6b7280'
    msg.style.fontSize = '12.5px'
    wrap.appendChild(msg)
    mount.appendChild(wrap)
    return
  }
  renderPriceChart(mount, points)
}


function renderPriceChart(mount: HTMLElement, points: HistorySample[]): void {
  mount.innerHTML = ''
  const wrap = document.createElement('div')
  Object.assign(wrap.style, {
    background: '#fff',
    border: '1px solid #e4e7eb',
    borderRadius: '10px',
    padding: '14px 16px 10px',
    margin: '6px 0 14px',
  } as CSSStyleDeclaration)
  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  } as CSSStyleDeclaration)
  const title = document.createElement('div')
  title.textContent = 'Εξέλιξη τιμής'
  Object.assign(title.style, {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1f2330',
  } as CSSStyleDeclaration)
  header.appendChild(title)
  wrap.appendChild(header)

  const canvas = document.createElement('div')
  canvas.style.width = '100%'
  wrap.appendChild(canvas)

  const controls = document.createElement('div')
  Object.assign(controls.style, {
    display: 'flex',
    justifyContent: 'center',
    gap: '6px',
    marginTop: '8px',
  } as CSSStyleDeclaration)

  const ranges: Array<{ id: string; label: string; days: number | null }> = [
    { id: '1m', label: '1 Μήνας', days: 30 },
    { id: '3m', label: '3 Μήνες', days: 90 },
    { id: '6m', label: '6 Μήνες', days: 180 },
    { id: 'all', label: 'Όλα', days: null },
  ]
  let active = ranges[0]!.id
  const now = Date.now()
  for (const r of ranges) {
    const days = r.days
    const count = days === null ? points.length : points.filter((p) => p.t >= now - days * 86400000).length
    if (count >= 2) { active = r.id; break }
  }

  const rangeBtns: HTMLButtonElement[] = []
  for (const r of ranges) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = r.label
    b.dataset.range = r.id
    styleRangeButton(b, r.id === active)
    b.addEventListener('click', () => {
      active = r.id
      for (const rb of rangeBtns) styleRangeButton(rb, rb.dataset.range === active)
      drawChart(canvas, filterByRange(points, r.days))
    })
    controls.appendChild(b)
    rangeBtns.push(b)
  }
  wrap.appendChild(controls)
  mount.appendChild(wrap)

  const initial = ranges.find((r) => r.id === active)!
  drawChart(canvas, filterByRange(points, initial.days))
}

function styleRangeButton(btn: HTMLButtonElement, isActive: boolean): void {
  Object.assign(btn.style, {
    padding: '6px 14px',
    border: `1px solid ${isActive ? '#2b87eb' : '#e4e7eb'}`,
    borderRadius: '999px',
    background: isActive ? '#eaf3ff' : '#fff',
    color: isActive ? '#1e73cc' : '#6b7280',
    fontWeight: isActive ? '600' : '500',
    fontSize: '12.5px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as CSSStyleDeclaration)
}

function filterByRange(points: HistorySample[], days: number | null): HistorySample[] {
  if (days === null) return points
  const cutoff = Date.now() - days * 86400000
  const filtered = points.filter((p) => p.t >= cutoff)
  return filtered.length >= 2 ? filtered : points
}

function drawChart(mount: HTMLElement, points: HistorySample[]): void {
  mount.innerHTML = ''
  if (points.length < 2) {
    const empty = document.createElement('div')
    empty.textContent = 'Δεν υπάρχουν αρκετά δεδομένα για αυτό το διάστημα.'
    empty.style.color = '#6b7280'
    empty.style.fontSize = '12px'
    empty.style.padding = '40px 0'
    empty.style.textAlign = 'center'
    mount.appendChild(empty)
    return
  }

  const width = Math.max(320, mount.clientWidth || 620)
  const height = 240
  const padLeft = 48
  const padRight = 44
  const padTop = 16
  const padBottom = 28

  const prices = points.map((p) => p.price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const spread = Math.max(maxPrice - minPrice, 0.01)
  const yMin = Math.max(0, niceFloor(minPrice - spread * 0.15))
  const yMax = niceCeil(maxPrice + spread * 0.15)
  const yTicks = buildYTicks(yMin, yMax, 5)

  const tMin = points[0]!.t
  const tMax = points[points.length - 1]!.t
  const tSpan = Math.max(tMax - tMin, 1)

  const xFor = (t: number): number =>
    padLeft + ((t - tMin) / tSpan) * (width - padLeft - padRight)
  const yFor = (price: number): number =>
    padTop + ((yMax - price) / (yMax - yMin || 1)) * (height - padTop - padBottom)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', String(height))
  svg.style.display = 'block'

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  const gradId = `oxygen-price-grad-${Math.random().toString(36).slice(2, 8)}`
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient')
  grad.setAttribute('id', gradId)
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0')
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1')
  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop1.setAttribute('offset', '0%')
  stop1.setAttribute('stop-color', '#2b87eb')
  stop1.setAttribute('stop-opacity', '0.35')
  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop')
  stop2.setAttribute('offset', '100%')
  stop2.setAttribute('stop-color', '#2b87eb')
  stop2.setAttribute('stop-opacity', '0')
  grad.appendChild(stop1); grad.appendChild(stop2)
  defs.appendChild(grad)
  svg.appendChild(defs)

  for (const y of yTicks) {
    const gy = yFor(y)
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', String(padLeft))
    line.setAttribute('x2', String(width - padRight))
    line.setAttribute('y1', String(gy))
    line.setAttribute('y2', String(gy))
    line.setAttribute('stroke', '#eef0f5')
    line.setAttribute('stroke-width', '1')
    svg.appendChild(line)

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(padLeft - 8))
    label.setAttribute('y', String(gy + 4))
    label.setAttribute('text-anchor', 'end')
    label.setAttribute('font-size', '11')
    label.setAttribute('fill', '#9aa0a6')
    label.setAttribute('font-family', 'inherit')
    label.textContent = `${formatYTick(y)} €`
    svg.appendChild(label)
  }

  const xTickCount = Math.min(8, points.length)
  for (let i = 0; i < xTickCount; i += 1) {
    const frac = xTickCount === 1 ? 0 : i / (xTickCount - 1)
    const t = tMin + frac * tSpan
    const xl = xFor(t)
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(xl))
    label.setAttribute('y', String(height - 8))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('font-size', '11')
    label.setAttribute('fill', '#9aa0a6')
    label.setAttribute('font-family', 'inherit')
    label.textContent = formatXTick(t)
    svg.appendChild(label)
  }

  const baseline = height - padBottom
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.t).toFixed(1)} ${yFor(p.price).toFixed(1)}`)
    .join(' ')
  const areaPath = `${linePath} L${xFor(points[points.length - 1]!.t).toFixed(1)} ${baseline} L${xFor(points[0]!.t).toFixed(1)} ${baseline} Z`

  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  area.setAttribute('d', areaPath)
  area.setAttribute('fill', `url(#${gradId})`)
  area.setAttribute('stroke', 'none')
  svg.appendChild(area)

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line.setAttribute('d', linePath)
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke', '#2b87eb')
  line.setAttribute('stroke-width', '2')
  line.setAttribute('stroke-linejoin', 'round')
  line.setAttribute('stroke-linecap', 'round')
  svg.appendChild(line)

  const last = points[points.length - 1]!
  const lx = xFor(last.t)
  const ly = yFor(last.price)
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  dot.setAttribute('cx', String(lx))
  dot.setAttribute('cy', String(ly))
  dot.setAttribute('r', '5')
  dot.setAttribute('fill', '#fff')
  dot.setAttribute('stroke', '#2b87eb')
  dot.setAttribute('stroke-width', '2')
  svg.appendChild(dot)

  const priceLabel = `${last.price.toFixed(2)} ${currencySymbol(last.currency)}`
  const approxW = priceLabel.length * 7 + 14
  const pillX = lx + approxW + 6 > width - padRight ? lx - approxW - 6 : lx + 10
  const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  pill.setAttribute('x', String(pillX))
  pill.setAttribute('y', String(ly - 11))
  pill.setAttribute('width', String(approxW))
  pill.setAttribute('height', '22')
  pill.setAttribute('rx', '5')
  pill.setAttribute('fill', '#2b87eb')
  svg.appendChild(pill)

  const pillText = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  pillText.setAttribute('x', String(pillX + approxW / 2))
  pillText.setAttribute('y', String(ly + 4))
  pillText.setAttribute('text-anchor', 'middle')
  pillText.setAttribute('font-size', '12')
  pillText.setAttribute('font-weight', '600')
  pillText.setAttribute('fill', '#fff')
  pillText.setAttribute('font-family', 'inherit')
  pillText.textContent = priceLabel
  svg.appendChild(pillText)

  mount.appendChild(svg)
}

function niceFloor(v: number): number {
  if (v <= 0) return 0
  const step = niceStep(v)
  return Math.floor(v / step) * step
}
function niceCeil(v: number): number {
  const step = niceStep(v)
  return Math.ceil(v / step) * step
}
function niceStep(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  if (norm <= 1) return 1 * mag
  if (norm <= 2) return 2 * mag
  if (norm <= 5) return 5 * mag
  return 10 * mag
}
function buildYTicks(min: number, max: number, target: number): number[] {
  const step = niceStep((max - min) / target) || 1
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)))
    if (ticks.length > 20) break
  }
  return ticks
}
function formatYTick(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(v % 1 === 0 ? 0 : 2).replace(/\.00$/, '')
}
function formatXTick(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })
}

/* =================================================================
 * buildSearchQuery — exported so both shells construct queries
 * the same way (ProductName + dimensions + category + SKU).
 * ================================================================= */

export function buildPriceMonitoringSearchQuery(
  name: string,
  dimensions?: string,
  category?: string,
  sku?: string,
): string {
  const parts: string[] = [name]
  if (dimensions) {
    const needle = normalizeForMatch(dimensions)
    const hay = normalizeForMatch(name)
    if (needle && !hay.includes(needle)) parts.push(dimensions)
  }
  if (category) {
    const needle = normalizeForMatch(category)
    const hay = normalizeForMatch(parts.join(' '))
    if (needle && !hay.includes(needle)) parts.push(category)
  }
  if (sku) {
    const cleanSku = sku.trim()
    const hasLetter = /[A-Za-zΑ-Ωα-ω]/.test(cleanSku)
    const isUseful =
      cleanSku.length >= 4 || (cleanSku.length >= 2 && hasLetter)
    if (isUseful) {
      const needle = normalizeForMatch(cleanSku)
      const hay = normalizeForMatch(parts.join(' '))
      if (needle && !hay.includes(needle)) parts.push(cleanSku)
    }
  }
  return parts.join(' ').trim()
}

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[×χΧ]/g, 'x')
    .replace(/[\s,.-]+/g, '')
}
