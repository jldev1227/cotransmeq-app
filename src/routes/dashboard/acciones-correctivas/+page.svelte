<script lang="ts">
	/**
	 * Tablero de acciones correctivas y preventivas.
	 *
	 * Misma cáscara que los directorios (`dir-*` de app.css y `listing/`):
	 * cabecera con los indicadores como conteos pulsables, buscador y
	 * segmentos a la vista, y las tarjetas de acción en una rejilla fluida.
	 * Entre medias, dos paneles de seguimiento (revisiones vencidas y
	 * próximas) y una franja con el estado de las causas y el reparto por
	 * tipo. Antes tenía su propio cascarón —cabecera con icono, pastillas,
	 * tarjetas KPI— que no se parecía al resto del panel.
	 *
	 * Filtros y papelera viven en la URL: un enlace compartido abre la misma
	 * vista.
	 */
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Plus, Trash2 } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import AccionCard from '$lib/components/acciones-correctivas/dashboard/AccionCard.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		bandera,
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { listadoAcciones } from '$lib/stores/volverListado';
	import { mascota } from '$lib/mascot';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva,
		type ActionStatusGlobal,
		type ResumenAcciones
	} from '$lib/api/acciones-correctivas';
	import {
		formatearDiasRelativo,
		formatDate as formatDateCorta
	} from '$lib/acciones-correctivas/dashboard-utils';

	const EMPRESA = 'Cotransmeq';

	// Colores semáforo de los estados: iguales en los dos gemelos.
	const AZUL = '#3b82f6';
	const ROJO = '#ef4444';
	const VERDE = '#22c55e';
	const AMBAR = '#f59e0b';
	const GRIS = '#66756f';

	const SEGMENTOS_ESTADO = [
		{ valor: '', etiqueta: 'Todas' },
		{ valor: 'EN_PROCESO', etiqueta: 'En proceso', punto: AZUL },
		{ valor: 'VENCIDA', etiqueta: 'Vencidas', punto: ROJO },
		{ valor: 'CUMPLIDA', etiqueta: 'Cumplidas', punto: VERDE }
	];
	const SEGMENTOS_REVISION = [
		{ valor: '', etiqueta: 'Todas' },
		{ valor: 'vencidas', etiqueta: 'Rev. vencidas', punto: ROJO },
		{ valor: 'proximas', etiqueta: 'Rev. próximas', punto: AMBAR }
	];
	const REVISIONES_PANEL_LIMITE = 8;

	// ── Filtros en la URL ────────────────────────────────────────────────
	/// Los nombres `search` y `estado` son los que esta página ya usaba, para
	/// no romper enlaces guardados.
	interface FiltrosAcciones {
		search: string;
		estado: string;
		revision: string;
		eliminadas: boolean;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<FiltrosAcciones> = {
		search: texto(),
		estado: opcion(''),
		revision: opcion(''),
		eliminadas: bandera(false),
		pagina: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<FiltrosAcciones>(estadoUrl.leer(page.url));
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	/// Cambiar cualquier filtro vuelve a la página 1: la 3 de «Vencidas» no es
	/// la 3 de «Todas». Se hace aquí, en el único sitio por donde cambian, y no
	/// con un efecto que compare valores: ese efecto también vería «cambiada»
	/// la página que llega en la URL al abrir un enlace y la borraría.
	function ponerFiltro<K extends keyof FiltrosAcciones>(clave: K, valor: FiltrosAcciones[K]) {
		filtros = { ...filtros, [clave]: valor, ...(clave === 'pagina' ? {} : { pagina: 1 }) };
	}
	const papelera = $derived(filtros.eliminadas);
	const hayFiltros = $derived(!!filtros.search || !!filtros.estado || !!filtros.revision);

	/// El campo de búsqueda lleva su propio estado: atado a `filtros.search`,
	/// cada tecla cambiaba el filtro y lanzaba una petición sin esperar al
	/// retardo del buscador.
	let busqueda = $state(untrack(() => filtros.search));

	/// Cada URL en la que se asienta el tablero (filtros, papelera, página)
	/// queda como destino del «Volver» del detalle y de la edición.
	afterNavigate(({ to }) => {
		if (to?.url) listadoAcciones.recordar(to.url.pathname + to.url.search);
	});

	// ── Datos ────────────────────────────────────────────────────────────
	/// 24 llena filas completas en la rejilla a 2, 3 y 4 columnas.
	const POR_PAGINA = 24;
	const RESUMEN_VACIO: ResumenAcciones = {
		total_estados: 0,
		por_estado: { EN_PROCESO: 0, VENCIDA: 0, CUMPLIDA: 0, REPLANTEADA: 0 },
		proximas_vencer: 0,
		revisiones: { vencidas: [], proximas: [] },
		causas: { total: 0, en_proceso: 0, vencida: 0, cumplida: 0 },
		por_tipo: {}
	};

	let acciones = $state<AccionCorrectivaPreventiva[]>([]);
	/// Total del resultado en el servidor (todas las páginas), para el paginador.
	let total = $state(0);
	/// Conteos del tablero sobre todo el filtro. Antes se contaban en el cliente
	/// sobre las 50 filas que se pedían, sin paginador: pasada la 50.ª acción,
	/// «Total», «Vencidas» y los paneles de revisión dejaban de cuadrar.
	let resumenServidor = $state<ResumenAcciones | null>(null);
	let cargando = $state(true);
	let errorCarga = $state<string | null>(null);
	let highlightId = $state<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;
	let expandirVencidas = $state(false);
	let expandirProximas = $state(false);
	let loadingState = $state<{
		id: string;
		action: 'duplicar' | 'eliminar' | 'restaurar' | 'eliminar-permanente' | 'pdf';
	} | null>(null);

	/// La recarga la dispara el cambio de filtros, no cada handler.
	$effect(() => {
		void filtros.search;
		void filtros.estado;
		void filtros.revision;
		void filtros.eliminadas;
		void filtros.pagina;
		void cargarAcciones();
	});

	/// Solo la respuesta de la última petición se pinta: al pasar rápido de
	/// página, una respuesta lenta de la anterior pisaba a la buena.
	let ultimaPeticion = 0;

	async function cargarAcciones() {
		const peticion = ++ultimaPeticion;
		cargando = true;
		errorCarga = null;
		try {
			const resultado = await accionesCorrectivasAPI.listar({
				page: filtros.pagina,
				limit: POR_PAGINA,
				sortBy: 'created_at',
				sortOrder: 'desc',
				...(filtros.search && { busqueda: filtros.search }),
				...(filtros.estado && { estado_global: filtros.estado as ActionStatusGlobal }),
				...((filtros.revision === 'vencidas' || filtros.revision === 'proximas') && {
					revision: filtros.revision
				}),
				...(filtros.eliminadas && { incluir_eliminados: true })
			});
			if (peticion !== ultimaPeticion) return;
			acciones = resultado.acciones;
			total = resultado.total;
			resumenServidor = resultado.resumen ?? RESUMEN_VACIO;
			expandirVencidas = false;
			expandirProximas = false;
		} catch (error) {
			if (peticion !== ultimaPeticion) return;
			/// No se vacía la lista: sin datos, el aviso de error ocupa su lugar
			/// en vez del «Todavía no hay acciones», que mentía; con datos de
			/// antes, se quedan a la vista junto al aviso.
			errorCarga = error instanceof Error ? error.message : 'No se pudieron cargar las acciones';
			toast.error(errorCarga);
		} finally {
			if (peticion === ultimaPeticion) cargando = false;
		}
	}

	/// Una página que ya no existe (se borraron acciones, o el enlace traía una
	/// de más) se recorta a la última. Solo con la respuesta en la mano: antes
	/// de la primera carga `total` vale 0 y recortaría cualquier `?pagina=3`.
	$effect(() => {
		if (cargando || !resumenServidor) return;
		const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
		if (filtros.pagina > paginas) untrack(() => ponerFiltro('pagina', paginas));
	});

	// ── Indicadores ──────────────────────────────────────────────────────
	const r = $derived(resumenServidor ?? RESUMEN_VACIO);
	const accionCounts = $derived({
		enProceso: r.por_estado.EN_PROCESO ?? 0,
		vencida: r.por_estado.VENCIDA ?? 0,
		cumplida: r.por_estado.CUMPLIDA ?? 0,
		proxVencer: r.proximas_vencer,
		total: r.total_estados
	});
	const revisionesVencidas = $derived(r.revisiones.vencidas);
	const revisionesProximas = $derived(r.revisiones.proximas);
	const causasStats = $derived({
		enProceso: r.causas.en_proceso,
		vencida: r.causas.vencida,
		cumplida: r.causas.cumplida,
		total: r.causas.total
	});
	const tipos = $derived(Object.entries(r.por_tipo).sort((a, b) => b[1] - a[1]));
	const COLOR_TIPO: Record<string, string> = {
		CORRECTIVA: AMBAR,
		PREVENTIVA: '#8b5cf6',
		MEJORA: '#079665'
	};

	const resumen = $derived([
		{ clave: '', etiqueta: 'Total', valor: accionCounts.total },
		{ clave: 'EN_PROCESO', etiqueta: 'En proceso', valor: accionCounts.enProceso, color: AZUL },
		{ clave: 'VENCIDA', etiqueta: 'Vencidas', valor: accionCounts.vencida, color: ROJO },
		{ clave: 'CUMPLIDA', etiqueta: 'Cumplidas', valor: accionCounts.cumplida, color: VERDE },
		{ clave: 'prox', etiqueta: 'Vencen en 7 días', valor: accionCounts.proxVencer, color: AMBAR },
		{ clave: 'rev', etiqueta: 'Rev. vencidas', valor: revisionesVencidas.length, color: '#dc2626' }
	]);
	function elegirConteo(clave: string) {
		if (clave === 'prox') return;
		if (clave === 'rev') return ponerFiltro('revision', filtros.revision === 'vencidas' ? '' : 'vencidas');
		ponerFiltro('estado', filtros.estado === clave ? '' : clave);
	}

	const causas = $derived([
		{ clave: 'total', etiqueta: 'Causas', valor: causasStats.total },
		{ clave: 'proceso', etiqueta: 'En proceso', valor: causasStats.enProceso, color: AZUL },
		{ clave: 'vencida', etiqueta: 'Vencidas', valor: causasStats.vencida, color: ROJO },
		{ clave: 'cumplida', etiqueta: 'Cumplidas', valor: causasStats.cumplida, color: VERDE }
	]);

	/// Conserva la papelera: «Limpiar filtros» dentro de ella sacaba de ella.
	function limpiarFiltros() {
		filtros = limpiarFiltrosDe(DEFS, filtros, ['eliminadas']);
		busqueda = '';
	}

	function cambiarPagina(pagina: number) {
		ponerFiltro('pagina', pagina);
	}

	// ── Acciones sobre una tarjeta ───────────────────────────────────────
	async function handleDuplicar(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		loadingState = { id, action: 'duplicar' };
		try {
			toast.loading('Duplicando acción…', { id: 'duplicar' });
			const nueva = await accionesCorrectivasAPI.duplicar(id);
			toast.success(`Acción duplicada: ${nueva.accion_numero}`, { id: 'duplicar' });
			highlightId = nueva.id;
			clearTimeout(highlightTimer);
			highlightTimer = setTimeout(() => (highlightId = null), 3000);
			/// La copia es la más reciente: sale primera en la página 1.
			if (filtros.pagina !== 1) ponerFiltro('pagina', 1);
			else await cargarAcciones();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo duplicar', { id: 'duplicar' });
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
			toast.error(error?.message || 'No se pudo mover a la papelera');
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
			toast.error(error?.message || 'No se pudo restaurar');
		} finally {
			loadingState = null;
		}
	}

	async function handleEliminarPermanente(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		const ok = await confirmarEliminacion({
			title: '¿Eliminar permanentemente?',
			message: 'Esta acción no se puede deshacer.',
			confirmText: 'Eliminar para siempre'
		});
		if (!ok) return;
		loadingState = { id, action: 'eliminar-permanente' };
		try {
			await accionesCorrectivasAPI.eliminarPermanente(id);
			toast.success('Acción eliminada permanentemente');
			await cargarAcciones();
		} catch (error: any) {
			toast.error(error?.message || 'No se pudo eliminar');
		} finally {
			loadingState = null;
		}
	}

	async function handleExportPDF(event: CustomEvent<{ id: string }>) {
		const id = event.detail.id;
		loadingState = { id, action: 'pdf' };
		try {
			toast.loading('Generando PDF…', { id: 'pdf' });
			const accion = acciones.find((a) => a.id === id);
			await accionesCorrectivasAPI.descargarPDF(id, accion?.accion_numero || id);
			toast.success('PDF descargado', { id: 'pdf' });
		} catch (error: any) {
			toast.error(error?.message || 'No se pudo exportar el PDF', { id: 'pdf' });
		} finally {
			loadingState = null;
		}
	}
</script>

<svelte:head>
	<title>Acciones correctivas — {EMPRESA}</title>
</svelte:head>

<div class="dir-pagina ac-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Acciones correctivas y preventivas</h1>
			<p class="dir-desc">
				Hallazgos, causas, planes de acción y seguimiento del sistema de gestión HSEQ.
			</p>
			{#if !papelera}
				<div class="dir-conteos">
					<ResumenConteos
						conteos={resumen}
						activo={filtros.revision === 'vencidas' ? 'rev' : filtros.estado || null}
						onElegir={elegirConteo}
					/>
				</div>
			{/if}
		</div>

		<div class="dir-cabecera-acciones">
			<button
				type="button"
				class="btn-secondary"
				class:ac-papelera--on={papelera}
				onclick={() => ponerFiltro('eliminadas', !papelera)}
				aria-pressed={papelera}
				title={papelera ? 'Volver a las acciones' : 'Ver la papelera'}
			>
				<Trash2 size={16} strokeWidth={2} />
				Papelera
			</button>
			<button type="button" class="btn-primary" onclick={() => goto('/dashboard/acciones-correctivas/crear')}>
				<Plus size={16} strokeWidth={2.4} />
				Nueva acción
			</button>
		</div>
	</header>

	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 80 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={busqueda}
				onBuscar={(t) => ponerFiltro('search', t)}
				placeholder={papelera ? 'Buscar en la papelera…' : 'Número, hallazgo, responsable…'}
				etiqueta="Buscar acciones"
			/>
		</div>
		{#if !papelera}
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={SEGMENTOS_ESTADO}
				valor={filtros.estado}
				onCambiar={(v) => ponerFiltro('estado', v)}
			/>
			<SegmentosFiltro
				etiqueta="Revisión"
				opciones={SEGMENTOS_REVISION}
				valor={filtros.revision}
				onCambiar={(v) => ponerFiltro('revision', v)}
			/>
		{/if}
	</div>

	{#if cargando && !resumenServidor}
		<CargaMascota texto={papelera ? 'Abriendo la papelera…' : 'Cargando acciones…'} />
	{:else if errorCarga && acciones.length === 0}
		{@const img = mascota('advertencia')}
		<div class="page-card dir-vacio" role="alert">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<h3>No pudimos cargar las acciones</h3>
			<p>{errorCarga}</p>
			<button type="button" class="btn-secondary" onclick={() => cargarAcciones()}>
				Reintentar
			</button>
		</div>
	{:else}
		{#if !papelera && (revisionesVencidas.length > 0 || revisionesProximas.length > 0)}
			<!-- ── Seguimiento: lo que hay que revisar ya y lo que viene ── -->
			<section class="ac-revisiones" aria-label="Revisiones pendientes y próximas" in:fly={{ y: 12, duration: 400, delay: 120 }}>
				{#each [{ clave: 'vencidas', titulo: 'Vencidas de revisión', ayuda: 'Más de 15 días sin un seguimiento registrado.', lista: revisionesVencidas, expandida: expandirVencidas, tono: 'vencida' }, { clave: 'proximas', titulo: 'Próximas revisiones', ayuda: 'El siguiente seguimiento cae en los próximos días.', lista: revisionesProximas, expandida: expandirProximas, tono: 'proxima' }] as panel (panel.clave)}
					{#if panel.lista.length > 0}
						<article class="page-card ac-panel ac-panel--{panel.tono}">
							<header class="ac-panel-cabecera">
								<span class="ac-panel-punto" aria-hidden="true"></span>
								<h2 class="ac-panel-titulo">{panel.titulo}</h2>
								<span class="ac-panel-conteo">{panel.lista.length}</span>
							</header>
							<!-- Una tira de chips, no una fila por acción: el panel es un aviso
							     rápido, no la lista. El detalle está a un clic. -->
							<ul class="ac-chips" title={panel.ayuda}>
								{#each panel.expandida ? panel.lista : panel.lista.slice(0, REVISIONES_PANEL_LIMITE) as acc (acc.id)}
									<li>
										<a
											class="ac-chip"
											href="/dashboard/acciones-correctivas/{acc.id}"
											title="{acc.responsable_ejecucion || 'Sin asignar'} · {panel.clave === 'vencidas'
												? `última: ${acc.ultimaFecha ? formatDateCorta(acc.ultimaFecha) : '—'}`
												: `próxima: ${acc.proximaFecha ? formatDateCorta(acc.proximaFecha) : '—'}`}"
										>
											<span class="ac-chip-num">{acc.accion_numero}</span>
											<span class="ac-chip-tag" class:ac-chip-tag--sin={acc.estado === 'sin-actividad'}>
												{acc.estado === 'sin-actividad' ? 'sin actividad' : formatearDiasRelativo(acc.diasHasta)}
											</span>
										</a>
									</li>
								{/each}
								{#if panel.lista.length > REVISIONES_PANEL_LIMITE}
									<li>
										<button
											type="button"
											class="ac-chip ac-chip--mas"
											aria-expanded={panel.expandida}
											onclick={() => {
												if (panel.clave === 'vencidas') expandirVencidas = !expandirVencidas;
												else expandirProximas = !expandirProximas;
											}}
										>
											{panel.expandida ? 'Ver menos' : `+${panel.lista.length - REVISIONES_PANEL_LIMITE} más`}
										</button>
									</li>
								{/if}
							</ul>
						</article>
					{/if}
				{/each}
			</section>
		{/if}

		{#if !papelera && total > 0 && (causasStats.total > 0 || tipos.length > 0)}
			<!-- ── Causas y reparto por tipo, en una sola franja ── -->
			<section class="page-card ac-resumen" aria-label="Causas y tipos" in:fly={{ y: 12, duration: 400, delay: 160 }}>
				{#if causasStats.total > 0}
					<div class="ac-resumen-bloque">
						<span class="ac-resumen-titulo">Causas registradas</span>
						<ResumenConteos conteos={causas} />
					</div>
				{/if}
				{#if tipos.length > 0}
					<div class="ac-resumen-bloque ac-resumen-bloque--tipos">
						<span class="ac-resumen-titulo">Por tipo de acción</span>
						<ul class="ac-tipos">
							{#each tipos as [tipo, n] (tipo)}
								{@const pct = total ? Math.round((n / total) * 100) : 0}
								<li class="ac-tipo">
									<span class="ac-tipo-nombre">{tipo}</span>
									<span class="ac-tipo-barra" aria-label="{tipo}: {n} ({pct} %)">
										<span class="ac-tipo-relleno" style="width: {pct}%; background: {COLOR_TIPO[tipo] ?? GRIS}"></span>
									</span>
									<span class="ac-tipo-n">{n}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>
		{/if}

		<p class="ac-resultados" aria-live="polite">
			{#if papelera}
				Papelera · {total} {total === 1 ? 'acción' : 'acciones'}
			{:else if filtros.revision}
				{total} {total === 1 ? 'acción' : 'acciones'} con revisión {filtros.revision === 'vencidas'
					? 'vencida'
					: 'próxima'}
			{:else}
				{total} {total === 1 ? 'acción' : 'acciones'}
			{/if}
			{#if hayFiltros}
				<button type="button" class="ac-limpiar" onclick={limpiarFiltros}>Limpiar filtros</button>
			{/if}
		</p>

		{#if acciones.length === 0}
			{@const img = mascota(papelera || hayFiltros ? 'vacio' : 'espera')}
			<div class="page-card dir-vacio">
				<img src={img.src} alt={img.alt} width="418" height="418" />
				<h3>
					{papelera ? 'La papelera está vacía' : hayFiltros ? 'Sin resultados' : 'Todavía no hay acciones'}
				</h3>
				<p>
					{papelera
						? 'Lo que muevas a la papelera aparecerá aquí para restaurarlo o eliminarlo del todo.'
						: hayFiltros
							? 'Ninguna acción coincide con la búsqueda o los filtros elegidos.'
							: 'Registra el primer hallazgo con sus causas y su plan de acción.'}
				</p>
				{#if hayFiltros}
					<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar filtros</button>
				{:else if !papelera}
					<button type="button" class="btn-primary" onclick={() => goto('/dashboard/acciones-correctivas/crear')}>
						<Plus size={16} strokeWidth={2.4} />
						Registrar acción
					</button>
				{/if}
			</div>
		{:else}
			<div class="ac-rejilla" in:fly={{ y: 12, duration: 400, delay: 200 }}>
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
			{#if total > POR_PAGINA}
				<PaginadorLista
					pagina={filtros.pagina}
					{total}
					porPagina={POR_PAGINA}
					onCambiar={cambiarPagina}
					cargando={cargando}
					nombreItems="acciones"
					suelto
				/>
			{/if}
		{/if}
	{/if}
</div>

<style>
	/* Las tarjetas de acción (`AccionCard`, `StatusBadge`, `CausasDots`) leen
	   estas variables de su contenedor: aquí se mapean a los tokens de la app
	   en vez de repetir hexadecimales. */
	.ac-pagina {
		--surface: var(--bg-surface);
		--surface-hover: var(--bg-base);
		--border: var(--border-subtle);
		--border-default: var(--border-default);
		--border-hover: var(--au-primary);
		--accent: var(--au-primary);
		--accent-hover: var(--au-primary-strong);
		--accent-bg: var(--au-tint);
		--accent-ring: rgba(var(--au-primary-rgb), 0.18);
		--tag-bg: var(--bg-base);
		--avatar-bg: var(--au-tint);
		--avatar-color: var(--au-dark);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);
		height: auto;
		min-height: 100%;
	}

	.ac-papelera--on {
		border-color: var(--au-danger) !important;
		color: var(--au-danger) !important;
		background: var(--au-danger-soft) !important;
	}

	/* ═══ Paneles de revisión ═══ */
	.ac-revisiones {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
	}
	.ac-panel {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.9rem 1.1rem;
	}
	.ac-panel--vencida {
		--ac-tono: #dc2626;
		--ac-tono-suave: #fff0ed;
	}
	.ac-panel--proxima {
		--ac-tono: #b45309;
		--ac-tono-suave: #fff4e5;
	}
	.ac-panel-cabecera {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.ac-panel-punto {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--ac-tono);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--ac-tono) 18%, transparent);
	}
	.ac-panel-titulo {
		margin: 0;
		flex: 1;
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: -0.015em;
		color: var(--text-primary);
	}
	.ac-panel-conteo {
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--ac-tono-suave);
		color: var(--ac-tono);
		font-size: 0.78rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.ac-chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.ac-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2rem;
		padding: 0.2rem 0.3rem 0.2rem 0.65rem;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		text-decoration: none;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.ac-chip:hover {
		border-color: var(--ac-tono);
		background: var(--bg-surface);
	}
	.ac-chip-tag {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--ac-tono-suave);
		color: var(--ac-tono);
		font-size: 0.68rem;
		font-weight: 800;
		white-space: nowrap;
	}
	.ac-chip-tag--sin {
		background: var(--bg-surface);
		color: var(--text-muted);
		border: 1px solid var(--border-subtle);
	}
	.ac-chip--mas {
		padding: 0.2rem 0.75rem;
		background: var(--bg-surface);
		color: var(--au-primary-strong);
	}

	/* ═══ Causas y tipos ═══ */
	.ac-resumen {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: 1rem 2rem;
	}
	.ac-resumen-bloque {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}
	.ac-resumen-titulo {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ac-tipos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.ac-tipo {
		display: grid;
		grid-template-columns: 7rem 1fr 2.5rem;
		align-items: center;
		gap: 0.6rem;
	}
	.ac-tipo-nombre {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ac-tipo-barra {
		display: block;
		height: 8px;
		border-radius: 999px;
		background: var(--bg-base);
		overflow: hidden;
	}
	.ac-tipo-relleno {
		display: block;
		height: 100%;
		border-radius: 999px;
		transition: width 0.4s ease;
	}
	.ac-tipo-n {
		font-size: 0.8rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--text-primary);
	}

	/* ═══ Resultados y rejilla ═══ */
	.ac-resultados {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.ac-limpiar {
		border: 0;
		background: none;
		padding: 0;
		color: var(--au-primary-strong);
		font-family: inherit;
		font-size: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.ac-limpiar:hover {
		text-decoration: underline;
	}
	.ac-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
		padding-bottom: 1rem;
	}
</style>
