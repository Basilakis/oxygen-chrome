import { sendMessage } from '@/shared/messages'
import type { AuthStatus } from '@/shared/messages'
import { getRuntimeConfig } from '@/core/config'

export async function renderAuth(root: HTMLElement, refresh?: () => void): Promise<void> {
  root.innerHTML = '<h2>Πιστοποίηση</h2>'

  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: { base_url: string; mode: 'sandbox' | 'production'; token?: string } }).settings

  const authRes = await sendMessage({ type: 'auth/get-status' })
  const auth = (authRes as { ok: true; auth: AuthStatus }).auth

  // Web deployment with OXYGEN_API_TOKEN set as Vercel env var — the proxy
  // injects the token server-side on every request, so the user doesn't need
  // to paste one. Show a banner and skip the token input entirely; keep the
  // connection-test button so the user can still verify end-to-end.
  const runtime = getRuntimeConfig()
  if (runtime.serverAuth) {
    const banner = document.createElement('div')
    banner.className = 'hint'
    banner.style.padding = '10px 12px'
    banner.style.marginBottom = '10px'
    banner.style.background = 'rgba(60, 180, 120, 0.12)'
    banner.style.border = '1px solid rgba(60, 180, 120, 0.35)'
    banner.style.borderRadius = '6px'
    banner.innerHTML =
      '<strong>✓ Το Oxygen token διαχειρίζεται ο server.</strong><br>' +
      'Δεν χρειάζεται να εισάγεις δικό σου token — όλες οι κλήσεις περνούν από το <code>/api/oxygen</code> proxy που κάνει inject το <code>OXYGEN_API_TOKEN</code> env var.'
    root.appendChild(banner)

    const testRow = document.createElement('div')
    testRow.className = 'row'
    const testOnlyBtn = document.createElement('button')
    testOnlyBtn.className = 'btn'
    testOnlyBtn.textContent = 'Δοκιμή σύνδεσης'
    testRow.appendChild(testOnlyBtn)
    root.appendChild(testRow)

    const statusLine = document.createElement('div')
    statusLine.className = 'hint'
    statusLine.style.marginTop = '8px'
    root.appendChild(statusLine)

    testOnlyBtn.addEventListener('click', async () => {
      statusLine.textContent = 'Δοκιμή…'
      const res = await sendMessage({ type: 'auth/test-connection' })
      if (res.ok) {
        statusLine.innerHTML = '<span class="ok">✓ Η σύνδεση λειτουργεί.</span>'
        refresh?.()
      } else {
        statusLine.innerHTML = `<span class="err">✗ ${(res as { error: string }).error}</span>`
      }
    })
    return
  }

  const urlLabel = document.createElement('label')
  urlLabel.className = 'field'
  urlLabel.innerHTML = '<span>Base URL</span>'
  const urlInput = document.createElement('input')
  urlInput.type = 'url'
  urlInput.value = settings.base_url
  urlLabel.appendChild(urlInput)
  root.appendChild(urlLabel)

  const modeLabel = document.createElement('label')
  modeLabel.className = 'field'
  modeLabel.innerHTML = '<span>Λειτουργία</span>'
  const modeSel = document.createElement('select')
  for (const m of ['sandbox', 'production']) {
    const o = document.createElement('option')
    o.value = m
    o.textContent = m
    if (settings.mode === m) o.selected = true
    modeSel.appendChild(o)
  }
  modeLabel.appendChild(modeSel)
  root.appendChild(modeLabel)

  const tokenLabel = document.createElement('label')
  tokenLabel.className = 'field'
  tokenLabel.innerHTML = '<span>Bearer token</span>'
  const tokenInput = document.createElement('input')
  tokenInput.type = 'password'
  tokenInput.placeholder = settings.token ? '••• αποθηκευμένο' : 'επικόλληση token'
  tokenInput.autocomplete = 'off'
  tokenLabel.appendChild(tokenInput)
  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent = 'Αποθηκεύεται τοπικά στον browser. Δε στέλνεται σε τρίτους.'
  tokenLabel.appendChild(hint)
  root.appendChild(tokenLabel)

  const row = document.createElement('div')
  row.className = 'row'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'btn primary'
  saveBtn.textContent = 'Αποθήκευση'
  const testBtn = document.createElement('button')
  testBtn.className = 'btn'
  testBtn.textContent = 'Δοκιμή σύνδεσης'
  const clearBtn = document.createElement('button')
  clearBtn.className = 'btn danger'
  clearBtn.textContent = 'Διαγραφή token'
  row.appendChild(saveBtn)
  row.appendChild(testBtn)
  row.appendChild(clearBtn)
  root.appendChild(row)

  const statusLine = document.createElement('div')
  statusLine.className = 'hint'
  statusLine.style.marginTop = '8px'
  root.appendChild(statusLine)

  if (auth.last_connect_check) {
    statusLine.textContent = `Τελευταία δοκιμή: ${auth.last_connect_check.ok ? 'OK' : 'ΑΠΟΤΥΧΙΑ'} — ${new Date(auth.last_connect_check.at).toLocaleString()}${
      auth.last_connect_check.message ? ` (${auth.last_connect_check.message})` : ''
    }`
  }

  saveBtn.addEventListener('click', async () => {
    const patch: Record<string, unknown> = {
      base_url: urlInput.value.trim(),
      mode: modeSel.value,
    }
    if (tokenInput.value) patch.token = tokenInput.value.trim()
    const res = await sendMessage({ type: 'settings/update', patch: patch as never })
    if (!res.ok) {
      statusLine.innerHTML = `<span class="err">Αποτυχία: ${(res as { error: string }).error}</span>`
      return
    }
    statusLine.innerHTML = '<span class="ok">Αποθηκεύτηκε.</span>'
    tokenInput.value = ''
  })

  testBtn.addEventListener('click', async () => {
    statusLine.textContent = 'Αποθήκευση & δοκιμή…'

    // Save current form values first, so Test uses the token/URL just typed
    // (no need to click Save separately).
    const patch: Record<string, unknown> = {
      base_url: urlInput.value.trim(),
      mode: modeSel.value,
    }
    if (tokenInput.value) patch.token = tokenInput.value.trim()
    const saveRes = await sendMessage({ type: 'settings/update', patch: patch as never })
    if (!saveRes.ok) {
      statusLine.innerHTML = `<span class="err">✗ Αποθήκευση απέτυχε: ${(saveRes as { error: string }).error}</span>`
      return
    }

    // Clear the token field so we don't display it
    tokenInput.value = ''

    const res = await sendMessage({ type: 'auth/test-connection' })
    if (res.ok) {
      statusLine.innerHTML = `<span class="ok">✓ Η σύνδεση λειτουργεί (${urlInput.value.trim()}).</span>`
      refresh?.()
    } else {
      const url = urlInput.value.trim()
      statusLine.innerHTML = `<span class="err">✗ ${(res as { error: string }).error}</span><div class="hint">URL: <code>${url}/taxes</code></div>`
    }
  })

  clearBtn.addEventListener('click', async () => {
    if (!confirm('Σίγουρα;')) return
    await sendMessage({ type: 'auth/clear-token' })
    statusLine.innerHTML = '<span class="ok">Το token διαγράφηκε.</span>'
    refresh?.()
  })
}
