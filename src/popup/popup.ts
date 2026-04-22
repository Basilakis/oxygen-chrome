import { renderSearchTab } from './tabs/search'
import { renderDraftsTab } from './tabs/drafts'
import { renderStatusTab } from './tabs/status'
import { renderAgentTab } from './tabs/agent'

type TabName = 'search' | 'drafts' | 'agent' | 'status'
const renderers: Record<TabName, (root: HTMLElement) => void | Promise<void>> = {
  search: renderSearchTab,
  drafts: renderDraftsTab,
  agent: renderAgentTab,
  status: renderStatusTab,
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

document.getElementById('open-options')?.addEventListener('click', (e) => {
  e.preventDefault()
  chrome.runtime.openOptionsPage()
})

// Detached-window mode: when opened via chrome.windows.create from the action click,
// flip the body to fill the OS window instead of using the default popup constraints.
if (new URLSearchParams(window.location.search).get('window') === '1') {
  document.body.dataset.windowMode = 'true'
}

selectTab('search')
