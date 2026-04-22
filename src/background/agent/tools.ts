import {
  BusinessAreas,
  Categories,
  Contacts,
  Drafts,
  Logos,
  MeasurementUnits,
  NumberingSequences,
  PaymentMethods,
  Products,
  Taxes,
  Variations,
  Warehouses,
} from '@/background/storage/stores'
import { search } from '@/background/search'
import { asArray, sumStock } from '@/shared/util'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export const TOOL_DEFS: ToolDefinition[] = [
  {
    name: 'search_catalog',
    description:
      'Search the local product catalog by name, code, barcode, MPN, part number, or supplier code. Returns matches with exact and fuzzy tiers. Use this to find products by description.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query (any language)' },
        limit: { type: 'integer', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description: 'Get full details of a single product by its code (e.g. "1", "2.1") or UUID. Returns null if not found.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Product code or UUID id' },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'get_catalog_stats',
    description:
      'Get summary counts: total products, contacts, suppliers, customers, variation types, drafts. Use this when asked generic "how many" questions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_contacts',
    description:
      'List contacts, optionally filtered by role. Returns a compact list with id, vat_number, company_name, is_supplier, is_client.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['all', 'suppliers', 'customers'],
          default: 'all',
        },
        limit: { type: 'integer', default: 20 },
      },
    },
  },
  {
    name: 'get_contact_by_vat',
    description: 'Look up a single contact by exact VAT number. Returns null if not found.',
    input_schema: {
      type: 'object',
      properties: { vat: { type: 'string' } },
      required: ['vat'],
    },
  },
  {
    name: 'list_taxes',
    description: 'List all VAT rates available in the account.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_warehouses',
    description: 'List all warehouses in the account.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_categories',
    description: 'List all product categories.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_measurement_units',
    description: 'List measurement units (pieces, kg, meters, etc.).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_variations',
    description:
      'List variation types and their possible values (e.g. "ΠΑΧΟΣ ΜΕΛΑΜΙΝΗΣ" → 8, 18, 25).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_drafts',
    description: 'List draft shopping-lists (pinned products waiting to be submitted as notices).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'active', 'submitted', 'archived'], default: 'all' },
      },
    },
  },
  {
    name: 'get_stock_summary',
    description:
      'Get total stock levels across warehouses for a product. Returns per-warehouse quantities and the total. Identify the product by code or id.',
    input_schema: {
      type: 'object',
      properties: { identifier: { type: 'string' } },
      required: ['identifier'],
    },
  },
  {
    name: 'list_numbering_sequences',
    description: 'List numbering sequences (document series used for invoices/notices).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'prepare_invoice_creation',
    description:
      'Call this when the user has attached an invoice (PDF or image) and wants to create products + supplier from it in the Oxygen catalog. Extract the invoice data and pass it in. The UI will open the product-creation form pre-filled with your extraction, where the user reviews and submits. Do not use this tool for general questions — only when the user explicitly wants to CREATE products from an attached invoice.',
    input_schema: {
      type: 'object',
      properties: {
        supplier_vat: { type: 'string', description: '9-digit Greek ΑΦΜ of the supplier (not the customer)' },
        supplier_name: { type: 'string', description: 'Supplier company name' },
        document_type: { type: 'string' },
        series: { type: 'string' },
        number: { type: 'string' },
        date: { type: 'string', description: 'Issue date YYYY-MM-DD' },
        mark: { type: 'string', description: 'myDATA MARK if present' },
        uid: { type: 'string', description: 'Document UID if present' },
        lines: {
          type: 'array',
          description: 'Product lines only — skip totals/VAT breakdown rows at the bottom.',
          items: {
            type: 'object',
            properties: {
              supplier_code: { type: 'string', description: 'ΚΩΔ. column' },
              description: { type: 'string' },
              unit_label: { type: 'string', description: 'TMX, τ.μ., κιλά, etc.' },
              quantity: { type: 'number' },
              unit_price: { type: 'number', description: 'Net unit price (before VAT)' },
              line_net: { type: 'number' },
              vat_percent: { type: 'number', description: '24, 13, 6, or 0' },
              line_total: { type: 'number', description: 'Gross line total (with VAT)' },
            },
            required: ['description', 'quantity', 'unit_price'],
          },
        },
        totals: {
          type: 'object',
          properties: {
            net: { type: 'number' },
            vat: { type: 'number' },
            gross: { type: 'number' },
          },
        },
      },
      required: ['lines'],
    },
  },
]

type ToolInput = Record<string, unknown>

export async function executeTool(name: string, input: ToolInput): Promise<unknown> {
  try {
    switch (name) {
      case 'search_catalog': {
        const query = String(input.query ?? '')
        const limit = Number(input.limit ?? 10)
        const results = await search(query, limit)
        return {
          query: results.query,
          exact: results.exact.map((h) => compactProduct(h.product)),
          fuzzy: results.fuzzy.map((h) => compactProduct(h.product)),
        }
      }
      case 'get_product': {
        const ident = String(input.identifier ?? '')
        // Try code first (most common), then UUID
        let product = await Products.findByCode(ident)
        if (!product) product = await Products.get(ident)
        if (!product) return { found: false }
        return { found: true, product: fullProduct(product) }
      }
      case 'get_catalog_stats': {
        const [products, contacts, taxes, warehouses, categories, units, ns, vars, draftsAll] = await Promise.all([
          Products.count(),
          Contacts.count(),
          Taxes.count(),
          Warehouses.count(),
          Categories.count(),
          MeasurementUnits.count(),
          NumberingSequences.count(),
          Variations.count(),
          Drafts.all(),
        ])
        const allContacts = await Contacts.all()
        return {
          products,
          contacts,
          suppliers: allContacts.filter((c) => c.is_supplier).length,
          customers: allContacts.filter((c) => c.is_client).length,
          taxes,
          warehouses,
          categories,
          measurement_units: units,
          numbering_sequences: ns,
          variations: vars,
          drafts: draftsAll.length,
          active_drafts: draftsAll.filter((d) => d.status === 'active').length,
        }
      }
      case 'list_contacts': {
        const filter = String(input.filter ?? 'all')
        const limit = Number(input.limit ?? 20)
        let all = await Contacts.all()
        if (filter === 'suppliers') all = all.filter((c) => c.is_supplier)
        else if (filter === 'customers') all = all.filter((c) => c.is_client)
        return {
          filter,
          total: all.length,
          contacts: all.slice(0, limit).map((c) => ({
            id: c.id,
            vat: c.vat_number,
            name: c.company_name || [c.name, c.surname].filter(Boolean).join(' ') || null,
            is_supplier: c.is_supplier,
            is_client: c.is_client,
            email: c.email,
            phone: c.phone,
          })),
        }
      }
      case 'get_contact_by_vat': {
        const vat = String(input.vat ?? '').replace(/\s+/g, '')
        const c = await Contacts.findByVat(vat)
        if (!c) return { found: false }
        return {
          found: true,
          contact: {
            id: c.id,
            vat: c.vat_number,
            name: c.company_name,
            is_supplier: c.is_supplier,
            is_client: c.is_client,
            email: c.email,
            phone: c.phone,
            address: [c.street, c.number, c.city, c.zip_code].filter(Boolean).join(' '),
            country: c.country,
            tax_office: c.tax_office,
          },
        }
      }
      case 'list_taxes': {
        const taxes = await Taxes.all()
        return taxes.map((t) => ({ id: t.id, title: t.title, rate: t.rate, is_default: t.is_default }))
      }
      case 'list_warehouses': {
        return (await Warehouses.all()).map((w) => ({ id: w.id, name: w.name }))
      }
      case 'list_categories': {
        return (await Categories.all()).map((c) => ({ id: c.id, name: c.name }))
      }
      case 'list_measurement_units': {
        return (await MeasurementUnits.all()).map((u) => ({
          id: u.id,
          abbreviation: u.abbreviation,
          title: u.title,
        }))
      }
      case 'list_variations': {
        const v = await Variations.all()
        return v.map((vt) => ({
          id: vt.id,
          name: vt.name,
          values: vt.values.map((vv) => ({ id: vv.id, name: vv.name })),
        }))
      }
      case 'list_drafts': {
        const status = String(input.status ?? 'all')
        let drafts = await Drafts.all()
        if (status !== 'all') drafts = drafts.filter((d) => d.status === status)
        return drafts.map((d) => ({
          id: d.id,
          status: d.status,
          contact_id: d.contact_id,
          issue_date: d.issue_date,
          lines_count: d.lines.length,
          updated_at: new Date(d.updated_at).toISOString(),
        }))
      }
      case 'get_stock_summary': {
        const ident = String(input.identifier ?? '')
        let product = await Products.findByCode(ident)
        if (!product) product = await Products.get(ident)
        if (!product) return { found: false }
        const warehouses = asArray<{ id?: string; warehouse_id?: string; name?: string; quantity?: number }>(
          product.warehouses,
        )
        const total = warehouses.reduce((s, w) => s + (w.quantity ?? 0), 0)
        return {
          found: true,
          code: product.code,
          name: product.name,
          total_stock: total,
          per_warehouse: warehouses.map((w) => ({
            warehouse_id: w.id ?? w.warehouse_id,
            warehouse_name: w.name,
            quantity: w.quantity,
          })),
        }
      }
      case 'list_numbering_sequences': {
        return (await NumberingSequences.all()).map((n) => ({
          id: n.id,
          name: n.name,
          document_type: n.document_type,
        }))
      }
      default:
        return { error: `unknown tool: ${name}` }
    }
  } catch (err) {
    return { error: String((err as Error)?.message ?? err) }
  }
}

/* -------- helpers ------------------------------------------------------ */

function compactProduct(p: import('@/shared/types').Product): unknown {
  const total_stock = sumStock(p.warehouses)
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category_name,
    sale_price: p.sale_net_amount,
    purchase_price: p.purchase_net_amount,
    vat_rate: p.sale_vat_ratio,
    total_stock,
    unit: p.metric,
  }
}

function fullProduct(p: import('@/shared/types').Product) {
  const total_stock = sumStock(p.warehouses)
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    barcode: p.barcode,
    part_number: p.part_number,
    category_name: p.category_name,
    supplier_id: p.supplier_id,
    supplier_code: p.supplier_code,
    metric: p.metric,
    total_stock,
    warehouses: p.warehouses,
    sale_net_amount: p.sale_net_amount,
    sale_vat_ratio: p.sale_vat_ratio,
    purchase_net_amount: p.purchase_net_amount,
    purchase_vat_ratio: p.purchase_vat_ratio,
    notes: p.notes,
  }
}

// Unused suppressors — keeps tree-shaking happy when optional stores are not
// used in tools but imported for side-effect typing.
void Logos
void PaymentMethods
void BusinessAreas
