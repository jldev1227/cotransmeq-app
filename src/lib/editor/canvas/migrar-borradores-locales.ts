/**
 * Rescate de los borradores que quedaron en `localStorage`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  CÓDIGO CON FECHA DE CADUCIDAD: se borra en el release siguiente al que lo
 *  estrene. Para entonces todo borrador local con menos de 48 h ya habrá
 *  subido o habrá caducado, y lo único que quedaría es el coste de recorrer
 *  `localStorage` en cada montaje del editor.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hasta ahora el borrador se guardaba con `liq-svc-draft-<id>` o
 * `liq-svc-draft-new`. Al pasar el autoguardado al servidor, esas claves se
 * quedan huérfanas: nadie las lee, pero contienen trabajo real de gente que
 * cerró el navegador el viernes.
 *
 * De paso cierra un agujero. Esas claves NO tenían namespace por usuario, así
 * que en un equipo compartido el borrador de uno lo leía el siguiente que
 * entrara. Al subirlas al servidor —donde sí van por usuario— y borrarlas de
 * local, ese acceso cruzado desaparece.
 */

/// Mismo prefijo que usaba `getDraftKey` en el editor.
const PREFIJO = 'liq-svc-draft-';
/// La clave del borrador «nuevo», sin liquidación asociada.
const SUFIJO_NUEVO = 'new';
/// Misma ventana que aplicaba la restauración local. Un borrador más viejo no
/// se habría restaurado ni antes, así que subirlo sería resucitar basura.
const VENTANA_MS = 48 * 60 * 60 * 1000;
/// Se deja puesta para no repetir el barrido en cada montaje.
export const BANDERA_MIGRACION = 'liq-svc-draft-migrado-v1';

export interface BorradorLocal {
	clave: string;
	/// `null` para el borrador «nuevo».
	liquidacionId: string | null;
	payload: unknown;
}

/**
 * Decide si una clave de `localStorage` es un borrador que valga la pena subir.
 *
 * Devuelve `null` tanto para lo que no es un borrador como para lo caducado o
 * ilegible. En los dos casos la clave se borra igual: quien llama no distingue,
 * y dejar basura local era justamente el problema.
 */
export function interpretarClaveBorrador(
	clave: string,
	crudo: string | null,
	ahora = Date.now()
): BorradorLocal | null {
	if (!clave.startsWith(PREFIJO)) return null;
	if (clave === BANDERA_MIGRACION) return null;
	if (!crudo) return null;

	let payload: any;
	try {
		payload = JSON.parse(crudo);
	} catch {
		return null;
	}
	if (!payload || typeof payload !== 'object') return null;

	const ts = Number(payload.ts) || 0;
	if (!ts || ahora - ts > VENTANA_MS) return null;

	const sufijo = clave.slice(PREFIJO.length);
	/// El id sale de la CLAVE y no de `payload.editingId`: la clave es lo que
	/// decidía dónde se guardaba, y si los dos no coinciden manda la clave.
	const liquidacionId = sufijo === SUFIJO_NUEVO ? null : sufijo || null;

	return { clave, liquidacionId, payload };
}

/**
 * Recorre `localStorage` y devuelve qué subir y qué claves borrar.
 *
 * Separado del envío para poder probarlo: la parte con red no necesita test,
 * la de decidir qué se sube y qué se tira sí.
 */
export function recogerBorradoresLocales(
	almacen: Pick<Storage, 'length' | 'key' | 'getItem'>,
	ahora = Date.now()
): { subir: BorradorLocal[]; borrar: string[] } {
	const subir: BorradorLocal[] = [];
	const borrar: string[] = [];

	for (let i = 0; i < almacen.length; i++) {
		const clave = almacen.key(i);
		if (!clave || !clave.startsWith(PREFIJO) || clave === BANDERA_MIGRACION) continue;

		/// Se borra SIEMPRE, se haya podido subir o no: si no se pudo leer, no
		/// hay nada que rescatar, y dejarla es dejar el agujero de privacidad
		/// abierto.
		borrar.push(clave);

		const b = interpretarClaveBorrador(clave, almacen.getItem(clave), ahora);
		if (b) subir.push(b);
	}

	return { subir, borrar };
}
