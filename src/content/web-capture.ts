import * as LookupCard from './overlays/lookup-card'
import * as AutoBadge from './overlays/auto-badge'
import * as Picker from './picker'
import { detectProduct, observeUrlChanges } from './product-detector'
import { sendMessage, ExtensionReloadedError } from '@/shared/messages'
import type { Settings } from '@/shared/types'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then((r) => sendResponse(r))
    .catch((err) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }))
  return true
})

async function handle(message: unknown): Promise<unknown> {
  if (!message || typeof message !== 'object') return { ok: false, error: 'bad message' }
  const m = message as { type?: string } & Record<string, unknown>
  switch (m.type) {
    case 'contextmenu/search-selection': {
      const rect = selectionRect()
      LookupCard.open(String(m.text ?? ''), rect)
      return { ok: true }
    }
    case 'picker/activate': {
      const mode = (m.mode as string | undefined) ?? 'lookup-card'
      Picker.activate((text) => {
        if (mode === 'return-to-popup') {
          // Broadcast the picked text to any listeners (popup / detached
          // window). We don't await the response because the popup is the
          // only consumer and it just reads the text.
          chrome.runtime.sendMessage({ type: 'picker/picked', text }).catch(() => {
            /* popup may be closed — safe to ignore */
          })
        } else {
          LookupCard.open(text)
        }
      })
      return { ok: true }
    }
    case 'contextmenu/pin-selection': {
      const text = String(m.text ?? '').trim()
      if (!text) return { ok: false, error: 'empty selection' }

      let draftId: string | null = null
      const active = await sendMessage({ type: 'drafts/get-active' })
      if (active.ok && 'draft' in active && active.draft) {
        draftId = (active.draft as { id: string }).id
      } else {
        const created = await sendMessage({ type: 'drafts/create' })
        if (created.ok && 'draft' in created && created.draft) {
          draftId = (created.draft as { id: string }).id
        }
      }
      if (!draftId) return { ok: false, error: 'could not obtain draft' }

      const res = await sendMessage({
        type: 'drafts/add-line',
        draft_id: draftId,
        line: {
          source: {
            url: String(m.url ?? window.location.href),
            title: String(m.title ?? document.title),
            selection: text,
            captured_at: Date.now(),
          },
          status: 'unmatched',
          payload: { description: text, quantity: 1 },
        },
      })
      if (res.ok) flashPinned(text)
      return res
    }
    default:
      return { ok: false, error: 'unhandled' }
  }
}

function selectionRect(): { top: number; left: number; width: number; height: number } | undefined {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return undefined
  const range = sel.getRangeAt(0)
  const r = range.getBoundingClientRect()
  if (!r.width && !r.height) return undefined
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function flashPinned(text: string): void {
  const tag = document.createElement('div')
  tag.textContent = `📌 Καρφιτσώθηκε: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`
  Object.assign(tag.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483600',
    background: '#2c2d4e',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '6px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Greek", sans-serif',
    fontSize: '13px',
    lineHeight: '1.4',
    fontWeight: '500',
    boxShadow: '0 8px 24px rgba(20, 22, 30, 0.2)',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  document.documentElement.appendChild(tag)
  setTimeout(() => tag.remove(), 2500)
}

/* ---------- Auto product detection ---------------------------------------- */

const OXYGEN_HOSTS = /(?:\.|^)(?:oxygen|pelatologio)\.gr$/i

let lastDetectedTitle: string | null = null

let contextInvalidated = false

async function settings(): Promise<Settings | null> {
  if (contextInvalidated) return null
  try {
    const res = await sendMessage({ type: 'settings/get' })
    if (res.ok && 'settings' in res) return res.settings as Settings
  } catch (err) {
    if (err instanceof ExtensionReloadedError) {
      contextInvalidated = true
      console.debug('[oxygen-helper] extension reloaded — auto-detection paused until page refresh')
      return null
    }
    console.debug('[oxygen-helper] settings fetch failed', err)
  }
  return null
}

async function runDetection(): Promise<void> {
  // Skip on the Oxygen app itself — don't litter the user's own UI.
  if (OXYGEN_HOSTS.test(window.location.hostname)) return

  const s = await settings()
  if (!s) return
  if (!s.auto_detect_products) return
  if (!s.token) return // no point searching if no token / no cached catalog

  const detected = detectProduct()
  if (!detected) {
    if (lastDetectedTitle) {
      AutoBadge.hide()
      lastDetectedTitle = null
    }
    return
  }

  if (detected.title === lastDetectedTitle) return
  if (AutoBadge.isDismissed(detected.title)) return
  lastDetectedTitle = detected.title

  console.debug('[oxygen-helper] product detected', detected)
  AutoBadge.show(detected).catch((err) =>
    console.debug('[oxygen-helper] auto-badge failed', err),
  )
}

function scheduleDetection(delay = 500): void {
  setTimeout(() => {
    runDetection().catch((err) => console.debug('[oxygen-helper] detection error', err))
  }, delay)
}

// Initial run after hydration
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  scheduleDetection(500)
} else {
  window.addEventListener('DOMContentLoaded', () => scheduleDetection(500), { once: true })
}

// SPA navigation
observeUrlChanges(() => {
  lastDetectedTitle = null
  AutoBadge.hide()
  scheduleDetection(400)
})

// Re-check on significant DOM mutations (in case the product info hydrates late)
let mutationDebounce: ReturnType<typeof setTimeout> | null = null
const observer = new MutationObserver(() => {
  if (mutationDebounce) return
  mutationDebounce = setTimeout(() => {
    mutationDebounce = null
    if (!lastDetectedTitle) runDetection().catch(() => void 0)
  }, 1200)
})
observer.observe(document.documentElement, { childList: true, subtree: true })

console.debug('[oxygen-helper] web-capture content script active')
