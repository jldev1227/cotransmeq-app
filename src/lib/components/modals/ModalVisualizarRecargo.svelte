<script lang="ts">
	import { onMount } from 'svelte';
	import { recargosApi } from '$lib/api/recargos';
	import { apiClient } from '$lib/api/apiClient';
	import type { RecargoDetallado } from '$lib/types/recargos';
	import { getNombreMes } from '$lib/utils/recargosHelpers';

	export let isOpen = false;
	export let recargoId: string | null = null;

	let recargo: RecargoDetallado | null = null;
	let isLoadingData = false;
	let error: string | null = null;
	let mesAño: { mes: number; año: number } | null = null;
	let archivoExistente: string | null = null;
	let selectedTab = 'detalles';

	// ═══ Preview monetario (cálculo de "Valor a Pagar" por día y total) ═══
	// Replica la lógica de RecargosDesgloseModal.svelte: trae el detalle por
	// planilla/día desde /api/liquidaciones/preview-recargos para mostrar el
	// valor total a pagar del recargo y el desglose por día.
	type PreviewDiaModal = {
		dia: number;
		fecha: string;
		es_festivo: boolean;
		es_domingo: boolean;
		disponibilidad: boolean;
		total_horas: number;
		total_valor_dia: number;
	};
	type PreviewPlanillaModal = {
		planilla_id: string;
		total_valor: number;
		dias: PreviewDiaModal[];
	};
	let isLoadingPreview = false;
	let previewError: string | null = null;
	let previewPlanilla: PreviewPlanillaModal | null = null;

	// Info del servicio asociado
	let servicioInfo: {
		origen: {
			id: string;
			codigo_municipio: number;
			nombre_municipio: string;
			nombre_departamento: string;
		} | null;
		destino: {
			id: string;
			codigo_municipio: number;
			nombre_municipio: string;
			nombre_departamento: string;
		} | null;
		origen_especifico: string;
		destino_especifico: string;
		proposito_servicio: string;
		observaciones: string;
		fecha_solicitud: string;
	} | null = null;

	interface DiaLaboral {
		id: string;
		dia: number;
		hora_inicio: string;
		hora_fin: string;
		total_horas: number;
		es_especial: boolean;
		es_domingo: boolean;
		es_festivo: boolean;
		hed: number;
		hen: number;
		hefd: number;
		hefn: number;
		rndf: number;
		rn: number;
		rd: number;
	}

	// Helper para formatear horas
	function formatearHoras(horas: number | string | undefined): string {
		if (!horas) return '0.0';
		const num = typeof horas === 'string' ? parseFloat(horas) : horas;
		return isNaN(num) ? '0.0' : num.toFixed(2);
	}

	function fmtCOP(v: number | null | undefined): string {
		const n = Number(v) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
	}

	// Carga el preview monetario del conductor en el período del recargo y
	// extrae la planilla que coincide con el recargo actual (por planilla_id === recargo.id).
	async function cargarPreviewValor(rec: RecargoDetallado) {
		try {
			isLoadingPreview = true;
			previewError = null;
			previewPlanilla = null;
			if (!rec?.conductor_id || !rec.mes || !rec.año) return;
			const data = await recargosApi.obtenerPreviewValorRecargo(
				rec.conductor_id,
				Number(rec.mes),
				Number((rec as any).a_o ?? rec.año)
			);
			const match = (data?.planillas || []).find((p) => p.planilla_id === rec.id);
			previewPlanilla = match
				? {
						planilla_id: match.planilla_id,
						total_valor: Number(match.total_valor) || 0,
						dias: (match.dias || []).map((d) => ({
							dia: Number(d.dia) || 0,
							fecha: d.fecha,
							es_festivo: !!d.es_festivo,
							es_domingo: !!d.es_domingo,
							disponibilidad: !!d.disponibilidad,
							total_horas: Number(d.total_horas) || 0,
							total_valor_dia: Number(d.total_valor_dia) || 0
						}))
					}
				: null;
			if (!match) {
				previewError = 'No se encontró el cálculo monetario para este recargo en el período.';
			}
		} catch (err) {
			console.warn('[ModalVisualizarRecargo] No se pudo cargar el preview:', err);
			previewError = 'No se pudo calcular el valor monetario del recargo.';
		} finally {
			isLoadingPreview = false;
		}
	}

	// Función para obtener URL firmada
	async function getPresignedUrl(s3Key: string): Promise<string | null> {
		try {
			const response = await apiClient.get<{
				success: boolean;
				data: { url: string };
			}>('/api/documentos/url-firma', {
				params: { key: s3Key }
			});
			return response.data.data.url;
		} catch (error) {
			console.error('Error obteniendo URL firmada:', error);
			return null;
		}
	}

	// Función para cargar datos del recargo
	async function cargarDatosRecargo(id: string) {
		try {
			isLoadingData = true;
			error = null;

			const recargoData = await recargosApi.obtenerPorId(id);

			if (recargoData) {
				// Mapear dias_laborales_planillas al formato esperado
				const diasMapeados = (recargoData.dias_laborales_planillas || []).map((dia: any) => {
					// Calcular totales de recargos por tipo
					const recargos = {
						hed: 0,
						hen: 0,
						hefd: 0,
						hefn: 0,
						rndf: 0,
						rn: 0,
						rd: 0
					};

					// Sumar horas de cada tipo de recargo
					(dia.detalles_recargos_dias || []).forEach((detalle: any) => {
						const codigo = detalle.tipos_recargos?.codigo?.toLowerCase();
						const horas = parseFloat(detalle.horas || '0');

						if (codigo && recargos.hasOwnProperty(codigo)) {
							recargos[codigo as keyof typeof recargos] += horas;
						}
					});

					return {
						id: dia.id,
						dia: dia.dia,
						hora_inicio: dia.hora_inicio,
						hora_fin: dia.hora_fin,
						total_horas: parseFloat(dia.total_horas || '0'),
						horas_ordinarias: parseFloat(dia.horas_ordinarias || '0'),
						es_festivo: dia.es_festivo,
						es_domingo: dia.es_domingo,
						kilometraje_inicial: dia.kilometraje_inicial,
						kilometraje_final: dia.kilometraje_final,
						// Recargos calculados
						hed: recargos.hed,
						hen: recargos.hen,
						hefd: recargos.hefd,
						hefn: recargos.hefn,
						rndf: recargos.rndf,
						rn: recargos.rn,
						rd: recargos.rd
					};
				});

				// Mapear los datos de la API al formato esperado por el modal
				recargo = {
					...recargoData,
					año: (recargoData as any).a_o || recargoData.año, // Mapear a_o -> año
					conductor: recargoData.conductor, // Ya tiene el nombre correcto
					vehiculo: recargoData.vehiculo, // Mapear vehiculo -> vehiculo
					empresa: (recargoData as any).clientes || (recargoData as any).cliente || {}, // Mapear clientes/cliente -> empresa
					dias_laborales: diasMapeados,
					total_horas: parseFloat(String(recargoData.total_horas_trabajadas || '0')),
					total_dias: (recargoData as any).total_dias_laborados || 0,
					// Mapear información de auditoría
					auditoria: {
						version: recargoData.version || 1,
						creado_por: (recargoData as any).users_recargos_planillas_creado_por_idTousers || {
							nombre: 'Sistema',
							apellido: '',
							email: 'sistema@cotransmeq.com'
						},
						actualizado_por:
							(recargoData as any).users_recargos_planillas_actualizado_por_idTousers || null,
						created_at: recargoData.created_at,
						updated_at: recargoData.updated_at
					},
					historial: [] // TODO: Obtener historial de cambios
				} as any;

				// Extraer info del servicio si existe
				if (recargoData.servicio_id && (recargoData as any).servicio) {
					const svc = (recargoData as any).servicio;
					servicioInfo = {
						origen: svc.municipios_servicio_origen_idTomunicipios || null,
						destino: svc.municipios_servicio_destino_idTomunicipios || null,
						origen_especifico: svc.origen_especifico || '',
						destino_especifico: svc.destino_especifico || '',
						proposito_servicio: svc.proposito_servicio || '',
						observaciones: svc.observaciones || '',
						fecha_solicitud: svc.fecha_solicitud || ''
					};
				} else {
					servicioInfo = null;
				}

				mesAño = { mes: recargoData.mes, año: (recargoData as any).a_o || recargoData.año };

				// Cargar archivo si existe
				if (recargoData.planilla_s3key) {
					const url = await getPresignedUrl(recargoData.planilla_s3key);
					archivoExistente = url;
				} else {
					archivoExistente = null;
				}

				// Cargar el preview monetario (total a pagar + desglose por día)
				if (recargo && recargo.conductor_id) {
					await cargarPreviewValor(recargo as RecargoDetallado);
				}
			} else {
				throw new Error('No se encontró información del recargo');
			}
		} catch (err) {
			error = 'No se pudo cargar la información del recargo';
			console.error('Error cargando recargo:', err);
		} finally {
			isLoadingData = false;
		}
	} // Función para descargar archivo
	async function descargarArchivoExistente() {
		if (!recargo?.planilla_s3key) {
			alert('No hay planilla asociada a este recargo');
			return;
		}

		const url = await getPresignedUrl(recargo.planilla_s3key);
		if (url) {
			window.open(url, '_blank');
		} else {
			alert('No se pudo obtener el enlace de descarga de la planilla');
		}
	}

	function handleClose() {
		recargo = null;
		error = null;
		mesAño = null;
		archivoExistente = null;
		servicioInfo = null;
		selectedTab = 'detalles';
		previewPlanilla = null;
		previewError = null;
		isLoadingPreview = false;
		isOpen = false;
	}

	// Función para visualizar el PDF o la imagen adjunta
	async function visualizarArchivo() {
		if (!recargo?.planilla_s3key) {
			alert('No hay planilla asociada a este recargo');
			return;
		}

		// Construir URL del adjunto desde el backend
		const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
		const archivoUrl = `${baseUrl}/api/documentos/ver/${encodeURIComponent(recargo.planilla_s3key)}`;

		// Abrir en nueva pestaña
		window.open(archivoUrl, '_blank');
	}

	// Computed values
	$: infoRecargo =
		recargo && mesAño
			? {
					conductor: recargo.conductor || {},
					vehiculo: recargo.vehiculo || {},
					empresa: recargo.empresa || {},
					planilla: recargo.numero_planilla || `Planilla ${getNombreMes(mesAño.mes)} ${mesAño.año}`,
					totalDias: recargo.total_dias || 0,
					mesAño: `${getNombreMes(mesAño.mes)} ${mesAño.año}`
				}
			: null;

	// Asegurar que dias_laborales siempre sea un array
	$: diasLaborales = recargo?.dias_laborales || [];

	// Asegurar que historial siempre sea un array
	$: historial = recargo?.historial || [];

	// Asegurar que auditoria tenga valores por defecto seguros
	$: auditoria = recargo?.auditoria || {
		version: 1,
		creado_por: { nombre: 'Sistema', apellido: '', email: 'sistema@cotransmeq.com' },
		created_at: null,
		actualizado_por: null,
		updated_at: null
	};

	$: totales =
		diasLaborales.length && recargo
			? {
					totalHoras: recargo.total_horas || 0,
					totalesRecargos: diasLaborales.reduce(
						(acc, dia) => ({
							HED: acc.HED + (dia.hed || 0),
							HEN: acc.HEN + (dia.hen || 0),
							HEFD: acc.HEFD + (dia.hefd || 0),
							HEFN: acc.HEFN + (dia.hefn || 0),
							RNDF: acc.RNDF + (dia.rndf || 0),
							RN: acc.RN + (dia.rn || 0),
							RD: acc.RD + (dia.rd || 0)
						}),
						{ HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RNDF: 0, RN: 0, RD: 0 }
					)
				}
			: {
					totalHoras: 0,
					totalesRecargos: { HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RNDF: 0, RN: 0, RD: 0 }
				};

	// Cargar datos cuando se abre el modal
	$: if (isOpen && recargoId) {
		cargarDatosRecargo(recargoId);
	}

	function formatearFecha(fecha: string): string {
		return new Date(fecha).toLocaleString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function traducirAccion(accion: string): string {
		const traducciones: Record<string, string> = {
			creacion: 'Creación',
			actualizacion: 'Actualización',
			eliminacion: 'Eliminación',
			restauracion: 'Restauración',
			aprobacion: 'Aprobación',
			rechazo: 'Rechazo'
		};
		return traducciones[accion] || accion;
	}

	function getColorAccion(accion: string): string {
		const colores: Record<string, string> = {
			creacion: 'bg-green-100 text-green-700',
			actualizacion: 'bg-blue-100 text-blue-700',
			eliminacion: 'bg-red-100 text-red-700',
			restauracion: 'bg-purple-100 text-purple-700',
			aprobacion: 'bg-orange-100 text-orange-700',
			rechazo: 'bg-orange-100 text-orange-700'
		};
		return colores[accion] || 'bg-gray-100 text-gray-700';
	}
</script>

{#if isOpen}
	<!-- Backdrop con blur (paleta landing) -->
	<button
		type="button"
		class="fixed inset-0 z-[60] cursor-default border-0 p-0"
		style="background: linear-gradient(135deg, rgba(15, 31, 26, 0.40), rgba(10, 20, 16, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
		aria-label="Cerrar modal"
		on:click={handleClose}
	></button>

	<!-- Modal Container -->
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center p-4"
		on:keydown={(e) => e.key === 'Escape' && handleClose()}
		role="presentation"
	>
		<!-- Modal Content -->
		<div
			class="relative max-h-[85vh] w-full max-w-5xl overflow-hidden"
			style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Header -->
			<div
				class="px-6 py-5"
				style="border-bottom: 1px solid var(--border-subtle); background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);"
			>
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0 flex-1">
						<h2
							class="font-display text-2xl"
							style="color: var(--bg-charcoal); font-weight: 500; letter-spacing: -0.01em;"
						>
							Detalle de Recargo
						</h2>
						<div class="mt-1 flex items-center gap-2">
							<p
								class="font-mono-meta inline-block rounded-md px-2 py-0.5 text-[10px]"
								style="color: var(--orange-500); background: rgba(249, 115, 22, 0.08); letter-spacing: 0.12em;"
							>
								{infoRecargo?.mesAño ?? '—'}
							</p>
							{#if recargo?.planilla_s3key}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700"
									title="Documento adjunto disponible"
								>
									<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
									Documento
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
									title="Sin documento adjunto"
								>
									<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
									Sin documento
								</span>
							{/if}
						</div>
					</div>
					<div class="flex flex-shrink-0 items-center gap-2">
						{#if recargo?.planilla_s3key}
							<!-- Botón para PDF o imagen -->
							<button on:click={visualizarArchivo} class="btn-primary" title="Visualizar adjunto">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
								Ver archivo
							</button>
						{/if}
						<button on:click={handleClose} class="filter-close" aria-label="Cerrar modal">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>
				</div>
			</div>

			<!-- Body -->
			<div class="max-h-[calc(85vh-180px)] overflow-y-auto px-6 py-6">
				{#if isLoadingData}
					<div class="flex items-center justify-center py-12">
						<div class="text-center">
							<div
								class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
							></div>
							<p class="text-sm text-gray-500">Cargando información...</p>
						</div>
					</div>
				{:else if error}
					<div class="flex items-center justify-center py-12">
						<div class="text-center">
							<svg
								class="mx-auto mb-3 h-12 w-12 text-red-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<p class="text-sm text-red-600">{error}</p>
						</div>
					</div>
				{:else if recargo && infoRecargo}
					<!-- Tabs -->
					<div class="mb-6 border-b border-gray-200">
						<div class="flex gap-4">
							<button
								class="border-b-2 px-4 py-2 text-sm font-medium {selectedTab === 'detalles'
									? 'border-orange-500 text-orange-600'
									: 'border-transparent text-gray-500 hover:text-gray-700'}"
								on:click={() => (selectedTab = 'detalles')}
							>
								<div class="flex items-center gap-2">
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
									<span>Detalles</span>
								</div>
							</button>
							<button
								class="border-b-2 px-4 py-2 text-sm font-medium {selectedTab === 'auditoria'
									? 'border-orange-500 text-orange-600'
									: 'border-transparent text-gray-500 hover:text-gray-700'}"
								on:click={() => (selectedTab = 'auditoria')}
							>
								<div class="flex items-center gap-2">
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
									<span>Auditoría</span>
								</div>
							</button>
							<button
								class="border-b-2 px-4 py-2 text-sm font-medium {selectedTab === 'historial'
									? 'border-orange-500 text-orange-600'
									: 'border-transparent text-gray-500 hover:text-gray-700'}"
								on:click={() => (selectedTab = 'historial')}
							>
								<div class="flex items-center gap-2">
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<span>Historial</span>
									{#if historial.length > 0}
										<span
											class="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700"
										>
											{historial.length}
										</span>
									{/if}
								</div>
							</button>
						</div>
					</div>

					<!-- Tab Content -->
					<div class="space-y-6">
						{#if selectedTab === 'detalles'}
							<!-- Información Principal -->
							<div class="grid grid-cols-1 gap-4 md:grid-cols-6">
								<div class="col-span-2 space-y-1">
									<div class="text-xs tracking-wide text-gray-400 uppercase">Conductor</div>
									<div class="font-medium text-gray-900">
										{`${infoRecargo.conductor.apellido} ${infoRecargo.conductor.nombre}`}
									</div>
									<div class="text-sm text-gray-500">
										CC: {infoRecargo.conductor.numero_identificacion}
									</div>
								</div>

								<div class="col-span-1 space-y-1">
									<div class="text-xs tracking-wide text-gray-400 uppercase">Vehículo</div>
									<div class="text-lg font-medium text-gray-900">
										{infoRecargo.vehiculo.placa}
									</div>
								</div>

								<div class="col-span-1 space-y-1">
									<div class="text-xs tracking-wide text-gray-400 uppercase">
										Número de planilla
									</div>
									<div class="text-lg font-medium text-gray-900">{infoRecargo.planilla}</div>
								</div>

								<div class="col-span-2 space-y-1">
									<div class="text-xs tracking-wide text-gray-400 uppercase">Empresa</div>
									<div class="font-medium text-gray-900">{infoRecargo.empresa.nombre}</div>
									<div class="text-sm text-gray-500">NIT: {infoRecargo.empresa.nit}</div>
								</div>
							</div>

							<!-- Información del Servicio Asociado -->
							{#if servicioInfo}
								<div
									class="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5"
								>
									<div class="mb-4 flex items-center gap-3">
										<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
											<svg
												class="h-4 w-4 text-white"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
												/>
											</svg>
										</div>
										<div>
											<h3 class="text-sm font-semibold text-gray-900">Servicio Asociado</h3>
											<p class="text-xs text-gray-500">Información del servicio vinculado</p>
										</div>
									</div>

									<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
										<!-- Origen -->
										<div class="rounded-lg bg-white/70 px-3 py-2">
											<div class="mb-1 text-xs font-medium text-gray-500 uppercase">Origen</div>
											{#if servicioInfo.origen}
												<div class="font-medium text-gray-900">
													{servicioInfo.origen.nombre_municipio}
												</div>
												<div class="flex items-center gap-2 text-xs text-gray-500">
													<span>{servicioInfo.origen.nombre_departamento}</span>
													<span
														class="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 font-mono font-semibold text-blue-700"
													>
														DIVIPOLA: {servicioInfo.origen.codigo_municipio}
													</span>
												</div>
												{#if servicioInfo.origen_especifico}
													<div class="mt-1 text-xs text-gray-600">
														📍 {servicioInfo.origen_especifico}
													</div>
												{/if}
											{:else}
												<div class="text-sm text-gray-400">No disponible</div>
											{/if}
										</div>

										<!-- Destino -->
										<div class="rounded-lg bg-white/70 px-3 py-2">
											<div class="mb-1 text-xs font-medium text-gray-500 uppercase">Destino</div>
											{#if servicioInfo.destino}
												<div class="font-medium text-gray-900">
													{servicioInfo.destino.nombre_municipio}
												</div>
												<div class="flex items-center gap-2 text-xs text-gray-500">
													<span>{servicioInfo.destino.nombre_departamento}</span>
													<span
														class="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 font-mono font-semibold text-blue-700"
													>
														DIVIPOLA: {servicioInfo.destino.codigo_municipio}
													</span>
												</div>
												{#if servicioInfo.destino_especifico}
													<div class="mt-1 text-xs text-gray-600">
														📍 {servicioInfo.destino_especifico}
													</div>
												{/if}
											{:else}
												<div class="text-sm text-gray-400">No disponible</div>
											{/if}
										</div>

										<!-- Tipo de Servicio -->
										<div class="rounded-lg bg-white/70 px-3 py-2">
											<div class="mb-1 text-xs font-medium text-gray-500 uppercase">
												Tipo de Servicio
											</div>
											<span
												class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {servicioInfo.proposito_servicio ===
												'personal'
													? 'bg-blue-100 text-blue-700'
													: servicioInfo.proposito_servicio === 'personal_y_herramienta'
														? 'bg-orange-100 text-orange-700'
														: 'bg-gray-100 text-gray-700'}"
											>
												{servicioInfo.proposito_servicio === 'personal'
													? '� Personal'
													: servicioInfo.proposito_servicio === 'personal_y_herramienta'
														? '�️ Personal y Herramienta'
														: servicioInfo.proposito_servicio || 'No especificado'}
											</span>
										</div>

										<!-- Observaciones -->
										{#if servicioInfo.observaciones}
											<div class="rounded-lg bg-white/70 px-3 py-2 md:col-span-2">
												<div class="mb-1 text-xs font-medium text-gray-500 uppercase">
													Observaciones
												</div>
												<div class="text-sm text-gray-700">{servicioInfo.observaciones}</div>
											</div>
										{/if}
									</div>
								</div>
							{/if}

							<!-- Resumen de Totales -->
							<div class="rounded-lg bg-gray-50 p-4">
								<div class="mb-3 text-xs tracking-wide text-gray-400 uppercase">
									Resumen de Horas
								</div>
								<div class="grid grid-cols-4 gap-4 md:grid-cols-8">
									<div class="text-center">
										<div class="text-lg font-semibold text-gray-900">
											{formatearHoras(totales.totalHoras)}
										</div>
										<div class="text-xs text-gray-400">Total</div>
									</div>
									<div class="text-center">
										<div class="text-lg font-semibold text-gray-900">{infoRecargo.totalDias}</div>
										<div class="text-xs text-gray-400">Días</div>
									</div>
									{#each [{ key: 'HED', value: totales.totalesRecargos.HED, label: 'HED', percent: '25%' }, { key: 'HEN', value: totales.totalesRecargos.HEN, label: 'HEN', percent: '75%' }, { key: 'HEFD', value: totales.totalesRecargos.HEFD, label: 'HEFD', percent: '100%' }, { key: 'HEFN', value: totales.totalesRecargos.HEFN, label: 'HEFN', percent: '150%' }, { key: 'RNDF', value: totales.totalesRecargos.RNDF, label: 'RNDF', percent: '115%' }, { key: 'RN', value: totales.totalesRecargos.RN, label: 'RN', percent: '35%' }, { key: 'RD', value: totales.totalesRecargos.RD, label: 'RD', percent: '75%' }] as { key, value, label, percent }}
										<div class="text-center">
											<div class="text-lg font-semibold text-gray-900">
												{formatearHoras(value)}
											</div>
											<div class="text-xs text-gray-400">{label}</div>
											<div class="text-xs text-gray-500">{percent}</div>
										</div>
									{/each}
								</div>
							</div>

							<!-- ═══ Valor a Pagar (cálculo monetario del período) ═══ -->
							<!-- Replica la lógica de RecargosDesgloseModal: muestra el total a pagar
							     generado por los recargos del período y el desglose por día. -->
							<div
								class="rounded-xl border p-5"
								style="background: linear-gradient(135deg, rgba(249, 115, 22,0.06), rgba(234, 88, 12,0.03)); border-color: rgba(249, 115, 22,0.25);"
							>
								<div class="mb-4 flex items-center justify-between gap-3">
									<div class="flex items-center gap-2">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg"
											style="background: linear-gradient(135deg, #f97316, #ea580c); box-shadow: 0 4px 10px rgba(249, 115, 22,0.25);"
										>
											<svg
												class="h-4 w-4 text-white"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="2"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>
										</div>
										<div>
											<p class="text-[10px] font-medium tracking-wide text-gray-500 uppercase">
												Valor a Pagar · Recargos del Período
											</p>
											<p class="text-[10px] text-gray-400">
												Cálculo automático con config salarial y % vigentes por día
											</p>
										</div>
									</div>
									{#if isLoadingPreview}
										<div class="flex items-center gap-1.5 text-gray-400">
											<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle
													class="opacity-25"
													cx="12"
													cy="12"
													r="10"
													stroke="currentColor"
													stroke-width="4"
												/>
												<path
													class="opacity-75"
													fill="currentColor"
													d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
												/>
											</svg>
											<span class="text-[10px]">Calculando…</span>
										</div>
									{/if}
								</div>

								{#if previewError && !isLoadingPreview}
									<div
										class="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-700"
									>
										{previewError}
									</div>
								{:else if previewPlanilla}
									<!-- Total a pagar destacado -->
									<div class="mb-4 flex items-baseline gap-2">
										<span class="text-3xl font-bold text-[#c2410c]">
											{fmtCOP(previewPlanilla.total_valor)}
										</span>
										<span class="text-xs text-gray-500"> · Total del recargo </span>
									</div>

									<!-- Desglose por día -->
									{#if previewPlanilla.dias.length > 0}
										<div
											class="overflow-hidden rounded-lg border"
											style="border-color: rgba(249, 115, 22,0.20);"
										>
											<table class="w-full text-xs">
												<thead style="background-color: rgba(249, 115, 22,0.06);">
													<tr>
														<th
															class="px-3 py-2 text-left font-medium tracking-wide text-gray-600 uppercase"
															style="font-size: 10px;"
														>
															Día
														</th>
														<th
															class="px-3 py-2 text-left font-medium tracking-wide text-gray-600 uppercase"
															style="font-size: 10px;"
														>
															Tipo
														</th>
														<th
															class="px-3 py-2 text-right font-medium tracking-wide text-gray-600 uppercase"
															style="font-size: 10px;"
														>
															Horas
														</th>
														<th
															class="px-3 py-2 text-right font-medium tracking-wide text-gray-600 uppercase"
															style="font-size: 10px;"
														>
															Valor del día
														</th>
													</tr>
												</thead>
												<tbody>
													{#each previewPlanilla.dias.slice().sort((a, b) => a.dia - b.dia) as d}
														<tr
															class="border-t border-gray-100"
															style="background: {d.disponibilidad ? '#FAFAFA' : 'white'};"
														>
															<td class="px-3 py-2">
																<div class="flex items-center gap-1.5">
																	<span
																		class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold"
																		style="background: {d.es_festivo
																			? 'rgba(245,158,11,0.12)'
																			: d.es_domingo
																				? 'rgba(168,85,247,0.10)'
																				: 'rgba(249, 115, 22,0.08)'}; color: {d.es_festivo
																			? '#92400E'
																			: d.es_domingo
																				? '#6B21A8'
																				: '#c2410c'};"
																	>
																		{String(d.dia).padStart(2, '0')}
																	</span>
																</div>
															</td>
															<td class="px-3 py-2">
																{#if d.disponibilidad}
																	<span class="text-[10px] text-gray-400">Disponible</span>
																{:else if d.es_festivo}
																	<span
																		class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
																		style="background: rgba(245,158,11,0.10); color: #92400E;"
																	>
																		Festivo
																	</span>
																{:else if d.es_domingo}
																	<span
																		class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
																		style="background: rgba(168,85,247,0.10); color: #6B21A8;"
																	>
																		Domingo
																	</span>
																{:else}
																	<span class="text-[10px] text-gray-500">Normal</span>
																{/if}
															</td>
															<td class="px-3 py-2 text-right text-gray-700 tabular-nums">
																{formatearHoras(d.total_horas)}h
															</td>
															<td
																class="px-3 py-2 text-right font-bold tabular-nums"
																style="color: {d.disponibilidad ? '#9CA3AF' : '#c2410c'};"
															>
																{d.disponibilidad ? '—' : fmtCOP(d.total_valor_dia)}
															</td>
														</tr>
													{/each}
												</tbody>
												<tfoot>
													<tr
														style="background: rgba(249, 115, 22,0.08); border-top: 2px solid rgba(249, 115, 22,0.30);"
													>
														<td
															colspan="3"
															class="px-3 py-2 text-right text-[11px] font-semibold text-[#c2410c]"
														>
															Total
														</td>
														<td
															class="px-3 py-2 text-right text-sm font-bold text-[#c2410c] tabular-nums"
														>
															{fmtCOP(previewPlanilla.total_valor)}
														</td>
													</tr>
												</tfoot>
											</table>
										</div>
									{:else}
										<p class="text-xs text-gray-500 italic">
											Este recargo no tiene días con recargos monetizables dentro del período.
										</p>
									{/if}
								{/if}
							</div>

							<!-- Días Laborales -->
							<div>
								<div class="mb-4 flex items-center justify-between">
									<div class="text-xs tracking-wide text-gray-400 uppercase">Días Laborales</div>
									<span class="text-xs text-gray-400">
										{diasLaborales.length} días registrados
									</span>
								</div>
								<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
									{#each diasLaborales as dia}
										{@const recargosDelDia = {
											HED: dia.hed || 0,
											HEN: dia.hen || 0,
											HEFD: dia.hefd || 0,
											HEFN: dia.hefn || 0,
											RNDF: dia.rndf || 0,
											RN: dia.rn || 0,
											RD: dia.rd || 0
										}}
										{@const tieneRecargos = Object.values(recargosDelDia).some(
											(valor) => valor > 0
										)}

										<div
											class="rounded-lg border border-gray-100 bg-white p-4 transition-shadow hover:shadow-sm"
										>
											<!-- Header del día -->
											<div class="mb-3 flex items-center justify-between">
												<div class="flex items-center gap-2">
													<div
														class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100"
													>
														<span class="text-sm font-semibold text-gray-700">{dia.dia}</span>
													</div>
													{#if dia.es_especial}
														<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
															{dia.es_domingo ? 'DOM' : 'FEST'}
														</span>
													{/if}
												</div>
												<span class="text-sm text-gray-500">
													{formatearHoras(dia.total_horas)}h
												</span>
											</div>

											<!-- Horario -->
											<div class="mb-3 text-xs text-gray-400">
												{dia.hora_inicio}:00 - {dia.hora_fin}:00
											</div>

											<!-- Recargos -->
											{#if tieneRecargos}
												<div class="space-y-1">
													{#each [{ key: 'HED', color: 'bg-green-50 text-green-700', value: recargosDelDia.HED }, { key: 'HEN', color: 'bg-blue-50 text-blue-700', value: recargosDelDia.HEN }, { key: 'HEFD', color: 'bg-orange-50 text-orange-700', value: recargosDelDia.HEFD }, { key: 'HEFN', color: 'bg-purple-50 text-purple-700', value: recargosDelDia.HEFN }, { key: 'RNDF', color: 'bg-indigo-50 text-indigo-700', value: recargosDelDia.RNDF }, { key: 'RN', color: 'bg-teal-50 text-teal-700', value: recargosDelDia.RN }, { key: 'RD', color: 'bg-red-50 text-red-700', value: recargosDelDia.RD }] as { key, color, value }}
														{#if value > 0}
															<div
																class="flex items-center justify-between rounded px-2 py-1 text-xs {color}"
															>
																<span>{key}:</span>
																<span class="font-medium">{formatearHoras(value)}h</span>
															</div>
														{/if}
													{/each}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>

							<!-- Información Adicional -->
							<div class="border-t border-gray-100 pt-4">
								<div class="mb-2 text-xs tracking-wide text-gray-400 uppercase">
									Información del Sistema
								</div>
								<div class="font-mono text-xs break-all text-gray-500">ID: {recargo.id}</div>
							</div>
						{:else if selectedTab === 'auditoria'}
							<!-- Auditoría -->
							<div class="space-y-6">
								<!-- Información de Creación -->
								<div
									class="rounded-lg border border-orange-100 bg-gradient-to-br from-orange-50 to-green-50 p-6"
								>
									<div class="mb-4 flex items-center gap-3">
										<div
											class="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-600"
										>
											<svg
												class="h-5 w-5 text-white"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
												/>
											</svg>
										</div>
										<div>
											<h3 class="text-sm font-semibold text-gray-900">Creación del Recargo</h3>
											<p class="text-xs text-gray-500">Versión {auditoria.version}</p>
										</div>
									</div>
									<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
										<div>
											<div class="mb-1 text-xs text-gray-500">Creado por</div>
											<div class="font-medium text-gray-900">
												{auditoria.creado_por.nombre}
												{auditoria.creado_por.apellido}
											</div>
											<div class="text-xs text-gray-500">
												{auditoria.creado_por.email}
											</div>
										</div>
										<div>
											<div class="mb-1 text-xs text-gray-500">Fecha de creación</div>
											<div class="flex items-center gap-2 text-sm text-gray-900">
												<svg
													class="h-3.5 w-3.5 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
													/>
												</svg>
												{auditoria.created_at
													? formatearFecha(auditoria.created_at)
													: 'No disponible'}
											</div>
										</div>
									</div>
								</div>

								<!-- Información de Última Actualización -->
								{#if auditoria.actualizado_por}
									<div
										class="rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-6"
									>
										<div class="mb-4 flex items-center gap-3">
											<div
												class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600"
											>
												<svg
													class="h-5 w-5 text-white"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
													/>
												</svg>
											</div>
											<div>
												<h3 class="text-sm font-semibold text-gray-900">Última Actualización</h3>
												<p class="text-xs text-gray-500">Versión {auditoria.version}</p>
											</div>
										</div>

										<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
											<div>
												<div class="mb-1 text-xs text-gray-500">Actualizado por</div>
												<div class="font-medium text-gray-900">
													{auditoria.actualizado_por.nombre}
													{auditoria.actualizado_por.apellido}
												</div>
												<div class="text-xs text-gray-500">
													{auditoria.actualizado_por.email}
												</div>
											</div>
											<div>
												<div class="mb-1 text-xs text-gray-500">Fecha de actualización</div>
												<div class="flex items-center gap-2 text-sm text-gray-900">
													<svg
														class="h-3.5 w-3.5 text-gray-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
														/>
													</svg>
													{auditoria.updated_at
														? formatearFecha(auditoria.updated_at)
														: 'No disponible'}
												</div>
											</div>
										</div>
									</div>
								{/if}

								<!-- Información Adicional -->
								<div class="rounded-lg bg-gray-50 p-4">
									<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
										<div>
											<div class="mb-1 text-xs tracking-wide text-gray-400 uppercase">Estado</div>
											<span
												class="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 uppercase"
											>
												{recargo.estado}
											</span>
										</div>
										<div>
											<div class="mb-1 text-xs tracking-wide text-gray-400 uppercase">Versión</div>
											<div class="text-sm font-semibold text-gray-900">
												v{auditoria.version}
											</div>
										</div>
										<div>
											<div class="mb-1 text-xs tracking-wide text-gray-400 uppercase">
												ID del Sistema
											</div>
											<div class="font-mono text-xs break-all text-gray-500">{recargo.id}</div>
										</div>
									</div>

									{#if recargo.observaciones}
										<div class="mt-4 border-t border-gray-200 pt-4">
											<div class="mb-1 text-xs tracking-wide text-gray-400 uppercase">
												Observaciones
											</div>
											<p class="text-sm text-gray-700">{recargo.observaciones}</p>
										</div>
									{/if}
								</div>
							</div>
						{:else if selectedTab === 'historial'}
							<!-- Historial -->
							<div>
								{#if !historial || historial.length === 0}
									<div class="py-12 text-center">
										<svg
											class="mx-auto mb-4 h-12 w-12 text-gray-300"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
										<p class="text-sm text-gray-500">No hay cambios registrados en el historial</p>
									</div>
								{:else}
									<div class="space-y-4">
										{#each historial
											.slice()
											.sort((a, b) => (b.version_nueva ?? 0) - (a.version_nueva ?? 0)) as item}
											<div
												class="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
											>
												<div class="mb-3 flex items-center justify-between">
													<div class="flex items-center gap-3">
														<span
															class="rounded-full px-3 py-1 text-xs font-medium {getColorAccion(
																item.accion
															)}"
														>
															{traducirAccion(item.accion)}
														</span>
														<span class="text-sm text-gray-500">
															v{item.version_anterior} → v{item.version_nueva}
														</span>
													</div>
													<span class="text-xs text-gray-400">
														{formatearFecha(item.created_at)}
													</span>
												</div>

												<div class="mb-2 flex items-center gap-2 text-sm">
													<svg
														class="h-4 w-4 text-gray-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
														/>
													</svg>
													{#if item.usuario}
														<span class="font-medium text-gray-900">
															{item.usuario.nombre}
															{item.usuario.apellido}
														</span>
														<span class="text-gray-500">({item.usuario.email})</span>
													{:else}
														<span class="text-gray-500">Usuario no disponible</span>
													{/if}
												</div>

												{#if item.campos_modificados && item.campos_modificados.length > 0}
													<div class="mt-3 rounded bg-gray-50 p-3">
														<div class="mb-2 text-xs font-medium text-gray-500">
															Campos modificados:
														</div>
														<div class="flex flex-wrap gap-2">
															{#each item.campos_modificados as campo}
																<span
																	class="rounded bg-white px-2 py-1 font-mono text-xs text-gray-700"
																>
																	{campo}
																</span>
															{/each}
														</div>
													</div>
												{/if}

												{#if item.motivo}
													<div class="mt-3 border-t border-gray-100 pt-3">
														<div class="mb-1 text-xs font-medium text-gray-500">Motivo:</div>
														<p class="text-sm text-gray-700">{item.motivo}</p>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div
				class="px-6 py-4"
				style="border-top: 1px solid var(--border-subtle); background-color: var(--bg-base);"
			>
				<div class="flex justify-end">
					<button on:click={handleClose} class="btn-primary"> Cerrar </button>
				</div>
			</div>
		</div>
	</div>
{/if}
