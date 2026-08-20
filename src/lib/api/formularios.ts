import { apiClient } from './apiClient';
import type {
	AssignmentDto,
	AssignmentFrequency,
	AssignmentStatus,
	DefinitionValidationResult,
	FieldTemplateDto,
	FormDefinitionDto,
	FormVersionDto,
	LimitPolicy,
	SubmissionDetailDto,
	SubmissionStatus,
	SubmissionSummaryDto,
	TargetType,
	FormErrorCode
} from '$lib/formularios/types';

/**
 * Cliente tipado del módulo de formularios dinámicos.
 *
 * Dos decisiones que valen por todo el archivo:
 *
 *  1. **Nada de reintentos ciegos en mutaciones.** `apiClient` ya solo reintenta
 *     métodos idempotentes, y aquí no se añade ninguno: reintentar un `publish` o
 *     un `POST /submissions` a espaldas del llamador es exactamente lo que la
 *     outbox del portal tiene que controlar con su propio `client_submission_id`.
 *
 *  2. **Los errores del dominio se desenvuelven a `FormApiError`.** El backend
 *     responde `{ success: false, error: { code, message, details } }`, y el
 *     `code` es lo que la UI necesita para decidir: `REVISION_CONFLICT` abre el
 *     diálogo de conflicto, `FORM_DEFINITION_INVALID` pinta los issues sobre las
 *     cards. Dejar pasar el `AxiosError` crudo obligaría a cada llamador a bucear
 *     en `err.response.data.error.code`.
 */

export interface ListMeta {
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

/** Error del dominio, con el código estable del backend. */
export class FormApiError extends Error {
	readonly code: FormErrorCode | string;
	readonly status: number;
	readonly details: unknown;

	constructor(code: string, message: string, status: number, details?: unknown) {
		super(message);
		this.name = 'FormApiError';
		this.code = code;
		this.status = status;
		this.details = details;
	}

	/** Issues de validación, cuando el error los trae. */
	get validationErrors(): { path: string; message: string; code?: string }[] {
		const d = this.details as any;
		if (Array.isArray(d?.errors)) return d.errors;
		if (Array.isArray(d)) return d;
		return [];
	}
}

function unwrap<T>(promise: Promise<{ data: any }>): Promise<T> {
	return promise.then((r) => r.data?.data as T, rethrow);
}

function unwrapWithMeta<T>(promise: Promise<{ data: any }>): Promise<{ data: T; meta: any }> {
	return promise.then((r) => ({ data: r.data?.data as T, meta: r.data?.meta ?? {} }), rethrow);
}

function rethrow(err: any): never {
	const payload = err?.response?.data;
	if (payload?.error?.code) {
		throw new FormApiError(
			payload.error.code,
			payload.error.message ?? 'Error del servidor.',
			err.response.status,
			payload.error.details
		);
	}
	/// Sin respuesta = red o timeout. Se marca con un código propio para que la
	/// outbox lo distinga de un rechazo de validación y reintente.
	if (!err?.response) {
		throw new FormApiError('NETWORK_ERROR', 'Sin conexión con el servidor.', 0, null);
	}
	throw new FormApiError(
		'INTERNAL_ERROR',
		payload?.message ?? err.message ?? 'Error inesperado.',
		err.response.status,
		payload
	);
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

export interface ListarFormulariosParams {
	page?: number;
	limit?: number;
	search?: string;
	ownerArea?: string;
	includeDeleted?: boolean;
}

export interface CrearFormularioPayload {
	code: string;
	slug?: string;
	name: string;
	description?: string | null;
	ownerArea?: string;
	versionTitle?: string;
}

/** Árbol que el builder envía. Los `id` ausentes crean nodos nuevos. */
export interface GuardarVersionPayload {
	title: string;
	description?: string | null;
	instructions?: string | null;
	settings?: Record<string, unknown>;
	sections: unknown[];
	revision: number;
	clientMutationId?: string;
}

export const formulariosAPI = {
	listar(params: ListarFormulariosParams = {}) {
		return unwrapWithMeta<FormDefinitionDto[]>(apiClient.get('/api/formularios', { params }));
	},

	obtener(formId: string) {
		return unwrap<FormDefinitionDto>(apiClient.get(`/api/formularios/${formId}`));
	},

	crear(payload: CrearFormularioPayload) {
		return unwrap<FormDefinitionDto>(apiClient.post('/api/formularios', payload));
	},

	actualizar(formId: string, payload: Partial<CrearFormularioPayload>) {
		return unwrap<FormDefinitionDto>(apiClient.patch(`/api/formularios/${formId}`, payload));
	},

	/** Borrado lógico. Falla con `FORM_HAS_ACTIVE_ASSIGNMENTS` si quedan vivas. */
	archivar(formId: string) {
		return unwrap<{ id: string; deletedAt: string }>(apiClient.delete(`/api/formularios/${formId}`));
	},

	restaurar(formId: string) {
		return unwrap<FormDefinitionDto>(apiClient.post(`/api/formularios/${formId}/restore`, {}));
	},

	duplicar(formId: string, payload: { code: string; slug?: string; name: string }, versionId?: string) {
		return unwrap<FormDefinitionDto>(
			apiClient.post(`/api/formularios/${formId}/duplicate`, payload, {
				params: versionId ? { versionId } : undefined
			})
		);
	},

	// ── Versiones ──────────────────────────────────────────────────────────────

	obtenerVersion(formId: string, versionId: string) {
		return unwrap<FormVersionDto>(
			apiClient.get(`/api/formularios/${formId}/versions/${versionId}`)
		);
	},

	/**
	 * Guarda el árbol del borrador.
	 *
	 * Devuelve la versión recargada más el resultado de validación en modo
	 * publish: así el builder puede pintar los warnings que bloquearían o
	 * acompañarían la publicación sin una segunda petición.
	 */
	guardarVersion(formId: string, versionId: string, payload: GuardarVersionPayload) {
		return unwrapWithMeta<FormVersionDto>(
			apiClient.put(`/api/formularios/${formId}/versions/${versionId}`, payload)
		) as Promise<{ data: FormVersionDto; meta: { validation: DefinitionValidationResult; revision: number } }>;
	},

	validarVersion(formId: string, versionId: string, mode: 'draft' | 'publish' = 'publish') {
		return unwrap<DefinitionValidationResult>(
			apiClient.post(`/api/formularios/${formId}/versions/${versionId}/validate`, {}, { params: { mode } })
		);
	},

	/** Única forma de "editar" una versión publicada. */
	clonarVersion(formId: string, versionId: string) {
		return unwrap<FormVersionDto>(
			apiClient.post(`/api/formularios/${formId}/versions/${versionId}/clone`, {})
		);
	},

	publicarVersion(formId: string, versionId: string) {
		return unwrapWithMeta<FormVersionDto>(
			apiClient.post(`/api/formularios/${formId}/versions/${versionId}/publish`, {})
		) as Promise<{
			data: FormVersionDto;
			meta: { validation: DefinitionValidationResult; alreadyPublished: boolean };
		}>;
	},

	archivarVersion(formId: string, versionId: string) {
		return unwrap<FormVersionDto>(
			apiClient.post(`/api/formularios/${formId}/versions/${versionId}/archive`, {})
		);
	}
};

// ─── Plantillas de cards ─────────────────────────────────────────────────────

export const plantillasFormularioAPI = {
	listar(params: { category?: string; search?: string } = {}) {
		return unwrap<FieldTemplateDto[]>(apiClient.get('/api/form-field-templates', { params }));
	},

	crear(payload: {
		name: string;
		category: string;
		fieldType: string;
		template: Record<string, unknown>;
		ownerArea?: string | null;
		isGlobal?: boolean;
	}) {
		return unwrap<FieldTemplateDto>(apiClient.post('/api/form-field-templates', payload));
	},

	actualizar(id: string, payload: Record<string, unknown>) {
		return unwrap<FieldTemplateDto>(apiClient.patch(`/api/form-field-templates/${id}`, payload));
	},

	eliminar(id: string) {
		return unwrap<{ id: string }>(apiClient.delete(`/api/form-field-templates/${id}`));
	}
};

// ─── Asignaciones ────────────────────────────────────────────────────────────

export interface TargetPayload {
	type: TargetType;
	conductorId?: string | null;
	vehicleId?: string | null;
	sede?: string | null;
	groupKey?: string | null;
}

export interface AsignacionPayload {
	versionId: string;
	name: string;
	frequency: AssignmentFrequency;
	limitPolicy: LimitPolicy;
	timezone?: string;
	startsAt?: string | null;
	endsAt?: string | null;
	targets: TargetPayload[];
	contextSchema?: Record<string, { required?: boolean }>;
	settings?: Record<string, unknown>;
}

export const asignacionesFormularioAPI = {
	listar(
		params: {
			page?: number;
			limit?: number;
			search?: string;
			formId?: string;
			versionId?: string;
			status?: AssignmentStatus;
		} = {}
	) {
		return unwrapWithMeta<AssignmentDto[]>(apiClient.get('/api/formularios/asignaciones', { params }));
	},

	obtener(id: string) {
		return unwrap<AssignmentDto>(apiClient.get(`/api/formularios/asignaciones/${id}`));
	},

	crear(payload: AsignacionPayload) {
		return unwrapWithMeta<AssignmentDto>(apiClient.post('/api/formularios/asignaciones', payload)) as Promise<{
			data: AssignmentDto;
			meta: { warnings: string[] };
		}>;
	},

	actualizar(id: string, payload: Partial<Omit<AsignacionPayload, 'versionId'>>) {
		return unwrapWithMeta<AssignmentDto>(
			apiClient.patch(`/api/formularios/asignaciones/${id}`, payload)
		) as Promise<{ data: AssignmentDto; meta: { warnings: string[] } }>;
	},

	pausar(id: string) {
		return unwrap<AssignmentDto>(apiClient.post(`/api/formularios/asignaciones/${id}/pause`, {}));
	},

	reactivar(id: string) {
		return unwrap<AssignmentDto>(apiClient.post(`/api/formularios/asignaciones/${id}/resume`, {}));
	},

	/** Terminal: una asignación cerrada no se reabre. */
	cerrar(id: string) {
		return unwrap<AssignmentDto>(apiClient.post(`/api/formularios/asignaciones/${id}/close`, {}));
	}
};

// ─── Envíos (administración) ─────────────────────────────────────────────────

export interface FiltrosEnvios {
	page?: number;
	limit?: number;
	search?: string;
	formId?: string;
	versionId?: string;
	assignmentId?: string;
	conductorId?: string;
	vehicleId?: string;
	status?: SubmissionStatus;
	businessDateFrom?: string;
	businessDateTo?: string;
}

export const enviosFormularioAPI = {
	listar(params: FiltrosEnvios = {}) {
		return unwrapWithMeta<SubmissionSummaryDto[]>(
			apiClient.get('/api/formularios/submissions', { params })
		);
	},

	/**
	 * Detalle inmutable. Trae la definición VERSIONADA junto al envío: el detalle
	 * debe renderizarse con las etiquetas y opciones que existían al enviarlo, no
	 * con las de la versión vigente.
	 */
	obtener(id: string) {
		return unwrap<{ submission: SubmissionDetailDto; definition: FormVersionDto }>(
			apiClient.get(`/api/formularios/submissions/${id}`)
		);
	},

	anular(id: string, reason: string) {
		return unwrap<{ submission: SubmissionDetailDto; definition: FormVersionDto }>(
			apiClient.post(`/api/formularios/submissions/${id}/void`, { reason })
		);
	},

	/**
	 * CSV de la lista filtrada.
	 *
	 * Con `versionId` el backend añade una columna por pregunta; sin él exporta
	 * solo la cabecera de cada envío, porque formularios distintos no comparten
	 * columnas.
	 */
	async exportarCsv(params: FiltrosEnvios = {}): Promise<Blob> {
		const { data } = await apiClient
			.get('/api/formularios/submissions/export.csv', { params, responseType: 'blob' })
			.catch(rethrow);
		return data as Blob;
	}
};
