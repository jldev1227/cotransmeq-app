<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import ModalFormVehiculo from '$lib/components/vehiculos/ModalFormVehiculo.svelte';
	import ModalConfirmDelete from '$lib/components/vehiculos/ModalConfirmDelete.svelte';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import { mascota } from '$lib/mascot';
	import { Pencil, Trash2 } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { page } from '$app/state';
	import { crearListingStore } from '$lib/listing/listingStore';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { coincide } from '$lib/listing/texto';
	import {
		contarActivos,
		firma,
		limpiar as limpiarFiltrosDe,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';

	interface Vehiculo {
		id: string;
		placa: string;
		marca: string;
		modelo: string;
		linea?: string;
		color?: string;
		estado: string;
		clase_vehiculo?: string;
		conductor_id?: string | null;
		conductores?: { id: string; nombre: string; apellido: string } | null;
		created_at?: string;
		oculto?: boolean;
	}

	/**
	 * Filtros de la página, declarados una vez.
	 *
	 * Viven en la URL: así una vista filtrada se puede pegar en un chat, el
	 * botón de atrás deshace el último filtro y recargar no pierde nada. Antes
	 * esta página no tocaba `searchParams` en absoluto.
	 */
	interface FiltrosFlota {
		q: string;
		estado: string;
		/** `activos` | `ocultos` | `papelera`: cada una pega a un endpoint. */
		vista: string;
	}

	// ── Permisos ──────────────────────────────────────────────────────
	// `Consulta` (`read`) entra a la pantalla pero no escribe. Se lee
	// `$authStore` a propósito para que el derived se recalcule cuando la
	// sesión termine de hidratarse. El backend aplica lo mismo sobre las
	// rutas de escritura de `flota`; esto sólo evita ofrecer un botón
	// que iba a devolver 403.
	const puedeEditar = $derived(!!$authStore.user && authStore.getAccessLevel('flota') === 'full');

	const DEFS: DefinicionesFiltros<FiltrosFlota> = {
		q: texto(),
		estado: opcion('todos'),
		vista: opcion('activos')
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	const listaVehiculos = crearListingStore<Vehiculo>();

	let filtros = $state<FiltrosFlota>(estadoUrl.leer(page.url));
	let mostrarFiltros = $state(false);

	let isModalOpen = $state(false);
	let selectedVehiculoId = $state<string | null>(null);
	let isDeleteModalOpen = $state(false);
	let vehiculoToDelete = $state<Vehiculo | null>(null);

	// Estados para modo selección
	let vehiculosSeleccionados = $state(new Set<string>());
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

			const idsInRange = vehiculos.slice(start, end + 1).map((v) => v.id);
			const someNotSelected = idsInRange.some((id) => !vehiculosSeleccionados.has(id));

			if (someNotSelected) {
				idsInRange.forEach((id) => vehiculosSeleccionados.add(id));
			} else {
				idsInRange.forEach((id) => vehiculosSeleccionados.delete(id));
			}
		} else {
			if (vehiculosSeleccionados.has(id)) {
				vehiculosSeleccionados.delete(id);
			} else {
				vehiculosSeleccionados.add(id);
			}
			ultimoSeleccionadoIndex = index;
		}
		vehiculosSeleccionados = vehiculosSeleccionados;
	}

	function toggleSeleccionarTodo() {
		if (vehiculosSeleccionados.size === vehiculos.length && vehiculos.length > 0) {
			vehiculosSeleccionados.clear();
		} else {
			vehiculos.forEach((v) => vehiculosSeleccionados.add(v.id));
		}
		vehiculosSeleccionados = vehiculosSeleccionados;
	}

	async function ejecutarAccionMasiva(accion: 'ocultar' | 'mostrar' | 'eliminar' | 'restaurar') {
		if (vehiculosSeleccionados.size === 0) return;

		const ids = Array.from(vehiculosSeleccionados);
		procesandoMasivo = true;

		try {
			/// Por `apiClient` y no por `fetch`: además de la clave de token
			/// correcta, trae reintento, deduplicación y manejo del 401.
			const respuesta = await vehiculosAPI.operacionesMasivas(ids, accion);
			const data = respuesta.data;
			if (data.success) {
				toast.success(data.message);
				vehiculosSeleccionados.clear();
				vehiculosSeleccionados = vehiculosSeleccionados;
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

	// Filtros activos (para chips removibles) — solo los distintos del default
	const ESTADOS_LABELS: Record<string, string> = {
		disponible: 'Disponible',
		servicio: 'En Servicio',
		mantenimiento: 'Mantenimiento',
		inactivo: 'Inactivo'
	};
	const VISTAS_LABELS: Record<string, string> = {
		ocultos: 'Ocultos',
		papelera: 'Papelera'
	};

	const activeFilters = $derived([
		...(filtros.estado !== 'todos'
			? [
					{
						key: 'estado',
						label: 'Estado',
						value: ESTADOS_LABELS[filtros.estado] ?? filtros.estado
					}
				]
			: []),
		...(filtros.vista !== 'activos'
			? [{ key: 'vista', label: 'Visibilidad', value: VISTAS_LABELS[filtros.vista] }]
			: []),
		...(filtros.q.trim() ? [{ key: 'q', label: 'Búsqueda', value: `"${filtros.q.trim()}"` }] : [])
	]);

	/// El contador del panel no cuenta la búsqueda: tiene su propio campo a la
	/// vista y sumarla haría parecer que hay un filtro escondido.
	const numFiltrosActivos = $derived(contarActivos(DEFS, filtros, ['q']));

	function clearFilter(key: string) {
		filtros = { ...filtros, [key]: DEFS[key as keyof FiltrosFlota].porDefecto };
	}

	/**
	 * Lo que hay cargado del servidor, sin filtrar en cliente.
	 *
	 * `?? []` porque el store devuelve `null` mientras no ha habido ninguna
	 * carga correcta, que es distinto de «cargado y vacío».
	 */
	const vehiculos = $derived($listaVehiculos._?.items ?? []);
	const isLoading = $derived($listaVehiculos._?.cargando ?? false);
	const error = $derived($listaVehiculos._?.error || null);

	/**
	 * Lo que se pinta: búsqueda y estado se aplican aquí, en memoria.
	 *
	 * La búsqueda de esta página NO funcionaba: `handleSearch` disparaba un
	 * refetch tras 400 ms, pero ni `loadVehiculos` usaba el término ni
	 * `vehiculosAPI.getAll` aceptaba parámetros. Teclear en el buscador
	 * recargaba la misma lista completa una y otra vez.
	 */
	const vehiculosVisibles = $derived(
		vehiculos.filter((v) => {
			if (filtros.estado !== 'todos') {
				const suyo = (v.estado ?? '').toUpperCase();
				const buscado = filtros.estado.toUpperCase();
				const equivalentes =
					buscado === 'DISPONIBLE'
						? ['DISPONIBLE', 'ACTIVO']
						: [buscado, buscado.replace('_', ' ')];
				if (!equivalentes.includes(suyo)) return false;
			}
			return coincide(filtros.q, [
				v.placa,
				v.marca,
				v.modelo,
				v.linea,
				v.color,
				v.clase_vehiculo,
				v.conductores ? `${v.conductores.nombre} ${v.conductores.apellido}` : ''
			]);
		})
	);

	/// Las tarjetas de resumen cuentan sobre TODO lo cargado, no sobre lo
	/// filtrado: son el estado de la flota, no del filtro puesto.
	const stats = $derived({
		total: vehiculos.length,
		disponible: vehiculos.filter((v) => ['DISPONIBLE', 'ACTIVO'].includes(v.estado?.toUpperCase()))
			.length,
		servicio: vehiculos.filter((v) => v.estado?.toUpperCase() === 'SERVICIO').length,
		mantenimiento: vehiculos.filter((v) => v.estado?.toUpperCase() === 'MANTENIMIENTO').length,
		inactivo: vehiculos.filter((v) => v.estado?.toUpperCase() === 'INACTIVO').length,
		noDisponible: vehiculos.filter((v) =>
			['NO_DISPONIBLE', 'NO DISPONIBLE'].includes(v.estado?.toUpperCase())
		).length
	});

	/**
	 * Trae la lista del servidor.
	 *
	 * Solo la VISTA cambia de endpoint; la búsqueda y el estado se resuelven en
	 * cliente, porque la flota es un catálogo acotado y traerla entera una vez
	 * es más rápido que ir al servidor con cada tecla. Si algún día crece, se
	 * cambia esta función por una que mande los filtros y el resto de la página
	 * sigue igual: ese es el motivo de que la firma incluya todos los filtros.
	 */
	async function traerVehiculos(): Promise<{ items: Vehiculo[] }> {
		if (filtros.vista === 'papelera') {
			const res = await vehiculosAPI.getDeleted();
			return { items: res.data.data || [] };
		}

		if (filtros.vista === 'ocultos') {
			const res = await vehiculosAPI.getOcultos();
			return { items: res.data?.data || res.data || [] };
		}

		const res = await vehiculosAPI.getAll();
		return { items: res.data?.data || res.data || [] };
	}

	/**
	 * Firma de caché.
	 *
	 * Solo entra `vista`: es lo único que cambia lo que pide el servidor. Si
	 * `q` o `estado` entraran aquí, escribir en el buscador invalidaría la
	 * caché y provocaría una petición por letra, que es justo lo que se evita
	 * filtrando en cliente.
	 */
	const firmaDatos = $derived(firma(DEFS, { ...filtros, q: '', estado: 'todos' }));

	async function cargar(forzar = false) {
		if (forzar) listaVehiculos.invalidar();
		await listaVehiculos.cargar(firmaDatos, traerVehiculos);
	}

	function limpiarFiltros() {
		filtros = limpiarFiltrosDe(DEFS, filtros);
	}

	function getStatusColor(estado: string) {
		switch (estado?.toUpperCase()) {
			case 'DISPONIBLE':
			case 'ACTIVO':
				return '#16a34a';
			case 'SERVICIO':
				return '#8b5cf6';
			case 'MANTENIMIENTO':
				return '#f59e0b';
			case 'INACTIVO':
				return '#6b7280';
			case 'NO_DISPONIBLE':
			case 'NO DISPONIBLE':
				return '#ef4444';
			default:
				return '#9ca3af';
		}
	}

	function getStatusLabel(estado: string) {
		switch (estado?.toUpperCase()) {
			case 'DISPONIBLE':
			case 'ACTIVO':
				return 'Disponible';
			case 'SERVICIO':
				return 'En servicio';
			case 'MANTENIMIENTO':
				return 'Mantenimiento';
			case 'INACTIVO':
				return 'Inactivo';
			case 'NO_DISPONIBLE':
			case 'NO DISPONIBLE':
				return 'Fuera de servicio';
			default:
				return estado
					? estado.charAt(0).toUpperCase() + estado.slice(1).toLowerCase()
					: 'Sin estado';
		}
	}

	/// Columnas de la lista. Sin `accessorKey` en las de presentación: la
	/// celda las pinta con el snippet y `TablaLista` no intenta leer un valor.
	const COLUMNAS: ColumnDef<Vehiculo, any>[] = [
		{ id: 'vehiculo', header: 'Vehículo', accessorKey: 'placa', enableSorting: false },
		{ id: 'detalle', header: 'Modelo · Clase', enableSorting: false },
		{ id: 'conductor', header: 'Conductor asignado', enableSorting: false },
		{ id: 'estado', header: 'Estado', accessorKey: 'estado', enableSorting: false, size: 150 },
		{ id: 'acciones', header: '', enableSorting: false, size: 110 }
	];

	const SEGMENTOS_ESTADO = [
		{ valor: 'todos', etiqueta: 'Todos' },
		{ valor: 'disponible', etiqueta: 'Disponibles', punto: '#16a34a' },
		{ valor: 'servicio', etiqueta: 'En servicio', punto: '#8b5cf6' },
		{ valor: 'mantenimiento', etiqueta: 'Mantenimiento', punto: '#f59e0b' },
		{ valor: 'inactivo', etiqueta: 'Inactivos', punto: '#64748b' }
	];

	const conteos = $derived([
		{ clave: 'todos', etiqueta: 'Total', valor: stats.total },
		{ clave: 'disponible', etiqueta: 'Disponibles', valor: stats.disponible, color: '#16a34a' },
		{ clave: 'servicio', etiqueta: 'En servicio', valor: stats.servicio, color: '#8b5cf6' },
		{
			clave: 'mantenimiento',
			etiqueta: 'Mantenimiento',
			valor: stats.mantenimiento,
			color: '#f59e0b'
		},
		{ clave: 'inactivo', etiqueta: 'Inactivos', valor: stats.inactivo, color: '#64748b' },
		{ clave: 'fuera', etiqueta: 'Fuera de servicio', valor: stats.noDisponible, color: '#dc2626' }
	]);

	function filtrarPorConteo(clave: string) {
		if (clave === 'fuera') return;
		filtros = { ...filtros, estado: filtros.estado === clave ? 'todos' : clave };
	}

	function openModal(id: string | null = null) {
		selectedVehiculoId = id;
		isModalOpen = true;
	}
	function openDeleteModal(v: Vehiculo) {
		vehiculoToDelete = v;
		isDeleteModalOpen = true;
	}

	/**
	 * Filtros → URL.
	 *
	 * Con `goto`, no con `history.replaceState`: así `page.url` refleja de
	 * verdad lo que hay en la barra de direcciones.
	 */
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	/**
	 * Carga cuando cambia lo que el servidor tiene que devolver.
	 *
	 * Depende de `firmaDatos`, no de `filtros`: teclear en el buscador cambia
	 * los filtros pero no la firma, así que no dispara ninguna petición.
	 */
	$effect(() => {
		void firmaDatos;
		void cargar();
	});

	onMount(() => {
		/// Un evento de socket marca la lista para revalidar en vez de recargar
		/// a ciegas. Antes los tres apuntaban a `loadVehiculos`, así que cada
		/// cambio de cualquier usuario provocaba una petición completa aquí.
		const bajas = [
			socketUtils.on('vehiculo-creado', () => cargar(true)),
			socketUtils.on('vehiculo-actualizado', () => cargar(true)),
			socketUtils.on('vehiculo-eliminado', () => cargar(true))
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
	<title>Flota — Cotransmeq</title>
</svelte:head>

<div class="dir-pagina {shiftPressed ? 'select-none' : ''}" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, conteos y acciones ─────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Flota</h1>
			<p class="dir-desc">Monitorea y administra todos los vehículos de la empresa.</p>
			<div class="dir-conteos">
				<ResumenConteos
					{conteos}
					activo={filtros.estado === 'todos' ? null : filtros.estado}
					onElegir={filtrarPorConteo}
				/>
			</div>
		</div>

		<div class="dir-cabecera-acciones">
			<!-- Vistas rápidas: ocultos y papelera -->
			{#if canAccessSpecialViews}
				<button
					onclick={() =>
						(filtros = {
							...filtros,
							vista: filtros.vista === 'ocultos' ? 'activos' : 'ocultos'
						})}
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
				<button
					onclick={() =>
						(filtros = {
							...filtros,
							vista: filtros.vista === 'papelera' ? 'activos' : 'papelera'
						})}
					title={filtros.vista === 'papelera' ? 'Ver activos' : 'Ver papelera'}
					class="btn-icon"
					style="border-color: {filtros.vista === 'papelera'
						? '#dc2626'
						: 'var(--border-default)'}; background-color: {filtros.vista === 'papelera'
						? 'rgba(220,38,38,0.04)'
						: 'white'}; color: {filtros.vista === 'papelera' ? '#dc2626' : 'var(--text-muted)'};"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
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
			</button>
			{#if puedeEditar}
				<button onclick={() => openModal()} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Registrar vehículo
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
			subtitle="Filtra la flota de vehículos para encontrar lo que necesitas."
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
					<label for="filtro-estado" class="filter-field-label">
						Estado del vehículo
						{#if filtros.estado !== 'todos'}<span class="filter-field-label-hint">filtrado</span
							>{/if}
					</label>
					<select id="filtro-estado" bind:value={filtros.estado}>
						<option value="todos">Todos los estados</option>
						<option value="disponible">Disponible</option>
						<option value="servicio">En Servicio</option>
						<option value="mantenimiento">Mantenimiento</option>
						<option value="inactivo">Inactivo</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-visibilidad" class="filter-field-label">
						Visibilidad
						{#if filtros.vista !== 'activos'}<span class="filter-field-label-hint">filtrado</span
							>{/if}
					</label>
					<select id="filtro-visibilidad" bind:value={filtros.vista}>
						<option value="activos">Activos y ocultos</option>
						<option value="ocultos" disabled={!canAccessSpecialViews}>Solo ocultos</option>
						<option value="papelera" disabled={!canAccessSpecialViews}>Papelera</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-busqueda" class="filter-field-label">
						Búsqueda por placa o marca
						{#if filtros.q.trim()}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<input
						id="filtro-busqueda"
						type="text"
						bind:value={filtros.q}
						placeholder="Ej. ABC-123, Chevrolet…"
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

	<!-- ── FILTROS A LA VISTA: buscador + estado ─────────────── -->
	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={filtros.q}
				onBuscar={(termino) => (filtros = { ...filtros, q: termino })}
				placeholder="Placa, marca, modelo o conductor…"
				etiqueta="Buscar vehículos"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Estado"
			opciones={SEGMENTOS_ESTADO}
			valor={filtros.estado}
			onCambiar={(v) => (filtros = { ...filtros, estado: v })}
		/>
	</div>

	<!-- ── LISTA ─────────────────────────────────────────────── -->
	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
		<div class="dir-lista-scroll">
			<TablaLista
				columnas={COLUMNAS}
				datos={vehiculosVisibles}
				claveFila={(v) => v.id}
				cargando={isLoading}
				onFila={puedeEditar ? (v) => openModal(v.id) : undefined}
				etiqueta="Vehículos de la flota"
			>
				{#snippet celda({ columnaId, fila: v })}
					{#if columnaId === 'vehiculo'}
						<div class="flex items-center">
							<span class="dir-check">
								<input
									type="checkbox"
									checked={vehiculosSeleccionados.has(v.id)}
									onclick={(e) => {
										e.stopPropagation();
										toggleSeleccion(v.id, vehiculosVisibles.indexOf(v), e);
									}}
									aria-label="Seleccionar {v.placa}"
								/>
							</span>
							<CeldaIdentidad
								codigo={v.placa}
								titulo={[v.marca, v.linea].filter(Boolean).join(' ') || 'Sin marca'}
								subtitulo={v.color ? v.color : undefined}
							/>
						</div>
					{:else if columnaId === 'detalle'}
						<div class="dir-celda">
							<span>{v.modelo || '—'}</span>
							<small>{v.clase_vehiculo ? v.clase_vehiculo.toUpperCase() : 'Sin clase'}</small>
						</div>
					{:else if columnaId === 'conductor'}
						{#if v.conductores}
							<div class="dir-celda">
								<span>{v.conductores.nombre} {v.conductores.apellido}</span>
							</div>
						{:else}
							<span class="dir-nulo">Sin conductor asignado</span>
						{/if}
					{:else if columnaId === 'estado'}
						<EstadoPunto
							etiqueta={getStatusLabel(v.estado)}
							color={getStatusColor(v.estado)}
							apagado={v.estado?.toUpperCase() === 'INACTIVO'}
						/>
					{:else if columnaId === 'acciones'}
						<AccionesFila
							acciones={[
								{
									id: 'editar',
									etiqueta: 'Editar',
									icono: Pencil,
									onClick: () => openModal(v.id),
									oculta: !puedeEditar
								},
								{
									id: 'eliminar',
									etiqueta: 'Eliminar',
									icono: Trash2,
									onClick: () => openDeleteModal(v),
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
						<h3>No hay vehículos</h3>
						<p>
							{activeFilters.length
								? 'No se encontraron vehículos con los filtros aplicados.'
								: 'Registra el primer vehículo para verlo aquí.'}
						</p>
						{#if activeFilters.length}
							<button onclick={limpiarFiltros} class="btn-secondary">Limpiar filtros</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>
	</div>

	<!-- Bulk Actions Bar — fondo charcoal profundo (no glass) -->
	{#if vehiculosSeleccionados.size > 0}
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
					{vehiculosSeleccionados.size} seleccionados
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
						vehiculosSeleccionados.clear();
						vehiculosSeleccionados = vehiculosSeleccionados;
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

<ModalFormVehiculo
	bind:isOpen={isModalOpen}
	vehiculoId={selectedVehiculoId}
	on:close={() => (isModalOpen = false)}
	on:success={() => cargar(true)}
/>
<ModalConfirmDelete
	bind:isOpen={isDeleteModalOpen}
	vehiculo={vehiculoToDelete}
	on:close={() => (isDeleteModalOpen = false)}
	on:success={() => cargar(true)}
/>

<style>
	/* .glass y .soft-shadow ya están definidos en app.css con la nueva paleta.
	   Solo conservamos reglas específicas de esta vista. */
</style>
