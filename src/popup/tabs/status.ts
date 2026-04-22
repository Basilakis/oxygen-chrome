import { sendMessage } from '@/shared/messages'
import type { SyncStatus, AuthStatus } from '@/shared/messages'

export async function renderStatusTab(root: HTMLElement): Promise<void> {
  root.innerHTML = '<p class="muted">Φόρτωση…</p>'
  const [authRes, syncRes] = await Promise.all([
    sendMessage({ type: 'auth/get-status' }),
    sendMessage({ type: 'sync/status' }),
  ])
  const auth = (authRes as { ok: true; auth: AuthStatus }).auth
  const sync = (syncRes as { ok: true; status: SyncStatus }).status

  root.innerHTML = ''

  const authBox = document.createElement('div')
  authBox.className = 'stack'
  root.appendChild(authBox)

  authBox.appendChild(statRow('Token', auth.has_token ? '✓' : '—'))
  authBox.appendChild(statRow('Mode', auth.mode))
  authBox.appendChild(statRow('Base URL', auth.base_url))
  if (auth.last_connect_check) {
    authBox.appendChild(
      statRow(
        'Τελευταίος έλεγχος',
        `${auth.last_connect_check.ok ? '✓' : '✗'} ${new Date(auth.last_connect_check.at).toLocaleString()}${
          auth.last_connect_check.message ? ` — ${auth.last_connect_check.message}` : ''
        }`,
      ),
    )
  }

  const actions = document.createElement('div')
  actions.className = 'row'
  actions.style.marginTop = '10px'
  const bootstrapBtn = document.createElement('button')
  bootstrapBtn.className = 'btn'
  bootstrapBtn.textContent = 'Πλήρης συγχρονισμός'
  bootstrapBtn.addEventListener('click', async () => {
    bootstrapBtn.disabled = true
    bootstrapBtn.textContent = 'Τρέχει…'
    const res = await sendMessage({ type: 'sync/bootstrap' })
    if (!res.ok) alert(`Αποτυχία: ${(res as { error: string }).error}`)
    renderStatusTab(root)
  })
  actions.appendChild(bootstrapBtn)

  const incBtn = document.createElement('button')
  incBtn.className = 'btn'
  incBtn.textContent = 'Ενημέρωση'
  incBtn.addEventListener('click', async () => {
    incBtn.disabled = true
    incBtn.textContent = 'Τρέχει…'
    const res = await sendMessage({ type: 'sync/incremental' })
    if (!res.ok) alert(`Αποτυχία: ${(res as { error: string }).error}`)
    renderStatusTab(root)
  })
  actions.appendChild(incBtn)
  root.appendChild(actions)

  const countsHead = document.createElement('div')
  countsHead.className = 'tier-head'
  countsHead.textContent = 'Αποθηκευμένα δεδομένα'
  countsHead.style.marginTop = '14px'
  root.appendChild(countsHead)

  for (const [k, v] of Object.entries(sync.counts)) {
    root.appendChild(statRow(k, String(v)))
  }

  if (sync.last_bootstrap_at) {
    root.appendChild(statRow('Πλήρης sync', new Date(sync.last_bootstrap_at).toLocaleString()))
  }
  if (sync.last_incremental_at) {
    root.appendChild(statRow('Τελευταία ενημέρωση', new Date(sync.last_incremental_at).toLocaleString()))
  }
  if (sync.last_error) {
    const err = document.createElement('p')
    err.style.color = '#82071e'
    err.style.fontSize = '11px'
    err.style.marginTop = '8px'
    err.textContent = `Σφάλμα: ${sync.last_error}`
    root.appendChild(err)
  }
}

function statRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'stat-row'
  const l = document.createElement('span')
  l.className = 'muted'
  l.textContent = label
  const v = document.createElement('span')
  v.textContent = value
  row.appendChild(l)
  row.appendChild(v)
  return row
}
