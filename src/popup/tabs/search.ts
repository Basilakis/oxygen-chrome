import { sendMessage } from '@/shared/messages'
import type { SearchResults } from '@/shared/messages'
import { formatMoney, debounce } from '@/shared/util'

export function renderSearchTab(root: HTMLElement): void {
  root.innerHTML = ''

  const inputRow = document.createElement('div')
  inputRow.className = 'search-input-row'
  const input = document.createElement('input')
  input.type = 'search'
  input.className = 'search-input'
  input.placeholder = 'περιγραφή / SKU / barcode / MPN / κωδικός προμηθευτή'
  inputRow.appendChild(input)

  // Page picker button — click to pick a product title from the active tab.
  // Only useful when the popup is in detached-window mode (so it stays open
  // while the user clicks on the page). In classic popup mode, the popup
  // closes on outside-click and this workflow breaks.
  const pickBtn = document.createElement('button')
  pickBtn.type = 'button'
  pickBtn.className = 'btn pick-btn'
  pickBtn.title = 'Επιλογή τίτλου από σελίδα'
  pickBtn.textContent = '📍'
  inputRow.appendChild(pickBtn)
  root.appendChild(inputRow)

  const pickStatus = document.createElement('div')
  pickStatus.className = 'pick-status'
  root.appendChild(pickStatus)

  const results = document.createElement('div')
  results.className = 'stack'
  root.appendChild(results)

  // Listen for picker result (broadcast by content script on pick-click)
  const pickListener = (msg: { type?: string; text?: string } | undefined): void => {
    if (msg?.type === 'picker/picked' && typeof msg.text === 'string') {
      input.value = msg.text
      pickStatus.textContent = ''
      // Fire the debounced search
      input.dispatchEvent(new Event('input'))
      input.focus()
    }
  }
  chrome.runtime.onMessage.addListener(pickListener as never)

  pickBtn.addEventListener('click', async () => {
    // Find active tab in a regular browser window (excludes our own popup window)
    const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' } as chrome.tabs.QueryInfo)
    const targetTab = tabs.find((t) => t.id !== undefined)
    if (!targetTab || targetTab.id === undefined) {
      pickStatus.innerHTML = '<span class="err">Δεν βρέθηκε ενεργή καρτέλα.</span>'
      return
    }

    // Not all URLs allow content-script injection.
    const url = targetTab.url ?? ''
    if (!/^https?:/i.test(url)) {
      pickStatus.innerHTML =
        `<span class="err">Η επιλογή δεν λειτουργεί σε αυτή τη σελίδα (${url.split(':')[0] || 'chrome'}:). Άνοιξε μια κανονική ιστοσελίδα.</span>`
      return
    }

    pickStatus.innerHTML = '📍 <em>Κάνε κλικ στον τίτλο του προϊόντος στη σελίδα. Escape για ακύρωση.</em>'
    const send = () =>
      chrome.tabs.sendMessage(targetTab.id!, {
        type: 'picker/activate',
        mode: 'return-to-popup',
      })
    try {
      await send()
    } catch {
      // Content script not present (tab open before extension loaded).
      // Programmatically inject it once, then retry the send.
      try {
        const contentFiles = contentScriptPaths()
        await chrome.scripting.executeScript({ target: { tabId: targetTab.id }, files: contentFiles })
        // Small delay so listeners register
        await new Promise((r) => setTimeout(r, 80))
        await send()
      } catch (err2) {
        renderReloadNeeded(pickStatus, targetTab.id)
        console.warn('[oxygen-helper] picker activation fallback failed', err2)
      }
    }
  })

  let seq = 0
  const run = debounce(async (q: string) => {
    const mySeq = ++seq
    if (!q.trim()) {
      results.innerHTML = '<p class="muted">Πληκτρολογήστε για αναζήτηση στον τοπικό κατάλογο.</p>'
      return
    }
    // Show a loading indicator so short queries get immediate feedback
    results.innerHTML = `<p class="muted">Αναζήτηση για «${escapeHtml(q)}»…</p>`
    const res = await sendMessage({ type: 'search/catalog', query: q, limit: 20 })
    // Drop stale responses if user kept typing
    if (mySeq !== seq) return
    if (!res.ok) {
      results.innerHTML = `<p class="muted">Σφάλμα: ${(res as { error: string }).error}</p>`
      return
    }
    renderResults(results, (res as { results: SearchResults }).results)
  }, 120)

  input.addEventListener('input', () => run(input.value))
  input.focus()
  run('')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Walk the manifest's `content_scripts` entry for web-capture and return its
 * built JS file path. crxjs rewrites the source path to a hashed asset name,
 * so we can't hard-code it. Falls back to a best-guess if the manifest is
 * shaped unexpectedly.
 */
function contentScriptPaths(): string[] {
  try {
    const manifest = chrome.runtime.getManifest()
    const cs = manifest.content_scripts ?? []
    // Find the entry that contains "web-capture" in one of its JS files
    const entry = cs.find((e) => (e.js ?? []).some((j) => /web-capture/i.test(j)))
    if (entry && entry.js && entry.js.length) return entry.js
  } catch {
    /* ignore */
  }
  return []
}

/**
 * If the tab doesn't have our content script and we couldn't inject it,
 * ask the user to refresh the tab. One-click reload button.
 */
function renderReloadNeeded(el: HTMLElement, tabId: number): void {
  el.innerHTML = ''
  const wrap = document.createElement('span')
  wrap.className = 'err'
  wrap.textContent =
    'Το περιεχόμενο δεν έχει φορτωθεί σε αυτή τη σελίδα. Ανανέωσέ την για να λειτουργήσει η επιλογή.'
  el.appendChild(wrap)
  const btn = document.createElement('button')
  btn.className = 'btn'
  btn.style.marginLeft = '6px'
  btn.style.padding = '2px 8px'
  btn.style.fontSize = '11px'
  btn.textContent = 'Ανανέωση'
  btn.addEventListener('click', () => {
    chrome.tabs.reload(tabId)
    el.innerHTML = '<em class="muted">Η σελίδα ανανεώθηκε — κάνε ξανά κλικ στο 📍.</em>'
  })
  el.appendChild(btn)
}

function renderResults(container: HTMLElement, results: SearchResults): void {
  container.innerHTML = ''
  if (!results.exact.length && !results.fuzzy.length) {
    container.innerHTML = '<p class="muted">Κανένα αποτέλεσμα.</p>'
    return
  }

  if (results.exact.length) {
    const h = document.createElement('div')
    h.className = 'tier-head tier-exact'
    h.textContent = 'Ακριβής αντιστοίχιση'
    container.appendChild(h)
    for (const hit of results.exact) container.appendChild(renderHit(hit.product))
  }

  if (results.fuzzy.length) {
    const h = document.createElement('div')
    h.className = 'tier-head tier-fuzzy'
    h.textContent = 'Πιθανές αντιστοιχίσεις'
    container.appendChild(h)
    for (const hit of results.fuzzy) container.appendChild(renderHit(hit.product))
  }
}

function renderHit(p: SearchResults['exact'][number]['product']): HTMLElement {
  const box = document.createElement('div')
  box.className = 'hit'

  const top = document.createElement('div')
  top.className = 'row'
  const name = document.createElement('span')
  name.className = 'name grow'
  name.textContent = p.name ?? '(χωρίς όνομα)'
  const code = document.createElement('span')
  code.className = 'code'
  code.textContent = p.code ?? ''
  top.appendChild(name)
  top.appendChild(code)
  box.appendChild(top)

  const stock = (p.warehouses ?? []).reduce((s, w) => s + (w.quantity ?? 0), 0)
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `αγορά ${formatMoney(p.purchase_net_amount ?? 0)} · πώληση ${formatMoney(p.sale_net_amount ?? 0)} · απόθεμα ${stock}`
  box.appendChild(meta)

  const row = document.createElement('div')
  row.className = 'row'
  row.style.marginTop = '6px'

  const addBtn = document.createElement('button')
  addBtn.className = 'btn'
  addBtn.textContent = 'Στο πρόχειρο'
  addBtn.addEventListener('click', async () => {
    let draftId: string | null = null
    const active = await sendMessage({ type: 'drafts/get-active' })
    if (active.ok && 'draft' in active && active.draft) draftId = (active.draft as { id: string }).id
    else {
      const created = await sendMessage({ type: 'drafts/create' })
      if (created.ok && 'draft' in created && created.draft) draftId = (created.draft as { id: string }).id
    }
    if (!draftId) return
    const added = await sendMessage({
      type: 'drafts/add-line',
      draft_id: draftId,
      line: { source: { captured_at: Date.now() }, matched_product_id: p.id, status: 'unmatched', payload: {} },
    })
    if (added.ok && 'draft' in added && added.draft) {
      const last = (added.draft as { lines: { id: string }[] }).lines.slice(-1)[0]
      if (last) await sendMessage({ type: 'drafts/match-line', draft_id: draftId, line_id: last.id, product_id: p.id })
    }
    addBtn.textContent = 'Προστέθηκε ✓'
    addBtn.disabled = true
  })
  row.appendChild(addBtn)
  box.appendChild(row)
  return box
}
