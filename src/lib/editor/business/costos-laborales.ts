import type { ConfiguracionDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import { uuidDeterminista } from './id-sintetico';

/**
 * Siembra los conceptos de COSTO LABORAL (prestaciones + seguridad social) que
 * falten en una liquidación.
 *
 * POR QUÉ HACE FALTA: el canvas de cierres finales los recibe ya calculados —
 * su generador de borradores los crea leyendo `configuracion_descuento_tercero`
 * y guarda el `porcentaje` en cada fila. Los canvas ocasional y adicionales, en
 * cambio, arrancan con `conceptos: []` a propósito, así que sus tablas de
 * «Descuentos por la prestación del servicio» salían con TODO a 0.00%.
 *
 * LOS PORCENTAJES NO SE ESCRIBEN AQUÍ. Se leen de la misma tabla de
 * configuración que usa cierres, que es la única fuente de verdad: si mañana
 * cambia el ARP, cambia en los cuatro canvas a la vez. Duplicar los números en
 * código sería garantizar que un día dejen de coincidir.
 *
 * Las filas sintéticas llevan un id con forma de UUID derivado del concepto Y
 * DEL PERIODO (ver `id-sintetico.ts`), para que el registro de bindings pueda
 * registrarlas antes de que el backend las persista y para que el upsert del
 * autoguardado apunte siempre al mismo registro —y solo al de su mes.
 */

/**
 * Días por defecto de las filas de SALARIOS.
 *
 * A diferencia de los porcentajes, estos NO están en
 * `configuracion_descuento_tercero`: el canvas de cierres los saca de los días
 * realmente laborados por cada conductor. Ocasionales y adicionales no tienen
 * esos datos, así que arrancaban con la columna DÍAS entera a 0 y sin nada que
 * mirar. Estos son los valores de referencia con los que trabaja el equipo.
 *
 * Van aquí y no repartidos por los builders para que haya un único sitio donde
 * cambiarlos. Si algún día deben ser editables, su hogar natural es la tabla de
 * configuración, junto a los porcentajes.
 */
export const DIAS_POR_DEFECTO: Record<string, number> = {
	SALARIO: 20,
	AUXILIO_TRANSPORTE: 20,
	BONIFICACION: 6,
	OTROS_AUXILIOS: 0,
	RECARGOS: 0
};

/// Categorías de `configuracion_descuento_tercero` que son costo laboral.
const CATEGORIAS_LABORALES = new Set(['PRESTACION_SOCIAL', 'SEGURIDAD_SOCIAL']);

/// Orden de presentación, el mismo que usa el canvas de cierres.
const ORDEN: string[] = [
	'CESANTIAS',
	'INTERESES_CESANTIAS',
	'PRIMA',
	'VACACIONES',
	'SALUD',
	'PENSION',
	'ARP',
	'PARAFISCALES'
];

/// Forma mínima que necesita esta función. Se deja laxa a propósito: los tres
/// canvas tienen su propio tipo de concepto y la firma genérica preserva el del
/// llamador en vez de forzar una conversión en cada sitio.
export interface ConceptoLaboralMinimo {
	tipo: string;
	concepto: string;
	porcentaje?: number | null;
}

/**
 * Devuelve la lista de conceptos con los laborales garantizados.
 *
 * A los que YA existen se les respeta su valor: pueden haberse editado a mano
 * para un periodo concreto. Solo se rellena el `porcentaje` cuando viene vacío,
 * que es el caso de las liquidaciones creadas antes de que esto existiera.
 */
export function ensureCostosLaborales<T extends ConceptoLaboralMinimo>(
	conceptos: T[],
	config: ConfiguracionDescuento[] | undefined,
	alcance: string
): T[] {
	if (!config?.length) return conceptos;

	const porConcepto = new Map<string, ConfiguracionDescuento>();
	for (const c of config) {
		if (!CATEGORIAS_LABORALES.has(String((c as any).categoria))) continue;
		if ((c as any).activo === false) continue;
		porConcepto.set(String(c.concepto), c);
	}
	if (porConcepto.size === 0) return conceptos;

	const out = [...conceptos];

	// ── SALARIOS ──
	// Solo se rellenan los DÍAS. El `valor_unitario` se deja como esté: poner
	// un valor de día aquí cambiaría los totales de la liquidación, que es una
	// decisión de negocio distinta a mostrar la estructura de la tabla.
	for (const [nombre, dias] of Object.entries(DIAS_POR_DEFECTO)) {
		const existente = out.find(
			(c) => c.tipo === 'COSTO_LABORAL' && c.concepto === nombre
		);
		if (existente) {
			if ((existente as any).dias == null || Number((existente as any).dias) === 0) {
				(existente as any).dias = dias;
			}
			continue;
		}
		out.push({
			// UUID estable derivado del concepto: la columna es `@db.Uuid` y el id
			// tiene que ser el mismo en cada render para que el upsert no cree una
			// fila nueva en cada autoguardado.
			id: uuidDeterminista(`laboral:${alcance}:${nombre}`),
			tipo: 'COSTO_LABORAL',
			concepto: nombre,
			porcentaje: null,
			dias,
			valor_unitario: 0,
			valor_total: 0,
			base_calculo: 0,
			calculado: true,
			conductor_id: null,
			placa_aplicada: null
		} as unknown as T);
	}

	for (const nombre of ORDEN) {
		const cfg = porConcepto.get(nombre);
		if (!cfg) continue;
		const pct = Number((cfg as any).porcentaje) || 0;

		const existente = out.find(
			(c) => c.tipo === 'COSTO_LABORAL' && c.concepto === nombre
		);
		if (existente) {
			// Solo se completa lo que falta: un porcentaje ya puesto manda.
			if (existente.porcentaje == null || Number(existente.porcentaje) === 0) {
				existente.porcentaje = pct;
			}
			continue;
		}

		out.push({
			id: uuidDeterminista(`laboral:${alcance}:${nombre}`),
			tipo: 'COSTO_LABORAL',
			concepto: nombre,
			porcentaje: pct,
			valor_total: 0,
			base_calculo: 0,
			calculado: true,
			conductor_id: null,
			placa_aplicada: null,
			dias: null,
			valor_unitario: 0
		} as unknown as T);
	}

	return out;
}

/**
 * Los cinco gastos de vehículo que la hoja SIEMPRE pinta.
 *
 * El orden es el de la tabla; `writeSmallSection` los renderiza en este mismo
 * orden aunque no exista ninguno en la base.
 */
export const GASTOS_VEHICULO: string[] = [
	'DOTACION',
	'EXAMEN_MEDICO',
	'COMBUSTIBLE',
	'PAPELERIA',
	'GASTOS_DIVERSOS'
];

/**
 * Siembra los conceptos de GASTO DE VEHÍCULO que falten.
 *
 * POR QUÉ HACE FALTA: el canvas de ocasionales pintaba las cinco filas SIEMPRE,
 * pero solo les ponía binding si encontraba un concepto `GASTO_OPERATIVO` con
 * id. Como el borrador ocasional nace con `conceptos: []` y nadie los sembraba,
 * esas diez celdas (CANTIDAD y VALOR) no tenían binding NI eran zona libre —la
 * hoja declara `soloDebajo`—, así que el adaptador las descartaba en silencio:
 * el TOTAL se recalculaba en pantalla y al recargar no quedaba nada. Eran los
 * «valores fantasma» de esa tabla.
 *
 * A diferencia de los laborales, aquí no hay tabla de configuración de la que
 * leer: los cinco conceptos son fijos y nacen en cero. Lo único que aporta esta
 * función es EXISTENCIA con un id estable.
 */
export function ensureGastosVehiculo<T extends ConceptoLaboralMinimo>(
	conceptos: T[],
	alcance: string
): T[] {
	const out = [...conceptos];
	for (const nombre of GASTOS_VEHICULO) {
		if (out.some((c) => c.tipo === 'GASTO_OPERATIVO' && c.concepto === nombre)) continue;
		out.push({
			id: uuidDeterminista(`gasto:${alcance}:${nombre}`),
			tipo: 'GASTO_OPERATIVO',
			concepto: nombre,
			porcentaje: null,
			dias: 0,
			valor_unitario: 0,
			valor_total: 0,
			base_calculo: 0,
			calculado: false,
			conductor_id: null,
			placa_aplicada: null
		} as unknown as T);
	}
	return out;
}
