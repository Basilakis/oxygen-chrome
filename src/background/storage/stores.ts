import { getDB } from './db'
import { STORES, type StoreName } from '@/shared/constants'
import type {
  Product,
  Contact,
  Tax,
  Warehouse,
  ProductCategory,
  MeasurementUnit,
  PaymentMethod,
  NumberingSequence,
  Logo,
  BusinessArea,
  Variation,
  Draft,
  SyncMeta,
  Id,
} from '@/shared/types'

async function bulkPut<T>(store: StoreName, items: T[]): Promise<void> {
  if (!items.length) return
  const db = await getDB()
  const tx = db.transaction(store as never, 'readwrite')
  const s = tx.store as unknown as { put: (v: unknown) => unknown }
  for (const it of items) {
    await s.put(it)
  }
  await tx.done
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDB()
  return (await db.getAll(store as never)) as T[]
}

async function clear(store: StoreName): Promise<void> {
  const db = await getDB()
  await db.clear(store as never)
}

async function replaceAll<T>(store: StoreName, items: T[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(store as never, 'readwrite')
  const s = tx.store as unknown as { clear: () => Promise<void>; put: (v: unknown) => unknown }
  await s.clear()
  for (const it of items) {
    await s.put(it)
  }
  await tx.done
}

// Products
export const Products = {
  all: () => getAll<Product>(STORES.products),
  put: (p: Product) => bulkPut(STORES.products, [p]),
  putMany: (ps: Product[]) => bulkPut(STORES.products, ps),
  replaceAll: (ps: Product[]) => replaceAll(STORES.products, ps),
  clear: () => clear(STORES.products),
  async get(id: Id): Promise<Product | undefined> {
    const db = await getDB()
    return db.get('products', id)
  },
  async findByCode(code: string): Promise<Product | undefined> {
    const db = await getDB()
    return db.getFromIndex('products', 'code', code)
  },
  async findByBarcode(barcode: string): Promise<Product | undefined> {
    const db = await getDB()
    return db.getFromIndex('products', 'barcode', barcode)
  },
  async findByMpn(mpn: string): Promise<Product | undefined> {
    const db = await getDB()
    return db.getFromIndex('products', 'mpn_isbn', mpn)
  },
  async findByPartNumber(pn: string): Promise<Product | undefined> {
    const db = await getDB()
    return db.getFromIndex('products', 'part_number', pn)
  },
  async findBySupplierCode(sc: string): Promise<Product | undefined> {
    const db = await getDB()
    return db.getFromIndex('products', 'supplier_code', sc)
  },
  async count(): Promise<number> {
    const db = await getDB()
    return db.count('products')
  },
}

// Contacts
export const Contacts = {
  all: () => getAll<Contact>(STORES.contacts),
  put: (c: Contact) => bulkPut(STORES.contacts, [c]),
  putMany: (cs: Contact[]) => bulkPut(STORES.contacts, cs),
  replaceAll: (cs: Contact[]) => replaceAll(STORES.contacts, cs),
  clear: () => clear(STORES.contacts),
  async get(id: Id): Promise<Contact | undefined> {
    const db = await getDB()
    return db.get('contacts', id)
  },
  async findByVat(vat: string): Promise<Contact | undefined> {
    const db = await getDB()
    return db.getFromIndex('contacts', 'vat_number', vat)
  },
  async count(): Promise<number> {
    const db = await getDB()
    return db.count('contacts')
  },
}

function makeLookupStore<T extends { id: Id }>(store: StoreName) {
  return {
    all: () => getAll<T>(store),
    replaceAll: (items: T[]) => replaceAll(store, items),
    put: (item: T) => bulkPut(store, [item]),
    clear: () => clear(store),
    async get(id: Id): Promise<T | undefined> {
      const db = await getDB()
      return (await db.get(store as never, id)) as T | undefined
    },
    async count(): Promise<number> {
      const db = await getDB()
      return db.count(store as never)
    },
  }
}

export const Taxes = makeLookupStore<Tax>(STORES.taxes)
export const Warehouses = makeLookupStore<Warehouse>(STORES.warehouses)
export const Categories = makeLookupStore<ProductCategory>(STORES.product_categories)
export const MeasurementUnits = makeLookupStore<MeasurementUnit>(STORES.measurement_units)
export const PaymentMethods = makeLookupStore<PaymentMethod>(STORES.payment_methods)
export const NumberingSequences = makeLookupStore<NumberingSequence>(STORES.numbering_sequences)
export const Logos = makeLookupStore<Logo>(STORES.logos)
export const BusinessAreas = makeLookupStore<BusinessArea>(STORES.business_areas)
export const Variations = makeLookupStore<Variation>(STORES.variations)

// Drafts
export const Drafts = {
  async all(): Promise<Draft[]> {
    const db = await getDB()
    return db.getAll('drafts')
  },
  async get(id: string): Promise<Draft | undefined> {
    const db = await getDB()
    return db.get('drafts', id)
  },
  async put(d: Draft): Promise<void> {
    const db = await getDB()
    await db.put('drafts', d)
  },
  async delete(id: string): Promise<void> {
    const db = await getDB()
    await db.delete('drafts', id)
  },
  async listActive(): Promise<Draft[]> {
    const db = await getDB()
    return db.getAllFromIndex('drafts', 'status', 'active')
  },
}

// Sync meta
export const Sync = {
  async get(resource: string): Promise<SyncMeta | undefined> {
    const db = await getDB()
    return db.get('sync_meta', resource)
  },
  async put(meta: SyncMeta): Promise<void> {
    const db = await getDB()
    await db.put('sync_meta', meta)
  },
  async all(): Promise<SyncMeta[]> {
    const db = await getDB()
    return db.getAll('sync_meta')
  },
}
