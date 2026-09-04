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

	const isAdmin = $derived(
		$authStore.user?.rol === 'admin' || $authStore.user?.role === 'admin'
	);
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
					buscado === 'DISPONIBLE' ? ['DISPONIBLE', 'ACTIVO'] : [buscado, buscado.replace('_', ' ')];
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
				return '#10b981';
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

<div class="flex h-full min-h-0 flex-col gap-4 p-6" in:fade={{ duration: 400 }}>
	<!-- ── HEADER (page-card editorial) ─────────────────────── -->
	<div class="page-card flex-shrink-0" style="padding: 1.25rem 1.5rem;">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex items-center gap-3">
				<div
					class="brand-gradient flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);"
				>
					<svg
						class="h-5 w-5 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
					</svg>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Gestión de Flota
						</h1>
						<span
							class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
							style="background: rgba(16,185,129,0.08); color: var(--emerald-800);"
						>
							<span
								class="h-1.5 w-1.5 animate-pulse rounded-full"
								style="background-color: var(--emerald-500);"
							></span>
							En vivo
						</span>
					</div>
					<p class="text-xs" style="color: var(--text-muted);">
						Monitorea y administra todos los vehículos de la empresa
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<!-- Vistas Rápidas (Icon Buttons) -->
				{#if canAccessSpecialViews}
					<div class="mr-1 flex items-center gap-1">
						<button
							onclick={() =>
								(filtros = {
									...filtros,
									vista: filtros.vista === 'ocultos' ? 'activos' : 'ocultos'
								})}
							title={filtros.vista === 'ocultos' ? 'Ver Activos' : 'Ver Ocultos'}
							class="apple-transition btn-icon"
							style="border-color: {filtros.vista === 'ocultos'
								? 'var(--emerald-500)'
								: 'var(--border-default)'}; background-color: {filtros.vista === 'ocultos'
								? 'rgba(16,185,129,0.04)'
								: 'white'}; color: {filtros.vista === 'ocultos' ? 'var(--emerald-600)' : 'var(--text-muted)'};"
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
							title={filtros.vista === 'papelera' ? 'Ver Activos' : 'Ver Papelera'}
							class="apple-transition btn-icon"
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
					</div>
				{/if}

				<div class="w-64">
					<BuscadorLista
						bind:valor={filtros.q}
						onBuscar={(termino) => (filtros = { ...filtros, q: termino })}
						placeholder="Placa, marca…"
						etiqueta="Buscar vehículos"
					/>
				</div>
				<button
					onclick={() => (mostrarFiltros = !mostrarFiltros)}
					class="btn-secondary"
					style="border-color: {mostrarFiltros
						? 'var(--emerald-500)'
						: 'var(--border-default)'}; color: {mostrarFiltros
						? 'var(--emerald-700)'
						: 'var(--text-secondary)'}; background-color: {mostrarFiltros
						? 'rgba(16,185,129,0.04)'
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
				<button onclick={() => openModal()} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Registrar Vehículo
				</button>
			</div>
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
				<button
					class="filter-clear"
					onclick={limpiarFiltros}
					disabled={activeFilters.length === 0}
				>
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
	</div>

	<!-- ── STATS CARDS (radios 16, mono labels) ──────────────── -->
	<div
		class="grid flex-shrink-0 grid-cols-2 gap-3 lg:grid-cols-6"
		in:fly={{ y: 12, duration: 400, delay: 100 }}
	>
		<div class="stat-card">
			<p class="stat-label">Total</p>
			<p class="stat-value">{stats.total}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Disponibles</p>
			<p class="stat-value" style="color: var(--emerald-600);">{stats.disponible}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">En Servicio</p>
			<p class="stat-value" style="color: #8b5cf6;">{stats.servicio}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Mantenimiento</p>
			<p class="stat-value" style="color: #f59e0b;">{stats.mantenimiento}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Inactivos</p>
			<p class="stat-value" style="color: var(--text-muted);">{stats.inactivo}</p>
		</div>
		<div class="stat-card">
			<p class="stat-label">Fuera Serv.</p>
			<p class="stat-value" style="color: #dc2626;">{stats.noDisponible}</p>
		</div>
	</div>

	<!-- ── TABLA (table-card editorial) ──────────────────────── -->
	<div
		class="table-card flex min-h-0 flex-1 flex-col {shiftPressed ? 'select-none' : ''}"
		in:fly={{ y: 12, duration: 400, delay: 150 }}
	>
		{#if isLoading}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
				<p class="text-sm" style="color: var(--text-muted);">Cargando flota…</p>
			</div>
		{:else if vehiculos.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div
					class="flex h-14 w-14 items-center justify-center rounded-2xl"
					style="background-color: var(--bg-base);"
				>
					<svg
						class="h-7 w-7"
						style="color: var(--text-very-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
					</svg>
				</div>
				<div class="text-center">
					<h3 class="mb-1 font-display text-lg" style="color: var(--bg-charcoal);">
						No hay vehículos
					</h3>
					<p class="text-sm" style="color: var(--text-muted);">No se encontraron resultados</p>
				</div>
				<button onclick={limpiarFiltros} class="btn-primary">Limpiar filtros</button>
			</div>
		{:else}
			<!-- Cards grid: 1 col mobile, 2 sm, 3 lg, 4 xl -->
			<div class="min-h-0 flex-1 overflow-y-auto p-3">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each vehiculosVisibles as v, index (v.id)}
						<article
							class="list-card"
							style="border-left: 4px solid {getStatusColor(v.estado)};
								background-color: {vehiculosSeleccionados.has(v.id)
								? 'rgba(16, 185, 129, 0.04)'
								: 'var(--bg-surface)'};
								border-color: {vehiculosSeleccionados.has(v.id) ? 'var(--emerald-500)' : 'var(--border-subtle)'};
								border-left-color: {getStatusColor(v.estado)};"
							in:fly={{ y: 8, duration: 200, delay: Math.min(index * 20, 200) }}
							onclick={(e) => toggleSeleccion(v.id, index, e)}
							role="button"
							tabindex="0"
						>
							<!-- Checkbox -->
							<div class="flex-shrink-0 pt-0.5">
								<input
									type="checkbox"
									checked={vehiculosSeleccionados.has(v.id)}
									onclick={(e) => {
										e.stopPropagation();
										toggleSeleccion(v.id, index, e);
									}}
									class="rounded text-emerald-600 focus:ring-emerald-500"
									style="border-color: var(--border-default);"
								/>
							</div>

							<!-- Contenido principal -->
							<div class="min-w-0 flex-1">
								<!-- Header: placa (mono) + status pill -->
								<div class="mb-1.5 flex items-start justify-between gap-2">
									<p
										class="font-mono-meta text-sm"
										style="color: var(--text-primary); letter-spacing: 0.08em;"
									>
										{v.placa}
									</p>
								</div>

								<!-- Marca + modelo (línea principal) -->
								<p class="text-sm leading-snug font-semibold" style="color: var(--text-primary);">
									{v.marca}
									{v.linea || ''}
								</p>
								<p class="text-[11px] leading-relaxed" style="color: var(--text-muted);">
									{v.modelo || '—'} · {v.color || '—'}{#if v.clase_vehiculo}
										· <span class="uppercase">{v.clase_vehiculo}</span>{/if}
								</p>

								<!-- Footer: conductor asignado -->
								<div
									class="mt-2 flex items-center gap-1.5 text-[11px]"
									style="color: var(--text-secondary);"
								>
									<svg
										class="h-3 w-3 flex-shrink-0"
										style="color: var(--text-very-muted);"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
									<span class="truncate">
										{#if v.conductores}
											<span class="font-medium" style="color: var(--text-primary);"
												>{v.conductores.nombre} {v.conductores.apellido}</span
											>
										{:else}
											<span class="italic" style="color: var(--text-very-muted);"
												>Sin conductor asignado</span
											>
										{/if}
									</span>
								</div>
							</div>

							<!-- Actions (vertical) -->
							<div
								class="flex flex-shrink-0 flex-col gap-1"
								onclick={(e) => e.stopPropagation()}
								role="presentation"
							>
								<button
									onclick={() => openModal(v.id)}
									class="apple-transition rounded-md p-1.5"
									style="color: var(--emerald-600); background-color: rgba(16, 185, 129, 0.06);"
									title="Editar"
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
											d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-2.828 0L9 13zm-4 6h16"
										/>
									</svg>
								</button>
								<button
									onclick={() => openDeleteModal(v)}
									class="apple-transition rounded-md p-1.5"
									style="color: #dc2626; background-color: rgba(220, 38, 38, 0.06);"
									title="Eliminar"
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
								</button>
							</div>
						</article>
					{/each}
				</div>
			</div>
		{/if}
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
