import { sendMessage } from '@/shared/messages'
import type { ScrapedInvoice } from '@/shared/messages'
import type { Product, Settings } from '@/shared/types'
import { formatMoney, asArray, sumStock } from '@/shared/util'
import * as PrefillModal from '@/content/overlays/prefill-modal'

/**
 * Βοηθός tab — chat UI with three affordances in the header:
 *   ℹ Βοήθεια   — toggles the intro/help panel (collapsed by default)
 *   📜 Ιστορικό — list of past sessions (persisted in chrome.storage.local)
 *   🗑 Καθαρισμός — archive current session and start a fresh one
 *
 * AI mode is gated behind "JARVIS tell me" / "JARVIS πες μου" prefix — without
 * that, typing costs zero Claude tokens. Local slash-commands (/search,
 * /product, /stock, /drafts, /stats, /help) run against the local cache.
 */

type Role = 'user' | 'assistant' | 'system'
interface Turn {
  role: Role
  text: string
  tool_calls?: Array<{ name: string; input: Record<string, unknown> }>
  usage?: { input_tokens: number; output_tokens: number; cache_read_tokens: number }
}

interface AgentSession {
  id: string
  title: string
  created_at: number
  updated_at: number
  turns: Turn[]
  anthropic_history: Array<{ role: 'user' | 'assistant'; content: unknown }>
}

const JARVIS_REGEX = /^\s*JARVIS\b/i
const AI_TRIGGERS = [
  /^\s*JARVIS\s+tell\s+me\b/i,
  /^\s*JARVIS\s+πες\s+μου\b/i,
  /^\s*JARVIS\s+πες\s+μας\b/i,
  /^\s*JARVIS\s+εξήγησέ\s+μου\b/i,
  /^\s*JARVIS\s+βρες\b/i,
]

// Current session state, kept in module-scope so tab re-renders preserve it
let conversation: Turn[] = []
let anthropicHistory: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
let currentSessionId: string | null = null
let pendingAttachment: { fileName: string; mimeType: string; dataBase64: string } | null = null

const ACCEPTED_ATTACHMENT_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]
const MAX_ATTACHMENT_MB = 10

export async function renderAgentTab(root: HTMLElement): Promise<void> {
  root.innerHTML = ''

  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: Settings }).settings

  if (!settings.agent_enabled) {
    root.appendChild(createInfo('Ο βοηθός είναι απενεργοποιημένος. Ενεργοποίησέ τον στις Ρυθμίσεις → Βοηθός AI.'))
    return
  }

  const hasKey = !!settings.anthropic_api_key

  // ---- Header row with icon actions ----
  const header = document.createElement('div')
  header.className = 'agent-header'
  const title = document.createElement('span')
  title.className = 'agent-title'
  title.textContent = 'Βοηθός (JARVIS)'
  header.appendChild(title)

  const actions = document.createElement('div')
  actions.className = 'agent-actions'
  const infoBtn = makeIconBtn('ℹ', 'Βοήθεια')
  const historyBtn = makeIconBtn('📜', 'Ιστορικό συνομιλιών')
  const clearBtn = makeIconBtn('🗑', 'Νέα συνομιλία')
  actions.appendChild(infoBtn)
  actions.appendChild(historyBtn)
  actions.appendChild(clearBtn)
  header.appendChild(actions)
  root.appendChild(header)

  // ---- Collapsible help panel ----
  const helpPanel = document.createElement('div')
  helpPanel.className = 'agent-help'
  helpPanel.style.display = 'none'
  helpPanel.innerHTML = `
    <div class="agent-help-body">
      • Γράψε <code>JARVIS tell me …</code> (ή <code>JARVIS πες μου …</code>) για ερώτηση με AI.<br>
      • Οτιδήποτε δεν ξεκινά με <code>JARVIS</code> δεν στέλνεται στο Claude — εξοικονομούμε tokens.<br>
      • Τοπικές εντολές: <code>/search</code>, <code>/product</code>, <code>/stock</code>, <code>/drafts</code>, <code>/stats</code>, <code>/help</code>.
      ${hasKey ? '' : '<br><span class="err">⚠ Δεν έχει οριστεί Anthropic API key. Οι εντολές JARVIS θα αποτύχουν μέχρι να το προσθέσεις στις Ρυθμίσεις.</span>'}
    </div>
  `
  root.appendChild(helpPanel)

  // ---- Collapsible history panel ----
  const historyPanel = document.createElement('div')
  historyPanel.className = 'agent-history'
  historyPanel.style.display = 'none'
  root.appendChild(historyPanel)

  // ---- Log + input ----
  const log = document.createElement('div')
  log.className = 'agent-log'
  root.appendChild(log)

  // Attachment preview chip (shown above the input when a file is staged)
  const attachPreview = document.createElement('div')
  attachPreview.className = 'agent-attach-preview'
  attachPreview.style.display = 'none'
  root.appendChild(attachPreview)

  const inputWrap = document.createElement('div')
  inputWrap.className = 'agent-input-wrap'

  // Paperclip button + hidden file input
  const attachBtn = document.createElement('button')
  attachBtn.type = 'button'
  attachBtn.className = 'agent-icon-btn agent-attach-btn'
  attachBtn.title = 'Επισύναψη τιμολογίου (PDF ή εικόνα)'
  attachBtn.textContent = '📎'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = ACCEPTED_ATTACHMENT_MIME.join(',')
  fileInput.hidden = true
  attachBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]
    if (!f) return
    await setAttachment(f, attachPreview)
    fileInput.value = ''
  })
  inputWrap.appendChild(attachBtn)
  inputWrap.appendChild(fileInput)

  const input = document.createElement('textarea')
  input.className = 'agent-input'
  input.rows = 2
  input.placeholder = 'JARVIS tell me how many products I have…'
  inputWrap.appendChild(input)
  const sendBtn = document.createElement('button')
  sendBtn.className = 'btn primary agent-send'
  sendBtn.textContent = 'Αποστολή'
  inputWrap.appendChild(sendBtn)
  root.appendChild(inputWrap)

  renderLog(log)

  // ---- Wire header icons ----
  infoBtn.addEventListener('click', () => {
    const shown = helpPanel.style.display !== 'none'
    helpPanel.style.display = shown ? 'none' : 'block'
    historyPanel.style.display = 'none'
  })

  historyBtn.addEventListener('click', async () => {
    const shown = historyPanel.style.display !== 'none'
    if (shown) {
      historyPanel.style.display = 'none'
      return
    }
    helpPanel.style.display = 'none'
    await renderHistoryPanel(historyPanel, log)
  })

  clearBtn.addEventListener('click', () => {
    if (conversation.length && !confirm('Αρχειοθέτηση τρέχουσας συνομιλίας και έναρξη νέας;')) return
    conversation = []
    anthropicHistory = []
    currentSessionId = null
    renderLog(log)
  })

  // ---- Submit ----
  const submit = async () => {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    await handleSubmit(text, log)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  })
  sendBtn.addEventListener('click', submit)
  input.focus()
}

async function handleSubmit(text: string, log: HTMLElement): Promise<void> {
  const hasAttachment = !!pendingAttachment
  const displayText = hasAttachment
    ? `${text || '(αρχείο)'}  📎 ${pendingAttachment!.fileName}`
    : text
  conversation.push({ role: 'user', text: displayText })
  renderLog(log)

  // Local slash-commands — no API call, no tokens. Ignore any attached file.
  if (text.startsWith('/') && !hasAttachment) {
    const response = await runLocalCommand(text)
    conversation.push({ role: 'assistant', text: response })
    renderLog(log)
    await persistCurrentSession()
    return
  }

  // Prefix gate — bypassed when a file is attached (attaching signals clear
  // intent to talk to the AI; we shouldn't make the user type "JARVIS tell
  // me" on top of dragging a PDF).
  if (!hasAttachment && !AI_TRIGGERS.some((rx) => rx.test(text))) {
    if (JARVIS_REGEX.test(text)) {
      conversation.push({
        role: 'system',
        text: 'Η λέξη "JARVIS" αναγνωρίστηκε αλλά λείπει η εντολή "tell me" ή "πες μου". Δοκίμασε: `JARVIS tell me how many products I have`.',
      })
    } else {
      conversation.push({
        role: 'system',
        text:
          'Δεν έστειλα τίποτα στο Claude (κανένα token). Ξεκίνα με `JARVIS tell me …` για AI ή `/help` για τοπικές εντολές, ή επισύναψε ένα αρχείο με 📎.',
      })
    }
    renderLog(log)
    return
  }

  const attachments = pendingAttachment ? [pendingAttachment] : undefined
  // Clear the staged attachment — it's now in flight
  const usedAttachment = pendingAttachment
  pendingAttachment = null
  const attachPreview = document.querySelector<HTMLElement>('.agent-attach-preview')
  if (attachPreview) {
    attachPreview.style.display = 'none'
    attachPreview.innerHTML = ''
  }

  conversation.push({
    role: 'system',
    text: usedAttachment
      ? `🤔 Ο Claude διαβάζει το ${usedAttachment.fileName}…`
      : '🤔 Ρωτάω το Claude…',
  })
  renderLog(log)

  const res = await sendMessage({
    type: 'agent/ask',
    text: text || 'Process the attached invoice — extract supplier + lines and open the creation form.',
    history: anthropicHistory,
    attachments,
  })
  conversation.pop()

  if (!res.ok) {
    conversation.push({ role: 'system', text: `Αποτυχία: ${(res as { error: string }).error}` })
    renderLog(log)
    return
  }

  const payload = (res as unknown as {
    agent: {
      assistant_text: string
      tool_calls: Array<{ name: string; input: Record<string, unknown>; result: unknown }>
      usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number }
      history: unknown[]
      pending_actions?: Array<{ type: string; invoice?: ScrapedInvoice; supplier_name?: string }>
    }
  }).agent

  anthropicHistory = payload.history as typeof anthropicHistory

  conversation.push({
    role: 'assistant',
    text: payload.assistant_text,
    tool_calls: payload.tool_calls.map((t) => ({ name: t.name, input: t.input })),
    usage: payload.usage,
  })
  renderLog(log)
  await persistCurrentSession()

  // Consume pending UI actions — currently only "open the prefill form".
  // Can't run in the SW (PrefillModal is a DOM overlay), so the popup does it.
  for (const action of payload.pending_actions ?? []) {
    if (action.type === 'open_prefill_form' && action.invoice) {
      const invoice = action.invoice
      // If extractor missed ΑΦΜ, prompt like the AADE flow does.
      if (!invoice.supplier_vat) {
        const vat = prompt(
          'Δε βρέθηκε ΑΦΜ προμηθευτή στο τιμολόγιο. Πληκτρολόγησε το ΑΦΜ:',
        )
        if (!vat) continue
        invoice.supplier_vat = vat.replace(/\s+/g, '')
      }
      try {
        await PrefillModal.open(invoice)
      } catch (err) {
        console.error('[oxygen-helper] failed to open prefill modal from agent', err)
        conversation.push({
          role: 'system',
          text: `Σφάλμα ανοίγματος φόρμας: ${(err as Error)?.message ?? err}`,
        })
        renderLog(log)
      }
    }
  }
}

/* ------------------------------------------------ session persistence -- */

async function persistCurrentSession(): Promise<void> {
  if (!conversation.length) return
  const firstUser = conversation.find((t) => t.role === 'user')?.text ?? 'Νέα συνομιλία'
  const title = firstUser.length > 60 ? `${firstUser.slice(0, 57)}…` : firstUser
  const now = Date.now()
  const id = currentSessionId ?? `sess_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
  currentSessionId = id
  const session: AgentSession = {
    id,
    title,
    created_at: now,
    updated_at: now,
    turns: conversation,
    anthropic_history: anthropicHistory,
  }
  await sendMessage({ type: 'agent/sessions/save', session })
}

async function renderHistoryPanel(panel: HTMLElement, log: HTMLElement): Promise<void> {
  panel.innerHTML = '<div class="agent-empty">Φόρτωση ιστορικού…</div>'
  panel.style.display = 'block'
  const res = await sendMessage({ type: 'agent/sessions/list' })
  if (!res.ok) {
    panel.innerHTML = `<div class="err">Σφάλμα: ${(res as { error: string }).error}</div>`
    return
  }
  const sessions = (res as unknown as { sessions: AgentSession[] }).sessions ?? []
  panel.innerHTML = ''

  if (!sessions.length) {
    panel.appendChild(createInfo('Δεν υπάρχουν αποθηκευμένες συνομιλίες.'))
    return
  }

  const head = document.createElement('div')
  head.className = 'agent-history-head'
  head.textContent = `${sessions.length} αποθηκευμένες συνομιλίες`
  panel.appendChild(head)

  const list = document.createElement('div')
  list.className = 'agent-history-list'
  panel.appendChild(list)

  for (const s of sessions) {
    const row = document.createElement('div')
    row.className = 'agent-history-item' + (s.id === currentSessionId ? ' current' : '')

    const main = document.createElement('div')
    main.className = 'agent-history-main'
    const title = document.createElement('div')
    title.className = 'agent-history-title'
    title.textContent = s.title
    const sub = document.createElement('div')
    sub.className = 'agent-history-sub'
    sub.textContent = `${s.turns.length} μηνύματα · ${new Date(s.updated_at).toLocaleString('el-GR')}`
    main.appendChild(title)
    main.appendChild(sub)

    main.addEventListener('click', () => {
      conversation = s.turns
      anthropicHistory = s.anthropic_history
      currentSessionId = s.id
      panel.style.display = 'none'
      renderLog(log)
    })

    const del = document.createElement('button')
    del.className = 'agent-history-delete'
    del.textContent = '×'
    del.title = 'Διαγραφή'
    del.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm('Διαγραφή αυτής της συνομιλίας;')) return
      await sendMessage({ type: 'agent/sessions/delete', id: s.id })
      if (s.id === currentSessionId) currentSessionId = null
      await renderHistoryPanel(panel, log)
    })

    row.appendChild(main)
    row.appendChild(del)
    list.appendChild(row)
  }

  const clearAll = document.createElement('button')
  clearAll.className = 'btn danger agent-history-clear-all'
  clearAll.textContent = 'Διαγραφή όλων'
  clearAll.addEventListener('click', async () => {
    if (!confirm('Διαγραφή όλων των αποθηκευμένων συνομιλιών;')) return
    await sendMessage({ type: 'agent/sessions/clear' })
    currentSessionId = null
    await renderHistoryPanel(panel, log)
  })
  panel.appendChild(clearAll)
}

/* ------------------------------------------------------------ render -- */

function renderLog(root: HTMLElement): void {
  root.innerHTML = ''
  if (!conversation.length) {
    root.appendChild(createInfo('Ο Βοηθός είναι έτοιμος. Γράψε την ερώτησή σου παρακάτω.'))
    return
  }
  for (const turn of conversation) root.appendChild(renderTurn(turn))
  root.scrollTop = root.scrollHeight
}

function renderTurn(turn: Turn): HTMLElement {
  const bubble = document.createElement('div')
  bubble.className = `agent-bubble role-${turn.role}`
  if (turn.tool_calls && turn.tool_calls.length) {
    const toolBox = document.createElement('div')
    toolBox.className = 'agent-tool-calls'
    for (const tc of turn.tool_calls) {
      const row = document.createElement('div')
      row.className = 'agent-tool-call'
      row.textContent = `🔧 ${tc.name}(${formatArgs(tc.input)})`
      toolBox.appendChild(row)
    }
    bubble.appendChild(toolBox)
  }
  const content = document.createElement('div')
  content.className = 'agent-content'
  content.textContent = turn.text
  bubble.appendChild(content)
  if (turn.usage) {
    const meta = document.createElement('div')
    meta.className = 'agent-usage'
    const cached = turn.usage.cache_read_tokens ? ` · cached ${turn.usage.cache_read_tokens}` : ''
    meta.textContent = `${turn.usage.input_tokens} in · ${turn.usage.output_tokens} out${cached}`
    bubble.appendChild(meta)
  }
  return bubble
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 40)}`)
    .join(', ')
}

function createInfo(text: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'agent-empty'
  div.textContent = text
  return div
}

function makeIconBtn(icon: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = 'agent-icon-btn'
  btn.type = 'button'
  btn.title = title
  btn.textContent = icon
  return btn
}

async function setAttachment(file: File, previewEl: HTMLElement): Promise<void> {
  if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
    previewEl.style.display = 'block'
    previewEl.innerHTML = `<span class="err">Το αρχείο είναι μεγαλύτερο από ${MAX_ATTACHMENT_MB}MB.</span>`
    return
  }
  if (!ACCEPTED_ATTACHMENT_MIME.includes(file.type)) {
    previewEl.style.display = 'block'
    previewEl.innerHTML = `<span class="err">Μη αποδεκτός τύπος: ${file.type}</span>`
    return
  }
  const dataBase64 = await fileToBase64(file)
  pendingAttachment = { fileName: file.name, mimeType: file.type, dataBase64 }

  previewEl.style.display = 'flex'
  previewEl.innerHTML = `
    <span class="agent-attach-icon">${file.type === 'application/pdf' ? '📄' : '🖼️'}</span>
    <span class="agent-attach-name">${escapeHtml(file.name)}</span>
    <span class="agent-attach-size">${(file.size / 1024).toFixed(0)} KB</span>
    <button class="agent-attach-remove" title="Αφαίρεση">×</button>
  `
  previewEl.querySelector('.agent-attach-remove')?.addEventListener('click', () => {
    pendingAttachment = null
    previewEl.style.display = 'none'
    previewEl.innerHTML = ''
  })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/* ---------------------------------------------------- local commands -- */

async function runLocalCommand(line: string): Promise<string> {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(' ')
  switch (cmd) {
    case '/help':
      return [
        'Τοπικές εντολές (δεν ξοδεύουν tokens):',
        '  /search <query>     — αναζήτηση στον τοπικό κατάλογο',
        '  /product <code>     — λεπτομέρειες προϊόντος',
        '  /stock <code>       — αποθέματα ανά αποθήκη',
        '  /drafts             — λίστα ειδοποιήσεων',
        '  /stats              — συνολικά μεγέθη καταλόγου',
        '',
        'Για AI χρήση:',
        '  JARVIS tell me ...  — ερώτηση στο Claude (BYOK)',
      ].join('\n')
    case '/search': {
      if (!arg) return 'Χρήση: /search <όρος>'
      const res = await sendMessage({ type: 'search/catalog', query: arg, limit: 10 })
      if (!res.ok) return `Σφάλμα: ${(res as { error: string }).error}`
      const r = (res as { results: { exact: { product: Product }[]; fuzzy: { product: Product }[] } }).results
      const all = [...r.exact.map((h) => h.product), ...r.fuzzy.map((h) => h.product)]
      if (!all.length) return 'Κανένα αποτέλεσμα.'
      return all
        .slice(0, 10)
        .map((p) => `• ${p.code}  ${p.name}  — ${formatMoney(p.sale_net_amount ?? 0)}`)
        .join('\n')
    }
    case '/product': {
      if (!arg) return 'Χρήση: /product <κωδικός>'
      const res = await sendMessage({ type: 'search/catalog', query: arg, limit: 1 })
      if (!res.ok) return `Σφάλμα: ${(res as { error: string }).error}`
      const p = (res as { results: { exact: { product: Product }[]; fuzzy: { product: Product }[] } }).results
      const found = p.exact[0]?.product ?? p.fuzzy[0]?.product
      if (!found) return 'Δε βρέθηκε.'
      return [
        `Κωδικός: ${found.code}`,
        `Όνομα: ${found.name}`,
        `Κατηγορία: ${found.category_name ?? '—'}`,
        `Τιμή αγοράς: ${formatMoney(found.purchase_net_amount ?? 0)}`,
        `Τιμή πώλησης: ${formatMoney(found.sale_net_amount ?? 0)}`,
        `ΦΠΑ πώλησης: ${found.sale_vat_ratio ?? '—'}%`,
        `Μονάδα: ${found.metric ?? '—'}`,
        `Συνολικό απόθεμα: ${sumStock(found.warehouses)}`,
      ].join('\n')
    }
    case '/stock': {
      if (!arg) return 'Χρήση: /stock <κωδικός>'
      const res = await sendMessage({ type: 'search/catalog', query: arg, limit: 1 })
      if (!res.ok) return `Σφάλμα: ${(res as { error: string }).error}`
      const p = (res as { results: { exact: { product: Product }[]; fuzzy: { product: Product }[] } }).results
      const found = p.exact[0]?.product ?? p.fuzzy[0]?.product
      if (!found) return 'Δε βρέθηκε.'
      const ws = asArray<{ id?: string; name?: string; quantity?: number }>(found.warehouses)
      if (!ws.length) return `${found.name}: δεν υπάρχει απόθεμα σε καμία αποθήκη.`
      const total = ws.reduce((s, w) => s + (w.quantity ?? 0), 0)
      return [
        `${found.name} (${found.code})`,
        ...ws.map((w) => `  ${w.name ?? w.id}: ${w.quantity}`),
        `  —— ΣΥΝΟΛΟ: ${total}`,
      ].join('\n')
    }
    case '/drafts': {
      const res = await sendMessage({ type: 'drafts/list' })
      if (!res.ok) return `Σφάλμα: ${(res as { error: string }).error}`
      const drafts = (res as { drafts: Array<{ id: string; status: string; lines: unknown[]; updated_at: number }> }).drafts
      if (!drafts.length) return 'Δεν υπάρχουν ειδοποιήσεις.'
      return drafts
        .map((d) => `• ${d.id.slice(0, 10)} [${d.status}] ${d.lines.length} γραμμές · ${new Date(d.updated_at).toLocaleDateString('el-GR')}`)
        .join('\n')
    }
    case '/stats': {
      const res = await sendMessage({ type: 'sync/status' })
      if (!res.ok) return `Σφάλμα: ${(res as { error: string }).error}`
      const counts = (res as { status: { counts: Record<string, number> } }).status.counts
      return Object.entries(counts)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
    }
    default:
      return `Άγνωστη εντολή: ${cmd}. Γράψε /help για λίστα.`
  }
}
