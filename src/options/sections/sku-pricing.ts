import { sendMessage } from '@/shared/messages'
import type { Id, ProductCategory, Settings, SkuStrategy } from '@/shared/types'

const STRATEGY_OPTIONS: Array<{ value: SkuStrategy; label: string; hint: string }> = [
  {
    value: 'auto',
    label: 'Αυτόματος εντοπισμός μοτίβου',
    hint: 'Εντοπίζουμε το μοτίβο από τον υπάρχοντα κατάλογο (συνιστάται).',
  },
  {
    value: 'numeric',
    label: 'Αύξων αριθμός (1, 2, 3…)',
    hint: 'Ίδιο μοτίβο με την προεπιλογή του Oxygen.',
  },
  {
    value: 'prefixed',
    label: 'Με πρόθεμα (OX-0001, OX-0002…)',
    hint: 'Ορίζεις πρόθεμα και βήμα· η ακολουθία αυξάνει ανά νέο προϊόν.',
  },
  {
    value: 'category',
    label: 'Ανά κατηγορία (ΕΠΙΠ-001, ΠΛΑΚ-001…)',
    hint: 'Το πρώτο τμήμα παίρνει τα 4 πρώτα γράμματα της κατηγορίας, μετά ακολουθία.',
  },
]

export async function renderSkuPricing(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>SKU &amp; τιμολόγηση</h2>'

  const [settingsRes, catsRes] = await Promise.all([
    sendMessage({ type: 'settings/get' }),
    sendMessage({ type: 'lookups/get-categories' }),
  ])
  const settings = (settingsRes as { ok: true; settings: Settings }).settings
  // Filter out categories marked inactive/deleted by the server (status=false).
  // Oxygen doesn't hard-delete on the public API — deletion flips status. If we
  // show them anyway, renames/removals look like they didn't take effect.
  const categories = ((catsRes as { ok: true; categories: ProductCategory[] }).categories ?? [])
    .filter((c) => c.status !== false)

  // ---- Strategy selector ----
  const stratWrap = document.createElement('label')
  stratWrap.className = 'field'
  stratWrap.innerHTML = '<span>Στρατηγική παραγωγής SKU</span>'
  const stratSel = document.createElement('select')
  for (const o of STRATEGY_OPTIONS) {
    const opt = document.createElement('option')
    opt.value = o.value
    opt.textContent = o.label
    if (settings.sku_strategy === o.value) opt.selected = true
    stratSel.appendChild(opt)
  }
  stratWrap.appendChild(stratSel)
  const stratHint = document.createElement('div')
  stratHint.className = 'hint'
  stratHint.textContent = STRATEGY_OPTIONS.find((o) => o.value === settings.sku_strategy)?.hint ?? ''
  stratWrap.appendChild(stratHint)
  root.appendChild(stratWrap)

  // ---- Conditional prefix / padding ----
  const prefixWrap = document.createElement('label')
  prefixWrap.className = 'field'
  prefixWrap.innerHTML = '<span>Πρόθεμα</span>'
  const prefixInput = document.createElement('input')
  prefixInput.type = 'text'
  prefixInput.value = settings.sku_prefix
  prefixInput.placeholder = 'π.χ. OX (αφήστε κενό για απλό αριθμητικό)'
  prefixWrap.appendChild(prefixInput)
  root.appendChild(prefixWrap)

  const padWrap = document.createElement('label')
  padWrap.className = 'field'
  padWrap.innerHTML = '<span>Μήκος ακολουθίας (ψηφία)</span>'
  const padInput = document.createElement('input')
  padInput.type = 'number'
  padInput.min = '0'
  padInput.max = '8'
  padInput.value = String(settings.sku_seq_padding)
  padInput.placeholder = '0 = χωρίς padding'
  padWrap.appendChild(padInput)
  root.appendChild(padWrap)

  // ---- Markup (global) ----
  const markupWrap = document.createElement('label')
  markupWrap.className = 'field'
  markupWrap.innerHTML = '<span>Markup πώλησης (%) — προεπιλογή</span>'
  const markupInput = document.createElement('input')
  markupInput.type = 'number'
  markupInput.min = '0'
  markupInput.step = '0.1'
  markupInput.value = String(settings.markup_percent)
  markupWrap.appendChild(markupInput)
  const markupHint = document.createElement('div')
  markupHint.className = 'hint'
  markupHint.textContent =
    'Εφαρμόζεται όταν η κατηγορία του προϊόντος δεν έχει δικό της markup παρακάτω. Η τιμή μπορεί να αλλαχθεί και ανά γραμμή στο AADE prefill.'
  markupWrap.appendChild(markupHint)
  root.appendChild(markupWrap)

  // ---- Per-category markup overrides ----
  // Each category gets its own percent input; leaving it blank means "use the
  // global markup above." We only persist non-empty, non-matching values on
  // save — clearing a row removes that category's override.
  const catMarkups: Record<Id, number> = { ...(settings.category_markup_percents ?? {}) }
  const catMarkupInputs = new Map<Id, HTMLInputElement>()
  if (categories.length) {
    const section = document.createElement('div')
    section.className = 'field category-markup-section'

    const header = document.createElement('div')
    header.className = 'category-markup-head'
    const headTitle = document.createElement('strong')
    headTitle.textContent = `Markup ανά κατηγορία (${categories.length})`
    header.appendChild(headTitle)
    // Force-refresh button — the local IDB is populated by the periodic sync,
    // so after renaming/deleting a category in Oxygen the user has to wait for
    // the next auto-sync (up to 2 minutes) before the list updates here. This
    // button triggers an incremental sync now and re-renders the whole section
    // with the fresh data, without waiting.
    const refreshBtn = document.createElement('button')
    refreshBtn.type = 'button'
    refreshBtn.className = 'btn'
    refreshBtn.style.marginLeft = 'auto'
    refreshBtn.style.fontSize = '11px'
    refreshBtn.style.padding = '4px 10px'
    refreshBtn.textContent = '🔄 Ενημέρωση λίστας'
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true
      refreshBtn.textContent = 'Ενημέρωση…'
      const res = await sendMessage({ type: 'sync/incremental' })
      if (!res.ok) {
        refreshBtn.disabled = false
        refreshBtn.textContent = '⚠ Αποτυχία — δοκίμασε ξανά'
        return
      }
      // Re-render whole section with the updated categories.
      await renderSkuPricing(root)
    })
    header.appendChild(refreshBtn)
    header.style.display = 'flex'
    header.style.alignItems = 'center'
    section.appendChild(header)

    const subHint = document.createElement('div')
    subHint.className = 'hint'
    subHint.textContent =
      'Προαιρετικό override ανά κατηγορία. Άδειο πεδίο = χρήση της προεπιλογής.'
    section.appendChild(subHint)

    const list = document.createElement('div')
    list.className = 'category-markup-list'
    for (const cat of categories) {
      const row = document.createElement('div')
      row.className = 'category-markup-row'
      const label = document.createElement('span')
      label.className = 'category-markup-name'
      label.textContent = cat.name || cat.id
      const input = document.createElement('input')
      input.type = 'number'
      input.min = '0'
      input.step = '0.1'
      input.className = 'category-markup-input'
      input.placeholder = `${settings.markup_percent}%`
      if (typeof catMarkups[cat.id] === 'number') {
        input.value = String(catMarkups[cat.id])
      }
      catMarkupInputs.set(cat.id, input)
      const suffix = document.createElement('span')
      suffix.className = 'category-markup-suffix'
      suffix.textContent = '%'
      row.appendChild(label)
      row.appendChild(input)
      row.appendChild(suffix)
      list.appendChild(row)
    }
    section.appendChild(list)
    root.appendChild(section)
  }

  // ---- Preview ----
  const previewBox = document.createElement('div')
  previewBox.className = 'sku-preview'
  root.appendChild(previewBox)

  const saveRow = document.createElement('div')
  saveRow.className = 'row'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'btn primary'
  saveBtn.textContent = 'Αποθήκευση'
  saveRow.appendChild(saveBtn)
  const status = document.createElement('span')
  status.className = 'hint'
  saveRow.appendChild(status)
  root.appendChild(saveRow)

  // ---- Wire up dynamic UI ----
  const updateVisibility = () => {
    const s = stratSel.value as SkuStrategy
    stratHint.textContent = STRATEGY_OPTIONS.find((o) => o.value === s)?.hint ?? ''
    // Manual prefix is only meaningful for 'prefixed' — 'category' derives it
    // from the category name, 'numeric' has no prefix, and 'auto' reads the
    // dominant pattern from the catalog so a manual override would defeat it.
    const wantsPrefix = s === 'prefixed'
    // Padding width applies wherever we emit a zero-padded sequential suffix.
    // Plain numeric and auto mirror whatever the catalog already uses, so the
    // width is irrelevant there.
    const wantsPadding = s === 'prefixed' || s === 'category'
    prefixWrap.style.display = wantsPrefix ? '' : 'none'
    padWrap.style.display = wantsPadding ? '' : 'none'
  }
  updateVisibility()

  const refreshPreview = async () => {
    // Save ephemeral form values so the preview reflects them (without
    // committing unrelated changes — we only persist on Αποθήκευση).
    const res = await sendMessage({ type: 'sku/preview' })
    if (!res.ok) {
      previewBox.innerHTML = `<span class="hint err">Preview error: ${(res as { error: string }).error}</span>`
      return
    }
    const p = (res as unknown as { preview: { strategy: string; next: string; resolved_from: string } }).preview
    const detected = p.resolved_from === 'auto'
      ? ` (εντοπίστηκε αυτόματα: <strong>${labelForStrategy(p.strategy as SkuStrategy)}</strong>)`
      : ''
    previewBox.innerHTML = `
      <div class="hint">Επόμενο SKU για νέο προϊόν:</div>
      <div class="sku-preview-value">${escapeHtml(p.next)}</div>
      <div class="hint">${detected}</div>
    `
  }
  refreshPreview()

  stratSel.addEventListener('change', async () => {
    updateVisibility()
    // Save strategy immediately so preview uses the new value
    await sendMessage({ type: 'settings/update', patch: { sku_strategy: stratSel.value as SkuStrategy } })
    refreshPreview()
  })
  prefixInput.addEventListener('change', async () => {
    await sendMessage({ type: 'settings/update', patch: { sku_prefix: prefixInput.value.trim() } })
    refreshPreview()
  })
  padInput.addEventListener('change', async () => {
    await sendMessage({
      type: 'settings/update',
      patch: { sku_seq_padding: Math.max(0, Math.min(8, Number(padInput.value))) },
    })
    refreshPreview()
  })

  saveBtn.addEventListener('click', async () => {
    // Collect non-empty, non-negative per-category markups. An empty input
    // means "no override" and gets dropped — we don't store a NaN entry.
    const nextCatMarkups: Record<Id, number> = {}
    for (const [catId, input] of catMarkupInputs.entries()) {
      const raw = input.value.trim()
      if (!raw) continue
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0) continue
      nextCatMarkups[catId] = n
    }
    const res = await sendMessage({
      type: 'settings/update',
      patch: {
        sku_strategy: stratSel.value as SkuStrategy,
        sku_prefix: prefixInput.value.trim(),
        sku_seq_padding: Math.max(0, Math.min(8, Number(padInput.value))),
        markup_percent: Math.max(0, Number(markupInput.value)),
        category_markup_percents: nextCatMarkups,
      },
    })
    status.innerHTML = res.ok ? '<span class="ok">Αποθηκεύτηκε</span>' : `<span class="err">${(res as { error: string }).error}</span>`
    if (res.ok) refreshPreview()
  })
}

function labelForStrategy(s: SkuStrategy): string {
  return STRATEGY_OPTIONS.find((o) => o.value === s)?.label ?? s
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
