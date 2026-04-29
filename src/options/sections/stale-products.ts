import { sendMessage } from '@/shared/messages'
import type { Product } from '@/shared/types'
import { productStock } from '@/shared/util'

/**
 * "Παλιά προϊόντα σε απόθεμα" — identifies products that:
 *   - have stock > 0, AND
 *   - haven't been updated in more than N months (default 6).
 *
 * Lets the user bulk-mark them as non-available (status: false) via
 * PUT /products/:id. Works off the local IDB cache so the filter is
 * instant, and refreshes the cache after each successful deactivation.
 */

const DEFAULT_THRESHOLD_MONTHS = 6

export async function renderStaleProducts(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>Παλιά προϊόντα σε απόθεμα</h2>'
  const intro = document.createElement('p')
  intro.className = 'hint'
  intro.textContent =
    'Προϊόντα με απόθεμα που δεν έχουν ενημερωθεί εδώ και πάνω από το επιλεγμένο διάστημα. Μπορείς να τα απενεργοποιήσεις μαζικά (status: false).'
  root.appendChild(intro)

  // ---- Threshold input ----
  const controls = document.createElement('div')
  controls.className = 'stale-controls'

  const thresholdLabel = document.createElement('label')
  thresholdLabel.className = 'stale-threshold-label'
  thresholdLabel.textContent = 'Κατώφλι ανενεργών (μήνες)'
  const thresholdInput = document.createElement('input')
  thresholdInput.type = 'number'
  thresholdInput.min = '1'
  thresholdInput.max = '60'
  thresholdInput.step = '1'
  thresholdInput.value = String(DEFAULT_THRESHOLD_MONTHS)
  thresholdInput.className = 'stale-threshold-input'
  thresholdLabel.appendChild(thresholdInput)
  controls.appendChild(thresholdLabel)

  const refreshBtn = document.createElement('button')
  refreshBtn.className = 'btn'
  refreshBtn.type = 'button'
  refreshBtn.textContent = 'Ανανέωση'
  controls.appendChild(refreshBtn)

  const deactivateBtn = document.createElement('button')
  deactivateBtn.className = 'btn danger'
  deactivateBtn.type = 'button'
  deactivateBtn.textContent = 'Απενεργοποίηση επιλεγμένων'
  deactivateBtn.disabled = true
  controls.appendChild(deactivateBtn)

  root.appendChild(controls)

  const summary = document.createElement('div')
  summary.className = 'stale-summary'
  root.appendChild(summary)

  const tableWrap = document.createElement('div')
  tableWrap.className = 'stale-table-wrap'
  root.appendChild(tableWrap)

  const progress = document.createElement('div')
  progress.className = 'stale-progress'
  root.appendChild(progress)

  const selected = new Set<string>()

  function syncDeactivateState(total: number) {
    deactivateBtn.disabled = selected.size === 0
    deactivateBtn.textContent =
      selected.size > 0
        ? `Απενεργοποίηση (${selected.size})`
        : 'Απενεργοποίηση επιλεγμένων'
    summary.textContent = total === 0
      ? 'Δεν βρέθηκαν παλιά προϊόντα με απόθεμα.'
      : `Βρέθηκαν ${total} προϊόντα. Επιλεγμένα: ${selected.size}.`
  }

  async function load() {
    selected.clear()
    tableWrap.innerHTML = ''
    progress.textContent = ''
    const months = Math.max(1, Math.min(60, Number(thresholdInput.value) || DEFAULT_THRESHOLD_MONTHS))
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000

    // Filter runs against the local IDB cache via the dedicated list message.
    // `updated_at` is populated by the normalizer during sync.
    const listRes = (await sendMessage({ type: 'catalog/list-all' })) as
      | { ok: true; products: Product[] }
      | { ok: false; error: string }
    if (!listRes.ok) throw new Error(listRes.error)
    const all = listRes.products
    const rows = all
      .filter((p) => productStock(p) > 0)
      .filter((p) => {
        const t = parseUpdatedAt(p.updated_at)
        return t !== null && t < cutoff
      })
      .sort((a, b) => (parseUpdatedAt(a.updated_at) ?? 0) - (parseUpdatedAt(b.updated_at) ?? 0))

    syncDeactivateState(rows.length)
    if (rows.length === 0) return

    const table = document.createElement('table')
    table.className = 'stale-table'

    const thead = document.createElement('thead')
    const hr = document.createElement('tr')
    const headers = ['', 'Κωδικός', 'Όνομα', 'Απόθεμα', 'Τελευταία ενημέρωση']
    for (const h of headers) {
      const th = document.createElement('th')
      th.textContent = h
      hr.appendChild(th)
    }
    const selectAllCheckbox = document.createElement('input')
    selectAllCheckbox.type = 'checkbox'
    selectAllCheckbox.title = 'Επιλογή όλων'
    hr.children[0]!.innerHTML = ''
    hr.children[0]!.appendChild(selectAllCheckbox)
    thead.appendChild(hr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const p of rows) {
      const tr = document.createElement('tr')

      const cbCell = document.createElement('td')
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.dataset.id = p.id
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(p.id)
        else selected.delete(p.id)
        syncDeactivateState(rows.length)
      })
      cbCell.appendChild(cb)
      tr.appendChild(cbCell)

      const codeCell = document.createElement('td')
      codeCell.textContent = p.code ?? '—'
      tr.appendChild(codeCell)

      const nameCell = document.createElement('td')
      nameCell.textContent = p.name ?? '(χωρίς όνομα)'
      tr.appendChild(nameCell)

      const stockCell = document.createElement('td')
      stockCell.className = 'num'
      stockCell.textContent = String(productStock(p))
      tr.appendChild(stockCell)

      const updCell = document.createElement('td')
      const ts = parseUpdatedAt(p.updated_at)
      updCell.textContent = ts
        ? new Date(ts).toLocaleDateString('el-GR')
        : '—'
      tr.appendChild(updCell)

      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    tableWrap.appendChild(table)

    selectAllCheckbox.addEventListener('change', () => {
      const checks = tbody.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      for (const c of checks) {
        c.checked = selectAllCheckbox.checked
        if (selectAllCheckbox.checked) selected.add(c.dataset.id!)
        else selected.delete(c.dataset.id!)
      }
      syncDeactivateState(rows.length)
    })
  }

  refreshBtn.addEventListener('click', () => {
    load().catch((err) => {
      progress.textContent = `Σφάλμα: ${(err as Error)?.message ?? err}`
    })
  })
  thresholdInput.addEventListener('change', () => {
    load().catch((err) => {
      progress.textContent = `Σφάλμα: ${(err as Error)?.message ?? err}`
    })
  })

  deactivateBtn.addEventListener('click', async () => {
    if (selected.size === 0) return
    if (
      !confirm(
        `Θα γίνουν ανενεργά ${selected.size} προϊόντα στο Oxygen. Συνέχεια;`,
      )
    )
      return
    const ids = Array.from(selected)
    deactivateBtn.disabled = true
    refreshBtn.disabled = true
    progress.textContent = `Εκτέλεση… 0 / ${ids.length}`
    try {
      const res = (await sendMessage({
        type: 'products/bulk-deactivate',
        ids,
      })) as { ok: true; results: Array<{ id: string; ok: boolean; error?: string }> } | { ok: false; error: string }
      if (!res.ok) {
        progress.textContent = `Αποτυχία: ${res.error}`
      } else {
        const okCount = res.results.filter((r) => r.ok).length
        const failCount = res.results.length - okCount
        progress.textContent =
          failCount === 0
            ? `Ολοκληρώθηκε: ${okCount} προϊόντα απενεργοποιήθηκαν.`
            : `Ολοκληρώθηκε: ${okCount} ΟΚ, ${failCount} απέτυχαν. Δες το console.`
        const failed = res.results.filter((r) => !r.ok)
        if (failed.length) console.warn('[oxygen-helper] deactivation failures', failed)
      }
    } catch (err) {
      progress.textContent = `Σφάλμα: ${(err as Error)?.message ?? err}`
    }
    refreshBtn.disabled = false
    await load()
  })

  await load()
}

function parseUpdatedAt(v: string | undefined | null): number | null {
  if (!v) return null
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}
