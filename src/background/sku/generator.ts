import { Products } from '@/background/storage/stores'
import { getSettings } from '@/background/storage/settings'
import type { Product, SkuStrategy } from '@/shared/types'

/**
 * SKU suggestion, strategy-based.
 *
 * Each platform has its own convention — Oxygen uses pure integers, other
 * ERPs use prefixed counters, some use per-category sequences. Rather than
 * bake one in, we dispatch by strategy and provide an auto-detect that
 * inspects the existing catalog and picks the dominant pattern.
 *
 * Variation children (codes containing `.`) are excluded from max-seq math
 * so parents drive the numbering, not their variants.
 */

export interface SuggestArgs {
  description?: string
  categoryName?: string
  /** Force a specific prefix regardless of settings (used in some callers). */
  explicitPrefix?: string
  /**
   * Number to add on top of the usual `max+1` increment. Needed when a UI
   * batch (e.g. AADE invoice with N lines) asks for multiple next SKUs
   * before any are persisted — each call passes the index of the line it
   * represents so they don't all come back identical.
   */
  offset?: number
}

export async function suggest(args: SuggestArgs = {}): Promise<string> {
  const settings = await getSettings()
  const products = await Products.all()
  const offset = Math.max(0, args.offset ?? 0)

  // Auto mode derives everything (strategy AND prefix/separator/padding)
  // from the existing catalog. Manual settings.sku_prefix/padding are
  // ignored — that's the whole point of "auto."
  if (settings.sku_strategy === 'auto') {
    return buildAutoNext(products, args, offset)
  }

  const strategy = settings.sku_strategy
  switch (strategy) {
    case 'numeric':
      return nextNumeric(products, args.explicitPrefix ?? settings.sku_prefix ?? '', offset)
    case 'prefixed':
      return nextPrefixed(
        products,
        args.explicitPrefix ?? settings.sku_prefix ?? '',
        settings.sku_seq_padding ?? 0,
        offset,
      )
    case 'category':
      return nextCategory(
        products,
        args.categoryName,
        args.explicitPrefix ?? settings.sku_prefix ?? '',
        settings.sku_seq_padding ?? 0,
        offset,
      )
  }
}

export async function previewNext(
  args: SuggestArgs = {},
): Promise<{ strategy: Exclude<SkuStrategy, 'auto'>; next: string; resolved_from: 'manual' | 'auto' }> {
  const settings = await getSettings()
  const products = await Products.all()
  const strategy = resolveStrategy(settings.sku_strategy, products)
  const next = await suggest(args)
  return {
    strategy,
    next,
    resolved_from: settings.sku_strategy === 'auto' ? 'auto' : 'manual',
  }
}

export async function collides(code: string): Promise<boolean> {
  const existing = await Products.findByCode(code)
  return !!existing
}

/* ------------------------------------------------------------- strategy -- */

function resolveStrategy(
  pref: SkuStrategy,
  products: Product[],
): Exclude<SkuStrategy, 'auto'> {
  if (pref !== 'auto') return pref
  return detectStrategy(products)
}

/**
 * Auto-mode builder. Inspects the catalog, detects the dominant
 * prefix/separator/padding pattern, and returns the next SKU that follows it.
 *
 * Empty catalog → `"1"` (plain numeric, no prefix). This intentionally does
 * NOT fall back to settings.sku_prefix — if the user wanted a prefix they
 * should pick the "Με πρόθεμα" strategy instead of "Αυτόματος εντοπισμός."
 */
function buildAutoNext(products: Product[], args: SuggestArgs, offset: number): string {
  if (args.explicitPrefix !== undefined) {
    // Some callers (e.g. Flow 1 per-line override) force a prefix — honor it
    // and behave like the prefixed strategy from there.
    return nextPrefixed(products, args.explicitPrefix, 0, offset)
  }

  const pattern = detectPattern(products)
  if (!pattern) return String(1 + offset)

  if (pattern.strategy === 'category') {
    // Category pattern depends on the current category name — fall back to
    // the detected default prefix when no category is supplied.
    return nextCategory(products, args.categoryName, pattern.prefix, pattern.padding, offset)
  }

  const patStr = pattern.separator
    ? `^${escapeRx(pattern.prefix)}${escapeRx(pattern.separator)}(\\d+)$`
    : pattern.prefix
      ? `^${escapeRx(pattern.prefix)}(\\d+)$`
      : '^(\\d+)$'
  const rx = new RegExp(patStr)
  let max = 0
  for (const p of products) {
    const code = p.code
    if (!code || code.includes('.')) continue
    const m = code.match(rx)
    if (m) {
      const n = parseInt(m[1]!, 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const next = max + 1 + offset
  return `${pattern.prefix}${pattern.separator}${String(next).padStart(pattern.padding, '0')}`
}

/**
 * Dominant-pattern detector. Groups existing codes by
 * (strategy, prefix, separator, digit-count) and returns the bucket with the
 * highest count. Returns null for empty catalogs.
 *
 * Shape recognizers:
 *   numeric   "42"              → prefix='', separator='', padding=<digit-count>
 *   prefixed  "OX1" / "OX-001"  → prefix='OX', separator='' or '-', padding=<digit-count>
 *   category  "EPIP-PLAK-001"   → prefix='EPIP-PLAK', separator='-', padding=3
 */
type DetectedPattern = {
  strategy: Exclude<SkuStrategy, 'auto'>
  prefix: string
  separator: string
  padding: number
}

function detectPattern(products: Product[]): DetectedPattern | null {
  const numericRx = /^(\d+)$/
  const prefixedRx = /^([A-Za-zΑ-Ωα-ω]+)([-_]?)(\d+)$/
  const categoryRx = /^([A-Za-zΑ-Ωα-ω]+-[A-Za-zΑ-Ωα-ω]+)([-_])(\d+)$/

  type Bucket = DetectedPattern & { count: number }
  const buckets = new Map<string, Bucket>()

  const bump = (b: Omit<Bucket, 'count'>) => {
    const key = `${b.strategy}|${b.prefix}|${b.separator}|${b.padding}`
    const existing = buckets.get(key)
    if (existing) existing.count += 1
    else buckets.set(key, { ...b, count: 1 })
  }

  let samples = 0
  for (const p of products) {
    if (!p.code || p.code.includes('.')) continue
    samples += 1
    const cat = p.code.match(categoryRx)
    if (cat) {
      bump({ strategy: 'category', prefix: cat[1]!, separator: cat[2]!, padding: cat[3]!.length })
      continue
    }
    const pre = p.code.match(prefixedRx)
    if (pre) {
      bump({ strategy: 'prefixed', prefix: pre[1]!, separator: pre[2]!, padding: pre[3]!.length })
      continue
    }
    const num = p.code.match(numericRx)
    if (num) {
      bump({ strategy: 'numeric', prefix: '', separator: '', padding: num[1]!.length })
    }
  }

  if (!samples) return null
  let winner: Bucket | null = null
  for (const b of buckets.values()) {
    if (!winner || b.count > winner.count) winner = b
  }
  if (!winner) return null
  return {
    strategy: winner.strategy,
    prefix: winner.prefix,
    separator: winner.separator,
    // Pure-numeric pattern has no padding semantics — keep 0 so we don't
    // zero-pad the next integer.
    padding: winner.strategy === 'numeric' ? 0 : winner.padding,
  }
}

export function detectStrategy(products: Product[]): Exclude<SkuStrategy, 'auto'> {
  let numeric = 0
  let prefixed = 0
  let category = 0
  let samples = 0

  const numericRx = /^\d+$/
  // Letters (Greek or Latin) optionally followed by separator and digits
  const prefixedRx = /^[A-Za-zΑ-Ωα-ω]+[-_]?\d+$/
  // Letters-sep-letters-sep-digits (category-code shape)
  const categoryRx = /^[A-Za-zΑ-Ωα-ω]+[-_][A-Za-zΑ-Ωα-ω]+[-_]\d+$/

  for (const p of products) {
    if (!p.code) continue
    // Skip variation children — their codes follow the parent (2.1, 2.2)
    if (p.code.includes('.')) continue
    samples += 1
    if (categoryRx.test(p.code)) category += 1
    else if (prefixedRx.test(p.code)) prefixed += 1
    else if (numericRx.test(p.code)) numeric += 1
  }

  if (!samples) return 'numeric'
  const winner = Math.max(numeric, prefixed, category)
  if (winner === category) return 'category'
  if (winner === prefixed) return 'prefixed'
  return 'numeric'
}

/* ------------------------------------------------ per-strategy builders -- */

function nextNumeric(products: Product[], prefix: string, offset = 0): string {
  // `prefix` may be empty for pure integer codes. When a prefix is supplied,
  // require it on the existing codes to contribute to max-seq so unrelated
  // codes don't inflate the sequence.
  const rx = prefix ? new RegExp(`^${escapeRx(prefix)}(\\d+)$`) : /^(\d+)$/
  let max = 0
  for (const p of products) {
    const code = p.code
    if (!code || code.includes('.')) continue
    const m = code.match(rx)
    if (m) {
      const n = parseInt(m[1]!, 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return `${prefix}${max + 1 + offset}`
}

function nextPrefixed(products: Product[], prefix: string, padding: number, offset = 0): string {
  // "OX-0001" style. Default separator "-" unless the prefix already ends with
  // a separator char. If no prefix is set, fall through to numeric.
  if (!prefix) return nextNumeric(products, '', offset)
  const sep = /[-_]$/.test(prefix) ? '' : '-'
  const pattern = `^${escapeRx(prefix)}${escapeRx(sep)}?(\\d+)$`
  const rx = new RegExp(pattern)
  let max = 0
  for (const p of products) {
    const code = p.code
    if (!code || code.includes('.')) continue
    const m = code.match(rx)
    if (m) {
      const n = parseInt(m[1]!, 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const next = max + 1 + offset
  const pad = Math.max(0, padding)
  return `${prefix}${sep}${String(next).padStart(pad, '0')}`
}

function nextCategory(
  products: Product[],
  categoryName: string | undefined,
  prefix: string,
  padding: number,
  offset = 0,
): string {
  const cat = slugify(categoryName ?? '').slice(0, 4) || 'GEN'
  const head = prefix ? `${prefix}-${cat}` : cat
  const rx = new RegExp(`^${escapeRx(head)}-(\\d+)$`)
  let max = 0
  for (const p of products) {
    const code = p.code
    if (!code || code.includes('.')) continue
    const m = code.match(rx)
    if (m) {
      const n = parseInt(m[1]!, 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const next = max + 1 + offset
  const pad = Math.max(0, padding || 3)
  return `${head}-${String(next).padStart(pad, '0')}`
}

/* --------------------------------------------------------------- utils -- */

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-ZΑ-Ωα-ω0-9]+/g, '')
    .toUpperCase()
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
