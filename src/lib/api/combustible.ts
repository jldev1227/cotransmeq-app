import { apiClient } from './apiClient';

/**
 * Tanqueos de combustible y rendimiento (km/gal) de la flota.
 *
 * El rendimiento lo calcula el backend, de lleno a lleno: aquí solo se pinta
 * lo que llega en `rendimiento.estado`, sin repetir reglas que se podrían
 * desincronizar.
 */

export type TipoCombustible = 'DIESEL' | 'GASOLINA';
export type MedioPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CREDITO_ESTACION' | 'ANTICIPO';

export const COMBUSTIBLE_LABELS: Record<TipoCombustible, string> = {
	DIESEL: 'Diésel (ACPM)',
	GASOLINA: 'Gasolina'
};

export const MEDIO_PAGO_LABELS: Record<MedioPago, string> = {
	EFECTIVO: 'Efectivo',
	TARJETA: 'Tarjeta',
	TRANSFERENCIA: 'Transferencia',
	CREDITO_ESTACION: 'Crédito o vales de la estación',
	ANTICIPO: 'Anticipo de viáticos'
};

/**
 * `medido`: cierra un tramo entre llenos. `alerta`: lo cierra por debajo de lo
 * habitual del vehículo. `parcial`: sus galones suman al siguiente lleno.
 * `inicio`: primer lleno del vehículo, el punto de partida.
 */
export type EstadoRendimiento = 'medido' | 'alerta' | 'parcial' | 'inicio';

export interface RendimientoTanqueo {
	estado: EstadoRendimiento;
	km_recorridos: number | null;
	galones_tramo: number | null;
	rendimiento: number | null;
	referencia: number | null;
	desviacion: number | null;
	costo_km: number | null;
}

export interface Tanqueo {
	id: string;
	vehiculo: { id: string; placa: string; marca: string | null; linea: string | null };
	conductor: { id: string; nombre: string; numero_identificacion: string | null } | null;
	fecha_hora: string;
	kilometraje: number;
	galones: number;
	valor_total: number;
	precio_galon: number;
	tipo_combustible: TipoCombustible;
	estacion: string | null;
	tanque_lleno: boolean;
	medio_pago: MedioPago | null;
	observaciones: string | null;
	comprobante: { nombre: string; mime: string | null } | null;
	creado_por: { id: string; nombre: string } | null;
	created_at: string;
	updated_at: string;
	rendimiento: RendimientoTanqueo;
}

export interface TotalesCombustible {
	tanqueos: number;
	galones: number;
	gasto: number;
	precio_galon: number | null;
	tramos: number;
	km_recorridos: number;
	rendimiento: number | null;
	costo_km: number | null;
	alertas: number;
}

export interface ListadoTanqueos {
	data: Tanqueo[];
	meta: { total: number; pagina: number; por_pagina: number; truncado: boolean };
	resumen: TotalesCombustible;
}

export interface RendimientoVehiculo extends TotalesCombustible {
	vehiculo: {
		id: string;
		placa: string;
		marca: string | null;
		linea: string | null;
		modelo: string | null;
	};
	ultimo_km: number;
	ultimo_tanqueo: string;
	ultimo_tramo: {
		rendimiento: number;
		referencia: number | null;
		desviacion: number | null;
		anomalo: boolean;
	} | null;
	rendimiento_historico: number | null;
}

export interface CatalogosCombustible {
	vehiculos: {
		id: string;
		placa: string;
		marca: string | null;
		linea: string | null;
		modelo: string | null;
		combustible: string | null;
		kilometraje: number | null;
		oculto: boolean;
	}[];
	conductores: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string | null;
		estado: string;
	}[];
}

export interface ContextoVehiculo {
	vehiculo: {
		id: string;
		placa: string;
		combustible: string | null;
		kilometraje_ficha: number | null;
	};
	anterior: { fecha_hora: string; kilometraje: number } | null;
	siguiente: { fecha_hora: string; kilometraje: number } | null;
}

export interface FiltrosCombustible {
	vehiculo_id?: string;
	conductor_id?: string;
	desde?: string;
	hasta?: string;
	solo_alertas?: boolean;
	pagina?: number;
	por_pagina?: number;
}

export interface TanqueoInput {
	vehiculo_id: string;
	conductor_id: string | null;
	/** `AAAA-MM-DDTHH:mm`, hora de Colombia (como la da un `datetime-local`). */
	fecha_hora: string;
	kilometraje: number;
	galones: number;
	valor_total: number;
	tipo_combustible: TipoCombustible;
	estacion: string | null;
	tanque_lleno: boolean;
	medio_pago: MedioPago | null;
	observaciones: string | null;
}

/** Mensaje del backend (`message`) o el genérico; nunca el volcado de axios. */
function mensaje(error: unknown, porDefecto: string): Error {
	const e = error as { response?: { data?: { message?: string; error?: string } } };
	return new Error(e?.response?.data?.message || e?.response?.data?.error || porDefecto);
}

async function llamar<T>(promesa: Promise<{ data: T }>, porDefecto: string): Promise<T> {
	try {
		return (await promesa).data;
	} catch (error) {
		throw mensaje(error, porDefecto);
	}
}

const params = (f: FiltrosCombustible) => ({
	...f,
	solo_alertas: f.solo_alertas ? '1' : undefined
});

export const combustibleAPI = {
	catalogos: async () =>
		(
			await llamar<{ data: CatalogosCombustible }>(
				apiClient.get('/api/combustible/catalogos'),
				'No se pudieron cargar vehículos y conductores'
			)
		).data,

	listar: (f: FiltrosCombustible) =>
		llamar<ListadoTanqueos>(
			apiClient.get('/api/combustible/tanqueos', { params: params(f) }),
			'No se pudieron cargar los tanqueos'
		),

	rendimiento: (f: FiltrosCombustible) =>
		llamar<{ vehiculos: RendimientoVehiculo[]; totales: TotalesCombustible }>(
			apiClient.get('/api/combustible/rendimiento', { params: params(f) }),
			'No se pudo calcular el rendimiento'
		),

	contexto: async (vehiculoId: string, fechaHora?: string, excluir?: string) =>
		(
			await llamar<{ data: ContextoVehiculo }>(
				apiClient.get(`/api/combustible/vehiculos/${vehiculoId}/contexto`, {
					params: { fecha_hora: fechaHora || undefined, excluir: excluir || undefined }
				}),
				'No se pudo consultar el vehículo'
			)
		).data,

	crear: async (input: TanqueoInput) =>
		(
			await llamar<{ data: Tanqueo }>(
				apiClient.post('/api/combustible/tanqueos', input),
				'No se pudo registrar el tanqueo'
			)
		).data,

	actualizar: async (id: string, input: TanqueoInput) =>
		(
			await llamar<{ data: Tanqueo }>(
				apiClient.put(`/api/combustible/tanqueos/${id}`, input),
				'No se pudo actualizar el tanqueo'
			)
		).data,

	eliminar: (id: string) =>
		llamar(apiClient.delete(`/api/combustible/tanqueos/${id}`), 'No se pudo eliminar el tanqueo'),

	subirComprobante: async (id: string, archivo: File) => {
		const fd = new FormData();
		fd.append('archivo', archivo);
		return (
			await llamar<{ data: Tanqueo }>(
				apiClient.post(`/api/combustible/tanqueos/${id}/comprobante`, fd, { timeout: 60_000 }),
				'No se pudo subir el comprobante'
			)
		).data;
	},

	quitarComprobante: async (id: string) =>
		(
			await llamar<{ data: Tanqueo }>(
				apiClient.delete(`/api/combustible/tanqueos/${id}/comprobante`),
				'No se pudo quitar el comprobante'
			)
		).data,

	urlComprobante: async (id: string) =>
		(
			await llamar<{ data: { url: string } }>(
				apiClient.get(`/api/combustible/tanqueos/${id}/comprobante/url`),
				'No se pudo abrir el comprobante'
			)
		).data.url,

	exportar: (f: FiltrosCombustible) =>
		llamar<Blob>(
			apiClient.get('/api/combustible/tanqueos/exportar', {
				params: params({ ...f, pagina: undefined, por_pagina: undefined }),
				responseType: 'blob'
			}),
			'No se pudo exportar'
		)
};

// ── Formato ───────────────────────────────────────────────────────────

const cop = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	maximumFractionDigits: 0
});
export const moneda = (v: number | null | undefined) => (v == null ? '—' : cop.format(v));

export const numero = (v: number | null | undefined, decimales = 0) =>
	v == null
		? '—'
		: v.toLocaleString('es-CO', {
				minimumFractionDigits: decimales,
				maximumFractionDigits: decimales
			});

export const kmGal = (v: number | null | undefined) => (v == null ? '—' : `${numero(v, 1)} km/gal`);

/// Siempre en hora de Colombia: un tanqueo de las 10 p. m. no debe saltar de
/// día porque el navegador esté en otra zona.
const fmtFecha = new Intl.DateTimeFormat('es-CO', {
	timeZone: 'America/Bogota',
	day: '2-digit',
	month: '2-digit',
	year: 'numeric'
});
const fmtHora = new Intl.DateTimeFormat('es-CO', {
	timeZone: 'America/Bogota',
	hour: '2-digit',
	minute: '2-digit',
	hour12: true
});
export const fechaTanqueo = (iso: string) => fmtFecha.format(new Date(iso));
export const horaTanqueo = (iso: string) => fmtHora.format(new Date(iso));

/** Instante → `AAAA-MM-DDTHH:mm` en hora de Colombia, para un `datetime-local`. */
export function aLocalBogota(fecha: Date | string): string {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'America/Bogota',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		})
			.formatToParts(new Date(fecha))
			.map((x) => [x.type, x.value])
	);
	return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Hoy en Colombia, `AAAA-MM-DD`. */
export const hoyBogota = () => aLocalBogota(new Date()).slice(0, 10);
