/**
 * Totales del pie contando solo lo que el filtro deja ver.
 *
 * Módulo aparte del engine por lo mismo que `historial-indices`: el engine
 * habla con Univer, que necesita canvas y WebGL y no se instancia en un test
 * de Node. Esto es la aritmética, y es donde se rompen las cosas.
 *
 * El detalle que obliga a escribirlo a mano en vez de dejarlo en una fórmula:
 * en esta hoja **una fila es un ÍTEM**, y los importes de la liquidación
 * (subtotal, IVA, total) se REPITEN en cada fila de su bloque. Un `SUM` sobre
 * esas columnas sumaría el total de una liquidación tantas veces como ítems
 * tenga. Por eso se cuenta cada liquidación una sola vez, por id.
 *
 * Y por eso el dedup NO puede apoyarse en `esPrimeraDeSuLiquidacion`: un
 * filtro puede ocultar precisamente la primera fila del bloque y dejar
 * visibles las demás, y esa liquidación seguiría estando en pantalla.
 */

/** Lo que el pie necesita de cada fila; `FilaHistorial` lo cumple. */
export interface FilaSumable {
	fila: number;
	/// Id de la LIQUIDACIÓN, no del ítem.
	id: string;
	subtotal: number;
	iva: number;
	total: number;
}

export interface TotalesVisibles {
	/// Liquidaciones distintas con al menos una fila visible.
	liquidaciones: number;
	/// Filas visibles, que en esta hoja es lo mismo que ítems.
	items: number;
	subtotal: number;
	iva: number;
	total: number;
}

/**
 * Suma las filas que no estén en `filtradas`.
 *
 * `filtradas` son índices de fila de Univer, tal como los devuelve
 * `FFilter.getFilteredOutRows()`. Un conjunto vacío significa «sin filtro», y
 * entonces el resultado es el total del histórico completo.
 */
export function totalesVisibles(
	filas: Iterable<FilaSumable>,
	filtradas: ReadonlySet<number> = new Set()
): TotalesVisibles {
	const vistas = new Set<string>();
	let items = 0;
	let subtotal = 0;
	let iva = 0;
	let total = 0;

	for (const f of filas) {
		if (filtradas.has(f.fila)) continue;
		items += 1;
		if (vistas.has(f.id)) continue;
		vistas.add(f.id);
		subtotal += f.subtotal || 0;
		iva += f.iva || 0;
		total += f.total || 0;
	}

	return { liquidaciones: vistas.size, items, subtotal, iva, total };
}
