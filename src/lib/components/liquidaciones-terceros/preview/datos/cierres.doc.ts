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
import { repartirValor } from '$lib/editor/business/reparto-propietarios';
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

// ─── Reparto por copropietario ────────────────────────────────────────

/** Lo que le corresponde a UN copropietario de este cierre. */
export interface PropietarioReparto {
	id: string;
	/** Ficha en el catálogo `terceros`, si la tiene. */
	tercero_id: string | null;
	nombre: string;
	identificacion: string | null;
	/** Correo de esa ficha: a quién se le manda SU liquidación. */
	correo: string | null;
	/** Concepto de pago, ej. "ABONAR A CRÉDITO BANCOOMEVA". */
	nota: string | null;
	porcentaje: number;
	porcentaje_efectivo: number;
	/** `false` = pago interno por concepto: no tributa ni genera egreso. */
	aplica_retenciones: boolean;
	/** Su parte del valor servicio, por el porcentaje efectivo. */
	facturar: number;
	/** Suma de SUS retenciones. 0 en los pagos internos. */
	retenciones: number;
	/** `facturar − retenciones`. NO se recorta a cero: si es negativo, se ve. */
	neto: number;
}

export interface RepartoCierre {
	esMulti: boolean;
	/** Bruto de la hoja (items + adicionales, sin los excluidos). */
	totalServicio: number;
	/** Nómina + gastos + anticipos: se descuentan ANTES de repartir. */
	descuentosGlobales: number;
	/** `totalServicio − descuentosGlobales`. Lo que se reparte. */
	valorServicio: number;
	propietarios: PropietarioReparto[];
}

/**
 * El reparto, a partir de lo ya totalizado.
 *
 * Los descuentos generales se totalizan ANTES de repartir; lo que queda es
 * el VALOR SERVICIO, y ese se divide por el porcentaje EFECTIVO de la
 * cascada (ver `$lib/editor/business/reparto-propietarios.ts`, cuadre al
 * peso). Las retenciones son de cada propietario —las calcula y persiste el
 * servidor sobre SU valor a facturar— y solo aplican a quienes tributan.
 */
function repartoCore(
	copropietarios: CopropietarioCierre[],
	impuestos: ConceptoDescuento[],
	totalServicio: number,
	descuentosGlobales: number
): RepartoCierre {
	const ordenados = [...copropietarios].sort((a, b) => a.orden - b.orden);
	const valorServicio = totalServicio - descuentosGlobales;
	const facturarMap = repartirValor(
		valorServicio,
		ordenados.map((p) => ({ id: p.id, efectivo: n(p.porcentaje_efectivo), orden: p.orden }))
	);

	return {
		esMulti: ordenados.length > 0,
		totalServicio,
		descuentosGlobales,
		valorServicio,
		propietarios: ordenados.map((p): PropietarioReparto => {
			const facturar = facturarMap.get(p.id) ?? 0;
			// Un pago interno no tributa: aunque el servidor le hubiera dejado
			// una fila de impuesto colgada, aquí no cuenta.
			const retenciones = p.aplica_retenciones
				? impuestos
						.filter((i) => (i as any).propietario_id === p.id)
						.reduce((s, i) => s + n(i.valor_total), 0)
				: 0;
			return {
				id: p.id,
				tercero_id: p.tercero_id ?? null,
				nombre: p.nombre,
				identificacion: p.identificacion,
				correo: p.correo ?? null,
				nota: p.nota,
				porcentaje: n(p.porcentaje),
				porcentaje_efectivo: n(p.porcentaje_efectivo),
				aplica_retenciones: p.aplica_retenciones,
				facturar,
				retenciones,
				neto: facturar - retenciones
			};
		})
	};
}

/**
 * El reparto de un cierre, para quien tiene el cierre y no el documento.
 *
 * Lo usa el modal de envíos: el correo de cada copropietario lleva SU valor
 * a facturar, y esa cifra tiene que ser exactamente la del PDF que va
 * adjunto. Por eso no lo recalcula por su cuenta —sería una tercera
 * aritmética— sino que pasa por las MISMAS funciones que arma el documento.
 */
export function repartoDeCierre(cierre: CierreFinalCompleto): RepartoCierre {
	const { hoja, items, adicionales, copropietarios, propietarios } = cierre;
	if (!hoja.es_multi_propietario || copropietarios.length === 0) {
		return {
			esMulti: false,
			totalServicio: 0,
			descuentosGlobales: 0,
			valorServicio: 0,
			propietarios: []
		};
	}
	// Copia por el mismo motivo que en `documentoCierre`: `getConductorGrupos`
	// REESCRIBE los conceptos que recibe.
	const conceptos = cierre.conceptos.map((c) => ({ ...c }));
	const bases = basesDelReparto(conceptos, items, adicionales, propietarios);
	return repartoCore(
		copropietarios,
		bases.impuestos,
		bases.totalServicio,
		bases.descuentosGlobales
	);
}

/**
 * Las dos cifras de las que cuelga el reparto, y los impuestos ya ordenados.
 *
 * Vive aparte porque la calculan DOS caminos —el documento y el modal de
 * envíos— y con dos copias acabarían discrepando en el peso, que es
 * justamente lo que el destinatario compara entre el correo y el PDF.
 *
 * ⚠️ MUTA `conceptos`: `getConductorGrupos` recalcula ahí las bases de
 * prestaciones y seguridad social. Pásale siempre una copia.
 */
function basesDelReparto(
	conceptos: ConceptoDescuento[],
	items: ItemCierre[],
	adicionales: AdicionalCierre[],
	propietarios: Record<string, boolean>
): { totalServicio: number; descuentosGlobales: number; impuestos: ConceptoDescuento[] } {
	// Normaliza los conceptos de nómina, igual que hace el documento al
	// pintar sus bloques de conductor.
	bloquesConductores(conceptos, propietarios);
	const gastos = bloqueGastos(conceptos, propietarios);
	const anticipos = bloqueAnticipos(conceptos);
	const totalCostosLaborales = conceptos
		.filter((c) => c.tipo === 'COSTO_LABORAL')
		.reduce((s, c) => s + n(c.valor_total), 0);

	// Los EXCLUIDOS no suman, igual que en la tabla de items.
	const totalServicio =
		items.filter((it) => !it.excluido).reduce((s, it) => s + n(it.valor_liquidar), 0) +
		adicionales.reduce((s, a) => s + n(a.valor_liquidar), 0);

	return {
		totalServicio,
		descuentosGlobales: totalCostosLaborales + gastos.total + anticipos.total,
		impuestos: conceptos
			.filter((c) => c.tipo === 'IMPUESTO')
			.sort(
				(a, b) => (ORDEN_IMPUESTOS[a.concepto] ?? 999) - (ORDEN_IMPUESTOS[b.concepto] ?? 999)
			)
	};
}

/**
 * Bloques de la sección «Retenciones y neto a pagar por copropietario».
 *
 * Aritmética: los descuentos generales (nómina + gastos + anticipos) se
 * totalizan ANTES de repartir; lo que queda es el VALOR SERVICIO, y ese se
 * divide como valor a facturar por el porcentaje EFECTIVO de la cascada
 * (ver `$lib/editor/business/reparto-propietarios.ts`, cuadre al peso). Las
 * retenciones son de cada propietario —las calcula y persiste el servidor
 * sobre SU valor a facturar— y solo aplican a quienes tributan.
 *
 * Devuelve DOS grupos, y no una lista sola, porque son dos cosas
 * distintas y antes se leían como una:
 *
 *  `reparto` — el resumen (total descuentos + valor servicio) y una card
 *    por propietario CON retenciones (facturar, retenciones concepto a
 *    concepto, neto). Esto es dinero que SALE hacia una persona.
 *
 *  `conceptos` — los pagos internos por concepto (propietarios sin
 *    retenciones): un abono a crédito no se le paga a nadie, se destina a
 *    un concepto. Van en su propia sección, con su propio color, porque
 *    mezclados entre las cards parecían un propietario más que cobra.
 *
 * El «Valor a pagar» NO se recorta a cero: si sale negativo, se enseña.
 */
function bloquesCopropietarios(
	reparto: RepartoCierre,
	impuestos: ConceptoDescuento[]
): { reparto: BloquePreview[]; conceptos: BloquePreview[] } {
	const ordenados = reparto.propietarios;
	const { valorServicio, descuentosGlobales } = reparto;

	const resumen: BloquePreview = {
		id: 'copro-resumen',
		ancho: 'completo',
		variante: 'copropietario',
		columnas: COLS_COPROPIETARIO,
		filas: [
			{
				celdas: {
					concepto: 'Total descuentos',
					porcentaje: '',
					valor: restado(descuentosGlobales)
				}
			},
			{
				destacada: true,
				celdas: {
					concepto: 'Valor servicio (listo para repartir)',
					porcentaje: '',
					valor: valorServicio
				}
			}
		]
	};

	const cards = ordenados
		.filter((p) => p.aplica_retenciones)
		.map((p): BloquePreview => {
			const facturar = p.facturar;
			const suyos = impuestos
				.filter((i) => (i as any).propietario_id === p.id)
				.sort(
					(a, b) =>
						(ORDEN_IMPUESTOS[a.concepto] ?? 999) - (ORDEN_IMPUESTOS[b.concepto] ?? 999)
				);
			const totalRet = p.retenciones;

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
			if (totalRet !== 0) {
				filas.push({
					variante: 'categoria',
					celdas: {
						concepto: '(−) Total retenciones',
						porcentaje: '',
						valor: restado(totalRet)
					}
				});
			}

			const subtitulo = [
				p.identificacion ? `CC/NIT ${p.identificacion}` : null,
				p.nota || null
			]
				.filter(Boolean)
				.join('  ·  ');

			return {
				id: `copro-${p.id}`,
				titulo: p.nombre || '—',
				subtitulo: subtitulo || undefined,
				etiqueta: fmtPct(n(p.porcentaje)),
				variante: 'copropietario',
				columnas: COLS_COPROPIETARIO,
				filas,
				pie: { label: '(=) Valor a pagar', valor: p.neto },
				vacio: 'Sin retenciones para este copropietario.'
			};
		});

	// Los pagos internos en UNA tabla, no un bloque suelto por cada uno: con
	// dos abonos eran dos cards sin filas, mezcladas entre los propietarios
	// que sí cobran. Aquí se enumeran.
	//
	// Sin totalizar, a propósito: cada concepto es un destino independiente
	// —un crédito, un fondo— y sumarlos da una cifra que no se paga a nadie
	// ni se concilia contra nada. Lo que se consulta es cuánto va a CADA
	// concepto, no cuánto va «a conceptos».
	const sinRetenciones = ordenados.filter((p) => !p.aplica_retenciones);

	const conceptos: BloquePreview[] = sinRetenciones.length
		? [
				{
					id: 'copro-conceptos',
					ancho: 'completo',
					titulo: 'Destinado a concepto',
					subtitulo: 'Pago interno — no genera egreso real ni tributa',
					variante: 'concepto',
					columnas: COLS_COPROPIETARIO,
					// El CONCEPTO manda en la fila y el titular cuelga debajo como
					// hija: lo que se consulta aquí es a qué se destina el dinero,
					// no quién figura como propietario.
					filas: sinRetenciones.flatMap((p): FilaPreview[] => {
						const titular = [
							p.nombre,
							p.identificacion ? `CC/NIT ${p.identificacion}` : null
						]
							.filter(Boolean)
							.join('  ·  ');
						return [
							{
								destacada: true,
								celdas: {
									concepto: (p.nota || p.nombre).toUpperCase(),
									porcentaje: fmtPct(n(p.porcentaje)),
									valor: p.facturar
								}
							},
							{
								variante: 'hija',
								celdas: { concepto: titular, porcentaje: '', valor: '' }
							}
						];
					})
				}
			]
		: [];

	return { reparto: [resumen, ...cards], conceptos };
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
		// La rejilla se ajusta a los propietarios que tributan (los pagos
		// internos por concepto van a lo ancho, fuera de la cuenta): con dos
		// cards, dos columnas; tope tres.
		const conRetenciones = copropietarios.filter((p) => p.aplica_retenciones).length;
		const pagosInternos = copropietarios.length - conRetenciones;
		const porFila = Math.min(3, Math.max(1, conRetenciones)) as 1 | 2 | 3;
		// El MISMO cálculo que consulta el modal de envíos para decirle a cada
		// copropietario cuánto se le factura: una sola aritmética, o el correo
		// y el PDF adjunto acabarían diciendo cifras distintas.
		const { reparto, conceptos } = bloquesCopropietarios(
			repartoCore(copropietarios, impuestos, totalServicio, descuentosGlobales),
			impuestos
		);
		secciones.push({
			id: 'copropietarios',
			titulo: 'Retenciones y neto a pagar por copropietario',
			// La suma se muestra tal cual, con aviso: normalizarla al 100%
			// cambiaría lo que se le paga a cada uno. El reparto real es la
			// cascada por orden (el primero toma su % del total y los demás
			// reparten el remanente).
			nota:
				Math.abs(sumaPct - 100) > 0.01
					? `Participaciones: ${sumaPct.toFixed(2)}% (cálculo en cascada por orden)`
					: `Participaciones: ${sumaPct.toFixed(2)}%`,
			columnas: [],
			filas: [],
			bloques: reparto,
			bloquesPorFila: porFila
		});
		// Sección aparte, y no un bloque más de la anterior: lo que va a un
		// concepto no se le paga a nadie, y sumado con los netos daría una
		// cifra que no existe.
		if (conceptos.length) {
			secciones.push({
				id: 'conceptos-internos',
				titulo: 'Destinado a concepto',
				nota: `${pagosInternos} pago(s) interno(s)`,
				columnas: [],
				filas: [],
				bloques: conceptos,
				bloquesPorFila: 1
			});
		}
	}

	// En MULTI-PROPIETARIO no se pinta resumen final.
	//
	// La hoja no tiene un «total a pagar»: el bruto se reparte en cascada y
	// cada copropietario tiene el suyo —con sus propias retenciones— en su
	// card, y lo que va a conceptos ni siquiera se paga. Un TOTAL A PAGAR
	// único al pie se leía como el cheque de la placa cuando en realidad era
	// la suma de pagos a personas distintas más un abono interno; además
	// repetía, con otra cifra, el «Total descuentos» que ya sale arriba en el
	// resumen del reparto (ese excluye las retenciones, que van por
	// propietario). El documento cierra en el reparto.
	const resumen: LineaResumen[] | undefined = esMulti
		? undefined
		: [
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
		// Sellado en cuanto deja de ser BORRADOR, igual que el PDF del correo.
		// ANULADA entra en el criterio porque así lo hacen los otros dos, y una
		// anulada sellada sigue siendo un documento que existió: lo que dice que
		// no vale es su estado, impreso en la banda de periodo.
		sello: !!hoja.estado && hoja.estado !== 'BORRADOR',
		nombreArchivo: `liquidacion_${nombre.replace(/[^a-z0-9_\-]/gi, '_')}`
	};
}
