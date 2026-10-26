import { env } from '$env/dynamic/private'
import type { RequestHandler } from './$types'

const BACKEND_URL = (
  env.BACKEND_INTERNAL_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
).replace(/\/+$/, '')
const MAPA_URL = '/dashboard/servicios/mapa'

function volverConEstado(estado: 'connected' | 'error', code?: string): Response {
  const query = new URLSearchParams({ wialon: estado })
  if (code) query.set('code', code)
  return new Response(null, {
    status: 303,
    headers: {
      location: `${MAPA_URL}?${query}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer'
    }
  })
}

/** Recibe el token en el servidor y lo pasa al backend sin exponerlo al cliente. */
export const GET: RequestHandler = async ({ url, fetch }) => {
  const svcError = url.searchParams.get('svc_error')
  if (svcError && svcError !== '0') return volverConEstado('error', 'WIALON_AUTHORIZATION_FAILED')

  const token = url.searchParams.get('access_token')
  const state = url.searchParams.get('state')
  if (!token || !state) return volverConEstado('error', 'WIALON_CALLBACK_INCOMPLETE')

  try {
    const response = await fetch(`${BACKEND_URL}/api/maps/wialon/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, state, origin: url.origin }),
      signal: AbortSignal.timeout(25_000)
    })
    if (response.ok) return volverConEstado('connected')

    const data = (await response.json().catch(() => null)) as { code?: unknown } | null
    const code =
      typeof data?.code === 'string' && /^WIALON_[A-Z_]+$/.test(data.code)
        ? data.code
        : 'WIALON_BACKEND_BAD_RESPONSE'
    return volverConEstado('error', code)
  } catch {
    return volverConEstado('error', 'WIALON_BACKEND_UNAVAILABLE')
  }
}
