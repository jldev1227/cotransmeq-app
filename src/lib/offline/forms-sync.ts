/**
 * Sincronizador de la outbox.
 *
 * Es el componente del que depende que un conductor no pierda una inspección.
 * Cinco decisiones lo gobiernan:
 *
 *  1. **Una operación a la vez, con lease.** El lease se toma en la misma
 *     transacción de IndexedDB que la lectura (`claimNextOperation`), así que dos
 *     pestañas no pueden ejecutar la misma operación. `BroadcastChannel` solo
 *     coordina despertares; no da exclusión mutua.
 *
 *  2. **Las dependencias se respetan.** El `SUBMIT` depende de los
 *     `COMPLETE_ATTACHMENT`, que dependen de los `UPLOAD`, que dependen de los
 *     `INIT`, que dependen del `BACKUP_DRAFT` que crea el envío en el servidor.
 *     Sin ese orden, el servidor rechazaría el envío con `ATTACHMENT_MISSING`
 *     —o el adjunto con `SUBMISSION_NOT_FOUND`— y el conductor vería un fallo
 *     que no es suyo.
 *
 *  3. **`navigator.onLine` no basta.** Antes de cada ronda se confirma
 *     conectividad con una petición real: en un portal cautivo `onLine` es `true`
 *     y nada llega.
 *
 *  4. **Un 4xx de validación NO se reintenta.** Se marca `BLOCKED` y el borrador
 *     queda editable con el detalle del error. Reintentar mil veces daría mil
 *     veces el mismo error.
 *
 *  5. **Un 401 pausa; no borra.** La sesión del magic link caduca; el trabajo se
 *     conserva y se reanuda tras autenticar.
 */

import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { portalSession } from '$lib/stores/portalStore';
import { PortalApiError, hayConexionReal, portalFormulariosAPI } from '$lib/api/formularios-portal';
import {
	allDrafts,
	allOperations,
	allReceipts,
	attachmentsForSubmission,
	claimNextOperation,
	deleteDraftCascade,
	deleteOperation,
	enqueueMany,
	getAssignment,
	getAttachment,
	getDraft,
	getMeta,
	getReceipt,
	installationId,
	markDraftBlocked,
	patchAttachment,
	patchOperation,
	putReceipt,
	releaseStaleLeases,
	setMeta,
	type OutboxOperation,
	type StoredAttachment,
	type StoredDraft
} from './forms-db';

const CHANNEL = 'transmeralda-forms-sync';

/**
 * Backoff con jitter: 1 s, 2 s, 4 s, 8 s, 30 s y tope de 5 minutos.
 *
 * El jitter evita el efecto manada: veinte conductores que recuperan cobertura
 * en el mismo punto de la ruta reintentarían en el mismo milisegundo.
 */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000, 300_000];

function siguienteEspera(intentos: number): number {
	const base = BACKOFF_MS[Math.min(intentos, BACKOFF_MS.length - 1)];
	return base + Math.floor(Math.random() * Math.min(base * 0.3, 5_000));
}

// ─── Estado observable ───────────────────────────────────────────────────────

export type SyncPhase = 'idle' | 'checking' | 'syncing' | 'offline' | 'paused-auth' | 'blocked';

export interface SyncState {
	phase: SyncPhase;
	/** Operaciones en la cola (cualquier estado). */
	pending: number;
	/**
	 * Envíos distintos representados por esas operaciones.
	 *
	 * Un envío genera varias operaciones (un `INIT`, un `UPLOAD` y un `COMPLETE`
	 * por foto, más el `SUBMIT`), así que contar operaciones y llamarlas «envíos»
	 * en la pantalla exagera el problema: «7 en cola» para un preoperacional con
	 * dos fotos. Lo que el conductor cuenta son formularios.
	 */
	submissions: number;
	/** Operaciones `BLOCKED`. Para diagnóstico; la pantalla usa `blockedSubmissions`. */
	blocked: number;
	/** Envíos distintos con alguna operación bloqueada. */
	blockedSubmissions: number;
	/** Antigüedad de la operación más vieja, en ms. `null` si la cola está vacía. */
	oldestAgeMs: number | null;
	lastSyncAt: string | null;
	lastError: { code: string; message: string } | null;
}

export const syncState = writable<SyncState>({
	phase: 'idle',
	pending: 0,
	submissions: 0,
	blocked: 0,
	blockedSubmissions: 0,
	oldestAgeMs: null,
	lastSyncAt: null,
	lastError: null
});

/** Recibos nuevos, para que la UI reaccione sin sondear IndexedDB. */
export const receiptEvents = writable<{ clientSubmissionId: string; submissionId: string } | null>(
	null
);

// ─── Detalle de la cola ──────────────────────────────────────────────────────

/**
 * Un envío pendiente, ya identificado con nombre y apellidos.
 *
 * Existe porque un contador no basta. «2 necesitan corrección» no dice CUÁLES, y
 * hasta ahora la única forma de encontrarlos era que su asignación siguiera
 * apareciendo en la lista de formularios en estado `AVAILABLE`. Un borrador cuya
 * asignación cambió de período, o que HSEQ retiró, quedaba contado en el panel
 * pero sin ninguna tarjeta donde verse: el conductor leía que tenía trabajo
 * pendiente en formularios que ni recordaba haber empezado, y no había forma de
 * llegar a ellos ni de quitarlos.
 */
export interface EnvioEnCola {
	clientSubmissionId: string;
	assignmentId: string | null;
	/** Código y título del formato, o `null` si ya no queda rastro para nombrarlo. */
	code: string | null;
	title: string | null;
	/** Operaciones que le quedan en la cola. */
	operaciones: number;
	bloqueado: boolean;
	/** Antigüedad de su operación más vieja, en ms. */
	ageMs: number;
	progress: number | null;
	error: { code: string; message: string } | null;
	/** Queda borrador local, así que se puede abrir para corregirlo. */
	abrible: boolean;
}

/** La cola, envío a envío. Se recalcula con cada `refrescarEstado`. */
export const colaEnvios = writable<EnvioEnCola[]>([]);

async function detallarCola(operaciones: OutboxOperation[]): Promise<EnvioEnCola[]> {
	if (operaciones.length === 0) return [];

	const borradores = new Map((await allDrafts()).map((d) => [d.clientSubmissionId, d]));
	const ahora = Date.now();

	const porEnvio = new Map<string, OutboxOperation[]>();
	for (const operacion of operaciones) {
		const grupo = porEnvio.get(operacion.aggregateId);
		if (grupo) grupo.push(operacion);
		else porEnvio.set(operacion.aggregateId, [operacion]);
	}

	const envios = await Promise.all(
		[...porEnvio].map(async ([clientSubmissionId, grupo]): Promise<EnvioEnCola> => {
			const draft = borradores.get(clientSubmissionId);
			/// El recibo es el plan B para ponerle nombre: si el borrador ya se borró
			/// —envío entregado con una operación rezagada— el recibo conserva el
			/// código y el título, y sin él la fila saldría anónima.
			const recibo = draft ? undefined : await getReceipt(clientSubmissionId);
			const assignmentId = draft?.assignmentId ?? recibo?.assignmentId ?? null;
			const asignacion = assignmentId ? await getAssignment(assignmentId) : undefined;
			const bloqueada = grupo.find((o) => o.state === 'BLOCKED');

			return {
				clientSubmissionId,
				assignmentId,
				code: asignacion?.code ?? recibo?.code ?? null,
				title: asignacion?.title ?? recibo?.title ?? null,
				operaciones: grupo.length,
				/// El borrador y la operación pueden discrepar un instante mientras se
				/// escriben los dos; basta con que uno lo diga para pedir atención.
				bloqueado: Boolean(bloqueada) || Boolean(draft?.blocked),
				ageMs: grupo.reduce((max, o) => Math.max(max, ahora - new Date(o.createdAt).getTime()), 0),
				progress: draft?.progress ?? null,
				error: draft?.blocked
					? { code: draft.blocked.code, message: draft.blocked.message }
					: bloqueada?.lastError
						? { code: bloqueada.lastError.code, message: bloqueada.lastError.message }
						: null,
				abrible: Boolean(draft)
			};
		})
	);

	/// Lo bloqueado primero —es lo único que exige una acción del conductor— y
	/// dentro de cada grupo lo más viejo arriba.
	return envios.sort((a, b) =>
		a.bloqueado !== b.bloqueado ? (a.bloqueado ? -1 : 1) : b.ageMs - a.ageMs
	);
}

// ─── Motor ───────────────────────────────────────────────────────────────────

let owner: string | null = null;
let channel: BroadcastChannel | null = null;
let corriendo = false;
let timerProximo: ReturnType<typeof setTimeout> | null = null;
let arrancado = false;

async function refrescarEstado(phase?: SyncPhase) {
	const operaciones = await allOperations();
	const bloqueadas = operaciones.filter((o) => o.state === 'BLOCKED');
	const masVieja = operaciones.reduce<number | null>((min, o) => {
		const edad = Date.now() - new Date(o.createdAt).getTime();
		return min === null || edad > min ? edad : min;
	}, null);

	const detalle = await detallarCola(operaciones);
	colaEnvios.set(detalle);

	syncState.update((s) => ({
		...s,
		...(phase ? { phase } : {}),
		pending: operaciones.length,
		submissions: detalle.length,
		blocked: bloqueadas.length,
		blockedSubmissions: detalle.filter((e) => e.bloqueado).length,
		oldestAgeMs: masVieja
	}));
}

/**
 * Arranca el sincronizador.
 *
 * Idempotente: llamarlo desde varias páginas del portal no crea varios motores.
 * Los eventos (`online`, `visibilitychange`, `focus`) solo DESPIERTAN; la
 * decisión de sincronizar la toma `tick()` tras confirmar conectividad real.
 */
export async function startSync(): Promise<void> {
	if (!browser || arrancado) return;
	arrancado = true;

	owner = await installationId();

	/// Leases huérfanos de una pestaña que se cerró a mitad de una subida: sin
	/// esto quedarían `RUNNING` para siempre y el envío no se completaría nunca.
	await releaseStaleLeases();

	/// Antes de mirar el estado: una operación `BLOCKED` no se reintenta nunca, así
	/// que un teléfono que ya se atascó no se cura solo por abrir el portal.
	await purgarObsoletasTrasRecibo();
	await rescatarBloqueadosSinBorrador();

	try {
		channel = new BroadcastChannel(CHANNEL);
		channel.onmessage = (event) => {
			if (event.data?.type === 'wake') void tick();
			if (event.data?.type === 'receipt') receiptEvents.set(event.data.payload);
		};
	} catch {
		/// Sin `BroadcastChannel` el lease en IndexedDB sigue evitando el trabajo
		/// duplicado; solo se pierde el despertar inmediato de las otras pestañas.
		channel = null;
	}

	const despertar = () => void tick();
	window.addEventListener('online', despertar);
	window.addEventListener('focus', despertar);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') despertar();
	});

	await refrescarEstado();
	void tick();
}

/** Despierta a todas las pestañas. */
export function wakeAll(): void {
	void tick();
	channel?.postMessage({ type: 'wake' });
}

function programar(ms: number) {
	if (timerProximo) clearTimeout(timerProximo);
	timerProximo = setTimeout(() => void tick(), ms);
}

/**
 * Una ronda de sincronización.
 *
 * Procesa operaciones hasta que no queda ninguna elegible, y reprograma según la
 * espera de la más próxima. No entra en bucle: `claimNextOperation` solo devuelve
 * operaciones cuyo `nextAttemptAt` ya venció.
 */
export async function tick(): Promise<void> {
	if (!browser || corriendo) return;
	if (!get(portalSession)?.token) {
		syncState.update((s) => ({ ...s, phase: 'paused-auth' }));
		return;
	}

	corriendo = true;
	try {
		const operaciones = await allOperations();
		const elegibles = operaciones.filter((o) => o.state === 'PENDING' || o.state === 'RETRY');
		if (elegibles.length === 0) {
			await refrescarEstado(operaciones.some((o) => o.state === 'BLOCKED') ? 'blocked' : 'idle');
			return;
		}

		syncState.update((s) => ({ ...s, phase: 'checking' }));
		if (!(await hayConexionReal())) {
			await refrescarEstado('offline');
			/// Sin red no se reintenta en bucle: se espera al evento `online` o al
			/// siguiente despertar por foco.
			programar(30_000);
			return;
		}

		/// `refrescarEstado` y no un `update` a secas: cambiar solo la fase dejaba el
		/// contador `pending` con el valor de la ronda anterior, así que el chip decía
		/// «Todo sincronizado» mientras había una operación en vuelo.
		await refrescarEstado('syncing');

		for (;;) {
			const operacion = await claimNextOperation(owner!);
			if (!operacion) break;
			const resultado = await ejecutar(operacion);
			if (resultado === 'auth') {
				await refrescarEstado('paused-auth');
				return;
			}
			if (resultado === 'offline') {
				await refrescarEstado('offline');
				programar(30_000);
				return;
			}
		}

		await setMeta('lastSyncAt', new Date().toISOString());
		const restantes = await allOperations();
		syncState.update((s) => ({
			...s,
			lastSyncAt: new Date().toISOString(),
			lastError: null
		}));
		await refrescarEstado(restantes.some((o) => o.state === 'BLOCKED') ? 'blocked' : 'idle');

		/**
		 * Reprograma según la operación con la espera más próxima.
		 *
		 * Las esperas ya VENCIDAS (`ms <= 0`) se cuentan como cero en vez de
		 * descartarse, y esa es la diferencia entre un motor que sigue vivo y uno que
		 * se duerme para siempre.
		 *
		 * El caso: el autosave encola un `BACKUP_DRAFT` MIENTRAS este tick corre. El
		 * bucle de `claimNextOperation` ya había salido, así que nadie la ejecutó; y
		 * como su `nextAttemptAt` es «ahora», su espera no es positiva. Con el filtro
		 * anterior desaparecía de la lista, no se programaba ningún temporizador y la
		 * operación se quedaba `PENDING` indefinidamente: solo la rescataba un evento
		 * externo (`online`, `focus`, cambio de pestaña). Desde fuera parecía que el
		 * backup «a veces» no sincronizaba.
		 *
		 * Solo cuentan las que `claimNextOperation` podría entregar de VERDAD, y por
		 * eso se repite aquí su filtro de dependencias (`forms-db.ts`).
		 *
		 * Sin ese filtro, una operación vencida pero bloqueada por su dependencia
		 * daba espera 0 y programaba un tick a 1 s que no podía ejecutarla: nadie la
		 * reclamaba, nadie la resolvía, y la ronda siguiente repetía el ciclo. El
		 * resultado era un `hayConexionReal()` por segundo —una petición a la lista
		 * completa de asignaciones— mientras el bloqueador real dormía su backoff de
		 * minutos. Un `SUBMIT` esperando a su `UPLOAD` tiene que esperar lo que
		 * espera el `UPLOAD`, no un segundo.
		 *
		 * Tampoco deja el motor sin temporizador: el bloqueador está en la misma
		 * lista y no tiene dependencias pendientes, así que aporta su propia espera.
		 */
		const idsEnCola = new Set(restantes.map((o) => o.operationId));
		const esperas = restantes
			.filter((o) => o.state === 'RETRY' || o.state === 'PENDING')
			.filter((o) => o.dependsOn.every((dep) => !idsEnCola.has(dep)))
			.map((o) => Math.max(0, new Date(o.nextAttemptAt).getTime() - Date.now()));
		if (esperas.length) programar(Math.max(1_000, Math.min(...esperas)));
	} finally {
		corriendo = false;
	}
}

type Resultado = 'ok' | 'retry' | 'blocked' | 'auth' | 'offline';

async function ejecutar(operacion: OutboxOperation): Promise<Resultado> {
	try {
		switch (operacion.type) {
			case 'BACKUP_DRAFT':
				await ejecutarBackup(operacion);
				break;
			case 'INIT_ATTACHMENT':
				await ejecutarInit(operacion);
				break;
			case 'UPLOAD_ATTACHMENT':
				await ejecutarUpload(operacion);
				break;
			case 'COMPLETE_ATTACHMENT':
				await ejecutarComplete(operacion);
				break;
			case 'DISCARD_ATTACHMENT':
				await ejecutarDiscard(operacion);
				break;
			case 'SUBMIT':
				await ejecutarSubmit(operacion);
				break;
		}
		/// Éxito: la operación se BORRA. Es lo que hace que sus dependientes se
		/// consideren desbloqueados (`claimNextOperation` resuelve dependencias por
		/// ausencia).
		await deleteOperation(operacion.operationId);
		/// Y se REINTENTA la limpieza del borrador. `ejecutarSubmit` la llama al
		/// terminar, pero si otra operación del mismo envío seguía en cola en ese
		/// momento, la limpieza no se hizo y nadie volvía a intentarla: el borrador
		/// se quedaba en el teléfono con el envío ya entregado. Ahora la última
		/// operación en terminar —sea cual sea— es la que limpia.
		await limpiarSiCompleto(operacion.aggregateId);
		return 'ok';
	} catch (err) {
		return manejarError(operacion, err);
	}
}

async function manejarError(operacion: OutboxOperation, err: unknown): Promise<Resultado> {
	const error =
		err instanceof PortalApiError
			? err
			: new PortalApiError(
					'INTERNAL_ERROR',
					err instanceof Error ? err.message : String(err),
					0,
					null
				);

	if (error.needsAuth) {
		/// Se devuelve a `PENDING` sin gastar un intento: la sesión caducada no es
		/// culpa de la operación, y contarla agotaría el backoff sin motivo.
		await patchOperation(operacion.operationId, {
			state: 'PENDING',
			leaseOwner: undefined,
			leaseUntil: undefined,
			lastError: { code: error.code, message: error.message, retryable: true }
		});
		syncState.update((s) => ({ ...s, lastError: { code: error.code, message: error.message } }));
		return 'auth';
	}

	if (error.code === 'NETWORK_ERROR' || error.code === 'ABORTED') {
		await patchOperation(operacion.operationId, {
			state: 'PENDING',
			leaseOwner: undefined,
			leaseUntil: undefined
		});
		return 'offline';
	}

	if (!error.retryable) {
		/// 4xx de validación o de límite: no se reintenta. El borrador queda
		/// bloqueado y editable con el detalle, para que el conductor corrija.
		await patchOperation(operacion.operationId, {
			state: 'BLOCKED',
			attempts: operacion.attempts + 1,
			leaseOwner: undefined,
			leaseUntil: undefined,
			lastError: { code: error.code, message: error.message, retryable: false }
		});
		await markDraftBlocked(operacion.aggregateId, {
			code: error.code,
			message: error.message,
			details: error.details
		});
		syncState.update((s) => ({ ...s, lastError: { code: error.code, message: error.message } }));
		return 'blocked';
	}

	const intentos = operacion.attempts + 1;
	await patchOperation(operacion.operationId, {
		state: 'RETRY',
		attempts: intentos,
		nextAttemptAt: new Date(Date.now() + siguienteEspera(intentos)).toISOString(),
		leaseOwner: undefined,
		leaseUntil: undefined,
		lastError: { code: error.code, message: error.message, retryable: true }
	});
	syncState.update((s) => ({ ...s, lastError: { code: error.code, message: error.message } }));
	return 'retry';
}

// ─── Ejecutores ──────────────────────────────────────────────────────────────

/** Sube el borrador tal como está en el dispositivo. Crea la fila si no existe. */
async function subirBorrador(draft: StoredDraft) {
	return portalFormulariosAPI.guardarBorrador(draft.clientSubmissionId, {
		assignmentId: draft.assignmentId,
		versionId: draft.versionId,
		context: draft.context,
		answers: draft.answers,
		progress: draft.progress,
		startedAt: draft.createdAt,
		device: { installationId: owner }
	});
}

async function ejecutarBackup(operacion: OutboxOperation): Promise<void> {
	const draft = await getDraft(operacion.aggregateId);
	/// El borrador puede haberse enviado o descartado mientras la operación
	/// esperaba: no es un error, simplemente ya no hay nada que respaldar.
	if (!draft) return;

	const resultado = await subirBorrador(draft);

	/// El servidor avisa de que ese `clientSubmissionId` ya está entregado: la
	/// outbox venía retrasada. Se limpia lo local en vez de insistir.
	if (resultado?.alreadySubmitted) {
		await limpiarSiCompleto(draft.clientSubmissionId);
	}
}

/**
 * `init` del adjunto, creando el borrador en el servidor si allí no existe.
 *
 * La cadena ya pone un `BACKUP_DRAFT` por delante, así que en un envío encolado
 * por esta versión esto no debería activarse nunca. Existe por dos casos que el
 * orden no cubre:
 *
 *  - Teléfonos con una cadena VIEJA en cola, encolada antes de que existiera la
 *    cabeza. Sin esto habría que pedirle al conductor que reenviara a mano un
 *    formulario que ya dio por entregado.
 *  - La fila existió y desapareció: borrador descartado desde otro dispositivo,
 *    restauración de la base, o el front apuntando a otro backend.
 *
 * Un solo reintento. Si después de crear el borrador el `init` insiste en que no
 * existe, el problema no es de orden y repetir solo gastaría datos.
 */
async function iniciarAdjuntoAsegurando(adjunto: StoredAttachment) {
	const peticion = () =>
		portalFormulariosAPI.iniciarAdjunto({
			clientSubmissionId: adjunto.clientSubmissionId,
			clientAttachmentId: adjunto.clientAttachmentId,
			fieldId: adjunto.fieldId,
			occurrenceId: adjunto.occurrenceId,
			kind: adjunto.kind,
			mimeType: adjunto.mimeType,
			byteSize: adjunto.byteSize,
			sha256: adjunto.sha256,
			originalName: adjunto.originalName
		});

	try {
		return await peticion();
	} catch (err) {
		if (!(err instanceof PortalApiError) || err.code !== 'SUBMISSION_NOT_FOUND') throw err;

		const draft = await getDraft(adjunto.clientSubmissionId);
		/// Sin borrador local no hay nada que crear: el 404 es la verdad.
		if (!draft) throw err;

		const guardado = await subirBorrador(draft);
		/// El backup dice «ya entregado» y el `init` decía «no existe». Son
		/// incompatibles, así que hay algo más roto que el orden: se deja el error
		/// original, que es el que describe lo que de verdad falló.
		if (guardado?.alreadySubmitted) throw err;

		return peticion();
	}
}

async function ejecutarInit(operacion: OutboxOperation): Promise<void> {
	const clientAttachmentId = String(operacion.payload.clientAttachmentId);
	const adjunto = await getAttachment(clientAttachmentId);
	if (!adjunto) return;
	if (adjunto.state === 'UPLOADED') return;

	const resultado = await iniciarAdjuntoAsegurando(adjunto);

	await patchAttachment(clientAttachmentId, {
		serverId: resultado.attachmentId,
		uploadUrl: resultado.uploadUrl ?? undefined,
		state: resultado.alreadyUploaded ? 'UPLOADED' : 'INITIALIZED'
	});
}

async function ejecutarUpload(operacion: OutboxOperation): Promise<void> {
	const clientAttachmentId = String(operacion.payload.clientAttachmentId);
	const adjunto = await getAttachment(clientAttachmentId);
	if (!adjunto) return;
	if (adjunto.state === 'UPLOADED') return;

	if (!adjunto.uploadUrl) {
		/// El `INIT` no llegó a guardar la URL (o caducó). Se pide otra en vez de
		/// dar el adjunto por perdido.
		const resultado = await iniciarAdjuntoAsegurando(adjunto);
		if (resultado.alreadyUploaded) {
			await patchAttachment(clientAttachmentId, {
				state: 'UPLOADED',
				serverId: resultado.attachmentId
			});
			return;
		}
		if (!resultado.uploadUrl)
			throw new PortalApiError('UPLOAD_FAILED', 'Sin URL de subida.', 500, null);
		await patchAttachment(clientAttachmentId, {
			serverId: resultado.attachmentId,
			uploadUrl: resultado.uploadUrl,
			state: 'INITIALIZED'
		});
		await portalFormulariosAPI.subirBinario(resultado.uploadUrl, adjunto.blob, adjunto.mimeType);
		return;
	}

	try {
		await portalFormulariosAPI.subirBinario(adjunto.uploadUrl, adjunto.blob, adjunto.mimeType);
	} catch (err) {
		/// Una URL firmada caducada devuelve 403. Se borra la URL —que lleva dentro
		/// el checksum firmado— para que el reintento pase por `init` y pida otra.
		if (err instanceof PortalApiError && err.code === 'UPLOAD_URL_EXPIRED') {
			await patchAttachment(clientAttachmentId, {
				uploadUrl: undefined,
				state: 'LOCAL'
			});
		}
		/// S3 rechazó los bytes por no coincidir con el checksum firmado. Reintentar
		/// el mismo blob daría siempre el mismo error, así que se marca `FAILED` y se
		/// deja que el conductor recapture la evidencia.
		if (err instanceof PortalApiError && err.code === 'UPLOAD_CHECKSUM_REJECTED') {
			await patchAttachment(clientAttachmentId, { state: 'FAILED' });
		}
		throw err;
	}
}

/**
 * Retira del servidor un adjunto que el conductor ya quitó del formulario.
 *
 * `attachmentId` va en el payload de la operación y NO se lee de la fila local:
 * la fila ya se borró cuando el conductor quitó la foto. Encolar el id del
 * servidor en el momento del borrado es lo que permite que este paso sobreviva a
 * un cierre de la app.
 */
async function ejecutarDiscard(operacion: OutboxOperation): Promise<void> {
	const attachmentId = String(operacion.payload.attachmentId ?? '');
	if (!attachmentId) return;
	try {
		await portalFormulariosAPI.descartarAdjunto(attachmentId);
	} catch (err) {
		/**
		 * El envío ya se entregó: este descarte llegó tarde y sobra.
		 *
		 * El servidor hace bien en negarse —un envío entregado es inmutable— pero
		 * para la cola NO es un fallo: si el `SUBMIT` pasó, el payload declaró la
		 * evidencia correcta (si hubiera sobrado un adjunto, el envío se habría
		 * rechazado con `ATTACHMENT_NOT_DECLARED`). No queda nada que descartar.
		 *
		 * Sin este caso, un 409 marcaba la operación `BLOCKED` y el borrador como
		 * «Necesita corrección: El envío ya fue entregado», al 100 %, para siempre:
		 * el conductor veía que su preoperacional había fallado cuando en realidad
		 * estaba entregado, y no había nada que pudiera corregir.
		 */
		if (err instanceof PortalApiError && err.code === 'SUBMISSION_IMMUTABLE') return;
		throw err;
	}
}

async function ejecutarComplete(operacion: OutboxOperation): Promise<void> {
	const clientAttachmentId = String(operacion.payload.clientAttachmentId);
	const adjunto = await getAttachment(clientAttachmentId);
	if (!adjunto) return;
	if (adjunto.state === 'UPLOADED') return;
	if (!adjunto.serverId) {
		throw new PortalApiError(
			'ATTACHMENT_MISSING',
			'El adjunto no está registrado en el servidor.',
			409,
			null
		);
	}

	await portalFormulariosAPI.completarAdjunto(adjunto.serverId, {
		sha256: adjunto.sha256,
		byteSize: adjunto.byteSize
	});
	await patchAttachment(clientAttachmentId, { state: 'UPLOADED' });
}

async function ejecutarSubmit(operacion: OutboxOperation): Promise<void> {
	const draft = await getDraft(operacion.aggregateId);
	if (!draft) return;

	const adjuntos = await attachmentsForSubmission(draft.clientSubmissionId);
	const sinSubir = adjuntos.filter((a) => a.state !== 'UPLOADED');
	if (sinSubir.length) {
		/// No debería ocurrir —el `SUBMIT` depende de los `COMPLETE`— pero si la
		/// cola se manipuló, es mejor reintentar que enviar sin evidencia.
		throw new PortalApiError(
			'ATTACHMENT_MISSING',
			`Faltan ${sinSubir.length} adjunto(s) por subir.`,
			408,
			null
		);
	}

	const resultado = await portalFormulariosAPI.enviar({
		clientSubmissionId: draft.clientSubmissionId,
		assignmentId: draft.assignmentId,
		versionId: draft.versionId,
		context: draft.context,
		startedAt: draft.createdAt,
		completedAt: new Date().toISOString(),
		answers: draft.answers,
		attachments: adjuntos.map((a) => ({
			clientAttachmentId: a.clientAttachmentId,
			fieldId: a.fieldId,
			occurrenceId: a.occurrenceId,
			kind: a.kind,
			mimeType: a.mimeType,
			byteSize: a.byteSize,
			sha256: a.sha256,
			originalName: a.originalName
		})),
		device: {
			installationId: owner,
			offlineCreated: Boolean(operacion.payload.offlineCreated),
			platform: navigator.userAgent.slice(0, 60)
		}
	});

	const assignment = await getAssignment(draft.assignmentId);

	await putReceipt({
		clientSubmissionId: draft.clientSubmissionId,
		submissionId: resultado.submissionId,
		assignmentId: draft.assignmentId,
		code: assignment?.code ?? '',
		title: assignment?.title ?? '',
		businessDate: resultado.businessDate,
		periodKey: resultado.periodKey,
		submittedAt: resultado.submittedAt,
		idempotentReplay: resultado.idempotentReplay,
		receivedAt: new Date().toISOString()
	});

	const evento = {
		clientSubmissionId: draft.clientSubmissionId,
		submissionId: resultado.submissionId
	};
	receiptEvents.set(evento);
	channel?.postMessage({ type: 'receipt', payload: evento });

	await limpiarSiCompleto(draft.clientSubmissionId);
}

/**
 * Borra el borrador y sus blobs SOLO si ya hay recibo y no queda ninguna
 * operación de ese envío.
 *
 * El orden importa: borrar el blob con un `UPLOAD` todavía en cola dejaría al
 * envío sin su evidencia y sin forma de recuperarla.
 *
 * El recibo se comprueba de verdad porque ahora esto se llama tras CUALQUIER
 * operación, no solo tras el `SUBMIT`: sin esa comprobación, terminar un
 * `BACKUP_DRAFT` de un borrador que aún no se ha enviado borraría el trabajo del
 * conductor.
 */
async function limpiarSiCompleto(clientSubmissionId: string): Promise<void> {
	const recibo = await getReceipt(clientSubmissionId);
	if (!recibo) return;
	const pendientes = (await allOperations()).filter(
		(o) => o.aggregateId === clientSubmissionId && o.type !== 'SUBMIT'
	);
	if (pendientes.length > 0) return;
	await deleteDraftCascade(clientSubmissionId);
}

/**
 * Devuelve a la cola los envíos atascados por el orden viejo de la cadena.
 *
 * Hasta esta versión, la cadena del envío empezaba por el `INIT` del primer
 * adjunto y el `SUBMIT` —el único paso que crea el envío en el servidor cuando
 * no hubo backup— iba al final. Un formulario diligenciado sin señal se atascaba
 * en el primer `INIT` con `SUBMISSION_NOT_FOUND`, un 404 que la cola marca
 * `BLOCKED` para siempre.
 *
 * Esos teléfonos ya tienen la cadena vieja escrita en IndexedDB y nada la
 * reescribe. Se desbloquean una vez: `iniciarAdjuntoAsegurando` crea el borrador
 * que falta y la cadena termina sola. Si vuelve a fallar, será con el error de
 * verdad —una asignación que ya no le corresponde, una versión nueva— y ese sí
 * describe algo que alguien puede arreglar.
 *
 * Una sola vez por instalación: si tras el rescate el envío se vuelve a bloquear,
 * repetirlo en cada arranque escondería el error nuevo detrás del viejo.
 */
const CLAVE_RESCATE = 'rescate-borrador-ausente-v1';

async function rescatarBloqueadosSinBorrador(): Promise<void> {
	if (await getMeta<boolean>(CLAVE_RESCATE)) return;

	for (const operacion of await allOperations()) {
		if (operacion.state !== 'BLOCKED') continue;
		if (operacion.lastError?.code !== 'SUBMISSION_NOT_FOUND') continue;
		await patchOperation(operacion.operationId, {
			state: 'PENDING',
			attempts: 0,
			nextAttemptAt: new Date().toISOString(),
			lastError: undefined
		});
		await markDraftBlocked(operacion.aggregateId, null);
	}

	await setMeta(CLAVE_RESCATE, true);
}

/**
 * Retira lo que quedó en la cola de envíos YA entregados.
 *
 * Recupera a los dispositivos que se quedaron atascados antes de que
 * `ejecutarDiscard` tratara el 409 como no-op: una operación en `BLOCKED` no se
 * reintenta nunca, así que sin esto el borrador seguiría marcado «Necesita
 * corrección» indefinidamente aunque el envío conste entregado.
 *
 * Solo se purgan `BACKUP_DRAFT` y `DISCARD_ATTACHMENT`, las únicas que pierden
 * el sentido tras la entrega. Un `INIT`/`UPLOAD`/`COMPLETE` no debería existir
 * aquí —el `SUBMIT` exige que la evidencia esté subida— y si existiera, borrarlo
 * dejaría un envío sin su evidencia: se deja en paz.
 */
async function purgarObsoletasTrasRecibo(): Promise<void> {
	const recibos = await allReceipts();
	if (recibos.length === 0) return;
	const entregados = new Set(recibos.map((r) => r.clientSubmissionId));

	for (const operacion of await allOperations()) {
		if (!entregados.has(operacion.aggregateId)) continue;
		if (operacion.type !== 'BACKUP_DRAFT' && operacion.type !== 'DISCARD_ATTACHMENT') continue;
		await deleteOperation(operacion.operationId);
	}

	for (const clientSubmissionId of entregados) await limpiarSiCompleto(clientSubmissionId);
}

// ─── Encolado ────────────────────────────────────────────────────────────────

function nuevaOperacion(
	type: OutboxOperation['type'],
	aggregateId: string,
	payload: Record<string, unknown>,
	dependsOn: string[] = []
): OutboxOperation {
	return {
		operationId: crypto.randomUUID(),
		type,
		aggregateId,
		dependsOn,
		payload,
		state: 'PENDING',
		attempts: 0,
		nextAttemptAt: new Date().toISOString(),
		createdAt: new Date().toISOString()
	};
}

/** Encola el backup del borrador. Sin adjuntos: solo texto y opciones. */
export async function encolarBackup(clientSubmissionId: string): Promise<void> {
	const existentes = await allOperations();
	/// Un solo backup por envío en la cola: encolar uno por cada autosave llenaría
	/// la cola de operaciones que se pisan entre sí. La operación lee el borrador
	/// vigente al ejecutarse, así que reutilizar la pendiente es correcto.
	const yaHay = existentes.some(
		(o) =>
			o.type === 'BACKUP_DRAFT' && o.aggregateId === clientSubmissionId && o.state !== 'BLOCKED'
	);
	if (yaHay) {
		/// Se refresca igualmente: salir sin actualizar dejaba el chip diciendo «Todo
		/// sincronizado» con una operación en cola.
		await refrescarEstado();
		return;
	}

	await enqueueMany([nuevaOperacion('BACKUP_DRAFT', clientSubmissionId, {})]);
	await refrescarEstado();
	/// Se despierta al motor. Sin esto, la operación depende de que exista un
	/// temporizador vivo, y encolar algo es justamente el momento en que puede no
	/// haberlo.
	void tick();
}

/**
 * Encola el descarte en el servidor de un adjunto que el conductor quitó.
 *
 * Se llama con el `serverId`, no con el `clientAttachmentId`: la fila local
 * desaparece en el mismo gesto, así que el id del servidor tiene que viajar en el
 * payload de la operación o se perdería.
 *
 * Si el adjunto nunca llegó a `attachments/init` no hay nada que descartar y
 * quien llama no debe encolar nada.
 */
export async function encolarDescarte(
	clientSubmissionId: string,
	clientAttachmentId: string,
	/** `serverId` del adjunto, o `null` si nunca llegó a `attachments/init`. */
	attachmentId: string | null
): Promise<void> {
	const existentes = await allOperations();

	/**
	 * Primero se retiran las operaciones de subida que quedaran en cola.
	 *
	 * Un `UPLOAD` o un `COMPLETE` ejecutándose después del descarte no tendría
	 * blob que subir (la fila local ya no existe) y, si el descarte ya se aplicó,
	 * volvería a crear la evidencia en el servidor. Esto se hace SIEMPRE, incluso
	 * cuando no hay nada que descartar remotamente.
	 */
	for (const previa of existentes) {
		if (previa.aggregateId !== clientSubmissionId) continue;
		if (
			previa.type !== 'INIT_ATTACHMENT' &&
			previa.type !== 'UPLOAD_ATTACHMENT' &&
			previa.type !== 'COMPLETE_ATTACHMENT'
		) {
			continue;
		}
		/// Solo las de ESTE adjunto: las de los demás siguen siendo necesarias.
		if (previa.payload.clientAttachmentId === clientAttachmentId) {
			await deleteOperation(previa.operationId);
		}
	}

	/// Sin `serverId` el servidor no tiene fila que retirar: basta con haber
	/// limpiado la cola.
	if (!attachmentId) {
		await refrescarEstado();
		return;
	}

	/// Sin duplicados: el `DELETE` del servidor es idempotente, pero encolar dos
	/// gasta dos peticiones por datos móviles para nada.
	const yaHay = existentes.some(
		(o) => o.type === 'DISCARD_ATTACHMENT' && o.payload.attachmentId === attachmentId
	);
	if (yaHay) {
		await refrescarEstado();
		return;
	}

	await enqueueMany([nuevaOperacion('DISCARD_ATTACHMENT', clientSubmissionId, { attachmentId })]);
	await refrescarEstado();
	/// Se intenta ya: el descarte es una petición diminuta y dejarlo para el
	/// siguiente ciclo alargaría sin motivo la ventana en la que el servidor tiene
	/// evidencia que el conductor ya quitó.
	void tick();
}

/**
 * Construye la cadena de operaciones de un envío.
 *
 * Pura y exportada porque el ORDEN de esta cadena es lo que decide si un envío
 * llega entero, y es justo lo que no se puede comprobar a ojo mirando el
 * IndexedDB de un teléfono.
 *
 * La cabeza es un `BACKUP_DRAFT` del que dependen todos los `INIT_ATTACHMENT`.
 * No es cosmético: la fila del envío en el servidor solo la crean el backup o el
 * `SUBMIT`, y el `SUBMIT` va al FINAL. Sin esa cabeza, un formulario
 * diligenciado sin señal —o enviado antes de que el autoguardado al servidor
 * llegara a correr— empieza por un `INIT` contra un envío que el servidor no
 * conoce y recibe `SUBMISSION_NOT_FOUND`: «Guarda el borrador antes de subir
 * evidencia». Un 404 que la cola NO reintenta, que deja el borrador en
 * «Necesita corrección» y que el conductor no puede corregir desde ninguna
 * pantalla, porque lo que falta no es un dato suyo sino un paso de la cola.
 */
export function construirCadenaEnvio(entrada: {
	clientSubmissionId: string;
	adjuntos: StoredAttachment[];
	descartesPendientes: string[];
	offlineCreated: boolean;
}): OutboxOperation[] {
	const { clientSubmissionId, adjuntos, descartesPendientes, offlineCreated } = entrada;
	const operaciones: OutboxOperation[] = [];
	const completes: string[] = [];

	const porSubir = adjuntos.filter((a) => a.state !== 'UPLOADED');

	/// Sin evidencia que subir no hace falta cabeza: el `SUBMIT` crea la fila si
	/// no existe, y un backup de más es un viaje de red contra los datos móviles
	/// del conductor para escribir lo que el `SUBMIT` va a escribir igual.
	const cabeza = porSubir.length ? nuevaOperacion('BACKUP_DRAFT', clientSubmissionId, {}) : null;
	if (cabeza) operaciones.push(cabeza);

	for (const adjunto of porSubir) {
		const init = nuevaOperacion(
			'INIT_ATTACHMENT',
			clientSubmissionId,
			{ clientAttachmentId: adjunto.clientAttachmentId },
			cabeza ? [cabeza.operationId] : []
		);
		const upload = nuevaOperacion(
			'UPLOAD_ATTACHMENT',
			clientSubmissionId,
			{ clientAttachmentId: adjunto.clientAttachmentId },
			[init.operationId]
		);
		const complete = nuevaOperacion(
			'COMPLETE_ATTACHMENT',
			clientSubmissionId,
			{ clientAttachmentId: adjunto.clientAttachmentId },
			[upload.operationId]
		);
		operaciones.push(init, upload, complete);
		completes.push(complete.operationId);
	}

	/**
	 * Los descartes pendientes también son prerrequisito del envío.
	 *
	 * El servidor rechaza un envío que no declare toda la evidencia que tiene el
	 * borrador: si el `SUBMIT` se adelantara a un `DISCARD_ATTACHMENT` en cola,
	 * llegaría con una foto que el conductor ya quitó y respondería
	 * `ATTACHMENT_NOT_DECLARED`.
	 */
	operaciones.push(
		nuevaOperacion('SUBMIT', clientSubmissionId, { offlineCreated }, [
			...completes,
			...descartesPendientes
		])
	);

	return operaciones;
}

/**
 * Encola el envío final con toda su cadena de adjuntos.
 *
 * Se construye la cadena completa de una vez porque así el orden queda escrito
 * en IndexedDB. Si se encolara sobre la marcha, un cierre de la app entre dos
 * pasos dejaría la cadena incompleta.
 */
export async function encolarEnvio(
	draft: StoredDraft,
	adjuntos: StoredAttachment[],
	opciones: { offlineCreated?: boolean } = {}
): Promise<void> {
	const enCola = await allOperations();

	const operaciones = construirCadenaEnvio({
		clientSubmissionId: draft.clientSubmissionId,
		adjuntos,
		descartesPendientes: enCola
			.filter(
				(o) =>
					o.type === 'DISCARD_ATTACHMENT' &&
					o.aggregateId === draft.clientSubmissionId &&
					o.state !== 'BLOCKED'
			)
			.map((o) => o.operationId),
		offlineCreated: Boolean(opciones.offlineCreated)
	});

	/// Los backups que ya estaban en cola se retiran: la cadena nueva trae el
	/// suyo —o no lo necesita— y dos backups del mismo borrador escriben dos
	/// veces lo mismo. Se van también los `BLOCKED`: el de la cadena nueva sale
	/// `PENDING`, que es lo que permite reintentar un envío que se atascó.
	for (const previa of enCola) {
		if (previa.aggregateId === draft.clientSubmissionId && previa.type === 'BACKUP_DRAFT') {
			await deleteOperation(previa.operationId);
		}
	}

	await enqueueMany(operaciones);
	await markDraftBlocked(draft.clientSubmissionId, null);
	await refrescarEstado();
	wakeAll();
}

/**
 * Reintenta un envío bloqueado tras corregirlo.
 *
 * Devuelve las operaciones `BLOCKED` a `PENDING` y reinicia sus intentos: el
 * backoff acumulado corresponde a un payload que ya no es el que se va a enviar.
 */
export async function reintentarBloqueado(clientSubmissionId: string): Promise<void> {
	const operaciones = await allOperations();
	for (const operacion of operaciones) {
		if (operacion.aggregateId !== clientSubmissionId) continue;
		if (operacion.state !== 'BLOCKED') continue;
		await patchOperation(operacion.operationId, {
			state: 'PENDING',
			attempts: 0,
			nextAttemptAt: new Date().toISOString(),
			lastError: undefined
		});
	}
	await markDraftBlocked(clientSubmissionId, null);
	await refrescarEstado();
	wakeAll();
}

/** Descarta la cola de un envío. Solo desde una acción explícita del usuario. */
export async function descartarEnvio(clientSubmissionId: string): Promise<void> {
	const operaciones = await allOperations();
	for (const operacion of operaciones) {
		if (operacion.aggregateId === clientSubmissionId) await deleteOperation(operacion.operationId);
	}
	await deleteDraftCascade(clientSubmissionId);
	await refrescarEstado();
}

/**
 * Lo que la suite necesita alcanzar sin arrancar el motor.
 *
 * `iniciarAdjuntoAsegurando` está aquí y no exportado a secas porque no es API
 * del módulo —nadie fuera debe pedir una URL de subida por su cuenta— pero sí es
 * la red de seguridad de los teléfonos con una cadena vieja en cola, y esa hay
 * que poder probarla.
 */
export const syncInternals = {
	siguienteEspera,
	BACKOFF_MS,
	CHANNEL,
	iniciarAdjuntoAsegurando
};
