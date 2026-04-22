import { sendMessage } from '@/shared/messages'
import type { Settings } from '@/shared/types'
import type { SyncStatus } from '@/shared/messages'

export async function renderSync(root: HTMLElement, refresh?: () => void): Promise<void> {
  root.innerHTML = '<h2>Συγχρονισμός</h2>'

  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: Settings }).settings

  const intervalLabel = document.createElement('label')
  intervalLabel.className = 'field'
  intervalLabel.innerHTML = '<span>Διάστημα ενημέρωσης (λεπτά)</span>'
  const interval = document.createElement('input')
  interval.type = 'number'
  interval.min = '5'
  interval.value = String(settings.sync_interval_minutes)
  interval.addEventListener('change', async () => {
    await sendMessage({
      type: 'settings/update',
      patch: { sync_interval_minutes: Math.max(5, Number(interval.value)) },
    })
  })
  intervalLabel.appendChild(interval)
  root.appendChild(intervalLabel)

  const row = document.createElement('div')
  row.className = 'row'
  const fullBtn = document.createElement('button')
  fullBtn.className = 'btn primary'
  fullBtn.textContent = 'Πλήρης συγχρονισμός'
  const incBtn = document.createElement('button')
  incBtn.className = 'btn'
  incBtn.textContent = 'Ενημέρωση τώρα'
  row.appendChild(fullBtn)
  row.appendChild(incBtn)
  root.appendChild(row)

  const statusWrap = document.createElement('div')
  statusWrap.style.marginTop = '12px'
  root.appendChild(statusWrap)

  async function refreshStatus() {
    const r = await sendMessage({ type: 'sync/status' })
    const s = (r as { ok: true; status: SyncStatus }).status
    statusWrap.innerHTML = ''
    const mk = (k: string, v: string) => {
      const p = document.createElement('div')
      p.className = 'stat-line'
      p.textContent = `${k}: ${v}`
      return p
    }
    if (s.last_bootstrap_at) statusWrap.appendChild(mk('Πλήρης συγχρονισμός', new Date(s.last_bootstrap_at).toLocaleString()))
    if (s.last_incremental_at) statusWrap.appendChild(mk('Τελευταία ενημέρωση', new Date(s.last_incremental_at).toLocaleString()))
    for (const [k, v] of Object.entries(s.counts)) statusWrap.appendChild(mk(k, String(v)))
    if (s.last_error) {
      const err = document.createElement('div')
      err.className = 'err'
      err.style.fontSize = '12px'
      err.textContent = `Σφάλμα: ${s.last_error}`
      statusWrap.appendChild(err)
    }
  }
  await refreshStatus()

  fullBtn.addEventListener('click', async () => {
    fullBtn.disabled = true
    fullBtn.textContent = 'Τρέχει…'
    const res = await sendMessage({ type: 'sync/bootstrap' })
    if (!res.ok) alert(`Αποτυχία: ${(res as { error: string }).error}`)
    fullBtn.disabled = false
    fullBtn.textContent = 'Πλήρης συγχρονισμός'
    await refreshStatus()
    if (res.ok) refresh?.()
  })
  incBtn.addEventListener('click', async () => {
    incBtn.disabled = true
    incBtn.textContent = 'Τρέχει…'
    const res = await sendMessage({ type: 'sync/incremental' })
    if (!res.ok) alert(`Αποτυχία: ${(res as { error: string }).error}`)
    incBtn.disabled = false
    incBtn.textContent = 'Ενημέρωση τώρα'
    await refreshStatus()
  })
}
