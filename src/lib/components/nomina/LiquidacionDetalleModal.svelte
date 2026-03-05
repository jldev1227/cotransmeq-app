<script lang="ts">
	import { onMount } from 'svelte';
	import { obtenerLiquidacionPorId } from '$lib/api/nomina';
	import type { Liquidacion, FirmaConUrl } from '$lib/types/nomina';
	import { toast } from 'svelte-sonner';
	import {
		X,
		User,
		DollarSign,
		Pencil,
		Calendar,
		FileText,
		ChevronDown,
		ChevronUp,
		Download,
		Loader2
	} from 'lucide-svelte';
	import { generarPdfDesprendible } from '$lib/utils/pdfDesprendible';
	import { generarPdfPrima } from '$lib/utils/pdfPrima';
	import { generarPdfInteresesCesantias } from '$lib/utils/pdfInteresesCesantias';

	export let liquidacionId: string;
	export let show = false;
	export let onClose: () => void = () => {};

	let liquidacion: Liquidacion | null = null;
	let firmas: FirmaConUrl[] = [];
	let loading = true;
	let firmasLoading = true;
	let activeTab: 'general' | 'conceptos' | 'procesamiento' = 'general';

	const tabs: { key: 'general' | 'conceptos' | 'procesamiento'; label: string }[] = [
		{ key: 'general', label: 'General' },
		{ key: 'conceptos', label: 'Conceptos' },
		{ key: 'procesamiento', label: 'Procesamiento' }
	];
	let expandedSections: Record<string, boolean> = {
		bonificaciones: false,
		recargos: false,
		pernotes: false,
		mantenimientos: false,
		anticipos: false
	};
	let generatingPdf = false;

	const MESES_ORDER: Record<string, number> = {
		Enero: 1,
		Febrero: 2,
		Marzo: 3,
		Abril: 4,
		Mayo: 5,
		Junio: 6,
		Julio: 7,
		Agosto: 8,
		Septiembre: 9,
		Octubre: 10,
		Noviembre: 11,
		Diciembre: 12
	};

	$: if (show && liquidacionId) {
		cargarDatos();
	}

	async function cargarDatos() {
		loading = true;
		firmasLoading = true;
		liquidacion = null;
		firmas = [];
		activeTab = 'general';

		try {
			const liqResponse = await obtenerLiquidacionPorId(liquidacionId);
			liquidacion = liqResponse.data;
			console.log('=== DATA LIQUIDACIÓN ===', JSON.parse(JSON.stringify(liquidacion)));
			console.log('conductor:', liquidacion?.conductor);
			console.log('vehiculos:', liquidacion?.vehiculos);
			console.log('bonificaciones:', liquidacion?.bonificaciones);
			console.log('recargos:', liquidacion?.recargos);
			console.log('pernotes:', liquidacion?.pernotes);
			console.log('anticipos:', liquidacion?.anticipos);
			console.log('mantenimientos:', liquidacion?.mantenimientos);
			console.log('conceptos_adicionales:', liquidacion?.conceptos_adicionales);
			console.log('firmas_desprendibles:', liquidacion?.firmas_desprendibles);
			console.log('creado_por:', liquidacion?.creado_por);
			console.log('actualizado_por:', liquidacion?.actualizado_por);
			console.log('liquidado_por:', liquidacion?.liquidado_por);
			console.log('es_cotransmeq:', liquidacion?.es_cotransmeq);
			console.log('sueldo_total:', liquidacion?.sueldo_total);
			console.log('neto_pagado:', liquidacion?.neto_pagado);
			// Firmas vienen incluidas en la respuesta de liquidación
			firmas = (liquidacion?.firmas_desprendibles as FirmaConUrl[]) || [];
		} catch (error: any) {
			console.error('Error cargando liquidación:', error);
			toast.error('Error al cargar los datos de la liquidación');
		} finally {
			loading = false;
			firmasLoading = false;
		}
	}

	function cerrar() {
		show = false;
		onClose();
	}

	function toggleSection(section: string) {
		expandedSections[section] = !expandedSections[section];
		expandedSections = expandedSections;
	}

	// ============= FORMATOS =============
	function formatCurrency(amount: number | string | null | undefined): string {
		const num = Number(amount) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(num);
	}

	function formatDate(dateStr: string | null | undefined): string {
		if (!dateStr) return 'Sin fecha';
		const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
		if (isNaN(date.getTime())) return 'Sin fecha';
		return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
	}

	function formatDateShort(dateStr: string | null | undefined): string {
		if (!dateStr) return '';
		const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
		if (isNaN(date.getTime())) return '';
		return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function formatDateTime(dateStr: string | null | undefined): string {
		if (!dateStr) return '';
		const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
		if (isNaN(date.getTime())) return '';
		return date.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getEstadoColor(estado: string | undefined): string {
		switch (estado) {
			case 'Liquidado':
				return 'bg-green-100 text-green-700';
			case 'Pendiente':
				return 'bg-yellow-100 text-yellow-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}

	// ============= COMPUTED =============
	$: conductorNombre = liquidacion?.conductor?.nombre || 'N/A';
	$: periodoInicio = formatDate(liquidacion?.periodo_inicio);
	$: periodoFin = formatDate(liquidacion?.periodo_fin);
	$: creadoPor = liquidacion?.creado_por
		? `${liquidacion.creado_por.nombre} ${liquidacion.creado_por.apellido || ''}`
		: 'No disponible';
	$: actualizadoPor = liquidacion?.actualizado_por
		? `${liquidacion.actualizado_por.nombre} ${liquidacion.actualizado_por.apellido || ''}`
		: 'No registrado';
	$: liquidadoPor = liquidacion?.liquidado_por
		? `${liquidacion.liquidado_por.nombre} ${liquidacion.liquidado_por.apellido || ''}`
		: 'No registrado';

	$: totalDeducciones = -(
		Number(liquidacion?.salud || 0) +
		Number(liquidacion?.pension || 0) +
		Number(liquidacion?.total_anticipos || 0)
	);
	$: netoAPagar = Number(liquidacion?.sueldo_total || liquidacion?.neto_pagado || 0);

	$: mostrarBotonPrima =
		Number(liquidacion?.prima || 0) > 0 || Number(liquidacion?.prima_pendiente || 0) > 0;
	$: mostrarBotonIntereses = Number(liquidacion?.interes_cesantias || 0) > 0;

	// ============= PDF =============
	async function handleGeneratePDF() {
		if (!liquidacion || generatingPdf) return;
		try {
			generatingPdf = true;
			await generarPdfDesprendible(liquidacion, firmas);
		} catch (error: any) {
			console.error('Error generando PDF:', error);
			toast.error('Error al generar el PDF del desprendible');
		} finally {
			generatingPdf = false;
		}
	}

	async function handleGeneratePrimaPDF() {
		if (!liquidacion) return;
		try {
			await generarPdfPrima(liquidacion, firmas);
		} catch (error: any) {
			console.error('Error generando PDF Prima:', error);
			toast.error('Error al generar el PDF de prima');
		}
	}

	async function handleGenerateInteresesPDF() {
		if (!liquidacion) return;
		try {
			await generarPdfInteresesCesantias(liquidacion, firmas);
		} catch (error: any) {
			console.error('Error generando PDF Intereses:', error);
			toast.error('Error al generar el PDF de intereses de cesantías');
		}
	}

	function parseValues(values: any): any[] {
		if (Array.isArray(values)) return values;
		if (typeof values === 'string') {
			try {
				const parsed = JSON.parse(values);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		}
		return [];
	}

	// Agrupar bonificaciones por vehiculo
	function agruparBonificacionesPorVehiculo() {
		if (!liquidacion?.bonificaciones) return [];
		const map: Record<string, any> = {};
		liquidacion.bonificaciones.forEach((b: any) => {
			const vid = b.vehiculo_id;
			const valorUnitario = Number(b.value);
			if (!map[vid]) {
				map[vid] = { vehiculo: b.vehiculo, total: 0, bonos: [] };
			}
			let totalBono = 0;
			parseValues(b.values).forEach((m: any) => {
				totalBono += m.quantity * valorUnitario;
			});
			map[vid].bonos.push({ id: b.id, nombre: b.name, total: totalBono });
			map[vid].total += totalBono;
		});
		return Object.values(map).sort((a: any, b: any) =>
			(a.vehiculo?.placa || '').localeCompare(b.vehiculo?.placa || '')
		);
	}

	// Agrupar recargos por vehiculo
	interface RecargoDetalle {
		id: string;
		empresa: string;
		mes: string;
		valor: number;
		pagaCliente: boolean;
	}
	interface RecargoVehiculoGroup {
		vehiculo: any;
		total: number;
		detalles: RecargoDetalle[];
	}
	function agruparRecargosPorVehiculo(): RecargoVehiculoGroup[] {
		if (!liquidacion?.recargos) return [];
		const map: Record<string, any> = {};
		liquidacion.recargos.forEach((r: any) => {
			const vid = r.vehiculo_id;
			const valor = Number(r.valor);
			if (!map[vid]) {
				map[vid] = { vehiculo: r.vehiculo, total: 0, detalles: [] };
			}
			map[vid].detalles.push({
				id: r.id,
				empresa: r.empresa?.nombre || r.clientes?.nombre || 'N/A',
				mes: r.mes,
				valor,
				pagaCliente: r.pag_cliente
			});
			map[vid].total += valor;
		});
		return Object.values(map).sort((a: any, b: any) =>
			(a.vehiculo?.placa || '').localeCompare(b.vehiculo?.placa || '')
		);
	}

	// Agrupar pernotes por vehiculo
	function agruparPernotesPorVehiculo() {
		if (!liquidacion?.pernotes) return [];
		const map: Record<string, any> = {};
		liquidacion.pernotes.forEach((p: any) => {
			const vid = p.vehiculo_id;
			const valor = Number(p.valor);
			const cantidad = p.cantidad || (p.fechas ? p.fechas.length : 0);
			if (!map[vid]) {
				map[vid] = { vehiculo: p.vehiculo, total: 0, cantidadTotal: 0, detalles: [] };
			}
			map[vid].detalles.push({ id: p.id, fechas: p.fechas || [], valor, cantidad });
			map[vid].total += valor;
			map[vid].cantidadTotal += cantidad;
		});
		return Object.values(map).sort((a: any, b: any) =>
			(a.vehiculo?.placa || '').localeCompare(b.vehiculo?.placa || '')
		);
	}
</script>

{#if show}
	<!-- Overlay -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		style="padding: env(safe-area-inset-top, 16px) env(safe-area-inset-right, 16px) env(safe-area-inset-bottom, 16px) env(safe-area-inset-left, 16px);"
		on:click={cerrar}
		on:keydown={(e) => e.key === 'Escape' && cerrar()}
		role="button"
		tabindex="-1"
	>
		<!-- Modal Container -->
		<div
			class="relative flex max-h-[75vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Escape' && cerrar()}
			role="dialog"
			tabindex="0"
		>
			{#if loading}
				<!-- Loading -->
				<div class="flex flex-col items-center justify-center py-20">
					<div
						class="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
					></div>
					<p class="text-gray-600">Cargando liquidación...</p>
				</div>
			{:else if !liquidacion}
				<div class="py-20 text-center">
					<p class="text-gray-500">No se pudo cargar la liquidación</p>
					<button on:click={cerrar} class="mt-4 rounded-lg bg-gray-200 px-4 py-2 text-gray-700">
						Cerrar
					</button>
				</div>
			{:else}
				<!-- Header -->
				<div
					class="flex shrink-0 items-center justify-between rounded-t-2xl border-b border-gray-200 bg-white px-6 py-4"
				>
					<div>
						<h2 class="text-xl font-bold text-gray-900">Detalle de Liquidación</h2>
						<div class="mt-1 flex items-center gap-3">
							<p class="text-sm text-gray-500">{conductorNombre}</p>
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {getEstadoColor(
									liquidacion.estado
								)}"
							>
								{liquidacion.estado || 'Pendiente'}
							</span>
						</div>
					</div>
					<button
						on:click={cerrar}
						class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<!-- Tabs -->
				<div class="shrink-0 border-b border-gray-200 bg-white px-6">
					<div class="flex gap-1">
						{#each tabs as tab}
							<button
								on:click={() => (activeTab = tab.key)}
								class="border-b-2 px-4 py-3 text-sm font-medium transition-colors {activeTab ===
								tab.key
									? 'border-orange-500 text-orange-600'
									: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}"
							>
								{tab.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Content -->
				<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					<!-- ========== TAB: GENERAL ========== -->
					{#if activeTab === 'general'}
						<!-- Conductor & Estado -->
						<div class="mb-6 border-b border-gray-200 pb-6">
							<h4 class="mb-2 text-sm font-medium text-gray-500">INFORMACIÓN GENERAL</h4>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
								<div>
									<p class="text-sm text-gray-500">Conductor</p>
									<p class="text-base font-medium">{conductorNombre}</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Período</p>
									<p class="text-base font-medium">{periodoInicio}</p>
									<p class="text-sm text-gray-500">hasta {periodoFin}</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Estado</p>
									<span
										class="mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {getEstadoColor(
											liquidacion.estado
										)}"
									>
										{liquidacion.estado || 'Pendiente'}
									</span>
								</div>
							</div>
						</div>

						<!-- Datos Salariales -->
						<div class="mb-6 border-b border-gray-200 pb-6">
							<h4 class="mb-2 text-sm font-medium text-gray-500">DATOS SALARIALES</h4>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<p class="text-sm text-gray-500">Salario Devengado</p>
									<p class="text-base font-medium">
										{formatCurrency(liquidacion.salario_devengado)}
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Sueldo Total</p>
									<p class="text-base font-medium text-orange-600">
										{formatCurrency(liquidacion.sueldo_total || liquidacion.neto_pagado)}
									</p>
								</div>
							</div>
						</div>

						<!-- Días Laborados -->
						<div class="mb-6 border-b border-gray-200 pb-6">
							<h4 class="mb-2 text-sm font-medium text-gray-500">DÍAS LABORADOS</h4>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
								<div>
									<p class="text-sm text-gray-500">Total Días</p>
									<p class="text-base font-medium">{liquidacion.dias_laborados} días</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Días en Villanueva</p>
									<p class="text-base font-medium">
										{liquidacion.dias_laborados_villanueva} días
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Días Anuales</p>
									<p class="text-base font-medium">{liquidacion.dias_laborados_anual} días</p>
								</div>
							</div>
						</div>

						<!-- Vehículos -->
						{#if liquidacion.vehiculos && liquidacion.vehiculos.length > 0}
							<div class="mb-6 border-b border-gray-200 pb-6">
								<h4 class="mb-2 text-sm font-medium text-gray-500">VEHÍCULOS ASOCIADOS</h4>
								<div class="grid grid-cols-2 gap-2 md:grid-cols-5">
									{#each liquidacion.vehiculos as vehiculo}
										<div class="rounded bg-gray-50 p-2">
											<p class="font-medium">{vehiculo.placa}</p>
											<p class="text-xs text-gray-500">
												{vehiculo.marca || ''}
												{vehiculo.modelo || ''}
											</p>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Resumen Financiero -->
						<div class="mb-6 border-b border-gray-200 pb-6">
							<h4 class="mb-2 text-sm font-medium text-gray-500">RESUMEN FINANCIERO</h4>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
								<div>
									<p class="text-sm text-gray-500">Total Ingresos</p>
									<p class="text-base font-medium text-orange-600">
										{formatCurrency(
											(liquidacion.sueldo_total || liquidacion.neto_pagado || 0) +
												Math.abs(totalDeducciones)
										)}
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Total Deducciones</p>
									<p class="text-base font-medium text-red-600">
										{formatCurrency(totalDeducciones)}
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500">Neto a Pagar</p>
									<p class="text-base font-medium text-orange-600">
										{formatCurrency(netoAPagar)}
									</p>
								</div>
							</div>
						</div>

						<!-- Observaciones -->
						{#if liquidacion.observaciones}
							<div class="mb-6">
								<h4 class="mb-2 text-sm font-medium text-gray-500">OBSERVACIONES</h4>
								<p class="rounded bg-gray-50 p-3 text-sm text-gray-700">
									{liquidacion.observaciones}
								</p>
							</div>
						{/if}

						<!-- ========== TAB: CONCEPTOS ========== -->
					{:else if activeTab === 'conceptos'}
						<div class="mb-6 border-b border-gray-200 pb-6">
							<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
								<!-- Ingresos -->
								<div>
									<div class="space-y-2">
										<div class="flex justify-between">
											<span class="text-sm text-gray-500">Salario Base</span>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.salario_devengado)}</span
											>
										</div>
										<div class="flex justify-between">
											<span class="text-sm text-gray-500">Auxilio Transporte</span>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.auxilio_transporte)}</span
											>
										</div>

										<!-- Bonificaciones con expand -->
										<div class="flex items-center justify-between">
											<div class="flex items-center">
												<span class="text-sm text-gray-500">Bonificaciones</span>
												<button
													class="ml-1 text-gray-400 hover:text-gray-600"
													on:click={() => toggleSection('bonificaciones')}
												>
													{#if expandedSections.bonificaciones}
														<ChevronUp class="h-4 w-4" />
													{:else}
														<ChevronDown class="h-4 w-4" />
													{/if}
												</button>
											</div>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.total_bonificaciones)}</span
											>
										</div>

										{#if expandedSections.bonificaciones}
											{@const bonosVehiculo = agruparBonificacionesPorVehiculo()}
											{#if bonosVehiculo.length > 0}
												<div class="mt-2 space-y-3">
													{#each bonosVehiculo as item}
														<div class="overflow-hidden rounded-md border">
															<div class="flex items-center justify-between bg-gray-100 px-4 py-2">
																<div>
																	<span class="font-medium"
																		>{item.vehiculo?.marca || ''}
																		{item.vehiculo?.modelo || ''}</span
																	>
																	<span class="ml-2 text-sm font-bold"
																		>({item.vehiculo?.placa || 'N/A'})</span
																	>
																</div>
																<span class="text-right font-bold"
																	>{formatCurrency(item.total)}</span
																>
															</div>
															<div class="border-l-2 border-gray-200 p-2 pl-4">
																{#each item.bonos as bono}
																	<div class="my-1 flex justify-between text-xs">
																		<span class="text-gray-600">{bono.nombre}</span>
																		<span class="font-medium">{formatCurrency(bono.total)}</span>
																	</div>
																{/each}
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="text-gray-500 italic">No hay bonificaciones</p>
											{/if}
										{/if}

										<!-- Recargos con expand -->
										<div class="flex items-center justify-between">
											<div class="flex items-center">
												<span class="text-sm text-gray-500">Recargos</span>
												<button
													class="ml-1 text-gray-400 hover:text-gray-600"
													on:click={() => toggleSection('recargos')}
												>
													{#if expandedSections.recargos}
														<ChevronUp class="h-4 w-4" />
													{:else}
														<ChevronDown class="h-4 w-4" />
													{/if}
												</button>
											</div>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.total_recargos)}</span
											>
										</div>

										{#if expandedSections.recargos}
											{@const recargosVehiculo = agruparRecargosPorVehiculo()}
											{#if recargosVehiculo.length > 0}
												<div class="mt-2 space-y-3">
													{#each recargosVehiculo as item}
														<div class="overflow-hidden rounded-md border">
															<div class="flex items-center justify-between bg-gray-100 px-4 py-2">
																<div>
																	<span class="font-medium"
																		>{item.vehiculo?.marca || ''}
																		{item.vehiculo?.modelo || ''}</span
																	>
																	<span class="ml-2 text-sm font-bold"
																		>({item.vehiculo?.placa || 'N/A'})</span
																	>
																</div>
																<span class="text-right font-bold"
																	>{formatCurrency(item.total)}</span
																>
															</div>
															<div class="border-l-2 border-gray-200 p-2 pl-4">
																{#each item.detalles.sort( (a: RecargoDetalle, b: RecargoDetalle) => {
																		return (MESES_ORDER[a.mes] || 0) - (MESES_ORDER[b.mes] || 0);
																	} ) as detalle}
																	<div class="my-1 flex justify-between text-xs">
																		<div>
																			<span class="text-gray-600"
																				>{detalle.empresa}
																				{detalle.mes ? `(${detalle.mes})` : ''}</span
																			>
																			{#if detalle.pagaCliente}
																				<span
																					class="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-600"
																					>Paga Cliente</span
																				>
																			{/if}
																		</div>
																		<span class="font-medium">{formatCurrency(detalle.valor)}</span>
																	</div>
																{/each}
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="text-gray-500 italic">No hay recargos</p>
											{/if}
										{/if}

										<!-- Pernotes con expand -->
										<div class="flex items-center justify-between">
											<div class="flex items-center">
												<span class="text-sm text-gray-500">Pernotes</span>
												<button
													class="ml-1 text-gray-400 hover:text-gray-600"
													on:click={() => toggleSection('pernotes')}
												>
													{#if expandedSections.pernotes}
														<ChevronUp class="h-4 w-4" />
													{:else}
														<ChevronDown class="h-4 w-4" />
													{/if}
												</button>
											</div>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.total_pernotes)}</span
											>
										</div>

										{#if expandedSections.pernotes}
											{@const pernotesVehiculo = agruparPernotesPorVehiculo()}
											{#if pernotesVehiculo.length > 0}
												<div class="mt-2 space-y-3">
													{#each pernotesVehiculo as item}
														<div class="overflow-hidden rounded-md border">
															<div class="flex items-center justify-between bg-gray-100 px-4 py-2">
																<div>
																	<span class="font-medium"
																		>{item.vehiculo?.marca || ''}
																		{item.vehiculo?.modelo || ''}</span
																	>
																	<span class="ml-2 text-sm font-bold"
																		>({item.vehiculo?.placa || 'N/A'})</span
																	>
																	<span class="ml-2 text-sm text-gray-600"
																		>({item.cantidadTotal} noches)</span
																	>
																</div>
																<span class="text-right font-bold"
																	>{formatCurrency(item.total * item.cantidadTotal)}</span
																>
															</div>
															<div class="border-l-2 border-gray-200 p-2 pl-4">
																{#each item.detalles as detalle}
																	<div class="my-2">
																		<div class="mb-1 flex justify-between text-xs">
																			<span class="text-gray-600"
																				>Cantidad: {detalle.cantidad}
																				{detalle.cantidad > 1 ? 'noches' : 'noche'}</span
																			>
																			<span class="text-gray-600"
																				>Valor unitario: {formatCurrency(detalle.valor)}</span
																			>
																		</div>
																		{#if detalle.fechas && detalle.fechas.length > 0}
																			<div class="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
																				{#each detalle.fechas as fecha}
																					<span class="rounded bg-gray-100 px-1.5 py-0.5"
																						>{formatDateShort(fecha)}</span
																					>
																				{/each}
																			</div>
																		{/if}
																	</div>
																{/each}
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="text-gray-500 italic">No hay pernotes</p>
											{/if}
										{/if}

										<!-- Vacaciones -->
										<div class="flex justify-between">
											<span class="text-sm text-gray-500">Vacaciones</span>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.total_vacaciones)}</span
											>
										</div>

										{#if liquidacion.periodo_start_vacaciones && liquidacion.periodo_end_vacaciones}
											<div class="pl-4 text-xs text-gray-600 italic">
												Período: {formatDate(liquidacion.periodo_start_vacaciones)} -
												{formatDate(liquidacion.periodo_end_vacaciones)}
											</div>
										{/if}

										<!-- Incapacidad -->
										<div class="flex justify-between">
											<span class="text-sm text-gray-500">Incapacidad</span>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.valor_incapacidad)}</span
											>
										</div>

										{#if liquidacion.periodo_start_incapacidad && liquidacion.periodo_end_incapacidad}
											<div class="pl-4 text-xs text-gray-600 italic">
												Período: {formatDate(liquidacion.periodo_start_incapacidad)} -
												{formatDate(liquidacion.periodo_end_incapacidad)}
											</div>
										{/if}

										<!-- Ajuste Salarial -->
										<div class="flex justify-between">
											<span class="text-sm text-gray-500">Ajuste Salarial</span>
											<span class="text-sm font-medium"
												>{formatCurrency(liquidacion.ajuste_salarial)}</span
											>
										</div>

										<!-- Anticipos con expand -->
										<div class="flex items-center justify-between">
											<div class="flex items-center">
												<span class="text-sm text-gray-500">Anticipos</span>
												<button
													class="ml-1 text-gray-400 hover:text-gray-600"
													on:click={() => toggleSection('anticipos')}
												>
													{#if expandedSections.anticipos}
														<ChevronUp class="h-4 w-4" />
													{:else}
														<ChevronDown class="h-4 w-4" />
													{/if}
												</button>
											</div>
											<span class="text-sm font-medium text-red-600"
												>-{formatCurrency(liquidacion.total_anticipos)}</span
											>
										</div>

										{#if expandedSections.anticipos && liquidacion.anticipos && liquidacion.anticipos.length > 0}
											<div class="my-2 border-l-2 border-gray-200 pl-4">
												{#each liquidacion.anticipos as anticipo}
													<div class="my-1 flex justify-between text-xs">
														<span class="text-gray-600">
															{anticipo.concepto || 'Anticipo'}
															{anticipo.fecha ? `(${formatDate(anticipo.fecha)})` : ''}
														</span>
														<span class="font-medium text-red-600"
															>-{formatCurrency(anticipo.valor)}</span
														>
													</div>
												{/each}
											</div>
										{/if}
									</div>

									<!-- Total ingresos -->
									<div class="mt-4 border-t border-gray-200 pt-4">
										<div class="flex justify-between font-semibold">
											<span>Total</span>
											<span class="text-orange-600">
												{formatCurrency(
													(liquidacion.sueldo_total || liquidacion.neto_pagado || 0) +
														Math.abs(totalDeducciones)
												)}
											</span>
										</div>
									</div>
								</div>

								<!-- Deducciones -->
								<div>
									<div class="rounded-lg bg-gray-50 p-4">
										<h5 class="mb-3 font-medium text-gray-700">Deducciones</h5>
										<div class="space-y-2">
											<div class="flex justify-between">
												<span class="text-sm text-gray-500">Salud (4%)</span>
												<span class="text-sm font-medium">{formatCurrency(liquidacion.salud)}</span>
											</div>
											<div class="flex justify-between">
												<span class="text-sm text-gray-500">Pensión (4%)</span>
												<span class="text-sm font-medium"
													>{formatCurrency(liquidacion.pension)}</span
												>
											</div>
										</div>
										<div class="mt-4 border-t border-gray-200 pt-4">
											<div class="flex justify-between font-semibold">
												<span>Total Deducciones</span>
												<span class="text-red-600">{formatCurrency(totalDeducciones)}</span>
											</div>
										</div>
										<div class="mt-4 border-t border-gray-200 pt-4">
											<div class="flex justify-between text-lg font-bold">
												<span>Neto a Pagar</span>
												<span class="text-orange-600">{formatCurrency(netoAPagar)}</span>
											</div>
										</div>
									</div>

									<!-- Provisiones -->
									<div class="mt-4 rounded-lg bg-gray-50 p-4">
										<h5 class="mb-3 font-medium text-gray-700">Provisiones</h5>
										<div class="space-y-2">
											<div class="flex justify-between">
												<span class="text-sm text-gray-500">Cesantías</span>
												<span class="text-sm font-medium"
													>{formatCurrency(liquidacion.cesantias)}</span
												>
											</div>
											<div class="flex justify-between">
												<span class="text-sm text-gray-500">Interés de Cesantías</span>
												<span class="text-sm font-medium"
													>{formatCurrency(liquidacion.interes_cesantias)}</span
												>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
						<!-- ========== TAB: PROCESAMIENTO ========== -->
					{:else if activeTab === 'procesamiento'}
						<div class="space-y-6">
							<!-- Auditoría -->
							<div class="rounded-lg bg-gray-50 p-4">
								<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div>
										<div class="mb-3">
											<p class="text-xs text-gray-500">Creado por</p>
											<p class="flex items-center text-sm font-medium">
												<User class="mr-1 h-3 w-3 text-gray-400" />
												{creadoPor}
											</p>
											{#if liquidacion.created_at}
												<p class="mt-1 text-xs text-gray-500">
													{formatDateTime(liquidacion.created_at)}
												</p>
											{/if}
										</div>

										<div>
											<p class="text-xs text-gray-500">Liquidado por</p>
											<p class="flex items-center text-sm font-medium">
												<DollarSign class="mr-1 h-3 w-3 text-gray-400" />
												{liquidadoPor}
											</p>
											{#if liquidacion.fecha_liquidacion}
												<p class="mt-1 text-xs text-gray-500">
													{formatDateTime(liquidacion.fecha_liquidacion)}
												</p>
											{/if}
										</div>
									</div>

									<div>
										<div class="mb-3">
											<p class="text-xs text-gray-500">Última actualización por</p>
											<p class="flex items-center text-sm font-medium">
												<Pencil class="mr-1 h-3 w-3 text-gray-400" />
												{actualizadoPor}
											</p>
											{#if liquidacion.updated_at && liquidacion.actualizado_por_id}
												<p class="mt-1 text-xs text-gray-500">
													{formatDateTime(liquidacion.updated_at)}
												</p>
											{/if}
										</div>

										<div class="mb-3">
											<p class="text-xs text-gray-500">ID de liquidación</p>
											<p class="font-mono text-sm font-medium">{liquidacion.id}</p>
										</div>
									</div>
								</div>
							</div>

							<!-- Períodos -->
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div class="rounded-lg bg-gray-50 p-4">
									<h4 class="mb-4 flex items-center text-sm font-medium text-gray-700">
										<Calendar class="mr-2 h-4 w-4" /> PERÍODOS
									</h4>
									<div class="grid grid-cols-1 gap-3">
										<div class="rounded border border-gray-200 bg-white p-3">
											<p class="text-xs text-gray-500">Período de Nómina</p>
											<p class="text-sm font-medium">{periodoInicio} - {periodoFin}</p>
										</div>
										{#if liquidacion.periodo_start_vacaciones && liquidacion.periodo_end_vacaciones}
											<div class="rounded border border-gray-200 bg-white p-3">
												<p class="text-xs text-gray-500">Período de Vacaciones</p>
												<p class="text-sm font-medium">
													{formatDate(liquidacion.periodo_start_vacaciones)} -
													{formatDate(liquidacion.periodo_end_vacaciones)}
												</p>
											</div>
										{/if}
									</div>
								</div>

								<!-- Firma -->
								<div class="rounded-lg bg-gray-50 p-4">
									<h4 class="mb-4 flex items-center text-sm font-medium text-gray-700">
										<FileText class="mr-2 h-4 w-4" /> FIRMA DESPRENDIBLE
									</h4>
									{#if firmasLoading}
										<div class="flex items-center justify-center py-4">
											<Loader2 class="h-6 w-6 animate-spin text-gray-400" />
										</div>
									{:else if firmas.length > 0}
										<div>
											<h4 class="mb-2 font-medium text-gray-900">Detalles de la Firma</h4>
											{#each firmas as firma}
												<div class="flex items-center gap-2">
													<Calendar class="h-4 w-4 text-gray-500" />
													<p class="text-xs text-gray-500">
														Firmado el {formatDateTime(firma.fecha_firma)}
													</p>
												</div>
												{#if firma.presignedUrl}
													<img
														src={firma.presignedUrl}
														alt="Firma"
														class="mt-2 h-12 w-44 object-contain"
													/>
												{/if}
											{/each}
										</div>
									{:else}
										<p class="text-gray-400 italic">
											El presente desprendible de nómina no cuenta con firma de recibido por parte
											del conductor.
										</p>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Footer con botones PDF -->
				<div
					class="flex shrink-0 items-center justify-between rounded-b-2xl border-t border-gray-200 bg-white px-6 py-4"
				>
					<div class="flex gap-3">
						{#if mostrarBotonPrima}
							<button
								on:click={handleGeneratePrimaPDF}
								class="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
							>
								<FileText class="h-4 w-4" />
								Desprendible Prima
							</button>
						{/if}
						{#if mostrarBotonIntereses}
							<button
								on:click={handleGenerateInteresesPDF}
								class="flex items-center gap-2 rounded-lg bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100"
							>
								<FileText class="h-4 w-4" />
								Desprendible Intereses
							</button>
						{/if}
					</div>

					<button
						on:click={handleGeneratePDF}
						disabled={generatingPdf || firmasLoading}
						class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-5 py-2.5 font-medium text-white shadow-md transition-all hover:shadow-lg disabled:opacity-50"
					>
						{#if generatingPdf}
							<Loader2 class="h-4 w-4 animate-spin" />
							Generando...
						{:else}
							<Download class="h-4 w-4" />
							{firmas.length > 0 ? 'Descargar Desprendible (Firmado)' : 'Descargar Desprendible'}
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
