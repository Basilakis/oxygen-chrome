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

export function parseMoney(s: string | number | undefined | null): number {
  if (s === null || s === undefined) return 0
  if (typeof s === 'number') return s
  const normalized = s
    .replace(/[^\d,.\-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
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
