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
  root.innerHTML = '<h2>Βοηθός AI (BYOK)</h2>'

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
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
