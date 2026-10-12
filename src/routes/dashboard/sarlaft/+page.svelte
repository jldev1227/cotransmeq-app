<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { mascota } from '$lib/mascot';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		firma,
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { untrack } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import {
		sarlaftAPI,
		TIPO_FORMULARIO_LABELS,
		ESTADO_LABELS,
		type TipoFormularioSarlaft,
		type EstadoSarlaft,
		type SarlaftFormularioResumen
	} from '$lib/api/sarlaft';
	import { listadoSarlaft } from '$lib/stores/volverListado';
	import { toast } from 'svelte-sonner';

	let items = $state<SarlaftFormularioResumen[]>([]);
	let pagination = $state({ page: 1, limit: 20, total: 0, pages: 1 });
	let isLoading = $state(true);
	/// Distingue la primera carga (mascota a pantalla de bloque) de las
	/// siguientes (esqueleto dentro de la tabla): al paginar o filtrar, la
	/// tabla conserva sus columnas y el paginador no salta.
	let cargadoUnaVez = $state(false);
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
	/// `leerInicial` y no `leer(page.url)`: al volver del detalle con el
	/// «Volver», durante la hidratación `page` todavía puede traer la URL
	/// anterior y los filtros nacían vacíos.
	let filtros = $state<FiltrosSarlaft>(estadoUrl.leerInicial());

	/// Cada cambio de lo que pide el servidor se resume en una cadena. Leer
	/// los campos aquí es lo que suscribe los efectos: `void filtros` sobre el
	/// proxy de `$state` no se entera de cambios en sus propiedades.
	const firmaConsulta = $derived(firma(DEFS, filtros));

	$effect(() => {
		void firmaConsulta;
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	/// Antes había además un `load()` en `onMount`: la primera visita pedía el
	/// listado dos veces.
	$effect(() => {
		void firmaConsulta;
		untrack(() => load());
	});

	/// El «Volver» del detalle regresa a esta URL exacta, con sus filtros.
	afterNavigate(({ to }) => {
		if (to?.url) listadoSarlaft.recordar(to.url.pathname + to.url.search);
	});

	function ponerFiltro<K extends keyof FiltrosSarlaft>(clave: K, valor: FiltrosSarlaft[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	/**
	 * Conteos por estado de la cabecera.
	 *
	 * Antes se contaban sobre `items`, que es SOLO la página visible (20
	 * registros), mientras «Total» era el del servidor: con 47 formularios la
	 * cabecera decía «Aprobados 12» cuando había 35. Ahora cada estado se
	 * pide al servidor con `limit: 1` (solo interesa su `total`), con la misma
	 * búsqueda y el mismo tipo que la lista. El estado no entra: el chip de
	 * cada estado es justamente el que filtra por él, y su cifra tiene que
	 * coincidir con lo que aparece al pulsarlo.
	 */
	const ESTADOS: EstadoSarlaft[] = [
		'recibido',
		'en_revision',
		'aprobado',
		'condicionado',
		'rechazado',
		'escalado'
	];
	let conteosEstado = $state<Record<string, number> | null>(null);
	const firmaConteos = $derived(`${filtros.q.trim()}|${filtros.tipo}`);

	let turnoConteos = 0;
	async function cargarConteos() {
		const turno = ++turnoConteos;
		const q = filtros.q.trim();
		const tipo = filtros.tipo;
		try {
			const totales = await Promise.all(
				ESTADOS.map((estado) =>
					sarlaftAPI
						.listar({
							page: 1,
							limit: 1,
							estado,
							...(q ? { search: q } : {}),
							...(tipo !== 'TODOS' ? { tipo_formulario: tipo as TipoFormularioSarlaft } : {})
						})
						.then((d) => d.pagination.total)
				)
			);
			if (turno !== turnoConteos) return;
			conteosEstado = Object.fromEntries(ESTADOS.map((e, i) => [e, totales[i]]));
		} catch {
			// Los conteos acompañan; si fallan, la lista sigue sirviendo y la
			// cabecera se queda con el total de la consulta.
			if (turno === turnoConteos) conteosEstado = null;
		}
	}

	$effect(() => {
		void firmaConteos;
		untrack(() => cargarConteos());
	});

	/// `condicionado` y `escalado` solo se muestran si hay alguno (o si son el
	/// filtro puesto): casi siempre están en cero y siete pastillas en la
	/// cabecera ya no se leen de un vistazo. `condicionado` va aparte de los
	/// aprobados a propósito: sumarlo inflaría la métrica de aprobación con
	/// casos sujetos a condiciones todavía no cumplidas.
	const conteos = $derived.by(() => {
		if (!conteosEstado) {
			return [{ clave: 'TODOS', etiqueta: 'Total', valor: pagination.total }];
		}
		const porEstado = conteosEstado;
		const total = ESTADOS.reduce((acc, e) => acc + (porEstado[e] ?? 0), 0);
		const ETIQUETAS: Record<EstadoSarlaft, string> = {
			recibido: 'Recibidos',
			en_revision: 'En revisión',
			aprobado: 'Aprobados',
			condicionado: 'Condicionados',
			rechazado: 'Rechazados',
			escalado: 'Escalados'
		};
		return [
			{ clave: 'TODOS', etiqueta: 'Total', valor: total },
			...ESTADOS.filter(
				(e) =>
					!['condicionado', 'escalado'].includes(e) ||
					(porEstado[e] ?? 0) > 0 ||
					filtros.estado === e
			).map((e) => ({
				clave: e,
				etiqueta: ETIQUETAS[e],
				valor: porEstado[e] ?? 0,
				color: ESTADO_LABELS[e].dot
			}))
		];
	});

	function filtrarPorConteo(clave: string) {
		ponerFiltro('estado', clave === 'TODOS' || filtros.estado === clave ? 'TODOS' : clave);
	}

	const SEGMENTOS_TIPO = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		{ valor: 'cliente_proveedor', etiqueta: 'Cliente/Prov.' },
		{ valor: 'accionistas', etiqueta: 'Accionistas' },
		{ valor: 'personal', etiqueta: 'Personal' },
		{ valor: 'autorizacion_propietario', etiqueta: 'Autoriz. propietario' },
		{ valor: 'declaracion_empresa_transporte', etiqueta: 'Declaración empresa de transporte' }
	];

	const SEGMENTOS_ESTADO = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		...ESTADOS.map((e) => ({
			valor: e,
			etiqueta: ESTADO_LABELS[e].label,
			punto: ESTADO_LABELS[e].dot
		}))
	];

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
		{
			id: 'documentos_count',
			accessorKey: 'documentos_count',
			header: 'Docs',
			enableSorting: false,
			size: 70
		},
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

	/// Turno de la última consulta: con filtros que cambian rápido, una
	/// respuesta lenta de antes podía llegar después y pisar la buena.
	let turnoLista = 0;

	async function load() {
		const turno = ++turnoLista;
		isLoading = true;
		error = null;
		try {
			const params: Parameters<typeof sarlaftAPI.listar>[0] & {
				orden?: string;
				direccion?: string;
			} = {
				page: filtros.pagina,
				limit: POR_PAGINA,
				orden: filtros.orden,
				direccion: filtros.direccion
			};
			if (filtros.q.trim()) params.search = filtros.q.trim();
			if (filtros.tipo !== 'TODOS') params.tipo_formulario = filtros.tipo as TipoFormularioSarlaft;
			if (filtros.estado !== 'TODOS') params.estado = filtros.estado as EstadoSarlaft;
			const data = await sarlaftAPI.listar(params);
			if (turno !== turnoLista) return;
			items = data.items;
			pagination = data.pagination;
		} catch (err: any) {
			if (turno !== turnoLista) return;
			const status = err?.response?.status;
			const msg = err?.response?.data?.error || err?.message || 'Error al cargar los formularios';
			error = status
				? `${msg} (HTTP ${status})`
				: `No se pudo conectar con el backend (${msg}). Verifica que VITE_API_URL en .env apunte al servidor correcto.`;
			toast.error(error);
		} finally {
			if (turno === turnoLista) {
				isLoading = false;
				cargadoUnaVez = true;
			}
		}
	}

	/// «Reintentar» repite las dos consultas: si falló la lista, lo normal es
	/// que los conteos fallaran con ella.
	function reintentar() {
		void load();
		void cargarConteos();
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
</script>

<svelte:head>
	<title>SARLAFT + PTEE · Cotransmeq</title>
</svelte:head>

<!-- Cáscara de los directorios (`dir-*` de app.css), la de flota y servicios. -->
<div class="dir-pagina sl-pagina" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, normas y conteos por estado ────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<span class="sl-eyebrow">Cumplimiento · SARLAFT + PTEE</span>
			<h1 class="dir-titulo">Formularios de conocimiento</h1>
			<p class="dir-desc sl-desc">
				Gestión, revisión y trazabilidad de los formularios radicados por clientes, proveedores,
				accionistas y personal vinculado a COTRANSMEQ S.A.S.
			</p>
			<div class="sl-normas" aria-label="Marco normativo">
				<span>Resolución 2328/2025</span>
				<span>Resolución 14673/2025</span>
				<span>Ley 1581/2012</span>
			</div>
			<div class="dir-conteos">
				<ResumenConteos
					{conteos}
					activo={conteosEstado && filtros.estado !== 'TODOS' ? filtros.estado : null}
					onElegir={conteosEstado ? filtrarPorConteo : undefined}
				/>
			</div>
		</div>
	</header>

	<!-- ── FILTROS A LA VISTA: buscador, tipo y estado ──────────── -->
	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(termino) => ponerFiltro('q', termino)}
				placeholder="Buscar por radicado, nombre, cédula o correo…"
				etiqueta="Buscar formularios SARLAFT"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Tipo"
			opciones={SEGMENTOS_TIPO}
			valor={filtros.tipo}
			onCambiar={(v) => ponerFiltro('tipo', v)}
		/>
		<SegmentosFiltro
			etiqueta="Estado"
			opciones={SEGMENTOS_ESTADO}
			valor={filtros.estado}
			onCambiar={(v) => ponerFiltro('estado', v)}
		/>
		{#if hasActiveFilter}
			<button type="button" class="btn-ghost sl-limpiar" onclick={limpiarFiltros}>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
				Limpiar
			</button>
		{/if}
	</div>

	<!-- ── LISTA ─────────────────────────────────────────────────── -->
	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
		{#if isLoading && !cargadoUnaVez}
			<div class="page-card sl-marco">
				<CargaMascota texto="Cargando formularios…" />
			</div>
		{:else if error && items.length === 0}
			{@const img = mascota('advertencia')}
			<div class="page-card sl-marco">
				<div class="dir-vacio">
					<img src={img.src} alt={img.alt} width="418" height="418" />
					<h3>No pudimos cargar el listado</h3>
					<p>{error}</p>
					<button type="button" class="btn-secondary" onclick={reintentar}>Reintentar</button>
				</div>
			</div>
		{:else}
			<TablaLista
				columnas={COLUMNAS}
				datos={items}
				claveFila={(f) => f.id}
				cargando={isLoading}
				orden={ordenTabla}
				onOrdenar={aplicarOrden}
				onFila={(f) => verDetalle(f.id)}
				etiqueta="Formularios SARLAFT recibidos"
			>
				{#snippet celda({ columnaId, fila, valor })}
					{#if columnaId === 'radicado'}
						<div class="sl-radicado">
							<span class="radicado-pill">{fila.radicado}</span>
							<span class="codigo-pill">{fila.codigo_formulario} · v{fila.version}</span>
						</div>
					{:else if columnaId === 'nombre_completo'}
						<div class="dir-celda">
							<span class="sl-nombre">{fila.nombre_completo ?? 'Sin nombre'}</span>
						</div>
					{:else if columnaId === 'tipo_formulario'}
						<span class="sl-tipo">{TIPO_FORMULARIO_LABELS[fila.tipo_formulario]}</span>
					{:else if columnaId === 'documento'}
						{#if fila.numero_documento}
							<span class="sl-tipo">{fila.tipo_documento ?? 'Doc'} {fila.numero_documento}</span>
						{:else}
							<span class="dir-nulo">—</span>
						{/if}
					{:else if columnaId === 'contacto'}
						<div class="dir-celda sl-apilado">
							<span>{fila.correo ?? '—'}</span>
							{#if fila.telefono}<small>{fila.telefono}</small>{/if}
						</div>
					{:else if columnaId === 'documentos_count'}
						{#if fila.documentos_count > 0}
							<span class="sl-docs">{fila.documentos_count}</span>
						{:else}
							<span class="dir-nulo">—</span>
						{/if}
					{:else if columnaId === 'estado'}
						{@const e = ESTADO_LABELS[fila.estado]}
						<EstadoPunto etiqueta={e.label} color={e.color} />
					{:else if columnaId === 'fecha_envio'}
						<div class="dir-celda dir-celda--fecha sl-apilado">
							<span>{formatFechaCorta(fila.fecha_envio)}</span>
							<small>{tiempoRelativo(fila.fecha_envio)}</small>
						</div>
					{:else}
						{valor ?? ''}
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota('vacio')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>No hay formularios</h3>
						<p>
							{hasActiveFilter
								? 'No se encontraron formularios con los filtros aplicados.'
								: 'Cuando alguien diligencie un formulario público aparecerá aquí para tu revisión.'}
						</p>
						{#if hasActiveFilter}
							<button type="button" class="btn-secondary" onclick={limpiarFiltros}>
								Limpiar filtros
							</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>

			<!-- Fuera del marco de la tabla, por eso `suelto`. Se pinta solo
			     cuando hay total; con una página fuera de rango sigue a la vista
			     para poder volver. -->
			<PaginadorLista
				pagina={filtros.pagina}
				total={pagination.total}
				porPagina={POR_PAGINA}
				cargando={isLoading}
				nombreItems="formularios"
				suelto
				onCambiar={irAPagina}
			/>
		{/if}
	</div>
</div>

<style>
	/* La página crece con la tabla y desplaza entera, como servicios: con el
	   `height: 100%` de `.dir-pagina` la lista quedaba con scroll propio y, en
	   móvil, la cabecera y los dos filtros se comían casi toda la altura. */
	.sl-pagina {
		height: auto;
		min-height: 100%;
	}

	.sl-eyebrow {
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--emerald-500);
	}
	/* Texto corrido: el tope es de legibilidad, no de página (skill de diseño). */
	.sl-desc {
		max-width: 44rem;
		line-height: 1.55;
	}
	.sl-normas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.15rem;
	}
	.sl-normas span {
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
	}

	.sl-limpiar {
		padding: 0.45rem 0.25rem;
	}

	/* Marco de la carga y del error: la misma caja que la tabla, para que al
	   llegar los datos no cambie la silueta de la página. */
	.sl-marco {
		padding: 0;
	}

	/* ── Celdas ─────────────────────────────────────────────────── */
	.sl-radicado {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
	}
	.radicado-pill {
		display: inline-flex;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--emerald-700);
		background: var(--au-tint);
		padding: 0.18rem 0.55rem;
		border-radius: 6px;
		letter-spacing: 0.04em;
		/* Un radicado partido en cuatro renglones deja de ser un identificador
		   legible y dispara la altura de la fila. Si no cabe, que la tabla
		   desplace en horizontal: para eso tiene su propio contenedor. */
		white-space: nowrap;
	}
	.codigo-pill {
		display: inline-flex;
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg-base);
		padding: 0.15rem 0.45rem;
		border-radius: 5px;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.sl-nombre {
		font-weight: 700;
	}
	.sl-tipo {
		font-size: 0.8rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.sl-docs {
		font-weight: 700;
		color: var(--text-primary);
	}
	/* Correo y teléfono apilados: en una sola línea el correo obliga a una
	   columna larguísima y empuja el resto de la tabla al scroll horizontal. */
	.sl-apilado span,
	.sl-apilado small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
