import { describe, expect, it } from 'vitest';
import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import {
	esConceptoConductorDinamico,
	getConductorGrupos
} from '$lib/editor/business/conductor-grupos.service';

function fila(
	concepto: string,
	valor_total: number,
	otros: Partial<ConceptoDescuento> = {}
): ConceptoDescuento {
	return {
		tipo: 'COSTO_LABORAL',
		concepto,
		conductor_id: 'conductor-1',
		valor_unitario: 0,
		valor_total,
		calculado: false,
		orden: 0,
		...otros
	};
}

describe('conceptos dinámicos de conductor', () => {
	it('aparecen como salario y no cambian las bases de prestaciones o seguridad social', () => {
		const filas = [
			fila('SALARIO', 1_000_000, { dias: 30, valor_unitario: 1_000_000 / 30 }),
			fila('AUXILIO_TRANSPORTE', 100_000),
			fila('BONIFICACION_ESPECIAL', 50_000),
			fila('CESANTIAS', 0, { porcentaje: 8.33 }),
			fila('SALUD', 0, { porcentaje: 4 })
		];

		const grupo = getConductorGrupos(filas)[0];

		expect(grupo.salarios.map((c) => c.concepto)).toContain('BONIFICACION_ESPECIAL');
		expect(grupo.totalConductor).toBe(1_281_630);
		expect(filas.find((c) => c.concepto === 'CESANTIAS')?.base_calculo).toBe(1_100_000);
		expect(filas.find((c) => c.concepto === 'SALUD')?.base_calculo).toBe(1_000_000);
		expect(filas.find((c) => c.concepto === 'BONIFICACION_ESPECIAL')?.valor_total).toBe(50_000);
	});

	it('distingue una fila libre de los nombres reservados del bloque', () => {
		expect(esConceptoConductorDinamico(fila('BONIFICACION_ESPECIAL', 1))).toBe(true);
		expect(esConceptoConductorDinamico(fila('SALARIO', 1))).toBe(false);
	});
});
