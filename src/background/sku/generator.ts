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
}

export async function suggest(args: SuggestArgs = {}): Promise<string> {
  const settings = await getSettings()
  const products = await Products.all()
  const strategy = resolveStrategy(settings.sku_strategy, products)

  switch (strategy) {
    case 'numeric':
      return nextNumeric(products, args.explicitPrefix ?? settings.sku_prefix ?? '')
    case 'prefixed':
      return nextPrefixed(
        products,
        args.explicitPrefix ?? settings.sku_prefix ?? '',
        settings.sku_seq_padding ?? 0,
      )
    case 'category':
      return nextCategory(
        products,
        args.categoryName,
        args.explicitPrefix ?? settings.sku_prefix ?? '',
        settings.sku_seq_padding ?? 0,
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

function nextNumeric(products: Product[], prefix: string): string {
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
  return `${prefix}${max + 1}`
}

function nextPrefixed(products: Product[], prefix: string, padding: number): string {
  // "OX-0001" style. Default separator "-" unless the prefix already ends with
  // a separator char. If no prefix is set, fall through to numeric.
  if (!prefix) return nextNumeric(products, '')
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
  const next = max + 1
  const pad = Math.max(0, padding)
  return `${prefix}${sep}${String(next).padStart(pad, '0')}`
}

function nextCategory(
  products: Product[],
  categoryName: string | undefined,
  prefix: string,
  padding: number,
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
  const next = max + 1
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
