/**
 * Capa de resaltado del historial: pinta el FONDO de un conjunto de filas sin
 * tocar el resto de su estilo.
 *
 * La usan dos cosas que parecen distintas y son la misma:
 *
 *  1. **Selección** — al tocar una celda se resalta el bloque entero de su
 *     liquidación. Un bloque son N filas (una por ítem) y la pregunta que
 *     responde el resaltado es «¿qué estoy a punto de aprobar?», que es
 *     exactamente sobre lo que opera la barra de acciones.
 *  2. **Llegada por socket** — una liquidación que entra o cambia desde otra
 *     pestaña destella unos segundos. Sin eso, una fila aparece arriba del todo
 *     y nadie se entera de que el contenido se movió bajo sus pies.
 *
 * ── Por qué solo el fondo, y por qué se restaura desde el modelo ────────────
 *
 * Reescribir el bloque con `bloqueLiquidacion()` sería más simple de razonar,
 * pero cuesta N filas × 27 columnas en CADA movimiento de selección, y con el
 * ratón arrastrando eso es un repintado continuo. `setBackgroundColor` toca una
 * sola propiedad.
 *
 * Para despintar NO se guarda el estilo previo: se recalcula desde `zebra`, que
 * es la única fuente del fondo de una fila de datos. Guardar y restaurar un
 * snapshot se desincroniza en cuanto el bloque se reescribe por otra vía —un
 * `actualizarLiquidacion` en medio de un resaltado— y deja filas con el color
 * de resaltado congelado.
 *
 * La columna de ESTADO queda fuera: su fondo codifica el estado (verde
 * aprobada, azul liquidada…) y pisarlo perdería información que el usuario
 * está mirando justo cuando selecciona.
 */

import { ZEBRA_BG } from '../builders/historial-comun';

/** Fondo del bloque de la liquidación bajo el cursor. Ámbar muy tenue. */
export const RESALTADO_SELECCION = '#FEF9E7';
/** Fondo del destello de una fila que acaba de llegar por socket. Verde tenue. */
export const RESALTADO_ENTRADA = '#DCFCE7';
/** Cuánto dura el destello de socket antes de volver a su color. */
export const MS_DESTELLO = 2600;

/** Columnas que NO se repintan: su fondo significa algo por sí mismo. */
export interface OpcionesResaltado {
	/// Índices de columna que conservan su fondo original.
	columnasExcluidas?: ReadonlySet<number>;
	/// Total de columnas de la hoja.
	totalColumnas: number;
}

/** Lo mínimo que la capa necesita saber de una fila para despintarla. */
export interface FilaPintable {
	fila: number;
	zebra: boolean;
}

/**
 * Aplica un color de fondo a un tramo contiguo de columnas de una fila.
 *
 * Se hace por TRAMOS y no celda a celda: con la columna de estado excluida en
 * medio, una fila son dos rangos, no veintisiete llamadas.
 */
function pintarFila(
  ws: any,
  fila: number,
  color: string | null,
  opts: OpcionesResaltado
): void {
	const excluidas = opts.columnasExcluidas ?? new Set<number>();
	let inicio = -1;
	for (let c = 0; c <= opts.totalColumnas; c++) {
		const cortar = c === opts.totalColumnas || excluidas.has(c);
		if (!cortar) {
			if (inicio === -1) inicio = c;
			continue;
		}
		if (inicio !== -1) {
			try {
				ws.getRange(fila, inicio, 1, c - inicio).setBackgroundColor(color);
			} catch {
				/// Una fila fuera de rango (bloque recién quitado) no debe tumbar el
				/// repintado del resto de la selección.
			}
			inicio = -1;
		}
	}
}

/**
 * Gestor de resaltado de UNA hoja.
 *
 * Mantiene qué filas están pintadas para poder despintarlas exactamente, sin
 * barrer la hoja entera ni recordar colores.
 */
export function crearResaltador(opts: OpcionesResaltado) {
	/// fila → zebra, de lo que está pintado ahora mismo.
	let pintadas = new Map<number, boolean>();

	return {
		/**
		 * Deja pintadas EXACTAMENTE estas filas y ninguna más.
		 *
		 * Calcula la diferencia contra lo anterior: mover la selección una fila
		 * dentro del mismo bloque no repinta el bloque, solo lo que cambió.
		 */
		aplicar(ws: any, filas: readonly FilaPintable[], color: string): void {
			if (!ws) return;
			const nuevas = new Map(filas.map((f) => [f.fila, f.zebra]));

			for (const [fila, zebra] of pintadas) {
				if (nuevas.has(fila)) continue;
				pintarFila(ws, fila, zebra ? ZEBRA_BG : null, opts);
			}
			for (const [fila] of nuevas) {
				if (pintadas.has(fila)) continue;
				pintarFila(ws, fila, color, opts);
			}
			pintadas = nuevas;
		},

		/** Despinta todo. Se llama al cambiar de hoja y al destruir la sesión. */
		limpiar(ws: any): void {
			if (!ws) return;
			for (const [fila, zebra] of pintadas) {
				pintarFila(ws, fila, zebra ? ZEBRA_BG : null, opts);
			}
			pintadas = new Map();
		},

		/** Filas pintadas ahora mismo. Para no repintar de más desde fuera. */
		get activas(): ReadonlySet<number> {
			return new Set(pintadas.keys());
		}
	};
}

export type Resaltador = ReturnType<typeof crearResaltador>;
