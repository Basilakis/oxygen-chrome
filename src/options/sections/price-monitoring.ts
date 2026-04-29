import { sendMessage } from '@/shared/messages'

/**
 * "Παρακολούθηση τιμών" dashboard. Lists every product currently being
 * tracked on Materials Hub for the user's API key — each row was registered
 * individually from its product modal (Κέρδος tab → Παρακολούθηση τιμών).
 * The dashboard is the single place to manage them all: bulk refresh, stop,
 * change interval, flip verification.
 *
 * Data source: one `GET /prices/track` call on render. Per-row actions hit
 * the per-id endpoints. We don't cache between renders — the list is small
 * and users expect fresh state when they open the section.
 */

interface TrackedRow {
  tracking_id: string
  search_query?: string
  dimensions?: string
  country_code?: string
  refresh_interval_hours?: number
  verify_prices?: boolean
  last_refreshed_at?: string
  total_results?: number
  status?: string
}

export async function renderPriceMonitoring(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>Παρακολούθηση τιμών</h2>'

  const intro = document.createElement('p')
  intro.className = 'hint'
  intro.textContent =
    'Προϊόντα που παρακολουθούνται στο Materials Hub. Κάθε γραμμή προστέθηκε ξεχωριστά από την καρτέλα «Κέρδος» του αντίστοιχου προϊόντος. Εδώ μπορείς να δεις/ενημερώσεις/σταματήσεις όλες τις παρακολουθήσεις μαζί.'
  root.appendChild(intro)

  const toolbar = document.createElement('div')
  toolbar.className = 'row'
  toolbar.style.marginBottom = '10px'
  const refreshAllBtn = document.createElement('button')
  refreshAllBtn.className = 'btn'
  refreshAllBtn.textContent = 'Ανανέωση λίστας'
  toolbar.appendChild(refreshAllBtn)
  root.appendChild(toolbar)

  const status = document.createElement('div')
  status.className = 'hint'
  status.style.minHeight = '18px'
  root.appendChild(status)

  const tableWrap = document.createElement('div')
  tableWrap.className = 'pm-table-wrap'
  root.appendChild(tableWrap)

  async function loadAndRender() {
    status.textContent = 'Φόρτωση…'
    tableWrap.innerHTML = ''
    try {
      const res = (await sendMessage({ type: 'prices/list-tracked' })) as
        | { ok: true; tracked: unknown }
        | { ok: false; error: string }
      if (!res.ok) {
        if (/materials hub api key/i.test(res.error)) {
          status.innerHTML =
            '<span class="err">Δεν έχει οριστεί Materials Hub API key. Πρόσθεσέ το στην ενότητα «Βοηθός AI &amp; Price Monitoring» πιο πάνω.</span>'
          return
        }
        status.innerHTML = `<span class="err">Σφάλμα: ${escapeHtml(res.error)}</span>`
        return
      }
      const rows = extractRows(res.tracked)
      status.textContent = rows.length === 0
        ? 'Δεν υπάρχουν παρακολουθούμενα προϊόντα.'
        : `${rows.length} προϊόντα.`
      if (rows.length === 0) return
      tableWrap.appendChild(buildTable(rows, loadAndRender))
    } catch (err) {
      status.innerHTML = `<span class="err">Σφάλμα: ${escapeHtml(
        String((err as Error)?.message ?? err),
      )}</span>`
    }
  }

  refreshAllBtn.addEventListener('click', () => void loadAndRender())

  await loadAndRender()
}

function extractRows(raw: unknown): TrackedRow[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (() => {
          const r = raw as Record<string, unknown>
          for (const key of ['items', 'data', 'results', 'tracked', 'tracking']) {
            if (Array.isArray(r[key])) return r[key] as unknown[]
          }
          return []
        })()
      : []
  const out: TrackedRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = String(r.tracking_id ?? r.id ?? '')
    if (!id) continue
    out.push({
      tracking_id: id,
      search_query: strOrUndef(r.search_query ?? r.query),
      dimensions: strOrUndef(r.dimensions),
      country_code: strOrUndef(r.country_code ?? r.country),
      refresh_interval_hours: numOrUndef(r.refresh_interval_hours ?? r.interval_hours),
      verify_prices: typeof r.verify_prices === 'boolean' ? r.verify_prices : undefined,
      last_refreshed_at: strOrUndef(r.last_refreshed_at ?? r.refreshed_at ?? r.updated_at),
      total_results: numOrUndef(r.total_results ?? r.result_count),
      status: strOrUndef(r.status),
    })
  }
  return out
}

function buildTable(rows: TrackedRow[], reload: () => Promise<void>): HTMLElement {
  const scroll = document.createElement('div')
  scroll.className = 'pm-table-scroll'

  const table = document.createElement('table')
  table.className = 'pm-table'

  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  for (const label of [
    'Προϊόν',
    'Χώρα',
    'Ανά',
    'Επαλ.',
    'Αποτ.',
    'Τελ. ανανέωση',
    'Ενέργειες',
  ]) {
    const th = document.createElement('th')
    th.textContent = label
    hr.appendChild(th)
  }
  thead.appendChild(hr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const r of rows) {
    tbody.appendChild(buildRow(r, reload))
  }
  table.appendChild(tbody)
  scroll.appendChild(table)
  return scroll
}

function buildRow(r: TrackedRow, reload: () => Promise<void>): HTMLTableRowElement {
  const tr = document.createElement('tr')

  const name = document.createElement('td')
  name.className = 'pm-col-name'
  const nameStack = document.createElement('div')
  nameStack.className = 'pm-name-stack'
  const q = document.createElement('div')
  q.className = 'pm-query'
  q.textContent = r.search_query || '(χωρίς όνομα)'
  q.title = r.search_query ?? ''
  nameStack.appendChild(q)
  if (r.dimensions) {
    const d = document.createElement('div')
    d.className = 'pm-dims'
    d.textContent = r.dimensions
    nameStack.appendChild(d)
  }
  name.appendChild(nameStack)
  tr.appendChild(name)

  const country = document.createElement('td')
  country.textContent = r.country_code ?? '—'
  tr.appendChild(country)

  // Interval — editable inline with a tiny number input.
  const interval = document.createElement('td')
  const intervalInput = document.createElement('input')
  intervalInput.type = 'number'
  intervalInput.min = '1'
  intervalInput.step = '1'
  intervalInput.value = String(r.refresh_interval_hours ?? 12)
  intervalInput.className = 'pm-interval-input'
  intervalInput.title = 'Ώρες μεταξύ αυτόματων ανανεώσεων'
  intervalInput.addEventListener('change', async () => {
    const h = Math.max(1, Math.floor(Number(intervalInput.value)))
    intervalInput.disabled = true
    await sendMessage({
      type: 'prices/update-by-id',
      tracking_id: r.tracking_id,
      patch: { refresh_interval_hours: h },
    })
    intervalInput.disabled = false
  })
  interval.appendChild(intervalInput)
  const hUnit = document.createElement('span')
  hUnit.textContent = ' ώρ.'
  hUnit.className = 'pm-unit'
  interval.appendChild(hUnit)
  tr.appendChild(interval)

  // verify_prices — checkbox.
  const verify = document.createElement('td')
  const verifyChk = document.createElement('input')
  verifyChk.type = 'checkbox'
  verifyChk.checked = r.verify_prices !== false
  verifyChk.className = 'pm-verify-chk'
  verifyChk.title = 'Επαλήθευση τιμών με Firecrawl'
  verifyChk.addEventListener('change', async () => {
    verifyChk.disabled = true
    await sendMessage({
      type: 'prices/update-by-id',
      tracking_id: r.tracking_id,
      patch: { verify_prices: verifyChk.checked },
    })
    verifyChk.disabled = false
  })
  verify.appendChild(verifyChk)
  tr.appendChild(verify)

  const count = document.createElement('td')
  count.className = 'pm-col-num'
  count.textContent = r.total_results !== undefined ? String(r.total_results) : '—'
  tr.appendChild(count)

  const last = document.createElement('td')
  last.className = 'pm-col-ts'
  last.textContent = r.last_refreshed_at
    ? new Date(r.last_refreshed_at).toLocaleString('el-GR')
    : '—'
  tr.appendChild(last)

  const actions = document.createElement('td')
  actions.className = 'pm-col-actions'
  const refreshBtn = document.createElement('button')
  refreshBtn.type = 'button'
  refreshBtn.className = 'btn pm-btn-small'
  refreshBtn.textContent = 'Ανανέωση'
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true
    refreshBtn.textContent = 'Τρέχει…'
    try {
      await sendMessage({ type: 'prices/refresh-by-id', tracking_id: r.tracking_id })
      await reload()
    } catch {
      refreshBtn.disabled = false
      refreshBtn.textContent = 'Ανανέωση'
    }
  })
  actions.appendChild(refreshBtn)

  const stopBtn = document.createElement('button')
  stopBtn.type = 'button'
  stopBtn.className = 'btn danger pm-btn-small'
  stopBtn.textContent = 'Διακοπή'
  stopBtn.addEventListener('click', async () => {
    if (!confirm(`Διακοπή παρακολούθησης για "${r.search_query ?? r.tracking_id}";`)) return
    stopBtn.disabled = true
    try {
      await sendMessage({ type: 'prices/stop-by-id', tracking_id: r.tracking_id })
      await reload()
    } catch {
      stopBtn.disabled = false
    }
  })
  actions.appendChild(stopBtn)
  tr.appendChild(actions)

  return tr
}

function strOrUndef(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v)
  return s === '' ? undefined : s
}

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
