<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';
	import {
		ChevronDown,
		ChevronRight,
		Clock,
		Sun,
		Moon,
		Star,
		Shield,
		Truck,
		Building2,
		CalendarDays,
		DollarSign,
		Loader2,
		AlertCircle,
		RefreshCw
	} from 'lucide-svelte';
	import { obtenerPreviewRecargos } from '$lib/api/nomina';
	import type { PreviewRecargosResponse, PreviewRecargoPlanilla } from '$lib/api/nomina';
	import { toast } from 'svelte-sonner';

	export let conductorId: string = '';
	export let periodoInicio: string = '';
	export let periodoFin: string = '';

	const dispatch = createEventDispatcher();

	let previewData: PreviewRecargosResponse | null = null;
	let loading = false;
	let error = '';
	let expandedPlanillas: Set<string> = new Set();
	let expandedDias: Set<string> = new Set();

	$: canLoad = conductorId && periodoInicio && periodoFin;

	export async function cargarPreview() {
		if (!canLoad) return;

		loading = true;
		error = '';
		try {
			const result = await obtenerPreviewRecargos(conductorId, periodoInicio, periodoFin);
			previewData = result.data;

			// Auto-expand first planilla if exists
			if (previewData.planillas.length > 0) {
				expandedPlanillas = new Set([previewData.planillas[0].planilla_id]);
			}

			// Emitir el total de recargos para que el form lo use
			dispatch('recargosCalculated', {
				totalRecargos: previewData.resumen.total_general,
				detalle: previewData
			});
		} catch (err: any) {
			console.error('Error cargando preview de recargos:', err);
			error = err.message || 'Error al cargar el preview';
			toast.error('Error al cargar los recargos');
		} finally {
			loading = false;
		}
	}

	function togglePlanilla(id: string) {
		const newSet = new Set(expandedPlanillas);
		if (newSet.has(id)) newSet.delete(id);
		else newSet.add(id);
		expandedPlanillas = newSet;
	}

	function toggleDia(key: string) {
		const newSet = new Set(expandedDias);
		if (newSet.has(key)) newSet.delete(key);
		else newSet.add(key);
		expandedDias = newSet;
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(amount);
	}

	function formatHora(hora: number): string {
		const h = Math.floor(hora);
		const m = Math.round((hora - h) * 60);
		return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
	}

	function getTipoDiaBadge(tipoDia: string, disponibilidad: boolean) {
		if (disponibilidad) return { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' };
		switch (tipoDia) {
			case 'Festivo': return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' };
			case 'Domingo': return { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' };
			default: return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' };
		}
	}

	function getRecargoBadgeColor(codigo: string) {
		switch (codigo) {
			case 'HED': return 'bg-blue-100 text-blue-800';
			case 'HEN': return 'bg-indigo-100 text-indigo-800';
			case 'HEFD': return 'bg-orange-100 text-orange-800';
			case 'HEFN': return 'bg-red-100 text-red-800';
			case 'RN': return 'bg-violet-100 text-violet-800';
			case 'RD': return 'bg-purple-100 text-purple-800';
			default: return 'bg-gray-100 text-gray-800';
		}
	}
</script>

<div class="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-orange-200 px-5 py-4">
		<div class="flex items-center gap-3">
			<div class="rounded-lg bg-orange-100 p-2">
				<DollarSign class="h-5 w-5 text-orange-600" />
			</div>
			<div>
				<h3 class="text-lg font-bold text-gray-900">Desglose de Recargos</h3>
				<p class="text-xs text-gray-500">Detalle día a día basado en planillas registradas</p>
			</div>
		</div>
		<button
			on:click={cargarPreview}
			disabled={!canLoad || loading}
			class="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if loading}
				<Loader2 class="h-4 w-4 animate-spin" />
				Cargando...
			{:else}
				<RefreshCw class="h-4 w-4" />
				Consultar Recargos
			{/if}
		</button>
	</div>

	<!-- Content -->
	<div class="p-5">
		{#if !canLoad}
			<div class="rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-center">
				<AlertCircle class="mx-auto mb-2 h-8 w-8 text-yellow-500" />
				<p class="text-sm text-yellow-800">Seleccione un conductor y defina el período para consultar los recargos</p>
			</div>
		{:else if loading}
			<div class="flex flex-col items-center justify-center py-12">
				<Loader2 class="mb-3 h-10 w-10 animate-spin text-orange-500" />
				<p class="text-sm text-gray-500">Consultando planillas y calculando recargos...</p>
			</div>
		{:else if error}
			<div class="rounded-lg bg-red-50 border border-red-200 p-4 text-center">
				<AlertCircle class="mx-auto mb-2 h-8 w-8 text-red-500" />
				<p class="text-sm text-red-800">{error}</p>
				<button
					on:click={cargarPreview}
					class="mt-2 text-sm text-red-600 underline hover:text-red-800"
				>
					Reintentar
				</button>
			</div>
		{:else if previewData}
			{#if previewData.planillas.length === 0}
				<div class="rounded-lg bg-gray-50 border border-gray-200 p-6 text-center">
					<CalendarDays class="mx-auto mb-2 h-10 w-10 text-gray-400" />
					<p class="text-gray-600 font-medium">No se encontraron planillas registradas</p>
					<p class="text-sm text-gray-500 mt-1">El conductor no tiene planillas de recargos en el período seleccionado</p>
				</div>
			{:else}
				<!-- Configuración salarial -->
				{#if previewData.configuracion_salarial}
					<div class="mb-4 rounded-lg bg-white border border-gray-200 p-3">
						<div class="flex flex-wrap items-center gap-4 text-xs">
							<span class="font-semibold text-gray-700">Config. Salarial:</span>
							<span class="text-gray-600">
								Salario: <strong class="text-gray-900">{formatCurrency(previewData.configuracion_salarial.salario_basico)}</strong>
							</span>
							<span class="text-gray-600">
								Hora base: <strong class="text-orange-700">{formatCurrency(previewData.configuracion_salarial.valor_hora_trabajador)}</strong>
							</span>
							<span class="text-gray-600">
								{previewData.configuracion_salarial.horas_mensuales_base} hrs/mes
							</span>
							{#if previewData.configuracion_salarial.sede}
								<span class="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{previewData.configuracion_salarial.sede}</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Resumen general -->
				<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-lg bg-white border border-gray-200 p-3 text-center">
						<p class="text-xs text-gray-500">Planillas</p>
						<p class="text-xl font-bold text-gray-900">{previewData.resumen.total_planillas}</p>
					</div>
					<div class="rounded-lg bg-white border border-gray-200 p-3 text-center">
						<p class="text-xs text-gray-500">Días trabajados</p>
						<p class="text-xl font-bold text-gray-900">{previewData.resumen.total_dias_trabajados}</p>
					</div>
					<div class="rounded-lg bg-white border border-gray-200 p-3 text-center">
						<p class="text-xs text-gray-500">Horas totales</p>
						<p class="text-xl font-bold text-gray-900">{previewData.resumen.total_horas_trabajadas}</p>
					</div>
					<div class="rounded-lg bg-white border border-orange-300 p-3 text-center">
						<p class="text-xs text-orange-600">Total Recargos</p>
						<p class="text-xl font-bold text-orange-700">{formatCurrency(previewData.resumen.total_general)}</p>
					</div>
				</div>

				<!-- Resumen por tipo de recargo -->
				{#if previewData.resumen_tipos.length > 0}
					<div class="mb-4 rounded-lg bg-white border border-gray-200 overflow-hidden">
						<div class="bg-gray-50 px-4 py-2 border-b border-gray-200">
							<h4 class="text-xs font-semibold text-gray-700 uppercase tracking-wider">Resumen por tipo</h4>
						</div>
						<div class="divide-y divide-gray-100">
							{#each previewData.resumen_tipos as tipo}
								<div class="flex items-center justify-between px-4 py-2">
									<div class="flex items-center gap-2">
										<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {getRecargoBadgeColor(tipo.codigo)}">
											{tipo.codigo}
										</span>
										<span class="text-sm text-gray-700">{tipo.nombre}</span>
										<span class="text-xs text-gray-400">
											({tipo.es_hora_extra ? `base + ${tipo.porcentaje}%` : `base × ${tipo.porcentaje}%`})
										</span>
									</div>
									<div class="flex items-center gap-4 text-sm">
										<span class="text-gray-500">{tipo.totalHoras}h</span>
										<span class="font-semibold text-gray-900">{formatCurrency(tipo.valorTotal)}</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Planillas detalladas -->
				<div class="space-y-3">
					{#each previewData.planillas as planilla (planilla.planilla_id)}
						<div class="rounded-lg bg-white border border-gray-200 overflow-hidden">
							<!-- Header de planilla (clickeable) -->
							<button
								on:click={() => togglePlanilla(planilla.planilla_id)}
								class="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
							>
								<div class="flex items-center gap-3">
									{#if expandedPlanillas.has(planilla.planilla_id)}
										<ChevronDown class="h-4 w-4 text-gray-500" />
									{:else}
										<ChevronRight class="h-4 w-4 text-gray-500" />
									{/if}
									<div class="flex items-center gap-2">
										<Truck class="h-4 w-4 text-gray-500" />
										<span class="font-semibold text-gray-900">{planilla.vehiculo.placa}</span>
									</div>
									<span class="text-gray-400">|</span>
									<div class="flex items-center gap-1">
										<Building2 class="h-3.5 w-3.5 text-gray-400" />
										<span class="text-sm text-gray-600">{planilla.empresa.nombre}</span>
									</div>
									{#if planilla.numero_planilla}
										<span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">#{planilla.numero_planilla}</span>
									{/if}
								</div>
								<div class="flex items-center gap-4">
									<span class="text-xs text-gray-500">{planilla.total_dias} días · {planilla.total_horas}h</span>
									<span class="font-semibold text-orange-700">{formatCurrency(planilla.total_valor)}</span>
								</div>
							</button>

							<!-- Detalle de días (expandible) -->
							{#if expandedPlanillas.has(planilla.planilla_id)}
								<div transition:slide={{ duration: 200 }} class="border-t border-gray-200">
									{#each planilla.dias as dia, dIdx}
										{@const diaKey = `${planilla.planilla_id}-${dia.dia}`}
										{@const badge = getTipoDiaBadge(dia.tipo_dia, dia.disponibilidad)}
										<div class="border-b border-gray-100 last:border-b-0">
											<!-- Fila del día -->
											<button
												on:click={() => toggleDia(diaKey)}
												class="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
											>
												<div class="flex items-center gap-3">
													{#if expandedDias.has(diaKey)}
														<ChevronDown class="h-3.5 w-3.5 text-gray-400" />
													{:else}
														<ChevronRight class="h-3.5 w-3.5 text-gray-400" />
													{/if}

													<div class="flex items-center gap-2">
														<span class="text-sm font-medium text-gray-800 w-28">{dia.fecha}</span>
														<span class="text-xs text-gray-500 capitalize w-8">{dia.nombre_dia}</span>
													</div>

													<!-- Tipo de día badge -->
													<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {badge.bg} {badge.text} {badge.border}">
														{#if dia.es_festivo}
															<Star class="mr-1 h-3 w-3" />
														{:else if dia.es_domingo}
															<Sun class="mr-1 h-3 w-3" />
														{/if}
														{dia.tipo_dia}
													</span>

													{#if dia.disponibilidad}
														<span class="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
															<Shield class="mr-1 h-3 w-3" />
															Disponibilidad
														</span>
													{/if}

													<!-- Horario -->
													<div class="flex items-center gap-1 text-xs text-gray-500">
														<Clock class="h-3 w-3" />
														{formatHora(dia.hora_inicio)} - {formatHora(dia.hora_fin)}
														<span class="ml-1 font-medium text-gray-700">({dia.total_horas}h)</span>
													</div>
												</div>

												<div class="flex items-center gap-2">
													<!-- Mini badges de recargos -->
													<div class="flex gap-1">
														{#each dia.recargos as rec}
															<span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium {getRecargoBadgeColor(rec.tipo_codigo)}">
																{rec.tipo_codigo} {rec.horas}h
															</span>
														{/each}
													</div>
													<span class="font-semibold text-sm text-gray-900">{formatCurrency(dia.total_valor_dia)}</span>
												</div>
											</button>

											<!-- Detalle expandido del día -->
											{#if expandedDias.has(diaKey)}
												<div transition:slide={{ duration: 150 }} class="bg-gray-50 px-6 py-3">
													<table class="w-full text-xs">
														<thead>
															<tr class="text-gray-500 border-b border-gray-200">
																<th class="py-1 text-left font-medium">Tipo</th>
																<th class="py-1 text-left font-medium">Concepto</th>
																<th class="py-1 text-right font-medium">Horas</th>
																<th class="py-1 text-right font-medium">% Recargo</th>
																<th class="py-1 text-right font-medium">Valor Hora Base</th>
																<th class="py-1 text-right font-medium">Valor Hora Calculada</th>
																<th class="py-1 text-right font-medium">Total</th>
															</tr>
														</thead>
														<tbody>
															{#each dia.recargos as rec}
																<tr class="border-b border-gray-100 last:border-b-0">
																	<td class="py-1.5">
																		<span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium {getRecargoBadgeColor(rec.tipo_codigo)}">
																			{rec.tipo_codigo}
																		</span>
																	</td>
																	<td class="py-1.5 text-gray-700">
																		{rec.tipo_nombre}
																		{#if rec.es_hora_extra}
																			<span class="text-[10px] text-gray-400">(Extra)</span>
																		{/if}
																	</td>
																	<td class="py-1.5 text-right font-medium text-gray-900">{rec.horas}</td>
																	<td class="py-1.5 text-right text-gray-600">
																		{#if rec.es_hora_extra}
																			+{rec.porcentaje}%
																		{:else}
																			{rec.porcentaje}%
																		{/if}
																	</td>
																	<td class="py-1.5 text-right text-gray-600">{formatCurrency(rec.valor_hora_base)}</td>
																	<td class="py-1.5 text-right font-medium text-orange-700">{formatCurrency(rec.valor_hora_calculada)}</td>
																	<td class="py-1.5 text-right font-bold text-gray-900">{formatCurrency(rec.valor_total)}</td>
																</tr>
															{/each}
														</tbody>
														<tfoot>
															<tr class="border-t border-gray-300">
																<td colspan="6" class="py-1.5 text-right font-semibold text-gray-700">Total día:</td>
																<td class="py-1.5 text-right font-bold text-orange-700">{formatCurrency(dia.total_valor_dia)}</td>
															</tr>
														</tfoot>
													</table>

													<!-- Fórmula explicativa -->
													<div class="mt-2 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-[10px] text-blue-700">
														{#each dia.recargos as rec}
															<div class="mb-0.5">
																<strong>{rec.tipo_codigo}:</strong>
																{#if rec.es_hora_extra}
																	{rec.horas}h × ({formatCurrency(rec.valor_hora_base)} + {formatCurrency(rec.valor_hora_base)} × {rec.porcentaje}%) = {formatCurrency(rec.valor_total)}
																{:else}
																	{rec.horas}h × ({formatCurrency(rec.valor_hora_base)} × {rec.porcentaje}%) = {formatCurrency(rec.valor_total)}
																{/if}
															</div>
														{/each}
													</div>
												</div>
											{/if}
										</div>
									{/each}

									<!-- Total planilla -->
									<div class="bg-orange-50 border-t border-orange-200 px-4 py-2.5 flex items-center justify-between">
										<span class="text-sm font-medium text-orange-800">
											Total planilla {planilla.vehiculo.placa} - {planilla.empresa.nombre}
										</span>
										<span class="text-base font-bold text-orange-700">{formatCurrency(planilla.total_valor)}</span>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Gran total -->
				<div class="mt-4 rounded-lg bg-orange-600 px-5 py-4 flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-orange-100">Total General Recargos</p>
						<p class="text-xs text-orange-200">
							{previewData.resumen.total_planillas} planillas · {previewData.resumen.total_dias_trabajados} días · {previewData.resumen.total_horas_trabajadas}h
						</p>
					</div>
					<p class="text-2xl font-bold text-white">{formatCurrency(previewData.resumen.total_general)}</p>
				</div>
			{/if}
		{:else}
			<div class="rounded-lg bg-gray-50 border border-gray-200 p-6 text-center">
				<DollarSign class="mx-auto mb-2 h-10 w-10 text-gray-300" />
				<p class="text-gray-500 text-sm">Presione "Consultar Recargos" para ver el desglose detallado</p>
			</div>
		{/if}
	</div>
</div>
