<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { getEvaluaciones, deleteEvaluacion, type Evaluacion, type Pregunta } from '$lib/api/evaluaciones';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import { page } from '$app/state';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';

	/**
	 * Filtros en la URL: búsqueda, orden y página.
	 *
	 * Todo se resuelve en servidor —el endpoint acepta `search`, `sortBy`,
	 * `sortOrder`, `page`—, así que la búsqueda va con retardo para no lanzar
	 * una petición por tecla.
	 */
	interface FiltrosEvaluaciones {
		q: string;
		orden: string;
		dir: string;
		pagina: number;
	}

	const POR_PAGINA = 10;

	const DEFS: DefinicionesFiltros<FiltrosEvaluaciones> = {
		q: texto(),
		orden: opcion('created_at'),
		dir: opcion('desc'),
		pagina: numero(1)
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<FiltrosEvaluaciones>(estadoUrl.leer(page.url));

	/**
	 * Columnas de la tabla.
	 *
	 * Solo `titulo` y `created_at` son ordenables: son los dos únicos campos
	 * que acepta el backend en `sortBy` (ver su lista blanca). Las demás
	 * —número de preguntas, puntos, tipos— se calculan a partir de las
	 * preguntas y no existen como columna que Prisma pueda ordenar, así que
	 * van `enableSorting: false` y su cabecera NO se pinta como pulsable.
	 */
	const COLUMNAS: ColumnDef<Evaluacion, any>[] = [
		// El título necesita suelo propio: sin `size` el resto de columnas se
		// lo comían y quedaba en cuatro renglones por fila.
		{ id: 'titulo', accessorKey: 'titulo', header: 'Evaluación', size: 340 },
		{ id: 'tipos', header: 'Tipos de pregunta', enableSorting: false, size: 170 },
		{ id: 'preguntas', header: 'Preguntas', enableSorting: false, size: 90 },
		{ id: 'puntos', header: 'Puntos', enableSorting: false, size: 80 },
		{ id: 'firma', header: 'Firma', enableSorting: false, size: 80 },
		{ id: 'created_at', accessorKey: 'created_at', header: 'Creada', size: 120 },
		{ id: 'acciones', header: 'Acciones', enableSorting: false, size: 90 }
	];

	/// `orden`/`dir` ya viajaban en la URL y ya se mandaban al backend; lo que
	/// no había era forma de cambiarlos desde la interfaz. La cabecera de la
	/// tabla es ahora ese control.
	const ordenTabla = $derived<SortingState>(
		filtros.orden ? [{ id: filtros.orden, desc: filtros.dir === 'desc' }] : []
	);

	function aplicarOrden(nuevo: SortingState) {
		const primero = nuevo[0];
		filtros = {
			...filtros,
			// Sin orden se vuelve al natural: lo más reciente arriba.
			orden: primero?.id ?? 'created_at',
			dir: primero ? (primero.desc ? 'desc' : 'asc') : 'desc',
			pagina: 1
		};
	}




	let evaluaciones = $state<Evaluacion[]>([]);
	let isLoading = $state(false);
	let totalRows = $state(0);

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	function ponerFiltro<K extends keyof FiltrosEvaluaciones>(
		clave: K,
		valor: FiltrosEvaluaciones[K]
	) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	async function loadEvaluaciones() {
		isLoading = true;
		try {
			const response = await getEvaluaciones({
				page: filtros.pagina,
				limit: POR_PAGINA,
				search: filtros.q || undefined,
				sortBy: filtros.orden as 'titulo' | 'created_at',
				sortOrder: filtros.dir as 'asc' | 'desc'
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
		/// Depende de los filtros completos: cualquiera de ellos cambia lo que
		/// el servidor devuelve.
		void filtros;
		loadEvaluaciones();
	});

	function handleSort(field: string, order: 'asc' | 'desc') {
		filtros = { ...filtros, orden: field, dir: order, pagina: 1 };
	}

	function handlePageChange(pagina: number) {
		filtros = { ...filtros, pagina };
	}

	function clearSearch() {
		ponerFiltro('q', '');
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
		<!-- ═══ HERO EDITORIAL ═══
		     Antes era una cabecera propia de esta pantalla —`.header` con su
		     `.logo-mark`— que no se parecía a ninguna otra del dashboard. Mismo
		     patrón que SARLAFT y salidas-NC: identidad a la izquierda, cifras a
		     la derecha, en paralelo y con rejilla fluida. -->
		<header class="page-hero">
			<div class="hero-left">
				<div class="hero-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
				<div class="hero-text">
					<span class="eyebrow">Formación · Evaluaciones</span>
					<h1>Evaluaciones de conocimiento</h1>
					<p>
						Diseño, publicación y seguimiento de las evaluaciones aplicadas al personal,
						con el detalle de lo que respondió cada evaluado.
					</p>
				</div>
			</div>

			<div class="hero-derecha">
				<div class="hero-stats">
					<div class="stat-item">
						<span class="stat-label">Evaluaciones</span>
						<span class="stat-value">{totalRows}</span>
					</div>
				</div>
				<button class="btn-primary" onclick={navigateToCrear} aria-label="Crear nueva evaluación">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
					Nueva evaluación
				</button>
			</div>
		</header>

		<!-- Buscador y recuento en una MISMA tarjeta.
		     Antes el buscador flotaba directamente sobre el fondo de la página y
		     el «N resultados» era un texto suelto debajo: dos elementos sin
		     contenedor entre dos tarjetas, que es lo que hacía que la pantalla
		     no se leyera como el resto del dashboard. -->
		<div class="filtros-bar" role="search">
			<div class="search-wrap">
				<BuscadorLista
					valor={filtros.q}
					onBuscar={(termino) => ponerFiltro('q', termino)}
					placeholder="Buscar por título o descripción…"
					etiqueta="Buscar evaluaciones"
				/>
			</div>

			<div class="filtros-meta" aria-live="polite" aria-atomic="true">
				{#if isLoading}
					<span class="filtros-conteo">Cargando…</span>
				{:else}
					<span class="filtros-conteo">
						{totalRows} evaluaci{totalRows === 1 ? 'ón' : 'ones'}
					</span>
				{/if}
				{#if filtros.q}
					<button class="clear-btn" onclick={clearSearch}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
						Limpiar
					</button>
				{/if}
			</div>
		</div>

		<!-- Una sola vista. Antes había dos: `.desktop-only` con un `DataTable`
		     y `.mobile-only` con tarjetas, cada una con sus propias columnas y
		     su propio render. Mantener dos listados del mismo dato es cómo se
		     acaba con una tabla que sabe ordenar y unas tarjetas que no.
		     `TablaLista` desplaza en horizontal cuando no cabe, que es lo que
		     resolvía el corte por ancho. -->
		<div class="listado">
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
					<p>{filtros.q ? 'Sin resultados para la búsqueda' : 'No hay evaluaciones creadas'}</p>
					{#if !filtros.q}
						<button class="btn-primary" onclick={navigateToCrear}>
							Crear primera evaluación
						</button>
					{/if}
				</div>
			{:else}
				<div class="tabla-envoltorio">
					<TablaLista
						columnas={COLUMNAS}
						datos={evaluaciones}
						claveFila={(f) => f.id}
						orden={ordenTabla}
						onOrdenar={aplicarOrden}
						onFila={(f) => navigateToDetalle(f.id)}
						etiqueta="Evaluaciones registradas"
					>
						{#snippet celda({ columnaId, fila, valor })}
							{#if columnaId === 'titulo'}
								<div class="c-titulo">
									<span class="c-titulo-txt">{fila.titulo}</span>
									{#if fila.descripcion}
										<span class="c-desc">{fila.descripcion}</span>
									{/if}
								</div>
							{:else if columnaId === 'tipos'}
								<div class="chips-wrap">
									{#each [...new Set(fila.preguntas.map((p) => p.tipo))] as tipo}
										<span class="chip {getTipoColor(tipo)}">{getTipoLabel(tipo)}</span>
									{/each}
								</div>
							{:else if columnaId === 'preguntas'}
								<span class="num-badge">{fila.preguntas.length}</span>
							{:else if columnaId === 'puntos'}
								<span class="num-badge blue">{calcularPuntajeTotal(fila)}</span>
							{:else if columnaId === 'firma'}
								{#if fila.requiere_firma}
									<span class="badge-firma">Firma</span>
								{:else}
									<span class="c-nulo">—</span>
								{/if}
							{:else if columnaId === 'created_at'}
								<span class="mono">{formatDate(fila.created_at)}</span>
							{:else if columnaId === 'acciones'}
								<!-- `stopPropagation` obligatorio: la fila entera navega al
								     detalle, y sin esto pulsar «Eliminar» abriría además la
								     evaluación que se está intentando borrar. -->
								<div class="acciones">
									<button
										class="accion accion--ver"
										title="Ver"
										aria-label="Ver la evaluación {fila.titulo}"
										onclick={(e) => { e.stopPropagation(); navigateToDetalle(fila.id); }}
									>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
											<circle cx="12" cy="12" r="3" />
										</svg>
									</button>
									<button
										class="accion accion--eliminar"
										title="Eliminar"
										aria-label="Eliminar la evaluación {fila.titulo}"
										onclick={(e) => { e.stopPropagation(); handleDelete(fila.id, fila.titulo || ''); }}
									>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="3 6 5 6 21 6" />
											<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
										</svg>
									</button>
								</div>
							{:else}
								{valor ?? ''}
							{/if}
						{/snippet}
					</TablaLista>
				</div>
			{/if}
	</div>
</div>

<style>
	/* ═══════════════════════════════════════════════════════════════
	   CÁSCARA DE PÁGINA
	   ═══════════════════════════════════════════════════════════════
	   Mismas medidas que SARLAFT y salidas-NC: fondo crema, 1.5rem de aire
	   arriba y a los lados, 1.25rem entre tarjetas. Antes eran 2rem/2.5rem y
	   sin fondo propio, así que esta pantalla respiraba distinto que sus
	   vecinas aunque el contenido fuera el mismo.

	   Había además un `.dash` anidado dentro de `.dash-wrapper` que no hacía
	   nada: se quitó, y el `gap` vive donde están las tarjetas.

	   Sin `max-width`: el ancho ya lo acota el `main` del layout. */
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
		--accent-bg: #ffedd5;

		min-height: 100vh;
		background: #faf7f2;
		font-family: 'Inter Tight', system-ui, sans-serif;
		color: var(--text-primary);
		padding: 1.5rem 1.25rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   HERO
	   ═══════════════════════════════════════════════════════════════
	   Sustituye a la cabecera propia de esta pantalla (`.header` con su
	   `.logo-mark`), que no se parecía a ninguna otra del dashboard. Mismas
	   medidas y misma rejilla fluida que SARLAFT y salidas-NC: el ancho que
	   manda es el del `main`, que cambia al colapsar la barra lateral, así
	   que `auto-fit` y no puntos de ruptura. */
	.page-hero {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 24px;
		padding: 1.35rem 1.5rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);

		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
		align-items: center;
		gap: 1.1rem 2rem;
	}
	.hero-left {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}
	.hero-icon {
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border-radius: 14px;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
	}
	.hero-icon svg {
		width: 24px;
		height: 24px;
	}
	.hero-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}
	/* `.eyebrow` es `inline-block`, pero como hijo de un flex en columna lo
	   estira el `align-items: stretch` por defecto. */
	.hero-text .eyebrow {
		align-self: flex-start;
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent);
		background: var(--accent-bg);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
	}
	.hero-text h1 {
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.6rem, 3.5vw, 2.1rem);
		font-weight: 500;
		line-height: 1.15;
		letter-spacing: -0.01em;
		color: var(--text-primary);
		margin: 0;
	}
	.hero-text p {
		font-size: 0.92rem;
		line-height: 1.6;
		color: var(--text-secondary);
		margin: 0;
		/* Tope de legibilidad; con dos columnas manda la columna. */
		max-width: 44rem;
	}
	.hero-derecha {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.hero-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-family: 'JetBrains Mono', monospace;
	}
	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.6rem;
		background: var(--surface-hover);
		border: 1px solid var(--border);
		border-radius: 9px;
	}
	.stat-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.stat-value {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text-primary);
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

	.filtros-bar {
		background: var(--surface);
		border: 1px solid var(--border);
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
	.filtros-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		margin-left: auto;
	}
	.filtros-conteo {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-muted);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		transition: color 0.2s, border-color 0.2s, background-color 0.2s;
	}
	.clear-btn svg {
		width: 0.85rem;
		height: 0.85rem;
	}
	.clear-btn:hover {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.04);
	}

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
	.acciones {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.15rem;
	}
	.accion {
		display: inline-flex;
		padding: 0.35rem;
		border: none;
		background: transparent;
		border-radius: 8px;
		color: var(--text-muted);
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s;
	}
	.accion svg {
		width: 1rem;
		height: 1rem;
	}
	.accion--ver:hover {
		background: var(--accent-bg);
		color: var(--accent-hover);
	}
	.accion--eliminar:hover {
		background: #fef2f2;
		color: #dc2626;
	}

	/* Mobile cards */

	/* Mobile cards */
	/* ═══════════════════════════════════════════════════════════════
	   PASTILLAS
	   ═══════════════════════════════════════════════════════════════
	   Estaban declaradas con `:global(...)` porque el `DataTable` pintaba las
	   celdas como cadenas de HTML y el CSS con ámbito no las alcanzaba. Ahora
	   que las celdas son markup de Svelte de verdad, el ámbito normal basta
	   —y así dejan de filtrarse al resto de la aplicación—. */
	.chips-wrap {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.chip-blue { background: #dbeafe; color: #1d4ed8; }
	.chip-purple { background: #ede9fe; color: #6d28d9; }
	.chip-green { background: #dcfce7; color: #15803d; }
	.chip-orange { background: #ffedd5; color: #c2410c; }
	.chip-pink { background: #fce7f3; color: #be185d; }
	.chip-teal { background: #ccfbf1; color: #0f766e; }
	.chip-gray { background: #f3f4f6; color: #4b5563; }

	.num-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 26px;
		padding: 2px 7px;
		border-radius: 6px;
		background: var(--accent-bg);
		color: var(--accent-hover);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.num-badge.blue {
		background: #dbeafe;
		color: #1d4ed8;
	}
	.badge-firma {
		display: inline-flex;
		padding: 2px 7px;
		border-radius: 6px;
		background: #ede9fe;
		color: #6d28d9;
		font-size: 0.68rem;
		font-weight: 600;
	}

	/* ═══════════════════════════════════════════════════════════════
	   CELDAS DE LA TABLA
	   ═══════════════════════════════════════════════════════════════
	   Aquí estaba `.cards-grid` con `.m-card*`: una tarjeta por evaluación,
	   con su título, su descripción y tres cifras. Cuatro datos por tarjeta y
	   dos evaluaciones por pantalla. La tabla los pone en una fila. */
	.tabla-envoltorio {
		--tl-fondo: var(--surface);
		--tl-borde: var(--border);
		--tl-th-fondo: var(--surface-hover);
		--tl-th-color: var(--text-muted);
		--tl-th-color-hover: var(--text-primary);
		--tl-td-color: var(--text-primary);
		--tl-td-suave: var(--text-muted);
		--tl-mono: 'JetBrains Mono', monospace;
		--tl-acento: var(--accent);
		--tl-fila-hover: var(--surface-hover);
	}
	.c-titulo {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.c-titulo-txt {
		font-weight: 600;
		color: var(--text-primary);
	}
	/* Dos líneas y corta: en el listado la descripción orienta, no se lee
	   entera; para eso está el detalle. */
	.c-desc {
		font-size: 0.75rem;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.c-nulo {
		color: var(--text-muted);
	}
	.mono {
		font-family: 'JetBrains Mono', monospace;
	}
</style>
