import { Contacts, Products } from '@/background/storage/stores'
import {
  createContact,
  createProduct,
  findContactByVat,
  getProduct,
  updateProduct,
  vatCheck,
} from '@/background/api/endpoints'
import type { Contact, Id, Product, ProductWarehouseStock } from '@/shared/types'
import { addOrUpdate as indexProduct, search } from '@/background/search'
import { OxygenApiError } from '@/background/api/errors'

export interface ResolveSupplierResult {
  contact: Contact
  source: 'local_cache' | 'remote_lookup' | 'vat_check_created'
}

export async function resolveSupplier(vat: string, autoCreate = true): Promise<ResolveSupplierResult> {
  const normalized = vat.replace(/\s+/g, '')
  console.debug('[oxygen-helper] resolveSupplier: looking up VAT', normalized)

  const cached = await Contacts.findByVat(normalized)
  if (cached) {
    console.debug('[oxygen-helper] resolveSupplier: found in local cache', {
      id: cached.id,
      vat: cached.vat_number,
      name: cached.company_name || cached.name,
    })
    return { contact: cached, source: 'local_cache' }
  }

  const remote = await findContactByVat(normalized)
  if (remote) {
    console.debug('[oxygen-helper] resolveSupplier: found via remote lookup', {
      id: remote.id,
      vat: remote.vat_number,
      name: remote.company_name || remote.name,
    })
    if ((remote.vat_number ?? '').replace(/\s+/g, '') !== normalized) {
      // Defensive: if the filter didn't work and we got back something unrelated
      console.warn('[oxygen-helper] resolveSupplier: remote lookup returned mismatched VAT — ignoring')
    } else {
      await Contacts.put(remote)
      return { contact: remote, source: 'remote_lookup' }
    }
  } else {
    console.debug('[oxygen-helper] resolveSupplier: no match in cache or remote — will auto-create')
  }

  if (!autoCreate) throw new Error(`supplier with VAT ${normalized} not found and autoCreate=false`)

  const vatData = await vatCheck(normalized)
  console.debug('[oxygen-helper] resolveSupplier: vat-check returned', vatData)
  // POST /contacts requires: type, is_client, is_supplier, country (non-empty).
  // Existing contacts in the API have type=2 for business/supplier; default to that.
  const created = await createContact({
    type: 2,
    is_client: false,
    is_supplier: true,
    country: vatData.country || 'GR',
    vat_number: normalized,
    company_name: vatData.company_name ?? normalized,
    profession: vatData.profession,
    street: vatData.street,
    number: vatData.number,
    city: vatData.city,
    zip_code: vatData.zip_code,
    tax_office: vatData.tax_office,
  } as Partial<Contact>)
  await Contacts.put(created as Contact)
  return { contact: created as Contact, source: 'vat_check_created' }
}

export interface CreateProductResult {
  input: Partial<Product>
  status: 'created' | 'failed'
  product?: Product
  error?: string
  validation?: Record<string, string[]>
}

export interface UpdateProductRequest {
  product_id: Id
  add_to_warehouse_id?: Id
  add_quantity?: number
  new_purchase_net_amount?: number
  new_sale_net_amount?: number
}

export interface UpdateProductResult {
  input: UpdateProductRequest
  status: 'updated' | 'failed'
  product?: Product
  error?: string
  validation?: Record<string, string[]>
  added_stock?: number
  new_total_stock?: number
  price_before?: number
  price_after?: number
}

/**
 * Apply stock/price updates to existing products. Used when an AADE invoice
 * line matches a product already in the catalog — the user can opt in per
 * line to add the received quantity to the target warehouse and/or refresh
 * the purchase/sale prices.
 *
 * For each update we fetch the product fresh from the API (not from IDB)
 * before modifying, so we don't clobber concurrent stock changes made
 * elsewhere in Oxygen. Then we PUT the full warehouses array back, updating
 * only the target warehouse entry (or adding it if missing).
 */
export async function updateProductsSequential(
  updates: UpdateProductRequest[],
): Promise<UpdateProductResult[]> {
  const results: UpdateProductResult[] = []
  for (const u of updates) {
    try {
      // Fetch fresh — IDB may be stale relative to another user's edits.
      const current = await getProduct(u.product_id)
      const patch: Partial<Product> & Record<string, unknown> = {}

      let addedStock: number | undefined
      let newTotalStock: number | undefined
      if (u.add_to_warehouse_id && u.add_quantity && u.add_quantity > 0) {
        const nextWarehouses = applyStockAddition(
          current.warehouses ?? [],
          u.add_to_warehouse_id,
          u.add_quantity,
        )
        patch.warehouses = nextWarehouses
        addedStock = u.add_quantity
        newTotalStock = nextWarehouses.reduce((s, w) => s + (w.quantity ?? 0), 0)
      }

      let priceBefore: number | undefined
      let priceAfter: number | undefined
      if (typeof u.new_purchase_net_amount === 'number') {
        priceBefore = current.purchase_net_amount
        priceAfter = u.new_purchase_net_amount
        patch.purchase_net_amount = u.new_purchase_net_amount
      }
      if (typeof u.new_sale_net_amount === 'number') {
        patch.sale_net_amount = u.new_sale_net_amount
      }

      if (Object.keys(patch).length === 0) {
        results.push({
          input: u,
          status: 'failed',
          error: 'no-op update (no stock delta, no price change)',
        })
        continue
      }

      const updated = await updateProduct(u.product_id, patch)
      await Products.put(updated as Product)
      await indexProduct(updated as Product)
      results.push({
        input: u,
        status: 'updated',
        product: updated as Product,
        added_stock: addedStock,
        new_total_stock: newTotalStock,
        price_before: priceBefore,
        price_after: priceAfter,
      })
    } catch (err) {
      if (err instanceof OxygenApiError) {
        results.push({
          input: u,
          status: 'failed',
          error: err.message,
          validation: err.validation,
        })
      } else {
        results.push({ input: u, status: 'failed', error: String((err as Error)?.message ?? err) })
      }
    }
  }
  return results
}

/**
 * Produce the Product we should cache locally after a successful POST
 * /products. The response (ProductItem) is a strict subset of what we sent —
 * it drops supplier_code, supplier_id, category_id, measurement_unit_id,
 * cpv_code, taric_code, etc. Merge them back so duplicate detection (which
 * looks up by supplier_code) hits on the next render.
 *
 * Rule: whatever the server returned wins for fields it defined. Gaps in
 * the response get filled from the request body.
 */
function mergeCreatedProduct(body: Partial<Product>, created: Product): Product {
  const out: Product = { ...(body as Product), ...created }
  // Spread semantics wipe body values with `undefined` from created. Walk the
  // response once more and replace any undefined with the body value we sent.
  for (const [k, v] of Object.entries(body) as Array<[keyof Product, unknown]>) {
    if (v === undefined) continue
    if ((out as unknown as Record<string, unknown>)[k as string] === undefined) {
      ;(out as unknown as Record<string, unknown>)[k as string] = v
    }
  }
  return out
}

/**
 * Return a new warehouses array with `addQty` added to the entry whose id
 * matches `targetId`. If no matching entry exists, a new one is appended.
 * The rest of the entries are copied unchanged so we can PUT the full array
 * back without losing stock in other warehouses.
 */
function applyStockAddition(
  warehouses: ProductWarehouseStock[],
  targetId: Id,
  addQty: number,
): ProductWarehouseStock[] {
  const next = warehouses.map((w) => ({ ...w }))
  const idx = next.findIndex((w) => String(w.id) === String(targetId) || String(w.warehouse_id) === String(targetId))
  if (idx >= 0) {
    const current = next[idx]!
    next[idx] = { ...current, quantity: (current.quantity ?? 0) + addQty }
  } else {
    next.push({
      id: targetId,
      warehouse_id: targetId,
      quantity: addQty,
    })
  }
  return next
}

/**
 * Look up whether the catalog already holds a "variation family" whose parent
 * name matches the given description. A family is recognised by products
 * sharing a `base.N` code pattern (e.g. "OX5.1", "OX5.2"). We return the
 * shared base plus the sorted list of taken suffix integers so the caller can
 * pick the next one without colliding.
 *
 * We look up the parent by fuzzy name search + prefix match on the top hit,
 * then read all products with codes starting with `${parentCode}.` to build
 * the used-suffix set.
 */
export async function findVariationFamily(description: string): Promise<{
  parent: Product
  baseCode: string
  usedSuffixes: number[]
  nextSuffix: number
} | null> {
  const q = description.trim()
  if (!q) return null
  const res = await search(q, 5)
  const top = res.exact[0]?.product ?? res.fuzzy[0]?.product
  if (!top || !top.code) return null
  // The match is the parent if its code doesn't already carry a `.N` tail
  // (a child wouldn't be the parent). If we matched a child, strip it.
  const baseCode = top.code.includes('.') ? top.code.split('.')[0]! : top.code
  const all = await Products.all()
  const rx = new RegExp(`^${escapeRx(baseCode)}\\.(\\d+)$`)
  const usedSuffixes: number[] = []
  for (const p of all) {
    if (!p.code) continue
    const m = p.code.match(rx)
    if (m) {
      const n = parseInt(m[1]!, 10)
      if (Number.isFinite(n)) usedSuffixes.push(n)
    }
  }
  if (!usedSuffixes.length) {
    // The matched product has no `.N` children — not a variation family yet.
    // Caller can still choose to convert it by starting at .1 manually; we
    // flag it with an empty suffixes list so the UI can offer that path.
    return { parent: top, baseCode, usedSuffixes: [], nextSuffix: 1 }
  }
  usedSuffixes.sort((a, b) => a - b)
  return {
    parent: top,
    baseCode,
    usedSuffixes,
    nextSuffix: Math.max(...usedSuffixes) + 1,
  }
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function createProductsSequential(
  supplierId: Id,
  products: Array<Partial<Product> & { name: string; code: string; sale_tax_id: Id; sale_net_amount: number }>,
): Promise<CreateProductResult[]> {
  const results: CreateProductResult[] = []
  for (const p of products) {
    // API requires `type` (enum, existing data uses 3) and `status` (active = 1).
    // Supplier is not a first-class product field in the API we're calling; store
    // supplier_code for reverse lookup, keep supplier_id in local cache only.
    const body: Partial<Product> & Record<string, unknown> = {
      type: 3,
      status: true,
      ...p,
      supplier_id: supplierId,
    }
    try {
      const created = await createProduct(body)
      // The Oxygen ProductItem response omits several fields we sent (notably
      // supplier_code, supplier_id, category_id, measurement_unit_id,
      // cpv_code, taric_code). If we Products.put() only the response, the
      // next duplicate detection round (same invoice, reopened modal) would
      // search by supplier_code and miss — the user would see "new" again
      // and be tempted to re-submit.
      //
      // Merge strategy: server response wins for fields it defines; body
      // fills in the ones the server dropped. The server accepted the POST,
      // so the fields we sent are valid for the record it created.
      const stored = mergeCreatedProduct(body as Partial<Product>, created as Product)
      await Products.put(stored)
      await indexProduct(stored)
      results.push({ input: p, status: 'created', product: stored })
    } catch (err) {
      if (err instanceof OxygenApiError) {
        results.push({
          input: p,
          status: 'failed',
          error: err.message,
          validation: err.validation,
        })
      } else {
        results.push({ input: p, status: 'failed', error: String((err as Error)?.message ?? err) })
      }
    }
  }
  return results
}

export async function detectDuplicates(lines: Array<{ supplier_code?: string; description: string }>): Promise<
  Array<
    | { status: 'exists'; product: Product; matched_by: string }
    | { status: 'candidate'; candidates: Product[] }
    | { status: 'new' }
  >
> {
  const out: Array<
    | { status: 'exists'; product: Product; matched_by: string }
    | { status: 'candidate'; candidates: Product[] }
    | { status: 'new' }
  > = []
  for (const line of lines) {
    const sc = line.supplier_code?.trim()
    if (sc) {
      const p = await Products.findBySupplierCode(sc)
      if (p) {
        out.push({ status: 'exists', product: p, matched_by: 'supplier_code' })
        continue
      }
      const byCode = await Products.findByCode(sc.toUpperCase())
      if (byCode) {
        out.push({ status: 'exists', product: byCode, matched_by: 'code' })
        continue
      }
      const byMpn = await Products.findByMpn(sc)
      if (byMpn) {
        out.push({ status: 'exists', product: byMpn, matched_by: 'mpn_isbn' })
        continue
      }
      const byPn = await Products.findByPartNumber(sc)
      if (byPn) {
        out.push({ status: 'exists', product: byPn, matched_by: 'part_number' })
        continue
      }
    }
    const r = await search(line.description, 5)
    const candidates = [...r.exact.map((h) => h.product), ...r.fuzzy.map((h) => h.product)]
    if (candidates.length) out.push({ status: 'candidate', candidates })
    else out.push({ status: 'new' })
  }
  return out
}
