import { Contacts, Products } from '@/background/storage/stores'
import {
  createContact,
  createProduct,
  findContactByVat,
  vatCheck,
} from '@/background/api/endpoints'
import type { Contact, Id, Product } from '@/shared/types'
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
      await Products.put(created as Product)
      await indexProduct(created as Product)
      results.push({ input: p, status: 'created', product: created as Product })
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
