import { sendMessage } from '@/shared/messages'
import type { SearchResults } from '@/shared/messages'
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
`

let currentBadge: HTMLElement | null = null
let currentQuery = ''

export async function show(product: DetectedProduct): Promise<void> {
  const { root } = mountShadowHost(HOST_ID, 2147483400)
  root.innerHTML = ''
  injectStyles(root, CSS)

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
    LookupCard.open(product.title)
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

export function hide(): void {
  currentBadge = null
  currentQuery = ''
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
