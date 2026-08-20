<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import {
		sarlaftAPI,
		TIPO_FORMULARIO_LABELS,
		TIPO_FORMULARIO_CODIGOS,
		ESTADO_LABELS,
		type TipoFormularioSarlaft,
		type EstadoSarlaft,
		type SarlaftFormularioResumen
	} from '$lib/api/sarlaft';
	import { toast } from 'svelte-sonner';

	let items: SarlaftFormularioResumen[] = [];
	let pagination = { page: 1, limit: 20, total: 0, pages: 1 };
	let isLoading = true;
	let error: string | null = null;

	let searchTerm = '';
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let filtroTipo: TipoFormularioSarlaft | 'TODOS' = 'TODOS';
	let filtroEstado: EstadoSarlaft | 'TODOS' = 'TODOS';

	$: stats = {
		total: pagination.total,
		pendientes: items.filter((i) => i.estado === 'recibido').length,
		enRevision: items.filter((i) => i.estado === 'en_revision').length,
		aprobados: items.filter((i) => i.estado === 'aprobado').length,
		rechazados: items.filter((i) => i.estado === 'rechazado').length,
		documentos: items.reduce((acc, i) => acc + i.documentos_count, 0)
	};

	$: hasActiveFilter = searchTerm.trim() !== '' || filtroTipo !== 'TODOS' || filtroEstado !== 'TODOS';

	async function load() {
		isLoading = true;
		error = null;
		try {
			const params: any = { page: pagination.page, limit: pagination.limit };
			if (searchTerm.trim()) params.search = searchTerm.trim();
			if (filtroTipo !== 'TODOS') params.tipo_formulario = filtroTipo;
			if (filtroEstado !== 'TODOS') params.estado = filtroEstado;
			const data = await sarlaftAPI.listar(params);
			items = data.items;
			pagination = data.pagination;
		} catch (err: any) {
			const status = err?.response?.status;
			const msg = err?.response?.data?.error || err?.message || 'Error al cargar los formularios';
			error = status
				? `${msg} (HTTP ${status})`
				: `No se pudo conectar con el backend (${msg}). Verifica que VITE_API_URL en .env apunte al servidor correcto.`;
			toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	function onSearchInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			pagination.page = 1;
			load();
		}, 350);
	}

	function setTipo(t: TipoFormularioSarlaft | 'TODOS') {
		filtroTipo = t;
		pagination.page = 1;
		load();
	}

	function setEstado(e: EstadoSarlaft | 'TODOS') {
		filtroEstado = e;
		pagination.page = 1;
		load();
	}

	function limpiarFiltros() {
		searchTerm = '';
		filtroTipo = 'TODOS';
		filtroEstado = 'TODOS';
		pagination.page = 1;
		load();
	}

	function irAPagina(p: number) {
		if (p < 1 || p > pagination.pages) return;
		pagination.page = p;
		load();
	}

	function verDetalle(id: string) {
		goto(`/dashboard/sarlaft/${id}`);
	}

	function formatFechaCorta(iso: string) {
		return new Date(iso).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: '2-digit'
		});
	}

	function tiempoRelativo(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const min = Math.floor(diff / 60000);
		if (min < 1) return 'hace un momento';
		if (min < 60) return `hace ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `hace ${h} h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `hace ${d} d`;
		if (d < 30) return `hace ${Math.floor(d / 7)} sem`;
		return formatFechaCorta(iso);
	}

	function initials(name: string | null): string {
		if (!name) return '?';
		const parts = name.trim().split(/\s+/);
		if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	onMount(() => {
		load();
	});
</script>

<svelte:head>
	<title>SARLAFT + PTEE · Cotransmeq</title>
</svelte:head>

<div class="sarlaft-page" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
	<!-- ═══ HERO EDITORIAL ═══ -->
	<header class="page-hero" in:fade={{ duration: 400 }}>
		<div class="hero-inner">
			<div class="hero-left">
				<div class="card-icon hero-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
				</div>
				<div class="hero-text">
					<span class="eyebrow">Cumplimiento · SARLAFT + PTEE</span>
					<h1>Formularios de conocimiento</h1>
					<p>
						Gestión, revisión y trazabilidad de los formularios radicados por clientes, proveedores,
						accionistas y personal vinculado a COTRANSMEQ S.A.S..
					</p>
					<div class="compliance-tags">
						<span class="compliance-tag">Resolución 2328/2025</span>
						<span class="compliance-tag">Resolución 14673/2025</span>
						<span class="compliance-tag">Ley 1581/2012</span>
					</div>
				</div>
			</div>
		</div>

		<div class="hero-stats">
			<div class="stat-item">
				<span class="stat-label">Total</span>
				<span class="stat-value">{stats.total}</span>
			</div>
			<span class="stat-sep" aria-hidden="true">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--blue" aria-hidden="true"></span>
				<span class="stat-label">Recibidos</span>
				<span class="stat-value">{stats.pendientes}</span>
			</div>
			<span class="stat-sep" aria-hidden="true">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--amber" aria-hidden="true"></span>
				<span class="stat-label">En revisión</span>
				<span class="stat-value">{stats.enRevision}</span>
			</div>
			<span class="stat-sep" aria-hidden="true">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--aprobado" aria-hidden="true"></span>
				<span class="stat-label">Aprobados</span>
				<span class="stat-value">{stats.aprobados}</span>
			</div>
			<span class="stat-sep" aria-hidden="true">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--red" aria-hidden="true"></span>
				<span class="stat-label">Rechazados</span>
				<span class="stat-value">{stats.rechazados}</span>
			</div>
			<span class="stat-sep" aria-hidden="true">·</span>
			<div class="stat-item">
				<svg class="h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
				</svg>
				<span class="stat-label">Documentos</span>
				<span class="stat-value">{stats.documentos}</span>
			</div>
		</div>
	</header>

	<!-- ═══ FILTROS ═══ -->
	<div class="filters-bar" in:fade={{ duration: 400, delay: 100 }}>
		<div class="search-wrap">
			<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
			</svg>
			<input
				type="text"
				bind:value={searchTerm}
				oninput={onSearchInput}
				placeholder="Buscar por radicado, nombre, cédula o correo…"
				class="search-input"
			/>
		</div>

		<div class="filter-group">
			<span class="filter-label">Tipo</span>
			{#each [{ k: 'TODOS', l: 'Todos' }, { k: 'cliente_proveedor', l: 'Cliente/Prov.' }, { k: 'accionistas', l: 'Accionistas' }, { k: 'personal', l: 'Personal' }, { k: 'autorizacion_propietario', l: 'Autoriz. propietario' }] as f}
				<button
					class="chip"
					class:chip--active={filtroTipo === f.k}
					onclick={() => setTipo(f.k as typeof filtroTipo)}
				>
					{f.l}
				</button>
			{/each}
		</div>

		<div class="filter-group">
			<span class="filter-label">Estado</span>
			{#each [{ k: 'TODOS', l: 'Todos' }, { k: 'recibido', l: 'Recibido' }, { k: 'en_revision', l: 'En revisión' }, { k: 'aprobado', l: 'Aprobado' }, { k: 'rechazado', l: 'Rechazado' }, { k: 'escalado', l: 'Escalado' }] as f}
				<button
					class="chip"
					class:chip--active={filtroEstado === f.k}
					onclick={() => setEstado(f.k as typeof filtroEstado)}
				>
					{#if f.k !== 'TODOS'}
						<span
							class="chip-dot"
							style="background: {ESTADO_LABELS[f.k as EstadoSarlaft].dot}"
							aria-hidden="true"
						></span>
					{/if}
					{f.l}
				</button>
			{/each}
		</div>

		{#if hasActiveFilter}
			<button class="clear-btn" onclick={limpiarFiltros}>
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
				Limpiar
			</button>
		{/if}
	</div>

	<!-- ═══ LISTADO ═══ -->
	{#if isLoading}
		<div class="state-block" in:fade>
			<div class="spin-ring" aria-hidden="true"></div>
			<p>Cargando formularios…</p>
		</div>
	{:else if error && items.length === 0}
		<div class="alert alert-error" in:fade>
			<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
			</svg>
			<div class="alert-body">
				<strong>No pudimos cargar el listado.</strong>
				<span>{error}</span>
			</div>
			<button class="btn-secondary btn-secondary--sm" onclick={() => load()}>Reintentar</button>
		</div>
	{:else if items.length === 0}
		<div class="empty-state" in:fade>
			<div class="empty-icon" aria-hidden="true">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.4">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.621 1.125a3.375 3.375 0 00-3.321 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<span class="eyebrow eyebrow--center">Sin formularios</span>
			<h3>No hay formularios recibidos</h3>
			<p>
				{hasActiveFilter
					? 'No hay resultados con los filtros aplicados. Ajusta los criterios para ampliar la búsqueda.'
					: 'Cuando alguien diligencie un formulario público aparecerá aquí para tu revisión.'}
			</p>
			{#if hasActiveFilter}
				<button class="btn-secondary" onclick={limpiarFiltros}>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
					Limpiar filtros
				</button>
			{/if}
		</div>
	{:else}
		<div class="cards-list">
			{#each items as item, idx (item.id)}
				{@const estado = ESTADO_LABELS[item.estado]}
				<button
					type="button"
					class="form-card"
					onclick={() => verDetalle(item.id)}
					in:fly={{ y: 12, duration: 280, delay: Math.min(idx * 30, 350), easing: quintOut }}
				>
					<header class="form-head">
						<div class="form-avatar form-avatar--{item.estado}">
							<span>{initials(item.nombre_completo)}</span>
						</div>
						<div class="form-head-text">
							<div class="form-head-row">
								<span class="radicado-pill">{item.radicado}</span>
								<span class="codigo-pill">{item.codigo_formulario} · v{item.version}</span>
							</div>
							<h3>{item.nombre_completo ?? 'Sin nombre'}</h3>
							<span class="form-sub">
								{TIPO_FORMULARIO_LABELS[item.tipo_formulario]}
								{#if item.tipo_documento || item.numero_documento}
									<span class="form-sep">·</span>
									<span class="mono">{item.tipo_documento ?? 'Doc'}: {item.numero_documento ?? '—'}</span>
								{/if}
							</span>
						</div>
						<span
							class="estado-pill"
							style="background-color: {estado.bg}; color: {estado.color}; border-color: {estado.border}"
						>
							<span class="estado-dot" style="background-color: {estado.dot}"></span>
							{estado.label}
						</span>
					</header>

					<div class="form-meta">
						<div class="meta-item">
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
							</svg>
							<span class="mono">{item.correo ?? '—'}</span>
						</div>
						{#if item.telefono}
							<div class="meta-item">
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
								</svg>
								<span class="mono">{item.telefono}</span>
							</div>
						{/if}
					</div>

					<footer class="form-foot">
						<div class="form-foot-left">
							<div class="form-date">
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
								</svg>
								<span class="mono">{formatFechaCorta(item.fecha_envio)}</span>
								<span class="form-date-rel">· {tiempoRelativo(item.fecha_envio)}</span>
							</div>
							{#if item.documentos_count > 0}
								<div class="form-docs">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
									</svg>
									<span class="mono">{item.documentos_count}</span>
									<span>documento{item.documentos_count !== 1 ? 's' : ''}</span>
								</div>
							{:else}
								<div class="form-docs form-docs--empty">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
									</svg>
									<span>Sin documentos</span>
								</div>
							{/if}
						</div>
						<span class="card-link">
							Abrir
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
							</svg>
						</span>
					</footer>
				</button>
			{/each}
		</div>

		<!-- Paginación -->
		{#if pagination.pages > 1}
			<nav class="pagination" aria-label="Paginación de formularios">
				<p class="pagination-info">
					<span class="mono">
						{(pagination.page - 1) * pagination.limit + 1}–{Math.min(
							pagination.page * pagination.limit,
							pagination.total
						)}
					</span>
					de <span class="mono">{pagination.total}</span>
				</p>
				<div class="pagination-controls">
					<button
						class="page-arrow"
						onclick={() => irAPagina(pagination.page - 1)}
						disabled={pagination.page === 1}
						aria-label="Página anterior"
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
						</svg>
					</button>
					{#each Array(pagination.pages) as _, i}
						{@const p = i + 1}
						{#if p === pagination.page || p === 1 || p === pagination.pages || Math.abs(p - pagination.page) <= 1}
							<button
								class="page-num"
								class:page-num--active={p === pagination.page}
								onclick={() => irAPagina(p)}
							>
								{p}
							</button>
						{:else if p === pagination.page - 2 || p === pagination.page + 2}
							<span class="page-ellipsis">…</span>
						{/if}
					{/each}
					<button
						class="page-arrow"
						onclick={() => irAPagina(pagination.page + 1)}
						disabled={pagination.page === pagination.pages}
						aria-label="Página siguiente"
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
						</svg>
					</button>
				</div>
			</nav>
		{/if}
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════════════════════════════
	   PAGE BASE
	   ═══════════════════════════════════════════════════════════════ */
	.sarlaft-page {
		min-height: 100vh;
		background: #fcfcfb;
		font-family: 'Geist', system-ui, sans-serif;
		color: #1e293b;
		padding: 1.5rem 1.25rem 3rem;
		max-width: 1400px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   TYPOGRAPHY
	   ═══════════════════════════════════════════════════════════════ */
	.eyebrow {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		font-family: 'Geist', ui-monospace, monospace;
	}
	.eyebrow--center {
		display: block;
		text-align: center;
		margin: 0 auto 0.5rem;
		width: fit-content;
	}
	h1,
	h3 {
		font-family: 'Geist', system-ui, sans-serif;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.mono {
		font-family: 'Geist', ui-monospace, monospace;
	}

	/* ═══════════════════════════════════════════════════════════════
	   HERO
	   ═══════════════════════════════════════════════════════════════ */
	.page-hero {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 24px;
		padding: 1.75rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.hero-inner {
		margin-bottom: 1.5rem;
	}
	.hero-left {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}
	.hero-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
	}
	.hero-text h1 {
		font-size: clamp(1.6rem, 3.5vw, 2.1rem);
		font-weight: 500;
		line-height: 1.15;
		margin: 0;
	}
	.hero-text p {
		font-size: 0.92rem;
		line-height: 1.6;
		color: #475569;
		margin: 0;
		max-width: 640px;
	}
	.compliance-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.compliance-tag {
		display: inline-flex;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #9a3412;
		background: rgba(249, 115, 22, 0.06);
		padding: 0.25rem 0.55rem;
		border-radius: 5px;
		border: 1px solid rgba(249, 115, 22, 0.15);
	}

	.hero-stats {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
		padding-top: 1.1rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		font-family: 'Geist', ui-monospace, monospace;
	}
	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.stat-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}
	.stat-value {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
	}
	.stat-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.stat-dot--aprobado {
		background: #22c55e;
	}
	.stat-dot--blue {
		background: #3b82f6;
	}
	.stat-dot--amber {
		background: #f59e0b;
	}
	.stat-dot--red {
		background: #ef4444;
	}
	.stat-sep {
		color: #cbd5e1;
	}

	/* ═══════════════════════════════════════════════════════════════
	   FILTERS BAR
	   ═══════════════════════════════════════════════════════════════ */
	.filters-bar {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 16px;
		padding: 0.85rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 240px;
	}
	.search-icon {
		position: absolute;
		left: 0.9rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: #94a3b8;
		pointer-events: none;
	}
	.search-input {
		width: 100%;
		padding: 0.6rem 0.9rem 0.6rem 2.5rem;
		font-family: inherit;
		font-size: 0.88rem;
		color: #1e293b;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.search-input::placeholder {
		color: #94a3b8;
	}
	.search-input:focus {
		background: white;
		border-color: rgba(249, 115, 22, 0.4);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}

	.filter-group {
		display: flex;
		gap: 0.3rem;
		padding: 0.25rem;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 12px;
		flex-wrap: wrap;
	}
	.filter-label {
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
		padding: 0 0.4rem;
		align-self: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.7rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #475569;
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.chip:hover {
		color: #0f172a;
	}
	.chip--active {
		background: white;
		color: #9a3412;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.chip-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}

	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #64748b;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.clear-btn:hover {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.04);
	}

	/* ═══════════════════════════════════════════════════════════════
	   FORM CARDS LIST
	   ═══════════════════════════════════════════════════════════════ */
	.cards-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.form-card {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 18px;
		padding: 1.1rem 1.25rem;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.form-card:hover,
	.form-card:focus-visible {
		transform: translateY(-2px);
		border-color: rgba(249, 115, 22, 0.3);
		box-shadow: 0 10px 28px rgba(249, 115, 22, 0.1);
		outline: none;
	}

	.form-head {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
	}
	.form-avatar {
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		border-radius: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.form-avatar--recibido {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(37, 99, 235, 0.18));
		color: #1e40af;
	}
	.form-avatar--en_revision {
		background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(217, 119, 6, 0.18));
		color: #854d0e;
	}
	/* "Aprobado" conserva el verde: es un color de estado, no de marca. Coincide
	   con ESTADO_LABELS.aprobado y con --emerald-800 (#166534) de app.css, que
	   el sistema reserva justamente para este caso. */
	.form-avatar--aprobado {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(22, 101, 52, 0.2));
		color: #166534;
	}
	.form-avatar--rechazado {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(220, 38, 38, 0.18));
		color: #991b1b;
	}
	.form-avatar--escalado {
		background: linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(124, 58, 237, 0.18));
		color: #5b21b6;
	}

	.form-head-text {
		flex: 1;
		min-width: 0;
	}
	.form-head-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.3rem;
	}
	.radicado-pill {
		display: inline-flex;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.72rem;
		font-weight: 700;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.18rem 0.55rem;
		border-radius: 5px;
		letter-spacing: 0.04em;
	}
	.codigo-pill {
		display: inline-flex;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.65rem;
		font-weight: 600;
		color: #64748b;
		background: rgba(0, 0, 0, 0.04);
		padding: 0.18rem 0.5rem;
		border-radius: 5px;
		letter-spacing: 0.04em;
	}
	.form-head-text h3 {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0 0 0.2rem;
		color: #0f172a;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.form-sub {
		font-size: 0.78rem;
		color: #64748b;
	}
	.form-sep {
		margin: 0 0.4rem;
		color: #cbd5e1;
	}

	.estado-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.25rem 0.55rem;
		border-radius: 5px;
		border: 1px solid;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.estado-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.form-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding: 0.6rem 0;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: #64748b;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta-item svg {
		color: #94a3b8;
		flex-shrink: 0;
	}

	.form-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.form-foot-left {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.form-date,
	.form-docs {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: #475569;
	}
	.form-date svg,
	.form-docs svg {
		color: #94a3b8;
	}
	.form-date-rel {
		color: #94a3b8;
	}
	.form-docs--empty {
		color: #94a3b8;
	}

	.card-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #f97316;
		transition: gap 0.2s;
	}
	.card-link svg {
		width: 14px;
		height: 14px;
	}
	.form-card:hover .card-link {
		gap: 0.65rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   PAGINATION
	   ═══════════════════════════════════════════════════════════════ */
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.5rem;
		padding: 0.85rem 1.25rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 14px;
	}
	.pagination-info {
		font-size: 0.78rem;
		color: #64748b;
		margin: 0;
	}
	.pagination-info .mono {
		color: #0f172a;
		font-weight: 700;
	}
	.pagination-controls {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.page-arrow,
	.page-num {
		min-width: 32px;
		height: 32px;
		padding: 0 0.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #475569;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.page-arrow svg {
		width: 14px;
		height: 14px;
	}
	.page-arrow:hover:not(:disabled),
	.page-num:hover {
		background: #fcfcfb;
		color: #0f172a;
	}
	.page-arrow:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.page-num--active {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);
	}
	.page-num--active:hover {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
	}
	.page-ellipsis {
		padding: 0 0.4rem;
		color: #94a3b8;
		font-size: 0.78rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ESTADOS GENERALES
	   ═══════════════════════════════════════════════════════════════ */
	.state-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 4rem 1.5rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 20px;
		color: #64748b;
		font-size: 0.88rem;
	}
	.spin-ring {
		width: 30px;
		height: 30px;
		border: 2.5px solid rgba(249, 115, 22, 0.15);
		border-top-color: #f97316;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 4rem 1.5rem;
		background: white;
		border: 1px dashed rgba(0, 0, 0, 0.12);
		border-radius: 24px;
		text-align: center;
	}
	.empty-state h3 {
		font-size: 1.3rem;
		font-weight: 500;
		margin: 0.25rem 0 0;
	}
	.empty-state p {
		font-size: 0.88rem;
		color: #475569;
		max-width: 480px;
		margin: 0 0 1rem;
		line-height: 1.55;
	}
	.empty-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(234, 88, 12, 0.12));
		color: #f97316;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.4rem;
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.12);
	}
	.empty-icon svg {
		width: 28px;
		height: 28px;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ALERT
	   ═══════════════════════════════════════════════════════════════ */
	.alert {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.95rem 1.1rem;
		border-radius: 12px;
		font-size: 0.88rem;
	}
	.alert-error {
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.2);
		color: #991b1b;
	}
	.alert-error svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: #dc2626;
	}
	.alert-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.alert-body strong {
		font-weight: 700;
	}
	.alert-body span {
		font-size: 0.82rem;
		color: #b91c1c;
	}

	/* ═══════════════════════════════════════════════════════════════
	   BOTONES
	   ═══════════════════════════════════════════════════════════════ */
	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.65rem 1.15rem;
		font-family: 'Geist', system-ui, sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 11px;
		cursor: pointer;
		transition: all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.btn-primary {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.28);
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.btn-secondary {
		background: white;
		color: #1e293b;
		border-color: rgba(0, 0, 0, 0.12);
	}
	.btn-secondary:hover:not(:disabled) {
		background: #fcfcfb;
		border-color: rgba(0, 0, 0, 0.2);
	}
	.btn-secondary--sm {
		padding: 0.45rem 0.85rem;
		font-size: 0.78rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   CARD ICON
	   ═══════════════════════════════════════════════════════════════ */
	.card-icon {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.card-icon svg {
		width: 24px;
		height: 24px;
	}
</style>
