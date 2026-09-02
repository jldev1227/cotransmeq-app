import type { SheetSession } from './sheet-session.svelte';
import type { CeldaDeCapa, Ancla, TipoAncla } from '../business/zona-libre';

/**
 * Capa de ANOTACIONES del canvas: las celdas libres que el equipo usa para
 * dejar referencias, recordatorios o valores de apoyo.
 *
 * Viajan por el MISMO `sheet:patch` que el resto de celdas, con
 * `entity_type: 'anotacion'`, para no inventar un segundo protocolo. Lo que
 * cambia es el destino: no tocan ninguna tabla de negocio, se guardan en
 * `canvas_anotacion` y no entran en ningún total ni fórmula.
 *
 * El `entity_id` es `<sheet_key>:<offset_fila>:<columna>`. La fila NO es
 * absoluta sino relativa al final del bloque estructurado, así que la nota
 * sigue en su sitio aunque mañana la tabla crezca.
 */

/// Clave de celda anotada, tal y como viaja en el protocolo.
export function idAnotacion(sheetKey: string, a: Ancla): string {
	// El ancla forma parte de la identidad: una celda atada a un item y otra
	// atada a una fila no son la misma celda aunque coincidieran en pantalla.
	return `${sheetKey}|${a.tipo}|${a.ref}|${a.offset}|${a.columna}`;
}

const TIPOS_ANCLA: ReadonlySet<string> = new Set<TipoAncla>(['fila', 'item', 'clave', 'top']);

export function parseIdAnotacion(
	id: string
): { sheetKey: string; ancla: Ancla } | null {
	const p = String(id).split('|');
	if (p.length !== 5) return null;
	const offset = Number(p[3]);
	const columna = Number(p[4]);
	if (!Number.isInteger(offset) || !Number.isInteger(columna)) return null;
	// LOS CUATRO TIPOS. La lista se quedó corta —le faltaban `clave` y `top`— y
	// eso no fallaba ruidosamente: el patch de una celda de esos tipos se
	// descartaba en silencio, así que ni se repintaba para el resto del room ni
	// se adoptaba la versión del acuse, y la siguiente edición de la MISMA celda
	// chocaba consigo misma por `base_version` obsoleta.
	if (!TIPOS_ANCLA.has(p[1])) return null;
	return { sheetKey: p[0], ancla: { tipo: p[1] as TipoAncla, ref: p[2], offset, columna } };
}

/**
 * Registro de versiones por celda anotada.
 *
 * Hace falta por lo mismo que en el resto del canvas: el `base_version` del
 * siguiente patch tiene que ser el que devolvió el servidor en el acuse, no el
 * que se cargó al montar. Sin esto, la segunda edición seguida de una misma
 * nota se rechazaría por conflicto contra uno mismo.
 *
 * `0` significa «esta celda todavía no existe en la base»: es lo que el
 * servicio interpreta como alta.
 */
export class VersionesAnotaciones {
	private versiones = new Map<string, number>();

	hidratar(porHoja: Record<string, CeldaDeCapa[]> | undefined, mes: number): void {
		for (const [sheetKey, lista] of Object.entries(porHoja ?? {})) {
			for (const a of lista ?? []) {
				const ancla: Ancla = {
					tipo: (a.ancla_tipo as any) ?? 'fila',
					ref: a.ancla_ref ?? '',
					offset: a.offset_fila,
					columna: a.columna
				};
				this.versiones.set(this.clave(mes, idAnotacion(sheetKey, ancla)), a.version);
			}
		}
	}

	de(mes: number, entityId: string): number {
		return this.versiones.get(this.clave(mes, entityId)) ?? 0;
	}

	set(mes: number, entityId: string, version: number): void {
		this.versiones.set(this.clave(mes, entityId), version);
	}

	limpiar(): void {
		this.versiones.clear();
	}

	private clave(mes: number, entityId: string): string {
		return `${mes}:${entityId}`;
	}
}

export interface EmitirAnotacionOpts {
	session: SheetSession | null;
	versiones: VersionesAnotaciones;
	mes: number;
	sheetKey: string;
	ancla: Ancla;
	/// `null` o cadena vacía borra la nota.
	valor: string | null;
}

/**
 * Manda una anotación al servidor. Devuelve el `entity_id` afectado, o `null`
 * si no había sesión (canvas sin colaboración activa).
 */
export function emitirAnotacion(opts: EmitirAnotacionOpts): string | null {
	const { session, versiones, mes, sheetKey, ancla, valor } = opts;
	if (!session) return null;

	const entityId = idAnotacion(sheetKey, ancla);
	const version = versiones.de(mes, entityId);
	// Borrar algo que nunca se guardó no es un cambio: emitirlo crearía una fila
	// vacía en la base por cada celda que el usuario limpie de pasada.
	if ((valor == null || valor === '') && version === 0) return null;
	session.enviarPatch({
		mes,
		entity_type: 'anotacion',
		entity_id: entityId,
		field: 'valor',
		value: valor === '' ? null : valor,
		base_version: version
	});
	return entityId;
}
