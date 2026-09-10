/**
 * Canvas de recorridos: builder, adapter y resumen del PDF.
 *
 * Lo que se fija aquí son las tres reglas que el usuario puede ver romperse:
 * que un día con dos recorridos ocupe dos filas, que el clic en una casilla
 * llegue a viajar como patch, y que el resumen del PDF cuente los bonos por
 * placa y mes.
 */

import { describe, it, expect, vi } from 'vitest';
import {
	buildLibroRecorridos,
	COL,
	COL_BONO_INICIO,
	totalColumnas,
	colValorPagar,
	colFirma,
	valorFila,
	FORMATO,
	COLOR_PESTANA_BORRADOR,
	type RecorridosPeriodoDTO
} from '$lib/editor/builders/recorridos.builder';
import {
	setRecorridoBindings,
	clearRecorridoBindings,
	getRecorridoBinding
} from '$lib/editor/business/recorridos-cell-binding';
import { installRecorridosCellChangeAdapter } from '$lib/editor/univer/adapters/cell-change-recorridos';
import { documentoRecorridos } from '$lib/components/liquidaciones-terceros/preview/datos/recorridos.doc';

/**
 * Las filas de cabecera no son fijas —una hoja de solo consulta añade su banda
 * de aviso—, así que se leen del `rangoFilas` que devuelve el builder en vez de
 * escribirlas a mano.
 */
function anclas(libro: ReturnType<typeof buildLibroRecorridos>) {
	const rango = libro.rangoPorHoja['conductor-c1']!;
	return { cabecera: rango.desde - 1, primera: rango.desde, ultima: rango.hasta };
}

const BONO_ALIM = 'cfg-alimentacion';
const BONO_DOBLE = 'cfg-doble';

function dtoDePrueba(): RecorridosPeriodoDTO {
	return {
		anio: 2026,
		mes: 7,
		desde: '2026-06-21',
		hasta: '2026-07-20',
		etiqueta: '21 Jun — 20 Jul 2026',
		bonos: [
			{ config_id: BONO_ALIM, nombre: 'Bono de alimentación', valor: 26061, anio: 2026 },
			{ config_id: BONO_DOBLE, nombre: 'Bono día trabajado doble', valor: 25000, anio: 2026 }
		],
		hojas: [
			{
				conductor_id: 'c1',
				nombre: 'JUAN',
				apellido: 'PEREZ',
				numero_identificacion: '123',
				nombre_hoja: 'PEREZ JUAN',
				filas: [
					fila({ segmento_id: 's1', fecha: '2026-07-01', orden: 1, placa: 'FST006', bonos: { [BONO_ALIM]: true } }),
					// MISMO día, segundo recorrido: debe ocupar su propia fila.
					fila({ segmento_id: 's2', fecha: '2026-07-01', orden: 2, placa: 'FST006', bonos: { [BONO_ALIM]: true, [BONO_DOBLE]: true } }),
					fila({ segmento_id: 's3', fecha: '2026-07-02', orden: 1, placa: 'ABC123', bonos: { [BONO_ALIM]: true } }),
					// Día sin recorridos.
					{
						tipo_fila: 'dia',
						registro_dia_id: 'd9',
						segmento_id: null,
						version: 1,
						fecha: '2026-07-03',
						tipo_dia: 'DESCANSO',
						orden: 0,
						cliente_id: null,
						cliente_nombre: null,
						vehiculo_id: null,
						vehiculo_placa: null,
						hora_inicio: null,
						hora_fin: null,
						inicio_dia_siguiente: false,
						fin_dia_siguiente: false,
						horas_conducidas: 0,
						km_inicial: null,
						km_final: null,
						pernocte: false,
						observaciones: null,
						bonos: {}
					}
				]
			}
		],
		avisos: []
	};
}

function fila(o: {
	segmento_id: string;
	fecha: string;
	orden: number;
	placa: string;
	bonos: Record<string, boolean>;
}) {
	return {
		tipo_fila: 'segmento' as const,
		registro_dia_id: `d-${o.fecha}`,
		segmento_id: o.segmento_id,
		version: 3,
		fecha: o.fecha,
		tipo_dia: 'LABORADO',
		orden: o.orden,
		cliente_id: 'cli1',
		cliente_nombre: 'CLIENTE UNO',
		vehiculo_id: 'v1',
		vehiculo_placa: o.placa,
		hora_inicio: '06:00',
		hora_fin: '18:00',
		inicio_dia_siguiente: false,
		fin_dia_siguiente: false,
		horas_conducidas: 12,
		km_inicial: 100,
		km_final: 200,
		pernocte: false,
		observaciones: null,
		bonos: o.bonos
	};
}

describe('builder del canvas de recorridos', () => {
	it('da UNA FILA POR RECORRIDO: un día con dos recorridos ocupa dos filas', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;

		// 4 filas de datos: dos del día 1, una del día 2 y el día de descanso.
		const { primera } = anclas(libro);
		const filasConFecha: string[] = [];
		for (let r = primera; r < primera + 4; r++) filasConFecha.push(hoja.cellData[r][COL.FECHA].v);

		expect(filasConFecha).toEqual(['2026-07-01', '2026-07-01', '2026-07-02', '2026-07-03']);
	});

	it('conserva el orden cronológico ascendente que da el servidor', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		const { primera } = anclas(libro);
		const fechas = [0, 1, 2, 3].map((i) => hoja.cellData[primera + i][COL.FECHA].v as string);
		expect([...fechas]).toEqual([...fechas].sort());
	});

	it('crea una columna por bono visible, más valor a pagar y firma', () => {
		const dto = dtoDePrueba();
		const libro = buildLibroRecorridos(dto, { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;

		// Las dos de cierre son del formato OP-FR-03: el valor que se paga y la
		// casilla donde Operaciones firma el papel.
		const { cabecera } = anclas(libro);
		expect(totalColumnas(dto.bonos)).toBe(COL_BONO_INICIO + 2 + 2);
		expect(hoja.cellData[cabecera][COL_BONO_INICIO].v).toBe('BONO DE ALIMENTACIÓN');
		expect(hoja.cellData[cabecera][COL_BONO_INICIO + 1].v).toBe('BONO DÍA TRABAJADO DOBLE');
		expect(hoja.cellData[cabecera][colValorPagar(dto.bonos)].v).toBe('VALOR A PAGAR');
		expect(hoja.cellData[cabecera][colFirma(dto.bonos)].v).toBe('FIRMA OPERACIONES');
	});

	it('marca la casilla con SÍ/NO según el bono', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		const { primera } = anclas(libro);
		// Primer recorrido: alimentación sí, doble no.
		expect(hoja.cellData[primera][COL_BONO_INICIO].v).toBe('SÍ');
		expect(hoja.cellData[primera][COL_BONO_INICIO + 1].v).toBe('NO');
		// Segundo recorrido del mismo día: los dos.
		expect(hoja.cellData[primera + 1][COL_BONO_INICIO + 1].v).toBe('SÍ');
	});

	it('abre con la banda de título del canvas de cierres', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;

		// APELLIDO primero: es como se busca a una persona en una lista.
		expect(hoja.cellData[0][0].v).toContain('PEREZ JUAN');
		expect(hoja.cellData[0][0].v).toContain('C.C. 123');
		// Blanco sobre verde, como el título de hoja de cierres.
		expect(hoja.cellData[0][0].s.bg.rgb).toBe('#0F4025');
		expect(hoja.cellData[0][0].s.cl.rgb).toBe('#FFFFFF');

		// La banda del formato lleva marca, nombre y código.
		expect(hoja.cellData[1][0].v).toContain(FORMATO.marca);
		expect(hoja.cellData[1][0].v).toContain(FORMATO.titulo);
		expect(hoja.cellData[1][0].v).toContain('OP-FR-03');
	});

	it('avisa en la propia hoja cuando el usuario solo puede consultar', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: false });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		expect(hoja.cellData[1][0].v).toContain('SOLO CONSULTA');
	});

	it('usa el verde de Transmeralda, no el gris del Excel', () => {
		// El OP-FR-03 es una guía de columnas, no una plantilla que calcar: su
		// encabezado gris es el de un Excel de oficina. La identidad es la misma
		// de los canvas de cierres, servicios y nómina.
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;

		const cabecera = hoja.cellData[anclas(libro).cabecera][COL.FECHA].s;
		expect(cabecera.bg.rgb).toBe('#0F4025');
		expect(cabecera.cl.rgb).toBe('#FFFFFF');

		// Ni una sola celda pintada con el gris del formato original.
		const grises: string[] = [];
		for (const fila of Object.values(hoja.cellData) as any[]) {
			for (const celda of Object.values(fila) as any[]) {
				const bg = celda?.s?.bg?.rgb;
				if (bg === '#D9D9D9') grises.push(bg);
			}
		}
		expect(grises).toHaveLength(0);
	});

	it('congela la cabecera pero NO columnas', () => {
		// Igual que cierres: al bajar se sigue viendo de qué columna es cada
		// dato, pero no se parte la hoja en dos con una línea vertical.
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		expect(hoja.freeze.xSplit).toBe(0);
		expect(hoja.freeze.ySplit).toBeGreaterThan(0);
	});

	it('pinta las pestañas con el pizarra de BORRADOR, como en cierres', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		expect(hoja.tabColor).toBe(COLOR_PESTANA_BORRADOR);
	});

	it('materializa las celdas vacías para que la retícula no tenga agujeros', () => {
		// Univer solo dibuja bordes en las celdas que EXISTEN en `cellData`.
		const dto = dtoDePrueba();
		const libro = buildLibroRecorridos(dto, { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		const ultima = totalColumnas(dto.bonos) - 1;
		// Una celda del colchón inferior, por debajo del pie de totales.
		const filaColchon = anclas(libro).ultima + 3;
		expect(hoja.cellData[filaColchon][ultima]).toBeDefined();
		expect(hoja.cellData[filaColchon][ultima].s).toBeDefined();
	});

	it('NO registra bindings cuando el usuario solo puede consultar', () => {
		const conPermiso = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const sinPermiso = buildLibroRecorridos(dtoDePrueba(), { editable: false });

		expect(conPermiso.bindingsPorHoja['conductor-c1'].length).toBeGreaterThan(0);
		// Sin bindings, el interceptor default-deny bloquea la hoja entera.
		expect(sinPermiso.bindingsPorHoja['conductor-c1']).toHaveLength(0);
	});

	it('el tipo de día solo es editable en las filas SIN recorridos', () => {
		const libro = buildLibroRecorridos(dtoDePrueba(), { editable: true });
		const seeds = libro.bindingsPorHoja['conductor-c1'];
		const tipos = seeds.filter((s) => s.binding.field === 'tipo_dia');
		expect(tipos).toHaveLength(1);
		expect(tipos[0].binding.tipoFila).toBe('dia');
	});

	it('suma el valor de los bonos marcados', () => {
		const dto = dtoDePrueba();
		const f = dto.hojas[0].filas[1]; // los dos bonos
		expect(valorFila(f as never, dto.bonos)).toBe(26061 + 25000);
	});
});

describe('adapter de ediciones', () => {
	/**
	 * EL BUG HISTÓRICO. `sheets-data-validation-ui` despacha el comando de la
	 * casilla con `{ range, value }` y SIN `unitId` ni `subUnitId`. Comparando
	 * `params.unitId !== ctx.unitId` con `undefined` a la izquierda, todos los
	 * clics se descartaban en silencio: la casilla se desmarcaba en pantalla, el
	 * modelo no se enteraba y al recargar volvía a estar marcada.
	 */
	it('emite el cambio aunque el comando de la casilla no traiga unitId ni subUnitId', () => {
		const unitId = 'workbook-recorridos-2026-07';
		const sheetId = 'conductor-c1';
		clearRecorridoBindings(unitId);
		setRecorridoBindings(unitId, sheetId, [
			{
				r: 3,
				c: COL_BONO_INICIO,
				binding: {
					tipoFila: 'segmento',
					entityId: 's1',
					field: `bono:${BONO_ALIM}`,
					conductorId: 'c1',
					registroDiaId: 'd1'
				}
			}
		]);

		let handler: ((info: any) => void) | null = null;
		const listeners: Array<(info: any) => void> = [];
		const commandService = {
			onCommandExecuted: (fn: (info: any) => void) => {
				listeners.push(fn);
				return { dispose: () => {} };
			}
		};

		const workbook = {
			getId: () => unitId,
			getActiveSheet: () => ({ getSheetId: () => sheetId }),
			getSheetBySheetId: () => ({
				getRange: () => ({ getCellData: () => ({ v: 'SÍ' }) })
			})
		};

		const cambios: any[] = [];
		installRecorridosCellChangeAdapter({
			unitId,
			commandService: commandService as never,
			getWorkbook: () => workbook as never,
			resolveConductor: (s) => (s === sheetId ? 'c1' : null),
			versionDe: () => 7,
			onCambios: (c) => cambios.push(...c)
		});

		// El comando tal y como lo emite la casilla: sin unitId ni subUnitId.
		for (const fn of listeners) {
			fn({
				id: 'sheet.command.set-range-values',
				params: {
					range: { startRow: 3, endRow: 3, startColumn: COL_BONO_INICIO, endColumn: COL_BONO_INICIO },
					value: { 3: { [COL_BONO_INICIO]: { v: 'SÍ' } } }
				}
			});
		}

		expect(cambios).toHaveLength(1);
		expect(cambios[0]).toMatchObject({
			tipoFila: 'segmento',
			entityId: 's1',
			field: `bono:${BONO_ALIM}`,
			value: 'SÍ',
			baseVersion: 7
		});
		clearRecorridoBindings(unitId);
	});

	it('descarta el cambio si no se conoce la versión (sin CAS no se emite)', () => {
		const unitId = 'u2';
		const sheetId = 'conductor-c1';
		clearRecorridoBindings(unitId);
		setRecorridoBindings(unitId, sheetId, [
			{
				r: 3,
				c: COL.HORA_INI,
				binding: {
					tipoFila: 'segmento',
					entityId: 's1',
					field: 'hora_inicio',
					conductorId: 'c1',
					registroDiaId: 'd1'
				}
			}
		]);

		const listeners: Array<(info: any) => void> = [];
		const cambios: any[] = [];
		installRecorridosCellChangeAdapter({
			unitId,
			commandService: {
				onCommandExecuted: (fn: any) => {
					listeners.push(fn);
					return { dispose: () => {} };
				}
			} as never,
			getWorkbook: () =>
				({
					getId: () => unitId,
					getActiveSheet: () => ({ getSheetId: () => sheetId }),
					getSheetBySheetId: () => ({ getRange: () => ({ getCellData: () => ({ v: '07:00' }) }) })
				}) as never,
			resolveConductor: () => 'c1',
			// Fila desconocida: emitir sin `base_version` sería last-write-wins.
			versionDe: () => null,
			onCambios: (c) => cambios.push(...c)
		});

		for (const fn of listeners) {
			fn({
				id: 'sheet.command.set-range-values',
				params: {
					unitId,
					subUnitId: sheetId,
					range: { startRow: 3, endRow: 3, startColumn: COL.HORA_INI, endColumn: COL.HORA_INI }
				}
			});
		}

		expect(cambios).toHaveLength(0);
		clearRecorridoBindings(unitId);
	});

	it('ignora los comandos de otro libro', () => {
		const unitId = 'u3';
		const listeners: Array<(info: any) => void> = [];
		const cambios: any[] = [];
		installRecorridosCellChangeAdapter({
			unitId,
			commandService: {
				onCommandExecuted: (fn: any) => {
					listeners.push(fn);
					return { dispose: () => {} };
				}
			} as never,
			getWorkbook: () => ({ getId: () => unitId }) as never,
			resolveConductor: () => 'c1',
			versionDe: () => 1,
			onCambios: (c) => cambios.push(...c)
		});

		for (const fn of listeners) {
			fn({
				id: 'sheet.command.set-range-values',
				params: { unitId: 'OTRO-LIBRO', subUnitId: 'x', range: { startRow: 3, endRow: 3, startColumn: 0, endColumn: 0 } }
			});
		}
		expect(cambios).toHaveLength(0);
	});
});

describe('documento del preview', () => {
	it('imprime el IMPORTE del bono, no la casilla', () => {
		const dto = dtoDePrueba();
		const doc = documentoRecorridos(dto, 'c1');
		const tabla = doc.secciones[0].bloques![0];
		const primera = tabla.filas[0].celdas as Record<string, unknown>;

		expect(primera[`bono_${BONO_ALIM}`]).toBe(26061);
		// Sin bono va vacío, no cero: una columna de «$ 0» esconde los importes
		// que sí están.
		expect(primera[`bono_${BONO_DOBLE}`]).toBe('');
	});

	it('resume los bonos por placa y por mes', () => {
		const dto = dtoDePrueba();
		const doc = documentoRecorridos(dto);
		const resumen = doc.secciones[1].bloques![0];

		const porPlaca = Object.fromEntries(
			resumen.filas.map((f) => [(f.celdas as any).placa, f.celdas as any])
		);

		// FST006: dos recorridos el mismo día → 2 de alimentación y 1 doble.
		expect(porPlaca['FST006'][`n_${BONO_ALIM}`]).toBe(2);
		expect(porPlaca['FST006'][`n_${BONO_DOBLE}`]).toBe(1);
		expect(porPlaca['FST006'].mes).toBe('JULIO');
		expect(porPlaca['FST006'].total_bonos).toBe(3);
		expect(porPlaca['FST006'].valor).toBe(26061 * 2 + 25000);

		// ABC123: un solo bono de alimentación.
		expect(porPlaca['ABC123'][`n_${BONO_ALIM}`]).toBe(1);
		expect(porPlaca['ABC123'][`n_${BONO_DOBLE}`]).toBe('');
	});

	it('sigue el formato OP-FR-03: rótulos, código y columna de firma', () => {
		const dto = dtoDePrueba();
		const doc = documentoRecorridos(dto, 'c1');

		expect(doc.titulo).toBe('CONTROL DÍAS LABORADOS PERSONAL');
		expect(doc.meta).toEqual([
			{ label: 'Código', valor: 'OP-FR-03' },
			{ label: 'Versión', valor: '3' },
			{ label: 'Fecha', valor: '2025-01-09' }
		]);

		const tabla = doc.secciones[0].bloques![0];
		const etiquetas = tabla.columnas.map((c) => c.label);
		expect(etiquetas).toContain('Descripción de la Labor / Recorrido');
		expect(etiquetas).toContain('Tiempo Total de Conducción en la Jornada');
		expect(etiquetas).toContain('Pernote SI / NO');
		// La casilla que Operaciones firma en el papel: existe y va vacía.
		expect(etiquetas.at(-1)).toBe('Firma Operaciones');
		expect((tabla.filas[0].celdas as any).firma).toBe('');

		// APELLIDO primero, igual que en la pestaña del canvas.
		expect(tabla.titulo).toBe('Nombre Conductor: PEREZ JUAN');
		expect(tabla.subtitulo).toBe('C.C.: 123');
	});

	it('no lista placas sin ningún bono en el mes', () => {
		const dto = dtoDePrueba();
		// El día de descanso no tiene placa ni bonos: no debe aparecer.
		const doc = documentoRecorridos(dto);
		const resumen = doc.secciones[1].bloques![0];
		expect(resumen.filas.map((f) => (f.celdas as any).placa)).not.toContain('(sin placa)');
	});
});
