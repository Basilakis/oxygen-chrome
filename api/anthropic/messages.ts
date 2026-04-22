/**
 * Vercel serverless proxy for Anthropic Messages API.
 *
 * The web-shell client posts to /api/anthropic/messages. We forward the body
 * as-is to api.anthropic.com after injecting the server-side API key. The
 * browser never sees ANTHROPIC_API_KEY.
 *
 * Set ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables.
 */

export const config = {
  runtime: 'edge',
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: { message: 'Method not allowed' } }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return json(
      { error: { message: 'Server misconfigured: ANTHROPIC_API_KEY is not set.' } },
      500,
    )
  }

  let body: string
  try {
    body = await req.text()
    // Validate JSON early so we fail fast with a clear message.
    JSON.parse(body)
  } catch {
    return json({ error: { message: 'Invalid JSON body' } }, 400)
  }

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body,
  })

  const respBody = await upstream.text()
  return new Response(respBody, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
