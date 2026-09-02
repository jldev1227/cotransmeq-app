/**
 * Reglas de negocio del canvas de INGRESOS DE COTRANSMEQ.
 *
 * Aquí vive lo que las dos hojas —«OTROS INGRESOS» y «ADICIONALES»— tienen en
 * común y que ni el builder ni la page deberían reimplementar por su cuenta:
 * el orden de las filas, los conceptos del pie que la hoja pinta siempre, y el
 * cálculo completo del documento.
 *
 * EL CÁLCULO ESTÁ DUPLICADO A PROPÓSITO (aquí y en el servicio del backend).
 * No es un descuido: el canvas necesita los números en el mismo instante en
 * que el usuario escribe —para el valor cacheado de cada celda de fórmula y
 * para el subtítulo de la barra— y el servidor necesita los suyos para
 * guardarlos sin fiarse del cliente. Las dos expresiones tienen que decir lo
 * mismo; si divergen, la cabecera contradice a la hoja que el usuario tiene
 * delante. Cualquier cambio aquí va acompañado del mismo cambio en
 * `recalcularIngresos` de `liquidaciones-terceros-ingresos.service.ts`.
 */

import type {
	ConceptoIngreso,
	FilaIngresoEstado,
	HojaIngreso,
	IngresoTerceroRow
} from '$lib/api/liquidaciones-terceros-ingresos';
import { uuidDeterminista } from './id-sintetico';

/// Espacio de nombres de las filas sintéticas de UN periodo. Una cabecera por
/// (mes, año), así que el par identifica la liquidación sin arrastrar su id.
export function alcanceIngresos(anio: number, mes: number): string {
	return `ingresos:${anio}:${mes}`;
}

// ─── Orden de la tabla ────────────────────────────────────────────────

/**
 * Clientes destacados.
 *
 * FEPCO es de quien más servicios se liquidan y casi todo lo que acaba bajando
 * a la hoja de ADICIONALES, así que sus filas se resaltan y llegan con INCLUIR
 * ya marcado. NO alteran el orden: la tabla va alfabética POR PLACA (ver
 * `ordenarFilasIngresos`), que es lo que permite recorrerla vehículo a
 * vehículo y comparar valores unitarios de un vistazo.
 *
 * Se compara por prefijo y sin tildes: en los datos aparece como «FEPCO
 * SERVICIOS S.A.S», pero la razón social cambia de sufijo con el tiempo.
 */
const PRIORIDAD_CLIENTE = ['FEPCO'];

function normalizar(texto: string): string {
	return String(texto ?? '')
		.toUpperCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

/// `true` si el cliente de la fila es uno de los prioritarios.
export function esClientePrioritario(clienteNombre: string): boolean {
	const n = normalizar(clienteNombre);
	return PRIORIDAD_CLIENTE.some((p) => n.startsWith(p));
}

/**
 * Ordena las filas de la hoja por PLACA (A-Z), UNA POR SERVICIO.
 *
 * La placa manda y no el cliente: la hoja se revisa vehículo a vehículo
 * —es la unidad con la que se contrasta contra los cierres finales— y con
 * el orden por empresa los servicios de una misma placa quedaban repartidos
 * por toda la tabla. El cliente queda de primer desempate, así que dentro de
 * una placa se siguen leyendo juntos.
 *
 * Sin agrupar por empresa ni por placa: consolidar los servicios en una sola
 * fila escondía justo lo que hay que mirar aquí —el valor unitario de cada
 * uno, y cuáles vienen en negativo—, y hacía imposible marcar servicios
 * sueltos para la hoja de adicionales.
 *
 * La cadena de desempates termina en el id del item: sin un criterio total,
 * dos servicios idénticos podrían intercambiarse entre recargas y las
 * anotaciones ancladas a una fila acabarían en la otra.
 *
 * `localeCompare` con locale español para que las tildes y la Ñ caigan donde
 * el equipo espera, y `numeric` para que «WNK 2» vaya antes que «WNK 10».
 */
export function ordenarFilasIngresos(filas: IngresoTerceroRow[]): IngresoTerceroRow[] {
	const cmp = (a: string, b: string) =>
		String(a ?? '').localeCompare(String(b ?? ''), 'es', {
			sensitivity: 'base',
			numeric: true
		});
	return [...filas].sort(
		(a, b) =>
			cmp(a.placa, b.placa) ||
			cmp(a.cliente_nombre, b.cliente_nombre) ||
			cmp(a.recorrido, b.recorrido) ||
			cmp(a.fechas, b.fechas) ||
			cmp(a.id, b.id)
	);
}

// ─── Conceptos del pie ───────────────────────────────────────────────
//
// NO HAY PRÉSTAMOS NI HORAS EXTRAS. El Excel de referencia abre un bloque
// «PRESTAMOS Y PAGO HORAS EXTRAS» con cuatro filas libres, y las hojas lo
// replicaban: cuatro conceptos sembrados por hoja, su banda, su totalizador y
// la línea TOTAL GENERAL que los sumaba al valor del servicio. En este
// documento no se liquida ninguno de los dos —esos conceptos viven en los
// cierres, no aquí—, así que eran ocho filas vacías por mes que sumaban cero
// y una línea de total que repetía la anterior. Fuera el bloque y fuera
// TOTAL GENERAL, que sin préstamos era VALOR SERVICIO DE TRANSPORTE otra vez.

/// Impuestos de la hoja de ADICIONALES, con el porcentaje del Excel como
/// valor de partida. Los tres últimos cuelgan de la retención de ICA.
export const IMPUESTOS_ADICIONALES: Array<{ concepto: string; porcentaje: number }> = [
	{ concepto: 'RETENCION_FUENTE', porcentaje: 3.5 },
	{ concepto: 'RETENCION_ICA', porcentaje: 1 },
	{ concepto: 'AVISOS_TABLEROS', porcentaje: 15 },
	{ concepto: 'SOBRETASA_BOMBERIL', porcentaje: 21 }
];

/**
 * Tipos que este documento ya NO liquida.
 *
 * Se descartan al leer, no solo al escribir. En la base quedan meses guardados
 * con conceptos `PRESTAMO` de cuando la hoja tenía su bloque, y el canvas los
 * devolvía tal cual al guardar: el backend, que ya no los admite, rechazaba el
 * guardado ENTERO del mes con un 400 y no había forma de salir del bucle. Al
 * filtrarlos aquí, el primer guardado los borra de la base —los conceptos se
 * reemplazan en bloque— y el mes se cura solo.
 */
const TIPOS_RETIRADOS = new Set<string>(['PRESTAMO']);


/**
 * Una fila que las hojas pintan siempre.
 *
 * `clave` es la IDENTIDAD y `concepto` solo el nombre con el que nace. Son
 * cosas distintas desde que el nombre es editable: el id sale de la clave, así
 * que renombrar «GASTO 1» a «ORIENTAL DE LLANTAS FEOL7850» sigue apuntando al
 * mismo registro. Con el id derivado del NOMBRE —como estaba— renombrar una
 * fila la convertía en huérfana y el sembrado creaba otra a su lado.
 */
interface SemillaIngreso {
	hoja: HojaIngreso;
	tipo: ConceptoIngreso['tipo'];
	clave: string;
	concepto: string;
	porcentaje: number | null;
	orden: number;
}

/**
 * El pie completo de las dos hojas.
 *
 * Además de las filas con nombre fijo —PAPELERÍA, OTROS ANTICIPOS, las cuatro
 * retenciones— cada bloque abre unas cuantas LIBRES. El pie de este documento
 * no es un catálogo cerrado: un mes se descuenta un juego de llantas de un
 * proveedor y al siguiente el mantenimiento de otro, y sin filas que nombrar
 * no había dónde escribirlos. Nacen como «GASTO 1», «ANTICIPO 1»…, se
 * renombran escribiendo encima y las que nadie toca NO se guardan (ver
 * `conceptosParaGuardar`), así que no ensucian la base.
 */
function semillasIngresos(): SemillaIngreso[] {
	const out: SemillaIngreso[] = [];

	// SIN FILAS LIBRES DE GASTO NI DE ANTICIPO.
	//
	// Cada hoja abría cuatro «GASTO n» y tres anticipos —OTROS_ANTICIPOS,
	// «ANTICIPO 1», «ANTICIPO 2»—, todas en cero. Existían porque eran la ÚNICA
	// forma de escribir un gasto: la hoja no dejaba crear filas y sin concepto en
	// la base no hay binding, así que había que dejarlas abiertas por si acaso.
	//
	// Con «Filas del pie» en el carril ya no hace falta: quien necesita una la
	// crea con su nombre. Lo que quedaba eran siete filas vacías por hoja —
	// catorce por mes— que se imprimían en el PDF, se exportaban al Excel y
	// obligaban a leer «GASTO 3 · $0» para saber que no había ningún gasto 3.
	//
	// PAPELERIA sí se siembra, en las dos hojas: es del formato, va todos los
	// meses y el documento la espera aunque valga cero. GASTOS DIVERSOS también
	// está siempre, pero no vive aquí — es una FÓRMULA del builder (0,4 % del
	// facturado más una parte fija), no un concepto que se guarde.
	for (const hoja of ['INGRESOS', 'ADICIONALES'] as HojaIngreso[]) {
		out.push({
			hoja,
			tipo: 'GASTO_OPERATIVO',
			clave: 'PAPELERIA',
			concepto: 'PAPELERIA',
			porcentaje: null,
			orden: 1
		});
	}

	// Los IMPUESTOS son las cuatro retenciones del formato: van siempre y traen
	// su porcentaje de fábrica. Solo en ADICIONALES — la hoja de ingresos no
	// retiene nada.
	IMPUESTOS_ADICIONALES.forEach(({ concepto, porcentaje }, i) => {
		out.push({
			hoja: 'ADICIONALES',
			tipo: 'IMPUESTO',
			clave: concepto,
			concepto,
			porcentaje,
			orden: 20 + i
		});
	});
	return out;
}

/**
 * Id determinista de una fila sembrada.
 *
 * Sale del PERIODO, la hoja, el tipo y la clave —nunca del nombre visible—,
 * para que el reemplazo en bloque del autoguardado apunte siempre al mismo
 * registro y solo al de su mes.
 */
function idDeSemilla(alcance: string, s: SemillaIngreso): string {
	return uuidDeterminista(`ingreso:${alcance}:${s.hoja}:${s.tipo}:${s.clave}`);
}

/**
 * Los ids de TODAS las filas sembradas de un periodo.
 *
 * Sirve para distinguir en la interfaz lo que el pie abre solo —PAPELERIA, las
 * cuatro filas libres de gasto, las retenciones— de lo que alguien añadió a
 * mano. La diferencia importa porque una fila sembrada NO se puede borrar:
 * `ensureConceptosIngresos` la vuelve a poner en la siguiente lectura, así que
 * ofrecer un botón de eliminar sobre ella sería mentir.
 */
export function idsSembrados(alcance: string): Set<string> {
	return new Set(semillasIngresos().map((s) => idDeSemilla(alcance, s)));
}

/**
 * Nombre de fábrica de cada fila sembrada, por id.
 *
 * «Vaciar» una fila del pie es devolverla a este nombre y a cero: entonces
 * `conceptosParaGuardar` la descarta y vuelve a ser lo que era, una fila libre
 * del formato. Sin el nombre original no habría a qué volver.
 */
export function nombresDeFabrica(alcance: string): Map<string, string> {
	const m = new Map<string, string>();
	for (const s of semillasIngresos()) m.set(idDeSemilla(alcance, s), s.concepto);
	return m;
}

/**
 * Siguiente `orden` libre de un bloque del pie.
 *
 * El pie se pinta ordenado por `orden` (ver `conceptosDe` en el builder), y las
 * semillas ocupan rangos fijos: gastos 1-5, anticipos 10-12, impuestos 20-23.
 * Una fila nueva se cuelga del mayor de SU bloque para que caiga al final del
 * suyo y no se cuele entre los de otro.
 */
export function siguienteOrden(
	conceptos: ConceptoIngreso[],
	hoja: HojaIngreso,
	tipo: ConceptoIngreso['tipo']
): number {
	return (
		conceptos
			.filter((c) => c.hoja === hoja && c.tipo === tipo)
			.reduce((m, c) => Math.max(m, Number(c.orden) || 0), 0) + 1
	);
}

/**
 * Devuelve los conceptos con TODAS las filas que las hojas pintan garantizadas.
 *
 * Igual que en el canvas de ocasionales: la hoja dibuja siempre el pie
 * completo, pero sus celdas solo son editables-y-persistentes si el concepto
 * existe con un id. Sin él no hay binding y el adaptador descarta la edición en
 * silencio —los «valores fantasma»—. Por eso se siembran ANTES de que el
 * builder vea los datos.
 */
export function ensureConceptosIngresos(
	conceptos: ConceptoIngreso[],
	alcance: string
): ConceptoIngreso[] {
	const out = conceptos.filter((c) => !TIPOS_RETIRADOS.has(String(c.tipo)));

	for (const s of semillasIngresos()) {
		const id = idDeSemilla(alcance, s);
		// Por id Y por nombre. Por id, para reconocer una fila libre que ya se
		// renombró; por nombre, para no duplicar una fila vieja guardada con
		// otro id antes de que existieran las claves.
		const yaEsta = out.some(
			(x) =>
				x.id === id || (x.hoja === s.hoja && x.tipo === s.tipo && x.concepto === s.concepto)
		);
		if (yaEsta) continue;
		out.push({
			id,
			hoja: s.hoja,
			tipo: s.tipo,
			concepto: s.concepto,
			persona: null,
			dias: null,
			valor_unitario: 0,
			porcentaje: s.porcentaje,
			valor_total: 0,
			base_calculo: s.tipo === 'IMPUESTO' ? 0 : null,
			orden: s.orden
		});
	}

	return out;
}

/**
 * Los conceptos que MERECE guardar: los que dicen algo.
 *
 * El pie de cada hoja abre filas libres para poder nombrar un gasto o un
 * anticipo cualquiera, y la mayoría de los meses la mayoría se quedan sin
 * tocar. Guardarlas sería repetir el error del bloque de préstamos: doce
 * filas por mes, todas a cero y con su nombre de fábrica, que solo estorban
 * en la base y en cualquier consulta que mire la tabla.
 *
 * Una fila se guarda si tiene IMPORTE, si tiene PORCENTAJE (las retenciones
 * valen cero y aun así hay que conservar su tasa), si la renombraron, o si no
 * corresponde a ninguna semilla —lo que llegó de fuera se respeta—.
 *
 * Se aplica SOLO al guardar. Lo que pinta la hoja sigue siendo el pie
 * completo: una fila que desaparece en cuanto se vacía no se puede volver a
 * rellenar.
 */
export function conceptosParaGuardar(
	conceptos: ConceptoIngreso[],
	alcance: string
): ConceptoIngreso[] {
	const nombreDeFabrica = new Map<string, string>();
	for (const s of semillasIngresos()) nombreDeFabrica.set(idDeSemilla(alcance, s), s.concepto);

	return conceptos.filter((c) => {
		if ((Number(c.valor_total) || 0) !== 0) return true;
		if (c.porcentaje != null) return true;
		const original = c.id ? nombreDeFabrica.get(c.id) : undefined;
		// Sin semilla que la explique: vino de fuera y no es nuestra para
		// descartarla.
		if (original == null) return true;
		return c.concepto !== original;
	});
}

// ─── Cálculo del documento ───────────────────────────────────────────

/**
 * GASTOS DIVERSOS = 0,4 % del total facturado + una parte fija. Es idéntico
 * en las dos hojas.
 *
 * La parte fija son 20.000 y no los 15.000 del Excel de referencia: es la
 * misma tarifa que aplica el módulo de cierres
 * (`TARIFA_FIJA_GASTOS_DIVERSOS` en `conceptos.service.ts` y en
 * `reglas-conceptos.ts` del backend), y este canvas era el único sitio donde
 * el mismo concepto valía otra cosa.
 */
export const GASTOS_DIVERSOS_PCT = 0.4;
export const GASTOS_DIVERSOS_FIJO = 20000;

/// Porcentajes por defecto. Espejo de los `@default` del schema, para que la
/// hoja calcule lo mismo antes y después del primer guardado.
export const PCT_ADMON_INGRESOS = 10;
export const PCT_GANANCIA_ADICIONALES = 70;
export const PCT_ADMON_ADICIONALES = 10;

/**
 * Redondeo con las reglas de `ROUND` de Excel: la mitad se ALEJA del cero.
 *
 * `Math.round` de JS manda la mitad hacia +∞, así que discrepa en negativos
 * (`Math.round(-0.5)` es `-0`, `ROUND(-0.5)` es `-1`). Aquí los negativos son
 * reales —un cliente puede dejar ingreso negativo en el mes— y estos números
 * alimentan el `v` cacheado de las celdas de fórmula: si no coincidieran con
 * lo que calcula el motor, el primer pintado mostraría un peso de más.
 */
export function roundExcel(n: number): number {
	return n < 0 ? -Math.round(-n) : Math.round(n);
}

export interface PorcentajesIngresos {
	admonIngresos: number;
	gananciaAdicionales: number;
	admonAdicionales: number;
}

/// Los porcentajes vigentes de un mes: los de su cabecera, o los de partida si
/// todavía no se ha guardado nada.
export function porcentajesDe(cabecera: {
	pct_admon_ingresos?: number;
	pct_ganancia_adicionales?: number;
	pct_admon_adicionales?: number;
} | null): PorcentajesIngresos {
	return {
		admonIngresos: cabecera?.pct_admon_ingresos ?? PCT_ADMON_INGRESOS,
		gananciaAdicionales: cabecera?.pct_ganancia_adicionales ?? PCT_GANANCIA_ADICIONALES,
		admonAdicionales: cabecera?.pct_admon_adicionales ?? PCT_ADMON_ADICIONALES
	};
}

/// Una fila de la tabla, ya resuelta contra su override.
export interface FilaCalculada {
	item: IngresoTerceroRow;
	estado: FilaIngresoEstado | undefined;
	/// El servicio está marcado con INCLUIR, es decir: baja a ADICIONALES.
	incluida: boolean;
	cantidad: number;
	/// V/UNIDAD de la hoja de INGRESOS: el ingreso que dejó el servicio.
	vUnidad: number;
	total: number;
	admon: number;
	vLiquidar: number;
}

/// `true` si el servicio está marcado con INCLUIR.
export function estaIncluido(estado: FilaIngresoEstado | undefined): boolean {
	return estado?.incluir_adicional === true;
}

/**
 * `true` si la fila es un ADICIONAL de un cierre final y no un servicio
 * facturado.
 *
 * Se pregunta por el campo y no por el signo de `ingreso_empresa`: un servicio
 * también puede dejar ingreso negativo —pasa, y son los que hay que revisar—,
 * así que deducirlo del signo confundiría las dos cosas justo en las filas más
 * delicadas de la hoja.
 */
export function esAdicional(item: IngresoTerceroRow): boolean {
	return item.origen === 'ADICIONAL';
}

export function indexarFilas(
	filas: FilaIngresoEstado[]
): Map<string, FilaIngresoEstado> {
	const m = new Map<string, FilaIngresoEstado>();
	for (const f of filas) m.set(f.liquidacion_tercero_id, f);
	return m;
}

export function cantidadDe(estado: FilaIngresoEstado | undefined): number {
	const c = estado?.cantidad;
	return c == null ? 1 : Number(c) || 0;
}

/**
 * % de administración que le toca a una fila, en la hoja que sea.
 *
 * CERO para un ADICIONAL, y no el 10 % de la cabecera. La administración es lo
 * que la empresa se queda por gestionar un servicio que le entra; un adicional
 * no entra, SALE. Cobrarle un 10 % convertía un pago de 450.000 en una pérdida
 * de 405.000, y los 45.000 restantes no aparecían por ningún lado: la hoja
 * decía que la empresa recuperaba parte de un dinero que ya había salido.
 *
 * Además, el importe que llega YA ES NETO —`valor_liquidar` del adicional, con
 * su propia administración descontada en el cierre de la placa—, así que
 * aplicar otra sería descontarla dos veces.
 */
export function pctAdmonDeFila(
	item: IngresoTerceroRow,
	estado: FilaIngresoEstado | undefined,
	pct: PorcentajesIngresos,
	hoja: HojaIngreso
): number {
	if (esAdicional(item)) return 0;
	return hoja === 'INGRESOS'
		? (estado?.pct_admon_ingresos ?? pct.admonIngresos)
		: (estado?.pct_admon_adicional ?? pct.admonAdicionales);
}

/// Filas de la hoja de INGRESOS, ya calculadas y en orden de presentación.
export function calcularFilasIngresos(
	items: IngresoTerceroRow[],
	porItem: Map<string, FilaIngresoEstado>,
	pct: PorcentajesIngresos
): FilaCalculada[] {
	return items.map((item) => {
		const estado = porItem.get(item.id);
		const cantidad = cantidadDe(estado);
		const vUnidad = Number(item.ingreso_empresa) || 0;
		const total = vUnidad * cantidad;
		const admon = roundExcel((total * pctAdmonDeFila(item, estado, pct, 'INGRESOS')) / 100);
		return {
			item,
			estado,
			incluida: estaIncluido(estado),
			cantidad,
			vUnidad,
			total,
			admon,
			vLiquidar: total - admon
		};
	});
}

/**
 * V/UNIDAD de un ingreso en la hoja de ADICIONALES.
 *
 * El valor escrito a mano manda sobre el porcentaje: el Excel de referencia
 * tiene una fila así, y sin esta salida habría que retorcer el % hasta que
 * cuadrara el número.
 */
export function vUnidadAdicional(
	item: IngresoTerceroRow,
	estado: FilaIngresoEstado | undefined,
	pct: PorcentajesIngresos
): number {
	if (estado?.valor_unitario_adicional != null) {
		return Number(estado.valor_unitario_adicional) || 0;
	}
	// UN ADICIONAL PASA ÍNTEGRO, sin porcentaje de ganancia.
	//
	// El % de ganancia existe para decidir con cuánto baja un INGRESO a la hoja
	// de adicionales: de lo que dejó el servicio, tanto se liquida. Un adicional
	// no es un ingreso del que quedarse una parte: es una salida de caja ya
	// ocurrida, por un importe exacto que la empresa ya pagó. Aplicarle un 70 %
	// dejaría la hoja restando 315.000 de un pago de 450.000, y los 135.000 que
	// faltan no están en ninguna parte.
	//
	// Sigue admitiendo override a mano (`valor_unitario_adicional`, arriba):
	// esa salida es la del Excel de referencia y vale para los dos orígenes.
	if (esAdicional(item)) return Number(item.ingreso_empresa) || 0;

	const ganancia = estado?.pct_ganancia ?? pct.gananciaAdicionales;
	return ((Number(item.ingreso_empresa) || 0) * ganancia) / 100;
}

/**
 * Filas de la hoja de ADICIONALES para TODOS los servicios del mes, marcados o
 * no, en el MISMO orden que los de la hoja de INGRESOS.
 *
 * Es lo que pinta el builder. La hoja lleva las filas de todos los servicios y
 * esconde las que no están marcadas, en vez de emitir solo las marcadas: así
 * marcar o desmarcar INCLUIR no mueve ni una fila de sitio y no hace falta
 * reconstruir el libro para reflejarlo (ver el encabezado del builder).
 *
 * El importe de las no marcadas se calcula igualmente —es el que tendría si se
 * marcara— pero NO entra en ningún total: la hoja lo apaga con la fórmula que
 * cuelga de la casilla INCLUIR, y aquí lo hace `calcularFilasAdicionales`.
 */
export function calcularFilasAdicionalesTodas(
	items: IngresoTerceroRow[],
	porItem: Map<string, FilaIngresoEstado>,
	pct: PorcentajesIngresos
): FilaCalculada[] {
	return items.map((item) => {
		const estado = porItem.get(item.id);
		const cantidad = cantidadDe(estado);
		const vUnidad = vUnidadAdicional(item, estado, pct);
		const total = vUnidad * cantidad;
		const admon = roundExcel((total * pctAdmonDeFila(item, estado, pct, 'ADICIONALES')) / 100);
		return {
			item,
			estado,
			incluida: estaIncluido(estado),
			cantidad,
			vUnidad,
			total,
			admon,
			vLiquidar: total - admon
		};
	});
}

/// Filas que de verdad LIQUIDA la hoja de ADICIONALES: solo las marcadas con
/// INCLUIR. Es lo que suman los totales y lo que imprime el preview.
export function calcularFilasAdicionales(
	items: IngresoTerceroRow[],
	porItem: Map<string, FilaIngresoEstado>,
	pct: PorcentajesIngresos
): FilaCalculada[] {
	return calcularFilasAdicionalesTodas(items, porItem, pct).filter((f) => f.incluida);
}

export function sumaConceptos(
	conceptos: ConceptoIngreso[],
	hoja: HojaIngreso,
	tipo: ConceptoIngreso['tipo']
): number {
	return conceptos
		.filter((c) => c.hoja === hoja && c.tipo === tipo)
		.reduce((s, c) => s + (Number(c.valor_total) || 0), 0);
}

export function porcentajeDeImpuesto(
	conceptos: ConceptoIngreso[],
	concepto: string,
	porDefecto: number
): number {
	const c = conceptos.find(
		(x) => x.hoja === 'ADICIONALES' && x.tipo === 'IMPUESTO' && x.concepto === concepto
	);
	return c?.porcentaje == null ? porDefecto : Number(c.porcentaje) || 0;
}

export interface TotalesHoja {
	facturado: number;
	admon: number;
	valorServicio: number;
	personal: number;
	gastos: number;
	anticipos: number;
	gastosDiversos: number;
	descuentos: number;
	valorAFacturar: number;
	transportePorPagar: number;
}

/// Una retención de la hoja de ADICIONALES, ya resuelta contra su base.
export interface ImpuestoCalculado {
	concepto: string;
	porcentaje: number;
	/// Sobre qué se aplica: la base imponible, o la retención de ICA.
	base: number;
	valor: number;
}

/**
 * Desglosa las retenciones de ADICIONALES, una a una.
 *
 * Existe porque el total agregado no basta para IMPRIMIRLAS: el documento
 * lleva una tarjeta con concepto, porcentaje, base y valor, igual que la del
 * canvas de cierres. Y vive aquí, junto al resto del cálculo, porque
 * `calcularTotales` SUMA esta misma lista para su `impuestos`: si el preview
 * se la calculara por su cuenta, el papel y la hoja acabarían discrepando en
 * el número que más se mira.
 *
 * Las tres primeras cuelgan de la base imponible; AVISOS Y TABLEROS y la
 * SOBRETASA BOMBERIL cuelgan de la retención de ICA y no de la base — es lo
 * que dice el Excel (`=+H90*15%`), y aplicarlas sobre la base las
 * multiplicaría por cien.
 */
export function desglosarImpuestosAdicionales(
	conceptos: ConceptoIngreso[],
	baseImponible: number
): ImpuestoCalculado[] {
	const pct = (nombre: string, porDefecto: number) =>
		porcentajeDeImpuesto(conceptos, nombre, porDefecto);

	const reteica = (baseImponible * pct('RETENCION_ICA', 1)) / 100;
	const de = (concepto: string, porDefecto: number, base: number): ImpuestoCalculado => {
		const porcentaje = pct(concepto, porDefecto);
		return { concepto, porcentaje, base, valor: (base * porcentaje) / 100 };
	};

	return [
		de('RETENCION_FUENTE', 3.5, baseImponible),
		de('RETENCION_ICA', 1, baseImponible),
		de('AVISOS_TABLEROS', 15, reteica),
		de('SOBRETASA_BOMBERIL', 21, reteica)
	];
}

/**
 * Totales del documento completo, en el mismo orden en que lo lee el papel.
 *
 * La hoja de ADICIONALES se calcula PRIMERO: su TRANSPORTE POR PAGAR es lo que
 * la de INGRESOS resta como «TOTAL DESCUENTOS LIQUIDACIÓN ADICIONALES», y al
 * revés no se puede.
 */
export function calcularTotales(o: {
	items: IngresoTerceroRow[];
	porItem: Map<string, FilaIngresoEstado>;
	conceptos: ConceptoIngreso[];
	pct: PorcentajesIngresos;
}): {
	ingresos: TotalesHoja & { totalIngresoTransmeralda: number };
	adicionales: TotalesHoja & {
		impuestos: number;
		baseImponible: number;
		retenciones: ImpuestoCalculado[];
	};
	filasIngresos: FilaCalculada[];
	filasAdicionales: FilaCalculada[];
	/// Las de ADICIONALES SIN filtrar por INCLUIR: lo que pinta el builder.
	filasAdicionalesTodas: FilaCalculada[];
} {
	const filasIngresos = calcularFilasIngresos(o.items, o.porItem, o.pct);
	const filasAdicionalesTodas = calcularFilasAdicionalesTodas(o.items, o.porItem, o.pct);
	const filasAdicionales = filasAdicionalesTodas.filter((f) => f.incluida);

	const acumular = (filas: FilaCalculada[]) => ({
		facturado: filas.reduce((s, f) => s + f.total, 0),
		admon: filas.reduce((s, f) => s + f.admon, 0),
		valorServicio: filas.reduce((s, f) => s + f.vLiquidar, 0)
	});

	// ── ADICIONALES ──
	const aBase = acumular(filasAdicionales);
	const aPersonal = sumaConceptos(o.conceptos, 'ADICIONALES', 'COSTO_LABORAL');
	const aGastos = sumaConceptos(o.conceptos, 'ADICIONALES', 'GASTO_OPERATIVO');
	const aDiversos =
		(aBase.facturado * GASTOS_DIVERSOS_PCT) / 100 + GASTOS_DIVERSOS_FIJO;
	const aDescuentos = aPersonal + aGastos + aDiversos;
	// Sin préstamos de por medio, la base imponible cuelga directamente del
	// valor del servicio: era `valorServicio + préstamos − descuentos`.
	const aBaseImponible = aBase.valorServicio - aDescuentos;

	const aAnticipos = sumaConceptos(o.conceptos, 'ADICIONALES', 'ANTICIPO');
	const aRetenciones = desglosarImpuestosAdicionales(o.conceptos, aBaseImponible);
	// El agregado incluye los anticipos porque van en el mismo bloque de la
	// hoja («IMPUESTOS Y GASTOS DEL VEHICULO») y se restan a la vez.
	const aImpuestos = aRetenciones.reduce((s, i) => s + i.valor, 0) + aAnticipos;
	const aPorPagar = aBaseImponible - aImpuestos;

	// ── INGRESOS ──
	const iBase = acumular(filasIngresos);
	// Aquí entra el circuito: lo que se paga por la liquidación de adicionales.
	const iValorAFacturar = iBase.valorServicio - aPorPagar;
	const iPersonal = sumaConceptos(o.conceptos, 'INGRESOS', 'COSTO_LABORAL');
	const iGastos = sumaConceptos(o.conceptos, 'INGRESOS', 'GASTO_OPERATIVO');
	const iAnticipos = sumaConceptos(o.conceptos, 'INGRESOS', 'ANTICIPO');
	const iDescuentos = iPersonal + iGastos + iAnticipos;
	const iPorPagar = iValorAFacturar - iDescuentos;
	const iDiversos =
		(iBase.facturado * GASTOS_DIVERSOS_PCT) / 100 + GASTOS_DIVERSOS_FIJO;

	return {
		filasIngresos,
		filasAdicionales,
		filasAdicionalesTodas,
		ingresos: {
			...iBase,
			personal: iPersonal,
			gastos: iGastos,
			anticipos: iAnticipos,
			gastosDiversos: iDiversos,
			descuentos: iDescuentos,
			valorAFacturar: iValorAFacturar,
			transportePorPagar: iPorPagar,
			totalIngresoTransmeralda: iPorPagar - iDiversos
		},
		adicionales: {
			...aBase,
			personal: aPersonal,
			gastos: aGastos,
			anticipos: aAnticipos,
			gastosDiversos: aDiversos,
			descuentos: aDescuentos,
			baseImponible: aBaseImponible,
			valorAFacturar: aBaseImponible,
			impuestos: aImpuestos,
			/// Desglose de las retenciones, para imprimirlas una a una.
			retenciones: aRetenciones,
			transportePorPagar: aPorPagar
		}
	};
}
