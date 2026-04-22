/**
 * Vercel Edge Middleware — access-password gate.
 *
 * Purpose: when ACCESS_PWD is set as a Vercel env var, the entire web app
 * (static files + /api/*) is protected by HTTP Basic Auth. Used for
 * single-user self-hosted deployments where the operator wants to restrict
 * access without building a login UI.
 *
 * If ACCESS_PWD is NOT set, the middleware is a no-op — the site is public
 * (or secured only by OXYGEN_API_TOKEN on the server and per-user tokens
 * in client localStorage, depending on how the operator configured it).
 *
 * The Chrome extension never runs through this middleware — it's a pure
 * browser-side bundle loaded from chrome-extension:// URLs.
 *
 * Username is ignored; any username is accepted as long as the password
 * matches. Keeps the prompt minimal for the operator.
 */

export const config = {
  // Run on everything except Vercel's internal asset plumbing.
  matcher: '/((?!_next/|_vercel/).*)',
}

const REALM = 'Oxygen Helper'

export default function middleware(request: Request): Response | undefined {
  const pw = process.env.ACCESS_PWD
  if (!pw) return undefined // no gate configured → continue

  const auth = request.headers.get('authorization')
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const idx = decoded.indexOf(':')
      const password = idx >= 0 ? decoded.slice(idx + 1) : decoded
      if (timingSafeEqual(password, pw)) return undefined
    } catch {
      // fall through to 401
    }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'www-authenticate': `Basic realm="${REALM}"`,
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
