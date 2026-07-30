// src/lib/api/recargos.ts

import { apiClient } from './apiClient';
import type {
	RecargoPlanilla,
	RecargoPlanillaFiltros,
	RecargoPlanillaResponse,
	CrearRecargoPlanillaDTO,
	ActualizarRecargoPlanillaDTO,
	HistorialRecargo,
	TipoRecargo,
	ConfiguracionSalario,
	CrearConfiguracionSalarioDTO,
	ActualizarConfiguracionSalarioDTO,
	EmpresaDisponible,
	CanvasRecargo
} from '$lib/types/recargos';

const BASE_URL = '/api/recargos';

export const recargosApi = {
	/**
	 * Obtener recargos para canvas con filtros.
	 * Acepta un AbortSignal opcional para cancelar la petición cuando el usuario
	 * cambia de mes/año rápidamente (la página debouncea + aborta el request anterior).
	 */
	async obtenerParaCanvas(
		filtros: RecargoPlanillaFiltros,
		options?: { signal?: AbortSignal }
	): Promise<{ data: CanvasRecargo[]; pagination: any; meta: { total_valor_pagar: number } }> {
		const params = new URLSearchParams();

		if (filtros.conductor_id) params.append('conductor_id', filtros.conductor_id);
		if (filtros.vehiculo_id) params.append('vehiculo_id', filtros.vehiculo_id);
		if (filtros.empresa_id) params.append('empresa_id', filtros.empresa_id);
		if (filtros.mes) params.append('mes', filtros.mes.toString());
		if (filtros.año) params.append('ano', filtros.año.toString()); // Usar 'ano' sin ñ
		if (filtros.estado) params.append('estado', filtros.estado);
		if (filtros.numero_planilla) params.append('numero_planilla', filtros.numero_planilla);
		if (filtros.imported_from_transmeralda) params.append('imported_from_transmeralda', filtros.imported_from_transmeralda);
		if (filtros.page) params.append('page', filtros.page.toString());
		if (filtros.limit) params.append('limit', filtros.limit.toString());
		if (filtros.eliminados) params.append('eliminados', filtros.eliminados.toString());

		const response = await apiClient.get<{
			data: CanvasRecargo[];
			pagination: any;
			meta: { total_valor_pagar: number };
		}>(`${BASE_URL}?${params.toString()}`, { signal: options?.signal });
		return response.data;
	},

	/**
	 * Devuelve el siguiente número de planilla libre (TM-XXXX).
	 * Endpoint ligero: NO trae recargos, solo el campo numero_planilla.
	 * Se usa en ModalFormRecargo para auto-generar el número al abrir
	 * un nuevo recargo. El backend lo calcula leyendo solo numero_planilla
	 * (sin joins), así que retorna en ms aunque haya miles de planillas.
	 */
	async obtenerSiguienteNumeroPlanilla(): Promise<string> {
		const response = await apiClient.get<{
			success: boolean;
			data: { numero_planilla: string };
		}>(`${BASE_URL}/next-numero-planilla`);
		return response.data.data.numero_planilla;
	},

	/**
	 * Obtener un recargo por ID con todas sus relaciones
	 */
	async obtenerPorId(id: string): Promise<RecargoPlanilla> {
		const response = await apiClient.get<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}`);
		return response.data.data;
	},

	/**
	 * Crear nuevo recargo
	 *
	 * Devuelve `{ recargo, valor_pagar }`. `valor_pagar` viene calculado
	 * por el backend (suma de `valor_calculado` de `detalles_recargos_dias`)
	 * y se inyecta directo en el mapa `valoresPagarByRecargo` del canvas
	 * para que la columna "Valor a Pagar" muestre el valor al instante,
	 * sin esperar al socket ni al endpoint de preview.
	 */
	async crear(
		data: CrearRecargoPlanillaDTO
	): Promise<{ recargo: RecargoPlanilla; valor_pagar: number }> {
		// Enviar como JSON, no como FormData
		const response = await apiClient.post<{
			data: RecargoPlanilla;
			valor_pagar: number;
		}>(BASE_URL, data);
		return {
			recargo: response.data.data,
			valor_pagar: Number(response.data.valor_pagar) || 0
		};
	},

	/**
	 * Actualizar recargo existente
	 *
	 * Devuelve `{ recargo, valor_pagar }`. Ver `crear()` para la razón
	 * de devolver `valor_pagar` acá también.
	 */
	async actualizar(
		id: string,
		data: ActualizarRecargoPlanillaDTO
	): Promise<{ recargo: RecargoPlanilla; valor_pagar: number }> {
		const response = await apiClient.put<{
			data: RecargoPlanilla;
			valor_pagar: number;
		}>(`${BASE_URL}/${id}`, data);
		return {
			recargo: response.data.data,
			valor_pagar: Number(response.data.valor_pagar) || 0
		};
	},

	/**
	 * Eliminar recargo (soft delete)
	 */
	async eliminar(id: string): Promise<void> {
		await apiClient.delete(`${BASE_URL}/${id}`);
	},

	/**
	 * Eliminar múltiples recargos (soft delete)
	 */
	async eliminarMultiple(ids: string[]): Promise<{ eliminados: number }> {
		const response = await apiClient.post<{ data: { eliminados: number } }>(
			`${BASE_URL}/eliminar-multiple`,
			{ ids }
		);
		return response.data.data;
	},

	/**
	 * Restaurar recargo (soft delete)
	 */
	async restaurar(id: string): Promise<void> {
		await apiClient.patch(`${BASE_URL}/restaurar/${id}`);
	},

	/**
	 * Restaurar múltiples recargos (soft delete)
	 */
	async restaurarMultiple(ids: string[]): Promise<{ eliminados: number }> {
		const response = await apiClient.post<{ data: { eliminados: number } }>(
			`${BASE_URL}/restaurar-multiple`,
			{ ids }
		);
		return response.data.data;
	},

	/**
	 * Cambiar estado de múltiples recargos
	 */
	async cambiarEstadoMultiple(
		ids: string[],
		estado: string
	): Promise<{ actualizados: number; estado: string }> {
		const response = await apiClient.patch<{ data: { actualizados: number; estado: string } }>(
			`${BASE_URL}/cambiar-estado-multiple`,
			{ ids, estado }
		);
		return response.data.data;
	},

	/**
	 * Liquidar recargo (cambiar estado a liquidada)
	 */
	async liquidar(id: string): Promise<RecargoPlanilla> {
		const response = await apiClient.post<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}/liquidar`);
		return response.data.data;
	},

	/**
	 * Obtener historial de cambios de un recargo
	 */
	async obtenerHistorial(id: string): Promise<HistorialRecargo[]> {
		const response = await apiClient.get<{ data: HistorialRecargo[] }>(
			`${BASE_URL}/${id}/historial`
		);
		return response.data.data;
	},

	/**
	 * Obtener tipos de recargo activos
	 */
	async obtenerTiposRecargo(): Promise<TipoRecargo[]> {
		const response = await apiClient.get<{ data: TipoRecargo[] }>('/tipos-recargo');
		return response.data.data;
	},

	/**
	 * Obtener configuración salarial de una empresa
	 */
	async obtenerConfigSalario(empresaId: string): Promise<ConfiguracionSalario> {
		const response = await apiClient.get<{ data: ConfiguracionSalario }>(
			`/configuracion-salario/empresa/${empresaId}`
		);
		return response.data.data;
	},

	// ═══════════════════════════════════════════════════════════
	// CONFIGURACIONES SALARIOS — CRUD
	// ═══════════════════════════════════════════════════════════

	/**
	 * Listar configuraciones de salarios con filtros opcionales
	 */
	async obtenerConfiguracionesSalarios(filtros?: {
		activo?: boolean;
		empresa_id?: string;
	}): Promise<ConfiguracionSalario[]> {
		const params = new URLSearchParams();
		if (filtros?.activo !== undefined) params.append('activo', String(filtros.activo));
		if (filtros?.empresa_id) params.append('empresa_id', filtros.empresa_id);
		const query = params.toString() ? `?${params.toString()}` : '';
		const response = await apiClient.get<{ data: ConfiguracionSalario[] }>(
			`${BASE_URL}/configuraciones-salarios${query}`
		);
		return response.data.data;
	},

	/**
	 * Obtener una configuración de salario por ID
	 */
	async obtenerConfiguracionSalario(id: string): Promise<ConfiguracionSalario> {
		const response = await apiClient.get<{ data: ConfiguracionSalario }>(
			`${BASE_URL}/configuraciones-salarios/${id}`
		);
		return response.data.data;
	},

	/**
	 * Crear nueva configuración de salario
	 */
	async crearConfiguracionSalario(
		data: CrearConfiguracionSalarioDTO
	): Promise<ConfiguracionSalario> {
		const response = await apiClient.post<{ data: ConfiguracionSalario }>(
			`${BASE_URL}/configuraciones-salarios`,
			data
		);
		return response.data.data;
	},

	/**
	 * Actualizar configuración de salario existente
	 */
	async actualizarConfiguracionSalario(
		id: string,
		data: ActualizarConfiguracionSalarioDTO
	): Promise<ConfiguracionSalario> {
		const response = await apiClient.put<{ data: ConfiguracionSalario }>(
			`${BASE_URL}/configuraciones-salarios/${id}`,
			data
		);
		return response.data.data;
	},

	/**
	 * Eliminar configuración de salario (soft delete)
	 */
	async eliminarConfiguracionSalario(id: string): Promise<void> {
		await apiClient.delete(`${BASE_URL}/configuraciones-salarios/${id}`);
	},

	/**
	 * Obtener empresas disponibles para selects
	 */
	async obtenerEmpresasDisponibles(): Promise<EmpresaDisponible[]> {
		const response = await apiClient.get<{ data: EmpresaDisponible[] }>(
			`${BASE_URL}/empresas-disponibles`
		);
		return response.data.data;
	},

	/**
	 * Descargar archivo de planilla
	 */
	async descargarPlanilla(id: string): Promise<Blob> {
		const response = await apiClient.get(`${BASE_URL}/${id}/descargar-planilla`, {
			responseType: 'blob'
		});
		return response.data;
	},

	/**
	 * Duplicar recargo (crear copia)
	 */
	async duplicar(id: string): Promise<RecargoPlanilla> {
		const response = await apiClient.post<{ data: RecargoPlanilla }>(`${BASE_URL}/${id}/duplicar`);
		return response.data.data;
	},

	/**
	 * Recalcular un recargo existente con la config salarial y % de tipos
	 * vigentes en cada día (por día, no un solo config para todo el planilla).
	 * Devuelve el recargo actualizado.
	 */
	async recalcular(
		id: string
	): Promise<{ recargo: RecargoPlanilla; valor_pagar: number }> {
		const response = await apiClient.post<{
			data: RecargoPlanilla;
			valor_pagar: number;
		}>(`${BASE_URL}/${id}/recalcular`);
		return {
			recargo: response.data.data,
			valor_pagar: Number(response.data.valor_pagar) || 0
		};
	},

	/**
	 * Lanza un recálculo bulk de N planillas en background.
	 *
	 * Retorna inmediatamente con `{ batchId, total }`. El cliente debe
	 * escuchar los eventos `recargos-bulk-recalc:progress` y
	 * `recargos-bulk-recalc:done` en el room del usuario (que el server
	 * emite con `io.to(\`user-${userId}\`)`).
	 *
	 * El `batchId` debe persistirse en `localStorage` para que, si el
	 * usuario recarga la página, pueda llamar a `obtenerEstadoBatchBulk`
	 * y reanudar la UI de progreso.
	 */
	async recalcularBulk(ids: string[]): Promise<{ batchId: string; total: number }> {
		const response = await apiClient.post<{
			success: boolean;
			message: string;
			batchId: string;
			total: number;
		}>(`${BASE_URL}/recalcular-bulk`, { ids });
		return {
			batchId: response.data.batchId,
			total: Number(response.data.total) || 0
		};
	},

	/**
	 * Estado actual de un batch bulk. Lo usa el cliente al recargar la
	 * página para reanudar la UI. Retorna `null` si el batch no existe
	 * (purga de 1h) o pertenece a otro usuario (404 filtrado).
	 */
	async obtenerEstadoBatchBulk(batchId: string): Promise<{
		batchId: string;
		status: 'pending' | 'running' | 'completed' | 'failed';
		processed: number;
		total: number;
		okCount: number;
		errCount: number;
		results: Array<{ id: string; ok: boolean; valor_pagar?: number; error?: string }>;
		startedAt: string;
		completedAt?: string;
	} | null> {
		try {
			const response = await apiClient.get<{
				success: boolean;
				data: any;
			}>(`${BASE_URL}/recalcular-bulk/${batchId}`);
			return response.data.data;
		} catch (err: any) {
			// 404 (purga de 1h o reinicio del server) → devolvemos null
			// para que el cliente limpie su localStorage.
			if (err?.response?.status === 404) return null;
			throw err;
		}
	},

	/**
	 * Obtener estadísticas/resumen
	 */
	async obtenerEstadisticas(filtros: {
		mes?: number;
		año?: number;
		empresa_id?: string;
	}): Promise<any> {
		const params = new URLSearchParams();
		if (filtros.mes) params.append('mes', filtros.mes.toString());
		if (filtros.año) params.append('año', filtros.año.toString());
		if (filtros.empresa_id) params.append('empresa_id', filtros.empresa_id);

		const response = await apiClient.get<{ data: any }>(`${BASE_URL}/stats/resumen?${params}`);
		return response.data.data;
	},
	/**
	 * Obtiene el preview de cálculo monetario de recargos para un conductor
	 * en el período del mes/año del recargo.
	 *
	 * Replica la lógica del endpoint `GET /api/liquidaciones/preview-recargos`:
	 *   - Usa el período completo del mes (del 1 al último día)
	 *   - Devuelve el desglose por planilla, día y tipo de recargo
	 *
	 * Se usa desde el canvas de recargos para calcular el "valor a pagar"
	 * por recargo individual y desde el modal de visualización para mostrar
	 * el desglose por día.
	 */
	async obtenerPreviewValorRecargo(
		conductor_id: string,
		mes: number,
		año: number,
		options?: { signal?: AbortSignal }
	): Promise<{
		planillas: Array<{
			planilla_id: string;
			total_valor: number;
			dias: Array<{
				dia: number;
				fecha: string;
				es_festivo: boolean;
				es_domingo: boolean;
				disponibilidad: boolean;
				total_horas: number;
				total_valor_dia: number;
			}>;
		}>;
		resumen: {
			total_recargos: number;
			total_general: number;
		};
	} | null> {
		if (!conductor_id || !mes || !año) return null;

		// Período: del primer día al último día del mes del recargo
		const inicio = `${año}-${String(mes).padStart(2, '0')}-01`;
		const lastDay = new Date(año, mes, 0).getDate();
		const fin = `${año}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

		const params = new URLSearchParams({
			conductor_id,
			periodo_inicio: inicio,
			periodo_fin: fin
		});

		const response = await apiClient.get<{
			success: boolean;
			data: {
				planillas: Array<{
					planilla_id: string;
					total_valor: number;
					dias: Array<{
						dia: number;
						fecha: string;
						es_festivo: boolean;
						es_domingo: boolean;
						disponibilidad: boolean;
						total_horas: number;
						total_valor_dia: number;
					}>;
				}>;
				resumen: {
					total_recargos: number;
					total_general: number;
				};
			};
		}>(`/api/liquidaciones/preview-recargos?${params.toString()}`, { signal: options?.signal });

		return response.data.data;
	},

	/**
	 * Reporte mensual
	 */
	async reportePdf(mes: number, año: number): Promise<void> {
		const params = new URLSearchParams();
		params.append('mes', mes.toString());
		params.append('anio', año.toString());

		const response = await apiClient.get(`${BASE_URL}/reporte?${params}`, {
			responseType: 'blob' // ← le dice a Axios que la respuesta es binario
		});

		// Crear URL temporal y disparar descarga
		const blob = new Blob([response.data], { type: 'application/pdf' });
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement('a');

		link.href = url;
		link.download = `Reporte_Servicios_${mes}_${año}.pdf`;
		link.click();

		// Limpiar memoria
		window.URL.revokeObjectURL(url);
	},

	// ═══════════════════════════════════════════════════════════
	// VIGENCIAS — Para wizard del ModalFormRecargo
	// ═══════════════════════════════════════════════════════════

	/**
	 * Tipos de recargo vigentes en una fecha o rango de fechas.
	 * Devuelve TODAS las versiones de cada código que aplican en el rango.
	 * Usado por el ModalFormRecargo para mostrar el timeline de cambios de %.
	 */
	async obtenerTiposRecargoVigentes(params: {
		fecha?: string;
		fecha_desde?: string;
		fecha_hasta?: string;
	}): Promise<TipoRecargo[]> {
		const search = new URLSearchParams();
		if (params.fecha) search.append('fecha', params.fecha);
		if (params.fecha_desde) search.append('fecha_desde', params.fecha_desde);
		if (params.fecha_hasta) search.append('fecha_hasta', params.fecha_hasta);
		const query = search.toString() ? `?${search.toString()}` : '';
		const response = await apiClient.get<{ data: TipoRecargo[] }>(
			`${BASE_URL}/tipos-recargo/vigentes${query}`
		);
		return response.data.data;
	},

	/**
	 * Configuración salarial vigente para una empresa y fecha concretas.
	 */
	async obtenerConfigSalarioVigente(params: {
		empresa_id?: string;
		fecha: string;
	}): Promise<ConfiguracionSalario | null> {
		const search = new URLSearchParams();
		if (params.empresa_id) search.append('empresa_id', params.empresa_id);
		search.append('fecha', params.fecha);
		const response = await apiClient.get<{ data: ConfiguracionSalario | null }>(
			`${BASE_URL}/configuraciones-salarios/vigentes?${search.toString()}`
		);
		return response.data.data;
	},

	/**
	 * Configs salariales que aplican en un rango (para el wizard).
	 * Devuelve TODAS las configs vigentes en al menos un día del rango.
	 */
	async obtenerConfigsSalariosEnRango(params: {
		empresa_id?: string;
		fecha_desde: string;
		fecha_hasta: string;
	}): Promise<ConfiguracionSalario[]> {
		// Por simplicidad, hacemos N queries (uno por día) y deduplicamos.
		// Alternativa: nuevo endpoint /en-rango en backend.
		const inicio = new Date(params.fecha_desde + 'T00:00:00Z');
		const fin = new Date(params.fecha_hasta + 'T00:00:00Z');
		const days: string[] = [];
		const cur = new Date(inicio);
		while (cur <= fin) {
			days.push(cur.toISOString().split('T')[0]);
			cur.setUTCDate(cur.getUTCDate() + 1);
		}
		// Limitamos a máx 7 días para no saturar; si pasa, muestreamos
		const muestreo =
			days.length <= 7 ? days : [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]];
		const results = await Promise.all(
			muestreo.map((d) =>
				this.obtenerConfigSalarioVigente({ empresa_id: params.empresa_id, fecha: d })
			)
		);
		const uniq = new Map<string, ConfiguracionSalario>();
		for (const c of results) {
			if (c && c.id) uniq.set(c.id, c);
		}
		return Array.from(uniq.values());
	},

	// ═══════════════════════════════════════════════════════════
	// IMPORTAR DESDE TRANSMERALDA
	// ═══════════════════════════════════════════════════════════

	/**
	 * Sincroniza en Transmeralda la marca de "conductor Cotransmeq":
	 * pone inactivos a los conductores sin liquidaciones en 2026.
	 * Idempotente. Se recomienda llamar UNA VEZ antes del primer preview.
	 */
	async sincronizarConductoresCotransmeqTransmeralda(): Promise<{
		year: number;
		conductores_con_liquidaciones_2026: number;
		activos_antes: number;
		activos_despues: number;
		marcados_inactivos: number;
		reactivados: number;
	}> {
		const response = await apiClient.post<{
			success: boolean;
			data: any;
		}>(`${BASE_URL}/importar-desde-transmeralda/sincronizar-conductores-cotransmeq`);
		return response.data.data;
	},

	/**
	 * Devuelve el preview de TODAS las planillas de Transmeralda del mes/año.
	 * Marca:
	 *   - ya_importado: ya está en Cotransmeq → tachada, no se reimporta
	 *   - motivo_no_importable: solo si el conductor no existe en CM
	 *   - vehiculo_no_existe_en_destino: se crea al importar
	 *   - empresa_no_existe_en_destino: se crea al importar
	 */
	async previewImportarTransmeralda(
		mes: number,
		año: number,
		incluirNoImportables: boolean = false
	): Promise<{
		mes: number;
		año: number;
		total: number;
		importables: number;
		ya_importadas: number;
		no_importables: number;
		/** Cuántas se quedaron fuera por conductor inactivo en CM */
		filtradas_por_conductor_inactivo: number;
		vehiculos_a_crear: number;
		empresas_a_crear: number;
		incluir_no_importables: boolean;
		planillas: Array<{
			source_id: string;
			conductor_nombre: string;
			conductor_identificacion: string;
			empresa_nombre: string;
			vehiculo_placa: string;
			/** Numero de planilla ORIGINAL de TM (puede ser "7176" o "TM-7176") */
			numero_planilla_original: string;
			/** Numero de planilla NORMALIZADO (siempre con TM- si era dígito puro) */
			numero_planilla_normalizado: string;
			/** Alias de `numero_planilla_normalizado` */
			numero_planilla: string;
			mes: number;
			año: number;
			dias_count: number;
			/** Lista de días laborados en orden ascendente. Ej: [1, 2, 3, 5, 6, 7] */
			dias_lista: number[];
			/** Mismos días pero compactados como rangos: "1-3, 5-7" */
			dias_rangos: string;
			ya_importado: boolean;
			conductor_existe_en_destino: boolean;
			/**
			 * El conductor en Cotransmeq está en un estado "califica
			 * para import": existe y su `estado` NO es `inactivo`.
			 * Cualquier otro enum (activo, disponible, servicio,
			 * programado, descanso, suspendido, retirado) cuenta.
			 */
			conductor_activo_en_destino: boolean;
			conductor_activo_en_origen: boolean;
			vehiculo_no_existe_en_destino: boolean;
			empresa_no_existe_en_destino: boolean;
			motivo_no_importable: string | null;
			imported_id: string | null;
		}>;
	}> {
		const response = await apiClient.post<{
			success: boolean;
			data: any;
		}>(`${BASE_URL}/importar-desde-transmeralda/preview`, {
			mes,
			año,
			incluir_no_importables: incluirNoImportables
		});
		return response.data.data;
	},

	/**
	 * Crea en Cotransmeq las placas y empresas que faltan (las que el
	 * preview marca como "a crear"). NO importa planillas.
	 */
	async crearEntidadesFaltantesTransmeralda(
		mes: number,
		año: number
	): Promise<{
		vehiculos_creados: number;
		empresas_creadas: number;
		errores: Array<{ tipo: 'vehiculo' | 'empresa'; origen_id: string; error: string }>;
	}> {
		const response = await apiClient.post<{
			success: boolean;
			data: any;
		}>(`${BASE_URL}/importar-desde-transmeralda/crear-entidades-faltantes`, { mes, año });
		return response.data.data;
	},

	/**
	 * Ejecuta la importación de las planillas seleccionadas (por source_id)
	 * a Cotransmeq. Auto-crea las placas y empresas faltantes. Devuelve
	 * cuántas se importaron, omitieron, fallaron y cuántas entidades se
	 * crearon.
	 */
	async importarDesdeTransmeralda(sourceIds: string[]): Promise<{
		solicitadas: number;
		importadas: number;
		omitidas: number;
		errores: number;
		vehiculos_creados: number;
		empresas_creadas: number;
		detalle: {
			importadas: Array<{ source_id: string; new_id: string; numero_planilla: string }>;
			omitidas: Array<{ source_id: string; motivo: string }>;
			errores: Array<{ source_id: string; error: string }>;
		};
	}> {
		const response = await apiClient.post<{
			success: boolean;
			message: string;
			data: any;
		}>(`${BASE_URL}/importar-desde-transmeralda`, { source_ids: sourceIds });
		return response.data.data;
	}
};
