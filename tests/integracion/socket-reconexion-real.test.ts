/**
 * El módulo REAL contra un servidor REAL que se cae y vuelve.
 *
 * `tests/socket-reconexion.test.ts` dobla `socket.io-client`: comprueba que
 * `lib/socket.ts` pide las opciones correctas y reacciona a los eventos
 * correctos, pero no prueba que socket.io haga con ellas lo que esperamos. Y
 * el fallo que se arregló vivía justo ahí: en cuántas veces reintenta de
 * verdad la librería antes de rendirse.
 *
 * Aquí no se dobla nada del transporte. Se levanta un socket.io de verdad, se
 * importa `lib/socket.ts` tal cual, se MATA el servidor más tiempo del que
 * sobrevivía la configuración anterior (~15 s) y se comprueba que el cliente
 * vuelve solo.
 *
 * Es lento a propósito (~35 s) y por eso vive fuera de la suite normal:
 *   npm run test:reconexion
 */

import { createServer, type Server as HttpServer } from 'node:http'
import { Server as IOServer, type Socket as SocketServidor } from 'socket.io'
import { afterAll, describe, expect, it, vi } from 'vitest'

const PUERTO = 45123

/**
 * Cuánto se mantiene caído el servidor.
 *
 * Tiene que superar los ~15 s en que se agotaban los 5 intentos de la
 * configuración anterior. Si alguien baja este número, el test pasa a no
 * demostrar nada: la configuración vieja también lo aprobaría.
 */
const CAIDA_MS = 22_000

let http: HttpServer | null = null
let ioSrv: IOServer | null = null
/** Sockets que ha visto el servidor, en orden de llegada. */
const conexionesServidor: SocketServidor[] = []
/** userIds recibidos por `join-dashboard`. */
const joins: string[] = []

function arrancarServidor(): Promise<void> {
	return new Promise((resolve) => {
		http = createServer()
		ioSrv = new IOServer(http, { cors: { origin: '*' } })
		ioSrv.on('connection', (socket) => {
			conexionesServidor.push(socket)
			socket.on('join-dashboard', (userId: string) => joins.push(userId))
		})
		http.listen(PUERTO, () => resolve())
	})
}

async function pararServidor(): Promise<void> {
	await new Promise<void>((resolve) => {
		if (!ioSrv) return resolve()
		// Cierra el io y el http que tiene debajo, y tira a los clientes: es lo
		// que le pasa a un backend al que se le hace un deploy.
		ioSrv.close(() => resolve())
	})
	ioSrv = null
	http = null
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Espera a que se cumpla una condición, o revienta. */
async function esperarA(cond: () => boolean, ms: number, queEsperaba: string) {
	const limite = Date.now() + ms
	while (Date.now() < limite) {
		if (cond()) return
		await espera(200)
	}
	throw new Error(`Se agotó la espera de: ${queEsperaba}`)
}

// El módulo lee la URL del backend de aquí, y se conecta al importarse: hay
// que dejarlo puesto y el servidor arriba ANTES del import.
vi.stubEnv('VITE_API_URL', `http://localhost:${PUERTO}`)

vi.mock('$lib/stores/auth', () => ({
	authStore: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({ token: 'token-de-prueba', user: { id: 'u-integracion' } })
			return () => {}
		},
		getToken: () => 'token-de-prueba',
		getUser: () => ({ id: 'u-integracion' }),
		logout: vi.fn()
	}
}))

await arrancarServidor()

const { socketUtils, socketManager, socketStore } = await import('$lib/socket')
const { get } = await import('svelte/store')

afterAll(async () => {
	socketManager.disconnect()
	await pararServidor()
})

describe('Reconexión real tras una caída larga del backend', () => {
	it(
		'el cliente vuelve solo aunque el servidor tarde más de lo que duraban los 5 intentos viejos',
		async () => {
			await esperarA(() => socketUtils.isConnected(), 10_000, 'la primera conexión')
			expect(get(socketStore).estado).toBe('conectado')
			expect(joins).toContain('u-integracion')

			// Se apunta a los avisos de reconexión y a un evento de dominio para
			// comprobar que los listeners siguen vivos al otro lado del corte.
			const resincronizar = vi.fn()
			socketUtils.onReconnect(resincronizar)
			const recibido: unknown[] = []
			socketUtils.on('evento-de-prueba', (d) => recibido.push(d))

			const idAntes = socketUtils.getSocketId()
			const conexionesAntes = conexionesServidor.length

			await pararServidor()
			await esperarA(
				() => !socketUtils.isConnected(),
				10_000,
				'que el cliente note la caída'
			)
			expect(get(socketStore).estado).toBe('reconectando')

			// El corte, más largo que la ventana en que la configuración anterior
			// se rendía para siempre.
			await espera(CAIDA_MS)
			expect(socketUtils.isConnected()).toBe(false)

			await arrancarServidor()

			await esperarA(
				() => socketUtils.isConnected(),
				20_000,
				'que el cliente vuelva por su cuenta'
			)

			// Conexión nueva de verdad, no un falso positivo del estado anterior.
			expect(socketUtils.getSocketId()).not.toBe(idAntes)
			expect(conexionesServidor.length).toBeGreaterThan(conexionesAntes)

			const estado = get(socketStore)
			expect(estado.connected).toBe(true)
			expect(estado.estado).toBe('conectado')
			expect(estado.error).toBeNull()

			// Se volvió a entrar al room propio: sin esto el cliente estaría
			// conectado pero sordo a todo lo dirigido a `user-<id>`.
			expect(joins.filter((j) => j === 'u-integracion').length).toBeGreaterThan(1)

			// Se avisó para resincronizar: los eventos del corte no vuelven solos.
			expect(resincronizar).toHaveBeenCalled()

			// Y los listeners de dominio siguen enganchados al socket nuevo.
			conexionesServidor[conexionesServidor.length - 1].emit('evento-de-prueba', { ok: true })
			await esperarA(() => recibido.length > 0, 5_000, 'un evento tras la reconexión')
			expect(recibido).toEqual([{ ok: true }])
		},
		90_000
	)

	it(
		'un cierre ordenado por el servidor también se recupera (socket.io no lo reintenta solo)',
		async () => {
			await esperarA(() => socketUtils.isConnected(), 10_000, 'estar conectado')
			const idAntes = socketUtils.getSocketId()

			// `disconnect(true)` manda un DISCONNECT: el cliente lo ve como
			// `io server disconnect` y socket.io NO reconecta. Si el reintento
			// manual no existiera, esto se quedaría colgado con el servidor arriba.
			conexionesServidor[conexionesServidor.length - 1].disconnect(true)

			await esperarA(() => !socketUtils.isConnected(), 5_000, 'que se note el cierre')
			await esperarA(
				() => socketUtils.isConnected() && socketUtils.getSocketId() !== idAntes,
				15_000,
				'que el cliente vuelva tras el cierre ordenado'
			)

			expect(get(socketStore).estado).toBe('conectado')
		},
		60_000
	)
})
