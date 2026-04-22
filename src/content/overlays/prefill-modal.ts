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
import { round2 } from '@/shared/util'
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
  }
}

type LineState = {
  checked: boolean
  // Γενικά
  name: string
  sku: string
  type: number
  categoryId?: Id
  unitId?: Id
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
  // Προϊόν με παραλλαγές
  hasVariations: boolean
  variationTypeId?: Id
  variationValueIds: Id[]
  // Internal status
  duplicateStatus: 'new' | 'exists' | 'candidate'
  duplicateProduct?: Product
  candidates?: Product[]
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
  const categories = (catRes as { ok: true; categories: ProductCategory[] }).categories
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

  // Build line states
  const states: LineState[] = []
  for (const line of invoice.lines) {
    const matchRes = await detectLine(line)
    const purchasePrice = line.unit_price || 0
    const salePrice = round2(purchasePrice * (1 + (ctx.defaults.markup_percent ?? 25) / 100))
    const saleTaxId = resolveTaxId(ctx.taxes, line.vat_percent) ?? ctx.defaults.default_vat_id
    const sku = await suggestSku(line.description, categories, ctx.defaults.default_category_id)
    const unitId = resolveUnitId(ctx.units, line.unit_label) ?? ctx.defaults.default_measurement_unit_id
    states.push({
      checked: matchRes.status === 'new',
      // Γενικά
      name: line.description,
      sku,
      type: 3,
      categoryId: ctx.defaults.default_category_id,
      unitId,
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
      // Variations
      hasVariations: false,
      variationValueIds: [],
      // Status
      duplicateStatus: matchRes.status,
      duplicateProduct: matchRes.status === 'exists' ? matchRes.product : undefined,
      candidates: matchRes.status === 'candidate' ? matchRes.candidates : undefined,
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
      if (s.barcode) base.barcode = s.barcode
      if (s.partNumber) {
        base.part_number = s.partNumber       // PC ή PN — manufacturer
        base.mpn_isbn = s.partNumber          // mirror on MPN/ISBN
      }
      if (s.supplierProductCode) base.supplier_code = s.supplierProductCode
      if (s.cpvCode) base.cpv_code = s.cpvCode
      if (s.taricCode) base.taric_code = s.taricCode
      if (s.notes) base.notes = s.notes
      return base
    }

    const payload: Array<Record<string, unknown>> = []
    for (const s of states) {
      if (!s.checked || s.duplicateStatus === 'exists') continue
      if (s.hasVariations && s.variationTypeId && s.variationValueIds.length) {
        const variationType = ctx.variations.find((v) => v.id === s.variationTypeId)
        const base = baseFromState(s)
        s.variationValueIds.forEach((valueId, i) => {
          const valueObj = variationType?.values.find((vv) => vv.id === valueId)
          payload.push({
            ...base,
            name: valueObj?.name ? `${s.name} - ${valueObj.name}` : s.name,
            code: `${s.sku}.${i + 1}`,
            variations: [
              { variation_id: s.variationTypeId, variation_value_id: valueId },
            ],
          })
        })
      } else {
        payload.push({ ...baseFromState(s), name: s.name, code: s.sku })
      }
    }

    const res = (await sendMessage({
      type: 'flow1/create-products',
      supplier_id: supplier.id,
      products: payload as unknown as never,
    })) as { ok: true; results: Array<{ status: 'created' | 'failed'; error?: string; validation?: Record<string, string[]> }> }

    if (!res.ok) {
      submitBtn.disabled = false
      submitBtn.textContent = 'Δημιουργία επιλεγμένων'
      alert(`Αποτυχία: ${(res as unknown as { error: string }).error}`)
      return
    }

    let idx = 0
    for (const s of states) {
      if (!s.checked || s.duplicateStatus === 'exists') continue
      const r = res.results[idx++]
      if (!r) continue
      if (r.status === 'failed') {
        s.error = r.error
        s.validation = r.validation
      } else {
        s.duplicateStatus = 'exists'
        s.checked = false
      }
    }
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
  const checkbox = h('input', {
    type: 'checkbox',
    checked: state.checked && state.duplicateStatus !== 'exists',
    disabled: state.duplicateStatus === 'exists',
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
    card.appendChild(
      h(
        'div',
        { class: 'note' },
        `Ταίριαξε με ${state.duplicateProduct.code} — ${state.duplicateProduct.name}`,
      ),
    )
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
    cb.addEventListener('change', () => {
      state.hasVariations = cb.checked
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

  general.appendChild(
    labeled(
      'Περιγραφή',
      inputEl({ value: state.name, class: 'col-full' }, (v) => {
        state.name = v
        summary.textContent = v || '(χωρίς όνομα)'
      }),
    ),
  )

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
      selectEl(
        [{ value: '', label: 'Χωρίς κατηγορία' }, ...ctx.categories.map((c) => ({ value: c.id, label: c.name }))],
        state.categoryId ?? '',
        (v) => (state.categoryId = v || undefined),
      ),
    ),
  )

  general.appendChild(
    labeled(
      'Μονάδα Μετρ.',
      selectEl(
        [{ value: '', label: 'Χωρίς μονάδα' }, ...ctx.units.map((u) => ({ value: u.id, label: u.abbreviation }))],
        state.unitId ?? '',
        (v) => (state.unitId = v || undefined),
      ),
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

  prices.appendChild(
    labeled(
      'Τιμή αγοράς',
      inputEl(
        { value: String(state.purchasePrice), type: 'number', step: '0.01' },
        (v) => (state.purchasePrice = Number(v)),
      ),
    ),
  )
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
  prices.appendChild(
    labeled(
      'Τιμή πώλησης',
      inputEl(
        { value: String(state.salePrice), type: 'number', step: '0.01' },
        (v) => (state.salePrice = Number(v)),
      ),
    ),
  )
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

function resolveTaxId(taxes: Tax[], percent: number | undefined): Id | undefined {
  if (percent == null) return undefined
  const match = taxes.find((t) => Math.round(t.rate) === Math.round(percent))
  return match?.id
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

async function suggestSku(description: string, categories: ProductCategory[], catId?: Id): Promise<string> {
  const catName = categories.find((c) => c.id === catId)?.name
  const res = (await sendMessage({
    type: 'flow1/suggest-sku',
    description,
    categoryName: catName,
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
