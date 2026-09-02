/**
 * Cliente de «Mis formularios»: diligenciamiento por un usuario del dashboard.
 *
 * Habla con `/api/mis-formularios`, que es la segunda puerta al MISMO service
 * que atiende al portal del conductor. Los tipos de respuesta se reutilizan de
 * `formularios-portal.ts` porque son literalmente los mismos objetos.
 *
 * ── Diferencias con el cliente del portal, y por qué ────────────────────────
 *
 *  - **Usa `apiClient`.** El portal lo evita a propósito: allí un 401 significa
 *    «pide otro magic link», y el interceptor de `apiClient` mandaría al
 *    conductor a `/login`. Aquí el actor ES un usuario del dashboard, así que
 *    ir al login en un 401 es exactamente lo correcto.
 *  - **No hay outbox.** El portal encola todo para sobrevivir sin señal; este
 *    runner es de escritorio y guarda contra el servidor directamente. El
 *    borrador vive en la base, no en IndexedDB, y por eso existe `obtenerBorrador`
 *    —el portal no la necesita porque relee de su almacén local—.
 *  - **La subida binaria se REUTILIZA del portal.** `subirBinario` no toca la
 *    sesión del portal: es un `PUT` a una URL firmada, sin cabeceras de
 *    autenticación. Copiarla aquí duplicaría la parte más frágil del módulo (el
 *    checksum va en el query string y NO como cabecera, o SigV4 rechaza la
 *    petición entera) y garantizaría que las dos copias se separaran.
 */

import { apiClient } from './apiClient';
import { portalFormulariosAPI, PortalApiError } from './formularios-portal';
import type {
	InitAttachmentResponse,
	PortalAssignmentCard,
	PortalDefinitionResponse,
	PortalListMeta,
	SubmitResponse
} from './formularios-portal';
import type { DraftAnswer } from '$lib/formularios/validate-answers';
import type { FormVersionDto, SubmissionDetailDto, SubmissionSummaryDto } from '$lib/formularios/types';

const BASE = '/api/mis-formularios';

/**
 * Traduce un error de axios al mismo `PortalApiError` que usa el runner.
 *
 * Compartir el tipo de error es lo que permite compartir el manejo: el runner
 * distingue «corrige esto» de «vuelve a intentarlo» por el `code` estable del
 * backend, y ese código es el mismo por las dos puertas.
 */
function traducir(err: any): never {
	if (err instanceof PortalApiError) throw err;
	if (!err?.response) {
		throw new PortalApiError('NETWORK_ERROR', 'Sin conexión con el servidor.', 0, null);
	}
	const cuerpo = err.response.data?.error;
	throw new PortalApiError(
		cuerpo?.code ?? 'INTERNAL_ERROR',
		cuerpo?.message ?? 'Error inesperado.',
		err.response.status,
		cuerpo?.details ?? null
	);
}

async function get<T>(url: string, config?: Record<string, unknown>): Promise<{ data: T; meta: any }> {
	try {
		const response = await apiClient.get(url, config);
		return { data: response.data?.data as T, meta: response.data?.meta };
	} catch (err) {
		traducir(err);
	}
}

async function enviar<T>(metodo: 'post' | 'put' | 'delete', url: string, body?: unknown): Promise<T> {
	try {
		const response =
			metodo === 'delete' ? await apiClient.delete(url) : await apiClient[metodo](url, body ?? {});
		return response.data?.data as T;
	} catch (err) {
		traducir(err);
	}
}

export const misFormulariosAPI = {
	/** Tarjetas de lo que me toca diligenciar. */
	async listar(signal?: AbortSignal) {
		const { data, meta } = await get<PortalAssignmentCard[]>(BASE, { signal });
		return { data: data ?? [], meta: meta as PortalListMeta };
	},

	/**
	 * Definición publicada de una asignación.
	 *
	 * Sin el juego de ETag del portal: aquí no hay caché local que revalidar, y
	 * el navegador ya honra el `ETag` que manda el backend por su cuenta.
	 */
	async definicion(assignmentId: string, signal?: AbortSignal) {
		const { data } = await get<PortalDefinitionResponse>(`${BASE}/${assignmentId}`, { signal });
		return data;
	},

	/**
	 * Relee un borrador propio con sus respuestas.
	 *
	 * Es lo que hace viable un runner sin almacenamiento local: recargar la
	 * página a media inspección solo se recupera si el servidor devuelve lo que
	 * se llevaba escrito.
	 */
	async borrador(clientSubmissionId: string) {
		const { data } = await get<{ submission: SubmissionDetailDto; definition: FormVersionDto }>(
			`${BASE}/drafts/${clientSubmissionId}`
		);
		return data;
	},

	guardarBorrador(
		clientSubmissionId: string,
		payload: {
			assignmentId: string;
			versionId: string;
			context?: Record<string, unknown>;
			answers: DraftAnswer[];
			progress?: number;
			device?: Record<string, unknown>;
		}
	) {
		return enviar<{ id: string; status: string; alreadySubmitted: boolean }>(
			'put',
			`${BASE}/drafts/${clientSubmissionId}`,
			payload
		);
	},

	descartarBorrador(clientSubmissionId: string) {
		return enviar<{ id: string | null; deleted: boolean }>(
			'delete',
			`${BASE}/drafts/${clientSubmissionId}`
		);
	},

	async historial(params: { page?: number; limit?: number; assignmentId?: string } = {}) {
		const { data, meta } = await get<SubmissionSummaryDto[]>(`${BASE}/submissions`, { params });
		return { data: data ?? [], meta };
	},

	async envio(submissionId: string) {
		const { data } = await get<{ submission: SubmissionDetailDto; definition: FormVersionDto }>(
			`${BASE}/submissions/${submissionId}`
		);
		return data;
	},

	// ── Evidencias ───────────────────────────────────────────────────────────
	//
	// Misma cadena que el portal: INIT reserva la fila y devuelve una URL
	// firmada, el navegador hace el PUT directo a S3 y COMPLETE verifica el
	// sha256 contra lo que S3 guardó. El binario nunca pasa por el backend.

	iniciarAdjunto(payload: {
		clientSubmissionId: string;
		clientAttachmentId: string;
		fieldId: string;
		occurrenceId?: string | null;
		kind: 'PHOTO' | 'FILE' | 'SIGNATURE';
		mimeType: string;
		byteSize: number;
		sha256: string;
		originalName?: string | null;
	}) {
		return enviar<InitAttachmentResponse>('post', `${BASE}/attachments/init`, payload);
	},

	completarAdjunto(attachmentId: string, payload: { sha256: string; byteSize?: number }) {
		return enviar<{
			attachmentId: string;
			submissionId: string;
			clientAttachmentId: string;
			status: string;
			alreadyUploaded: boolean;
		}>('post', `${BASE}/attachments/${attachmentId}/complete`, payload);
	},

	descartarAdjunto(attachmentId: string) {
		return enviar<{ attachmentId: string; discarded: boolean; alreadyGone: boolean }>(
			'delete',
			`${BASE}/attachments/${attachmentId}`
		);
	},

	/// Reexportado tal cual: el `PUT` firmado no depende de qué sesión abrió el
	/// formulario, y su comentario documenta por qué no lleva cabeceras.
	subirBinario: portalFormulariosAPI.subirBinario,

	enviarFormulario(payload: Record<string, unknown>) {
		return enviar<SubmitResponse>('post', `${BASE}/submissions`, payload);
	}
};

export { PortalApiError as MisFormulariosError };
