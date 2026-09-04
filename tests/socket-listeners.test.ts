/**
 * El alta y la baja de listeners del socket funcionan de verdad.
 *
 * Durante mucho tiempo NO funcionaron, y ese es el motivo de este archivo.
 * `on()` envolvía el callback en otro que hacía `console.log`, registraba el
 * ENVUELTO y guardaba el ENVUELTO; `off(evento, cb)` intentaba borrar el
 * original. Ni el `Set.delete` ni el `socket.off` encontraban nada.
 *
 * El efecto era invisible: las quince páginas que llamaban a `off` en su
 * `onDestroy` parecían correctas, no fallaba ningún test, no había ningún
 * aviso — y cada visita a una página dejaba un listener más. Tras N idas y
 * vueltas a `/dashboard/recargos`, cada `recargo-creado` ejecutaba su handler
 * N veces: N peticiones, N repintados, y en las páginas que refrescan la lista
 * entera, N recargas simultáneas.
 *
 * Lo que se fija aquí:
 *   1. dar de baja quita el listener de verdad
 *   2. suscribirse y desuscribirse en bucle no acumula nada
 *   3. la baja de uno no se lleva por delante la de otro
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Socket falso que registra altas y bajas como lo haría socket.io. */
const manejadores = new Map<string, Set<(data: unknown) => void>>()

const socketFalso = {
	connected: true,
	id: 'socket-de-prueba',
	on(evento: string, cb: (data: unknown) => void) {
		if (!manejadores.has(evento)) manejadores.set(evento, new Set())
		manejadores.get(evento)!.add(cb)
	},
	off(evento: string, cb?: (data: unknown) => void) {
		if (!cb) manejadores.delete(evento)
		else manejadores.get(evento)?.delete(cb)
	},
	emit: vi.fn(),
	disconnect: vi.fn(),
	/** Simula la llegada de un evento del servidor. */
	recibir(evento: string, datos: unknown) {
		for (const cb of manejadores.get(evento) ?? []) cb(datos)
	}
}

vi.mock('socket.io-client', () => ({
	io: () => socketFalso,
	Socket: class {}
}))

vi.mock('$lib/stores/auth', () => ({
	authStore: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({ token: 'tok', user: { id: 'u1' } })
			return () => {}
		},
		getToken: () => 'tok',
		getUser: () => ({ id: 'u1' }),
		logout: vi.fn()
	}
}))

const { socketUtils } = await import('$lib/socket')

/** Cuántos listeners hay realmente registrados en el socket para un evento. */
function registrados(evento: string): number {
	return manejadores.get(evento)?.size ?? 0
}

describe('Alta y baja de listeners del socket', () => {
	beforeEach(() => {
		manejadores.clear()
	})

	it('la función que devuelve on() da de baja el listener', () => {
		const handler = vi.fn()

		const baja = socketUtils.on('servicio:creado', handler)
		expect(registrados('servicio:creado')).toBe(1)

		baja()
		expect(registrados('servicio:creado')).toBe(0)

		socketFalso.recibir('servicio:creado', { id: 'x' })
		expect(handler).not.toHaveBeenCalled()
	})

	it('off(evento, handler) también da de baja — era el que no funcionaba', () => {
		const handler = vi.fn()

		socketUtils.on('servicio:actualizado', handler)
		socketUtils.off('servicio:actualizado', handler)

		expect(registrados('servicio:actualizado')).toBe(0)
		socketFalso.recibir('servicio:actualizado', { id: 'x' })
		expect(handler).not.toHaveBeenCalled()
	})

	it('entrar y salir de una página diez veces no acumula listeners', () => {
		const handler = vi.fn()

		for (let i = 0; i < 10; i++) {
			const baja = socketUtils.on('servicio:eliminado', handler)
			baja()
		}

		expect(registrados('servicio:eliminado')).toBe(0)

		// La última vuelta se queda suscrita, como una página abierta.
		socketUtils.on('servicio:eliminado', handler)
		socketFalso.recibir('servicio:eliminado', { id: 'x' })

		// Una sola vez. Con el fallo anterior habrían sido once.
		expect(handler).toHaveBeenCalledTimes(1)
	})

	it('dar de baja un listener no afecta a los de otro módulo', () => {
		// Es el fallo real que había: salir de /dashboard/conductores mataba el
		// listener de `dias-laborados:registro-actualizado` de
		// TablaDiasLaborados.svelte, que dejaba de actualizarse en silencio.
		const deLaPagina = vi.fn()
		const delComponente = vi.fn()

		const bajaPagina = socketUtils.on('dias-laborados:registro-actualizado', deLaPagina)
		socketUtils.on('dias-laborados:registro-actualizado', delComponente)

		bajaPagina()

		socketFalso.recibir('dias-laborados:registro-actualizado', { id: 'x' })
		expect(deLaPagina).not.toHaveBeenCalled()
		expect(delComponente).toHaveBeenCalledTimes(1)
	})
})
