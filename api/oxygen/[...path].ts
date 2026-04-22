/**
 * Vercel edge proxy for the Oxygen API.
 *
 * Web shell calls go to /api/oxygen/<path> instead of api.oxygen.gr/v1/<path>.
 *
 * Auth precedence:
 *   1. If OXYGEN_API_TOKEN is set as a Vercel env var, we use it server-side
 *      for every request. The client's Authorization header is ignored —
 *      useful for "single-owner" deployments where the operator wants one
 *      shared backing account.
 *   2. Otherwise, we forward whatever Authorization header the client sends.
 *      This matches the multi-user model where each user pastes their own
 *      Bearer token into Settings and it lives in their localStorage.
 *
 * The Chrome extension never hits this endpoint — it talks directly to
 * api.oxygen.gr with the user's BYOK token.
 */

export const config = {
  runtime: 'edge',
}

const UPSTREAM_BASE = 'https://api.oxygen.gr/v1'

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const subpath = url.pathname.replace(/^\/api\/oxygen/, '') || '/'
  const upstreamUrl = `${UPSTREAM_BASE}${subpath}${url.search}`

  const serverToken = process.env.OXYGEN_API_TOKEN
  const authHeader = serverToken
    ? `Bearer ${serverToken}`
    : req.headers.get('authorization')

  if (!authHeader) {
    return new Response(
      JSON.stringify({
        error: {
          message:
            'No Oxygen token provided. Either set OXYGEN_API_TOKEN as a Vercel env var, or enter a Bearer token in the app Settings.',
        },
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
  }

  const forwardHeaders: Record<string, string> = {
    accept: 'application/json',
    authorization: authHeader,
  }
  const incomingContentType = req.headers.get('content-type')
  if (incomingContentType) forwardHeaders['content-type'] = incomingContentType

  const hasBody =
    req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE'

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: hasBody ? await req.text() : undefined,
    })
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Proxy fetch failed: ${(err as Error).message}`,
        },
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }

  const body = await upstream.text()
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') || 'application/json',
    },
  })
}
