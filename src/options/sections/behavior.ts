import { sendMessage } from '@/shared/messages'
import type { Settings } from '@/shared/types'

export async function renderBehavior(root: HTMLElement): Promise<void> {
  root.innerHTML = '<h2>Συμπεριφορά</h2>'
  const settingsRes = await sendMessage({ type: 'settings/get' })
  const settings = (settingsRes as { ok: true; settings: Settings }).settings

  const autoLink = document.createElement('div')
  autoLink.className = 'inline-check'
  const chk1 = document.createElement('input')
  chk1.type = 'checkbox'
  chk1.checked = settings.auto_link_suppliers
  chk1.id = 'auto-link'
  const lbl1 = document.createElement('label')
  lbl1.htmlFor = 'auto-link'
  lbl1.textContent = 'Αυτόματη δημιουργία προμηθευτή μέσω /vat-check αν δεν υπάρχει'
  autoLink.appendChild(chk1)
  autoLink.appendChild(lbl1)
  root.appendChild(autoLink)

  const autoDetect = document.createElement('div')
  autoDetect.className = 'inline-check'
  const chk3 = document.createElement('input')
  chk3.type = 'checkbox'
  chk3.checked = settings.auto_detect_products
  chk3.id = 'auto-detect'
  const lbl3 = document.createElement('label')
  lbl3.htmlFor = 'auto-detect'
  lbl3.textContent =
    'Αυτόματος εντοπισμός προϊόντος στις σελίδες που επισκέπτομαι και αναζήτηση στον κατάλογο'
  autoDetect.appendChild(chk3)
  autoDetect.appendChild(lbl3)
  root.appendChild(autoDetect)

  const notif = document.createElement('div')
  notif.className = 'inline-check'
  const chk2 = document.createElement('input')
  chk2.type = 'checkbox'
  chk2.checked = settings.notifications_enabled
  chk2.id = 'notif'
  const lbl2 = document.createElement('label')
  lbl2.htmlFor = 'notif'
  lbl2.textContent = 'Ειδοποιήσεις για σφάλματα σύνδεσης (401) και ολοκληρωμένους συγχρονισμούς'
  notif.appendChild(chk2)
  notif.appendChild(lbl2)
  root.appendChild(notif)

  const row = document.createElement('div')
  row.className = 'row'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'btn primary'
  saveBtn.textContent = 'Αποθήκευση'
  row.appendChild(saveBtn)
  const status = document.createElement('span')
  status.className = 'hint'
  row.appendChild(status)
  root.appendChild(row)

  saveBtn.addEventListener('click', async () => {
    const res = await sendMessage({
      type: 'settings/update',
      patch: {
        auto_link_suppliers: chk1.checked,
        auto_detect_products: chk3.checked,
        notifications_enabled: chk2.checked,
      },
    })
    status.innerHTML = res.ok ? '<span class="ok">Αποθηκεύτηκε</span>' : `<span class="err">${(res as { error: string }).error}</span>`
  })
}
