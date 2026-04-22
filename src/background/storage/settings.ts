import { STORAGE_KEY_SETTINGS, STORAGE_KEY_AUTH_CHECK } from '@/shared/constants'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types'
import { kv } from '@/core/storage/kv'

export async function getSettings(): Promise<Settings> {
  const stored = (await kv().get<Partial<Settings>>(STORAGE_KEY_SETTINGS)) ?? {}
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next = { ...current, ...patch }
  await kv().set(STORAGE_KEY_SETTINGS, next)
  return next
}

export async function clearToken(): Promise<Settings> {
  return updateSettings({ token: undefined })
}

export interface AuthCheck {
  ok: boolean
  at: number
  message?: string
}

export async function getAuthCheck(): Promise<AuthCheck | undefined> {
  return kv().get<AuthCheck>(STORAGE_KEY_AUTH_CHECK)
}

export async function setAuthCheck(check: AuthCheck): Promise<void> {
  await kv().set(STORAGE_KEY_AUTH_CHECK, check)
}
