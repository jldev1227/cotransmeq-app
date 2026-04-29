<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import SortIcon from '$lib/components/ui/SortIcon.svelte';

	interface Evaluacion {
		id: string;
		titulo: string;
		descripcion: string | null;
		requiere_firma: boolean;
		created_at: string;
		updated_at: string;
		preguntas: Pregunta[];
	}

	interface Pregunta {
		id: string;
		texto: string;
		tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO';
		puntaje: number;
		opciones: Opcion[];
	}

	interface Opcion {
		id: string;
		texto: string;
		esCorrecta: boolean;
	}

	let evaluaciones: Evaluacion[] = [];
	let isLoading = false;
	let error: string | null = null;
	let searchQuery = '';
	let sortField: 'titulo' | 'preguntas' | 'puntaje' | 'created_at' = 'created_at';
	let sortDir: 'asc' | 'desc' = 'desc';

	$: filtered = evaluaciones
		.filter((e) =>
			searchQuery.trim() === '' ||
			e.titulo.toLowerCase().includes(searchQuery.toLowerCase()) ||
			(e.descripcion ?? '').toLowerCase().includes(searchQuery.toLowerCase())
		)
		.sort((a, b) => {
			let va: any, vb: any;
			if (sortField === 'titulo')         { va = a.titulo;                 vb = b.titulo; }
			else if (sortField === 'preguntas') { va = a.preguntas.length;       vb = b.preguntas.length; }
			else if (sortField === 'puntaje')   { va = calcularPuntajeTotal(a);  vb = calcularPuntajeTotal(b); }
			else                               { va = a.created_at;             vb = b.created_at; }
			if (va < vb) return sortDir === 'asc' ? -1 : 1;
			if (va > vb) return sortDir === 'asc' ?  1 : -1;
			return 0;
		});

	onMount(() => { loadEvaluaciones(); });

	async function loadEvaluaciones() {
		isLoading = true; error = null;
		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/evaluaciones`);
			const data = await response.json();
			if (data.success) { evaluaciones = data.data; }
			else { error = 'Error al cargar evaluaciones'; }
		} catch (err: any) {
			error = err.message || 'Error al cargar evaluaciones';
		} finally { isLoading = false; }
	}

	function getTipoColor(tipo: string) {
		const c: Record<string, string> = {
			OPCION_UNICA: 'chip-blue', OPCION_MULTIPLE: 'chip-purple',
			NUMERICA: 'chip-green',   TEXTO: 'chip-orange',
			RELACION: 'chip-pink',    VERDADERO_FALSO: 'chip-teal'
		};
		return c[tipo] || 'chip-gray';
	}

	function getTipoLabel(tipo: string) {
		const l: Record<string, string> = {
			OPCION_UNICA: 'Única',   OPCION_MULTIPLE: 'Múltiple',
			NUMERICA: 'Numérica',    TEXTO: 'Texto',
			RELACION: 'Relación',    VERDADERO_FALSO: 'V/F'
		};
		return l[tipo] || tipo;
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function calcularPuntajeTotal(e: Evaluacion) {
		return e.preguntas.reduce((s, p) => s + p.puntaje, 0);
	}

	function toggleSort(field: typeof sortField) {
		if (sortField === field) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
		else { sortField = field; sortDir = 'asc'; }
	}

	function navigateToCrear()            { goto('/dashboard/evaluaciones/crear'); }
	function navigateToDetalle(id: string) { goto(`/dashboard/evaluaciones/${id}`); }

	async function deleteEvaluacion(id: string, titulo: string) {
		if (!confirm(`¿Estás seguro de eliminar "${titulo}"?`)) return;
		try {
			const r = await fetch(`${import.meta.env.VITE_API_URL}/api/evaluaciones/${id}`, { method: 'DELETE' });
			if (r.ok) { evaluaciones = evaluaciones.filter((e) => e.id !== id); }
			else { alert('Error al eliminar'); }
		} catch { alert('Error al eliminar'); }
	}
</script>

<svelte:head><title>Evaluaciones - Transmeralda</title></svelte:head>

<div class="page-wrapper" in:fade={{ duration: 500 }}>

	<!-- Header -->
	<div class="page-header" in:fly={{ y: -16, duration: 500 }}>
		<div class="header-left">
			<div class="header-icon">
				<svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
			</div>
			<div>
				<h1 class="page-title">Evaluaciones</h1>
				<p class="page-subtitle">Gestión de evaluaciones y formularios</p>
			</div>
		</div>
		<div class="header-right">
			<div class="stat-pill">
				<span class="stat-num">{evaluaciones.length}</span>
				<span class="stat-label">Total</span>
			</div>
			<button class="btn-primary" on:click={navigateToCrear}>
				<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
				</svg>
				Nueva Evaluación
			</button>
		</div>
	</div>

	<!-- Toolbar -->
	<div class="toolbar" in:fly={{ y: -8, duration: 500, delay: 100 }}>
		<div class="search-wrap">
			<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input class="search-input" type="text" placeholder="Buscar evaluación…" bind:value={searchQuery} />
			{#if searchQuery}
				<button class="search-clear" on:click={() => (searchQuery = '')}>✕</button>
			{/if}
		</div>
		<span class="result-count">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
	</div>

	<!-- States -->
	{#if isLoading}
		<div class="state-center" in:fade>
			<div class="spinner"></div>
			<p class="state-text">Cargando evaluaciones…</p>
		</div>

	{:else if error}
		<div class="state-center error-state" in:fade>
			<svg class="state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
					d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<p class="state-text">{error}</p>
			<button class="btn-primary" on:click={loadEvaluaciones}>Reintentar</button>
		</div>

	{:else if evaluaciones.length === 0}
		<div class="state-center" in:fade>
			<svg class="state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
					d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
			</svg>
			<p class="state-heading">Sin evaluaciones</p>
			<p class="state-text">Crea tu primera evaluación para comenzar</p>
			<button class="btn-primary" on:click={navigateToCrear}>
				<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
				</svg>
				Crear Evaluación
			</button>
		</div>

	{:else}
		<!-- ── DESKTOP TABLE ──────────────────────────────────── -->
		<div class="table-card desktop-only" in:fly={{ y: 16, duration: 500, delay: 200 }}>
			<table class="ev-table">
				<thead>
					<tr>
						<th class="th-main">
							<button class="th-btn" on:click={() => toggleSort('titulo')}>
								Evaluación <SortIcon field="titulo" {sortField} {sortDir} />
							</button>
						</th>
						<th>
							<button class="th-btn" on:click={() => toggleSort('preguntas')}>
								Preguntas <SortIcon field="preguntas" {sortField} {sortDir} />
							</button>
						</th>
						<th>
							<button class="th-btn" on:click={() => toggleSort('puntaje')}>
								Puntaje <SortIcon field="puntaje" {sortField} {sortDir} />
							</button>
						</th>
						<th>Tipos</th>
						<th>
							<button class="th-btn" on:click={() => toggleSort('created_at')}>
								Creada <SortIcon field="created_at" {sortField} {sortDir} />
							</button>
						</th>
						<th class="th-actions">Acciones</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as ev, i (ev.id)}
						<tr class="ev-row" in:fly={{ x: -12, duration: 250, delay: i * 40 }}
							on:click={() => navigateToDetalle(ev.id)}>
							<td class="td-main">
								<div class="td-title-wrap">
									<span class="td-title">{ev.titulo}</span>
									{#if ev.requiere_firma}
										<span class="badge-firma">
											<svg class="icon-xs" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
													d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
											</svg>
											Firma
										</span>
									{/if}
								</div>
								{#if ev.descripcion}
									<p class="td-desc">{ev.descripcion}</p>
								{/if}
							</td>
							<td class="td-center"><span class="num-badge green">{ev.preguntas.length}</span></td>
							<td class="td-center"><span class="num-badge blue">{calcularPuntajeTotal(ev)}</span></td>
							<td>
								<div class="chips-wrap">
									{#each [...new Set(ev.preguntas.map((p) => p.tipo))] as tipo}
										<span class="chip {getTipoColor(tipo)}">{getTipoLabel(tipo)}</span>
									{/each}
								</div>
							</td>
							<td class="td-date">{formatDate(ev.created_at)}</td>
							<td class="td-actions" on:click|stopPropagation>
								<button class="btn-icon btn-view" title="Ver" on:click={() => navigateToDetalle(ev.id)}>
									<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
									</svg>
								</button>
								<button class="btn-icon btn-delete" title="Eliminar"
									on:click={() => deleteEvaluacion(ev.id, ev.titulo)}>
									<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if filtered.length === 0 && searchQuery}
				<div class="no-results">Sin resultados para <strong>"{searchQuery}"</strong></div>
			{/if}
		</div>

		<!-- ── MOBILE CARDS ───────────────────────────────────── -->
		<div class="mobile-only" in:fly={{ y: 16, duration: 500, delay: 200 }}>
			{#if filtered.length === 0 && searchQuery}
				<div class="no-results-mobile">Sin resultados para <strong>"{searchQuery}"</strong></div>
			{:else}
				<div class="cards-grid">
					{#each filtered as ev, i (ev.id)}
						<div class="m-card" in:fly={{ y: 12, duration: 250, delay: i * 50 }}>
							<!-- Card header -->
							<div class="m-card-header" on:click={() => navigateToDetalle(ev.id)}>
								<div class="m-card-title-row">
									<span class="m-card-title">{ev.titulo}</span>
									{#if ev.requiere_firma}
										<span class="badge-firma">
											<svg class="icon-xs" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
													d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
											</svg>
											Firma
										</span>
									{/if}
								</div>
								{#if ev.descripcion}
									<p class="m-card-desc">{ev.descripcion}</p>
								{/if}
							</div>

							<!-- Stats row -->
							<div class="m-card-stats">
								<div class="m-stat">
									<span class="num-badge green">{ev.preguntas.length}</span>
									<span class="m-stat-label">Preguntas</span>
								</div>
								<div class="m-stat">
									<span class="num-badge blue">{calcularPuntajeTotal(ev)}</span>
									<span class="m-stat-label">Puntos</span>
								</div>
								<div class="m-stat-date">
									<svg class="icon-xs2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
									</svg>
									{formatDate(ev.created_at)}
								</div>
							</div>

							<!-- Chips -->
							<div class="chips-wrap m-chips">
								{#each [...new Set(ev.preguntas.map((p) => p.tipo))] as tipo}
									<span class="chip {getTipoColor(tipo)}">{getTipoLabel(tipo)}</span>
								{/each}
							</div>

							<!-- Actions -->
							<div class="m-card-actions">
								<button class="btn-full-view" on:click={() => navigateToDetalle(ev.id)}>
									<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
									</svg>
									Ver Detalle
								</button>
								<button class="btn-icon btn-delete"
									on:click={() => deleteEvaluacion(ev.id, ev.titulo)}>
									<svg class="icon-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ── Base ─────────────────────────────────────────────────── */
	.page-wrapper { display: flex; flex-direction: column; gap: 1.25rem; padding: 1.5rem; }

	/* ── Responsive visibility ────────────────────────────────── */
	.desktop-only { display: block; }
	.mobile-only  { display: none; }
	@media (max-width: 767px) {
		.desktop-only { display: none; }
		.mobile-only  { display: block; }
		.page-wrapper { padding: 1rem; gap: 1rem; }
	}

	/* ── Header ───────────────────────────────────────────────── */
	.page-header {
		display: flex; align-items: center; justify-content: space-between;
		flex-wrap: wrap; gap: 1rem;
		background: linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);
		border: 1px solid #fed7aa; border-radius: 1.25rem; padding: 1.5rem 2rem;
	}
	@media (max-width: 767px) { .page-header { padding: 1rem 1.25rem; } }
	.header-left  { display: flex; align-items: center; gap: 1rem; }
	.header-right { display: flex; align-items: center; gap: 0.75rem; }
	.header-icon {
		display: flex; align-items: center; justify-content: center;
		width: 3.25rem; height: 3.25rem; flex-shrink: 0;
		background: linear-gradient(135deg, #f97316, #d97706);
		border-radius: 1rem; box-shadow: 0 4px 14px #f9731640;
	}
	@media (max-width: 767px) {
		.header-icon { width: 2.5rem; height: 2.5rem; border-radius: 0.75rem; }
	}
	.page-title    { font-size: 1.75rem; font-weight: 800; color: #111827; line-height: 1.1; }
	.page-subtitle { font-size: 0.875rem; color: #6b7280; margin-top: 0.125rem; }
	@media (max-width: 767px) {
		.page-title    { font-size: 1.35rem; }
		.page-subtitle { font-size: 0.78rem; }
	}
	.stat-pill {
		display: flex; flex-direction: column; align-items: center;
		background: white; border: 1px solid #fed7aa;
		border-radius: 0.75rem; padding: 0.5rem 1rem;
	}
	.stat-num   { font-size: 1.5rem; font-weight: 800; color: #ea580c; line-height: 1; }
	.stat-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }

	/* ── Buttons ──────────────────────────────────────────────── */
	.btn-primary {
		display: inline-flex; align-items: center; gap: 0.5rem;
		background: linear-gradient(135deg, #f97316, #d97706);
		color: white; font-weight: 700; font-size: 0.9rem;
		padding: 0.65rem 1.4rem; border-radius: 0.75rem;
		border: none; cursor: pointer; box-shadow: 0 4px 14px #f9731635;
		transition: transform .15s, box-shadow .15s;
	}
	.btn-primary:hover  { transform: translateY(-1px); box-shadow: 0 6px 20px #f9731645; }
	.btn-primary:active { transform: translateY(0); }
	@media (max-width: 767px) {
		.btn-primary { padding: 0.55rem 1rem; font-size: 0.82rem; }
	}
	.btn-icon {
		display: inline-flex; align-items: center; justify-content: center;
		width: 2rem; height: 2rem; border-radius: 0.5rem;
		border: none; cursor: pointer; transition: background .15s, transform .1s;
	}
	.btn-icon:hover { transform: scale(1.1); }
	.btn-view          { background: #fff7ed; color: #ea580c; }
	.btn-view:hover    { background: #fed7aa; }
	.btn-delete        { background: #fef2f2; color: #dc2626; }
	.btn-delete:hover  { background: #fee2e2; }
	.btn-full-view {
		flex: 1; display: inline-flex; align-items: center; justify-content: center;
		gap: 0.4rem; background: #fff7ed; color: #ea580c;
		font-weight: 700; font-size: 0.85rem;
		padding: 0.55rem 1rem; border-radius: 0.6rem;
		border: none; cursor: pointer; transition: background .15s;
	}
	.btn-full-view:hover { background: #fed7aa; }

	/* ── Toolbar ──────────────────────────────────────────────── */
	.toolbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
	.search-wrap {
		position: relative; display: flex; align-items: center;
		background: white; border: 1.5px solid #d1d5db;
		border-radius: 0.75rem; flex: 1; min-width: 200px; max-width: 400px;
		transition: border-color .2s;
	}
	.search-wrap:focus-within { border-color: #f97316; box-shadow: 0 0 0 3px #f9731620; }
	.search-icon { width: 1rem; height: 1rem; color: #9ca3af; position: absolute; left: 0.75rem; pointer-events: none; }
	.search-input {
		width: 100%; padding: 0.55rem 2.25rem;
		font-size: 0.875rem; background: transparent;
		border: none; outline: none; color: #111827;
	}
	.search-clear {
		position: absolute; right: 0.6rem;
		background: none; border: none; cursor: pointer;
		color: #9ca3af; font-size: 0.75rem; padding: 0.2rem;
	}
	.search-clear:hover { color: #6b7280; }
	.result-count { font-size: 0.8rem; color: #9ca3af; white-space: nowrap; }

	/* ── Desktop table ────────────────────────────────────────── */
	.table-card {
		background: white; border: 1px solid #e5e7eb;
		border-radius: 1.25rem; overflow: hidden;
		box-shadow: 0 1px 8px #0000000a;
	}
	.ev-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
	.ev-table thead tr { background: #f9fafb; border-bottom: 1.5px solid #e5e7eb; }
	.ev-table th {
		padding: 0.9rem 1rem; text-align: left;
		font-size: 0.75rem; font-weight: 700; color: #6b7280;
		text-transform: uppercase; letter-spacing: .06em; white-space: nowrap;
	}
	.th-main    { padding-left: 1.5rem; width: 35%; }
	.th-actions { text-align: right; padding-right: 1.5rem; }
	.th-btn {
		display: inline-flex; align-items: center; gap: 0.35rem;
		background: none; border: none; cursor: pointer;
		color: #6b7280; font-size: inherit; font-weight: 700;
		text-transform: uppercase; letter-spacing: .06em; padding: 0;
	}
	.th-btn:hover { color: #ea580c; }
	.ev-row { border-bottom: 1px solid #f3f4f6; cursor: pointer; transition: background .12s; }
	.ev-row:last-child { border-bottom: none; }
	.ev-row:hover      { background: #fff7ed; }
	.ev-table td { padding: 0.85rem 1rem; vertical-align: middle; }
	.td-main    { padding-left: 1.5rem; }
	.td-center  { text-align: center; }
	.td-date    { color: #9ca3af; white-space: nowrap; font-size: 0.8rem; }
	.td-actions { text-align: right; padding-right: 1.25rem; }
	.td-title-wrap { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.td-title      { font-weight: 700; color: #111827; }
	.td-desc {
		font-size: 0.78rem; color: #6b7280; margin-top: 0.2rem;
		max-width: 28ch; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
	}
	.no-results { text-align: center; padding: 2.5rem; color: #9ca3af; font-size: 0.875rem; }
	.no-results strong { color: #6b7280; }

	/* ── Mobile cards ─────────────────────────────────────────── */
	.cards-grid { display: flex; flex-direction: column; gap: 0.875rem; }
	.no-results-mobile {
		text-align: center; padding: 2rem; color: #9ca3af;
		font-size: 0.875rem; background: white;
		border: 1px solid #e5e7eb; border-radius: 1rem;
	}
	.m-card {
		background: white; border: 1px solid #e5e7eb;
		border-radius: 1rem; overflow: hidden;
		box-shadow: 0 1px 6px #0000000d;
	}
	.m-card-header {
		padding: 1rem 1rem 0.75rem;
		cursor: pointer; transition: background .12s;
	}
	.m-card-header:active { background: #fff7ed; }
	.m-card-title-row { display: flex; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap; }
	.m-card-title  { font-weight: 700; color: #111827; font-size: 0.95rem; flex: 1; }
	.m-card-desc   { font-size: 0.78rem; color: #6b7280; margin-top: 0.3rem; line-height: 1.4; }
	.m-card-stats  {
		display: flex; align-items: center; gap: 1rem;
		padding: 0.6rem 1rem; background: #f9fafb;
		border-top: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6;
	}
	.m-stat        { display: flex; align-items: center; gap: 0.4rem; }
	.m-stat-label  { font-size: 0.72rem; color: #9ca3af; }
	.m-stat-date   {
		display: flex; align-items: center; gap: 0.3rem;
		margin-left: auto; font-size: 0.72rem; color: #9ca3af;
	}
	.m-chips { padding: 0.6rem 1rem; }
	.m-card-actions {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid #f3f4f6;
	}

	/* ── Shared badges & chips ────────────────────────────────── */
	.badge-firma {
		display: inline-flex; align-items: center; gap: 0.2rem;
		background: #f3e8ff; color: #7c3aed;
		font-size: 0.68rem; font-weight: 700;
		padding: 0.15rem 0.5rem; border-radius: 999px;
	}
	.num-badge {
		display: inline-block; font-size: 0.9rem; font-weight: 800;
		padding: 0.2rem 0.65rem; border-radius: 0.5rem;
	}
	.num-badge.green { background: #fff7ed; color: #ea580c; }
	.num-badge.blue  { background: #eff6ff; color: #2563eb; }
	.chips-wrap { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.chip {
		font-size: 0.68rem; font-weight: 600;
		padding: 0.2rem 0.55rem; border-radius: 999px;
	}
	.chip-blue   { background: #dbeafe; color: #1d4ed8; }
	.chip-purple { background: #ede9fe; color: #6d28d9; }
	.chip-green  { background: #dcfce7; color: #15803d; }
	.chip-orange { background: #ffedd5; color: #c2410c; }
	.chip-pink   { background: #fce7f3; color: #be185d; }
	.chip-teal   { background: #ccfbf1; color: #0f766e; }
	.chip-gray   { background: #f3f4f6; color: #4b5563; }

	/* ── State screens ────────────────────────────────────────── */
	.state-center {
		display: flex; flex-direction: column; align-items: center;
		justify-content: center; gap: 1rem; padding: 4rem 2rem; text-align: center;
		background: white; border: 1px solid #e5e7eb; border-radius: 1.25rem;
	}
	.error-state { border-color: #fecaca; background: #fff5f5; }
	.state-icon  { width: 3.5rem; height: 3.5rem; color: #d1d5db; }
	.error-state .state-icon { color: #f87171; }
	.state-heading { font-size: 1.1rem; font-weight: 700; color: #111827; margin: 0; }
	.state-text    { font-size: 0.875rem; color: #6b7280; margin: 0; }

	/* ── Icons ────────────────────────────────────────────────── */
	.icon-lg  { width: 1.75rem; height: 1.75rem; color: white; }
	.icon-sm  { width: 1rem;    height: 1rem; }
	.icon-xs  { width: 0.65rem; height: 0.65rem; }
	.icon-xs2 { width: 0.75rem; height: 0.75rem; }

	/* ── Spinner ──────────────────────────────────────────────── */
	.spinner {
		width: 2.5rem; height: 2.5rem;
		border: 3px solid #fed7aa; border-top-color: #ea580c;
		border-radius: 50%; animation: spin .7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
</style>