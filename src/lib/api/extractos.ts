/**
 * Extractos de contrato (FUEC, OP-FR-04): emitidos por el sistema y los
 * importados del libro de Excel con que se hacían antes.
 *
 * Un extracto no se edita: se reemplaza (el anterior queda anulado) o se
 * anula. El PDF se arma en el navegador a partir del `snapshot` que firmó el
 * servidor (`pdfExtracto.ts`).
 */
import { apiClient } from './apiClient';

export type EstadoExtracto = 'VIGENTE' | 'POR_VENCER' | 'VENCIDO' | 'ANULADO';
export type FiltroEstadoExtracto = 'todos' | 'vigentes' | 'por_vencer' | 'vencidos' | 'anulados';
export type TipoCatalogo = 'OBJETO' | 'CONVENIO' | 'ORIGEN_DESTINO';

export const ESTADO_LABELS: Record<EstadoExtracto, string> = {
	VIGENTE: 'Vigente',
	POR_VENCER: 'Por vencer',
	VENCIDO: 'Vencido',
	ANULADO: 'Anulado'
};
export const ESTADO_COLORES: Record<EstadoExtracto, string> = {
	VIGENTE: '#22c55e',
	POR_VENCER: '#f59e0b',
	VENCIDO: '#94a3b8',
	ANULADO: '#ef4444'
};

export interface Responsable {
	nombre: string | null;
	cedula: string | null;
	telefono: string | null;
	direccion: string | null;
}

export interface ConductorExtracto {
	id: string;
	conductor_id: string | null;
	nombre: string;
	cedula: string | null;
	licencia_vigencia: string | null;
	orden: number;
}

/** Lo que firmó el servidor: exactamente lo que se imprime. */
export interface SnapshotExtracto {
	numero: string;
	consecutivo: number;
	empresa: { razon_social: string; nit: string };
	contrato_numero: string;
	contratante: { nombre: string; nit: string | null };
	objeto_contrato: string;
	origen_destino: string;
	convenio: string;
	vigencia_desde: string;
	vigencia_hasta: string;
	vehiculo: {
		placa: string;
		modelo: string | null;
		marca: string | null;
		clase: string | null;
		numero_interno: string | null;
		tarjeta_operacion: string | null;
	};
	conductores: Array<{ nombre: string; cedula: string | null; licencia_vigencia: string | null }>;
	responsable: Responsable;
	emitido_at: string;
}

export interface Extracto {
	id: string;
	consecutivo: number;
	numero_completo: string;
	estado: EstadoExtracto;
	contratante_id: string | null;
	contratante_nombre: string | null;
	contratante_nit: string | null;
	contrato_numero: string | null;
	objeto_contrato: string | null;
	origen_destino: string | null;
	convenio: string | null;
	vigencia_desde: string;
	vigencia_hasta: string;
	vehiculo_id: string | null;
	placa: string | null;
	modelo: string | null;
	marca: string | null;
	clase: string | null;
	numero_interno: string | null;
	tarjeta_operacion: string | null;
	conductores: ConductorExtracto[];
	responsable: Responsable;
	codigo_verificacion: string | null;
	huella: string | null;
	firmado: boolean;
	emitido_at: string;
	source: string;
	creado_por: { id: string; nombre: string } | null;
	anulado_at: string | null;
	anulado_por: { id: string; nombre: string } | null;
	motivo_anulacion: string | null;
	reemplaza_a: { id: string; numero_completo: string; consecutivo: number } | null;
	reemplazado_por: Array<{ id: string; numero_completo: string; consecutivo: number }>;
	snapshot: SnapshotExtracto | Record<string, never>;
}

export interface ListadoExtractos {
	data: Extracto[];
	total: number;
	page: number;
	limit: number;
	conteos: {
		todos: number;
		vigentes: number;
		por_vencer: number;
		vencidos: number;
		anulados: number;
	};
}

export interface Contratante {
	id: string;
	nombre: string;
	nit: string | null;
	numero_contrato: string | null;
	cliente_id: string | null;
	responsable: Responsable;
	usos: number;
	ultimo_uso_at: string | null;
}

export interface ContratanteInput {
	id?: string | null;
	nombre: string;
	nit?: string | null;
	numero_contrato?: string | null;
	cliente_id?: string | null;
	responsable?: Partial<Responsable> | null;
}

export interface EntradaCatalogo {
	id: string;
	tipo: TipoCatalogo;
	texto: string;
	usos: number;
}

export interface VehiculoOpcion {
	id: string;
	placa: string;
	modelo: string | null;
	marca: string | null;
	clase: string | null;
	numero_interno: string | null;
	tarjeta_operacion: string | null;
	empresa_afiliacion: string | null;
	estado: string;
}

export interface ConductorOpcion {
	id: string;
	nombre: string;
	cedula: string | null;
	licencia_vigencia: string | null;
	estado: string;
}

export interface EmpresaFuec {
	prefijo: string;
	razon_social: string;
	nit: string;
	codigo_formato: string;
	version: string;
	fecha_formato: string;
	direccion: string;
	email: string;
	telefono: string;
	firmante_cargo: string;
	objeto_defecto: string;
}

export interface OpcionesExtracto {
	empresa: EmpresaFuec;
	hoy: string;
	siguiente_consecutivo: number;
	anio: number;
	vigencia_defecto: { desde: string; hasta: string };
	contratantes: Contratante[];
	catalogos: Record<TipoCatalogo, EntradaCatalogo[]>;
	vehiculos: VehiculoOpcion[];
	conductores: ConductorOpcion[];
}

export interface EmitirExtractoInput {
	contratante: ContratanteInput;
	contrato_numero?: string | null;
	objeto_contrato: string;
	origen_destino: string;
	convenio?: string | null;
	vigencia_desde: string;
	vigencia_hasta: string;
	vehiculo: {
		id?: string | null;
		placa: string;
		modelo?: string | null;
		marca?: string | null;
		clase?: string | null;
		numero_interno?: string | null;
		tarjeta_operacion?: string | null;
	};
	conductores: Array<{
		id?: string | null;
		nombre: string;
		cedula?: string | null;
		licencia_vigencia?: string | null;
	}>;
	reemplaza_a_id?: string | null;
	actualizar_fichas?: boolean;
}

/** Lo que devuelve la validación pública (a donde lleva el QR). */
export interface ExtractoPublico {
	numero: string;
	consecutivo: number;
	estado: EstadoExtracto;
	firma_valida: boolean;
	huella: string | null;
	emitido_at: string | null;
	empresa: { razon_social: string; nit: string };
	contratante: string | null;
	contrato_numero: string;
	objeto_contrato: string | null;
	origen_destino: string | null;
	convenio: string | null;
	vigencia_desde: string | null;
	vigencia_hasta: string | null;
	vehiculo: {
		placa: string | null;
		modelo: string | null;
		marca: string | null;
		clase: string | null;
		numero_interno: string | null;
		tarjeta_operacion: string | null;
	};
	conductores: Array<{ nombre: string; cedula: string | null; licencia_vigencia: string | null }>;
	anulado: { fecha: string; motivo: string | null } | null;
	reemplazado_por: string | null;
}

function mensaje(error: unknown, porDefecto: string): Error {
	const e = error as { response?: { data?: { message?: string } } };
	return new Error(e?.response?.data?.message || porDefecto);
}

async function llamar<T>(promesa: Promise<{ data: { data: T } }>, porDefecto: string): Promise<T> {
	try {
		return (await promesa).data.data;
	} catch (error) {
		throw mensaje(error, porDefecto);
	}
}

export const extractosAPI = {
	async listar(params: {
		q?: string;
		placa?: string;
		contratante_id?: string;
		estado?: FiltroEstadoExtracto;
		anio?: number;
		page?: number;
		limit?: number;
	}): Promise<ListadoExtractos> {
		try {
			const { data } = await apiClient.get('/api/extractos', { params });
			return data;
		} catch (error) {
			throw mensaje(error, 'No se pudieron cargar los extractos');
		}
	},
	anios: () =>
		llamar<number[]>(apiClient.get('/api/extractos/anios'), 'No se pudieron leer los años'),
	opciones: () =>
		llamar<OpcionesExtracto>(
			apiClient.get('/api/extractos/opciones'),
			'No se pudieron cargar los datos del formulario'
		),
	detalle: (id: string) =>
		llamar<Extracto>(apiClient.get(`/api/extractos/${id}`), 'No se pudo cargar el extracto'),
	emitir: (input: EmitirExtractoInput) =>
		llamar<Extracto>(apiClient.post('/api/extractos', input), 'No se pudo emitir el extracto'),
	anular: (id: string, motivo: string) =>
		llamar<Extracto>(
			apiClient.post(`/api/extractos/${id}/anular`, { motivo }),
			'No se pudo anular el extracto'
		),
	contratantes: (q?: string) =>
		llamar<Contratante[]>(
			apiClient.get('/api/extractos/contratantes', { params: q ? { q } : {} }),
			'No se pudieron cargar los contratantes'
		),
	crearContratante: (input: ContratanteInput) =>
		llamar<Contratante>(
			apiClient.post('/api/extractos/contratantes', input),
			'No se pudo crear el contratante'
		),
	guardarContratante: (id: string, input: ContratanteInput) =>
		llamar<Contratante>(
			apiClient.put(`/api/extractos/contratantes/${id}`, input),
			'No se pudo guardar el contratante'
		),
	async eliminarContratante(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/extractos/contratantes/${id}`);
		} catch (error) {
			throw mensaje(error, 'No se pudo eliminar el contratante');
		}
	},
	catalogo: (tipo: TipoCatalogo) =>
		llamar<EntradaCatalogo[]>(
			apiClient.get('/api/extractos/catalogo', { params: { tipo } }),
			'No se pudo leer el catálogo'
		),
	async eliminarCatalogo(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/extractos/catalogo/${id}`);
		} catch (error) {
			throw mensaje(error, 'No se pudo eliminar la entrada');
		}
	}
};

/** Validación pública: sin sesión, por el código del QR. */
export async function validarExtractoPublico(codigo: string): Promise<ExtractoPublico> {
	const API = (import.meta.env.VITE_API_URL as string) || '';
	const base = API.endsWith('/') ? API.slice(0, -1) : API;
	const res = await fetch(`${base}/api/public/extractos/${encodeURIComponent(codigo)}`);
	const json = await res.json().catch(() => null);
	if (!res.ok) throw new Error(json?.message || 'No se pudo validar el extracto');
	return json.data as ExtractoPublico;
}

// ── Formato ─────────────────────────────────────────────────────────────

/** 1116020351 → 1.116.020.351 (como lo imprime el formato). Con DV, 901528440-3 → 901.528.440-3. */
export function conPuntos(v: string | null | undefined): string {
	if (!v) return '';
	const [cuerpo, dv] = v.replace(/\./g, '').split('-');
	if (!/^\d+$/.test(cuerpo)) return v;
	return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dv ? `-${dv}` : '');
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function fechaFormato(ymd: string | null | undefined): string {
	if (!ymd) return '';
	const [a, m, d] = ymd.slice(0, 10).split('-');
	return a && m && d ? `${d}/${m}/${a}` : ymd;
}

export function fechaLarga(ymd: string | null | undefined): string {
	if (!ymd) return '—';
	/// Un instante (con hora) va al día local: a las 11 p. m. en Colombia ya es
	/// el día siguiente en UTC. Una fecha a secas se corta tal cual.
	const [a, m, d] = ymd.includes('T')
		? [new Date(ymd).getFullYear(), new Date(ymd).getMonth() + 1, new Date(ymd).getDate()]
		: ymd.slice(0, 10).split('-').map(Number);
	return new Date(a, m - 1, d).toLocaleDateString('es-CO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

export function urlPublicaExtracto(codigo: string): string {
	const origen = typeof window !== 'undefined' ? window.location.origin : '';
	return `${origen}/public/extracto/${codigo}`;
}
