<script lang="ts">
	import { createEventDispatcher, onMount, tick } from 'svelte';
	import {
		DollarSign,
		Loader2,
		AlertCircle,
		RefreshCw,
		Truck,
		Building2,
		CalendarDays,
		BarChart3
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
		numeroPlanilla: string | null;
		emisor: string;
		/// IDs de las planillas que componen este grupo (para enviar al backend
		/// como origen_planilla_id y permitir upsert idempotente).
		origenPlanillaIds: string[];
		totalValor: number;
		pagCliente: boolean;
		porcentajePropietario: number;
		incluir: boolean;
	}

	export let conductorId: string = '';
	export let periodoInicio: string = '';
	export let periodoFin: string = '';
	/** Cached previewData from parent to restore on re-mount without re-fetching */
	export let cachedPreviewData: PreviewRecargosResponse | null = null;
	/** Cached per-grupo overrides (pagCliente / porcentajePropietario) keyed by grupo.key */
	export let cachedGrupoOverrides: Record<string, { pagCliente: boolean; porcentajePropietario: number; incluir?: boolean }> = {};
	/**
	 * Recargos ya persistidos en la liquidación (manuales + automáticos).
	 * Se usa para detectar duplicidad visual y mostrar el badge "Ya incluido".
	 * Estructura: { vehiculo_id, empresa_id, mes, es_automatico }
	 */
	export let recargosExistentes: Array<{ vehiculo_id: string; empresa_id: string; mes: string; es_automatico?: boolean; es_override?: boolean; origen_planilla_id?: string | null }> = [];

	const dispatch = createEventDispatcher();

	let previewData: PreviewRecargosResponse | null = cachedPreviewData;
	let loading = false;
	let error = '';

	$: canLoad = conductorId && periodoInicio && periodoFin;

	const MESES_NOMBRES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

	let grupos: GrupoRecargo[] = [];

	$: grupos = agruparDatos(previewData, cachedGrupoOverrides);
	$: totalGeneral = grupos.filter(g => g.incluir).reduce((sum, g) => sum + g.totalValor, 0);

	// Set de keys de grupos automáticos ya persistidos en la liquidación.
	// Se construye comparando (vehiculo_id, empresa_id, mes YYYY-MM) contra recargosExistentes.
	$: keysYaIncluidos = new Set(
		recargosExistentes
			.filter((r) => r.es_automatico)
			.map((r) => `${r.vehiculo_id}-${r.mes}-${r.empresa_id}`)
	);
	$: totalYaIncluidos = grupos
		.filter((g) => keysYaIncluidos.has(`${g.vehiculoId}-${`${g.año}-${String(g.mes).padStart(2, '0')}`}-${g.empresaId}`))
		.reduce((sum, g) => sum + g.totalValor, 0);

	// Set de planillas (origen_planilla_id) que tienen un override manual activo.
	// Se usa para mostrar el badge "✏️ Override" en la fila correspondiente del
	// preview y diferenciar visualmente entre un automático "limpio" y uno
	// sobreescrito por un recargo manual.
	$: planillasConOverride = new Set(
		recargosExistentes
			.filter((r) => r.es_override && r.origen_planilla_id)
			.map((r) => r.origen_planilla_id as string)
	);

	function agruparDatos(data: PreviewRecargosResponse | null, _overrides: Record<string, { pagCliente: boolean; porcentajePropietario: number }>): GrupoRecargo[] {
		if (!data || !data.planillas.length) return [];

		const map = new Map<string, GrupoRecargo>();

		for (const planilla of data.planillas) {
			const emisor = planilla.numero_planilla?.toUpperCase().includes('COTRANSMEQ') ? 'COTRANSMEQ' : 'TRANSMERALDA';
			const key = `${planilla.vehiculo.id}-${planilla.año}-${String(planilla.mes).padStart(2, '0')}-${planilla.empresa.id}-${emisor}`;
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
				numeroPlanilla: planilla.numero_planilla || null,
				emisor,
				origenPlanillaIds: [],
				totalValor: 0,
				pagCliente: override?.pagCliente ?? false,
				porcentajePropietario: override?.porcentajePropietario ?? 0,
				incluir: override?.incluir ?? true
			});
		}
		const grupo = map.get(key)!;
		grupo.totalValor += (planilla.total_valor || 0);
		// Acumular origen_planilla_id para idempotencia en el backend
		if (planilla.planilla_id && !grupo.origenPlanillaIds.includes(planilla.planilla_id)) {
			grupo.origenPlanillaIds.push(planilla.planilla_id);
		}
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
			if(!result){
				throw new Error('Error al obtener recargos automaticos')
			}

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
		const totalRecargos = grupos.filter(g => g.incluir).reduce((sum, g) => sum + g.totalValor, 0);
		// Expandir cada grupo en N entradas (una por cada origen_planilla_id)
		// para permitir upsert idempotente en el backend. La config del grupo
		// (pagCliente, porcentajePropietario, incluir) se comparte.
		const gruposExpandidos: any[] = [];
		for (const g of grupos) {
			if (!g.origenPlanillaIds.length) {
				// Fallback sin origen (no debería pasar, pero defensivo)
				gruposExpandidos.push({
					key: g.key,
					vehiculo_id: g.vehiculoId,
					vehiculo_placa: g.vehiculoPlaca,
					empresa_id: g.empresaId,
					empresa_nombre: g.empresaNombre,
					mes: `${g.año}-${String(g.mes).padStart(2, '0')}`,
					valor: g.totalValor,
					pag_cliente: g.pagCliente,
					porcentaje_propietario: g.porcentajePropietario,
					numero_planilla: g.numeroPlanilla,
					emisor: g.emisor,
					origen_planilla_id: null as string | null,
					incluir: g.incluir
				});
			} else {
				for (const planillaId of g.origenPlanillaIds) {
					gruposExpandidos.push({
						key: g.key,
						vehiculo_id: g.vehiculoId,
						vehiculo_placa: g.vehiculoPlaca,
						empresa_id: g.empresaId,
						empresa_nombre: g.empresaNombre,
						mes: `${g.año}-${String(g.mes).padStart(2, '0')}`,
						valor: g.totalValor,
						pag_cliente: g.pagCliente,
						porcentaje_propietario: g.porcentajePropietario,
						numero_planilla: g.numeroPlanilla,
						emisor: g.emisor,
						origen_planilla_id: planillaId,
						incluir: g.incluir
					});
				}
			}
		}

		dispatch('recargosCalculated', {
			totalRecargos,
			detalle: previewData,
			grupos: gruposExpandidos
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

	function handleIncluirChange(key: string, checked: boolean) {
		grupos = grupos.map(g => {
			if (g.key === key) {
				return { ...g, incluir: checked };
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

	// Trigger reactivo: en el single-page layout el componente se monta antes de
	// que el usuario haya seleccionado conductor/fechas (o en edit, antes de que
	// el padre termine `cargarDatosIniciales`). Cuando `canLoad` pasa a true
	// con params nuevos, disparamos la carga automáticamente.
	let lastAutoLoadKey = '';
	$: {
		const autoLoadKey = `${conductorId}|${periodoInicio}|${periodoFin}`;
		if (canLoad && autoLoadKey !== lastAutoLoadKey) {
			// Solo auto-cargar si NO hay datos cacheados que coincidan con los
			// params actuales (caso edit con cachedPreviewData)
			const cachedMatchesParams =
				previewData &&
				conductorId &&
				periodoInicio &&
				periodoFin &&
				previewData.conductor_id === conductorId &&
				previewData.periodo?.inicio === periodoInicio &&
				previewData.periodo?.fin === periodoFin;

			if (!cachedMatchesParams) {
				lastAutoLoadKey = autoLoadKey;
				cargarPreview();
			} else {
				lastAutoLoadKey = autoLoadKey;
			}
		}
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(amount));
	}
</script>

<div class="rounded-xl border border-[var(--border-subtle)] bg-white shadow-[var(--shadow-card)]">
	<!-- Header -->
	<div class="flex flex-col gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<DollarSign class="h-4 w-4 text-[var(--text-muted)]" />
			<h3 class="font-mono-meta text-[0.7rem] text-[var(--text-muted)]">Recargos de Planillas</h3>
		</div>
		<div class="grid grid-cols-2 gap-1.5 sm:flex sm:items-center">
			<button
				on:click={() => dispatch('openDesglose')}
				disabled={!previewData || !previewData.planillas?.length}
				class="apple-transition flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
				style="color: #047857; background: linear-gradient(135deg, rgba(16, 185, 129, 0.10), rgba(5, 150, 105, 0.06)); border-color: rgba(16, 185, 129, 0.30);"
				title="Ver desglose detallado por día, tipo de recargo, configuración salarial, etc."
			>
				<BarChart3 class="h-3.5 w-3.5" />
				Ver desglose
			</button>
			<button
				on:click={cargarPreview}
				disabled={!canLoad || loading}
				class="apple-transition flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:border-[var(--border-emphasis)] disabled:opacity-50 disabled:cursor-not-allowed"
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
	</div>

	<!-- Content -->
	<div class="p-4">
		{#if !canLoad}
			<div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-center">
				<AlertCircle class="mx-auto mb-1.5 h-6 w-6 text-[var(--text-very-muted)]" />
				<p class="text-xs text-[var(--text-muted)]">Seleccione conductor y período para calcular recargos</p>
			</div>
		{:else if loading}
			<div class="flex flex-col items-center justify-center py-8">
				<Loader2 class="mb-2 h-7 w-7 animate-spin text-[var(--text-very-muted)]" />
				<p class="text-xs text-[var(--text-muted)]">Consultando planillas y calculando recargos...</p>
			</div>
		{:else if error}
			<div class="alert alert-error">
				<AlertCircle />
				<div class="flex-1 text-center">
					<p class="text-xs">{error}</p>
					<button
						on:click={cargarPreview}
						class="mt-1.5 text-xs underline hover:opacity-80"
					>
						Reintentar
					</button>
				</div>
			</div>
		{:else if previewData}
			{#if grupos.length === 0}
				<div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-center">
					<p class="text-xs text-[var(--text-muted)]">No se encontraron recargos mayores a $0 en el período</p>
				</div>
			{:else}
				<!-- Banner de resumen: cuántos ya están incluidos -->
				{#if keysYaIncluidos.size > 0}
					<div class="mb-3 flex items-center gap-2 rounded-lg border border-[rgba(16,185,129,0.20)] bg-[rgba(16,185,129,0.08)] px-3 py-2">
						<svg
							class="h-3.5 w-3.5 flex-shrink-0 text-[var(--emerald-600)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2.5"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						<span class="text-xs font-medium text-[var(--emerald-700)]">
							{keysYaIncluidos.size} recargo{keysYaIncluidos.size !== 1 ? 's' : ''} ya incluido{keysYaIncluidos.size !== 1 ? 's' : ''} ({formatCurrency(totalYaIncluidos)})
							<span class="font-normal text-[var(--text-muted)]">
								— editable{keysYaIncluidos.size !== 1 ? 's' : ''} (Paga Cliente / % Propietario); los cambios se guardan al pulsar "Guardar Liquidación"
							</span>
						</span>
					</div>
				{/if}

				<!-- Tabla de recargos agrupados -->
				<div class="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
					<table class="w-full text-xs">
						<thead>
							<tr class="table-header">
								<th class="text-left">
									<div class="flex items-center gap-1"><Truck class="h-3 w-3" /> Vehículo</div>
								</th>
								<th class="text-left">
									<div class="flex items-center gap-1"><CalendarDays class="h-3 w-3" /> Mes</div>
								</th>
								<th class="text-left">
									<div class="flex items-center gap-1"><Building2 class="h-3 w-3" /> Empresa</div>
								</th>
								<th class="text-left">Emisor</th>
								<th class="text-right">Valor</th>
								<th class="text-center">Incluir</th>
								<th class="text-center">Paga Cliente</th>
								<th class="text-center">% Propietario</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-subtle)]">
							{#each grupos as grupo (grupo.key)}
								{@const grupoKey = `${grupo.vehiculoId}-${grupo.año}-${String(grupo.mes).padStart(2, '0')}-${grupo.empresaId}`}
								{@const yaIncluido = keysYaIncluidos.has(`${grupo.vehiculoId}-${`${grupo.año}-${String(grupo.mes).padStart(2, '0')}`}-${grupo.empresaId}`)}
								{@const tieneOverride = grupo.origenPlanillaIds.some((id) => planillasConOverride.has(id))}
								<tr class="table-row" class:opacity-60={yaIncluido}>
									<td class="px-3 py-2.5 font-medium text-[var(--text-primary)]">
										<div class="flex flex-wrap items-center gap-1.5">
											<span>{grupo.vehiculoPlaca}</span>
											{#if yaIncluido}
												<span
													class="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700"
													title="Este recargo ya está registrado en la liquidación. Puedes editar 'Paga Cliente' y '% Propietario' aquí mismo; los cambios se guardan al pulsar 'Guardar Liquidación'."
												>
													<svg
														class="h-2.5 w-2.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="3"
													>
														<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
													</svg>
													Ya incluido · editable
												</span>
											{/if}
											{#if tieneOverride}
												<span
													class="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800"
													title="Este recargo automático fue sobreescrito por un recargo manual. Para revertir, elimina el manual en la sección de Recargos."
												>
													<svg
														class="h-2.5 w-2.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="2.5"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
														/>
													</svg>
													Override
												</span>
											{/if}
										</div>
									</td>
									<td class="px-3 py-2.5 text-[var(--text-secondary)]">{grupo.mesLabel}</td>
									<td class="px-3 py-2.5 text-[var(--text-secondary)]">{grupo.empresaNombre}</td>
									<td class="px-3 py-2.5 text-[var(--text-secondary)]">{grupo.emisor === 'TRANSMERALDA' ? 'Transmeralda' : 'Cotransmeq'}</td>
									<td class="px-3 py-2.5 text-right font-semibold text-[var(--text-primary)]">{formatCurrency(grupo.totalValor)}</td>
									<td class="px-3 py-2.5 text-center">
										{#if yaIncluido}
											<span
												class="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-100 text-emerald-700"
												title="Ya incluido en esta liquidación"
											>
												<svg
													class="h-3 w-3"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="3"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
												</svg>
											</span>
										{:else}
											<input
												type="checkbox"
												checked={grupo.incluir}
												on:change={(e) => handleIncluirChange(grupo.key, e.currentTarget.checked)}
												class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
											/>
										{/if}
									</td>
									<td class="px-3 py-2.5 text-center">
										<input
											type="checkbox"
											checked={grupo.pagCliente}
											on:change={(e) => handlePagClienteChange(grupo.key, e.currentTarget.checked)}
											title={yaIncluido
												? 'Editar si el cliente paga este recargo (se actualizará al guardar)'
												: '¿El cliente paga este recargo?'}
											class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
										/>
									</td>
									<td class="px-3 py-2.5 text-center">
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
													title={yaIncluido
														? 'Editar el % que asume el propietario (se actualizará al guardar)'
														: '% que asume el propietario'}
													class="input-glow w-16 rounded-lg border border-[var(--border-default)] bg-white px-2 py-1 text-center text-xs"
												/>
												<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">%</span>
											</div>
										{:else}
											<span
												class="cursor-help text-[var(--text-very-muted)]"
												title="Marca 'Paga Cliente' para indicar el % que asume el propietario"
											>—</span>
										{/if}
									</td>
								</tr>
								{#if grupo.pagCliente && grupo.porcentajePropietario > 0}
									<tr class="bg-[var(--bg-base)]">
										<td colspan="8" class="px-3 py-1.5 pl-6 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											↳ Propietario reconoce {grupo.porcentajePropietario}% = {formatCurrency(grupo.totalValor * grupo.porcentajePropietario / 100)} · Cliente asume {formatCurrency(grupo.totalValor * (100 - grupo.porcentajePropietario) / 100)}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
						<tfoot>
							<tr class="border-t border-[var(--border-emphasis)] bg-[var(--bg-base)]">
								<td colspan="4" class="px-3 py-2.5 text-right font-mono-meta text-[0.7rem] text-[var(--text-secondary)]">Total Recargos</td>
								<td class="px-3 py-2.5 text-right font-bold text-[var(--emerald-700)]">{formatCurrency(totalGeneral)}</td>
								<td colspan="3"></td>
							</tr>
						</tfoot>
					</table>
				</div>

				<!-- Info resumen -->
				{#if previewData.resumen}
					<div class="mt-3 flex flex-wrap gap-3 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
						<span>{previewData.resumen.total_planillas} planillas</span>
						<span>·</span>
						<span>{previewData.resumen.total_dias_trabajados} días</span>
						<span>·</span>
						<span>{previewData.resumen.total_horas_trabajadas}h trabajadas</span>
					</div>
				{/if}
			{/if}
		{:else}
			<div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-center">
				<p class="text-xs text-[var(--text-very-muted)]">Los recargos se calcularán automáticamente</p>
			</div>
		{/if}
	</div>
</div>
