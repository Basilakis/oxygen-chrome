import { sendMessage } from '@/shared/messages'
import type { Settings } from '@/shared/types'
import type { SyncStatus } from '@/shared/messages'

// Map of IDB store keys → friendly Greek labels so the counts grid reads
// like a summary table instead of a raw JSON dump.
const COUNT_LABELS: Record<string, string> = {
  products: 'Προϊόντα',
  contacts: 'Επαφές',
  taxes: 'ΦΠΑ',
  warehouses: 'Αποθήκες',
  product_categories: 'Κατηγορίες',
  measurement_units: 'Μονάδες μέτρησης',
  payment_methods: 'Τρόποι πληρωμής',
  numbering_sequences: 'Αριθμοδοτήσεις',
  logos: 'Λογότυπα',
  business_areas: 'Τομείς',
  variations: 'Τύποι παραλλαγών',
  drafts: 'Ειδοποιήσεις',
}

export async function renderSync(root: HTMLElement, refresh?: () => void): Promise<void> {
  root.innerHTML = '<h2>Συγχρονισμός</h2>'

  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: Settings }).settings

  // ---- Interval field + action buttons: one horizontal row ----
  // Keeps the interval control and the two sync triggers on the same line
  // so the whole section takes fewer vertical pixels. The hint underneath
  // still spans the full width so it stays readable on narrow windows.
  const intervalWrap = document.createElement('div')
  intervalWrap.className = 'sync-interval-row'

  const intervalLabel = document.createElement('label')
  intervalLabel.className = 'sync-interval-label'
  intervalLabel.htmlFor = 'sync-interval-input'
  intervalLabel.textContent = 'Διάστημα ενημέρωσης'

  const intervalControlsRow = document.createElement('div')
  intervalControlsRow.className = 'sync-interval-inline'

  const intervalControl = document.createElement('div')
  intervalControl.className = 'sync-interval-control'
  const interval = document.createElement('input')
  interval.id = 'sync-interval-input'
  interval.type = 'number'
  interval.min = '5'
  interval.step = '1'
  interval.className = 'sync-interval-input'
  interval.value = String(settings.sync_interval_minutes)
  interval.addEventListener('change', async () => {
    await sendMessage({
      type: 'settings/update',
      patch: { sync_interval_minutes: Math.max(5, Number(interval.value)) },
    })
  })
  const intervalSuffix = document.createElement('span')
  intervalSuffix.className = 'sync-interval-suffix'
  intervalSuffix.textContent = 'λεπτά'
  intervalControl.appendChild(interval)
  intervalControl.appendChild(intervalSuffix)

  const fullBtn = document.createElement('button')
  fullBtn.className = 'btn primary'
  fullBtn.textContent = 'Πλήρης συγχρονισμός'
  const incBtn = document.createElement('button')
  incBtn.className = 'btn'
  incBtn.textContent = 'Ενημέρωση τώρα'

  intervalControlsRow.appendChild(intervalControl)
  intervalControlsRow.appendChild(fullBtn)
  intervalControlsRow.appendChild(incBtn)

  const intervalHint = document.createElement('div')
  intervalHint.className = 'sync-interval-hint'
  intervalHint.textContent =
    'Ο αυτόματος incremental συγχρονισμός τρέχει με αυτή τη συχνότητα. Ελάχιστο: 5.'

  intervalWrap.appendChild(intervalLabel)
  intervalWrap.appendChild(intervalControlsRow)
  intervalWrap.appendChild(intervalHint)
  root.appendChild(intervalWrap)

  // ---- Status — timestamps + counts grid ----
  const statusWrap = document.createElement('div')
  statusWrap.className = 'sync-status'
  root.appendChild(statusWrap)

  async function refreshStatus() {
    const r = await sendMessage({ type: 'sync/status' })
    const s = (r as { ok: true; status: SyncStatus }).status
    statusWrap.innerHTML = ''

    // Timestamps block
    const ts = document.createElement('div')
    ts.className = 'sync-status-timestamps'
    const mkTs = (label: string, t?: number) => {
      const div = document.createElement('div')
      div.className = 'sync-ts-row'
      div.innerHTML = `<span class="sync-ts-label">${label}</span><span class="sync-ts-value">${
        t ? new Date(t).toLocaleString('el-GR') : '—'
      }</span>`
      return div
    }
    ts.appendChild(mkTs('Πλήρης συγχρονισμός', s.last_bootstrap_at))
    ts.appendChild(mkTs('Τελευταία ενημέρωση', s.last_incremental_at))
    statusWrap.appendChild(ts)

    // Counts grid
    const countsTitle = document.createElement('div')
    countsTitle.className = 'sync-counts-title'
    countsTitle.textContent = 'Αποθηκευμένα δεδομένα'
    statusWrap.appendChild(countsTitle)

    const counts = document.createElement('div')
    counts.className = 'sync-counts-grid'
    for (const [k, v] of Object.entries(s.counts)) {
      const cell = document.createElement('div')
      cell.className = 'sync-count-cell'
      const label = document.createElement('span')
      label.className = 'sync-count-label'
      label.textContent = COUNT_LABELS[k] ?? k
      const value = document.createElement('span')
      value.className = 'sync-count-value'
      value.textContent = String(v)
      cell.appendChild(label)
      cell.appendChild(value)
      counts.appendChild(cell)
    }
    statusWrap.appendChild(counts)

    if (s.last_error) {
      const err = document.createElement('div')
      err.className = 'sync-error'
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
