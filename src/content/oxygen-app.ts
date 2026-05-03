import { findModalRoot, scrapeInvoiceModal } from './scraper/invoice-modal'
import * as PrefillModal from './overlays/prefill-modal'
import * as LookupCard from './overlays/lookup-card'
import { INJECT_BUTTON_LABEL } from '@/shared/constants'
import { sendMessage, ExtensionReloadedError } from '@/shared/messages'

const SENTINEL_CLASS = 'oxygen-helper-injected-btn'
const FLOATING_HOST_ID = 'oxygen-helper-floating-btn'
const RELOAD_BANNER_ID = 'oxygen-helper-reload-banner'
let currentModalRoot: HTMLElement | null = null
// Guard against transient findModalRoot() misses during Kendo re-renders —
// if we nuke the button on every single null tick, flicker + disappearance
// becomes visible to the user. Require the modal to look absent for a few
// ticks in a row before tearing down.
let nullTicksInRow = 0
const MODAL_CLOSE_THRESHOLD = 4

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

/**
 * True when an element is in the DOM AND has non-zero layout size — catches
 * the case where Kendo re-renders the modal and keeps our button in a
 * detached or `display:none`-ified subtree. If the button is "there" but
 * hidden, we want to treat it as missing and re-inject.
 */
function isVisiblyPresent(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return true
}

function injectInline(container: HTMLElement): boolean {
  const existing = container.querySelector<HTMLElement>(`.${SENTINEL_CLASS}`)
  if (existing && isVisiblyPresent(existing)) return true
  // Stale/hidden button — drop it so the fresh one lands in the current
  // footer that the modal is actually rendering now.
  existing?.remove()
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
  // If the floating host still exists AND its button is connected + visible,
  // leave it alone. Otherwise rebuild so we never end up with a zombie.
  const existingHost = document.getElementById(FLOATING_HOST_ID)
  if (existingHost) {
    const existingBtn = existingHost.querySelector<HTMLElement>(`.${SENTINEL_CLASS}`)
    if (existingBtn && isVisiblyPresent(existingBtn)) return
    existingHost.remove()
  }
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

/**
 * Heuristic — is the current page one where the AADE modal is commonly
 * opened? When detection fails on a page that looks like it SHOULD have a
 * modal, we log extra diagnostics so the user can paste them back and we
 * can adjust the selectors. Currently the module IDs the user reported
 * are listed here; extend as new instances surface.
 */
function looksLikeModalHostPage(): boolean {
  const search = window.location.search
  // The AADE "Παραστατικά σε εκκρεμότητα" listing opens on m=922 at the
  // user's tenant — not a guarantee but a strong hint.
  return /\bm=(922)\b/.test(search)
}

function tick() {
  try {
    // Independent of the AADE scrape flow — tries to annotate the Oxygen
    // "Εμφάνιση προϊόντος" modal with a Google-search icon next to the
    // product description. Safe no-op when the modal isn't present.
    scanProductInfoModal()

    const root = findModalRoot()
    if (root) {
      nullTicksInRow = 0
      if (root !== currentModalRoot) {
        console.log('[oxygen-helper] modal detected', { tag: root.tagName, classes: root.className })
      }
      currentModalRoot = root
      injectInline(root)
      injectFloating(root)
    } else if (currentModalRoot) {
      // Grace period — a single null tick often happens while Kendo swaps
      // DOM subtrees. Only tear down after several consecutive failures.
      nullTicksInRow += 1
      if (nullTicksInRow >= MODAL_CLOSE_THRESHOLD) {
        currentModalRoot = null
        nullTicksInRow = 0
        removeFloating()
      }
    } else {
      nullTicksInRow = 0
      // If the URL hints a modal page but we have never detected a root,
      // log once every ~10 ticks so the console shows what we're seeing.
      // Throttled via a module-level counter to avoid spam.
      diagTickCount += 1
      if (looksLikeModalHostPage() && diagTickCount % 10 === 0) {
        const hasTable = !!document.querySelector('table.tableThinOpen')
        const headingSamples = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, .modal-title, .k-window-title'))
          .map((n) => (n.textContent ?? '').trim())
          .filter(Boolean)
          .slice(0, 6)
        console.log('[oxygen-helper] modal not detected on likely-modal page', {
          url: window.location.href,
          hasTableThinOpen: hasTable,
          headingSamples,
        })
      }
    }
  } catch (err) {
    console.error('[oxygen-helper] tick() threw — swallowing so MutationObserver keeps firing', err)
  }
}

let diagTickCount = 0

/**
 * Adds a Google-search icon next to the product name inside Oxygen's
 * "Εμφάνιση προϊόντος" (`.wdialog_container` → `#wdialog`) modal. Clicking
 * the icon opens `https://www.google.com/search?q=<product-name>` in a new
 * tab. Idempotent — tagged with `SEARCH_ICON_CLASS` so repeated ticks
 * don't duplicate the icon as Kendo re-renders the modal.
 *
 * The modal markup anchors on a <b> inside a row whose first cell text is
 * "Περιγραφή". We match the label accent- and case-insensitively so minor
 * UI variants don't break detection.
 */
const SEARCH_ICON_CLASS = 'oxygen-helper-gsearch-icon'

function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Expected heading normalized once so we don't have to hand-strip diaereses
// from the literal — `normalizeLabel` strips combining accents, but iota-
// with-diaeresis ("ϊ") decomposes under NFD and turns into plain "ι", so the
// comparison string needs to be run through the same pipeline, not written
// by hand.
const PRODUCT_INFO_HEADING = normalizeLabel('Εμφάνιση προϊόντος')
const DESCRIPTION_LABEL = normalizeLabel('Περιγραφή')

function scanProductInfoModal(): void {
  const containers = document.querySelectorAll<HTMLElement>('.wdialog_container #wdialog, #wdialog')
  if (!containers.length) return
  for (const dialog of Array.from(containers)) {
    // Only act on the product-info dialog, not every wdialog instance.
    const heading = dialog.querySelector<HTMLElement>('.popHeader h1')
    if (!heading) continue
    if (normalizeLabel(heading.textContent ?? '') !== PRODUCT_INFO_HEADING) continue

    const rows = dialog.querySelectorAll<HTMLTableRowElement>('#tab-general table tr')
    for (const tr of Array.from(rows)) {
      const cells = tr.cells
      if (cells.length < 2) continue
      const labelText = normalizeLabel(cells[0]!.textContent ?? '')
      if (labelText !== DESCRIPTION_LABEL) continue
      const bold = cells[1]!.querySelector<HTMLElement>('b')
      if (!bold) continue
      // Already injected? Skip.
      if (bold.nextElementSibling?.classList.contains(SEARCH_ICON_CLASS)) break
      const name = (bold.textContent ?? '').trim()
      if (!name) break
      const icon = buildGoogleSearchIcon(name)
      bold.insertAdjacentElement('afterend', icon)
      break
    }

    injectPriceMonitoringSection(dialog)
    injectMentionMonitoringSection(dialog)
  }
}

/**
 * Mention Monitoring section — lives INSIDE the Περισσότερα (`#tab-more`)
 * pane of the product modal, mirroring the Price Monitoring affordance in
 * Κέρδος. Renders via the shared renderer so the web app gets the same UI.
 */
const MENTION_SECTION_ID = 'oxygen-helper-mention-monitoring-section'

function injectMentionMonitoringSection(dialog: HTMLElement): void {
  const morePane = dialog.querySelector<HTMLElement>('#tab-more')
  if (!morePane) return
  if (morePane.querySelector(`#${MENTION_SECTION_ID}`)) return

  const section = document.createElement('div')
  section.id = MENTION_SECTION_ID
  // Oxygen renders #tab-more as two `.col50` floated columns. Without
  // `clear:both` our section either lands to the right of the cols or
  // gets visually overlapped. Force full-width + clear so it always sits
  // BELOW the two columns regardless of their height.
  Object.assign(section.style, {
    clear: 'both',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e4e7eb',
  } as CSSStyleDeclaration)

  const title = document.createElement('div')
  title.textContent = 'Mention Monitoring'
  Object.assign(title.style, {
    fontSize: '15px',
    fontWeight: '600',
    color: '#1f2330',
    marginBottom: '10px',
  } as CSSStyleDeclaration)
  section.appendChild(title)

  const bodyWrap = document.createElement('div')
  Object.assign(bodyWrap.style, {
    minHeight: '40px',
    fontSize: '13px',
    color: '#6b7280',
  } as CSSStyleDeclaration)
  section.appendChild(bodyWrap)

  morePane.appendChild(section)

  const ctx = extractProductContext(dialog)
  if (!ctx) {
    bodyWrap.textContent = 'Δεν βρέθηκαν πληροφορίες προϊόντος για παρακολούθηση αναφορών.'
    return
  }
  // Aliases include the SKU/Κωδικός part of the productKey when available
  // (gives the classifier a second hook beyond the human-readable name).
  const aliases: string[] = []
  const codeMatch = /^code:(.+)$/.exec(ctx.productKey)
  if (codeMatch?.[1]) aliases.push(codeMatch[1])
  void renderMentionMonitoringInto(bodyWrap, {
    productKey: ctx.productKey,
    productName: ctx.productName,
    aliases: aliases.length ? aliases : undefined,
  })
}

/**
 * Adds a "Price Monitoring Changes" section INSIDE the Κέρδος (`#tab-analysis`)
 * tab pane so it only shows when that tab is active. Also renders live price
 * results from the Materials Hub / MIVAA API via the service worker.
 */
const PRICE_SECTION_ID = 'oxygen-helper-price-monitoring-section'

function injectPriceMonitoringSection(dialog: HTMLElement): void {
  const analysisPane = dialog.querySelector<HTMLElement>('#tab-analysis')
  if (!analysisPane) return
  if (analysisPane.querySelector(`#${PRICE_SECTION_ID}`)) return

  const section = document.createElement('div')
  section.id = PRICE_SECTION_ID
  Object.assign(section.style, {
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e4e7eb',
  } as CSSStyleDeclaration)

  const title = document.createElement('div')
  title.textContent = 'Price Monitoring Changes'
  Object.assign(title.style, {
    fontSize: '15px',
    fontWeight: '600',
    color: '#1f2330',
    marginBottom: '10px',
  } as CSSStyleDeclaration)
  section.appendChild(title)

  const bodyWrap = document.createElement('div')
  bodyWrap.className = 'oxygen-helper-price-monitoring-body'
  Object.assign(bodyWrap.style, {
    minHeight: '40px',
    fontSize: '13px',
    color: '#6b7280',
  } as CSSStyleDeclaration)
  section.appendChild(bodyWrap)

  analysisPane.appendChild(section)

  // Kick off the async render — we stash the context on the section so later
  // re-renders (refresh / start-tracking clicks) reuse the same extracted
  // product info without re-reading the DOM.
  const ctx = extractProductContext(dialog)
  if (!ctx) {
    bodyWrap.textContent = 'Δεν βρέθηκαν πληροφορίες προϊόντος για παρακολούθηση.'
    bodyWrap.style.color = '#6b7280'
    return
  }
  void renderPriceMonitoringInto(bodyWrap, ctx)
}

// Price-monitoring rendering + types live in a shared module so the web app
// uses the exact same pipeline. The Oxygen-side logic in this file is just
// the DOM-extraction and section injection — everything inside the section
// (tables, chart, summary, buttons) renders through the shared renderer.
import {
  type PriceMonitoringContext,
  buildPriceMonitoringSearchQuery,
  renderPriceMonitoringInto,
} from '@/shared/ui/price-monitoring'
import { renderMentionMonitoringInto } from '@/shared/ui/mention-monitoring'

function extractProductContext(dialog: HTMLElement): PriceMonitoringContext | null {
  // Product name — same anchor as the Google-search icon.
  let productName = ''
  const rows = dialog.querySelectorAll<HTMLTableRowElement>('#tab-general table tr')
  for (const tr of Array.from(rows)) {
    if (tr.cells.length < 2) continue
    if (normalizeLabel(tr.cells[0]!.textContent ?? '') !== DESCRIPTION_LABEL) continue
    const b = tr.cells[1]!.querySelector<HTMLElement>('b')
    productName = (b?.textContent ?? '').trim()
    break
  }
  if (!productName) return null

  // Dimensions — optional, lifted from the "Διαστάσεις" row in #tab-more.
  // Skip sentinel placeholders like "xx" / "-" that Oxygen writes when the
  // field is unset.
  const dimLabel = normalizeLabel('Διαστάσεις')
  let dimensions: string | undefined
  const moreRows = dialog.querySelectorAll<HTMLTableRowElement>('#tab-more table tr')
  for (const tr of Array.from(moreRows)) {
    if (tr.cells.length < 2) continue
    if (normalizeLabel(tr.cells[0]!.textContent ?? '') !== dimLabel) continue
    const v = (tr.cells[1]!.textContent ?? '').trim()
    if (v && v.toLowerCase() !== 'xx' && v !== '-' && v !== '—') dimensions = v
    break
  }

  // Category — the Κατηγορία row in #tab-general carries a chevron-separated
  // breadcrumb (e.g. "Λευκές Συσκευές > Απορροφητήρας"). We collapse the
  // breadcrumb to a single space-joined string so it reads as a natural
  // hint to the search backend rather than a UI artefact.
  const catLabel = normalizeLabel('Κατηγορία')
  let category: string | undefined
  for (const tr of Array.from(rows)) {
    if (tr.cells.length < 2) continue
    if (normalizeLabel(tr.cells[0]!.textContent ?? '') !== catLabel) continue
    // Collapse multiple whitespace runs and strip the chevron glyphs FontAwesome
    // doesn't render textually, so we get a clean "Λευκές Συσκευές Απορροφητήρας".
    const v = (tr.cells[1]!.textContent ?? '')
      .replace(/\s+/g, ' ')
      .replace(/[›»→>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (v && v !== '-' && v !== '—') category = v
    break
  }

  // Purchase cost + sale price — parsed from the Κέρδος (#tab-analysis) pane.
  // Oxygen renders "63.05 €" in the first column of the "Αγορά (κόστος)" row
  // and the same for "Λιανική (πώληση)". We use these as the anchors for the
  // profit column in the price table.
  let purchaseNet: number | undefined
  let saleNet: number | undefined
  const analysisRows = dialog.querySelectorAll<HTMLTableRowElement>('#tab-analysis table tr')
  for (const tr of Array.from(analysisRows)) {
    if (tr.cells.length < 2) continue
    const label = normalizeLabel(tr.cells[0]!.textContent ?? '')
    if (label === normalizeLabel('Αγορά (κόστος)') || label.startsWith(normalizeLabel('Αγορά'))) {
      purchaseNet = parsePriceText(tr.cells[1]!.textContent)
    } else if (
      label === normalizeLabel('Λιανική (πώληση)') ||
      label.startsWith(normalizeLabel('Λιανική'))
    ) {
      saleNet = parsePriceText(tr.cells[1]!.textContent)
    }
  }

  // Product key — prefer the Κωδικός (product code, called "SKU" in our UI
  // copy) cell. It's stable per product across modal opens, unlike
  // `data-docid` which lives on the footer's "warehouse-change_quantity"/
  // "warehouse-add_product" buttons and actually identifies the current
  // invoice/document context, not the product.
  let codeText = ''
  for (const tr of Array.from(rows)) {
    if (tr.cells.length < 2) continue
    if (normalizeLabel(tr.cells[0]!.textContent ?? '') !== normalizeLabel('Κωδικός')) continue
    codeText = (tr.cells[1]!.textContent ?? '').trim()
    break
  }
  const docBtn = dialog.querySelector<HTMLElement>('[data-docid]')
  const docid = docBtn?.dataset.docid?.trim()
  const productKey = codeText
    ? `code:${codeText}`
    : docid
      ? `docid:${docid}`
      : `name:${productName}`

  return {
    productKey,
    productName,
    dimensions,
    purchaseNet,
    saleNet,
    searchQuery: buildPriceMonitoringSearchQuery(productName, dimensions, category, codeText),
  }
}

function parsePriceText(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  // Handles "63.05 €", "1.234,56 €", "63,05" etc — strip currency + spaces,
  // then normalize comma-decimal if present.
  const cleaned = raw
    .replace(/€|\$|£|EUR|USD|GBP/gi, '')
    .replace(/\s+/g, '')
    .trim()
  if (!cleaned) return undefined
  let numeric = cleaned
  const hasComma = numeric.includes(',')
  const hasDot = numeric.includes('.')
  if (hasComma && hasDot) {
    // European thousands+decimal like "1.234,56" — drop dots, comma→dot
    numeric = numeric.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    numeric = numeric.replace(',', '.')
  }
  const n = parseFloat(numeric)
  return Number.isFinite(n) ? n : undefined
}


function buildGoogleSearchIcon(query: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.className = SEARCH_ICON_CLASS
  a.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.title = `Αναζήτηση στο Google: ${query}`
  a.setAttribute('aria-label', 'Αναζήτηση στο Google')
  Object.assign(a.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    marginInlineStart: '8px',
    borderRadius: '999px',
    border: '1px solid #e4e7eb',
    background: '#fff',
    color: '#4b5563',
    textDecoration: 'none',
    verticalAlign: 'middle',
    cursor: 'pointer',
    transition: 'background 0.15s ease, border-color 0.15s ease',
  } as CSSStyleDeclaration)
  a.addEventListener('mouseenter', () => {
    a.style.background = '#f5f6fa'
    a.style.borderColor = '#2b87eb'
  })
  a.addEventListener('mouseleave', () => {
    a.style.background = '#fff'
    a.style.borderColor = '#e4e7eb'
  })
  a.addEventListener('click', (e) => e.stopPropagation())
  a.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="14" height="14" aria-hidden="true">' +
    '<path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>' +
    '<path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>' +
    '<path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>' +
    '<path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>' +
    '</svg>'
  return a
}

// --- Observation strategy -------------------------------------------------
// Three overlapping signals drive tick():
//   1. MutationObserver on <html> — catches most modal DOM changes synchronously.
//   2. Short-interval poll (1s) — backstop for any mutation we can't observe
//      (attribute-only updates, microtask-batched rebuilds, Chrome throttling
//      on hidden tabs, or a dead observer).
//   3. visibilitychange / focus / pageshow — force an immediate tick the
//      moment the user returns to the tab.
//
// We also re-attach the MutationObserver if it ever looks orphaned (body
// re-rendered through some full-document replacement). Belt + suspenders;
// content-script reliability on a long-lived SPA session is more valuable
// than the microcosts of the extra checks.

let observer: MutationObserver | null = null

function attachObserver() {
  try {
    if (observer) observer.disconnect()
  } catch {
    /* ignore */
  }
  observer = new MutationObserver(() => tick())
  observer.observe(document.documentElement, { childList: true, subtree: true })
}
attachObserver()
tick()

// Fast poll — tiny work (querySelector + a few DOM reads) so the cost is
// negligible even at 1s. Closes the gap between MutationObserver bursts
// while the modal is open.
setInterval(() => tick(), 1000)

// A rarer, heavier re-registration of the MutationObserver. If for some
// reason the root got replaced (e.g. Kendo re-renders <body>), the observer
// still thinks it's watching the old node. Re-attach every 30s to be safe.
setInterval(() => attachObserver(), 30000)

// Immediate tick whenever the tab comes back into focus — covers the
// "opened tab N hours ago, came back, button missing" case the user hit.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick()
})
window.addEventListener('focus', () => tick())
window.addEventListener('pageshow', () => tick())

// --- SPA navigation hooks -------------------------------------------------
// Oxygen's admin app uses a mix of full-page loads and same-tab URL
// switches. When the URL changes within the tab, we often miss the modal's
// next appearance because our `currentModalRoot` reference points at a node
// from the previous view, and the MutationObserver callback assumes the new
// modal is "already handled." Reset state on every navigation event and
// force an immediate tick so detection starts from scratch.
function onNavigation(source: string) {
  console.log('[oxygen-helper] navigation detected via', source, '→', window.location.href)
  currentModalRoot = null
  nullTicksInRow = 0
  removeFloating()
  // The new view's DOM might still be rendering — queue a few ticks so we
  // catch the modal once Kendo is done inserting it.
  tick()
  setTimeout(() => tick(), 200)
  setTimeout(() => tick(), 800)
}
window.addEventListener('popstate', () => onNavigation('popstate'))
window.addEventListener('hashchange', () => onNavigation('hashchange'))
// Monkey-patch history.pushState / replaceState so we learn about
// programmatic SPA nav too — `popstate` only fires on back/forward, not on
// explicit route pushes the app makes.
const origPush = history.pushState
history.pushState = function (...args: Parameters<typeof history.pushState>) {
  const ret = origPush.apply(this, args)
  onNavigation('pushState')
  return ret
}
const origReplace = history.replaceState
history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
  const ret = origReplace.apply(this, args)
  onNavigation('replaceState')
  return ret
}

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
