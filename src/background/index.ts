/**
 * Chrome extension service worker. Registers lifecycle listeners, context
 * menus, alarms, and the chrome.runtime.onMessage handler. All actual message
 * dispatch lives in `./handler.ts` so the same logic can run under the web
 * shell too (without chrome.* at all).
 */

import type { Message } from '@/shared/messages'
import {
  ALARM_INCREMENTAL_SYNC,
  CTX_MENU_PICK,
  CTX_MENU_PIN,
  CTX_MENU_SEARCH,
} from '@/shared/constants'
import { getSettings } from '@/background/storage/settings'
import { isAuthInvalid } from '@/background/api/client'
import { runIncremental } from '@/background/sync/incremental'
import { ensureReady as ensureSearchReady } from '@/background/search'
import { handle, setSyncIntervalHook } from '@/background/handler'

// --- Lifecycle ---------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.debug('[oxygen-helper] installed', details.reason)
  await ensureContextMenus()
  await ensureAlarms()
})

let popupWindowId: number | null = null

chrome.action.onClicked.addListener(async () => {
  // If our popup window is already open, focus it instead of creating a duplicate.
  if (popupWindowId !== null) {
    try {
      const w = await chrome.windows.get(popupWindowId)
      if (w) {
        await chrome.windows.update(popupWindowId, { focused: true, drawAttention: true })
        return
      }
    } catch {
      popupWindowId = null
    }
  }
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('src/popup/index.html?window=1'),
    type: 'popup',
    width: 480,
    height: 720,
    focused: true,
  })
  popupWindowId = created.id ?? null
})

chrome.windows.onRemoved.addListener((windowId) => {
  if (popupWindowId === windowId) popupWindowId = null
})

chrome.runtime.onStartup.addListener(async () => {
  await ensureContextMenus()
  await ensureAlarms()
  ensureSearchReady().catch((err) => console.warn('[oxygen-helper] search init', err))
})

async function ensureContextMenus() {
  try {
    await chrome.contextMenus.removeAll()
  } catch {
    /* ignore */
  }
  chrome.contextMenus.create({
    id: CTX_MENU_SEARCH,
    title: 'Αναζήτηση στην αποθήκη',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: CTX_MENU_PIN,
    title: 'Καρφίτσωμα στο τρέχον πρόχειρο',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: CTX_MENU_PICK,
    title: 'Oxygen: Επιλογή τίτλου προϊόντος από σελίδα',
    contexts: ['page', 'frame', 'selection'],
  })
}

async function ensureAlarms() {
  const settings = await getSettings()
  const periodInMinutes = Math.max(5, settings.sync_interval_minutes || 60)
  const existing = await chrome.alarms.get(ALARM_INCREMENTAL_SYNC)
  if (!existing || existing.periodInMinutes !== periodInMinutes) {
    await chrome.alarms.clear(ALARM_INCREMENTAL_SYNC)
    await chrome.alarms.create(ALARM_INCREMENTAL_SYNC, {
      periodInMinutes,
      delayInMinutes: periodInMinutes,
    })
  }
}

// Hand the extension-specific ensureAlarms to the shared handler so that
// `settings/update` with a new sync_interval_minutes re-arms the alarm.
setSyncIntervalHook(ensureAlarms)

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_INCREMENTAL_SYNC) return
  const settings = await getSettings()
  if (!settings.token) return
  try {
    await runIncremental()
  } catch (err) {
    console.error('[oxygen-helper] incremental sync failed', err)
    await maybeNotifyAuthFailure()
  }
})

// --- Context menu → content script dispatch ---------------------------------

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return
  const text = (info.selectionText ?? '').trim()
  if (info.menuItemId === CTX_MENU_SEARCH) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'contextmenu/search-selection', text })
      .catch((err) => console.debug('[oxygen-helper] forward search ctx', err))
  } else if (info.menuItemId === CTX_MENU_PIN) {
    chrome.tabs
      .sendMessage(tab.id, {
        type: 'contextmenu/pin-selection',
        text,
        url: tab.url ?? '',
        title: tab.title ?? '',
      })
      .catch((err) => console.debug('[oxygen-helper] forward pin ctx', err))
  } else if (info.menuItemId === CTX_MENU_PICK) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'picker/activate' })
      .catch((err) => console.debug('[oxygen-helper] forward pick ctx', err))
  }
})

// --- Message router ---------------------------------------------------------

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handle(message)
    .then((r) => sendResponse(r))
    .catch((err) => {
      console.error('[oxygen-helper] handler error', err)
      sendResponse({ ok: false, error: String((err as Error)?.message ?? err) })
    })
  return true
})

async function maybeNotifyAuthFailure() {
  if (!isAuthInvalid()) return
  const settings = await getSettings()
  if (!settings.notifications_enabled) return
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: '',
      title: 'Oxygen Helper',
      message: 'Το token απέτυχε στον έλεγχο (401). Άνοιξε τις ρυθμίσεις για να το ανανεώσεις.',
    })
  } catch {
    /* ignore */
  }
}

// Eagerly warm caches (no-op if no token yet)
;(async () => {
  try {
    const settings = await getSettings()
    if (settings.token) {
      ensureSearchReady().catch(() => void 0)
    }
  } catch {
    /* ignore */
  }
})()
