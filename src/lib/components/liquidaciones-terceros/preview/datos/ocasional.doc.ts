/**
 * Documento del canvas de LIQUIDACIONES OCASIONALES.
 *
 * Un mes ocasional es UNA liquidación (`cabecera`) con sus items, sus
 * adicionales y su bloque de descuentos. El papel sigue ese mismo orden,
 * que es el del formato GAF-FR-11 que ya emite el PDF de un cierre.
 *
 * Los totales de cabecera mandan sobre los recalculados cuando existen:
 * son los que el servidor dejó guardados y contra los que se paga. Solo se
 * suman las columnas a mano cuando el mes todavía no tiene borrador.
 */

import type {
	AdicionalOcasional,
	ConceptoOcasional,
	ItemOcasional,
	LiquidacionOcasional
} from '$lib/api/liquidaciones-terceros-ocasional';
import { COP, enRojo, fmtPct, nombreArchivoHoja, nombreMes } from '../formato';
import { TITULO_SCOPE } from '../columnas';
import type {
	BloquePreview,
	ColumnaPreview,
	DocumentoPreview,
	FilaPreview,
	LineaResumen
} from '../tipos';

const COLS_ITEMS = [
	'n',
	'cliente',
	'consecutivo',
	'placa',
	'tercero',
	'recorrido',
	'fechas',
	'v_unidad',
	'cantidad',
	'pct_admon',
	'admon',
	'total',
	'valor_liquidar',
	'planilla',
	'ing_extra_global',
	'ing_extras_aval',
	'ingreso_empresa',
	'recargos',
	'factura',
	'aplica_impuestos'
];

/** Los adicionales no vienen de un servicio: no tienen planilla ni factura. */
const COLS_ADICIONALES = [
	'n',
	'cliente',
	'placa',
	'tercero',
	'recorrido',
	'fechas',
	'v_unidad',
	'cantidad',
	'pct_admon',
	'admon',
	'total',
	'valor_liquidar',
	'aplica_impuestos'
];

const COLS_POR_PLACA = ['n', 'placa', 'tercero', 'cantidad', 'valor_liquidar'];

// ─── Columnas propias de los bloques de descuento ────────────────────
// No pasan por el selector: lo que el usuario delimita es la tabla de
// items, no el desglose de un descuento.

const COLS_LABORALES: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 34 },
	{ key: 'persona', label: 'Conductor', tipo: 'texto', peso: 34 },
	{ key: 'dias', label: 'Días / %', tipo: 'texto', peso: 12 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 20 }
];

const COLS_GASTOS: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 40 },
	{ key: 'cantidad', label: 'Cant.', tipo: 'numero', peso: 14 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 23 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 23 }
];

const COLS_ANTICIPOS: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 50 },
	{ key: 'fecha', label: 'Fecha', tipo: 'texto', peso: 25 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 25 }
];

const COLS_IMPUESTOS: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 40 },
	{ key: 'porcentaje', label: '%', tipo: 'texto', peso: 15 },
	{ key: 'base', label: 'Base', tipo: 'moneda', peso: 22 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 23 }
];

const num = (v: unknown) => Number(v) || 0;

/** TOTAL de una fila de item: lo facturado al cliente. */
const totalItem = (it: ItemOcasional) =>
	it.total_facturado != null
		? num(it.total_facturado)
		: num(it.valor_unitario) * num(it.cantidad);

const totalAdicional = (a: AdicionalOcasional) => num(a.valor_unitario) * num(a.cantidad);

/** Nombre legible de un concepto de descuento. */
const nombreConcepto = (c: ConceptoOcasional) => (c.concepto || '').replace(/_/g, ' ');

export function documentoOcasional(o: {
	cabecera: LiquidacionOcasional | null;
	items: ItemOcasional[];
	adicionales: AdicionalOcasional[];
	conceptos: ConceptoOcasional[];
	mes: number;
	anio: number;
}): DocumentoPreview {
	// Los excluidos se muestran tachados y NO suman: es el soft-delete del
	// pivote, igual que en el canvas de cierres.
	const items = [...o.items].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
	const vivos = items.filter((it) => !it.excluido);

	const filasItems: FilaPreview[] = items.map((it, i) => ({
		excluida: !!it.excluido,
		celdas: {
			n: i + 1,
			cliente: it.cliente_nombre || '—',
			consecutivo: it.consecutivo || '—',
			placa: it.placa,
			tercero: it.tercero_nombre || '—',
			recorrido: it.recorrido || '—',
			fechas: it.fechas || '',
			v_unidad: num(it.valor_unitario),
			cantidad: num(it.cantidad),
			pct_admon: num(it.porcentaje_admin),
			admon: enRojo(num(it.valor_admin)),
			total: totalItem(it),
			valor_liquidar: num(it.valor_liquidar),
			planilla: it.numero_planilla || '',
			ing_extra_global: num(it.ingreso_extra_global),
			ing_extras_aval: num(it.ingresos_extra_aval),
			ingreso_empresa: num(it.ingreso_empresa),
			recargos: num(it.valor_recargos ?? it.liquidacion_servicio?.valor_recargos),
			factura: it.numero_factura || '',
			aplica_impuestos: it.aplica_impuestos !== false
		}
	}));

	const adicionales = [...o.adicionales].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
	const filasAdicionales: FilaPreview[] = adicionales.map((a, i) => ({
		destacada: true,
		celdas: {
			n: i + 1,
			cliente: a.cliente || 'COTRANSMEQ',
			placa: a.placa,
			tercero: a.tercero_nombre || '—',
			recorrido: a.recorrido || '—',
			fechas: a.fechas || '',
			v_unidad: num(a.valor_unitario),
			cantidad: num(a.cantidad),
			pct_admon: num(a.porcentaje_admin),
			admon: enRojo(num(a.valor_admin)),
			total: totalAdicional(a),
			valor_liquidar: num(a.valor_liquidar),
			aplica_impuestos: a.aplica_impuestos !== false
		}
	}));

	// ── Sumas de tabla ──
	const itemsFacturado = vivos.reduce((s, it) => s + totalItem(it), 0);
	const itemsAdmon = vivos.reduce((s, it) => s + num(it.valor_admin), 0);
	const itemsLiquidar = vivos.reduce((s, it) => s + num(it.valor_liquidar), 0);
	const itemsCantidad = vivos.reduce((s, it) => s + num(it.cantidad), 0);
	const adicFacturado = adicionales.reduce((s, a) => s + totalAdicional(a), 0);
	const adicAdmon = adicionales.reduce((s, a) => s + num(a.valor_admin), 0);
	const adicLiquidar = adicionales.reduce((s, a) => s + num(a.valor_liquidar), 0);
	const adicCantidad = adicionales.reduce((s, a) => s + num(a.cantidad), 0);

	// ── Resumen por placa ──
	// Es la vista con la que se contrasta la liquidación ocasional contra los
	// cierres finales de cada placa, que es lo que se hace al cerrarla.
	const porPlaca = new Map<string, { tercero: string; cantidad: number; liquidar: number }>();
	const acumular = (placa: string, tercero: string, cantidad: number, liquidar: number) => {
		const clave = placa || '—';
		const acc = porPlaca.get(clave) ?? { tercero, cantidad: 0, liquidar: 0 };
		acc.cantidad += cantidad;
		acc.liquidar += liquidar;
		porPlaca.set(clave, acc);
	};
	for (const it of vivos) {
		acumular(it.placa, it.tercero_nombre || '—', num(it.cantidad), num(it.valor_liquidar));
	}
	for (const a of adicionales) {
		acumular(a.placa, a.tercero_nombre || '—', num(a.cantidad), num(a.valor_liquidar));
	}
	const filasPlaca: FilaPreview[] = [...porPlaca.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([placa, v], i) => ({
			celdas: {
				n: i + 1,
				placa,
				tercero: v.tercero,
				cantidad: v.cantidad,
				valor_liquidar: v.liquidar
			}
		}));

	// ── Descuentos ──
	// Van como BLOQUES con columnas propias, el mismo lenguaje que la hoja
	// de un cierre: sus campos (concepto, días, porcentaje) no son columnas
	// del catálogo de este canvas, y meterlos ahí llenaría el selector de
	// opciones que solo aplican a un trozo del papel.
	const porTipo = (tipo: ConceptoOcasional['tipo']) =>
		o.conceptos
			.filter((c) => c.tipo === tipo)
			.sort((a, b) => (a.orden || 0) - (b.orden || 0));

	const bloqueDe = (
		id: string,
		titulo: string,
		lista: ConceptoOcasional[],
		variante: BloquePreview['variante'],
		columnas: ColumnaPreview[],
		celdasDe: (c: ConceptoOcasional) => FilaPreview['celdas']
	): { bloque: BloquePreview; total: number } | null => {
		// Un bloque sin conceptos no se emite: un titular por cada tipo
		// llenaría el papel de secciones vacías.
		if (!lista.length) return null;
		const total = lista.reduce((s, c) => s + num(c.valor_total), 0);
		return {
			total,
			bloque: {
				id,
				titulo,
				variante,
				columnas,
				filas: lista.map((c) => ({ celdas: celdasDe(c) })),
				pie: { label: `Total ${titulo.toLowerCase()}`, valor: total }
			}
		};
	};

	const bloquesDescuento: BloquePreview[] = [];
	for (const b of [
		bloqueDe(
			'laborales',
			'Costos laborales',
			porTipo('COSTO_LABORAL'),
			'neutro',
			COLS_LABORALES,
			(c) => ({
				concepto: nombreConcepto(c),
				persona: c.conductor ? `${c.conductor.nombre} ${c.conductor.apellido}` : '—',
				dias: c.dias ? String(c.dias) : c.porcentaje != null ? fmtPct(num(c.porcentaje)) : '',
				total: num(c.valor_total)
			})
		),
		bloqueDe('gastos', 'Gastos de vehículo', porTipo('GASTO_OPERATIVO'), 'gastos', COLS_GASTOS, (c) => ({
			concepto: nombreConcepto(c),
			cantidad: c.dias ?? null,
			valor: num(c.valor_unitario),
			total: num(c.valor_total)
		})),
		bloqueDe('anticipos', 'Anticipos', porTipo('ANTICIPO'), 'anticipos', COLS_ANTICIPOS, (c) => ({
			concepto: nombreConcepto(c),
			// La fecha del anticipo vive en `observaciones`: herencia del
			// editor tabular, no hay columna propia.
			fecha: c.observaciones || '—',
			valor: num(c.valor_total)
		})),
		bloqueDe(
			'impuestos',
			'Impuestos y retenciones',
			porTipo('IMPUESTO'),
			'impuestos',
			COLS_IMPUESTOS,
			(c) => ({
				concepto: nombreConcepto(c),
				porcentaje: c.porcentaje != null ? `${num(c.porcentaje).toFixed(2)}%` : '—',
				base: num(c.base_calculo),
				valor: num(c.valor_total)
			})
		)
	]) {
		if (b) bloquesDescuento.push(b.bloque);
	}

	const cab = o.cabecera;
	const totalDescuentos = cab ? num(cab.total_descuentos) : null;
	const totalPagar = cab
		? num(cab.total_pagar)
		: itemsLiquidar + adicLiquidar;

	const resumen: LineaResumen[] = [
		{ label: 'Valor a liquidar', valor: itemsLiquidar + adicLiquidar },
		...(totalDescuentos != null
			? [{ label: 'Total descuentos', valor: totalDescuentos, descuento: true }]
			: []),
		{ label: 'Total a pagar', valor: totalPagar, fuerte: true }
	];

	return {
		titulo: TITULO_SCOPE.ocasional,
		meta: [
			{ label: 'Código', valor: 'GAF-FR-11' },
			{ label: 'Consecutivo', valor: cab?.consecutivo || '—' },
			{ label: 'Periodo', valor: `${String(o.mes).padStart(2, '0')}/${o.anio}` }
		],
		periodo: [
			{ label: 'Mes', valor: nombreMes(o.mes) },
			{ label: 'Año', valor: String(o.anio) },
			{ label: 'Consecutivo', valor: cab?.consecutivo || '—' },
			{ label: 'Estado', valor: cab?.estado || 'SIN BORRADOR' },
			{ label: 'Total a pagar', valor: COP(totalPagar) }
		],
		secciones: [
			{
				id: 'items',
				titulo: 'Items de la liquidación',
				nota: `${vivos.length} item(s)${
					items.length !== vivos.length ? `  ·  ${items.length - vivos.length} excluido(s)` : ''
				}`,
				columnas: COLS_ITEMS,
				filas: filasItems,
				vacio: cab
					? 'Esta liquidación no tiene items.'
					: 'Este mes no tiene borrador generado.',
				totalesLabel: 'Totales',
				totales: {
					cantidad: itemsCantidad,
					admon: enRojo(itemsAdmon),
					total: itemsFacturado,
					valor_liquidar: itemsLiquidar
				}
			},
			{
				id: 'adicionales',
				titulo: 'Adicionales',
				nota: `${adicionales.length} fila(s)`,
				columnas: COLS_ADICIONALES,
				filas: filasAdicionales,
				vacio: 'Sin adicionales en este mes.',
				totalesLabel: 'Totales',
				totales: {
					cantidad: adicCantidad,
					admon: enRojo(adicAdmon),
					total: adicFacturado,
					valor_liquidar: adicLiquidar
				}
			},
			{
				id: 'por-placa',
				titulo: 'Resumen por placa',
				nota: `${porPlaca.size} placa(s)`,
				columnas: COLS_POR_PLACA,
				filas: filasPlaca,
				vacio: 'Sin placas liquidadas.',
				totalesLabel: 'Totales',
				totales: {
					cantidad: itemsCantidad + adicCantidad,
					valor_liquidar: itemsLiquidar + adicLiquidar
				}
			},
			...(bloquesDescuento.length
				? [
						{
							id: 'descuentos',
							titulo: 'Descuentos por la prestación del servicio',
							columnas: [] as string[],
							filas: [] as FilaPreview[],
							bloques: bloquesDescuento,
							bloquesPorFila: 2 as const
						}
					]
				: [])
		],
		resumen,
		// El CONSECUTIVO ya no entra en el nombre. Identificaba bien un archivo
		// suelto, pero dentro del ZIP anual dejaba doce ficheros con nombres sin
		// relación entre sí —`LIQ-OCA-2026-0007 JUNIO 2026`—, imposibles de ordenar
		// por periodo. El consecutivo sigue impreso en la cabecera del documento.
		sello: !!cab?.estado && cab.estado !== 'BORRADOR',
		nombreArchivo: nombreArchivoHoja('OCASIONALES', o.mes, o.anio)
	};
}
