<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { clientesAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import { mascota } from '$lib/mascot';
	import { Eye, Trash2 } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { page } from '$app/state';
	import { crearListingStore } from '$lib/listing/listingStore';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		contarActivos,
		firma,
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';

	// ── Permisos ──────────────────────────────────────────────────────
	// `Consulta` (`read`) entra a la pantalla pero no escribe. Se lee
	// `$authStore` a propósito para que el derived se recalcule cuando la
	// sesión termine de hidratarse. El backend aplica lo mismo sobre las
	// rutas de escritura de `clientes`; esto sólo evita ofrecer un botón
	// que iba a devolver 403.
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('clientes') === 'full'
	);

	const TipoCliente = {
		EMPRESA: 'EMPRESA',
		PERSONA_NATURAL: 'PERSONA_NATURAL'
	} as const;

	type TipoCliente = (typeof TipoCliente)[keyof typeof TipoCliente];

	interface Cliente {
		id: string;
		nit: string;
		nombre: string;
		representante: string | null;
		cedula: string | null;
		telefono: string;
		direccion: string;
		correo: string | null;
		requiere_osi: boolean;
		paga_recargos: boolean;
		tipo: TipoCliente;
		createdAt: string;
		updatedAt: string;
		deletedAt?: string | null;
	}

	/**
	 * Filtros de la página.
	 *
	 * A diferencia de flota, aquí TODO se resuelve en servidor: el endpoint ya
	 * acepta `search`, `tipo`, `page` y `limit`. Por eso la firma de caché los
	 * incluye a todos —cambiar cualquiera implica pedir otra cosa— y la
	 * búsqueda va con retardo, para no lanzar una petición por letra.
	 */
	interface FiltrosClientes {
		q: string;
		tipo: string;
		/** `activos` | `ocultos`. */
		vista: string;
		pagina: number;
	}

	const POR_PAGINA = 20;

	const DEFS: DefinicionesFiltros<FiltrosClientes> = {
		q: texto(),
		tipo: opcion('TODOS'),
		vista: opcion('activos'),
		pagina: numero(1)
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	const listaClientes = crearListingStore<Cliente>();

	let filtros = $state<FiltrosClientes>(estadoUrl.leer(page.url));
	let mostrarFiltros = $state(false);

	let showDeleteModal = $state(false);
	let clienteToDelete = $state<Cliente | null>(null);

	// Estados para modo selección
	let clientesSeleccionados = $state(new Set<string>());
	let ultimoSeleccionadoIndex: number | null = null;
	let shiftPressed = $state(false);
	let procesandoMasivo = $state(false);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = true;
	}

	function handleKeyup(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = false;
	}

	function toggleSeleccion(id: string, index: number, event: MouseEvent | TouchEvent | any) {
		if (event.shiftKey && ultimoSeleccionadoIndex !== null) {
			const start = Math.min(ultimoSeleccionadoIndex, index);
			const end = Math.max(ultimoSeleccionadoIndex, index);

			const idsInRange = clientes.slice(start, end + 1).map((c) => c.id);
			const someNotSelected = idsInRange.some((id) => !clientesSeleccionados.has(id));

			if (someNotSelected) {
				idsInRange.forEach((id) => clientesSeleccionados.add(id));
			} else {
				idsInRange.forEach((id) => clientesSeleccionados.delete(id));
			}
		} else {
			if (clientesSeleccionados.has(id)) {
				clientesSeleccionados.delete(id);
			} else {
				clientesSeleccionados.add(id);
			}
			ultimoSeleccionadoIndex = index;
		}
		clientesSeleccionados = clientesSeleccionados;
	}

	function toggleSeleccionarTodo() {
		if (clientesSeleccionados.size === clientes.length && clientes.length > 0) {
			clientesSeleccionados.clear();
		} else {
			clientes.forEach((c) => clientesSeleccionados.add(c.id));
		}
		clientesSeleccionados = clientesSeleccionados;
	}

	async function ejecutarAccionMasiva(accion: 'ocultar' | 'mostrar' | 'eliminar') {
		if (clientesSeleccionados.size === 0) return;

		const ids = Array.from(clientesSeleccionados);
		procesandoMasivo = true;

		try {
			/// Por `apiClient` y no por `fetch`: además de la clave de token
			/// correcta, trae reintento, deduplicación y manejo del 401.
			const respuesta = await clientesAPI.operacionesMasivas(ids, accion);
			const data = respuesta.data;
			if (data.success) {
				toast.success(data.message);
				clientesSeleccionados.clear();
				clientesSeleccionados = clientesSeleccionados;
				cargar(true);
			} else {
				toast.error(data.message || 'Error al ejecutar acción masiva');
			}
		} catch (err) {
			toast.error('Error de conexión al ejecutar acción masiva');
		} finally {
			procesandoMasivo = false;
		}
	}

	const isAdmin = $derived($authStore.user?.rol === 'admin' || $authStore.user?.role === 'admin');
	const isOperaciones = $derived($authStore.user?.area?.includes('operaciones'));
	const isTalentoHumano = $derived($authStore.user?.area?.includes('talento_humano'));
	const canAccessSpecialViews = $derived(isAdmin || isOperaciones || isTalentoHumano);

	// Filtros activos (para chips removibles)
	const TIPO_LABELS: Record<string, string> = {
		EMPRESA: 'Empresa',
		PERSONA_NATURAL: 'Persona Natural'
	};
	const activeFilters = $derived([
		...(filtros.tipo !== 'TODOS'
			? [{ key: 'tipo', label: 'Tipo', value: TIPO_LABELS[filtros.tipo] ?? filtros.tipo }]
			: []),
		...(filtros.vista === 'ocultos'
			? [{ key: 'vista', label: 'Visibilidad', value: 'Ocultos' }]
			: []),
		...(filtros.q.trim() ? [{ key: 'q', label: 'Búsqueda', value: `"${filtros.q.trim()}"` }] : [])
	]);

	/// La página no cuenta como filtro y la búsqueda tiene su propio campo.
	const numFiltrosActivos = $derived(contarActivos(DEFS, filtros, ['q', 'pagina']));

	function clearFilter(key: string) {
		ponerFiltro(
			key as keyof FiltrosClientes,
			DEFS[key as keyof FiltrosClientes].porDefecto as never
		);
	}

	const clientes = $derived($listaClientes._?.items ?? []);
	const isLoading = $derived($listaClientes._?.cargando ?? false);
	const error = $derived($listaClientes._?.error || null);
	const totalClientes = $derived($listaClientes._?.total ?? 0);

	const stats = $derived({
		total: totalClientes || clientes.length,
		empresas: clientes.filter((c) => c.tipo === TipoCliente.EMPRESA).length,
		personas: clientes.filter((c) => c.tipo === TipoCliente.PERSONA_NATURAL).length,
		conOSI: clientes.filter((c) => c.requiere_osi).length,
		conRecargos: clientes.filter((c) => c.paga_recargos).length
	});

	/**
	 * Trae una página del servidor.
	 *
	 * La rama de ocultos usaba `fetch` crudo sin pasar `search`, `tipo` ni
	 * `page`, y luego forzaba `pages = 1`: al activar «Ver ocultos» se perdían
	 * en silencio la búsqueda, el filtro de tipo y la paginación entera. Ahora
	 * las dos ramas mandan lo mismo.
	 */
	async function traerClientes(): Promise<{ items: Cliente[]; total: number }> {
		const params = {
			page: filtros.pagina,
			limit: POR_PAGINA,
			search: filtros.q.trim() || undefined,
			tipo: filtros.tipo !== 'TODOS' ? filtros.tipo : undefined
		};

		const res =
			filtros.vista === 'ocultos'
				? await clientesAPI.getOcultos(params)
				: await clientesAPI.getAll(params);

		const cuerpo = res.data ?? {};
		const items: Cliente[] = cuerpo.data ?? (Array.isArray(cuerpo) ? cuerpo : []);
		return { items, total: cuerpo.pagination?.total ?? items.length };
	}

	/// Aquí sí entran todos los filtros: cualquiera de ellos cambia lo que el
	/// servidor devuelve, así que la caché de una combinación no vale para otra.
	const firmaDatos = $derived(firma(DEFS, filtros));

	async function cargar(forzar = false) {
		if (forzar) listaClientes.invalidar();
		await listaClientes.cargar(firmaDatos, traerClientes);
	}

	function limpiarFiltros() {
		filtros = limpiarFiltrosDe(DEFS, filtros);
	}

	function irPagina(pagina: number) {
		filtros = { ...filtros, pagina };
	}

	/**
	 * Cambia un filtro y vuelve a la primera página.
	 *
	 * Sin esto, filtrar estando en la página 7 de un listado que pasa a tener
	 * 2 deja una tabla vacía sin explicación.
	 */
	function ponerFiltro<K extends keyof FiltrosClientes>(clave: K, valor: FiltrosClientes[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	function openDeleteModal(cliente: Cliente) {
		clienteToDelete = cliente;
		showDeleteModal = true;
	}

	async function confirmDelete() {
		if (!clienteToDelete) return;
		try {
			await fetch(`${import.meta.env.VITE_API_URL}/api/clientes/${clienteToDelete.id}`, {
				method: 'DELETE'
			});
			toast.success('Cliente eliminado');
			showDeleteModal = false;
			cargar(true);
		} catch (err) {
			toast.error('Error al eliminar');
		}
	}

	const COLUMNAS: ColumnDef<Cliente, any>[] = [
		{ id: 'cliente', header: 'Cliente', accessorKey: 'nombre', enableSorting: false },
		{ id: 'tipo', header: 'Tipo', accessorKey: 'tipo', enableSorting: false, size: 170 },
		{ id: 'contacto', header: 'Contacto', enableSorting: false },
		{ id: 'condiciones', header: 'Condiciones', enableSorting: false, size: 190 },
		{ id: 'acciones', header: '', enableSorting: false, size: 110 }
	];

	const SEGMENTOS_TIPO = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		{ valor: TipoCliente.EMPRESA, etiqueta: 'Empresas', punto: '#3b82f6' },
		{ valor: TipoCliente.PERSONA_NATURAL, etiqueta: 'Personas', punto: '#16a34a' }
	];

	const conteos = $derived([
		{ clave: 'TODOS', etiqueta: 'Total', valor: stats.total },
		{ clave: TipoCliente.EMPRESA, etiqueta: 'Empresas', valor: stats.empresas, color: '#3b82f6' },
		{
			clave: TipoCliente.PERSONA_NATURAL,
			etiqueta: 'Personas',
			valor: stats.personas,
			color: '#16a34a'
		},
		{ clave: 'osi', etiqueta: 'Con OSI', valor: stats.conOSI, color: '#f59e0b' },
		{ clave: 'recargos', etiqueta: 'Pagan recargos', valor: stats.conRecargos, color: '#a855f7' }
	]);

	function filtrarPorConteo(clave: string) {
		if (clave === 'osi' || clave === 'recargos') return;
		ponerFiltro('tipo', filtros.tipo === clave ? 'TODOS' : clave);
	}

	function getTipoColor(tipo: string) {
		return tipo === TipoCliente.EMPRESA ? '#3b82f6' : '#16a34a';
	}

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	$effect(() => {
		void firmaDatos;
		void cargar();
	});

	/**
	 * Corrige una página que se quedó fuera de rango.
	 *
	 * Pasa al abrir un enlace guardado cuya página ya no existe —porque el
	 * filtro devuelve menos resultados que entonces, o porque se borraron
	 * registros—. Sin esto se ve una lista vacía sin ninguna explicación, que
	 * parece un error de la aplicación.
	 */
	$effect(() => {
		const ultima = Math.max(1, Math.ceil(totalClientes / POR_PAGINA));
		if (!isLoading && totalClientes > 0 && filtros.pagina > ultima) {
			filtros = { ...filtros, pagina: ultima };
		}
	});

	onMount(() => {
		/// Estos tres eventos no existían en el backend hasta ahora: el módulo
		/// emitía `cliente:oculto` y `clientes:actualizacion-masiva`, así que
		/// crear o editar un cliente no le llegaba a nadie más.
		const bajas = [
			socketUtils.on('cliente:created', () => cargar(true)),
			socketUtils.on('cliente:updated', () => cargar(true)),
			socketUtils.on('cliente:deleted', () => cargar(true))
		];

		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('keyup', handleKeyup);

		return () => {
			for (const baja of bajas) baja();
		};
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('keyup', handleKeyup);
	});
</script>

<svelte:head>
	<title>Clientes — Cotransmeq</title>
</svelte:head>

<div class="dir-pagina {shiftPressed ? 'select-none' : ''}" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, conteos y acciones ─────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Clientes</h1>
			<p class="dir-desc">Administra toda la información de los clientes registrados.</p>
			<div class="dir-conteos">
				<ResumenConteos
					{conteos}
					activo={filtros.tipo === 'TODOS' ? null : filtros.tipo}
					onElegir={filtrarPorConteo}
				/>
			</div>
		</div>

		<div class="dir-cabecera-acciones">
			{#if canAccessSpecialViews}
				<button
					onclick={() => ponerFiltro('vista', filtros.vista === 'ocultos' ? 'activos' : 'ocultos')}
					title={filtros.vista === 'ocultos' ? 'Ver activos' : 'Ver ocultos'}
					class="btn-icon"
					style="border-color: {filtros.vista === 'ocultos'
						? 'var(--emerald-500)'
						: 'var(--border-default)'}; background-color: {filtros.vista === 'ocultos'
						? 'var(--au-tint)'
						: 'white'}; color: {filtros.vista === 'ocultos'
						? 'var(--emerald-800)'
						: 'var(--text-muted)'};"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
						/>
					</svg>
				</button>
			{/if}

			<button
				onclick={() => (mostrarFiltros = !mostrarFiltros)}
				class="btn-secondary"
				style="border-color: {mostrarFiltros
					? 'var(--emerald-500)'
					: 'var(--border-default)'}; color: {mostrarFiltros
					? 'var(--emerald-800)'
					: 'var(--text-secondary)'}; background-color: {mostrarFiltros
					? 'var(--au-tint)'
					: 'white'};"
			>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				Filtros
				{#if numFiltrosActivos > 0}
					<span
						class="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
						style="background-color: var(--emerald-500);">!</span
					>
				{/if}
			</button>

			{#if puedeEditar}
				<button onclick={() => goto('/dashboard/clientes/agregar')} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Nuevo cliente
				</button>
			{/if}
		</div>

		<!-- Panel de filtros (drawer lateral) — siempre montado para que las
		     animaciones de entrada Y salida del FilterDrawer se ejecuten -->
		<FilterDrawer
			open={mostrarFiltros}
			onClose={() => (mostrarFiltros = false)}
			eyebrow="Filtros"
			title="Refinar resultados"
			subtitle="Filtra la cartera de clientes por tipo o palabra clave."
			activeCount={activeFilters.length}
		>
			<div slot="chips" class="flex flex-wrap gap-1.5">
				{#each activeFilters as chip, i (chip.key)}
					<span class="chip-pop-in" style="animation-delay: {i * 60}ms">
						<button class="filter-chip" onclick={() => clearFilter(chip.key)}>
							<span style="color: var(--text-muted); font-weight: 500;">{chip.label}:</span>
							<span>{chip.value}</span>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
						</button>
					</span>
				{/each}
			</div>

			<div class="flex flex-col gap-5">
				<div class="filter-field">
					<label for="filtro-tipo" class="filter-field-label">
						Tipo de cliente
						{#if filtros.tipo !== 'TODOS'}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select
						id="filtro-tipo"
						value={filtros.tipo}
						onchange={(e) => ponerFiltro('tipo', e.currentTarget.value)}
					>
						<option value="TODOS">Todos los tipos</option>
						<option value={TipoCliente.EMPRESA}>Empresa</option>
						<option value={TipoCliente.PERSONA_NATURAL}>Persona Natural</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-visibilidad" class="filter-field-label">
						Visibilidad
						{#if filtros.vista !== 'activos'}<span class="filter-field-label-hint">filtrado</span
							>{/if}
					</label>
					<select
						id="filtro-visibilidad"
						value={filtros.vista}
						onchange={(e) => ponerFiltro('vista', e.currentTarget.value)}
					>
						<option value="activos">Activos</option>
						<option value="ocultos" disabled={!canAccessSpecialViews}>Solo ocultos</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-busqueda" class="filter-field-label">
						Búsqueda por nombre, NIT o correo
						{#if filtros.q.trim()}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<BuscadorLista
						valor={filtros.q}
						onBuscar={(termino) => ponerFiltro('q', termino)}
						placeholder="Ej. Transportes Norte, 900.123.456…"
						etiqueta="Buscar clientes por nombre, NIT o correo"
					/>
				</div>
			</div>

			<div slot="footer">
				<button class="filter-clear" onclick={limpiarFiltros} disabled={activeFilters.length === 0}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
					Limpiar
				</button>
				<button class="btn-primary" onclick={() => (mostrarFiltros = false)}>
					Ver resultados
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7l7 7-7 7" /></svg
					>
				</button>
			</div>
		</FilterDrawer>
	</header>

	<!-- ── FILTROS A LA VISTA: buscador + tipo ───────────────── -->
	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(termino) => ponerFiltro('q', termino)}
				placeholder="Nombre, NIT, representante o correo…"
				etiqueta="Buscar clientes"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Tipo"
			opciones={SEGMENTOS_TIPO}
			valor={filtros.tipo}
			onCambiar={(v) => ponerFiltro('tipo', v)}
		/>
	</div>

	<!-- ── LISTA ─────────────────────────────────────────────── -->
	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
		<div class="dir-lista-scroll">
			<TablaLista
				columnas={COLUMNAS}
				datos={clientes}
				claveFila={(c) => c.id}
				cargando={isLoading}
				onFila={(c) => goto(`/dashboard/clientes/${c.id}`)}
				etiqueta="Clientes registrados"
			>
				{#snippet celda({ columnaId, fila: c })}
					{#if columnaId === 'cliente'}
						<div class="flex items-center">
							<span class="dir-check">
								<input
									type="checkbox"
									checked={clientesSeleccionados.has(c.id)}
									onclick={(e) => {
										e.stopPropagation();
										toggleSeleccion(c.id, clientes.indexOf(c), e);
									}}
									aria-label="Seleccionar {c.nombre}"
								/>
							</span>
							<CeldaIdentidad
								titulo={c.nombre}
								subtitulo={c.nit ? `NIT ${c.nit}` : undefined}
								tono={getTipoColor(c.tipo)}
							/>
						</div>
					{:else if columnaId === 'tipo'}
						<div class="dir-celda">
							<span>{c.tipo === TipoCliente.EMPRESA ? 'Empresa' : 'Persona natural'}</span>
							{#if c.representante}<small>{c.representante}</small>{/if}
						</div>
					{:else if columnaId === 'contacto'}
						<div class="dir-celda">
							{#if c.telefono}<span>{c.telefono}</span>{:else}<span class="dir-nulo"
									>Sin teléfono</span
								>{/if}
							{#if c.correo}<small>{c.correo}</small>{/if}
						</div>
					{:else if columnaId === 'condiciones'}
						{#if c.requiere_osi || c.paga_recargos}
							<div class="dir-celda">
								{#if c.requiere_osi}<span>Requiere OSI</span>{/if}
								{#if c.paga_recargos}<span>Paga recargos</span>{/if}
							</div>
						{:else}
							<span class="dir-nulo">—</span>
						{/if}
					{:else if columnaId === 'acciones'}
						<AccionesFila
							acciones={[
								{
									id: 'ver',
									etiqueta: 'Ver detalle',
									icono: Eye,
									onClick: () => goto(`/dashboard/clientes/${c.id}`)
								},
								{
									id: 'eliminar',
									etiqueta: 'Eliminar',
									icono: Trash2,
									onClick: () => openDeleteModal(c),
									peligrosa: true,
									oculta: !puedeEditar
								}
							]}
						/>
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota('vacio')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>No hay clientes</h3>
						<p>
							{activeFilters.length
								? 'No se encontraron clientes con los filtros aplicados.'
								: 'Registra el primer cliente para verlo aquí.'}
						</p>
						{#if activeFilters.length}
							<button onclick={limpiarFiltros} class="btn-secondary">Limpiar filtros</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>

		<PaginadorLista
			pagina={filtros.pagina}
			total={totalClientes}
			porPagina={POR_PAGINA}
			cargando={isLoading}
			nombreItems="clientes"
			onCambiar={irPagina}
		/>
	</div>

	<!-- Bulk Actions Bar — fondo charcoal profundo (no glass) -->
	{#if clientesSeleccionados.size > 0}
		<div class="bulk-actions-container">
			<div
				class="flex items-center gap-4 rounded-2xl p-2.5 shadow-2xl"
				style="background-color: var(--bg-charcoal); border: 1px solid rgba(255,255,255,0.08); color: white;"
				in:scale={{ duration: 300, start: 0.9 }}
			>
				<span
					class="px-2 text-xs font-medium"
					style="border-right: 1px solid rgba(255,255,255,0.15);"
				>
					{clientesSeleccionados.size} seleccionados
				</span>
				<div class="flex gap-1.5">
					{#if puedeEditar}
						<button
							onclick={() => ejecutarAccionMasiva('ocultar')}
							disabled={procesandoMasivo}
							class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
							style="background-color: rgba(255,255,255,0.08);"
						>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
								/>
							</svg>
							Ocultar
						</button>
					{/if}
					{#if puedeEditar}
						<button
							onclick={() => ejecutarAccionMasiva('eliminar')}
							disabled={procesandoMasivo}
							class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
							style="background-color: rgba(220,38,38,0.85);"
						>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							Papelera
						</button>
					{/if}
				</div>
				<button
					onclick={() => {
						clientesSeleccionados.clear();
						clientesSeleccionados = clientesSeleccionados;
					}}
					class="apple-transition ml-2"
					style="color: rgba(255,255,255,0.5);"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>
	{/if}
</div>

{#if showDeleteModal && clienteToDelete}
	<!-- Backdrop con blur (paleta landing) -->
	<button
		type="button"
		class="fixed inset-0 z-50 cursor-default border-0 p-0"
		style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.40), rgba(20, 83, 45, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
		aria-label="Cerrar modal"
		onclick={() => (showDeleteModal = false)}
	></button>

	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		onkeydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-sm overflow-hidden"
			style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18); padding: 1.5rem;"
			in:scale={{ duration: 200, start: 0.95 }}
		>
			<div class="mb-4 flex items-center gap-3">
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
					style="background-color: rgba(220, 38, 38, 0.08);"
				>
					<svg
						class="h-5 w-5"
						style="color: #dc2626;"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<div>
					<h2 class="text-base font-bold" style="color: var(--text-primary);">
						¿Eliminar cliente?
					</h2>
					<p class="mt-0.5 text-xs" style="color: var(--text-muted);">
						Esta acción no se puede deshacer
					</p>
				</div>
			</div>
			<p class="mb-5 text-sm" style="color: var(--text-secondary);">
				Se eliminará a <span class="font-semibold" style="color: var(--text-primary);"
					>{clienteToDelete.nombre}</span
				>
				del sistema.
			</p>
			<div class="flex gap-2">
				<button
					onclick={() => (showDeleteModal = false)}
					class="btn-secondary flex-1"
					style="justify-content: center;"
				>
					Cancelar
				</button>
				{#if puedeEditar}
					<button
						onclick={confirmDelete}
						class="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white"
						style="background-color: #dc2626;"
					>
						Eliminar
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* .page-card, .stat-card, .table-card, .list-card, .brand-gradient, .btn-primary,
	   .btn-secondary, .btn-icon, .spinner, .filter-field, .filter-chip, .filter-clear,
	   .bulk-actions-container y .confirm-card ya están definidos en app.css con la
	   nueva paleta editorial. Solo conservamos animaciones específicas si las hubiera. */
</style>
