/**
 * Documento de la HOJA ACTIVA del canvas de cierres finales.
 *
 * Una hoja es un cierre —un par placa-propietario— y el papel lleva todo
 * lo que la hoja lleva, en su mismo orden:
 *
 *   1. Tabla de items de la liquidación (+ adicionales de Cotransmeq)
 *   2. Descuentos por la prestación del servicio: un bloque por conductor
 *   3. Gastos de vehículo
 *   4. Anticipos del vehículo
 *   5. Impuestos y retenciones (o el reparto por copropietario)
 *   6. TOTAL DESCUENTOS y TOTAL A PAGAR
 *
 * ── De dónde salen los números ──
 * De `detalles[cierreId]`, es decir de lo que el canvas tiene EN MEMORIA,
 * no de una lectura nueva al servidor. Es deliberado: la hoja recalcula en
 * vivo (editar los días de un SALARIO cascadea a prestaciones, seguridad
 * social, dotación y examen médico) y el preview tiene que enseñar lo que
 * el usuario está viendo, no el último estado confirmado.
 *
 * Las agrupaciones de nómina y la cantidad de los gastos automáticos se
 * toman de `getConductorGrupos` y `totalDiasNoPropietarios`, las mismas
 * funciones que usa el builder de la hoja. Reimplementarlas aquí sería una
 * tercera aritmética del mismo dato.
 */

import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import type {
	AdicionalCierre,
	CierreFinalCompleto,
	CopropietarioCierre,
	ItemCierre
} from '$lib/editor/builders/cierres-finales.builder';
import { claveConductor } from '$lib/editor/builders/cierres-finales.builder';
import { getConductorGrupos } from '$lib/editor/business/conductor-grupos.service';
import { totalDiasNoPropietarios } from '$lib/editor/business/conceptos.service';
import { COP, enRojo, fmtPct, fmtPlaca, nombreMes, restado } from '../formato';
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
	'factura',
	'aplica_impuestos'
];

const n = (v: unknown): number => {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
};

/**
 * Un total de ingresos que PUEDE salir negativo —los adicionales restan—
 * pintado como resta: paréntesis y rojo, igual que las filas que lo
 * provocan.
 *
 * `restado()` espera la MAGNITUD, no el número con signo: el paréntesis es
 * el signo y lo pone él. Sin pasar por aquí, el pie salía como un
 * `-$ 1.442.450` en negro —el `-` de `COP()`— que en papel se lee como un
 * guion de separación y no como una resta, justo en la única fila donde el
 * signo cambia lo que significa la cifra.
 */
const totalConSigno = (v: number) => (v < 0 ? restado(-v) : v);

/** Orden canónico de los impuestos. El mismo del builder y del backend. */
const ORDEN_IMPUESTOS: Record<string, number> = {
	RETENCION_ICA: 1,
	AVISOS_TABLEROS: 2,
	SOBRETASA_BOMBERIL: 3,
	RETENCION_FUENTE: 4
};

/**
 * DOTACION y EXAMEN_MEDICO son automáticos: su cantidad son los días de
 * SALARIO de los conductores NO propietarios. Misma regla que aplica el
 * builder — y por la misma razón: una hoja sin conductores nunca ha pasado
 * por la cascada del servidor y su `dias` es NULL.
 */
const GASTOS_POR_DIAS_CONDUCTOR = new Set(['DOTACION', 'EXAMEN_MEDICO']);

const legible = (concepto: string) => (concepto || '').replace(/_/g, ' ');

// ─── Columnas propias de cada bloque ──────────────────────────────────

const COLS_CONDUCTOR: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 40 },
	{ key: 'dias', label: 'Días / %', tipo: 'texto', peso: 14 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 23 },
	{ key: 'total', label: 'Total', tipo: 'moneda', peso: 23 }
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

/**
 * SIN columna BASE. Es una cifra de trabajo —sobre qué se aplicó el
 * porcentaje—, no algo que el tercero tenga que ver ni cotejar: lo que le
 * importa es qué le retienen y a qué tasa. El documento que sale por correo
 * (`liquidaciones-terceros-pdf.template.ts`) ya la omitía; esta era la única
 * vista que la seguía sacando.
 */
const COLS_IMPUESTOS: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 50 },
	{ key: 'porcentaje', label: '%', tipo: 'texto', peso: 20 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 30 }
];

const COLS_COPROPIETARIO: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 52 },
	{ key: 'porcentaje', label: '%', tipo: 'texto', peso: 18 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 30 }
];

// ─── Bloques ──────────────────────────────────────────────────────────

/**
 * Un bloque por conductor: salarios, la categoría PRESTACIONES SOCIALES
 * con sus hijos, la de SEGURIDAD SOCIAL con los suyos, y el total.
 *
 * Los porcentajes de una categoría son la SUMA de los de sus hijos, igual
 * que en la hoja: es un agregado, no el porcentaje del primero.
 */
function bloquesConductores(
	conceptos: ConceptoDescuento[],
	propietarios: Record<string, boolean>
): BloquePreview[] {
	return getConductorGrupos(conceptos).map((g) => {
		const filas: FilaPreview[] = [];

		for (const c of g.salarios) {
			filas.push({
				celdas: {
					concepto: legible(c.concepto),
					dias: c.dias ? String(c.dias) : '',
					valor: n(c.valor_unitario),
					total: n(c.valor_total)
				}
			});
		}

		const categoria = (titulo: string, lista: ConceptoDescuento[]) => {
			if (!lista.length) return;
			filas.push({
				variante: 'categoria',
				celdas: {
					concepto: titulo,
					dias: fmtPct(lista.reduce((s, c) => s + n(c.porcentaje), 0)),
					valor: null,
					total: lista.reduce((s, c) => s + n(c.valor_total), 0)
				}
			});
			for (const c of lista) {
				filas.push({
					variante: 'hija',
					celdas: {
						concepto: legible(c.concepto),
						dias: fmtPct(n(c.porcentaje)),
						valor: null,
						total: n(c.valor_total)
					}
				});
			}
		};
		categoria('Prestaciones sociales', g.prestaciones);
		categoria('Seguridad social', g.seguridadSocial);

		const esPropietario = propietarios[claveConductor(g.conductorId)] === true;
		const cc = (g.conceptos[0] as any)?.conductor?.numero_identificacion;

		return {
			id: `cond-${g.conductorId ?? 'sin-conductor'}`,
			titulo: g.nombre,
			subtitulo: cc ? `CC ${cc}` : undefined,
			// Se dice quién es propietario porque de ello depende que su
			// dotación y su examen médico entren en los gastos automáticos.
			etiqueta: esPropietario ? 'Propietario' : undefined,
			columnas: COLS_CONDUCTOR,
			filas,
			pie: { label: 'Valor total conductor', valor: n(g.totalConductor) },
			vacio: 'Sin conceptos de nómina.'
		};
	});
}

function bloqueGastos(
	conceptos: ConceptoDescuento[],
	propietarios: Record<string, boolean>
): { bloque: BloquePreview; total: number } {
	const gastos = conceptos
		.filter((c) => c.tipo === 'GASTO_OPERATIVO')
		.sort((a, b) => (a.orden || 0) - (b.orden || 0));

	const diasNoPropietarios = totalDiasNoPropietarios(conceptos, propietarios);
	// `calculado === false` es la marca de que alguien puso el número a
	// mano: ahí manda lo guardado, igual que en el servidor y en la hoja.
	const cantidadDe = (g: ConceptoDescuento) =>
		g.calculado !== false && GASTOS_POR_DIAS_CONDUCTOR.has(g.concepto)
			? diasNoPropietarios
			: n(g.dias);

	let total = 0;
	const filas: FilaPreview[] = gastos.map((g) => {
		const cantidad = cantidadDe(g);
		const vu = n(g.valor_unitario);
		total += cantidad * vu;
		return {
			celdas: {
				concepto: legible(g.concepto),
				cantidad,
				valor: vu,
				total: cantidad * vu
			}
		};
	});

	return {
		total,
		bloque: {
			id: 'gastos',
			titulo: 'Gastos de vehículo',
			variante: 'gastos',
			columnas: COLS_GASTOS,
			filas,
			pie: { label: 'Total gastos de vehículo', valor: total },
			vacio: 'Sin gastos registrados.'
		}
	};
}

function bloqueAnticipos(conceptos: ConceptoDescuento[]): {
	bloque: BloquePreview;
	total: number;
} {
	const anticipos = conceptos
		.filter((c) => c.tipo === 'ANTICIPO')
		.sort((a, b) => (a.orden || 0) - (b.orden || 0));
	const total = anticipos.reduce((s, c) => s + n(c.valor_total), 0);

	return {
		total,
		bloque: {
			id: 'anticipos',
			titulo: 'Anticipos del vehículo',
			variante: 'anticipos',
			columnas: COLS_ANTICIPOS,
			filas: anticipos.map((a) => ({
				celdas: {
					concepto: legible(a.concepto),
					// La fecha del anticipo vive en `observaciones`: herencia del
					// editor tabular, no hay columna propia.
					fecha: a.observaciones || '—',
					valor: n(a.valor_unitario ?? a.valor_total)
				}
			})),
			pie: { label: 'Total anticipos del vehículo', valor: total },
			vacio: 'Sin anticipos registrados.'
		}
	};
}

function bloqueImpuestos(impuestos: ConceptoDescuento[]): {
	bloque: BloquePreview;
	total: number;
} {
	const total = impuestos.reduce((s, c) => s + n(c.valor_total), 0);
	return {
		total,
		bloque: {
			id: 'impuestos',
			titulo: 'Impuestos y retenciones',
			variante: 'impuestos',
			columnas: COLS_IMPUESTOS,
			filas: impuestos.map((i) => ({
				celdas: {
					concepto: legible(i.concepto),
					porcentaje: i.porcentaje != null ? `${n(i.porcentaje).toFixed(2)}%` : '—',
					valor: n(i.valor_total)
				}
			})),
			pie: { label: 'Total impuestos y retenciones', valor: total },
			vacio: 'Sin impuestos registrados.'
		}
	};
}

/**
 * Una card por copropietario: lo que le toca facturar, sus retenciones y
 * su neto.
 *
 * El reparto es proporcional al porcentaje declarado, que es como lo hace
 * el editor. La suma de los porcentajes NO se normaliza: por requisito del
 * negocio un cierre puede repartir 115%, y corregirlo rompería la
 * liquidación. Se avisa en la nota de la sección.
 */
function bloquesCopropietarios(
	copropietarios: CopropietarioCierre[],
	impuestos: ConceptoDescuento[],
	valorLiquidar: number,
	descuentosGlobales: number
): BloquePreview[] {
	return copropietarios.map((p) => {
		const factor = n(p.porcentaje) / 100;
		const facturar = Math.max(
			0,
			Math.round(valorLiquidar * factor) - Math.round(descuentosGlobales * factor)
		);
		const suyos = impuestos
			.filter((i) => (i as any).propietario_id === p.id)
			.sort(
				(a, b) =>
					(ORDEN_IMPUESTOS[a.concepto] ?? 999) - (ORDEN_IMPUESTOS[b.concepto] ?? 999)
			);
		const totalRet = suyos.reduce((s, i) => s + n(i.valor_total), 0);

		const filas: FilaPreview[] = [
			{
				destacada: true,
				celdas: { concepto: 'Valor a facturar', porcentaje: '', valor: facturar }
			},
			...suyos.map((i) => ({
				variante: 'hija' as const,
				celdas: {
					concepto: legible(i.concepto),
					porcentaje: i.porcentaje != null ? `${n(i.porcentaje).toFixed(2)}%` : '',
					valor: restado(n(i.valor_total))
				}
			}))
		];
		if (totalRet > 0) {
			filas.push({
				variante: 'categoria',
				celdas: {
					concepto: '(−) Total retenciones',
					porcentaje: '',
					valor: restado(totalRet)
				}
			});
		}

		return {
			id: `copro-${p.id}`,
			titulo: p.nombre || '—',
			subtitulo: p.identificacion ? `CC/NIT ${p.identificacion}` : undefined,
			etiqueta: fmtPct(n(p.porcentaje)),
			variante: 'copropietario',
			columnas: COLS_COPROPIETARIO,
			filas,
			pie: { label: '(=) Valor a pagar', valor: Math.max(0, facturar - totalRet) },
			vacio: 'Sin retenciones para este copropietario.'
		};
	});
}

// ─── Documento ────────────────────────────────────────────────────────

export function documentoCierre(o: {
	cierre: CierreFinalCompleto;
	mes: number;
	anio: number;
}): DocumentoPreview {
	const { hoja, items, adicionales, copropietarios, propietarios } = o.cierre;

	/**
	 * Copia de los conceptos, y no los del canvas.
	 *
	 * `getConductorGrupos` REESCRIBE lo que recibe: recalcula `base_calculo`
	 * y `valor_total` de prestaciones y seguridad social sobre las bases del
	 * conductor. Sobre el modelo del canvas eso es dos cosas malas a la vez —
	 * un preview reescribiendo los datos que enseña, y una mutación de
	 * `$state` dentro de un `$derived`, que Svelte 5 aborta con
	 * `state_unsafe_mutation`.
	 *
	 * Basta una copia por concepto: lo que se escribe son escalares.
	 */
	const conceptos = o.cierre.conceptos.map((c) => ({ ...c }));

	// ── 1. Items ──
	// Los excluidos siguen visibles (tachados, para poder restaurarlos) pero
	// NO suman. Es la misma regla del `SUMIF(...,"NO",...)` de la hoja: si
	// sumaran, el papel daría un total distinto del que se ve en el canvas.
	const vivos = items.filter((it) => !it.excluido);

	const filaDeItem = (it: ItemCierre, i: number): FilaPreview => ({
		excluida: !!it.excluido,
		celdas: {
			n: i + 1,
			cliente: it.cliente_nombre || '',
			consecutivo: it.liquidacion_servicio_consecutivo || '',
			placa: it.placa || hoja.placa,
			tercero: it.tercero_nombre || hoja.tercero_nombre || '—',
			recorrido: it.recorrido || '',
			fechas: it.fechas || '',
			v_unidad: n(it.valor_unitario),
			cantidad: n(it.cantidad) || 1,
			pct_admon: n(it.porcentaje_admin),
			admon: enRojo(n(it.valor_admin)),
			total: n(it.total_facturado),
			valor_liquidar: n(it.valor_liquidar),
			planilla: it.numero_planilla || '',
			ing_extra_global: n(it.ingreso_extra_global),
			ing_extras_aval: n(it.ingresos_extra_aval),
			ingreso_empresa: n(it.ingreso_extra_global) - n(it.ingresos_extra_aval),
			factura: it.numero_factura || '',
			aplica_impuestos: it.aplica_impuestos !== false
		}
	});

	// Los adicionales van al final de la MISMA tabla, destacados, como en la
	// hoja: son filas de la liquidación, no un anexo.
	const filaDeAdicional = (a: AdicionalCierre, i: number): FilaPreview => {
		const bruto = n(a.valor_unitario) * (n(a.cantidad) || 1);
		return {
			destacada: true,
			celdas: {
				n: `T${i + 1}`,
				cliente: a.cliente || 'COTRANSMEQ',
				consecutivo: '—',
				placa: a.placa || hoja.placa,
				tercero: a.tercero_nombre || hoja.tercero_nombre || '—',
				recorrido: a.recorrido || '—',
				fechas: a.fechas || '',
				v_unidad: n(a.valor_unitario),
				cantidad: n(a.cantidad) || 1,
				pct_admon: n(a.porcentaje_admin),
				admon: enRojo(n(a.valor_admin)),
				total: bruto,
				valor_liquidar: n(a.valor_liquidar),
				planilla: '—',
				// El adicional RESTA al ingreso de Cotransmeq: es lo que la
				// empresa deja de llevarse para pagárselo al tercero.
				//
				// El negativo va en las DOS columnas. INGRESO EMPRESA se lee
				// como `ING. EXTRA GLOBAL − ING. EXTRAS AVAL` —así lo calcula
				// `filaDeItem`—, y con EXTRA GLOBAL en 0 el pie mostraba una
				// resta que no salía de sus propias columnas.
				ing_extra_global: restado(n(a.valor_liquidar)),
				ing_extras_aval: 0,
				ingreso_empresa: restado(n(a.valor_liquidar)),
				factura: '—',
				aplica_impuestos: a.aplica_impuestos !== false
			}
		};
	};

	const filasItems = [
		...items.map(filaDeItem),
		...adicionales.map(filaDeAdicional)
	];

	const totalAdicionales = adicionales.reduce((s, a) => s + n(a.valor_liquidar), 0);
	const totalAdicionalesBruto = adicionales.reduce(
		(s, a) => s + n(a.valor_unitario) * (n(a.cantidad) || 1),
		0
	);
	const totalesItems = {
		cantidad:
			vivos.reduce((s, it) => s + (n(it.cantidad) || 1), 0) +
			adicionales.reduce((s, a) => s + (n(a.cantidad) || 1), 0),
		admon: enRojo(
			vivos.reduce((s, it) => s + n(it.valor_admin), 0) +
				adicionales.reduce((s, a) => s + n(a.valor_admin), 0)
		),
		total:
			vivos.reduce((s, it) => s + n(it.total_facturado), 0) + totalAdicionalesBruto,
		valor_liquidar:
			vivos.reduce((s, it) => s + n(it.valor_liquidar), 0) + totalAdicionales,
		ing_extra_global: totalConSigno(
			vivos.reduce((s, it) => s + n(it.ingreso_extra_global), 0) - totalAdicionales
		),
		ing_extras_aval: vivos.reduce((s, it) => s + n(it.ingresos_extra_aval), 0),
		ingreso_empresa: totalConSigno(
			vivos.reduce(
				(s, it) => s + n(it.ingreso_extra_global) - n(it.ingresos_extra_aval),
				0
			) - totalAdicionales
		)
	};

	// ── 2..5. Descuentos ──
	const conductores = bloquesConductores(conceptos, propietarios);
	const gastos = bloqueGastos(conceptos, propietarios);
	const anticipos = bloqueAnticipos(conceptos);

	const impuestos = conceptos
		.filter((c) => c.tipo === 'IMPUESTO')
		.sort(
			(a, b) => (ORDEN_IMPUESTOS[a.concepto] ?? 999) - (ORDEN_IMPUESTOS[b.concepto] ?? 999)
		);
	const impuestosBloque = bloqueImpuestos(impuestos);

	const totalCostosLaborales = conceptos
		.filter((c) => c.tipo === 'COSTO_LABORAL')
		.reduce((s, c) => s + n(c.valor_total), 0);

	// Mismo encadenado que la hoja: TOTAL DESCUENTOS es la suma de los
	// totalizadores de las cuatro secciones, y TOTAL A PAGAR se apoya en él.
	const totalServicio = Number(totalesItems.valor_liquidar);
	const totalDescuentos =
		totalCostosLaborales + gastos.total + impuestosBloque.total + anticipos.total;
	const totalPagar = totalServicio - totalDescuentos;

	// ── Copropietarios ──
	const esMulti = !!hoja.es_multi_propietario && copropietarios.length > 0;
	// Lo que se reparte es el bruto menos los descuentos GLOBALES (nómina,
	// gastos y anticipos): las retenciones ya van por copropietario.
	const descuentosGlobales = totalCostosLaborales + gastos.total + anticipos.total;
	const sumaPct = copropietarios.reduce((s, p) => s + n(p.porcentaje), 0);

	const secciones: DocumentoPreview['secciones'] = [
		{
			id: 'items',
			titulo: 'Liquidación de transporte',
			nota: `${vivos.length} item(s)${
				items.length !== vivos.length ? `  ·  ${items.length - vivos.length} excluido(s)` : ''
			}${adicionales.length ? `  ·  ${adicionales.length} adicional(es)` : ''}`,
			columnas: COLS_ITEMS,
			filas: filasItems,
			vacio: 'Esta hoja no tiene items.',
			totalesLabel: 'Totales',
			totales: totalesItems
		},
		{
			id: 'descuentos',
			titulo: 'Descuentos por la prestación del servicio',
			nota: conductores.length
				? `${conductores.length} conductor(es)  ·  ${COP(totalCostosLaborales)}`
				: 'Sin conceptos de nómina',
			columnas: [],
			filas: [],
			bloques: conductores,
			bloquesPorFila: 3
		},
		{
			id: 'otros-descuentos',
			titulo: 'Gastos, anticipos e impuestos',
			columnas: [],
			filas: [],
			// En multi-propietario los impuestos NO van en bloque global: se
			// prorratean por copropietario, que es la regla de la hoja y la
			// del editor. Meterlos aquí los contaría dos veces a la vista.
			bloques: esMulti
				? [gastos.bloque, anticipos.bloque]
				: [gastos.bloque, anticipos.bloque, impuestosBloque.bloque],
			bloquesPorFila: 3
		}
	];

	if (esMulti) {
		secciones.push({
			id: 'copropietarios',
			titulo: 'Reparto por copropietarios',
			// La suma se muestra tal cual, con aviso: normalizarla al 100%
			// cambiaría lo que se le paga a cada uno.
			nota:
				Math.abs(sumaPct - 100) > 0.01
					? `Participaciones: ${sumaPct.toFixed(2)}% (distinta de 100%)`
					: `Participaciones: ${sumaPct.toFixed(2)}%`,
			columnas: [],
			filas: [],
			bloques: bloquesCopropietarios(
				copropietarios,
				impuestos,
				totalServicio,
				descuentosGlobales
			),
			bloquesPorFila: 2
		});
	}

	const resumen: LineaResumen[] = [
		{ label: 'Valor del servicio', valor: totalServicio },
		{ label: 'Total descuentos', valor: totalDescuentos, descuento: true },
		{ label: 'Total a pagar', valor: totalPagar, fuerte: true }
	];

	const nombre = `${hoja.consecutivo || hoja.id}_${fmtPlaca(hoja.placa)}`;

	return {
		titulo: TITULO_SCOPE.cierres,
		meta: [
			{ label: 'Código', valor: 'GAF-FR-11' },
			{ label: 'Versión', valor: '2' },
			{ label: 'Periodo', valor: `${String(o.mes).padStart(2, '0')}/${o.anio}` }
		],
		periodo: [
			{ label: 'Mes', valor: nombreMes(o.mes) },
			{ label: 'Año', valor: String(o.anio) },
			{ label: 'Placa', valor: fmtPlaca(hoja.placa) },
			{ label: 'Consecutivo', valor: hoja.consecutivo || '—' },
			{ label: 'Estado', valor: hoja.estado || '' },
			{ label: 'Tercero', valor: hoja.tercero_nombre || '—' }
		],
		secciones,
		resumen,
		nombreArchivo: `liquidacion_${nombre.replace(/[^a-z0-9_\-]/gi, '_')}`
	};
}
