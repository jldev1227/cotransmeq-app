/**
 * Documento del canvas de ADICIONALES DE CIERRES FINALES.
 *
 * Traduce lo que la hoja del mes tiene en pantalla a las estructuras de
 * `tipos.ts`. Los totales se recalculan aquí y no se leen del servidor a
 * propósito: la hoja muestra columnas derivadas por fórmula, y el papel
 * tiene que cuadrar con lo que el usuario está viendo, no con el último
 * guardado.
 */

import type { AdicionalListado } from '$lib/api/liquidaciones-terceros-adicionales';
import { COP, enRojo, nombreMes } from '../formato';
import type { DocumentoPreview, FilaPreview, LineaResumen } from '../tipos';
import { TITULO_SCOPE } from '../columnas';

/** Todas las claves del catálogo que la tabla de items sabe rellenar. */
const COLS_ITEMS = [
	'n',
	'placa',
	'tercero',
	'cliente',
	'recorrido',
	'fechas',
	'v_unidad',
	'cantidad',
	'pct_admon',
	'admon',
	'total',
	'valor_liquidar',
	'cierre',
	'estado',
	'aplica_impuestos'
];

/** El resumen por placa solo tiene sentido en las columnas agregables. */
const COLS_POR_PLACA = ['placa', 'tercero', 'cantidad', 'admon', 'total', 'valor_liquidar'];

/**
 * TOTAL de una fila = V/UNIDAD × CANT.
 *
 * `valor_admin` y `valor_liquidar` sí vienen del servidor: son las que
 * cascadean con el porcentaje y las calcula él.
 */
const totalDe = (it: AdicionalListado) => (it.valor_unitario || 0) * (it.cantidad || 0);

export function documentoAdicionales(o: {
	items: AdicionalListado[];
	mes: number;
	anio: number;
	/** Σ del año, para la banda de periodo. */
	totalAnual?: number;
}): DocumentoPreview {
	const items = [...o.items].sort(
		(a, b) =>
			(a.placa || '').localeCompare(b.placa || '') ||
			(a.orden ?? 0) - (b.orden ?? 0)
	);

	const filas: FilaPreview[] = items.map((it, i) => ({
		celdas: {
			n: i + 1,
			placa: it.placa,
			tercero: it.tercero_nombre || '—',
			cliente: it.cliente || 'COTRANSMEQ',
			recorrido: it.recorrido || '—',
			fechas: it.fechas || '',
			v_unidad: it.valor_unitario,
			cantidad: it.cantidad,
			pct_admon: it.porcentaje_admin,
			admon: enRojo(it.valor_admin || 0),
			total: totalDe(it),
			valor_liquidar: it.valor_liquidar,
			cierre: it.cierre_consecutivo || '—',
			estado: it.estado || '',
			aplica_impuestos: it.aplica_impuestos
		}
	}));

	const sumaFacturado = items.reduce((s, it) => s + totalDe(it), 0);
	const sumaAdmon = items.reduce((s, it) => s + (it.valor_admin || 0), 0);
	const sumaLiquidar = items.reduce((s, it) => s + (it.valor_liquidar || 0), 0);
	const sumaCantidad = items.reduce((s, it) => s + (it.cantidad || 0), 0);

	// ── Resumen por placa ──
	// La placa es la unidad con la que se revisa este canvas: un adicional
	// se reparte en varias filas y lo que se contrasta contra el cierre es
	// el acumulado de la placa, no cada fila suelta.
	const porPlaca = new Map<
		string,
		{ tercero: string; cantidad: number; admon: number; total: number; liquidar: number }
	>();
	for (const it of items) {
		const clave = it.placa || '—';
		const acc =
			porPlaca.get(clave) ??
			{ tercero: it.tercero_nombre || '—', cantidad: 0, admon: 0, total: 0, liquidar: 0 };
		acc.cantidad += it.cantidad || 0;
		acc.admon += it.valor_admin || 0;
		acc.total += totalDe(it);
		acc.liquidar += it.valor_liquidar || 0;
		porPlaca.set(clave, acc);
	}

	const filasPlaca: FilaPreview[] = [...porPlaca.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([placa, v]) => ({
			celdas: {
				placa,
				tercero: v.tercero,
				cantidad: v.cantidad,
				admon: enRojo(v.admon),
				total: v.total,
				valor_liquidar: v.liquidar
			}
		}));

	const resumen: LineaResumen[] = [
		{ label: 'Total facturado', valor: sumaFacturado },
		{ label: 'Total administración', valor: sumaAdmon, descuento: true },
		{ label: 'Total a liquidar', valor: sumaLiquidar, fuerte: true }
	];

	const periodo = [
		{ label: 'Mes', valor: nombreMes(o.mes) },
		{ label: 'Año', valor: String(o.anio) },
		{ label: 'Filas', valor: String(items.length) },
		{ label: 'Placas', valor: String(porPlaca.size) }
	];
	if (o.totalAnual != null) {
		periodo.push({ label: 'Σ Año', valor: COP(o.totalAnual) });
	}

	return {
		titulo: TITULO_SCOPE.adicionales,
		meta: [
			{ label: 'Código', valor: 'GAF-FR-11' },
			{ label: 'Periodo', valor: `${String(o.mes).padStart(2, '0')}/${o.anio}` },
			{ label: 'Filas', valor: String(items.length) }
		],
		periodo,
		secciones: [
			{
				id: 'items',
				titulo: 'Adicionales del periodo',
				nota: `${items.length} fila(s)`,
				columnas: COLS_ITEMS,
				filas,
				vacio: 'Este mes no tiene adicionales registrados.',
				totalesLabel: 'Totales',
				totales: {
					cantidad: sumaCantidad,
					admon: enRojo(sumaAdmon),
					total: sumaFacturado,
					valor_liquidar: sumaLiquidar
				}
			},
			{
				id: 'por-placa',
				titulo: 'Resumen por placa',
				nota: `${porPlaca.size} placa(s)`,
				columnas: COLS_POR_PLACA,
				filas: filasPlaca,
				vacio: 'Sin placas con adicionales.',
				totalesLabel: 'Totales',
				totales: {
					cantidad: sumaCantidad,
					admon: enRojo(sumaAdmon),
					total: sumaFacturado,
					valor_liquidar: sumaLiquidar
				}
			}
		],
		resumen,
		nombreArchivo: `adicionales_${o.anio}_${String(o.mes).padStart(2, '0')}`
	};
}
