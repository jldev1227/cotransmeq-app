/**
 * Decisiones del autoguardado del formulario de liquidaciones de servicios.
 *
 * Módulo aparte del componente por lo de siempre en este repo: `LiquidacionEditor`
 * son ~9.700 líneas de Svelte que no se instancian en un test de Node, y esto
 * es donde de verdad se rompen las cosas — cuándo nace una fila en la base y
 * qué gana cuando el servidor y el borrador no coinciden. Ver
 * `historial-indices.ts` y `totales-visibles.ts`, mismo criterio.
 */

/** Lo que devuelve `buildDraftPayload()` en el editor, en lo que aquí importa. */
export interface PayloadBorrador {
	editingId?: string | null;
	selectedCliente?: { id?: string } | null;
	hdr?: { consecutivo?: string };
	rows?: Array<{ placa?: string }>;
	ts?: number;
}

/**
 * Dónde va este autoguardado.
 *
 * - `fila`: hay bastante para crear (o actualizar) la liquidación real en
 *   BORRADOR, que es lo que la hace persistente y abrible por otro usuario.
 * - `previo`: todavía no puede existir la fila —`cliente_id` y `consecutivo`
 *   son obligatorios en la base— así que el estado va a la tabla de borrador
 *   por usuario.
 * - `ninguno`: no hay nada que valga la pena guardar.
 *
 * La tercera condición (alguna placa) es la que evita llenar la base de filas
 * de gente que abrió el formulario y se fue. Es la misma heurística de
 * «esto ya es trabajo» que usaba la restauración del borrador local.
 */
export function decidirDestino(
	p: PayloadBorrador | null | undefined
): 'fila' | 'previo' | 'ninguno' {
	if (!p) return 'ninguno';

	/// Si ya hay fila, todo va a la fila: da igual que el usuario haya borrado
	/// las placas después, lo que existe en la base no se abandona.
	if (p.editingId) return 'fila';

	const hayCliente = !!p.selectedCliente?.id;
	const hayConsecutivo = !!p.hdr?.consecutivo?.trim();
	const hayPlaca = !!p.rows?.some((r) => !!r?.placa?.trim());

	if (hayCliente && hayConsecutivo && hayPlaca) return 'fila';
	if (hayCliente || hayConsecutivo || hayPlaca) return 'previo';
	return 'ninguno';
}

/** Qué gana al abrir el formulario. */
export type Restauracion = 'servidor' | 'preguntar' | 'draft';

/**
 * Qué se pinta al abrir: lo del servidor, lo del borrador, o hay que preguntar.
 *
 * Hasta ahora el borrador local se aplicaba ENCIMA de lo que acababa de llegar
 * del servidor, en silencio. Con una liquidación que otro pudo haber tocado —o
 * aprobado— eso resucita datos viejos sin que nadie se entere, así que cuando
 * los dos difieren se pregunta.
 *
 * @param hashServidor  hash del estado tal como vino del servidor
 * @param hashDraft     hash del borrador guardado
 * @param tsDraft       cuándo se guardó el borrador (ms)
 * @param tsServidor    `updated_at` del servidor (ms)
 */
export function decidirRestauracion(opts: {
	hashServidor: string | null;
	hashDraft: string | null;
	tsDraft?: number | null;
	tsServidor?: number | null;
}): Restauracion {
	const { hashServidor, hashDraft, tsDraft, tsServidor } = opts;

	if (!hashDraft) return 'servidor';
	/// Sin snapshot del servidor es una liquidación nueva: no hay con qué
	/// comparar y el borrador es lo único que hay.
	if (!hashServidor) return 'draft';
	if (hashDraft === hashServidor) return 'servidor';

	/// El borrador es más viejo que lo último que se guardó en el servidor: es
	/// un residuo de una sesión anterior, no trabajo pendiente. Se descarta sin
	/// molestar al usuario.
	if (tsDraft != null && tsServidor != null && tsDraft <= tsServidor) return 'servidor';

	return 'preguntar';
}

/**
 * Hash estable de una cadena (djb2, base36).
 *
 * Extraído del editor sin cambios. Sirve para dos cosas: no reescribir cuando
 * nada cambió —que con red pasa de ahorrar bytes a ahorrar peticiones— y
 * comparar el borrador con lo que vino del servidor.
 */
export function hashStr(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h.toString(36);
}
