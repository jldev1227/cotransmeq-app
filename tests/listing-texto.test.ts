/**
 * Normalización y coincidencia de texto para las búsquedas en cliente.
 *
 * Estaba duplicada con implementaciones distintas, así que buscar «Villanueva»
 * encontraba resultados en una página y no en otra según cómo estuviera
 * escrito el acento en la base.
 */

import { describe, expect, it } from 'vitest'
import { coincide, normalizarTexto } from '$lib/listing/texto'

describe('normalizarTexto', () => {
	it('ignora acentos y mayúsculas', () => {
		expect(normalizarTexto('YOPÁL')).toBe('yopal')
		expect(normalizarTexto('Villanueva')).toBe('villanueva')
	})

	it('trata igual la tilde precompuesta y la compuesta', () => {
		// La misma palabra puede venir de la base en cualquiera de las dos
		// formas Unicode; si no se normalizan, no se encuentran entre sí.
		expect(normalizarTexto('Bogotá')).toBe(normalizarTexto('Bogotá'))
	})

	it('tolera nulos y números sin reventar', () => {
		expect(normalizarTexto(null)).toBe('')
		expect(normalizarTexto(undefined)).toBe('')
		expect(normalizarTexto(1234)).toBe('1234')
	})
})

describe('coincide', () => {
	it('encuentra por coincidencia parcial en cualquier campo', () => {
		expect(coincide('abc', ['ABC123', 'Renault'])).toBe(true)
		expect(coincide('renault', ['ABC123', 'Renault'])).toBe(true)
	})

	it('exige todas las palabras, en cualquier campo y orden', () => {
		// Es lo que se espera al teclear dos datos seguidos: «juan yopal».
		const campos = ['Juan Pérez', 'YOPAL', '1234']
		expect(coincide('juan yopal', campos)).toBe(true)
		expect(coincide('yopal juan', campos)).toBe(true)
		expect(coincide('juan villanueva', campos)).toBe(false)
	})

	it('un término vacío no filtra nada', () => {
		expect(coincide('', ['lo que sea'])).toBe(true)
		expect(coincide('   ', ['lo que sea'])).toBe(true)
	})

	it('ignora acentos también al buscar', () => {
		expect(coincide('perez', ['Juan Pérez'])).toBe(true)
	})
})
