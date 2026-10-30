import { describe, expect, it } from 'vitest';
import type { RecorridosPeriodoDTO } from '../src/lib/editor/builders/recorridos.builder';
import type { Liquidacion } from '../src/lib/types/nomina';
import { controlDiasDesdeRecorridos, paginaControlDias } from '../src/lib/utils/pdfControlDias';

describe('control de días del desprendible', () => {
	it('imprime placas y agrega cada día de vacaciones y licencia dentro del corte', () => {
		const dto = {
			desde: '2026-09-21',
			hasta: '2026-09-25',
			etiqueta: '21 Sep — 25 Sep 2026',
			hojas: [{
				conductor_id: 'c1',
				filas: [{
					fecha: '2026-09-22',
					tipo_dia: 'LABORADO',
					vehiculo_placa: 'PPK074',
					hora_inicio: '08:00',
					hora_fin: '12:00',
					cliente_nombre: 'NAMERO'
				}]
			}]
		} as unknown as RecorridosPeriodoDTO;
		const liquidacion = {
			periodo_vacaciones_inicio: '2026-09-20',
			periodo_vacaciones_fin: '2026-09-21',
			periodo_start_licencia: '2026-09-23',
			periodo_end_licencia: '2026-09-24',
			conductor: { genero: 'FEMENINO' }
		} as unknown as Liquidacion;
		const control = controlDiasDesdeRecorridos(dto, 'c1', liquidacion);
		expect(control?.filas.map(({ fecha, tipo_dia, vehiculo_placa }) => [
			fecha, tipo_dia, vehiculo_placa
		])).toEqual([
			['2026-09-21', 'VACACIONES', null],
			['2026-09-22', 'LABORADO', 'PPK074'],
			['2026-09-23', 'LICENCIA DE MATERNIDAD', null],
			['2026-09-24', 'LICENCIA DE MATERNIDAD', null]
		]);
		const pagina = paginaControlDias({
			control: control!,
			color: '#000000',
			colorBg: '#ffffff',
			razonSocial: 'Transmeralda',
			logo: null,
			conductorNombre: 'Conductor',
			conductorCedula: '123',
			firma: null
		});
		const tabla = pagina[3].table;
		expect(tabla.body[0].map((celda: { text: string }) => celda.text)).toEqual([
			'FECHA', 'DÍA', 'TIPO', 'PLACA', 'INICIO', 'FIN', 'CLIENTE'
		]);
		expect(tabla.body[2][3].text).toBe('PPK074');
		expect(tabla.body[3][2].text).toBe('LICENCIA DE MATERNIDAD');
		expect(tabla.body).toHaveLength(32);
	});
});
