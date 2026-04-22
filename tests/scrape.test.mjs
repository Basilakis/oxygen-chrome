import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(__dirname, 'fixtures/invoice-modal.html'), 'utf8')
const { window } = new JSDOM(html, { url: 'http://localhost/' })

// Install globals the scraper expects
globalThis.document = window.document
globalThis.Node = window.Node
globalThis.Element = window.Element
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLTableElement = window.HTMLTableElement
globalThis.HTMLTableCellElement = window.HTMLTableCellElement
globalThis.HTMLTableRowElement = window.HTMLTableRowElement

const { findModalRoot, scrapeInvoiceModal } = await import('../src/content/scraper/invoice-modal.ts')

const root = findModalRoot()
if (!root) {
  console.error('❌ findModalRoot returned null')
  process.exit(1)
}

const invoice = scrapeInvoiceModal(root)
console.log(JSON.stringify(invoice, null, 2))

function assert(cond, msg) {
  if (!cond) {
    console.error('❌', msg)
    process.exit(1)
  }
  console.log('✓', msg)
}

assert(invoice !== null, 'scrapeInvoiceModal returned a value')
assert(invoice.lines.length === 1, 'extracted exactly 1 product line (no separators/totals leaked)')

const line = invoice.lines[0]
assert(line.supplier_code === '0444-0412020003', `supplier_code = ${line.supplier_code}`)
assert(line.description.startsWith('ΜΑΣΤΟΙ ΑΡΣ.'), `description = ${line.description}`)
assert(line.unit_label === 'TMX', `unit_label = ${line.unit_label}`)
assert(line.quantity === 6, `quantity = ${line.quantity}`)
assert(line.unit_price === 2.42, `unit_price = ${line.unit_price}`)
assert(line.line_net === 14.52, `line_net = ${line.line_net}`)
assert(line.vat_percent === 24, `vat_percent = ${line.vat_percent}`)
assert(line.line_total === 18.0, `line_total = ${line.line_total}`)

assert(invoice.totals.net === 14.52, `totals.net = ${invoice.totals.net}`)
assert(invoice.totals.vat === 3.48, `totals.vat = ${invoice.totals.vat}`)
assert(invoice.totals.gross === 18.0, `totals.gross = ${invoice.totals.gross}`)

// Header fields are absent in this fixture — nothing should be falsely populated.
assert(invoice.supplier_vat === '', `supplier_vat empty (got ${JSON.stringify(invoice.supplier_vat)})`)
assert(invoice.number === undefined, `number undefined (got ${JSON.stringify(invoice.number)})`)
assert(invoice.date === undefined, `date undefined (got ${JSON.stringify(invoice.date)})`)
assert(invoice.series === undefined, `series undefined (got ${JSON.stringify(invoice.series)})`)
assert(invoice.mark === undefined, `mark undefined (got ${JSON.stringify(invoice.mark)})`)

console.log('\nAll assertions passed.')
