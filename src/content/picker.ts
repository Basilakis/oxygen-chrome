/**
 * Click-to-pick mode: once activated, the user hovers any element on the page
 * (element highlights with a blue outline), clicks to capture, and we emit the
 * clicked element's text. Escape or click-outside cancels.
 *
 * Activated via the context-menu command "Oxygen: Επιλογή τίτλου προϊόντος".
 */

const STYLE_ID = 'oxygen-pick-style'
const BANNER_ID = 'oxygen-pick-banner'
const HIGHLIGHT_CLASS = 'oxygen-pick-highlight'

const CSS = `
.${HIGHLIGHT_CLASS} {
  outline: 2px solid #2b87eb !important;
  outline-offset: 2px !important;
  background: rgba(43, 135, 235, 0.08) !important;
  cursor: crosshair !important;
}
`

let active = false
let hoverEl: HTMLElement | null = null
let onPickCb: ((text: string) => void) | null = null

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function showBanner(): void {
  if (document.getElementById(BANNER_ID)) return
  const host = document.createElement('div')
  host.id = BANNER_ID
  Object.assign(host.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483600',
    background: '#2c2d4e',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '8px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Greek", sans-serif',
    fontSize: '13px',
    fontWeight: '500',
    boxShadow: '0 10px 30px rgba(20, 22, 30, 0.3)',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as CSSStyleDeclaration)
  host.textContent = '📍 Κάνε κλικ στον τίτλο του προϊόντος — Escape για ακύρωση'
  document.documentElement.appendChild(host)
}

function hideBanner(): void {
  document.getElementById(BANNER_ID)?.remove()
}

function onMouseOver(e: MouseEvent): void {
  if (!active) return
  const el = e.target as HTMLElement | null
  if (!el || el.id === BANNER_ID) return
  if (hoverEl && hoverEl !== el) hoverEl.classList.remove(HIGHLIGHT_CLASS)
  el.classList.add(HIGHLIGHT_CLASS)
  hoverEl = el
}

function onMouseOut(_e: MouseEvent): void {
  if (!active || !hoverEl) return
  hoverEl.classList.remove(HIGHLIGHT_CLASS)
  hoverEl = null
}

function onClick(e: MouseEvent): void {
  if (!active) return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  const el = e.target as HTMLElement | null
  const text = cleanText(el?.textContent ?? '')
  const cb = onPickCb
  deactivate()
  if (text && cb) cb(text)
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    deactivate()
  }
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function activate(onPick: (text: string) => void): void {
  if (active) return
  active = true
  onPickCb = onPick
  addStyle()
  showBanner()
  document.addEventListener('mouseover', onMouseOver, true)
  document.addEventListener('mouseout', onMouseOut, true)
  // Use capture + stopImmediatePropagation so the page's own click handlers
  // don't fire when the user is picking an element (e.g. a link or button).
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)
}

export function deactivate(): void {
  active = false
  onPickCb = null
  document.removeEventListener('mouseover', onMouseOver, true)
  document.removeEventListener('mouseout', onMouseOut, true)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKeyDown, true)
  if (hoverEl) hoverEl.classList.remove(HIGHLIGHT_CLASS)
  hoverEl = null
  hideBanner()
}

export function isActive(): boolean {
  return active
}
