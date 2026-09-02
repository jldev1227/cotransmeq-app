/**
 * Reindexado de filas del canvas de historial.
 *
 * Módulo aparte del engine a propósito: el engine llama a Univer, que
 * necesita canvas y WebGL y no se puede instanciar en un test de Node. Esta
 * es la ARITMÉTICA del desplazamiento, que es donde de verdad se rompen las
 * cosas — un índice mal desplazado hace que «Aprobar» actúe sobre la
 * liquidación de al lado, sin ningún error visible.
 *
 * Al separarla, el engine se queda con «llama a Univer y luego reindexa», y
 * la parte con lógica queda cubierta por `tests/servicios-historial-indices`.
 */

import type { FilaHistorial } from '../builders/servicios-historial.builder';

export interface AnclasHistorial {
	header: number;
	primeraFila: number;
	ultimaFila: number;
	totales: number;
}

/** La parte del modelo que el desplazamiento toca. */
export interface IndiceHistorial {
	filas: Map<number, FilaHistorial>;
	filasPorLiquidacion: Map<string, number[]>;
	anclas: AnclasHistorial;
}

/**
 * Desplaza en `delta` filas todo lo que esté en `desde` o por debajo.
 *
 * `delta > 0` para una inserción, `delta < 0` para un borrado. Las filas
 * afectadas ya deben haberse quitado del mapa antes de llamar con un delta
 * negativo: esta función mueve lo que queda, no borra nada.
 *
 * `ultimaFila` se DERIVA de `totales` en vez de ajustarse por su cuenta. Con
 * un ajuste condicional (`if (ultimaFila >= desde) ultimaFila += delta`),
 * quitar el último bloque la dejaba apuntando a una fila ya borrada, y el pie
 * se repintaba con un rango que incluía su propia celda — una referencia
 * circular que Univer resuelve como cero, así que el total desaparecía sin
 * error.
 */
export function desplazarFilas(idx: IndiceHistorial, desde: number, delta: number): void {
	if (delta !== 0) {
		const nuevas = new Map<number, FilaHistorial>();
		for (const [fila, info] of idx.filas) {
			const f = fila >= desde ? fila + delta : fila;
			info.fila = f;
			nuevas.set(f, info);
		}
		idx.filas = nuevas;

		for (const [id, filas] of idx.filasPorLiquidacion) {
			idx.filasPorLiquidacion.set(
				id,
				filas.map((f) => (f >= desde ? f + delta : f))
			);
		}
	}

	idx.anclas.totales += delta;
	// Invariante: los datos son contiguos entre `primeraFila` y la fila
	// anterior al pie. El `max` protege el caso de la hoja vacía, donde un
	// rango invertido produciría `=SUM(A2:A1)`.
	idx.anclas.ultimaFila = Math.max(idx.anclas.primeraFila, idx.anclas.totales - 1);
}

/** Lo mismo para la hoja de facturas, donde cada factura es UNA fila. */
export function desplazarFilasSimples<T extends { fila: number }>(
	filas: Map<number, T>,
	filaPorId: Map<string, number>,
	anclas: { primeraFila: number; totales: number },
	desde: number,
	delta: number
): Map<number, T> {
	if (delta === 0) {
		anclas.totales += delta;
		return filas;
	}
	const nuevas = new Map<number, T>();
	for (const [fila, info] of filas) {
		const f = fila >= desde ? fila + delta : fila;
		info.fila = f;
		nuevas.set(f, info);
	}
	for (const [id, fila] of filaPorId) {
		if (fila >= desde) filaPorId.set(id, fila + delta);
	}
	anclas.totales += delta;
	return nuevas;
}
