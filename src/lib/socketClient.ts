import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null
let connected = false
let intentos = 0
/** Token con el que se hizo el handshake vigente. */
let tokenEnUso: string | undefined
/** El servidor rechazó el handshake: reintentar con lo mismo no sirve. */
let rechazadoPorAuth = false
let reintentoManual: ReturnType<typeof setTimeout> | null = null
let despertadoresInstalados = false
/** Callbacks a avisar cuando la conexión vuelve tras haberse caído. */
const listenersReconexion = new Set<() => void>()
/** ¿Hubo ya una conexión buena? Distingue conectar de RE-conectar. */
let huboConexion = false

const RECONEXION_DELAY = 1_000
const RECONEXION_DELAY_MAX = 10_000
const HANDSHAKE_TIMEOUT = 10_000
const RECHAZO_AUTH = /unauthorized/i

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
 * Avisa cuando la conexión VUELVE tras haberse caído.
 *
 * Los canvas colaborativos lo necesitan: mientras no había canal, los cambios
 * de los demás se emitieron al vacío. Volver a tener socket no repone esos
 * cambios; hay que releer la hoja. Devuelve la función de baja.
 */
export function onSocketReconnect(callback: () => void): () => void {
	listenersReconexion.add(callback)
	return () => {
		listenersReconexion.delete(callback)
	}
}

function avisarReconexion() {
	for (const cb of listenersReconexion) {
		try {
			cb()
		} catch (error) {
			console.error('[socket] error en un listener de reconexión:', error)
		}
	}
}

function cancelarReintentoManual() {
	if (reintentoManual) {
		clearTimeout(reintentoManual)
		reintentoManual = null
	}
}

/**
 * Reintento propio para los casos en que socket.io NO reintenta solo: el
 * cierre ordenado por el servidor y el agotamiento de su contador.
 */
function programarReintentoManual(retraso = RECONEXION_DELAY) {
	if (reintentoManual || rechazadoPorAuth) return
	reintentoManual = setTimeout(() => {
		reintentoManual = null
		if (rechazadoPorAuth) return
		if (socket && !socket.connected) socket.connect()
	}, retraso)
}

/**
 * Reintenta en cuanto el equipo vuelve a estar en condiciones.
 *
 * El backoff de socket.io es un `setTimeout` y los navegadores congelan los
 * temporizadores de las pestañas en segundo plano: un portátil que se suspende
 * con el canvas abierto despierta con el socket muerto y el siguiente intento
 * pendiente de un temporizador parado. Estos eventos son el «prueba ya».
 */
function instalarDespertadores() {
	if (despertadoresInstalados) return
	if (typeof window === 'undefined') return
	despertadoresInstalados = true

	const despertar = () => {
		if (rechazadoPorAuth) return
		if (!socket || socket.connected) return
		socket.connect()
	}

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') despertar()
	})
	window.addEventListener('online', despertar)
	window.addEventListener('focus', despertar)
	// Vuelta desde el bfcache: la página se restaura entera pero la conexión
	// TCP que tenía ya no existe.
	window.addEventListener('pageshow', despertar)
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
		if (t && tokenEnUso !== t) {
			tokenEnUso = t
			// Sesión nueva: el handshake anterior ya no representa a nadie y un
			// rechazo previo deja de ser definitivo.
			rechazadoPorAuth = false
			socket.io.reconnection(true)
			socket.disconnect().connect()
		} else if (!socket.connected && !rechazadoPorAuth) {
			// Alguien vuelve a pedir el socket y no hay canal: no se espera al
			// siguiente hueco del backoff, se intenta ya.
			socket.connect()
		}
		return socket
	}

	tokenEnUso = t

	socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
		autoConnect: true,
		reconnection: true,
		reconnectionDelay: RECONEXION_DELAY,
		reconnectionDelayMax: RECONEXION_DELAY_MAX,
		/// Antes eran 10 intentos.
		///
		/// Con el escalonado de socket.io eso es poco más de un minuto: si el
		/// backend tardaba más en volver —un deploy, el contenedor rearrancando,
		/// el `tsx watch` recompilando— el cliente emitía `reconnect_failed` y
		/// NO volvía a intentarlo jamás. El canvas se quedaba mudo con el
		/// servidor ya levantado y sin más pista que la consola.
		reconnectionAttempts: Infinity,
		// Jitter: sin él todos los clientes reintentan en el mismo milisegundo
		// y le caen encima al backend justo cuando acaba de arrancar.
		randomizationFactor: 0.5,
		// El defecto son 20 s. Con la red caída (sin RST) cada ciclo se comía
		// esos 20 s antes de darse por perdido.
		timeout: HANDSHAKE_TIMEOUT,
		/// Función, NO objeto: socket.io la vuelve a invocar en CADA intento de
		/// reconexión. Con `auth: { token: t }` el token quedaba congelado en la
		/// creación, así que tras renovar la sesión todos los reintentos
		/// viajaban con el viejo.
		auth: (cb: (datos: Record<string, unknown>) => void) => {
			const actual = tokenActual() ?? tokenEnUso
			cb(actual ? { token: actual } : {})
		}
	})

	socket.on('connect', () => {
		const esReconexion = huboConexion
		huboConexion = true
		connected = true
		intentos = 0
		rechazadoPorAuth = false
		cancelarReintentoManual()
		console.log('[socket] connected:', socket?.id)

		/// Volver a tener canal no significa estar al día: lo que el backend
		/// emitió durante el corte se perdió salvo lo que recupere el
		/// `connectionStateRecovery` del servidor. Quien tenga estado vivo
		/// (los canvas, el chat) tiene que releerlo.
		if (esReconexion) {
			console.log('[socket] reconectado — avisando para resincronizar')
			avisarReconexion()
		}
	})

	socket.on('disconnect', (reason) => {
		connected = false
		console.log('[socket] disconnected:', reason)

		/// socket.io reconecta solo en todos los casos MENOS cuando el cierre lo
		/// ordena el servidor (`socket.disconnect()` desde el backend, o el
		/// proceso cerrando conexiones al pararse). Ahí hay que volver a llamar
		/// a `connect()` a mano; no hacerlo dejaba el cliente colgado con el
		/// backend ya levantado.
		if (reason === 'io server disconnect') {
			console.warn('[socket] cierre ordenado por el servidor; reintentando a mano')
			programarReintentoManual()
		}
	})

	socket.on('connect_error', (err) => {
		intentos++
		console.error(`[socket] connect_error (intento ${intentos}):`, err.message)
		// Con `SOCKET_AUTH_MODE=enforce` el servidor rechaza el handshake sin
		// token válido. Reintentar con las mismas credenciales no arregla nada,
		// y con reintentos infinitos sería martillear el backend para siempre.
		if (RECHAZO_AUTH.test(err.message)) {
			rechazadoPorAuth = true
			cancelarReintentoManual()
			socket?.io.reconnection(false)
			console.error(
				'[socket] handshake rechazado por autenticación — revisa la sesión. ' +
					'No se reintenta hasta que cambie el token.'
			)
		}
	})

	/// Con `reconnectionAttempts: Infinity` esto no debería dispararse nunca.
	/// Se maneja igual: si algún día alguien vuelve a poner un número, el
	/// cliente no se queda muerto en silencio como estaba.
	socket.io.on('reconnect_failed', () => {
		console.error('[socket] socket.io agotó sus reintentos; se sigue por nuestra cuenta')
		programarReintentoManual(RECONEXION_DELAY_MAX)
	})

	instalarDespertadores()

	return socket
}

export function disconnectSocket() {
	cancelarReintentoManual()
	if (socket) {
		socket.disconnect()
		socket = null
		connected = false
		huboConexion = false
		rechazadoPorAuth = false
		tokenEnUso = undefined
		intentos = 0
	}
}
