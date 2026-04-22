import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { DB_NAME, DB_VERSION, STORES } from '@/shared/constants'
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
} from '@/shared/types'

export interface OxygenDB extends DBSchema {
  products: {
    key: string
    value: Product
    indexes: {
      code: string
      barcode: string
      mpn_isbn: string
      part_number: string
      supplier_id: string
      category_id: string
      supplier_code: string
    }
  }
  contacts: {
    key: string
    value: Contact
    indexes: { vat_number: string; company_name: string }
  }
  taxes: { key: string; value: Tax }
  warehouses: { key: string; value: Warehouse }
  product_categories: { key: string; value: ProductCategory }
  measurement_units: { key: string; value: MeasurementUnit }
  payment_methods: { key: string; value: PaymentMethod }
  numbering_sequences: {
    key: string
    value: NumberingSequence
    indexes: { document_type: string }
  }
  logos: { key: string; value: Logo }
  business_areas: { key: string; value: BusinessArea }
  variations: { key: string; value: Variation }
  drafts: {
    key: string
    value: Draft
    indexes: { status: string; updated_at: number }
  }
  sync_meta: { key: string; value: SyncMeta }
}

let dbPromise: Promise<IDBPDatabase<OxygenDB>> | null = null

export function getDB(): Promise<IDBPDatabase<OxygenDB>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<OxygenDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const products = db.createObjectStore(STORES.products, { keyPath: 'id' })
        products.createIndex('code', 'code', { unique: false })
        products.createIndex('barcode', 'barcode', { unique: false })
        products.createIndex('mpn_isbn', 'mpn_isbn', { unique: false })
        products.createIndex('part_number', 'part_number', { unique: false })
        products.createIndex('supplier_id', 'supplier_id', { unique: false })
        products.createIndex('category_id', 'category_id', { unique: false })
        products.createIndex('supplier_code', 'supplier_code', { unique: false })

        const contacts = db.createObjectStore(STORES.contacts, { keyPath: 'id' })
        contacts.createIndex('vat_number', 'vat_number', { unique: false })
        contacts.createIndex('company_name', 'company_name', { unique: false })

        db.createObjectStore(STORES.taxes, { keyPath: 'id' })
        db.createObjectStore(STORES.warehouses, { keyPath: 'id' })
        db.createObjectStore(STORES.product_categories, { keyPath: 'id' })
        db.createObjectStore(STORES.measurement_units, { keyPath: 'id' })
        db.createObjectStore(STORES.payment_methods, { keyPath: 'id' })
        const numbering = db.createObjectStore(STORES.numbering_sequences, { keyPath: 'id' })
        numbering.createIndex('document_type', 'document_type', { unique: false })
        db.createObjectStore(STORES.logos, { keyPath: 'id' })
        db.createObjectStore(STORES.business_areas, { keyPath: 'id' })

        const drafts = db.createObjectStore(STORES.drafts, { keyPath: 'id' })
        drafts.createIndex('status', 'status', { unique: false })
        drafts.createIndex('updated_at', 'updated_at', { unique: false })

        db.createObjectStore(STORES.sync_meta, { keyPath: 'resource' })
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORES.variations)) {
          db.createObjectStore(STORES.variations, { keyPath: 'id' })
        }
      }
    },
  })
  return dbPromise
}

export async function wipeDatabase(): Promise<void> {
  const db = await getDB()
  const names = [
    'products',
    'contacts',
    'taxes',
    'warehouses',
    'product_categories',
    'measurement_units',
    'payment_methods',
    'numbering_sequences',
    'logos',
    'business_areas',
    'variations',
    'drafts',
    'sync_meta',
  ] as const
  const tx = db.transaction(names, 'readwrite')
  await Promise.all(names.map((n) => tx.objectStore(n).clear()))
  await tx.done
}
