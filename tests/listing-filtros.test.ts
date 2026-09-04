/**
 * Filtros ↔ URL: ida y vuelta, firma de caché y limpieza.
 *
 * Lo que se fija aquí es lo que hace utilizable un enlace compartido: que el
 * estado que se escribe en la URL sea exactamente el que se lee de vuelta, y
 * que una URL limpia describa lo mismo que una con todos los parámetros en su
 * valor por defecto.
 */

import { describe, expect, it } from 'vitest'
import {
	aParams,
	bandera,
	contarActivos,
	firma,
	leerDeParams,
	limpiar,
	lista,
	numero,
	opcion,
	texto,
	valoresPorDefecto,
	type DefinicionesFiltros
} from '$lib/listing/filtros'

interface FiltrosFlota {
	q: string
	estado: string
	pagina: number
	ocultos: boolean
	sedes: string[]
}

const DEFS: DefinicionesFiltros<FiltrosFlota> = {
	q: texto(),
	estado: opcion('TODOS'),
	pagina: numero(1),
	ocultos: bandera(false),
	sedes: lista()
}

describe('Filtros de lista', () => {
	it('los valores por defecto NO se escriben en la URL', () => {
		// Si se escribieran, entrar a la página dejaría la barra de direcciones
		// llena de parámetros antes de que el usuario tocara nada.
		const params = aParams(DEFS, valoresPorDefecto(DEFS))
		expect(params.toString()).toBe('')
	})

	it('una URL vacía describe el mismo estado que los valores por defecto', () => {
		expect(leerDeParams(DEFS, new URLSearchParams())).toEqual(valoresPorDefecto(DEFS))
	})

	it('ida y vuelta: lo que se escribe es lo que se lee', () => {
		const original: FiltrosFlota = {
			q: 'villanueva',
			estado: 'ACTIVO',
			pagina: 3,
			ocultos: true,
			sedes: ['YOPAL', 'VILLANUEVA']
		}

		const vuelta = leerDeParams(DEFS, aParams(DEFS, original))
		expect(vuelta).toEqual(original)
	})

	it('la página viaja en la URL — antes ninguna lista lo hacía', () => {
		const params = aParams(DEFS, { ...valoresPorDefecto(DEFS), pagina: 4 })
		expect(params.get('pagina')).toBe('4')
		// Compartir el enlace debe devolver la MISMA página, no la primera.
		expect(leerDeParams(DEFS, params).pagina).toBe(4)
	})

	it('un número inválido en la URL cae al valor por defecto', () => {
		// La URL la escribe cualquiera; no puede tumbar la página.
		const params = new URLSearchParams('pagina=abc')
		expect(leerDeParams(DEFS, params).pagina).toBe(1)
	})

	describe('firma para la caché', () => {
		it('no depende del orden en que se pusieron los filtros', () => {
			const a: FiltrosFlota = { ...valoresPorDefecto(DEFS), q: 'x', estado: 'ACTIVO' }
			const b: FiltrosFlota = { ...valoresPorDefecto(DEFS), estado: 'ACTIVO', q: 'x' }
			expect(firma(DEFS, a)).toBe(firma(DEFS, b))
		})

		it('cambia cuando cambia un filtro', () => {
			const a = { ...valoresPorDefecto(DEFS), estado: 'ACTIVO' }
			const b = { ...valoresPorDefecto(DEFS), estado: 'INACTIVO' }
			expect(firma(DEFS, a)).not.toBe(firma(DEFS, b))
		})

		it('cambia con la página: la caché de la 1 no vale para la 2', () => {
			const p1 = { ...valoresPorDefecto(DEFS), pagina: 1 }
			const p2 = { ...valoresPorDefecto(DEFS), pagina: 2 }
			expect(firma(DEFS, p1)).not.toBe(firma(DEFS, p2))
		})
	})

	it('cuenta los filtros activos, ignorando los que se pidan', () => {
		const v: FiltrosFlota = { ...valoresPorDefecto(DEFS), q: 'abc', estado: 'ACTIVO', pagina: 5 }
		// La página y la búsqueda no cuentan como «filtros» en el panel.
		expect(contarActivos(DEFS, v, ['pagina', 'q'])).toBe(1)
		expect(contarActivos(DEFS, v)).toBe(3)
	})

	it('limpiar deja todo por defecto salvo lo que se conserve', () => {
		const v: FiltrosFlota = { ...valoresPorDefecto(DEFS), q: 'abc', estado: 'ACTIVO', pagina: 7 }
		const limpio = limpiar(DEFS, v, ['q'])

		expect(limpio.q).toBe('abc')
		expect(limpio.estado).toBe('TODOS')
		// Limpiar filtros tiene que volver a la primera página: quedarse en la
		// 7 de un listado que ahora tiene 2 muestra una tabla vacía.
		expect(limpio.pagina).toBe(1)
	})

	it('una lista vacía no ensucia la URL', () => {
		expect(aParams(DEFS, { ...valoresPorDefecto(DEFS), sedes: [] }).toString()).toBe('')
	})
})
