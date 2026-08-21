/**
 * Cliente del portal del conductor para formularios dinámicos.
 *
 * **No usa `apiClient`.** Ese cliente adjunta el JWT del dashboard desde
 * `authStore` y redirige a `/login` en un 401; el portal se autentica con el
 * token del magic link (`portalSession`) y un 401 aquí significa «pide otro
 * enlace», no «vete al login del dashboard».
 *
 * Tampoco reintenta nada por su cuenta: los reintentos los decide la outbox, que
 * es la única que sabe qué operaciones son idempotentes y en qué orden van.
 * Reintentar un `POST /submissions` desde aquí duplicaría el trabajo que
 * `client_submission_id` está protegiendo.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { portalSession } from '$lib/stores/portalStore';
import type { FormVersionDto, SubmissionDetailDto, SubmissionSummaryDto } from '$lib/formularios/types';
import type { DraftAnswer } from '$lib/formularios/validate-answers';

const API_BASE = browser
	? ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000')
	: 'http://localhost:4000';

const BASE = `${API_BASE}/api/conductor-portal/formularios`;

/** Error de la API del portal, con el código estable del backend. */
export class PortalApiError extends Error {
	readonly code: string;
	readonly status: number;
	readonly details: unknown;

	constructor(code: string, message: string, status: number, details?: unknown) {
		super(message);
		this.name = 'PortalApiError';
		this.code = code;
		this.status = status;
		this.details = details;
	}

	/**
	 * ¿Merece reintento automático?
	 *
	 * Red, 408, 429 y 5xx sí: son fallos transitorios. Un 4xx de validación NO —
	 * reintentarlo mil veces daría mil veces el mismo error y gastaría los datos
	 * del conductor.
	 */
	get retryable(): boolean {
		if (this.code === 'NETWORK_ERROR') return true;
		if (this.status === 408 || this.status === 429) return true;
		/**
		 * `ATTACHMENT_MISSING` es la excepción entre los 4xx.
		 *
		 * Es un 422, pero no significa «el conductor tiene que corregir algo»: el
		 * servidor dice que aún hay evidencia sin terminar de subir. La cadena
		 * `INIT → UPLOAD → COMPLETE` sigue en la cola y cuando acabe, el mismo
		 * envío pasa sin tocar nada. Bloquear el borrador aquí le pediría al
		 * conductor arreglar algo que se arregla solo.
		 */
		if (this.code === 'ATTACHMENT_MISSING') return true;
		return this.status >= 500;
	}

	/** 401: la sesión caducó. La outbox pausa y conserva todo. */
	get needsAuth(): boolean {
		return this.status === 401;
	}
}

function authHeaders(): Record<string, string> {
	const session = get(portalSession);
	if (!session?.token) throw new PortalApiError('UNAUTHORIZED', 'Sin sesión del portal.', 401, null);
	return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
}

interface FetchOpts {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	/** Corta la petición; la outbox lo usa para no colgarse en una red mala. */
	signal?: AbortSignal;
	/** Tope propio en ms. Por defecto `TIMEOUT_JSON`. */
	timeoutMs?: number;
}

/**
 * Tope por defecto de las peticiones JSON del portal.
 *
 * Sin tope, una conexión que se queda colgada —el servidor se reinicia, un portal
 * cautivo intercepta el tráfico, la red móvil acepta el socket y no responde—
 * deja la promesa pendiente para siempre. Y no bloquea solo esa operación: la
 * outbox se queda con ella en `RUNNING` y con su bandera de «ya estoy corriendo»
 * puesta, así que NINGUNA otra se vuelve a intentar hasta recargar la página. Un
 * fallo de red tiene que ser un fallo, no un cuelgue.
 */
const TIMEOUT_JSON = 30_000;

/**
 * Tope de la subida de un binario. Mucho más generoso: una foto por datos
 * móviles lentos tarda de verdad, y cortarla a los 30 s sería sabotearla.
 */
const TIMEOUT_SUBIDA = 120_000;

/**
 * Combina el `signal` de quien llama con un tope de tiempo.
 *
 * Devuelve también `limpiar()`, que hay que llamar SIEMPRE: un `setTimeout` sin
 * cancelar mantiene vivo el controlador y, en una outbox que hace cientos de
 * peticiones, se acumulan.
 */
function conTope(signal: AbortSignal | undefined, ms: number) {
	const controlador = new AbortController();
	const temporizador = setTimeout(() => controlador.abort(new Error('timeout')), ms);
	const propagar = () => controlador.abort(signal?.reason);
	if (signal) {
		if (signal.aborted) propagar();
		else signal.addEventListener('abort', propagar, { once: true });
	}
	return {
		signal: controlador.signal,
		limpiar: () => {
			clearTimeout(temporizador);
			signal?.removeEventListener('abort', propagar);
		}
	};
}

async function call<T>(path: string, opts: FetchOpts = {}): Promise<{ data: T; meta: any; response: Response }> {
	let response: Response;
	const tope = conTope(opts.signal, opts.timeoutMs ?? TIMEOUT_JSON);
	try {
		response = await fetch(`${BASE}${path}`, {
			method: opts.method ?? 'GET',
			headers: { ...authHeaders(), ...(opts.headers ?? {}) },
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			signal: tope.signal
		});
	} catch (err) {
		/// `fetch` solo rechaza por red o abort. Se marca con código propio para que
		/// la outbox lo distinga de un rechazo del servidor.
		///
		/// Un abort del tope propio NO es una cancelación: es una red que no
		/// responde, y la outbox debe reintentarlo. Se distingue mirando si el
		/// `signal` de quien llamó está realmente abortado.
		if ((err as Error)?.name === 'AbortError' && opts.signal?.aborted) {
			throw new PortalApiError('ABORTED', 'Petición cancelada.', 0, null);
		}
		throw new PortalApiError('NETWORK_ERROR', 'Sin conexión con el servidor.', 0, null);
	} finally {
		tope.limpiar();
	}

	if (response.status === 304) {
		/// `304` no trae cuerpo: lo maneja quien envió `If-None-Match`.
		return { data: undefined as T, meta: { notModified: true }, response };
	}

	let cuerpo: any = null;
	try {
		cuerpo = await response.json();
	} catch {
		cuerpo = null;
	}

	if (!response.ok) {
		throw new PortalApiError(
			cuerpo?.error?.code ?? 'INTERNAL_ERROR',
			cuerpo?.error?.message ?? `Error ${response.status}.`,
			response.status,
			cuerpo?.error?.details ?? null
		);
	}

	return { data: cuerpo?.data as T, meta: cuerpo?.meta ?? {}, response };
}

// ─── Tipos de la API ─────────────────────────────────────────────────────────

export interface PortalAssignmentCard {
	assignmentId: string;
	formId: string;
	versionId: string;
	code: string;
	title: string;
	name: string;
	frequency: string;
	limitPolicy: string;
	dueState: 'AVAILABLE' | 'DONE' | 'NOT_YET' | 'EXPIRED' | 'PAUSED';
	submittedThisPeriod: number;
	periodKey: string | null;
	businessDate: string;
	draft: {
		clientSubmissionId: string;
		updatedAt: string;
		progress: number;
		context: Record<string, unknown>;
	} | null;
	allowOffline: boolean;
	requiresContext: string[];
	revision: number;
}

export interface PortalListMeta {
	today: string;
	pending: number;
	drafts: number;
}

export interface PortalDefinitionResponse {
	assignment: {
		id: string;
		name: string;
		frequency: string;
		limitPolicy: string;
		timezone: string;
		contextSchema: Record<string, { required?: boolean }>;
		settings: Record<string, unknown>;
		businessDate: string;
		periodKey: string | null;
	};
	definition: FormVersionDto;
}

export interface InitAttachmentResponse {
	attachmentId: string;
	uploadUrl: string | null;
	alreadyUploaded: boolean;
	objectKey: string | null;
	/**
	 * SHA-256 en base64 con el que se firmó `uploadUrl`. Informativo.
	 *
	 * El cliente NO tiene que hacer nada con él: ya viaja dentro de la URL
	 * firmada (`&x-amz-checksum-sha256=…`) y S3 lo aplica desde ahí. Reenviarlo
	 * como cabecera rompe la firma —ver `subirBinario`—, así que solo sirve para
	 * diagnosticar.
	 *
	 * `null` cuando el servidor tiene el checksum nativo desactivado; entonces la
	 * URL va sin él y la verificación la hace el backend leyendo el objeto.
	 */
	checksumSha256: string | null;
}

export interface SubmitResponse {
	submissionId: string;
	clientSubmissionId: string;
	businessDate: string;
	periodKey: string | null;
	submittedAt: string;
	idempotentReplay: boolean;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const portalFormulariosAPI = {
	async listar(signal?: AbortSignal) {
		const { data, meta } = await call<PortalAssignmentCard[]>('', { signal });
		return { data: data ?? [], meta: meta as PortalListMeta };
	},

	/**
	 * Vehículos para las asignaciones que exigen `vehicleId`.
	 *
	 * Cuelga de `/conductor-portal/dias-laborados/vehiculos`, fuera de `BASE`:
	 * el listado de vehículos no es un recurso de formularios, pero sí está
	 * detrás del mismo `portalAuthMiddleware`, así que el token del magic link
	 * basta.
	 *
	 * Lo que NO puede hacer es tirar de `vehiculosAPI` de `apiClient`: ese
	 * cliente manda el JWT del dashboard, que en el teléfono del conductor no
	 * existe, y su interceptor convierte el 401 en
	 * `window.location.href = '/login'` — sacando al conductor del formulario a
	 * medio diligenciar. Es exactamente lo que advierte la cabecera de este
	 * módulo.
	 *
	 * Devuelve `[]` ante cualquier fallo: sin desplegable el conductor escribe
	 * la placa a mano, y bloquear el formulario por no poder pintar un `select`
	 * sería absurdo en un patio sin cobertura.
	 */
	async listarVehiculos(signal?: AbortSignal): Promise<Array<{ id: string; placa: string }>> {
		const tope = conTope(signal, TIMEOUT_JSON);
		try {
			const response = await fetch(`${API_BASE}/api/conductor-portal/dias-laborados/vehiculos`, {
				headers: authHeaders(),
				signal: tope.signal
			});
			if (!response.ok) return [];
			const cuerpo = await response.json();
			return Array.isArray(cuerpo?.data) ? cuerpo.data : [];
		} catch {
			return [];
		} finally {
			tope.limpiar();
		}
	},

	/**
	 * Definición de una asignación, con revalidación por ETag.
	 *
	 * Con `etag` conocido se envía `If-None-Match` y el servidor puede responder
	 * `304`: el árbol de un preoperacional pesa cientos de kilobytes y no hay que
	 * reenviarlo por datos móviles cada vez que se abre la lista.
	 */
	async definicion(assignmentId: string, etag?: string | null, signal?: AbortSignal) {
		const { data, meta, response } = await call<PortalDefinitionResponse>(`/${assignmentId}`, {
			headers: etag ? { 'If-None-Match': etag } : {},
			signal
		});
		return {
			notModified: Boolean(meta?.notModified),
			etag: response.headers.get('ETag'),
			data
		};
	},

	async historial(params: { page?: number; limit?: number; assignmentId?: string } = {}) {
		const query = new URLSearchParams();
		if (params.page) query.set('page', String(params.page));
		if (params.limit) query.set('limit', String(params.limit));
		if (params.assignmentId) query.set('assignmentId', params.assignmentId);
		const sufijo = query.toString() ? `?${query}` : '';
		const { data, meta } = await call<SubmissionSummaryDto[]>(`/submissions${sufijo}`);
		return { data: data ?? [], meta };
	},

	async envio(submissionId: string) {
		const { data } = await call<{ submission: SubmissionDetailDto; definition: FormVersionDto }>(
			`/submissions/${submissionId}`
		);
		return data;
	},

	/** Backup del borrador. Sin adjuntos binarios: solo texto y opciones. */
	async guardarBorrador(
		clientSubmissionId: string,
		payload: {
			assignmentId: string;
			versionId: string;
			context?: Record<string, unknown>;
			answers: DraftAnswer[];
			progress?: number;
			device?: Record<string, unknown>;
		},
		signal?: AbortSignal
	) {
		const { data } = await call<{ id: string; status: string; alreadySubmitted: boolean }>(
			`/drafts/${clientSubmissionId}`,
			{ method: 'PUT', body: payload, signal }
		);
		return data;
	},

	async descartarBorrador(clientSubmissionId: string) {
		const { data } = await call<{ id: string | null; deleted: boolean }>(
			`/drafts/${clientSubmissionId}`,
			{ method: 'DELETE' }
		);
		return data;
	},

	async iniciarAdjunto(
		payload: {
			clientSubmissionId: string;
			clientAttachmentId: string;
			fieldId: string;
			occurrenceId?: string | null;
			kind: 'PHOTO' | 'FILE' | 'SIGNATURE';
			mimeType: string;
			byteSize: number;
			sha256: string;
			originalName?: string | null;
		},
		signal?: AbortSignal
	) {
		const { data } = await call<InitAttachmentResponse>('/attachments/init', {
			method: 'POST',
			body: payload,
			signal
		});
		return data;
	},

	async completarAdjunto(
		attachmentId: string,
		payload: { sha256: string; byteSize?: number },
		signal?: AbortSignal
	) {
		const { data } = await call<{
			attachmentId: string;
			submissionId: string;
			clientAttachmentId: string;
			status: string;
			alreadyUploaded: boolean;
		}>(`/attachments/${attachmentId}/complete`, { method: 'POST', body: payload, signal });
		return data;
	},

	/**
	 * Descarta un adjunto del borrador en el servidor.
	 *
	 * Hace falta porque el submit rechaza los adjuntos que el payload no declara:
	 * quitar una foto en el runner tiene que retirar también la fila del servidor,
	 * o el envío quedaría bloqueado con `ATTACHMENT_NOT_DECLARED`.
	 */
	async descartarAdjunto(attachmentId: string, signal?: AbortSignal) {
		const { data } = await call<{ attachmentId: string; discarded: boolean; alreadyGone: boolean }>(
			`/attachments/${attachmentId}`,
			{ method: 'DELETE', signal }
		);
		return data;
	},

	async enviar(payload: Record<string, unknown>, signal?: AbortSignal) {
		const { data } = await call<SubmitResponse>('/submissions', {
			method: 'POST',
			body: payload,
			signal
		});
		return data;
	},

	/**
	 * Sube el binario directamente a la URL firmada de S3.
	 *
	 * NO pasa por el backend: subir dos veces el mismo archivo (teléfono → API →
	 * S3) duplicaría el consumo de datos del conductor y bloquearía un worker de
	 * Fastify mientras dura la subida.
	 *
	 * Va sin cabeceras de autenticación: la firma de la URL ya autoriza, y adjuntar
	 * el `Authorization` haría que S3 rechazara la petición.
	 *
	 * **No añadir cabeceras `x-amz-*` aquí.** SigV4 exige que toda cabecera
	 * `x-amz-*` esté incluida en `X-Amz-SignedHeaders`, y la firma la genera el
	 * backend sin conocer lo que el navegador vaya a añadir después. Una que no
	 * esté firmada hace que S3 rechace la petición entera con
	 * `403 AccessDenied: There were headers present in the request which were not
	 * signed`.
	 *
	 * En concreto, el checksum NO se manda como cabecera. El presigner del SDK lo
	 * iza al query string (`&x-amz-checksum-sha256=…`), firmado ahí dentro, y S3
	 * lo aplica igual: si los bytes recibidos no producen ese digest, responde
	 * `400 BadDigest` y rechaza la subida. Reenviarlo como cabecera no añadía
	 * ninguna garantía —ya estaba en la URL— y rompía la firma.
	 */
	async subirBinario(
		uploadUrl: string,
		blob: Blob,
		mimeType: string,
		signal?: AbortSignal
	): Promise<void> {
		let response: Response;
		const tope = conTope(signal, TIMEOUT_SUBIDA);
		try {
			response = await fetch(uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': mimeType },
				body: blob,
				signal: tope.signal
			});
		} catch (err) {
			/// Igual que en `call()`: solo es cancelación si quien llamó abortó.
			if ((err as Error)?.name === 'AbortError' && signal?.aborted) {
				throw new PortalApiError('ABORTED', 'Subida cancelada.', 0, null);
			}
			throw new PortalApiError('NETWORK_ERROR', 'Sin conexión al subir la evidencia.', 0, null);
		} finally {
			tope.limpiar();
		}
		if (!response.ok) {
			/// `403` es lo que devuelve una URL firmada caducada (y también una firma
			/// que no cuadra). Se trata como recuperable: se vuelve a pedir en
			/// `attachments/init`.
			if (response.status === 403) {
				throw new PortalApiError(
					'UPLOAD_URL_EXPIRED',
					'La URL de subida caducó. Se reintentará con una nueva.',
					408,
					null
				);
			}
			/// `400 BadDigest` significa que los bytes enviados NO producen el
			/// checksum firmado. Reintentar el mismo blob daría el mismo error para
			/// siempre, así que se marca como NO reintentable: el adjunto está
			/// corrupto en el dispositivo y hay que volver a capturarlo.
			throw new PortalApiError(
				'UPLOAD_CHECKSUM_REJECTED',
				response.status === 400
					? 'El archivo no coincide con su huella: vuelve a capturar la evidencia.'
					: `La subida falló con estado ${response.status}.`,
				response.status,
				null
			);
		}
	}
};

/**
 * Comprueba conectividad REAL con el backend.
 *
 * `navigator.onLine` solo dice que hay una interfaz de red levantada: en un
 * portal cautivo de hotel, o con datos agotados, dice `true` y ninguna petición
 * llega. La outbox no sale a sincronizar solo porque el navegador diga que hay
 * red.
 */
export async function hayConexionReal(timeoutMs = 4000): Promise<boolean> {
	if (!browser) return false;
	if (navigator.onLine === false) return false;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const session = get(portalSession);
		if (!session?.token) return false;
		const response = await fetch(BASE, {
			method: 'GET',
			headers: { Authorization: `Bearer ${session.token}` },
			signal: controller.signal
		});
		/// Un 401 también prueba que hay red; el problema es la sesión, y de eso se
		/// encarga la outbox por separado.
		return response.ok || response.status === 401;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}
