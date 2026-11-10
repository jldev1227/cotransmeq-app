import { describe, expect, it } from 'vitest';
import { seccionesSnapshot } from '../src/lib/components/univer/snapshot-preview';

describe('vista histórica de una hoja', () => {
	it('usa valores congelados del cierre y su estado', () => {
		const secciones = seccionesSnapshot(
			'cierres',
			{
				estado: 'LIQUIDADA',
				totales: { valor_liquidar: 80, total_pagar: 55 },
				items_detalle: [
					{ placa: 'FST006', cliente: 'Cliente viejo', total_facturado: 100, valor_liquidar: 80 }
				],
				conceptos: [{ concepto: 'SALARIO', dias: 30, valor_total: 25 }]
			},
			'FST006'
		);
		expect(secciones[0].filas[0][0]).toBe('Cliente viejo');
		expect(secciones[1].filas[0][2]).toBe(30);
		expect(secciones[2].filas[0]).toEqual(['LIQUIDADA', 80, 55]);
	});

	it('limita adicionales a la placa activa', () => {
		const secciones = seccionesSnapshot(
			'adicionales',
			{
				filas: [
					{ placa: 'FST006', cliente: 'A' },
					{ placa: 'ABC123', cliente: 'B' }
				]
			},
			'FST006'
		);
		expect(secciones[0].filas).toHaveLength(1);
	});

	it('limita recorridos al conductor y a la placa', () => {
		const secciones = seccionesSnapshot(
			'recorridos',
			{
				hojas: [
					{
						conductor_id: 'uno',
						filas: [
							{ fecha: '2026-09-01', vehiculo_placa: 'FST006' },
							{ fecha: '2026-09-02', vehiculo_placa: 'ABC123' }
						]
					},
					{ conductor_id: 'dos', filas: [{ fecha: '2026-09-03', vehiculo_placa: 'FST006' }] }
				]
			},
			'FST006',
			'uno'
		);
		expect(secciones[0].filas).toHaveLength(1);
		expect(secciones[0].filas[0][0]).toBe('2026-09-01');
	});

	it('separa las dos hojas históricas de ingresos', () => {
		const payload = {
			filas: [
				{ origen: 'SERVICIO', placa: 'FST006' },
				{ origen: 'ADICIONAL', placa: 'FST006' }
			]
		};
		expect(seccionesSnapshot('ingresos', payload, null, null, 'INGRESOS')[0].filas).toHaveLength(1);
		expect(seccionesSnapshot('ingresos', payload, null, null, 'ADICIONALES')[0].filas).toHaveLength(
			1
		);
	});
});
