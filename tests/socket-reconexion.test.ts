/**
 * El cliente de socket sobrevive a que el backend se caiga y vuelva.
 *
 * Esto se escribe porque NO sobrevivía. La configuración era
 * `reconnectionAttempts: 5` con `reconnectionDelay: 1000` y el techo por
 * defecto de 5 s: los cinco intentos se agotaban en unos quince segundos.
 * Cualquier parada más larga —un deploy, el contenedor rearrancando, el
 * `tsx watch` recompilando— hacía que socket.io emitiera `reconnect_failed` y
 * NO volviera a intentarlo nunca. El backend volvía a estar arriba, el rótulo
 * seguía diciendo «Sin conexión» y la única salida era recargar la página.
 *
 * Lo que se fija aquí:
 *   1. los reintentos no se agotan
 *   2. el handshake tiene un tope de espera propio (el defecto de 20 s dejaba
 *      el backoff a paso de tortuga justo cuando más falta hacía)
 *   3. el token se relee en CADA intento, no se congela al crear el socket
 *   4. el cierre ordenado por el servidor —el único que socket.io no reintenta
 *      solo— se reintenta a mano
 *   5. un rechazo por identidad deja de reintentar en vez de martillear
 *   6. al reconectar se avisa para resincronizar: volver a tener canal no
 *      repone los eventos que se emitieron durante el corte
 *   7. un aviso de `offline` del navegador que no llega a tumbar el socket no
 *      deja el indicador diciendo «Reconectando» para siempre
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Token que devuelve el authStore doblado. Los tests lo cambian. */
let tokenVigente = 'token-inicial'

/** Opciones con las que se llamó a `io()`. */
let opcionesIo: Record<string, any> | undefined

const manejadores = new Map<string, Set<(data: unknown) => void>>()
const manejadoresManager = new Map<string, Set<(data: unknown) => void>>()

/** El Manager de socket.io: donde vive el backoff y se anuncian los intentos. */
const managerFalso = {
	on(evento: string, cb: (data: unknown) => void) {
		if (!manejadoresManager.has(evento)) manejadoresManager.set(evento, new Set())
		manejadoresManager.get(evento)!.add(cb)
	},
	reconnection: vi.fn(),
	/** Simula un evento del Manager (`reconnect_attempt`, `reconnect_failed`). */
	emitir(evento: string, datos?: unknown) {
		for (const cb of manejadoresManager.get(evento) ?? []) cb(datos)
	}
}

const socketFalso = {
	connected: false,
	id: 'socket-de-prueba',
	io: managerFalso,
	on(evento: string, cb: (data: unknown) => void) {
		if (!manejadores.has(evento)) manejadores.set(evento, new Set())
		manejadores.get(evento)!.add(cb)
	},
	off(evento: string, cb?: (data: unknown) => void) {
		if (!cb) manejadores.delete(evento)
		else manejadores.get(evento)?.delete(cb)
	},
	emit: vi.fn(),
	connect: vi.fn(),
	disconnect: vi.fn(),
	/** Simula la llegada de un evento del servidor. */
	recibir(evento: string, datos?: unknown) {
		for (const cb of manejadores.get(evento) ?? []) cb(datos)
	}
}

vi.mock('socket.io-client', () => ({
	io: (_url: string, opts: Record<string, any>) => {
		opcionesIo = opts
		// Un socket recién creado no trae handlers ni conexión. Sin esto, cada
		// `reconectar()` apilaría otra copia de los listeners internos sobre el
		// mismo doble y un solo `connect` los ejecutaría todos.
		manejadores.clear()
		manejadoresManager.clear()
		socketFalso.connected = false
		return socketFalso
	},
	Socket: class {}
}))

vi.mock('$lib/stores/auth', () => ({
	authStore: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({ token: tokenVigente, user: { id: 'u1' } })
			return () => {}
		},
		getToken: () => tokenVigente,
		getUser: () => ({ id: 'u1' }),
		logout: vi.fn()
	}
}))

const { socketUtils, socketManager, socketStore } = await import('$lib/socket')
const { get } = await import('svelte/store')

/** Deja el socket en «conectado» como si el servidor hubiera respondido. */
function conectar() {
	socketFalso.connected = true
	socketFalso.recibir('connect')
}

/** Simula la caída del servidor. */
function caer(motivo = 'transport close') {
	socketFalso.connected = false
	socketFalso.recibir('disconnect', motivo)
}

describe('Reintentos y tiempos de espera del socket', () => {
	beforeEach(() => {
		socketFalso.connect.mockClear()
		socketFalso.emit.mockClear()
		managerFalso.reconnection.mockClear()
	})

	it('no se rinde nunca: los reintentos son infinitos', () => {
		// Con los 5 de antes, un backend que tardara más de ~15 s en volver
		// dejaba al cliente muerto hasta que alguien recargara la página.
		expect(opcionesIo?.reconnectionAttempts).toBe(Infinity)
		expect(opcionesIo?.reconnection).toBe(true)
	})

	it('el backoff tiene techo y reparto para no martillear al backend', () => {
		expect(opcionesIo?.reconnectionDelay).toBeGreaterThan(0)
		expect(opcionesIo?.reconnectionDelayMax).toBeGreaterThanOrEqual(
			opcionesIo?.reconnectionDelay
		)
		// Sin jitter, todas las pestañas abiertas reintentan en el mismo
		// milisegundo y le caen encima al servidor justo al arrancar.
		expect(opcionesIo?.randomizationFactor).toBeGreaterThan(0)
	})

	it('el handshake no espera los 20 s por defecto', () => {
		expect(opcionesIo?.timeout).toBeGreaterThan(0)
		expect(opcionesIo?.timeout).toBeLessThan(20_000)
	})

	it('el token se relee en cada intento en vez de congelarse', () => {
		// `auth` tiene que ser una FUNCIÓN. Con el objeto que había antes, el
		// token quedaba fijado al crear el socket y tras renovar sesión todos
		// los reintentos seguían mandando el viejo.
		expect(typeof opcionesIo?.auth).toBe('function')

		const leer = () => {
			let capturado: Record<string, unknown> | undefined
			opcionesIo!.auth((d: Record<string, unknown>) => (capturado = d))
			return capturado
		}

		expect(leer()).toEqual({ token: 'token-inicial' })

		tokenVigente = 'token-renovado'
		expect(leer()).toEqual({ token: 'token-renovado' })

		tokenVigente = 'token-inicial'
	})
})

describe('Recuperación tras perder el canal', () => {
	beforeEach(() => {
		socketFalso.connect.mockClear()
		socketFalso.emit.mockClear()
		managerFalso.reconnection.mockClear()
		vi.useRealTimers()
	})

	it('el cierre ordenado por el servidor se reintenta a mano', async () => {
		vi.useFakeTimers()
		conectar()

		// Es el ÚNICO motivo que socket.io no reintenta por su cuenta. Sin este
		// reintento, un backend que cierre conexiones al pararse dejaba al
		// cliente colgado aunque volviera a levantarse un segundo después.
		caer('io server disconnect')
		expect(socketFalso.connect).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(1_500)
		expect(socketFalso.connect).toHaveBeenCalled()

		vi.useRealTimers()
	})

	it('una caída de transporte la reintenta socket.io, no nosotros', async () => {
		vi.useFakeTimers()
		conectar()
		socketFalso.connect.mockClear()

		caer('transport close')
		await vi.advanceTimersByTimeAsync(5_000)

		// Duplicar el reintento aquí solo abriría dos conexiones a la vez.
		expect(socketFalso.connect).not.toHaveBeenCalled()
		expect(get(socketStore).estado).toBe('reconectando')

		vi.useRealTimers()
	})

	it('al reconectar se avisa para resincronizar; al conectar por primera vez no', () => {
		const resincronizar = vi.fn()
		const baja = socketUtils.onReconnect(resincronizar)

		// El aviso NO es para la primera conexión: ahí no hay nada que reponer.
		// (El socket ya venía conectado de tests anteriores; se fuerza el estado
		// inicial recreándolo.)
		socketManager.reconectar()
		conectar()
		expect(resincronizar).not.toHaveBeenCalled()

		// Ahora sí: se cayó y volvió. Todo lo que el backend emitió durante el
		// corte se perdió, así que quien mantenga listas vivas debe releerlas.
		caer()
		conectar()
		expect(resincronizar).toHaveBeenCalledTimes(1)

		baja()
		caer()
		conectar()
		expect(resincronizar).toHaveBeenCalledTimes(1)
	})

	it('reconectar deja el estado en «conectado» y sin error', () => {
		socketManager.reconectar()
		conectar()

		const estado = get(socketStore)
		expect(estado.connected).toBe(true)
		expect(estado.estado).toBe('conectado')
		expect(estado.error).toBeNull()
		expect(estado.intentos).toBe(0)
		expect(estado.ultimaConexion).not.toBeNull()
	})

	it('al conectar se vuelve a entrar en el room del usuario', () => {
		socketManager.reconectar()
		conectar()

		// Sin esto, tras una reconexión el cliente no recibe nada de lo que el
		// backend manda a `user-<id>`: progresos de colas, sesión cerrada...
		expect(socketFalso.emit).toHaveBeenCalledWith('join-dashboard', 'u1')
	})
})

describe('El indicador no se queda avisando de un problema que ya no existe', () => {
	beforeEach(() => {
		socketManager.reconectar()
		conectar()
	})

	it('si el navegador dijo «offline» pero el socket aguantó, el estado se corrige', () => {
		// Reproduce lo que hace el listener de `offline`: marcar reconectando por
		// precaución. Si el canal nunca llegó a caerse no habrá ningún `connect`
		// que devuelva el estado a su sitio, y el chip del header se quedaba
		// diciendo «Reconectando» para siempre. Se vio en el navegador.
		socketStore.update((s) => ({ ...s, connected: false, estado: 'reconectando' }))

		socketManager.revisarConexion()

		const estado = get(socketStore)
		expect(estado.estado).toBe('conectado')
		expect(estado.connected).toBe(true)
		expect(estado.intentos).toBe(0)
	})

	it('si el socket sí está caído, revisar fuerza un intento en vez de mentir', () => {
		socketFalso.connected = false
		socketFalso.recibir('disconnect', 'transport close')
		socketFalso.connect.mockClear()

		socketManager.revisarConexion()

		expect(socketFalso.connect).toHaveBeenCalled()
		expect(get(socketStore).estado).toBe('reconectando')
	})
})

describe('Handshake rechazado por identidad', () => {
	beforeEach(() => {
		socketFalso.connect.mockClear()
		managerFalso.reconnection.mockClear()
		socketManager.reconectar()
	})

	it('deja de reintentar en vez de martillear con un token que no vale', () => {
		socketFalso.recibir('connect_error', new Error('unauthorized: token inválido'))

		expect(managerFalso.reconnection).toHaveBeenCalledWith(false)
		expect(get(socketStore).estado).toBe('rechazado')
		expect(get(socketStore).error).toBeTruthy()
	})

	it('un error de red corriente sí sigue reintentando', () => {
		socketFalso.recibir('connect_error', new Error('xhr poll error'))

		expect(managerFalso.reconnection).not.toHaveBeenCalled()
		expect(get(socketStore).estado).toBe('reconectando')
		expect(get(socketStore).intentos).toBe(1)
	})

	it('el aviso de error solo aparece tras insistir un poco', () => {
		// Un corte de un segundo no tiene por qué alarmar a nadie.
		socketFalso.recibir('connect_error', new Error('xhr poll error'))
		expect(get(socketStore).error).toBeNull()

		socketFalso.recibir('connect_error', new Error('xhr poll error'))
		socketFalso.recibir('connect_error', new Error('xhr poll error'))
		expect(get(socketStore).error).toBeTruthy()
	})
})
