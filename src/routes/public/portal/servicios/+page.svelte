<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import {
		portalSession,
		isAuthenticated,
		conductorNombre
	} from '$lib/stores/portalStore';
	import {
		conductorServiciosStore,
		SERVICIO_STATUS_PALETTE,
		fmtDate,
		fmtCurrency,
		type ServicioConductor,
		type ServicioEstado
	} from '$lib/stores/conductor-servicios';

	type FiltroEstado = 'todos' | ServicioEstado;

	const FILTROS: { value: FiltroEstado; label: string; icon: string }[] = [
		{ value: 'todos', label: 'Todos', icon: '📋' },
		{ value: 'planificado', label: 'Planificados', icon: '📅' },
		{ value: 'en_curso', label: 'En curso', icon: '▶️' },
		{ value: 'realizado', label: 'Realizados', icon: '✅' },
		{ value: 'pendiente', label: 'Pendientes', icon: '⏳' }
	];

	let filtroActivo: FiltroEstado = 'todos';
	let search = '';
	let refreshing = false;
	let pullStart = 0;
	let pullDelta = 0;
	let refreshingDown = false;

	$: servicios = $conductorServiciosStore.servicios;
	$: loading = $conductorServiciosStore.loading;
	$: error = $conductorServiciosStore.error;

	$: serviciosFiltrados = filtrarServicios(servicios, filtroActivo, search);

	function filtrarServicios(list: ServicioConductor[], filtro: FiltroEstado, query: string) {
		let r = list;
		if (filtro === 'planificado') r = r.filter((s) => s.estado === 'planificado');
		else if (filtro === 'en_curso') r = r.filter((s) => s.estado === 'en_curso');
		else if (filtro === 'realizado') r = r.filter((s) => s.estado === 'realizado');
		else if (filtro === 'pendiente') r = r.filter((s) => s.estado === 'pendiente');

		const q = query.trim().toLowerCase();
		if (q) {
			r = r.filter(
				(s) =>
					s.origen_especifico?.toLowerCase().includes(q) ||
					s.destino_especifico?.toLowerCase().includes(q) ||
					s.origen?.nombre_municipio?.toLowerCase().includes(q) ||
					s.destino?.nombre_municipio?.toLowerCase().includes(q) ||
					s.vehiculo?.placa?.toLowerCase().includes(q) ||
					s.cliente?.nombre?.toLowerCase().includes(q) ||
					s.numero_planilla?.toLowerCase().includes(q)
			);
		}
		return r;
	}

	$: counts = {
		todos: servicios.length,
		planificado: servicios.filter((s) => s.estado === 'planificado').length,
		en_curso: servicios.filter((s) => s.estado === 'en_curso').length,
		realizado: servicios.filter((s) => s.estado === 'realizado').length,
		pendiente: servicios.filter((s) => s.estado === 'pendiente').length
	} as Record<FiltroEstado, number>;

	async function cargar() {
		await conductorServiciosStore.cargarServicios();
	}

	async function handleRefresh() {
		refreshing = true;
		await cargar();
		refreshing = false;
	}

	function verDetalle(id: string) {
		goto(`/public/portal/servicios/${id}`);
	}

	function handleTouchStart(e: TouchEvent) {
		if (window.scrollY === 0) {
			pullStart = e.touches[0].clientY;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (pullStart === 0 || window.scrollY > 0) return;
		pullDelta = Math.max(0, e.touches[0].clientY - pullStart);
		if (pullDelta > 60 && !refreshingDown) {
			refreshingDown = true;
		}
	}

	async function handleTouchEnd() {
		if (refreshingDown && pullDelta > 80) {
			await handleRefresh();
		}
		pullStart = 0;
		pullDelta = 0;
		refreshingDown = false;
	}

	onMount(async () => {
		if (!$isAuthenticated) {
			goto('/public/portal');
			return;
		}
		await cargar();
	});
</script>

<svelte:head>
	<title>Mis Servicios · Portal Conductor</title>
</svelte:head>

<div
	class="page-servicios"
	role="feed"
	aria-label="Lista de servicios"
	on:touchstart={handleTouchStart}
	on:touchmove={handleTouchMove}
	on:touchend={handleTouchEnd}
>
	<!-- ─── HEADER ─── -->
	<header class="page-header">
		<div class="header-row">
			<div class="header-info">
				<p class="header-eyebrow">Hola, {$conductorNombre.split(' ')[0] || 'Conductor'}</p>
				<h1 class="header-title">Mis servicios</h1>
			</div>
			<button
				class="refresh-btn"
				class:spinning={refreshing}
				on:click={handleRefresh}
				aria-label="Actualizar"
				disabled={refreshing}
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
			</button>
		</div>

		<!-- Search -->
		<label class="search-wrap">
			<svg
				class="search-icon"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<input
				type="search"
				bind:value={search}
				placeholder="Buscar por ciudad, vehículo, cliente..."
				class="search-input"
			/>
		</label>

		<!-- Filtros pill scrollables (mobile) -->
		<div class="filters-scroll">
			{#each FILTROS as f}
				<button
					class="filter-pill"
					class:active={filtroActivo === f.value}
					on:click={() => (filtroActivo = f.value)}
				>
					<span class="filter-icon">{f.icon}</span>
					<span class="filter-label">{f.label}</span>
					{#if counts[f.value] > 0}
						<span class="filter-count">{counts[f.value]}</span>
					{/if}
				</button>
			{/each}
		</div>
	</header>

	<!-- ─── BODY ─── -->
	<main class="page-body">
		{#if loading && servicios.length === 0}
			<div class="loading-state">
				<div class="spinner"></div>
				<p>Cargando servicios...</p>
			</div>
		{:else if error}
			<div class="error-state">
				<div class="error-icon">⚠️</div>
				<p class="error-title">No pudimos cargar tus servicios</p>
				<p class="error-msg">{error}</p>
				<button class="btn-retry" on:click={handleRefresh}>Reintentar</button>
			</div>
		{:else if serviciosFiltrados.length === 0}
			<div class="empty-state">
				<div class="empty-icon">📭</div>
				<p class="empty-title">No hay servicios {filtroActivo !== 'todos' ? 'con este filtro' : 'asignados'}</p>
				<p class="empty-msg">
					{filtroActivo === 'todos'
						? 'Cuando te asignen un servicio aparecerá aquí.'
						: 'Intenta con otro filtro o vuelve a "Todos".'}
				</p>
			</div>
		{:else}
			<div class="servicios-list" in:fade={{ duration: 200 }}>
				{#each serviciosFiltrados as servicio, i (servicio.id)}
					{@const pal = SERVICIO_STATUS_PALETTE[servicio.estado]}
					<button
						class="servicio-card"
						in:fly={{ y: 16, duration: 250, delay: Math.min(i * 40, 240) }}
						on:click={() => verDetalle(servicio.id)}
						aria-label="Ver detalle del servicio {servicio.origen_especifico} a {servicio.destino_especifico}"
					>
						<!-- Status badge -->
						<div
							class="status-badge"
							style="background-color: {pal.bg}; color: {pal.fg}; border-color: {pal.border}"
						>
							<span class="status-dot" style="background-color: {pal.dot}"></span>
							{pal.label}
						</div>

						<!-- Recorrido A → B -->
						<div class="route-row">
							<div class="route-side">
								<div class="route-pin origin">A</div>
								<div class="route-line"></div>
								<div class="route-pin dest">B</div>
							</div>
							<div class="route-locations">
								<p class="loc-text origin-text">
									{servicio.origen_especifico || servicio.origen?.nombre_municipio || '—'}
								</p>
								<p class="loc-text dest-text">
									{servicio.destino_especifico || servicio.destino?.nombre_municipio || '—'}
								</p>
							</div>
						</div>

						<!-- Meta grid -->
						<div class="meta-grid">
							<div class="meta-item">
								<svg
									class="meta-icon"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
								<div class="meta-text">
									<p class="meta-label">Fecha</p>
									<p class="meta-value">{fmtDate(servicio.fecha_solicitud)}</p>
								</div>
							</div>
							<div class="meta-item">
								<svg
									class="meta-icon"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
									/>
								</svg>
								<div class="meta-text">
									<p class="meta-label">Vehículo</p>
									<p class="meta-value">
										{servicio.vehiculo?.placa ?? 'Sin asignar'}
									</p>
								</div>
							</div>
						</div>

						<!-- Footer: cliente + chevron -->
						<div class="card-footer">
							<div class="cliente-mini">
								<svg
									class="h-3.5 w-3.5"
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
								<span class="cliente-text">
									{servicio.cliente?.nombre || '—'}
								</span>
							</div>
							<svg
								class="chevron"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	.page-servicios {
		display: flex;
		flex-direction: column;
		min-height: 100%;
		width: 100%;
		max-width: 100%;
		overflow-x: hidden;
	}

	/* ─── HEADER ─── */
	.page-header {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1rem 1rem 0.85rem;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid #e5e7eb;
	}

	.header-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}

	.header-eyebrow {
		font-size: 0.75rem;
		font-weight: 600;
		color: #ea580c;
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.header-title {
		font-size: 1.5rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0.1rem 0 0;
		line-height: 1.1;
	}

	.refresh-btn {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		background: white;
		color: #475569;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: all 0.2s;
	}

	.refresh-btn:active:not(:disabled) {
		transform: scale(0.92);
	}

	.refresh-btn:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.refresh-btn.spinning svg {
		animation: spin 0.9s linear infinite;
	}

	/* ─── SEARCH ─── */
	.search-wrap {
		position: relative;
		display: block;
	}

	.search-icon {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		width: 1.05rem;
		height: 1.05rem;
		color: #94a3b8;
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.65rem 0.9rem 0.65rem 2.5rem;
		font-size: 0.92rem;
		font-weight: 500;
		color: #0f172a;
		background: #f8fafc;
		border: 1.5px solid #e2e8f0;
		border-radius: 12px;
		outline: none;
		font-family: inherit;
		transition: border-color 0.2s, background 0.2s;
		appearance: none;
		-webkit-appearance: none;
	}

	.search-input:focus {
		border-color: #ea580c;
		background: white;
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.1);
	}

	.search-input::placeholder {
		color: #94a3b8;
		font-weight: 400;
	}

	/* ─── FILTROS ─── */
	.filters-scroll {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		-ms-overflow-style: none;
		padding: 0 0 0.15rem;
		scroll-padding-left: 0;
		-webkit-overflow-scrolling: touch;
	}

	.filters-scroll::-webkit-scrollbar {
		display: none;
	}

	.filter-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.85rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #475569;
		background: #f1f5f9;
		border: 1.5px solid transparent;
		border-radius: 99px;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
		transition: all 0.18s;
		font-family: inherit;
		min-height: 36px;
	}

	.filter-pill:active {
		transform: scale(0.96);
	}

	.filter-pill.active {
		background: #ecfdf5;
		border-color: #f97316;
		color: #047857;
	}

	.filter-icon {
		font-size: 0.95rem;
		line-height: 1;
	}

	.filter-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		font-weight: 700;
		border-radius: 99px;
		background: #cbd5e1;
		color: #0f172a;
	}

	.filter-pill.active .filter-count {
		background: #f97316;
		color: white;
	}

	/* ─── BODY ─── */
	.page-body {
		flex: 1;
		padding: 1rem;
	}

	/* Loading */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 3rem 1rem;
		color: #64748b;
		font-size: 0.9rem;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid #e2e8f0;
		border-top-color: #ea580c;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	/* Error */
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		text-align: center;
	}

	.error-icon {
		font-size: 2.5rem;
	}

	.error-title {
		font-size: 1rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0.5rem 0 0;
	}

	.error-msg {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0;
	}

	.btn-retry {
		margin-top: 0.75rem;
		padding: 0.6rem 1.25rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: white;
		background: linear-gradient(135deg, #ea580c, #047857);
		border: none;
		border-radius: 10px;
		cursor: pointer;
		font-family: inherit;
	}

	/* Empty */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 3rem 1rem;
		text-align: center;
	}

	.empty-icon {
		font-size: 3rem;
		opacity: 0.7;
	}

	.empty-title {
		font-size: 1rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0.5rem 0 0;
	}

	.empty-msg {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0;
		max-width: 280px;
	}

	/* ─── SERVICIO CARD ─── */
	.servicios-list {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		min-width: 0;
	}

	.servicio-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1rem;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 16px;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
		transition: all 0.18s;
		-webkit-tap-highlight-color: transparent;
		min-width: 0;
		max-width: 100%;
	}

	.servicio-card:active {
		transform: scale(0.985);
		border-color: #f97316;
		box-shadow: 0 4px 16px rgba(234, 88, 12, 0.1);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		align-self: flex-start;
		padding: 0.25rem 0.65rem;
		font-size: 0.7rem;
		font-weight: 700;
		border: 1px solid;
		border-radius: 8px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	/* Route */
	.route-row {
		display: flex;
		gap: 0.75rem;
		align-items: stretch;
		min-width: 0;
	}

	.route-side {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 0.15rem;
	}

	.route-pin {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 800;
		color: white;
		flex-shrink: 0;
	}

	.route-pin.origin {
		background: #ea580c;
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.15);
	}

	.route-pin.dest {
		background: #dc2626;
		box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.15);
	}

	.route-line {
		width: 2px;
		flex: 1;
		min-height: 14px;
		background: linear-gradient(to bottom, #ea580c, #dc2626);
		margin: 2px 0;
		opacity: 0.6;
	}

	.route-locations {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		justify-content: space-between;
		min-width: 0;
	}

	.loc-text {
		font-size: 0.92rem;
		font-weight: 600;
		color: #0f172a;
		margin: 0;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 1;
		line-clamp: 1;
		-webkit-box-orient: vertical;
	}

	/* Meta grid */
	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px dashed #e2e8f0;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.meta-icon {
		width: 1rem;
		height: 1rem;
		color: #94a3b8;
		flex-shrink: 0;
	}

	.meta-text {
		min-width: 0;
		flex: 1;
	}

	.meta-label {
		font-size: 0.65rem;
		font-weight: 600;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0;
		line-height: 1.2;
	}

	.meta-value {
		font-size: 0.8rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Footer */
	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px solid #f1f5f9;
		min-width: 0;
	}

	.cliente-mini {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		flex: 1;
		color: #64748b;
	}

	.cliente-text {
		font-size: 0.78rem;
		font-weight: 600;
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chevron {
		width: 1.1rem;
		height: 1.1rem;
		color: #94a3b8;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ─── RESPONSIVE ≥ sm ─── */
	@media (min-width: 640px) {
		.page-header {
			padding: 1.25rem 1.5rem 1rem;
		}
		.page-body {
			padding: 1.25rem 1.5rem;
		}
		.header-title {
			font-size: 1.75rem;
		}
		.servicios-list {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
			gap: 1rem;
		}
	}

	@media (min-width: 1024px) {
		.page-header {
			padding: 1.5rem 2rem 1.25rem;
		}
		.page-body {
			padding: 1.5rem 2rem;
		}
	}
</style>
