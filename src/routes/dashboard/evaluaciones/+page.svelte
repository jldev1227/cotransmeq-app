<script lang="ts">
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { getEvaluaciones, deleteEvaluacion, type Evaluacion } from '$lib/api/evaluaciones';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import { page } from '$app/state';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import PastillaTipo from '$lib/components/evaluaciones/PastillaTipo.svelte';
	import ModalConfirmar from '$lib/components/evaluaciones/ModalConfirmar.svelte';
	import { pluralPreguntas, pluralPuntos } from '$lib/components/evaluaciones/tipos';
	import { mascota } from '$lib/mascot';
	import { Eye, Pencil, Trash2 } from 'lucide-svelte';
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
		{ id: 'tipos', header: 'Tipos de pregunta', enableSorting: false, size: 220 },
		{ id: 'preguntas', header: 'Preguntas · Puntos', enableSorting: false, size: 150 },
		{ id: 'firma', header: 'Firma', enableSorting: false, size: 110 },
		{ id: 'created_at', accessorKey: 'created_at', header: 'Creada', size: 140 },
		{ id: 'acciones', header: '', enableSorting: false, size: 150 }
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

	/** Evaluación pendiente de confirmar su borrado; `null` cierra el modal. */
	let aEliminar = $state<{ id: string; titulo: string } | null>(null);
	let eliminando = $state(false);

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

	function pedirEliminar(id: string, titulo: string) {
		aEliminar = { id, titulo };
	}

	async function confirmarEliminar() {
		if (!aEliminar) return;
		eliminando = true;
		try {
			const r = await deleteEvaluacion(aEliminar.id);
			if (r.success) loadEvaluaciones();
		} catch (err) {
			console.error('Error al eliminar:', err);
		} finally {
			eliminando = false;
			aEliminar = null;
		}
	}

	function tiposDe(e: Evaluacion): string[] {
		return [...new Set(e.preguntas.map((p) => p.tipo))];
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

	const conteos = $derived([
		{ clave: 'total', etiqueta: 'Evaluaciones', valor: totalRows },
		{
			clave: 'firma',
			etiqueta: 'Con firma',
			valor: evaluaciones.filter((e) => e.requiere_firma).length,
			color: '#ea580c'
		},
		{
			clave: 'preguntas',
			etiqueta: 'Preguntas en página',
			valor: evaluaciones.reduce((s, e) => s + e.preguntas.length, 0)
		}
	]);
</script>

<svelte:head><title>Evaluaciones - Cotransmeq</title></svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA ──────────────────────────────────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Evaluaciones</h1>
			<p class="dir-desc">
				Diseño, publicación y seguimiento de las evaluaciones aplicadas al personal, con el detalle
				de lo que respondió cada evaluado.
			</p>
			<div class="dir-conteos">
				<ResumenConteos {conteos} />
			</div>
		</div>

		<div class="dir-cabecera-acciones">
			<button class="btn-primary" onclick={navigateToCrear} aria-label="Crear nueva evaluación">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
				</svg>
				Nueva evaluación
			</button>
		</div>
	</header>

	<!-- ── BUSCADOR ──────────────────────────────────────────── -->
	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(termino) => ponerFiltro('q', termino)}
				placeholder="Buscar por título o descripción…"
				etiqueta="Buscar evaluaciones"
			/>
		</div>
		{#if filtros.q}
			<button class="btn-secondary" onclick={clearSearch}>Limpiar</button>
		{/if}
	</div>

	<!-- ── LISTA ─────────────────────────────────────────────── -->
	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
		<div class="dir-lista-scroll">
			<TablaLista
				columnas={COLUMNAS}
				datos={evaluaciones}
				claveFila={(f) => f.id}
				cargando={isLoading}
				orden={ordenTabla}
				onOrdenar={aplicarOrden}
				onFila={(f) => navigateToDetalle(f.id)}
				etiqueta="Evaluaciones registradas"
			>
				{#snippet celda({ columnaId, fila, valor })}
					{#if columnaId === 'titulo'}
						<!-- Con ancho máximo: la descripción va en una línea sin cortes y, en
						     una tabla de anchura automática, ese texto sin saltos hacía crecer
						     la columna hasta sacar las demás de la pantalla. -->
						<div class="eval-identidad">
							<CeldaIdentidad titulo={fila.titulo} subtitulo={fila.descripcion ?? undefined} />
						</div>
					{:else if columnaId === 'tipos'}
						{@const tipos = tiposDe(fila)}
						<div class="eval-tipos">
							{#each tipos.slice(0, 3) as tipo (tipo)}
								<PastillaTipo {tipo} corta />
							{/each}
							{#if tipos.length > 3}<span class="eval-tipos-mas">+{tipos.length - 3}</span>{/if}
							{#if tipos.length === 0}<span class="dir-nulo">Sin preguntas</span>{/if}
						</div>
					{:else if columnaId === 'preguntas'}
						<div class="dir-celda">
							<span>{pluralPreguntas(fila.preguntas.length)}</span>
							<small>{pluralPuntos(calcularPuntajeTotal(fila))}</small>
						</div>
					{:else if columnaId === 'firma'}
						{#if fila.requiere_firma}
							<EstadoPunto etiqueta="Requerida" color="#ea580c" />
						{:else}
							<EstadoPunto etiqueta="No aplica" color="#64748b" apagado />
						{/if}
					{:else if columnaId === 'created_at'}
						<span class="dir-celda dir-celda--fecha">{formatDate(fila.created_at)}</span>
					{:else if columnaId === 'acciones'}
						<AccionesFila
							acciones={[
								{
									id: 'ver',
									etiqueta: 'Ver detalle',
									icono: Eye,
									onClick: () => navigateToDetalle(fila.id)
								},
								{
									id: 'editar',
									etiqueta: 'Editar',
									icono: Pencil,
									onClick: () => goto(`/dashboard/evaluaciones/${fila.id}/editar`)
								},
								{
									id: 'eliminar',
									etiqueta: 'Eliminar',
									icono: Trash2,
									onClick: () => pedirEliminar(fila.id, fila.titulo || ''),
									peligrosa: true
								}
							]}
						/>
					{:else}
						{valor ?? ''}
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota('vacio')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>{filtros.q ? 'Sin resultados' : 'No hay evaluaciones creadas'}</h3>
						<p>
							{filtros.q
								? 'Ninguna evaluación coincide con la búsqueda.'
								: 'Crea la primera evaluación para aplicarla al personal.'}
						</p>
						{#if filtros.q}
							<button class="btn-secondary" onclick={clearSearch}>Limpiar búsqueda</button>
						{:else}
							<button class="btn-primary" onclick={navigateToCrear}>Crear primera evaluación</button
							>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>

		<PaginadorLista
			pagina={filtros.pagina}
			total={totalRows}
			porPagina={POR_PAGINA}
			cargando={isLoading}
			nombreItems="evaluaciones"
			onCambiar={handlePageChange}
		/>
	</div>
</div>

{#if aEliminar}
	<ModalConfirmar
		titulo="Eliminar evaluación"
		mensaje={`Se eliminará «${aEliminar.titulo}» con todas sus preguntas y respuestas. Esta acción no se puede deshacer.`}
		confirmar="Eliminar evaluación"
		procesando={eliminando}
		onConfirmar={confirmarEliminar}
		onCancelar={() => (aEliminar = null)}
	/>
{/if}

<style>
	.eval-identidad {
		/* Ancho fijo con tope: el título va en `nowrap`, y sin un ancho propio
		   el mínimo de la columna sería el texto entero, que empuja la tabla
		   fuera de la tarjeta y corta la columna de acciones. */
		width: 19rem;
		max-width: 100%;
		min-width: 0;
		flex: 1;
	}
	.eval-tipos {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}
	.eval-tipos-mas {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-muted);
	}
</style>
