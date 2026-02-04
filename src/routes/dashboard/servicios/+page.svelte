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

	// Filtros avanzados (valores para svelte-select)
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

	// Subscripciones reactivas
	$: stats = $serviciosStore.stats;
	$: servicios = $serviciosStore.servicios;
	$: loading = $serviciosStore.loading;
	$: socketConnected = $socketStore.connected;
	$: pagination = $serviciosStore.pagination;
	$: totalPaginas = pagination.totalPages;

	// Opciones para los selects desde el store
	$: conductores = $conductoresOptions;
	$: vehiculos = $vehiculosOptions;
	$: clientes = $clientesOptions;

	// Función para cargar servicios con filtros y paginación
	async function cargarServicios(forceRefresh = false) {
		console.log('🚀 cargarServicios llamado con params:', {
			filtroEstado,
			busqueda,
			conductorSeleccionado,
			vehiculoSeleccionado,
			clienteSeleccionado,
			filtroFechaDesde,
			filtroFechaHasta,
			paginaActual
		});

		const params: any = {
			page: paginaActual,
			limit: itemsPorPagina,
			orderBy: ordenarPor,
			orderDirection: ordenDireccion
		};

		if (filtroEstado) {
			params.estado = filtroEstado;
		}

		if (busqueda && busqueda.trim()) {
			params.search = busqueda.trim();
		}

		if (conductorSeleccionado && conductorSeleccionado.value) {
			params.conductor_id = conductorSeleccionado.value;
		}

		if (vehiculoSeleccionado && vehiculoSeleccionado.value) {
			params.vehiculo_id = vehiculoSeleccionado.value;
		}

		if (clienteSeleccionado && clienteSeleccionado.value) {
			params.cliente_id = clienteSeleccionado.value;
		}

		if (filtroFechaDesde) {
			params.fecha_desde = filtroFechaDesde;
		}

		if (filtroFechaHasta) {
			params.fecha_hasta = filtroFechaHasta;
		}

		if (filtroFechaDesde || filtroFechaHasta) {
			params.campo_fecha = campoFecha;
		}

		console.log('📡 Enviando request con params:', params);
		await serviciosStore.obtenerServicios(params, forceRefresh);
	}

	// Debounce para la búsqueda
	function handleBusquedaChange() {
		if (!inicializado) return;

		clearTimeout(busquedaTimeout);
		busquedaTimeout = setTimeout(() => {
			paginaActual = 1;
			cargarServicios();
		}, 500); // 500ms de delay
	}

	// Reactividad para búsqueda
	$: if (inicializado && busqueda !== undefined) {
		handleBusquedaChange();
	}

	// Handler para cambios en filtros de estado
	function handleEstadoChange() {
		console.log(
			'🔔 handleEstadoChange llamado - inicializado:',
			inicializado,
			'estado:',
			filtroEstado
		);
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}

	// Handler para cambios en los selects (conductor, vehículo, cliente)
	function handleSelectChange() {
		console.log('🔔 handleSelectChange llamado - inicializado:', inicializado);
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}

	// Handler para cambios en fechas
	function handleFechaChange() {
		console.log('🔔 handleFechaChange llamado - inicializado:', inicializado);
		if (!inicializado) return;
		paginaActual = 1;
		cargarServicios();
	}

	// Handler para cambios en ordenamiento
	function handleOrdenChange() {
		console.log('🔔 handleOrdenChange llamado - inicializado:', inicializado);
		if (!inicializado) return;
		cargarServicios();
	}

	// Funciones de paginación
	async function irPagina(pagina: number) {
		if (pagina >= 1 && pagina <= totalPaginas) {
			paginaActual = pagina;
			await cargarServicios();
		}
	}

	function truncarTexto(texto: string, maxLength: number = 50): string {
		if (!texto) return '';
		return texto.length > maxLength ? texto.substring(0, maxLength) + '...' : texto;
	}

	// Inicializar
	onMount(async () => {
		console.log('🎬 [SERVICIOS PAGE] Montando componente...');

		try {
			// 1. Inicializar store de servicios (solo socket, sin cargar datos)
			console.log('� [SERVICIOS PAGE] Configurando socket...');
			await serviciosStore.inicializar();

			// 2. Cargar recursos básicos para los selects (conductores, vehículos, clientes, municipios)
			console.log('📦 [SERVICIOS PAGE] Cargando recursos para filtros...');
			await recursos.cargarTodos();

			// 3. Ahora sí, marcar como inicializado para activar watchers
			inicializado = true;
			console.log('✅ [SERVICIOS PAGE] Componente inicializado, watchers activos');

			// 4. Cargar servicios y stats manualmente UNA SOLA VEZ
			console.log('📊 [SERVICIOS PAGE] Cargando servicios y stats...');
			await cargarServicios();

			console.log('✅ [SERVICIOS PAGE] Componente montado completamente');
		} catch (error) {
			console.error('❌ [SERVICIOS PAGE] Error en onMount:', error);
		}
	});

	// Limpiar al desmontar
	onDestroy(() => {
		serviciosStore.limpiarSocket();
	});

	// Funciones
	function verDetalle(id: string) {
		goto(`/dashboard/servicios/${id}`);
	}

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
		await serviciosStore.obtenerStats(); // Recargar stats
		await cargarServicios(true); // Forzar recarga sin caché
	}

	// Modal form handlers
	function handleNuevoServicio() {
		servicioEditar = null;
		mostrarModalFormServicio = true;
	}

	function handleEditarServicio(servicio: ServicioConRelaciones) {
		servicioEditar = servicio;
		mostrarModalFormServicio = true;
	}

	function handleModalFormClose() {
		mostrarModalFormServicio = false;
		servicioEditar = null;
	}

	async function handleModalFormSuccess() {
		mostrarModalFormServicio = false;
		servicioEditar = null;
		// Reload services (las stats vienen incluidas en la respuesta)
		await serviciosStore.obtenerServicios({}, true); // Force refresh
	}

	// Función auxiliar para cambiar filtro de estado desde las stats cards
	function cambiarFiltroEstado(estado: EstadoServicio) {
		console.log('🎯 Cambiar filtro estado a:', estado);
		filtroEstado = estado;
		paginaActual = 1;
		cargarServicios();
	}

	// Generar y copiar link compartible
	async function handleCompartirServicio(servicio: ServicioConRelaciones) {
		try {
			let token: string | null | undefined = servicio.share_token;

			// Si no tiene token, generarlo
			if (!token) {
				token = await serviciosStore.generarShareToken(servicio.id);
				if (!token) {
					alert('Error al generar enlace compartible');
					return;
				}
			}

			// Construir URL pública
			const shareUrl = `${window.location.origin}/public/servicio/${token}`;

			// Copiar al portapapeles
			await navigator.clipboard.writeText(shareUrl);

			// Mostrar notificación (puedes usar una librería de toast aquí)
			alert('✅ Enlace copiado al portapapeles!\n\n' + shareUrl);
		} catch (error) {
			console.error('Error compartiendo servicio:', error);
			alert('Error al compartir servicio');
		}
	}

	// Función para solicitar eliminación
	function handleEliminarServicio(servicio: ServicioConRelaciones) {
		servicioAEliminar = servicio;
		mostrarModalConfirm = true;
	}

	// Función para confirmar eliminación
	async function confirmarEliminacion() {
		if (!servicioAEliminar) return;

		try {
			await serviciosStore.eliminar(servicioAEliminar.id);
			mostrarModalConfirm = false;
			servicioAEliminar = null;

			// Recargar servicios
			await cargarServicios(true);

			toast.success('Servicio eliminado exitosamente');
		} catch (error: any) {
			console.error('Error eliminando servicio:', error);
			toast.error('Error al eliminar servicio: ' + (error.message || 'Error desconocido'));
		}
	}

	// Función para cancelar eliminación
	function cancelarEliminacion() {
		mostrarModalConfirm = false;
		servicioAEliminar = null;
	}
</script>

<svelte:head>
	<title>Servicios - Cotransmeq</title>
</svelte:head>

<div class="space-y-6 p-6" style="overflow: visible;">
	<!-- Header con glassmorphism -->
	<div
		class="glass soft-shadow rounded-2xl border border-gray-200/50 p-6"
		style="overflow: visible; position: relative; z-index: 10;"
		in:fade={{ duration: 600, delay: 100 }}
	>
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<!-- Título y badge de conexión -->
			<div>
				<div class="mb-2 flex items-center gap-3">
					<div
						class="soft-shadow flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div>
						<h1 class="text-2xl font-bold text-gray-900">Gestión de Servicios</h1>
						<p class="text-sm text-gray-600">
							Administra y monitorea todos los servicios de transporte
						</p>
					</div>
				</div>

				<!-- Badge de conexión -->
				{#if socketConnected}
					<div class="mt-2 flex items-center gap-2" in:scale={{ duration: 300 }}>
						<div class="h-2 w-2 animate-pulse rounded-full bg-orange-500"></div>
						<span class="text-xs font-medium text-orange-600">Tiempo real activo</span>
					</div>
				{:else}
					<div class="mt-2 flex items-center gap-2" in:scale={{ duration: 300 }}>
						<div class="h-2 w-2 rounded-full bg-orange-500"></div>
						<span class="text-xs font-medium text-orange-600">Modo offline</span>
					</div>
				{/if}
			</div>

			<!-- Barra de búsqueda y filtros -->
			<div class="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
				<!-- Búsqueda -->
				<div class="relative flex-1 lg:w-80">
					<input
						type="text"
						bind:value={busqueda}
						placeholder="Buscar servicios..."
						class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 pl-10 text-gray-900 placeholder-gray-400 focus:border-orange-400"
					/>
					<svg
						class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</div>

				<!-- Botón filtros -->
				<button
					on:click={() => (mostrarFiltros = !mostrarFiltros)}
					class="apple-transition flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-medium text-gray-700 hover:border-orange-200 hover:bg-orange-50"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
						/>
					</svg>
					<span>Filtros</span>
				</button>

				<!-- Botón nuevo servicio -->
				<button
					on:click={handleNuevoServicio}
					class="apple-hover apple-transition soft-shadow orange-glow flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2.5 font-semibold text-white"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 6v6m0 0v6m0-6h6m-6 0H6"
						/>
					</svg>
					<span>Nuevo Servicio</span>
				</button>
			</div>
		</div>

		<!-- Panel de filtros expandible -->
		{#if mostrarFiltros}
			<div
				class="mt-6 border-t border-gray-200/50 pt-6"
				style="overflow: visible; position: relative; z-index: 90;"
				transition:fly={{ y: -20, duration: 300 }}
			>
				<!-- Filtros básicos -->
				<div
					class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
					style="overflow: visible;"
				>
					<!-- Filtro por estado -->
					<div>
						<label class="mb-2 block text-sm font-medium text-gray-700">
							<svg
								class="mr-1 inline h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							Estado
						</label>
						<select
							bind:value={filtroEstado}
							on:change={handleEstadoChange}
							class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:border-orange-400"
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

					<!-- Filtro por conductor -->
					<div style="position: relative; z-index: 5;">
						<label class="mb-2 block text-sm font-medium text-gray-700">
							<svg
								class="mr-1 inline h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
								/>
							</svg>
							Conductor
						</label>
						<Select
							items={conductores}
							bind:value={conductorSeleccionado}
							placeholder="Seleccione un conductor"
							searchable={true}
							clearable={true}
							on:change={handleSelectChange}
							on:clear={handleSelectChange}
							--background="white"
							--border="1px solid rgb(229, 231, 235)"
							--border-radius="0.75rem"
							--padding="0.625rem 1rem"
							--border-focused="1px solid rgb(52, 211, 153)"
							--list-z-index="99999"
						/>
					</div>
					<!-- Filtro por vehículo -->
					<div style="position: relative; z-index: 4;">
						<label class="mb-2 block text-sm font-medium text-gray-700">
							<svg
								class="mr-1 inline h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
								/>
							</svg>
							Vehículo
						</label>
						<Select
							items={vehiculos}
							bind:value={vehiculoSeleccionado}
							placeholder="Seleccione un vehículo"
							searchable={true}
							clearable={true}
							on:change={handleSelectChange}
							on:clear={handleSelectChange}
							--background="white"
							--border="1px solid rgb(229, 231, 235)"
							--border-radius="0.75rem"
							--padding="0.625rem 1rem"
							--border-focused="1px solid rgb(52, 211, 153)"
							--list-z-index="99999"
						/>
					</div>

					<!-- Filtro por cliente -->
					<div style="position: relative; z-index: 3;">
						<label class="mb-2 block text-sm font-medium text-gray-700">
							<svg
								class="mr-1 inline h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
								/>
							</svg>
							Cliente
						</label>
						<Select
							items={clientes}
							bind:value={clienteSeleccionado}
							placeholder="Seleccione un cliente"
							searchable={true}
							clearable={true}
							on:change={handleSelectChange}
							on:clear={handleSelectChange}
							--background="white"
							--border="1px solid rgb(229, 231, 235)"
							--border-radius="0.75rem"
							--padding="0.625rem 1rem"
							--border-focused="1px solid rgb(52, 211, 153)"
							--list-z-index="99999"
						/>
					</div>
				</div>

				<!-- Botones de acción y filtros avanzados -->
				<div class="flex items-center justify-between gap-4">
					<button
						on:click={() => (mostrarFiltrosAvanzados = !mostrarFiltrosAvanzados)}
						class="apple-transition flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
							/>
						</svg>
						<span>Filtros avanzados</span>
						<svg
							class="h-4 w-4 transition-transform {mostrarFiltrosAvanzados ? 'rotate-180' : ''}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</button>

					<button
						on:click={limpiarFiltros}
						class="apple-transition flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:border-red-300 hover:bg-red-50"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
						<span>Limpiar filtros</span>
					</button>
				</div>

				<!-- Filtros avanzados expandibles -->
				{#if mostrarFiltrosAvanzados}
					<div
						class="mt-4 border-t border-gray-200/50 pt-4"
						transition:fly={{ y: -10, duration: 200 }}
					>
						<div class="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
							<!-- Tipo de fecha -->
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									<svg
										class="mr-1 inline h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									Tipo de fecha
								</label>
								<select
									bind:value={campoFecha}
									on:change={handleFechaChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:border-orange-400"
								>
									<option value="fecha_solicitud">Fecha de solicitud</option>
									<option value="created_at">Fecha de creación</option>
									<option value="fecha_realizacion">Fecha de realización</option>
									<option value="fecha_finalizacion">Fecha de finalización</option>
								</select>
							</div>

							<!-- Fecha desde -->
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									<svg
										class="mr-1 inline h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
										/>
									</svg>
									Desde
								</label>
								<input
									type="date"
									bind:value={filtroFechaDesde}
									on:change={handleFechaChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:border-orange-400"
								/>
							</div>

							<!-- Fecha hasta -->
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									<svg
										class="mr-1 inline h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
										/>
									</svg>
									Hasta
								</label>
								<input
									type="date"
									bind:value={filtroFechaHasta}
									on:change={handleFechaChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:border-orange-400"
								/>
							</div>

							<!-- Ordenar por -->
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									<svg
										class="mr-1 inline h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
										/>
									</svg>
									Ordenar por
								</label>
								<select
									bind:value={ordenarPor}
									on:change={handleOrdenChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:border-orange-400"
								>
									<option value="fecha_solicitud">Fecha de solicitud</option>
									<option value="fecha_realizacion">Fecha de realización</option>
									<option value="estado">Estado</option>
									<option value="cliente">Cliente</option>
									<option value="conductor">Conductor</option>
								</select>
							</div>

							<!-- Dirección de orden -->
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									<svg
										class="mr-1 inline h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
										/>
									</svg>
									Dirección
								</label>
								<select
									bind:value={ordenDireccion}
									on:change={handleOrdenChange}
									class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:border-orange-400"
								>
									<option value="asc">Ascendente (A-Z, 1-9, Antiguo-Nuevo)</option>
									<option value="desc">Descendente (Z-A, 9-1, Nuevo-Antiguo)</option>
								</select>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Stats Cards -->
	{#if stats}
		<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
			<!-- Total -->
			<div
				class="glass soft-shadow apple-hover apple-transition rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 200 }}
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-gray-600">Total</span>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-gray-400 to-gray-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
				</div>
				<p class="text-2xl font-bold text-gray-900">{stats.total}</p>
			</div>

			<!-- Solicitados -->
			<div
				class="glass soft-shadow apple-hover apple-transition cursor-pointer rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 250 }}
				on:click={() => cambiarFiltroEstado('solicitado')}
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-gray-600">Solicitados</span>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
				</div>
				<p class="text-2xl font-bold text-blue-600">{stats.solicitado}</p>
			</div>

			<!-- En Curso -->
			<div
				class="glass soft-shadow apple-hover apple-transition cursor-pointer rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 300 }}
				on:click={() => cambiarFiltroEstado('en_curso')}
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-gray-600">En Curso</span>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							/>
						</svg>
					</div>
				</div>
				<p class="text-2xl font-bold text-amber-600">{stats.en_curso}</p>
			</div>

			<!-- Planificados -->
			<div
				class="glass soft-shadow apple-hover apple-transition cursor-pointer rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 350 }}
				on:click={() => cambiarFiltroEstado('planificado')}
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-gray-600">Planificados</span>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-400 to-violet-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 2z"
							/>
						</svg>
					</div>
				</div>
				<p class="text-2xl font-bold text-violet-600">{stats.planificado}</p>
			</div>

			<!-- Realizados -->
			<div
				class="glass soft-shadow apple-hover apple-transition cursor-pointer rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 400 }}
				on:click={() => cambiarFiltroEstado('realizado')}
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-gray-600">Realizados</span>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
				</div>
				<p class="text-2xl font-bold text-orange-600">{stats.realizado}</p>
			</div>

			<!-- Cancelados -->
			<div
				class="glass soft-shadow apple-hover apple-transition cursor-pointer rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 450 }}
				on:click={() => cambiarFiltroEstado('cancelado')}
			>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-medium text-gray-600">Cancelados</span>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-400 to-red-600"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
				</div>
				<p class="text-2xl font-bold text-red-600">{stats.cancelado}</p>
			</div>
		</div>
	{/if}

	<!-- Lista de servicios -->
	<div
		class="glass soft-shadow rounded-2xl border border-gray-200/50"
		style="overflow: visible;"
		in:fly={{ y: 20, duration: 600, delay: 500 }}
	>
		<div class="border-b border-gray-200/50 p-6">
			<div class="flex items-center justify-between">
				{#if busqueda || filtroEstado}
					<span class="text-sm text-gray-600">Filtros activos</span>
				{/if}
			</div>
		</div>

		{#if loading}
			<!-- Loading state -->
			<div class="flex flex-col items-center justify-center p-12">
				<div
					class="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
				></div>
				<p class="text-gray-600">Cargando servicios...</p>
			</div>
		{:else if servicios.length === 0}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center p-12">
				<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
					<svg class="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
				</div>
				<h3 class="mb-2 text-lg font-semibold text-gray-900">No hay servicios</h3>
				<p class="mb-6 text-center text-gray-600">
					{busqueda || filtroEstado
						? 'No se encontraron servicios con los filtros aplicados'
						: 'Comienza creando un nuevo servicio'}
				</p>
				{#if busqueda || filtroEstado}
					<button
						on:click={limpiarFiltros}
						class="apple-transition rounded-lg bg-orange-500 px-4 py-2 text-white hover:bg-orange-600"
					>
						Limpiar filtros
					</button>
				{/if}
			</div>
		{:else}
			<!-- Lista de servicios en cards -->
			<div class="space-y-3 p-4">
				{#each servicios as servicio, index (servicio?.id || `temp-${index}`)}
					<div
						class="apple-transition group overflow-hidden rounded-xl border border-gray-200/50 bg-white hover:border-orange-300 hover:shadow-md"
						in:fly={{ y: 20, duration: 400, delay: index * 50 }}
					>
						<!-- on:click={() => verDetalle(servicio.id)} -->
						<div class="flex h-full items-stretch">
							<!-- Columna izquierda: Estado visual -->
							<div
								class="w-1.5 flex-shrink-0"
								style="background-color: {getEstadoColor(servicio.estado)}"
							></div>

							<!-- Contenido principal -->
							<div class="flex min-w-0 flex-1 flex-col px-3 sm:px-4 py-2.5">
								<!-- Fila 1: Ruta, Cliente, Conductor, Vehículo -->
								<div class="mb-2 flex min-w-0 flex-col lg:flex-row items-start lg:items-center gap-3 lg:gap-4">
									<!-- Ruta (sin límite, flex-1) -->
									<div class="min-w-0 w-full lg:flex-1">
										<div class="flex items-start gap-1.5">
											<svg
												class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-500"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
												/>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
												/>
											</svg>
											<div class="min-w-0 flex-1">
												<p class="text-sm leading-tight font-semibold text-gray-900 break-words">
													{servicio.origen_especifico ||
														servicio.origen?.nombre_municipio ||
														'Origen no especificado'}
												</p>
												<div class="mt-0.5 flex items-center gap-1">
													<svg
														class="h-3 w-3 flex-shrink-0 text-gray-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M19 14l-7 7m0 0l-7-7m7 7V3"
														/>
													</svg>
													<p class="text-xs leading-tight text-gray-600 break-words">
														{servicio.destino_especifico ||
															servicio.destino?.nombre_municipio ||
															'Destino no especificado'}
													</p>
												</div>
											</div>
										</div>
									</div>

									<!-- Grid para Cliente, Conductor, Vehículo -->
									<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
										<!-- Cliente -->
										<div class="min-w-0 lg:w-48 lg:flex-shrink-0">
											<p class="mb-0.5 text-xs text-gray-500">Cliente</p>
											<p
												class="truncate text-sm font-medium text-gray-900"
												title={servicio.cliente?.nombre || 'Sin cliente'}
											>
												{servicio.cliente?.nombre || 'Sin cliente'}
											</p>
											{#if servicio.cliente?.nit}
												<p class="text-xs text-gray-500">NIT: {servicio.cliente.nit}</p>
											{/if}
										</div>

										<!-- Conductor -->
										<div class="min-w-0 lg:w-44 lg:flex-shrink-0">
											<p class="mb-0.5 text-xs text-gray-500">Conductor</p>
											{#if servicio.conductor}
												<p
													class="truncate text-sm text-gray-900"
													title="{servicio.conductor.nombre} {servicio.conductor.apellido}"
												>
													{servicio.conductor.nombre}
													{servicio.conductor.apellido}
												</p>
												{#if servicio.conductor.telefono}
													<p class="text-xs text-gray-500">{servicio.conductor.telefono}</p>
												{/if}
											{:else}
												<span class="text-sm text-gray-400 italic">Sin asignar</span>
											{/if}
										</div>

										<!-- Vehículo -->
										<div class="min-w-0 lg:w-32 lg:flex-shrink-0">
											<p class="mb-0.5 text-xs text-gray-500">Vehículo</p>
											{#if servicio.vehiculo}
												<p class="text-sm font-semibold text-gray-900">{servicio.vehiculo.placa}</p>
												<p class="truncate text-xs text-gray-500">
													{servicio.vehiculo.marca}
													{servicio.vehiculo.modelo}
												</p>
											{:else}
												<span class="text-sm text-gray-400 italic">Sin asignar</span>
											{/if}
										</div>
									</div>
								</div>

								<!-- Fila 2: Fechas, Acciones y Estado -->
								<div class="flex flex-col lg:grid lg:grid-cols-2 gap-3 lg:gap-4 border-t border-gray-100 pt-2">
									<!-- Columna 1: Fechas -->
									<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
										<!-- Fecha Creación -->
										{#if servicio.created_at}
											<div class="flex items-center gap-1.5">
												<span class="text-xs text-gray-500">Creación:</span>
												<span class="text-xs font-medium text-gray-700"
													>{formatDateTime(servicio.created_at)}</span
												>
											</div>
										{/if}

										<!-- Fecha Solicitud -->
										<div class="flex items-center gap-1.5">
											<span class="text-xs text-gray-500">Solicitud:</span>
											<span class="text-xs font-medium text-gray-700"
												>{formatDateTime(servicio.fecha_solicitud)}</span
											>
										</div>

										<!-- Fecha Realización -->
										{#if servicio.fecha_realizacion}
											<div class="flex items-center gap-1.5">
												<span class="text-xs text-gray-500">Realización:</span>
												<span class="text-xs font-medium text-gray-700"
													>{formatDateTime(servicio.fecha_realizacion)}</span
												>
											</div>
										{/if}

										<!-- Fecha Finalización -->
										{#if servicio.fecha_finalizacion}
											<div class="flex items-center gap-1.5">
												<span class="text-xs text-gray-500">Finalización:</span>
												<span class="text-xs font-medium text-gray-700"
													>{formatDateTime(servicio.fecha_finalizacion)}</span
												>
											</div>
										{/if}
									</div>

									<!-- Columna 2: Acciones y Estado -->
									<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 lg:gap-4">
										<!-- Acciones -->
										<div class="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
											<!-- Compartir -->
											<button
												on:click|stopPropagation={() => handleCompartirServicio(servicio)}
												class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-50"
												title="Compartir servicio"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
													/>
												</svg>
												<span class="hidden sm:inline">Compartir</span>
											</button>

											<!-- Ticket -->
											<button
												on:click|stopPropagation={() => {
													servicioSeleccionado = servicio;
													mostrarModalTicket = true;
												}}
												class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50"
												title="Ver ticket"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
													/>
												</svg>
												<span class="hidden sm:inline">Ticket</span>
											</button>

											<!-- Editar -->
											{#if ['solicitado', 'asignado', 'en_curso'].includes(servicio.estado)}
												<button
													on:click|stopPropagation={() => handleEditarServicio(servicio)}
													class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
													title="Editar servicio"
												>
													<svg
														class="h-4 w-4"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
														/>
													</svg>
													<span class="hidden sm:inline">Editar</span>
												</button>
											{/if}

											<!-- Eliminar -->
											<button
												on:click|stopPropagation={() => handleEliminarServicio(servicio)}
												class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
												title="Eliminar servicio"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/>
												</svg>
												<span class="hidden sm:inline">Eliminar</span>
											</button>

											<!-- Ver detalle -->
											<button
												on:click|stopPropagation={() => verDetalle(servicio.id)}
												class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-50"
												title="Ver detalle"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
													/>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
													/>
												</svg>
												<span class="hidden sm:inline">Ver detalle</span>
											</button>
										</div>

										<!-- Estado -->
										<div class="flex justify-center sm:justify-end">
											<span
												class="inline-flex items-center rounded-lg border px-3 py-1 text-xs font-semibold whitespace-nowrap"
												style="background-color: {getEstadoColor(
													servicio.estado
												)}15; border-color: {getEstadoColor(
													servicio.estado
												)}40; color: {getEstadoColor(servicio.estado)}"
											>
												{getEstadoText(servicio.estado)}
											</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<!-- Paginación -->
			{#if totalPaginas > 1}
				<div class="border-t border-gray-200/50 bg-gray-50/30 px-6 py-4">
					<div class="flex items-center justify-between">
						<!-- Información de página -->
						<div class="text-sm text-gray-700">
							Mostrando <span class="font-semibold"
								>{(pagination.page - 1) * pagination.limit + 1}</span
							>
							a
							<span class="font-semibold"
								>{Math.min(pagination.page * pagination.limit, pagination.total)}</span
							>
							de <span class="font-semibold">{pagination.total}</span> servicios
						</div>

						<!-- Controles de paginación -->
						<div class="flex items-center gap-2">
							<!-- Primera página -->
							<button
								on:click={() => irPagina(1)}
								disabled={pagination.page === 1 || loading}
								class="apple-transition rounded-lg border border-gray-200 px-3 py-2 text-sm {pagination.page ===
									1 || loading
									? 'cursor-not-allowed bg-gray-100 text-gray-400'
									: 'cursor-pointer bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50'}"
								title="Primera página"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
									/>
								</svg>
							</button>

							<!-- Página anterior -->
							<button
								on:click={() => irPagina(pagination.page - 1)}
								disabled={pagination.page === 1 || loading}
								class="apple-transition rounded-lg border border-gray-200 px-3 py-2 text-sm {pagination.page ===
									1 || loading
									? 'cursor-not-allowed bg-gray-100 text-gray-400'
									: 'cursor-pointer bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50'}"
								title="Página anterior"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 19l-7-7 7-7"
									/>
								</svg>
							</button>

							<!-- Números de página -->
							{#each Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
								const start = Math.max(1, Math.min(pagination.page - 2, totalPaginas - 4));
								return start + i;
							}) as pagina}
								<button
									on:click={() => irPagina(pagina)}
									disabled={loading}
									class="apple-transition cursor-pointer rounded-lg border px-4 py-2 text-sm {pagination.page ===
									pagina
										? 'border-orange-500 bg-orange-500 font-semibold text-white'
										: 'cursor-pointer border-gray-200 bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50'} {loading
										? 'cursor-not-allowed opacity-50'
										: ''}"
								>
									{pagina}
								</button>
							{/each}

							<!-- Página siguiente -->
							<button
								on:click={() => irPagina(pagination.page + 1)}
								disabled={pagination.page === totalPaginas || loading}
								class="apple-transition rounded-lg border border-gray-200 px-3 py-2 text-sm cursor-pointer{pagination.page ===
									totalPaginas || loading
									? 'cursor-not-allowed bg-gray-100 text-gray-400'
									: 'cursor-pointer bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50'}"
								title="Página siguiente"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/>
								</svg>
							</button>

							<!-- Última página -->
							<button
								on:click={() => irPagina(totalPaginas)}
								disabled={pagination.page === totalPaginas || loading}
								class="apple-transition rounded-lg border border-gray-200 px-3 py-2 text-sm {pagination.page ===
									totalPaginas || loading
									? 'cursor-not-allowed bg-gray-100 text-gray-400'
									: 'cursor-pointer bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50'}"
								title="Última página"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13 5l7 7-7 7M5 5l7 7-7 7"
									/>
								</svg>
							</button>
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Modal de Ticket -->
{#if mostrarModalTicket && servicioSeleccionado}
	<ModalTicket
		servicio={servicioSeleccionado}
		onClose={() => {
			mostrarModalTicket = false;
			servicioSeleccionado = null;
		}}
	/>
{/if}

<!-- Modal de Formulario de Servicio -->
{#if mostrarModalFormServicio}
	<ModalFormServicio
		isOpen={mostrarModalFormServicio}
		servicio={servicioEditar}
		onClose={handleModalFormClose}
		onSuccess={handleModalFormSuccess}
	/>
{/if}

<!-- Modal de Confirmación de Eliminación -->
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
