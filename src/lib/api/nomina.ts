import { apiClient } from './apiClient';
import type {
	Liquidacion,
	Conductor,
	Vehiculo,
	ConfiguracionLiquidacion,
	Empresa,
	CreateLiquidacionPayload,
	UpdateLiquidacionPayload,
	FirmaDesprendible,
	FirmaConUrl,
	Prima,
	CreatePrimaPayload,
	UpdatePrimaPayload,
	PrimasParams,
	PrimasStats
} from '$lib/types/nomina';
import type { DiaLaboralPlanilla } from '$lib/types/recargos';

/**
 * API Cliente para el módulo de Nómina
 */

// ==================== LIQUIDACIONES ====================

export interface LiquidacionesParams {
	page?: number;
	limit?: number;
	search?: string;
	estado?: string;
	sortBy?: string;
	sortOrder?: string;
	nomina_month?: string;
}

/**
 * Obtener todas las liquidaciones con paginación y filtros
 */
export const obtenerLiquidaciones = async (params?: LiquidacionesParams) => {
	const searchParams = new URLSearchParams();
	if (params?.page) searchParams.set('page', params.page.toString());
	if (params?.limit) searchParams.set('limit', params.limit.toString());
	if (params?.search) searchParams.set('search', params.search);
	if (params?.estado) searchParams.set('estado', params.estado);
	if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
	if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
	if (params?.nomina_month) searchParams.set('nomina_month', params.nomina_month);

	const query = searchParams.toString();
	const url = `/api/liquidaciones${query ? `?${query}` : ''}`;
	const response = await apiClient.get<{
		data: Liquidacion[];
		pagination: {
			total: number;
			page: number;
			limit: number;
			totalPages: number;
			hasNext: boolean;
			hasPrev: boolean;
		};
		stats: {
			totalRegistros: number;
			totalPendientes: number;
			montoTotal: number;
		};
	}>(url);
	return response.data;
};

/**
 * Obtener una liquidación por ID
 */
export const obtenerLiquidacionPorId = async (id: string) => {
	const response = await apiClient.get<{ data: Liquidacion }>(`/api/liquidaciones/${id}`);
	return response.data;
};

/**
 * Obtener un analisis de liquidaciones
 */
export const obtenerAnalisis = async () => {
	const response = await apiClient.get<{ data: Liquidacion }>('/api/liquidaciones/analisis?noLimit=true');
	return response.data;
};
/**
 * Crear nueva liquidación
 */
export const crearLiquidacion = async (payload: CreateLiquidacionPayload) => {
	const response = await apiClient.post<{ success: boolean; data: Liquidacion }>(
		'/api/liquidaciones',
		payload
	);
	return response.data;
};

/**
 * Editar liquidación existente
 */
export const editarLiquidacion = async (id: string, payload: UpdateLiquidacionPayload) => {
	const response = await apiClient.put<{ success: boolean; data: Liquidacion }>(
		`/api/liquidaciones/${id}`,
		payload
	);
	return response.data;
};

/**
 * Eliminar liquidación
 */
export const eliminarLiquidacion = async (id: string) => {
	const response = await apiClient.delete<{ success: boolean; message: string }>(
		`/api/liquidaciones/${id}`
	);
	return response.data;
};

// ==================== CONDUCTORES ====================

/**
 * Obtener todos los conductores (sin límite para selects)
 */
export const obtenerConductores = async () => {
	const response = await apiClient.get<{ data: Conductor[] }>('/api/conductores?limit=9999');
	return response.data;
};

/**
 * Obtener conductor por ID
 */
export const obtenerConductorPorId = async (id: string) => {
	const response = await apiClient.get<{ data: Conductor }>(`/api/conductores/${id}`);
	return response.data;
};

// ==================== VEHÍCULOS ====================

/**
 * Obtener todos los vehículos
 */
export const obtenerVehiculos = async () => {
	const response = await apiClient.get<{ data: Vehiculo[] }>('/api/vehiculos');
	return response.data;
};

/**
 * Obtener vehículo por ID
 */
export const obtenerVehiculoPorId = async (id: string) => {
	const response = await apiClient.get<{ data: Vehiculo }>(`/api/vehiculos/${id}`);
	return response.data;
};

// ==================== EMPRESAS ====================

/**
 * Obtener todas las empresas
 */
export const obtenerEmpresas = async () => {
	const response = await apiClient.get<{ data: Empresa[] }>('/api/empresas');
	return response.data;
};

// ==================== CONFIGURACIÓN ====================

/**
 * Obtener configuraciones de liquidación (filtrar por año opcional)
 */
export const obtenerConfiguraciones = async (anio?: number) => {
	const params = anio ? `?anio=${anio}` : '';
	const response = await apiClient.get<{ data: ConfiguracionLiquidacion[] }>(
		`/api/configuraciones-liquidacion${params}`
	);
	return response.data;
};

/**
 * Obtener años disponibles de configuraciones
 */
export const obtenerAniosConfiguraciones = async () => {
	const response = await apiClient.get<{ data: number[] }>(
		'/api/configuraciones-liquidacion/anios'
	);
	return response.data;
};

/**
 * Actualizar configuración de liquidación
 */
export const actualizarConfiguracion = async (
	id: string,
	payload: { nombre?: string; valor?: number; tipo?: string }
) => {
	const response = await apiClient.put<{ success: boolean; data: ConfiguracionLiquidacion }>(
		`/api/configuraciones-liquidacion/${id}`,
		payload
	);
	return response.data;
};

/**
 * Crear nueva configuración
 */
export const crearConfiguracion = async (payload: {
	nombre: string;
	valor: number;
	tipo: string;
	anio: number;
}) => {
	const response = await apiClient.post<{ success: boolean; data: ConfiguracionLiquidacion }>(
		'/api/configuraciones-liquidacion',
		payload
	);
	return response.data;
};

/**
 * Duplicar configuraciones de un año a otro
 */
export const duplicarConfiguraciones = async (anio_origen: number, anio_destino: number) => {
	const response = await apiClient.post<{
		success: boolean;
		data: ConfiguracionLiquidacion[];
		message: string;
	}>('/api/configuraciones-liquidacion/duplicar', { anio_origen, anio_destino });
	return response.data;
};

/**
 * Eliminar configuración
 */
export const eliminarConfiguracionItem = async (id: string) => {
	const response = await apiClient.delete<{ success: boolean; message: string }>(
		`/api/configuraciones-liquidacion/${id}`
	);
	return response.data;
};

// ==================== DESPRENDIBLES (PDF + EMAIL) ====================

/**
 * Obtener firmas de desprendible por liquidación ID
 */
export const obtenerFirmasPorLiquidacion = async (liquidacionId: string) => {
	const response = await apiClient.get<{ data: FirmaConUrl[] }>(
		`/api/firmas/liquidacion/${liquidacionId}`
	);
	return response.data;
};

/**
 * Preview de desprendibles a enviar (muestra conductores, emails, montos)
 */
export const previewDesprendibles = async (liquidacionIds: string[]) => {
	const response = await apiClient.post<{
		success: boolean;
		data: {
			total: number;
			canSend: number;
			cannotSend: number;
			items: Array<{
				liquidacionId: string;
				conductor: string;
				email: string | null;
				periodo_inicio: string;
				periodo_fin: string;
				sueldo_total: number;
				estado: string;
				canSend: boolean;
			}>;
		};
	}>('/api/liquidaciones/preview-desprendibles', { liquidacionIds });
	return response.data;
};

/**
 * Enviar notificación de desprendibles por email a conductores
 */
export const enviarDesprendibles = async (liquidacionIds: string[]) => {
	const response = await apiClient.post<{
		success: boolean;
		message: string;
		data: {
			enviados: number;
			errores: number;
			total: number;
			resultados: Array<{
				liquidacionId: string;
				conductor: string;
				email?: string;
				status: 'enviado' | 'error';
				message?: string;
			}>;
		};
	}>('/api/liquidaciones/enviar-desprendibles', { liquidacionIds });
	return response.data;
};

// ==================== PRIMAS (PDF + EMAIL) ====================

export interface PrimaPreviewItem {
	primaId: string;
	conductor: string;
	email: string | null;
	mes: number;
	anio: number;
	prima: number;
	prima_pendiente: number | null;
	estado: string;
	canSend: boolean;
}

export interface PrimaPreviewResponse {
	total: number;
	canSend: number;
	cannotSend: number;
	items: PrimaPreviewItem[];
}

export interface PrimaEnvioResultado {
	primaId: string;
	conductor: string;
	email?: string;
	status: 'enviado' | 'error';
	message?: string;
	portalLink?: string;
}

/**
 * Preview de envío de primas por email (muestra conductores, emails, monto)
 * Intenta primero el endpoint real del backend; si no existe (404) cae a un mock local
 * que construye el preview a partir de las primas ya cargadas en el cliente.
 */
export const previewPrimas = async (primaIds: string[]): Promise<PrimaPreviewResponse> => {
	// El backend de Cotransmeq aún no expone /api/primas/preview-envio.
	// Usamos el mock local que arma el preview desde la cache de sessionStorage.
	return buildPrimaPreviewMock(primaIds);
};

/**
 * Enviar notificación de primas por email a conductores.
 * Intenta el endpoint real; si no existe, simula el envío (log + queue localStorage)
 * y devuelve los links al portal con highlight en la prima correspondiente.
 */
export const enviarPrimas = async (
	primaIds: string[]
): Promise<{
	enviados: number;
	errores: number;
	total: number;
	resultados: PrimaEnvioResultado[];
}> => {
	// El backend de Cotransmeq aún no expone /api/primas/enviar.
	// Usamos el mock local que simula el envío (log + queue localStorage).
	return buildPrimaEnvioMock(primaIds);
};

/**
 * Mock local de preview: arma el preview desde la cache de sessionStorage
 * (cacheadas por la pantalla de Primas al hacer `cargarPrimas`).
 */
function buildPrimaPreviewMock(primaIds: string[]): PrimaPreviewResponse {
	const cache = readPrimasCache();
	const items: PrimaPreviewItem[] = primaIds
		.map((id) => cache.get(id))
		.filter(Boolean)
		.map((p) => ({
			primaId: p.id,
			conductor:
				`${p.conductor?.nombre ?? ''} ${p.conductor?.apellido ?? ''}`.trim() || 'Sin conductor',
			email: p.conductor?.email ?? null,
			mes: p.mes,
			anio: p.anio,
			prima: Number(p.prima) || 0,
			prima_pendiente: p.prima_pendiente != null ? Number(p.prima_pendiente) : null,
			estado: p.estado,
			canSend: !!p.conductor?.email
		}));
	return {
		total: items.length,
		canSend: items.filter((i) => i.canSend).length,
		cannotSend: items.filter((i) => !i.canSend).length,
		items
	};
}

/**
 * Mock local de envío: arma links al portal con `?highlight_prima=<prima_id>`,
 * los guarda en localStorage para que el portal del conductor los pueda leer
 * (cuando el conductor abre el link), y devuelve los resultados.
 */
function buildPrimaEnvioMock(primaIds: string[]): {
	enviados: number;
	errores: number;
	total: number;
	resultados: PrimaEnvioResultado[];
} {
	const cache = readPrimasCache();
	const queue = readEmailQueue();
	let enviados = 0;
	let errores = 0;
	const resultados: PrimaEnvioResultado[] = [];

	for (const id of primaIds) {
		const p = cache.get(id);
		if (!p) {
			resultados.push({ primaId: id, conductor: 'N/A', status: 'error', message: 'Prima no encontrada' });
			errores++;
			continue;
		}
		const conductorNombre =
			`${p.conductor?.nombre ?? ''} ${p.conductor?.apellido ?? ''}`.trim() || 'Sin conductor';
		const email = p.conductor?.email ?? null;
		if (!email) {
			resultados.push({
				primaId: id,
				conductor: conductorNombre,
				status: 'error',
				message: 'Conductor sin email registrado'
			});
			errores++;
			continue;
		}

		const token = generateMockPortalToken(p.conductor_id ?? '', id);
		const portalLink = `${window.location.origin}/public/portal?token=${encodeURIComponent(token)}&highlight_prima=${id}`;

		queue.push({
			id: cryptoRandomId(),
			tipo: 'prima',
			createdAt: new Date().toISOString(),
			to: email,
			conductorNombre,
			mes: p.mes,
			anio: p.anio,
			prima: Number(p.prima) || 0,
			prima_pendiente: p.prima_pendiente != null ? Number(p.prima_pendiente) : null,
			conductorId: p.conductor_id,
			primaId: id,
			portalLink,
			subject: `💰 Tu Liquidación de Prima — ${mesNombre(p.mes)} ${p.anio}`,
			consumed: false
		});
		enviados++;
		resultados.push({
			primaId: id,
			conductor: conductorNombre,
			email,
			status: 'enviado',
			portalLink
		});

		console.info('[PrimaEmailMock] ✉️ Email enviado:', {
			to: email,
			subject: `💰 Tu Liquidación de Prima — ${mesNombre(p.mes)} ${p.anio}`,
			portalLink
		});
	}
	writeEmailQueue(queue);
	return { enviados, errores, total: primaIds.length, resultados };
}

function readPrimasCache(): Map<string, any> {
	try {
		const raw = sessionStorage.getItem('primas_cache');
		const arr: any[] = raw ? JSON.parse(raw) : [];
		return new Map(arr.map((p) => [p.id, p]));
	} catch {
		return new Map();
	}
}

const EMAIL_QUEUE_KEY = 'prima_email_queue_mock';
function readEmailQueue(): any[] {
	try {
		const raw = localStorage.getItem(EMAIL_QUEUE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}
function writeEmailQueue(q: any[]) {
	try {
		localStorage.setItem(EMAIL_QUEUE_KEY, JSON.stringify(q));
	} catch {
		/* ignore */
	}
}

function generateMockPortalToken(conductorId: string, primaId: string): string {
	const payload = btoa(
		JSON.stringify({
			sub: conductorId,
			prima: primaId,
			tipo: 'conductor_portal',
			mock: true,
			ts: Date.now()
		})
	);
	return `mock.${payload}.${cryptoRandomId()}`;
}

function cryptoRandomId(): string {
	return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function mesNombre(m: number): string {
	const nombres = [
		'',
		'Enero',
		'Febrero',
		'Marzo',
		'Abril',
		'Mayo',
		'Junio',
		'Julio',
		'Agosto',
		'Septiembre',
		'Octubre',
		'Noviembre',
		'Diciembre'
	];
	return nombres[m] || '';
}

/**
 * Toggle visibilidad de una prima en el portal del conductor (futuro endpoint real).
 * Por ahora persiste en localStorage para que el portal la pueda leer.
 */
export const togglePrimaPortalVisible = async (
	primaIds: string[],
	visible: boolean
): Promise<{ updated: number; visible: boolean }> => {
	// El backend de Cotransmeq aún no expone /api/primas/portal-visible.
	// Persistimos en sessionStorage para que el portal la pueda leer.
	try {
		const raw = sessionStorage.getItem('primas_portal_visibility') || '{}';
		const map: Record<string, boolean> = JSON.parse(raw);
		primaIds.forEach((id) => (map[id] = visible));
		sessionStorage.setItem('primas_portal_visibility', JSON.stringify(map));
	} catch {
		/* ignore */
	}
	return { updated: primaIds.length, visible };
};

/**
 * Toggle visibilidad de desprendibles en el portal del conductor
 */
export const toggleDesprendibleVisible = async (liquidacionIds: string[], visible: boolean) => {
	const response = await apiClient.patch<{
		success: boolean;
		message: string;
		data: { count: number; visible: boolean };
	}>('/api/liquidaciones/desprendible-visible', { liquidacionIds, visible });
	return response.data;
};

/**
 * Toggle visibilidad de tablas en el desprendibles
 */
export const toggleDesprendibleTablasVisible = async (liquidacionIds: string[], visible: boolean) => {
	const response = await apiClient.patch<{
		success: boolean;
		message: string;
		data: { count: number; visible: boolean };
	}>('/api/liquidaciones/desprendible-tablas-visible', { liquidacionIds, visible });
	return response.data;
};

// ==================== PREVIEW RECARGOS ====================

export interface PreviewRecargoDia {
	dia: number;
	fecha: string;
	nombre_dia: string;
	tipo_dia: string;
	es_festivo: boolean;
	es_domingo: boolean;
	disponibilidad: boolean;
	hora_inicio: number;
	hora_fin: number;
	total_horas: number;
	recargos: Array<{
		tipo_codigo: string;
		tipo_nombre: string;
		es_hora_extra: boolean;
		adicional: boolean;
		porcentaje: number;
		horas: number;
		valor_hora_base: number;
		valor_hora_calculada: number;
		valor_total: number;
	}>;
	total_valor_dia: number;
}

export interface PreviewRecargoPlanilla {
	planilla_id: string;
	numero_planilla: string | null;
	vehiculo: { id: string; placa: string; marca: string; modelo: string };
	empresa: { id: string; nombre: string };
	mes: number;
	año: number;
	total_dias: number;
	total_horas: number;
	total_valor: number;
	total_festivos: number;
	dias: PreviewRecargoDia[];
	configuracion_salarial: {
		id: string;
		salario_basico: number;
		valor_hora_trabajador: number;
		horas_mensuales_base: number;
		paga_dias_festivos: boolean;
		porcentaje_festivos: number;
	} | null;
}

export interface PreviewRecargosResponse {
	conductor_id: string;
	periodo: { inicio: string; fin: string };
	configuracion_salarial: {
		id: string;
		salario_basico: number;
		valor_hora_trabajador: number;
		horas_mensuales_base: number;
		sede: string | null;
		paga_dias_festivos: boolean;
		porcentaje_festivos: number;
	} | null;
	configuracion_salarial_base: {
		id: string;
		salario_basico: number;
		valor_hora_trabajador: number;
		horas_mensuales_base: number;
		paga_dias_festivos: boolean;
		porcentaje_festivos: number;
	} | null;
	resumen: {
		total_planillas: number;
		total_dias_trabajados: number;
		total_horas_trabajadas: number;
		total_recargos: number;
		total_festivos: number;
		total_general: number;
	};
	resumen_tipos: Array<{
		codigo: string;
		nombre: string;
		porcentaje: number;
		es_hora_extra: boolean;
		adicional: boolean;
		totalHoras: number;
		valorHoraBase: number;
		valorTotal: number;
	}>;
	planillas: PreviewRecargoPlanilla[];
}

export function agruparPorMesVehiculoEmpresa(data: any[]) {
  const map = new Map();

  for (const item of data) {
    const key = [
      item.año,
      item.mes,
      item.vehiculo.id,
      item.empresa.id
    ].join("_");

    if (!map.has(key)) {
      map.set(key, {
        ...item, // base

        // reiniciamos acumuladores
        total_dias: 0,
        total_horas: 0,
        total_valor: 0,
        total_festivos: 0,

        // importante: aquí sí unificas días
        dias: []
      });
    }

    const acc = map.get(key);

    acc.total_dias += item.total_dias || 0;
    acc.total_horas += item.total_horas || 0;
    acc.total_valor += item.total_valor || 0;
    acc.total_festivos += item.total_festivos || 0;

    // 🔥 aquí está la clave: unificas días, no planillas
    acc.dias.push(...(item.dias || []));
	acc.dias.sort((a: DiaLaboralPlanilla, b: DiaLaboralPlanilla) => a.dia - b.dia);
  }

  return Array.from(map.values());
}

/**
 * Obtener preview de recargos para un conductor en un período
 */
export const obtenerPreviewRecargos = async (
	conductor_id: string,
	periodo_inicio: string,
	periodo_fin: string
): Promise<{ success: boolean; data: PreviewRecargosResponse }> => {
	const params = new URLSearchParams({
		conductor_id,
		periodo_inicio,
		periodo_fin
	});
	const response = await apiClient.get<{ success: boolean; data: PreviewRecargosResponse }>(
		`/api/liquidaciones/preview-recargos?${params.toString()}`
	);
	return response.data;
};

// ============================================================
// PRIMAS
// ============================================================

export async function obtenerPrimas(params: PrimasParams = {}) {
	const query: Record<string, string> = {};
	if (params.page) query.page = String(params.page);
	if (params.limit) query.limit = String(params.limit);
	if (params.search) query.search = params.search;
	if (params.mes) query.mes = String(params.mes);
	if (params.anio) query.anio = String(params.anio);
	if (params.estado) query.estado = params.estado;
	if (params.sortBy) query.sortBy = params.sortBy;
	if (params.sortOrder) query.sortOrder = params.sortOrder;
	return apiClient.get('/api/primas', { params: query });
}

export async function obtenerPrimaPorId(id: string) {
	return apiClient.get(`/api/primas/${id}`);
}

export async function crearPrima(payload: CreatePrimaPayload) {
	return apiClient.post('/api/primas', payload);
}

export async function editarPrima(id: string, payload: UpdatePrimaPayload) {
	return apiClient.put(`/api/primas/${id}`, payload);
}

export async function eliminarPrima(id: string) {
	return apiClient.delete(`/api/primas/${id}`);
}

export async function buscarPrimaPorConductorPeriodo(
	conductor_id: string,
	mes: number,
	anio: number
) {
	return apiClient.get('/api/primas/buscar', {
		params: { conductor_id, mes: String(mes), anio: String(anio) }
	});
}

export default {
	// Liquidaciones
	obtenerLiquidaciones,
	obtenerLiquidacionPorId,
	crearLiquidacion,
	editarLiquidacion,
	eliminarLiquidacion,

	// Conductores
	obtenerConductores,
	obtenerConductorPorId,

	// Vehículos
	obtenerVehiculos,
	obtenerVehiculoPorId,

	// Empresas
	obtenerEmpresas,

	// Configuración
	obtenerConfiguraciones,
	obtenerAniosConfiguraciones,
	actualizarConfiguracion,
	crearConfiguracion,
	duplicarConfiguraciones,
	eliminarConfiguracionItem,

	agruparPorMesVehiculoEmpresa,

	// Desprendibles
	previewDesprendibles,
	enviarDesprendibles,
	toggleDesprendibleVisible,

	// Firmas
	obtenerFirmasPorLiquidacion,

	// Preview Recargos
	obtenerPreviewRecargos,

	// Primas - Envío / Portal
	previewPrimas,
	enviarPrimas,
	togglePrimaPortalVisible
};
