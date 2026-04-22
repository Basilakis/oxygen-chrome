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
  return asArray<{ quantity?: number }>(warehouses).reduce(
    (s, w) => s + (w.quantity ?? 0),
    0,
  )
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
  // Capture TWO required numbers + ONE optional number joined by x/X/×, plus
  // an optional unit suffix anchored at the end of the triple.
  const rx = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)(?:\s*[xX×]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)?\b/i
  const m = name.match(rx)
  if (!m) return null
  const a = parseMoney(m[1]!)
  const b = parseMoney(m[2]!)
  const cRaw = m[3]
  const c = cRaw ? parseMoney(cRaw) : undefined
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null
  const rawUnit = (m[4] ?? 'mm').toLowerCase() as 'mm' | 'cm' | 'm'
  const toMeters = rawUnit === 'm' ? 1 : rawUnit === 'cm' ? 0.01 : 0.001
  const toMm = rawUnit === 'm' ? 1000 : rawUnit === 'cm' ? 10 : 1
  const widthM = a * toMeters
  const heightM = b * toMeters
  return {
    widthM,
    heightM,
    areaSqm: round2(widthM * heightM * 1000) / 1000, // 3-dp for tiny panels
    unitLabel: rawUnit,
    source: m[0]!,
    raw: { a, b, c },
    mm: {
      width: Math.round(a * toMm),
      length: Math.round(b * toMm),
      height: c !== undefined && Number.isFinite(c) && c > 0 ? Math.round(c * toMm) : undefined,
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
