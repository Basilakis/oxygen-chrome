import { sendMessage } from '@/shared/messages'
import type { Settings, SkuStrategy } from '@/shared/types'

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

  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: Settings }).settings

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

  // ---- Markup ----
  const markupWrap = document.createElement('label')
  markupWrap.className = 'field'
  markupWrap.innerHTML = '<span>Markup πώλησης (%)</span>'
  const markupInput = document.createElement('input')
  markupInput.type = 'number'
  markupInput.min = '0'
  markupInput.step = '0.1'
  markupInput.value = String(settings.markup_percent)
  markupWrap.appendChild(markupInput)
  root.appendChild(markupWrap)

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
    const res = await sendMessage({
      type: 'settings/update',
      patch: {
        sku_strategy: stratSel.value as SkuStrategy,
        sku_prefix: prefixInput.value.trim(),
        sku_seq_padding: Math.max(0, Math.min(8, Number(padInput.value))),
        markup_percent: Math.max(0, Number(markupInput.value)),
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
