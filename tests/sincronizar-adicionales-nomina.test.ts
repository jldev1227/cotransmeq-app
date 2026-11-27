import { describe, expect, it } from 'vitest';
import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import { conceptosParaSincronizar } from '../src/lib/editor/business/sincronizar-adicionales-nomina';

const fila = (concepto: string, conductor_id: string, valor: number): ConceptoDescuento =>
	({
		tipo: 'COSTO_LABORAL',
		concepto,
		conductor_id,
		dias: 1,
		valor_unitario: valor,
		valor_total: valor,
		calculado: false,
		orden: 1
	}) as ConceptoDescuento;

describe('sincronización de adicionales de nómina', () => {
	it('actualiza los conceptos fijos, conserva ediciones y separa conductores', () => {
		const nuevos = [
			fila('SALARIO', 'a', 200),
			fila('BONO_PACTADO', 'a', 50),
			fila('BONO_PACTADO', 'b', 30)
		];
		const actuales = [
			fila('SALARIO', 'a', 100),
			fila('BONO_PACTADO', 'a', 75),
			fila('MANUAL', 'a', 10)
		];
		const resultado = conceptosParaSincronizar(nuevos, actuales);
		expect(resultado.find((c) => c.concepto === 'SALARIO')?.valor_total).toBe(200);
		expect(
			resultado.find((c) => c.concepto === 'BONO_PACTADO' && c.conductor_id === 'a')?.valor_total
		).toBe(75);
		expect(
			resultado.find((c) => c.concepto === 'BONO_PACTADO' && c.conductor_id === 'b')?.valor_total
		).toBe(30);
		expect(resultado.filter((c) => c.concepto === 'BONO_PACTADO')).toHaveLength(2);
		expect(resultado.some((c) => c.concepto === 'MANUAL')).toBe(true);
	});
});
