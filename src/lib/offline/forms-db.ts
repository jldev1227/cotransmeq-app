/**
 * Almacenamiento local de formularios dinámicos (IndexedDB).
 *
 * **No se usa `localStorage`.** Es sincrónico —bloquea el hilo de UI mientras el
 * conductor escribe—, tiene un tope de unos 5 MB y solo guarda strings, así que
 * una foto habría que meterla en base64 y ocuparía un 33 % más. IndexedDB guarda
 * `Blob` tal cual y es asíncrono.
 *
 * Esta es la ÚNICA capa que habla con IndexedDB. El resto de la UI llama a estas
 * funciones: si cada pantalla abriera su propia conexión, una migración de
 * esquema tendría que coordinarse entre todas.
 *
 * La versión del esquema LOCAL (`DB_VERSION`) no tiene nada que ver con las
 * versiones de los formularios. Se sube al cambiar los stores, no al publicar un
 * formulario nuevo.
 */

import { browser } from '$app/environment';
import type { FormVersionDto } from '$lib/formularios/types';
import type { DraftAnswer } from '$lib/formularios/validate-answers';

const DB_NAME = 'transmeralda_forms_v1';
const DB_VERSION = 1;

export const STORES = {
	definitions: 'definitions',
	assignments: 'assignments',
	drafts: 'drafts',
	attachments: 'attachments',
	outbox: 'outbox',
	receipts: 'receipts',
	meta: 'meta'
} as const;

// ─── Formas guardadas ────────────────────────────────────────────────────────

export interface StoredDefinition {
	versionId: string;
	assignmentId: string;
	definition: FormVersionDto;
	/** ETag devuelto por el servidor, para revalidar con `If-None-Match`. */
	etag: string | null;
	fetchedAt: string;
}

export interface StoredAssignment {
	assignmentId: string;
	formId: string;
	versionId: string;
	code: string;
	title: string;
	name: string;
	frequency: string;
	limitPolicy: string;
	dueState: string;
	submittedThisPeriod: number;
	periodKey: string | null;
	businessDate: string;
	allowOffline: boolean;
	requiresContext: string[];
	revision: number;
	cachedAt: string;
}

export interface StoredDraft {
	clientSubmissionId: string;
	assignmentId: string;
	versionId: string;
	context: Record<string, unknown>;
	answers: DraftAnswer[];
	progress: number;
	/** Monotónico: nunca retrocede aunque el reloj del dispositivo cambie. */
	updatedAt: string;
	createdAt: string;
	/** Marcado por la outbox cuando el servidor rechaza el envío por validación. */
	blocked?: { code: string; message: string; details?: unknown };
}

export type LocalAttachmentState = 'LOCAL' | 'INITIALIZED' | 'UPLOADED' | 'FAILED';

export interface StoredAttachment {
	clientAttachmentId: string;
	clientSubmissionId: string;
	fieldId: string;
	occurrenceId: string | null;
	kind: 'PHOTO' | 'FILE' | 'SIGNATURE';
	mimeType: string;
	byteSize: number;
	sha256: string;
	originalName: string | null;
	/** El binario. Solo vive aquí hasta que el servidor confirma la subida. */
	blob: Blob;
	state: LocalAttachmentState;
	/** Id que asignó el servidor en `attachments/init`. */
	serverId?: string;
	/**
	 * URL firmada de S3 para el `PUT`.
	 *
	 * Lleva el checksum izado dentro (`&x-amz-checksum-sha256=…`) y firmado, así
	 * que no hay nada que guardar aparte ni que reenviar como cabecera: la URL es
	 * la instrucción completa. Se invalida entera al caducar.
	 */
	uploadUrl?: string;
	createdAt: string;
}

export type OutboxType =
	| 'BACKUP_DRAFT'
	| 'INIT_ATTACHMENT'
	| 'UPLOAD_ATTACHMENT'
	| 'COMPLETE_ATTACHMENT'
	/**
	 * Retira del servidor un adjunto que el conductor quitó del formulario.
	 *
	 * Existe porque el servidor rechaza los envíos con evidencia que el payload no
	 * declara (`ATTACHMENT_NOT_DECLARED`): sin esta operación, quitar una foto ya
	 * inicializada dejaría el envío bloqueado para siempre.
	 */
	| 'DISCARD_ATTACHMENT'
	| 'SUBMIT';

export type OutboxState = 'PENDING' | 'RUNNING' | 'RETRY' | 'BLOCKED';

export interface OutboxOperation {
	operationId: string;
	type: OutboxType;
	/** `clientSubmissionId` del envío al que pertenece la operación. */
	aggregateId: string;
	/** `operationId`s que deben completarse antes que esta. */
	dependsOn: string[];
	payload: Record<string, unknown>;
	state: OutboxState;
	attempts: number;
	nextAttemptAt: string;
	createdAt: string;
	lastError?: { code: string; message: string; retryable: boolean };
	/** Lease de la pestaña que la está ejecutando. ISO; caduca. */
	leaseUntil?: string;
	leaseOwner?: string;
}

export interface StoredReceipt {
	clientSubmissionId: string;
	submissionId: string;
	assignmentId: string;
	code: string;
	title: string;
	businessDate: string;
	periodKey: string | null;
	submittedAt: string;
	idempotentReplay: boolean;
	receivedAt: string;
}

export interface MetaRecord {
	key: string;
	value: unknown;
}

// ─── Conexión ────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Abre (y migra si hace falta) la base local.
 *
 * La promesa se cachea: abrir IndexedDB en cada operación serializaría todo tras
 * el handshake de apertura, que en un móvil de gama baja son decenas de ms.
 */
export function openFormsDb(): Promise<IDBDatabase> {
	if (!browser) return Promise.reject(new Error('IndexedDB solo existe en el navegador.'));
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;

			if (!db.objectStoreNames.contains(STORES.definitions)) {
				db.createObjectStore(STORES.definitions, { keyPath: 'versionId' });
			}
			if (!db.objectStoreNames.contains(STORES.assignments)) {
				db.createObjectStore(STORES.assignments, { keyPath: 'assignmentId' });
			}
			if (!db.objectStoreNames.contains(STORES.drafts)) {
				const drafts = db.createObjectStore(STORES.drafts, { keyPath: 'clientSubmissionId' });
				/// Índice por asignación: la lista del portal necesita «¿tengo un
				/// borrador de este formulario?» sin recorrer todos los borradores.
				drafts.createIndex('assignmentId', 'assignmentId', { unique: false });
			}
			if (!db.objectStoreNames.contains(STORES.attachments)) {
				const attachments = db.createObjectStore(STORES.attachments, {
					keyPath: 'clientAttachmentId'
				});
				attachments.createIndex('clientSubmissionId', 'clientSubmissionId', { unique: false });
				attachments.createIndex('state', 'state', { unique: false });
			}
			if (!db.objectStoreNames.contains(STORES.outbox)) {
				const outbox = db.createObjectStore(STORES.outbox, { keyPath: 'operationId' });
				outbox.createIndex('state', 'state', { unique: false });
				outbox.createIndex('aggregateId', 'aggregateId', { unique: false });
				outbox.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
			}
			if (!db.objectStoreNames.contains(STORES.receipts)) {
				db.createObjectStore(STORES.receipts, { keyPath: 'clientSubmissionId' });
			}
			if (!db.objectStoreNames.contains(STORES.meta)) {
				db.createObjectStore(STORES.meta, { keyPath: 'key' });
			}
		};

		request.onsuccess = () => {
			const db = request.result;
			/// Si otra pestaña sube la versión del esquema, esta conexión bloquea la
			/// migración. Se cierra y se descarta la promesa para que la próxima
			/// operación reabra con el esquema nuevo.
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};

		request.onerror = () => {
			dbPromise = null;
			reject(request.error ?? new Error('No se pudo abrir la base local.'));
		};

		/// `onblocked` ocurre cuando otra pestaña tiene una conexión vieja abierta.
		/// No se rechaza: la otra pestaña la cerrará en su `onversionchange`.
		request.onblocked = () => {
			console.warn('[forms-db] apertura bloqueada por otra pestaña; esperando…');
		};
	});

	return dbPromise;
}

type Modo = 'readonly' | 'readwrite';

/**
 * Ejecuta una operación en una transacción.
 *
 * Envuelve la API de eventos de IndexedDB en promesas y —esto es lo importante—
 * resuelve en `transaction.oncomplete`, no en `request.onsuccess`. Con lo segundo
 * se puede leer un valor que un `abort` posterior deshace.
 */
async function tx<T>(
	stores: string | string[],
	modo: Modo,
	fn: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
	const db = await openFormsDb();
	return new Promise<T>((resolve, reject) => {
		const transaction = db.transaction(stores, modo);
		let resultado: T;
		let fallo: unknown = null;

		transaction.oncomplete = () => (fallo ? reject(fallo) : resolve(resultado));
		transaction.onerror = () => reject(fallo ?? transaction.error);
		/**
		 * `fallo` va PRIMERO, y no es un detalle.
		 *
		 * Cuando el callback lanza, este envoltorio llama a `transaction.abort()`, y
		 * eso dispara `onabort`. Una transacción abortada nunca llega a
		 * `oncomplete`, así que si aquí se rechazaba con un error genérico, el error
		 * de verdad —el `DataCloneError` que explica QUÉ no se pudo guardar— se
		 * perdía y quien depuraba solo veía «Transacción abortada.».
		 */
		transaction.onabort = () =>
			reject(fallo ?? transaction.error ?? new Error('Transacción abortada.'));

		Promise.resolve(fn(transaction))
			.then((r) => {
				resultado = r;
			})
			.catch((err) => {
				fallo = err;
				try {
					transaction.abort();
				} catch {
					/// Ya abortada o completada.
				}
			});
	});
}

function req<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

// ─── Definiciones ────────────────────────────────────────────────────────────

export async function putDefinition(record: StoredDefinition): Promise<void> {
	await tx(STORES.definitions, 'readwrite', (t) =>
		req(t.objectStore(STORES.definitions).put(record))
	);
}

export async function getDefinition(versionId: string): Promise<StoredDefinition | undefined> {
	return tx(STORES.definitions, 'readonly', (t) =>
		req(t.objectStore(STORES.definitions).get(versionId))
	);
}

export async function allDefinitions(): Promise<StoredDefinition[]> {
	return tx(STORES.definitions, 'readonly', (t) =>
		req(t.objectStore(STORES.definitions).getAll())
	);
}

/**
 * Borra definiciones que ya no corresponden a ninguna asignación accesible.
 *
 * Se llama tras reconciliar la lista. NO se borra una definición que todavía
 * tiene un borrador abierto: el conductor quedaría con respuestas que no se
 * pueden renderizar.
 */
export async function pruneDefinitions(versionIdsVigentes: string[]): Promise<number> {
	const vigentes = new Set(versionIdsVigentes);
	const borradores = await allDrafts();
	for (const draft of borradores) vigentes.add(draft.versionId);

	return tx(STORES.definitions, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.definitions);
		const todas: StoredDefinition[] = await req(store.getAll());
		let borradas = 0;
		for (const definicion of todas) {
			if (vigentes.has(definicion.versionId)) continue;
			await req(store.delete(definicion.versionId));
			borradas += 1;
		}
		return borradas;
	});
}

// ─── Asignaciones ────────────────────────────────────────────────────────────

export async function putAssignments(records: StoredAssignment[]): Promise<void> {
	await tx(STORES.assignments, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.assignments);
		/// Reemplazo completo: la lista del servidor es la autoridad sobre qué le
		/// corresponde al conductor, y conservar una asignación retirada le
		/// mostraría una tarjeta que el POST rechazaría.
		await req(store.clear());
		for (const record of records) await req(store.put(record));
	});
}

export async function allAssignments(): Promise<StoredAssignment[]> {
	return tx(STORES.assignments, 'readonly', (t) =>
		req(t.objectStore(STORES.assignments).getAll())
	);
}

export async function getAssignment(assignmentId: string): Promise<StoredAssignment | undefined> {
	return tx(STORES.assignments, 'readonly', (t) =>
		req(t.objectStore(STORES.assignments).get(assignmentId))
	);
}

// ─── Borradores ──────────────────────────────────────────────────────────────

/**
 * Guarda el borrador.
 *
 * `updatedAt` es MONOTÓNICO: se toma el máximo entre "ahora" y el valor previo
 * más un milisegundo. Sin esto, un dispositivo cuyo reloj se atrasa (o cambia de
 * zona) escribiría un `updatedAt` anterior al guardado previo, y la
 * reconciliación con el backup del servidor elegiría la versión vieja.
 */
export async function putDraft(draft: Omit<StoredDraft, 'updatedAt'> & { updatedAt?: string }): Promise<StoredDraft> {
	return tx(STORES.drafts, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.drafts);
		const previo: StoredDraft | undefined = await req(store.get(draft.clientSubmissionId));

		const ahora = Date.now();
		const anterior = previo ? new Date(previo.updatedAt).getTime() : 0;
		const updatedAt = new Date(Math.max(ahora, anterior + 1)).toISOString();

		const record: StoredDraft = {
			...draft,
			createdAt: previo?.createdAt ?? draft.createdAt ?? new Date(ahora).toISOString(),
			updatedAt
		};
		await req(store.put(record));
		return record;
	});
}

export async function getDraft(clientSubmissionId: string): Promise<StoredDraft | undefined> {
	return tx(STORES.drafts, 'readonly', (t) =>
		req(t.objectStore(STORES.drafts).get(clientSubmissionId))
	);
}

export async function allDrafts(): Promise<StoredDraft[]> {
	return tx(STORES.drafts, 'readonly', (t) => req(t.objectStore(STORES.drafts).getAll()));
}

export async function draftsForAssignment(assignmentId: string): Promise<StoredDraft[]> {
	return tx(STORES.drafts, 'readonly', (t) =>
		req(t.objectStore(STORES.drafts).index('assignmentId').getAll(assignmentId))
	);
}

/**
 * Borra un borrador y sus adjuntos.
 *
 * Solo se llama cuando existe recibo Y no quedan operaciones pendientes de ese
 * envío. Borrar antes dejaría a la outbox intentando subir un blob que ya no
 * existe, y el envío se quedaría sin su evidencia para siempre.
 */
export async function deleteDraftCascade(clientSubmissionId: string): Promise<void> {
	await tx([STORES.drafts, STORES.attachments], 'readwrite', async (t) => {
		await req(t.objectStore(STORES.drafts).delete(clientSubmissionId));
		const index = t.objectStore(STORES.attachments).index('clientSubmissionId');
		const adjuntos: StoredAttachment[] = await req(index.getAll(clientSubmissionId));
		for (const adjunto of adjuntos) {
			await req(t.objectStore(STORES.attachments).delete(adjunto.clientAttachmentId));
		}
	});
}

export async function markDraftBlocked(
	clientSubmissionId: string,
	blocked: StoredDraft['blocked'] | null
): Promise<void> {
	await tx(STORES.drafts, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.drafts);
		const draft: StoredDraft | undefined = await req(store.get(clientSubmissionId));
		if (!draft) return;
		if (blocked) draft.blocked = blocked;
		else delete draft.blocked;
		await req(store.put(draft));
	});
}

// ─── Adjuntos ────────────────────────────────────────────────────────────────

export async function putAttachment(record: StoredAttachment): Promise<void> {
	await tx(STORES.attachments, 'readwrite', (t) =>
		req(t.objectStore(STORES.attachments).put(record))
	);
}

export async function getAttachment(
	clientAttachmentId: string
): Promise<StoredAttachment | undefined> {
	return tx(STORES.attachments, 'readonly', (t) =>
		req(t.objectStore(STORES.attachments).get(clientAttachmentId))
	);
}

export async function attachmentsForSubmission(
	clientSubmissionId: string
): Promise<StoredAttachment[]> {
	return tx(STORES.attachments, 'readonly', (t) =>
		req(t.objectStore(STORES.attachments).index('clientSubmissionId').getAll(clientSubmissionId))
	);
}

export async function patchAttachment(
	clientAttachmentId: string,
	patch: Partial<StoredAttachment>
): Promise<void> {
	await tx(STORES.attachments, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.attachments);
		const record: StoredAttachment | undefined = await req(store.get(clientAttachmentId));
		if (!record) return;
		await req(store.put({ ...record, ...patch }));
	});
}

export async function deleteAttachment(clientAttachmentId: string): Promise<void> {
	await tx(STORES.attachments, 'readwrite', (t) =>
		req(t.objectStore(STORES.attachments).delete(clientAttachmentId))
	);
}

/** Bytes ocupados por los adjuntos de un borrador, para el tope por envío. */
export async function draftAttachmentBytes(clientSubmissionId: string): Promise<number> {
	const adjuntos = await attachmentsForSubmission(clientSubmissionId);
	return adjuntos.reduce((sum, a) => sum + a.byteSize, 0);
}

// ─── Outbox ──────────────────────────────────────────────────────────────────

export async function enqueue(operation: OutboxOperation): Promise<void> {
	await tx(STORES.outbox, 'readwrite', (t) => req(t.objectStore(STORES.outbox).put(operation)));
}

export async function enqueueMany(operations: OutboxOperation[]): Promise<void> {
	await tx(STORES.outbox, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.outbox);
		for (const operation of operations) await req(store.put(operation));
	});
}

export async function allOperations(): Promise<OutboxOperation[]> {
	return tx(STORES.outbox, 'readonly', (t) => req(t.objectStore(STORES.outbox).getAll()));
}

export async function operationsFor(aggregateId: string): Promise<OutboxOperation[]> {
	return tx(STORES.outbox, 'readonly', (t) =>
		req(t.objectStore(STORES.outbox).index('aggregateId').getAll(aggregateId))
	);
}

export async function patchOperation(
	operationId: string,
	patch: Partial<OutboxOperation>
): Promise<void> {
	await tx(STORES.outbox, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.outbox);
		const record: OutboxOperation | undefined = await req(store.get(operationId));
		if (!record) return;
		await req(store.put({ ...record, ...patch }));
	});
}

export async function deleteOperation(operationId: string): Promise<void> {
	await tx(STORES.outbox, 'readwrite', (t) =>
		req(t.objectStore(STORES.outbox).delete(operationId))
	);
}

/**
 * Reclama UNA operación elegible con un lease, en una sola transacción.
 *
 * El lease es lo que evita que dos pestañas ejecuten la misma operación. Va
 * dentro de la transacción de IndexedDB porque `BroadcastChannel` no garantiza
 * exclusión: dos pestañas pueden anunciarse a la vez y las dos creer que ganaron.
 *
 * Elegible = `PENDING`/`RETRY`, con `nextAttemptAt` vencido, sin lease vivo y con
 * todas sus dependencias ya resueltas (no presentes en la cola).
 */
export async function claimNextOperation(
	owner: string,
	leaseMs = 60_000
): Promise<OutboxOperation | null> {
	return tx(STORES.outbox, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.outbox);
		const todas: OutboxOperation[] = await req(store.getAll());
		const ahora = Date.now();
		const pendientes = new Set(todas.map((o) => o.operationId));

		const elegibles = todas
			.filter((o) => o.state === 'PENDING' || o.state === 'RETRY')
			.filter((o) => new Date(o.nextAttemptAt).getTime() <= ahora)
			.filter((o) => !o.leaseUntil || new Date(o.leaseUntil).getTime() <= ahora)
			/// Las dependencias se resuelven por AUSENCIA: una operación completada
			/// se borra de la cola, así que si su id ya no está, terminó.
			.filter((o) => o.dependsOn.every((dep) => !pendientes.has(dep)))
			/// FIFO por creación: los adjuntos se encolan antes que el SUBMIT del
			/// mismo envío, y respetar el orden reduce los reintentos por dependencia.
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

		const elegida = elegibles[0];
		if (!elegida) return null;

		const reclamada: OutboxOperation = {
			...elegida,
			state: 'RUNNING',
			leaseOwner: owner,
			leaseUntil: new Date(ahora + leaseMs).toISOString()
		};
		await req(store.put(reclamada));
		return reclamada;
	});
}

/**
 * Devuelve a `PENDING` las operaciones con lease caducado.
 *
 * Ocurre cuando una pestaña se cierra a mitad de una subida: la operación queda
 * `RUNNING` para siempre y el envío no se completa nunca. Se llama al arrancar el
 * sincronizador.
 */
export async function releaseStaleLeases(): Promise<number> {
	return tx(STORES.outbox, 'readwrite', async (t) => {
		const store = t.objectStore(STORES.outbox);
		const todas: OutboxOperation[] = await req(store.getAll());
		const ahora = Date.now();
		let liberadas = 0;
		for (const operacion of todas) {
			if (operacion.state !== 'RUNNING') continue;
			if (operacion.leaseUntil && new Date(operacion.leaseUntil).getTime() > ahora) continue;
			await req(
				store.put({
					...operacion,
					state: 'PENDING' as OutboxState,
					leaseOwner: undefined,
					leaseUntil: undefined
				})
			);
			liberadas += 1;
		}
		return liberadas;
	});
}

// ─── Recibos ─────────────────────────────────────────────────────────────────

export async function putReceipt(receipt: StoredReceipt): Promise<void> {
	await tx(STORES.receipts, 'readwrite', (t) => req(t.objectStore(STORES.receipts).put(receipt)));
}

export async function getReceipt(clientSubmissionId: string): Promise<StoredReceipt | undefined> {
	return tx(STORES.receipts, 'readonly', (t) =>
		req(t.objectStore(STORES.receipts).get(clientSubmissionId))
	);
}

export async function allReceipts(): Promise<StoredReceipt[]> {
	return tx(STORES.receipts, 'readonly', (t) => req(t.objectStore(STORES.receipts).getAll()));
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
	const record: MetaRecord | undefined = await tx(STORES.meta, 'readonly', (t) =>
		req(t.objectStore(STORES.meta).get(key))
	);
	return record?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
	await tx(STORES.meta, 'readwrite', (t) => req(t.objectStore(STORES.meta).put({ key, value })));
}

/**
 * Id de instalación de este navegador.
 *
 * Identifica el dispositivo en `device_json` y sirve de `leaseOwner`. Se guarda
 * en IndexedDB y no en `localStorage` para que se borre junto con el resto de los
 * datos locales si el usuario limpia el sitio.
 */
export async function installationId(): Promise<string> {
	const existente = await getMeta<string>('installationId');
	if (existente) return existente;
	const nuevo = crypto.randomUUID();
	await setMeta('installationId', nuevo);
	return nuevo;
}

// ─── Cuota ───────────────────────────────────────────────────────────────────

export interface QuotaInfo {
	usage: number;
	quota: number;
	/** Fracción usada, 0–1. `null` si el navegador no lo informa. */
	ratio: number | null;
	persisted: boolean;
}

/**
 * Estado de la cuota de almacenamiento.
 *
 * Se consulta antes de aceptar evidencia nueva. Si falta espacio, el runner
 * conserva el texto y bloquea solo los adjuntos: perder una inspección de dos
 * horas por una foto es inaceptable.
 */
export async function quotaInfo(): Promise<QuotaInfo> {
	if (!browser || !navigator.storage?.estimate) {
		return { usage: 0, quota: 0, ratio: null, persisted: false };
	}
	const { usage = 0, quota = 0 } = await navigator.storage.estimate();
	const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
	return { usage, quota, ratio: quota > 0 ? usage / quota : null, persisted };
}

/**
 * Pide almacenamiento persistente.
 *
 * Sin esto el navegador puede desalojar la base cuando le falte espacio, y con
 * ella los borradores y las fotos. Se pide tras el PRIMER borrador con adjuntos y
 * no al abrir la app: algunos navegadores muestran un permiso, y pedirlo sin que
 * haya nada que perder hace que el conductor lo rechace.
 */
export async function requestPersistence(): Promise<boolean> {
	if (!browser || !navigator.storage?.persist) return false;
	try {
		if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

/** Borra todo lo local. Solo al cerrar sesión de forma explícita. */
export async function clearAll(): Promise<void> {
	await tx(Object.values(STORES) as string[], 'readwrite', async (t) => {
		for (const store of Object.values(STORES)) await req(t.objectStore(store).clear());
	});
}

export const dbInternals = { tx, req, DB_NAME, DB_VERSION };
