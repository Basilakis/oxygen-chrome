/**
 * Runtime config for the web shell.
 *
 * The web shell calls `loadRuntimeConfig()` once on boot to learn what the
 * server side has enabled. Currently: whether OXYGEN_API_TOKEN is set as a
 * Vercel env var, which means the user does NOT need to enter their own
 * Bearer token in Settings — the proxy injects the server token on every
 * request.
 *
 * In the Chrome extension, this module is still imported (the API client
 * reads it) but it short-circuits: extension runtime never has a server
 * side, so serverAuth is always false.
 */

export type RuntimeConfig = {
  serverAuth: boolean
}

const DEFAULT: RuntimeConfig = { serverAuth: false }

let cache: RuntimeConfig = DEFAULT
let loaded = false

function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (loaded) return cache
  if (isExtensionContext()) {
    cache = DEFAULT
    loaded = true
    return cache
  }
  try {
    const res = await fetch('/api/config', { cache: 'no-store' })
    if (res.ok) {
      const body = (await res.json()) as { serverAuth?: boolean }
      cache = { serverAuth: Boolean(body.serverAuth) }
    }
  } catch {
    // Network hiccup on boot — keep defaults. The API client will surface
    // any auth failures on the first real call anyway.
  }
  loaded = true
  return cache
}

export function getRuntimeConfig(): RuntimeConfig {
  return cache
}
