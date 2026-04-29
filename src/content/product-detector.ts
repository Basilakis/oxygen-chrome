/**
 * Detects whether the current page is a product detail page and extracts the
 * key fields we'd want to use as a catalog search query.
 *
 * Strategies, most specific first:
 *   1. JSON-LD structured data (schema.org/Product)       — e-commerce standard
 *   2. OpenGraph meta tags with og:type=product           — Shopify, Magento, etc.
 *   3. Microdata (itemtype schema.org/Product)             — legacy
 *   4. Heuristic CSS selectors + singleton <h1> fallback   — generic
 *
 * Returns null if the page doesn't look like a product page.
 */

export type DetectionSource = 'jsonld' | 'og' | 'microdata' | 'heuristic' | 'manual'

export interface DetectedProduct {
  title: string
  price?: number
  currency?: string
  image?: string
  brand?: string
  sku?: string
  source: DetectionSource
}

/**
 * Domains we never run product detection on — SaaS tools, dev platforms,
 * mail, social, docs, etc. These pages often have exactly one visible <h1>
 * (the ticket/article/document title) which used to trick the heuristic
 * fallback into showing a "ΛΕΙΠΕΙ" badge on every Jira issue or Confluence
 * page. Explicit deny-list is faster and more reliable than trying to
 * out-guess every corporate CMS with signal-based heuristics.
 */
const DETECTOR_DOMAIN_DENYLIST = [
  // Atlassian
  /\.atlassian\.net$/i,
  /\.atlassian\.com$/i,
  /\.jira\.com$/i,
  /confluence\./i,
  // Dev platforms
  /(^|\.)github\.com$/i,
  /(^|\.)github\.io$/i,
  /(^|\.)gitlab\.com$/i,
  /(^|\.)bitbucket\.org$/i,
  // Productivity / docs
  /(^|\.)notion\.so$/i,
  /(^|\.)linear\.app$/i,
  /(^|\.)asana\.com$/i,
  /(^|\.)trello\.com$/i,
  /(^|\.)monday\.com$/i,
  /(^|\.)clickup\.com$/i,
  /(^|\.)airtable\.com$/i,
  /(^|\.)figma\.com$/i,
  /(^|\.)miro\.com$/i,
  // Google workspace
  /docs\.google\.com$/i,
  /drive\.google\.com$/i,
  /sheets\.google\.com$/i,
  /calendar\.google\.com$/i,
  /meet\.google\.com$/i,
  /mail\.google\.com$/i,
  // Microsoft / Office
  /office\.com$/i,
  /outlook\.(live|office|com)/i,
  /sharepoint\.com$/i,
  /teams\.microsoft\.com$/i,
  // Communication
  /(^|\.)slack\.com$/i,
  /(^|\.)discord\.com$/i,
  /(^|\.)zoom\.us$/i,
  // Social / content
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)stackoverflow\.com$/i,
  /(^|\.)stackexchange\.com$/i,
  // Our own
  /(^|\.)oxygen\.gr$/i,
  /(^|\.)pelatologio\.gr$/i,
]

function isDenylisted(): boolean {
  const host = window.location.hostname
  return DETECTOR_DOMAIN_DENYLIST.some((rx) => rx.test(host))
}

export function detectProduct(): DetectedProduct | null {
  if (isDenylisted()) return null
  const jsonld = detectJsonLd()
  if (jsonld) {
    console.debug('[oxygen-helper] product detected via JSON-LD:', jsonld)
    return jsonld
  }
  const og = detectOpenGraph()
  if (og) {
    console.debug('[oxygen-helper] product detected via OpenGraph:', og)
    return og
  }
  const md = detectMicrodata()
  if (md) {
    console.debug('[oxygen-helper] product detected via microdata:', md)
    return md
  }
  const heur = detectHeuristic()
  if (heur) {
    console.debug('[oxygen-helper] product detected via heuristic:', heur)
    return heur
  }
  console.debug(
    '[oxygen-helper] no product detected on',
    window.location.href,
    '— tried JSON-LD, OG, microdata, heuristic',
  )
  return null
}

/* ---------- 1. JSON-LD ---------------------------------------------------- */

function detectJsonLd(): DetectedProduct | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
  for (const script of Array.from(scripts)) {
    const raw = script.textContent?.trim()
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    for (const item of flattenGraph(parsed)) {
      if (!isProductNode(item)) continue
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers
      return {
        title: String(item.name ?? '').trim(),
        price: offer?.price ? toNumber(offer.price) : undefined,
        currency: typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : undefined,
        image: firstImage(item.image),
        brand: typeof item.brand === 'string' ? item.brand : item.brand?.name,
        sku: (item.sku ?? item.mpn ?? item.gtin ?? item.gtin13) as string | undefined,
        source: 'jsonld',
      }
    }
  }
  return null
}

type JsonLdNode = {
  '@type'?: string | string[]
  '@graph'?: unknown
  name?: string
  offers?: { price?: unknown; priceCurrency?: string } | Array<{ price?: unknown; priceCurrency?: string }>
  image?: unknown
  brand?: string | { name?: string }
  sku?: string
  mpn?: string
  gtin?: string
  gtin13?: string
}

function flattenGraph(data: unknown): JsonLdNode[] {
  if (Array.isArray(data)) return data.flatMap(flattenGraph)
  if (data && typeof data === 'object') {
    const node = data as JsonLdNode
    if (Array.isArray(node['@graph'])) {
      return [node, ...flattenGraph(node['@graph'])]
    }
    return [node]
  }
  return []
}

function isProductNode(item: JsonLdNode): boolean {
  const type = item['@type']
  if (!type) return false
  if (type === 'Product') return true
  if (Array.isArray(type) && type.includes('Product')) return true
  return false
}

function firstImage(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.length) {
    const first = v[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && 'url' in first) return (first as { url: string }).url
  }
  if (v && typeof v === 'object' && 'url' in v) return (v as { url: string }).url
  return undefined
}

/* ---------- 2. OpenGraph -------------------------------------------------- */

function detectOpenGraph(): DetectedProduct | null {
  const type = meta('og:type')
  if (type !== 'product' && type !== 'product.item' && type !== 'og:product') return null
  const title = meta('og:title') ?? document.title
  if (!title) return null
  return {
    title: title.trim(),
    price: toNumber(meta('product:price:amount') ?? meta('og:price:amount')),
    currency: meta('product:price:currency') ?? meta('og:price:currency'),
    image: meta('og:image'),
    brand: meta('product:brand') ?? meta('og:brand'),
    sku: meta('product:retailer_item_id'),
    source: 'og',
  }
}

function meta(property: string): string | undefined {
  const byProperty = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content
  if (byProperty) return byProperty
  const byName = document.querySelector<HTMLMetaElement>(`meta[name="${property}"]`)?.content
  return byName || undefined
}

/* ---------- 3. Microdata -------------------------------------------------- */

function detectMicrodata(): DetectedProduct | null {
  const root = document.querySelector('[itemtype*="schema.org/Product"]')
  if (!root) return null
  const name = textOrContent(root.querySelector('[itemprop="name"]'))
  if (!name) return null
  const price = textOrContent(root.querySelector('[itemprop="price"]'))
  const imgEl = root.querySelector<HTMLImageElement>('[itemprop="image"]')
  const image = imgEl?.src ?? imgEl?.getAttribute('content') ?? undefined
  const brand = textOrContent(root.querySelector('[itemprop="brand"]'))
  const sku = textOrContent(root.querySelector('[itemprop="sku"]'))
  return {
    title: name,
    price: toNumber(price),
    image,
    brand,
    sku,
    source: 'microdata',
  }
}

function textOrContent(el: Element | null | undefined): string | undefined {
  if (!el) return undefined
  const content = el.getAttribute('content')
  if (content) return content.trim()
  const text = (el as HTMLElement).textContent?.trim()
  return text || undefined
}

/* ---------- 4. Heuristic ------------------------------------------------- */

const HEURISTIC_SELECTORS = [
  'h1.product-title',
  'h1.product-name',
  'h1.product__title',
  'h1.pdp-title',
  'h1[itemprop="name"]',
  '.product-title h1',
  '.product-name h1',
  '.product__title h1',
  '[data-testid*="product-title"]',
  '[data-testid*="product-name"]',
  '[data-qa*="product-title"]',
  '.pdp h1',
  '.product-single__title',
  '.product-detail h1',
]

function detectHeuristic(): DetectedProduct | null {
  for (const s of HEURISTIC_SELECTORS) {
    const el = document.querySelector(s)
    const text = (el as HTMLElement | null)?.textContent?.trim()
    if (text && text.length > 2 && text.length < 400) {
      return { title: text, source: 'heuristic' }
    }
  }
  // Last-resort heuristic — keep it conservative. Require a product-shaped
  // URL AND at least one commerce-specific DOM signal (cart button or
  // price-valued element). The previous "any of three" rule was too lax
  // and fired on Jira/Confluence/generic `.html` pages that happen to have
  // a single visible h1.
  //
  // Also excludes the generic `.html?$` URL fallback entirely — too many
  // static sites end in .html without being product pages, and we'd rather
  // miss a real product than misfire on a blog post.
  const path = window.location.pathname.toLowerCase()
  const looksProductUrl = /\/(?:product|products|prod|item|items|dp|pdp|katalogos|προϊον)\//.test(
    path,
  )
  if (!looksProductUrl) return null

  const h1s = Array.from(document.querySelectorAll<HTMLElement>('h1')).filter(visible)
  if (h1s.length !== 1) return null
  const h1 = h1s[0]!
  const text = h1.textContent?.trim()
  if (!text || text.length <= 2 || text.length >= 400) return null

  const hasCartSignal = !!document.querySelector(
    '[class*="add-to-cart" i], [class*="addtocart" i], [class*="add_to_cart" i], [data-add-to-cart], [id*="add-to-cart" i], button[name*="add-to-cart" i]',
  )
  const hasPriceSignal = !!document.querySelector(
    '[itemprop="price"], [class*="price" i] [class*="amount" i], .product-price, .pdp-price, .price-current, .price-now',
  )

  if (!hasCartSignal && !hasPriceSignal) return null

  return { title: text, source: 'heuristic' }
}

function visible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
}

/* ---------- Helpers ------------------------------------------------------ */

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/* ---------- URL-change observer (for SPA nav) ---------------------------- */

export function observeUrlChanges(cb: (url: string) => void): () => void {
  let last = window.location.href
  const check = () => {
    if (window.location.href !== last) {
      last = window.location.href
      cb(last)
    }
  }

  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)

  const originalPush = history.pushState
  const originalReplace = history.replaceState
  history.pushState = function (...args: Parameters<typeof originalPush>) {
    const ret = originalPush.apply(this, args)
    check()
    return ret
  }
  history.replaceState = function (...args: Parameters<typeof originalReplace>) {
    const ret = originalReplace.apply(this, args)
    check()
    return ret
  }

  return () => {
    window.removeEventListener('popstate', check)
    window.removeEventListener('hashchange', check)
    history.pushState = originalPush
    history.replaceState = originalReplace
  }
}
