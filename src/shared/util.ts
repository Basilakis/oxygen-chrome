export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rnd}`
}

export function round2(n: number | string | null | undefined): number {
  const num = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100) / 100
}

/**
 * Collapse unknown "should be a list" values into a real array so downstream
 * `.reduce` / `.map` calls can't throw. The Oxygen API occasionally returns
 * warehouses (and similar relation fields) as `{}`, `null`, or keyed objects
 * when the list is empty or serialized by a different path — `?? []` alone
 * misses those, since only `null`/`undefined` trigger the fallback.
 */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export function sumStock(
  warehouses: unknown,
): number {
  // Oxygen responses send warehouse.quantity as a string (e.g. "204.00"),
  // which survives the store→IDB→MiniSearch roundtrip on products that
  // were fetched before our normalizer ran. A naive `s + w.quantity` then
  // does string concatenation, or worse falls through the `??` guard and
  // sums to 0 when the guard misreads "0.00"-like strings. Coerce via
  // parseMoney so both numeric and string-shaped quantities work.
  return asArray<{ quantity?: number | string }>(warehouses).reduce((s, w) => {
    const q = w.quantity
    if (typeof q === 'number' && Number.isFinite(q)) return s + q
    if (typeof q === 'string') return s + parseMoney(q)
    return s
  }, 0)
}

/**
 * Total stock for a product, resilient to the two API response shapes.
 *
 * The `/products` LIST endpoint sometimes returns an empty `warehouses`
 * array while still populating the top-level `quantity` aggregate — the
 * per-warehouse breakdown only shows up on the `/products/:id` DETAIL
 * endpoint (or the search endpoint). Using `sumStock(warehouses)` alone
 * then wrongly shows 0 on the auto-badge for any product that was
 * bootstrapped but never fetched in detail, even when the platform shows
 * a non-zero stock.
 *
 * Strategy: trust the warehouses breakdown when it's there; fall back
 * to the top-level aggregate otherwise.
 */
export function productStock(
  product: { quantity?: number | string | null; warehouses?: unknown } | null | undefined,
): number {
  if (!product) return 0
  const ws = asArray<{ quantity?: number | string }>(product.warehouses)
  if (ws.length > 0) return sumStock(ws)
  const q = product.quantity
  if (typeof q === 'number' && Number.isFinite(q)) return q
  if (typeof q === 'string') return parseMoney(q)
  return 0
}

/**
 * Flatten a category list into DFS order using a client-side parent map
 * (since Oxygen's API doesn't expose hierarchy). Result carries a `depth`
 * annotation so callers can render indented dropdowns without rebuilding
 * the tree structure themselves.
 *
 * - Roots: categories with no parent, or whose parent isn't in the input.
 * - Sort: alphabetical (Greek collation) at every level.
 * - Cycle guard: if `A → B → A` sneaks in, each id is visited at most once;
 *   any category left unvisited after the DFS pass is appended at depth 0.
 */
export type TreeCategoryInput = { id: string; name: string }
export type TreeCategoryNode = {
  id: string
  name: string
  depth: number
  parent_id?: string
  hasChildren: boolean
}

export function buildCategoryTree(
  categories: TreeCategoryInput[],
  parents: Record<string, string> | undefined,
): TreeCategoryNode[] {
  const parentMap = parents ?? {}
  const byId = new Map(categories.map((c) => [c.id, c]))
  const childrenMap: Record<string, string[]> = {}
  const rootIds: string[] = []
  for (const cat of categories) {
    const pid = parentMap[cat.id]
    if (pid && byId.has(pid) && pid !== cat.id) {
      ;(childrenMap[pid] ??= []).push(cat.id)
    } else {
      rootIds.push(cat.id)
    }
  }
  const sortByName = (ids: string[]) =>
    ids.sort((a, b) => {
      const na = byId.get(a)?.name ?? ''
      const nb = byId.get(b)?.name ?? ''
      return na.localeCompare(nb, 'el')
    })
  sortByName(rootIds)
  for (const kids of Object.values(childrenMap)) sortByName(kids)

  const result: TreeCategoryNode[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return
    seen.add(id)
    const c = byId.get(id)
    if (!c) return
    const kids = childrenMap[id] ?? []
    result.push({
      id,
      name: c.name,
      depth,
      parent_id: parentMap[id],
      hasChildren: kids.length > 0,
    })
    for (const kid of kids) visit(kid, depth + 1)
  }
  for (const rootId of rootIds) visit(rootId, 0)
  // Orphans from cycles or missing parents — render at root depth so they're
  // at least reachable.
  for (const cat of categories) {
    if (!seen.has(cat.id)) {
      result.push({ id: cat.id, name: cat.name, depth: 0, hasChildren: false })
    }
  }
  return result
}

/**
 * True if making `candidateParent` the parent of `childId` would introduce
 * a cycle — i.e. childId is already an ancestor of candidateParent. Used by
 * the settings UI to disable invalid parent choices in the dropdown.
 */
export function wouldCreateCycle(
  childId: string,
  candidateParent: string,
  parents: Record<string, string>,
): boolean {
  if (childId === candidateParent) return true
  let cursor: string | undefined = candidateParent
  const seen = new Set<string>()
  while (cursor) {
    if (seen.has(cursor)) return true // existing cycle, treat as invalid
    seen.add(cursor)
    if (cursor === childId) return true
    cursor = parents[cursor]
  }
  return false
}

/**
 * Extract physical dimensions from a product name by scanning for an
 * AxBxC descriptor. Handles common Greek-invoice formats like:
 *   "ΤΖΑΜΙ 4100x640x8mm"       → 4100 × 640 × 8 mm
 *   "ΠΛΑΚΑΚΙ 60x60cm"          → 600 × 600 mm (normalised)
 *   "ΞΥΛΟ 2.5x1.2m"            → 2500 × 1200 mm
 *   "ΠΑΝΕΛ 1200 x 2400 mm"     → 1200 × 2400 mm
 *
 * Rules:
 *   - Two or three numbers separated by `x`/`X`/`×` (with optional spaces).
 *   - Optional trailing unit (`mm`/`cm`/`m`); defaults to mm (AADE norm).
 *   - Returns every captured dimension in BOTH the original unit and
 *     millimetres so callers can pick (display vs. storage).
 *   - `height` / `third` is the smallest value in panels (thickness/depth);
 *     we don't relabel it because Oxygen's metadata schema uses the three
 *     words width/length/height directly and the convention is up to the
 *     product type. Callers map freely.
 *   - Returns null if no WxH pair is detected.
 */
export type ParsedDimensions = {
  widthM: number
  heightM: number
  areaSqm: number
  unitLabel: 'mm' | 'cm' | 'm'
  source: string
  /** Raw numbers as they appeared in the name, unit-preserved. */
  raw: { a: number; b: number; c?: number }
  /** All three dimensions normalised to millimetres (most common Oxygen unit). */
  mm: { width: number; length: number; height?: number }
}

export function parseAreaFromName(name: string): ParsedDimensions | null {
  if (!name) return null
  // Separator class includes Greek chi (Χ/χ) alongside Latin x/X and the
  // multiplication sign × — Greek product names very commonly type the
  // Greek letter as the dimension separator ("1200Χ2400mm"), and without
  // it the third dimension silently drops. The `i` flag handles case but
  // does NOT unify Greek↔Latin, so both have to be listed explicitly.
  const SEP = '[xX×Χχ]'
  const rx = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*${SEP}\\s*(\\d+(?:[.,]\\d+)?)(?:\\s*${SEP}\\s*(\\d+(?:[.,]\\d+)?))?\\s*(mm|cm|m)?\\b`,
    'i',
  )
  const m = name.match(rx)
  if (!m) return null
  const a = parseMoney(m[1]!)
  const b = parseMoney(m[2]!)
  const cRaw = m[3]
  const c = cRaw ? parseMoney(cRaw) : undefined
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null
  const rawUnit = (m[4] ?? 'mm').toLowerCase() as 'mm' | 'cm' | 'm'
  const toMm = rawUnit === 'm' ? 1000 : rawUnit === 'cm' ? 10 : 1

  // Values in mm — NOT rounded. Gypsum boards and similar products have
  // 12.5mm thickness; Math.round turns that into 13 and wrecks sqm pricing.
  const aMm = a * toMm
  const bMm = b * toMm
  const cMm = c !== undefined && Number.isFinite(c) && c > 0 ? c * toMm : undefined

  // Semantic mapping into width/length/height:
  //   - Three dims: the smallest is almost always thickness/depth (the
  //     "height" slot in Oxygen's metadata). The remaining two are the
  //     face dimensions — smaller → width, larger → length. Matches the
  //     Greek invoicing convention for plaster boards, glass, panels:
  //       "ΓΥΨ 12,5Χ1200Χ2000mm" → thickness 12.5, width 1200, length 2000
  //       "ΤΖΑΜΙ 4100x640x8mm"   → thickness 8,    width 640,  length 4100
  //   - Two dims: smaller → width, larger → length, no thickness.
  // Callers who want the raw positional values can still read `raw.a/b/c`.
  let widthMm = aMm
  let lengthMm = bMm
  let heightMm: number | undefined
  if (cMm !== undefined) {
    const sorted = [aMm, bMm, cMm].sort((x, y) => x - y)
    heightMm = sorted[0]
    widthMm = sorted[1]!
    lengthMm = sorted[2]!
  } else if (bMm < aMm) {
    widthMm = bMm
    lengthMm = aMm
  }

  const widthM = widthMm / 1000
  const lengthM = lengthMm / 1000
  return {
    // `widthM` / `heightM` here stand for the two face dimensions used by
    // the sqm math below. Naming kept for backward compat with the SQM↔
    // PIECES conversion in the prefill modal; the face area is w × l so
    // order doesn't matter.
    widthM,
    heightM: lengthM,
    areaSqm: widthM * lengthM,
    unitLabel: rawUnit,
    source: m[0]!,
    raw: { a, b, c },
    mm: {
      width: widthMm,
      length: lengthMm,
      height: heightMm,
    },
  }
}

/**
 * Parse a number string that may be formatted in Greek/European (`1.234,56`),
 * US (`1,234.56`), or plain (`5.796`) style. The previous implementation
 * stripped every `.` followed by exactly 3 digits as a thousand separator,
 * which mangled legitimate decimals like `5.796` into `5796`. This version
 * disambiguates by counting separators and picking the decimal as the last
 * separator to appear.
 *
 * Rules:
 *   - Only one `.` and no `,` → `.` is the decimal (preserves `5.796`).
 *   - Only one `,` and no `.` → `,` is the decimal (Greek: `5,796` → 5.796).
 *   - Multiple `.` and no `,` → all thousand separators (`1.234.567` → 1234567).
 *   - Multiple `,` and no `.` → all thousand separators (`1,234,567` → 1234567).
 *   - Both present → the LAST-appearing separator is the decimal, the other
 *     is thousands. Handles both `1.234,56` (European) and `1,234.56` (US).
 */
export function parseMoney(s: string | number | undefined | null): number {
  if (s === null || s === undefined) return 0
  if (typeof s === 'number') return s
  const str = s.toString().replace(/[^\d,.\-]/g, '')
  if (!str) return 0

  const dotCount = (str.match(/\./g) || []).length
  const commaCount = (str.match(/,/g) || []).length

  let normalized: string
  if (dotCount === 0 && commaCount === 0) {
    normalized = str
  } else if (dotCount >= 1 && commaCount >= 1) {
    const lastDot = str.lastIndexOf('.')
    const lastComma = str.lastIndexOf(',')
    if (lastComma > lastDot) {
      // European: `1.234,56`
      normalized = str.replace(/\./g, '').replace(',', '.')
    } else {
      // US: `1,234.56`
      normalized = str.replace(/,/g, '')
    }
  } else if (dotCount > 1) {
    normalized = str.replace(/\./g, '')
  } else if (commaCount > 1) {
    normalized = str.replace(/,/g, '')
  } else if (commaCount === 1) {
    normalized = str.replace(',', '.')
  } else {
    // Single `.`, no commas → decimal, leave as-is.
    normalized = str
  }
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : 0
}

export function formatMoney(n: number | string | null | undefined, currency = '€'): string {
  // Oxygen API returns money fields as strings ("42.00") in several endpoints;
  // coerce here so every render site doesn't have to guard against it.
  const num = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
  const safe = Number.isFinite(num) ? num : 0
  return `${currency}${safe.toFixed(2).replace('.', ',')}`
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function normalizeCode(s: string | undefined | null): string {
  return (s ?? '').toString().trim().toUpperCase()
}

export function looksCodeLike(q: string): boolean {
  const s = q.trim()
  if (!s) return false
  if (s.length > 32) return false
  if (/\s/.test(s)) return false
  return /^[A-Za-z0-9][A-Za-z0-9.\-_/]*$/.test(s)
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...args: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function assertNever(x: never, msg = 'unreachable'): never {
  throw new Error(`${msg}: ${safeStringify(x)}`)
}
