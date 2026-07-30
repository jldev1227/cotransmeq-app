<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';

	export let isOpen = false;
	export let mes: number;
	export let año: number;

	const dispatch = createEventDispatcher<{
		imported: {
			importadas: number;
			omitidas: number;
			errores: number;
			vehiculos_creados: number;
			empresas_creadas: number;
		};
		cancel: void;
	}>();

	// Estado
	let loadingPreview = false;
	let importing = false;
	let creatingEntities = false;
	let preview: {
		mes: number;
		año: number;
		total: number;
		importables: number;
		ya_importadas: number;
		no_importables: number;
		filtradas_por_conductor_inactivo: number;
		vehiculos_a_crear: number;
		empresas_a_crear: number;
		incluir_no_importables: boolean;
		planillas: any[];
	} | null = null;
	let errorMsg: string | null = null;
	let selectedIds = new Set<string>();
	let syncing = false;
	let syncResult: any = null;
	let mostrarNoImportables = false;

	$: if (isOpen) {
		selectedIds = new Set();
		preview = null;
		errorMsg = null;
		syncResult = null;
		mostrarNoImportables = false;
		void cargarPreview();
	}

	async function cargarPreview() {
		loadingPreview = true;
		errorMsg = null;
		try {
			preview = await recargosApi.previewImportarTransmeralda(
				mes,
				año,
				mostrarNoImportables
			);
			// Auto-seleccionar todas las importables nuevas
			selectedIds = new Set(
				preview.planillas
					.filter((p) => !p.ya_importado && p.motivo_no_importable === null)
					.map((p) => p.source_id)
			);
		} catch (err: any) {
			console.error('Error en preview importar transmeralda:', err);
			errorMsg =
				err?.response?.data?.message ||
				err?.message ||
				'No se pudo obtener el preview de Transmeralda';
		} finally {
			loadingPreview = false;
		}
	}

	async function sincronizarCotransmeq() {
		syncing = true;
		errorMsg = null;
		try {
			syncResult = await recargosApi.sincronizarConductoresCotransmeqTransmeralda();
			await cargarPreview();
		} catch (err: any) {
			errorMsg =
				err?.response?.data?.message ||
				err?.message ||
				'No se pudo sincronizar los conductores';
		} finally {
			syncing = false;
		}
	}

	async function crearEntidadesFaltantes() {
		if (!preview) return;
		creatingEntities = true;
		errorMsg = null;
		try {
			const result = await recargosApi.crearEntidadesFaltantesTransmeralda(
				preview.mes,
				preview.año
			);
			const total =
				(result.vehiculos_creados || 0) + (result.empresas_creadas || 0);
			if (total === 0) {
				toast.info('No hay entidades nuevas para crear');
			} else {
				toast.success(
					`${result.vehiculos_creados} vehículo(s) y ${result.empresas_creadas} empresa(s) creados en Cotransmeq`
				);
			}
			// Re-cargar preview para reflejar los cambios
			await cargarPreview();
		} catch (err: any) {
			errorMsg =
				err?.response?.data?.message ||
				err?.message ||
				'No se pudo crear las entidades';
		} finally {
			creatingEntities = false;
		}
	}

	function toggleSelect(sourceId: string) {
		if (selectedIds.has(sourceId)) {
			selectedIds.delete(sourceId);
		} else {
			selectedIds.add(sourceId);
		}
		selectedIds = selectedIds;
	}

	function toggleSelectAll() {
		if (!preview) return;
		const importables = preview.planillas.filter(
			(p) => !p.ya_importado && p.motivo_no_importable === null
		);
		const allSelected = importables.every((p) => selectedIds.has(p.source_id));
		if (allSelected) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(importables.map((p) => p.source_id));
		}
	}

	$: importablesCount =
		preview?.planillas.filter(
			(p) => !p.ya_importado && p.motivo_no_importable === null
		).length ?? 0;

	$: haySeleccion = selectedIds.size > 0;

	async function ejecutarImportacion() {
		if (!haySeleccion) return;
		importing = true;
		errorMsg = null;
		try {
			const sourceIds = Array.from(selectedIds);
			const result = await recargosApi.importarDesdeTransmeralda(sourceIds);
			dispatch('imported', {
				importadas: result.importadas,
				omitidas: result.omitidas,
				errores: result.errores,
				vehiculos_creados: result.vehiculos_creados,
				empresas_creadas: result.empresas_creadas
			});
			isOpen = false;
		} catch (err: any) {
			errorMsg =
				err?.response?.data?.message ||
				err?.message ||
				'No se pudo ejecutar la importación';
		} finally {
			importing = false;
		}
	}

	function handleCancel() {
		if (importing) return;
		dispatch('cancel');
		isOpen = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !importing && !loadingPreview) {
			handleCancel();
		}
	}

	const meses = [
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
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop con blur -->
	<button
		type="button"
		class="modal-overlay cursor-default"
		style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
		aria-label="Cerrar modal"
		on:click={handleCancel}
		transition:fade={{ duration: 200, easing: quintOut }}
	></button>

	<!-- Modal Container -->
	<div class="modal-overlay" role="presentation" style="pointer-events: none;">
		<div
			class="modal-content"
			style="max-width: 72rem; width: 96vw; max-height: 90vh; pointer-events: auto; background-color: var(--bg-surface); border: 1px solid var(--border-subtle); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);"
			role="dialog"
			aria-modal="true"
			transition:fly={{ y: 20, duration: 400, easing: quintOut }}
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			<!-- Header verde -->
			<div
				class="flex items-center justify-between gap-4 px-6 py-4"
				style="background: linear-gradient(135deg, #047857 0%, #065F46 100%); color: white;"
			>
				<div class="flex items-center gap-3 min-w-0">
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
						style="background: rgba(255, 255, 255, 0.18); backdrop-filter: blur(4px);"
					>
						<svg
							class="h-5 w-5 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p
							class="font-mono-meta"
							style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255, 255, 255, 0.85);"
						>
							IMPORTAR RECARGOS · TRANSMERALDA → COTRANSMEQ
						</p>
						<h3
							style="font-family: 'Geist', sans-serif; font-size: 1.15rem; font-weight: 600; color: white; letter-spacing: -0.01em; line-height: 1.3; margin-top: 2px;"
						>
							Planillas de {meses[mes]} {año}
						</h3>
					</div>
				</div>
				<button
					on:click={handleCancel}
					disabled={importing}
					class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition hover:bg-white/15 disabled:opacity-50"
					aria-label="Cerrar"
				>
					<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Toolbar verde: stats + acciones -->
			{#if preview}
				<div
					class="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3"
					style="border-color: var(--border-subtle); background-color: var(--bg-base);"
				>
					<!-- Stats (Excel-style chips) -->
					<div class="flex flex-wrap items-center gap-2 text-xs">
						<span
							class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold"
							style="color: #065F46; background: rgba(16, 185, 129, 0.10); border: 1px solid rgba(16, 185, 129, 0.25);"
							title="Planillas listas para importar"
						>
							<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
							{preview.importables} nuevas
						</span>
						<span
							class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold"
							style="color: #6B7280; background: rgba(107, 114, 128, 0.10); border: 1px solid rgba(107, 114, 128, 0.20);"
							title="Ya importadas en Cotransmeq"
						>
							<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							{preview.ya_importadas} ya importadas
						</span>
						{#if preview.no_importables > 0}
							<span
								class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold"
								style="color: #B45309; background: rgba(180, 83, 9, 0.10); border: 1px solid rgba(180, 83, 9, 0.25);"
								title="No se pueden importar"
							>
								<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
								</svg>
								{preview.no_importables} no importables
							</span>
						{/if}
						{#if preview.vehiculos_a_crear > 0 || preview.empresas_a_crear > 0}
							<span
								class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold"
								style="color: #7C3AED; background: rgba(124, 58, 237, 0.10); border: 1px solid rgba(124, 58, 237, 0.25);"
								title="Placas y empresas que se crearán al importar"
							>
								<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
								</svg>
								{preview.vehiculos_a_crear} placas + {preview.empresas_a_crear} empresas a crear
							</span>
						{/if}
					</div>

					<!-- Acciones -->
					<div class="flex items-center gap-2">
						<!-- Toggle: mostrar también las tachadas (no importables) -->
						{#if preview && preview.filtradas_por_conductor_inactivo > 0}
							<label
								class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--bg-base)]"
								title="Mostrar también las planillas filtradas (conductor inactivo, no existe en CM, etc.) para diagnóstico"
							>
								<input
									type="checkbox"
									bind:checked={mostrarNoImportables}
									on:change={cargarPreview}
									class="h-3 w-3 cursor-pointer rounded"
									style="accent-color: #047857;"
								/>
								<span style="color: var(--text-secondary);">
									Mostrar tachadas
									<span
										class="font-mono-meta ml-0.5"
										style="font-size: 0.6rem; color: #6B7280;"
									>
										(+{preview.filtradas_por_conductor_inactivo})
									</span>
								</span>
							</label>
						{/if}
						<button
							on:click={sincronizarCotransmeq}
							disabled={syncing || importing}
							class="apple-transition flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--bg-base)] disabled:opacity-50"
							title="Marca inactivos en TM a los conductores sin liquidaciones en 2026"
						>
							{#if syncing}
								<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
								</svg>
							{:else}
								<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
							{/if}
							Sincronizar TM
						</button>
						{#if preview.vehiculos_a_crear > 0 || preview.empresas_a_crear > 0}
							<button
								on:click={crearEntidadesFaltantes}
								disabled={creatingEntities || importing}
								class="apple-transition flex items-center gap-1.5 rounded-lg border border-[rgba(124,58,237,0.30)] bg-[rgba(124,58,237,0.06)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[rgba(124,58,237,0.12)] disabled:opacity-50"
								style="color: #6D28D9;"
								title="Crea las placas y empresas faltantes en Cotransmeq sin importar planillas"
							>
								{#if creatingEntities}
									<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
									</svg>
								{:else}
									<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
									</svg>
								{/if}
								Crear entidades
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error -->
			{#if errorMsg}
				<div class="px-6 pt-4">
					<div
						class="rounded-xl p-3 text-sm"
						style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); color: #991B1B;"
					>
						<strong>Error:</strong>
						{errorMsg}
					</div>
				</div>
			{/if}

			<!-- Loading -->
			{#if loadingPreview}
				<div class="flex flex-col items-center justify-center gap-3 px-6 py-16">
					<svg class="h-8 w-8 animate-spin" style="color: #047857;" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
					</svg>
					<p class="text-sm" style="color: var(--text-secondary);">
						Buscando planillas en Transmeralda…
					</p>
				</div>
			{:else if preview}
				<!-- Tabla estilo Excel moderna -->
				<div class="overflow-auto" style="max-height: calc(90vh - 260px);">
					<table
						class="w-full border-collapse"
						style="font-size: 0.78rem;"
					>
						<thead style="position: sticky; top: 0; z-index: 2;">
							<tr
								style="background: linear-gradient(180deg, #ECFDF5 0%, #D1FAE5 100%); border-bottom: 2px solid #10B981;"
							>
								<th
									class="px-3 py-2.5 text-left"
									style="width: 36px; color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem;"
								>
									{#if importablesCount > 0}
										<input
											type="checkbox"
											checked={selectedIds.size === importablesCount && importablesCount > 0}
											on:change={toggleSelectAll}
											class="h-3.5 w-3.5 cursor-pointer rounded"
											style="accent-color: #047857;"
										/>
									{/if}
								</th>
								<th
									class="px-3 py-2.5 text-left"
									style="color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; min-width: 200px;"
								>
									Conductor
								</th>
								<th
									class="px-3 py-2.5 text-left"
									style="color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; min-width: 180px;"
								>
									Empresa
								</th>
								<th
									class="px-3 py-2.5 text-left"
									style="color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; width: 110px;"
								>
									Placa
								</th>
								<th
									class="px-3 py-2.5 text-left"
									style="color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; width: 140px;"
								>
									N° Planilla
								</th>
								<th
									class="px-3 py-2.5 text-left"
									style="color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; min-width: 110px;"
								>
									Días
								</th>
								<th
									class="px-3 py-2.5 text-left"
									style="color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; min-width: 260px;"
								>
									Estado
								</th>
							</tr>
						</thead>
						<tbody>
							{#each preview.planillas as p, i (p.source_id)}
								{@const noImportable = !!p.motivo_no_importable}
								{@const importada = p.ya_importado}
								{@const deshabilitada = noImportable || importada || !p.conductor_activo_en_destino}
								{@const isSelected = selectedIds.has(p.source_id)}
								<tr
									style="border-bottom: 1px solid #E5E7EB; background: {i % 2 === 0
										? '#FFFFFF'
										: '#F9FAFB'}; transition: background-color 100ms ease;"
									class:opacity-55={deshabilitada}
									class:line-through={importada}
									on:mouseenter={(e) => {
										if (!deshabilitada) {
											(e.currentTarget as HTMLElement).style.background = '#F0FDF4';
										}
									}}
									on:mouseleave={(e) => {
										(e.currentTarget as HTMLElement).style.background =
											i % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
									}}
								>
									<td class="px-3 py-2.5">
										<input
											type="checkbox"
											disabled={deshabilitada}
											checked={isSelected}
											on:change={() => toggleSelect(p.source_id)}
											class="h-3.5 w-3.5 cursor-pointer rounded disabled:cursor-not-allowed"
											style="accent-color: #047857;"
										/>
									</td>
									<td class="px-3 py-2.5" style="vertical-align: middle;">
										<div class="flex flex-col gap-0.5">
											<span style="color: var(--text-primary); font-weight: 500; line-height: 1.3;">
												{p.conductor_nombre || '—'}
											</span>
											<span
												class="font-mono-meta"
												style="font-size: 0.7rem; color: var(--text-muted);"
											>
												CC {p.conductor_identificacion || '—'}
											</span>
										</div>
									</td>
									<td
										class="px-3 py-2.5"
										style="color: var(--text-secondary); vertical-align: middle;"
									>
										{p.empresa_nombre}
									</td>
									<td
										class="px-3 py-2.5 font-mono-meta"
										style="color: var(--text-secondary); vertical-align: middle;"
									>
										{p.vehiculo_placa}
									</td>
									<td
										class="px-3 py-2.5"
										style="vertical-align: middle;"
									>
										<div class="flex flex-col gap-0.5">
											<span
												class="font-mono-meta"
												style="color: var(--text-primary); font-weight: 600; line-height: 1.2;"
											>
												{p.numero_planilla_normalizado || p.numero_planilla || '—'}
											</span>
											{#if p.numero_planilla_original && p.numero_planilla_original !== p.numero_planilla_normalizado}
												<span
													class="font-mono-meta inline-flex items-center gap-1 self-start rounded px-1 py-0.5"
													style="font-size: 0.6rem; color: #7C3AED; background: #EDE9FE; border: 1px solid #DDD6FE; line-height: 1.3;"
													title="Original de Transmeralda. Se importa con prefijo TM-."
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
															d="M13 7l5 5m0 0l-5 5m5-5H6"
														/>
													</svg>
													orig: {p.numero_planilla_original}
												</span>
											{/if}
										</div>
									</td>
									<td
										class="px-3 py-2.5 font-mono-meta"
										style="color: var(--text-secondary); vertical-align: middle; white-space: nowrap;"
									>
										<span
											title={p.dias_lista && p.dias_lista.length > 0
												? `Días laborados: ${p.dias_lista.join(', ')}`
												: 'Sin días registrados'}
										>
											{p.dias_rangos || '—'}
										</span>
									</td>
									<td class="px-3 py-2.5" style="vertical-align: middle;">
										<div class="flex flex-wrap items-center gap-1.5">
											{#if importada}
												<span
													class="inline-flex items-center gap-1 rounded-md px-2 py-0.5"
													style="font-size: 0.66rem; font-weight: 600; color: #4B5563; background: #F3F4F6; border: 1px solid #D1D5DB; line-height: 1.4;"
												>
													<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
													</svg>
													YA IMPORTADA
												</span>
											{:else if noImportable}
												<span
													class="inline-flex items-center gap-1 rounded-md px-2 py-0.5"
													style="font-size: 0.66rem; font-weight: 600; color: {p.conductor_activo_en_destino ? '#B45309' : '#991B1B'}; background: {p.conductor_activo_en_destino ? '#FEF3C7' : '#FEE2E2'}; border: 1px solid {p.conductor_activo_en_destino ? '#FDE68A' : '#FCA5A5'}; line-height: 1.4;"
													title={p.motivo_no_importable}
												>
													<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
													</svg>
													{p.motivo_no_importable}
												</span>
											{:else}
												<span
													class="inline-flex items-center gap-1 rounded-md px-2 py-0.5"
													style="font-size: 0.66rem; font-weight: 600; color: #065F46; background: #D1FAE5; border: 1px solid #6EE7B7; line-height: 1.4;"
												>
													<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
														<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
													</svg>
													NUEVA
												</span>
											{/if}
											{#if !importada && !noImportable && p.vehiculo_no_existe_en_destino}
												<span
													class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
													style="font-size: 0.6rem; font-weight: 600; color: #7C3AED; background: #EDE9FE; border: 1px solid #DDD6FE; line-height: 1.4;"
													title="Esta placa se creará automáticamente en Cotransmeq al importar"
												>
													+placa
												</span>
											{/if}
											{#if !importada && !noImportable && p.empresa_no_existe_en_destino}
												<span
													class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
													style="font-size: 0.6rem; font-weight: 600; color: #7C3AED; background: #EDE9FE; border: 1px solid #DDD6FE; line-height: 1.4;"
													title="Esta empresa se creará automáticamente en Cotransmeq al importar"
												>
													+empresa
												</span>
											{/if}
										</div>
									</td>
								</tr>
							{:else}
								<tr>
									<td colspan="7" class="px-6 py-16 text-center">
										<div class="flex flex-col items-center gap-2">
											<svg
												class="h-10 w-10"
												style="color: var(--text-very-muted);"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="1.5"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
												/>
											</svg>
											<p style="color: var(--text-muted); font-weight: 500;">
												No hay planillas en Transmeralda para {meses[mes]} {año}
											</p>
											<p style="color: var(--text-very-muted); font-size: 0.75rem;">
												Verificá que la sincronización de conductores se haya
												ejecutado y que el mes/año tenga recargos en TM.
											</p>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<!-- Footer -->
			<div
				class="flex items-center justify-between gap-3 border-t px-6 py-3"
				style="border-color: var(--border-subtle); background-color: var(--bg-base);"
			>
				<span
					class="font-mono-meta text-xs"
					style="color: var(--text-muted);"
				>
					{#if preview}
						{selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'} de {preview.importables} nuevas
					{/if}
				</span>
				<div class="flex items-center gap-2">
					<button
						on:click={handleCancel}
						disabled={importing}
						class="btn-secondary"
					>
						Cancelar
					</button>
					<button
						on:click={ejecutarImportacion}
						disabled={!haySeleccion || importing}
						class="apple-transition flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
						style="background: linear-gradient(135deg, #047857, #065F46); box-shadow: 0 2px 6px rgba(6, 95, 70, 0.30);"
					>
						{#if importing}
							<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
							</svg>
							Importando {selectedIds.size}…
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
							</svg>
							Importar {selectedIds.size}
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
