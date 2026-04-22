import { findModalRoot, scrapeInvoiceModal } from './scraper/invoice-modal'
import * as PrefillModal from './overlays/prefill-modal'
import * as LookupCard from './overlays/lookup-card'
import { INJECT_BUTTON_LABEL } from '@/shared/constants'
import { sendMessage, ExtensionReloadedError } from '@/shared/messages'

const SENTINEL_CLASS = 'oxygen-helper-injected-btn'
const FLOATING_HOST_ID = 'oxygen-helper-floating-btn'
const RELOAD_BANNER_ID = 'oxygen-helper-reload-banner'
let currentModalRoot: HTMLElement | null = null

function showReloadBanner(): void {
  if (document.getElementById(RELOAD_BANNER_ID)) return
  const host = document.createElement('div')
  host.id = RELOAD_BANNER_ID
  Object.assign(host.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483600',
    background: '#2c2d4e',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '8px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Greek", sans-serif',
    fontSize: '13px',
    fontWeight: '500',
    boxShadow: '0 10px 30px rgba(20, 22, 30, 0.25)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as CSSStyleDeclaration)

  const msg = document.createElement('span')
  msg.textContent = 'Το Oxygen Helper επαναφορτώθηκε — ανανέωσε τη σελίδα.'
  host.appendChild(msg)

  const btn = document.createElement('button')
  btn.textContent = 'Ανανέωση'
  Object.assign(btn.style, {
    background: '#2b87eb',
    color: '#fff',
    border: '0',
    borderRadius: '5px',
    padding: '5px 12px',
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  } as CSSStyleDeclaration)
  btn.addEventListener('click', () => window.location.reload())
  host.appendChild(btn)

  document.documentElement.appendChild(host)
}

console.log('[oxygen-helper] oxygen-app content script loaded on', window.location.href)

window.addEventListener('error', (event) => {
  if (event.filename?.includes('oxygen-helper') || event.message?.includes('oxygen-helper')) {
    console.error('[oxygen-helper] uncaught error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    })
  }
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[oxygen-helper] unhandled promise rejection', event.reason)
})

function buildButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = SENTINEL_CLASS
  btn.textContent = INJECT_BUTTON_LABEL
  btn.type = 'button'
  Object.assign(btn.style, {
    marginInlineStart: '8px',
    padding: '7px 14px',
    borderRadius: '6px',
    border: '1px solid #2b87eb',
    background: '#2b87eb',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '500',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Greek", sans-serif',
    fontSize: '13px',
    lineHeight: '1.3',
    boxShadow: '0 1px 2px rgba(20, 22, 30, 0.12)',
  } as CSSStyleDeclaration)
  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#1e73cc'
    btn.style.borderColor = '#1e73cc'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#2b87eb'
    btn.style.borderColor = '#2b87eb'
  })
  return btn
}

function findFooter(container: HTMLElement): HTMLElement | null {
  const candidates = container.querySelectorAll(
    '.modal-footer, .k-window-actions, .k-dialog-buttongroup, footer, .footer, .actions, .modal-buttons, .buttons',
  )
  for (const c of Array.from(candidates)) return c as HTMLElement
  return null
}

function injectInline(container: HTMLElement): boolean {
  if (container.querySelector(`.${SENTINEL_CLASS}`)) return true
  const footer = findFooter(container)
  if (!footer) return false
  const btn = buildButton()
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('[oxygen-helper] inject button clicked')
    handleClick(container).catch((err) => {
      console.error('[oxygen-helper] handleClick failed', err)
      if (err instanceof ExtensionReloadedError) {
        showReloadBanner()
        return
      }
      alert(`Oxygen Helper σφάλμα: ${err?.message ?? err}`)
    })
  })
  footer.appendChild(btn)
  console.log('[oxygen-helper] inline button injected into modal footer')
  return true
}

function injectFloating(container: HTMLElement): void {
  if (document.getElementById(FLOATING_HOST_ID)) return
  const host = document.createElement('div')
  host.id = FLOATING_HOST_ID
  Object.assign(host.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483500',
    pointerEvents: 'auto',
  } as CSSStyleDeclaration)
  const btn = buildButton()
  btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('[oxygen-helper] inject button clicked')
    handleClick(container).catch((err) => {
      console.error('[oxygen-helper] handleClick failed', err)
      if (err instanceof ExtensionReloadedError) {
        showReloadBanner()
        return
      }
      alert(`Oxygen Helper σφάλμα: ${err?.message ?? err}`)
    })
  })
  host.appendChild(btn)
  document.documentElement.appendChild(host)
  console.log('[oxygen-helper] floating button injected (no footer detected)')
}

function removeFloating(): void {
  document.getElementById(FLOATING_HOST_ID)?.remove()
}

async function handleClick(container: HTMLElement) {
  console.log('[oxygen-helper] handleClick: starting scrape on container', {
    tag: container.tagName,
    classes: container.className,
    tableThinOpen: !!container.querySelector('table.tableThinOpen'),
  })
  let invoice
  try {
    invoice = scrapeInvoiceModal(container)
  } catch (err) {
    console.error('[oxygen-helper] scrapeInvoiceModal threw', err)
    alert(`Oxygen Helper: σφάλμα κατά το διάβασμα του παραστατικού: ${(err as Error)?.message ?? err}`)
    return
  }
  console.log('[oxygen-helper] scrape result', invoice)

  if (!invoice) {
    alert(
      'Oxygen Helper: δεν κατάφερε να διαβάσει το παραστατικό. Δες το console (F12).',
    )
    console.warn('[oxygen-helper] scrape returned null', container.outerHTML.slice(0, 2000))
    return
  }

  if (!invoice.lines.length) {
    alert(
      `Oxygen Helper: βρέθηκε το παραστατικό αλλά δεν εξήχθησαν γραμμές. Αυτό σημαίνει ότι ο scraper έφτασε αλλά ο πίνακας γραμμών δεν αναγνωρίστηκε.`,
    )
    console.warn('[oxygen-helper] scrape returned 0 lines', invoice)
    return
  }

  if (!invoice.supplier_vat) {
    const vat = prompt(
      `Δεν βρέθηκε αυτόματα το ΑΦΜ προμηθευτή στο παραστατικό (${invoice.lines.length} γραμμές βρέθηκαν).\nΠληκτρολόγησε το ΑΦΜ:`,
    )
    if (!vat) return
    invoice.supplier_vat = vat.replace(/\s+/g, '')
  }

  console.log('[oxygen-helper] handleClick: invoice ready, opening prefill modal', {
    supplier_vat: invoice.supplier_vat,
    lines: invoice.lines.length,
  })

  await sendMessage({ type: 'flow1/scrape-detected', invoice })
  await PrefillModal.open(invoice)
}

function tick() {
  try {
    const root = findModalRoot()
    if (root) {
      if (root !== currentModalRoot) {
        console.log('[oxygen-helper] modal detected', { tag: root.tagName, classes: root.className })
      }
      currentModalRoot = root
      if (!injectInline(root)) injectFloating(root)
    } else if (currentModalRoot) {
      currentModalRoot = null
      removeFloating()
    }
  } catch (err) {
    console.error('[oxygen-helper] tick() threw — swallowing so MutationObserver keeps firing', err)
  }
}

const observer = new MutationObserver(() => {
  tick()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
tick()

// Listen for context-menu events forwarded from the SW
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleRuntimeMessage(message)
    .then((r) => sendResponse(r))
    .catch((err) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }))
  return true
})

async function handleRuntimeMessage(message: unknown): Promise<unknown> {
  if (!message || typeof message !== 'object') return { ok: false, error: 'bad message' }
  const m = message as { type?: string } & Record<string, unknown>
  if (m.type === 'contextmenu/search-selection') {
    LookupCard.open(String(m.text ?? ''))
    return { ok: true }
  }
  return { ok: false, error: 'unhandled' }
}

console.log('[oxygen-helper] oxygen-app content script active')
