<script lang="ts">
	import { createEventDispatcher, onMount, tick } from 'svelte';
	import {
		DollarSign,
		Loader2,
		AlertCircle,
		RefreshCw,
		Truck,
		Building2,
		CalendarDays
	} from 'lucide-svelte';
	import { obtenerPreviewRecargos } from '$lib/api/nomina';
	import type { PreviewRecargosResponse } from '$lib/api/nomina';
	import { toast } from 'svelte-sonner';

	// ── Interfaz de agrupación ──
	interface GrupoRecargo {
		key: string;
		vehiculoId: string;
		vehiculoPlaca: string;
		mes: number;
		año: number;
		mesLabel: string;
		empresaId: string;
		empresaNombre: string;
		totalValor: number;
		pagCliente: boolean;
		porcentajePropietario: number;
	}

	export let conductorId: string = '';
	export let periodoInicio: string = '';
	export let periodoFin: string = '';
	/** Cached previewData from parent to restore on re-mount without re-fetching */
	export let cachedPreviewData: PreviewRecargosResponse | null = null;
	/** Cached per-grupo overrides (pagCliente / porcentajePropietario) keyed by grupo.key */
	export let cachedGrupoOverrides: Record<string, { pagCliente: boolean; porcentajePropietario: number }> = {};

	const dispatch = createEventDispatcher();

	let previewData: PreviewRecargosResponse | null = cachedPreviewData;
	let loading = false;
	let error = '';

	$: canLoad = conductorId && periodoInicio && periodoFin;

	const MESES_NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

	let grupos: GrupoRecargo[] = [];

	$: grupos = agruparDatos(previewData, cachedGrupoOverrides);
	$: totalGeneral = grupos.reduce((sum, g) => sum + g.totalValor, 0);

	function agruparDatos(data: PreviewRecargosResponse | null, _overrides: Record<string, { pagCliente: boolean; porcentajePropietario: number }>): GrupoRecargo[] {
		if (!data || !data.planillas.length) return [];

		const map = new Map<string, GrupoRecargo>();

		for (const planilla of data.planillas) {
			const key = `${planilla.vehiculo.id}-${planilla.año}-${String(planilla.mes).padStart(2, '0')}-${planilla.empresa.id}`;
			if (!map.has(key)) {
				const override = cachedGrupoOverrides[key];
				map.set(key, {
					key,
					vehiculoId: planilla.vehiculo.id,
					vehiculoPlaca: planilla.vehiculo.placa,
					mes: planilla.mes,
					año: planilla.año,
					mesLabel: `${MESES_NOMBRES[planilla.mes] || planilla.mes} ${planilla.año}`,
					empresaId: planilla.empresa.id,
					empresaNombre: planilla.empresa.nombre,
					totalValor: 0,
					pagCliente: override?.pagCliente ?? false,
					porcentajePropietario: override?.porcentajePropietario ?? 0
				});
			}
			const grupo = map.get(key)!;
			grupo.totalValor += (planilla.total_valor || 0);
		}

		return Array.from(map.values())
			.filter(g => Math.round(g.totalValor) > 0)
			.map(g => ({ ...g, totalValor: Math.round(g.totalValor) }))
			.sort((a, b) => {
				const v = a.vehiculoPlaca.localeCompare(b.vehiculoPlaca);
				if (v !== 0) return v;
				const m = (a.año * 100 + a.mes) - (b.año * 100 + b.mes);
				if (m !== 0) return m;
				return a.empresaNombre.localeCompare(b.empresaNombre);
			});
	}

	export async function cargarPreview() {
		if (!canLoad) return;

		loading = true;
		error = '';
		try {
			const result = await obtenerPreviewRecargos(conductorId, periodoInicio, periodoFin);
			previewData = result.data;
			// Esperar a que Svelte ejecute las declaraciones reactivas ($: grupos = ...)
			// para que emitirDatos lea los grupos ya actualizados con overrides
			await tick();
			emitirDatos();
		} catch (err: any) {
			console.error('Error cargando preview de recargos:', err);
			error = err.message || 'Error al cargar el preview';
			toast.error('Error al cargar los recargos');
		} finally {
			loading = false;
		}
	}

	function emitirDatos() {
		const totalRecargos = grupos.reduce((sum, g) => sum + g.totalValor, 0);
		dispatch('recargosCalculated', {
			totalRecargos,
			detalle: previewData,
			grupos: grupos.map(g => ({
				key: g.key,
				vehiculo_id: g.vehiculoId,
				vehiculo_placa: g.vehiculoPlaca,
				empresa_id: g.empresaId,
				empresa_nombre: g.empresaNombre,
				mes: `${g.año}-${String(g.mes).padStart(2, '0')}`,
				valor: g.totalValor,
				pag_cliente: g.pagCliente,
				porcentaje_propietario: g.porcentajePropietario
			}))
		});
	}

	function handlePagClienteChange(key: string, checked: boolean) {
		grupos = grupos.map(g => {
			if (g.key === key) {
				return { ...g, pagCliente: checked, porcentajePropietario: checked ? g.porcentajePropietario : 0 };
			}
			return g;
		});
		emitirDatos();
	}

	function handlePorcentajeChange(key: string, value: number) {
		grupos = grupos.map(g => {
			if (g.key === key) {
				return { ...g, porcentajePropietario: Math.min(100, Math.max(0, value)) };
			}
			return g;
		});
		emitirDatos();
	}

	onMount(async () => {
		if (previewData) {
			// Already have cached data from parent — wait for reactive update then re-emit
			await tick();
			emitirDatos();
			return;
		}
		if (canLoad) {
			cargarPreview();
		}
	});

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(amount));
	}
</script>

<div class="rounded-md border border-gray-200 bg-white">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
		<div class="flex items-center gap-2">
			<DollarSign class="h-4 w-4 text-gray-500" />
			<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Recargos de Planillas</h3>
		</div>
		<button
			on:click={cargarPreview}
			disabled={!canLoad || loading}
			class="flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if loading}
				<Loader2 class="h-3.5 w-3.5 animate-spin" />
				Calculando...
			{:else}
				<RefreshCw class="h-3.5 w-3.5" />
				Recalcular
			{/if}
		</button>
	</div>

	<!-- Content -->
	<div class="p-4">
		{#if !canLoad}
			<div class="rounded-md bg-gray-50 border border-gray-200 p-4 text-center">
				<AlertCircle class="mx-auto mb-1.5 h-6 w-6 text-gray-400" />
				<p class="text-xs text-gray-500">Seleccione conductor y período para calcular recargos</p>
			</div>
		{:else if loading}
			<div class="flex flex-col items-center justify-center py-8">
				<Loader2 class="mb-2 h-7 w-7 animate-spin text-gray-400" />
				<p class="text-xs text-gray-500">Consultando planillas y calculando recargos...</p>
			</div>
		{:else if error}
			<div class="rounded-md bg-red-50 border border-red-200 p-3 text-center">
				<p class="text-xs text-red-700">{error}</p>
				<button
					on:click={cargarPreview}
					class="mt-1.5 text-xs text-red-500 underline hover:text-red-700"
				>
					Reintentar
				</button>
			</div>
		{:else if previewData}
			{#if grupos.length === 0}
				<div class="rounded-md bg-gray-50 border border-gray-200 p-4 text-center">
					<p class="text-xs text-gray-500">No se encontraron recargos mayores a $0 en el período</p>
				</div>
			{:else}
				<!-- Tabla de recargos agrupados -->
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="border-b border-gray-200">
								<th class="py-2 text-left font-medium text-gray-500">
									<div class="flex items-center gap-1"><Truck class="h-3 w-3" /> Vehículo</div>
								</th>
								<th class="py-2 text-left font-medium text-gray-500">
									<div class="flex items-center gap-1"><CalendarDays class="h-3 w-3" /> Mes</div>
								</th>
								<th class="py-2 text-left font-medium text-gray-500">
									<div class="flex items-center gap-1"><Building2 class="h-3 w-3" /> Empresa</div>
								</th>
								<th class="py-2 text-right font-medium text-gray-500">Valor</th>
								<th class="py-2 text-center font-medium text-gray-500">Paga Cliente</th>
								<th class="py-2 text-center font-medium text-gray-500">% Propietario</th>
							</tr>
						</thead>
						<tbody>
							{#each grupos as grupo (grupo.key)}
								<tr class="border-b border-gray-100 hover:bg-gray-50">
									<td class="py-2.5 font-medium text-gray-800">{grupo.vehiculoPlaca}</td>
									<td class="py-2.5 text-gray-600">{grupo.mesLabel}</td>
									<td class="py-2.5 text-gray-600">{grupo.empresaNombre}</td>
									<td class="py-2.5 text-right font-semibold text-gray-900">{formatCurrency(grupo.totalValor)}</td>
									<td class="py-2.5 text-center">
										<input
											type="checkbox"
											checked={grupo.pagCliente}
											on:change={(e) => handlePagClienteChange(grupo.key, e.currentTarget.checked)}
											class="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
										/>
									</td>
									<td class="py-2.5 text-center">
										{#if grupo.pagCliente}
											<div class="inline-flex items-center gap-0.5">
												<input
													type="number"
													value={grupo.porcentajePropietario}
													on:input={(e) => handlePorcentajeChange(grupo.key, parseFloat(e.currentTarget.value) || 0)}
													min="0"
													max="100"
													step="1"
													placeholder="0"
													class="w-16 rounded border border-gray-200 px-2 py-1 text-center text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
												/>
												<span class="text-[10px] text-gray-400">%</span>
											</div>
										{:else}
											<span class="text-gray-300">—</span>
										{/if}
									</td>
								</tr>
								{#if grupo.pagCliente && grupo.porcentajePropietario > 0}
									<tr class="border-b border-gray-100 bg-gray-50/50">
										<td colspan="6" class="py-1.5 pl-6 text-[11px] text-gray-400">
											↳ Propietario reconoce {grupo.porcentajePropietario}% = {formatCurrency(grupo.totalValor * grupo.porcentajePropietario / 100)} · Cliente asume {formatCurrency(grupo.totalValor * (100 - grupo.porcentajePropietario) / 100)}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
						<tfoot>
							<tr class="border-t border-gray-300">
								<td colspan="3" class="py-2.5 text-right text-xs font-semibold text-gray-700">Total Recargos</td>
								<td class="py-2.5 text-right font-bold text-emerald-700">{formatCurrency(totalGeneral)}</td>
								<td colspan="2"></td>
							</tr>
						</tfoot>
					</table>
				</div>

				<!-- Info resumen -->
				{#if previewData.resumen}
					<div class="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-400">
						<span>{previewData.resumen.total_planillas} planillas</span>
						<span>·</span>
						<span>{previewData.resumen.total_dias_trabajados} días</span>
						<span>·</span>
						<span>{previewData.resumen.total_horas_trabajadas}h trabajadas</span>
					</div>
				{/if}
			{/if}
		{:else}
			<div class="rounded-md bg-gray-50 border border-gray-200 p-4 text-center">
				<p class="text-xs text-gray-400">Los recargos se calcularán automáticamente</p>
			</div>
		{/if}
	</div>
</div>
