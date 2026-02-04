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
		rn: number;
		rd: number;
	}

	// Helper para formatear horas
	function formatearHoras(horas: number | string | undefined): string {
		if (!horas) return '0.0';
		const num = typeof horas === 'string' ? parseFloat(horas) : horas;
		return isNaN(num) ? '0.0' : num.toFixed(1);
	}

	// Función para obtener URL firmada
	async function getPresignedUrl(s3Key: string): Promise<string | null> {
		try {
			// TODO: Implementar endpoint /api/documentos/url-firma en el backend
			console.warn('Endpoint de URL firmada no implementado:', s3Key);
			return null;

			// const response = await apiClient.get('/api/documentos/url-firma', {
			// 	params: { key: s3Key }
			// });
			// return response.data.url;
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
						rn: recargos.rn,
						rd: recargos.rd
					};
				});

				// Mapear los datos de la API al formato esperado por el modal
				recargo = {
					...recargoData,
					año: recargoData.a_o, // Mapear a_o -> año
					conductor: recargoData.conductores, // Mapear conductores -> conductor
					vehiculo: recargoData.vehiculos, // Mapear vehiculos -> vehiculo
					empresa: recargoData.clientes, // Mapear clientes -> empresa
					dias_laborales: diasMapeados,
					total_horas: parseFloat(recargoData.total_horas_trabajadas || '0'),
					total_dias: recargoData.total_dias_laborados || 0,
					// Mapear información de auditoría con valores por defecto seguros
					auditoria: {
						version: recargoData.version || 1,
						creado_por: recargoData.users_recargos_planillas_creado_por_idTousers || {
							nombre: 'Sistema',
							apellido: '',
							email: 'sistema@cotransmeq.com'
						},
						actualizado_por: recargoData.users_recargos_planillas_actualizado_por_idTousers || null,
						created_at: recargoData.created_at,
						updated_at: recargoData.updated_at
					},
					historial: [] // TODO: Obtener historial de cambios
				} as any;

				mesAño = { mes: recargoData.mes, año: recargoData.a_o };

				// Cargar archivo si existe
				if (recargoData.planilla_s3key) {
					const url = await getPresignedUrl(recargoData.planilla_s3key);
					archivoExistente = url;
				} else {
					archivoExistente = null;
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
			alert(
				'La funcionalidad de descarga requiere implementar el endpoint /api/documentos/url-firma en el backend'
			);
		}
	}

	function handleClose() {
		recargo = null;
		error = null;
		mesAño = null;
		archivoExistente = null;
		selectedTab = 'detalles';
		isOpen = false;
	}

	// Función para visualizar PDF
	async function visualizarPDF() {
		if (!recargo?.planilla_s3key) {
			alert('No hay planilla asociada a este recargo');
			return;
		}

		// Construir URL del PDF desde el backend
		const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
		const pdfUrl = `${baseUrl}/api/documentos/ver/${encodeURIComponent(recargo.planilla_s3key)}`;

		// Abrir en nueva pestaña
		window.open(pdfUrl, '_blank');
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

	$: totales = diasLaborales.length
		? {
				totalHoras: recargo.total_horas || 0,
				totalesRecargos: diasLaborales.reduce(
					(acc, dia) => ({
						HED: acc.HED + (dia.hed || 0),
						HEN: acc.HEN + (dia.hen || 0),
						HEFD: acc.HEFD + (dia.hefd || 0),
						HEFN: acc.HEFN + (dia.hefn || 0),
						RN: acc.RN + (dia.rn || 0),
						RD: acc.RD + (dia.rd || 0)
					}),
					{ HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0 }
				)
			}
		: {
				totalHoras: 0,
				totalesRecargos: { HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0 }
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
			creacion: 'bg-orange-100 text-orange-700',
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
	<!-- Modal Overlay -->
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		on:click={handleClose}
		on:keydown={(e) => e.key === 'Escape' && handleClose()}
		role="button"
		tabindex="0"
	>
		<!-- Modal Content -->
		<div
			class="relative max-h-[67.5vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			tabindex="-1"
		>
			<!-- Header -->
			<div class="border-b border-gray-100 px-6 py-4">
				<div class="flex items-center justify-between">
					<div>
						<div class="flex items-center gap-2">
							<h2 class="text-xl font-medium text-gray-900">Detalle de Recargo</h2>
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
						{#if infoRecargo}
							<p class="mt-0.5 text-sm text-gray-500">{infoRecargo.mesAño}</p>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						{#if recargo?.planilla_s3key}
							<!-- Botón Ver PDF -->
							<button
								on:click={visualizarPDF}
								class="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
								title="Visualizar PDF"
							>
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
								Ver PDF
							</button>
						{/if}
						<button on:click={handleClose} class="rounded-lg p-2 text-gray-400 hover:text-gray-600">
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
			<div class="max-h-[calc(67.5vh-160px)] overflow-y-auto px-6 py-6">
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
									{#each [{ key: 'HED', value: totales.totalesRecargos.HED, label: 'HED', percent: '25%' }, { key: 'HEN', value: totales.totalesRecargos.HEN, label: 'HEN', percent: '75%' }, { key: 'HEFD', value: totales.totalesRecargos.HEFD, label: 'HEFD', percent: '100%' }, { key: 'HEFN', value: totales.totalesRecargos.HEFN, label: 'HEFN', percent: '150%' }, { key: 'RN', value: totales.totalesRecargos.RN, label: 'RN', percent: '35%' }, { key: 'RD', value: totales.totalesRecargos.RD, label: 'RD', percent: '75%' }] as { key, value, label, percent }}
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
													{#each [{ key: 'HED', color: 'bg-orange-50 text-orange-700', value: recargosDelDia.HED }, { key: 'HEN', color: 'bg-blue-50 text-blue-700', value: recargosDelDia.HEN }, { key: 'RN', color: 'bg-purple-50 text-purple-700', value: recargosDelDia.RN }, { key: 'RD', color: 'bg-red-50 text-red-700', value: recargosDelDia.RD }, { key: 'HEFD', color: 'bg-orange-50 text-orange-700', value: recargosDelDia.HEFD }, { key: 'HEFN', color: 'bg-indigo-50 text-indigo-700', value: recargosDelDia.HEFN }] as { key, color, value }}
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
									class="rounded-lg border border-orange-100 bg-gradient-to-br from-orange-50 to-orange-50 p-6"
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
												{formatearFecha(auditoria.created_at)}
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
													{formatearFecha(auditoria.updated_at)}
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
												class="inline-flex items-center rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800 uppercase"
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
													<span class="font-medium text-gray-900">
														{item.usuario.nombre}
														{item.usuario.apellido}
													</span>
													<span class="text-gray-500">({item.usuario.email})</span>
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
			<div class="border-t border-gray-100 px-6 py-4">
				<div class="flex justify-end">
					<button
						on:click={handleClose}
						class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
					>
						Cerrar
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
