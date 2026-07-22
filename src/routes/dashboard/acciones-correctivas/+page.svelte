<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva,
		type ActionStatusGlobal
	} from '$lib/api/acciones-correctivas';
	import KpiCard from '$lib/components/acciones-correctivas/dashboard/KpiCard.svelte';
	import AccionCard from '$lib/components/acciones-correctivas/dashboard/AccionCard.svelte';

	const FILTERS: { label: string; value: ActionStatusGlobal | '' }[] = [
		{ label: 'Todas', value: '' },
		{ label: 'En Proceso', value: 'EN_PROCESO' },
		{ label: 'Vencidas', value: 'VENCIDA' },
		{ label: 'Cumplidas', value: 'CUMPLIDA' }
	];

	let acciones: AccionCorrectivaPreventiva[] = [];
	let isLoading = true;
	let total = 0;
	let highlightId: string | null = null;
	let highlightTimer: any;
	let showDeleted = false;
	let loadingState: { id: string; action: 'duplicar' | 'eliminar' | 'restaurar' | 'eliminar-permanente' | 'pdf' } | null = null;

	let search = '';
	let activeFilter: ActionStatusGlobal | '' = '';
	let searchInput = '';
	let debounceTimer: any;

	$: filteredAcciones = acciones;

	$: accionCounts = (() => {
		let enProceso = 0;
		let vencida = 0;
		let cumplida = 0;
		let proxVencer = 0;
		const now = new Date();
		const sevenDays = 7 * 24 * 60 * 60 * 1000;
		acciones.forEach(a => {
			if (a.estado_global === 'EN_PROCESO') enProceso++;
			else if (a.estado_global === 'VENCIDA') vencida++;
			else if (a.estado_global === 'CUMPLIDA') cumplida++;
			if (a.fecha_limite_cierre_accion) {
				const fecha = new Date(a.fecha_limite_cierre_accion);
				const diff = fecha.getTime() - now.getTime();
				if (diff > 0 && diff < sevenDays) proxVencer++;
			}
		});
		return { enProceso, vencida, cumplida, proxVencer, total: acciones.length };
	})();

	$: tipoCounts = (() => {
		const counts: Record<string, number> = {};
		acciones.forEach(a => {
			const tipo = a.tipo_accion_ejecutar || 'Sin tipo';
			counts[tipo] = (counts[tipo] || 0) + 1;
		});
		return counts;
	})();

	$: causasStats = (() => {
		let enProceso = 0;
		let vencida = 0;
		let cumplida = 0;
		let total = 0;
		acciones.forEach(a => {
			if (a.causas) {
				total += a.causas.length;
				a.causas.forEach(c => {
					if (c.estado_seguimiento === 'En Proceso') enProceso++;
					else if (c.estado_seguimiento === 'Vencida') vencida++;
					else if (c.estado_seguimiento === 'Cumplida') cumplida++;
				});
			}
		});
		return { enProceso, vencida, cumplida, total };
	})();

	$: kpis = [
		{
			label: 'Total',
			value: accionCounts.total,
			sub: `${accionCounts.proxVencer} próx. vencer`,
			color: '#6366f1'
		},
		{
			label: 'En Proceso',
			value: accionCounts.enProceso,
			sub: `${accionCounts.total > 0 ? Math.round((accionCounts.enProceso / accionCounts.total) * 100) : 0}%`,
			color: '#3b82f6'
		},
		{
			label: 'Vencidas',
			value: accionCounts.vencida,
			sub: `${accionCounts.total > 0 ? Math.round((accionCounts.vencida / accionCounts.total) * 100) : 0}%`,
			color: '#ef4444'
		},
		{
			label: 'Cumplidas',
			value: accionCounts.cumplida,
			sub: `${accionCounts.total > 0 ? Math.round((accionCounts.cumplida / accionCounts.total) * 100) : 0}%`,
			color: '#22c55e'
		}
	];

	function debounceSearch() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			search = searchInput;
			updateUrl();
			cargarAcciones();
		}, 300);
	}

	function setFilter(value: ActionStatusGlobal | '') {
		activeFilter = value;
		updateUrl();
		cargarAcciones();
	}

	function clearFilters() {
		search = '';
		searchInput = '';
		activeFilter = '';
		updateUrl();
		cargarAcciones();
	}

	async function cargarAcciones() {
		isLoading = true;
		try {
			const resultado = await accionesCorrectivasAPI.listar({
				limit: 50,
				sortBy: 'created_at',
				sortOrder: 'desc',
				...(search && { busqueda: search }),
				...(activeFilter && { estado_global: activeFilter }),
				...(showDeleted && { incluir_eliminados: true })
			});
			acciones = resultado.acciones;
			total = resultado.total;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al cargar las acciones';
			toast.error(message);
			acciones = [];
		} finally {
			isLoading = false;
		}
	}

	function toggleDeleted() {
		showDeleted = !showDeleted;
		cargarAcciones();
	}

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const urlSearch = params.get('search') || '';
		const urlEstado = params.get('estado') || '';

		search = urlSearch;
		searchInput = urlSearch;
		activeFilter = urlEstado as ActionStatusGlobal | '';

		await cargarAcciones();
	});

	function updateUrl() {
		const params = new URLSearchParams();
		if (search) params.set('search', search);
		if (activeFilter) params.set('estado', activeFilter);
		const qs = params.toString();
		window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
	}

	async function handleDuplicar(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		loadingState = { id, action: 'duplicar' };
		try {
			toast.loading('Duplicando acción...', { id: 'duplicar' });
			const nuevaAccion = await accionesCorrectivasAPI.duplicar(id);
			toast.success(`Acción duplicada: ${nuevaAccion.accion_numero}`, { id: 'duplicar' });
			highlightId = nuevaAccion.id;
			clearTimeout(highlightTimer);
			highlightTimer = setTimeout(() => {
				highlightId = null;
			}, 3000);
			await cargarAcciones();
		} catch (error: any) {
			const message = error instanceof Error ? error.message : 'Error al duplicar la acción';
			toast.error(message, { id: 'duplicar' });
		} finally {
			loadingState = null;
		}
	}

	async function handleEliminar(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		loadingState = { id, action: 'eliminar' };
		try {
			await accionesCorrectivasAPI.eliminar(id);
			toast.success('Acción movida a la papelera');
			await cargarAcciones();
		} catch (error: any) {
			toast.error(error.message || 'Error al eliminar la acción');
		} finally {
			loadingState = null;
		}
	}

	async function handleRestaurar(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		loadingState = { id, action: 'restaurar' };
		try {
			await accionesCorrectivasAPI.restaurar(id);
			toast.success('Acción restaurada');
			await cargarAcciones();
		} catch (error: any) {
			toast.error(error.message || 'Error al restaurar la acción');
		} finally {
			loadingState = null;
		}
	}

	async function handleEliminarPermanente(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		if (!confirm('¿Eliminar permanentemente? Esta acción no se puede deshacer.')) return;
		loadingState = { id, action: 'eliminar-permanente' };
		try {
			await accionesCorrectivasAPI.eliminarPermanente(id);
			toast.success('Acción eliminada permanentemente');
			await cargarAcciones();
		} catch (error: any) {
			toast.error(error.message || 'Error al eliminar permanentemente');
		} finally {
			loadingState = null;
		}
	}

	async function handleExportPDF(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		loadingState = { id, action: 'pdf' };
		try {
			toast.loading('Generando PDF...', { id: 'pdf' });
			const accion = acciones.find(a => a.id === id);
			await accionesCorrectivasAPI.descargarPDF(id, accion?.accion_numero || id);
			toast.success('PDF descargado', { id: 'pdf' });
		} catch (error: any) {
			toast.error(error.message || 'Error al exportar PDF', { id: 'pdf' });
		} finally {
			loadingState = null;
		}
	}
</script>

<svelte:head>
	<title>Acciones Correctivas · Cotransmeq</title>
</svelte:head>

<div class="dash-wrapper" in:fade={{ duration: 400 }}>
	<div class="dash">
		<header class="header">
			<div class="header-left">
				<div class="logo-mark" aria-hidden="true">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
				</div>
				<div>
					<span class="eyebrow">Acciones de mejora · {new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
					<h1>Acciones Correctivas y Preventivas</h1>
					<p class="header-sub">Gestión HSEQ · Causas, planes de acción y seguimiento.</p>
				</div>
			</div>
			<div class="header-actions">
				<button
					class="btn-trash-toggle"
					class:btn-trash-active={showDeleted}
					on:click={toggleDeleted}
					aria-label="Ver papelera"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					<span>Papelera</span>
				</button>
				<button class="btn-primary" on:click={() => goto('/dashboard/acciones-correctivas/crear')} aria-label="Crear nueva acción">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
					Nueva acción
				</button>
			</div>
		</header>

		{#if !isLoading && !showDeleted}
			<section class="kpi-row" aria-label="Indicadores clave">
				{#each kpis as kpi (kpi.label)}
					<KpiCard {...kpi} />
				{/each}
			</section>
		{/if}

		{#if !isLoading && !showDeleted && acciones.length > 0 && causasStats.total > 0}
			<section class="causa-stats-row" aria-label="Estado de causas">
				<div class="causa-stat-card">
					<span class="causa-stat-dot dot-proceso"></span>
					<div class="causa-stat-info">
						<span class="causa-stat-label">En Proceso (Causas)</span>
						<span class="causa-stat-value">{causasStats.enProceso}</span>
					</div>
				</div>
				<div class="causa-stat-card">
					<span class="causa-stat-dot dot-vencida"></span>
					<div class="causa-stat-info">
						<span class="causa-stat-label">Vencidas (Causas)</span>
						<span class="causa-stat-value">{causasStats.vencida}</span>
					</div>
				</div>
				<div class="causa-stat-card">
					<span class="causa-stat-dot dot-cumplida"></span>
					<div class="causa-stat-info">
						<span class="causa-stat-label">Cumplidas (Causas)</span>
						<span class="causa-stat-value">{causasStats.cumplida}</span>
					</div>
				</div>
				<div class="causa-stat-card causa-stat-total">
					<span class="causa-stat-label">Total causas</span>
					<span class="causa-stat-value">{causasStats.total}</span>
				</div>
			</section>
		{/if}

		{#if !isLoading && !showDeleted && Object.keys(tipoCounts).length > 0}
			<div class="tipo-row" role="list" aria-label="Distribución por tipo">
				{#each Object.entries(tipoCounts) as [tipo, count] (tipo)}
					{@const pct = accionCounts.total > 0 ? Math.round((count / accionCounts.total) * 100) : 0}
					<div class="tipo-item" role="listitem">
						<span class="tipo-name">{tipo}</span>
						<div class="tipo-bar-track" aria-label="{tipo}: {count} acciones ({pct}%)">
							<div class="tipo-bar-fill tipo-{tipo.toLowerCase()}" style="width: {pct}%"></div>
						</div>
						<span class="tipo-count">{count}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="filter-bar" role="search">
			<div class="search-wrap">
				<svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
				<input
					type="search"
					placeholder={showDeleted ? 'Buscar en papelera…' : 'Buscar por número, descripción, responsable…'}
					bind:value={searchInput}
					on:input={debounceSearch}
					aria-label="Buscar acciones"
				/>
			</div>

			{#if !showDeleted}
			<nav class="pills" aria-label="Filtros de estado">
				{#each FILTERS as f (f.label)}
					<button
						class="pill"
						class:pill-active={activeFilter === f.value}
						on:click={() => setFilter(f.value)}
						aria-pressed={activeFilter === f.value}
					>
						{f.label}
					{#if f.value}
						<span class="pill-count">
							{f.value === 'EN_PROCESO'
								? accionCounts.enProceso
								: f.value === 'VENCIDA'
									? accionCounts.vencida
									: accionCounts.cumplida}
						</span>
					{/if}
					</button>
				{/each}
			</nav>
			{/if}
		</div>

		<div class="results-info" aria-live="polite" aria-atomic="true">
			{#if isLoading}
				<span>Cargando...</span>
			{:else}
				<span>{showDeleted ? '🗑️ Papelera: ' : ''}{acciones.length} acción{acciones.length !== 1 ? 'es' : ''} encontrada{acciones.length !== 1 ? 's' : ''}</span>
				{#if search || activeFilter}
					<button class="reset-btn" on:click={clearFilters}>
						Limpiar filtros
					</button>
				{/if}
			{/if}
		</div>

		<main>
			{#if isLoading}
				<div class="empty" role="status">
					<div class="spinner"></div>
					<p>Cargando acciones...</p>
				</div>
			{:else if acciones.length === 0}
				<div class="empty" role="status">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
					<p>{showDeleted ? 'No hay acciones en la papelera' : search || activeFilter ? 'Sin resultados para los filtros aplicados' : 'No hay acciones registradas'}</p>
					{#if !search && !activeFilter && !showDeleted}
						<button class="btn-primary" on:click={() => goto('/dashboard/acciones-correctivas/crear')}>
							Crear primera acción
						</button>
					{/if}
				</div>
			{:else}
				<div class="grid" transition:fly={{ y: 12, duration: 400 }}>
					{#each acciones as accion (accion.id)}
						<AccionCard
							{accion}
							highlight={highlightId === accion.id}
							loadingAction={loadingState?.id === accion.id ? loadingState.action : null}
							on:duplicar={handleDuplicar}
							on:eliminar={handleEliminar}
							on:restaurar={handleRestaurar}
							on:eliminar-permanente={handleEliminarPermanente}
							on:pdf={handleExportPDF}
						/>
					{/each}
				</div>
			{/if}
		</main>
	</div>
</div>

<style>
	.dash-wrapper {
		--surface: #fff;
		--surface-hover: #faf7f2;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--border-hover: rgba(0, 0, 0, 0.2);
		--text-primary: #0f1f1a;
		--text-secondary: #4a4a4a;
		--text-muted: #6b6b6b;
		--accent: #f97316;
		--accent-hover: #ea580c;
		--accent-bg: rgba(249, 115, 22, 0.08);
		--accent-ring: rgba(249, 115, 22, 0.15);
		--tag-bg: rgba(0, 0, 0, 0.05);
		--avatar-bg: rgba(0, 0, 0, 0.05);
		--avatar-color: #0f1f1a;
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.dash {
		padding: 2rem 2.5rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.header-left { display: flex; align-items: center; gap: 12px; }
	.header-actions { display: flex; align-items: center; gap: 8px; }
	.btn-trash-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0.55rem 0.85rem;
		background: transparent;
		color: var(--text-muted);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		font-family: inherit;
	}
	.btn-trash-toggle:hover {
		border-color: rgba(220, 38, 38, 0.3);
		color: #b91c1c;
		background: rgba(220, 38, 38, 0.04);
	}
	.btn-trash-active {
		border-color: #b91c1c;
		color: #b91c1c;
		background: rgba(220, 38, 38, 0.06);
	}
	.logo-mark {
		width: 44px;
		height: 44px;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #fff;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.eyebrow {
		display: inline-block;
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent-hover);
		background: var(--accent-bg);
		padding: 0.2rem 0.6rem;
		border-radius: 5px;
		margin-bottom: 0.35rem;
	}
	h1 {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.4rem;
		font-weight: 500;
		color: var(--text-primary);
		letter-spacing: -0.015em;
		line-height: 1.2;
		margin: 0;
	}
	.header-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0.2rem 0 0;
		line-height: 1.45;
	}
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.55rem 1rem;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		white-space: nowrap;
		font-family: inherit;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.btn-primary:active {
		transform: translateY(0);
	}

	.kpi-row,
	.causa-stats-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
	}
	.causa-stat-card {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.85rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		transition: all 0.2s var(--ease);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.causa-stat-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-1px);
	}
	.causa-stat-total {
		justify-content: center;
		background: var(--bg);
	}
	.causa-stat-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.03);
	}
	.dot-proceso { background: #3b82f6; }
	.dot-vencida { background: #ef4444; }
	.dot-cumplida { background: #22c55e; }
	.causa-stat-info { display: flex; flex-direction: column; min-width: 0; }
	.causa-stat-label {
		font-family: 'Geist', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.causa-stat-value {
		font-family: 'Geist', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		margin-top: 0.15rem;
	}
	.causa-stat-total .causa-stat-value { font-size: 1.35rem; }

	.tipo-row {
		display: flex;
		gap: 1.25rem;
		padding: 1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		flex-wrap: wrap;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.tipo-item { display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 140px; }
	.tipo-name {
		font-family: 'Geist', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		min-width: 80px;
	}
	.tipo-bar-track {
		flex: 1;
		height: 6px;
		background: rgba(0, 0, 0, 0.06);
		border-radius: 3px;
		overflow: hidden;
	}
	.tipo-bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
	.tipo-correctiva { background: #f59e0b; }
	.tipo-preventiva { background: #6366f1; }
	.tipo-mejora { background: #22c55e; }
	.tipo-count {
		font-family: 'Geist', monospace;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		min-width: 20px;
		text-align: right;
	}

	.filter-bar {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		padding: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.search-wrap { position: relative; flex: 1; min-width: 220px; }
	.search-icon {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-very-muted, #9a9a9a);
		pointer-events: none;
	}
	.search-wrap input {
		width: 100%;
		padding: 0.55rem 2.4rem 0.55rem;
		font-size: 0.85rem;
		border-radius: 10px;
		border: 1px solid var(--border-default);
		background: var(--surface);
		color: var(--text-primary);
		outline: none;
		transition: all 0.2s var(--ease);
		font-family: inherit;
	}
	.search-wrap input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-ring);
	}
	.search-wrap input::placeholder { color: var(--text-muted); }

	.pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.pill {
		font-family: 'Geist', monospace;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--border-default);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s var(--ease);
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.pill:hover {
		border-color: var(--border-hover);
		color: var(--text-primary);
		background: var(--bg);
	}
	.pill-active {
		background: var(--accent-bg);
		border-color: rgba(249, 115, 22, 0.3);
		color: var(--accent-hover);
	}
	.pill-count {
		font-size: 0.6rem;
		font-weight: 700;
		background: rgba(0, 0, 0, 0.06);
		border-radius: 8px;
		padding: 0.1rem 0.4rem;
		line-height: 1.4;
		font-family: 'Geist', monospace;
	}
	.pill-active .pill-count { background: rgba(249, 115, 22, 0.2); color: var(--accent-hover); }

	.results-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.reset-btn {
		font-size: 0.78rem;
		color: var(--accent);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		font-family: inherit;
		font-weight: 600;
		transition: color 0.2s var(--ease);
	}
	.reset-btn:hover {
		color: var(--accent-hover);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.85rem;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 4rem 2rem;
		color: var(--text-muted);
		text-align: center;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
	}
	.empty p { font-size: 0.88rem; margin: 0; }
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(249, 115, 22, 0.15);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	@media (max-width: 600px) {
		.dash { padding: 1.25rem 1rem 3rem; }
		h1 { font-size: 1.2rem; }
		.tipo-row { gap: 0.75rem; }
		.kpi-row,
		.causa-stats-row {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
