import { sendMessage } from '@/shared/messages'
import type { ScrapedInvoice, ScrapedInvoiceLine } from '@/shared/messages'
import type {
  Contact,
  Id,
  MeasurementUnit,
  Product,
  ProductCategory,
  Tax,
  Variation,
  Warehouse,
} from '@/shared/types'
import { round2, parseAreaFromName } from '@/shared/util'
import { mountShadowHost, unmountHost, injectStyles, h } from './shared'

const HOST_ID = 'oxygen-helper-prefill-modal'

const CSS = `
:host, * { box-sizing: border-box; }
:host {
  --brand-deep: #2c2d4e;
  --primary: #2b87eb;
  --primary-hover: #1e73cc;
  --success: #2eae5a;
  --warning: #f59f00;
  --danger: #e43f5a;
  --bg-card: #ffffff;
  --bg-app: #f6f7f9;
  --bg-muted: #f3f5f8;
  --border: #e4e7eb;
  --border-soft: #eef0f3;
  --text: #1f2330;
  --text-muted: #6b7280;
  --text-subtle: #9aa0a6;
  --radius: 6px;
  --radius-lg: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Greek", sans-serif;
}
.backdrop {
  position: fixed; inset: 0; background: rgba(20, 22, 30, 0.42);
  pointer-events: auto;
  backdrop-filter: blur(2px);
}
.modal {
  position: fixed; inset: 40px 40px 40px 40px;
  background: var(--bg-app);
  color: var(--text);
  border-radius: var(--radius-lg);
  font: 13px/1.5 var(--font);
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(20, 22, 30, 0.28);
  overflow: hidden;
}
.header {
  padding: 16px 22px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-card);
  display: flex; justify-content: space-between; align-items: center;
}
.brand-row {
  display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;
}
.brand-logo {
  font-size: 12px; font-weight: 800; letter-spacing: 1px; color: var(--brand-deep);
}
.brand-tag {
  font-size: 9px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-subtle);
}
.header h2 {
  font-size: 16px; font-weight: 600; margin: 0; color: var(--text);
}
.header .sub {
  font-size: 12px; color: var(--text-muted); margin-top: 4px;
}
.close {
  background: transparent; border: 0; cursor: pointer; font-size: 22px; line-height: 1;
  color: var(--text-subtle); padding: 4px 8px; border-radius: var(--radius);
}
.close:hover { background: var(--bg-muted); color: var(--text); }
.body {
  flex: 1; overflow: auto; padding: 16px 22px; background: var(--bg-app);
}
.supplier {
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 14px;
  font-size: 12px;
}
.supplier .ok { color: var(--success); font-weight: 500; }
.supplier .warn { color: var(--warning); font-weight: 500; }
.line {
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 2px rgba(20,22,30,0.03);
}
.line .top {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.line .top .status {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  padding: 3px 9px;
  border-radius: 999px;
}
.status-new { background: rgba(46, 174, 90, 0.12); color: var(--success); }
.status-exists { background: rgba(228, 63, 90, 0.12); color: var(--danger); }
.status-candidate { background: rgba(245, 159, 0, 0.14); color: var(--warning); }
.line .grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 12px;
}
.line label {
  display: flex; flex-direction: column; gap: 3px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.3px; color: var(--text-muted); text-transform: uppercase;
}
.line input, .line select {
  font: inherit; font-size: 12px; text-transform: none;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--text);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.line input:focus, .line select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(43,135,235,0.15);
}
.line .read-only-cell {
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-muted);
  color: var(--text);
  text-transform: none;
  min-height: 28px;
  display: flex;
  align-items: center;
  letter-spacing: 0;
  font-weight: 500;
}
.line .full { grid-column: 1 / -1; }
.line .sku-row { display: flex; gap: 4px; align-items: stretch; }
.line .sku-row input { flex: 1; }
.line .err {
  color: var(--danger); font-size: 11px; margin-top: 6px; font-weight: 500;
}
.footer {
  padding: 14px 22px;
  border-top: 1px solid var(--border-soft);
  background: var(--bg-card);
  display: flex; justify-content: flex-end; gap: 8px;
}
.btn {
  font: inherit; font-size: 13px; font-weight: 500;
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.btn:hover { background: var(--bg-muted); }
.btn.primary {
  background: var(--primary); color: #fff; border-color: var(--primary);
}
.btn.primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn.primary:disabled { background: var(--text-subtle); border-color: var(--text-subtle); cursor: wait; }
.note {
  font-size: 11px;
  color: var(--text-subtle);
  margin-top: 8px;
  font-style: italic;
}

/* Update panel shown on 'exists' lines — lets the user opt in to adding the
   received quantity to the existing stock and/or refreshing the purchase
   price when the invoice disagrees. Indent the checkbox rows slightly so
   they read as sub-actions of the matched product. */
.exists-panel {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(127, 127, 127, 0.05);
  border-radius: var(--radius-md, 6px);
  border: 1px dashed var(--border-soft);
}

/* Conversion panel — only shown when billing unit != warehouse unit. Sits
   between the general/meta grid and the Διαθεσιμότητα section. */
.conversion-panel {
  margin: 10px 0;
  padding: 8px 12px;
  background: rgba(43, 135, 235, 0.06);
  border: 1px solid rgba(43, 135, 235, 0.25);
  border-radius: var(--radius-md, 6px);
}
.conversion-head {
  font-size: 11px;
  color: var(--text);
  margin-bottom: 6px;
  font-weight: 600;
}
.conversion-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.conversion-label {
  font-size: 11px;
  color: var(--text-subtle);
}
.conversion-input {
  width: 90px;
  padding: 3px 6px !important;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.conversion-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}
.conversion-warn {
  margin-top: 6px;
  font-size: 11px;
  color: #c94a1c;
}

/* Searchable combobox — positioned relatively so the dropdown overlays the
   rest of the form without displacing other grid cells. Keeps the same
   input look as the other draft-input fields for visual consistency. */
.searchable-select {
  position: relative;
  width: 100%;
}
.searchable-select-input {
  width: 100%;
  padding-right: 24px !important;
  cursor: text;
}
.searchable-select-arrow {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-subtle);
  font-size: 10px;
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
}
.searchable-select-list {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  box-shadow: 0 4px 16px rgba(20, 22, 30, 0.15);
  z-index: 10;
  display: none;
}
.searchable-select-item {
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
  border-bottom: 1px solid rgba(127, 127, 127, 0.08);
}
.searchable-select-item:last-child {
  border-bottom: none;
}
.searchable-select-item.selected {
  font-weight: 600;
}
.searchable-select-item:hover,
.searchable-select-item.highlighted {
  background: var(--primary);
  color: white;
}
.searchable-select-empty {
  padding: 8px 10px;
  font-size: 11px;
  font-style: italic;
  color: var(--text-muted);
}

/* Inline name-duplicate suggestion. Appears just under the name input when
   live search finds a likely existing product. One-click action switches
   the line to UPDATE mode against the match; × dismisses for this session. */
.name-dupe-suggestion {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 6px 10px;
  background: rgba(245, 159, 0, 0.1);
  border: 1px solid rgba(245, 159, 0, 0.35);
  border-radius: var(--radius-md, 6px);
  font-size: 11px;
  flex-wrap: wrap;
}
.name-dupe-icon {
  color: var(--warning);
}
.name-dupe-text {
  flex: 1;
  color: var(--text);
  overflow-wrap: anywhere;
}

/* Inline note shown when the variations switcher detects an existing
   family — makes it clear the children will continue a sequence instead
   of starting fresh. */
.variation-family-note {
  background: rgba(43, 135, 235, 0.08);
  border: 1px solid rgba(43, 135, 235, 0.25);
  padding: 6px 10px;
  border-radius: var(--radius-md, 6px);
  font-style: normal;
  margin-bottom: 6px;
  color: var(--text);
}
.exists-summary {
  font-size: 11px;
  color: var(--text-subtle);
  margin-bottom: 6px;
}
.exists-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  cursor: pointer;
}
.exists-row input[type="checkbox"] {
  margin: 0;
}
.exists-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  margin-top: 2px;
}
.line .top {
  flex-wrap: wrap;
}
.line-summary {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.btn-tiny {
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.btn-tiny:hover {
  background: var(--bg-muted);
  color: var(--text);
}
.btn-icon {
  font: inherit;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  cursor: pointer;
}
.btn-icon:hover { background: var(--bg-muted); }

.section-head {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--text-subtle);
  margin: 16px 0 8px;
  padding-bottom: 5px;
  border-bottom: 1px dashed var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
}
.section-head::before {
  content: "";
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--primary);
}
.line .col-2 { grid-column: span 2; }
.line .col-full { grid-column: 1 / -1; }
.line .col-span-2 { grid-column: span 2; }

.check-cell {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-top: 18px;
  flex-wrap: wrap;
}
.inline-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  color: var(--text);
  cursor: pointer;
  letter-spacing: 0;
}
.inline-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.line textarea {
  font: inherit;
  font-size: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--text);
  min-height: 56px;
  resize: vertical;
  width: 100%;
  font-family: var(--font);
}
.line textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(43,135,235,0.15);
}

.variations-toprow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.variations-toprow-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.switcher {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
}

.switcher input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.switcher-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--border);
  border-radius: 22px;
  transition: background 0.2s ease;
}

.switcher-slider::before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(20, 22, 30, 0.2);
  transition: transform 0.2s ease;
}

.switcher input:checked + .switcher-slider {
  background: var(--primary);
}

.switcher input:checked + .switcher-slider::before {
  transform: translateX(16px);
}

.variations-inline {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.variations-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note.err {
  color: var(--danger);
  font-style: normal;
  font-size: 12px;
}

.variation-values-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
}

.variation-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.variation-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  background: var(--bg-card);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.variation-pill input { margin: 0; accent-color: var(--primary); cursor: pointer; }
.variation-pill:hover { border-color: var(--primary); }
.variation-pill.selected {
  background: rgba(43, 135, 235, 0.12);
  border-color: var(--primary);
  color: var(--primary);
}
`

type LookupContext = {
  taxes: Tax[]
  warehouses: Warehouse[]
  categories: ProductCategory[]
  units: MeasurementUnit[]
  variations: Variation[]
  // Resolved supplier from the invoice's ΑΦΜ, shown read-only on every line.
  // Populated after mountModal's resolve-supplier call completes.
  supplier: Contact | null
  defaults: {
    default_warehouse_id?: Id
    default_category_id?: Id
    default_vat_id?: Id
    default_measurement_unit_id?: Id
    markup_percent: number
    /** Per-category override map (category_id → markup %). */
    category_markup_percents?: Record<Id, number>
  }
}

type LineState = {
  checked: boolean
  // Γενικά
  name: string
  sku: string
  type: number
  categoryId?: Id
  /**
   * Warehouse (storage) unit — the one that goes out as measurement_unit_id /
   * metric on the product payload. By default same as billingUnitId; the user
   * can switch it in the dual-unit dropdown to trigger a conversion (e.g. the
   * invoice charged per m² but we want to track stock as pieces).
   */
  unitId?: Id
  /**
   * Billing (invoice) unit — what the supplier charged us in. Captured from
   * the scraped unit_label so we can recompute warehouse qty/price whenever
   * the user changes the warehouse unit.
   */
  billingUnitId?: Id
  /** Original invoice quantity, immutable after init. */
  billingQuantity: number
  /** Original invoice price-per-billing-unit, immutable after init. */
  billingPrice: number
  /**
   * m² per piece — only meaningful when converting between SQM (billing) and
   * PIECES (warehouse). Auto-filled from parseAreaFromName when dimensions
   * are detectable in the product name; otherwise the user types it in.
   */
  sqmPerItem?: number
  barcode: string
  partNumber: string              // PC ή PN — manufacturer's part number (editable, blank by default)
  supplierProductCode: string     // Κωδικός Προϊόντος Προμ. — supplier's code (editable, auto-filled from invoice ΚΩΔ)
  cpvCode: string
  taricCode: string
  // Διαθεσιμότητα
  warehouseId?: Id
  quantity: number
  stockThreshold: number
  noStockThreshold: boolean
  active: boolean
  // Τιμές
  /**
   * Per-line markup % override. Starts from the category's override (if any)
   * or the global markup_percent; the user can edit in the UI and the sale
   * price recomputes live. The value is NOT sent to the API directly — it
   * only drives the salePrice that IS sent.
   */
  markupPercent: number
  pricesIncludeVat: boolean
  purchasePrice: number
  purchaseTaxId?: Id
  salePrice: number
  saleTaxId?: Id
  saleDiscountPercent: number
  // myData
  mydataIncomeCategory: string
  mydataIncomeType: string
  mydataIncomeRetailCategory: string
  mydataIncomeRetailType: string
  // Σημειώσεις
  notes: string
  // Μεταδεδομένα (metadata array στο POST body). Παίρνονται αυτόματα από το
  // όνομα αν τυχαίνει να έχει διαστάσεις (π.χ. "4100x640x8mm"), εναλλακτικά
  // ο χρήστης τα συμπληρώνει manually. Όλα τα μήκη αποθηκεύονται σε mm.
  metaWidth?: number
  metaLength?: number
  metaHeight?: number
  metaWeight?: number
  metaLink?: string
  metaWarranty?: string
  // Προϊόν με παραλλαγές
  hasVariations: boolean
  variationTypeId?: Id
  variationValueIds: Id[]
  // Internal status
  duplicateStatus: 'new' | 'exists' | 'candidate'
  duplicateProduct?: Product
  candidates?: Product[]
  // For 'exists' lines the user can opt in to update the existing product
  // instead of skipping it. Price update is only offered when the invoice's
  // unit price differs from the stored purchase_net_amount.
  updateStock: boolean
  updatePrice: boolean
  error?: string
  validation?: Record<string, string[]>
  expanded: boolean
}

// Best-guess enums sourced from the platform UI. Refine once API docs surface.
const PRODUCT_TYPES: Array<{ value: number; label: string }> = [
  { value: 3, label: 'Προϊόν' },
  { value: 1, label: 'Υπηρεσία' },
  { value: 2, label: 'Πάγιο' },
]

const MYDATA_INCOME_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'category1_1', label: 'Έσοδα από Πώληση Εμπορευμάτων' },
  { value: 'category1_2', label: 'Έσοδα από Πώληση Προϊόντων' },
  { value: 'category1_3', label: 'Έσοδα από Παροχή Υπηρεσιών' },
  { value: 'category1_4', label: 'Έσοδα από Πώληση Παγίων' },
  { value: 'category1_5', label: 'Λοιπά Συνήθη Έσοδα' },
  { value: 'category1_95', label: 'Λοιπά Έσοδα' },
]

const MYDATA_INCOME_TYPES: Array<{ value: string; label: string }> = [
  { value: 'E3_561_001', label: 'E3_561_001 — Πωλήσεις χονδρικές' },
  { value: 'E3_561_002', label: 'E3_561_002 — Πωλήσεις (επιτηδευματίες)' },
  { value: 'E3_561_003', label: 'E3_561_003 — Πωλήσεις λιανικές' },
  { value: 'E3_561_004', label: 'E3_561_004 — Πωλήσεις λιανικές (επιτηδ.)' },
  { value: 'E3_561_005', label: 'E3_561_005 — Πωλήσεις εξωτερικού' },
  { value: 'E3_561_006', label: 'E3_561_006 — Πωλήσεις εξωτερικού (επιτηδ.)' },
  { value: 'E3_561_007', label: 'E3_561_007 — Πωλήσεις λοιπές' },
  { value: 'E3_881_001', label: 'E3_881_001 — Πωλήσεις παγίων χονδρικές' },
  { value: 'E3_881_003', label: 'E3_881_003 — Πωλήσεις παγίων λιανικές' },
]

export async function open(invoice: ScrapedInvoice): Promise<void> {
  console.debug('[oxygen-helper] PrefillModal.open() invoked with', {
    supplier_vat: invoice.supplier_vat,
    lines: invoice.lines.length,
  })
  const { root } = mountShadowHost(HOST_ID, 2147483600)
  root.innerHTML = ''
  injectStyles(root, CSS)
  const backdrop = h('div', { class: 'backdrop', onclick: close })
  root.appendChild(backdrop)

  const modal = h('div', { class: 'modal' })
  modal.addEventListener('click', (e) => e.stopPropagation())
  root.appendChild(modal)

  try {
    await mountModal(modal, invoice)
  } catch (err) {
    console.error('[oxygen-helper] PrefillModal mount failed', err)
    modal.innerHTML = ''
    modal.appendChild(buildErrorPanel(err))
  }
}

function buildErrorPanel(err: unknown): HTMLElement {
  const wrap = h('div', { class: 'header' })
  wrap.appendChild(
    h(
      'div',
      {},
      h('h2', {}, 'Σφάλμα φόρτωσης'),
      h(
        'div',
        { class: 'sub' },
        `Δες το console (F12) για λεπτομέρειες: ${(err as Error)?.message ?? String(err)}`,
      ),
    ),
  )
  wrap.appendChild(h('button', { class: 'close', onclick: close } as Partial<HTMLButtonElement>, '×'))
  return wrap
}

async function mountModal(modal: HTMLElement, invoice: ScrapedInvoice): Promise<void> {
  modal.appendChild(buildHeader(invoice))

  const body = h('div', { class: 'body' })
  modal.appendChild(body)

  const supplierBox = h('div', { class: 'supplier' }, '🕐 Εύρεση προμηθευτή…')
  body.appendChild(supplierBox)

  const linesContainer = h('div')
  body.appendChild(linesContainer)

  const footer = h('div', { class: 'footer' })
  modal.appendChild(footer)
  const cancelBtn = h('button', { class: 'btn', onclick: close }, 'Άκυρο')
  const submitBtn = h('button', { class: 'btn primary' } as Partial<HTMLButtonElement>, 'Δημιουργία επιλεγμένων')
  footer.appendChild(cancelBtn)
  footer.appendChild(submitBtn)

  // Load lookups + resolve supplier in parallel
  const [taxesRes, whRes, catRes, unitRes, varsRes, settingsRes] = await Promise.all([
    sendMessage({ type: 'lookups/get-taxes' }),
    sendMessage({ type: 'lookups/get-warehouses' }),
    sendMessage({ type: 'lookups/get-categories' }),
    sendMessage({ type: 'lookups/get-measurement-units' }),
    sendMessage({ type: 'lookups/get-variations' }),
    sendMessage({ type: 'settings/get' }),
  ])
  const taxes = (taxesRes as { ok: true; taxes: Tax[] }).taxes
  const warehouses = (whRes as { ok: true; warehouses: Warehouse[] }).warehouses
  // Drop inactive/deleted categories — Oxygen soft-deletes by flipping
  // status=false and still returns them in /products-categories.
  const categories = (catRes as { ok: true; categories: ProductCategory[] }).categories.filter(
    (c) => c.status !== false,
  )
  const units = (unitRes as { ok: true; measurement_units: MeasurementUnit[] }).measurement_units
  const variations = (varsRes as { ok: true; variations: Variation[] }).variations ?? []
  const settings = (settingsRes as { ok: true; settings: LookupContext['defaults'] }).settings

  const ctx: LookupContext = {
    taxes,
    warehouses,
    categories,
    units,
    variations,
    supplier: null,
    defaults: {
      default_warehouse_id: settings.default_warehouse_id,
      default_category_id: settings.default_category_id,
      default_vat_id: settings.default_vat_id,
      default_measurement_unit_id: settings.default_measurement_unit_id,
      markup_percent: settings.markup_percent ?? 25,
      category_markup_percents: settings.category_markup_percents,
    },
  }

  let supplier: Contact | null = null
  try {
    const r = await sendMessage({
      type: 'flow1/resolve-supplier',
      vat: invoice.supplier_vat,
      autoCreate: true,
    })
    if (r.ok && 'contact' in r) {
      supplier = r.contact as Contact
      ctx.supplier = supplier
      supplierBox.innerHTML = ''
      supplierBox.appendChild(
        h('span', { class: 'ok' }, `✓ Προμηθευτής: ${supplier.company_name ?? supplier.vat_number} (ΑΦΜ ${supplier.vat_number})`),
      )
    } else {
      supplierBox.innerHTML = ''
      supplierBox.appendChild(h('span', { class: 'warn' }, `⚠ Αποτυχία εύρεσης προμηθευτή: ${(r as { error: string }).error}`))
    }
  } catch (err) {
    supplierBox.innerHTML = ''
    supplierBox.appendChild(h('span', { class: 'warn' }, `⚠ ${String((err as Error)?.message ?? err)}`))
  }

  // Duplicate detection (needs supplier_code and description)
  const dupeRes = await sendMessage({
    type: 'search/catalog',
    query: invoice.lines.map((l) => l.description).join(' ').slice(0, 64),
    limit: 1,
  })
  void dupeRes // triggers index rehydrate; per-line detection below

  // Build line states.
  //
  // Each new/candidate line consumes one SKU slot — we track a running offset
  // so sequential calls to suggestSku during this batch return unique codes
  // instead of all colliding on max+1. Existing-match lines don't consume an
  // SKU (they'll be UPDATEs, not CREATEs) so the offset only advances for
  // lines where we might create something new.
  const states: LineState[] = []
  let skuOffset = 0
  for (const line of invoice.lines) {
    const matchRes = await detectLine(line)
    const purchasePrice = line.unit_price || 0
    // Markup resolution order: per-category override → global default → 25.
    // The user can still tweak per-line in the UI.
    const categoryId = ctx.defaults.default_category_id
    const markupPercent = resolveMarkup(categoryId, ctx.defaults)
    const salePrice = round2(purchasePrice * (1 + markupPercent / 100))
    const saleTaxId = resolveTaxId(ctx.taxes, line.vat_percent) ?? ctx.defaults.default_vat_id
    const willConsumeSku = matchRes.status !== 'exists'
    const sku = await suggestSku(
      line.description,
      categories,
      ctx.defaults.default_category_id,
      skuOffset,
    )
    if (willConsumeSku) skuOffset += 1
    const unitId = resolveUnitId(ctx.units, line.unit_label) ?? ctx.defaults.default_measurement_unit_id
    // Billing side is frozen from the scrape. Warehouse defaults to same as
    // billing — the user can pivot it in the dropdown to trigger a convert.
    // Pre-parse dimensions from the name so (a) the SQM→PIECES conversion has
    // a factor ready, and (b) the product metadata (width/length/height in mm)
    // is prefilled for the POST payload.
    const parsedArea = parseAreaFromName(line.description)
    const sqmPerItem = parsedArea?.areaSqm
    const metaWidth = parsedArea?.mm.width
    const metaLength = parsedArea?.mm.length
    const metaHeight = parsedArea?.mm.height
    const matched = matchRes.status === 'exists' ? matchRes.product : undefined
    // Default the update toggles ON for existing lines: the user just received
    // stock, so adding it and refreshing the price is almost always what they
    // want. They can uncheck either one per line.
    const priceDiffers =
      matched !== undefined &&
      typeof matched.purchase_net_amount === 'number' &&
      round2(matched.purchase_net_amount) !== round2(purchasePrice)
    states.push({
      checked: matchRes.status === 'new' || matchRes.status === 'exists',
      // Γενικά
      name: line.description,
      sku,
      type: 3,
      categoryId: ctx.defaults.default_category_id,
      unitId,
      billingUnitId: unitId,
      billingQuantity: line.quantity || 1,
      billingPrice: purchasePrice,
      sqmPerItem,
      barcode: '',
      partNumber: '',                                    // PC ή PN stays blank — for manufacturer
      supplierProductCode: line.supplier_code ?? '',     // invoice ΚΩΔ → supplier_code
      cpvCode: '',
      taricCode: '',
      // Διαθεσιμότητα
      warehouseId: ctx.defaults.default_warehouse_id,
      quantity: line.quantity || 1,
      stockThreshold: 0,
      noStockThreshold: false,
      active: true,
      // Τιμές
      markupPercent,
      pricesIncludeVat: false,
      purchasePrice,
      purchaseTaxId: saleTaxId,
      salePrice,
      saleTaxId,
      saleDiscountPercent: 0,
      // myData
      mydataIncomeCategory: 'category1_2',
      mydataIncomeType: 'E3_561_001',
      mydataIncomeRetailCategory: 'category1_2',
      mydataIncomeRetailType: 'E3_561_003',
      // Σημειώσεις
      notes: '',
      // Μεταδεδομένα από το όνομα (mm)
      metaWidth,
      metaLength,
      metaHeight,
      // Variations
      hasVariations: false,
      variationValueIds: [],
      // Status
      duplicateStatus: matchRes.status,
      duplicateProduct: matched,
      candidates: matchRes.status === 'candidate' ? matchRes.candidates : undefined,
      updateStock: matchRes.status === 'exists',
      updatePrice: matchRes.status === 'exists' && priceDiffers,
      // Default to expanded for everything except confirmed-existing lines —
      // otherwise the user only sees a checkbox+summary and thinks nothing rendered.
      expanded: matchRes.status !== 'exists',
    })
  }

  const render = () => {
    linesContainer.innerHTML = ''
    states.forEach((state, i) => {
      linesContainer.appendChild(buildLineCard(i, state, invoice.lines[i]!, ctx, () => render()))
    })
  }
  render()

  submitBtn.addEventListener('click', async () => {
    if (!supplier) {
      supplierBox.innerHTML = ''
      supplierBox.appendChild(h('span', { class: 'warn' }, '⚠ Ο προμηθευτής δεν αναλύθηκε — δεν μπορούμε να συνεχίσουμε'))
      return
    }
    submitBtn.disabled = true
    submitBtn.textContent = 'Δημιουργία…'

    // POST /products requires sale_tax_id (UUID) and warehouses as [{id, qty}].
    // For lines with variations enabled, we expand one state → N products
    // (one per selected value), each with a child code `{sku}.{n}` and a name
    // suffixed with the variation value label.
    //
    // Optional string fields (barcode/part_number/mpn_isbn/supplier_code/
    // cpv_code/taric_code/notes) must be OMITTED when empty, not sent as "".
    // The Oxygen API runs Laravel's default ConvertEmptyStringsToNull
    // middleware, which rewrites "" → null before validation; the `string`
    // rule (without `nullable`) then rejects null with "must be a string."
    // Leaving the key out bypasses the rule entirely.
    const baseFromState = (s: LineState): Record<string, unknown> => {
      // The measurement-unit relation needs two fields on POST /products:
      //   - measurement_unit_id: UUID of the unit (FK column)
      //   - metric: abbreviation string ("ΤΜΧ", "KG", …) that the UI reads
      //     back for display. Oxygen stores/returns both; sending only the
      //     id makes the product come back with an empty metric cell, which
      //     is what the user sees in the product page.
      const unit = s.unitId ? ctx.units.find((u) => u.id === s.unitId) : undefined
      const base: Record<string, unknown> = {
        type: s.type,
        status: s.active,
        category_id: s.categoryId,
        measurement_unit_id: s.unitId,
        stock_threshold: s.noStockThreshold ? null : s.stockThreshold,
        no_stock_threshold: s.noStockThreshold,
        prices_include_vat: s.pricesIncludeVat,
        purchase_net_amount: s.purchasePrice,
        purchase_tax_id: s.purchaseTaxId!,
        sale_net_amount: s.salePrice,
        sale_tax_id: s.saleTaxId!,
        sale_discount_percent: s.saleDiscountPercent || 0,
        mydata_income_category: s.mydataIncomeCategory,
        mydata_income_type: s.mydataIncomeType,
        mydata_income_retail_category: s.mydataIncomeRetailCategory,
        mydata_income_retail_type: s.mydataIncomeRetailType,
        warehouses: s.warehouseId ? [{ id: s.warehouseId, quantity: s.quantity }] : [],
      }
      if (unit?.abbreviation) base.metric = unit.abbreviation
      if (s.barcode) base.barcode = s.barcode
      if (s.partNumber) {
        base.part_number = s.partNumber       // PC ή PN — manufacturer
        base.mpn_isbn = s.partNumber          // mirror on MPN/ISBN
      }
      // supplier_code is REQUIRED whenever supplier_id is set (Flow 1 always
      // sets it). API rule: `required_unless:supplier_id,null`. If the
      // invoice's ΚΩΔ column was empty and the user didn't type a value,
      // fall back to the SKU so we always satisfy the validator. SKU is
      // always non-empty because it's auto-generated.
      base.supplier_code = s.supplierProductCode || s.sku
      if (s.cpvCode) base.cpv_code = s.cpvCode
      if (s.taricCode) base.taric_code = s.taricCode
      if (s.notes) base.notes = s.notes
      // Metadata array — only sent when at least one field has a value, so
      // we don't clutter the API with empty shells. The Oxygen schema for
      // metadata items is {width, length, height, weight, link, warranty}
      // and we send a single-element array following that shape.
      const metaItem: Record<string, unknown> = {}
      if (s.metaWidth !== undefined) metaItem.width = s.metaWidth
      if (s.metaLength !== undefined) metaItem.length = s.metaLength
      if (s.metaHeight !== undefined) metaItem.height = s.metaHeight
      if (s.metaWeight !== undefined) metaItem.weight = s.metaWeight
      if (s.metaLink) metaItem.link = s.metaLink
      if (s.metaWarranty) metaItem.warranty = s.metaWarranty
      if (Object.keys(metaItem).length > 0) base.metadata = [metaItem]
      return base
    }

    // Partition work into two groups:
    //   - creates: 'new' or unmatched 'candidate' lines with the line
    //     checkbox checked → POST /products via flow1/create-products
    //   - updates: 'exists' lines with the line checkbox checked AND at least
    //     one of updateStock/updatePrice → PUT /products/:id via
    //     flow1/update-products
    // Lines that don't match either group are ignored (e.g. an existing
    // product the user explicitly unchecked).
    type UpdateReq = {
      product_id: Id
      add_to_warehouse_id?: Id
      add_quantity?: number
      new_purchase_net_amount?: number
      new_sale_net_amount?: number
    }

    const createPayload: Array<Record<string, unknown>> = []
    const createSourceStates: LineState[] = []  // parallel to createPayload for result mapping
    const updatePayload: UpdateReq[] = []
    const updateSourceStates: LineState[] = []

    for (const s of states) {
      if (!s.checked) continue
      if (s.duplicateStatus === 'exists' && s.duplicateProduct) {
        if (!s.updateStock && !s.updatePrice) continue
        const u: UpdateReq = { product_id: s.duplicateProduct.id }
        if (s.updateStock && s.warehouseId && s.quantity > 0) {
          u.add_to_warehouse_id = s.warehouseId
          u.add_quantity = s.quantity
        }
        if (s.updatePrice) {
          u.new_purchase_net_amount = s.purchasePrice
          u.new_sale_net_amount = s.salePrice
        }
        updatePayload.push(u)
        updateSourceStates.push(s)
      } else if (s.hasVariations && s.variationTypeId && s.variationValueIds.length) {
        const variationType = ctx.variations.find((v) => v.id === s.variationTypeId)
        const base = baseFromState(s)
        // If this line was recognised as extending an existing variation
        // family (detected when the user enabled variations), continue the
        // suffix sequence from the family's last used number instead of
        // restarting at `.1` — that would collide with existing children.
        const fam = (s as LineState & {
          _variationFamily?: { baseCode: string; usedSuffixes: number[]; nextSuffix: number }
        })._variationFamily
        const startSuffix = fam ? fam.nextSuffix : 1
        s.variationValueIds.forEach((valueId, i) => {
          const valueObj = variationType?.values.find((vv) => vv.id === valueId)
          createPayload.push({
            ...base,
            name: valueObj?.name ? `${s.name} - ${valueObj.name}` : s.name,
            code: `${s.sku}.${startSuffix + i}`,
            variations: [
              { variation_id: s.variationTypeId, variation_value_id: valueId },
            ],
          })
          createSourceStates.push(s)
        })
      } else {
        createPayload.push({ ...baseFromState(s), name: s.name, code: s.sku })
        createSourceStates.push(s)
      }
    }

    if (createPayload.length === 0 && updatePayload.length === 0) {
      submitBtn.disabled = false
      submitBtn.textContent = 'Δημιουργία επιλεγμένων'
      alert('Δεν έχει επιλεγεί καμία ενέργεια (δημιουργία ή ενημέρωση).')
      return
    }

    // Fire creates + updates in parallel — they touch different product ids
    // so there's no ordering dependency. Each promise returns its own result
    // shape; we reduce them into the UI state below.
    type CreateResShape = {
      ok: boolean
      error?: string
      results: Array<{ status: 'created' | 'failed'; error?: string; validation?: Record<string, string[]> }>
    }
    type UpdateResShape = {
      ok: boolean
      error?: string
      results: Array<{
        status: 'updated' | 'failed'
        error?: string
        validation?: Record<string, string[]>
        added_stock?: number
        new_total_stock?: number
        price_before?: number
        price_after?: number
      }>
    }
    const createPromise: Promise<CreateResShape> = createPayload.length
      ? (sendMessage({
          type: 'flow1/create-products',
          supplier_id: supplier.id,
          products: createPayload as unknown as never,
        }) as Promise<CreateResShape>)
      : Promise.resolve({ ok: true, results: [] } as CreateResShape)
    const updatePromise: Promise<UpdateResShape> = updatePayload.length
      ? (sendMessage({
          type: 'flow1/update-products',
          updates: updatePayload,
        }) as Promise<UpdateResShape>)
      : Promise.resolve({ ok: true, results: [] } as UpdateResShape)
    const [createRes, updateRes] = await Promise.all([createPromise, updatePromise])

    if (!createRes.ok || !updateRes.ok) {
      submitBtn.disabled = false
      submitBtn.textContent = 'Δημιουργία επιλεγμένων'
      const err = (!createRes.ok && createRes.error) || (!updateRes.ok && updateRes.error) || 'unknown'
      alert(`Αποτυχία: ${err}`)
      return
    }

    // Map create results back onto their source states.
    createRes.results.forEach((r, i) => {
      const s = createSourceStates[i]
      if (!s) return
      if (r.status === 'failed') {
        s.error = r.error
        s.validation = r.validation
      } else {
        s.duplicateStatus = 'exists'
        s.checked = false
      }
    })

    // Map update results — a successful update switches the line to "done"
    // (checkbox off) and clears any previous per-line error.
    updateRes.results.forEach((r, i) => {
      const s = updateSourceStates[i]
      if (!s) return
      if (r.status === 'failed') {
        s.error = r.error
        s.validation = r.validation
      } else {
        s.error = undefined
        s.validation = undefined
        s.checked = false
        s.updateStock = false
        s.updatePrice = false
      }
    })

    render()
    submitBtn.disabled = false
    submitBtn.textContent = 'Δημιουργία επιλεγμένων'
  })

  document.addEventListener('keydown', escHandler)
}

function escHandler(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

export function close(): void {
  document.removeEventListener('keydown', escHandler)
  unmountHost(HOST_ID)
}

function buildHeader(invoice: ScrapedInvoice): HTMLElement {
  const header = h('div', { class: 'header' })
  const left = h('div')
  const brandRow = h('div', { class: 'brand-row' })
  brandRow.appendChild(h('span', { class: 'brand-logo' }, 'OXYGEN'))
  brandRow.appendChild(h('span', { class: 'brand-tag' }, 'Warehouse Helper'))
  left.appendChild(brandRow)
  left.appendChild(h('h2', {}, 'Δημιουργία προϊόντων από τιμολόγιο'))
  left.appendChild(
    h(
      'div',
      { class: 'sub' },
      [
        invoice.document_type,
        invoice.series ? `σειρά ${invoice.series}` : undefined,
        invoice.number ? `αρ. ${invoice.number}` : undefined,
        invoice.date,
        `${invoice.lines.length} γραμμές`,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  )
  header.appendChild(left)
  header.appendChild(h('button', { class: 'close', onclick: close } as Partial<HTMLButtonElement>, '×'))
  return header
}

/**
 * For lines that match an existing product, show current stock + price plus
 * two opt-in checkboxes: add the received quantity to the selected warehouse,
 * and refresh the purchase (and markup-derived sale) price. Both default ON
 * when the master line checkbox is checked — the common case after a real
 * invoice is "yes, update both."
 */
function buildExistingUpdatePanel(state: LineState, matched: Product): HTMLElement {
  const wrap = h('div', { class: 'exists-panel' })

  wrap.appendChild(
    h(
      'div',
      { class: 'note' },
      `Ταίριαξε με ${matched.code ?? '(no code)'} — ${matched.name}`,
    ),
  )

  const currentStock = (matched.warehouses ?? []).reduce((s, w) => s + (w.quantity ?? 0), 0)
  const currentPurchase =
    typeof matched.purchase_net_amount === 'number' ? matched.purchase_net_amount : null

  const summary = h(
    'div',
    { class: 'exists-summary' },
    `Τρέχον: απόθεμα ${currentStock} · τιμή αγοράς ${
      currentPurchase !== null ? `${formatPrice(currentPurchase)}€` : '—'
    }`,
  )
  wrap.appendChild(summary)

  // --- Stock update row ---
  const stockRow = h('label', { class: 'exists-row' })
  const stockCb = h('input', {
    type: 'checkbox',
    checked: state.updateStock,
  } as Partial<HTMLInputElement>)
  stockCb.addEventListener('change', () => {
    state.updateStock = (stockCb as HTMLInputElement).checked
  })
  stockRow.appendChild(stockCb)
  const newStock = currentStock + (state.quantity || 0)
  stockRow.appendChild(
    h(
      'span',
      {},
      `Προσθήκη αποθέματος: +${state.quantity || 0} → ${newStock}`,
    ),
  )
  wrap.appendChild(stockRow)

  // --- Price update row (only if the invoice price differs) ---
  const priceDiffers =
    currentPurchase !== null && round2(currentPurchase) !== round2(state.purchasePrice)
  if (priceDiffers) {
    const priceRow = h('label', { class: 'exists-row' })
    const priceCb = h('input', {
      type: 'checkbox',
      checked: state.updatePrice,
    } as Partial<HTMLInputElement>)
    priceCb.addEventListener('change', () => {
      state.updatePrice = (priceCb as HTMLInputElement).checked
    })
    priceRow.appendChild(priceCb)
    const delta = state.purchasePrice - (currentPurchase ?? 0)
    const deltaText =
      delta > 0 ? `+${formatPrice(delta)}` : delta < 0 ? `${formatPrice(delta)}` : '0'
    priceRow.appendChild(
      h(
        'span',
        {},
        `Ενημέρωση τιμής αγοράς: ${formatPrice(currentPurchase ?? 0)}€ → ${formatPrice(state.purchasePrice)}€ (${deltaText}€)`,
      ),
    )
    wrap.appendChild(priceRow)
  } else if (currentPurchase !== null) {
    wrap.appendChild(
      h('div', { class: 'exists-hint' }, `Η τιμή αγοράς ταυτίζεται (${formatPrice(currentPurchase)}€) — δεν χρειάζεται ενημέρωση.`),
    )
  }

  return wrap
}

function formatPrice(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function buildLineCard(
  index: number,
  state: LineState,
  _raw: ScrapedInvoiceLine,
  ctx: LookupContext,
  rerender: () => void,
): HTMLElement {
  const card = h('div', { class: 'line' })

  // -- Top bar: checkbox, status, item number, expand toggle --
  const top = h('div', { class: 'top' })
  // The "master" checkbox now applies to both create and update lines. For
  // existing lines it gates whether updateStock/updatePrice actions run at
  // submit time; for new lines it still controls whether we create at all.
  const checkbox = h('input', {
    type: 'checkbox',
    checked: state.checked,
  } as Partial<HTMLInputElement>)
  checkbox.addEventListener('change', () => {
    state.checked = (checkbox as HTMLInputElement).checked
  })
  top.appendChild(checkbox)

  const statusClass = `status status-${state.duplicateStatus}`
  const statusLabel =
    state.duplicateStatus === 'exists'
      ? 'ΥΠΑΡΧΕΙ'
      : state.duplicateStatus === 'candidate'
        ? 'ΠΙΘΑΝΗ ΑΝΤΙΣΤΟΙΧΙΣΗ'
        : 'ΝΕΟ'
  top.appendChild(h('span', { class: statusClass }, statusLabel))
  top.appendChild(h('strong', {}, `#${index + 1}`))

  const summary = h('span', { class: 'line-summary' }, state.name || '(χωρίς όνομα)')
  top.appendChild(summary)

  if (state.duplicateStatus !== 'exists') {
    const toggle = h(
      'button',
      {
        class: 'btn-tiny',
        onclick: () => {
          state.expanded = !state.expanded
          rerender()
        },
      },
      state.expanded ? 'Σύμπτυξη' : 'Επεξεργασία',
    )
    top.appendChild(toggle)
  }
  card.appendChild(top)

  if (state.duplicateStatus === 'exists' && state.duplicateProduct) {
    card.appendChild(buildExistingUpdatePanel(state, state.duplicateProduct))
    return card
  }

  if (!state.expanded) {
    if (state.candidates && state.candidates.length) {
      card.appendChild(
        h(
          'div',
          { class: 'note' },
          `Υποψήφια: ${state.candidates
            .slice(0, 3)
            .map((p) => `${p.code ?? ''} ${p.name}`)
            .join(' · ')}`,
        ),
      )
    }
    return card
  }

  // ====================================================================
  // Section: Προϊόν με παραλλαγές — placed at the top of each line so the
  // user sees it first. Toggle is an iOS-style switcher. When enabled with
  // no synced variations, only the instruction note is shown (no dropdown).
  // ====================================================================
  {
    const row = h('div', { class: 'variations-toprow' })
    const label = h('span', { class: 'variations-toprow-label' }, 'Προϊόν με παραλλαγές')
    row.appendChild(label)

    const switcher = document.createElement('label')
    switcher.className = 'switcher'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = state.hasVariations
    cb.addEventListener('change', async () => {
      state.hasVariations = cb.checked
      // When the user flips variations ON, check the catalog for an
      // existing family sharing this name. If we find one, reuse its base
      // code so the new variation slots into the existing sequence
      // (`OX5.1`, `OX5.2` → next is `OX5.3`) instead of getting a fresh
      // unrelated SKU. We keep the user-typed SKU if no family is found.
      if (cb.checked && state.name.trim().length >= 3) {
        try {
          const res = (await sendMessage({
            type: 'flow1/find-variation-family',
            description: state.name,
          })) as {
            ok: true
            family: {
              parent: Product
              baseCode: string
              usedSuffixes: number[]
              nextSuffix: number
            } | null
          }
          if (res.ok && res.family) {
            state.sku = res.family.baseCode
            ;(state as LineState & { _variationFamily?: typeof res.family })._variationFamily =
              res.family
          }
        } catch {
          // ignore — fall back to fresh SKU
        }
      } else {
        ;(state as LineState & { _variationFamily?: unknown })._variationFamily = undefined
      }
      rerender()
    })
    const slider = document.createElement('span')
    slider.className = 'switcher-slider'
    switcher.appendChild(cb)
    switcher.appendChild(slider)
    row.appendChild(switcher)
    card.appendChild(row)

    if (state.hasVariations) {
      const varWrap = h('div', { class: 'variations-wrap variations-inline' })
      // If we've matched an existing family, surface it so the user knows
      // the next SKU is a continuation rather than a fresh parent.
      const fam = (state as LineState & {
        _variationFamily?: { baseCode: string; usedSuffixes: number[]; nextSuffix: number }
      })._variationFamily
      if (fam) {
        const taken = fam.usedSuffixes.length
          ? fam.usedSuffixes.map((n) => `${fam.baseCode}.${n}`).join(', ')
          : '(καμία ακόμα)'
        varWrap.appendChild(
          h(
            'div',
            { class: 'note variation-family-note' },
            `🔗 Επέκταση υπάρχουσας οικογένειας ${fam.baseCode}. Υπάρχοντα: ${taken}. Επόμενο: ${fam.baseCode}.${fam.nextSuffix}`,
          ),
        )
      }
      if (ctx.variations.length === 0) {
        varWrap.appendChild(
          h(
            'div',
            { class: 'note err' },
            'Δεν βρέθηκαν τύποι παραλλαγών στον τοπικό κατάλογο. Τρέξε Ρυθμίσεις → Συγχρονισμός → Πλήρης συγχρονισμός για να τους φορτώσεις.',
          ),
        )
      } else {
        const typeSel = document.createElement('select')
        const mkO = (value: string, text: string): HTMLOptionElement => {
          const o = document.createElement('option')
          o.value = value
          o.textContent = text
          return o
        }
        typeSel.appendChild(mkO('', 'Επιλογή τύπου παραλλαγής…'))
        for (const v of ctx.variations) typeSel.appendChild(mkO(v.id, v.name))
        if (state.variationTypeId) typeSel.value = state.variationTypeId
        typeSel.addEventListener('change', () => {
          state.variationTypeId = typeSel.value || undefined
          state.variationValueIds = []
          rerender()
        })
        varWrap.appendChild(labeled('Τύπος παραλλαγής', typeSel))

        const selectedType = ctx.variations.find((v) => v.id === state.variationTypeId)
        if (selectedType && selectedType.values.length) {
          varWrap.appendChild(
            h(
              'div',
              { class: 'variation-values-label' },
              `Τιμές (${selectedType.name}) — θα δημιουργηθεί ένα προϊόν ανά επιλογή`,
            ),
          )
          const valueBox = document.createElement('div')
          valueBox.className = 'variation-values'
          for (const val of selectedType.values) {
            const isChecked = state.variationValueIds.includes(val.id)
            const pill = document.createElement('label')
            pill.className = 'variation-pill' + (isChecked ? ' selected' : '')
            const vcb = document.createElement('input')
            vcb.type = 'checkbox'
            vcb.checked = isChecked
            vcb.addEventListener('change', () => {
              if (vcb.checked) {
                if (!state.variationValueIds.includes(val.id)) {
                  state.variationValueIds = [...state.variationValueIds, val.id]
                }
              } else {
                state.variationValueIds = state.variationValueIds.filter((id) => id !== val.id)
              }
              rerender()
            })
            const name = document.createElement('span')
            name.textContent = val.name
            pill.appendChild(vcb)
            pill.appendChild(name)
            valueBox.appendChild(pill)
          }
          varWrap.appendChild(valueBox)

          if (state.variationValueIds.length) {
            varWrap.appendChild(
              h(
                'div',
                { class: 'note' },
                `Θα δημιουργηθούν ${state.variationValueIds.length} προϊόντα: ${state.variationValueIds
                  .map((_v, i) => `${state.sku}.${i + 1}`)
                  .join(', ')}`,
              ),
            )
          }
        }
      }
      card.appendChild(varWrap)
    }
  }

  // ====================================================================
  // Section: Γενικά
  // ====================================================================
  card.appendChild(sectionHead('Γενικά'))
  const general = h('div', { class: 'grid' })

  // Name input + live duplicate-suggestion banner. The initial detectLine
  // ran against the scraped description, but once the user edits the name
  // the match may flip — run a debounced search on every keystroke and, if
  // we find an existing product, offer a one-click "switch this line to an
  // UPDATE of that existing product" shortcut.
  const nameField = labeled(
    'Περιγραφή',
    inputEl({ value: state.name, class: 'col-full' }, (v) => {
      state.name = v
      summary.textContent = v || '(χωρίς όνομα)'
      triggerNameDuplicateProbe()
    }),
  )
  const nameSuggestion = h('div', { class: 'name-dupe-suggestion' })
  nameSuggestion.style.display = 'none'
  nameField.appendChild(nameSuggestion)
  general.appendChild(nameField)

  // Debounce the probe so we don't hammer search on every keystroke. We
  // skip the probe entirely for lines already marked 'exists' — those have
  // a match and should not get distracted by a second one.
  const probeDebounce = { t: 0 as ReturnType<typeof setTimeout> | 0 }
  function triggerNameDuplicateProbe() {
    if (state.duplicateStatus === 'exists') {
      nameSuggestion.style.display = 'none'
      return
    }
    if (probeDebounce.t) clearTimeout(probeDebounce.t as ReturnType<typeof setTimeout>)
    probeDebounce.t = setTimeout(() => void runNameDuplicateProbe(), 350)
  }
  async function runNameDuplicateProbe(): Promise<void> {
    const q = state.name.trim()
    if (q.length < 3) {
      nameSuggestion.style.display = 'none'
      return
    }
    const res = (await sendMessage({
      type: 'search/catalog',
      query: q,
      limit: 3,
    })) as { ok: true; results: import('@/shared/messages').SearchResults } | { ok: false }
    if (!res.ok) return
    const hit = res.results.exact[0] ?? res.results.fuzzy[0]
    // Don't surface a match that's already represented as the line's
    // current duplicate-candidate — it's noise.
    if (!hit || hit.product.id === state.duplicateProduct?.id) {
      nameSuggestion.style.display = 'none'
      return
    }
    renderNameSuggestion(hit.product)
  }
  function renderNameSuggestion(match: Product): void {
    nameSuggestion.innerHTML = ''
    nameSuggestion.style.display = 'flex'
    const icon = h('span', { class: 'name-dupe-icon' }, '⚠')
    const text = h(
      'span',
      { class: 'name-dupe-text' },
      `Πιθανό duplicate: ${match.code ?? '(χωρίς κωδικό)'} — ${match.name ?? ''}`,
    )
    const useBtn = h('button', { class: 'btn-tiny primary', type: 'button' }, 'Χρήση υπάρχοντος')
    useBtn.addEventListener('click', () => {
      // Pivot this line to an UPDATE flow against the matched product.
      state.duplicateStatus = 'exists'
      state.duplicateProduct = match
      state.checked = true
      state.updateStock = true
      state.updatePrice =
        typeof match.purchase_net_amount === 'number' &&
        round2(match.purchase_net_amount) !== round2(state.purchasePrice)
      rerender()
    })
    const dismiss = h('button', { class: 'btn-tiny', type: 'button' }, '×')
    dismiss.title = 'Αγνόηση'
    dismiss.addEventListener('click', () => {
      nameSuggestion.style.display = 'none'
    })
    nameSuggestion.appendChild(icon)
    nameSuggestion.appendChild(text)
    nameSuggestion.appendChild(useBtn)
    nameSuggestion.appendChild(dismiss)
  }

  const skuInput = inputEl({ value: state.sku }, (v) => (state.sku = v))
  general.appendChild(labeled('Κωδικός (SKU)', skuInput))

  general.appendChild(
    labeled(
      'Τύπος',
      selectEl(
        PRODUCT_TYPES.map((t) => ({ value: String(t.value), label: t.label })),
        String(state.type),
        (v) => (state.type = Number(v)),
      ),
    ),
  )

  general.appendChild(
    labeled(
      'Κατηγορία',
      // Searchable combobox — the catalog can have 40+ categories, and native
      // <select> only gives first-letter jumping. The user asked for type-to-
      // filter here specifically.
      searchableSelectEl(
        [{ value: '', label: 'Χωρίς κατηγορία' }, ...ctx.categories.map((c) => ({ value: c.id, label: c.name }))],
        state.categoryId ?? '',
        'Αναζήτηση κατηγορίας…',
        (v) => {
          state.categoryId = v || undefined
          // Markup may depend on the category — refresh derived prices.
          state.markupPercent = resolveMarkup(state.categoryId, ctx.defaults)
          state.salePrice = round2(state.purchasePrice * (1 + state.markupPercent / 100))
          rerender()
        },
      ),
    ),
  )

  // ====================================================================
  // Dual measurement units: billing (invoice) vs warehouse (storage).
  // When the two differ we trigger a conversion so the warehouse records the
  // right quantity and price in its native unit. See computeConversion() for
  // the math. The conversion panel below the dropdowns re-renders on change.
  // ====================================================================
  const unitOptions = [
    { value: '', label: 'Χωρίς μονάδα' },
    ...ctx.units.map((u) => ({ value: u.id, label: u.abbreviation })),
  ]
  general.appendChild(
    labeled(
      'Μονάδα Τιμολόγισης',
      selectEl(unitOptions, state.billingUnitId ?? '', (v) => {
        state.billingUnitId = v || undefined
        applyConversion(state, ctx, rerender)
      }),
    ),
  )
  general.appendChild(
    labeled(
      'Μονάδα Αποθήκης',
      selectEl(unitOptions, state.unitId ?? '', (v) => {
        state.unitId = v || undefined
        applyConversion(state, ctx, rerender)
      }),
    ),
  )

  general.appendChild(labeled('Barcode', inputEl({ value: state.barcode }, (v) => (state.barcode = v))))
  general.appendChild(labeled('PC ή PN', inputEl({ value: state.partNumber }, (v) => (state.partNumber = v))))
  general.appendChild(labeled('Κωδικός CPV', inputEl({ value: state.cpvCode }, (v) => (state.cpvCode = v))))
  general.appendChild(labeled('Κωδικός TARIC', inputEl({ value: state.taricCode }, (v) => (state.taricCode = v))))

  // Supplier info — read-only display of whom the product is linked to,
  // plus editable supplier-side code (from invoice ΚΩΔ).
  const supplierLabel = ctx.supplier
    ? `${ctx.supplier.company_name ?? [ctx.supplier.name, ctx.supplier.surname].filter(Boolean).join(' ') ?? ctx.supplier.vat_number ?? '—'}${ctx.supplier.vat_number ? ` (ΑΦΜ ${ctx.supplier.vat_number})` : ''}`
    : '—'
  const supplierField = labeled(
    'Προμηθευτής',
    readOnlyEl(supplierLabel),
  )
  supplierField.classList.add('col-2')
  general.appendChild(supplierField)

  general.appendChild(
    labeled(
      'Κωδικός Προϊόντος Προμ.',
      inputEl({ value: state.supplierProductCode }, (v) => (state.supplierProductCode = v)),
    ),
  )

  card.appendChild(general)

  // ====================================================================
  // Section: Μεταδεδομένα — πλάτος / μήκος / ύψος / βάρος / link / εγγύηση.
  // Αντιστοιχούν 1-1 στα fields που περιμένει το Oxygen POST /products
  // (metadata array). Αν το όνομα είχε διαστάσεις (π.χ. "4100x640x8mm"),
  // τα πρώτα τρία έχουν ήδη γεμίσει από το parseAreaFromName. Όλες οι
  // διαστάσεις σε mm· το βάρος σε kg (Oxygen convention).
  // ====================================================================
  card.appendChild(sectionHead('Μεταδεδομένα'))
  const meta = h('div', { class: 'grid' })

  const numOpt = (v: number | undefined) => (v !== undefined ? String(v) : '')
  const parseOptNum = (s: string): number | undefined => {
    const n = Number(s)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  meta.appendChild(
    labeled(
      'Πλάτος (mm)',
      inputEl(
        { value: numOpt(state.metaWidth), type: 'number', step: '1', min: '0' },
        (v) => (state.metaWidth = parseOptNum(v)),
      ),
    ),
  )
  meta.appendChild(
    labeled(
      'Μήκος (mm)',
      inputEl(
        { value: numOpt(state.metaLength), type: 'number', step: '1', min: '0' },
        (v) => (state.metaLength = parseOptNum(v)),
      ),
    ),
  )
  meta.appendChild(
    labeled(
      'Ύψος / πάχος (mm)',
      inputEl(
        { value: numOpt(state.metaHeight), type: 'number', step: '1', min: '0' },
        (v) => (state.metaHeight = parseOptNum(v)),
      ),
    ),
  )
  meta.appendChild(
    labeled(
      'Βάρος (kg)',
      inputEl(
        { value: numOpt(state.metaWeight), type: 'number', step: '0.01', min: '0' },
        (v) => (state.metaWeight = parseOptNum(v)),
      ),
    ),
  )
  meta.appendChild(
    labeled(
      'Link',
      inputEl(
        { value: state.metaLink ?? '', type: 'url' },
        (v) => (state.metaLink = v.trim() || undefined),
      ),
    ),
  )
  meta.appendChild(
    labeled(
      'Εγγύηση',
      inputEl(
        { value: state.metaWarranty ?? '' },
        (v) => (state.metaWarranty = v.trim() || undefined),
      ),
    ),
  )

  card.appendChild(meta)

  // ====================================================================
  // Conversion panel — only renders when the warehouse unit differs from
  // the billing unit. Shows the detected/manual m²/τεμ. factor, the derived
  // warehouse quantity, and the derived price, so the user can see (and
  // override) the math that'll go out to the API.
  // ====================================================================
  const billingKind = canonicalFromUnitId(ctx.units, state.billingUnitId)
  const warehouseKind = canonicalFromUnitId(ctx.units, state.unitId)
  if (billingKind && warehouseKind && billingKind !== warehouseKind) {
    const panel = h('div', { class: 'conversion-panel' })

    const head = h('div', { class: 'conversion-head' })
    const billingAbbr =
      ctx.units.find((u) => u.id === state.billingUnitId)?.abbreviation ?? '?'
    const warehouseAbbr =
      ctx.units.find((u) => u.id === state.unitId)?.abbreviation ?? '?'
    head.textContent = `Μετατροπή: ${state.billingQuantity} ${billingAbbr} × ${state.billingPrice}€ → ${state.quantity} ${warehouseAbbr} × ${state.purchasePrice}€`
    panel.appendChild(head)

    // m²/τεμ. input — editable. Auto-filled from name when SQM↔PIECES.
    if (
      (billingKind === 'SQM' && warehouseKind === 'PIECES') ||
      (billingKind === 'PIECES' && warehouseKind === 'SQM')
    ) {
      const row = h('div', { class: 'conversion-row' })
      row.appendChild(h('span', { class: 'conversion-label' }, 'm² ανά τεμάχιο:'))
      const sqmInput = h('input', {
        type: 'number',
        step: '0.001',
        min: '0',
        value: state.sqmPerItem != null ? String(state.sqmPerItem) : '',
      } as Partial<HTMLInputElement>)
      sqmInput.className = 'conversion-input'
      sqmInput.placeholder = 'π.χ. 2.624'
      sqmInput.addEventListener('change', () => {
        const v = Number(sqmInput.value)
        state.sqmPerItem = Number.isFinite(v) && v > 0 ? v : undefined
        applyConversion(state, ctx, rerender)
      })
      row.appendChild(sqmInput)
      // Show auto-detection source if we found one.
      const auto = parseAreaFromName(state.name)
      if (auto) {
        row.appendChild(
          h(
            'span',
            { class: 'conversion-hint' },
            `(αυτόματα από: ${auto.source} = ${auto.areaSqm} m²)`,
          ),
        )
      }
      panel.appendChild(row)
    }

    const warning = (state as LineState & { _conversionWarning?: string })._conversionWarning
    if (warning) {
      panel.appendChild(h('div', { class: 'conversion-warn' }, warning))
    }

    card.appendChild(panel)
  }

  // ====================================================================
  // Section: Διαθεσιμότητα
  // ====================================================================
  card.appendChild(sectionHead('Διαθεσιμότητα'))
  const stock = h('div', { class: 'grid' })

  stock.appendChild(
    labeled(
      'Αποθήκη',
      selectEl(
        [{ value: '', label: 'Καμία' }, ...ctx.warehouses.map((w) => ({ value: w.id, label: w.name }))],
        state.warehouseId ?? '',
        (v) => (state.warehouseId = v || undefined),
      ),
    ),
  )
  stock.appendChild(
    labeled(
      'Ποσότητα',
      inputEl({ value: String(state.quantity), type: 'number', step: '0.01' }, (v) => (state.quantity = Number(v))),
    ),
  )
  stock.appendChild(
    labeled(
      'Όριο αποθέματος',
      inputEl(
        { value: String(state.stockThreshold), type: 'number', step: '1' },
        (v) => (state.stockThreshold = Number(v)),
      ),
    ),
  )

  const checkBox = h('div', { class: 'check-cell' })
  checkBox.appendChild(
    labelInline('Χωρίς όριο', checkboxEl(state.noStockThreshold, (v) => (state.noStockThreshold = v))),
  )
  checkBox.appendChild(labelInline('Ενεργό', checkboxEl(state.active, (v) => (state.active = v))))
  stock.appendChild(checkBox)

  card.appendChild(stock)

  // ====================================================================
  // Section: Τιμές
  // ====================================================================
  card.appendChild(sectionHead('Τιμή αγοράς – πώλησης'))
  const prices = h('div', { class: 'grid' })

  // Build the three linked inputs up front so we can wire cross-updates —
  // changing purchase or markup recomputes the sale; directly editing sale
  // leaves markup alone (the user is committing to that exact price).
  const purchaseInput = h('input', {
    value: String(state.purchasePrice),
    type: 'number',
    step: '0.01',
  } as Partial<HTMLInputElement>)
  const markupInput = h('input', {
    value: String(state.markupPercent),
    type: 'number',
    step: '0.1',
    min: '0',
  } as Partial<HTMLInputElement>)
  const saleInput = h('input', {
    value: String(state.salePrice),
    type: 'number',
    step: '0.01',
  } as Partial<HTMLInputElement>)

  const recomputeSale = () => {
    const sale = round2(state.purchasePrice * (1 + state.markupPercent / 100))
    state.salePrice = sale
    saleInput.value = String(sale)
  }

  purchaseInput.addEventListener('input', () => {
    state.purchasePrice = Number(purchaseInput.value) || 0
    recomputeSale()
  })
  markupInput.addEventListener('input', () => {
    const raw = Number(markupInput.value)
    state.markupPercent = Number.isFinite(raw) && raw >= 0 ? raw : 0
    recomputeSale()
  })
  saleInput.addEventListener('input', () => {
    // Direct sale edit — trust the user. Don't back-calculate markup because
    // that jitters the markup field on every keystroke; let the next markup
    // change be the source of truth.
    state.salePrice = Number(saleInput.value) || 0
  })

  prices.appendChild(labeled('Τιμή αγοράς', purchaseInput))
  prices.appendChild(
    labeled(
      'ΦΠΑ αγοράς',
      selectEl(
        ctx.taxes.map((t) => ({ value: t.id, label: `${t.rate}%` })),
        state.purchaseTaxId ?? '',
        (v) => (state.purchaseTaxId = v || undefined),
      ),
    ),
  )
  prices.appendChild(labeled('Markup (%)', markupInput))
  prices.appendChild(labeled('Τιμή πώλησης', saleInput))
  prices.appendChild(
    labeled(
      'ΦΠΑ πώλησης',
      selectEl(
        ctx.taxes.map((t) => ({ value: t.id, label: `${t.rate}%` })),
        state.saleTaxId ?? '',
        (v) => (state.saleTaxId = v || undefined),
      ),
    ),
  )
  prices.appendChild(
    labeled(
      'Έκπτωση πώλησης (%)',
      inputEl(
        { value: String(state.saleDiscountPercent), type: 'number', step: '0.1', min: '0' },
        (v) => (state.saleDiscountPercent = Number(v)),
      ),
    ),
  )

  const includeVat = h('div', { class: 'check-cell col-2' })
  includeVat.appendChild(
    labelInline(
      'Οι τιμές περιλαμβάνουν το ΦΠΑ',
      checkboxEl(state.pricesIncludeVat, (v) => (state.pricesIncludeVat = v)),
    ),
  )
  prices.appendChild(includeVat)

  card.appendChild(prices)

  // ====================================================================
  // Section: myData
  // ====================================================================
  card.appendChild(sectionHead('myData'))
  const mydata = h('div', { class: 'grid' })
  mydata.appendChild(
    labeled(
      'Κατηγορία εσόδων (χονδρική)',
      selectEl(MYDATA_INCOME_CATEGORIES, state.mydataIncomeCategory, (v) => (state.mydataIncomeCategory = v)),
    ),
  )
  mydata.appendChild(
    labeled(
      'Τύπος εσόδων (χονδρική)',
      selectEl(MYDATA_INCOME_TYPES, state.mydataIncomeType, (v) => (state.mydataIncomeType = v)),
    ),
  )
  mydata.appendChild(
    labeled(
      'Κατηγορία εσόδων (λιανική)',
      selectEl(MYDATA_INCOME_CATEGORIES, state.mydataIncomeRetailCategory, (v) => (state.mydataIncomeRetailCategory = v)),
    ),
  )
  mydata.appendChild(
    labeled(
      'Τύπος εσόδων (λιανική)',
      selectEl(MYDATA_INCOME_TYPES, state.mydataIncomeRetailType, (v) => (state.mydataIncomeRetailType = v)),
    ),
  )
  card.appendChild(mydata)

  // ====================================================================
  // Section: Σημειώσεις
  // ====================================================================
  card.appendChild(sectionHead('Σημειώσεις'))
  const notesArea = document.createElement('textarea')
  notesArea.value = state.notes
  notesArea.placeholder = 'Προαιρετικές σημειώσεις…'
  notesArea.addEventListener('input', () => (state.notes = notesArea.value))
  card.appendChild(notesArea)

  // ====================================================================
  // Match candidates + errors
  // ====================================================================
  if (state.candidates && state.candidates.length) {
    card.appendChild(
      h(
        'div',
        { class: 'note' },
        `Υποψήφια: ${state.candidates
          .slice(0, 3)
          .map((p) => `${p.code ?? ''} ${p.name}`)
          .join(' · ')}`,
      ),
    )
  }

  if (state.error) {
    card.appendChild(h('div', { class: 'err' }, state.error))
    if (state.validation) {
      for (const [field, msgs] of Object.entries(state.validation)) {
        card.appendChild(h('div', { class: 'err' }, `${field}: ${msgs.join(', ')}`))
      }
    }
  }

  return card
}

function sectionHead(title: string): HTMLElement {
  return h('div', { class: 'section-head' }, title)
}

function checkboxEl(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = checked
  cb.addEventListener('change', () => onChange(cb.checked))
  return cb
}

function labelInline(text: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'inline-label'
  wrap.appendChild(control)
  wrap.appendChild(h('span', {}, text))
  return wrap
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = h('label', {})
  wrap.appendChild(h('span', {}, label))
  wrap.appendChild(control)
  return wrap
}

function inputEl(
  props: Partial<HTMLInputElement> & { class?: string },
  onChange: (val: string) => void,
): HTMLInputElement {
  const input = h('input', props as Partial<HTMLInputElement>)
  input.addEventListener('input', () => onChange(input.value))
  return input
}

function readOnlyEl(text: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'read-only-cell'
  div.textContent = text
  return div
}

function selectEl(
  options: Array<{ value: string; label: string }>,
  selected: string,
  onChange: (val: string) => void,
): HTMLSelectElement {
  const select = document.createElement('select')
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    if (opt.value === selected) o.selected = true
    select.appendChild(o)
  }
  select.addEventListener('change', () => onChange(select.value))
  return select
}

/**
 * Combobox / searchable-select — renders as an input + absolute dropdown that
 * filters on every keystroke. Used for long option lists (categories especially)
 * where scrolling a native <select> is painful. Key behaviors:
 *   - Focus opens the list with no filter, so the user sees everything first.
 *   - Typing filters case- and accent-insensitively.
 *   - Click / Enter / ArrowDown+Enter commits a selection.
 *   - Escape or blur without a selection restores the original label.
 *   - `value` binding is kept via a closure — `onChange` is the single source of truth.
 */
function searchableSelectEl(
  options: Array<{ value: string; label: string }>,
  selected: string,
  placeholder: string,
  onChange: (val: string) => void,
): HTMLElement {
  const wrap = h('div', { class: 'searchable-select' })
  const input = h('input', {
    type: 'text',
    class: 'searchable-select-input draft-input',
    placeholder,
  } as Partial<HTMLInputElement>)
  input.autocomplete = 'off'
  const arrow = h('span', { class: 'searchable-select-arrow' }, '▾')
  const list = h('div', { class: 'searchable-select-list' })

  let currentValue = selected
  let highlightIdx = -1
  let isOpen = false

  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? ''
  input.value = labelFor(currentValue)

  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  const getFiltered = (): Array<{ value: string; label: string }> => {
    const q = normalize(input.value.trim())
    if (!q) return options
    return options.filter((o) => normalize(o.label).includes(q))
  }

  const renderList = () => {
    list.innerHTML = ''
    const filtered = getFiltered()
    filtered.forEach((opt, i) => {
      const item = h('div', {
        class: 'searchable-select-item' + (i === highlightIdx ? ' highlighted' : ''),
      })
      if (opt.value === currentValue) item.classList.add('selected')
      item.textContent = opt.label
      // mousedown fires before blur — commits before the dropdown closes.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        commit(opt.value)
      })
      list.appendChild(item)
    })
    if (!filtered.length) {
      list.appendChild(h('div', { class: 'searchable-select-empty' }, 'Καμία αντιστοίχιση'))
    }
  }

  const open = () => {
    if (isOpen) return
    isOpen = true
    arrow.textContent = '▴'
    list.style.display = 'block'
    // On open, start with the full list regardless of the current label in the
    // input — the user should see everything first, not filter by the
    // currently-selected label.
    input.value = ''
    highlightIdx = -1
    renderList()
  }

  const close = (restore = true) => {
    if (!isOpen) return
    isOpen = false
    arrow.textContent = '▾'
    list.style.display = 'none'
    if (restore) input.value = labelFor(currentValue)
  }

  const commit = (v: string) => {
    currentValue = v
    input.value = labelFor(v)
    onChange(v)
    close(false)
    input.blur()
  }

  input.addEventListener('focus', () => open())
  input.addEventListener('blur', () => {
    // Delay so mousedown on an item can finish committing before we close.
    setTimeout(() => close(true), 120)
  })
  input.addEventListener('input', () => {
    if (!isOpen) open()
    highlightIdx = -1
    renderList()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close(true)
      input.blur()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const filtered = getFiltered()
      const pick = filtered[highlightIdx >= 0 ? highlightIdx : 0]
      if (pick) commit(pick.value)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen) open()
      const n = getFiltered().length
      highlightIdx = Math.min(highlightIdx + 1, n - 1)
      renderList()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlightIdx = Math.max(highlightIdx - 1, -1)
      renderList()
    }
  })
  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (isOpen) close(true)
    else input.focus()
  })

  wrap.appendChild(input)
  wrap.appendChild(arrow)
  wrap.appendChild(list)
  return wrap
}

function resolveTaxId(taxes: Tax[], percent: number | undefined): Id | undefined {
  if (percent == null) return undefined
  const match = taxes.find((t) => Math.round(t.rate) === Math.round(percent))
  return match?.id
}

/**
 * Apply a SQM↔PIECES conversion to a line's state in-place, then re-render
 * the card so the computed quantity/price show up. Called whenever either
 * unit dropdown changes OR the m²/τεμ. input is edited. If the conversion
 * returns a warning (e.g. dimensions missing), stash it on the state so the
 * next render can surface it in the conversion panel.
 */
function applyConversion(
  state: LineState,
  ctx: LookupContext,
  rerender: () => void,
): void {
  const result = computeConversion(ctx.units, state)
  state.quantity = result.quantity
  state.purchasePrice = result.price
  // Rebuild sale price off the converted purchase + current markup so the
  // downstream POST sends a coherent pair.
  state.salePrice = round2(state.purchasePrice * (1 + state.markupPercent / 100))
  ;(state as LineState & { _conversionWarning?: string })._conversionWarning = result.warning
  rerender()
}

/**
 * Resolve the markup % to apply for a given category. Per-category override
 * wins when present, otherwise the global default. Called both at state
 * init time and when the user changes a line's category in the UI.
 */
function resolveMarkup(
  categoryId: Id | undefined,
  defaults: LookupContext['defaults'],
): number {
  if (categoryId) {
    const override = defaults.category_markup_percents?.[categoryId]
    if (typeof override === 'number' && Number.isFinite(override)) return override
  }
  return defaults.markup_percent ?? 25
}

/**
 * Canonicalize a unit abbreviation. Both the scraper output ("TMX" from the
 * AADE modal) and the stored `abbreviation` on each MeasurementUnit go through
 * the same mapping so Latin/Greek/lookalike forms match the same concept.
 */
const UNIT_CANONICAL: Record<string, string> = {
  // Pieces (τεμάχια) — TMX is the Greek "ΤΜΧ" written with Latin lookalikes
  tmx: 'PIECES',
  τμχ: 'PIECES',
  τεμ: 'PIECES',
  tem: 'PIECES',
  pcs: 'PIECES',
  piece: 'PIECES',
  pieces: 'PIECES',
  εα: 'PIECES',
  ea: 'PIECES',
  // Square meters
  τμ: 'SQM',
  sqm: 'SQM',
  m2: 'SQM',
  // Meters
  μ: 'METERS',
  m: 'METERS',
  meters: 'METERS',
  // Cubic meters
  κυβ: 'CBM',
  cbm: 'CBM',
  m3: 'CBM',
  // Kilograms
  kg: 'KG',
  κιλ: 'KG',
  κγ: 'KG',
  κ: 'KG',
  // Liters
  l: 'LITER',
  λ: 'LITER',
  lt: 'LITER',
  lit: 'LITER',
}

function normalizeUnitLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-zα-ω0-9]+/g, '') // strip punctuation + spaces (keep Greek + Latin letters + digits)
    .trim()
}

function canonicalizeUnit(s: string): string | null {
  const norm = normalizeUnitLabel(s)
  return UNIT_CANONICAL[norm] ?? null
}

/**
 * Resolve a MeasurementUnit id to its canonical kind ('SQM', 'PIECES', ...).
 * Used by the conversion logic to decide whether to run sqm→piece math.
 */
function canonicalFromUnitId(units: MeasurementUnit[], id: Id | undefined): string | null {
  if (!id) return null
  const u = units.find((x) => x.id === id)
  if (!u) return null
  return (
    (u.abbreviation && canonicalizeUnit(u.abbreviation)) ||
    (u.abbreviation_en && canonicalizeUnit(u.abbreviation_en)) ||
    (u.title && canonicalizeUnit(u.title)) ||
    null
  )
}

/**
 * Given a line's billing side (invoice qty/price) and a desired warehouse
 * unit, compute the warehouse qty/price. Only the SQM→PIECES conversion is
 * implemented automatically (the one the user asked for); other pairings
 * keep the billing values as-is. Returns the computed values plus an
 * optional warning when the conversion couldn't run.
 */
function computeConversion(
  units: MeasurementUnit[],
  state: LineState,
): { quantity: number; price: number; warning?: string } {
  const billingKind = canonicalFromUnitId(units, state.billingUnitId)
  const warehouseKind = canonicalFromUnitId(units, state.unitId)

  // Same canonical kind (or either unknown) → pass through the invoice values.
  if (!billingKind || !warehouseKind || billingKind === warehouseKind) {
    return { quantity: state.billingQuantity, price: state.billingPrice }
  }

  if (billingKind === 'SQM' && warehouseKind === 'PIECES') {
    const factor = state.sqmPerItem
    if (!factor || factor <= 0) {
      return {
        quantity: state.billingQuantity,
        price: state.billingPrice,
        warning:
          'Δεν εντοπίστηκαν διαστάσεις στο όνομα για να υπολογιστεί αυτόματα m²/τεμ. — συμπλήρωσέ το πεδίο παρακάτω.',
      }
    }
    return {
      quantity: round2(state.billingQuantity / factor),
      price: round2(state.billingPrice * factor),
    }
  }

  if (billingKind === 'PIECES' && warehouseKind === 'SQM') {
    const factor = state.sqmPerItem
    if (!factor || factor <= 0) {
      return {
        quantity: state.billingQuantity,
        price: state.billingPrice,
        warning:
          'Δεν εντοπίστηκαν διαστάσεις στο όνομα για να υπολογιστεί αυτόματα m²/τεμ. — συμπλήρωσέ το πεδίο παρακάτω.',
      }
    }
    return {
      quantity: round2(state.billingQuantity * factor),
      price: round2(state.billingPrice / factor),
    }
  }

  // Unsupported conversion pair — leave billing values and warn.
  return {
    quantity: state.billingQuantity,
    price: state.billingPrice,
    warning: `Δεν υποστηρίζεται αυτόματη μετατροπή ${billingKind}↔${warehouseKind}. Προσάρμοσε ποσότητα/τιμή manually.`,
  }
}

function resolveUnitId(units: MeasurementUnit[], label: string | undefined): Id | undefined {
  if (!label) return undefined
  const target = canonicalizeUnit(label)
  if (!target) return undefined
  for (const u of units) {
    const fields = [u.abbreviation, u.abbreviation_en]
    for (const f of fields) {
      if (!f) continue
      if (canonicalizeUnit(f) === target) return u.id
    }
  }
  return undefined
}

async function suggestSku(
  description: string,
  categories: ProductCategory[],
  catId?: Id,
  offset = 0,
): Promise<string> {
  const catName = categories.find((c) => c.id === catId)?.name
  const res = (await sendMessage({
    type: 'flow1/suggest-sku',
    description,
    categoryName: catName,
    offset,
  })) as { ok: true; sku: string } | { ok: false; error: string }
  if (res.ok) return res.sku
  return ''
}

async function detectLine(line: ScrapedInvoiceLine): Promise<
  | { status: 'exists'; product: Product }
  | { status: 'candidate'; candidates: Product[] }
  | { status: 'new' }
> {
  const res = (await sendMessage({
    type: 'search/catalog',
    query: line.supplier_code || line.description,
    limit: 3,
  })) as { ok: true; results: import('@/shared/messages').SearchResults } | { ok: false; error: string }
  if (!res.ok) return { status: 'new' }
  if (res.results.exact.length) return { status: 'exists', product: res.results.exact[0]!.product }
  if (res.results.fuzzy.length) return { status: 'candidate', candidates: res.results.fuzzy.map((h) => h.product) }
  return { status: 'new' }
}
