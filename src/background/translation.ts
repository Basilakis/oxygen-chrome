import { callAnthropic } from '@/background/agent/client'
import { getSettings } from '@/background/storage/settings'

/**
 * Tiny Claude-backed English → Greek translator for UI strings we don't
 * control. The main caller is the Materials Hub price-tracking summary,
 * which always comes back in English. Cache-first so the same summary
 * (very common across refreshes of the same product) doesn't re-hit the
 * API. Cache lives in chrome.storage.local keyed by the source text —
 * short snippets, no privacy concern, easy to invalidate by bumping the
 * version suffix if we ever change the prompt.
 */

const CACHE_KEY = 'oxygen_helper_translations_el_v1'
const MAX_CACHE_ENTRIES = 200

type Cache = Record<string, string>

async function readCache(): Promise<Cache> {
  try {
    const res = (await chrome.storage.local.get(CACHE_KEY)) as Record<string, unknown>
    const v = res[CACHE_KEY]
    if (v && typeof v === 'object') return v as Cache
  } catch {
    /* ignore — fall through to empty */
  }
  return {}
}

async function writeCache(cache: Cache): Promise<void> {
  // Crude eviction: if we grow past MAX_CACHE_ENTRIES, drop the oldest half.
  // Order follows insertion order in V8, so the first keys are oldest.
  const keys = Object.keys(cache)
  if (keys.length > MAX_CACHE_ENTRIES) {
    const drop = keys.slice(0, keys.length - MAX_CACHE_ENTRIES / 2)
    for (const k of drop) delete cache[k]
  }
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: cache })
  } catch {
    /* storage full or unavailable — caller already has the in-memory result */
  }
}

export async function translateToGreek(text: string): Promise<string> {
  const src = (text ?? '').trim()
  if (!src) {
    console.debug('[oxygen-helper:translation] empty input, skipping')
    return text
  }

  // Heuristic: skip the round-trip when the text is already mostly Greek.
  // Kept conservative (threshold 0.6 instead of 0.5) so mixed-language
  // strings like "Price 20€ from Πολυχρώμο" still get translated.
  if (looksGreek(src)) {
    console.debug('[oxygen-helper:translation] looksGreek → skip')
    return text
  }

  const cache = await readCache()
  const cached = cache[src]
  // Ignore cache entries that accidentally mirror the source — an earlier
  // version could have saved identity translations when the model echoed
  // the English back. Treat those as misses and re-translate.
  if (cached && cached.trim() && cached.trim() !== src) {
    console.debug('[oxygen-helper:translation] cache hit')
    return cached
  }

  const settings = await getSettings()
  if (!settings.anthropic_api_key) {
    console.warn(
      '[oxygen-helper:translation] no Anthropic key — add one in Settings → Βοηθός AI to enable automatic Greek translation of API summaries',
    )
    return text
  }

  try {
    const model = settings.anthropic_model || 'claude-haiku-4-5-20251001'
    console.debug('[oxygen-helper:translation] calling', model, 'chars:', src.length)
    const res = await callAnthropic({
      model,
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content:
            'Translate the following English text to Greek. Reply with ONLY ' +
            'the Greek translation — no preamble, no commentary, no quotes. ' +
            'Preserve numbers, currency values, retailer names, and domain ' +
            'names exactly as they appear.\n\n' +
            src,
        },
      ],
    })
    const out = (res.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => (b.text ?? '').trim())
      .join(' ')
      .trim()
    if (!out) {
      console.warn('[oxygen-helper:translation] empty response from model')
      return text
    }
    if (out === src) {
      console.warn('[oxygen-helper:translation] model echoed source, not caching')
      return text
    }
    cache[src] = out
    await writeCache(cache)
    console.debug('[oxygen-helper:translation] translated, cached. chars:', out.length)
    return out
  } catch (err) {
    console.warn('[oxygen-helper:translation] failed, returning original', err)
    return text
  }
}

/**
 * True when a string is already predominantly Greek. Uses ratio of Greek
 * letters (incl. extended block) over total letters — threshold 0.5 is
 * deliberately permissive so mixed "Ferrara τιμή 20€" passes as Greek.
 */
function looksGreek(s: string): boolean {
  let greek = 0
  let latin = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x0370 && code <= 0x03ff) greek += 1
    else if (code >= 0x1f00 && code <= 0x1fff) greek += 1
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1
  }
  const total = greek + latin
  if (total === 0) return true
  return greek / total >= 0.6
}
