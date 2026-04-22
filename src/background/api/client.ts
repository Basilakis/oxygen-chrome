import { getSettings } from '@/background/storage/settings'
import { OxygenApiError, OxygenAuthError } from './errors'
import { sleep } from '@/shared/util'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  query?: Record<string, string | number | undefined>
  body?: unknown
  retry?: boolean
  signal?: AbortSignal
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const trimmed = base.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${trimmed}${suffix}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

let authInvalid = false

export function isAuthInvalid(): boolean {
  return authInvalid
}

export function resetAuthInvalid(): void {
  authInvalid = false
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const settings = await getSettings()
  if (!settings.token) throw new OxygenAuthError({ message: 'no token configured' })

  const url = buildUrl(settings.base_url, path, opts.query)
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${settings.token}`,
  }
  let body: string | undefined
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json'
  }

  const attempt = async (): Promise<T> => {
    const res = await fetch(url, { method, headers, body, signal: opts.signal })
    const raw = await res.text()
    let parsed: unknown = null
    if (raw) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }
    if (res.status >= 200 && res.status < 300) {
      return parsed as T
    }
    if (res.status === 401) {
      authInvalid = true
      throw new OxygenAuthError(parsed)
    }
    throw new OxygenApiError(
      `HTTP ${res.status} on ${method} ${path}`,
      res.status,
      parsed,
    )
  }

  try {
    return await attempt()
  } catch (err) {
    if (!(err instanceof OxygenApiError)) {
      if (opts.retry !== false) {
        await sleep(1000)
        try {
          return await attempt()
        } catch (err2) {
          if (!(err2 instanceof OxygenApiError)) {
            await sleep(3000)
            return await attempt()
          }
          throw err2
        }
      }
      throw err
    }
    if (err.status === 429 && opts.retry !== false) {
      await sleep(2000)
      return await attempt()
    }
    throw err
  }
}

// Helper that tries query-string style first, falls back to path-inlined for quirky endpoints (/vat-check, /vies).
export async function apiRequestWithFallback<T = unknown>(
  path: string,
  key: string,
  value: string,
  opts: Omit<RequestOptions, 'query'> = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, { ...opts, query: { [key]: value } })
  } catch (err) {
    if (err instanceof OxygenApiError && err.status === 404) {
      const suffixed = path.endsWith('/') ? `${path}${encodeURIComponent(value)}` : `${path}/${encodeURIComponent(value)}`
      return apiRequest<T>(suffixed, opts)
    }
    throw err
  }
}
