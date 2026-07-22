import { browser } from '$app/environment';

const API_URL = browser ? import.meta.env.VITE_API_URL : 'http://localhost:4000';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type Sede = 'yopal' | 'villanueva' | 'ambas' | 'lugar_prestacion';

export interface TemasInformados {
	peligros_riesgos: boolean;
	normas_comportamiento: boolean;
	uso_epp: boolean;
	prohibicion_alcohol_drogas: boolean;
	manejo_residuos: boolean;
	uso_agua_energia: boolean;
	procedimiento_derrames: boolean;
	alarma_evacuacion: boolean;
	pasos_emergencia: boolean;
	numeros_emergencia: boolean;
	seguridad_vial: boolean;
}

export interface InduccionVisitante {
	id: string;
	sede: Sede;
	fecha: string;

	visitante_nombre: string;
	visitante_cargo: string;
	visitante_cedula: string;
	visitante_entidad: string;
	visitante_firma: string;

	temas_informados: TemasInformados;
	porcentaje_conformidad: number;

	responsable_nombre: string;
	responsable_cargo: string;
	responsable_cedula: string;
	responsable_firma: string;

	observaciones?: string | null;
	creado_por_id: string;
	created_at: string;
	updated_at: string;

	creado_por?: {
		id: string;
		nombre: string;
		correo: string;
	};
}

export interface CreateInduccionInput {
	sede: Sede;
	fecha: string; // ISO datetime
	visitante_nombre: string;
	visitante_cargo: string;
	visitante_cedula: string;
	visitante_entidad: string;
	visitante_firma: string; // Base64
	temas_informados: TemasInformados;
	responsable_nombre: string;
	responsable_cargo: string;
	responsable_cedula: string;
	responsable_firma: string; // Base64
	observaciones?: string;
}

export interface UpdateInduccionInput {
	sede?: Sede;
	fecha?: string;
	visitante_nombre?: string;
	visitante_cargo?: string;
	visitante_cedula?: string;
	visitante_entidad?: string;
	visitante_firma?: string;
	temas_informados?: Partial<TemasInformados>;
	responsable_nombre?: string;
	responsable_cargo?: string;
	responsable_cedula?: string;
	responsable_firma?: string;
	observaciones?: string;
}

export interface FiltrosInduccion {
	sede?: Sede;
	fecha_desde?: string;
	fecha_hasta?: string;
	visitante_nombre?: string;
	visitante_entidad?: string;
	page?: number;
	limit?: number;
}

export interface PaginatedInducciones {
	data: InduccionVisitante[];
	pagination: {
		total: number;
		page: number;
		limit: number;
		totalPages: number;
	};
}

export interface EstadisticasInducciones {
	total: number;
	ultimo_mes: number;
	promedio_conformidad: number;
	por_sede: { sede: Sede; cantidad: number }[];
}

// ── Clase API ─────────────────────────────────────────────────────────────────

class InduccionesAPI {
	private baseUrl = `${API_URL}/api/inducciones`;

	private async getAuthHeaders() {
		const token = browser ? localStorage.getItem('transmeralda_token') : null;
		return {
			'Content-Type': 'application/json',
			...(token && { Authorization: `Bearer ${token}` })
		};
	}

	// ── CRUD ──────────────────────────────────────────────────────────────────

	async crear(data: CreateInduccionInput): Promise<InduccionVisitante> {
		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al registrar la inducción');
		}

		const result = await response.json();
		return result.data;
	}

	async obtenerTodos(filtros?: FiltrosInduccion): Promise<PaginatedInducciones> {
		const params = new URLSearchParams();
		if (filtros) {
			Object.entries(filtros).forEach(([key, value]) => {
				if (value !== undefined && value !== null && value !== '') {
					params.set(key, String(value));
				}
			});
		}

		const url = params.toString() ? `${this.baseUrl}?${params}` : this.baseUrl;

		const response = await fetch(url, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener las inducciones');
		}

		const result = await response.json();
		return {
			data: result.data,
			pagination: result.pagination
		};
	}

	async obtenerPorId(id: string): Promise<InduccionVisitante> {
		const response = await fetch(`${this.baseUrl}/${id}`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Inducción no encontrada');
		}

		const result = await response.json();
		return result.data;
	}

	// Alias para consistencia
	obtenerInduccion(id: string): Promise<InduccionVisitante> {
		return this.obtenerPorId(id);
	}

	async actualizar(id: string, data: UpdateInduccionInput): Promise<InduccionVisitante> {
		const response = await fetch(`${this.baseUrl}/${id}`, {
			method: 'PATCH',
			headers: await this.getAuthHeaders(),
			body: JSON.stringify(data)
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.message || 'Error al actualizar la inducción');
		}

		const result = await response.json();
		return result.data;
	}

	async eliminar(id: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/${id}`, {
			method: 'DELETE',
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al eliminar la inducción');
		}
	}

	// ── Estadísticas ─────────────────────────────────────────────────────────

	async obtenerEstadisticas(): Promise<EstadisticasInducciones> {
		const response = await fetch(`${this.baseUrl}/estadisticas`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al obtener estadísticas');
		}

		const result = await response.json();
		return result.data;
	}

	// ── Exportación ───────────────────────────────────────────────────────────

	async exportarExcel(id: string): Promise<Blob> {
		const response = await fetch(`${this.baseUrl}/${id}/exportar/excel`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al exportar Excel');
		}

		return await response.blob();
	}

	async exportarPDF(id: string): Promise<Blob> {
		const response = await fetch(`${this.baseUrl}/${id}/exportar/pdf`, {
			headers: await this.getAuthHeaders()
		});

		if (!response.ok) {
			throw new Error('Error al exportar PDF');
		}

		return await response.blob();
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private descargarBlob(blob: Blob, nombre: string): void {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = nombre;
		a.click();
		URL.revokeObjectURL(url);
	}

	async descargarExcel(id: string, nombreVisitante: string): Promise<void> {
		const blob = await this.exportarExcel(id);
		const fecha = new Date().toISOString().split('T')[0];
		this.descargarBlob(blob, `induccion_${nombreVisitante.replace(/\s+/g, '_')}_${fecha}.xlsx`);
	}

	async descargarPDF(id: string, nombreVisitante: string): Promise<void> {
		const blob = await this.exportarPDF(id);
		const fecha = new Date().toISOString().split('T')[0];
		this.descargarBlob(blob, `induccion_${nombreVisitante.replace(/\s+/g, '_')}_${fecha}.pdf`);
	}
}

export const induccionesAPI = new InduccionesAPI();