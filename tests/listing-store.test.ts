/**
 * Caché de listas: frescura, invalidación y revalidación en segundo plano.
 *
 * Cada regla de aquí corresponde a un comportamiento que hoy falta o está mal
 * en las páginas: volver a una página siempre re-pide todo, cambiar de filtro
 * puede servir datos del filtro anterior, y un evento de socket dispara una
 * recarga completa por cada cambio de cualquier usuario.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crearListingStore } from '$lib/listing/listingStore'

interface Vehiculo {
	id: string
	placa: string
}

const UNO: Vehiculo[] = [{ id: '1', placa: 'AAA111' }]
const OTRO: Vehiculo[] = [{ id: '2', placa: 'BBB222' }]

describe('Caché de listas', () => {
	beforeEach(() => {
		vi.useRealTimers()
	})

	it('la primera vez siempre va al servidor', async () => {
		const store = crearListingStore<Vehiculo>()
		const traer = vi.fn().mockResolvedValue({ items: UNO, total: 1 })

		await store.cargar('estado=ACTIVO', traer)

		expect(traer).toHaveBeenCalledTimes(1)
		expect(store.estado().items).toEqual(UNO)
		expect(store.estado().total).toBe(1)
	})

	it('volver con los mismos filtros no vuelve a pedir', async () => {
		// Es lo que hoy no pasa: salir de una página y volver re-pide todo.
		const store = crearListingStore<Vehiculo>()
		const traer = vi.fn().mockResolvedValue({ items: UNO })

		await store.cargar('estado=ACTIVO', traer)
		await store.cargar('estado=ACTIVO', traer)

		expect(traer).toHaveBeenCalledTimes(1)
	})

	it('cambiar de filtro invalida la caché aunque el dato sea nuevo', async () => {
		// Servir cincuenta filas de otro filtro es peor que un spinner.
		const store = crearListingStore<Vehiculo>()
		const traer = vi.fn().mockResolvedValue({ items: UNO })

		await store.cargar('estado=ACTIVO', traer)
		await store.cargar('estado=INACTIVO', traer)

		expect(traer).toHaveBeenCalledTimes(2)
	})

	it('no se puede pintar de caché lo que corresponde a otros filtros', async () => {
		const store = crearListingStore<Vehiculo>()
		await store.cargar('estado=ACTIVO', async () => ({ items: UNO }))

		expect(store.puedePintar('estado=ACTIVO')).toBe(true)
		expect(store.puedePintar('estado=INACTIVO')).toBe(false)
	})

	it('pasado el TTL se revalida', async () => {
		const store = crearListingStore<Vehiculo>({ ttl: 50 })
		const traer = vi.fn().mockResolvedValue({ items: UNO })

		await store.cargar('f', traer)
		await new Promise((r) => setTimeout(r, 70))
		await store.cargar('f', traer)

		expect(traer).toHaveBeenCalledTimes(2)
	})

	it('aunque el dato esté viejo, se puede pintar mientras se revalida', async () => {
		const store = crearListingStore<Vehiculo>({ ttl: 10 })
		await store.cargar('f', async () => ({ items: UNO }))
		await new Promise((r) => setTimeout(r, 30))

		// Viejo, pero de la misma firma: se pinta y se revalida de fondo, en
		// vez de dejar la tabla en blanco con un spinner.
		expect(store.necesitaFetch('f')).toBe(true)
		expect(store.puedePintar('f')).toBe(true)
	})

	it('un evento de socket marca la lista para revalidar', async () => {
		const store = crearListingStore<Vehiculo>()
		const traer = vi.fn().mockResolvedValue({ items: UNO })

		await store.cargar('f', traer)
		expect(store.necesitaFetch('f')).toBe(false)

		store.ensuciar()
		expect(store.necesitaFetch('f')).toBe(true)
	})

	it('los eventos con la lista oculta se cuentan para el badge', async () => {
		const store = crearListingStore<Vehiculo>()
		await store.cargar('f', async () => ({ items: UNO }))

		store.ensuciar('_', false)
		store.ensuciar('_', false)
		expect(store.estado().pendientes).toBe(2)

		store.ver()
		expect(store.estado().pendientes).toBe(0)
	})

	it('dos peticiones simultáneas iguales se resuelven con una sola', async () => {
		// Sin esto, dos componentes que piden la misma lista a la vez —o un
		// efecto que se dispara dos veces— provocan dos peticiones idénticas.
		const store = crearListingStore<Vehiculo>()
		let resolver: (v: { items: Vehiculo[] }) => void = () => {}
		const traer = vi.fn(
			() => new Promise<{ items: Vehiculo[] }>((r) => { resolver = r })
		)

		const a = store.cargar('f', traer)
		const b = store.cargar('f', traer)
		resolver({ items: UNO })
		await Promise.all([a, b])

		expect(traer).toHaveBeenCalledTimes(1)
	})

	it('un fallo conserva el último dato bueno', async () => {
		// Vaciar una tabla ya pintada por un fallo de red deja al usuario peor
		// que dejarle el dato anterior junto al aviso.
		const store = crearListingStore<Vehiculo>()
		await store.cargar('f', async () => ({ items: UNO }))

		store.ensuciar()
		await store.cargar('f', async () => {
			throw new Error('sin conexión')
		})

		expect(store.estado().items).toEqual(UNO)
		expect(store.estado().error).toBe('sin conexión')
		expect(store.estado().cargando).toBe(false)
	})

	it('parchear cambia una fila sin volver a pedir la lista', async () => {
		const store = crearListingStore<Vehiculo>()
		const traer = vi.fn().mockResolvedValue({ items: [...UNO, ...OTRO] })
		await store.cargar('f', traer)

		store.parchear((items) =>
			items.map((v) => (v.id === '2' ? { ...v, placa: 'ZZZ999' } : v))
		)

		expect(store.estado().items?.[1].placa).toBe('ZZZ999')
		expect(traer).toHaveBeenCalledTimes(1)
	})

	it('listas distintas de la misma página no se pisan', async () => {
		const store = crearListingStore<Vehiculo>()
		await store.cargar('f', async () => ({ items: UNO }), 'activos')
		await store.cargar('f', async () => ({ items: OTRO }), 'papelera')

		expect(store.estado('activos').items).toEqual(UNO)
		expect(store.estado('papelera').items).toEqual(OTRO)
	})
})
