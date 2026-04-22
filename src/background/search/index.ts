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
      // Sanity check: if IDB has products but the loaded index has none, the
      // serialized blob is stale (e.g. from a pre-sync state or a schema skew)
      // and we should rebuild. Otherwise every search returns empty despite
      // the catalog being populated.
      if (ms.documentCount > 0) return ms
      const dbCount = await Products.count()
      if (dbCount === 0) return ms
      console.warn(
        `[oxygen-helper] search index had 0 docs but IDB has ${dbCount}; rebuilding`,
      )
    } catch (err) {
      console.warn('[oxygen-helper] search index rehydrate failed; rebuilding', err)
    }
  }
  await rebuildFromDB()
  return ms!
}

/**
 * Local-only search — MiniSearch index + direct IDB lookups for code-like
 * queries. Fast (<5ms on a 10k catalog) and works offline. Used by:
 *   - The popup search tab as the first half of parallel search.
 *   - JARVIS agent tools that need to count/filter without API round-trips.
 *   - Flow 1 duplicate detection.
 */
export async function searchLocal(query: string, limit = 20): Promise<SearchResults> {
  const q = query.trim()
  if (!q) return { query: q, exact: [], fuzzy: [] }

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

  return { query: q, exact: exactHits, fuzzy: fuzzyHits }
}

/**
 * Remote-only search — hits /products?search= for authoritative, always-fresh
 * results. Slower (200-400ms network round-trip) and can fail. Used by the
 * popup search tab as the second half of parallel search. We filter the API
 * response client-side because /products?search= sometimes returns the whole
 * catalog when no match is found.
 */
export async function searchRemoteOnly(
  query: string,
  limit = 20,
): Promise<SearchResults> {
  const q = query.trim()
  if (!q) return { query: q, exact: [], fuzzy: [] }
  const terms = tokenizeQuery(q)
  const hits = (await searchRemote(q, limit * 3)).filter((h) =>
    termsMatchProduct(h.product, terms),
  )
  return { query: q, exact: [], fuzzy: hits.slice(0, limit) }
}

/**
 * Backwards-compatible combined search — local first, remote only as fallback
 * when local returns nothing. Used by the agent slash commands and other
 * in-process callers that expect a single synchronous-looking result.
 */
export async function search(query: string, limit = 20): Promise<SearchResults> {
  const local = await searchLocal(query, limit)
  if (local.exact.length > 0 || local.fuzzy.length > 0) return local
  try {
    return await searchRemoteOnly(query, limit)
  } catch (err) {
    console.warn('[oxygen-helper] remote search fallback failed', err)
    return local
  }
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
  const [{ apiRequest }, { normalizeProduct }] = await Promise.all([
    import('@/background/api/client'),
    import('@/background/api/endpoints'),
  ])
  type Wrapped = { data?: unknown[] } | unknown[]
  const res = await apiRequest<Wrapped>('/products', {
    query: { search: query, per_page: limit },
  })
  const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
  if (!list.length) return []

  // Run the full normalizer used by bootstrap sync so we get every field the
  // API returns. Anything the search endpoint omits (category, mydata_*,
  // supplier_id, etc.) comes back undefined from normalizeProduct — we then
  // merge with the existing IDB record to retain those fields instead of
  // overwriting them with undefined.
  const hits: CatalogSearchHit[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const fresh = normalizeProduct(raw)
    if (!fresh.id) continue
    const existing = await Products.get(fresh.id)
    const merged = mergeProducts(existing, fresh)
    hits.push({ product: merged, tier: 'fuzzy', score: 0.5, matched_field: 'remote' })
    // Backfill local cache + index so next search is instant AND keeps the
    // broader data (category_name, supplier_code, etc.) intact.
    Products.put(merged).catch(() => void 0)
    addOrUpdate(merged).catch(() => void 0)
  }
  return hits
}

/**
 * Merge an existing IDB product with a fresh remote record. Strategy:
 *   - Start with existing so we retain any fields the search endpoint didn't
 *     return (e.g. mydata_income_*, supplier_id, category relations).
 *   - Overwrite with fresh fields that are defined AND non-empty — a field
 *     set to undefined on fresh means "the search endpoint didn't send it",
 *     not "this should be cleared".
 *   - Special-case `warehouses`: the search endpoint typically does return
 *     stock, so prefer fresh when it has entries, fall back to existing when
 *     it came back empty.
 */
function mergeProducts(existing: Product | undefined, fresh: Product): Product {
  if (!existing) return fresh
  const out: Product = { ...existing }
  for (const [k, v] of Object.entries(fresh) as Array<[keyof Product, unknown]>) {
    if (v === undefined) continue
    if (v === '' && existing[k] !== undefined && existing[k] !== '') continue
    ;(out as unknown as Record<string, unknown>)[k as string] = v
  }
  const freshWarehouses = Array.isArray(fresh.warehouses) ? fresh.warehouses : []
  const existingWarehouses = Array.isArray(existing.warehouses) ? existing.warehouses : []
  out.warehouses = freshWarehouses.length ? freshWarehouses : existingWarehouses
  return out
}
