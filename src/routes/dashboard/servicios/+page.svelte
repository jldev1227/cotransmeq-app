<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { serviciosStore, serviciosPorEstado } from '$lib/stores/servicios';
	import {
		recursos,
		conductoresOptions,
		vehiculosOptions,
		clientesOptions
	} from '$lib/stores/recursos';
	import { socketStore } from '$lib/socket';
	import {
		getEstadoText,
		getEstadoColor,
		formatCurrency,
		formatDateTime,
		type ServicioConRelaciones,
		type EstadoServicio
	} from '$lib/types/servicios';
	import ModalTicket from '$lib/components/servicios/ModalTicket.svelte';
	import ModalFormServicio from '$lib/components/servicios/ModalFormServicio.svelte';
	import ModalConfirm from '$lib/components/common/ModalConfirm.svelte';
	import { toast } from '$lib/stores/toast';
	import Select from 'svelte-select';

	// Estados locales
	let filtroEstado: EstadoServicio | '' = '';
	let busqueda = '';
	let busquedaTimeout: NodeJS.Timeout;
	let mostrarFiltros = false;
	let mostrarFiltrosAvanzados = false;
	let mostrarModalTicket = false;
	let mostrarModalFormServicio = false;
	let mostrarModalConfirm = false;
	let servicioSeleccionado: ServicioConRelaciones | null = null;
	let servicioEditar: ServicioConRelaciones | null = null;
	let servicioAEliminar: ServicioConRelaciones | null = null;
	let inicializado = false;

	// Filtros avanzados
	let conductorSeleccionado: any = null;
	let vehiculoSeleccionado: any = null;
	let clienteSeleccionado: any = null;
	let filtroFechaDesde = '';
	let filtroFechaHasta = '';
	let campoFecha: 'fecha_solicitud' | 'fecha_realizacion' | 'created_at' | 'fecha_finalizacion' =
		'fecha_solicitud';
	let ordenarPor = 'fecha_solicitud';
	let ordenDireccion: 'asc' | 'desc' = 'desc';

	// Paginación
	let paginaActual = 1;
	let itemsPorPagina = 20;

	$: stats = $serviciosStore.stats;
	$: servicios = $serviciosStore.servicios;
	$: loading = $serviciosStore.loading;
	$: socketConnected = $socketStore.connected;
	$: pagination = $serviciosStore.pagination;
	$: totalPaginas = pagination.totalPages;
	$: conductores = $conductoresOptions;
	$: vehiculos = $vehiculosOptions;
	$: clientes = $clientesOptions;

	async function cargarServicios(forceRefresh = false) {
		const params: any = {
			page: paginaActual,
			limit: itemsPorPagina,
			orderBy: ordenarPor,
			orderDirection: ordenDireccion
		};
		if (filtroEstado) params.estado = filtroEstado;
		if (busqueda?.trim()) params.search = busqueda.trim();
		if (conductorSeleccionado?.value) params.conductor_id = conductorSeleccionado.value;
		if (vehiculoSeleccionado?.value) params.vehiculo_id = vehiculoSeleccionado.value;
		if (clienteSeleccionado?.value) params.cliente_id = clienteSeleccionado.value;
		if (filtroFechaDesde) params.fecha_desde = filtroFechaDesde;
		if (filtroFechaHasta) params.fecha_hasta = filtroFechaHasta;
		if (filtroFechaDesde || filtroFechaHasta) params.campo_fecha = campoFecha;
		await serviciosStore.obtenerServicios(params, forceRefresh);
	}

	function handleBusquedaChange() {
		if (!inicializado) return;
		clearTimeout(busquedaTimeout);
		busquedaTimeout = setTimeout(() => { paginaActual = 1; cargarServicios(); }, 500);
	}

	$: if (inicializado && busqueda !== undefined) handleBusquedaChange();

	function handleEstadoChange() {
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}
	function handleSelectChange() {
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}
	function handleFechaChange() {
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}
	function handleOrdenChange() {
		if (!inicializado) return;
		cargarServicios();
	}

	async function irPagina(pagina: number) {
		if (pagina >= 1 && pagina <= totalPaginas) {
			paginaActual = pagina;
			await cargarServicios();
		}
	}

	onMount(async () => {
		await serviciosStore.inicializar();
		await recursos.cargarTodos();
		inicializado = true;
		await cargarServicios();
	});

	onDestroy(() => { serviciosStore.limpiarSocket(); });

	function verDetalle(id: string) { goto(`/dashboard/servicios/${id}`); }

	async function limpiarFiltros() {
		filtroEstado = '';
		busqueda = '';
		conductorSeleccionado = null;
		vehiculoSeleccionado = null;
		clienteSeleccionado = null;
		filtroFechaDesde = '';
		filtroFechaHasta = '';
		campoFecha = 'fecha_solicitud';
		ordenarPor = 'fecha_solicitud';
		ordenDireccion = 'desc';
		paginaActual = 1;
		await serviciosStore.obtenerStats();
		await cargarServicios(true);
	}

	function handleNuevoServicio() { servicioEditar = null; mostrarModalFormServicio = true; }
	function handleEditarServicio(servicio: ServicioConRelaciones) { servicioEditar = servicio; mostrarModalFormServicio = true; }
	function handleModalFormClose() { mostrarModalFormServicio = false; servicioEditar = null; }
	async function handleModalFormSuccess() {
		mostrarModalFormServicio = false;
		servicioEditar = null;
		await serviciosStore.obtenerServicios({}, true);
	}

	function cambiarFiltroEstado(estado: EstadoServicio) {
		filtroEstado = estado;
		paginaActual = 1;
		cargarServicios();
	}

	async function handleCompartirServicio(servicio: ServicioConRelaciones) {
		try {
			let token = servicio.share_token;
			if (!token) {
				token = (await serviciosStore.generarShareToken(servicio.id)) ?? undefined;
				if (!token) { alert('Error al generar enlace compartible'); return; }
			}
			const shareUrl = `${window.location.origin}/public/servicio/${token}`;
			await navigator.clipboard.writeText(shareUrl);
			alert('✅ Enlace copiado al portapapeles!\n\n' + shareUrl);
		} catch (error) {
			console.error('Error compartiendo servicio:', error);
			alert('Error al compartir servicio');
		}
	}

	function handleEliminarServicio(servicio: ServicioConRelaciones) {
		servicioAEliminar = servicio;
		mostrarModalConfirm = true;
	}

	async function confirmarEliminacion() {
		if (!servicioAEliminar) return;
		try {
			await serviciosStore.eliminar(servicioAEliminar.id);
			mostrarModalConfirm = false;
			servicioAEliminar = null;
			await cargarServicios(true);
			toast.success('Servicio eliminado exitosamente');
		} catch (error: any) {
			toast.error('Error al eliminar servicio: ' + (error.message || 'Error desconocido'));
		}
	}

	function cancelarEliminacion() { mostrarModalConfirm = false; servicioAEliminar = null; }

	async function handleDescargarRutograma(servicio: ServicioConRelaciones) {
		try {
			const token = localStorage.getItem('transmeralda_token');
			const baseURL = import.meta.env.VITE_API_URL;
			const response = await fetch(`${baseURL}/api/servicios/${servicio.id}/rutograma`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				throw new Error(errorData?.message || `Error ${response.status}`);
			}
			const blob = await response.blob();
			const blobUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = blobUrl;
			a.download = `rutograma-${servicio.origen_especifico || 'servicio'}-${servicio.destino_especifico || ''}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(blobUrl);
			toast.success('Rutograma descargado exitosamente');
		} catch (error: any) {
			toast.error('Error al descargar rutograma: ' + (error.message || 'Error desconocido'));
		}
	}
</script>

<svelte:head>
	<title>Servicios - Cotransmeq</title>
</svelte:head>

<!-- Layout raíz: columna que ocupa todo el alto disponible -->
<div class="flex h-full flex-col gap-4 p-6" in:fade={{ duration: 400 }}>

	<!-- ═══════════════════════════════════════════
	     HEADER
	     ═══════════════════════════════════════════ -->
	<div class="glass soft-shadow flex-shrink-0 rounded-2xl border border-gray-200/50 p-5">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

			<!-- Título -->
			<div class="flex items-center gap-3">
				<div class="soft-shadow flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600">
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="text-xl font-bold text-gray-900">Gestión de Servicios</h1>
						{#if socketConnected}
							<span class="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-600" in:scale={{ duration: 200 }}>
								<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500"></span>
								En vivo
							</span>
						{:else}
							<span class="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-600">
								<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
								Offline
							</span>
						{/if}
					</div>
					<p class="text-xs text-gray-500">Administra y monitorea todos los servicios de transporte</p>
				</div>
			</div>

			<!-- Búsqueda + acciones -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Búsqueda -->
				<div class="relative">
					<input
						type="text"
						bind:value={busqueda}
						placeholder="Buscar servicios..."
						class="input-glow apple-transition w-64 rounded-xl border border-gray-200 bg-white/80 py-2 pr-4 pl-9 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400"
					/>
					<svg class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
				</div>

				<!-- Filtros -->
				<button
					on:click={() => (mostrarFiltros = !mostrarFiltros)}
					class="apple-transition flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors
						{mostrarFiltros ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50'}"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
					</svg>
					Filtros
					{#if filtroEstado || conductorSeleccionado || vehiculoSeleccionado || clienteSeleccionado || filtroFechaDesde || filtroFechaHasta}
						<span class="flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">!</span>
					{/if}
				</button>

				<!-- Nuevo -->
				<button
					on:click={handleNuevoServicio}
					class="apple-hover apple-transition soft-shadow orange-glow flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Nuevo Servicio
				</button>
			</div>
		</div>

		<!-- Panel de filtros expandible -->
		{#if mostrarFiltros}
			<div
				class="mt-4 border-t border-gray-100 pt-4"
				style="position: relative; z-index: 90;"
				transition:fly={{ y: -12, duration: 200 }}
			>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4" style="overflow: visible;">
					<!-- Estado -->
					<div>
						<label for="filtro-estado" class="mb-1.5 block text-xs font-medium text-gray-600">Estado</label>
						<select
							id="filtro-estado"
							bind:value={filtroEstado}
							on:change={handleEstadoChange}
							class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-400"
						>
							<option value="">Todos los estados</option>
							<option value="solicitado">Solicitado</option>
							<option value="en_curso">En Curso</option>
							<option value="planificado">Planificado</option>
							<option value="realizado">Realizado</option>
							<option value="cancelado">Cancelado</option>
							<option value="liquidado">Liquidado</option>
						</select>
					</div>

					<!-- Conductor -->
					<div style="position: relative; z-index: 5;">
						<label for="filtro-conductor" class="mb-1.5 block text-xs font-medium text-gray-600">Conductor</label>
						<Select
							inputAttributes={{ id: 'filtro-conductor' }}
							items={conductores}
							bind:value={conductorSeleccionado}
							placeholder="Todos los conductores"
							searchable={true}
							clearable={true}
							on:change={handleSelectChange}
							on:clear={handleSelectChange}
							--background="white"
							--border="1px solid rgb(229, 231, 235)"
							--border-radius="0.75rem"
							--padding="0.5rem 0.75rem"
							--border-focused="1px solid rgb(52, 211, 153)"
							--list-z-index="99999"
						/>
					</div>

					<!-- Vehículo -->
					<div style="position: relative; z-index: 4;">
						<label for="filtro-vehiculo" class="mb-1.5 block text-xs font-medium text-gray-600">Vehículo</label>
						<Select
							inputAttributes={{ id: 'filtro-vehiculo' }}
							items={vehiculos}
							bind:value={vehiculoSeleccionado}
							placeholder="Todos los vehículos"
							searchable={true}
							clearable={true}
							on:change={handleSelectChange}
							on:clear={handleSelectChange}
							--background="white"
							--border="1px solid rgb(229, 231, 235)"
							--border-radius="0.75rem"
							--padding="0.5rem 0.75rem"
							--border-focused="1px solid rgb(52, 211, 153)"
							--list-z-index="99999"
						/>
					</div>

					<!-- Cliente -->
					<div style="position: relative; z-index: 3;">
						<label for="filtro-cliente" class="mb-1.5 block text-xs font-medium text-gray-600">Cliente</label>
						<Select
							inputAttributes={{ id: 'filtro-cliente' }}
							items={clientes}
							bind:value={clienteSeleccionado}
							placeholder="Todos los clientes"
							searchable={true}
							clearable={true}
							on:change={handleSelectChange}
							on:clear={handleSelectChange}
							--background="white"
							--border="1px solid rgb(229, 231, 235)"
							--border-radius="0.75rem"
							--padding="0.5rem 0.75rem"
							--border-focused="1px solid rgb(52, 211, 153)"
							--list-z-index="99999"
						/>
					</div>
				</div>

				<!-- Acciones + filtros avanzados -->
				<div class="mt-3 flex items-center justify-between">
					<button
						on:click={() => (mostrarFiltrosAvanzados = !mostrarFiltrosAvanzados)}
						class="apple-transition flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
						</svg>
						Filtros avanzados
						<svg class="h-3 w-3 transition-transform {mostrarFiltrosAvanzados ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					<button
						on:click={limpiarFiltros}
						class="apple-transition flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:border-red-300 hover:bg-red-50"
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
						Limpiar filtros
					</button>
				</div>

				<!-- Filtros avanzados -->
				{#if mostrarFiltrosAvanzados}
					<div class="mt-3 border-t border-gray-100 pt-3" transition:fly={{ y: -8, duration: 150 }}>
						<div class="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
							<div>
								<label for="filtro-campo-fecha" class="mb-1.5 block text-xs font-medium text-gray-600">Tipo de fecha</label>
								<select id="filtro-campo-fecha" bind:value={campoFecha} on:change={handleFechaChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-400">
									<option value="fecha_solicitud">Solicitud</option>
									<option value="created_at">Creación</option>
									<option value="fecha_realizacion">Realización</option>
									<option value="fecha_finalizacion">Finalización</option>
								</select>
							</div>
							<div>
								<label for="filtro-fecha-desde" class="mb-1.5 block text-xs font-medium text-gray-600">Desde</label>
								<input id="filtro-fecha-desde" type="date" bind:value={filtroFechaDesde} on:change={handleFechaChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-400" />
							</div>
							<div>
								<label for="filtro-fecha-hasta" class="mb-1.5 block text-xs font-medium text-gray-600">Hasta</label>
								<input id="filtro-fecha-hasta" type="date" bind:value={filtroFechaHasta} on:change={handleFechaChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-400" />
							</div>
							<div>
								<label for="filtro-ordenar-por" class="mb-1.5 block text-xs font-medium text-gray-600">Ordenar por</label>
								<select id="filtro-ordenar-por" bind:value={ordenarPor} on:change={handleOrdenChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-400">
									<option value="fecha_solicitud">Fecha solicitud</option>
									<option value="fecha_realizacion">Fecha realización</option>
									<option value="estado">Estado</option>
									<option value="cliente">Cliente</option>
									<option value="conductor">Conductor</option>
								</select>
							</div>
							<div>
								<label for="filtro-orden-direccion" class="mb-1.5 block text-xs font-medium text-gray-600">Dirección</label>
								<select id="filtro-orden-direccion" bind:value={ordenDireccion} on:change={handleOrdenChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-400">
									<option value="asc">Ascendente</option>
									<option value="desc">Descendente</option>
								</select>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ═══════════════════════════════════════════
	     STATS CARDS — compactas, una fila
	     ═══════════════════════════════════════════ -->
	{#if stats}
		<div class="grid flex-shrink-0 grid-cols-3 gap-3 lg:grid-cols-6" in:fly={{ y: 12, duration: 400, delay: 100 }}>
			<!-- Total -->
			<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-3">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Total</p>
						<p class="text-xl font-bold text-gray-900">{stats.total}</p>
					</div>
					<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-gray-400 to-gray-600">
						<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
					</div>
				</div>
			</div>

			<!-- Solicitados -->
			<button
				on:click={() => cambiarFiltroEstado('solicitado')}
				class="glass soft-shadow apple-transition rounded-xl border p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/30
					{filtroEstado === 'solicitado' ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200/50'}"
			>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Solicitados</p>
						<p class="text-xl font-bold text-blue-600">{stats.solicitado}</p>
					</div>
					<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600">
						<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
				</div>
			</button>

			<!-- En Curso -->
			<button
				on:click={() => cambiarFiltroEstado('en_curso')}
				class="glass soft-shadow apple-transition rounded-xl border p-3 text-left transition-colors hover:border-amber-200 hover:bg-amber-50/30
					{filtroEstado === 'en_curso' ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200/50'}"
			>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">En Curso</p>
						<p class="text-xl font-bold text-amber-600">{stats.en_curso}</p>
					</div>
					<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600">
						<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					</div>
				</div>
			</button>

			<!-- Planificados -->
			<button
				on:click={() => cambiarFiltroEstado('planificado')}
				class="glass soft-shadow apple-transition rounded-xl border p-3 text-left transition-colors hover:border-violet-200 hover:bg-violet-50/30
					{filtroEstado === 'planificado' ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200/50'}"
			>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Planificados</p>
						<p class="text-xl font-bold text-violet-600">{stats.planificado}</p>
					</div>
					<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-violet-600">
						<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
					</div>
				</div>
			</button>

			<!-- Realizados -->
			<button
				on:click={() => cambiarFiltroEstado('realizado')}
				class="glass soft-shadow apple-transition rounded-xl border p-3 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/30
					{filtroEstado === 'realizado' ? 'border-orange-300 bg-orange-50/50' : 'border-gray-200/50'}"
			>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Realizados</p>
						<p class="text-xl font-bold text-orange-600">{stats.realizado}</p>
					</div>
					<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600">
						<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
				</div>
			</button>

			<!-- Cancelados -->
			<button
				on:click={() => cambiarFiltroEstado('cancelado')}
				class="glass soft-shadow apple-transition rounded-xl border p-3 text-left transition-colors hover:border-red-200 hover:bg-red-50/30
					{filtroEstado === 'cancelado' ? 'border-red-300 bg-red-50/50' : 'border-gray-200/50'}"
			>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wide text-gray-500">Cancelados</p>
						<p class="text-xl font-bold text-red-600">{stats.cancelado}</p>
					</div>
					<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-red-400 to-red-600">
						<svg class="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
				</div>
			</button>
		</div>
	{/if}

	<!-- ═══════════════════════════════════════════
	     TABLA — ocupa el resto del alto disponible
	     ═══════════════════════════════════════════ -->
	<div
		class="glass soft-shadow flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/50"
		in:fly={{ y: 12, duration: 400, delay: 150 }}
	>
		{#if loading}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
				<p class="text-sm text-gray-500">Cargando servicios...</p>
			</div>

		{:else if servicios.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
					<svg class="h-7 w-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
				<div class="text-center">
					<h3 class="mb-1 text-base font-semibold text-gray-900">No hay servicios</h3>
					<p class="text-sm text-gray-500">
						{busqueda || filtroEstado ? 'No se encontraron servicios con los filtros aplicados' : 'Comienza creando un nuevo servicio'}
					</p>
				</div>
				{#if busqueda || filtroEstado}
					<button on:click={limpiarFiltros} class="apple-transition rounded-lg bg-orange-500 px-4 py-2 text-sm text-white hover:bg-orange-600">
						Limpiar filtros
					</button>
				{/if}
			</div>

		{:else}
			<!-- ─────────────────────────────────────────
			     LEYENDA DE ESTADOS
			     ───────────────────────────────────────── -->
			<div class="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-gray-100 bg-gray-50/60 px-4 py-2">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Estados:</span>
				{#each [
					{ estado: 'solicitado',  label: 'Solicitado'  },
					{ estado: 'en_curso',    label: 'En Curso'    },
					{ estado: 'planificado', label: 'Planificado' },
					{ estado: 'realizado',   label: 'Realizado'   },
					{ estado: 'cancelado',   label: 'Cancelado'   },
					{ estado: 'liquidado',   label: 'Liquidado'   },
				] as item}
					<button
						on:click={() => cambiarFiltroEstado(item.estado as EstadoServicio)}
						class="flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors hover:bg-gray-100
							{filtroEstado === item.estado ? 'bg-gray-200/80 ring-1 ring-gray-300' : ''}"
						title="Filtrar por {item.label}"
					>
						<span
							class="h-2 w-2 flex-shrink-0 rounded-full"
							style="background-color: {getEstadoColor(item.estado as EstadoServicio)}"
						></span>
						<span class="text-[10px] font-medium text-gray-600">{item.label}</span>
					</button>
				{/each}
				{#if filtroEstado}
					<button
						on:click={() => { filtroEstado = ''; paginaActual = 1; cargarServicios(); }}
						class="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-red-500 hover:bg-red-50"
					>
						<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
						Quitar filtro
					</button>
				{/if}
			</div>

			<!-- ─────────────────────────────────────────
			     MOBILE: Lista de cards  (< lg)
			     ───────────────────────────────────────── -->
			<div class="min-h-0 flex-1 overflow-y-auto lg:hidden">
				<div class="divide-y divide-gray-100">
					{#each servicios as servicio, index (servicio?.id || `temp-${index}`)}
						<div
							class="relative flex gap-0 transition-colors hover:bg-gray-50/60"
							in:fly={{ y: 8, duration: 200, delay: index * 20 }}
						>
							<!-- Barra de estado lateral -->
							<div
								class="w-1 flex-shrink-0 rounded-l-sm"
								style="background-color: {getEstadoColor(servicio.estado)}"
							></div>

							<!-- Contenido de la card -->
							<div class="min-w-0 flex-1 px-3 py-3">
								<!-- Fila 1: Ruta + Estado badge -->
								<div class="mb-2 flex items-start justify-between gap-2">
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1">
											<svg class="h-3 w-3 flex-shrink-0 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
											</svg>
											<p class="truncate text-sm font-semibold text-gray-900">
												{servicio.origen_especifico || servicio.origen?.nombre_municipio || 'Sin origen'}
											</p>
										</div>
										<div class="mt-0.5 flex items-center gap-1 pl-4">
											<svg class="h-2.5 w-2.5 flex-shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
											</svg>
											<p class="truncate text-xs text-gray-500">
												{servicio.destino_especifico || servicio.destino?.nombre_municipio || 'Sin destino'}
											</p>
										</div>
									</div>
									<span
										class="flex-shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold"
										style="background-color: {getEstadoColor(servicio.estado)}15; border-color: {getEstadoColor(servicio.estado)}40; color: {getEstadoColor(servicio.estado)}"
									>
										{getEstadoText(servicio.estado)}
									</span>
								</div>

								<!-- Fila 2: Cliente + Valor -->
								<div class="mb-1.5 flex items-center justify-between gap-2">
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs text-gray-700" title={servicio.cliente?.nombre}>
											<span class="font-medium text-gray-500">Cliente: </span>
											{servicio.cliente?.nombre || 'Sin cliente'}
										</p>
									</div>
									{#if servicio.valor}
										<span class="flex-shrink-0 text-xs font-semibold text-gray-900">
											{new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(servicio.valor)}
										</span>
									{/if}
								</div>

								<!-- Fila 3: Conductor + Vehículo -->
								<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
									{#if servicio.conductor}
										<p class="text-xs text-gray-500">
											<span class="font-medium">🧑 </span>
											{servicio.conductor.nombre} {servicio.conductor.apellido}
										</p>
									{:else}
										<p class="text-xs italic text-gray-400">Sin conductor</p>
									{/if}
									{#if servicio.vehiculo}
										<p class="text-xs text-gray-500">
											<span class="font-mono font-semibold text-gray-700">{servicio.vehiculo.placa}</span>
											· {servicio.vehiculo.marca}
										</p>
									{/if}
								</div>

								<!-- Fila 4: Fecha solicitud + Acciones -->
								<div class="flex items-center justify-between gap-2">
									<p class="text-[10px] text-gray-400">
										{formatDateTime(servicio.fecha_solicitud)}
									</p>

									<!-- Acciones mobile -->
									<div class="flex items-center gap-0.5">
										<button
											on:click|stopPropagation={() => handleCompartirServicio(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-teal-50 hover:text-teal-600"
											title="Compartir"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => { servicioSeleccionado = servicio; mostrarModalTicket = true; }}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-purple-50 hover:text-purple-600"
											title="Ticket"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => handleEditarServicio(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
											title="Editar"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => verDetalle(servicio.id)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600"
											title="Ver detalle"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => handleEliminarServicio(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
											title="Eliminar"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
										</button>
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- ─────────────────────────────────────────
			     DESKTOP: Tabla responsive  (>= lg)
			     Breakpoints de columnas:
			       lg       : barra, ruta, cliente, conductor, valor, estado, acciones
			       xl       : + vehículo, fecha solicitud
			       2xl      : + propósito, planilla, fecha realización, fecha finalización
			     ───────────────────────────────────────── -->
			<div class="hidden min-h-0 flex-1 overflow-auto lg:block">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="sticky top-0 z-10 border-b border-gray-200 bg-gray-50/95 backdrop-blur-sm">
							<!-- Barra estado: siempre -->
							<th class="w-1 p-0"></th>

							<!-- Ruta: siempre -->
							<th class="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
								Ruta
							</th>

							<!-- Cliente: siempre -->
							<th class="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
								Cliente
							</th>

							<!-- Conductor: siempre (lg+) -->
							<th class="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
								Conductor
							</th>

							<!-- Vehículo: xl+ -->
							<th class="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap xl:table-cell">
								Vehículo
							</th>

							<!-- Valor: siempre -->
							<th class="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
								Valor
							</th>

							<!-- Propósito: 2xl+ -->
							<th class="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap 2xl:table-cell">
								Propósito
							</th>

							<!-- Planilla: 2xl+ -->
							<th class="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap 2xl:table-cell">
								Planilla
							</th>

							<!-- Fecha Solicitud: xl+ -->
							<th class="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap xl:table-cell">
								Solicitud
							</th>

							<!-- Fecha Realización: 2xl+ -->
							<th class="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap 2xl:table-cell">
								Realización
							</th>

							<!-- Fecha Finalización: 2xl+ -->
							<th class="hidden px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap 2xl:table-cell">
								Finalización
							</th>

							<!-- Estado: siempre -->
							<!-- <th class="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
								Estado
							</th> -->

							<!-- Acciones: siempre, sticky -->
							<th class="sticky right-0 bg-gray-50/95 px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap backdrop-blur-sm">
								Acciones
							</th>
						</tr>
					</thead>

					<tbody class="divide-y divide-gray-100 bg-white">
						{#each servicios as servicio, index (servicio?.id || `temp-${index}`)}
							<tr
								class="group transition-colors duration-100 hover:bg-orange-50/40"
								in:fly={{ y: 8, duration: 200, delay: index * 20 }}
							>
								<!-- Barra de estado lateral -->
								<td class="w-1 p-0">
									<div
										class="min-h-[2.5rem] w-1"
										style="background-color: {getEstadoColor(servicio.estado)}"
									></div>
								</td>

								<!-- Ruta -->
								<td class="max-w-[200px] min-w-[150px] px-3 py-2">
									<div class="flex items-start gap-1">
										<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
										</svg>
										<div class="min-w-0">
											<p
												class="truncate text-xs font-semibold leading-tight text-gray-900"
												title={servicio.origen_especifico || servicio.origen?.nombre_municipio}
											>
												{servicio.origen_especifico || servicio.origen?.nombre_municipio || 'Sin origen'}
											</p>
											<div class="mt-0.5 flex items-center gap-0.5">
												<svg class="h-2.5 w-2.5 flex-shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
												</svg>
												<p
													class="truncate text-xs leading-tight text-gray-500"
													title={servicio.destino_especifico || servicio.destino?.nombre_municipio}
												>
													{servicio.destino_especifico || servicio.destino?.nombre_municipio || 'Sin destino'}
												</p>
											</div>
										</div>
									</div>
								</td>

								<!-- Cliente -->
								<td class="max-w-[160px] min-w-[120px] px-3 py-2">
									<p class="truncate text-xs font-medium text-gray-900" title={servicio.cliente?.nombre}>
										{servicio.cliente?.nombre || 'Sin cliente'}
									</p>
									{#if servicio.cliente?.nit}
										<p class="text-[10px] text-gray-400">NIT: {servicio.cliente.nit}</p>
									{/if}
								</td>

								<!-- Conductor -->
								<td class="max-w-[150px] min-w-[120px] px-3 py-2">
									{#if servicio.conductor}
										<p
											class="truncate text-xs text-gray-900"
											title="{servicio.conductor.nombre} {servicio.conductor.apellido}"
										>
											{servicio.conductor.nombre} {servicio.conductor.apellido}
										</p>
										{#if servicio.conductor.telefono}
											<p class="text-[10px] text-gray-400">{servicio.conductor.telefono}</p>
										{/if}
									{:else}
										<span class="text-xs italic text-gray-400">Sin asignar</span>
									{/if}
								</td>

								<!-- Vehículo: xl+ -->
								<td class="hidden min-w-[100px] px-3 py-2 xl:table-cell">
									{#if servicio.vehiculo}
										<p class="text-xs font-semibold text-gray-900">{servicio.vehiculo.placa}</p>
										<p class="truncate text-[10px] text-gray-400">
											{servicio.vehiculo.marca} {servicio.vehiculo.modelo}
										</p>
									{:else}
										<span class="text-xs italic text-gray-400">Sin asignar</span>
									{/if}
								</td>

								<!-- Valor -->
								<td class="px-3 py-2 text-right whitespace-nowrap">
									<span class="text-xs font-semibold text-gray-900">
										{servicio.valor
											? new Intl.NumberFormat('es-CO', {
													style: 'currency',
													currency: 'COP',
													minimumFractionDigits: 0
												}).format(servicio.valor)
											: '—'}
									</span>
								</td>

								<!-- Propósito: 2xl+ -->
								<td class="hidden px-3 py-2 whitespace-nowrap 2xl:table-cell">
									<span
										class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium
											{(servicio.proposito_servicio as string) === 'empresarial'
													? 'bg-blue-50 text-blue-700'
													: (servicio.proposito_servicio as string) === 'personal'
														? 'bg-violet-50 text-violet-700'
														: 'bg-gray-100 text-gray-600'}"
									>
										{servicio.proposito_servicio ?? '—'}
									</span>
								</td>

								<!-- Planilla: 2xl+ -->
								<td class="hidden px-3 py-2 whitespace-nowrap 2xl:table-cell">
									{#if servicio.numero_planilla}
										<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700">
											{servicio.numero_planilla}
										</span>
									{:else}
										<span class="text-xs text-gray-300">—</span>
									{/if}
								</td>

								<!-- Fecha Solicitud: xl+ -->
								<td class="hidden px-3 py-2 whitespace-nowrap xl:table-cell">
									<span class="text-xs text-gray-600">{formatDateTime(servicio.fecha_solicitud)}</span>
								</td>

								<!-- Fecha Realización: 2xl+ -->
								<td class="hidden px-3 py-2 whitespace-nowrap 2xl:table-cell">
									{#if servicio.fecha_realizacion}
										<span class="text-xs text-gray-600">{formatDateTime(servicio.fecha_realizacion)}</span>
									{:else}
										<span class="text-xs text-gray-300">—</span>
									{/if}
								</td>

								<!-- Fecha Finalización: 2xl+ -->
								<td class="hidden px-3 py-2 whitespace-nowrap 2xl:table-cell">
									{#if servicio.fecha_finalizacion}
										<span class="text-xs text-gray-600">{formatDateTime(servicio.fecha_finalizacion)}</span>
									{:else}
										<span class="text-xs text-gray-300">—</span>
									{/if}
								</td>

								<!-- Estado badge -->
								<!-- <td class="px-3 py-2 whitespace-nowrap">
									<span
										class="inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold"
										style="background-color: {getEstadoColor(servicio.estado)}15; border-color: {getEstadoColor(servicio.estado)}40; color: {getEstadoColor(servicio.estado)}"
									>
										{getEstadoText(servicio.estado)}
									</span>
								</td> -->

								<!-- Acciones sticky -->
								<td class="sticky right-0 bg-white px-2 py-2 whitespace-nowrap group-hover:bg-orange-50/40">
									<div class="flex items-center justify-center gap-0.5">
										<button
											on:click|stopPropagation={() => handleCompartirServicio(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-teal-50 hover:text-teal-600"
											title="Compartir"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => { 
												console.log(servicio)
												servicioSeleccionado = servicio; mostrarModalTicket = true;
											 }}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-purple-50 hover:text-purple-600"
											title="Ticket"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => handleDescargarRutograma(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-700"
											title="Rutograma PDF"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => handleEditarServicio(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
											title="Editar"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => verDetalle(servicio.id)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600"
											title="Ver detalle"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
											</svg>
										</button>
										<button
											on:click|stopPropagation={() => handleEliminarServicio(servicio)}
											class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
											title="Eliminar"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Paginación pegada al fondo -->
			{#if totalPaginas > 1}
				<div class="flex flex-shrink-0 items-center justify-between border-t border-gray-100 bg-gray-50/50 px-4 py-3">
					<p class="text-xs text-gray-500">
						<span class="font-semibold text-gray-700">{(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)}</span>
						de <span class="font-semibold text-gray-700">{pagination.total}</span> servicios
					</p>

					<div class="flex items-center gap-1">
						<button on:click={() => irPagina(1)} disabled={pagination.page === 1 || loading}
							class="apple-transition rounded-lg border border-gray-200 p-1.5 {pagination.page === 1 || loading ? 'cursor-not-allowed bg-gray-100 text-gray-300' : 'bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50'}" title="Primera">
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
						</button>
						<button on:click={() => irPagina(pagination.page - 1)} disabled={pagination.page === 1 || loading}
							class="apple-transition rounded-lg border border-gray-200 p-1.5 {pagination.page === 1 || loading ? 'cursor-not-allowed bg-gray-100 text-gray-300' : 'bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50'}" title="Anterior">
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
						</button>

						{#each Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
							const start = Math.max(1, Math.min(pagination.page - 2, totalPaginas - 4));
							return start + i;
						}) as pagina}
							<button on:click={() => irPagina(pagina)} disabled={loading}
								class="apple-transition min-w-[2rem] rounded-lg border px-2 py-1 text-xs {pagination.page === pagina ? 'border-orange-500 bg-orange-500 font-semibold text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50'} {loading ? 'opacity-50' : ''}">
								{pagina}
							</button>
						{/each}

						<button on:click={() => irPagina(pagination.page + 1)} disabled={pagination.page === totalPaginas || loading}
							class="apple-transition rounded-lg border border-gray-200 p-1.5 {pagination.page === totalPaginas || loading ? 'cursor-not-allowed bg-gray-100 text-gray-300' : 'bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50'}" title="Siguiente">
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
						</button>
						<button on:click={() => irPagina(totalPaginas)} disabled={pagination.page === totalPaginas || loading}
							class="apple-transition rounded-lg border border-gray-200 p-1.5 {pagination.page === totalPaginas || loading ? 'cursor-not-allowed bg-gray-100 text-gray-300' : 'bg-white text-gray-600 hover:border-orange-200 hover:bg-orange-50'}" title="Última">
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Modales -->
{#if mostrarModalTicket && servicioSeleccionado}
	<ModalTicket servicio={servicioSeleccionado} onClose={() => { mostrarModalTicket = false; servicioSeleccionado = null; }} />
{/if}

{#if mostrarModalFormServicio}
	<ModalFormServicio isOpen={mostrarModalFormServicio} servicio={servicioEditar} onClose={handleModalFormClose} onSuccess={handleModalFormSuccess} />
{/if}

{#if servicioAEliminar}
	<ModalConfirm
		isOpen={mostrarModalConfirm}
		title="¿Eliminar servicio?"
		message={`¿Estás seguro de que deseas eliminar el servicio de ${servicioAEliminar.cliente?.nombre || 'N/A'} (${servicioAEliminar.origen_especifico || servicioAEliminar.origen?.nombre_municipio || 'N/A'} → ${servicioAEliminar.destino_especifico || servicioAEliminar.destino?.nombre_municipio || 'N/A'})? Esta acción no se puede deshacer.`}
		confirmText="Eliminar"
		cancelText="Cancelar"
		type="danger"
		on:confirm={confirmarEliminacion}
		on:cancel={cancelarEliminacion}
	/>
{/if}