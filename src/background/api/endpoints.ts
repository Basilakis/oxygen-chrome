import { apiRequest, apiRequestWithFallback } from './client'
import type {
  BusinessArea,
  Contact,
  Id,
  InvoiceCreatePayload,
  Logo,
  MeasurementUnit,
  NoticeCreatePayload,
  NumberingSequence,
  PaymentMethod,
  Product,
  ProductCategory,
  ProductWarehouseStock,
  Tax,
  Variation,
  VariationValue,
  VatCheckResult,
  Warehouse,
} from '@/shared/types'

/* -------------------------------------------------- unwrap + paginate -- */

type ListResponse<T> =
  | { data?: T[]; items?: T[]; meta?: { total?: number; current_page?: number; last_page?: number } }
  | T[]

function extractList<T>(res: ListResponse<T>): T[] {
  if (Array.isArray(res)) return res
  if (res.data && Array.isArray(res.data)) return res.data
  if (res.items && Array.isArray(res.items)) return res.items
  return []
}

function extractPaginationMeta(res: unknown): { current_page?: number; last_page?: number } {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return {}
  const r = res as { meta?: { current_page?: number; last_page?: number } }
  return r.meta ?? {}
}

async function paginate<T>(
  path: string,
  perPage = 2000,
  query: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const out: T[] = []
  let page = 1
  for (;;) {
    const res = await apiRequest<ListResponse<T>>(path, {
      query: { ...query, page, per_page: perPage },
    })
    const batch = extractList<T>(res)
    if (!batch.length) break
    out.push(...batch)
    const meta = extractPaginationMeta(res)
    if (meta.last_page !== undefined) {
      if (page >= meta.last_page) break
    } else if (batch.length < perPage) {
      break
    }
    page += 1
    if (page > 1000) break
  }
  return out
}

async function paginateNormalized<T>(
  path: string,
  normalize: (raw: unknown) => T,
  perPage = 2000,
  query: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const raw = await paginate<unknown>(path, perPage, query)
  return raw.map(normalize)
}

/* -------------------------------------------------------- coercers -- */

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

function toId(v: unknown): Id {
  return String(v ?? '')
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true'
  return Boolean(v)
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  return String(v)
}

/* ----------------------------------------------------- normalizers -- */

function normalizeTax(raw: unknown): Tax {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    title: String(r.title ?? r.name ?? ''),
    rate: toNum(r.rate) ?? 0,
    is_default: toBool(r.is_default),
    mydata_vat_code: str(r.mydata_vat_code),
    mydata_vat_exemption_category: (r.mydata_vat_exemption_category as number | string | undefined) ?? undefined,
    status: r.status as boolean | number | undefined,
  }
}

function normalizeWarehouse(raw: unknown): Warehouse {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    name: String(r.name ?? ''),
    status: toBool(r.status),
  }
}

function normalizeCategory(raw: unknown): ProductCategory {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    name: String(r.name ?? ''),
    status: toBool(r.status),
    parent_id: r.parent_id ? toId(r.parent_id) : null,
  }
}

function normalizeMeasurementUnit(raw: unknown): MeasurementUnit {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    abbreviation: String(r.abbreviation ?? ''),
    abbreviation_en: str(r.abbreviation_en),
    title: str(r.title),
    title_en: str(r.title_en),
    mydata_code: str(r.mydata_code),
    peppol_code: str(r.peppol_code),
  }
}

function normalizePaymentMethod(raw: unknown): PaymentMethod {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    title_gr: String(r.title_gr ?? r.title ?? ''),
    title_en: str(r.title_en),
    mydata_code: str(r.mydata_code),
    status: toBool(r.status),
  }
}

function normalizeNumberingSequence(raw: unknown): NumberingSequence {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    document_type: String(r.document_type ?? ''),
    name: String(r.name ?? ''),
    title: (r.title as string | null | undefined) ?? null,
    is_draft: toBool(r.is_draft),
    status: r.status as boolean | number | undefined,
  }
}

function normalizeLogo(raw: unknown): Logo {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    is_default: toBool(r.is_default),
    name: str(r.name),
    url: str(r.url),
  }
}

function normalizeBusinessArea(raw: unknown): BusinessArea {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    code: str(r.code),
    name: str(r.name),
  }
}

function normalizeVariation(raw: unknown): Variation {
  const r = raw as Record<string, unknown>
  const values = Array.isArray(r.values)
    ? (r.values as unknown[]).map((v): VariationValue => {
        const vv = v as Record<string, unknown>
        return { id: toId(vv.id), name: String(vv.name ?? '') }
      })
    : []
  return {
    id: toId(r.id),
    name: String(r.name ?? ''),
    name_en: str(r.name_en),
    values,
  }
}

function normalizeProductWarehouse(raw: unknown): ProductWarehouseStock {
  const r = raw as Record<string, unknown>
  const id = toId(r.id)
  return {
    id,
    warehouse_id: id,
    name: str(r.name),
    quantity: toNum(r.quantity) ?? 0,
    position: str(r.position),
  }
}

function normalizeProduct(raw: unknown): Product {
  const r = raw as Record<string, unknown>
  const category = r.category as Record<string, unknown> | null | undefined
  const categoryId = category ? toId(category.id) : undefined
  const warehouses = Array.isArray(r.warehouses)
    ? (r.warehouses as unknown[]).map(normalizeProductWarehouse)
    : []
  return {
    id: toId(r.id),
    code: String(r.code ?? ''),
    name: String(r.name ?? ''),
    type: toNum(r.type),
    category: category
      ? normalizeCategory(category)
      : null,
    category_id: categoryId,
    category_name: category ? String(category.name ?? '') : undefined,
    barcode: (r.barcode as string | null | undefined) ?? null,
    mpn_isbn: (r.mpn_isbn as string | null | undefined) ?? null,
    part_number: (r.part_number as string | null | undefined) ?? null,
    metric: str(r.metric),
    quantity: toNum(r.quantity),
    warehouses,
    sale_net_amount: toNum(r.sale_net_amount),
    sale_vat_ratio: toNum(r.sale_vat_ratio),
    sale_vat_amount: toNum(r.sale_vat_amount),
    sale_total_amount: toNum(r.sale_total_amount),
    purchase_net_amount: toNum(r.purchase_net_amount),
    purchase_vat_ratio: toNum(r.purchase_vat_ratio),
    purchase_vat_amount: toNum(r.purchase_vat_amount),
    purchase_total_amount: toNum(r.purchase_total_amount),
    profit_ratio: toNum(r.profit_ratio),
    profit_amount: toNum(r.profit_amount),
    status: toBool(r.status),
    notes: str(r.notes),
    mydata_income_category: str(r.mydata_income_category),
    mydata_income_type: str(r.mydata_income_type),
    mydata_income_retail_category: str(r.mydata_income_retail_category),
    mydata_income_retail_type: str(r.mydata_income_retail_type),
    supplier_id: r.supplier_id ? toId(r.supplier_id) : undefined,
    supplier_code: str(r.supplier_code),
    updated_at: str(r.updated_at),
  }
}

function normalizeContact(raw: unknown): Contact {
  const r = raw as Record<string, unknown>
  return {
    id: toId(r.id),
    code: str(r.code),
    type: toNum(r.type),
    is_client: toBool(r.is_client),
    is_supplier: toBool(r.is_supplier),
    name: str(r.name),
    surname: str(r.surname),
    nickname: str(r.nickname),
    company_name: str(r.company_name),
    vat_number: str(r.vat_number),
    profession: str(r.profession),
    street: str(r.street),
    number: str(r.number),
    city: str(r.city),
    zip_code: str(r.zip_code),
    country: str(r.country),
    tax_office: str(r.tax_office),
    email: str(r.email),
    phone: str(r.phone),
    status: toBool(r.status),
  }
}

/* --------------------------------------------------------- endpoints -- */

// Lookup tables
export const getTaxes = () => paginateNormalized<Tax>('/taxes', normalizeTax, 500)
export const getWarehouses = () => paginateNormalized<Warehouse>('/warehouses', normalizeWarehouse, 500)
export const getProductCategories = () => paginateNormalized<ProductCategory>('/products-categories', normalizeCategory, 500)
export const getMeasurementUnits = () => paginateNormalized<MeasurementUnit>('/measurement-units', normalizeMeasurementUnit, 500)
export const getPaymentMethods = () => paginateNormalized<PaymentMethod>('/payment-methods', normalizePaymentMethod, 500)
export const getNumberingSequences = () => paginateNormalized<NumberingSequence>('/numbering-sequences', normalizeNumberingSequence, 500)
export const getLogos = () => paginateNormalized<Logo>('/logos', normalizeLogo, 200)
export const getBusinessAreas = () => paginateNormalized<BusinessArea>('/business-areas', normalizeBusinessArea, 500)
export const getVariations = () => paginateNormalized<Variation>('/variations', normalizeVariation, 500)

// Contacts
export const getContacts = () => paginateNormalized<Contact>('/contacts', normalizeContact, 2000)
export const getContact = async (id: Id) =>
  normalizeContact(unwrap(await apiRequest<unknown>(`/contacts/${id}`)))
export async function findContactByVat(vat: string): Promise<Contact | null> {
  // The API ignores the `?vat_number=` filter — it returns the same first
  // contact regardless of the query. We paginate broadly and match
  // client-side on exact VAT equality.
  const target = vat.replace(/\s+/g, '')
  if (!target) return null
  const res = await apiRequest<ListResponse<unknown>>('/contacts', {
    query: { vat_number: vat, per_page: 200 },
  })
  const list = extractList<unknown>(res).map(normalizeContact)
  return list.find((c) => (c.vat_number ?? '').replace(/\s+/g, '') === target) ?? null
}
export const createContact = async (contact: Partial<Contact>) =>
  normalizeContact(unwrap(await apiRequest<unknown>('/contacts', { method: 'POST', body: contact, retry: false })))
export const updateContact = async (id: Id, patch: Partial<Contact>) =>
  normalizeContact(unwrap(await apiRequest<unknown>(`/contacts/${id}`, { method: 'PUT', body: patch, retry: false })))

// Products
export const getProducts = () => paginateNormalized<Product>('/products', normalizeProduct, 2000)
export const getProduct = async (id: Id) =>
  normalizeProduct(unwrap(await apiRequest<unknown>(`/products/${id}`)))
export const createProduct = async (product: Partial<Product>) =>
  normalizeProduct(unwrap(await apiRequest<unknown>('/products', { method: 'POST', body: product, retry: false })))
export const updateProduct = async (id: Id, patch: Partial<Product>) =>
  normalizeProduct(unwrap(await apiRequest<unknown>(`/products/${id}`, { method: 'PUT', body: patch, retry: false })))

// VAT check
export function vatCheck(vat: string): Promise<VatCheckResult> {
  return apiRequestWithFallback<VatCheckResult>('/vat-check', 'vat_number', vat, { retry: false })
}
export function vies(vat: string): Promise<VatCheckResult> {
  return apiRequestWithFallback<VatCheckResult>('/vies', 'vat_number', vat, { retry: false })
}

// Notices & invoices
export const createNotice = (payload: NoticeCreatePayload) =>
  apiRequest<{ data?: { id: Id } } | { id: Id }>('/notices', {
    method: 'POST',
    body: payload,
    retry: false,
  }).then(unwrap)

export const createInvoice = (payload: InvoiceCreatePayload) =>
  apiRequest<{ data?: { id: Id } } | { id: Id }>('/invoices', {
    method: 'POST',
    body: payload,
    retry: false,
  }).then(unwrap)

function unwrap<T>(res: T | { data?: T }): T {
  if (res && typeof res === 'object' && 'data' in (res as object)) {
    const d = (res as { data?: T }).data
    if (d !== undefined) return d
  }
  return res as T
}
