import { sendMessage } from '@/shared/messages'

export async function renderDiagnostics(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>Διαγνωστικά</h2>'

  const row = document.createElement('div')
  row.className = 'row'
  const snapBtn = document.createElement('button')
  snapBtn.className = 'btn'
  snapBtn.textContent = 'Εμφάνιση snapshot'
  const resetBtn = document.createElement('button')
  resetBtn.className = 'btn danger'
  resetBtn.textContent = 'Διαγραφή βάσης & cache'
  row.appendChild(snapBtn)
  row.appendChild(resetBtn)
  root.appendChild(row)

  const out = document.createElement('pre')
  out.className = 'log'
  out.style.marginTop = '12px'
  out.textContent = 'Κανένα snapshot.'
  root.appendChild(out)

  snapBtn.addEventListener('click', async () => {
    const res = await sendMessage({ type: 'diagnostics/snapshot' })
    out.textContent = JSON.stringify(res, null, 2)
  })

  resetBtn.addEventListener('click', async () => {
    if (!confirm('Αυτό διαγράφει ΟΛΑ τα τοπικά δεδομένα (βάση, search index, ειδοποιήσεις). Συνέχεια;')) return
    const res = await sendMessage({ type: 'diagnostics/reset' })
    out.textContent = JSON.stringify(res, null, 2)
  })
}
