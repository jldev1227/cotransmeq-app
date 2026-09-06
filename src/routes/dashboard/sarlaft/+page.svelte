<script lang="ts">
	import { page } from '$app/state';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
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

	let items = $state<SarlaftFormularioResumen[]>([]);
	let pagination = $state({ page: 1, limit: 20, total: 0, pages: 1 });
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	/**
	 * Filtros en la URL.
	 *
	 * Búsqueda, tipo, estado y página se resuelven en servidor, así que todos
	 * entran en la firma y la búsqueda va con el retardo compartido —antes eran
	 * 350 ms propios, uno más de los siete valores que había en el proyecto—.
	 */
	interface FiltrosSarlaft {
		q: string;
		tipo: string;
		estado: string;
		pagina: number;
		/// El orden va en la URL como todo lo demás: se resuelve en servidor
		/// (la lista está paginada), así que forma parte de la consulta y un
		/// enlace compartido tiene que reproducir lo que el otro estaba viendo.
		orden: string;
		direccion: string;
	}

	const POR_PAGINA = 20;

	const DEFS: DefinicionesFiltros<FiltrosSarlaft> = {
		q: texto(),
		tipo: opcion('TODOS'),
		estado: opcion('TODOS'),
		pagina: numero(1),
		orden: opcion('fecha_envio'),
		direccion: opcion('desc')
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<FiltrosSarlaft>(estadoUrl.leer(page.url));

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	$effect(() => {
		void filtros;
		load();
	});

	function ponerFiltro<K extends keyof FiltrosSarlaft>(clave: K, valor: FiltrosSarlaft[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	const stats = $derived({
		total: pagination.total,
		pendientes: items.filter((i) => i.estado === 'recibido').length,
		enRevision: items.filter((i) => i.estado === 'en_revision').length,
		aprobados: items.filter((i) => i.estado === 'aprobado').length,
		// `condicionado` se cuenta aparte a propósito: sumarlo a los aprobados
		// inflaría la métrica de aprobación con casos que quedaron sujetos a
		// condiciones todavía no cumplidas.
		condicionados: items.filter((i) => i.estado === 'condicionado').length,
		rechazados: items.filter((i) => i.estado === 'rechazado').length,
		documentos: items.reduce((acc, i) => acc + i.documentos_count, 0)
		});

	/**
	 * Columnas de la tabla.
	 *
	 * `id` coincide con el nombre del campo que acepta el backend en `orden`
	 * (ver la lista blanca de `listarAdmin`): así la cabecera pulsada y el
	 * criterio de la consulta son literalmente lo mismo y no hace falta un
	 * mapa intermedio que se desincronice.
	 *
	 * `contacto` y `documento` no se pueden ordenar porque juntan dos campos;
	 * marcarlas `enableSorting: false` es lo que hace que su cabecera NO se
	 * pinte como pulsable, en vez de prometer algo que el servidor no hace.
	 */
	const COLUMNAS: ColumnDef<SarlaftFormularioResumen, any>[] = [
		{ id: 'radicado', accessorKey: 'radicado', header: 'Radicado', size: 190 },
		{ id: 'nombre_completo', accessorKey: 'nombre_completo', header: 'Nombre' },
		{ id: 'tipo_formulario', accessorKey: 'tipo_formulario', header: 'Tipo', size: 170 },
		{ id: 'documento', header: 'Documento', enableSorting: false, size: 150 },
		{ id: 'contacto', header: 'Contacto', enableSorting: false, size: 230 },
		{ id: 'documentos_count', accessorKey: 'documentos_count', header: 'Docs', enableSorting: false, size: 70 },
		{ id: 'estado', accessorKey: 'estado', header: 'Estado', size: 140 },
		{ id: 'fecha_envio', accessorKey: 'fecha_envio', header: 'Enviado', size: 160 }
	];

	/// Traducción en los dos sentidos entre el estado de TanStack y los dos
	/// campos planos que viajan en la URL y en la consulta.
	const ordenTabla = $derived<SortingState>(
		filtros.orden ? [{ id: filtros.orden, desc: filtros.direccion === 'desc' }] : []
	);

	function aplicarOrden(nuevo: SortingState) {
		const primero = nuevo[0];
		filtros = {
			...filtros,
			// Quitar el orden vuelve al natural de la pantalla: lo último
			// recibido arriba, que es como se lee un buzón de trámites.
			orden: primero?.id ?? 'fecha_envio',
			direccion: primero ? (primero.desc ? 'desc' : 'asc') : 'desc',
			pagina: 1
		};
	}

	const hasActiveFilter = $derived(
		filtros.q.trim() !== '' || filtros.tipo !== 'TODOS' || filtros.estado !== 'TODOS'
	);

	async function load() {
		isLoading = true;
		error = null;
		try {
			const params: any = {
				page: filtros.pagina,
				limit: POR_PAGINA,
				orden: filtros.orden,
				direccion: filtros.direccion
			};
			if (filtros.q.trim()) params.search = filtros.q.trim();
			if (filtros.tipo !== 'TODOS') params.tipo_formulario = filtros.tipo;
			if (filtros.estado !== 'TODOS') params.estado = filtros.estado;
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

	/// El retardo lo pone `BuscadorLista`; aquí solo se recibe el término ya
	/// reposado.
	function onSearchInput(termino: string) {
		ponerFiltro('q', termino);
	}

	/// La recarga la dispara el efecto que observa `filtros`.
	function setTipo(t: TipoFormularioSarlaft | 'TODOS') {
		ponerFiltro('tipo', t);
	}

	function setEstado(e: EstadoSarlaft | 'TODOS') {
		ponerFiltro('estado', e);
	}

	function limpiarFiltros() {
		filtros = limpiarFiltrosDe(DEFS, filtros);
	}

	function irAPagina(p: number) {
		filtros = { ...filtros, pagina: p };
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

		<!-- Los separadores «·» que había entre cifras se retiraron: ahora cada
		     dato es una pastilla y, al envolverse en la columna estrecha, los
		     puntos quedaban colgando al final de las líneas. -->
		<div class="hero-stats">
			<div class="stat-item">
				<span class="stat-label">Total</span>
				<span class="stat-value">{stats.total}</span>
			</div>
			<div class="stat-item">
				<span class="stat-dot stat-dot--blue" aria-hidden="true"></span>
				<span class="stat-label">Recibidos</span>
				<span class="stat-value">{stats.pendientes}</span>
			</div>
			<div class="stat-item">
				<span class="stat-dot stat-dot--amber" aria-hidden="true"></span>
				<span class="stat-label">En revisión</span>
				<span class="stat-value">{stats.enRevision}</span>
			</div>
			<div class="stat-item">
				<span class="stat-dot stat-dot--aprobado" aria-hidden="true"></span>
				<span class="stat-label">Aprobados</span>
				<span class="stat-value">{stats.aprobados}</span>
			</div>
			<div class="stat-item">
				<span class="stat-dot stat-dot--red" aria-hidden="true"></span>
				<span class="stat-label">Rechazados</span>
				<span class="stat-value">{stats.rechazados}</span>
			</div>
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
			<BuscadorLista
				valor={filtros.q}
				onBuscar={onSearchInput}
				placeholder="Buscar por radicado, nombre, cédula o correo…"
				etiqueta="Buscar formularios SARLAFT"
			/>
		</div>

		<div class="filter-group">
			<span class="filter-label">Tipo</span>
			{#each [{ k: 'TODOS', l: 'Todos' }, { k: 'cliente_proveedor', l: 'Cliente/Prov.' }, { k: 'accionistas', l: 'Accionistas' }, { k: 'personal', l: 'Personal' }, { k: 'autorizacion_propietario', l: 'Autoriz. propietario' }, { k: 'declaracion_empresa_transporte', l: 'Declaración empresa de transporte' }] as f}
				<button
					class="chip"
					class:chip--active={filtros.tipo === f.k}
					onclick={() => setTipo(f.k as TipoFormularioSarlaft | 'TODOS')}
				>
					{f.l}
				</button>
			{/each}
		</div>

		<div class="filter-group">
			<span class="filter-label">Estado</span>
			{#each [{ k: 'TODOS', l: 'Todos' }, { k: 'recibido', l: 'Recibido' }, { k: 'en_revision', l: 'En revisión' }, { k: 'aprobado', l: 'Aprobado' }, { k: 'condicionado', l: 'Condicionado' }, { k: 'rechazado', l: 'Rechazado' }, { k: 'escalado', l: 'Escalado' }] as f}
				<button
					class="chip"
					class:chip--active={filtros.estado === f.k}
					onclick={() => setEstado(f.k as EstadoSarlaft | 'TODOS')}
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
		<!-- El envoltorio existe para pasarle a la tabla compartida la piel de
		     esta pantalla por custom properties, sin tocar su CSS. -->
		<div class="tabla-envoltorio">
			<TablaLista
				columnas={COLUMNAS}
				datos={items}
				claveFila={(f) => f.id}
				orden={ordenTabla}
				onOrdenar={aplicarOrden}
				onFila={(f) => verDetalle(f.id)}
				etiqueta="Formularios SARLAFT recibidos"
			>
				{#snippet celda({ columnaId, fila, valor })}
					{#if columnaId === 'radicado'}
						<div class="c-radicado">
							<span class="radicado-pill">{fila.radicado}</span>
							<span class="codigo-pill">{fila.codigo_formulario} · v{fila.version}</span>
						</div>
					{:else if columnaId === 'nombre_completo'}
						<span class="c-nombre">{fila.nombre_completo ?? 'Sin nombre'}</span>
					{:else if columnaId === 'tipo_formulario'}
						<span class="c-tipo">{TIPO_FORMULARIO_LABELS[fila.tipo_formulario]}</span>
					{:else if columnaId === 'documento'}
						{#if fila.numero_documento}
							<span class="mono c-doc">{fila.tipo_documento ?? 'Doc'} {fila.numero_documento}</span>
						{:else}
							<span class="c-nulo">—</span>
						{/if}
					{:else if columnaId === 'contacto'}
						<div class="c-contacto">
							<span class="mono">{fila.correo ?? '—'}</span>
							{#if fila.telefono}<span class="mono c-nulo">{fila.telefono}</span>{/if}
						</div>
					{:else if columnaId === 'documentos_count'}
						{#if fila.documentos_count > 0}
							<span class="mono c-docs">{fila.documentos_count}</span>
						{:else}
							<span class="c-nulo">—</span>
						{/if}
					{:else if columnaId === 'estado'}
						{@const e = ESTADO_LABELS[fila.estado]}
						<span
							class="estado-pill"
							style="background-color: {e.bg}; color: {e.color}; border-color: {e.border}"
						>
							<span class="estado-dot" style="background-color: {e.dot}"></span>
							{e.label}
						</span>
					{:else if columnaId === 'fecha_envio'}
						<div class="c-fecha">
							<span class="mono">{formatFechaCorta(fila.fecha_envio)}</span>
							<span class="c-nulo">{tiempoRelativo(fila.fecha_envio)}</span>
						</div>
					{:else}
						{valor ?? ''}
					{/if}
				{/snippet}
			</TablaLista>
		</div>

		<!-- Paginación -->
		<PaginadorLista
			pagina={filtros.pagina}
			total={pagination.total}
			porPagina={POR_PAGINA}
			cargando={isLoading}
			nombreItems="formularios"
			onCambiar={irAPagina}
		/>
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
		padding: 1.35rem 1.5rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);

		/* Texto y cifras EN PARALELO, no apilados.
		 *
		 * Antes el hero era una columna: bloque de título arriba y una fila de
		 * estadísticas debajo, separadas por una línea. En escritorio eso
		 * gastaba casi un tercio de la altura visible de la página en cabecera
		 * mientras la mitad derecha de la tarjeta quedaba vacía.
		 *
		 * La rejilla es fluida y NO lleva `@media`: el ancho que importa es el
		 * del `<main>` del layout, que cambia cuando la barra lateral se
		 * colapsa. Un punto de ruptura atado al viewport se desincroniza de ese
		 * ancho; `auto-fit` no. Con `min(100%, 26rem)` cae a una sola columna en
		 * cuanto no caben dos de 26rem, sin desbordar en móvil.
		 */
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
	.hero-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}
	/* `.eyebrow` es `inline-block`, pero como hijo de un flex en columna lo
	   estira el `align-items: stretch` por defecto: la pastilla naranja llegaba
	   hasta el borde de la columna en vez de ceñirse a su texto. Se nota mucho
	   más desde que la columna es la mitad de la tarjeta y no toda. */
	.hero-text .eyebrow {
		align-self: flex-start;
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
		/* 640px capaba la descripción muy por debajo del ancho disponible y
		   dejaba hueco muerto a su derecha. El tope se sube al límite de
		   legibilidad (44rem): con dos columnas es la propia columna la que
		   manda y este valor no llega a morder; solo actúa cuando la rejilla
		   cae a una columna ancha, que es justo donde un renglón larguísimo
		   haría perder la línea al leer. */
		max-width: 44rem;
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
		gap: 0.4rem;
		font-family: 'Geist', ui-monospace, monospace;
	}
	/* La línea superior que separaba las cifras del texto se fue con el
	   apilado: al ponerse en paralelo ya no hay nada arriba de lo que
	   separarlas, y un borde a media tarjeta quedaba suelto. Cada dato se
	   delimita ahora por sí mismo, que además hace legible el envolvido en la
	   columna estrecha. */
	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.6rem;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.05);
		border-radius: 9px;
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
	   CELDAS DE LA TABLA
	   ═══════════════════════════════════════════════════════════════
	   Aquí había el CSS de las tarjetas: `.form-card`, `.form-head`,
	   `.form-meta`, `.form-foot` y los cinco `.form-avatar--<estado>` del
	   círculo con las iniciales del nombre. Una tarjeta por registro gastaba
	   media pantalla en cuatro datos y el avatar no aportaba información: era
	   una inicial calculada, no una foto ni un identificador.

	   Se conservan las pastillas —radicado, código y estado— porque siguen
	   usándose dentro de las celdas. */
	.tabla-envoltorio {
		/* La tabla es un componente compartido y neutro; la piel de esta
		   pantalla se le pasa por custom properties en vez de tocar su CSS. */
		--tl-th-fondo: #fcfcfb;
		--tl-th-color: #64748b;
		--tl-th-color-hover: #0f172a;
		--tl-td-color: #1e293b;
		--tl-td-suave: #64748b;
		--tl-mono: 'Geist', ui-monospace, monospace;
		--tl-acento: #f97316;
		--tl-fila-hover: rgba(249, 115, 22, 0.04);
	}

	.c-radicado {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
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
		/* Un radicado partido en cuatro renglones deja de ser un identificador
		   legible y dispara la altura de la fila. Si no cabe, que la tabla
		   desplace en horizontal: para eso tiene su propio contenedor. */
		white-space: nowrap;
	}
	.codigo-pill {
		display: inline-flex;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 600;
		color: #64748b;
		background: rgba(0, 0, 0, 0.04);
		padding: 0.15rem 0.45rem;
		border-radius: 5px;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.c-nombre {
		font-weight: 600;
		color: #0f172a;
	}
	.c-tipo,
	.c-doc {
		font-size: 0.78rem;
		color: #475569;
		white-space: nowrap;
	}
	.c-nulo {
		color: #94a3b8;
	}
	.c-docs {
		font-weight: 700;
		color: #0f172a;
	}
	/* Correo y teléfono apilados: en una sola línea el correo obliga a una
	   columna larguísima y empuja el resto de la tabla al scroll horizontal. */
	.c-contacto,
	.c-fecha {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		font-size: 0.75rem;
	}
	.c-contacto span,
	.c-fecha span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.estado-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.25rem 0.5rem;
		border-radius: 5px;
		border: 1px solid;
		white-space: nowrap;
	}
	.estado-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	/* ═══════════════════════════════════════════════════════════════
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
