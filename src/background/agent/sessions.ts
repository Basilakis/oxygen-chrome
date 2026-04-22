import type { AnthropicMessage } from './client'
import { kv } from '@/core/storage/kv'

const STORAGE_KEY = 'agent_sessions'
const MAX_SESSIONS = 50

export interface AgentTurnSnapshot {
  role: 'user' | 'assistant' | 'system'
  text: string
  tool_calls?: Array<{ name: string; input: Record<string, unknown> }>
  usage?: { input_tokens: number; output_tokens: number; cache_read_tokens: number }
}

export interface AgentSession {
  id: string
  title: string
  created_at: number
  updated_at: number
  turns: AgentTurnSnapshot[]
  anthropic_history: AnthropicMessage[]
}

export async function listSessions(): Promise<AgentSession[]> {
  const arr = (await kv().get<AgentSession[]>(STORAGE_KEY)) ?? []
  return arr.sort((a, b) => b.updated_at - a.updated_at)
}

export async function getSession(id: string): Promise<AgentSession | null> {
  const all = await listSessions()
  return all.find((s) => s.id === id) ?? null
}

export async function saveSession(session: AgentSession): Promise<void> {
  const all = await listSessions()
  const filtered = all.filter((s) => s.id !== session.id)
  const updated = [session, ...filtered].slice(0, MAX_SESSIONS)
  await kv().set(STORAGE_KEY, updated)
}

export async function deleteSession(id: string): Promise<void> {
  const all = await listSessions()
  const updated = all.filter((s) => s.id !== id)
  await kv().set(STORAGE_KEY, updated)
}

export async function clearAllSessions(): Promise<void> {
  await kv().set(STORAGE_KEY, [])
}

export function createSessionFromTurns(
  turns: AgentTurnSnapshot[],
  anthropicHistory: AnthropicMessage[],
  existingId?: string,
): AgentSession {
  const firstUser = turns.find((t) => t.role === 'user')?.text ?? 'Νέα συνομιλία'
  const title = firstUser.length > 60 ? `${firstUser.slice(0, 57)}…` : firstUser
  const now = Date.now()
  return {
    id: existingId ?? uid(),
    title,
    created_at: now,
    updated_at: now,
    turns,
    anthropic_history: anthropicHistory,
  }
}

function uid(): string {
  return `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
