import { sendMessage } from '@/shared/messages'
import type { CatalogSearchHit, SearchResults } from '@/shared/messages'
import { formatMoney, parseAreaFromName, productStock } from '@/shared/util'
import type { Product } from '@/shared/types'
import { mountShadowHost, unmountHost, injectStyles, h } from './shared'
import type { DetectedProduct } from '../product-detector'
import * as LookupCard from './lookup-card'

const HOST_ID = 'oxygen-helper-auto-badge'

const CSS = `
:host, * { box-sizing: border-box; }
:host {
  --brand-deep: #1d2358;
  --primary: #2b87eb;
  --success: #2eae5a;
  --warning: #f59f00;
  --danger: #e43f5a;
  --bg-card: #ffffff;
  --border: #e4e7eb;
  --text: #1f2330;
  --text-muted: #6b7280;
  --text-subtle: #9aa0a6;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Greek", sans-serif;
}

.badge {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(20, 22, 30, 0.18), 0 2px 6px rgba(20, 22, 30, 0.08);
  font: 12px/1.4 var(--font);
  color: var(--text);
  cursor: pointer;
  pointer-events: auto;
  max-width: 360px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  animation: slide-in 0.25s ease-out;
}

.badge:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 40px rgba(20, 22, 30, 0.22), 0 2px 8px rgba(20, 22, 30, 0.1);
}

@keyframes slide-in {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.logo {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  flex-shrink: 0;
  background: linear-gradient(135deg, #7c3dff, #3f8cff 50%, #ff3da8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.logo::after {
  content: "";
  width: 9px;
  height: 9px;
  border: 1.6px solid #fff;
  border-radius: 50%;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-subtle);
}

.state-loading .dot {
  background: var(--text-subtle);
  animation: pulse 1.2s infinite ease-in-out;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.state-found .dot { background: var(--success); }
.state-partial .dot { background: var(--warning); }
.state-missing .dot { background: var(--danger); }
.state-error .dot { background: var(--text-subtle); }

.label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.text strong {
  color: var(--brand-deep);
  font-weight: 600;
}

.close {
  background: transparent;
  border: 0;
  color: var(--text-subtle);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  flex-shrink: 0;
}

.close:hover {
  background: #f3f5f8;
  color: var(--text);
}

/* Popover that opens above the badge when a match is found and the user
   clicks the icon — shows the matched product's key ERP fields in-place.
   Arrow at the bottom points to the badge's logo. */
.popover {
  position: fixed;
  right: 20px;
  bottom: 78px;
  max-width: 340px;
  min-width: 260px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 36px rgba(20, 22, 30, 0.2), 0 3px 10px rgba(20, 22, 30, 0.08);
  padding: 12px 14px;
  font: 12px/1.4 var(--font);
  color: var(--text);
  animation: pop-in 0.18s ease-out;
}
@keyframes pop-in {
  from { transform: translateY(6px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.popover::after {
  content: "";
  position: absolute;
  bottom: -7px;
  right: 30px;
  width: 13px;
  height: 13px;
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  transform: rotate(45deg);
}
.popover-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.popover-name {
  font-weight: 600;
  color: var(--brand-deep);
  line-height: 1.3;
  flex: 1;
}
.popover-code {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 3px 7px;
  background: rgba(43, 135, 235, 0.1);
  color: var(--primary);
  border-radius: 3px;
  white-space: nowrap;
}
.popover-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 5px 10px;
}
.popover-grid dt {
  color: var(--text-subtle);
  font-size: 11px;
  margin: 0;
}
.popover-grid dd {
  margin: 0;
  font-weight: 500;
  color: var(--text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* "Why this match?" line between header and details grid. Plain italic
   helper text that tells the user on which field the catalog search
   fired — demystifies why a potentially wrong product is being shown. */
.popover-why {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
  margin-bottom: 8px;
  padding: 3px 7px;
  background: rgba(127, 127, 127, 0.08);
  border-radius: 3px;
  display: inline-block;
}

/* Alternatives — shown when the search returned more than one hit. Each
   row is a clickable button that swaps the popover to that hit's details.
   Compact enough that 3-5 alternatives fit without making the popover
   unwieldy, scrolls after that. */
.popover-alts-title {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-subtle);
  margin-bottom: 6px;
}
.popover-alts {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 160px;
  overflow-y: auto;
}
.popover-alt {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font: 11px/1.3 var(--font);
  text-align: left;
  color: var(--text);
}
.popover-alt:hover {
  background: rgba(43, 135, 235, 0.06);
  border-color: rgba(43, 135, 235, 0.2);
}
.popover-alt.selected {
  background: rgba(43, 135, 235, 0.12);
  border-color: rgba(43, 135, 235, 0.4);
  font-weight: 600;
}
.popover-alt-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.popover-alt-code {
  font-size: 10px;
  color: var(--text-subtle);
  font-variant-numeric: tabular-nums;
}
`

let currentBadge: HTMLElement | null = null
let currentQuery = ''
// All catalog hits from the last search — sorted by MiniSearch score,
// best first. Populated by renderState. The popover shows the top hit's
// details and lists the rest as switchable alternatives so the user can
// review which of several fuzzy matches actually corresponds to the page
// they're on.
let matchedHits: CatalogSearchHit[] = []
let currentPopover: HTMLElement | null = null
let currentRoot: ShadowRoot | null = null

export async function show(product: DetectedProduct): Promise<void> {
  const { root } = mountShadowHost(HOST_ID, 2147483400)
  root.innerHTML = ''
  injectStyles(root, CSS)
  currentRoot = root
  currentPopover = null
  matchedHits = []

  currentQuery = product.title

  const badge = h('div', { class: 'badge state-loading' })
  root.appendChild(badge)
  currentBadge = badge

  const logo = h('span', { class: 'logo', 'aria-hidden': 'true' } as unknown as Partial<HTMLSpanElement>)
  badge.appendChild(logo)

  const dot = h('span', { class: 'dot' })
  badge.appendChild(dot)

  const textEl = h('span', { class: 'text' }, 'Αναζήτηση στον κατάλογο…')
  badge.appendChild(textEl)

  const close = h('button', { class: 'close', title: 'Κλείσιμο' } as Partial<HTMLButtonElement>, '×')
  close.addEventListener('click', (e) => {
    e.stopPropagation()
    markDismissed(product.title)
    hide()
  })
  badge.appendChild(close)

  badge.addEventListener('click', () => {
    // When we have catalog hits, toggle the details popover. For fully
    // missing matches, fall back to the full lookup card so the user can
    // keep searching manually.
    if (matchedHits.length > 0) {
      togglePopover()
    } else {
      LookupCard.open(product.title)
    }
  })

  const res = await sendMessage({ type: 'search/catalog', query: product.title, limit: 5 })
  if (!res.ok) {
    badge.className = 'badge state-error'
    textEl.textContent = 'Σφάλμα αναζήτησης'
    return
  }

  const results = (res as { ok: true; results: SearchResults }).results
  renderState(badge, dot, textEl, results, product)
}

function renderState(
  badge: HTMLElement,
  _dot: HTMLElement,
  textEl: HTMLElement,
  results: SearchResults,
  product: DetectedProduct,
): void {
  const exactCount = results.exact.length
  const fuzzyCount = results.fuzzy.length

  textEl.innerHTML = ''

  if (exactCount > 0) {
    badge.className = 'badge state-found'
    // Store every hit so the popover can list fuzzy alternatives too, even
    // when we've got a confident exact match — useful for disambiguation.
    matchedHits = [...results.exact, ...results.fuzzy]
    const match = results.exact[0]!.product
    const prefix = document.createElement('span')
    prefix.className = 'label'
    prefix.textContent = 'ΒΡΕΘΗΚΕ'
    const name = document.createElement('strong')
    name.textContent = match.name || match.code || '—'
    textEl.appendChild(prefix)
    textEl.appendChild(document.createTextNode(' '))
    textEl.appendChild(name)
    return
  }

  if (fuzzyCount > 0) {
    badge.className = 'badge state-partial'
    matchedHits = [...results.fuzzy]
    const prefix = document.createElement('span')
    prefix.className = 'label'
    prefix.textContent = 'ΠΙΘΑΝΟ'
    const msg = document.createElement('span')
    msg.textContent = ` ${fuzzyCount} αντιστοίχιση${fuzzyCount === 1 ? '' : 'εις'}`
    textEl.appendChild(prefix)
    textEl.appendChild(msg)
    return
  }

  badge.className = 'badge state-missing'
  const prefix = document.createElement('span')
  prefix.className = 'label'
  prefix.textContent = 'ΛΕΙΠΕΙ'
  const name = document.createElement('strong')
  name.textContent = truncate(product.title, 60)
  textEl.appendChild(prefix)
  textEl.appendChild(document.createTextNode(' '))
  textEl.appendChild(name)
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

/**
 * Show / hide the compact details popover above the badge. Toggling is
 * idempotent — clicking again with the popover open closes it. Closing
 * happens too when the user clicks anywhere outside; see the one-shot
 * document listener inside.
 */
function togglePopover(): void {
  if (currentPopover) {
    currentPopover.remove()
    currentPopover = null
    return
  }
  if (!currentRoot || matchedHits.length === 0) return
  currentPopover = buildPopover(matchedHits, 0)
  currentRoot.appendChild(currentPopover)
  // Close on outside click — run on next tick so the click that opened
  // the popover doesn't immediately close it again.
  //
  // Shadow DOM quirk: clicks inside our shadow tree are re-targeted to the
  // shadow host before reaching a document listener, so `.contains(target)`
  // returns false and any click inside the popover would close it prematurely.
  // Use `composedPath()` to see the real path through the shadow tree.
  setTimeout(() => {
    const dismiss = (e: MouseEvent) => {
      const path = e.composedPath()
      if (currentPopover && path.includes(currentPopover)) return
      if (currentBadge && path.includes(currentBadge)) return
      currentPopover?.remove()
      currentPopover = null
      document.removeEventListener('click', dismiss, true)
    }
    document.addEventListener('click', dismiss, true)
  }, 0)
}

/**
 * Build the popover body for a given hit set and selected index. When there
 * are multiple hits (common with fuzzy matches), we render the selected
 * hit's details on top AND a clickable list of alternatives below so the
 * user can switch between them in place. The `matched_field` on each hit
 * tells them WHY we thought it was a candidate (e.g. matched by "name" vs
 * "code" vs "barcode"), which is the "why does it think we have this?"
 * answer they asked about.
 */
function buildPopover(hits: CatalogSearchHit[], selectedIdx: number): HTMLElement {
  const box = document.createElement('div')
  box.className = 'popover'
  const hit = hits[selectedIdx] ?? hits[0]!
  const product = hit.product

  const head = document.createElement('div')
  head.className = 'popover-head'
  const name = document.createElement('span')
  name.className = 'popover-name'
  name.textContent = product.name || '—'
  head.appendChild(name)
  if (product.code) {
    const code = document.createElement('span')
    code.className = 'popover-code'
    code.textContent = product.code
    head.appendChild(code)
  }
  box.appendChild(head)

  // "Why this match?" — which product field contributed to the match, and
  // its tier (exact/fuzzy). Sets honest expectations when the match isn't
  // actually the right product.
  const whyLine = document.createElement('div')
  whyLine.className = 'popover-why'
  const tierLabel = hit.tier === 'exact' ? 'ακριβές' : 'πιθανό'
  const fieldLabel = hit.matched_field ? ` · πεδίο: ${translateField(hit.matched_field)}` : ''
  whyLine.textContent = `Match: ${tierLabel}${fieldLabel}`
  box.appendChild(whyLine)

  const grid = document.createElement('dl')
  grid.className = 'popover-grid'
  const addRow = (label: string, value: string | undefined | null) => {
    if (!value) return
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    grid.appendChild(dt)
    grid.appendChild(dd)
  }
  addRow('Κατηγορία', product.category_name || undefined)
  addRow('Μονάδα', product.metric || undefined)
  addRow('Barcode', product.barcode || undefined)
  addRow('Part Number', product.part_number || undefined)
  addRow('MPN/ISBN', product.mpn_isbn || undefined)
  addRow('Κωδ. προμηθευτή', product.supplier_code || undefined)
  const purchase = product.purchase_net_amount as number | string | null | undefined
  if (purchase !== null && purchase !== undefined && purchase !== '') {
    addRow('Τιμή αγοράς', formatMoney(purchase))
  }
  const sale = product.sale_net_amount as number | string | null | undefined
  if (sale !== null && sale !== undefined && sale !== '') {
    addRow('Τιμή πώλησης', formatMoney(sale))
  }
  const stock = productStock(product)
  addRow('Απόθεμα', String(stock))
  box.appendChild(grid)

  // Market-price lookup — one-shot fetch against Materials Hub. Doesn't
  // persist tracking; just shows the cheapest retailer we find so the user
  // gets a quick "is our retail competitive?" signal inline in the popover.
  box.appendChild(buildLowestPriceAction(product))

  console.debug('[oxygen-helper] auto-badge popover matched product:', product)

  // Alternatives picker — hidden when there's only one hit. Clicking a row
  // swaps the popover body to that hit's details without closing + reopening.
  if (hits.length > 1) {
    const altTitle = document.createElement('div')
    altTitle.className = 'popover-alts-title'
    altTitle.textContent = `Άλλες πιθανές αντιστοιχίσεις (${hits.length - 1})`
    box.appendChild(altTitle)

    const alts = document.createElement('div')
    alts.className = 'popover-alts'
    hits.forEach((h, i) => {
      const row = document.createElement('button')
      row.className = 'popover-alt' + (i === selectedIdx ? ' selected' : '')
      row.type = 'button'
      const label = document.createElement('span')
      label.className = 'popover-alt-name'
      label.textContent = h.product.name || h.product.code || '—'
      const codeTag = document.createElement('span')
      codeTag.className = 'popover-alt-code'
      codeTag.textContent = h.product.code || ''
      row.appendChild(label)
      row.appendChild(codeTag)
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        if (i === selectedIdx) return
        // Replace the popover in place with the newly selected hit.
        if (!currentRoot || !currentPopover) return
        const next = buildPopover(hits, i)
        currentPopover.replaceWith(next)
        currentPopover = next
      })
      alts.appendChild(row)
    })
    box.appendChild(alts)
  }

  return box
}

/**
 * "Fetch lowest price" row — adds a link that kicks a one-shot Materials Hub
 * lookup against the matched product, renders the cheapest retailer inline
 * without persisting a tracking row. Failure paths surface the error text
 * rather than silently collapsing to nothing.
 */
function buildLowestPriceAction(product: Product): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'popover-lowprice'
  Object.assign(wrap.style, {
    marginTop: '10px',
    paddingTop: '8px',
    borderTop: '1px solid #edeff3',
  } as CSSStyleDeclaration)

  const link = document.createElement('a')
  link.href = 'javascript:void(0);'
  link.textContent = '🔎 Fetch lowest price'
  Object.assign(link.style, {
    color: '#2b87eb',
    fontSize: '12.5px',
    fontWeight: '500',
    textDecoration: 'none',
    cursor: 'pointer',
  } as CSSStyleDeclaration)
  wrap.appendChild(link)

  const out = document.createElement('div')
  out.style.marginTop = '6px'
  out.style.fontSize = '12px'
  out.style.color = '#6b7280'
  wrap.appendChild(out)

  link.addEventListener('click', async (e) => {
    e.stopPropagation()
    e.preventDefault()
    const name = (product.name ?? '').trim()
    if (!name) {
      out.textContent = 'Δεν υπάρχει όνομα προϊόντος.'
      return
    }
    // Reuse the dimension parser to surface size info inline in the query;
    // the API accepts `dimensions` separately but including it in the
    // `search_query` materially improves retailer match quality.
    const parsed = parseAreaFromName(name)
    const dimensions = parsed?.source
    link.textContent = 'Φόρτωση…'
    out.textContent = ''
    try {
      const res = (await sendMessage({
        type: 'prices/lookup-quick',
        search_query: name,
        dimensions,
      })) as
        | { ok: true; record: { results?: Array<Record<string, unknown>>; summary?: string } }
        | { ok: false; error: string }
      if (!res.ok) {
        if (/materials hub api key/i.test(res.error)) {
          out.innerHTML =
            'Προσθέστε Materials Hub API key στις <strong>Ρυθμίσεις</strong>.'
        } else {
          out.textContent = `Σφάλμα: ${res.error}`
          out.style.color = '#b91c1c'
        }
        link.textContent = '🔎 Fetch lowest price'
        return
      }
      const results = res.record.results ?? []
      if (!results.length) {
        out.textContent = 'Δεν βρέθηκαν τιμές.'
        link.textContent = '🔎 Fetch lowest price'
        return
      }
      // Prefer exact-match rows for the "cheapest" claim so we don't mislead
      // the user with a variant (different color/size) price. Fall back to
      // variant/unverifiable when no exact match exists. Family rows
      // (same brand+series but DIFFERENT SKU) are excluded entirely —
      // their price is for a different product and would mislead.
      const nonFamily = results.filter((r) => r.match_kind !== 'family')
      const withExact = nonFamily.filter((r) => r.match_kind === 'exact')
      const pool = withExact.length ? withExact : nonFamily.length ? nonFamily : results
      const sorted = [...pool].sort(
        (a, b) =>
          (Number(a.price) || Number.POSITIVE_INFINITY) -
          (Number(b.price) || Number.POSITIVE_INFINITY),
      )
      const cheapest = sorted[0]!
      const price = Number(cheapest.price)
      const originalPrice = Number(cheapest.original_price)
      const hasOriginal =
        Number.isFinite(originalPrice) && originalPrice > 0 && originalPrice > price
      const currency = String(cheapest.currency ?? 'EUR')
      const retailer = String(cheapest.retailer_name ?? 'retailer')
      const url = String(cheapest.product_url ?? '')
      const verified = cheapest.verified === true
      const matchKind = typeof cheapest.match_kind === 'string' ? cheapest.match_kind : ''
      const matchNote = typeof cheapest.match_note === 'string' ? cheapest.match_note : ''
      const sym = currencySymbolLocal(currency)
      out.innerHTML = ''

      const label = document.createElement('span')
      label.textContent = 'Χαμηλότερη: '
      out.appendChild(label)
      if (hasOriginal) {
        const was = document.createElement('span')
        was.textContent = `${originalPrice.toFixed(2)} ${sym} `
        was.style.textDecoration = 'line-through'
        was.style.color = '#9aa0a6'
        was.style.fontSize = '11px'
        was.title = 'Αρχική τιμή (πριν την έκπτωση)'
        out.appendChild(was)
      }
      const priceNow = document.createElement('strong')
      priceNow.textContent = Number.isFinite(price) ? `${price.toFixed(2)} ${sym}` : '—'
      out.appendChild(priceNow)

      const badge = document.createElement('span')
      badge.textContent = verified ? ' ✓' : ' ?'
      badge.title = verified ? 'Επαληθευμένη Τιμή' : 'Μη Επαληθευμένη Τιμή'
      badge.style.color = verified ? '#0c7b00' : '#a15c00'
      badge.style.fontWeight = '700'
      badge.style.cursor = 'help'
      out.appendChild(badge)

      // Profit vs our purchase cost — same affordance as the Κέρδος-tab
      // table, rendered inline after the verified badge. Falls through when
      // we don't have a cost (product.purchase_net_amount missing/0) so
      // nothing silently misleads the user with a "0%" delta.
      const costRaw = product.purchase_net_amount
      const cost = typeof costRaw === 'number' ? costRaw : parseFloat(String(costRaw ?? ''))
      if (Number.isFinite(cost) && cost > 0 && Number.isFinite(price) && price > 0) {
        const diff = price - cost
        const pct = (diff / cost) * 100
        const sign = diff > 0 ? '+' : ''
        const profit = document.createElement('span')
        profit.textContent = ` · Κέρδος ${sign}${diff.toFixed(2)} ${sym} (${sign}${pct.toFixed(1)}%)`
        profit.style.color = diff > 0 ? '#0c7b00' : diff < 0 ? '#b91c1c' : '#6b7280'
        profit.style.fontWeight = '600'
        profit.title = `Τιμή ανταγωνιστή ${price.toFixed(2)} ${sym} − κόστος μας ${cost.toFixed(2)} ${sym}`
        out.appendChild(profit)
      }

      const sep = document.createElement('span')
      sep.textContent = ' · '
      out.appendChild(sep)

      const rlabel = document.createElement('a')
      rlabel.href = url || 'javascript:void(0);'
      rlabel.target = '_blank'
      rlabel.rel = 'noopener noreferrer'
      rlabel.textContent = retailer
      rlabel.style.color = '#2b87eb'
      rlabel.style.textDecoration = 'none'
      out.appendChild(rlabel)

      if (matchKind === 'variant' || matchKind === 'unverifiable') {
        const mb = document.createElement('span')
        mb.textContent = ` ${matchKind === 'variant' ? 'Variant' : 'Unverified'}`
        mb.title = matchNote ||
          (matchKind === 'variant'
            ? 'Παραλλαγή: ίδιο μοντέλο, διαφορετικό χρώμα/μέγεθος/φινίρισμα'
            : 'Δεν κατέστη δυνατή η ταυτοποίηση του προϊόντος από τη σελίδα')
        mb.style.marginInlineStart = '6px'
        mb.style.padding = '0 6px'
        mb.style.borderRadius = '10px'
        mb.style.background = matchKind === 'variant' ? '#fdecc8' : '#eef0f5'
        mb.style.color = matchKind === 'variant' ? '#a15c00' : '#6b7280'
        mb.style.fontSize = '10px'
        mb.style.fontWeight = '600'
        mb.style.cursor = 'help'
        out.appendChild(mb)
      }

      if (results.length > 1) {
        const more = document.createElement('span')
        more.textContent = ` (+${results.length - 1} ακόμη)`
        more.style.color = '#6b7280'
        out.appendChild(more)
      }
      link.textContent = '🔁 Ανανέωση'
    } catch (err) {
      out.textContent = `Σφάλμα: ${(err as Error)?.message ?? err}`
      out.style.color = '#b91c1c'
      link.textContent = '🔎 Fetch lowest price'
    }
  })

  return wrap
}

function currencySymbolLocal(code: string): string {
  switch (code.toUpperCase()) {
    case 'EUR': return '€'
    case 'USD': return '$'
    case 'GBP': return '£'
    default: return code
  }
}

function translateField(field: string): string {
  const map: Record<string, string> = {
    name: 'όνομα',
    code: 'SKU',
    barcode: 'barcode',
    mpn_isbn: 'MPN/ISBN',
    part_number: 'part number',
    supplier_code: 'κωδ. προμηθευτή',
    remote: 'live Oxygen search',
  }
  return map[field] ?? field
}

export function hide(): void {
  currentBadge = null
  currentQuery = ''
  currentPopover = null
  currentRoot = null
  matchedHits = []
  unmountHost(HOST_ID)
}

export function isShowing(query: string): boolean {
  return currentBadge !== null && currentQuery === query
}

/* ---- Dismissal memory (sessionStorage, keyed by origin + query hash) ---- */

const DISMISS_KEY = 'oxygen-helper.auto-badge.dismissed'

function loadDismissed(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveDismissed(data: Record<string, number>): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

function dismissKey(title: string): string {
  return `${window.location.origin}|${title.slice(0, 120).toLowerCase()}`
}

export function isDismissed(title: string): boolean {
  const data = loadDismissed()
  return !!data[dismissKey(title)]
}

function markDismissed(title: string): void {
  const data = loadDismissed()
  data[dismissKey(title)] = Date.now()
  saveDismissed(data)
}
