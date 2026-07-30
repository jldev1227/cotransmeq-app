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
			/**
			 * Id del job bulk de recálculo que arrancó el server en
			 * background. El page lo usa para alimentar el
			 * `bulkRecalcStore` y mostrar la barra de progreso global.
			 * `null` si no se importó nada.
			 */
			recalculoBatchId: string | null;
			/**
			 * Ids de las planillas recién creadas. El page las pasa al
			 * `bulkRecalcStore.iniciar(ids)` para que la UI sepa qué
			 * filas están bloqueadas mientras se recalculan.
			 */
			newRecargoIds: string[];
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
	let mostrarNoImportables = false;

	$: if (isOpen) {
		selectedIds = new Set();
		preview = null;
		errorMsg = null;
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
			const newRecargoIds = (result.detalle?.importadas || []).map((d) => d.new_id);
			dispatch('imported', {
				importadas: result.importadas,
				omitidas: result.omitidas,
				errores: result.errores,
				vehiculos_creados: result.vehiculos_creados,
				empresas_creadas: result.empresas_creadas,
				recalculoBatchId: result.recalculoBatchId,
				newRecargoIds
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
		aria-label="Cerrar modal"
		on:click={handleCancel}
		transition:fade={{ duration: 200, easing: quintOut }}
	></button>

	<!-- Modal Container -->
	<div class="modal-overlay" role="presentation" style="pointer-events: none;">
		<div
			class="modal-content modal-xl"
			role="dialog"
			aria-modal="true"
			style="pointer-events: auto;"
			transition:fly={{ y: 20, duration: 400, easing: quintOut }}
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			<!-- Header -->
			<div class="modal-header">
				<div class="modal-title-row">
					<div class="modal-icon">
						<svg
							class="h-6 w-6"
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
					<div class="modal-title-text">
						<p class="modal-eyebrow">Importar · Transmeralda → Cotransmeq</p>
						<h2 class="modal-title">Planillas de {meses[mes]} {año}</h2>
						{#if preview}
							<p class="modal-sub">
								{preview.total} planilla{preview.total === 1 ? '' : 's'} en origen · {preview
									.importables} disponible{preview.importables === 1 ? '' : 's'} para importar
							</p>
						{:else}
							<p class="modal-sub">Buscando planillas en Transmeralda…</p>
						{/if}
					</div>
				</div>
				<button
					on:click={handleCancel}
					disabled={importing}
					class="modal-close"
					aria-label="Cerrar"
				>
					<svg
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Stat cards (resumen del preview) -->
			{#if preview}
				<div
					class="grid grid-cols-2 gap-2.5 border-b px-6 py-4 lg:grid-cols-4"
					style="border-color: var(--border-subtle); background-color: var(--bg-base);"
				>
					<!-- Nuevas (importables) -->
					<div class="stat-card">
						<div class="flex items-center justify-between gap-2">
							<span class="stat-label">Nuevas</span>
							<span
								class="flex h-6 w-6 items-center justify-center rounded-md"
								style="background: rgba(249, 115, 22, 0.10); color: #ea580c;"
							>
								<svg
									class="h-3 w-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M12 4v16m8-8H4"
									/>
								</svg>
							</span>
						</div>
						<div
							class="stat-value"
							style="color: #166534;"
						>
							{preview.importables}
						</div>
						<p class="mt-0.5 text-[0.7rem]" style="color: var(--text-muted);">
							Listas para importar
						</p>
					</div>

					<!-- Ya importadas -->
					<div class="stat-card">
						<div class="flex items-center justify-between gap-2">
							<span class="stat-label">Ya importadas</span>
							<span
								class="flex h-6 w-6 items-center justify-center rounded-md"
								style="background: rgba(100, 116, 139, 0.10); color: #475569;"
							>
								<svg
									class="h-3 w-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</span>
						</div>
						<div class="stat-value" style="color: var(--text-primary);">
							{preview.ya_importadas}
						</div>
						<p class="mt-0.5 text-[0.7rem]" style="color: var(--text-muted);">
							Duplicados bloqueados
						</p>
					</div>

					<!-- No importables -->
					<div class="stat-card">
						<div class="flex items-center justify-between gap-2">
							<span class="stat-label">No importables</span>
							<span
								class="flex h-6 w-6 items-center justify-center rounded-md"
								style="background: rgba(180, 83, 9, 0.10); color: #B45309;"
							>
								<svg
									class="h-3 w-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
							</span>
						</div>
						<div
							class="stat-value"
							style="color: {preview.no_importables > 0 ? '#B45309' : 'var(--text-primary)'};"
						>
							{preview.no_importables}
						</div>
						<p class="mt-0.5 text-[0.7rem]" style="color: var(--text-muted);">
							Requieren revisión
						</p>
					</div>

					<!-- A crear -->
					<div class="stat-card">
						<div class="flex items-center justify-between gap-2">
							<span class="stat-label">A crear</span>
							<span
								class="flex h-6 w-6 items-center justify-center rounded-md"
								style="background: rgba(124, 58, 237, 0.10); color: #6D28D9;"
							>
								<svg
									class="h-3 w-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
									/>
								</svg>
							</span>
						</div>
						<div
							class="stat-value"
							style="color: {preview.vehiculos_a_crear + preview.empresas_a_crear > 0
								? '#6D28D9'
								: 'var(--text-primary)'};"
						>
							{preview.vehiculos_a_crear + preview.empresas_a_crear}
						</div>
						<p class="mt-0.5 text-[0.7rem]" style="color: var(--text-muted);">
							{preview.vehiculos_a_crear} placas · {preview.empresas_a_crear} empresas
						</p>
					</div>
				</div>
			{/if}

			<!-- Acciones toolbar (mostrar tachadas / crear entidades) -->
			{#if preview}
				<div
					class="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-2.5"
					style="border-color: var(--border-subtle);"
				>
					<!-- Toggle mostrar tachadas -->
					{#if preview && preview.filtradas_por_conductor_inactivo > 0}
						<label
							class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-1.5 text-xs font-semibold apple-transition hover:bg-[var(--bg-base)]"
							title="Mostrar también las planillas filtradas (conductor inactivo, no existe en CM, etc.) para diagnóstico"
						>
							<input
								type="checkbox"
								bind:checked={mostrarNoImportables}
								on:change={cargarPreview}
								class="h-3 w-3 cursor-pointer rounded"
								style="accent-color: #f97316;"
							/>
							<span style="color: var(--text-secondary);">
								Mostrar tachadas
								<span
									class="font-mono-meta ml-0.5"
									style="font-size: 0.6rem; color: var(--text-muted);"
								>
									(+{preview.filtradas_por_conductor_inactivo})
								</span>
							</span>
						</label>
					{:else}
						<span></span>
					{/if}

					<div class="flex flex-wrap items-center gap-2">
						{#if preview.vehiculos_a_crear > 0 || preview.empresas_a_crear > 0}
							<button
								on:click={crearEntidadesFaltantes}
								disabled={creatingEntities || importing}
								class="help-btn"
								style="color: #6D28D9; background: rgba(124, 58, 237, 0.08); border-color: rgba(124, 58, 237, 0.25);"
								title="Crea las placas y empresas faltantes en Cotransmeq sin importar planillas"
							>
								{#if creatingEntities}
									<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
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
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										/>
									</svg>
									Creando…
								{:else}
									<svg
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
										/>
									</svg>
									Crear recursos
								{/if}
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error -->
			{#if errorMsg}
				<div class="px-6 pt-4">
					<div class="alert alert-error">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
						<div>
							<strong>Error</strong>
							<p class="mt-0.5 text-xs">{errorMsg}</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Body: tabla -->
			<div class="modal-body" style="padding: 0;">
				{#if loadingPreview}
					<div class="flex flex-col items-center justify-center gap-3 py-20">
						<div class="spinner"></div>
						<p class="text-sm" style="color: var(--text-secondary);">
							Buscando planillas en Transmeralda…
						</p>
					</div>
				{:else if preview}
					<div class="overflow-x-auto">
						<table class="w-full" style="font-size: 0.78rem; border-collapse: collapse;">
								<thead class="table-header sticky top-0 z-10">
									<tr>
										<th
											class="px-3 py-2.5"
											style="width: 40px; text-align: center;"
										>
											{#if importablesCount > 0}
												<input
													type="checkbox"
													checked={selectedIds.size === importablesCount &&
														importablesCount > 0}
													on:change={toggleSelectAll}
													class="h-3.5 w-3.5 cursor-pointer rounded"
													style="accent-color: #f97316;"
												/>
											{/if}
										</th>
										<th class="px-3 py-2.5" style="min-width: 200px;">Conductor</th>
										<th class="px-3 py-2.5" style="min-width: 180px;">Empresa</th>
										<th class="px-3 py-2.5" style="width: 110px;">Placa</th>
										<th class="px-3 py-2.5" style="width: 150px;">N° Planilla</th>
										<th class="px-3 py-2.5" style="width: 110px;">Días</th>
										<th class="px-3 py-2.5" style="min-width: 240px;">Estado</th>
									</tr>
								</thead>
								<tbody>
									{#each preview.planillas as p, i (p.source_id)}
										{@const noImportable = !!p.motivo_no_importable}
										{@const importada = p.ya_importado}
										{@const deshabilitada =
											noImportable || importada || !p.conductor_activo_en_destino}
										{@const isSelected = selectedIds.has(p.source_id)}
										<tr
											class="table-row"
											class:opacity-55={deshabilitada}
											class:line-through={importada}
											style="border-bottom: 1px solid var(--border-subtle);"
										>
											<td
												class="px-3 py-2.5"
												style="text-align: center; vertical-align: middle;"
											>
												<input
													type="checkbox"
													disabled={deshabilitada}
													checked={isSelected}
													on:change={() => toggleSelect(p.source_id)}
													class="h-3.5 w-3.5 cursor-pointer rounded disabled:cursor-not-allowed"
													style="accent-color: #f97316;"
												/>
											</td>
											<td
												class="px-3 py-2.5"
												style="vertical-align: middle;"
											>
												<div class="flex flex-col gap-0.5">
													<span
														style="color: var(--text-primary); font-weight: 500; line-height: 1.3;"
													>
														{p.conductor_nombre || '—'}
													</span>
													<span
														class="font-mono-meta"
														style="font-size: 0.66rem; color: var(--text-muted);"
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
											<td class="px-3 py-2.5" style="vertical-align: middle;">
												<div class="flex flex-col gap-0.5">
													<span
														class="font-mono-meta"
														style="color: var(--text-primary); font-weight: 600; line-height: 1.2;"
													>
														{p.numero_planilla_normalizado ||
															p.numero_planilla ||
															'—'}
													</span>
													{#if p.numero_planilla_original && p.numero_planilla_original !== p.numero_planilla_normalizado}
														<span
															class="font-mono-meta inline-flex items-center gap-1 self-start rounded px-1.5 py-0.5"
															style="font-size: 0.6rem; color: #6D28D9; background: rgba(124, 58, 237, 0.10); border: 1px solid rgba(124, 58, 237, 0.20); line-height: 1.3;"
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
															class="status-pill"
															style="background: rgba(100, 116, 139, 0.10); color: #475569;"
														>
															Ya importada
														</span>
													{:else if noImportable}
														<span
															class="status-pill"
															style="background: {p.conductor_activo_en_destino
																? 'rgba(180, 83, 9, 0.10)'
																: 'rgba(220, 38, 38, 0.10)'}; color: {p.conductor_activo_en_destino
																? '#B45309'
																: '#991B1B'};"
															title={p.motivo_no_importable}
														>
															{p.motivo_no_importable}
														</span>
													{:else}
														<span
															class="status-pill"
															style="background: rgba(249, 115, 22, 0.10); color: #c2410c;"
														>
															Nueva
														</span>
													{/if}
													{#if !importada && !noImportable && p.vehiculo_no_existe_en_destino}
														<span
															class="font-mono-meta inline-flex items-center gap-0.5 rounded px-1.5 py-0.5"
															style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6D28D9; background: rgba(124, 58, 237, 0.10); border: 1px solid rgba(124, 58, 237, 0.20);"
															title="Esta placa se creará automáticamente en Cotransmeq al importar"
														>
															+ placa
														</span>
													{/if}
													{#if !importada && !noImportable && p.empresa_no_existe_en_destino}
														<span
															class="font-mono-meta inline-flex items-center gap-0.5 rounded px-1.5 py-0.5"
															style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6D28D9; background: rgba(124, 58, 237, 0.10); border: 1px solid rgba(124, 58, 237, 0.20);"
															title="Esta empresa se creará automáticamente en Cotransmeq al importar"
														>
															+ empresa
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
													<p
														style="color: var(--text-muted); font-weight: 500;"
													>
														No hay planillas en Transmeralda para {meses[mes]}
														{año}
													</p>
													<p
														style="color: var(--text-very-muted); font-size: 0.75rem;"
													>
														Verificá que el mes/año tenga recargos cargados en TM.
													</p>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="modal-footer" style="justify-content: space-between;">
				<span
					class="font-mono-meta text-xs"
					style="color: var(--text-muted);"
				>
					{#if preview}
						{selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'} de
						{preview.importables} nuevas
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
						class="btn-primary"
					>
						{#if importing}
							<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							Importando {selectedIds.size}…
						{:else}
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/>
							</svg>
							Importar {selectedIds.size}
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
