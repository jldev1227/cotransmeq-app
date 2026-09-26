/**
 * Construye el libro de nómina de un periodo: una hoja por conductor, en
 * orden alfabético, replicando la estructura de los Excel que hasta ahora se
 * montaban a mano.
 *
 * CINCO ZONAS por hoja, las mismas del Excel:
 *
 *   A  Tabla de días (arriba)      — un día por columna: turno, horas,
 *                                    disponibilidad y las siete filas de
 *                                    recargo, resaltadas por tipo.
 *   B  Configuración (abajo izq.)  — tarifas vigentes y acumulado por tipo.
 *   C  Empresas (abajo izq., más)  — un bloque por empresa y mes, con los
 *                                    días agrupados en texto.
 *   D  Jornada (abajo centro)      — topes legales y horas por semana.
 *   E  Desprendible (abajo dcha.)  — devengos, deducciones y neto.
 *
 * Debajo de la fila 22 las columnas de los días quedan libres, así que las
 * zonas B, C, D y E conviven en el mismo rango de columnas sin estorbarse.
 * Es lo que hace el Excel y por eso la hoja cabe en un ancho razonable.
 *
 * Lo único EDITABLE es el desprendible y las dos constantes de
 * disponibilidad; todo lo demás es derivado de las planillas y se registra
 * sin binding, de modo que `cell-permission-nomina` lo bloquea por defecto.
 */

import {
	BooleanNumber,
	HorizontalAlign,
	LocaleType,
	VerticalAlign,
	type ICellData,
	type IStyleData,
	type IWorkbookData,
	type IWorksheetData
} from '@univerjs/core';
import {
	allBorders,
	CABECERA_BG,
	colLetra,
	comoTexto,
	contraste,
	GREEN,
	MUTED,
	TEXT_DARK,
	TEXTO_MARCA,
	TEXTO_MARCA_FUERTE,
	TINTE,
	TOTALES_BG
} from './historial-comun';
import { rellenarBordesVacios } from './relleno-bordes';
import { CHECKBOX_SI, CHECKBOX_NO } from '../univer/checkbox-si-no';
import { setNominaBinding, type NominaBinding } from '../business/nomina-cell-binding';
import { obtenerFestivosCompletos } from '$lib/utils/festivosColombia';

// ─── Tipos de entrada (espejo de `nomina-canvas.types.ts` del backend) ───

export type CodigoRecargo = 'RN' | 'HEN' | 'HED' | 'HEFD' | 'HEFN' | 'RD' | 'RNDF';

export interface DiaPeriodoDTO {
	fecha: string;
	dia: number;
	mes: number;
	anio: number;
	nombreMes: string;
	nombreDia: string;
	esDomingo: boolean;
	indice: number;
	/**
	 * Repetición de la fecha: 0 es la primera columna del día.
	 *
	 * Una fecha abre más de una columna cuando ALGÚN conductor del libro tuvo
	 * dos servicios ese día. Es lo que permite ocultar por hoja las que ese
	 * conductor no usa. Ausente en snapshots viejos, que se pintan enteros.
	 */
	ocurrencia?: number;
}

export interface SemanaDTO {
	etiqueta: string;
	indices: number[];
}

export interface DiaHojaDTO {
	indice: number;
	fecha: string;
	horaInicio: number | null;
	horaFin: number | null;
	totalHoras: number;
	esFestivo: boolean;
	esDomingo: boolean;
	disponibilidad: boolean;
	pernocte: boolean;
	horas: Partial<Record<CodigoRecargo, number>>;
	empresa: string | null;
	empresaId: string | null;
	empresaColor: string | null;
	placa?: string | null;
	placaColor?: string | null;
	/// Cuál de los servicios del día es. Ausente en payloads viejos: entonces
	/// es el primero.
	ocurrencia?: number;
	/// `true` cuando el día viene de la COPIA de la liquidación y por tanto se
	/// puede teclear. Ausente en payloads anteriores al borrador editable.
	propio?: boolean;
}

export interface ClienteNominaDTO {
	id: string;
	nombre: string;
	color: string;
}

export interface TarifaDTO {
	codigo: CodigoRecargo;
	nombre: string;
	color: string;
	porcentaje: number;
	valorHora: number;
	/** Horas que se PAGAN: las de la planilla, o las corregidas a mano. */
	horas: number;
	/**
	 * Lo que dicen las planillas. Ausente en payloads anteriores a los ajustes
	 * de horas, donde `horas` es siempre la cifra de la planilla.
	 */
	horasPlanilla?: number;
	/** `true` si estas horas están corregidas a mano. */
	ajustada?: boolean;
	valor: number;
	/** Índice dentro de `HojaNominaDTO.tramos`. Ausente en payloads viejos. */
	tramo?: number;
	/// Valor hora e importe sobre CADA base del tramo, alineados con
	/// `TramoVigenciaDTO.bases`. Ausentes en payloads anteriores a las tarifas
	/// por empresa, donde solo existe la base general.
	valorHoraPorBase?: number[];
	valorPorBase?: number[];
}

/**
 * Un tramo del corte con una misma configuración salarial y tarifas.
 *
 * Casi siempre hay uno. Hay dos cuando el corte cruza un cambio de vigencia
 * —el 21-jun → 20-jul de 2026 cruza la Ley 2466— y entonces el bloque de
 * configuración se pinta partido, con su propia base y sus propias tarifas
 * por tramo, porque una sola fila de RD no puede decir 80 % y 90 % a la vez.
 */
export interface TramoVigenciaDTO {
	desde: string;
	hasta: string;
	etiqueta: string;
	salarioBasico: number;
	horasMensualesBase: number;
	valorHora: number;
	/// Bases salariales vigentes en el tramo, la general primero. Ausente en
	/// payloads viejos: entonces solo se pinta la columna de siempre.
	bases?: { empresaId: string | null; nombre: string; salarioBasico: number; valorHora: number }[];
}

export interface BloqueEmpresaDTO {
	empresaId: string;
	empresa: string;
	color: string;
	mes: number;
	anio: number;
	textoDias: string;
	dias: number[];
	lineas: { codigo: CodigoRecargo; nombre: string; horas: number; valor: number }[];
	totalHoras: number;
	totalValor: number;
}

export interface ConceptoDTO {
	clave: string;
	nombre: string;
	cantidad: number | null;
	valor: number;
	editable: boolean;
	/**
	 * Importe MENSUAL que este concepto prorratea entre 30.
	 *
	 * Con él, la celda de VALOR se escribe como fórmula —«base entre 30 por la
	 * cantidad»— y cambiar los días en la columna CANT. mueve el importe en el
	 * acto, sin esperar al servidor. Ausente en los conceptos que se teclean
	 * enteros y en el auxilio cuando la liquidación lo tiene descontado.
	 */
	baseMensual?: number;
	/**
	 * Cantidad desde la que el concepto se paga ENTERO, sin prorratear.
	 *
	 * Solo lo trae la NIVELACIÓN DE SALARIO: con 17 días de Villanueva o más se
	 * paga la diferencia completa del mes. La fórmula tiene que respetarlo o la
	 * celda enseñaría menos de lo que el servidor guarda al teclear 20 días.
	 * Ausente en todo lo demás —y en los snapshots anteriores al bono—, que
	 * prorratean siempre.
	 */
	umbralCompleto?: number;
	/// Fila que solo es un rótulo de sección («OTROS»). Ausente en payloads
	/// viejos, donde no existía.
	seccion?: boolean;
}

export interface HojaNominaDTO {
	conductorId: string;
	liquidacionId: string | null;
	version: number;
	estado: string;
	nombre: string;
	cedula: string | null;
	/**
	 * Correo del conductor: es a donde va el desprendible.
	 *
	 * Opcional porque un snapshot capturado antes de que este campo existiera no
	 * lo trae, y esas versiones se siguen pudiendo abrir.
	 */
	correo?: string | null;
	cargo: string;
	nombreHoja: string;
	tipoVehiculo: string | null;
	placas: string[];
	/** Placas del periodo con su color. Ausente en snapshots viejos. */
	placasUsadas?: { placa: string; color: string }[];
	/** `PAREX`, `GEOPARK`, `PAREX, GEOPARK` o `VILLANUEVA`. Ausente en snapshots viejos. */
	tipoNomina?: string;
	/** Bonos × placa × mes. Ausente en snapshots viejos. */
	matrizBonos?: {
		/// `vehiculoId` falta en los snapshots anteriores a la edición: sin él la
		/// celda no se puede direccionar y se pinta de solo lectura.
		placas: { placa: string; color: string; vehiculoId?: string | null }[];
		/// Meses del corte, `YYYY-MM`. Ausente en snapshots viejos, que traen un
		/// total por placa en vez del desglose.
		meses?: string[];
		filas: {
			nombre: string;
			valorUnitario: number;
			/// `number[][]` (placa × mes) desde el desglose por mes; los snapshots
			/// viejos traen `number[]`, un total por placa. `cantidadesDe()`
			/// admite las dos formas.
			cantidades: number[][] | number[];
			total: number;
			/// Las tres siguientes faltan en los snapshots anteriores al cruce con
			/// recorridos. Sin ellas el bloque se pinta como siempre, con la
			/// cantidad de la liquidación a secas.
			cantidadesRecorridos?: number[][] | number[];
			totalRecorridos?: number;
			descuadra?: boolean;
		}[];
		hayRecorridos?: boolean;
	};
	dias: DiaHojaDTO[];
	tarifas: TarifaDTO[];
	/** Ausente en payloads viejos: entonces se pinta un tramo único. */
	tramos?: TramoVigenciaDTO[];
	bloquesEmpresa: BloqueEmpresaDTO[];
	salarioBasico: number;
	/**
	 * Básico con el que se liquida el DESPRENDIBLE: el de la liquidación, o el
	 * de la ficha del conductor mientras aquella no fije el suyo.
	 *
	 * Aparte de `salarioBasico`, que es el de la configuración de la EMPRESA y
	 * de donde salen el valor hora y los siete recargos. Opcional porque un
	 * snapshot anterior a la columna no lo trae, y entonces se cae al de la
	 * empresa, que es lo que esas versiones enseñaban.
	 */
	salarioBasicoDesprendible?: number;
	/** `true` = lo fijó esta liquidación; `false` = viene del conductor. */
	salarioBasicoFijado?: boolean;
	/**
	 * Días de la NIVELACIÓN DE SALARIO que entran en la base prestacional.
	 *
	 * `null` es «sin decidir» y vale por el ajuste ENTERO del mes; `0` es una
	 * decisión: nada del bono cotiza. Ausente en snapshots viejos, donde la
	 * celda no existía y la base siempre llevaba el ajuste completo.
	 */
	diasAjusteDeducciones?: number | null;
	/**
	 * Los tres interruptores del ajuste de recargos, que se marcan en la hoja.
	 *
	 * Deciden qué recargos entran en la base prestacional: el de PAREX, el de
	 * GEOPARK, o TODOS los del corte con el completo. Ausentes en snapshots
	 * anteriores a que la hoja los dejara marcar, donde salen sin marcar.
	 */
	aplicaAjusteParex?: boolean;
	aplicaAjusteGeopark?: boolean;
	ajusteRecargosCompletos?: boolean;
	/**
	 * Lo que la hoja necesita para calcular la BASE PRESTACIONAL sola.
	 *
	 * La base y las dos deducciones son fórmulas sobre los días de nivelación,
	 * los días que van a la base y las tres casillas. Ausentes en snapshots
	 * viejos, donde las tres celdas se quedan con la cifra del servidor.
	 */
	salarioVillanueva?: number;
	porcentajeSalud?: number;
	porcentajePension?: number;
	descontarSaludSalario?: boolean;
	descontarPensionSalario?: boolean;
	valorHora: number;
	horasMensualesBase: number;
	totalHorasMes: number;
	repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[];
	repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[];
	/// Fechas, días y salario de vacaciones. Ausente en payloads viejos, donde
	/// el bloque no se pinta.
	vacaciones?: {
		desde: string | null;
		hasta: string | null;
		dias: number;
		salarioBase: number;
		salarioHeredado: boolean;
	};
	/**
	 * Licencia de maternidad o paternidad: su interruptor y sus dos fechas.
	 *
	 * Los días salen de restarlas, con el de inicio incluido, y el importe del
	 * básico: por eso ninguno de los dos se teclea. Ausente en payloads viejos,
	 * donde el bloque no se pinta.
	 */
	licencia?: {
		aplica: boolean;
		desde: string | null;
		hasta: string | null;
		dias: number;
		salarioBase: number;
	};
	devengos: ConceptoDTO[];
	deducciones: ConceptoDTO[];
	totales: Record<string, number>;
	clientes: ClienteNominaDTO[];
	/**
	 * La liquidación tiene recargos pero ninguna FILA en `recargos`, que es de
	 * donde el desprendible los suma. En ese estado el comprobante del conductor
	 * sale con «Otros … $ 0». Opcional: los payloads viejos no lo traen.
	 */
	sinFilasDeRecargos?: boolean;
	avisos: string[];
}

export interface PeriodoNominaDTO {
	anio: number;
	mes: number;
	corte: number;
	etiqueta: string;
	periodo: { dias: DiaPeriodoDTO[]; semanas: SemanaDTO[] };
	disponibilidad: { horasBase: number; horasDescuento: number };
	topes: { horasSemanales: number; horasMensuales: number; horasExtrasMes: number };
	hojas: HojaNominaDTO[];
	clientes?: ClienteNominaDTO[];
	avisos: string[];
}

// ─── Geometría ────────────────────────────────────────────────────────

/**
 * Columnas fijas de la izquierda. Nunca índices crudos en el código.
 *
 * SIN COLUMNA «#»: numeraba las hojas del libro (1…25), pero cada hoja tiene
 * UN conductor y su número ya está en la pestaña y en el selector. Dentro de la
 * hoja no ordenaba nada ni se podía cotejar contra nada — era una columna de
 * 32 px repitiendo un dato que no se usa.
 *
 * SIN COLUMNA «TIPO DE VEHICULO»: decía «CAMIONETA» para un conductor que usó
 * cinco vehículos distintos, así que era el tipo del ÚLTIMO y no del periodo.
 * Con las placas en la leyenda —cada una con su color, y el color repetido bajo
 * cada día— el tipo es información que se deduce de la placa y ocupaba 118 px
 * fijos para repetir siempre lo mismo.
 *
 * `ROTULOS` se llamaba `PLACA_FIN` de cuando ahí vivía la columna de placas.
 */
export const COL = {
	NOMBRE: 0,
	CEDULA: 1,
	CARGO: 2,
	/**
	 * Final del merge del cargo.
	 *
	 * Las columnas 3 y 4 son las que ocupaban TIPO DE VEHICULO y PLACA. NO se
	 * eliminan de la rejilla, solo dejan de tener cabecera propia: las zonas de
	 * abajo —configuración, tarifas, desprendible— se apoyan en que el bloque
	 * izquierdo mida 718 px, porque un ancho es de la COLUMNA ENTERA y no se
	 * pueden ensanchar las de día para compensar. Quitarlas de verdad dejaba la
	 * tabla de recargos sobre columnas de 46 px, con «$105,007» recortado.
	 *
	 * Así que el cargo se extiende sobre ellas y el ancho total no se mueve.
	 */
	CARGO_FIN: 4,
	/**
	 * Dos columnas de aire entre la tabla de bonos y la de días.
	 *
	 * Pegadas, las dos tablas se leían como una sola rejilla y la mirada saltaba
	 * de «Bono oficina» a «HORA INICIO» sin que nada dijera que son cosas
	 * distintas. Aquí arriba están en blanco; ABAJO no se desperdician: la
	 * primera es la columna de importes del bloque de configuración —por eso
	 * mide 104 px y no 20—, y es también la razón de que el aire caiga en este
	 * punto y no en otro.
	 */
	AIRE0: 5,
	AIRE1: 6,
	/** Dónde van los rótulos de las filas del bloque de días. */
	ROTULOS: 7,
	/** Primera columna de día. */
	DIA0: 8
} as const;

/**
 * Traduce una fila de la hoja al código de recargo que le toca, o `null` si esa
 * fila no es de la rejilla de recargos.
 *
 * Lo necesita quien reacciona a una edición y solo tiene coordenadas —el
 * adapter da fila y columna, no el campo—, para no volver a construir el libro
 * ni clavar el 9 de `FILA.RECARGO0` en otro archivo.
 */
export function recargoDeFila(fila: number): CodigoRecargo | null {
	const i = fila - FILA.RECARGO0;
	return i >= 0 && i < ORDEN_RECARGOS.length ? ORDEN_RECARGOS[i] : null;
}

/** Filas de la zona A, 0-indexadas. */
const FILA = {
	/// Arranca en 0: la hoja dejaba la fila 1 en blanco sin que nada la usara.
	CAB_MES: 0,
	CAB_MES_FIN: 1,
	CAB_DIA: 2,
	CAB_NOMBRE_DIA: 3,
	TURNO: 4,
	INICIO: 5,
	FIN: 6,
	HORAS: 7,
	DISPONIBILIDAD: 8,
	/** Primera de las siete filas de recargo. */
	RECARGO0: 9,
	/**
	 * Cliente del día. Antes llevaba el NOMBRE de la empresa, pero con 31
	 * columnas de 46px no cabía —salía «FIPETRO», «TRANSMERAL»— y encima
	 * repetía en cada día lo que el bloque de abajo ya dice. Ahora la celda
	 * solo se rellena con el color del cliente y quién es cada color lo dice
	 * la leyenda de la fila 21.
	 */
	/**
	 * Dos filas en blanco antes.
	 *
	 * Las siete de recargo y las dos de color —cliente y placa— son cosas
	 * distintas: arriba son HORAS y abajo son CLAVES de color. Pegadas se leían
	 * como una sola tabla de nueve filas y la vista no encontraba dónde termina
	 * una y empieza la otra.
	 */
	CLIENTE_DIA: 18,
	/**
	 * Placa del día, justo debajo del cliente.
	 *
	 * Ocupa la fila 18 (0-indexada), que ya estaba libre entre el cliente y los
	 * totales — no desplaza nada de lo de abajo. Igual que el cliente, la celda
	 * solo lleva COLOR: la placa completa no cabe en 46 px y quién es cada color
	 * lo dice la leyenda de la izquierda.
	 */
	PLACA_DIA: 19,
	/// Otras dos en blanco: los totales y la leyenda cierran el bloque de días,
	/// no forman parte de él.
	TOTALES_TURNO: 22,
	LEYENDA: 23
} as const;

// ─── Fórmulas vivas sobre la rejilla de días ──────────────────────────
//
// POR QUÉ EXISTEN. Las horas de cada día se teclean —son la copia que el
// borrador hizo de las planillas— y de ellas sale TODO el dinero de recargos
// de la hoja: la tabla de tarifas, el desglose por empresa, el reparto entre
// desprendible y disponibilidad, y las siete líneas de OTROS del
// desprendible. Hasta ahora esas cifras se pintaban como números fijos
// calculados en el servidor, así que corregir una hora dejaba la hoja
// diciendo dos cosas a la vez —el día nuevo arriba, el importe viejo abajo—
// hasta que alguien recargara.
//
// Con fórmulas, el recálculo es el de una hoja de cálculo: instantáneo, sin
// ida y vuelta al servidor y auditable —se puede pinchar la celda y ver de
// dónde sale. El servidor sigue siendo el que manda: al recargar, sus cifras
// vuelven a pintar las mismas celdas. Lo que esto quita es la ventana en la
// que las dos no coincidían.
//
// LO QUE NO SE PUEDE EXPRESAR ASÍ. Un recargo con las horas corregidas a mano
// («ajustada») lleva en el desprendible un desplazamiento que el servidor
// aplica sobre el agregado, y un agregado no sabe a qué día tocarle. Esas
// filas se siguen pintando con la cifra del servidor.

/** Fila 1-indexada donde la rejilla de días guarda las horas de `codigo`. */
function filaDelRecargo(codigo: CodigoRecargo): number {
	return FILA.RECARGO0 + ORDEN_RECARGOS.indexOf(codigo) + 1;
}

/**
 * Las columnas dadas como referencias de una fila: `[8,9,10,12] → "I10:K10,M10"`.
 *
 * Se compactan los tramos seguidos porque un corte tiene entre 30 y 50
 * columnas de día: enumerarlas una a una daría fórmulas de 400 caracteres
 * donde casi siempre basta con un rango.
 */
function refsDeColumnas(columnas: number[], fila: number): string {
	const orden = [...new Set(columnas)].sort((a, b) => a - b);
	const trozos: string[] = [];
	for (let i = 0; i < orden.length; ) {
		let j = i;
		while (j + 1 < orden.length && orden[j + 1] === orden[j] + 1) j++;
		const primera = `${colLetra(orden[i])}${fila}`;
		trozos.push(i === j ? primera : `${primera}:${colLetra(orden[j])}${fila}`);
		i = j + 1;
	}
	return trozos.join(',');
}

/** `=SUM(...)` de las horas de `codigo` en esas columnas de día. */
function formulaHoras(codigo: CodigoRecargo, columnas: number[]): string | null {
	const refs = refsDeColumnas(columnas, filaDelRecargo(codigo));
	return refs ? `=SUM(${refs})` : null;
}

/**
 * `=ROUND(SUM(...)*tarifa+SUM(...)*tarifa,0)`.
 *
 * UN GRUPO POR TRAMO. Cuando el corte cruza un cambio de vigencia, el mismo
 * recargo vale distinto antes y después: sumar todas las horas y multiplicar
 * una sola vez es lo que pagaba junio a precio de julio. Con un tramo —lo
 * normal— sale un único `SUM(...)*tarifa`.
 */
function formulaImporte(
	codigo: CodigoRecargo,
	grupos: { columnas: number[]; valorHora: number }[]
): string | null {
	const fila = filaDelRecargo(codigo);
	const terminos = grupos
		.map((g) => ({ refs: refsDeColumnas(g.columnas, fila), vh: g.valorHora }))
		.filter((t) => t.refs)
		.map((t) => `SUM(${t.refs})*${t.vh}`);
	return terminos.length ? `=ROUND(${terminos.join('+')},0)` : null;
}

/**
 * Tramo de vigencia al que pertenece una fecha ISO.
 *
 * Las fechas van en `YYYY-MM-DD`, que se ordena igual como texto que como
 * fecha, así que no hace falta construir `Date` para compararlas.
 */
function tramoDeFecha(tramos: TramoVigenciaDTO[] | undefined, fecha: string): number {
	if (!tramos?.length) return 0;
	const i = tramos.findIndex((t) => !t.desde || (fecha >= t.desde && fecha <= t.hasta));
	return i >= 0 ? i : tramos.length - 1;
}

/**
 * Los días agrupados por tramo, cada grupo con la tarifa de SU tramo.
 *
 * Es lo que come `formulaImporte`. Los códigos con las horas corregidas a
 * mano se excluyen antes de llamar aquí: su importe no sale de los días.
 */
function gruposPorTramo(
	hoja: HojaNominaDTO,
	codigo: CodigoRecargo,
	dias: DiaHojaDTO[],
	/**
	 * Cliente sobre cuya base salarial se valora, o `null` para la general.
	 *
	 * El desglose POR EMPRESA tiene que pagar a la tarifa del cliente: PAREX
	 * liquida sobre 2.358.897 y no sobre los 1.750.905 de la general. Sin esto,
	 * el bloque de PAREX salía valorado a la tarifa de la empresa y contradecía
	 * a la columna «$ PAREX» de la tabla de arriba, que sí usa la base propia.
	 *
	 * Un cliente sin `configuraciones_salario` propia —la mayoría— no aparece
	 * en `bases` y se queda con la general, que es lo que le corresponde.
	 */
	empresaId: string | null = null
): { columnas: number[]; valorHora: number }[] {
	/**
	 * Se agrupa por (TRAMO, BASE DEL CLIENTE), no solo por tramo.
	 *
	 * Un corte mezcla días de varios clientes y cada uno puede tener su propia
	 * `configuraciones_salario`: una hora extra diurna de GEOPARK vale 13.831 y
	 * la general 10.422. Es lo que hace `recargos.service` al valorar las
	 * planillas —«específica de la empresa > base»— y lo que queda guardado en
	 * `valor_hora_calculado`, así que agrupar solo por tramo y multiplicar por
	 * la tarifa general pagaba de menos esos días.
	 *
	 * `empresaId` fuerza una base para TODOS los días; sin él manda la del día,
	 * que es lo correcto cuando la lista viene mezclada.
	 */
	const grupos = new Map<string, { columnas: number[]; valorHora: number }>();
	for (const d of dias) {
		const i = tramoDeFecha(hoja.tramos, d.fecha);
		const t = hoja.tarifas.find((x) => x.codigo === codigo && (x.tramo ?? 0) === i);
		/// `valorHoraPorBase` va alineado con `tramos[i].bases`, así que el
		/// índice de la base ES el índice de la tarifa. Se busca por `empresaId`
		/// y no por posición para que un tramo al que le falte una empresa caiga
		/// en la general en vez de coger la de al lado.
		const dueño = empresaId ?? d.empresaId ?? null;
		const iBase = dueño
			? (hoja.tramos?.[i]?.bases ?? []).findIndex((b) => b.empresaId === dueño)
			: -1;
		const valorHora = (iBase >= 0 ? t?.valorHoraPorBase?.[iBase] : undefined) ?? t?.valorHora ?? 0;
		const clave = `${i}|${valorHora}`;
		const ya = grupos.get(clave);
		if (ya) ya.columnas.push(COL.DIA0 + d.indice);
		else grupos.set(clave, { columnas: [COL.DIA0 + d.indice], valorHora });
	}
	return [...grupos.values()].filter((g) => g.valorHora > 0);
}

/** Códigos cuyas horas se corrigieron a mano: su dinero no sale de los días. */
function codigosAjustados(hoja: HojaNominaDTO): Set<CodigoRecargo> {
	return new Set(hoja.tarifas.filter((t) => t.ajustada === true).map((t) => t.codigo));
}

/** Primera fila de la mitad inferior (config, empresas, jornada, desprendible). */
const FILA_INFERIOR = 25;

/** Orden de las siete filas de recargo, el mismo del Excel. */
export const ORDEN_RECARGOS: CodigoRecargo[] = ['RN', 'HEN', 'HED', 'HEFD', 'HEFN', 'RD', 'RNDF'];

/** Gris de relleno cuando la tarifa no trae color. */
export const COLOR_RECARGO_NEUTRO = '#E2E8F0';

/**
 * Color de cada una de las siete franjas de recargo.
 *
 * Existe porque el color se pinta en TRES momentos: el rótulo de la fila, la
 * celda de cada día al construir el libro, y el repintado VIVO cuando alguien
 * teclea una hora (`repintarRecargosDelDia`, en el engine). Con la búsqueda
 * suelta en cada sitio, ese tercero nacía ya con su propia copia de la regla.
 *
 * Se queda con la PRIMERA tarifa de cada código: un corte partido en tramos de
 * vigencia trae el mismo código repetido con distinta tarifa, pero el color es
 * del tipo de recargo, no del tramo.
 */
export function coloresDeRecargos(hoja: HojaNominaDTO): Record<CodigoRecargo, string> {
	const colores = {} as Record<CodigoRecargo, string>;
	for (const codigo of ORDEN_RECARGOS) {
		colores[codigo] = hoja.tarifas.find((t) => t.codigo === codigo)?.color ?? COLOR_RECARGO_NEUTRO;
	}
	return colores;
}

/**
 * Columnas de las zonas inferiores. Se apoyan en que, por debajo de la fila
 * 22, las columnas de los días quedan libres.
 *
 * ⚠️ TODAS LAS COLUMNAS DE DÍA MIDEN LO MISMO Y NINGUNA SE ENSANCHA. El ancho
 * es una propiedad de la COLUMNA ENTERA: ensanchar la N para que quepa
 * «SEMANA DEL 27 DE JULIO AL 2 DE AGOSTO» ensanchaba también el día 27 de la
 * tabla de arriba, y la cuadrícula quedaba con columnas de distinto tamaño
 * salteadas. Aquí los rótulos largos ganan sitio COMBINANDO celdas, que es lo
 * que hace el Excel y lo único que no deforma la rejilla.
 */
const ZONA = {
	/**
	 * A — el bloque izquierdo entero, que son 718 px repartidos en seis
	 * columnas. Era la 1 cuando delante había una columna «#» de 32 px; al
	 * quitarla, todo se corrió un índice.
	 */
	CONFIG_C0: 0,
	/** Arrancaba en la 13 y dejaba un hueco muerto entre el bloque de
	 *  configuración (que acaba en la 5) y esta zona. */
	JORNADA_C0: 10,
	DESPRENDIBLE_C0: 25
} as const;

/** Celdas que ocupa cada campo de las zonas inferiores. */
const SPAN = {
	/**
	 * Rótulo y valor del bloque de vacaciones.
	 *
	 * Copian el ancho de la columna de concepto del desprendible y el de
	 * cantidad + valor juntos: el bloque va DEBAJO, y con otros anchos las dos
	 * tablas quedarían desalineadas una sobre otra.
	 */
	VAC_ROTULO: 6,
	VAC_VALOR: 3,
	/** Rótulo de una fila de topes / semana. */
	JORNADA_LABEL: 5,
	/** Su valor. */
	JORNADA_VALOR: 2,
	/** La barra de título de la zona. No abarca la tabla entera a propósito:
	 *  es un rótulo, no una cabecera de columnas. */
	JORNADA_TITULO: 7,
	/** Código de recargo en la tabla de reparto. */
	REPARTO_COD: 2,
	/** Columna de horas. Tres celdas porque sus cabeceras son «DESPRENDIBLE»
	 *  y «DISPONIBILIDAD», que en dos se quedaban cortadas. */
	REPARTO_HORAS: 3,
	REPARTO_VALOR: 2,
	/** Nombre del concepto en la columna de DEVENGOS. Es la más larga:
	 *  «RECARGO NOCTURNO DOMINICAL O FESTIVO - RNDF». */
	DESP_CONCEPTO: 6,
	/** Nombre del concepto en DEDUCCIONES: SALUD, PENSION, ANTICIPOS. Con seis
	 *  columnas ocupaba media hoja para escribir siete letras. */
	DESP_DED_CONCEPTO: 3,
	DESP_CANT: 1,
	/** Un importe con formato («$1.750.905») cabe en dos columnas. */
	DESP_VALOR: 2
} as const;

/** Ancho total en columnas de cada zona, para dimensionar la hoja. */
const ANCHO_JORNADA =
	SPAN.REPARTO_COD + SPAN.REPARTO_HORAS + SPAN.REPARTO_VALOR * 2 + SPAN.REPARTO_HORAS;
const ANCHO_DESPRENDIBLE =
	SPAN.DESP_CONCEPTO +
	SPAN.DESP_CANT +
	SPAN.DESP_VALOR +
	SPAN.DESP_DED_CONCEPTO +
	SPAN.DESP_VALOR;

const ANCHO_COL_DIA = 46;
const MIN_COLUMNAS = 27;

// ─── Estilos ──────────────────────────────────────────────────────────

const FMT_COP = '"$"#,##0;[Red]-"$"#,##0';
/**
 * Las horas van SIN patrón a propósito.
 *
 * Univer 0.25.1 renderiza los decimales opcionales de `#,##0.##` dejando el
 * punto cuando el número es entero: 178 sale como «178.» y 35 % como «35.%».
 * Excel no lo hace, pero aquí lo que se ve es Univer. Sin patrón, 178 sale
 * «178» y 12,5 sale «12.5», que es lo que se quiere. Por eso los builders que
 * ya funcionan solo usan patrones sin decimales opcionales (`"$"#,##0`,
 * `0.00"%"`).
 */
const FMT_HORAS = undefined;
const FMT_PCT = '0.00"%"';

/** Cabecera de tabla; el mismo tono que usa el bloque de configuración de
 *  abajo, para que las dos tablas se lean como hermanas. */
const SUBCAB = CABECERA_BG;

const base = (): IStyleData => ({
	bd: allBorders(),
	vt: VerticalAlign.MIDDLE,
	cl: { rgb: TEXT_DARK },
	fs: 10
});

/**
 * Banda de cabecera. El texto lo decide el FONDO, no una constante.
 *
 * Esta misma función pinta las bandas de marca —verde oscuro en Transmeralda,
 * naranja claro en Cotransmeq— y también el ámbar del festivo y el rojo del
 * domingo. Con `#FFFFFF` clavado, el rótulo de Cotransmeq quedaba ilegible
 * sobre su propio naranja.
 */
const cabecera = (bg = GREEN): IStyleData => ({
	...base(),
	bg: { rgb: bg },
	cl: { rgb: contraste(bg) },
	bl: 1,
	ht: HorizontalAlign.CENTER
});

const etiqueta = (): IStyleData => ({ ...base(), bl: 1, cl: { rgb: MUTED } });

const numero = (fmt: string): IStyleData => ({ ...base(), ht: HorizontalAlign.RIGHT });

const totales = (): IStyleData => ({ ...base(), bg: { rgb: TOTALES_BG }, bl: 1 });

/**
 * Celda derivada: fondo apenas gris. Es la señal de que ese número viene de
 * las planillas y no se teclea aquí; sin ella, el usuario intenta corregir el
 * recargo en el desprendible y el canvas se lo rechaza sin que entienda por qué.
 */
/**
 * Festivos. Es el mismo ámbar que usa el desprendible en PDF («Los días
 * dominicales o festivos se resaltan en naranja»), para que la hoja y el
 * papel señalen lo mismo del mismo color.
 */
const FESTIVO_BG = '#FEF3C7';
const FESTIVO_TEXTO = '#92400E';
const FESTIVO_CABECERA = '#B45309';

/**
 * Cabecera de la columna de un SEGUNDO servicio de la misma fecha.
 *
 * Gris pizarra, fuera de la paleta de la marca a propósito: no es un día del
 * calendario sino una columna de desdoble, y tiene que distinguirse de un
 * lunes cualquiera sin competir con el ámbar del festivo ni con el rojo del
 * domingo, que sí son información del día.
 */
const SERVICIO_EXTRA = '#64748B';

const DERIVADA_BG = '#F8FAFC';
const derivada = (): IStyleData => ({ ...base(), bg: { rgb: DERIVADA_BG } });

/** Celda que sí se teclea: blanca y con el borde algo más marcado. */
const EDITABLE_BG = '#FFFFFF';
const editable = (): IStyleData => ({ ...base(), bg: { rgb: EDITABLE_BG } });

// ─── Construcción ─────────────────────────────────────────────────────

export function nominaSheetId(conductorId: string): string {
	return `nomina-${conductorId}`;
}

/** Dónde cuelga el engine el checkbox de los interruptores de ajuste. */
export interface RangoCheckboxNomina {
	columna: number;
	desde: number;
	hasta: number;
}

export interface ResultadoBuild {
	workbook: IWorkbookData;
	unitId: string;
	/** `conductorId → sheetId`, para activar hoja sin remontar. */
	sheetIdPorConductor: Record<string, string>;
	/** `sheetId → conductorId`, para resolver el destino de un comando. */
	conductorPorSheetId: Record<string, string>;
	/// `sheetId → rango de los interruptores`, para colgarles el checkbox.
	/// Varios rangos por hoja: los tres interruptores de ajuste y la casilla
	/// de la licencia, que están en bloques distintos.
	checkboxPorSheetId: Record<string, RangoCheckboxNomina[]>;
}

export function buildNominaWorkbook(dto: PeriodoNominaDTO): ResultadoBuild {
	const unitId = `nomina-${dto.anio}-${dto.mes}`;
	const dias = dto.periodo.dias;
	// La leyenda de clientes se escribe hacia la derecha a razón de 4 columnas
	// por cliente (nombre en dos, color en una, hueco en una). Con muchos
	// clientes se sale del ancho de los días, así que la hoja tiene que ser al
	// menos tan ancha como la leyenda más larga del libro.
	// Festivos del periodo, calculados UNA vez para todo el libro.
	// `obtenerFestivosCompletos` recalcula el año entero en cada llamada; con
	// 31 días × 24 conductores serían 744 recálculos.
	const festivos = festivosDelPeriodo(dias);

	const maxClientes = dto.hojas.reduce((m, h) => Math.max(m, h.clientes?.length ?? 0), 0);
	const numColumnas = Math.max(
		COL.DIA0 + dias.length,
		COL.DIA0 + maxClientes * 4,
		// Las zonas de abajo ya no ensanchan columnas: ganan sitio combinando
		// celdas, así que la hoja tiene que tener columnas suficientes.
		ZONA.JORNADA_C0 + ANCHO_JORNADA,
		ZONA.DESPRENDIBLE_C0 + ANCHO_DESPRENDIBLE,
		MIN_COLUMNAS
	);

	const sheets: Record<string, Partial<IWorksheetData>> = {};
	const sheetOrder: string[] = [];
	const sheetIdPorConductor: Record<string, string> = {};
	/// Lo rellena `construirHoja`: dónde quedaron las tres casillas de ajuste.
	const checkboxPorSheetId: Record<string, RangoCheckboxNomina[]> = {};
	const conductorPorSheetId: Record<string, string> = {};

	dto.hojas.forEach((hoja, i) => {
		const sheetId = nominaSheetId(hoja.conductorId);
		sheetOrder.push(sheetId);
		sheetIdPorConductor[hoja.conductorId] = sheetId;
		conductorPorSheetId[sheetId] = hoja.conductorId;
		sheets[sheetId] = construirHoja({
			dto,
			hoja,
			indice: i + 1,
			sheetId,
			unitId,
			numColumnas,
			festivos,
			checkboxPorSheetId
		});
	});

	// Un libro sin hojas no lo acepta Univer: mejor una hoja que lo explique
	// que un error de consola.
	if (!sheetOrder.length) {
		const sheetId = 'nomina-vacio';
		sheetOrder.push(sheetId);
		sheets[sheetId] = hojaVacia(dto);
	}

	return {
		workbook: {
			id: unitId,
			name: `Nómina ${dto.etiqueta}`,
			appVersion: '0.25.1',
			locale: LocaleType.ES_ES,
			styles: {},
			sheetOrder,
			sheets
		} as IWorkbookData,
		unitId,
		sheetIdPorConductor,
		checkboxPorSheetId,
		conductorPorSheetId
	};
}

function hojaVacia(dto: PeriodoNominaDTO): Partial<IWorksheetData> {
	const cellData: Record<number, Record<number, ICellData>> = {
		1: {
			1: {
				// Ya no es «no hay conductores»: el libro son las LIQUIDACIONES del
				// periodo, y que no haya ninguna no dice nada de la plantilla.
				v: `No hay liquidaciones en ${dto.etiqueta}.`,
				s: { ...base(), bl: 1 }
			}
		}
	};
	return {
		id: 'nomina-vacio',
		name: 'Sin conductores',
		rowCount: 10,
		columnCount: 10,
		cellData,
		mergeData: [{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 8 }],
		showGridlines: BooleanNumber.FALSE
	};
}

function construirHoja(args: {
	dto: PeriodoNominaDTO;
	hoja: HojaNominaDTO;
	indice: number;
	sheetId: string;
	unitId: string;
	numColumnas: number;
	/** Fechas ISO festivas del periodo. */
	festivos: Set<string>;
	/// Mapa que rellena esta función: dónde quedaron las casillas de ajuste,
	/// para que el engine les cuelgue el checkbox. Se pasa en vez de devolverlo
	/// porque el retorno es la hoja que espera Univer.
	/// Varios rangos por hoja: los tres interruptores de ajuste y la casilla
	/// de la licencia, que están en bloques distintos.
	checkboxPorSheetId: Record<string, RangoCheckboxNomina[]>;
}): Partial<IWorksheetData> {
	const { dto, hoja, indice, sheetId, unitId, numColumnas, festivos } = args;
	const dias = dto.periodo.dias;

	const cellData: Record<number, Record<number, ICellData>> = {};
	const mergeData: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] = [];

	const set = (r: number, c: number, cell: ICellData) => {
		(cellData[r] ??= {})[c] = cell;
	};
	const merge = (r1: number, c1: number, r2: number, c2: number) => {
		mergeData.push({ startRow: r1, endRow: r2, startColumn: c1, endColumn: c2 });
	};
	const bind = (r: number, c: number, binding: NominaBinding) => {
		setNominaBinding(unitId, sheetId, r, c, binding);
	};

	// Índice por columna de los días con planilla, para no buscar en bucle.
	const porIndice = new Map<number, DiaHojaDTO>(hoja.dias.map((d) => [d.indice, d]));

	zonaDias({ dias, hoja, porIndice, set, merge, dto, festivos, bind });

	// Un día que la ley marca como festivo pero la planilla no, se paga como
	// día normal: sin RD ni RNDF. Es dinero, y no salta por ningún lado.
	const festivosSinMarcar = hoja.dias
		.filter((d) => festivos.has(d.fecha) && !d.esFestivo)
		.map((d) => d.fecha);
	const avisosHoja = [...hoja.avisos];
	if (festivosSinMarcar.length) {
		avisosHoja.push(
			`Festivo(s) sin marcar en la planilla: ${festivosSinMarcar.join(', ')}. ` +
				'Esos días se liquidaron como ordinarios, sin recargo dominical ni festivo.'
		);
	}
	const { fin: finConfig, celdaSalarioBasico } = zonaConfiguracion({
		hoja,
		dias,
		set,
		merge,
		bind
	});
	const finEmpresas = zonaEmpresas({ hoja, set, merge, desdeFila: finConfig + 2 });
	const reparto = zonaJornada({ dto, hoja, set, merge });
	const { fin: finDesprendible, checkbox: rangosCheckbox } = zonaDesprendible({
		hoja,
		set,
		merge,
		bind,
		avisos: avisosHoja,
		reparto,
		celdaSalarioBasico
	});

	if (rangosCheckbox.length) args.checkboxPorSheetId[sheetId] = rangosCheckbox;

	const rowCount = Math.max(finEmpresas, finDesprendible) + 3;

	const columnData: Record<number, { w: number }> = {};
	columnData[COL.NOMBRE] = { w: 210 };
	columnData[COL.CEDULA] = { w: 100 };
	columnData[COL.CARGO] = { w: 90 };
	// Sin cabecera propia, pero con su ancho: es lo que mantiene el bloque
	// izquierdo en 718 px y, con él, la tabla de recargos de abajo legible.
	columnData[COL.CARGO + 1] = { w: 118 };
	columnData[COL.CARGO_FIN] = { w: 96 };
	// Las dos de aire, iguales. La primera NO es solo aire: abajo es la columna
	// de importes del bloque de configuración («$105.007»), y de ahí salen sus
	// 104 px. La segunda los copia para que el hueco entre las dos tablas se lea
	// como una banda pareja y no como una columna ancha seguida de una rendija.
	columnData[COL.AIRE0] = { w: 104 };
	columnData[COL.AIRE1] = { w: 104 };
	// Aquí van los rótulos de las filas del bloque de días («DISPONIBILIDAD»,
	// «CLIENTE», «PLACA») y, más abajo, los nombres largos de recargo.
	columnData[COL.ROTULOS] = { w: 104 };
	// TODAS las columnas de día miden lo mismo, sin excepción. Las zonas de
	// abajo comparten estas columnas y ganan sitio combinando celdas, nunca
	// ensanchándolas: un ancho es de la columna entera y deformaría la
	// cuadrícula de días de arriba.
	for (let c = COL.DIA0; c < numColumnas; c++) columnData[c] = { w: ANCHO_COL_DIA };

	/**
	 * AQUÍ NO SE OCULTA NINGUNA COLUMNA, y es una decisión, no un olvido.
	 *
	 * Se ocultaban las columnas repetidas que la hoja no usaba. La rejilla se
	 * dimensiona mirando a TODOS los conductores —si uno solo hace turno
	 * partido el 5 de julio, esa fecha abre dos columnas en las 25 hojas y en
	 * 24 la segunda queda vacía—, así que parecía limpio esconderlas.
	 *
	 * NO LO ERA: `hd` esconde la columna ENTERA, y por debajo de la rejilla de
	 * días pasan las zonas de abajo. El desprendible ocupa de la 25 a la 38 y
	 * esas son también columnas de día. Medido en el corte de julio de 2026 de
	 * transmeralda: 18 columnas ocultables, y SIETE de ellas —26, 28, 30, 32,
	 * 34, 36 y 38— caen dentro del desprendible. O sea que esconder los huecos
	 * de arriba borraba trozos del desprendible de abajo: la columna de
	 * concepto partida, media columna de VALOR, el rótulo de deducciones.
	 *
	 * El precio de no ocultarlas es ver las columnas vacías de las fechas que
	 * otro conductor repitió. Se marcan en la cabecera (`2.º SERVICIO`) para
	 * que no se lean como un día repetido, que es exactamente como se leían.
	 */

	cerrarBordesDeCombinadas(cellData, mergeData);
	rellenarBordesVacios(cellData, rowCount, numColumnas, mergeData);

	return {
		id: sheetId,
		name: hoja.nombreHoja,
		tabColor: colorDePestana(hoja.estado),
		hidden: BooleanNumber.FALSE,
		// Solo se congelan las FILAS de cabecera. Las columnas A-G iban
		// congeladas y estorbaban: ocupan casi la mitad del ancho útil, y al
		// desplazarse por los días o por los bloques de abajo se llevaban por
		// delante el espacio de lo que se estaba mirando.
		freeze: {
			startRow: FILA.CAB_NOMBRE_DIA + 1,
			startColumn: 0,
			ySplit: FILA.CAB_NOMBRE_DIA + 1,
			xSplit: 0
		},
		rowCount,
		columnCount: numColumnas,
		zoomRatio: 1,
		scrollTop: 0,
		scrollLeft: 0,
		defaultColumnWidth: 90,
		defaultRowHeight: 20,
		mergeData,
		cellData,
		rowData: {},
		columnData,
		rowHeader: { width: 40 },
		columnHeader: { height: 22 },
		showGridlines: BooleanNumber.FALSE,
		rightToLeft: BooleanNumber.FALSE
	};
}

/** Color de pestaña por estado. Espejo de `nomina-estado.ts`. */
function colorDePestana(estado: string): string {
	switch (estado) {
		case 'LIQUIDADA':
			return '#0EA5E9';
		case 'APROBADA':
			return '#16A34A';
		case 'PAGADA':
			return '#0F4025';
		case 'ANULADA':
			return '#B91C1C';
		default:
			return '#94A3B8';
	}
}

// ─── Zona A: tabla de días ────────────────────────────────────────────

function zonaDias(args: {
	dias: DiaPeriodoDTO[];
	hoja: HojaNominaDTO;
	porIndice: Map<number, DiaHojaDTO>;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	dto: PeriodoNominaDTO;
	festivos: Set<string>;
	/// Lo necesita `leyendaPlacas`: las celdas de la matriz de bonos se teclean
	/// y sin binding el permiso de celda las bloquea.
	bind: (r: number, c: number, binding: NominaBinding) => void;
}) {
	const { dias, hoja, porIndice, set, merge, dto, festivos, bind } = args;

	// Cabecera izquierda: rótulos arriba (filas 1-4), datos debajo (5-8).
	const rotulos: [number, string][] = [
		[COL.NOMBRE, 'NOMBRES Y APELLIDOS'],
		[COL.CEDULA, 'CEDULA'],
		// Ni PLACA ni TIPO DE VEHICULO. La primera apilaba las cinco placas de un
		// conductor en una celda —«PPQ491, LLQ895, SIN-PLACA, TSS965, POP128»—
		// que no cabía y no decía CUÁNDO se usó cada una; la segunda repetía el
		// tipo del último vehículo como si fuera el del periodo. Las dos las
		// sustituye la leyenda de la izquierda, con un color por placa que se
		// repite bajo cada día.
		[COL.CARGO, 'CARGO']
	];
	for (const [c, texto] of rotulos) {
		set(FILA.CAB_MES, c, { v: texto, s: cabecera() });
		merge(FILA.CAB_MES, c, FILA.CAB_NOMBRE_DIA, c === COL.CARGO ? COL.CARGO_FIN : c);
	}

	const datos: [number, ICellData][] = [
		[COL.NOMBRE, comoTexto({ v: hoja.nombre, s: { ...base(), bl: 1 } })],
		[COL.CEDULA, comoTexto({ v: hoja.cedula ?? '', s: base() })],
		[COL.CARGO, comoTexto({ v: hoja.cargo, s: base() })]
	];
	for (const [c, cell] of datos) {
		set(FILA.TURNO, c, cell);
		merge(FILA.TURNO, c, FILA.HORAS, c === COL.CARGO ? COL.CARGO_FIN : c);
	}

	// Fila de mes: un merge por tramo de mes seguido.
	let tramoInicio = 0;
	for (let i = 0; i <= dias.length; i++) {
		const cambia = i === dias.length || dias[i].mes !== dias[tramoInicio].mes;
		if (!cambia) continue;
		const d = dias[tramoInicio];
		const c1 = COL.DIA0 + tramoInicio;
		const c2 = COL.DIA0 + i - 1;
		set(FILA.CAB_MES, c1, { v: `${d.nombreMes} ${d.anio}`, s: cabecera() });
		merge(FILA.CAB_MES, c1, FILA.CAB_MES_FIN, c2);
		tramoInicio = i;
	}

	/**
	 * Rótulos de fila.
	 *
	 * Sin HORA INICIO / HORA FIN / TOTAL HORAS / DISPONIBILIDAD: sus filas son
	 * las cuatro primeras y se leen solas —«06:00», «18:00», «12», «DISP»—, así
	 * que el rótulo repetía lo evidente y ocupaba el único hueco de la hoja con
	 * ancho suficiente para un dato de cabecera. Ahí va ahora la nómina.
	 *
	 * Los que quedan SÍ hacen falta: un color sin nombre no significa nada, y
	 * los códigos de recargo son siglas.
	 */
	const rotulosFila: [number, string][] = [
		[FILA.CLIENTE_DIA, 'CLIENTE'],
		[FILA.PLACA_DIA, 'PLACA']
	];
	for (const [r, texto] of rotulosFila) {
		set(r, COL.ROTULOS, { v: texto, s: etiqueta() });
	}

	// ── Nómina a la que pertenece el conductor en este periodo ───────────
	//
	// Ocupa las tres columnas que quedaron libres (F-H) por encima de la tabla
	// de bonos: es el hueco con más ancho de la hoja y estaba en blanco. Debajo
	// sigue siendo el aire que separa las dos tablas.
	const nomina = hoja.tipoNomina ?? '';
	if (nomina) {
		set(FILA.CAB_MES, COL.AIRE0, { v: 'NÓMINA', s: cabecera() });
		merge(FILA.CAB_MES, COL.AIRE0, FILA.CAB_NOMBRE_DIA, COL.ROTULOS);
		set(FILA.TURNO, COL.AIRE0, {
			v: nomina,
			s: {
				...base(),
				bl: 1,
				fs: nomina.length > 14 ? 10 : 12,
				ht: HorizontalAlign.CENTER,
				// Villanueva es el caso por defecto y va en gris; Parex y Geopark
				// se resaltan porque son los que cambian el cálculo del ajuste.
				...(nomina === 'VILLANUEVA'
					? { cl: { rgb: MUTED } }
					: { bg: { rgb: TINTE }, cl: { rgb: TEXTO_MARCA_FUERTE } })
			}
		});
		/// Hasta HORAS y no hasta DISPONIBILIDAD: esa última fila es del bloque
		/// de días —lleva el «DISP» de cada jornada— y el merge la partía por la
		/// mitad, rompiendo la rejilla. Así el bloque de nómina queda a la misma
		/// altura exacta que el del conductor, que también acaba en HORAS.
		merge(FILA.TURNO, COL.AIRE0, FILA.HORAS, COL.ROTULOS);
	}
	const colorRecargo = coloresDeRecargos(hoja);
	ORDEN_RECARGOS.forEach((codigo, i) => {
		set(FILA.RECARGO0 + i, COL.ROTULOS, {
			v: codigo,
			s: {
				...etiqueta(),
				bg: { rgb: colorRecargo[codigo] },
				ht: HorizontalAlign.CENTER,
				cl: { rgb: contraste(colorRecargo[codigo]) }
			}
		});
	});

	// Una columna por día.
	for (const d of dias) {
		const c = COL.DIA0 + d.indice;
		const dh = porIndice.get(d.indice);
		const domingo = d.esDomingo;
		// Festivo según el calendario colombiano (`festivosColombia.ts`), no
		// según la marca de la planilla: la ley no depende de que alguien la
		// tecleara. Cuando las dos no coinciden, la hoja lo avisa.
		const festivo = festivos.has(d.fecha);

		// En un día festivo las celdas van en ámbar, el mismo que usa el PDF.
		const celdaDia = (): IStyleData =>
			festivo
				? { ...base(), bg: { rgb: FESTIVO_BG }, cl: { rgb: FESTIVO_TEXTO } }
				: derivada();

		/**
		 * Segundo (o tercer) servicio de la MISMA fecha.
		 *
		 * Repetía el número del día y las tres letras del nombre —«5 / MAR»
		 * otra vez— y no había forma de distinguirlo de un día duplicado por
		 * error, que es como se leía: un día sin hora de inicio ni de fin y sin
		 * ninguna razón aparente para existir. La razón es que OTRO conductor
		 * hizo turno partido esa fecha y la rejilla de columnas es común al
		 * libro entero.
		 *
		 * El número del día se conserva —la columna sigue siendo del día 5— y
		 * lo que cambia es la segunda línea, que es donde iba la información
		 * repetida.
		 */
		const repetida = (d.ocurrencia ?? 0) > 0;
		set(FILA.CAB_DIA, c, {
			v: d.dia,
			s: { ...cabecera(festivo ? FESTIVO_CABECERA : domingo ? '#7F1D1D' : GREEN), fs: 10 }
		});
		set(FILA.CAB_NOMBRE_DIA, c, {
			v: repetida ? `${(d.ocurrencia ?? 0) + 1}.º SERV` : d.nombreDia.slice(0, 3),
			s: {
				...cabecera(repetida ? SERVICIO_EXTRA : festivo ? '#92400E' : domingo ? '#991B1B' : SUBCAB),
				fs: repetida ? 7 : 9
			}
		});

		if (!dh) {
			// Día sin planilla: se deja en blanco, no en cero. Un cero diría
			// «trabajó cero horas» y lo que pasa es que no hay dato.
			continue;
		}

		set(FILA.TURNO, c, { v: 'T', s: { ...celdaDia(), ht: HorizontalAlign.CENTER } });
		set(FILA.INICIO, c, {
			v: horaTexto(dh.horaInicio),
			s: { ...celdaDia(), ht: HorizontalAlign.CENTER, fs: 9 }
		});
		set(FILA.FIN, c, {
			v: horaTexto(dh.horaFin),
			s: { ...celdaDia(), ht: HorizontalAlign.CENTER, fs: 9 }
		});
		set(FILA.HORAS, c, {
			v: redondear(dh.totalHoras),
			s: { ...celdaDia(), ht: HorizontalAlign.CENTER, bl: 1 }
		});

		// Disponibilidad: literal en los días de standby, cálculo en el resto.
		// Es la fila 10 del Excel (`horas − 7 − 3`), con las dos constantes
		// como dato del periodo y no clavadas en la fórmula.
		if (dh.disponibilidad) {
			set(FILA.DISPONIBILIDAD, c, {
				v: 'DISP',
				s: { ...celdaDia(), ht: HorizontalAlign.CENTER, fs: 9, cl: { rgb: MUTED }, bl: 1 }
			});
		} else {
			const { horasBase, horasDescuento } = dto.disponibilidad;
			set(FILA.DISPONIBILIDAD, c, {
				v: redondear(dh.totalHoras - horasBase - horasDescuento),
				s: { ...derivada(), ht: HorizontalAlign.CENTER, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
			});
		}

		// Las siete filas de recargo. El día se resalta con el color del tipo
		// cuando tiene horas de ese tipo — igual que en el Excel, donde el
		// color es lo que deja ver de un vistazo qué clase de recargo hubo.
		const tieneAlguno = ORDEN_RECARGOS.some((cod) => (dh.horas[cod] ?? 0) > 0);
		/**
		 * Las horas de cada día SE TECLEAN cuando el día es de la copia.
		 *
		 * El borrador tiene sus propios días desde que se genera, así que
		 * corregir una hora aquí ya no toca `recargos_planillas`. Un día que
		 * todavía se deriva de la planilla —liquidaciones anteriores a la copia,
		 * u hojas sin borrador— sigue siendo de solo lectura: no hay fila que
		 * escribir.
		 */
		const diaEditable = Boolean(dh.propio && hoja.liquidacionId);
		ORDEN_RECARGOS.forEach((codigo, i) => {
			const h = dh.horas[codigo] ?? 0;
			const color = colorRecargo[codigo];
			set(FILA.RECARGO0 + i, c, {
				v: h > 0 ? redondear(h) : '',
				s: {
					...base(),
					// Solo se pinta si el día tuvo recargos: así el bloque de
					// color marca los días con actividad y el resto queda limpio.
					...(tieneAlguno ? { bg: { rgb: color }, cl: { rgb: contraste(color) } } : {}),
					ht: HorizontalAlign.CENTER,
					...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}),
					fs: 9
				}
			});
			if (diaEditable) {
				bind(FILA.RECARGO0 + i, c, {
					entityType: 'liquidacion',
					entityId: hoja.liquidacionId!,
					// La celda se identifica por FECHA y OCURRENCIA, no por la
					// columna: la rejilla es global al libro y se corre cuando
					// otro conductor abre una columna nueva.
					field: `dia|${dh.fecha}|${dh.ocurrencia ?? 0}|${codigo}`,
					conductorId: hoja.conductorId
				});
			}
		});

		// Solo el COLOR del cliente, sin texto: el nombre no cabe en 46px y ya
		// está en la leyenda de abajo y en el desglose por empresa.
		if (dh.empresaColor) {
			set(FILA.CLIENTE_DIA, c, {
				v: '',
				s: { ...base(), bg: { rgb: dh.empresaColor } }
			});
		}

		// Y debajo, la placa de ESE día. Misma regla que el cliente —color y no
		// texto—, con la leyenda de la izquierda diciendo cuál es cuál. Juntas,
		// las dos filas contestan de un vistazo «¿para quién y con qué vehículo
		// trabajó cada día?», que antes había que reconstruir a mano.
		if (dh.placaColor) {
			set(FILA.PLACA_DIA, c, {
				v: '',
				s: { ...base(), bg: { rgb: dh.placaColor } }
			});
		}
	}

	// Total de horas del periodo, con fórmula viva: si alguien corrige una
	// celda de horas, el total sigue.
	const cIni = colLetra(COL.DIA0);
	const cFin = colLetra(COL.DIA0 + dias.length - 1);
	set(FILA.TOTALES_TURNO, COL.NOMBRE, { v: 'TOTAL HORAS DEL PERIODO', s: etiqueta() });
	merge(FILA.TOTALES_TURNO, COL.NOMBRE, FILA.TOTALES_TURNO, COL.ROTULOS);
	set(FILA.TOTALES_TURNO, COL.DIA0, {
		f: `=SUM(${cIni}${FILA.HORAS + 1}:${cFin}${FILA.HORAS + 1})`,
		s: { ...totales(), ht: HorizontalAlign.LEFT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
	});
	merge(FILA.TOTALES_TURNO, COL.DIA0, FILA.TOTALES_TURNO, COL.DIA0 + 3);

	leyendaClientes({ hoja, set, merge });
	leyendaPlacas({ hoja, set, merge, bind });
}

/**
 * Placas del periodo, en el hueco que dejan las filas de recargo.
 *
 * Las filas 11-18 tenían las columnas B-E vacías: los datos del conductor
 * ocupan solo hasta la fila 9 y los rótulos de recargo viven en la columna G.
 * Ocho filas de ancho útil sin usar, justo al lado de lo que hay que mirar.
 *
 * Ahí van las placas, una por fila, con su cuadro de color — el mismo que se
 * repite bajo cada día en la fila 19. Es lo que sustituye a la vieja columna
 * PLACA de la cabecera, que apilaba «PPQ491, LLQ895, SIN-PLACA, TSS965,
 * POP128» en una celda de dos columnas.
 *
 * Si hay más placas que filas disponibles, la última dice cuántas quedan fuera
 * en vez de desbordarse sobre los totales.
 */
function leyendaPlacas(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	bind: (r: number, c: number, binding: NominaBinding) => void;
}) {
	const { hoja, set, merge, bind } = args;
	const placas = hoja.placasUsadas ?? [];
	if (!placas.length) return;

	/// El bloque libre: de la primera fila de recargo a la de la placa.
	const PRIMERA = FILA.RECARGO0;
	/// Hasta la fila anterior a la separación: la tabla de bonos vive en las
	/// columnas A-E y podría seguir bajando, pero cruzar la banda en blanco la
	/// haría parecer parte del bloque de cliente y placa.
	const ULTIMA = FILA.CLIENTE_DIA - 1;
	/// Cuatro columnas (B-E) para los datos. Es un tope de la rejilla, no una
	/// decisión — un ancho es de la COLUMNA ENTERA y meter más aquí correría
	/// las de día y descuadraría las zonas de abajo.
	const COLS_DATO = COL.CARGO_FIN - COL.NOMBRE;

	const matriz = hoja.matrizBonos;

	// ── Sin bonos: la lista simple, que es lo que da sentido a los colores ──
	if (!matriz?.filas.length) {
		set(PRIMERA, COL.NOMBRE, {
			v: placas.length === 1 ? 'VEHÍCULO DEL PERIODO' : 'VEHÍCULOS DEL PERIODO',
			s: cabecera()
		});
		merge(PRIMERA, COL.NOMBRE, PRIMERA, COL.CARGO_FIN);

		const cabida = ULTIMA - PRIMERA;
		placas.slice(0, cabida).forEach((p, i) => {
			const r = PRIMERA + 1 + i;
			set(r, COL.NOMBRE, {
				v: p.placa,
				s: { ...base(), bg: { rgb: p.color }, cl: { rgb: contraste(p.color) }, bl: 1, ht: HorizontalAlign.CENTER, fs: 9 }
			});
			merge(r, COL.NOMBRE, r, COL.CARGO_FIN);
		});
		return;
	}

	/**
	 * Meses del corte: son las SUBCOLUMNAS de cada placa.
	 *
	 * Un corte 21→20 cruza dos, y hacen falta separados porque la celda se
	 * edita: `bonificaciones.values` guarda `[{ mes, quantity }]` y con un solo
	 * número no se sabría a cuál de los dos va lo que alguien teclea.
	 *
	 * El `['']` de reserva es para los snapshots anteriores a este desglose,
	 * que traen un total por placa y ningún mes: se pintan en una sola columna
	 * y, al no tener mes al que escribir, sin binding.
	 */
	const meses = matriz.meses?.length ? matriz.meses : [''];
	const conMeses = Boolean(matriz.meses?.length);

	/** Cantidades de una fila en una placa, tolerando el formato viejo. */
	const cantidadesDe = (celdas: unknown, i: number): number[] => {
		const fila = (celdas as any)?.[i];
		if (Array.isArray(fila)) return fila as number[];
		return [Number(fila ?? 0)];
	};

	/**
	 * Solo entran las placas CON bonos.
	 *
	 * La suma cuenta las dos fuentes: una placa que solo tiene bonos MARCADOS
	 * EN RECORRIDOS —y ninguno en la liquidación— es justo la que hay que ver,
	 * y mirando solo `cantidades` se quedaba fuera por venir a cero.
	 */
	const total = (fila: number[]) => fila.reduce((s, n) => s + n, 0);
	const conBonos = matriz.placas
		.map((p, i) => ({
			...p,
			i,
			suma: matriz.filas.reduce(
				(t, f) =>
					t + total(cantidadesDe(f.cantidades, i)) + total(cantidadesDe(f.cantidadesRecorridos, i)),
				0
			)
		}))
		.filter((p) => p.suma > 0)
		.sort((a, b) => b.suma - a.suma);

	/// Cada placa ocupa una columna POR MES, así que con dos meses caben dos
	/// placas donde antes cabían cuatro. Es el precio de poder editar mes a mes.
	const maxPlacas = Math.max(1, Math.floor(COLS_DATO / meses.length));
	const visibles = conBonos.slice(0, maxPlacas);
	const omitidas = conBonos.slice(maxPlacas);

	/**
	 * Solo se compara si el conductor tiene ALGO marcado en recorridos.
	 *
	 * Sin esta guarda, el caso corriente —nadie le ha marcado bonos en el canvas
	 * de recorridos— pintaría toda la tabla en amarillo contra una columna de
	 * ceros, que se lee como «la nómina está mal» cuando lo que pasa es que no
	 * hay con qué contrastar.
	 */
	const comparar = matriz.hayRecorridos === true;

	/// Columna de la subcelda (placa k, mes j).
	const colDe = (k: number, j: number) => COL.NOMBRE + 1 + k * meses.length + j;

	// ── Cabecera: el título comparte fila con las placas ──────────────────
	//
	// Antes el título tenía su propia fila. Con la fila de meses añadida ya no
	// cabían las cinco de bono, el total y las notas, y la nota del descuadre
	// —que es lo accionable— era lo primero en caerse.
	set(PRIMERA, COL.NOMBRE, { v: 'BONOS POR VEHÍCULO', s: cabecera() });
	visibles.forEach((p, k) => {
		// La placa conserva SU color también aquí: es la misma clave que se
		// repite bajo cada día en la fila 19, y romperla obligaría a aprenderse
		// dos códigos para lo mismo.
		const estilo = {
			...base(),
			bg: { rgb: p.color },
			cl: { rgb: contraste(p.color) },
			bl: 1,
			ht: HorizontalAlign.CENTER,
			fs: 8
		};
		set(PRIMERA, colDe(k, 0), { v: p.placa, s: estilo });
		for (let j = 1; j < meses.length; j++) set(PRIMERA, colDe(k, j), { v: '', s: estilo });
		if (meses.length > 1) merge(PRIMERA, colDe(k, 0), PRIMERA, colDe(k, meses.length - 1));
	});
	for (let c = colDe(visibles.length, 0); c <= COL.CARGO_FIN; c++) {
		set(PRIMERA, c, { v: '', s: cabecera() });
	}

	// ── Subcabecera: el mes de cada columna ───────────────────────────────
	const FILA_CAB = PRIMERA + 1;
	set(FILA_CAB, COL.NOMBRE, {
		v: 'BONO · VALOR UNITARIO',
		s: { ...cabecera(SUBCAB), ht: HorizontalAlign.LEFT, fs: 9 }
	});
	visibles.forEach((p, k) => {
		meses.forEach((m, j) => {
			set(FILA_CAB, colDe(k, j), {
				v: etiquetaMes(m),
				s: { ...cabecera(SUBCAB), ht: HorizontalAlign.CENTER, fs: 8 }
			});
		});
	});
	/// Las columnas que sobran se cierran igual: sin esto la tabla termina en un
	/// borde a media altura y parece cortada.
	for (let c = colDe(visibles.length, 0); c <= COL.CARGO_FIN; c++) {
		set(FILA_CAB, c, { v: '', s: cabecera(SUBCAB) });
	}

	/// Se reserva sitio para las notas del pie antes de repartir filas de bono:
	/// si no, la última nota se comería la fila de TOTAL BONOS o se saldría del
	/// bloque y caería sobre la banda en blanco.
	const hayDescuadre = comparar && matriz.filas.some((f) => f.descuadra);
	const notasPie = (hayDescuadre ? 1 : 0) + (omitidas.length ? 1 : 0);
	const filasCabida = ULTIMA - FILA_CAB - notasPie;

	// ── Cuerpo: una fila por bono ─────────────────────────────────────────
	matriz.filas.slice(0, filasCabida).forEach((f, i) => {
		const r = FILA_CAB + 1 + i;
		const zebra = i % 2 === 1;
		set(r, COL.NOMBRE, {
			v: `${f.nombre}  ·  ${formatoCOP(f.valorUnitario)}`,
			s: { ...(zebra ? derivada() : base()), ht: HorizontalAlign.LEFT, fs: 8 }
		});
		visibles.forEach((p, k) => {
			const cant = cantidadesDe(f.cantidades, p.i);
			const rec = cantidadesDe(f.cantidadesRecorridos, p.i);
			meses.forEach((m, j) => {
				const n = cant[j] ?? 0;
				const nRec = rec[j] ?? 0;
				const difiere = comparar && n !== nRec;
				/// Editable solo si se puede direccionar la fila de
				/// `bonificaciones`: hace falta liquidación, vehículo y mes. La
				/// columna «sin placa» no tiene vehículo y por eso no se toca.
				const editableAqui = Boolean(conMeses && hoja.liquidacionId && p.vehiculoId);
				const fondo = editableAqui ? editable() : zebra ? derivada() : base();
				set(r, colDe(k, j), {
					// Un cero se deja en blanco: la tabla tiene más ceros que datos
					// y llenarla de ceros esconde lo que sí pasó. Pero un cero que
					// DIFIERE de recorridos sí se escribe: «0 → 3» es el descuadre
					// más grave que hay y en blanco sería el más invisible.
					v: difiere ? `${n} → ${nRec}` : n > 0 ? n : '',
					s: {
						...fondo,
						ht: HorizontalAlign.CENTER,
						fs: difiere ? 8 : 9,
						...(n > 0 || difiere ? { bl: 1 } : {}),
						...(difiere ? { bg: { rgb: FESTIVO_BG }, cl: { rgb: FESTIVO_TEXTO } } : {})
					}
				});
				if (editableAqui) {
					bind(r, colDe(k, j), {
						entityType: 'liquidacion',
						entityId: hoja.liquidacionId!,
						field: `bono|${p.vehiculoId}|${m}|${f.nombre}`,
						conductorId: hoja.conductorId
					});
				}
			});
		});
		for (let c = colDe(visibles.length, 0); c <= COL.CARGO_FIN; c++) {
			set(r, c, { v: '', s: zebra ? derivada() : base() });
		}
	});

	// ── Pie: totales por placa y mes ──────────────────────────────────────
	const filasPintadas = Math.min(matriz.filas.length, filasCabida);
	const rTotal = FILA_CAB + 1 + filasPintadas;
	if (rTotal <= ULTIMA) {
		set(rTotal, COL.NOMBRE, { v: 'TOTAL BONOS', s: { ...totales(), ht: HorizontalAlign.LEFT, fs: 8 } });
		visibles.forEach((p, k) => {
			meses.forEach((m, j) => {
				const suma = matriz.filas.reduce((t, f) => t + (cantidadesDe(f.cantidades, p.i)[j] ?? 0), 0);
				set(rTotal, colDe(k, j), {
					v: suma > 0 ? suma : '',
					s: { ...totales(), ht: HorizontalAlign.CENTER, fs: 9 }
				});
			});
		});
		for (let c = colDe(visibles.length, 0); c <= COL.CARGO_FIN; c++) {
			set(rTotal, c, { v: '', s: totales() });
		}
	}

	/// Las dos notas del pie comparten las filas que queden, en orden: primero
	/// el descuadre, que es accionable, y después las placas sin columna.
	let rNota = rTotal + 1;
	const nota = (texto: string) => {
		if (rNota > ULTIMA) return;
		set(rNota, COL.NOMBRE, {
			v: texto,
			s: { ...base(), ht: HorizontalAlign.LEFT, fs: 8, cl: { rgb: FESTIVO_TEXTO }, bg: { rgb: FESTIVO_BG } }
		});
		merge(rNota, COL.NOMBRE, rNota, COL.CARGO_FIN);
		rNota++;
	};

	// ── Aviso de descuadre con lo marcado en recorridos ────────────────────
	//
	// Sin esta línea, un «14 → 16» en una celda amarilla no dice de dónde sale
	// el segundo número.
	if (hayDescuadre) {
		nota('liquidación → marcado en recorridos');
	}

	// ── Aviso SOLO si se queda fuera una placa que sí tiene bonos ──────────
	if (omitidas.length) {
		nota(`Con bonos y sin columna: ${omitidas.map((p) => p.placa).join(', ')}`);
	}
}

/** `2026-08` → `AGO`. Cabe en una columna de 105 px, que el mes entero no. */
function etiquetaMes(mes: string): string {
	const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
	const n = Number(mes.slice(5, 7));
	return MESES[n - 1] ?? mes;
}

/** `$26.061` — el precio unitario del bono, corto para que quepa en la celda. */
function formatoCOP(n: number): string {
	return `$${Math.round(n).toLocaleString('es-CO')}`;
}

/**
 * Leyenda de clientes: de izquierda a derecha, dos celdas para el nombre y
 * una para el color, con una celda en blanco entre item e item.
 *
 * Va aquí y no en un panel aparte porque la fila 18 solo lleva color: sin
 * leyenda, esos colores no significan nada. Solo se listan los clientes de
 * ESTA hoja; el color sí es del periodo, así que comparar entre conductores
 * sigue funcionando.
 */
function leyendaClientes(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
}) {
	const { hoja, set, merge } = args;
	if (!hoja.clientes?.length) return;

	const r = FILA.LEYENDA;
	set(r, COL.NOMBRE, { v: 'CLIENTES', s: { ...etiqueta(), ht: HorizontalAlign.RIGHT } });

	/// nombre (2) + color (1) + hueco (1)
	const PASO = 4;
	let c = COL.DIA0;
	for (const cliente of hoja.clientes) {
		set(r, c, {
			// Alineado a la IZQUIERDA: dos columnas de día son ~92px y casi
			// ningún nombre de cliente cabe. Alineado a la derecha se recortaba
			// por delante —«FIPETROL S.A.S» por CONFIPETROL— que es justo la
			// parte que lo identifica.
			v: nombreCortoCliente(cliente.nombre),
			s: { ...base(), fs: 8, ht: HorizontalAlign.LEFT }
		});
		merge(r, c, r, c + 1);
		set(r, c + 2, { v: '', s: { ...base(), bg: { rgb: cliente.color } } });
		c += PASO;
	}
}

/**
 * El nombre del cliente sin su forma jurídica.
 *
 * «FEPCO SERVICIOS S.A.S» y «MCS CONSULTORIA Y MONITOREO AMBIENTAL S. A. S.»
 * no caben en dos columnas, y lo que sobra —el S.A.S— es justo lo que no
 * distingue a un cliente de otro. El nombre completo sigue en el bloque de
 * desglose por empresa.
 */
function nombreCortoCliente(nombre: string): string {
	return nombre
		.replace(/\s*\b(S\.?\s?A\.?\s?S\.?|S\.?A\.?|LTDA\.?|SAS|SUCURSAL\s+COLOMBIA)\s*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// ─── Zona B: configuración y acumulado ────────────────────────────────

function zonaConfiguracion(args: {
	hoja: HojaNominaDTO;
	/// La rejilla del libro, para que HORAS MES sume las columnas de su tramo.
	dias: DiaPeriodoDTO[];
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	/// Las horas de recargo se corrigen a mano desde aquí; sin binding el
	/// permiso de celda las bloquea por defecto.
	bind: (r: number, c: number, binding: NominaBinding) => void;
}): { fin: number; celdaSalarioBasico: string | null } {
	const { hoja, dias, set, merge, bind } = args;
	/** Ajustes pintados, para la nota de debajo de la tabla. */
	const ajustes: string[] = [];
	const c0 = ZONA.CONFIG_C0;
	let r = FILA_INFERIOR;

	set(r, c0, { v: 'LIQUIDACIÓN DE HORAS EXTRAS Y RECARGOS', s: cabecera() });
	merge(r, c0, r, c0 + 5);
	r++;

	// UN SUB-BLOQUE POR TRAMO DE VIGENCIA.
	//
	// Con un tramo —lo normal— esto pinta exactamente la tabla de siempre. Con
	// dos, que es lo que pasa cuando el corte cruza un cambio de ley (el
	// 21-jun → 20-jul de 2026 cruza la Ley 2466), se pinta dos veces: cada
	// mitad con su propia base y sus propias tarifas. Antes había una sola
	// tabla con la configuración del CIERRE, así que los días de junio salían
	// valorados a 210 h base y RD al 90 %.
	const tramos: TramoVigenciaDTO[] = hoja.tramos?.length
		? hoja.tramos
		: [
				{
					desde: '',
					hasta: '',
					etiqueta: '',
					salarioBasico: hoja.salarioBasico,
					horasMensualesBase: hoja.horasMensualesBase,
					valorHora: hoja.valorHora
				}
			];
	const partido = tramos.length > 1;

	const L = (c: number) => colLetra(c);
	/** Rangos de filas de tarifa, para que TOTALES sume los dos sub-bloques. */
	const rangos: [number, number][] = [];
	/**
	 * Dirección A1 de la celda del básico, para que el desprendible escriba su
	 * SALARIO como fórmula contra ella en vez de repetir la cifra.
	 *
	 * `null` en una hoja sin liquidación —no hay nada que teclear— y el
	 * desprendible cae entonces en el importe del servidor.
	 */
	let celdaSalarioBasico: string | null = null;

	/**
	 * Columnas de empresa: se fijan con las bases del PRIMER tramo y valen para
	 * todos.
	 *
	 * Una columna es de la tabla entera, no de un sub-bloque: si cada tramo
	 * eligiera las suyas, con dos tramos la misma columna diría «PAREX» arriba
	 * y «GEOPARK» abajo. Los valores de cada tramo se buscan después por
	 * `empresaId`, no por posición, para que un tramo al que le falte una
	 * empresa deje su celda vacía en vez de correr las demás.
	 */
	const CUPO_BASES = ZONA.JORNADA_C0 - (ZONA.CONFIG_C0 + 6);
	const basesColumnas = (tramos[0]?.bases ?? [])
		.filter((b) => b.empresaId)
		.slice(0, Math.max(0, CUPO_BASES));

	tramos.forEach((tr, iTramo) => {
		// El rótulo del tramo solo aparece cuando hay más de uno: si no, sería
		// ruido repitiendo el periodo que ya está en el título de la pestaña.
		if (partido) {
			set(r, c0, { v: tr.etiqueta, s: cabecera(SUBCAB) });
			merge(r, c0, r, c0 + 5);
			r++;
		}

		/**
		 * Base de cálculo, que es lo que hace comprensible todo lo de abajo.
		 *
		 * EL «SALARIO BÁSICO» DE AQUÍ ES EL DEL DESPRENDIBLE Y SE TECLEA.
		 *
		 * Antes enseñaba el de `configuraciones_salario` —la base de la
		 * empresa— mientras el desprendible dividía entre 30 el de la ficha del
		 * conductor. Eran dos cifras distintas con el mismo nombre, y la de
		 * arriba no se podía tocar: para subirle el sueldo a una persona en un
		 * corte había que editar su ficha, con lo que se movía cualquier otro
		 * corte que se reabriera.
		 *
		 * El VALOR HORA sigue saliendo de la configuración de la empresa, y con
		 * él los siete recargos: el básico de una persona no re-precia la hora
		 * extra de la tabla. Por eso, cuando las dos cifras dejan de coincidir,
		 * se pinta la de la empresa en su propia fila: si no, la división
		 * `básico / horas` no daría el valor hora de al lado y la tabla
		 * parecería mal sumada.
		 */
		const basicoDesprendible = hoja.salarioBasicoDesprendible ?? tr.salarioBasico;
		const difiereDeLaEmpresa = redondear(basicoDesprendible) !== redondear(tr.salarioBasico);

		const baseInfo: [string, number, string | undefined, boolean][] = [
			['Salario básico', basicoDesprendible, FMT_COP, true],
			...(difiereDeLaEmpresa
				? ([['Base de recargos (empresa)', tr.salarioBasico, FMT_COP, false]] as [
						string,
						number,
						string | undefined,
						boolean
					][])
				: []),
			// Las horas van sin patrón (ver FMT_HORAS).
			['Horas mensuales base', tr.horasMensualesBase, FMT_HORAS, false],
			['Valor hora', tr.valorHora, FMT_COP, false]
		];
		for (const [rotulo, valor, fmt, esBasico] of baseInfo) {
			/**
			 * Se teclea SOLO en el primer tramo.
			 *
			 * El básico es uno por liquidación y los tramos son subperiodos de
			 * la misma: dos celdas editables escribirían el mismo campo y la
			 * segunda pisaría a la primera sin que se viera cuál ganó.
			 */
			const editaAqui = esBasico && iTramo === 0 && !!hoja.liquidacionId;
			set(r, c0, { v: rotulo, s: etiqueta() });
			merge(r, c0, r, c0 + 2);
			set(r, c0 + 3, {
				v: redondear(valor),
				s: {
					...(editaAqui ? editable() : derivada()),
					ht: HorizontalAlign.RIGHT,
					...(fmt ? { n: { pattern: fmt } } : {})
				}
			});
			merge(r, c0 + 3, r, c0 + 5);
			if (editaAqui) {
				celdaSalarioBasico = `${L(c0 + 3)}${r + 1}`;
				bind(r, c0 + 3, {
					entityType: 'liquidacion',
					entityId: hoja.liquidacionId!,
					field: 'salario_basico',
					conductorId: hoja.conductorId
				});
			}
			r++;
		}
		r++;

		/**
		 * Columnas extra: el MISMO recargo valorado con la base salarial de cada
		 * cliente que tiene configuración propia.
		 *
		 * Un conductor que trabaja con Parex genera el recargo sobre un básico de
		 * 2.358.897 y no sobre los 1.750.905 de la general, y hasta ahora esa
		 * segunda cifra no se veía por ningún lado: había que sacarla del Excel.
		 * Caben porque entre el bloque de configuración (termina en la columna 5)
		 * y el de jornada (empieza en la 10) hay cuatro columnas libres.
		 */
		/**
		 * Columnas de día que caen dentro de ESTE tramo: son las que suma
		 * HORAS MES. Con un tramo único son todas.
		 */
		const columnasTramo = dias
			.filter((d) => !tr.desde || (d.fecha >= tr.desde && d.fecha <= tr.hasta))
			.map((d) => COL.DIA0 + d.indice);

		const extra = basesColumnas;
		/** Dónde está cada columna dentro de las bases de ESTE tramo. */
		const indiceEnTramo = extra.map((b) =>
			(tr.bases ?? []).findIndex((x) => x.empresaId === b.empresaId)
		);

		const cabeceras = ['RECARGO', '%', 'VALOR HORA', 'HORAS MES', 'VALOR'];
		cabeceras.forEach((t, i) => {
			const c = i === 0 ? c0 : c0 + i + 1;
			set(r, c, { v: t, s: cabecera(SUBCAB) });
			if (i === 0) merge(r, c0, r, c0 + 1);
		});
		extra.forEach((b, i) => {
			set(r, c0 + 6 + i, {
				// El nombre entero no cabe en 104 px; la primera palabra basta para
				// distinguir «PAREX» de «SERTECPET».
				// Sin `fs` propio: `base()` fija 10 y estas columnas tienen que
				// leerse igual que VALOR, que está justo al lado. Con 8 se veían
				// como una nota al pie de la tabla en vez de como otra columna.
				v: `$ ${b.nombre.split(/\s+/)[0].slice(0, 12)}`,
				s: cabecera('#3F3F46')
			});
		});
		r++;

		const primeraTarifa = r;
		for (const codigo of ORDEN_RECARGOS) {
			// `tramo ?? 0` deja pasar los payloads viejos, que no lo traían.
			const t = hoja.tarifas.find((x) => x.codigo === codigo && (x.tramo ?? 0) === iTramo);
			if (!t) continue;
			set(r, c0, {
				v: t.nombre,
				s: { ...base(), bg: { rgb: t.color }, cl: { rgb: contraste(t.color) }, bl: 1, fs: 9 }
			});
			merge(r, c0, r, c0 + 1);
			set(r, c0 + 2, { v: t.porcentaje, s: { ...derivada(), ht: HorizontalAlign.CENTER, n: { pattern: FMT_PCT } } });
			set(r, c0 + 3, { v: redondear(t.valorHora), s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } } });
			/**
			 * HORAS MES se teclea, y por eso sigue siendo un NÚMERO aunque esté
			 * ajustada.
			 *
			 * Aquí no cabe el «30 → 32» que sí usan los bonos: esta columna la
			 * suma la fila TOTALES con un `=SUM()`, y una celda de texto cuenta
			 * como cero y descuadraría el total. Así que la celda lleva la cifra
			 * que se paga, se resalta en ámbar cuando viene de un ajuste, y el
			 * valor de la planilla se dice en la nota de debajo de la tabla.
			 */
			const ajustada = t.ajustada === true;
			if (ajustada) {
				ajustes.push(`${t.codigo} ${redondear(t.horasPlanilla ?? t.horas)} → ${redondear(t.horas)}`);
			}
			/**
			 * Sin ajuste, HORAS MES es la SUMA VIVA de las columnas de día del
			 * tramo: corregir una hora arriba mueve esta celda, y con ella
			 * VALOR, las columnas de empresa y los TOTALES, sin recargar.
			 *
			 * Con ajuste sigue siendo el número tecleado. Las dos cosas conviven
			 * sin contradecirse porque teclear encima de una fórmula la sustituye
			 * —que es exactamente lo que significa ajustar— y el patch
			 * `horas|tramo|codigo` que sale de ahí la vuelve ámbar al recargar.
			 */
			const estiloHoras: IStyleData = {
				...(ajustada ? base() : derivada()),
				ht: HorizontalAlign.RIGHT,
				...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}),
				...(ajustada ? { bg: { rgb: FESTIVO_BG }, cl: { rgb: FESTIVO_TEXTO }, bl: 1 } : {})
			};
			const fHoras = ajustada ? null : formulaHoras(t.codigo, columnasTramo);
			set(r, c0 + 4, fHoras ? { f: fHoras, s: estiloHoras } : { v: redondear(t.horas), s: estiloHoras });
			if (hoja.liquidacionId) {
				bind(r, c0 + 4, {
					entityType: 'liquidacion',
					entityId: hoja.liquidacionId,
					field: `horas|${iTramo}|${t.codigo}`,
					conductorId: hoja.conductorId
				});
			}
			/**
			 * VALOR y las columnas de empresa cuelgan de HORAS MES, no del
			 * número que mandó el servidor: así el importe sigue a las horas
			 * vengan de donde vengan —de los días o de un ajuste tecleado— y no
			 * hay forma de que la fila diga 32 horas y cobre 30.
			 *
			 * VALOR apunta a la celda de VALOR HORA que tiene al lado, que es lo
			 * que hace el Excel y deja la cuenta a la vista. Las columnas de
			 * empresa llevan su tarifa dentro de la fórmula porque ninguna celda
			 * la enseña: son el mismo recargo sobre la base de ese cliente.
			 */
			const refHoras = `${L(c0 + 4)}${r + 1}`;
			set(r, c0 + 5, {
				f: `=ROUND(${refHoras}*${L(c0 + 3)}${r + 1},0)`,
				s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
			});
			/// El índice +1 salta la base general, que ya es la columna VALOR.
			extra.forEach((_, i) => {
				const j = indiceEnTramo[i];
				const vhBase = j >= 0 ? (t.valorHoraPorBase?.[j] ?? null) : null;
				const estilo = { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } };
				set(
					r,
					c0 + 6 + i,
					vhBase ? { f: `=ROUND(${refHoras}*${vhBase},0)`, s: estilo } : { v: '', s: estilo }
				);
			});
			r++;
		}
		if (r > primeraTarifa) rangos.push([primeraTarifa + 1, r]);
	});

	// Con dos tramos el SUM lleva dos rangos: `=SUM(S30:S36,S41:S47)`.
	const sumaDe = (c: number) =>
		rangos.length
			? `=SUM(${rangos.map(([a, b]) => `${L(c)}${a}:${L(c)}${b}`).join(',')})`
			: '=0';

	set(r, c0, { v: 'TOTALES', s: totales() });
	merge(r, c0, r, c0 + 3);
	set(r, c0 + 4, {
		f: sumaDe(c0 + 4),
		s: { ...totales(), ht: HorizontalAlign.RIGHT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
	});
	set(r, c0 + 5, {
		f: sumaDe(c0 + 5),
		s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	/// Las columnas de empresa se totalizan igual que VALOR: sin esto, la fila
	/// TOTALES se cortaba a media tabla y las dos cifras que se comparan con el
	/// Excel —lo que costaría a tarifa de cada cliente— había que sumarlas a
	/// mano.
	basesColumnas.forEach((_, i) => {
		set(r, c0 + 6 + i, {
			f: sumaDe(c0 + 6 + i),
			s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
		});
	});

	// ── Qué decía la planilla antes del ajuste ────────────────────────────
	//
	// Sin esta línea, una celda ámbar dice que alguien tocó las horas pero no
	// cuántas había, y deshacer el ajuste sería a ciegas.
	if (ajustes.length) {
		r++;
		set(r, c0, {
			v: `Horas ajustadas a mano (planilla → pagado): ${ajustes.join(' · ')}. Vacía la celda para volver a la planilla.`,
			s: { ...base(), fs: 8, cl: { rgb: FESTIVO_TEXTO }, bg: { rgb: FESTIVO_BG } }
		});
		merge(r, c0, r, c0 + 5);
	}

	return { fin: r, celdaSalarioBasico };
}

// ─── Zona C: desglose por empresa ─────────────────────────────────────

function zonaEmpresas(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	desdeFila: number;
}): number {
	const { hoja, set, merge, desdeFila } = args;
	const c0 = ZONA.CONFIG_C0;
	let r = desdeFila;
	const ajustados = codigosAjustados(hoja);

	set(r, c0, { v: 'RECARGOS Y HORAS EXTRAS POR EMPRESA', s: cabecera() });
	merge(r, c0, r, c0 + 5);
	r += 1;

	if (!hoja.bloquesEmpresa.length) {
		set(r, c0, { v: 'Sin planillas en el periodo.', s: { ...base(), cl: { rgb: MUTED } } });
		merge(r, c0, r, c0 + 5);
		return r;
	}

	// Un bloque por (empresa, mes). En el Excel esto estaba limitado a siete
	// bloques fijos; aquí se generan los que haya.
	for (const b of hoja.bloquesEmpresa) {
		set(r, c0, { v: b.empresa, s: cabecera(SUBCAB) });
		merge(r, c0, r, c0 + 3);
		// Los días agrupados en texto: «7, 13 AL 19 DE AGOSTO DE 2026».
		set(r, c0 + 4, { v: b.textoDias, s: { ...cabecera(SUBCAB), ht: HorizontalAlign.LEFT, fs: 9 } });
		merge(r, c0 + 4, r, c0 + 5);
		r++;

		/**
		 * Los días de ESTE bloque: los de esta empresa dentro de su mes.
		 *
		 * Se cruza por `empresaId` y por el mes de la fecha, que es la misma
		 * pareja con la que el servidor agrupa. Un bloque es (empresa, mes), así
		 * que FEPCO aparece dos veces en un corte que cruza dos meses y cada
		 * copia suma solo sus columnas.
		 */
		const diasDelBloque = hoja.dias.filter(
			(d) =>
				d.empresaId === b.empresaId &&
				Number(d.fecha.slice(0, 4)) === b.anio &&
				Number(d.fecha.slice(5, 7)) === b.mes
		);
		const columnasBloque = diasDelBloque.map((d) => COL.DIA0 + d.indice);

		const primera = r;
		for (const linea of b.lineas) {
			const t = hoja.tarifas.find((x) => x.codigo === linea.codigo);
			set(r, c0, { v: linea.nombre, s: { ...base(), fs: 9 } });
			merge(r, c0, r, c0 + 2);
			set(r, c0 + 3, {
				v: '',
				s: { ...base(), bg: { rgb: t?.color ?? '#E2E8F0' } }
			});
			/// Un código con las horas corregidas a mano no sale de los días:
			/// el ajuste es un agregado y no sabe a qué empresa tocarle.
			const vivo = !ajustados.has(linea.codigo);
			const fHoras = vivo ? formulaHoras(linea.codigo, columnasBloque) : null;
			const fValor = vivo
				? formulaImporte(
						linea.codigo,
						/// A la tarifa de ESTE cliente, no a la general: es su bloque.
						gruposPorTramo(hoja, linea.codigo, diasDelBloque, b.empresaId)
					)
				: null;
			const estiloHoras = {
				...derivada(),
				ht: HorizontalAlign.RIGHT,
				...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {})
			};
			const estiloValor = { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } };
			set(r, c0 + 4, fHoras ? { f: fHoras, s: estiloHoras } : { v: redondear(linea.horas), s: estiloHoras });
			set(r, c0 + 5, fValor ? { f: fValor, s: estiloValor } : { v: linea.valor, s: estiloValor });
			r++;
		}

		const L = (c: number) => colLetra(c);
		set(r, c0, { v: 'TOTAL', s: totales() });
		merge(r, c0, r, c0 + 3);
		set(r, c0 + 4, {
			f: `=SUM(${L(c0 + 4)}${primera + 1}:${L(c0 + 4)}${r})`,
			s: { ...totales(), ht: HorizontalAlign.RIGHT, ...(FMT_HORAS ? { n: { pattern: FMT_HORAS } } : {}) }
		});
		set(r, c0 + 5, {
			f: `=SUM(${L(c0 + 5)}${primera + 1}:${L(c0 + 5)}${r})`,
			s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
		});
		r += 2;
	}

	return r;
}

// ─── Zona D: control de jornada ───────────────────────────────────────

/**
 * Dónde quedó cada cifra del reparto, para que el desprendible apunte a ellas
 * en vez de repetir el número.
 *
 * Las siete líneas de OTROS del desprendible SON el reparto de desprendible:
 * mismas horas, mismo importe. Pintarlas dos veces con dos números fijos era
 * dejar abierta la puerta a que dijeran cosas distintas.
 */
interface CeldasReparto {
	/** `codigo → { horas, valor }`, en referencias de celda («N40», «P40»). */
	porCodigo: Map<CodigoRecargo, { horas: string; valor: string }>;
	/**
	 * Aquí vivía `totalDisponibilidad`, la celda del total de la columna de
	 * standby, a la que apuntaba la línea DISPONIBILIDAD MES del desprendible.
	 * Se quitó porque ese total vale cero siempre —un día de disponibilidad no
	 * genera recargos, así que no hay horas que valorar— y la línea enseñaba
	 * $0 aunque la liquidación tuviera su importe. El importe se teclea y sale
	 * de `liquidaciones.disponibilidad`; la columna de HORAS sigue en su sitio.
	 */
}

function zonaJornada(args: {
	dto: PeriodoNominaDTO;
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
}): CeldasReparto {
	const { dto, hoja, set, merge } = args;
	const c0 = ZONA.JORNADA_C0;
	let r = FILA_INFERIOR;

	/** Escribe una celda que ocupa `span` columnas. Devuelve la siguiente libre. */
	const campo = (fila: number, col: number, span: number, cell: ICellData): number => {
		set(fila, col, cell);
		if (span > 1) merge(fila, col, fila, col + span - 1);
		return col + span;
	};

	const L = (c: number) => colLetra(c);

	campo(r, c0, SPAN.JORNADA_TITULO, { v: 'CONTROL DE JORNADA', s: cabecera() });
	r++;

	const topes: [string, number][] = [
		['Horas semanales', dto.topes.horasSemanales],
		['Horas máximas mensuales', dto.topes.horasMensuales],
		['Tope horas extras mes', dto.topes.horasExtrasMes]
	];
	for (const [rotulo, valor] of topes) {
		let c = campo(r, c0, SPAN.JORNADA_LABEL, { v: rotulo, s: etiqueta() });
		campo(r, c, SPAN.JORNADA_VALOR, {
			v: valor,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT }
		});
		r++;
	}

	/**
	 * Extras del trabajador contra el tope, y el margen que queda.
	 *
	 * Los tres topes de arriba son constantes de la ley; sin contrastarlos con
	 * lo que esta persona lleva acumulado no dicen nada de ESTA hoja. El Excel
	 * lo resuelve con dos filas (`TOTAL HORAS EXTRAS EN EL MES - TRABAJADOR` y
	 * `DIFERENCIA DE HORAS EXTRAS`) y es de lo primero que se mira, porque
	 * pasarse del tope es un problema legal, no de cuadre.
	 *
	 * Solo cuentan las CUATRO clases de hora extra. Los recargos (RN, RD, RNDF)
	 * no son horas extra: son el mismo tiempo pagado con recargo, y sumarlos
	 * daría un exceso que no existe.
	 */
	const CODIGOS_EXTRA: CodigoRecargo[] = ['HEN', 'HED', 'HEFD', 'HEFN'];
	const horasExtra = (hoja.tarifas ?? [])
		.filter((x) => CODIGOS_EXTRA.includes(x.codigo))
		.reduce((s, x) => s + (x.horas ?? 0), 0);
	const margen = dto.topes.horasExtrasMes - horasExtra;

	let cx = campo(r, c0, SPAN.JORNADA_LABEL, { v: 'Horas extras del trabajador', s: etiqueta() });
	campo(r, cx, SPAN.JORNADA_VALOR, {
		v: redondear(horasExtra),
		s: { ...derivada(), ht: HorizontalAlign.RIGHT }
	});
	r++;

	cx = campo(r, c0, SPAN.JORNADA_LABEL, { v: 'Margen hasta el tope', s: etiqueta() });
	campo(r, cx, SPAN.JORNADA_VALOR, {
		v: redondear(margen),
		s: {
			...derivada(),
			ht: HorizontalAlign.RIGHT,
			bl: 1,
			/// En rojo cuando se pasó del tope. Un número negativo entre otros
			/// positivos se lee como un dato más si no cambia de color.
			...(margen < 0
				? { bg: { rgb: '#FEE2E2' }, cl: { rgb: '#991B1B' } }
				: { cl: { rgb: TEXTO_MARCA } })
		}
	});
	r++;
	r++;

	let c = campo(r, c0, SPAN.JORNADA_LABEL, { v: 'SEMANA', s: cabecera(SUBCAB) });
	const colHoras = c;
	campo(r, c, SPAN.JORNADA_VALOR, { v: 'HORAS', s: cabecera(SUBCAB) });
	r++;

	const primera = r;
	for (const semana of dto.periodo.semanas) {
		campo(r, c0, SPAN.JORNADA_LABEL, { v: semana.etiqueta, s: { ...base(), fs: 9 } });
		// Fórmula viva sobre las columnas de esa semana en la fila de horas:
		// si se corrige un día, el total semanal se mueve solo.
		const cIni = colLetra(COL.DIA0 + semana.indices[0]);
		const cFin = colLetra(COL.DIA0 + semana.indices[semana.indices.length - 1]);
		campo(r, colHoras, SPAN.JORNADA_VALOR, {
			f: `=SUM(${cIni}${FILA.HORAS + 1}:${cFin}${FILA.HORAS + 1})`,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT }
		});
		r++;
	}

	campo(r, c0, SPAN.JORNADA_LABEL, { v: 'TOTAL', s: totales() });
	campo(r, colHoras, SPAN.JORNADA_VALOR, {
		f: `=SUM(${L(colHoras)}${primera + 1}:${L(colHoras)}${r})`,
		s: { ...totales(), ht: HorizontalAlign.RIGHT }
	});
	r += 2;

	// Reparto entre lo que se paga en el desprendible y lo que se imputa a
	// disponibilidad. Es la parte central del Excel (cols N-S).
	c = campo(r, c0, SPAN.REPARTO_COD, { v: 'RECARGO', s: cabecera(SUBCAB) });
	const colDespH = c;
	c = campo(r, c, SPAN.REPARTO_HORAS, { v: 'DESPRENDIBLE', s: cabecera(SUBCAB) });
	const colDespV = c;
	c = campo(r, c, SPAN.REPARTO_VALOR, { v: '$', s: cabecera(SUBCAB) });
	const colDispH = c;
	c = campo(r, c, SPAN.REPARTO_HORAS, { v: 'DISPONIBILIDAD', s: cabecera(SUBCAB) });
	const colDispV = c;
	campo(r, c, SPAN.REPARTO_VALOR, { v: '$', s: cabecera(SUBCAB) });
	r++;

	/**
	 * El reparto sale del DÍA: si está marcado como standby, sus horas van a
	 * disponibilidad; si no, al desprendible. Es el mismo criterio que aplica
	 * el servidor, así que las dos columnas se pueden sumar aquí mismo.
	 */
	const ajustados = codigosAjustados(hoja);
	const diasDesprendible = hoja.dias.filter((d) => !d.disponibilidad);
	const diasDisponibilidad = hoja.dias.filter((d) => d.disponibilidad);
	const porCodigo = new Map<CodigoRecargo, { horas: string; valor: string }>();

	const primeraReparto = r;
	for (const codigo of ORDEN_RECARGOS) {
		const desp = hoja.repartoDesprendible.find((x) => x.codigo === codigo);
		const disp = hoja.repartoDisponibilidad.find((x) => x.codigo === codigo);
		const t = hoja.tarifas.find((x) => x.codigo === codigo);
		const colorTipo = t?.color ?? '#E2E8F0';
		/// Con las horas corregidas a mano el servidor desplaza el importe del
		/// desprendible sobre el agregado, y eso no se deduce de los días.
		const vivo = !ajustados.has(codigo);

		campo(r, c0, SPAN.REPARTO_COD, {
			v: codigo,
			s: {
				...base(),
				bg: { rgb: colorTipo },
				cl: { rgb: contraste(colorTipo) },
				bl: 1,
				ht: HorizontalAlign.CENTER
			}
		});
		const numero = { ...derivada(), ht: HorizontalAlign.RIGHT };
		const moneda = { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } };
		const celda = (formula: string | null, valor: number, s: IStyleData): ICellData =>
			vivo && formula ? { f: formula, s } : { v: valor, s };

		campo(
			r,
			colDespH,
			SPAN.REPARTO_HORAS,
			celda(formulaHoras(codigo, diasDesprendible.map((d) => COL.DIA0 + d.indice)), redondear(desp?.horas ?? 0), numero)
		);
		campo(
			r,
			colDespV,
			SPAN.REPARTO_VALOR,
			celda(formulaImporte(codigo, gruposPorTramo(hoja, codigo, diasDesprendible)), desp?.valor ?? 0, moneda)
		);
		campo(
			r,
			colDispH,
			SPAN.REPARTO_HORAS,
			celda(formulaHoras(codigo, diasDisponibilidad.map((d) => COL.DIA0 + d.indice)), redondear(disp?.horas ?? 0), numero)
		);
		campo(
			r,
			colDispV,
			SPAN.REPARTO_VALOR,
			celda(formulaImporte(codigo, gruposPorTramo(hoja, codigo, diasDisponibilidad)), disp?.valor ?? 0, moneda)
		);
		porCodigo.set(codigo, {
			horas: `${L(colDespH)}${r + 1}`,
			valor: `${L(colDespV)}${r + 1}`
		});
		r++;
	}

	campo(r, c0, SPAN.REPARTO_COD, { v: 'TOTAL', s: totales() });
	for (const [col, span, esMoneda] of [
		[colDespH, SPAN.REPARTO_HORAS, false],
		[colDespV, SPAN.REPARTO_VALOR, true],
		[colDispH, SPAN.REPARTO_HORAS, false],
		[colDispV, SPAN.REPARTO_VALOR, true]
	] as [number, number, boolean][]) {
		campo(r, col, span, {
			f: `=SUM(${L(col)}${primeraReparto + 1}:${L(col)}${r})`,
			s: {
				...totales(),
				ht: HorizontalAlign.RIGHT,
				...(esMoneda ? { n: { pattern: FMT_COP } } : {})
			}
		});
	}

	return { porCodigo };
}

// ─── Zona E: desprendible ─────────────────────────────────────────────

function zonaDesprendible(args: {
	hoja: HojaNominaDTO;
	set: (r: number, c: number, cell: ICellData) => void;
	merge: (r1: number, c1: number, r2: number, c2: number) => void;
	bind: (r: number, c: number, binding: NominaBinding) => void;
	/** Los de la hoja más los que detecta el builder (festivos sin marcar). */
	avisos: string[];
	/// Dónde quedaron las cifras del reparto: las siete líneas de OTROS son
	/// esas mismas y apuntan ahí en vez de repetir el número.
	reparto: CeldasReparto;
	/**
	 * Dirección A1 del básico editable del bloque de recargos.
	 *
	 * El SALARIO se escribe contra ella —«básico entre 30 por los días»— para
	 * que corregir el sueldo arriba se vea abajo sin ir y volver al servidor.
	 * `null` en una hoja sin liquidación, donde no hay celda que teclear.
	 */
	celdaSalarioBasico: string | null;
}): { fin: number; checkbox: RangoCheckboxNomina[] } {
	const { hoja, set, merge, bind, avisos, reparto, celdaSalarioBasico } = args;
	/// Rango de las tres casillas de ajuste, para que el engine les cuelgue el
	/// checkbox de Univer. `null` en una hoja sin liquidación, que no las pinta.
	let filaCheckbox: RangoCheckboxNomina | null = null;
	/// Fila de la casilla de licencia, para colgarle también el checkbox.
	let filaCasillaLicencia = -1;
	const c0 = ZONA.DESPRENDIBLE_C0;
	const L = (c: number) => colLetra(c);
	let r = FILA_INFERIOR;

	const campo = (fila: number, col: number, span: number, cell: ICellData): number => {
		set(fila, col, cell);
		if (span > 1) merge(fila, col, fila, col + span - 1);
		return col + span;
	};

	// Columnas de cada campo, calculadas una vez: el resto de la zona se
	// alinea contra ellas en vez de ir sumando spans en cada fila.
	const colDevCant = c0 + SPAN.DESP_CONCEPTO;
	const colDevValor = colDevCant + SPAN.DESP_CANT;
	const colDedConcepto = colDevValor + SPAN.DESP_VALOR;
	const colDedValor = colDedConcepto + SPAN.DESP_DED_CONCEPTO;
	const finZona = colDedValor + SPAN.DESP_VALOR - 1;

	campo(r, c0, finZona - c0 + 1, {
		v: `DESPRENDIBLE · ${hoja.estado}`,
		s: cabecera()
	});
	r++;

	campo(r, c0, SPAN.DESP_CONCEPTO, { v: 'DEVENGOS', s: cabecera(SUBCAB) });
	campo(r, colDevCant, SPAN.DESP_CANT, { v: 'CANT.', s: cabecera(SUBCAB) });
	campo(r, colDevValor, SPAN.DESP_VALOR, { v: 'VALOR', s: cabecera(SUBCAB) });
	campo(r, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
		v: 'DEDUCCIONES',
		s: cabecera('#7F1D1D')
	});
	campo(r, colDedValor, SPAN.DESP_VALOR, { v: 'VALOR', s: cabecera('#7F1D1D') });
	r++;

	const primeraDevengo = r;
	/** Fila del rótulo OTROS, para colgar de ella el subtotal de recargos. */
	let marcaOtros = -1;
	/**
	 * Los bloques de PAREX y GEOPARK, cada uno con sus siete líneas.
	 *
	 * El desprendible imprime tres tablas de recargo, no una: OTROS con el resto
	 * de clientes y estas dos aparte. Son disjuntas —OTROS ya llega restado del
	 * servidor—, así que TOTAL DEVENGADO las suma todas sin contar nada dos
	 * veces. Cada una lleva su propio TOTAL al lado, como OTROS.
	 *
	 * Solo existen cuando ese cliente puso horas: el servidor no manda la
	 * sección si el reparto está a cero.
	 */
	const bloquesCliente: {
		nombre: string;
		rotulo: number;
		primera: number;
		ultima: number;
		/// Fila de SU DISPONIBILIDAD MES, que se resta de su propio total. `-1`
		/// en payloads anteriores a que cada bloque tuviera la suya.
		disponibilidad: number;
	}[] = [];
	/**
	 * Los días de cada cliente con bloque propio.
	 *
	 * POR NOMBRE y no por id, igual que el servidor: los `NOMINA_EMPRESA_*_ID`
	 * no están puestos en ningún entorno y en la tabla conviven dos «GEOPARK
	 * COLOMBIA S.A.S» —uno con punto final y otro sin él— que por id serían dos
	 * empresas y por nómina son la misma. Las dos reglas TIENEN que coincidir o
	 * la hoja repartiría distinto de lo que el servidor mandó.
	 */
	const diasPorCubo = new Map<string, DiaHojaDTO[]>([
		['PAREX', []],
		['GEOPARK', []]
	]);
	for (const d of hoja.dias) {
		if (d.disponibilidad) continue;
		const n = (d.empresa ?? '').toUpperCase();
		if (n.includes('PAREX')) diasPorCubo.get('PAREX')!.push(d);
		else if (n.includes('GEOPARK')) diasPorCubo.get('GEOPARK')!.push(d);
	}
	/** `recargo:PAREX:HED` → `PAREX`; `recargo:HED` y el resto → `null`. */
	const cuboDeClave = (clave: string): string | null => {
		const partes = clave.split(':');
		return partes.length === 3 && partes[0] === 'recargo' ? partes[1] : null;
	};
	/** Fila de cada línea, para restar los cubos de OTROS al cerrar la zona. */
	const filasOtros = new Map<CodigoRecargo, number>();
	const filasCubo = new Map<string, number>();
	/**
	 * Celdas de las que cuelga la BASE PRESTACIONAL.
	 *
	 * Se apuntan mientras se pinta: la fórmula no se puede escribir hasta
	 * conocer las filas de los recargos y de las casillas, que van más abajo.
	 */
	let celdaSalarioDevengado: string | null = null;
	let celdaVacaciones: string | null = null;
	/// La licencia COTIZA: entra en la base prestacional como un devengo más.
	let celdaLicencia: string | null = null;
	let celdaDiasVillanueva: string | null = null;
	let celdaDiasBase: string | null = null;
	let filaSalud = -1;
	let filaPension = -1;
	/**
	 * Primera y última fila del bloque de bonos y pernotes.
	 *
	 * Se apuntan mientras se pinta y no se calculan aparte: el bloque no tiene
	 * un rótulo que lo abra —van seguidos sin más— y contarlo por separado
	 * obligaría a repetir aquí las reglas de qué línea entra en él.
	 */
	let primeraBonif = -1;
	let ultimaBonif = -1;
	/** ¿Hay pernotes dentro del bloque? Decide el rótulo del subtotal. */
	let hayPernotes = false;
	/**
	 * Fila de DISPONIBILIDAD MES, si la hay.
	 *
	 * Se apunta al pintarla y no se deduce de la posición: está la última del
	 * bloque de OTROS por cómo las ordena el servidor, pero los dos totales
	 * que dependen de ella —el subtotal de OTROS y el DEVENGADO— cambiarían de
	 * significado en silencio si mañana se añade una línea detrás.
	 */
	let filaDisponibilidad = -1;
	const filas = Math.max(hoja.devengos.length, hoja.deducciones.length);

	for (let i = 0; i < filas; i++) {
		const dev = hoja.devengos[i];
		const ded = hoja.deducciones[i];

		if (dev?.seccion) {
			// Rótulo a lo ancho de las tres columnas de devengos: no lleva
			// cantidad ni valor y no debe parecer una línea más.
			campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT + SPAN.DESP_VALOR, {
				v: dev.nombre,
				s: { ...cabecera(SUBCAB), ht: HorizontalAlign.CENTER, fs: 9 }
			});
			/// `seccion:otros` es la de siempre y lleva la disponibilidad; las
			/// otras son los bloques de cliente, que van a su propia lista.
			if (dev.clave === 'seccion:otros' || !dev.clave.startsWith('seccion:')) marcaOtros = r;
			else {
				bloquesCliente.push({
					nombre: dev.nombre,
					rotulo: r,
					primera: -1,
					ultima: -1,
					disponibilidad: -1
				});
			}
		} else if (dev) {
			if (dev.clave === 'disponibilidad') filaDisponibilidad = r;
			/// Las líneas que siguen a un rótulo de cliente son suyas. La
			/// disponibilidad se apunta aparte: no es un recargo más, es lo que
			/// se descuenta de ellos.
			const bloque = bloquesCliente[bloquesCliente.length - 1];
			if (bloque && dev.clave.startsWith('recargo:') && dev.clave.split(':').length === 3) {
				if (bloque.primera < 0) bloque.primera = r;
				bloque.ultima = r;
			}
			if (bloque && dev.clave.startsWith('disponibilidad:')) bloque.disponibilidad = r;
			if (dev.clave.startsWith('bono:') || dev.clave.startsWith('pernote:')) {
				if (primeraBonif < 0) primeraBonif = r;
				ultimaBonif = r;
				if (dev.clave.startsWith('pernote:')) hayPernotes = true;
			}
			const estilo = dev.editable ? editable() : derivada();
			campo(r, c0, SPAN.DESP_CONCEPTO, { v: dev.nombre, s: { ...base(), fs: 9 } });
			/**
			 * Las líneas de recargo y la de disponibilidad APUNTAN al reparto,
			 * que ya suma los días. Así corregir una hora arriba baja hasta el
			 * TOTAL OTROS, el total devengado y el neto, que son sumas vivas
			 * sobre estas mismas celdas.
			 *
			 * `refDeConcepto` devuelve `null` para todo lo demás —salario,
			 * bonos, deducciones—, que no sale de los días y se sigue pintando
			 * con la cifra del servidor.
			 */
			/**
			 * Las líneas de un bloque de cliente cuelgan de SUS columnas de día.
			 *
			 * No pueden apuntar al reparto: ahí solo hay una cifra por código,
			 * la de todos los clientes juntos. Se construye la misma fórmula que
			 * usa el reparto pero restringida a los días de ese cliente, así que
			 * corregir una hora sigue moviendo su bloque, su total y el neto.
			 *
			 * A TARIFA GENERAL, igual que el reparto: esto es lo que se paga. La
			 * base propia del cliente manda en el desglose POR EMPRESA de arriba,
			 * que responde a otra pregunta.
			 */
			const cubo = cuboDeClave(dev.clave);
			const diasDelCubo = cubo ? diasPorCubo.get(cubo) ?? [] : [];
			/// Igual que el reparto, que también valora por días aunque el código
			/// tenga las horas corregidas a mano. Las dos zonas tienen que usar
			/// el mismo criterio: OTROS se define como el reparto MENOS estas
			/// celdas, así que si una fuera por días y la otra por la cifra del
			/// servidor, la resta no cuadraría.
			const codigoCubo = cubo ? (dev.clave.split(':')[2] as CodigoRecargo) : null;
			if (cubo && codigoCubo) filasCubo.set(`${cubo}|${codigoCubo}`, r);
			if (!cubo && dev.clave.startsWith('recargo:')) {
				filasOtros.set(dev.clave.slice('recargo:'.length) as CodigoRecargo, r);
			}

			if (dev.clave === 'salario') celdaSalarioDevengado = `${L(colDevValor)}${r + 1}`;
			if (dev.clave === 'vacaciones') celdaVacaciones = `${L(colDevValor)}${r + 1}`;
			if (dev.clave === 'licencia') celdaLicencia = `${L(colDevValor)}${r + 1}`;
			if (dev.clave === 'ajuste_salarial') celdaDiasVillanueva = `${L(colDevCant)}${r + 1}`;

			const ref = refDeConcepto(dev.clave, reparto);
			const fHorasCubo = codigoCubo
				? formulaHoras(
						codigoCubo,
						diasDelCubo.map((d) => COL.DIA0 + d.indice)
					)
				: null;
			campo(r, colDevCant, SPAN.DESP_CANT, {
				...(fHorasCubo
					? { f: fHorasCubo }
					: ref?.horas
						? { f: `=${ref.horas}` }
						: { v: dev.cantidad ?? '' }),
				s: { ...estilo, ht: HorizontalAlign.CENTER }
			});

			/**
			 * VALOR = BASE ENTRE 30 POR LA CANTIDAD, escrito como fórmula.
			 *
			 * Era la cifra que devolvió el servidor, así que cambiar los días en
			 * la columna CANT. dejaba el importe viejo al lado hasta que volvía
			 * la respuesta: un segundo largo en el que el desprendible enseñaba
			 * catorce días cobrando quince. Ahora la hoja lo recalcula sola y el
			 * servidor confirma después.
			 *
			 * El SALARIO apunta a la CELDA del básico, no a su número: por eso
			 * corregir el sueldo arriba baja hasta aquí. El auxilio no tiene
			 * celda propia —su base es un parámetro de la empresa— y lleva la
			 * cifra dentro de la fórmula.
			 *
			 * `ROUND` porque el importe se guarda en pesos: sin él, la celda
			 * enseña los decimales de dividir entre 30 y no cuadra con el total.
			 */
			const baseSalario = dev.clave === 'salario' ? celdaSalarioBasico : null;
			// `baseProrrateo` y no `base`: ese nombre ya es el estilo de celda.
			const baseProrrateo =
				baseSalario ?? (dev.baseMensual != null ? String(dev.baseMensual) : null);
			const celdaCant = `${L(colDevCant)}${r + 1}`;
			/**
			 * Con TOPE la fórmula lleva el `IF` dentro.
			 *
			 * La nivelación de salario se prorratea hasta los 16 días de
			 * Villanueva y desde los 17 se paga entera. Sin el `IF`, teclear 20
			 * enseñaba dos tercios del bono y el servidor guardaba el completo:
			 * la hoja y el desprendible decían cifras distintas del mismo
			 * concepto hasta que alguien comparaba los dos papeles.
			 */
			const formulaValor =
				!ref?.valor && baseProrrateo && dev.baseMensual != null
					? dev.umbralCompleto
						? `=ROUND(IF(${celdaCant}>=${dev.umbralCompleto},${baseProrrateo},${baseProrrateo}/30*${celdaCant}),0)`
						: `=ROUND(${baseProrrateo}/30*${celdaCant},0)`
					: null;

			const fValorCubo = codigoCubo
				? formulaImporte(codigoCubo, gruposPorTramo(hoja, codigoCubo, diasDelCubo))
				: null;
			campo(r, colDevValor, SPAN.DESP_VALOR, {
				...(fValorCubo
					? { f: fValorCubo }
					: ref?.valor
						? { f: `=${ref.valor}` }
						: formulaValor
							? { f: formulaValor }
							: { v: Math.round(dev.valor) }),
				s: {
					// Con fórmula la celda YA NO SE TECLEA: sale de la cantidad de
					// al lado y del básico de arriba. Pintarla de editable invitaba
					// a escribir un importe que el permiso rechaza sin explicar.
					...(formulaValor ? derivada() : estilo),
					ht: HorizontalAlign.RIGHT,
					n: { pattern: FMT_COP }
				}
			});
			// Solo se registra binding en lo que de verdad se teclea. El resto
			// queda sin entrada y el permiso de celda lo bloquea por defecto.
			if (dev.editable && hoja.liquidacionId) {
				/**
				 * CON FÓRMULA NO SE REGISTRA BINDING.
				 *
				 * La celda ya sale de la cantidad de al lado, y el importe es
				 * derivado: el recálculo del servidor lo reescribe desde los días
				 * en cuanto se guarda cualquier cosa. Registrarlo dejaba pasar un
				 * número tecleado que se perdía en el viaje siguiente, sin decir
				 * que se había perdido. Es la NIVELACIÓN DE SALARIO: los días son
				 * el dato, el bono su consecuencia.
				 */
				const campoValor = formulaValor ? null : campoDeConcepto(dev.clave);
				if (campoValor) {
					bind(r, colDevValor, {
						entityType: 'liquidacion',
						entityId: hoja.liquidacionId,
						field: campoValor,
						conductorId: hoja.conductorId
					});
				}
				const campoCantidad = campoDeCantidad(dev.clave);
				if (campoCantidad) {
					bind(r, colDevCant, {
						entityType: 'liquidacion',
						entityId: hoja.liquidacionId,
						field: campoCantidad,
						conductorId: hoja.conductorId
					});
				}
			}
		}

		if (ded) {
			/**
			 * LAS DEDUCCIONES TAMBIÉN SE TECLEAN, cuando lo dice el servidor.
			 *
			 * Esta columna se pintaba entera de solo lectura y sin un solo
			 * binding, así que `ded.editable` —que el servidor manda a `true`
			 * para los anticipos— no lo miraba nadie: escribir el valor en la
			 * celda lo rechazaba el permiso, y el rechazo se lee igual que un
			 * problema de permisos. No había forma de meter un anticipo desde
			 * el canvas.
			 *
			 * La salud y la pensión siguen sin tocarse: salen de un porcentaje
			 * sobre la base y el servidor las manda con `editable: false`.
			 */
			const campoDed = ded.editable && hoja.liquidacionId ? campoDeConcepto(ded.clave) : null;
			/// Se apuntan para reescribirlas como porcentaje sobre la base al
			/// cerrar la zona: la base todavía no existe cuando se pintan.
			if (ded.clave === 'salud') filaSalud = r;
			if (ded.clave === 'pension') filaPension = r;
			campo(r, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
				v: ded.nombre,
				s: { ...base(), fs: 9 }
			});
			campo(r, colDedValor, SPAN.DESP_VALOR, {
				v: Math.round(ded.valor),
				s: {
					...(campoDed ? editable() : derivada()),
					ht: HorizontalAlign.RIGHT,
					n: { pattern: FMT_COP },
					cl: { rgb: '#B91C1C' }
				}
			});
			if (campoDed) {
				bind(r, colDedValor, {
					entityType: 'liquidacion',
					entityId: hoja.liquidacionId!,
					field: campoDed,
					conductorId: hoja.conductorId
				});
			}
		}

		r++;
	}
	const ultimaFila = r - 1;

	/**
	 * Subtotal del bloque de bonos y pernotes.
	 *
	 * Mismo sitio y misma forma que el de OTROS: fusionado en la columna de
	 * deducciones, al lado de las líneas que resume. Es una suma VIVA sobre sus
	 * propias filas, no `totales.totalBonificaciones`, para que no pueda decir
	 * una cosa distinta de lo que tiene al lado cuando alguien edita una
	 * cantidad.
	 *
	 * Solo se pinta si el bloque empieza DEBAJO de la última deducción: con
	 * pocos devengos antes, la celda fusionada se comería ANTICIPOS. Es raro
	 * —hacen falta al menos tres líneas por encima— pero el daño sería
	 * silencioso.
	 *
	 * El rótulo distingue si hay pernotes dentro: van intercalados con los
	 * bonos por subperiodo, así que el subtotal los abarca, y llamarlo «total
	 * bonificaciones» a secas mentiría sobre lo que suma.
	 */
	const ultimaDeduccion = primeraDevengo + Math.max(hoja.deducciones.length, 1) - 1;
	if (primeraBonif > ultimaDeduccion && ultimaBonif >= primeraBonif) {
		campo(primeraBonif, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
			v: hayPernotes ? 'TOTAL BONIF. + PERNOTES' : 'TOTAL BONIFICACIONES',
			s: { ...base(), fs: 8, bl: 1, vt: VerticalAlign.MIDDLE }
		});
		merge(primeraBonif, colDedConcepto, ultimaBonif, colDedConcepto + SPAN.DESP_DED_CONCEPTO - 1);
		campo(primeraBonif, colDedValor, SPAN.DESP_VALOR, {
			f: `=SUM(${L(colDevValor)}${primeraBonif + 1}:${L(colDevValor)}${ultimaBonif + 1})`,
			s: {
				...derivada(),
				ht: HorizontalAlign.RIGHT,
				vt: VerticalAlign.MIDDLE,
				bl: 1,
				n: { pattern: FMT_COP }
			}
		});
		merge(primeraBonif, colDedValor, ultimaBonif, colDedValor + SPAN.DESP_VALOR - 1);
	}

	/**
	 * DISPONIBILIDAD CONSUME DE OTROS: no es dinero nuevo.
	 *
	 * Lo que se imputa a disponibilidad sale de la misma bolsa de recargos, y
	 * así lo presenta el desprendible: resta de «Otros» y aparece como su
	 * propia línea, de modo que las dos cifras juntas siguen siendo el total
	 * de recargos. En la hoja eso se traduce en dos ajustes:
	 *
	 *   • TOTAL OTROS  = recargos − disponibilidad.
	 *   • TOTAL DEVENGADO no puede sumar las dos, o pagaría dos veces el mismo
	 *     peso. Resta lo consumido, que es como decir que cuenta los recargos
	 *     enteros y la disponibilidad ninguna vez.
	 *
	 * `MIN(disponibilidad, recargos)` acota el consumo a lo que hay en la
	 * bolsa. Si alguien teclea más de lo que existe, TOTAL OTROS queda en cero
	 * y el DEVENGADO conserva los recargos completos: el exceso se ve en la
	 * línea —que sigue enseñando lo tecleado— en vez de desaparecer restando
	 * de otra cosa.
	 *
	 * La disponibilidad se descuenta SOLO de OTROS. PAREX y GEOPARK tienen sus
	 * propios bloques más abajo y su total es el suyo entero: la bolsa de
	 * standby es del periodo, no de un cliente, y el papel la descuenta también
	 * de un único sitio.
	 */
	/// Última línea de recargo de OTROS: la de encima de DISPONIBILIDAD. Sin
	/// ella —snapshots viejos—, la de encima del primer bloque de cliente, o la
	/// última del desprendible. En 1-indexado, que es como se escriben las
	/// fórmulas.
	const ultimoRecargo =
		filaDisponibilidad >= 0
			? filaDisponibilidad
			: bloquesCliente.length
				? bloquesCliente[0].rotulo
				: ultimaFila + 1;
	const hayRecargos = marcaOtros >= 0 && ultimoRecargo >= marcaOtros + 2;
	const rangoOtros = hayRecargos
		? `SUM(${L(colDevValor)}${marcaOtros + 2}:${L(colDevValor)}${ultimoRecargo})`
		: '0';
	const celdaDisp = filaDisponibilidad >= 0 ? `${L(colDevValor)}${filaDisponibilidad + 1}` : null;
	/// Lo que la disponibilidad se lleva de la bolsa, nunca más de lo que hay.
	const consumido = celdaDisp ? `MIN(${celdaDisp},${rangoOtros})` : null;
	const sumaOtros = consumido ? `${rangoOtros}-${consumido}` : rangoOtros;

	/**
	 * Subtotal de OTROS, en una celda fusionada al lado de sus líneas.
	 *
	 * Es lo que hace el Excel: las siete filas de recargo más disponibilidad no
	 * se suman en ningún sitio visible, y esa cifra —lo que el periodo pagó de
	 * recargos— es de las que más se miran. Va en la columna de deducciones
	 * porque debajo de ANTICIPOS no hay nada, y fusionada a lo alto del bloque
	 * para que se lea como el total de ESAS filas y no como una línea más.
	 *
	 * La fórmula es viva, como los totales: ajustar unas horas mueve el
	 * subtotal sin esperar al servidor.
	 */
	/**
	 * Subtotal en la banda de deducciones, fusionado a lo alto de SUS filas.
	 *
	 * El de OTROS llega hasta donde empieza el primer bloque de cliente, no
	 * hasta el final del desprendible: si barriera hasta abajo se comería las
	 * filas de PAREX y GEOPARK y diría ser el total de unas líneas que no son
	 * suyas.
	 */
	const subtotal = (rotulo: string, desde: number, hasta: number, formula: string) => {
		if (desde < 0 || hasta < desde) return;
		campo(desde, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
			v: rotulo,
			s: { ...base(), fs: 9, bl: 1, vt: VerticalAlign.MIDDLE }
		});
		if (hasta > desde) {
			merge(desde, colDedConcepto, hasta, colDedConcepto + SPAN.DESP_DED_CONCEPTO - 1);
		}
		campo(desde, colDedValor, SPAN.DESP_VALOR, {
			f: formula,
			s: {
				...derivada(),
				ht: HorizontalAlign.RIGHT,
				vt: VerticalAlign.MIDDLE,
				bl: 1,
				n: { pattern: FMT_COP }
			}
		});
		if (hasta > desde) {
			merge(desde, colDedValor, hasta, colDedValor + SPAN.DESP_VALOR - 1);
		}
	};

	if (marcaOtros >= 0 && ultimaFila > marcaOtros) {
		/// El bloque de OTROS acaba donde empieza el primero de cliente.
		const finBloqueOtros = bloquesCliente.length ? bloquesCliente[0].rotulo - 1 : ultimaFila;
		subtotal('TOTAL OTROS', marcaOtros + 1, finBloqueOtros, `=${sumaOtros}`);
	}

	/**
	 * CADA BLOQUE RESTA LA SUYA.
	 *
	 * La disponibilidad era una sola cifra del corte y se descontaba entera de
	 * OTROS, así que el desprendible enseñaba en una línea la suma de las tres.
	 * Ahora cada cliente con bloque propio tiene la suya y sale de su propio
	 * total, con el mismo `MIN` que OTROS: lo imputado nunca puede pasar de lo
	 * que hay en esa bolsa.
	 */
	const consumidosCliente: string[] = [];
	for (const b of bloquesCliente) {
		if (b.primera < 0) continue;
		const suma = `SUM(${L(colDevValor)}${b.primera + 1}:${L(colDevValor)}${b.ultima + 1})`;
		const celda = b.disponibilidad >= 0 ? `${L(colDevValor)}${b.disponibilidad + 1}` : null;
		const consumido = celda ? `MIN(${celda},${suma})` : null;
		if (consumido) consumidosCliente.push(consumido);
		subtotal(
			`TOTAL ${b.nombre.replace(/^RECARGOS\s+/i, '')}`,
			b.rotulo + 1,
			Math.max(b.ultima, b.disponibilidad),
			`=${suma}${consumido ? `-${consumido}` : ''}`
		);
	}

	/**
	 * OTROS ES EL RESTO, también en la hoja.
	 *
	 * Sus líneas apuntan al reparto, que suma TODAS las empresas. Ahora PAREX y
	 * GEOPARK tienen bloque propio unas filas más abajo, así que la línea de
	 * OTROS tiene que restarlos o las mismas horas se contarían dos veces y el
	 * TOTAL DEVENGADO saldría inflado en esa cifra.
	 *
	 * Se reescribe AQUÍ y no dentro del bucle porque las filas de los bloques
	 * de cliente todavía no existían cuando se pintó OTROS. Restar celdas y no
	 * números mantiene viva toda la cadena: corregir una hora de PAREX baja su
	 * bloque, sube el de OTROS en lo mismo y deja el devengado quieto.
	 */
	for (const [codigo, fila] of filasOtros) {
		const restas = [...diasPorCubo.keys()]
			.map((cubo) => filasCubo.get(`${cubo}|${codigo}`))
			.filter((f): f is number => f !== undefined);
		if (!restas.length) continue;
		const menos = (col: number) => restas.map((f) => `-${L(col)}${f + 1}`).join('');
		const ref = refDeConcepto(`recargo:${codigo}`, reparto);
		if (ref?.horas) {
			set(fila, colDevCant, {
				f: `=${ref.horas}${menos(colDevCant)}`,
				s: { ...derivada(), ht: HorizontalAlign.CENTER }
			});
		}
		if (ref?.valor) {
			set(fila, colDevValor, {
				f: `=${ref.valor}${menos(colDevValor)}`,
				s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
			});
		}
	}

	// Totales con fórmula viva: si se edita un concepto, el neto se mueve sin
	// esperar al servidor. El servidor recalcula igual y manda el suyo, pero
	// mientras tanto la hoja no miente.
	campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, { v: 'TOTAL DEVENGADO', s: totales() });
	/// Se resta LO CONSUMIDO DE CADA BLOQUE, no solo lo de OTROS: la línea de
	/// disponibilidad de cada uno suma en este rango, y sin restarla el
	/// devengado pagaría dos veces el mismo peso.
	const consumidoTotal = [consumido, ...consumidosCliente].filter(Boolean) as string[];
	campo(r, colDevValor, SPAN.DESP_VALOR, {
		f: `=SUM(${L(colDevValor)}${primeraDevengo + 1}:${L(colDevValor)}${ultimaFila + 1})${
			consumidoTotal.map((c) => `-${c}`).join('')
		}`,
		s: { ...totales(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	campo(r, colDedConcepto, SPAN.DESP_DED_CONCEPTO, {
		v: 'TOTAL DEDUCCIONES',
		s: { ...totales(), fs: 9 }
	});
	/**
	 * Las deducciones se suman SOLO sobre sus propias filas.
	 *
	 * Antes barría la columna entera hasta el final del bloque, y ahí abajo
	 * vive el subtotal de OTROS —va en esta columna porque debajo de ANTICIPOS
	 * queda sitio—, así que se colaba en el total: las deducciones salían
	 * infladas con los recargos y el neto, corto en esa misma cifra. La
	 * columna de devengos sí puede barrerse entera, porque todo lo que hay en
	 * ella son devengos.
	 */
	campo(r, colDedValor, SPAN.DESP_VALOR, {
		f: `=SUM(${L(colDedValor)}${primeraDevengo + 1}:${L(colDedValor)}${primeraDevengo + Math.max(hoja.deducciones.length, 1)})`,
		s: {
			...totales(),
			ht: HorizontalAlign.RIGHT,
			n: { pattern: FMT_COP },
			cl: { rgb: '#B91C1C' }
		}
	});
	const filaTotales = r;
	r++;

	/**
	 * BASE PRESTACIONAL, con los DÍAS que se le mandan de la nivelación.
	 *
	 * Cuánto del bono de nivelación cotiza varía por persona y por mes: a veces
	 * los 30 días, a veces ninguno. La columna que lo decide
	 * —`dias_ajuste_deducciones`— existía y solo la enseñaba el formulario de
	 * liquidaciones, así que desde el canvas la base siempre se llevaba el
	 * ajuste entero y había que salir a otra pantalla para corregirlo.
	 *
	 * Va en la columna CANT. de esta misma fila y no en una tabla aparte: es el
	 * mismo par «cantidad → valor» de todas las líneas de arriba, y deja los
	 * días pegados a la cifra que explican en vez de a tres filas de distancia.
	 *
	 * VACÍO NO ES CERO. Vacío es «sin decidir» y vale por el ajuste completo
	 * del mes; un 0 tecleado dice que el bono no cotiza. El patch conserva esa
	 * diferencia —es el único campo que manda `null` en vez de 0 al borrarlo—,
	 * así que la celda se deja en blanco cuando el campo es nulo.
	 *
	 * El importe NO es fórmula: la base mezcla salario devengado, vacaciones,
	 * la fracción del ajuste y los recargos de PAREX/Geopark según sus
	 * interruptores. Se recalcula en el servidor, y por eso este campo rehace
	 * la hoja al guardarse.
	 */
	campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, {
		v: 'BASE PRESTACIONAL',
		s: etiqueta()
	});
	/// La FÓRMULA se escribe al cerrar la zona: necesita la fila de los días
	/// que van a la base y las tres casillas, que van más abajo.
	const filaBase = r;
	const celdaBase = `${L(colDevValor)}${r + 1}`;
	campo(r, colDevValor, SPAN.DESP_VALOR, {
		v: Math.round(hoja.totales.baseCalculo ?? 0),
		s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	r++;

	if (hoja.liquidacionId) {
		/**
		 * FILA PROPIA Y CON RÓTULO, no una celda suelta.
		 *
		 * Estuvo en la columna CANT. de BASE PRESTACIONAL, que es donde el resto
		 * del desprendible pone las cantidades. Pero esa celda está VACÍA
		 * mientras nadie decide —vacío es «todos los días», que es el caso
		 * normal—, y una celda en blanco sin rótulo al lado de un total no se
		 * lee como un campo: se lee como un hueco. No se encontraba.
		 *
		 * El rótulo lleva la regla dentro porque es la que se olvida: VACÍO NO
		 * ES CERO. Vacío vale por el ajuste entero del mes; un 0 tecleado dice
		 * que el bono no cotiza, y son dos decisiones distintas.
		 */
		campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, {
			v: 'DÍAS DE NIVELACIÓN A LA BASE (vacío = todos)',
			s: { ...base(), fs: 9, cl: { rgb: MUTED } }
		});
		celdaDiasBase = `${L(colDevValor)}${r + 1}`;
		campo(r, colDevValor, SPAN.DESP_VALOR, {
			v: hoja.diasAjusteDeducciones ?? '',
			s: { ...editable(), ht: HorizontalAlign.CENTER }
		});
		bind(r, colDevValor, {
			entityType: 'liquidacion',
			entityId: hoja.liquidacionId,
			field: 'dias_ajuste_deducciones',
			conductorId: hoja.conductorId
		});
		r++;
	}

	campo(r, c0, SPAN.DESP_CONCEPTO + SPAN.DESP_CANT, {
		v: 'NETO A PAGAR',
		s: { ...cabecera(), fs: 12 }
	});
	campo(r, colDevValor, SPAN.DESP_VALOR, {
		f: `=${L(colDevValor)}${filaTotales + 1}-${L(colDedValor)}${filaTotales + 1}`,
		s: { ...cabecera(), fs: 12, ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
	});
	r++;

	/**
	 * VACACIONES: las dos fechas, los días que salen de ellas y el salario.
	 *
	 * DEBAJO del desprendible y no dentro: no es un concepto más, son los datos
	 * de los que sale UNA de sus líneas. Dentro habría que robarle filas a los
	 * devengos y la fila VACACIONES quedaría separada de sus propias fechas.
	 *
	 * Al lado tampoco: ahí caía en columnas que la hoja ni siquiera declaraba
	 * —Univer no avisa, simplemente no las dibuja— y obligaba a ensanchar la
	 * rejilla para una tabla de cuatro filas. Abajo reutiliza las columnas que
	 * ya están en pantalla y queda alineada con lo que explica.
	 *
	 * Los DÍAS no se teclean: son la resta de las fechas, con el día de inicio
	 * incluido. Dejarlos editables permitiría guardar un número que contradiga
	 * a las fechas que tiene al lado, y entonces ninguno de los dos sirve para
	 * justificar nada.
	 */
	const vac = hoja.vacaciones;
	if (vac) {
		r++;
		campo(r, c0, SPAN.VAC_ROTULO + SPAN.VAC_VALOR, { v: 'VACACIONES', s: cabecera() });
		r++;

		const filaVac = (
			rotulo: string,
			valor: string | number,
			campoBd: string | null,
			formato?: string
		) => {
			campo(r, c0, SPAN.VAC_ROTULO, { v: rotulo, s: { ...base(), fs: 9 } });
			campo(r, c0 + SPAN.VAC_ROTULO, SPAN.VAC_VALOR, {
				v: valor,
				s: {
					...(campoBd ? editable() : derivada()),
					ht: campoBd === null ? HorizontalAlign.CENTER : HorizontalAlign.RIGHT,
					...(formato ? { n: { pattern: formato } } : {})
				}
			});
			if (campoBd && hoja.liquidacionId) {
				bind(r, c0 + SPAN.VAC_ROTULO, {
					entityType: 'liquidacion',
					entityId: hoja.liquidacionId,
					field: campoBd,
					conductorId: hoja.conductorId
				});
			}
			r++;
		};

		// Las fechas van como TEXTO `AAAA-MM-DD`, que es como las guarda y las
		// espera el servidor. Con formato de fecha de Univer, la celda
		// devolvería un serial y el patch lo rechazaría.
		filaVac('FECHA INICIO', vac.desde ?? '', 'periodo_start_vacaciones');
		filaVac('FECHA FIN', vac.hasta ?? '', 'periodo_end_vacaciones');
		filaVac('DÍAS', vac.dias || '', null);
		filaVac(
			vac.salarioHeredado ? 'SALARIO (del básico)' : 'SALARIO VACACIONES',
			Math.round(vac.salarioBase),
			'salario_vacaciones',
			FMT_COP
		);

		campo(r, c0, SPAN.VAC_ROTULO + SPAN.VAC_VALOR, {
			v: 'Los días incluyen el de inicio. El valor es salario ÷ 30 × días.',
			s: { ...base(), fs: 8, cl: { rgb: '#6B7280' } }
		});
		r++;
	}

	/**
	 * LICENCIA DE MATERNIDAD O PATERNIDAD.
	 *
	 * Debajo de las vacaciones y antes del ajuste de recargos, porque se teclea
	 * igual que ellas: una casilla y dos fechas. Los DÍAS no se teclean —son la
	 * resta de las fechas, con el de inicio incluido— y el importe tampoco:
	 * sale del básico entre 30 por esos días. Dejarlos editables permitiría
	 * guardar un número que contradiga a las fechas que tiene al lado.
	 *
	 * La casilla va ARRIBA del bloque: es lo que decide si la línea aparece en
	 * el desprendible, y se puede apagar sin borrar las fechas.
	 *
	 * El rótulo del devengo —maternidad, paternidad o las dos— lo decide el
	 * servidor con el género de la ficha; aquí solo se pintan los datos.
	 */
	const lic = hoja.licencia;
	if (lic && hoja.liquidacionId) {
		r++;
		campo(r, c0, SPAN.VAC_ROTULO + SPAN.VAC_VALOR, { v: 'LICENCIA', s: cabecera() });
		r++;
		filaCasillaLicencia = r;
		campo(r, c0, SPAN.VAC_ROTULO, {
			v: 'Aplica licencia',
			s: { ...base(), fs: 9 }
		});
		/// Sin combinar, como las otras casillas: sobre una celda combinada el
		/// checkbox no se dibuja. Ver `checkbox-si-no.ts`.
		campo(r, c0 + SPAN.VAC_ROTULO, 1, {
			v: lic.aplica ? CHECKBOX_SI : CHECKBOX_NO,
			s: { ...editable(), ht: HorizontalAlign.CENTER }
		});
		bind(r, c0 + SPAN.VAC_ROTULO, {
			entityType: 'liquidacion',
			entityId: hoja.liquidacionId,
			field: 'aplica_licencia',
			conductorId: hoja.conductorId
		});
		r++;

		const filaLic = (rotulo: string, valor: string | number, campoBd: string | null) => {
			campo(r, c0, SPAN.VAC_ROTULO, { v: rotulo, s: { ...base(), fs: 9 } });
			campo(r, c0 + SPAN.VAC_ROTULO, SPAN.VAC_VALOR, {
				v: valor,
				s: {
					...(campoBd ? editable() : derivada()),
					ht: campoBd ? HorizontalAlign.RIGHT : HorizontalAlign.CENTER
				}
			});
			if (campoBd) {
				bind(r, c0 + SPAN.VAC_ROTULO, {
					entityType: 'liquidacion',
					entityId: hoja.liquidacionId!,
					field: campoBd,
					conductorId: hoja.conductorId
				});
			}
			r++;
		};
		/// Las fechas van como TEXTO `AAAA-MM-DD`: con formato de fecha de Univer
		/// la celda devolvería un serial y el patch lo rechazaría.
		filaLic('FECHA INICIO', lic.desde ?? '', 'periodo_start_licencia');
		filaLic('FECHA FIN', lic.hasta ?? '', 'periodo_end_licencia');
		filaLic('DÍAS', lic.dias || '', null);

		campo(r, c0, SPAN.VAC_ROTULO + SPAN.VAC_VALOR, {
			v: 'Los días incluyen el de inicio. El valor es el básico ÷ 30 × días, y cotiza.',
			s: { ...base(), fs: 8, cl: { rgb: '#6B7280' } }
		});
		r++;
	}

	/**
	 * AJUSTE DE RECARGOS: los tres interruptores, como casillas.
	 *
	 * Deciden qué recargos entran en la BASE PRESTACIONAL. Hasta ahora «¿aplica
	 * el de PAREX?» se deducía de que su importe fuera mayor que cero, y ese
	 * importe solo lo escribe el cálculo cuando el interruptor ya está puesto:
	 * un círculo cerrado que dejaba a los borradores del canvas sin forma de
	 * encenderlo. En esta base, 83 de 148 liquidaciones con recargos de PAREX
	 * lo tenían apagado.
	 *
	 * COMPLETO manda sobre los otros dos: mete TODOS los recargos del corte
	 * —OTROS, PAREX y GEOPARK—, y por eso va el último y lo dice su rótulo.
	 *
	 * Se guardan como `SÍ` / `NO` y no como booleano porque es lo que guarda el
	 * checkbox de Univer: la regla se construye con esas dos cadenas y es su
	 * texto el que viaja en el patch. Ver `checkbox-si-no.ts`.
	 */
	if (hoja.liquidacionId) {
		r++;
		campo(r, c0, SPAN.VAC_ROTULO + SPAN.VAC_VALOR, {
			v: 'AJUSTE DE RECARGOS A LA BASE',
			s: cabecera()
		});
		r++;
		filaCheckbox = { columna: c0 + SPAN.VAC_ROTULO, desde: r, hasta: r + 2 };
		const interruptores: [string, boolean, string][] = [
			['Ajuste PAREX', !!hoja.aplicaAjusteParex, 'aplica_ajuste_parex'],
			['Ajuste GEOPARK', !!hoja.aplicaAjusteGeopark, 'aplica_ajuste_geopark'],
			[
				'Ajuste completo (OTROS + PAREX + GEOPARK)',
				!!hoja.ajusteRecargosCompletos,
				'ajuste_parex_recargos_completos'
			]
		];
		for (const [rotulo, marcado, campoBd] of interruptores) {
			campo(r, c0, SPAN.VAC_ROTULO, { v: rotulo, s: { ...base(), fs: 9 } });
			/// SIN COMBINAR: la regla de validación se cuelga de una columna, y
			/// sobre una celda combinada el checkbox no se dibuja. Las dos
			/// columnas que quedan a la derecha se dejan vacías a propósito.
			campo(r, c0 + SPAN.VAC_ROTULO, 1, {
				v: marcado ? CHECKBOX_SI : CHECKBOX_NO,
				s: { ...editable(), ht: HorizontalAlign.CENTER }
			});
			bind(r, c0 + SPAN.VAC_ROTULO, {
				entityType: 'liquidacion',
				entityId: hoja.liquidacionId,
				field: campoBd,
				conductorId: hoja.conductorId
			});
			r++;
		}
		campo(r, c0, SPAN.VAC_ROTULO + SPAN.VAC_VALOR, {
			v: 'Marcar hace que esos recargos coticen: sube la base, la salud y la pensión.',
			s: { ...base(), fs: 8, cl: { rgb: '#6B7280' } }
		});
		r++;
	}

	// Avisos de la hoja, si los hay. Van aquí y no en un toast porque son de
	// esta hoja concreta y el usuario está mirando treinta.
	if (avisos.length) {
		r++;
		campo(r, c0, finZona - c0 + 1, { v: 'AVISOS', s: cabecera(FESTIVO_CABECERA) });
		r++;
		for (const aviso of avisos) {
			campo(r, c0, finZona - c0 + 1, {
				v: aviso,
				s: { ...base(), fs: 9, cl: { rgb: '#B45309' } }
			});
			r++;
		}
	}

	/**
	 * BASE PRESTACIONAL, VIVA.
	 *
	 * Era la cifra que mandó el servidor, así que cambiar los días de
	 * nivelación o los que van a la base obligaba a releer el periodo entero y
	 * REMONTAR EL LIBRO: el canvas parpadeaba y se perdía el sitio, por mover
	 * un número. Ahora la hoja la calcula sola, como ya hacían el salario, el
	 * subtotal de OTROS, el devengado y el neto; el servidor recalcula igual y
	 * confirma en el siguiente viaje.
	 *
	 * Reproduce `baseIbc` de `liquidar.ts`, y SOLO esa suma:
	 *
	 *     salario devengado + vacaciones + parte del ajuste + recargos que cotizan
	 *
	 * · La parte del ajuste es la diferencia a nivelar —«Salario villanueva»
	 *   menos el básico, nunca negativa— prorrateada por los días que se le
	 *   manden a la base. VACÍO NO ES CERO: vacío vale por el mes entero.
	 *   Y solo cuenta si hay días de Villanueva, que es el interruptor del bono.
	 * · Los recargos entran al 100 % según las tres casillas: el «completo» se
	 *   lleva TODOS los del corte y manda sobre los otros dos.
	 *
	 * Se suman las filas BRUTAS de cada bloque y no sus TOTALES, porque el
	 * total ya lleva restada la disponibilidad imputada y el IBC se calcula
	 * antes de eso.
	 *
	 * Sin los parámetros —un snapshot viejo— se queda la cifra del servidor.
	 */
	const rangoValor = (desde: number, hasta: number) =>
		`SUM(${L(colDevValor)}${desde + 1}:${L(colDevValor)}${hasta + 1})`;
	const filasOtrosOrdenadas = [...filasOtros.values()].sort((a, b) => a - b);
	const sumaOtrosBruta = filasOtrosOrdenadas.length
		? rangoValor(filasOtrosOrdenadas[0], filasOtrosOrdenadas[filasOtrosOrdenadas.length - 1])
		: '0';
	const sumaDeCubo = (nombre: string) => {
		const b = bloquesCliente.find((x) => x.nombre.toUpperCase().includes(nombre));
		return b && b.primera >= 0 ? rangoValor(b.primera, b.ultima) : '0';
	};
	const sumaParex = sumaDeCubo('PAREX');
	const sumaGeopark = sumaDeCubo('GEOPARK');
	const colCasilla = L(c0 + SPAN.VAC_ROTULO);
	const casilla = (i: number) =>
		filaCheckbox ? `${colCasilla}${filaCheckbox.desde + 1 + i}` : null;
	const [cbParex, cbGeopark, cbCompleto] = [casilla(0), casilla(1), casilla(2)];

	let formulaBase: string | null = null;
	if (
		celdaSalarioDevengado &&
		celdaSalarioBasico &&
		celdaDiasVillanueva &&
		celdaDiasBase &&
		hoja.salarioVillanueva != null
	) {
		const ajusteCompleto = `MAX(0,${hoja.salarioVillanueva}-${celdaSalarioBasico})`;
		const parteAjuste =
			`IF(${celdaDiasVillanueva}>0,` +
			`IF(${celdaDiasBase}="",${ajusteCompleto},${ajusteCompleto}/30*${celdaDiasBase}),0)`;
		const todos = `(${sumaOtrosBruta}+${sumaParex}+${sumaGeopark})`;
		const porCasillas =
			cbParex && cbGeopark && cbCompleto
				? `IF(${cbCompleto}="${CHECKBOX_SI}",${todos},IF(${cbParex}="${CHECKBOX_SI}",${sumaParex},0))` +
					`+IF(${cbGeopark}="${CHECKBOX_SI}",${sumaGeopark},0)`
				: '0';
		const ibc =
			`${celdaSalarioDevengado}+${celdaVacaciones ?? 0}+${celdaLicencia ?? 0}` +
			`+${parteAjuste}+${porCasillas}`;
		/// Las dos palancas de «descontar sobre el salario» son fijas por
		/// liquidación —no se tocan en la hoja—, así que se resuelven aquí.
		const soloSalud = hoja.descontarSaludSalario === true;
		const soloPension = hoja.descontarPensionSalario === true;
		const cuerpo =
			soloSalud && soloPension
				? celdaSalarioBasico
				: soloSalud || soloPension
					? `MAX(${celdaSalarioBasico},${ibc})`
					: ibc;
		formulaBase = `=ROUND(${cuerpo},0)`;
	}

	if (formulaBase) {
		set(filaBase, colDevValor, {
			f: formulaBase,
			s: { ...derivada(), ht: HorizontalAlign.RIGHT, n: { pattern: FMT_COP } }
		});
	}

	/**
	 * SALUD y PENSIÓN, colgadas de la base.
	 *
	 * Cada una lleva su propio interruptor: una puede ir por el IBC y la otra
	 * por el básico pelado. Como los dos son fijos por liquidación, se resuelve
	 * aquí cuál es su base y la celda solo aplica el porcentaje.
	 */
	if (formulaBase && hoja.porcentajeSalud != null && hoja.porcentajePension != null) {
		const deduccion = (fila: number, pct: number, sobreSalario: boolean) => {
			if (fila < 0) return;
			const sobre = sobreSalario ? celdaSalarioBasico : celdaBase;
			set(fila, colDedValor, {
				f: `=ROUND(${pct}/100*${sobre},0)`,
				s: {
					...derivada(),
					ht: HorizontalAlign.RIGHT,
					n: { pattern: FMT_COP },
					cl: { rgb: '#B91C1C' }
				}
			});
		};
		deduccion(filaSalud, hoja.porcentajeSalud, hoja.descontarSaludSalario === true);
		deduccion(filaPension, hoja.porcentajePension, hoja.descontarPensionSalario === true);
	}

	/// Los dos bloques con casilla: los tres interruptores de ajuste y la
	/// licencia. Van juntos para que el engine les cuelgue el checkbox de una.
	const rangos: RangoCheckboxNomina[] = [];
	if (filaCheckbox) rangos.push(filaCheckbox);
	if (filaCasillaLicencia >= 0) {
		rangos.push({
			columna: c0 + SPAN.VAC_ROTULO,
			desde: filaCasillaLicencia,
			hasta: filaCasillaLicencia
		});
	}
	return { fin: r, checkbox: rangos };
}

/**
 * Campo de `liquidaciones` que edita el IMPORTE de un concepto.
 * `null` significa que el importe no se teclea directamente (sale de una
 * cantidad, de las planillas o de otra tabla).
 */
/**
 * La celda del reparto de la que sale este concepto del desprendible, si sale
 * de ahí.
 *
 * `recargo:<CODIGO>` son las siete líneas de OTROS. Un código con las horas
 * corregidas a mano no está en el mapa —el reparto lo dejó estático— y
 * entonces la línea se pinta con la cifra del servidor, que es la buena.
 *
 * DISPONIBILIDAD MES estuvo aquí, apuntando a la columna de standby del
 * reparto. Esa columna vale cero siempre —un día de disponibilidad no genera
 * recargos, así que no tiene horas que valorar— y la línea enseñaba $0 aunque
 * la liquidación tuviera su importe guardado. Ahora es una celda que se
 * teclea y se guarda en `liquidaciones.disponibilidad`.
 */
function refDeConcepto(
	clave: string,
	reparto: CeldasReparto
): { horas?: string; valor?: string } | null {
	if (!clave.startsWith('recargo:')) return null;
	return reparto.porCodigo.get(clave.slice('recargo:'.length) as CodigoRecargo) ?? null;
}

function campoDeConcepto(clave: string): string | null {
	/**
	 * Los conceptos adicionales no son una columna sino un elemento del Json
	 * `conceptos_adicionales`, y se direccionan POR NOMBRE —igual que los
	 * bonos de la matriz—: el índice se corre en cuanto se borra uno de en
	 * medio y el binding inverso acabaría repintando la fila equivocada.
	 *
	 * La clave llega como `adicional:<nombre>` y el nombre puede traer `:`
	 * dentro, así que se corta por el PRIMER separador y el resto es el
	 * nombre entero.
	 */
	if (clave.startsWith('adicional:')) {
		const nombre = clave.slice('adicional:'.length).trim();
		return nombre ? `adicional|${nombre}` : null;
	}
	switch (clave) {
		case 'vacaciones':
			return 'total_vacaciones';
		case 'ajuste_salarial':
			return 'ajuste_salarial';
		/// Se teclea: no se deriva de nada. Es lo que se imputa a
		/// disponibilidad de la bolsa de OTROS.
		case 'disponibilidad':
			return 'disponibilidad';
		/// Y una por bloque de cliente: `disponibilidad:PAREX` escribe en
		/// `disponibilidad_parex`. Antes era una sola cifra para el corte entero
		/// y el desprendible enseñaba la suma de las tres en una línea.
		case 'disponibilidad:PAREX':
			return 'disponibilidad_parex';
		case 'disponibilidad:GEOPARK':
			return 'disponibilidad_geopark';
		/**
		 * El total de anticipos, que es una DEDUCCIÓN.
		 *
		 * Apunta a la columna `total_anticipos` y no a la tabla `anticipos`:
		 * esa es el detalle de dónde salió la cifra —y el resto de la
		 * aplicación ya lee la columna—, mientras que lo que el desprendible
		 * descuenta es la cifra.
		 */
		case 'anticipos':
			return 'total_anticipos';
		default:
			return null;
	}
}

/** Campo que edita la CANTIDAD (los días) de un concepto. */
function campoDeCantidad(clave: string): string | null {
	switch (clave) {
		case 'salario':
		case 'auxilio_transporte':
			return 'dias_laborados';
		case 'ajuste_salarial':
			return 'dias_laborados_villanueva';
		default:
			return null;
	}
}

/**
 * Cierra el borde de las celdas combinadas.
 *
 * EL PROBLEMA: Univer 0.25.1 dibuja el borde del ANCLA a su tamaño propio, no
 * al de la combinación. En una fila «TOTAL HORAS DEL PERIODO» combinada de B a
 * G se veía el recuadro solo alrededor de la B y el resto quedaba sin trazar;
 * y las filas cuyo rótulo y valor son dos combinaciones seguidas se quedaban
 * directamente sin retícula. Al lado, las celdas sueltas sí la tenían, así que
 * la hoja parecía a medio dibujar.
 *
 * LA SOLUCIÓN: materializar las celdas CUBIERTAS con bordes PARCIALES —arriba
 * y abajo siempre, el izquierdo solo en la primera y el derecho solo en la
 * última—. Así el rectángulo se cierra sin que aparezcan las líneas verticales
 * interiores, que es justo lo que la combinación viene a quitar. `rellenarBordesVacios`
 * las salta a propósito (por eso no lo hacía él), y lleva un aviso explicando
 * que rellenarlas con el borde COMPLETO dibujaba por dentro.
 *
 * Se copia además el fondo del ancla: si el renderizador pinta las cubiertas
 * por separado, el color de la cabecera sigue siendo continuo.
 */
function cerrarBordesDeCombinadas(
	cellData: Record<number, Record<number, ICellData>>,
	mergeData: { startRow: number; endRow: number; startColumn: number; endColumn: number }[]
): void {
	for (const m of mergeData) {
		const ancla = cellData[m.startRow]?.[m.startColumn];
		const estiloAncla = (ancla?.s ?? {}) as IStyleData;
		const bordeAncla = estiloAncla.bd;
		// Si el ancla no lleva borde, la combinación tampoco debe llevarlo.
		if (!bordeAncla) continue;

		// EL ANCLA PIERDE SUS BORDES INTERIORES. Conservaba el derecho (y el
		// inferior en combinaciones de varias filas) de su estilo original, y
		// eso dibujaba una vertical DENTRO de la combinación, justo detrás del
		// rótulo: era lo que hacía que el recuadro pareciera cortado a medias.
		// El borde derecho pertenece a la última columna del rango, no al ancla.
		const variasColumnas = m.endColumn > m.startColumn;
		const variasFilas = m.endRow > m.startRow;
		if (variasColumnas || variasFilas) {
			cellData[m.startRow][m.startColumn] = {
				...ancla,
				s: {
					...estiloAncla,
					bd: {
						...bordeAncla,
						...(variasColumnas ? { r: undefined } : {}),
						...(variasFilas ? { b: undefined } : {})
					}
				}
			};
		}

		for (let r = m.startRow; r <= m.endRow; r++) {
			const fila = (cellData[r] ??= {});
			for (let c = m.startColumn; c <= m.endColumn; c++) {
				if (r === m.startRow && c === m.startColumn) continue;

				const bd: Record<string, unknown> = {};
				if (r === m.startRow && bordeAncla.t) bd.t = bordeAncla.t;
				if (r === m.endRow && bordeAncla.b) bd.b = bordeAncla.b;
				if (c === m.startColumn && bordeAncla.l) bd.l = bordeAncla.l;
				if (c === m.endColumn && bordeAncla.r) bd.r = bordeAncla.r;

				fila[c] = {
					s: {
						...(estiloAncla.bg ? { bg: estiloAncla.bg } : {}),
						bd: bd as IStyleData['bd']
					}
				};
			}
		}
	}
}

// ─── Utilidades ───────────────────────────────────────────────────────

/**
 * Fechas ISO festivas que caen dentro del periodo.
 *
 * El periodo cruza dos meses y puede cruzar dos años (diciembre → enero), así
 * que se piden los festivos de cada año presente y se filtran por fecha.
 */
function festivosDelPeriodo(dias: DiaPeriodoDTO[]): Set<string> {
	const anios = new Set(dias.map((d) => d.anio));
	const delPeriodo = new Set(dias.map((d) => d.fecha));
	const out = new Set<string>();
	for (const anio of anios) {
		for (const f of obtenerFestivosCompletos(anio)) {
			if (delPeriodo.has(f.fechaCompleta)) out.add(f.fechaCompleta);
		}
	}
	return out;
}

/** Hora decimal (5.5) → «05:30». En la planilla se guarda como decimal. */
function horaTexto(h: number | null): string {
	if (h === null || h === undefined || !Number.isFinite(h)) return '';
	const horas = Math.floor(h);
	const min = Math.round((h - horas) * 60);
	return `${String(horas).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function redondear(n: number): number {
	return Math.round(n * 100) / 100;
}

