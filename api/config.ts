/**
 * Runtime-config endpoint for the web shell.
 *
 * The web client calls this once on boot to learn whether the deployment has
 * a server-side Oxygen token (in which case every user can use the app
 * without manually entering one) or whether each user must paste their own
 * token into Settings.
 *
 * We only return a boolean — the token itself never leaves the server.
 * The ACCESS_PWD gate is enforced by middleware.ts before this endpoint is
 * reached, so there's nothing to expose here about it.
 */

export const config = {
  runtime: 'edge',
}

export default function handler(): Response {
  return new Response(
    JSON.stringify({
      serverAuth: Boolean(process.env.OXYGEN_API_TOKEN),
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  )
}
