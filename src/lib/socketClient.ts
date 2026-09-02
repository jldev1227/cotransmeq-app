import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null
let connected = false
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10

const TOKEN_KEY = 'transmeralda_token'

export function getSocket(): Socket | null {
	return socket
}

export function isConnected(): boolean {
	return connected
}

/** Token de sesión guardado por `authStore`. */
function tokenActual(): string | undefined {
	if (typeof localStorage === 'undefined') return undefined
	return localStorage.getItem(TOKEN_KEY) || undefined
}

/**
 * Conecta (o reutiliza) el socket compartido.
 *
 * El token va SIEMPRE, aunque el llamador no lo pase: el backend verifica el
 * handshake (`SOCKET_AUTH_MODE`) y usa esa identidad para firmar las
 * escrituras. Antes esto era un problema real: `if (socket) return socket`
 * hacía que solo contara el token de la PRIMERA llamada, y todas las llamadas
 * de los canvas eran `connectSocket()` sin argumentos — así que en la
 * práctica el socket viajaba sin credenciales y el servidor se creía la
 * identidad que el cliente declarara en cada evento.
 *
 * Si el token cambió (login/logout en otra pestaña), se fuerza la reconexión
 * para rehacer el handshake con el nuevo.
 */
export function connectSocket(token?: string): Socket {
	const t = token ?? tokenActual()

	if (socket) {
		const actual = (socket.auth as any)?.token
		if (t && actual !== t) {
			socket.auth = { token: t }
			socket.disconnect().connect()
		}
		return socket
	}

	socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
		autoConnect: true,
		reconnection: true,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000,
		reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
		auth: t ? { token: t } : {}
	})

	socket.on('connect', () => {
		connected = true
		reconnectAttempts = 0
		console.log('[socket] connected:', socket?.id)
	})

	socket.on('disconnect', () => {
		connected = false
		console.log('[socket] disconnected')
	})

	socket.on('connect_error', (err) => {
		reconnectAttempts++
		console.error('[socket] connect_error:', err.message)
		// Con `SOCKET_AUTH_MODE=enforce` el servidor rechaza el handshake sin
		// token válido. Reintentar con las mismas credenciales no arregla nada.
		if (/unauthorized/i.test(err.message)) {
			console.error(
				'[socket] handshake rechazado por autenticación — revisa la sesión.'
			)
		}
	})

	return socket
}

export function disconnectSocket() {
	if (socket) {
		socket.disconnect()
		socket = null
		connected = false
	}
}
