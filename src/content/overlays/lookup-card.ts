import { sendMessage } from '@/shared/messages'
import type { SearchResults, CatalogSearchHit, DOMRectLike } from '@/shared/messages'
import { formatMoney, sumStock } from '@/shared/util'
import { mountShadowHost, unmountHost, injectStyles, h } from './shared'

const HOST_ID = 'oxygen-helper-lookup-card'

const CSS = `
:host, * { box-sizing: border-box; }
:host {
  --brand-deep: #2c2d4e;
  --primary: #2b87eb;
  --primary-hover: #1e73cc;
  --success: #2eae5a;
  --danger: #e43f5a;
  --bg-card: #ffffff;
  --bg-muted: #f3f5f8;
  --border: #e4e7eb;
  --border-soft: #eef0f3;
  --text: #1f2330;
  --text-muted: #6b7280;
  --text-subtle: #9aa0a6;
  --radius: 6px;
  --radius-lg: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Greek", sans-serif;
}
.card {
  position: absolute;
  min-width: 340px;
  max-width: 440px;
  max-height: 480px;
  overflow: auto;
  background: var(--bg-card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 14px 40px rgba(20, 22, 30, 0.16), 0 2px 6px rgba(20, 22, 30, 0.08);
  font: 13px/1.45 var(--font);
  padding: 12px 14px;
  pointer-events: auto;
}
.brand-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.brand-logo {
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--brand-deep);
  font-size: 12px;
}
.brand-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-subtle);
}
.card .close {
  position: absolute;
  top: 8px;
  right: 10px;
  cursor: pointer;
  background: transparent;
  border: 0;
  font-size: 18px;
  line-height: 1;
  color: var(--text-subtle);
  padding: 2px 6px;
  border-radius: 4px;
}
.card .close:hover { background: var(--bg-muted); color: var(--text); }
.search {
  width: 100%;
  padding: 9px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  margin-bottom: 10px;
  background: #eff1f6;
  color: var(--text);
  transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.search::placeholder { color: var(--text-subtle); }
.search:hover { background: #e6e9f0; }
.search:focus {
  outline: none;
  background: var(--bg-card);
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(43,135,235,0.12);
}
.tier { margin-bottom: 10px; }
.hit {
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  margin-bottom: 6px;
  background: var(--bg-card);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.hit:hover { border-color: var(--border); box-shadow: 0 1px 3px rgba(20,22,30,0.06); }
.hit .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.hit .name { font-weight: 600; color: var(--text); }
.hit .code { color: var(--text-subtle); font-size: 11px; font-variant-numeric: tabular-nums; }
.hit .meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.hit .actions { margin-top: 8px; display: flex; gap: 6px; }
.btn {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.btn:hover { background: var(--bg-muted); }
.btn.primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.btn.primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.empty { color: var(--text-subtle); font-style: italic; font-size: 12px; }
.tier-label-exact, .tier-label-fuzzy {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tier-label-exact::before, .tier-label-fuzzy::before {
  content: "";
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
.tier-label-exact { color: var(--success); }
.tier-label-fuzzy { color: var(--text-subtle); }
`

let currentInput: HTMLInputElement | null = null

export function open(query: string, rect?: DOMRectLike): void {
  const { root } = mountShadowHost(HOST_ID)
  root.innerHTML = ''
  injectStyles(root, CSS)

  const card = h('div', { class: 'card' })
  positionCard(card, rect)
  root.appendChild(card)

  card.appendChild(h('button', { class: 'close', onclick: close, textContent: '×' } as Partial<HTMLButtonElement>))
  const brandRow = h('div', { class: 'brand-row' })
  brandRow.appendChild(h('span', { class: 'brand-logo' }, 'OXYGEN'))
  brandRow.appendChild(h('span', { class: 'brand-tag' }, 'Αναζήτηση αποθήκης'))
  card.appendChild(brandRow)

  const input = h('input', {
    class: 'search',
    value: query,
    placeholder: 'περιγραφή / SKU / barcode / MPN',
  } as Partial<HTMLInputElement>)
  currentInput = input
  card.appendChild(input)

  const results = h('div', { class: 'results' })
  card.appendChild(results)

  const runSearch = async (q: string) => {
    results.innerHTML = ''
    results.appendChild(h('div', { class: 'empty' }, q ? 'Αναζήτηση…' : 'Πληκτρολογήστε κάτι'))
    if (!q.trim()) return
    const res = (await sendMessage({ type: 'search/catalog', query: q, limit: 15 })) as { ok: true; results: SearchResults } | { ok: false; error: string }
    if (!res.ok) {
      results.innerHTML = ''
      results.appendChild(h('div', { class: 'empty' }, `Σφάλμα: ${res.error}`))
      return
    }
    renderResults(results, res.results)
  }

  let t: ReturnType<typeof setTimeout> | null = null
  input.addEventListener('input', () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => runSearch(input.value), 200)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  document.addEventListener('keydown', escHandler, { once: false })
  document.addEventListener('mousedown', outsideHandler, { capture: true })

  setTimeout(() => input.focus(), 0)
  runSearch(query)
}

function positionCard(card: HTMLElement, rect?: DOMRectLike): void {
  if (!rect) {
    card.style.top = '16px'
    card.style.right = '16px'
    card.style.left = 'auto'
    return
  }
  const top = Math.min(window.innerHeight - 420, Math.max(8, rect.top + rect.height + 6))
  const left = Math.min(window.innerWidth - 460, Math.max(8, rect.left))
  card.style.top = `${top}px`
  card.style.left = `${left}px`
}

function renderResults(container: HTMLElement, results: SearchResults): void {
  container.innerHTML = ''
  if (!results.exact.length && !results.fuzzy.length) {
    container.appendChild(h('div', { class: 'empty' }, 'Κανένα αποτέλεσμα'))
    return
  }
  if (results.exact.length) {
    container.appendChild(h('div', { class: 'tier-label-exact' }, 'ΑΚΡΙΒΗΣ ΑΝΤΙΣΤΟΙΧΙΣΗ'))
    const tier = h('div', { class: 'tier' })
    for (const hit of results.exact) tier.appendChild(renderHit(hit))
    container.appendChild(tier)
  }
  if (results.fuzzy.length) {
    container.appendChild(h('div', { class: 'tier-label-fuzzy' }, 'ΠΙΘΑΝΕΣ ΑΝΤΙΣΤΟΙΧΙΣΕΙΣ'))
    const tier = h('div', { class: 'tier' })
    for (const hit of results.fuzzy) tier.appendChild(renderHit(hit))
    container.appendChild(tier)
  }
}

function renderHit(hit: CatalogSearchHit): HTMLElement {
  const p = hit.product
  const totalStock = sumStock(p.warehouses)
  const box = h('div', { class: 'hit' })
  box.appendChild(
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'name' }, p.name ?? '(χωρίς όνομα)'),
      h('span', { class: 'code' }, p.code ?? ''),
    ),
  )
  box.appendChild(
    h(
      'div',
      { class: 'meta' },
      `αγορά ${formatMoney(p.purchase_net_amount ?? 0)} · πώληση ${formatMoney(p.sale_net_amount ?? 0)} · απόθεμα ${totalStock}`,
    ),
  )
  const actions = h('div', { class: 'actions' })
  actions.appendChild(
    h(
      'button',
      {
        class: 'btn primary',
        onclick: async () => {
          const active = (await sendMessage({ type: 'drafts/get-active' })) as { ok: true; draft: unknown } | { ok: false; error: string }
          if (!active.ok || !active.draft) {
            const created = (await sendMessage({ type: 'drafts/create' })) as { ok: true; draft: { id: string } }
            await addToDraft(created.draft.id, p.id)
          } else {
            await addToDraft((active.draft as { id: string }).id, p.id)
          }
        },
      },
      'Στην ειδοποίηση',
    ),
  )
  box.appendChild(actions)
  return box
}

async function addToDraft(draftId: string, productId: string): Promise<void> {
  const line = await sendMessage({
    type: 'drafts/add-line',
    draft_id: draftId,
    line: {
      source: { captured_at: Date.now(), url: window.location.href, title: document.title },
      matched_product_id: productId,
      status: 'unmatched',
      payload: {},
    },
  })
  if (!line.ok) {
    console.warn('[oxygen-helper] add-line failed', line.error)
    return
  }
  // Promote unmatched → matched using server-side logic
  const draft = (line as { ok: true; draft: { lines: { id: string; matched_product_id?: string | null }[] } }).draft
  const last = draft.lines[draft.lines.length - 1]
  if (last && last.matched_product_id) {
    await sendMessage({ type: 'drafts/match-line', draft_id: draftId, line_id: last.id, product_id: productId })
  }
}

function escHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

function outsideHandler(e: MouseEvent): void {
  const host = document.getElementById(HOST_ID)
  if (!host) return
  const path = e.composedPath()
  if (!path.includes(host)) close()
}

export function close(): void {
  document.removeEventListener('keydown', escHandler)
  document.removeEventListener('mousedown', outsideHandler, { capture: true })
  currentInput = null
  unmountHost(HOST_ID)
}

export function focusIfOpen(): boolean {
  if (currentInput) {
    currentInput.focus()
    return true
  }
  return false
}
