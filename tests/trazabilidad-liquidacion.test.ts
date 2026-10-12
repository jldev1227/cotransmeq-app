/**
 * Trazabilidad de la liquidación de servicio: qué evento es cada fila del
 * historial y qué cambió respecto al anterior.
 */
import { describe, expect, it } from 'vitest';
import type { HistorialEstado } from '$lib/api/liquidaciones-servicios';
import {
	agruparPorDia,
	construirEventos,
	hitosDe,
	type EventoTrazabilidad
} from '$lib/liquidaciones/trazabilidad';

let seq = 0;
function h(
	accion: string | null,
	anterior: string | null,
	nuevo: string,
	fecha: string,
	snapshot: Record<string, unknown> | null = null,
	extra: Partial<HistorialEstado> = {}
): HistorialEstado {
	seq += 1;
	return {
		id: `h${seq}`,
		liquidacion_id: 'l1',
		estado_anterior: anterior,
		estado_nuevo: nuevo,
		usuario: { id: 'u1', nombre: 'Camilo Cepeda', correo: 'c@x.co' },
		motivo: null,
		accion,
		snapshot,
		created_at: fecha,
		...extra
	};
}

const servicio = (placa: string, valor: number, fecha = '2026-03-31T00:00:00.000Z') => ({
	placa,
	fecha_inicial: fecha,
	fecha_final: fecha,
	recorrido: 'VILLANUEVA - PAZ DE ARIPORO',
	tipo_servicio: 'HORA_24',
	numero_planilla: 'TM-1',
	cantidad: 1,
	valor_final: valor
});

const fotoBase = (extra: Record<string, unknown> = {}) => ({
	mes: 3,
	anio: 2026,
	osi: 'OSI-1',
	operadora: 'PAREX',
	cliente: { nombre: 'AMSPEC' },
	total: 1_000_000,
	valor_servicios: 1_000_000,
	items: [servicio('PUM337', 1_000_000)],
	...extra
});

const unico = (eventos: EventoTrazabilidad[], tipo: string) => eventos.find((e) => e.tipo === tipo)!;

describe('construirEventos', () => {
	it('ordena del más reciente al más antiguo y nombra cada evento', () => {
		const eventos = construirEventos([
			h('cambio_estado', 'BORRADOR', 'LIQUIDADA', '2026-10-02T15:00:00Z'),
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z'),
			h('cambio_estado', 'LIQUIDADA', 'APROBADA', '2026-10-03T15:00:00Z')
		]);
		expect(eventos.map((e) => e.titulo)).toEqual([
			'Aprobó la liquidación',
			'Marcó la liquidación como liquidada',
			'Creó la liquidación'
		]);
	});

	it('una edición ya no sale como «Borrador → Borrador»', () => {
		const [e] = construirEventos([h('edicion', 'BORRADOR', 'BORRADOR', '2026-10-01T15:00:00Z')]);
		expect(e.tipo).toBe('edicion');
		expect(e.titulo).toBe('Editó la liquidación');
	});

	it('anular, reactivar y devolver a borrador tienen su propio nombre', () => {
		const eventos = construirEventos([
			h('cambio_estado', 'LIQUIDADA', 'ANULADA', '2026-10-01T15:00:00Z'),
			h('cambio_estado', 'ANULADA', 'BORRADOR', '2026-10-02T15:00:00Z'),
			h('cambio_estado', 'APROBADA', 'BORRADOR', '2026-10-03T15:00:00Z')
		]);
		expect(eventos.map((e) => [e.tipo, e.titulo])).toEqual([
			['estado', 'Devolvió la liquidación a borrador'],
			['reactivacion', 'Reactivó la liquidación'],
			['anulacion', 'Anuló la liquidación']
		]);
	});

	it('cuenta cuánto cambió el total y los componentes', () => {
		const eventos = construirEventos([
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z', fotoBase()),
			h('edicion', 'BORRADOR', 'BORRADOR', '2026-10-02T15:00:00Z', fotoBase({ total: 1_150_000, valor_recargos: 150_000 }))
		]);
		const edicion = unico(eventos, 'edicion');
		const total = edicion.cambios.find((c) => c.etiqueta === 'Total')!;
		expect(total.antes).toBe('$ 1.000.000');
		expect(total.despues).toBe('$ 1.150.000');
		expect(total.diferencia).toBe('+$ 150.000');
		expect(total.sube).toBe(true);
		// Recargos no estaba en la foto anterior: no hay con qué comparar.
		expect(edicion.cambios.find((c) => c.etiqueta === 'Recargos')).toBeUndefined();
	});

	it('detecta servicios agregados, quitados y modificados', () => {
		const eventos = construirEventos([
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z', fotoBase({ items: [servicio('PUM337', 1_000_000), servicio('FST006', 500_000)] })),
			h(
				'edicion',
				'BORRADOR',
				'BORRADOR',
				'2026-10-02T15:00:00Z',
				fotoBase({ items: [servicio('PUM337', 1_200_000), servicio('QLR015', 300_000)] })
			)
		]);
		const tipos = unico(eventos, 'edicion').serviciosCambiados.map((c) => c.tipo).sort();
		expect(tipos).toEqual(['agregado', 'modificado', 'quitado']);
		const modificado = unico(eventos, 'edicion').serviciosCambiados.find((c) => c.tipo === 'modificado')!;
		expect(modificado.texto).toContain('$ 1.000.000 → $ 1.200.000');
	});

	it('dos servicios idénticos cuentan como dos', () => {
		const dos = [servicio('PUM337', 100), servicio('PUM337', 100)];
		const eventos = construirEventos([
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z', fotoBase({ items: dos })),
			h('edicion', 'BORRADOR', 'BORRADOR', '2026-10-02T15:00:00Z', fotoBase({ items: [servicio('PUM337', 100)] }))
		]);
		expect(unico(eventos, 'edicion').serviciosCambiados).toEqual([
			expect.objectContaining({ tipo: 'quitado' })
		]);
	});

	it('el primer evento y los que no tienen foto no se comparan', () => {
		const eventos = construirEventos([
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z', fotoBase()),
			h('cambio_estado', 'BORRADOR', 'LIQUIDADA', '2026-10-02T15:00:00Z', null)
		]);
		expect(eventos.every((e) => e.sinComparacion)).toBe(true);
	});

	it('compara con la última foto disponible aunque haya eventos sin foto en medio', () => {
		const eventos = construirEventos([
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z', fotoBase()),
			h('cambio_estado', 'BORRADOR', 'LIQUIDADA', '2026-10-02T15:00:00Z', null),
			h('cambio_estado', 'LIQUIDADA', 'APROBADA', '2026-10-03T15:00:00Z', fotoBase({ osi: 'OSI-2' }))
		]);
		const aprobada = eventos[0];
		expect(aprobada.cambios).toEqual([{ etiqueta: 'OSI', antes: 'OSI-1', despues: 'OSI-2' }]);
	});

	it('el motivo se conserva y los espacios no cuentan como motivo', () => {
		const [conMotivo, sinMotivo] = construirEventos([
			h('cambio_estado', 'BORRADOR', 'ANULADA', '2026-10-02T15:00:00Z', null, { motivo: '  Duplicada  ' }),
			h('cambio_estado', 'BORRADOR', 'LIQUIDADA', '2026-10-01T15:00:00Z', null, { motivo: '   ' })
		]);
		expect(conMotivo.motivo).toBe('Duplicada');
		expect(sinMotivo.motivo).toBeNull();
	});
});

describe('hitosDe', () => {
	it('muestra la aprobación vigente, no la primera', () => {
		const eventos = construirEventos([
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z'),
			h('cambio_estado', 'LIQUIDADA', 'APROBADA', '2026-10-02T15:00:00Z'),
			h('cambio_estado', 'APROBADA', 'BORRADOR', '2026-10-03T15:00:00Z'),
			h('cambio_estado', 'LIQUIDADA', 'APROBADA', '2026-10-05T15:00:00Z')
		]);
		const hitos = hitosDe(eventos);
		expect(hitos.map((x) => x.etiqueta)).toEqual(['Creada', 'Aprobada']);
		expect(hitos[1].fecha).toBe('2026-10-05T15:00:00Z');
	});
});

describe('agruparPorDia', () => {
	it('agrupa por día de Bogotá y nombra hoy y ayer', () => {
		const ahora = new Date('2026-10-11T18:00:00Z'); // 11 oct, 1:00 p. m. en Bogotá
		const eventos = construirEventos([
			h('edicion', 'BORRADOR', 'BORRADOR', '2026-10-11T14:00:00Z'),
			// 10 oct a las 10:00 p. m. en Bogotá, aunque en UTC ya es 11.
			h('edicion', 'BORRADOR', 'BORRADOR', '2026-10-11T03:00:00Z'),
			h('creacion', null, 'BORRADOR', '2026-10-01T15:00:00Z')
		]);
		const dias = agruparPorDia(eventos, ahora);
		expect(dias.map((d) => [d.etiqueta, d.eventos.length])).toEqual([
			['Hoy', 1],
			['Ayer', 1],
			[expect.stringMatching(/^Jueves, 1 de octubre de 2026$/i), 1]
		]);
	});
});
