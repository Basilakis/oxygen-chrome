import { getSettings } from '@/background/storage/settings'

const ANTHROPIC_DIRECT_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_PROXY_URL = '/api/anthropic/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Extension shells hit Anthropic directly with the user's BYOK key.
 * Web shells hit our Vercel serverless proxy which injects ANTHROPIC_API_KEY
 * server-side — the browser never sees it.
 */
function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'document'
  // text blocks
  text?: string
  // tool_use blocks
  id?: string
  name?: string
  input?: Record<string, unknown>
  // tool_result blocks
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  cache_control?: { type: 'ephemeral' }
  // image / document blocks — base64-encoded binary payload
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface AnthropicRequest {
  model: string
  max_tokens: number
  system?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
  messages: AnthropicMessage[]
  tools?: AnthropicToolDef[]
}

export interface AnthropicResponse {
  id: string
  model: string
  role: 'assistant'
  content: AnthropicContentBlock[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export class AnthropicError extends Error {
  public status: number
  public body: unknown
  constructor(status: number, body: unknown) {
    let msg = `Anthropic API error (${status})`
    if (body && typeof body === 'object') {
      const err = (body as { error?: { message?: string } }).error
      if (err && typeof err.message === 'string' && err.message) msg = err.message
    }
    super(msg)
    this.name = 'AnthropicError'
    this.status = status
    this.body = body
  }
}

export async function callAnthropic(req: AnthropicRequest): Promise<AnthropicResponse> {
  const extension = isExtensionContext()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url: string

  if (extension) {
    const settings = await getSettings()
    if (!settings.anthropic_api_key) {
      throw new Error('Δεν έχει οριστεί Anthropic API key στις Ρυθμίσεις → Βοηθός AI.')
    }
    url = ANTHROPIC_DIRECT_URL
    headers['x-api-key'] = settings.anthropic_api_key
    headers['anthropic-version'] = ANTHROPIC_VERSION
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else {
    // Web shell — proxy through Vercel, key lives as ANTHROPIC_API_KEY env var
    url = ANTHROPIC_PROXY_URL
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  })
  const raw = await res.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = raw
  }
  if (res.status >= 200 && res.status < 300) {
    return parsed as AnthropicResponse
  }
  throw new AnthropicError(res.status, parsed)
}
