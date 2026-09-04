/**
 * Fecha del formulario: lo que el frontend lee y muestra.
 *
 * Desde que la fecha la calcula el servidor a partir de `started_at`, aquí no
 * queda nada que validar —no hay nada que teclear— pero sí dos cosas que se
 * pagan caras si fallan: que la fecha local no se adelante un día por culpa de
 * UTC, y que un envío sin fecha no muestre una inventada.
 */

import { describe, expect, it } from 'vitest';
import {
	CLAVE_FECHA_DILIGENCIAMIENTO,
	esFechaISO,
	fechaDeFormularioDe,
	fechaLocalDe,
	formatearFechaCorta
} from '$lib/formularios/fecha-diligenciamiento';

describe('fechaLocalDe', () => {
	it('usa el reloj local, no UTC', () => {
		/// 19:30 en Colombia ya son las 00:30 del día siguiente en UTC. Con
		/// `toISOString()` un preoperacional de la noche saldría fechado al día
		/// siguiente, que no es el día del turno.
		expect(fechaLocalDe(new Date(2026, 8, 4, 19, 30))).toBe('2026-09-04');
	});

	it('no se adelanta a medianoche', () => {
		expect(fechaLocalDe(new Date(2026, 8, 4, 23, 59))).toBe('2026-09-04');
		expect(fechaLocalDe(new Date(2026, 8, 5, 0, 1))).toBe('2026-09-05');
	});

	it('acepta el ISO que guarda el borrador local', () => {
		const iso = new Date(2026, 8, 4, 7, 15).toISOString();
		expect(fechaLocalDe(iso)).toBe('2026-09-04');
	});

	it('rellena mes y día a dos cifras', () => {
		expect(fechaLocalDe(new Date(2026, 0, 7, 12, 0))).toBe('2026-01-07');
	});

	it('cae en hoy si el instante no es válido', () => {
		/// Un borrador viejo con `createdAt` corrupto no debe romper la pantalla
		/// del conductor.
		expect(fechaLocalDe('no es una fecha')).toBe(fechaLocalDe(new Date()));
	});
});

describe('esFechaISO', () => {
	it('acepta una fecha real', () => {
		expect(esFechaISO('2026-09-04')).toBe(true);
	});

	it('rechaza un día que no existe', () => {
		expect(esFechaISO('2026-02-31')).toBe(false);
		expect(esFechaISO('2026-13-01')).toBe(false);
	});

	it('rechaza lo que no tiene forma de fecha', () => {
		for (const valor of ['', '04/09/2026', '2026-9-4', null, undefined, 20260904]) {
			expect(esFechaISO(valor)).toBe(false);
		}
	});
});

describe('fechaDeFormularioDe', () => {
	it('lee la fecha del contexto de un envío', () => {
		expect(fechaDeFormularioDe({ [CLAVE_FECHA_DILIGENCIAMIENTO]: '2026-09-04' })).toBe('2026-09-04');
	});

	it('devuelve null en los envíos anteriores al campo', () => {
		/// Y no hoy: un documento firmado no puede mostrar una fecha inventada al
		/// vuelo por quien lo está leyendo.
		expect(fechaDeFormularioDe({ vehicleId: 'v-1' })).toBeNull();
		expect(fechaDeFormularioDe(null)).toBeNull();
		expect(fechaDeFormularioDe(undefined)).toBeNull();
	});

	it('ignora un valor guardado que no es una fecha', () => {
		expect(fechaDeFormularioDe({ [CLAVE_FECHA_DILIGENCIAMIENTO]: 'ayer' })).toBeNull();
	});
});

describe('formatearFechaCorta', () => {
	it('da el formato que el conductor espera leer', () => {
		expect(formatearFechaCorta('2026-09-04')).toBe('04/09/2026');
	});

	it('no inventa nada cuando no hay fecha', () => {
		expect(formatearFechaCorta(null)).toBe('—');
		expect(formatearFechaCorta('2026-02-31')).toBe('—');
	});
});
