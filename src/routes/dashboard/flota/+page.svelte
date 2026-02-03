<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { fade, fly } from 'svelte/transition';
	import ModalFormVehiculo from '$lib/components/vehiculos/ModalFormVehiculo.svelte';
	import ModalConfirmDelete from '$lib/components/vehiculos/ModalConfirmDelete.svelte';
	import { flotaStore } from '$lib/stores/flota';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';

	interface Vehiculo {
		id: string;
		placa: string;
		marca: string;
		modelo: string;
		linea?: string;
		color?: string;
		ano?: number;
		estado: string;
		clase_vehiculo?: string;
		tipo_carroceria?: string;
		combustible?: string;
		capacidad_pasajeros?: number;
		kilometraje?: number;
		conductor_id?: string | null;
		conductores?: {
			id: string;
			nombre: string;
			apellido: string;
		} | null;
		created_at?: string;
		isNew?: boolean;
	}

	let vehiculos: Vehiculo[] = [];
	let vehiculosFiltrados: Vehiculo[] = [];
	let vehiculosPaginaActual: Vehiculo[] = [];
	let isLoading = true;
	let error: string | null = null;
	let searchTerm = '';
	let estadoFilter = 'todos';
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	// Modal state
	let isModalOpen = false;
	let selectedVehiculoId: string | null = null;

	// Delete modal state
	let isDeleteModalOpen = false;
	let vehiculoToDelete: Vehiculo | null = null;

	// Estado para ver eliminados (solo administradores)
	let showDeleted = false;
	let vehiculosEliminados: Vehiculo[] = [];
	let mostrarOcultos = false; // Toggle para ver registros ocultos

	// Verificar si el usuario es administrador
	$: isAdmin = $authStore.user?.rol === 'administrador';

	// Pagination
	let pagination = {
		page: 1,
		limit: 12,
		pages: 1,
		total: 0,
		hasNext: false,
		hasPrev: false
	};

	// Stats - agrupados por los enums del backend
	$: stats = {
		total: vehiculos.length,
		disponible: vehiculos.filter((v) => {
			const estado = v.estado?.toUpperCase();
			return estado === 'DISPONIBLE' || estado === 'ACTIVO';
		}).length,
		noDisponible: vehiculos.filter((v) => {
			const estado = v.estado?.toUpperCase();
			return estado === 'NO_DISPONIBLE' || estado === 'NO DISPONIBLE';
		}).length,
		servicio: vehiculos.filter((v) => v.estado?.toUpperCase() === 'SERVICIO').length,
		mantenimiento: vehiculos.filter((v) => v.estado?.toUpperCase() === 'MANTENIMIENTO').length,
		inactivo: vehiculos.filter((v) => v.estado?.toUpperCase() === 'INACTIVO').length,
		desvinculado: vehiculos.filter((v) => v.estado?.toUpperCase() === 'DESVINCULADO').length
	};

	onMount(() => {
		loadVehiculos();
		setupSocketListeners();
	});

	onDestroy(() => {
		// Limpiar listeners de socket
		socketUtils.off('vehiculo-creado', handleVehiculoCreado);
		socketUtils.off('vehiculo-actualizado', handleVehiculoActualizado);
		socketUtils.off('vehiculo-estado', handleVehiculoEstado);
		socketUtils.off('vehiculo-eliminado', handleVehiculoEliminado);
		socketUtils.off('vehiculo-restaurado', handleVehiculoRestaurado);
	});

	function setupSocketListeners() {
		// Escuchar evento de vehículo creado
		socketUtils.on('vehiculo-creado', handleVehiculoCreado);

		// Escuchar evento de vehículo actualizado
		socketUtils.on('vehiculo-actualizado', handleVehiculoActualizado);

		// Escuchar evento de cambio de estado
		socketUtils.on('vehiculo-estado', handleVehiculoEstado);

		// Escuchar evento de vehículo eliminado
		socketUtils.on('vehiculo-eliminado', handleVehiculoEliminado);

		// Escuchar evento de vehículo restaurado
		socketUtils.on('vehiculo-restaurado', handleVehiculoRestaurado);
	}

	function handleVehiculoCreado(data: any) {
		console.log('Vehículo creado vía socket:', data);
		// El store ya lo agregó, solo necesitamos actualizar la lista local
		flotaStore.subscribe((state) => {
			vehiculos = state.vehiculos;
			applyFilters();
		})();
	}

	function handleVehiculoActualizado(data: any) {
		console.log('Vehículo actualizado vía socket:', data);
		const index = vehiculos.findIndex((v) => v.id === data.vehiculoId);
		if (index !== -1) {
			vehiculos[index] = { ...vehiculos[index], ...data.vehiculo };
			vehiculos = [...vehiculos];
			applyFilters();
		}
	}

	function handleVehiculoEstado(data: any) {
		console.log('Estado de vehículo actualizado vía socket:', data);
		const index = vehiculos.findIndex((v) => v.id === data.vehiculoId);
		if (index !== -1) {
			vehiculos[index].estado = data.estado;
			vehiculos = [...vehiculos];
			applyFilters();
		}
	}

	function handleVehiculoEliminado(data: any) {
		console.log('Vehículo eliminado vía socket:', data);
		// Remover del array local
		vehiculos = vehiculos.filter((v) => v.id !== data.vehiculoId);
		applyFilters();
	}

	function handleVehiculoRestaurado(data: any) {
		console.log('Vehículo restaurado vía socket:', data);
		// Recargar ambas listas
		loadVehiculos();
		if (showDeleted) {
			loadVehiculosEliminados();
		}
	}

	async function loadVehiculos() {
		try {
			isLoading = true;
			error = null;

			// Usar endpoint de ocultos si está activado el toggle
			const endpoint = mostrarOcultos ? '/vehiculos/ocultos' : '/vehiculos';
			const response = mostrarOcultos
				? await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
						headers: {
							Authorization: `Bearer ${localStorage.getItem('token')}`
						}
					}).then((r) => r.json())
				: await vehiculosAPI.getAll();

			// La API devuelve { success, data: [...], count }
			vehiculos = response.data.data || response.data || [];

			// Actualizar el store
			flotaStore.setVehiculos(vehiculos);

			vehiculosFiltrados = vehiculos;
			console.log('Vehículos cargados:', vehiculos);
		} catch (err: any) {
			error = err.response?.data?.message || 'Error al cargar vehículos';
			console.error('Error loading vehiculos:', err);
			vehiculos = [];
			vehiculosFiltrados = [];
			flotaStore.setError(error);
		} finally {
			isLoading = false;
		}
	}

	// Suscribirse al store para mantener sincronizados los vehículos
	flotaStore.subscribe((state) => {
		if (state.vehiculos.length > 0 && !isLoading) {
			vehiculos = state.vehiculos;
			applyFilters();
		}
	});

	const applyFilters = () => {
		let filtrados = [...vehiculos];

		// Filtro por búsqueda
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtrados = filtrados.filter((v) => {
				return (
					(v.placa ?? '').toLowerCase().includes(term) ||
					(v.marca ?? '').toLowerCase().includes(term) ||
					(v.modelo ?? '').toLowerCase().includes(term) ||
					(v.clase_vehiculo ?? '').toLowerCase().includes(term)
				);
			});
		}

		// Filtro por estado
		if (estadoFilter !== 'todos') {
			filtrados = filtrados.filter((v) => {
				const estado = v.estado?.toUpperCase();
				switch (estadoFilter) {
					case 'disponible':
						return estado === 'DISPONIBLE' || estado === 'ACTIVO';
					case 'noDisponible':
						return estado === 'NO_DISPONIBLE' || estado === 'NO DISPONIBLE';
					case 'servicio':
						return estado === 'SERVICIO';
					case 'mantenimiento':
						return estado === 'MANTENIMIENTO';
					case 'inactivo':
						return estado === 'INACTIVO';
					case 'desvinculado':
						return estado === 'DESVINCULADO';
					default:
						return true;
				}
			});
		}

		vehiculosFiltrados = filtrados;
		pagination.page = 1;
	};

	$: {
		const total = vehiculosFiltrados.length;
		pagination.total = total;
		pagination.pages = Math.max(1, Math.ceil(total / pagination.limit));
		if (pagination.page > pagination.pages) pagination.page = pagination.pages;
		pagination.hasPrev = pagination.page > 1;
		pagination.hasNext = pagination.page < pagination.pages;
	}

	$: vehiculosPaginaActual = (() => {
		const startIndex = (pagination.page - 1) * pagination.limit;
		const endIndex = startIndex + pagination.limit;
		return vehiculosFiltrados.slice(startIndex, endIndex);
	})();

	const getPageNumbers = () => {
		const pages: (number | string)[] = [];
		const totalPages = pagination.pages;
		const current = pagination.page;

		if (totalPages <= 7) {
			for (let i = 1; i <= totalPages; i += 1) pages.push(i);
			return pages;
		}

		pages.push(1);
		let start = Math.max(2, current - 1);
		let end = Math.min(totalPages - 1, current + 1);

		if (start > 2) pages.push('...');
		for (let i = start; i <= end; i += 1) pages.push(i);
		if (end < totalPages - 1) pages.push('...');
		pages.push(totalPages);
		return pages;
	};

	const goToPage = (page: number) => {
		if (page < 1 || page > pagination.pages || page === pagination.page) return;
		pagination.page = page;
	};

	const previousPage = () => {
		if (pagination.hasPrev) pagination.page -= 1;
	};

	const nextPage = () => {
		if (pagination.hasNext) pagination.page += 1;
	};

	const handleSearchChange = (event: Event) => {
		const target = event.target as HTMLInputElement;
		searchTerm = target.value;

		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			applyFilters();
		}, 300);
	};

	const handleEstadoFilterChange = (event: Event) => {
		const target = event.target as HTMLSelectElement;
		estadoFilter = target.value;
		applyFilters();
	};

	function handleOpenModal(vehiculoId: string | null = null) {
		selectedVehiculoId = vehiculoId;
		isModalOpen = true;
	}

	function handleModalClose() {
		isModalOpen = false;
		selectedVehiculoId = null;
	}

	function handleModalSuccess() {
		// No necesitamos recargar, el store ya se actualizó
		console.log('Modal cerrado con éxito');
	}

	function handleOpenDeleteModal(vehiculo: Vehiculo) {
		vehiculoToDelete = vehiculo;
		isDeleteModalOpen = true;
	}

	function handleDeleteModalClose() {
		isDeleteModalOpen = false;
		vehiculoToDelete = null;
	}

	function handleDeleteSuccess() {
		console.log('Vehículo eliminado con éxito');
	}

	async function loadVehiculosEliminados() {
		try {
			isLoading = true;
			const response = await vehiculosAPI.getDeleted();
			vehiculosEliminados = response.data.data || [];
		} catch (err: any) {
			console.error('Error al cargar vehículos eliminados:', err);
			error = 'Error al cargar vehículos eliminados';
		} finally {
			isLoading = false;
		}
	}

	async function handleRestore(vehiculoId: string) {
		try {
			await vehiculosAPI.restore(vehiculoId);

			// Emitir evento por socket
			socketUtils.emit('vehiculo-restaurado', { vehiculoId });

			// Recargar ambas listas
			await loadVehiculos();
			await loadVehiculosEliminados();
		} catch (err: any) {
			console.error('Error al restaurar vehículo:', err);
			alert('Error al restaurar el vehículo');
		}
	}

	function toggleShowDeleted() {
		showDeleted = !showDeleted;
		if (showDeleted && vehiculosEliminados.length === 0) {
			loadVehiculosEliminados();
		}
	}

	function handleUbicacionUpdate(data: any) {
		// Future implementation for real-time updates
		console.log('Ubicación actualizada:', data);
	}

	function getStatusColor(estado: string) {
		const estadoUpper = estado?.toUpperCase();
		switch (estadoUpper) {
			case 'ACTIVO':
			case 'DISPONIBLE':
				return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
			case 'SERVICIO':
				return 'bg-purple-50 text-purple-700 ring-1 ring-purple-200';
			case 'MANTENIMIENTO':
				return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
			case 'INACTIVO':
				return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200';
			case 'NO_DISPONIBLE':
			case 'NO DISPONIBLE':
				return 'bg-red-50 text-red-700 ring-1 ring-red-200';
			case 'DESVINCULADO':
				return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	}

	function getEstadoLabel(estado: string) {
		const estadoUpper = estado?.toUpperCase();
		switch (estadoUpper) {
			case 'ACTIVO':
			case 'DISPONIBLE':
				return 'Disponible';
			case 'SERVICIO':
				return 'En Servicio';
			case 'MANTENIMIENTO':
				return 'Mantenimiento';
			case 'INACTIVO':
				return 'Inactivo';
			case 'NO_DISPONIBLE':
			case 'NO DISPONIBLE':
				return 'No Disponible';
			case 'DESVINCULADO':
				return 'Desvinculado';
			default:
				return estado || 'Sin estado';
		}
	}

	function getCombustibleColor(nivel: number) {
		if (nivel >= 70) return 'text-orange-600';
		if (nivel >= 30) return 'text-yellow-600';
		return 'text-red-600';
	}
</script>

<svelte:head>
	<title>Flota de Vehículos - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen p-6">
	<!-- Header -->
	<div class="glass mb-6 rounded-2xl border border-gray-200/50 p-6">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">Gestión de Flota</h1>
				<p class="mt-1 text-sm text-gray-600">
					Monitorea y administra todos los vehículos de la empresa
				</p>
			</div>
			<div class="flex items-center gap-3">
				<!-- Toggle para ver ocultos -->
				<div class="group relative">
					<button
						on:click={() => {
							mostrarOcultos = !mostrarOcultos;
							loadVehiculos();
						}}
						class="apple-transition inline-flex items-center rounded-xl border-2 px-4 py-2.5 font-medium shadow-sm hover:shadow-md
							{mostrarOcultos
							? 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100'
							: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							{#if mostrarOcultos}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
								/>
							{:else}
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
							{/if}
						</svg>
					</button>
					<!-- Tooltip -->
					<div
						class="pointer-events-none absolute top-full right-0 mt-2 w-max rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
					>
						{mostrarOcultos ? 'Ver vehículos activos' : 'Ver vehículos ocultos'}
					</div>
				</div>

				<button
					on:click={() => handleOpenModal()}
					class="apple-hover apple-transition soft-shadow inline-flex items-center rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white"
				>
					<svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Registrar Vehículo
				</button>
			</div>
		</div>
	</div>

	<!-- Stats Cards -->
	<div
		class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6"
		in:fly={{ y: 20, duration: 600, delay: 200 }}
	>
		<!-- Total -->
		<button
			on:click={() => {
				estadoFilter = 'todos';
				applyFilters();
			}}
			class="glass apple-transition rounded-xl border border-gray-200/50 p-4 text-left hover:shadow-lg {estadoFilter ===
			'todos'
				? 'ring-2 ring-blue-500'
				: ''}"
		>
			<div class="flex items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M8 9l4-4 4 4m0 6l-4 4-4-4"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<p class="text-xs font-medium text-gray-600">Total</p>
					<p class="text-xl font-bold text-gray-900">{stats.total}</p>
				</div>
			</div>
		</button>

		<!-- Disponible -->
		<button
			on:click={() => {
				estadoFilter = 'disponible';
				applyFilters();
			}}
			class="glass apple-transition rounded-xl border border-gray-200/50 p-4 text-left hover:shadow-lg {estadoFilter ===
			'disponible'
				? 'ring-2 ring-orange-500'
				: ''}"
		>
			<div class="flex items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<p class="text-xs font-medium text-gray-600">Disponible</p>
					<p class="text-xl font-bold text-gray-900">{stats.disponible}</p>
				</div>
			</div>
		</button>

		<!-- En Servicio -->
		<button
			on:click={() => {
				estadoFilter = 'servicio';
				applyFilters();
			}}
			class="glass apple-transition rounded-xl border border-gray-200/50 p-4 text-left hover:shadow-lg {estadoFilter ===
			'servicio'
				? 'ring-2 ring-purple-500'
				: ''}"
		>
			<div class="flex items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-400 to-purple-600"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M13 10V3L4 14h7v7l9-11h-7z"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<p class="text-xs font-medium text-gray-600">Servicio</p>
					<p class="text-xl font-bold text-gray-900">{stats.servicio}</p>
				</div>
			</div>
		</button>

		<!-- Mantenimiento -->
		<button
			on:click={() => {
				estadoFilter = 'mantenimiento';
				applyFilters();
			}}
			class="glass apple-transition rounded-xl border border-gray-200/50 p-4 text-left hover:shadow-lg {estadoFilter ===
			'mantenimiento'
				? 'ring-2 ring-orange-500'
				: ''}"
		>
			<div class="flex items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<p class="text-xs font-medium text-gray-600">Mantenimiento</p>
					<p class="text-xl font-bold text-gray-900">{stats.mantenimiento}</p>
				</div>
			</div>
		</button>

		<!-- Inactivo -->
		<button
			on:click={() => {
				estadoFilter = 'inactivo';
				applyFilters();
			}}
			class="glass apple-transition rounded-xl border border-gray-200/50 p-4 text-left hover:shadow-lg {estadoFilter ===
			'inactivo'
				? 'ring-2 ring-gray-500'
				: ''}"
		>
			<div class="flex items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-gray-400 to-gray-600"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<p class="text-xs font-medium text-gray-600">Inactivo</p>
					<p class="text-xl font-bold text-gray-900">{stats.inactivo}</p>
				</div>
			</div>
		</button>

		<!-- No Disponible -->
		<button
			on:click={() => {
				estadoFilter = 'noDisponible';
				applyFilters();
			}}
			class="glass apple-transition rounded-xl border border-gray-200/50 p-4 text-left hover:shadow-lg {estadoFilter ===
			'noDisponible'
				? 'ring-2 ring-red-500'
				: ''}"
		>
			<div class="flex items-center">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-red-400 to-red-600"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<p class="text-xs font-medium text-gray-600">No Disponible</p>
					<p class="text-xl font-bold text-gray-900">{stats.noDisponible}</p>
				</div>
			</div>
		</button>
	</div>

	<!-- Search and Filters -->
	<div class="glass mb-6 rounded-2xl border border-gray-200/50 p-4">
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<label for="search" class="mb-2 block text-sm font-medium text-gray-700">
					Buscar vehículo
				</label>
				<input
					id="search"
					type="text"
					value={searchTerm}
					on:input={handleSearchChange}
					placeholder="Placa, marca, modelo, clase..."
					class="h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				/>
			</div>
			<div>
				<label for="estadoFilter" class="mb-2 block text-sm font-medium text-gray-700">
					Filtrar por estado
				</label>
				<select
					id="estadoFilter"
					value={estadoFilter}
					on:change={handleEstadoFilterChange}
					class="h-10 w-full rounded-lg border border-gray-300 bg-white px-4 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				>
					<option value="todos">Todos los estados</option>
					<option value="disponible">Disponible</option>
					<option value="servicio">En Servicio</option>
					<option value="mantenimiento">Mantenimiento</option>
					<option value="inactivo">Inactivo</option>
					<option value="noDisponible">No Disponible</option>
					<option value="desvinculado">Desvinculado</option>
				</select>
			</div>
		</div>

		<!-- Toggle para ver eliminados (solo administradores) -->
		{#if isAdmin}
			<div class="mt-4 flex items-center justify-between border-t border-gray-200/50 pt-4">
				<div class="flex items-center gap-2">
					<svg class="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					<span class="text-sm font-medium text-gray-700">Ver vehículos eliminados</span>
				</div>
				<button
					on:click={toggleShowDeleted}
					class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {showDeleted
						? 'bg-red-600'
						: 'bg-gray-300'}"
				>
					<span
						class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {showDeleted
							? 'translate-x-6'
							: 'translate-x-1'}"
					></span>
				</button>
			</div>
		{/if}
	</div>

	<!-- Vehicles Grid -->
	{#if isLoading}
		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each Array(8) as _}
				<div class="glass animate-pulse rounded-2xl border border-gray-200/50 p-6">
					<div class="mb-4 flex items-center justify-between">
						<div class="h-6 w-20 rounded bg-gray-300"></div>
						<div class="h-6 w-16 rounded bg-gray-300"></div>
					</div>
					<div class="mb-2 h-4 w-full rounded bg-gray-300"></div>
					<div class="h-4 w-3/4 rounded bg-gray-300"></div>
				</div>
			{/each}
		</div>
	{:else if error && vehiculos.length === 0}
		<div class="glass rounded-2xl border border-red-200/50 bg-red-50/30 p-8 text-center">
			<div class="mb-4 text-red-500">
				<svg class="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<p class="mb-4 text-gray-600">{error}</p>
			<button class="font-medium text-orange-600 hover:text-orange-700" on:click={loadVehiculos}>
				Intentar nuevamente
			</button>
		</div>
	{:else if vehiculosFiltrados.length === 0}
		<div class="glass rounded-2xl border border-gray-200/50 p-8 text-center">
			<svg
				class="mx-auto mb-4 h-16 w-16 text-gray-400"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<h3 class="mb-2 text-lg font-semibold text-gray-900">No se encontraron vehículos</h3>
			<p class="text-gray-600">
				{#if searchTerm}
					No hay vehículos que coincidan con "{searchTerm}"
				{:else}
					No hay vehículos registrados
				{/if}
			</p>
		</div>
	{:else}
		<div
			class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
			in:fly={{ y: 20, duration: 600, delay: 400 }}
		>
			{#each vehiculosPaginaActual as vehiculo (vehiculo.id)}
				<div
					class="glass apple-transition rounded-2xl border p-6 hover:shadow-lg {vehiculo.isNew
						? 'border-orange-500 ring-2 ring-orange-200'
						: 'border-gray-200/50'}"
					in:fade={{ delay: 100 }}
				>
					<!-- Header -->
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center space-x-3">
							<div
								class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br {vehiculo.isNew
									? 'from-orange-500 to-orange-700 ring-2 ring-orange-300'
									: 'from-orange-400 to-orange-600'}"
							>
								<svg
									class="h-5 w-5 text-white"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M8 9l4-4 4 4m0 6l-4 4-4-4"
									/>
								</svg>
							</div>
							<div>
								<div class="flex items-center gap-2">
									<h3 class="font-semibold text-gray-900">{vehiculo.placa}</h3>
									{#if vehiculo.isNew}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-200"
											in:fly={{ x: -10, duration: 300, delay: 200 }}
										>
											<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
												<path
													d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
												/>
											</svg>
											NUEVO
										</span>
									{/if}
								</div>
								<p class="text-sm text-gray-500">
									{vehiculo.marca}
									{vehiculo.linea || vehiculo.modelo}
								</p>
							</div>
						</div>
						<span
							class="inline-flex rounded-full px-2 py-1 text-xs font-semibold {getStatusColor(
								vehiculo.estado
							)}"
						>
							{getEstadoLabel(vehiculo.estado)}
						</span>
					</div>

					<!-- Vehicle Info -->
					<div class="space-y-3">
						{#if vehiculo.modelo}
							<div class="flex items-center justify-between">
								<span class="text-sm text-gray-600">Modelo:</span>
								<span class="text-sm font-medium text-gray-900">{vehiculo.modelo}</span>
							</div>
						{/if}

						{#if vehiculo.color}
							<div class="flex items-center justify-between">
								<span class="text-sm text-gray-600">Color:</span>
								<span class="text-sm font-medium text-gray-900">{vehiculo.color}</span>
							</div>
						{/if}

						{#if vehiculo.clase_vehiculo}
							<div class="flex items-center justify-between">
								<span class="text-sm text-gray-600">Clase:</span>
								<span class="text-sm font-medium text-gray-900">{vehiculo.clase_vehiculo}</span>
							</div>
						{/if}

						<div class="flex items-center justify-between">
							<span class="text-sm text-gray-600">Conductor:</span>
							<span class="text-sm font-medium text-gray-900">
								{#if vehiculo.conductores}
									{vehiculo.conductores.nombre}
									{vehiculo.conductores.apellido}
								{:else}
									No asignado
								{/if}
							</span>
						</div>
					</div>
					<!-- Actions -->
					<div class="mt-4 flex space-x-2 border-t border-gray-200/50 pt-4">
						<button
							on:click={() => handleOpenModal(vehiculo.id)}
							class="apple-transition flex-1 rounded-lg bg-blue-50 py-2 text-sm text-blue-700 hover:bg-blue-100"
						>
							Editar
						</button>
						<button
							on:click={() => handleOpenDeleteModal(vehiculo)}
							class="apple-transition rounded-lg bg-red-50 px-3 py-2 text-red-700 hover:bg-red-100"
							title="Eliminar vehículo"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
						</button>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if pagination.total > pagination.limit}
			<div
				class="glass mt-6 rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 500 }}
			>
				<div class="flex flex-col items-center justify-between gap-4 lg:flex-row">
					<!-- Info de registros -->
					<div class="text-sm text-gray-600">
						Mostrando {(pagination.page - 1) * pagination.limit + 1} a {Math.min(
							pagination.page * pagination.limit,
							pagination.total
						)} de {pagination.total} vehículos
					</div>

					<!-- Controles de navegación -->
					<div class="flex items-center gap-2">
						<button
							on:click={previousPage}
							disabled={!pagination.hasPrev}
							class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Anterior
						</button>

						<div class="flex items-center gap-1">
							{#each getPageNumbers() as pageNum}
								{#if pageNum === '...'}
									<span class="px-2 text-gray-400">...</span>
								{:else}
									<button
										on:click={() => goToPage(Number(pageNum))}
										class="h-8 w-8 rounded-lg text-sm transition-colors {pageNum === pagination.page
											? 'bg-orange-500 text-white'
											: 'hover:bg-gray-100'}"
									>
										{pageNum}
									</button>
								{/if}
							{/each}
						</div>

						<button
							on:click={nextPage}
							disabled={!pagination.hasNext}
							class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Siguiente
						</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Sección de vehículos eliminados (solo administradores) -->
	{#if isAdmin && showDeleted}
		<div class="mt-8" in:fly={{ y: 20, duration: 400 }}>
			<div class="mb-4 flex items-center gap-2">
				<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
					/>
				</svg>
				<h2 class="text-2xl font-bold text-gray-900">Vehículos Eliminados</h2>
				<span class="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
					{vehiculosEliminados.length}
				</span>
			</div>

			{#if vehiculosEliminados.length === 0}
				<div class="glass rounded-xl border border-gray-200/50 p-12 text-center">
					<p class="text-gray-500">No hay vehículos eliminados</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each vehiculosEliminados as vehiculo (vehiculo.id)}
						<div
							class="glass rounded-2xl border border-red-200 bg-red-50/30 p-6"
							in:fade={{ delay: 100 }}
						>
							<!-- Header -->
							<div class="mb-4 flex items-center justify-between">
								<div class="flex items-center space-x-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-400 to-red-600"
									>
										<svg
											class="h-5 w-5 text-white"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="1.5"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7"
											/>
										</svg>
									</div>
									<div>
										<h3 class="font-semibold text-gray-900">{vehiculo.placa}</h3>
										<p class="text-sm text-gray-500">
											{vehiculo.marca}
											{vehiculo.linea || vehiculo.modelo}
										</p>
									</div>
								</div>
							</div>

							<!-- Vehicle Info -->
							<div class="space-y-2">
								{#if vehiculo.clase_vehiculo}
									<div class="flex items-center justify-between">
										<span class="text-sm text-gray-600">Clase:</span>
										<span class="text-sm font-medium text-gray-900">{vehiculo.clase_vehiculo}</span>
									</div>
								{/if}

								<div class="flex items-center justify-between">
									<span class="text-sm text-gray-600">Conductor:</span>
									<span class="text-sm font-medium text-gray-900">
										{#if vehiculo.conductores}
											{vehiculo.conductores.nombre}
											{vehiculo.conductores.apellido}
										{:else}
											No asignado
										{/if}
									</span>
								</div>
							</div>

							<!-- Restore Button -->
							<div class="mt-4 border-t border-red-200 pt-4">
								<button
									on:click={() => handleRestore(vehiculo.id)}
									class="apple-transition w-full rounded-lg bg-orange-500 py-2 text-sm font-medium text-white hover:bg-orange-600"
								>
									<div class="flex items-center justify-center gap-2">
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
											/>
										</svg>
										<span>Restaurar</span>
									</div>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal -->
<ModalFormVehiculo
	bind:isOpen={isModalOpen}
	vehiculoId={selectedVehiculoId}
	on:close={handleModalClose}
	on:success={handleModalSuccess}
/>

<!-- Modal de Confirmación de Eliminación -->
<ModalConfirmDelete
	bind:isOpen={isDeleteModalOpen}
	vehiculo={vehiculoToDelete}
	on:close={handleDeleteModalClose}
	on:success={handleDeleteSuccess}
/>
