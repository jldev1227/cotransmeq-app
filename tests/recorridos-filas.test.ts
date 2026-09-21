/**
 * Canvas de recorridos: FILAS que el usuario inserta y elimina, y lo que se
 * teclea en ellas.
 *
 * Lo que se fija aquí: que la fecha sea editable en todas las filas y el día
 * de la semana no; que la columna de horas pinte «6 horas» sin dejar de ser
 * un número; que los bindings sigan a las filas cuando Univer las desplaza;
 * que la guarda deje insertar y eliminar SOLO dentro de la tabla; y que lo
 * que Univer convierte al teclear (serial de fecha, fracción de hora) vuelva
 * a ser texto antes de viajar.
 */

import { describe, it, expect } from 'vitest';
import {
	buildLibroRecorridos,
	bindingsFilaNueva,
	celdasFilaVacia,
	COL,
	COL_BONO_INICIO,
	colValorPagar,
	FORMATO_HORAS,
	BORRADOR_BG,
	formulaPie,
	type RecorridosPeriodoDTO
} from '$lib/editor/builders/recorridos.builder';
import {
	setRecorridoBindings,
	clearRecorridoBindings,
	getRecorridoBinding,
	getRecorridoCellFor,
	getRecorridoBindingsDeFila,
	shiftRecorridoBindings
} from '$lib/editor/business/recorridos-cell-binding';
import {
	faltantesDeBorrador,
	fechaDesdeCelda,
	horaDesdeCelda,
	horasDesdeCelda,
	placaDesdeCelda
} from '$lib/editor/business/recorridos-celdas';
import { installRecorridosCellPermission } from '$lib/editor/univer/cell-permission-recorridos';
import {
	installRecorridosCellChangeAdapter,
	rellenado
} from '$lib/editor/univer/adapters/cell-change-recorridos';
import { ICommandService, IUniverInstanceService } from '@univerjs/core';
import { SheetInterceptorService, SheetsSelectionsService } from '@univerjs/sheets';

const BONO = 'cfg-alimentacion';

function dto(filas: RecorridosPeriodoDTO['hojas'][number]['filas']): RecorridosPeriodoDTO {
	return {
		anio: 2026,
		mes: 9,
		desde: '2026-08-21',
		hasta: '2026-09-20',
		etiqueta: '21 Ago — 20 Sep 2026',
		bonos: [{ config_id: BONO, nombre: 'Bono de alimentación', valor: 26061, anio: 2026 }],
		hojas: [
			{
				conductor_id: 'c1',
				nombre: 'JUAN',
				apellido: 'PEREZ',
				numero_identificacion: '123',
				nombre_hoja: 'JUAN PEREZ',
				filas
			}
		],
		avisos: []
	};
}

function recorrido(segmento_id: string, fecha: string) {
	return {
		tipo_fila: 'segmento' as const,
		registro_dia_id: `d-${fecha}`,
		segmento_id,
		version: 1,
		fecha,
		tipo_dia: 'LABORADO',
		orden: 1,
		cliente_id: null,
		cliente_nombre: null,
		vehiculo_id: 'v1',
		vehiculo_placa: 'FST006',
		hora_inicio: '06:00',
		hora_fin: '18:00',
		inicio_dia_siguiente: false,
		fin_dia_siguiente: false,
		horas_conducidas: 6,
		km_inicial: null,
		km_final: null,
		pernocte: false,
		observaciones: null,
		bonos: {}
	};
}

function dia(registro_dia_id: string, fecha: string) {
	return {
		...recorrido('', fecha),
		tipo_fila: 'dia' as const,
		registro_dia_id,
		segmento_id: null,
		tipo_dia: 'DESCANSO',
		vehiculo_id: null,
		vehiculo_placa: null,
		hora_inicio: null,
		hora_fin: null,
		horas_conducidas: 0
	};
}

describe('builder: fecha, día y horas', () => {
	it('la FECHA se edita en las filas de recorrido y en las de día; el DÍA nunca', () => {
		const libro = buildLibroRecorridos(dto([recorrido('s1', '2026-09-01'), dia('d2', '2026-09-02')]), {
			editable: true
		});
		const seeds = libro.bindingsPorHoja['conductor-c1'];
		const fechas = seeds.filter((s) => s.binding.field === 'fecha');
		expect(new Set(fechas.map((s) => s.binding.tipoFila))).toEqual(new Set(['segmento', 'dia']));
		expect(fechas.every((s) => s.c === COL.FECHA)).toBe(true);
		// El día de la semana se calcula a partir de la fecha: sin binding.
		expect(seeds.some((s) => s.c === COL.DIA_SEMANA)).toBe(false);
	});

	it('la columna de horas es un NÚMERO con formato «horas», no texto', () => {
		const libro = buildLibroRecorridos(dto([recorrido('s1', '2026-09-01')]), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		const r = libro.rangoPorHoja['conductor-c1']!.desde;
		const celda = hoja.cellData[r][COL.HORAS];
		expect(celda.v).toBe(6);
		expect(celda.s.n.pattern).toBe(FORMATO_HORAS);
		// Singular para 1, plural para el resto: lo decide el propio formato.
		expect(FORMATO_HORAS).toContain('" hora"');
		expect(FORMATO_HORAS).toContain('" horas"');
	});

	it('el pie existe aunque la hoja esté vacía, y sin fórmula circular', () => {
		const libro = buildLibroRecorridos(dto([]), { editable: true });
		const hoja = libro.workbook.sheets['conductor-c1'] as any;
		const inicio = libro.inicioDatosPorHoja['conductor-c1'];
		const total = colValorPagar(libro.workbook.sheets['conductor-c1'] ? dto([]).bonos : []);
		expect(libro.rangoPorHoja['conductor-c1']).toBeNull();
		// El pie ocupa la fila donde irían los datos.
		expect(hoja.cellData[inicio][COL.DESCRIPCION].v).toBe('TOTAL EN BONOS DEL PERIODO');
		expect(hoja.cellData[inicio][total].f).toBeUndefined();
		// Con filas, la fórmula cubre exactamente la zona de datos (con un bono,
		// el valor a pagar es la columna O).
		expect(formulaPie(total, 4, 10)).toBe('=SUBTOTAL(109,O5:O11)');
	});

	it('una fila insertada nace en blanco, ámbar y con las casillas en NO', () => {
		const bonos = dto([]).bonos;
		const celdas = celdasFilaVacia(bonos, { borrador: true });
		expect(celdas[COL.ITEM].v).toBe('+');
		expect(celdas[COL.FECHA].v).toBe('');
		expect(celdas[COL.PERNOCTE].v).toBe('NO');
		expect(celdas[COL_BONO_INICIO].v).toBe('NO');
		expect(celdas[colValorPagar(bonos)].v).toBe(0);
		expect((celdas[COL.FECHA].s as any).bg.rgb).toBe(BORRADOR_BG);
		expect((celdas[COL.HORAS].s as any).n.pattern).toBe(FORMATO_HORAS);
		// Al vincularla, el ámbar desaparece: `null` explícito, porque Univer
		// fusiona estilos y omitir el fondo lo dejaría pegado.
		expect((celdasFilaVacia(bonos)[COL.FECHA].s as any).bg).toBeNull();
	});

	it('un borrador enlaza fecha, tipo, placa, horario y bonos con el id local', () => {
		const seeds = bindingsFilaNueva(7, 'nueva:abc', 'c1', dto([]).bonos);
		const campos = new Set(seeds.map((s) => s.binding.field));
		expect(campos.has('fecha')).toBe(true);
		expect(campos.has('tipo_dia')).toBe(true);
		expect(campos.has('vehiculo_placa')).toBe(true);
		expect(campos.has(`bono:${BONO}`)).toBe(true);
		expect(seeds.every((s) => s.r === 7 && s.binding.tipoFila === 'nueva')).toBe(true);
	});
});

describe('registry: los bindings siguen a las filas', () => {
	const unitId = 'u-filas';
	const sheetId = 'conductor-c1';

	function sembrar() {
		clearRecorridoBindings(unitId);
		setRecorridoBindings(unitId, sheetId, [
			{ r: 4, c: COL.FECHA, binding: { tipoFila: 'segmento', entityId: 's1', field: 'fecha', conductorId: 'c1', registroDiaId: 'd1' } },
			{ r: 5, c: COL.FECHA, binding: { tipoFila: 'segmento', entityId: 's2', field: 'fecha', conductorId: 'c1', registroDiaId: 'd2' } },
			{ r: 6, c: COL.FECHA, binding: { tipoFila: 'dia', entityId: 'd3', field: 'fecha', conductorId: 'c1', registroDiaId: 'd3' } }
		]);
	}

	it('insertar dos filas encima de la 5 baja la 5 y la 6 dos puestos', () => {
		sembrar();
		shiftRecorridoBindings(unitId, sheetId, 5, 2);
		expect(getRecorridoBinding(unitId, sheetId, 4, COL.FECHA)?.entityId).toBe('s1');
		expect(getRecorridoBinding(unitId, sheetId, 5, COL.FECHA)).toBeUndefined();
		expect(getRecorridoBinding(unitId, sheetId, 7, COL.FECHA)?.entityId).toBe('s2');
		expect(getRecorridoBinding(unitId, sheetId, 8, COL.FECHA)?.entityId).toBe('d3');
		// El índice inverso también: es el que usan los patches remotos.
		expect(getRecorridoCellFor(unitId, 'd3', 'fecha')?.row).toBe(8);
		clearRecorridoBindings(unitId);
	});

	it('eliminar la fila 5 descarta su binding y sube la 6', () => {
		sembrar();
		shiftRecorridoBindings(unitId, sheetId, 5, -1);
		expect(getRecorridoBinding(unitId, sheetId, 5, COL.FECHA)?.entityId).toBe('d3');
		expect(getRecorridoBinding(unitId, sheetId, 6, COL.FECHA)).toBeUndefined();
		expect(getRecorridoCellFor(unitId, 's2', 'fecha')).toBeUndefined();
		expect(getRecorridoBindingsDeFila(unitId, sheetId, 5)).toHaveLength(1);
		clearRecorridoBindings(unitId);
	});
});

describe('lo que Univer convierte al teclear', () => {
	it('la fecha vuelve a ser texto ISO, venga como serial, ISO o DD/MM/AAAA', () => {
		// 2026-09-03 como serial de Excel (días desde 1899-12-30).
		expect(fechaDesdeCelda(46268)).toBe('2026-09-03');
		expect(fechaDesdeCelda('2026-09-03')).toBe('2026-09-03');
		expect(fechaDesdeCelda('3/9/2026')).toBe('2026-09-03');
		expect(fechaDesdeCelda('03-09-2026')).toBe('2026-09-03');
		expect(fechaDesdeCelda('2026-02-30')).toBeNull();
		expect(fechaDesdeCelda('hoy')).toBeNull();
		expect(fechaDesdeCelda('')).toBeNull();
	});

	it('la hora vuelve a HH:MM desde la fracción del día', () => {
		expect(horaDesdeCelda(0.3125)).toBe('07:30');
		expect(horaDesdeCelda('7:30')).toBe('07:30');
		expect(horaDesdeCelda('18:00')).toBe('18:00');
		// Lo que no se entiende se deja para que el servidor lo explique.
		expect(horaDesdeCelda('siete')).toBe('siete');
	});

	it('«6 horas» es 6; la placa va en mayúsculas y sin espacios', () => {
		expect(horasDesdeCelda('6 horas')).toBe(6);
		expect(horasDesdeCelda('6,5')).toBe(6.5);
		expect(horasDesdeCelda(6)).toBe(6);
		expect(horasDesdeCelda('seis')).toBe('seis');
		expect(placaDesdeCelda(' fst 006 ')).toBe('FST006');
		expect(placaDesdeCelda(null)).toBe('');
	});
});

describe('guarda: insertar y eliminar solo dentro de la tabla', () => {
	const unitId = 'u-guarda';
	const sheetId = 'conductor-c1';

	function montarGuarda(
		zona: { desde: number; hasta: number; vacia?: boolean } | null,
		seleccion: { startRow: number; endRow: number },
		extra: { bindings?: Array<{ r: number; c: number }>; derivadas?: number[] } = {}
	) {
		clearRecorridoBindings(unitId);
		setRecorridoBindings(
			unitId,
			sheetId,
			(extra.bindings ?? []).map(({ r, c }) => ({
				r,
				c,
				binding: { tipoFila: 'nueva' as const, entityId: `nueva:${r}`, field: 'fecha', conductorId: 'c1', registroDiaId: '' }
			}))
		);
		const antes: Array<(info: any) => void> = [];
		const bloqueos: string[] = [];
		const injector = {
			get(token: unknown) {
				// Por identidad del token, no por nombre: los tokens de Univer no
				// son strings.
				if (token === ICommandService) {
					return {
						beforeCommandExecuted: (fn: any) => {
							antes.push(fn);
							return { dispose() {} };
						},
						onCommandExecuted: () => ({ dispose() {} })
					};
				}
				if (token === SheetInterceptorService) {
					return { interceptBeforeCommand: () => ({ dispose() {} }) };
				}
				if (token === IUniverInstanceService) {
					const libro = {
						getUnitId: () => unitId,
						getActiveSheet: () => ({ getSheetId: () => sheetId })
					};
					return { getUnit: () => libro, getCurrentUnitOfType: () => libro };
				}
				if (token === SheetsSelectionsService) {
					return {
						getCurrentSelections: () => [
							{ range: { ...seleccion, startColumn: 0, endColumn: 5 } }
						]
					};
				}
				throw new Error('token desconocido');
			}
		};
		installRecorridosCellPermission({ __getInjector: () => injector } as never, {
			unitId,
			editable: true,
			zonaDeDatos: () => zona,
			columnasDerivadas: () => new Set(extra.derivadas ?? []),
			onBloqueado: (a) => bloqueos.push(a.titulo)
		});
		const ejecutar = (id: string, params: Record<string, unknown> = {}) => {
			for (const fn of antes) fn({ id, params });
		};
		return { ejecutar, bloqueos };
	}

	it('deja insertar debajo de la última fila de datos, y no debajo del pie', () => {
		const zona = { desde: 4, hasta: 10 };
		const ok = montarGuarda(zona, { startRow: 10, endRow: 10 });
		expect(() => ok.ejecutar('sheet.command.insert-row-after')).not.toThrow();
		// La ventana abierta deja pasar la maquinaria interna.
		expect(() => ok.ejecutar('sheet.mutation.insert-row')).not.toThrow();

		const pie = montarGuarda(zona, { startRow: 11, endRow: 11 });
		expect(() => pie.ejecutar('sheet.command.insert-row-after')).toThrow();
		expect(pie.bloqueos).toContain('Solo dentro de la tabla');
	});

	it('no deja eliminar una selección que se sale de la tabla', () => {
		const zona = { desde: 4, hasta: 10 };
		const dentro = montarGuarda(zona, { startRow: 6, endRow: 7 });
		expect(() => dentro.ejecutar('sheet.command.remove-row-confirm')).not.toThrow();

		const conPie = montarGuarda(zona, { startRow: 9, endRow: 11 });
		expect(() => conPie.ejecutar('sheet.command.remove-row-confirm')).toThrow();
		const cabecera = montarGuarda(zona, { startRow: 3, endRow: 4 });
		expect(() => cabecera.ejecutar('sheet.command.remove-row-confirm')).toThrow();
	});

	it('en una hoja vacía solo se puede insertar ENCIMA del pie', () => {
		const zona = { desde: 4, hasta: 4, vacia: true };
		const encima = montarGuarda(zona, { startRow: 4, endRow: 4 });
		expect(() => encima.ejecutar('sheet.command.insert-row-before')).not.toThrow();
		const debajo = montarGuarda(zona, { startRow: 4, endRow: 4 });
		expect(() => debajo.ejecutar('sheet.command.insert-row-after')).toThrow();
		const borrar = montarGuarda(zona, { startRow: 4, endRow: 4 });
		expect(() => borrar.ejecutar('sheet.command.remove-row-confirm')).toThrow();
	});

	it('las columnas y las hojas siguen fijas', () => {
		const g = montarGuarda({ desde: 4, hasta: 10 }, { startRow: 5, endRow: 5 });
		expect(() => g.ejecutar('sheet.command.insert-col-after')).toThrow();
		expect(() => g.ejecutar('sheet.command.remove-sheet')).toThrow();
	});

	it('una mutación de fila SUELTA (sin comando del usuario) no pasa', async () => {
		const g = montarGuarda({ desde: 4, hasta: 10 }, { startRow: 5, endRow: 5 });
		// Sin haber abierto la ventana con un comando de usuario.
		await new Promise((r) => setTimeout(r, 5));
		expect(() => g.ejecutar('sheet.mutation.remove-rows')).toThrow();
	});
});

describe('tirador de relleno (arrastrar una fecha hacia abajo)', () => {
	it('el destino sin el origen es lo que se escribió', () => {
		const origen = { startRow: 33, endRow: 33, startColumn: 1, endColumn: 1 };
		const destino = { startRow: 33, endRow: 40, startColumn: 1, endColumn: 1 };
		expect(rellenado(origen, destino)).toEqual([
			{ startRow: 34, endRow: 40, startColumn: 1, endColumn: 1 }
		]);
		// Hacia arriba también.
		expect(rellenado(origen, { ...destino, startRow: 30, endRow: 33 })).toEqual([
			{ startRow: 30, endRow: 32, startColumn: 1, endColumn: 1 }
		]);
	});

	it('emite un cambio por cada fila rellenada con binding', () => {
		const unitId = 'u-fill';
		const sheetId = 'conductor-c1';
		clearRecorridoBindings(unitId);
		setRecorridoBindings(unitId, sheetId, [
			{ r: 33, c: COL.FECHA, binding: { tipoFila: 'segmento', entityId: 's1', field: 'fecha', conductorId: 'c1', registroDiaId: 'd1' } },
			{ r: 34, c: COL.FECHA, binding: { tipoFila: 'nueva', entityId: 'nueva:a', field: 'fecha', conductorId: 'c1', registroDiaId: '' } },
			{ r: 35, c: COL.FECHA, binding: { tipoFila: 'nueva', entityId: 'nueva:b', field: 'fecha', conductorId: 'c1', registroDiaId: '' } }
		]);
		const listeners: Array<(info: any) => void> = [];
		const cambios: any[] = [];
		const valores: Record<number, string> = { 33: '2026-09-18', 34: '2026-09-19', 35: '2026-09-20' };
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
					getSheetBySheetId: () => ({
						getRange: (r: number) => ({ getCellData: () => ({ v: valores[r] }) })
					})
				}) as never,
			resolveConductor: () => 'c1',
			versionDe: (id) => (id.startsWith('nueva:') ? 0 : 3),
			onCambios: (c) => cambios.push(...c)
		});
		for (const fn of listeners) {
			fn({
				id: 'sheet.command.auto-fill',
				params: {
					sourceRange: { startRow: 33, endRow: 33, startColumn: COL.FECHA, endColumn: COL.FECHA },
					targetRange: { startRow: 33, endRow: 35, startColumn: COL.FECHA, endColumn: COL.FECHA }
				}
			});
		}
		// Dos filas nuevas rellenadas; el origen (fila 33) no cambió y no viaja.
		expect(cambios.map((c) => [c.entityId, c.value])).toEqual([
			['nueva:a', '2026-09-19'],
			['nueva:b', '2026-09-20']
		]);
		clearRecorridoBindings(unitId);
	});
});

describe('arrastre en bloque por encima de columnas calculadas', () => {
	it('el autorrelleno pasa por DÍA y # dentro de la tabla; un pegado normal no', () => {
		const unitId = 'u-guarda';
		const sheetId = 'conductor-c1';
		const zona = { desde: 4, hasta: 10 };
		const bindings = [5, 6].flatMap((r) => [COL.FECHA, COL.TIPO].map((c) => ({ r, c })));
		const derivadas = [COL.ITEM, COL.DIA_SEMANA];
		const rango = { startRow: 4, endRow: 6, startColumn: COL.FECHA, endColumn: COL.TIPO };

		// Se reutiliza el doble de la guarda del bloque anterior.
		const listeners: Array<(info: any) => void> = [];
		const injector = {
			get(token: unknown) {
				if (token === ICommandService) {
					return {
						beforeCommandExecuted: (fn: any) => {
							listeners.push(fn);
							return { dispose() {} };
						},
						onCommandExecuted: () => ({ dispose() {} })
					};
				}
				if (token === SheetInterceptorService) return { interceptBeforeCommand: () => ({ dispose() {} }) };
				if (token === IUniverInstanceService) {
					const libro = { getUnitId: () => unitId, getActiveSheet: () => ({ getSheetId: () => sheetId }) };
					return { getUnit: () => libro, getCurrentUnitOfType: () => libro };
				}
				if (token === SheetsSelectionsService) return { getCurrentSelections: () => [] };
				throw new Error('token desconocido');
			}
		};
		clearRecorridoBindings(unitId);
		setRecorridoBindings(
			unitId,
			sheetId,
			bindings.map(({ r, c }) => ({ r, c, binding: { tipoFila: 'nueva' as const, entityId: `nueva:${r}`, field: 'x', conductorId: 'c1', registroDiaId: '' } }))
		);
		installRecorridosCellPermission({ __getInjector: () => injector } as never, {
			unitId,
			editable: true,
			zonaDeDatos: () => zona,
			columnasDerivadas: () => new Set(derivadas)
		});
		const ejecutar = (id: string, params: Record<string, unknown>) => {
			for (const fn of listeners) fn({ id, params });
		};

		// Fila 4 (origen, guardada en la vida real) no tiene binding en este
		// doble: para el test el origen también es borrador.
		setRecorridoBindings(unitId, sheetId, [COL.FECHA, COL.TIPO].map((c) => ({ r: 4, c, binding: { tipoFila: 'nueva' as const, entityId: 'nueva:4', field: 'x', conductorId: 'c1', registroDiaId: '' } })));

		// Arrastre fecha..tipo (incluye DÍA): pasa.
		expect(() => ejecutar('sheet.command.auto-fill', { sourceRange: { ...rango, endRow: 4 }, targetRange: rango })).not.toThrow();
		// El mismo bloque como pegado: DÍA no tiene binding y se rechaza entero.
		expect(() => ejecutar('sheet.command.paste', { range: rango })).toThrow();
		// Arrastre que se sale de la tabla (hasta el pie): no pasa.
		expect(() => ejecutar('sheet.command.auto-fill', { sourceRange: { ...rango, endRow: 4 }, targetRange: { ...rango, endRow: 11 } })).toThrow();
		clearRecorridoBindings(unitId);
	});
});

describe('qué le falta a una fila insertada', () => {
	it('dice lo que falta en palabras, según lo que ya tenga', () => {
		expect(faltantesDeBorrador({})).toEqual([
			'la fecha',
			'el tipo de día (DISPONIBLE, DESCANSO o MANTENIMIENTO), o placa y horario si es un recorrido'
		]);
		// Con fecha y tipo que no sea LABORADO no falta nada: se guarda.
		expect(faltantesDeBorrador({ fecha: '2026-09-10', tipo_dia: 'disponible' })).toEqual([]);
		// LABORADO es un recorrido: exige placa y horario.
		expect(faltantesDeBorrador({ fecha: '2026-09-10', tipo_dia: 'LABORADO' })).toEqual([
			'la placa',
			'la hora inicial',
			'la hora final'
		]);
		// Con placa ya es un recorrido aunque no diga tipo: le falta el horario.
		expect(faltantesDeBorrador({ fecha: '2026-09-10', vehiculo_placa: 'FST006' })).toEqual([
			'la hora inicial',
			'la hora final'
		]);
		expect(faltantesDeBorrador({ fecha: '2026-09-10', tipo_dia: 'MANTENIMIENTO' })).toEqual([
			'la placa del vehículo en mantenimiento'
		]);
	});
});
