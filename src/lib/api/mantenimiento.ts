import { apiClient } from './apiClient';

/**
 * Mantenimiento de flota: planes preventivos por vehículo y órdenes de
 * trabajo. Espejo de `backend/src/modules/mantenimiento`.
 *
 * El catálogo de categorías y los umbrales de «próximo» llegan de
 * `/mantenimiento/opciones`: viven solo en el backend, igual que el cálculo
 * del estado de cada plan (aquí solo se pinta).
 */

export type EstadoPlan = 'vencido' | 'proximo' | 'al_dia' | 'sin_datos' | 'pausado';
export type EstadoOrden = 'PROGRAMADO' | 'EN_CURSO' | 'EJECUTADO' | 'CANCELADO';
export type TipoOrden = 'PREVENTIVO' | 'CORRECTIVO';
export type TipoAdjunto = 'FACTURA' | 'FOTO' | 'OTRO';

export interface CategoriaMantenimiento {
	clave: string;
	etiqueta: string;
	sugerenciaKm: number | null;
	sugerenciaMeses: number | null;
}

export interface VehiculoOpcion {
	id: string;
	placa: string;
	marca: string | null;
	linea: string | null;
	kilometraje: number | null;
	estado: string;
}

export interface OpcionesMantenimiento {
	hoy: string;
	categorias: CategoriaMantenimiento[];
	umbrales: { km: number; dias: number };
	vehiculos: VehiculoOpcion[];
}

export interface OrdenAbiertaRef {
	id: string;
	consecutivo: number;
	estado: EstadoOrden;
}

export interface Plan {
	id: string;
	vehiculo: { id: string; placa: string; marca: string | null; linea: string | null };
	categoria: string;
	categoria_etiqueta: string;
	nombre: string;
	periodicidad_km: number | null;
	periodicidad_meses: number | null;
	periodicidad_dias: number | null;
	ultima_ejecucion_fecha: string | null;
	ultima_ejecucion_km: number | null;
	ultimo_evento_id: string | null;
	proxima_fecha: string | null;
	proximo_km: number | null;
	km_actual: number | null;
	activo: boolean;
	observaciones: string | null;
	orden_abierta: OrdenAbiertaRef | null;
	estado: EstadoPlan;
	km_restantes: number | null;
	dias_restantes: number | null;
	motivo: 'km' | 'fecha' | 'ambos' | null;
}

export interface ConteosPlanes {
	vencido: number;
	proximo: number;
	al_dia: number;
	sin_datos: number;
	pausado: number;
	total: number;
}

export interface LineaRepuesto {
	descripcion: string;
	cantidad: number;
	valor_unitario: number;
}

export interface Orden {
	id: string;
	consecutivo: number;
	tipo: TipoOrden;
	estado: EstadoOrden;
	descripcion: string;
	vehiculo: {
		id: string;
		placa: string;
		marca: string | null;
		linea: string | null;
		km_actual: number | null;
	};
	plan: {
		id: string;
		nombre: string;
		categoria: string | null;
		categoria_etiqueta: string;
		eliminado: boolean;
	} | null;
	fecha: string | null;
	km: number | null;
	fecha_ejecucion: string | null;
	km_ejecucion: number | null;
	taller: string | null;
	responsable: string | null;
	numero_factura: string | null;
	repuestos: LineaRepuesto[];
	costo_repuestos: number;
	costo_mano_obra: number;
	costo: number;
	observaciones: string | null;
	motivo_anulacion: string | null;
	iniciado_at: string | null;
	cerrado_at: string | null;
	anulado_at: string | null;
	creado_at: string;
	creado_por: string | null;
	cerrado_por: string | null;
	adjuntos: number;
}

export interface Adjunto {
	id: string;
	tipo: TipoAdjunto;
	nombre: string;
	mimetype: string;
	size: number;
	created_at: string;
}

export interface OrdenDetalle extends Orden {
	adjuntos_detalle: Adjunto[];
}

export interface PlanDetalle extends Plan {
	ordenes: Orden[];
}

export interface ResumenMantenimiento {
	hoy: string;
	planes: ConteosPlanes;
	ordenes: { abiertas: number; programadas: number; en_curso: number };
	costo_mes: { mes: string; total: number; ordenes: number };
}

export interface ListadoPlanes {
	items: Plan[];
	total: number;
	page: number;
	limit: number;
	conteos: ConteosPlanes;
}

export interface ListadoOrdenes {
	items: Orden[];
	total: number;
	page: number;
	limit: number;
	conteos: Record<EstadoOrden, number>;
}

export interface CostosMantenimiento {
	desde: string;
	hasta: string;
	totales: {
		total: number;
		repuestos: number;
		mano_obra: number;
		ordenes: number;
		preventivo: number;
		correctivo: number;
	};
	por_vehiculo: Array<{
		vehiculo_id: string;
		placa: string;
		marca: string | null;
		linea: string | null;
		ordenes: number;
		preventivas: number;
		correctivas: number;
		repuestos: number;
		mano_obra: number;
		total: number;
	}>;
	por_mes: Array<{
		mes: string;
		ordenes: number;
		preventivo: number;
		correctivo: number;
		total: number;
	}>;
}

export interface MantenimientoVehiculo {
	vehiculo: { id: string; placa: string; km_actual: number | null };
	planes: Plan[];
	conteos: ConteosPlanes;
	ordenes: Orden[];
	costos: Record<
		'historico' | 'ultimos_12_meses' | 'anio_actual',
		{ total: number; ordenes: number }
	>;
}

export interface NovedadesPreoperacional {
	id: string;
	formulario: string;
	codigo: string;
	fecha: string;
	enviado_at: string | null;
	conductor: string | null;
	vehiculo: {
		id: string;
		placa: string;
		marca: string | null;
		linea: string | null;
		km_actual: number | null;
	} | null;
	items: Array<{ key: string; label: string; observacion: string | null }>;
}

export interface CrearPlanInput {
	categoria: string;
	nombre: string;
	periodicidad_km: number | null;
	periodicidad_meses: number | null;
	observaciones?: string | null;
	vehiculos: Array<{
		vehiculo_id: string;
		ultima_ejecucion_km: number | null;
		ultima_ejecucion_fecha: string | null;
	}>;
}

export type ActualizarPlanInput = Partial<
	Omit<CrearPlanInput, 'vehiculos'> & {
		ultima_ejecucion_km: number | null;
		ultima_ejecucion_fecha: string | null;
		activo: boolean;
	}
>;

export interface OrdenInput {
	tipo?: TipoOrden;
	plan_id?: string | null;
	vehiculo_id?: string | null;
	descripcion?: string;
	fecha?: string | null;
	km?: number | null;
	taller?: string | null;
	responsable?: string | null;
	numero_factura?: string | null;
	repuestos?: LineaRepuesto[];
	costo_mano_obra?: number | null;
	observaciones?: string | null;
}

/** Con qué abre el formulario de una orden nueva (desde un plan, la ficha o un preoperacional). */
export interface InicialOrden {
	tipo: TipoOrden;
	plan_id?: string | null;
	vehiculo_id?: string | null;
	descripcion?: string;
}

/// Convierte el error de axios en un `Error` con el mensaje del backend: las
/// pantallas solo hacen `toast.error(e.message)`.
async function llamar<T>(promesa: Promise<{ data: { data: T } }>, porDefecto: string): Promise<T> {
	try {
		return (await promesa).data.data;
	} catch (e: any) {
		const data = e?.response?.data;
		throw new Error(
			(typeof data?.message === 'string' && data.message) ||
				(typeof data?.error === 'string' && data.error) ||
				porDefecto
		);
	}
}

const limpio = (p: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'todos')
	);

export const mantenimientoAPI = {
	opciones: () =>
		llamar<OpcionesMantenimiento>(
			apiClient.get('/api/mantenimiento/opciones'),
			'No se pudieron cargar las opciones'
		),
	resumen: () =>
		llamar<ResumenMantenimiento>(
			apiClient.get('/api/mantenimiento/resumen'),
			'No se pudo cargar el resumen'
		),

	planes: (p: {
		q?: string;
		estado?: string;
		categoria?: string;
		vehiculo_id?: string;
		page?: number;
		limit?: number;
	}) =>
		llamar<ListadoPlanes>(
			apiClient.get('/api/mantenimiento/planes', { params: limpio(p) }),
			'No se pudieron cargar los planes'
		),
	plan: (id: string) =>
		llamar<PlanDetalle>(
			apiClient.get(`/api/mantenimiento/planes/${id}`),
			'No se pudo abrir el plan'
		),
	crearPlanes: (input: CrearPlanInput) =>
		llamar<{
			creados: number;
			ids: string[];
			omitidos: Array<{ vehiculo_id: string; placa: string; motivo: string }>;
		}>(apiClient.post('/api/mantenimiento/planes', input), 'No se pudo crear el plan'),
	actualizarPlan: (id: string, input: ActualizarPlanInput) =>
		llamar<PlanDetalle>(
			apiClient.patch(`/api/mantenimiento/planes/${id}`, input),
			'No se pudo guardar el plan'
		),
	eliminarPlan: (id: string) =>
		llamar<unknown>(
			apiClient.delete(`/api/mantenimiento/planes/${id}`).then((r) => ({ data: { data: r.data } })),
			'No se pudo eliminar el plan'
		),

	ordenes: (p: {
		q?: string;
		estado?: string;
		tipo?: string;
		vehiculo_id?: string;
		plan_id?: string;
		desde?: string;
		hasta?: string;
		page?: number;
		limit?: number;
	}) =>
		llamar<ListadoOrdenes>(
			apiClient.get('/api/mantenimiento/ordenes', {
				params: limpio({ ...p, estado: p.estado === 'todas' ? undefined : p.estado })
			}),
			'No se pudieron cargar las órdenes'
		),
	orden: (id: string) =>
		llamar<OrdenDetalle>(
			apiClient.get(`/api/mantenimiento/ordenes/${id}`),
			'No se pudo abrir la orden'
		),
	crearOrden: (input: OrdenInput) =>
		llamar<OrdenDetalle>(
			apiClient.post('/api/mantenimiento/ordenes', input),
			'No se pudo crear la orden'
		),
	actualizarOrden: (id: string, input: OrdenInput) =>
		llamar<OrdenDetalle>(
			apiClient.patch(`/api/mantenimiento/ordenes/${id}`, input),
			'No se pudo guardar la orden'
		),
	cambiarEstado: (
		id: string,
		input: {
			estado: 'EN_CURSO' | 'EJECUTADO' | 'CANCELADO';
			fecha_ejecucion?: string | null;
			km_ejecucion?: number | null;
			motivo?: string | null;
		}
	) =>
		llamar<OrdenDetalle>(
			apiClient.post(`/api/mantenimiento/ordenes/${id}/estado`, input),
			'No se pudo cambiar el estado'
		),
	subirAdjunto: (id: string, tipo: TipoAdjunto, archivo: File) => {
		// El tipo va ANTES del archivo: el backend lee las partes en orden.
		const fd = new FormData();
		fd.append('tipo', tipo);
		fd.append('archivo', archivo);
		return llamar<Adjunto>(
			apiClient.post(`/api/mantenimiento/ordenes/${id}/adjuntos`, fd),
			'No se pudo subir el archivo'
		);
	},
	urlAdjunto: async (id: string, adjuntoId: string) =>
		(
			await llamar<{ url: string }>(
				apiClient.get(`/api/mantenimiento/ordenes/${id}/adjuntos/${adjuntoId}/url`),
				'No se pudo abrir el archivo'
			)
		).url,
	eliminarAdjunto: (id: string, adjuntoId: string) =>
		llamar<unknown>(
			apiClient
				.delete(`/api/mantenimiento/ordenes/${id}/adjuntos/${adjuntoId}`)
				.then((r) => ({ data: { data: r.data } })),
			'No se pudo eliminar el archivo'
		),

	vehiculo: (id: string) =>
		llamar<MantenimientoVehiculo>(
			apiClient.get(`/api/mantenimiento/vehiculos/${id}`),
			'No se pudo cargar el mantenimiento del vehículo'
		),
	costos: (p: { desde?: string; hasta?: string; vehiculo_id?: string }) =>
		llamar<CostosMantenimiento>(
			apiClient.get('/api/mantenimiento/costos', { params: limpio(p) }),
			'No se pudieron calcular los costos'
		),
	preoperacional: (id: string) =>
		llamar<NovedadesPreoperacional>(
			apiClient.get(`/api/mantenimiento/preoperacionales/${id}`),
			'No se pudo abrir el preoperacional'
		)
};

// ── Presentación ────────────────────────────────────────────────────────
/// Semáforos en hex y no en la escala `emerald-*`: cotransmeq la remapea a
/// naranja, y «al día» tiene que seguir viéndose verde allá también.

export const ESTADO_PLAN: Record<EstadoPlan, { etiqueta: string; color: string }> = {
	vencido: { etiqueta: 'Vencido', color: '#dc2626' },
	proximo: { etiqueta: 'Próximo', color: '#d97706' },
	al_dia: { etiqueta: 'Al día', color: '#16a34a' },
	sin_datos: { etiqueta: 'Sin datos', color: '#94a3b8' },
	pausado: { etiqueta: 'Pausado', color: '#64748b' }
};

export const ESTADO_ORDEN: Record<EstadoOrden, { etiqueta: string; color: string }> = {
	PROGRAMADO: { etiqueta: 'Abierta', color: '#2563eb' },
	EN_CURSO: { etiqueta: 'En curso', color: '#7c3aed' },
	EJECUTADO: { etiqueta: 'Cerrada', color: '#16a34a' },
	CANCELADO: { etiqueta: 'Anulada', color: '#94a3b8' }
};

export const TIPO_ORDEN: Record<TipoOrden, string> = {
	PREVENTIVO: 'Preventiva',
	CORRECTIVO: 'Correctiva'
};

export const TIPO_ADJUNTO: Record<TipoAdjunto, string> = {
	FACTURA: 'Factura',
	FOTO: 'Foto',
	OTRO: 'Otro'
};

const cop = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	maximumFractionDigits: 0
});
export const moneda = (v: number | null | undefined) => cop.format(v ?? 0);
export const km = (v: number | null | undefined) =>
	v == null ? '—' : `${v.toLocaleString('es-CO')} km`;

/** `YYYY-MM-DD` → «10 oct 2026». Es una fecha sin hora: se formatea en UTC para no correrla un día. */
export function fecha(iso: string | null | undefined): string {
	if (!iso) return '—';
	return new Intl.DateTimeFormat('es-CO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/** «cada 5.000 km o 3 meses», lo que ocurra primero. */
export function periodicidad(
	p: Pick<Plan, 'periodicidad_km' | 'periodicidad_meses' | 'periodicidad_dias'>
) {
	const partes = [
		p.periodicidad_km ? `${p.periodicidad_km.toLocaleString('es-CO')} km` : null,
		p.periodicidad_meses
			? `${p.periodicidad_meses} ${p.periodicidad_meses === 1 ? 'mes' : 'meses'}`
			: p.periodicidad_dias
				? `${p.periodicidad_dias} días`
				: null
	].filter(Boolean);
	return partes.length ? `cada ${partes.join(' o ')}` : 'sin periodicidad';
}

/** Lo que falta (o lo que se pasó) en palabras, por el eje que manda. */
export function restante(p: Pick<Plan, 'km_restantes' | 'dias_restantes' | 'estado'>): string {
	const partes: string[] = [];
	if (p.km_restantes != null) {
		partes.push(
			p.km_restantes <= 0
				? `${Math.abs(p.km_restantes).toLocaleString('es-CO')} km de más`
				: `faltan ${p.km_restantes.toLocaleString('es-CO')} km`
		);
	}
	if (p.dias_restantes != null) {
		partes.push(
			p.dias_restantes < 0
				? `hace ${Math.abs(p.dias_restantes)} d`
				: p.dias_restantes === 0
					? 'hoy'
					: `en ${p.dias_restantes} d`
		);
	}
	if (p.estado === 'sin_datos') return 'Falta el último km o la fecha';
	return partes.join(' · ') || '—';
}
