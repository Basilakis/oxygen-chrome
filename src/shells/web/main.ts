/**
 * Web shell entry. Wires the popup tab code + options sections to run in a
 * plain web page instead of the Chrome extension popup. Same UI, same
 * business logic — only the shell differs.
 *
 * Flow: the popup tab renderers call `sendMessage(...)` which normally goes
 * through chrome.runtime. Here we install a local dispatcher that calls the
 * handler directly — no SW, no IPC.
 */

// Bundle the popup + web stylesheets with this entry — lets Vite fingerprint
// them and keeps the HTML <head> free of absolute /src/... paths that only
// resolve under the Chrome extension runtime.
import '@/popup/popup.css'
import './web.css'

import { setLocalDispatcher } from '@/shared/messages'
import { handle } from '@/background/handler'

import { renderSearchTab } from '@/popup/tabs/search'
import { renderDraftsTab } from '@/popup/tabs/drafts'
import { renderAgentTab } from '@/popup/tabs/agent'
import { renderStatusTab } from '@/popup/tabs/status'

import { renderAuth } from '@/options/sections/auth'
import { renderSync } from '@/options/sections/sync'
import { renderDefaults } from '@/options/sections/defaults'
import { renderSkuPricing } from '@/options/sections/sku-pricing'
import { renderBehavior } from '@/options/sections/behavior'
import { renderAi } from '@/options/sections/ai'
import { renderDiagnostics } from '@/options/sections/diagnostics'

// Route every sendMessage() call to the in-process handler. No chrome.runtime
// needed because the web page hosts the handler directly.
setLocalDispatcher(handle)

type TabName = 'search' | 'drafts' | 'agent' | 'status' | 'settings'

const renderers: Record<TabName, (root: HTMLElement) => void | Promise<void>> = {
  search: renderSearchTab,
  drafts: renderDraftsTab,
  agent: renderAgentTab,
  status: renderStatusTab,
  settings: renderSettingsTab,
}

async function renderSettingsTab(root: HTMLElement): Promise<void> {
  // Stacked vertical sections — same renderers as the extension options page.
  root.innerHTML = ''
  const sections: Array<{ title: string; render: (el: HTMLElement) => Promise<void> | void }> = [
    { title: 'Πιστοποίηση', render: renderAuth },
    { title: 'Συγχρονισμός', render: renderSync },
    { title: 'Προεπιλογές', render: renderDefaults },
    { title: 'SKU & τιμολόγηση', render: renderSkuPricing },
    { title: 'Συμπεριφορά', render: renderBehavior },
    { title: 'Βοηθός AI', render: renderAi },
    { title: 'Διαγνωστικά', render: renderDiagnostics },
  ]
  for (const s of sections) {
    const section = document.createElement('section')
    section.className = 'editor-section web-settings-section'
    root.appendChild(section)
    await s.render(section)
  }
}

function selectTab(name: TabName) {
  document.querySelectorAll<HTMLElement>('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === name)
  })
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((el) => {
    el.classList.toggle('active', el.id === `tab-${name}`)
  })
  const panel = document.getElementById(`tab-${name}`)!
  renderers[name](panel)
}

document.querySelectorAll<HTMLElement>('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab as TabName
    selectTab(name)
  })
})

// In window-mode flag parity with the extension popup — used by popup.css
// to let the body fill the viewport instead of the 420px popup width.
document.body.dataset.windowMode = 'true'

selectTab('search')

// PWA service worker registration — ignore failures silently
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* swallow — offline cache is best-effort */
  })
}
