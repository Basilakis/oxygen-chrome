import MiniSearch from 'minisearch'
import { Products } from '@/background/storage/stores'
import type { Product } from '@/shared/types'
import type { CatalogSearchHit, SearchResults } from '@/shared/messages'
import { looksCodeLike, normalizeCode } from '@/shared/util'
import { SESSION_KEY_SEARCH_INDEX } from '@/shared/constants'
import { sessionKv } from '@/core/storage/kv'

let ms: MiniSearch<Product> | null = null

const FIELDS = ['name', 'code', 'barcode', 'mpn_isbn', 'part_number', 'supplier_code'] as const
const STORED = [
  'id',
  'code',
  'name',
  'barcode',
  'mpn_isbn',
  'part_number',
  'supplier_code',
  'supplier_id',
  'category_id',
  'category_name',
  'metric',
  'quantity',
  'sale_net_amount',
  'sale_vat_ratio',
  'purchase_net_amount',
  'purchase_vat_ratio',
  'warehouses',
] as const

function normalizeTerm(term: string): string {
  // Strip Greek/Latin combining accents and lower-case so "Ferrara" and "FERÁRRA"
  // index into the same token. Leaves the rest of the token intact for fuzzy.
  return term
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function makeIndex(): MiniSearch<Product> {
  return new MiniSearch<Product>({
    fields: [...FIELDS],
    storeFields: [...STORED],
    searchOptions: {
      prefix: true,
      fuzzy: 0.35,
      boost: { code: 4, barcode: 4, mpn_isbn: 3, part_number: 3, supplier_code: 3, name: 1 },
      combineWith: 'AND',
    },
    extractField: (doc, fieldName) => {
      const v = (doc as unknown as Record<string, unknown>)[fieldName]
      return v == null ? '' : String(v)
    },
    processTerm: (term) => normalizeTerm(term) || null,
  })
}

export async function rebuildFromDB(): Promise<void> {
  const all = await Products.all()
  ms = makeIndex()
  ms.addAll(all)
  await persist()
}

export async function addOrUpdate(product: Product): Promise<void> {
  if (!ms) await ensureReady()
  if (!ms) return
  if (ms.has(product.id)) ms.replace(product)
  else ms.add(product)
  await persist()
}

export async function remove(id: string): Promise<void> {
  if (!ms) await ensureReady()
  if (!ms) return
  if (ms.has(id)) ms.discard(id)
  await persist()
}

async function persist(): Promise<void> {
  if (!ms) return
  try {
    const serialized = JSON.stringify(ms.toJSON())
    await sessionKv().set(SESSION_KEY_SEARCH_INDEX, serialized)
  } catch (err) {
    console.warn('[oxygen-helper] failed to persist search index to session storage', err)
  }
}

export async function ensureReady(): Promise<MiniSearch<Product>> {
  if (ms) return ms
  const serialized = await sessionKv().get<string>(SESSION_KEY_SEARCH_INDEX)
  if (typeof serialized === 'string' && serialized.length) {
    try {
      ms = MiniSearch.loadJSON<Product>(serialized, {
        fields: [...FIELDS],
        storeFields: [...STORED],
        searchOptions: {
          prefix: true,
          fuzzy: 0.35,
          boost: { code: 4, barcode: 4, mpn_isbn: 3, part_number: 3, supplier_code: 3, name: 1 },
          combineWith: 'AND',
        },
        processTerm: (term) => normalizeTerm(term) || null,
      })
      return ms
    } catch (err) {
      console.warn('[oxygen-helper] search index rehydrate failed; rebuilding', err)
    }
  }
  await rebuildFromDB()
  return ms!
}

export async function search(query: string, limit = 20): Promise<SearchResults> {
  const q = query.trim()
  const empty: SearchResults = { query: q, exact: [], fuzzy: [] }
  if (!q) return empty

  const exactHits: CatalogSearchHit[] = []

  if (looksCodeLike(q)) {
    const up = normalizeCode(q)
    const tries: Array<[keyof Product, Promise<Product | undefined>]> = [
      ['code', Products.findByCode(up)],
      ['barcode', Products.findByBarcode(up)],
      ['mpn_isbn', Products.findByMpn(up)],
      ['part_number', Products.findByPartNumber(up)],
      ['supplier_code', Products.findBySupplierCode(up)],
    ]
    const seen = new Set<string>()
    for (const [field, pr] of tries) {
      const p = await pr
      if (p && !seen.has(p.id)) {
        seen.add(p.id)
        exactHits.push({ product: p, tier: 'exact', score: 1000, matched_field: String(field) })
      }
    }
  }

  const index = await ensureReady()
  const raw = index.search(q, { prefix: true, fuzzy: 0.4, combineWith: 'AND' })
  const exactIds = new Set(exactHits.map((h) => h.product.id))

  // Trust MiniSearch's scoring for local results — the previous substring
  // post-filter rejected valid prefix matches (e.g. "Fer" matches "FERARRA"
  // via prefix, but at 4 chars "Ferr" isn't a substring of "ferarra" and the
  // filter dropped it). MiniSearch already ranked the hit; show it.
  const fuzzyHits: CatalogSearchHit[] = []
  for (const r of raw) {
    const id = String(r.id)
    if (exactIds.has(id)) continue
    const p = r as unknown as Product
    fuzzyHits.push({
      product: p,
      tier: 'fuzzy',
      score: r.score,
      matched_field: Object.keys(r.match ?? {})[0],
    })
    if (fuzzyHits.length >= limit) break
  }

  // Remote fallback: the API's /products?search= can return everything when
  // nothing matches, so we DO filter those (the relevance check only gates
  // server responses, not local hits).
  if (exactHits.length === 0 && fuzzyHits.length === 0) {
    try {
      const terms = tokenizeQuery(q)
      const remote = (await searchRemote(q, limit * 3)).filter((h) =>
        termsMatchProduct(h.product, terms),
      )
      return { query: q, exact: [], fuzzy: remote.slice(0, limit) }
    } catch (err) {
      console.warn('[oxygen-helper] remote search fallback failed', err)
    }
  }

  return { query: q, exact: exactHits, fuzzy: fuzzyHits }
}

function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

function productHaystack(p: Product): string {
  return [p.name, p.code, p.barcode, p.mpn_isbn, p.part_number, p.supplier_code]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .join(' · ')
}

function termsMatchProduct(p: Product, terms: string[]): boolean {
  if (!terms.length) return true
  const hay = productHaystack(p)
  return terms.every((t) => {
    if (hay.includes(t)) return true
    // Permit one small typo: split haystack into tokens and check edit distance.
    if (t.length <= 4) return false
    const tokens = hay.split(/[\s·\-/,]+/)
    for (const tok of tokens) {
      if (tok.length < t.length - 2) continue
      if (Math.abs(tok.length - t.length) > 2) continue
      if (editDistanceWithin(tok, t, 2)) return true
    }
    return false
  })
}

// Early-exit Levenshtein — returns true if distance is <= max.
function editDistanceWithin(a: string, b: string, max: number): boolean {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > max) return false
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    let rowMin = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
      if (curr[j]! < rowMin) rowMin = curr[j]!
    }
    if (rowMin > max) return false
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]! <= max
}

async function searchRemote(query: string, limit: number): Promise<CatalogSearchHit[]> {
  const { apiRequest } = await import('@/background/api/client')
  type Wrapped = { data?: unknown[] } | unknown[]
  const res = await apiRequest<Wrapped>('/products', {
    query: { search: query, per_page: limit },
  })
  const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
  if (!list.length) return []
  // Lightweight inline normalization. Full normalization happens on next sync —
  // this just yields a usable display for the immediate query.
  const hits: CatalogSearchHit[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const product: Product = {
      id: String(r.id ?? ''),
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      barcode: (r.barcode as string | null | undefined) ?? null,
      mpn_isbn: (r.mpn_isbn as string | null | undefined) ?? null,
      part_number: (r.part_number as string | null | undefined) ?? null,
      sale_net_amount: toNumberOpt(r.sale_net_amount),
      purchase_net_amount: toNumberOpt(r.purchase_net_amount),
      sale_vat_ratio: toNumberOpt(r.sale_vat_ratio),
      quantity: toNumberOpt(r.quantity),
      warehouses: Array.isArray(r.warehouses)
        ? (r.warehouses as Array<Record<string, unknown>>).map((w) => ({
            id: String(w.id ?? ''),
            warehouse_id: String(w.id ?? ''),
            quantity: toNumberOpt(w.quantity) ?? 0,
          }))
        : [],
    }
    hits.push({ product, tier: 'fuzzy', score: 0.5, matched_field: 'remote' })
    // Backfill local cache + index so next search is instant.
    Products.put(product).catch(() => void 0)
    addOrUpdate(product).catch(() => void 0)
  }
  return hits
}

function toNumberOpt(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}
