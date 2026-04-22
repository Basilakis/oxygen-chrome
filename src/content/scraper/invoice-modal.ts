import type { ScrapedInvoice, ScrapedInvoiceLine } from '@/shared/messages'
import { parseMoney } from '@/shared/util'
import { MODAL_HEADING_GREEK } from '@/shared/constants'

/**
 * Label-anchored scraper for Oxygen's "Προβολή Παραστατικού" (AADE document view) modal.
 *
 * Anchors (in order):
 *   1. table.tableThinOpen — Oxygen's line-items table has this distinctive class.
 *   2. The first <tr> inside the table is the header (it has <b> cells with label text).
 *   3. Body rows are product rows iff they have no colspan cells, the right column count,
 *      and a numeric line number in the first cell.
 *   4. Totals rows carry colspan=8 label + single value cell; we read them separately.
 *
 * Header comparisons are accent-insensitive and punctuation-insensitive so abbreviated
 * Greek caps (ΚΩΔ., ΠΟΣΟΤ., ΤΙΜ. ΜΟΝ.) match the canonical forms.
 */

const HEADER_LABELS: Record<keyof Omit<ScrapedInvoice, 'lines' | 'totals'>, string[]> = {
  supplier_vat: ['ΑΦΜ', 'Α.Φ.Μ.', 'VAT', 'ΑΦΜ Εκδότη', 'ΑΦΜ εκδότη'],
  document_type: ['Είδος', 'Είδος Παραστατικού', 'Τύπος', 'Παραστατικό'],
  series: ['Σειρά'],
  number: ['Αριθμός', 'Αρ.', 'Α/Α'],
  date: ['Ημερομηνία', 'Ημ/νία', 'Ημερ.'],
  mark: ['Μ.ΑΡ.Κ.', 'ΜΑΡΚ', 'MARK'],
  uid: ['UID', 'Αναγνωριστικό'],
}

const LINE_HEADERS = {
  supplier_code: ['ΚΩΔ', 'Κωδικός', 'Κωδ', 'Code'],
  description: ['ΠΕΡΙΓΡΑΦΗ', 'Περιγραφή', 'Είδος', 'Description'],
  unit_label: ['ΜΜ', 'Μ.Μ.', 'Μονάδα', 'Unit'],
  quantity: ['ΠΟΣΟΤ', 'Ποσότητα', 'Ποσ', 'Qty', 'Quantity'],
  unit_price: ['ΤΙΜ. ΜΟΝ', 'ΤΙΜ ΜΟΝ', 'Τιμή Μονάδας', 'Τιμή', 'Τ. Μονάδας', 'Unit Price'],
  line_net: ['ΑΞΙΑ', 'Καθαρή αξία', 'Αξία', 'Net', 'Net Amount'],
  vat_percent: ['ΦΠΑ', 'VAT'],
  line_total: ['ΣΥΝΟΛΟ', 'Σύνολο', 'Total'],
} as const

type LineField = keyof typeof LINE_HEADERS

/* ------------------------------------------------------------------ utils -- */

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .replace(/[.:·]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function labelMatches(cellText: string, label: string): boolean {
  const c = normalize(cellText)
  const l = normalize(label)
  if (!c || !l) return false
  return c === l || c.startsWith(l) || c.includes(l)
}

function hasAnyColspan(row: HTMLTableRowElement): boolean {
  return Array.from(row.cells).some((c) => c.hasAttribute('colspan'))
}

/* ---------------------------------------------------------------- anchors -- */

export function findModalRoot(): HTMLElement | null {
  // 1. Heading-based anchor — but climb up until the ancestor ALSO contains the
  //    line-items table (or looks like a dialog). Otherwise a header-only wrapper
  //    like <div class="popHeader"> would be returned and scraping fails.
  const headings = document.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, .modal-title, .k-window-title',
  )
  for (const node of headings) {
    const text = (node.textContent ?? '').trim()
    if (!text) continue
    if (!text.includes(MODAL_HEADING_GREEK) && !/Προβολή\s+Παραστατικού/i.test(text)) continue
    let el: HTMLElement | null = node as HTMLElement
    while (el) {
      if (el.matches('[role="dialog"], .modal, .k-window, .k-dialog, .popup, .popBody, .popup-body, .modal-body')) {
        return el
      }
      if (el.querySelector('table.tableThinOpen')) return el
      el = el.parentElement
    }
  }
  // 2. Distinctive table fallback — find the Oxygen line-items table anywhere on the
  //    page and walk up to its enclosing dialog/modal wrapper.
  const table = document.querySelector('table.tableThinOpen')
  if (table) {
    let el: HTMLElement | null = table as HTMLElement
    while (el) {
      if (el.matches('[role="dialog"], .modal, .k-window, .k-dialog, .popup, .popBody, .popup-body, .modal-body')) {
        return el
      }
      el = el.parentElement
    }
    // Last resort: closest generic div
    const d = table.closest('div')
    if (d instanceof HTMLElement) return d
  }
  return null
}

function pickTable(root: HTMLElement): HTMLTableElement | null {
  // Score every table by how many product-line headers the FIRST ROW contains,
  // then pick the best. A page can have several `table.tableThinOpen` (e.g.
  // invoice-metadata table with ΝΟΜΙΣΜΑ/ΗΜΝ/ΝΙΑ/ΜΑΡΚ, supplier table, etc.);
  // only one is the line items. The first-row check is key — using full-table
  // text can score metadata tables too high when they happen to mention ΦΠΑ in
  // totals, etc.
  const tables = Array.from(root.querySelectorAll('table')) as HTMLTableElement[]
  if (!tables.length) return null

  let best: HTMLTableElement | null = null
  let bestScore = -1
  const details: Array<{ score: number; classes: string; headers: string }> = []
  for (const t of tables) {
    const firstRow = t.rows[0]
    if (!firstRow) continue
    const headerText = textOf(firstRow)
    const score =
      +/ΠΕΡΙΓΡΑΦΗ|Περιγραφή|Description/i.test(headerText) * 5 +
      +/ΠΟΣΟΤ|Ποσότητα|Qty/i.test(headerText) * 4 +
      +/ΤΙΜ\.?\s*ΜΟΝ|Τιμή|Unit\s*Price/i.test(headerText) * 3 +
      +/ΦΠΑ|VAT/i.test(headerText) * 2 +
      +/ΚΩΔ|Κωδικός|Code/i.test(headerText) * 2 +
      +/ΣΥΝΟΛΟ|Total/i.test(headerText) +
      (t.className.includes('tableThinOpen') ? 2 : 0) +
      Math.min(t.rows.length, 10) * 0.2
    details.push({ score, classes: t.className, headers: headerText.slice(0, 80) })
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  console.log('[oxygen-helper:scraper] pickTable scored candidates:', details)
  // Require at least ΠΕΡΙΓΡΑΦΗ + one other line-item header to accept the
  // winner. Otherwise there's no line-items table on this page.
  if (bestScore < 6) {
    console.log('[oxygen-helper:scraper] pickTable: best score too low — no line-items table')
    return null
  }
  return best
}

/* ---------------------------------------------------------- header parser -- */

function findHeaderRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const rows = Array.from(table.rows)
  for (const row of rows) {
    if (hasAnyColspan(row)) continue
    const cellTexts = Array.from(row.cells).map((c) => textOf(c))
    let matches = 0
    for (const labels of Object.values(LINE_HEADERS)) {
      if (cellTexts.some((t) => labels.some((l) => labelMatches(t, l)))) matches += 1
    }
    if (matches >= 3) return row
  }
  // Fallback: first non-colspan row
  return rows.find((r) => !hasAnyColspan(r)) ?? null
}

function resolveHeaderIndexes(headerRow: HTMLTableRowElement): Partial<Record<LineField, number>> {
  const cells = Array.from(headerRow.cells).map((c) => textOf(c))
  const idx: Partial<Record<LineField, number>> = {}
  for (const [key, labels] of Object.entries(LINE_HEADERS) as Array<[LineField, readonly string[]]>) {
    const i = cells.findIndex((c) => labels.some((l) => labelMatches(c, l)))
    if (i >= 0) idx[key] = i
  }
  return idx
}

/* ------------------------------------------------------------- vat parser -- */

function parseVatCell(td: HTMLTableCellElement | undefined): {
  amount?: number
  rate?: number
} {
  if (!td) return {}
  const rateDiv = td.querySelector('div')
  const rateText = rateDiv ? textOf(rateDiv) : ''
  let amountText = ''
  for (const node of Array.from(td.childNodes)) {
    if (node === rateDiv) continue
    amountText += node.textContent ?? ''
  }
  const amount = parseMoney(amountText)
  const rate = rateText ? parseMoney(rateText.replace(/%/g, '')) : undefined
  return {
    amount: Number.isFinite(amount) ? amount : undefined,
    rate: rate !== undefined && Number.isFinite(rate) ? rate : undefined,
  }
}

/* ---------------------------------------------------- totals extraction -- */

function extractTotals(table: HTMLTableElement): ScrapedInvoice['totals'] {
  const totals: ScrapedInvoice['totals'] = {}
  const labelMap: Array<[string[], keyof NonNullable<ScrapedInvoice['totals']>]> = [
    [['ΚΑΘΑΡΗ ΑΞΙΑ', 'Καθαρή αξία', 'Net'], 'net'],
    [['ΑΞΙΑ ΦΠΑ', 'ΦΠΑ', 'VAT'], 'vat'],
    [['ΣΥΝΟΛΙΚΗ ΑΞΙΑ', 'Γενικό Σύνολο', 'Τελικό Σύνολο', 'Σύνολο', 'Total'], 'gross'],
  ]
  for (const row of Array.from(table.rows)) {
    const labelCell = Array.from(row.cells).find((c) => c.hasAttribute('colspan'))
    if (!labelCell) continue
    const labelText = textOf(labelCell)
    const valueCell = Array.from(row.cells).find((c) => !c.hasAttribute('colspan'))
    if (!valueCell) continue
    for (const [labels, key] of labelMap) {
      if (labels.some((l) => labelMatches(labelText, l))) {
        totals[key] = parseMoney(textOf(valueCell))
        break
      }
    }
  }
  return totals
}

/* --------------------------------------------------------- header fields -- */

function findValueByLabel(root: HTMLElement, labels: string[]): string | undefined {
  const labelPattern = new RegExp(
    `(?:^|[\\s>])(${labels.map(escape).join('|')})\\s*[:：]\\s*(.+)`,
    'i',
  )
  const candidates = root.querySelectorAll('dt, dd, label, span, td, th, div, p, b')
  // strategy 1: inline "Label: value" in the same element — requires an explicit colon
  //             so we don't trip on label text that happens to appear mid-sentence.
  for (const el of candidates) {
    const text = textOf(el)
    if (!text || text.length > 200) continue
    const m = text.match(labelPattern)
    if (m && m[2] && m[2].trim()) return m[2].trim()
  }
  // strategy 2: label cell + value-in-next-sibling. Cell text must match a label EXACTLY
  //             (after accent/punctuation normalization) — this avoids e.g. a description
  //             cell containing "ΑΡΣ." matching the "Αρ." label and hijacking the value.
  const normLabels = labels.map(normalize)
  for (const el of candidates) {
    const t = textOf(el)
    if (!t || t.length > 48) continue
    const n = normalize(t)
    if (!normLabels.includes(n)) continue
    const next = el.nextElementSibling
    const nextText = textOf(next)
    if (nextText) return nextText
    const parent = el.parentElement
    if (parent) {
      const cells = Array.from(parent.children)
      const i = cells.indexOf(el as Element)
      if (i >= 0 && cells[i + 1]) return textOf(cells[i + 1])
    }
  }
  return undefined
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* --------------------------------------------------------------- public --- */

function scrapeLines(table: HTMLTableElement): ScrapedInvoiceLine[] {
  const headerRow = findHeaderRow(table)
  if (!headerRow) {
    console.log('[oxygen-helper:scraper] no header row found in table', {
      first_row_cells: Array.from(table.rows[0]?.cells ?? []).map((c) => textOf(c)),
    })
    return []
  }
  const idx = resolveHeaderIndexes(headerRow)
  const expected = headerRow.cells.length
  console.log('[oxygen-helper:scraper] header row', {
    cells: expected,
    header_texts: Array.from(headerRow.cells).map((c) => textOf(c)),
    resolved_indexes: idx,
  })
  const out: ScrapedInvoiceLine[] = []
  const skipReasons: Record<string, number> = {}
  for (const row of Array.from(table.rows)) {
    if (row === headerRow) continue
    const cells = Array.from(row.cells)
    if (cells.length !== expected) {
      skipReasons[`cell_count(${cells.length}vs${expected})`] = (skipReasons[`cell_count(${cells.length}vs${expected})`] ?? 0) + 1
      continue
    }
    if (cells.some((c) => c.hasAttribute('colspan'))) {
      skipReasons['has_colspan'] = (skipReasons['has_colspan'] ?? 0) + 1
      continue
    }
    const first = textOf(cells[0])
    if (!/^\d+$/.test(first)) {
      skipReasons[`first_not_numeric("${first.slice(0, 20)}")`] = (skipReasons[`first_not_numeric("${first.slice(0, 20)}")`] ?? 0) + 1
      continue
    }
    const g = (field: LineField): HTMLTableCellElement | undefined => {
      const i = idx[field]
      return i === undefined ? undefined : cells[i]
    }
    const vat = parseVatCell(g('vat_percent'))
    const description = textOf(g('description'))
    if (!description) {
      skipReasons['empty_description'] = (skipReasons['empty_description'] ?? 0) + 1
      continue
    }
    out.push({
      supplier_code: textOf(g('supplier_code')) || undefined,
      description,
      unit_label: textOf(g('unit_label')) || undefined,
      quantity: parseMoney(textOf(g('quantity'))),
      unit_price: parseMoney(textOf(g('unit_price'))),
      line_net: idx.line_net !== undefined ? parseMoney(textOf(g('line_net'))) : undefined,
      vat_percent: vat.rate,
      line_total: idx.line_total !== undefined ? parseMoney(textOf(g('line_total'))) : undefined,
    })
  }
  if (Object.keys(skipReasons).length) {
    console.log('[oxygen-helper:scraper] skipped row breakdown:', skipReasons)
  }
  console.log('[oxygen-helper:scraper] extracted', out.length, 'product lines')
  return out
}

export function scrapeInvoiceModal(root: HTMLElement): ScrapedInvoice | null {
  console.log('[oxygen-helper:scraper] starting scrape', {
    root_tag: root.tagName,
    root_classes: root.className,
    root_has_tableThinOpen: !!root.querySelector('table.tableThinOpen'),
    doc_has_tableThinOpen: !!document.querySelector('table.tableThinOpen'),
    doc_total_tables: document.querySelectorAll('table').length,
    iframe_count: document.querySelectorAll('iframe').length,
  })

  // If the passed root doesn't contain the line-items table, widen the search so
  // a narrowly-scoped container (e.g. a popHeader div) still yields results.
  let tableSearchRoot: HTMLElement = root
  if (!root.querySelector('table.tableThinOpen') && document.querySelector('table.tableThinOpen')) {
    tableSearchRoot = document.body
    console.log('[oxygen-helper:scraper] widened table search to document.body')
  }
  const table = pickTable(tableSearchRoot)
  console.log('[oxygen-helper:scraper] picked table', {
    found: !!table,
    classes: table?.className,
    rows: table?.rows?.length,
  })

  // Header fields: search the widest sensible scope so labels in sibling panels are reachable.
  const headerSearchRoot: HTMLElement =
    (table?.closest('[role="dialog"], .modal, .k-window, .k-dialog, .popup, .popBody, .popup-body, .modal-body') as HTMLElement | null) ??
    document.body

  const supplierVat = findValueByLabel(headerSearchRoot, HEADER_LABELS.supplier_vat) ?? ''
  const docType = findValueByLabel(headerSearchRoot, HEADER_LABELS.document_type)
  const series = findValueByLabel(headerSearchRoot, HEADER_LABELS.series)
  const number = findValueByLabel(headerSearchRoot, HEADER_LABELS.number)
  const date = findValueByLabel(headerSearchRoot, HEADER_LABELS.date)
  const mark = findValueByLabel(headerSearchRoot, HEADER_LABELS.mark)
  const uid = findValueByLabel(headerSearchRoot, HEADER_LABELS.uid)

  const lines = table ? scrapeLines(table) : []
  const totals = table ? extractTotals(table) : {}

  if (!supplierVat && !lines.length) return null

  return {
    supplier_vat: (supplierVat || '').replace(/\s+/g, ''),
    document_type: docType,
    series,
    number,
    date,
    mark,
    uid,
    lines,
    totals,
  }
}
