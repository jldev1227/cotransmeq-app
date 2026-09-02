/**
 * Inserción/actualización de una liquidación en la lista del canvas de
 * historial.
 *
 * Módulo aparte del componente por el mismo motivo que `historial-indices`: el
 * canvas necesita Univer, que no se instancia en un test de Node, y esto es
 * lógica pura que sí se puede probar.
 *
 * Lo que cubre es un fallo concreto. Guardar una liquidación desde el overlay
 * del canvas la mete en la lista por dos caminos a la vez: el `onGuardada` del
 * editor, y el eco del socket, porque el guardado va por HTTP y el backend
 * reemite a la sala — incluido el cliente que guardó. El engine de Univer ya
 * toleraba el duplicado (`insertarLiquidacion` delega en `actualizarLiquidacion`
 * si el id ya está), pero el array no: hacía `[l, ...liquidaciones]` a ciegas.
 * El síntoma no habría sido una fila repetida en la hoja, sino el contador del
 * encabezado mintiendo y la selección resolviendo dos veces la misma
 * liquidación.
 */

/** Lo mínimo que necesita el upsert; el canvas pasa `LiquidacionServicio`. */
export interface ConId {
	id: string;
}

/**
 * Devuelve la lista con `entrada` dentro: la reemplaza si su id ya estaba, o la
 * pone la primera si es nueva.
 *
 * Primera y no última porque el listado ordena por `created_at desc`, así que
 * una liquidación recién creada pertenece arriba — y es donde el engine la
 * inserta también.
 *
 * Devuelve un array nuevo siempre que haya cambio, para que la reactividad de
 * Svelte lo vea; si el id ya estaba, gana el objeto entrante.
 */
export function upsertLiquidacion<T extends ConId>(lista: T[], entrada: T): T[] {
	const i = lista.findIndex((x) => x.id === entrada.id);
	if (i === -1) return [entrada, ...lista];
	const copia = lista.slice();
	copia[i] = entrada;
	return copia;
}

/** `true` si el id ya estaba en la lista. Para decidir si avisar de un alta. */
export function yaEstaba<T extends ConId>(lista: T[], id: string): boolean {
	return lista.some((x) => x.id === id);
}
