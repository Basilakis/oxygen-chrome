import { sendMessage } from '@/shared/messages'
import type { Settings } from '@/shared/types'

const MODELS: Array<{ id: string; label: string; note: string }> = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    note: 'Προεπιλογή — καλή ισορροπία ποιότητας/κόστους (~$3/$15 per MTok)',
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    note: 'Υψηλότερη ποιότητα σε σύνθετες ερωτήσεις (~$15/$75 per MTok)',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    note: 'Φθηνότερο και πιο γρήγορο (~$0.25/$1.25 per MTok)',
  },
]

export async function renderAi(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>Βοηθός AI &amp; Price Monitoring (BYOK)</h2>'

  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: Settings }).settings

  // Enable toggle
  const enable = document.createElement('div')
  enable.className = 'inline-check'
  const chkEnable = document.createElement('input')
  chkEnable.type = 'checkbox'
  chkEnable.checked = settings.agent_enabled
  chkEnable.id = 'agent-enabled'
  const lblEnable = document.createElement('label')
  lblEnable.htmlFor = 'agent-enabled'
  lblEnable.textContent = 'Ενεργοποίηση καρτέλας "Βοηθός" στο popup'
  enable.appendChild(chkEnable)
  enable.appendChild(lblEnable)
  root.appendChild(enable)

  // API key
  const keyLabel = document.createElement('label')
  keyLabel.className = 'field'
  keyLabel.innerHTML = '<span>Anthropic API key</span>'
  const keyInput = document.createElement('input')
  keyInput.type = 'password'
  keyInput.placeholder = settings.anthropic_api_key ? '••• αποθηκευμένο' : 'sk-ant-…'
  keyInput.autocomplete = 'off'
  keyLabel.appendChild(keyInput)
  const keyHint = document.createElement('div')
  keyHint.className = 'hint'
  keyHint.innerHTML =
    'Το κλειδί αποθηκεύεται τοπικά στον browser σου και στέλνεται μόνο στο <code>api.anthropic.com</code>. Πάρε το από <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>.'
  keyLabel.appendChild(keyHint)
  root.appendChild(keyLabel)

  // Model
  const modelLabel = document.createElement('label')
  modelLabel.className = 'field'
  modelLabel.innerHTML = '<span>Μοντέλο</span>'
  const modelSel = document.createElement('select')
  for (const m of MODELS) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.label
    if (settings.anthropic_model === m.id) opt.selected = true
    modelSel.appendChild(opt)
  }
  modelLabel.appendChild(modelSel)
  const modelNote = document.createElement('div')
  modelNote.className = 'hint'
  modelNote.textContent = MODELS.find((m) => m.id === settings.anthropic_model)?.note ?? ''
  modelSel.addEventListener('change', () => {
    modelNote.textContent = MODELS.find((m) => m.id === modelSel.value)?.note ?? ''
  })
  modelLabel.appendChild(modelNote)
  root.appendChild(modelLabel)

  // Actions
  const row = document.createElement('div')
  row.className = 'row'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'btn primary'
  saveBtn.textContent = 'Αποθήκευση'
  const testBtn = document.createElement('button')
  testBtn.className = 'btn'
  testBtn.textContent = 'Δοκιμή κλειδιού'
  const clearBtn = document.createElement('button')
  clearBtn.className = 'btn danger'
  clearBtn.textContent = 'Διαγραφή κλειδιού'
  row.appendChild(saveBtn)
  row.appendChild(testBtn)
  row.appendChild(clearBtn)
  root.appendChild(row)

  const status = document.createElement('div')
  status.className = 'hint'
  status.style.marginTop = '8px'
  root.appendChild(status)

  // How to use
  const howto = document.createElement('div')
  howto.className = 'hint'
  howto.style.marginTop = '16px'
  howto.innerHTML = `
    <strong>Πώς δουλεύει:</strong><br>
    Στο popup, άνοιξε την καρτέλα <em>Βοηθός</em>. Ο βοηθός στέλνεται στο Claude <strong>μόνο</strong> όταν η ερώτηση ξεκινά με <code>JARVIS tell me</code> ή <code>JARVIS πες μου</code>. Οτιδήποτε άλλο (ή τοπικές εντολές με <code>/</code>) δεν ξοδεύει tokens.
  `
  root.appendChild(howto)

  saveBtn.addEventListener('click', async () => {
    const patch: Partial<Settings> = {
      agent_enabled: chkEnable.checked,
      anthropic_model: modelSel.value,
    }
    if (keyInput.value) patch.anthropic_api_key = keyInput.value.trim()
    const res = await sendMessage({ type: 'settings/update', patch })
    if (res.ok) {
      status.innerHTML = '<span class="ok">Αποθηκεύτηκε.</span>'
      keyInput.value = ''
      // Reflect stored-key state in the placeholder without re-rendering.
      if (patch.anthropic_api_key) keyInput.placeholder = '••• αποθηκευμένο'
    } else {
      status.innerHTML = `<span class="err">${(res as { error: string }).error}</span>`
    }
  })

  testBtn.addEventListener('click', async () => {
    status.textContent = 'Δοκιμή…'
    // Save form values first so the test uses whatever the user just typed
    const patch: Partial<Settings> = { anthropic_model: modelSel.value }
    if (keyInput.value) patch.anthropic_api_key = keyInput.value.trim()
    await sendMessage({ type: 'settings/update', patch })
    keyInput.value = ''
    if (patch.anthropic_api_key) keyInput.placeholder = '••• αποθηκευμένο'
    const res = await sendMessage({ type: 'agent/test-connection' })
    if (res.ok) {
      const msg = (res as unknown as { message?: string }).message ?? 'OK'
      status.innerHTML = `<span class="ok">✓ Το κλειδί λειτουργεί (απάντηση: <code>${escapeHtml(msg)}</code>).</span>`
    } else {
      status.innerHTML = `<span class="err">✗ ${(res as { error: string }).error}</span>`
    }
  })

  clearBtn.addEventListener('click', async () => {
    if (!confirm('Διαγραφή του Anthropic API key;')) return
    await sendMessage({ type: 'settings/update', patch: { anthropic_api_key: undefined } })
    status.innerHTML = '<span class="ok">Το κλειδί διαγράφηκε.</span>'
    keyInput.placeholder = 'sk-ant-…'
  })

  // ---- Materials Hub / MIVAA Price Monitoring --------------------------
  const divider = document.createElement('div')
  divider.style.margin = '22px 0 12px'
  divider.style.borderTop = '1px solid var(--border)'
  root.appendChild(divider)

  const mhHeading = document.createElement('h3')
  mhHeading.textContent = 'Materials Hub Price Monitoring'
  mhHeading.style.margin = '0 0 6px'
  mhHeading.style.fontSize = '15px'
  root.appendChild(mhHeading)

  const mhIntro = document.createElement('div')
  mhIntro.className = 'hint'
  mhIntro.style.marginBottom = '10px'
  mhIntro.innerHTML =
    'Συνδέει το add-on με την υπηρεσία <code>v1api.materialshub.gr</code> για παρακολούθηση τιμών αγοράς ανά προϊόν. Δημιούργησε το κλειδί από Material KAI → Profile → Subscription → Generate Key.'
  root.appendChild(mhIntro)

  const mhKeyLabel = document.createElement('label')
  mhKeyLabel.className = 'field'
  mhKeyLabel.innerHTML = '<span>Materials Hub API key</span>'
  const mhKeyInput = document.createElement('input')
  mhKeyInput.type = 'password'
  mhKeyInput.placeholder = settings.materials_hub_api_key ? '••• αποθηκευμένο' : 'kai_…'
  mhKeyInput.autocomplete = 'off'
  mhKeyLabel.appendChild(mhKeyInput)
  root.appendChild(mhKeyLabel)

  const mhCountryLabel = document.createElement('label')
  mhCountryLabel.className = 'field'
  mhCountryLabel.innerHTML = '<span>Χώρα (ISO-2)</span>'
  const mhCountryInput = document.createElement('input')
  mhCountryInput.type = 'text'
  mhCountryInput.maxLength = 2
  mhCountryInput.placeholder = 'GR'
  mhCountryInput.value = settings.materials_hub_country_code ?? 'GR'
  mhCountryInput.style.maxWidth = '90px'
  mhCountryInput.style.textTransform = 'uppercase'
  mhCountryLabel.appendChild(mhCountryInput)
  const mhCountryHint = document.createElement('div')
  mhCountryHint.className = 'hint'
  mhCountryHint.textContent = 'Προεπιλεγμένη αγορά για τις αναζητήσεις τιμών (π.χ. GR, BG, CY).'
  mhCountryLabel.appendChild(mhCountryHint)
  root.appendChild(mhCountryLabel)

  // v3 verification toggle. Default on (accurate prices). Flipping OFF
  // trades accuracy for ~3× lower cost / ~30s faster first response.
  const mhVerifyWrap = document.createElement('div')
  mhVerifyWrap.className = 'inline-check'
  const mhVerifyChk = document.createElement('input')
  mhVerifyChk.type = 'checkbox'
  mhVerifyChk.id = 'mh-verify-prices'
  mhVerifyChk.checked = settings.materials_hub_verify_prices !== false
  const mhVerifyLbl = document.createElement('label')
  mhVerifyLbl.htmlFor = 'mh-verify-prices'
  mhVerifyLbl.textContent =
    'Επαλήθευση τιμών με Firecrawl (συνιστώμενο)'
  mhVerifyWrap.appendChild(mhVerifyChk)
  mhVerifyWrap.appendChild(mhVerifyLbl)
  root.appendChild(mhVerifyWrap)
  const mhVerifyHint = document.createElement('div')
  mhVerifyHint.className = 'hint'
  mhVerifyHint.textContent =
    'Όταν ενεργό, κάθε τιμή επιβεβαιώνεται από τη σελίδα του εμπόρου — ακριβέστερα αποτελέσματα αλλά ~3× πιο ακριβό και ~30 δευτ. πιο αργό.'
  root.appendChild(mhVerifyHint)

  // ---- v5 alert defaults — applied to every new track ----
  const alertWrap = document.createElement('div')
  alertWrap.style.marginTop = '14px'
  alertWrap.style.padding = '10px 12px'
  alertWrap.style.background = 'var(--bg-page)'
  alertWrap.style.border = '1px solid var(--border)'
  alertWrap.style.borderRadius = '6px'
  const alertHeader = document.createElement('div')
  alertHeader.textContent = 'Ειδοποιήσεις τιμών (προεπιλογές για νέα προϊόντα)'
  alertHeader.style.fontWeight = '600'
  alertHeader.style.marginBottom = '6px'
  alertHeader.style.fontSize = '13px'
  alertWrap.appendChild(alertHeader)
  const alertHint = document.createElement('div')
  alertHint.className = 'hint'
  alertHint.style.marginBottom = '10px'
  alertHint.textContent =
    'Οι παρακάτω επιλογές εφαρμόζονται αυτόματα κάθε φορά που ξεκινάς νέα παρακολούθηση τιμών. Δεν επηρεάζουν υπάρχοντα τραβηγμένα προϊόντα.'
  alertWrap.appendChild(alertHint)

  const mkAlertCheck = (
    id: string,
    label: string,
    checked: boolean,
  ): { wrap: HTMLDivElement; chk: HTMLInputElement } => {
    const w = document.createElement('div')
    w.className = 'inline-check'
    const c = document.createElement('input')
    c.type = 'checkbox'
    c.id = id
    c.checked = checked
    const l = document.createElement('label')
    l.htmlFor = id
    l.textContent = label
    w.appendChild(c)
    w.appendChild(l)
    return { wrap: w, chk: c }
  }

  const ch1 = mkAlertCheck(
    'mh-alert-bell',
    'In-app (bell) — δωρεάν, στο Material KAI',
    settings.materials_hub_alert_bell ?? true,
  )
  const ch2 = mkAlertCheck(
    'mh-alert-email',
    'Email — 1 credit ανά αποστολή, στο email του λογαριασμού',
    settings.materials_hub_alert_email ?? false,
  )
  const ch3 = mkAlertCheck(
    'mh-alert-webhook',
    'Webhook — δωρεάν, στο URL που ορίζεις παρακάτω',
    settings.materials_hub_alert_webhook ?? false,
  )
  alertWrap.appendChild(ch1.wrap)
  alertWrap.appendChild(ch2.wrap)
  alertWrap.appendChild(ch3.wrap)

  const webhookField = document.createElement('label')
  webhookField.className = 'field'
  webhookField.style.marginTop = '6px'
  webhookField.innerHTML = '<span>Webhook URL</span>'
  const webhookInput = document.createElement('input')
  webhookInput.type = 'url'
  webhookInput.placeholder = 'https://your.api/webhooks/price-alerts'
  webhookInput.value = settings.materials_hub_alert_webhook_url ?? ''
  webhookField.appendChild(webhookInput)
  alertWrap.appendChild(webhookField)

  const trigHeader = document.createElement('div')
  trigHeader.textContent = 'Πότε να ειδοποιεί:'
  trigHeader.style.fontWeight = '500'
  trigHeader.style.marginTop = '10px'
  trigHeader.style.marginBottom = '4px'
  trigHeader.style.fontSize = '12.5px'
  alertWrap.appendChild(trigHeader)
  const trig1 = mkAlertCheck(
    'mh-alert-drop',
    'Πτώση τιμής σε ανταγωνιστή',
    settings.materials_hub_alert_on_price_drop ?? true,
  )
  const trig2 = mkAlertCheck(
    'mh-alert-new-retailer',
    'Νέος ανταγωνιστής βρέθηκε',
    settings.materials_hub_alert_on_new_retailer ?? true,
  )
  const trig3 = mkAlertCheck(
    'mh-alert-promo',
    'Έναρξη προσφοράς (strikethrough price)',
    settings.materials_hub_alert_on_promo ?? true,
  )
  alertWrap.appendChild(trig1.wrap)
  alertWrap.appendChild(trig2.wrap)
  alertWrap.appendChild(trig3.wrap)

  root.appendChild(alertWrap)

  const mhRow = document.createElement('div')
  mhRow.className = 'row'
  const mhSaveBtn = document.createElement('button')
  mhSaveBtn.className = 'btn primary'
  mhSaveBtn.textContent = 'Αποθήκευση'
  const mhTestBtn = document.createElement('button')
  mhTestBtn.className = 'btn'
  mhTestBtn.textContent = 'Δοκιμή κλειδιού'
  const mhClearBtn = document.createElement('button')
  mhClearBtn.className = 'btn danger'
  mhClearBtn.textContent = 'Διαγραφή κλειδιού'
  mhRow.appendChild(mhSaveBtn)
  mhRow.appendChild(mhTestBtn)
  mhRow.appendChild(mhClearBtn)
  root.appendChild(mhRow)

  const mhStatus = document.createElement('div')
  mhStatus.className = 'hint'
  mhStatus.style.marginTop = '8px'
  root.appendChild(mhStatus)

  mhSaveBtn.addEventListener('click', async () => {
    const patch: Partial<Settings> = {}
    if (mhKeyInput.value) patch.materials_hub_api_key = mhKeyInput.value.trim()
    const country = mhCountryInput.value.trim().toUpperCase()
    if (country) patch.materials_hub_country_code = country
    patch.materials_hub_verify_prices = mhVerifyChk.checked
    patch.materials_hub_alert_bell = ch1.chk.checked
    patch.materials_hub_alert_email = ch2.chk.checked
    patch.materials_hub_alert_webhook = ch3.chk.checked
    const url = webhookInput.value.trim()
    patch.materials_hub_alert_webhook_url = url || undefined
    patch.materials_hub_alert_on_price_drop = trig1.chk.checked
    patch.materials_hub_alert_on_new_retailer = trig2.chk.checked
    patch.materials_hub_alert_on_promo = trig3.chk.checked
    const res = await sendMessage({ type: 'settings/update', patch })
    if (res.ok) {
      mhStatus.innerHTML = '<span class="ok">Αποθηκεύτηκε.</span>'
      mhKeyInput.value = ''
      if (patch.materials_hub_api_key) mhKeyInput.placeholder = '••• αποθηκευμένο'
    } else {
      mhStatus.innerHTML = `<span class="err">${(res as { error: string }).error}</span>`
    }
  })

  mhTestBtn.addEventListener('click', async () => {
    mhStatus.textContent = 'Δοκιμή…'
    // Persist whatever the user just typed before testing so the backend
    // reads the fresh key, not the previously-saved one.
    const patch: Partial<Settings> = {}
    if (mhKeyInput.value) patch.materials_hub_api_key = mhKeyInput.value.trim()
    if (Object.keys(patch).length) await sendMessage({ type: 'settings/update', patch })
    mhKeyInput.value = ''
    if (patch.materials_hub_api_key) mhKeyInput.placeholder = '••• αποθηκευμένο'
    const res = await sendMessage({ type: 'prices/test-connection' })
    if (res.ok) {
      const msg = (res as unknown as { message?: string }).message ?? 'OK'
      mhStatus.innerHTML = `<span class="ok">✓ ${escapeHtml(msg)}</span>`
    } else {
      mhStatus.innerHTML = `<span class="err">✗ ${escapeHtml((res as { error: string }).error)}</span>`
    }
  })

  mhClearBtn.addEventListener('click', async () => {
    if (!confirm('Διαγραφή του Materials Hub API key;')) return
    await sendMessage({
      type: 'settings/update',
      patch: { materials_hub_api_key: undefined },
    })
    mhStatus.innerHTML = '<span class="ok">Το κλειδί διαγράφηκε.</span>'
    mhKeyInput.placeholder = 'kai_…'
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
