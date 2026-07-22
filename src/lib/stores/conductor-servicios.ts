import { writable, get } from 'svelte/store';
import { portalFetch } from './portalStore';

export type ServicioEstado =
	| 'solicitado'
	| 'planificado'
	| 'en_curso'
	| 'pendiente'
	| 'realizado'
	| 'planilla_asignada'
	| 'liquidado'
	| 'cancelado';

export type ServicioProposito = 'personal' | 'comercial' | 'empresarial';

export interface ServicioVehiculo {
	id: string;
	placa: string;
	marca?: string | null;
	linea?: string | null;
	modelo?: string | null;
	color?: string | null;
	clase_vehiculo?: string | null;
	tipo_carroceria?: string | null;
	combustible?: string | null;
}

export interface ServicioMunicipio {
	id: string;
	nombre_municipio: string;
	nombre_departamento?: string | null;
	latitud?: number | null;
	longitud?: number | null;
}

export interface ServicioCliente {
	id: string;
	nombre?: string | null;
	nit?: string | null;
}

export interface ServicioConductor {
	id: string;
	estado: ServicioEstado;
	proposito_servicio: ServicioProposito;
	origen_especifico: string;
	destino_especifico: string;
	fecha_solicitud: string;
	fecha_realizacion?: string | null;
	fecha_finalizacion?: string | null;
	origen_latitud?: number | null;
	origen_longitud?: number | null;
	destino_latitud?: number | null;
	destino_longitud?: number | null;
	valor: number;
	numero_planilla?: string | null;
	origen?: ServicioMunicipio | null;
	destino?: ServicioMunicipio | null;
	vehiculo?: ServicioVehiculo | null;
	cliente?: ServicioCliente | null;
}

export const SERVICIO_STATUS_PALETTE: Record<
	ServicioEstado,
	{ bg: string; fg: string; border: string; dot: string; label: string }
> = {
	solicitado: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6', label: 'Solicitado' },
	planificado: { bg: '#faf5ff', fg: '#7e22ce', border: '#e9d5ff', dot: '#a855f7', label: 'Planificado' },
	en_curso: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6', label: 'En curso' },
	pendiente: { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa', dot: '#f97316', label: 'Pendiente' },
	realizado: { bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0', dot: '#10b981', label: 'Realizado' },
	planilla_asignada: { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6', label: 'Planilla' },
	liquidado: { bg: '#f3f4f6', fg: '#374151', border: '#d1d5db', dot: '#6b7280', label: 'Liquidado' },
	cancelado: { bg: '#fef2f2', fg: '#b91c1c', border: '#fecaca', dot: '#ef4444', label: 'Cancelado' }
};

function createConductorServiciosStore() {
	const { subscribe, set, update } = writable<{
		servicios: ServicioConductor[];
		loading: boolean;
		error: string;
		detalle: ServicioConductor | null;
		loadingDetalle: boolean;
		errorDetalle: string;
	}>({
		servicios: [],
		loading: false,
		error: '',
		detalle: null,
		loadingDetalle: false,
		errorDetalle: ''
	});

	return {
		subscribe,
		async cargarServicios(estados?: ServicioEstado[]) {
			update((s) => ({ ...s, loading: true, error: '' }));
			try {
				const qs = estados?.length ? `?estados=${estados.join(',')}` : '';
				const res = await portalFetch(`/conductor-portal/servicios${qs}`);
				update((s) => ({
					...s,
					servicios: res.data || [],
					loading: false
				}));
			} catch (err: any) {
				const msg = err.message || 'Error al cargar servicios';
				update((s) => ({ ...s, loading: false, error: msg }));
			}
		},
		async cargarDetalle(id: string) {
			update((s) => ({ ...s, loadingDetalle: true, errorDetalle: '', detalle: null }));
			try {
				const res = await portalFetch(`/conductor-portal/servicios/${id}`);
				update((s) => ({
					...s,
					detalle: res.data || null,
					loadingDetalle: false
				}));
			} catch (err: any) {
				const msg = err.message || 'Error al cargar servicio';
				update((s) => ({ ...s, loadingDetalle: false, errorDetalle: msg }));
			}
		},
		limpiarDetalle() {
			update((s) => ({ ...s, detalle: null, errorDetalle: '' }));
		},
		limpiar() {
			set({
				servicios: [],
				loading: false,
				error: '',
				detalle: null,
				loadingDetalle: false,
				errorDetalle: ''
			});
		}
	};
}

export const conductorServiciosStore = createConductorServiciosStore();

export const fmtCurrency = (n: number) =>
	new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(n);

export const fmtDate = (d?: string | null) => {
	if (!d) return '—';
	try {
		return new Intl.DateTimeFormat('es-CO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(d));
	} catch {
		return '—';
	}
};

export const fmtTime = (d?: string | null) => {
	if (!d) return '—';
	try {
		return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
	} catch {
		return '—';
	}
};

export const fmtMin = (m: number) => {
	const h = Math.floor(m / 60),
		r = Math.round(m % 60);
	return h > 0 ? `${h}h ${r}min` : `${r}min`;
};
