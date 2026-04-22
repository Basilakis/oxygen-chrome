import { sendMessage } from '@/shared/messages'
import type { AuthStatus, SyncStatus } from '@/shared/messages'
import { renderAuth } from './sections/auth'
import { renderSync } from './sections/sync'
import { renderDefaults } from './sections/defaults'
import { renderSkuPricing } from './sections/sku-pricing'
import { renderBehavior } from './sections/behavior'
import { renderAi } from './sections/ai'
import { renderDiagnostics } from './sections/diagnostics'

function renderLocked(root: HTMLElement, title: string, message: string): void {
  root.innerHTML = ''
  const h = document.createElement('h2')
  h.textContent = title
  root.appendChild(h)
  const body = document.createElement('div')
  body.className = 'locked'
  body.innerHTML = `<span class="lock-icon" aria-hidden="true">🔒</span><span>${message}</span>`
  root.appendChild(body)
}

async function mount(): Promise<void> {
  const [authRes, syncRes] = await Promise.all([
    sendMessage({ type: 'auth/get-status' }),
    sendMessage({ type: 'sync/status' }),
  ])
  const auth = (authRes as { ok: true; auth: AuthStatus }).auth
  const sync = (syncRes as { ok: true; status: SyncStatus }).status

  const authOk = !!auth.has_token && auth.last_connect_check?.ok === true
  const syncDone = sync.last_bootstrap_at !== undefined && sync.counts.products + sync.counts.contacts > 0

  const authEl = document.getElementById('section-auth')
  const syncEl = document.getElementById('section-sync')
  const defaultsEl = document.getElementById('section-defaults')
  const skuEl = document.getElementById('section-sku')
  const behaviorEl = document.getElementById('section-behavior')
  const diagEl = document.getElementById('section-diagnostics')

  const refresh = () => {
    mount().catch((err) => console.error('[oxygen-helper] options refresh failed', err))
  }

  if (authEl) await renderAuth(authEl, refresh)

  if (syncEl) {
    if (!authOk) {
      renderLocked(
        syncEl,
        'Συγχρονισμός',
        'Ολοκληρώστε πρώτα τη δοκιμή σύνδεσης παραπάνω για να ενεργοποιηθεί ο συγχρονισμός.',
      )
    } else {
      await renderSync(syncEl, refresh)
    }
  }

  const aiEl = document.getElementById('section-ai')

  const gated: Array<{ el: HTMLElement | null; title: string; render: (el: HTMLElement) => Promise<void> }> = [
    { el: defaultsEl, title: 'Προεπιλογές', render: renderDefaults },
    { el: skuEl, title: 'SKU & τιμολόγηση', render: renderSkuPricing },
    { el: behaviorEl, title: 'Συμπεριφορά', render: renderBehavior },
  ]

  // AI section is NOT gated — user should be able to paste their Anthropic key
  // independently of the Oxygen auth/sync state.
  if (aiEl) await renderAi(aiEl)

  for (const { el, title, render } of gated) {
    if (!el) continue
    if (!authOk) {
      renderLocked(el, title, 'Ολοκληρώστε τη δοκιμή σύνδεσης πρώτα.')
    } else if (!syncDone) {
      renderLocked(
        el,
        title,
        'Εκτελέστε πλήρη συγχρονισμό από την ενότητα «Συγχρονισμός» για να εμφανιστούν τα διαθέσιμα δεδομένα.',
      )
    } else {
      await render(el)
    }
  }

  if (diagEl) await renderDiagnostics(diagEl)
}

mount().catch((err) => console.error('[oxygen-helper] options mount failed', err))
