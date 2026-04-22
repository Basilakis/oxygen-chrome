/**
 * Thin key-value store abstraction. Same API on both shells:
 *   - Chrome extension → chrome.storage.local
 *   - Web app         → localStorage (wrapped to look async)
 *
 * Why this exists: shared modules (settings, agent sessions, sync metadata)
 * need persistent storage that survives reloads. We want the same code to work
 * under both the Chrome extension and the Vercel-hosted web app, so we inject
 * the right backend at runtime based on `chrome.storage` availability.
 *
 * Values are serialized/deserialized as JSON — pass plain objects, dates are
 * numbers-of-ms, etc. Same contract as `chrome.storage.local` already has.
 */

export interface KVStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
}

class ChromeKVStore implements KVStore {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.local.get(key)
    return res[key] as T | undefined
  }
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  }
  async clear(): Promise<void> {
    await chrome.storage.local.clear()
  }
}

class WebKVStore implements KVStore {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined
    try {
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }
  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value))
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key)
  }
  async clear(): Promise<void> {
    localStorage.clear()
  }
}

/**
 * Ephemeral KV — for caches that can be rebuilt (e.g. the serialized
 * MiniSearch index). Extension uses `chrome.storage.session` (in-memory,
 * cleared on browser restart). Web uses `sessionStorage` (per-tab).
 */
class ChromeSessionKVStore implements KVStore {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.session.get(key)
    return res[key] as T | undefined
  }
  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.session.set({ [key]: value })
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.session.remove(key)
  }
  async clear(): Promise<void> {
    await chrome.storage.session.clear()
  }
}

class WebSessionKVStore implements KVStore {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = sessionStorage.getItem(key)
    if (raw === null) return undefined
    try {
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }
  async set(key: string, value: unknown): Promise<void> {
    sessionStorage.setItem(key, JSON.stringify(value))
  }
  async remove(key: string): Promise<void> {
    sessionStorage.removeItem(key)
  }
  async clear(): Promise<void> {
    sessionStorage.clear()
  }
}

/* ---------------------------------------------- runtime detection -- */

let persistentImpl: KVStore | null = null
let sessionImpl: KVStore | null = null

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome?.storage?.local &&
    !!chrome?.storage?.session
  )
}

/** Main persistent store (chrome.storage.local / localStorage). */
export function kv(): KVStore {
  if (persistentImpl) return persistentImpl
  if (hasChromeStorage()) {
    persistentImpl = new ChromeKVStore()
  } else if (typeof localStorage !== 'undefined') {
    persistentImpl = new WebKVStore()
  } else {
    throw new Error('No persistent KV backend available (neither chrome.storage nor localStorage).')
  }
  return persistentImpl
}

/** Ephemeral store (chrome.storage.session / sessionStorage). */
export function sessionKv(): KVStore {
  if (sessionImpl) return sessionImpl
  if (hasChromeStorage()) {
    sessionImpl = new ChromeSessionKVStore()
  } else if (typeof sessionStorage !== 'undefined') {
    sessionImpl = new WebSessionKVStore()
  } else {
    throw new Error('No session KV backend available.')
  }
  return sessionImpl
}

/** Tests + callers that want to inject a specific impl. */
export function setKVStore(impl: KVStore): void {
  persistentImpl = impl
}

export function setSessionKVStore(impl: KVStore): void {
  sessionImpl = impl
}
