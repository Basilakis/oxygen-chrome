/**
 * Page-load auto-sync helper used by both shells.
 *
 * Behavior:
 *   1. Immediately on call, ask the SW / local handler for a throttled sync
 *      via `sync/auto`. The handler decides whether to actually run based on
 *      last_incremental_at and the presence of a token.
 *   2. While the call is pending, flip the `#sync-indicator` badge to a
 *      "syncing" state so the user knows data is being refreshed.
 *   3. When the call resolves, reflect the outcome briefly (ran / skipped /
 *      failed) and then fade the badge out.
 *
 * The sync itself runs inside the handler — this module is purely UI glue,
 * so the same code works whether we're in the Chrome extension popup (talks
 * to the SW via chrome.runtime) or the web shell (talks to the in-process
 * local dispatcher set up by main.ts).
 */

import { sendMessage } from '@/shared/messages'

type AutoSyncResult = {
  ok: boolean
  skipped?: boolean
  ran?: boolean
  reason?: 'running' | 'fresh' | 'no_token'
  error?: string
  age_ms?: number
}

const INDICATOR_ID = 'sync-indicator'
const BADGE_FADE_MS = 2000

function setIndicator(state: 'syncing' | 'ok' | 'fail' | 'idle', text = ''): void {
  const el = document.getElementById(INDICATOR_ID)
  if (!el) return
  if (state === 'idle') {
    el.hidden = true
    el.textContent = ''
    el.className = 'sync-indicator'
    return
  }
  el.hidden = false
  el.className = `sync-indicator state-${state}`
  el.textContent = text
}

/** Kick off a throttled incremental sync on page/popup open. Non-blocking. */
export function triggerAutoSyncOnOpen(): void {
  setIndicator('syncing', '🔄 συγχρονισμός…')
  sendMessage<AutoSyncResult>({ type: 'sync/auto' })
    .then((res) => {
      if (!res.ok) {
        setIndicator('fail', '⚠ αποτυχία sync')
        scheduleHide()
        return
      }
      if (res.ran) {
        setIndicator('ok', '✓ ενημερώθηκε')
        scheduleHide()
        return
      }
      if (res.skipped && res.reason === 'fresh') {
        // Already fresh (< 2 min since last sync) — hide silently without
        // blinking the badge, to keep the UI calm when the user reopens the
        // popup repeatedly.
        setIndicator('idle')
        return
      }
      if (res.skipped && res.reason === 'running') {
        setIndicator('syncing', '🔄 συγχρονισμός…')
        // Another sync is in flight; poll status until it clears.
        pollUntilIdle().catch(() => {
          setIndicator('idle')
        })
        return
      }
      if (res.skipped && res.reason === 'no_token') {
        setIndicator('idle')
        return
      }
      setIndicator('idle')
    })
    .catch(() => {
      setIndicator('fail', '⚠ αποτυχία sync')
      scheduleHide()
    })
}

function scheduleHide(): void {
  setTimeout(() => setIndicator('idle'), BADGE_FADE_MS)
}

async function pollUntilIdle(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const res = await sendMessage<{ ok: boolean; status?: { running: boolean } }>({
      type: 'sync/status',
    })
    if (res.ok && res.status && !res.status.running) {
      setIndicator('ok', '✓ ενημερώθηκε')
      scheduleHide()
      return
    }
  }
  setIndicator('idle')
}
