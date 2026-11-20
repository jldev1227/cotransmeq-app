import { apiClient } from './apiClient';

type Respuesta<T> = { data: { success: boolean; data: T; error?: { message: string } } };
async function dato<T>(promesa: Promise<Respuesta<T>>): Promise<T> {
	try {
		return (await promesa).data.data;
	} catch (error: any) {
		throw new Error(
			error?.response?.data?.error?.message ??
				error?.message ??
				'No se pudo completar la operación.'
		);
	}
}

export type OpcionesEscaneados = {
	assignments: Array<{
		id: string;
		name: string;
		version: { title: string; version_number: number; form: { code: string; name: string } };
	}>;
	conductores: Array<{
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string | null;
	}>;
	vehiculos: Array<{ id: string; placa: string }>;
};
export type Escaneado = {
	id: string;
	formCode: string;
	formName: string;
	versionNumber: number;
	assignmentName: string;
	conductor: string;
	document: string | null;
	placa: string;
	dateFrom: string;
	dateTo: string;
	daysCovered: number;
	explanation: string;
	details: Record<string, string>;
	originalName: string;
	byteSize: number;
	uploadedAt: string | null;
	createdBy: string;
};
export type NuevoEscaneado = {
	assignmentId: string;
	conductorId: string;
	vehicleId: string;
	dateFrom: string;
	dateTo: string;
	explanation: string;
	details: Record<string, string>;
	originalName: string;
	byteSize: number;
	sha256: string;
};

export const escaneadosAPI = {
	opciones(q = '', formId = '') {
		return dato<OpcionesEscaneados>(
			apiClient.get('/api/formularios/escaneados/opciones', {
				params: { q, formId: formId || undefined }
			})
		);
	},
	listar(page = 1, search = '', coveredOn = '') {
		return dato<{ items: Escaneado[]; total: number; page: number }>(
			apiClient.get('/api/formularios/escaneados', {
				params: { page, search, coveredOn: coveredOn || undefined }
			})
		);
	},
	iniciar(payload: NuevoEscaneado) {
		return dato<{ id: string; uploadUrl: string }>(
			apiClient.post('/api/formularios/escaneados/init', payload)
		);
	},
	completar(id: string) {
		return dato<{ id: string; status: string }>(
			apiClient.post(`/api/formularios/escaneados/${id}/complete`, {})
		);
	},
	subir(id: string, archivo: File) {
		const body = new FormData();
		body.append('archivo', archivo);
		return dato<{ id: string; status: string }>(
			apiClient.post(`/api/formularios/escaneados/${id}/archivo`, body, { timeout: 120_000 })
		);
	},
	url(id: string) {
		return dato<{ url: string }>(apiClient.get(`/api/formularios/escaneados/${id}/url`));
	}
};
