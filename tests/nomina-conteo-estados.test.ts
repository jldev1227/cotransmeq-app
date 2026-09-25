/**
 * El recuento por estado de la cabecera del panel de estados.
 *
 * Lo que de verdad se prueba aquí es que las hojas SIN LIQUIDACIÓN no se
 * cuelen entre los borradores: el servidor manda `estado_flujo ?? 'BORRADOR'`,
 * así que llegan escritas «BORRADOR» y solo se distinguen por el
 * `liquidacionId` nulo. Confundirlas ofrece «liquidar» hojas que no existen.
 */
import { describe, it, expect } from 'vitest';
import {
	conteoPorEstado,
	SIN_LIQUIDACION,
	ESTADOS_VALIDOS,
	type HojaContable
} from '../src/lib/editor/builders/nomina-estado';

const hoja = (estado: string, conLiquidacion = true): HojaContable => ({
	liquidacionId: conLiquidacion ? crypto.randomUUID() : null,
	estado
});

describe('conteoPorEstado', () => {
	it('sin hojas no hay nada que pintar', () => {
		expect(conteoPorEstado([])).toEqual([]);
	});

	it('separa las hojas sin liquidación de los borradores de verdad', () => {
		// El caso real del canvas: un periodo recién abierto, donde casi nadie
		// tiene liquidación todavía y todas dicen «BORRADOR».
		const hojas = [hoja('BORRADOR'), ...Array.from({ length: 22 }, () => hoja('BORRADOR', false))];
		expect(conteoPorEstado(hojas)).toEqual([
			{ clave: 'BORRADOR', n: 1 },
			{ clave: SIN_LIQUIDACION, n: 22 }
		]);
	});

	it('los grupos suman el total de hojas', () => {
		const hojas = [
			...Array.from({ length: 15 }, () => hoja('BORRADOR')),
			...Array.from({ length: 3 }, () => hoja('APROBADA')),
			hoja('PAGADA'),
			...Array.from({ length: 5 }, () => hoja('BORRADOR', false))
		];
		const total = conteoPorEstado(hojas).reduce((s, g) => s + g.n, 0);
		expect(total).toBe(hojas.length);
	});

	it('van en el orden del flujo, no en el de llegada', () => {
		const hojas = [hoja('PAGADA'), hoja('BORRADOR'), hoja('ANULADA'), hoja('LIQUIDADA')];
		expect(conteoPorEstado(hojas).map((g) => g.clave)).toEqual([
			'BORRADOR',
			'LIQUIDADA',
			'PAGADA',
			'ANULADA'
		]);
	});

	it('«sin liquidación» va al final, después de cualquier estado', () => {
		const hojas = [hoja('BORRADOR', false), ...ESTADOS_VALIDOS.map((e) => hoja(e))];
		const claves = conteoPorEstado(hojas).map((g) => g.clave);
		expect(claves[claves.length - 1]).toBe(SIN_LIQUIDACION);
	});

	it('un estado desconocido se cuenta igual, al final de los conocidos', () => {
		// Si el backend estrena un estado antes que el frontend, la cuenta tiene
		// que seguir cuadrando: perderlo en silencio es lo que no puede pasar.
		const hojas = [hoja('BORRADOR'), hoja('EN_REVISION'), hoja('EN_REVISION')];
		expect(conteoPorEstado(hojas)).toEqual([
			{ clave: 'BORRADOR', n: 1 },
			{ clave: 'EN_REVISION', n: 2 }
		]);
	});

	it('no inventa el grupo de sin liquidación cuando todas la tienen', () => {
		const claves = conteoPorEstado([hoja('BORRADOR'), hoja('PAGADA')]).map((g) => g.clave);
		expect(claves).not.toContain(SIN_LIQUIDACION);
	});
});
