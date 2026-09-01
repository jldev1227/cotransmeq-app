/**
 * Documentos del canvas de INGRESOS DE COTRANSMEQ: UNO POR HOJA.
 *
 * `documentoIngresos({ hoja })` emite el papel de UNA de las dos hojas del
 * mes. Antes emitía uno solo con las dos dentro, y estaba mal: un preview es
 * de una hoja: se imprime, se archiva y se entrega por separado, y metiendo
 * las dos en el mismo PDF no había forma de mandar solo la de adicionales.
 * El «salto de página» que las separaba era la pista de que ya eran dos
 * documentos con un lienzo común.
 *
 * LAS DOS COMPARTEN LAYOUT: mismo encabezado, mismas bandas, mismas tarjetas
 * de pie y la misma cadena de totales a la derecha. Lo que cambia es lo que
 * cada una DICE que es —el nombre del documento, lo que resume su banda de
 * periodo, los porcentajes que la gobiernan y el nombre del fichero—, que es
 * justo lo que las distingue.
 *
 * SIGUEN ENCADENADAS. La de adicionales liquida hasta un TRANSPORTE POR
 * PAGAR y la de ingresos lo resta; eso no se puede romper porque se impriman
 * aparte, así que el papel de ingresos nombra esa línea como lo que es —lo
 * que se paga por la liquidación de adicionales DEL MISMO MES— y el de
 * adicionales cierra en el número que la otra recoge.
 *
 * Los números salen de `calcularTotales`, la misma función que alimenta las
 * fórmulas de la hoja. No se recalcula nada aquí: una segunda aritmética
 * acabaría contradiciendo al canvas, que es el fallo que este módulo
 * arrastró en los otros previews. Y se calculan SIEMPRE las dos hojas
 * aunque se imprima una: la de ingresos necesita el total de la otra.
 *
 * ── EL PAPEL CONSOLIDA POR EMPRESA ──────────────────────────────────────
 * El canvas lleva una fila por SERVICIO porque ahí hay que decidir cuáles
 * bajan a adicionales, servicio a servicio. El papel no decide nada: se
 * entrega y se lee, y para eso una empresa con cuarenta servicios son
 * cuarenta líneas de las que solo importa la suma. Así que aquí se agrupa
 * por cliente (ver `agruparPorEmpresa`), como hacía el Excel.
 *
 * ── EL PIE VA EN TARJETAS, COMO EN CIERRES ──────────────────────────────
 * Gastos, anticipos e impuestos se pintan con la misma estructura de
 * bloques que el documento del canvas de cierres: una tarjeta por bloque,
 * con sus columnas propias y su total. Antes eran tres líneas sueltas del
 * resumen clave/valor, así que el papel decía cuánto se descontaba pero no
 * POR QUÉ — y las retenciones, que son cuatro con sus porcentajes y sus
 * bases, se leían como un solo número.
 */

import type {
	ConceptoIngreso,
	FilaIngresoEstado,
	HojaIngreso,
	IngresoTerceroRow
} from '$lib/api/liquidaciones-terceros-ingresos';
import {
	alcanceIngresos,
	calcularTotales,
	conceptosParaGuardar,
	indexarFilas,
	type FilaCalculada,
	type ImpuestoCalculado,
	type PorcentajesIngresos
} from '$lib/editor/business/ingresos-transmeralda';
// El título del documento ya NO sale de `TITULO_SCOPE`: cada hoja lleva el
// suyo (ver `HOJAS_INGRESOS`), que es lo que las distingue en el papel.
import { COP, enRojo, fmtPct, nombreMes } from '../formato';
import type {
	BloquePreview,
	ColumnaPreview,
	DocumentoPreview,
	FilaPreview,
	LineaResumen,
	SeccionPreview
} from '../tipos';

/** La columna INCLUIR solo existe en la hoja de ingresos. */
const COLS_INGRESOS = [
	'n',
	'empresa',
	'descripcion',
	'fechas',
	'servicios',
	'v_unidad',
	'cantidad',
	'admon',
	'total',
	'valor_liquidar',
	'incluir'
];
const COLS_ADICIONALES = COLS_INGRESOS.filter((k) => k !== 'incluir');

/**
 * Identidad de cada hoja: lo único que separa a los dos documentos.
 *
 * Está aquí junta y no repartida por el fichero para que se lea de un
 * vistazo en qué se diferencian —y para que añadir una tercera hoja sea
 * añadir una entrada, no perseguir condicionales.
 */
export const HOJAS_INGRESOS = {
	INGRESOS: {
		/// Nombre del documento, el del Excel del que sale.
		titulo: 'OTROS INGRESOS DE COTRANSMEQ',
		/// Etiqueta CORTA para la banda de periodo, que son fichas de un dato
		/// en monoespaciada: una frase ahí se lee como un error de maqueta.
		chip: 'OTROS INGRESOS',
		/// Qué representa la hoja, en prosa. Va en la nota de la sección, que
		/// es donde este documento pone el texto pequeño.
		resume: 'Lo que los servicios facturados de terceros dejaron a la empresa',
		archivo: 'otros_ingresos'
	},
	ADICIONALES: {
		titulo: 'LIQUIDACION DE ADICIONALES',
		chip: 'ADICIONALES',
		resume: 'Los servicios marcados con INCLUIR, liquidados aparte',
		archivo: 'adicionales'
	}
} as const satisfies Record<
	HojaIngreso,
	{ titulo: string; chip: string; resume: string; archivo: string }
>;

const legible = (concepto: string) => (concepto || '').replace(/_/g, ' ');

// ─── Consolidación por empresa ────────────────────────────────────────

/**
 * Una empresa del documento: sus servicios ya sumados.
 *
 * `descripcion` y `fechas` son las del PRIMER servicio del grupo, no una
 * concatenación de las cuarenta: el papel quiere una referencia de qué es
 * esa línea, no el detalle —que es justo lo que se acaba de consolidar—.
 */
interface GrupoEmpresa {
	empresa: string;
	descripcion: string;
	fechas: string;
	servicios: number;
	incluidos: number;
	vUnidad: number;
	cantidad: number;
	admon: number;
	total: number;
	vLiquidar: number;
}

/**
 * Agrupa las filas calculadas por CLIENTE.
 *
 * La clave es el `cliente_id` y no el nombre: dos registros del mismo
 * cliente pueden traer la razón social escrita distinta («FEPCO SERVICIOS
 * S.A.S» / «FEPCO SERVICIOS SAS») y saldrían como dos empresas. El nombre
 * que se imprime es el del primer servicio del grupo.
 *
 * El orden es ALFABÉTICO por empresa. El del canvas es por placa, y al
 * consolidar la placa desaparece: mantenerlo dejaría las empresas en un
 * orden que ya nada explica.
 */
function agruparPorEmpresa(filas: FilaCalculada[]): GrupoEmpresa[] {
	const grupos = new Map<string, GrupoEmpresa>();

	for (const f of filas) {
		const clave = f.item.cliente_id || f.item.cliente_nombre || '—';
		let g = grupos.get(clave);
		if (!g) {
			g = {
				empresa: f.item.cliente_nombre || '—',
				descripcion: f.item.recorrido || '',
				fechas: f.item.fechas || '',
				servicios: 0,
				incluidos: 0,
				vUnidad: 0,
				cantidad: 0,
				admon: 0,
				total: 0,
				vLiquidar: 0
			};
			grupos.set(clave, g);
		}
		g.servicios += 1;
		if (f.incluida) g.incluidos += 1;
		g.vUnidad += f.vUnidad;
		g.cantidad += f.cantidad;
		g.admon += f.admon;
		g.total += f.total;
		g.vLiquidar += f.vLiquidar;
	}

	return [...grupos.values()].sort((a, b) =>
		a.empresa.localeCompare(b.empresa, 'es', { sensitivity: 'base' })
	);
}

/**
 * Celda INCLUIR de una fila consolidada.
 *
 * Un grupo puede tener unos servicios marcados y otros no, así que el SÍ/NO
 * de la columna deja de valer: se dice cuántos de cuántos. `SÍ` y `NO` se
 * reservan para cuando el grupo entero va en un sentido, que es lo que se
 * lee de un vistazo.
 */
function celdaIncluir(g: GrupoEmpresa) {
	if (g.incluidos === 0) return { texto: 'NO' };
	if (g.incluidos === g.servicios) return { texto: 'SÍ' };
	return { texto: `${g.incluidos}/${g.servicios}` };
}

function filaDeGrupo(g: GrupoEmpresa, i: number, conIncluir: boolean): FilaPreview {
	return {
		celdas: {
			n: i + 1,
			empresa: g.empresa,
			descripcion: g.descripcion,
			fechas: g.fechas,
			servicios: g.servicios,
			v_unidad: g.vUnidad,
			cantidad: g.cantidad,
			admon: enRojo(g.admon),
			total: g.total,
			valor_liquidar: g.vLiquidar,
			incluir: conIncluir ? celdaIncluir(g) : undefined
		}
	};
}

function totalesDeGrupos(grupos: GrupoEmpresa[]) {
	const sumar = (f: (g: GrupoEmpresa) => number) => grupos.reduce((s, g) => s + f(g), 0);
	return {
		servicios: sumar((g) => g.servicios),
		v_unidad: sumar((g) => g.vUnidad),
		cantidad: sumar((g) => g.cantidad),
		admon: enRojo(sumar((g) => g.admon)),
		total: sumar((g) => g.total),
		valor_liquidar: sumar((g) => g.vLiquidar)
	};
}

// ─── Bloques del pie ──────────────────────────────────────────────────
// Mismas columnas y mismas variantes de color que las tarjetas del
// documento de cierres. Aquí los conceptos no llevan días ni cantidad —el
// pie de estas hojas es etiqueta + importe—, así que los bloques de gastos
// y anticipos van a dos columnas en vez de cuatro.

const COLS_CONCEPTO: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 62 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 38 }
];

const COLS_PERSONAL: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 46 },
	{ key: 'persona', label: 'Persona', tipo: 'texto', peso: 24 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 30 }
];

/// Sin columna BASE: ver `bloqueRetenciones`. Los pesos de las tres que
/// quedan se reparten los 24 que ocupaba.
const COLS_IMPUESTOS: ColumnaPreview[] = [
	{ key: 'concepto', label: 'Concepto', tipo: 'texto', peso: 50 },
	{ key: 'porcentaje', label: '%', tipo: 'texto', peso: 16 },
	{ key: 'valor', label: 'Valor', tipo: 'moneda', peso: 34 }
];

const n = (v: unknown): number => {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
};

function conceptosDe(
	conceptos: ConceptoIngreso[],
	hoja: HojaIngreso,
	tipo: ConceptoIngreso['tipo']
): ConceptoIngreso[] {
	return conceptos
		.filter((c) => c.hoja === hoja && c.tipo === tipo)
		.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

function bloqueConceptos(o: {
	id: string;
	titulo: string;
	variante: BloquePreview['variante'];
	conceptos: ConceptoIngreso[];
	etiquetaPie: string;
	total: number;
	vacio: string;
	conPersona?: boolean;
}): BloquePreview {
	return {
		id: o.id,
		titulo: o.titulo,
		variante: o.variante,
		columnas: o.conPersona ? COLS_PERSONAL : COLS_CONCEPTO,
		filas: o.conceptos.map((c) => ({
			celdas: {
				concepto: legible(c.concepto),
				persona: c.persona || '—',
				valor: n(c.valor_total)
			}
		})),
		pie: { label: o.etiquetaPie, valor: o.total },
		vacio: o.vacio
	};
}

/**
 * Tarjeta de las retenciones de ADICIONALES.
 *
 * El desglose lo da `calcularTotales` —es el mismo que suma para su
 * `impuestos`—, así que la tarjeta y el total del documento no pueden
 * discrepar.
 *
 * SIN COLUMNA DE BASE IMPONIBLE. La llevó, para explicar que las dos últimas
 * retenciones cuelgan de la de ICA y no de la base; el documento se entrega
 * fuera y ese detalle de cálculo no es lo que se va a leer en él. `base`
 * sigue viniendo en el desglose y gobernando los valores, solo no se imprime.
 */
function bloqueRetenciones(retenciones: ImpuestoCalculado[]): BloquePreview {
	const total = retenciones.reduce((s, i) => s + i.valor, 0);
	return {
		id: 'retenciones',
		titulo: 'Impuestos y retenciones',
		variante: 'impuestos',
		columnas: COLS_IMPUESTOS,
		filas: retenciones.map((i) => ({
			celdas: {
				concepto: legible(i.concepto),
				porcentaje: fmtPct(i.porcentaje),
				valor: i.valor
			}
		})),
		pie: { label: 'Total retenciones', valor: total },
		vacio: 'Sin retenciones.'
	};
}

/**
 * Sección de tarjetas del pie de UNA hoja.
 *
 * `null` cuando esa hoja no tiene nada que enseñar: un mes sin gastos, sin
 * anticipos y sin personal no gana nada con tres tarjetas vacías. Las
 * retenciones sí se pintan siempre en adicionales — son parte de la
 * liquidación aunque salgan a cero.
 */
function seccionDescuentos(o: {
	hoja: HojaIngreso;
	conceptos: ConceptoIngreso[];
	totales: { personal: number; gastos: number; anticipos: number };
	retenciones?: ImpuestoCalculado[];
}): SeccionPreview | null {
	const personal = conceptosDe(o.conceptos, o.hoja, 'COSTO_LABORAL');
	const gastos = conceptosDe(o.conceptos, o.hoja, 'GASTO_OPERATIVO');
	const anticipos = conceptosDe(o.conceptos, o.hoja, 'ANTICIPO');

	const bloques: BloquePreview[] = [];
	if (personal.length) {
		bloques.push(
			bloqueConceptos({
				id: `${o.hoja}-personal`,
				titulo: 'Personal para la ejecución',
				variante: 'neutro',
				conceptos: personal,
				conPersona: true,
				etiquetaPie: 'Total personal',
				total: o.totales.personal,
				vacio: 'Sin conceptos de nómina.'
			})
		);
	}
	bloques.push(
		bloqueConceptos({
			id: `${o.hoja}-gastos`,
			titulo: 'Gastos del vehículo',
			variante: 'gastos',
			conceptos: gastos,
			etiquetaPie: 'Total gastos del vehículo',
			total: o.totales.gastos,
			vacio: 'Sin gastos registrados.'
		}),
		bloqueConceptos({
			id: `${o.hoja}-anticipos`,
			titulo: 'Anticipos',
			variante: 'anticipos',
			conceptos: anticipos,
			etiquetaPie: 'Total anticipos',
			total: o.totales.anticipos,
			vacio: 'Sin anticipos registrados.'
		})
	);
	if (o.retenciones) bloques.push(bloqueRetenciones(o.retenciones));

	// Todo vacío y sin retenciones que enseñar: no se pinta la sección.
	const hayAlgo =
		o.retenciones != null || personal.length > 0 || gastos.length > 0 || anticipos.length > 0;
	if (!hayAlgo) return null;

	return {
		id: `${o.hoja}-descuentos`,
		titulo: 'Gastos, anticipos e impuestos',
		columnas: [],
		filas: [],
		bloques,
		bloquesPorFila: 3
	};
}

// ─── Documento ────────────────────────────────────────────────────────

export function documentoIngresos(o: {
	/** Cuál de las dos hojas del mes se imprime. */
	hoja: HojaIngreso;
	items: IngresoTerceroRow[];
	filas: FilaIngresoEstado[];
	conceptos: ConceptoIngreso[];
	pct: PorcentajesIngresos;
	mes: number;
	anio: number;
}): DocumentoPreview {
	// Se calculan SIEMPRE las dos hojas aunque se imprima una: el TRANSPORTE
	// POR PAGAR de adicionales es una línea del pie de ingresos.
	const t = calcularTotales({
		items: o.items,
		porItem: indexarFilas(o.filas),
		conceptos: o.conceptos,
		pct: o.pct
	});

	const esIngresos = o.hoja === 'INGRESOS';
	const identidad = HOJAS_INGRESOS[o.hoja];
	const periodoCorto = `${String(o.mes).padStart(2, '0')}/${o.anio}`;

	// Las tarjetas del pie llevan lo que DICE algo. El pie de la hoja abre
	// filas libres para poder nombrar un gasto cualquiera, y las que nadie
	// tocó son las mismas que no se guardan: en el papel serían «GASTO 3 · $0».
	// No afecta a ningún total —valen cero— ni a las retenciones, que se
	// calculan aparte y conservan su porcentaje.
	const conceptosVisibles = conceptosParaGuardar(o.conceptos, alcanceIngresos(o.anio, o.mes));

	// Las filas de adicionales ya vienen con SU V/UNIDAD —el % de ganancia
	// sobre el ingreso, o el valor escrito a mano—: lo resuelve
	// `calcularFilasAdicionalesTodas`, no hay que volver a aplicarlo aquí.
	const calculadas = esIngresos ? t.filasIngresos : t.filasAdicionales;
	const grupos = agruparPorEmpresa(calculadas);

	/**
	 * Cadena de totales de la hoja, en el orden en que se lee en el papel:
	 * valor del servicio, lo que se le descuenta y lo que queda.
	 *
	 * El DETALLE de esos descuentos va en las tarjetas de
	 * `seccionDescuentos`; aquí solo sus totales, para poder seguir la
	 * cadena de un número al siguiente sin volver a la tabla.
	 */
	const cadena: LineaResumen[] = esIngresos
		? [
				{ label: 'Valor del servicio', valor: t.ingresos.valorServicio },
				{
					// Se nombra la hoja de la que sale: es el único número de este
					// papel que no se puede comprobar dentro de este papel.
					label: `Liquidación de adicionales ${periodoCorto}`,
					valor: t.adicionales.transportePorPagar,
					descuento: true
				},
				{ label: 'Valor a facturar', valor: t.ingresos.valorAFacturar },
				{ label: 'Personal para la ejecución', valor: t.ingresos.personal, descuento: true },
				{ label: 'Gastos del vehículo', valor: t.ingresos.gastos, descuento: true },
				{ label: 'Anticipos', valor: t.ingresos.anticipos, descuento: true },
				{ label: 'Transporte por pagar', valor: t.ingresos.transportePorPagar },
				// Los gastos diversos van DESPUÉS del transporte por pagar y no con
				// el resto de descuentos: es el último recorte, y así lo encadena
				// `calcularTotales` (`totalIngresoTransmeralda = porPagar − diversos`).
				{ label: 'Gastos diversos', valor: t.ingresos.gastosDiversos, descuento: true },
				{
					label: 'Total ingreso Cotransmeq',
					valor: t.ingresos.totalIngresoTransmeralda,
					fuerte: true
				}
			]
		: [
				{ label: 'Valor del servicio', valor: t.adicionales.valorServicio },
				{ label: 'Personal para la ejecución', valor: t.adicionales.personal, descuento: true },
				{ label: 'Gastos del vehículo', valor: t.adicionales.gastos, descuento: true },
				{ label: 'Gastos diversos', valor: t.adicionales.gastosDiversos, descuento: true },
				// Mismo número que la base imponible de las retenciones, pero se
				// nombra como en la hoja de ingresos: es el valor que se factura.
				// Ahora que la tarjeta de retenciones no imprime su columna de base,
				// esta línea es donde ese número aparece en el papel.
				{ label: 'Valor a facturar', valor: t.adicionales.valorAFacturar },
				{ label: 'Impuestos y anticipos', valor: t.adicionales.impuestos, descuento: true },
				{ label: 'Transporte por pagar', valor: t.adicionales.transportePorPagar, fuerte: true }
			];

	const secciones: SeccionPreview[] = [
		{
			id: `tabla-${o.hoja}`,
			// Qué es la TABLA, no qué es el documento: eso ya lo dice el
			// encabezado, y repetirlo aquí sonaba a eco.
			titulo: 'Consolidado por empresa',
			nota: `${identidad.resume}  ·  ${grupos.length} empresa(s)  ·  ${
				esIngresos
					? `${t.filasIngresos.length} servicio(s)  ·  ${t.filasAdicionales.length} marcado(s) para adicionales`
					: `${t.filasAdicionales.length} servicio(s) marcado(s) con INCLUIR`
			}`,
			columnas: esIngresos ? COLS_INGRESOS : COLS_ADICIONALES,
			filas: grupos.map((g, i) => filaDeGrupo(g, i, esIngresos)),
			vacio: esIngresos
				? 'Este mes no dejó ingresos de terceros.'
				: 'Ningún servicio del mes está marcado para bajar a adicionales.',
			totalesLabel: 'Totales',
			totales: totalesDeGrupos(grupos)
		}
	];

	// Los descuentos de la OTRA hoja no salen aquí: son de su liquidación, y
	// mezclarlos era lo que hacía ilegible el documento combinado.
	const descuentos = seccionDescuentos({
		hoja: o.hoja,
		conceptos: conceptosVisibles,
		totales: esIngresos ? t.ingresos : t.adicionales,
		// Solo la hoja de adicionales retiene: la de ingresos no, su bloque de
		// abajo son anticipos y papelería.
		retenciones: esIngresos ? undefined : t.adicionales.retenciones
	});
	if (descuentos) secciones.push(descuentos);

	// La banda de periodo lleva SOLO los porcentajes que gobiernan esta hoja
	// y su número final. Con los tres porcentajes en las dos, la mitad de la
	// banda no explicaba nada de lo que se estaba mirando.
	const periodo = [
		{ label: 'Mes', valor: nombreMes(o.mes) },
		{ label: 'Año', valor: String(o.anio) },
		{ label: 'Hoja', valor: identidad.chip },
		{ label: 'Empresas', valor: String(grupos.length) },
		...(esIngresos
			? [
					{ label: 'Admon', valor: fmtPct(o.pct.admonIngresos) },
					{ label: 'Total ingreso', valor: COP(t.ingresos.totalIngresoTransmeralda) }
				]
			: [
					{ label: 'Ganancia', valor: fmtPct(o.pct.gananciaAdicionales) },
					{ label: 'Admon', valor: fmtPct(o.pct.admonAdicionales) },
					{ label: 'Transporte por pagar', valor: COP(t.adicionales.transportePorPagar) }
				])
	];

	return {
		titulo: identidad.titulo,
		meta: [
			{ label: 'Código', valor: 'GAF-FR-11' },
			{ label: 'Periodo', valor: periodoCorto },
			{ label: 'Servicios', valor: String(calculadas.length) }
		],
		periodo,
		secciones,
		resumen: cadena,
		// Documento de uso interno: no lo firma ningún tercero.
		firmas: false,
		nombreArchivo: `${identidad.archivo}_${o.anio}_${String(o.mes).padStart(2, '0')}`
	};
}
