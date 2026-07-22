<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { getEvaluaciones, deleteEvaluacion, type Evaluacion, type Pregunta } from '$lib/api/evaluaciones';
	import DataTable from '$lib/components/ui/data-table/DataTable.svelte';

	let evaluaciones = $state<Evaluacion[]>([]);
	let isLoading = $state(false);
	let totalRows = $state(0);
	let currentPage = $state(1);
	let pageSize = $state(10);
	let sortBy = $state<'titulo' | 'created_at'>('created_at');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	let searchInput = $state('');
	let searchQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	onMount(() => {
		loadEvaluaciones();
	});

	function debounceSearch() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			searchQuery = searchInput;
			currentPage = 1;
		}, 300);
	}

	async function loadEvaluaciones() {
		isLoading = true;
		try {
			const response = await getEvaluaciones({
				page: currentPage,
				limit: pageSize,
				search: searchQuery || undefined,
				sortBy,
				sortOrder
			});

			if (response.success) {
				evaluaciones = response.data;
				totalRows = response.meta?.total ?? response.data.length;
			}
		} catch (err) {
			console.error('Error al cargar evaluaciones:', err);
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		searchQuery;
		sortBy;
		sortOrder;
		currentPage;
		loadEvaluaciones();
	});

	function handleSort(field: string, order: 'asc' | 'desc') {
		sortBy = field as 'titulo' | 'created_at';
		sortOrder = order;
		currentPage = 1;
	}

	function handlePageChange(page: number) {
		currentPage = page;
	}

	function clearSearch() {
		searchInput = '';
		searchQuery = '';
		currentPage = 1;
	}

	function navigateToCrear() {
		goto('/dashboard/evaluaciones/crear');
	}

	function navigateToDetalle(id: string) {
		goto(`/dashboard/evaluaciones/${id}`);
	}

	async function handleDelete(id: string, titulo: string) {
		if (!confirm(`¿Estás seguro de eliminar "${titulo}"?`)) return;
		try {
			const r = await deleteEvaluacion(id);
			if (r.success) loadEvaluaciones();
		} catch (err) {
			console.error('Error al eliminar:', err);
		}
	}

	function getTipoColor(tipo: string) {
		const c: Record<string, string> = {
			OPCION_UNICA: 'chip-blue',
			OPCION_MULTIPLE: 'chip-purple',
			NUMERICA: 'chip-green',
			TEXTO: 'chip-orange',
			RELACION: 'chip-pink',
			VERDADERO_FALSO: 'chip-teal'
		};
		return c[tipo] || 'chip-gray';
	}

	function getTipoLabel(tipo: string) {
		const l: Record<string, string> = {
			OPCION_UNICA: 'Única',
			OPCION_MULTIPLE: 'Múltiple',
			NUMERICA: 'Numérica',
			TEXTO: 'Texto',
			RELACION: 'Relación',
			VERDADERO_FALSO: 'V/F'
		};
		return l[tipo] || tipo;
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function calcularPuntajeTotal(e: Evaluacion) {
		return e.preguntas.reduce((s, p) => s + p.puntaje, 0);
	}
</script>

<svelte:head><title>Evaluaciones - Cotransmeq</title></svelte:head>

<div class="dash-wrapper" in:fade={{ duration: 400 }}>
	<div class="dash">
		<header class="header">
			<div class="header-left">
				<div class="logo-mark" aria-hidden="true">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
				<div>
					<h1>Evaluaciones</h1>
					<p class="header-sub">Sistema de gestión · {new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
				</div>
			</div>
			<button class="btn-primary" on:click={navigateToCrear} aria-label="Crear nueva evaluación">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				Nueva Evaluación
			</button>
		</header>

		<div class="filter-bar" role="search">
			<div class="search-wrap">
				<svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8" />
					<line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
				<input
					type="search"
					placeholder="Buscar evaluación..."
					bind:value={searchInput}
					on:input={debounceSearch}
					aria-label="Buscar evaluaciones"
				/>
			</div>
		</div>

		<div class="results-info" aria-live="polite" aria-atomic="true">
			{#if isLoading}
				<span>Cargando...</span>
			{:else}
				<span>{totalRows} resultado{totalRows !== 1 ? 's' : ''} encontrado{totalRows !== 1 ? 's' : ''}</span>
				{#if searchQuery}
					<button class="reset-btn" on:click={clearSearch}>
						Limpiar búsqueda
					</button>
				{/if}
			{/if}
		</div>

		<div class="desktop-only">
			<DataTable
				data={evaluaciones}
				columns={[
					{
						key: 'titulo',
						label: 'Evaluación',
						sortable: true,
						render: (ev: Evaluacion) => {
							if (!ev) return '<span class="text-muted">Sin datos</span>';
							const titulo = ev.titulo || 'Sin título';
							const desc = ev.descripcion ? `<p class="td-desc">${ev.descripcion}</p>` : '';
							return `<div class="cell-titulo"><span class="td-title td-title-truncate">${titulo}</span>${desc}</div>`;
						}
					},
					{
						key: 'requiere_firma',
						label: 'Firma',
						align: 'center',
						render: (ev: Evaluacion) => {
							if (!ev) return '';
							return ev.requiere_firma
								? '<span class="badge-firma">Firma</span>'
								: '<span class="text-muted">No</span>';
						}
					},
					{
						key: 'preguntas',
						label: 'Preguntas',
						align: 'center',
						render: (ev: Evaluacion) => {
							const count = ev?.preguntas?.length ?? 0;
							return `<span class="num-badge">${count}</span>`;
						}
					},
					{
						key: 'puntaje',
						label: 'Puntaje',
						align: 'center',
						render: (ev: Evaluacion) => {
							const total = ev ? calcularPuntajeTotal(ev) : 0;
							return `<span class="num-badge blue">${total}</span>`;
						}
					},
					{
						key: 'tipos',
						label: 'Tipos',
						render: (ev: Evaluacion) => {
							if (!ev?.preguntas?.length) return '<span class="text-muted">-</span>';
							const tipos = [...new Set(ev.preguntas.map((p: Pregunta) => p.tipo))];
							const chips = tipos.map((t: string) => `<span class="chip ${getTipoColor(t)}">${getTipoLabel(t)}</span>`).join('');
							return `<div class="chips-wrap">${chips}</div>`;
						}
					},
					{
						key: 'created_at',
						label: 'Creada',
						sortable: true,
						render: (ev: Evaluacion) => {
							const date = ev?.created_at ? formatDate(ev.created_at) : '-';
							return `<span class="td-date">${date}</span>`;
						}
					},
					{
						key: 'acciones',
						label: 'Acciones',
						align: 'right',
						render: (ev: Evaluacion) => {
							if (!ev?.id) return '';
							return `
								<div class="actions-wrap">
									<button class="action-btn view" title="Ver" data-action="view">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
											<circle cx="12" cy="12" r="3" />
										</svg>
									</button>
									<button class="action-btn delete" title="Eliminar" data-action="delete">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="3 6 5 6 21 6" />
											<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
										</svg>
									</button>
								</div>
							`;
						}
					}
				]}
				{isLoading}
				{totalRows}
				{currentPage}
				{pageSize}
				onPageChange={handlePageChange}
				onSortChange={handleSort}
				onRowClick={(row) => {
					const ev = row as Evaluacion;
					if (ev?.id) navigateToDetalle(ev.id);
				}}
				onAction={(action, row) => {
					if (!row) return;
					const ev = row as Evaluacion;
					if (action === 'view') {
						navigateToDetalle(ev.id);
					} else if (action === 'delete') {
						handleDelete(ev.id, ev.titulo || '');
					}
				}}
				emptyMessage={searchQuery ? 'Sin resultados para la búsqueda' : 'No hay evaluaciones creadas'}
				emptyActionLabel={!searchQuery ? 'Crear primera evaluación' : undefined}
				onEmptyAction={navigateToCrear}
			/>
		</div>

		<div class="mobile-only">
			{#if isLoading}
				<div class="empty" role="status">
					<div class="spinner"></div>
					<p>Cargando...</p>
				</div>
			{:else if evaluaciones.length === 0}
				<div class="empty" role="status">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
					<p>{searchQuery ? 'Sin resultados para la búsqueda' : 'No hay evaluaciones creadas'}</p>
					{#if !searchQuery}
						<button class="btn-primary" on:click={navigateToCrear}>
							Crear primera evaluación
						</button>
					{/if}
				</div>
			{:else}
				<div class="cards-grid">
					{#each evaluaciones as ev (ev.id)}
						<div class="m-card" on:click={() => navigateToDetalle(ev.id)}>
							<div class="m-card-header">
								<div class="m-card-title-row">
									<span class="m-card-title">{ev.titulo}</span>
									{#if ev.requiere_firma}
										<span class="badge-firma">Firma</span>
									{/if}
								</div>
								{#if ev.descripcion}
									<p class="m-card-desc">{ev.descripcion}</p>
								{/if}
							</div>
							<div class="m-card-stats">
								<div class="m-stat">
									<span class="num-badge">{ev.preguntas.length}</span>
									<span class="m-stat-label">Preguntas</span>
								</div>
								<div class="m-stat">
									<span class="num-badge blue">{calcularPuntajeTotal(ev)}</span>
									<span class="m-stat-label">Puntos</span>
								</div>
								<div class="m-stat-date">{formatDate(ev.created_at)}</div>
							</div>
							<div class="chips-wrap m-chips">
								{#each [...new Set(ev.preguntas.map((p) => p.tipo))] as tipo}
									<span class="chip {getTipoColor(tipo)}">{getTipoLabel(tipo)}</span>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.dash-wrapper {
		--surface: #fff;
		--surface-hover: #f9fafb;
		--border: #e5e7eb;
		--border-hover: #d1d5db;
		--text-primary: #111827;
		--text-secondary: #4b5563;
		--text-muted: #6b7280;
		--accent: #f97316;
		--accent-hover: #ea580c;
		--accent-bg: #d1fae5;
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

	.header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.logo-mark {
		width: 40px;
		height: 40px;
		background: var(--accent-bg);
		color: var(--accent);
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	h1 {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.02em;
		line-height: 1.2;
	}

	.header-sub {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 2px;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
		font-family: inherit;
	}

	.btn-primary:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.btn-primary:active {
		transform: scale(0.98);
	}

	.filter-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.search-wrap {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 200px;
		max-width: 400px;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--text-muted);
		pointer-events: none;
	}

	.search-wrap input {
		width: 100%;
		padding: 9px 12px 9px 36px;
		font-size: 13px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text-primary);
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.search-wrap input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}

	.search-wrap input::placeholder {
		color: var(--text-muted);
	}

	.results-info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		color: var(--text-muted);
	}

	.reset-btn {
		background: none;
		border: none;
		color: var(--accent);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		padding: 0;
		font-family: inherit;
	}

	.reset-btn:hover {
		text-decoration: underline;
	}

	/* Cell styles */
	:global(.cell-titulo) {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	:global(.td-title) {
		font-weight: 600;
		color: var(--text-primary);
	}

	:global(.td-title-truncate) {
		display: block;
		max-width: 400px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.td-desc) {
		font-size: 11px;
		color: var(--text-muted);
		margin: 0;
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.td-date) {
		color: var(--text-muted);
		font-size: 12px;
	}

	:global(.num-badge) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 24px;
		padding: 0 8px;
		font-size: 12px;
		font-weight: 600;
		background: #ecfdf5;
		color: #ea580c;
		border-radius: 6px;
	}

	:global(.num-badge.blue) {
		background: #eff6ff;
		color: #2563eb;
	}

	:global(.badge-firma) {
		display: inline-flex;
		align-items: center;
		padding: 2px 6px;
		font-size: 10px;
		font-weight: 600;
		background: #f3e8ff;
		color: #7c3aed;
		border-radius: 4px;
	}

	:global(.chips-wrap) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	:global(.chip) {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
	}

	:global(.chip-blue) { background: #dbeafe; color: #1d4ed8; }
	:global(.chip-purple) { background: #ede9fe; color: #6d28d9; }
	:global(.chip-green) { background: #dcfce7; color: #15803d; }
	:global(.chip-orange) { background: #ffedd5; color: #c2410c; }
	:global(.chip-pink) { background: #fce7f3; color: #be185d; }
	:global(.chip-teal) { background: #ccfbf1; color: #0f766e; }
	:global(.chip-gray) { background: #f3f4f6; color: #4b5563; }

	:global(.actions-wrap) {
		display: inline-flex;
		gap: 4px;
	}

	:global(.action-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s;
	}

	:global(.action-btn.view) {
		background: #ecfdf5;
		color: #ea580c;
	}

	:global(.action-btn.view:hover) {
		background: #d1fae5;
	}

	:global(.action-btn.delete) {
		background: #fef2f2;
		color: #dc2626;
	}

	:global(.action-btn.delete:hover) {
		background: #fee2e2;
	}

	/* Empty & spinner */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 60px 20px;
		text-align: center;
		color: var(--text-muted);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}

	.empty svg {
		color: #d1d5db;
	}

	.empty p {
		font-size: 13px;
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #e5e7eb;
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Responsive */
	.desktop-only { display: block; }
	.mobile-only { display: none; }

	@media (max-width: 767px) {
		.dash {
			padding: 1.25rem 1rem 2rem;
		}
		.desktop-only { display: none; }
		.mobile-only { display: block; }
	}

	/* Mobile cards */
	.cards-grid {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.m-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.m-card:hover {
		border-color: var(--accent);
	}

	.m-card-header {
		margin-bottom: 12px;
	}

	.m-card-title-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		flex-wrap: wrap;
	}

	.m-card-title {
		font-weight: 600;
		font-size: 14px;
		color: var(--text-primary);
		flex: 1;
	}

	.m-card-desc {
		font-size: 12px;
		color: var(--text-muted);
		margin: 4px 0 0;
	}

	.m-card-stats {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-top: 1px solid #f3f4f6;
		border-bottom: 1px solid #f3f4f6;
		margin-bottom: 10px;
	}

	.m-stat {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.m-stat-label {
		font-size: 11px;
		color: var(--text-muted);
	}

	.m-stat-date {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-muted);
	}

	.m-chips {
		margin: 0;
	}
</style>
