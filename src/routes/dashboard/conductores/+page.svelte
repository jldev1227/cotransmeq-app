<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly, fade, scale } from 'svelte/transition';
	import { conductoresAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';

	type EstadoConductor =
		| 'TODOS'
		| 'ACTIVO'
		| 'INACTIVO'
		| 'VACACIONES'
		| 'INCAPACITADO'
		| 'RETIRADO';

	interface Conductor {
		id: string;
		nombre: string;
		apellido: string;
		tipo_identificacion?: string;
		numero_identificacion: string;
		email?: string;
		telefono?: string;
		estado: EstadoConductor | string;
		sede_trabajo?: string;
		cargo?: string;
		categoria_licencia?: string;
		vencimiento_licencia?: string;
		tipo_sangre?: string;
		foto_signed_url?: string;
		fecha_ingreso?: string;
		created_at?: string;
	}

	let conductores: Conductor[] = [];
	let conductoresFiltrados: Conductor[] = [];
	let conductoresPaginaActual: Conductor[] = [];
	let isLoading = true;
	let error: string | null = null;
	let searchTerm = '';
	let filtroEstado: EstadoConductor = 'TODOS';
	let filtroSede: 'TODOS' | 'YOPAL' | 'VILLANUEVA' = 'TODOS';
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let mostrarOcultos = false; // Toggle para ver registros ocultos

	// Estados para modo selección
	let modoSeleccion = false;
	let conductoresSeleccionados = new Set<string>();
	let procesandoOcultar = false;

	let pagination = {
		page: 1,
		limit: 12,
		pages: 1,
		total: 0,
		hasNext: false,
		hasPrev: false
	};

	const hasValidData = (value: unknown) => {
		if (value === null || value === undefined) return false;
		if (typeof value === 'string') {
			const trimmed = value.trim().toLowerCase();
			if (!trimmed) return false;
			if (['null', 'undefined', 'n/a', 'na', 'sin dato', 's/d'].includes(trimmed)) return false;
		}
		return true;
	};

	const getFallbackText = (field: string) => {
		switch (field) {
			case 'telefono':
				return 'Teléfono no registrado';
			case 'email':
				return 'Sin correo electrónico';
			case 'cargo':
				return 'Cargo no asignado';
			case 'sede_trabajo':
				return 'Sede no definida';
			default:
				return 'No disponible';
		}
	};

	const formatDate = (dateStr?: string | null) => {
		if (!dateStr) return 'Sin fecha';
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) return 'Fecha inválida';
		return date.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: '2-digit'
		});
	};

	const getEstadoColor = (estado: string) => {
		switch (estado) {
			case 'ACTIVO':
				return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
			case 'INACTIVO':
				return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200';
			case 'VACACIONES':
				return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
			case 'INCAPACITADO':
				return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
			case 'RETIRADO':
				return 'bg-red-50 text-red-700 ring-1 ring-red-200';
			default:
				return 'bg-gray-50 text-gray-700 ring-1 ring-gray-200';
		}
	};

	const getEstadoLabel = (estado: EstadoConductor | string) => {
		switch (estado) {
			case 'ACTIVO':
				return 'Activo';
			case 'INACTIVO':
				return 'Inactivo';
			case 'VACACIONES':
				return 'En vacaciones';
			case 'INCAPACITADO':
				return 'Incapacitado';
			case 'RETIRADO':
				return 'Retirado';
			default:
				return 'Sin estado';
		}
	};

	const applyFilters = () => {
		let filtrados = [...conductores];

		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtrados = filtrados.filter((c) => {
				const nombreCompleto = `${c.nombre ?? ''} ${c.apellido ?? ''}`.toLowerCase();
				return (
					nombreCompleto.includes(term) ||
					(c.numero_identificacion ?? '').toString().toLowerCase().includes(term) ||
					(c.email ?? '').toLowerCase().includes(term) ||
					(c.cargo ?? '').toLowerCase().includes(term)
				);
			});
		}

		if (filtroEstado !== 'TODOS') {
			filtrados = filtrados.filter((c) => c.estado === filtroEstado);
		}

		if (filtroSede !== 'TODOS') {
			filtrados = filtrados.filter((c) => (c.sede_trabajo ?? '').toUpperCase() === filtroSede);
		}

		// Ordenar alfabéticamente por nombre (A-Z)
		filtrados.sort((a, b) => {
			const nombreA = `${a.nombre ?? ''} ${a.apellido ?? ''}`.toLowerCase();
			const nombreB = `${b.nombre ?? ''} ${b.apellido ?? ''}`.toLowerCase();
			return nombreA.localeCompare(nombreB, 'es');
		});

		conductoresFiltrados = filtrados;
		pagination.page = 1;
	};

	$: {
		const total = conductoresFiltrados.length;
		pagination.total = total;
		pagination.pages = Math.max(1, Math.ceil(total / pagination.limit));
		if (pagination.page > pagination.pages) pagination.page = pagination.pages;
		pagination.hasPrev = pagination.page > 1;
		pagination.hasNext = pagination.page < pagination.pages;
	}

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

	const handleEstadoChange = (event: Event) => {
		const target = event.target as HTMLSelectElement;
		filtroEstado = target.value as EstadoConductor;
		applyFilters();
	};

	const handleSedeChange = (event: Event) => {
		const target = event.target as HTMLSelectElement;
		filtroSede = target.value as 'TODOS' | 'YOPAL' | 'VILLANUEVA';
		applyFilters();
	};

	let stats = {
		total: 0,
		activos: 0,
		inactivos: 0,
		vacaciones: 0,
		yopal: 0,
		villanueva: 0
	};

	// Calcular estadísticas solo para conductores visibles (no ocultos)
	$: {
		console.log('🔍 [STATS] Recalculando estadísticas');
		console.log('🔍 [STATS] mostrarOcultos:', mostrarOcultos);
		console.log('🔍 [STATS] conductores.length:', conductores.length);
		console.log(
			'🔍 [STATS] conductores:',
			conductores.map((c) => ({
				id: c.id.substring(0, 8),
				nombre: c.nombre,
				apellido: c.apellido,
				estado: c.estado,
				sede: c.sede_trabajo
			}))
		);

		// Si estamos viendo ocultos, no mostramos stats (o mostramos stats diferentes)
		if (mostrarOcultos) {
			stats = {
				total: conductores.length,
				activos: 0,
				inactivos: 0,
				vacaciones: 0,
				yopal: 0,
				villanueva: 0
			};
		} else {
			// Stats normales - solo conductores visibles
			const total = conductores.length;
			stats = {
				total,
				activos: conductores.filter((c) => c.estado === 'ACTIVO').length,
				inactivos: conductores.filter((c) => c.estado === 'INACTIVO').length,
				vacaciones: conductores.filter((c) => c.estado === 'VACACIONES').length,
				yopal: conductores.filter((c) => (c.sede_trabajo ?? '').toUpperCase() === 'YOPAL').length,
				villanueva: conductores.filter((c) => (c.sede_trabajo ?? '').toUpperCase() === 'VILLANUEVA')
					.length
			};
		}

		console.log('🔍 [STATS] Resultado:', stats);
	}

	async function loadConductores() {
		isLoading = true;
		error = null;

		try {
			let data: Conductor[] = [];

			if (mostrarOcultos) {
				// Usar endpoint de ocultos con token del authStore
				const token = authStore.getToken();

				if (!token) {
					error = 'No hay sesión activa. Por favor inicia sesión nuevamente.';
					goto('/login');
					return;
				}

				const response = await fetch(`${import.meta.env.VITE_API_URL}/api/conductores/ocultos`, {
					headers: {
						Authorization: `Bearer ${token}`
					}
				});

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`);
				}

				const jsonData = await response.json();
				data = jsonData.data || [];
			} else {
				// Usar el API client normal que ya maneja el token
				console.log('📥 [LOAD] Cargando conductores visibles (no ocultos)...');
				const response = await conductoresAPI.getAll();
				console.log('📥 [LOAD] Respuesta completa del backend:', response);
				console.log('📥 [LOAD] response.data:', response.data);
				console.log('📥 [LOAD] response.data.data:', response.data.data);
				data = response.data.data || [];
				console.log('📥 [LOAD] Total conductores recibidos:', data.length);
				console.log(
					'📥 [LOAD] Conductores:',
					data.map((c) => ({
						id: c.id.substring(0, 8),
						nombre: c.nombre,
						apellido: c.apellido
					}))
				);
			}

			// Ordenar alfabéticamente por nombre (A-Z)
			data.sort((a, b) => {
				const nombreA = `${a.nombre ?? ''} ${a.apellido ?? ''}`.toLowerCase();
				const nombreB = `${b.nombre ?? ''} ${b.apellido ?? ''}`.toLowerCase();
				return nombreA.localeCompare(nombreB, 'es');
			});

			console.log('✅ [LOAD] Conductores después de ordenar:', data.length);
			conductores = data;
			conductoresFiltrados = data;
		} catch (err) {
			console.error('❌ [CONDUCTORES] Error cargando conductores:', err);
			console.error('❌ [CONDUCTORES] Detalle del error:', {
				message: err instanceof Error ? err.message : 'Error desconocido',
				response: (err as any).response,
				status: (err as any).response?.status,
				data: (err as any).response?.data
			});

			if (conductores.length === 0) {
				conductores = [];
				conductoresFiltrados = [];
			}

			if (err instanceof Error) {
				error = err.message;
				// Si es error de autenticación, redirigir a login
				if (err.message.includes('401') || err.message.includes('Unauthorized')) {
					goto('/login');
				}
			} else {
				error = 'Error desconocido al cargar conductores';
			}
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadConductores();

		// Suscribirse a eventos de WebSocket para conductores
		socketUtils.on('conductor:oculto', (data: { id: string; oculto: boolean }) => {
			if (data.oculto && !mostrarOcultos) {
				// Remover el conductor del array si fue ocultado y estamos en vista normal
				conductores = conductores.filter((c) => c.id !== data.id);
				applyFilters();
			} else if (!data.oculto && mostrarOcultos) {
				// Remover el conductor del array si fue restaurado y estamos en vista ocultos
				conductores = conductores.filter((c) => c.id !== data.id);
				applyFilters();
			}
		});
	});

	onDestroy(() => {
		// Limpiar listeners de WebSocket
		socketUtils.off('conductor:oculto');
	});

	function navigateToConductorProfile(conductorId: string) {
		goto(`/dashboard/conductores/${conductorId}`);
	}

	function navigateToAddConductor() {
		goto('/dashboard/conductores/agregar');
	}

	function toggleModoSeleccion() {
		modoSeleccion = !modoSeleccion;
		if (!modoSeleccion) {
			conductoresSeleccionados.clear();
			conductoresSeleccionados = conductoresSeleccionados; // Trigger reactivity
		}
	}

	function toggleSeleccionConductor(event: Event, conductorId: string) {
		event.stopPropagation();
		if (conductoresSeleccionados.has(conductorId)) {
			conductoresSeleccionados.delete(conductorId);
		} else {
			conductoresSeleccionados.add(conductorId);
		}
		conductoresSeleccionados = conductoresSeleccionados; // Trigger reactivity
	}

	async function ocultarConductoresSeleccionados() {
		if (conductoresSeleccionados.size === 0) return;

		procesandoOcultar = true;
		try {
			const token = authStore.getToken();

			if (!token) {
				error = 'No hay sesión activa. Por favor inicia sesión nuevamente.';
				goto('/login');
				return;
			}

			const promises = Array.from(conductoresSeleccionados).map(async (conductorId) => {
				const response = await fetch(
					`${import.meta.env.VITE_API_URL}/api/conductores/${conductorId}/ocultar`,
					{
						method: 'PATCH',
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({ oculto: true })
					}
				);

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`);
				}

				return response.json();
			});

			await Promise.all(promises);

			// Limpiar selección y salir del modo selección
			conductoresSeleccionados.clear();
			conductoresSeleccionados = conductoresSeleccionados;
			modoSeleccion = false;

			// Los conductores se eliminarán del array vía WebSocket
		} catch (err) {
			console.error('Error al ocultar conductores:', err);
			error = err instanceof Error ? err.message : 'Error al ocultar conductores seleccionados';

			// Si es error de autenticación, redirigir a login
			if (err instanceof Error && err.message.includes('401')) {
				goto('/login');
			}
		} finally {
			procesandoOcultar = false;
		}
	}

	async function restaurarConductoresSeleccionados() {
		if (conductoresSeleccionados.size === 0) return;

		procesandoOcultar = true;
		try {
			const token = authStore.getToken();

			if (!token) {
				error = 'No hay sesión activa. Por favor inicia sesión nuevamente.';
				goto('/login');
				return;
			}

			const promises = Array.from(conductoresSeleccionados).map(async (conductorId) => {
				const response = await fetch(
					`${import.meta.env.VITE_API_URL}/api/conductores/${conductorId}/ocultar`,
					{
						method: 'PATCH',
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({ oculto: false })
					}
				);

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`);
				}

				return response.json();
			});

			await Promise.all(promises);

			// Limpiar selección y salir del modo selección
			conductoresSeleccionados.clear();
			conductoresSeleccionados = conductoresSeleccionados;
			modoSeleccion = false;

			// Los conductores se eliminarán del array vía WebSocket
		} catch (err) {
			console.error('Error al restaurar conductores:', err);
			error = err instanceof Error ? err.message : 'Error al restaurar conductores seleccionados';

			// Si es error de autenticación, redirigir a login
			if (err instanceof Error && err.message.includes('401')) {
				goto('/login');
			}
		} finally {
			procesandoOcultar = false;
		}
	}

	function retryLoadConductores() {
		loadConductores();
	}

	$: conductoresPaginaActual = (() => {
		const startIndex = (pagination.page - 1) * pagination.limit;
		const endIndex = startIndex + pagination.limit;
		return conductoresFiltrados.slice(startIndex, endIndex);
	})();
</script>

<div class="min-h-screen p-6">
	<!-- Header Section -->
	<div class="glass mb-6 rounded-2xl border border-gray-200/50 p-6">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">Gestión de Conductores</h1>
				<p class="mt-1 text-sm text-gray-600">Administra y supervisa el personal de conducción</p>
			</div>
			<div class="flex items-center gap-3">
				<!-- Botón para ocultar/restaurar seleccionados (visible en modo selección) -->
				{#if modoSeleccion && conductoresSeleccionados.size > 0}
					<button
						on:click={mostrarOcultos
							? restaurarConductoresSeleccionados
							: ocultarConductoresSeleccionados}
						disabled={procesandoOcultar}
						class="apple-transition inline-flex items-center rounded-xl border-2 px-4 py-2.5 font-medium shadow-sm hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50
							{mostrarOcultos
							? 'border-orange-500 bg-orange-50 text-orange-700 hover:bg-orange-100'
							: 'border-red-500 bg-red-50 text-red-700 hover:bg-red-100'}"
						in:scale={{ duration: 200 }}
					>
						{#if procesandoOcultar}
							<svg
								class="mr-2 h-5 w-5 animate-spin"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							{mostrarOcultos ? 'Restaurando...' : 'Ocultando...'}
						{:else if mostrarOcultos}
							<svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
							Restaurar {conductoresSeleccionados.size} seleccionado{conductoresSeleccionados.size >
							1
								? 's'
								: ''}
						{:else}
							<svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
								/>
							</svg>
							Ocultar {conductoresSeleccionados.size} seleccionado{conductoresSeleccionados.size > 1
								? 's'
								: ''}
						{/if}
					</button>
				{/if}

				<!-- Botón de modo selección (visible tanto en vista normal como en ocultos) -->
				<button
					on:click={toggleModoSeleccion}
					class="apple-transition inline-flex items-center rounded-xl border-2 px-4 py-2.5 font-medium shadow-sm hover:shadow-md
						{modoSeleccion
						? 'border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100'
						: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}"
				>
					<svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						{#if modoSeleccion}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						{:else}
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
							/>
						{/if}
					</svg>
					{modoSeleccion ? 'Cancelar' : 'Seleccionar'}
				</button>

				<!-- Toggle para ver ocultos -->
				<div class="group relative">
					<button
						on:click={() => {
							mostrarOcultos = !mostrarOcultos;
							modoSeleccion = false;
							conductoresSeleccionados.clear();
							conductoresSeleccionados = conductoresSeleccionados;
							loadConductores();
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
						{mostrarOcultos ? 'Ver conductores activos' : 'Ver conductores ocultos'}
					</div>
				</div>

				<button
					on:click={navigateToAddConductor}
					class="apple-transition inline-flex items-center rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
				>
					<svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Nuevo Conductor
				</button>
			</div>
		</div>
	</div>

	<!-- Stats Cards -->
	{#if !mostrarOcultos}
		<div
			class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
			in:fly={{ y: 20, duration: 600, delay: 200 }}
		>
			<div class="glass rounded-xl border border-gray-200/50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium text-gray-600">Total Visibles</p>
						<p class="mt-1 text-2xl font-bold text-gray-900">{stats.total}</p>
					</div>
					<div class="rounded-lg bg-blue-50 p-2">
						<svg
							class="h-5 w-5 text-blue-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
							/>
						</svg>
					</div>
				</div>
			</div>

			<div class="glass rounded-xl border border-gray-200/50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium text-gray-600">Activos</p>
						<p class="mt-1 text-2xl font-bold text-orange-600">{stats.activos}</p>
					</div>
					<div class="rounded-lg bg-orange-50 p-2">
						<svg
							class="h-5 w-5 text-orange-600"
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
					</div>
				</div>
			</div>

			<div class="glass rounded-xl border border-gray-200/50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium text-gray-600">Inactivos</p>
						<p class="mt-1 text-2xl font-bold text-gray-600">{stats.inactivos}</p>
					</div>
					<div class="rounded-lg bg-gray-50 p-2">
						<svg
							class="h-5 w-5 text-gray-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
							/>
						</svg>
					</div>
				</div>
			</div>

			<div class="glass rounded-xl border border-gray-200/50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium text-gray-600">Vacaciones</p>
						<p class="mt-1 text-2xl font-bold text-blue-600">{stats.vacaciones}</p>
					</div>
					<div class="rounded-lg bg-blue-50 p-2">
						<svg
							class="h-5 w-5 text-blue-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
							/>
						</svg>
					</div>
				</div>
			</div>

			<div class="glass rounded-xl border border-gray-200/50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium text-gray-600">Yopal</p>
						<p class="mt-1 text-2xl font-bold text-purple-600">{stats.yopal}</p>
					</div>
					<div class="rounded-lg bg-purple-50 p-2">
						<svg
							class="h-5 w-5 text-purple-600"
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
					</div>
				</div>
			</div>

			<div class="glass rounded-xl border border-gray-200/50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium text-gray-600">Villanueva</p>
						<p class="mt-1 text-2xl font-bold text-amber-600">{stats.villanueva}</p>
					</div>
					<div class="rounded-lg bg-amber-50 p-2">
						<svg
							class="h-5 w-5 text-amber-600"
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
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- Stats para vista de ocultos -->
		<div class="mb-6" in:fly={{ y: 20, duration: 600, delay: 200 }}>
			<div class="glass rounded-xl border border-amber-200/50 bg-amber-50/30 p-4">
				<div class="flex items-center gap-3">
					<div class="rounded-lg bg-amber-100 p-3">
						<svg
							class="h-6 w-6 text-amber-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
							/>
						</svg>
					</div>
					<div>
						<p class="text-sm font-medium text-gray-600">Conductores Ocultos</p>
						<p class="text-2xl font-bold text-gray-900">{stats.total}</p>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Filters Section -->
	<div
		class="glass mb-6 rounded-2xl border border-gray-200/50 p-4"
		in:fly={{ y: 20, duration: 600, delay: 300 }}
	>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<label for="search" class="mb-2 block text-sm font-medium text-gray-700">
					Buscar conductor
				</label>
				<input
					id="search"
					type="text"
					value={searchTerm}
					on:input={handleSearchChange}
					placeholder="Nombre, cédula, email..."
					class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				/>
			</div>
			<div>
				<label for="estado" class="mb-2 block text-sm font-medium text-gray-700">Estado</label>
				<select
					id="estado"
					value={filtroEstado}
					on:change={handleEstadoChange}
					class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				>
					<option value="TODOS">Todos los estados</option>
					<option value="ACTIVO">Activo</option>
					<option value="INACTIVO">Inactivo</option>
					<option value="VACACIONES">Vacaciones</option>
					<option value="INCAPACITADO">Incapacitado</option>
					<option value="RETIRADO">Retirado</option>
				</select>
			</div>
			<div>
				<label for="sede" class="mb-2 block text-sm font-medium text-gray-700">Sede</label>
				<select
					id="sede"
					value={filtroSede}
					on:change={handleSedeChange}
					class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				>
					<option value="TODOS">Todas las sedes</option>
					<option value="YOPAL">Yopal</option>
					<option value="VILLANUEVA">Villanueva</option>
				</select>
			</div>
		</div>

		{#if searchTerm || filtroEstado !== 'TODOS' || filtroSede !== 'TODOS'}
			<div class="mt-4 flex flex-wrap gap-2">
				{#if searchTerm}
					<span
						class="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800"
					>
						Búsqueda: {searchTerm}
					</span>
				{/if}
				{#if filtroEstado !== 'TODOS'}
					<span
						class="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800"
					>
						Estado: {getEstadoLabel(filtroEstado)}
					</span>
				{/if}
				{#if filtroSede !== 'TODOS'}
					<span
						class="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-800"
					>
						Sede: {filtroSede}
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Grid de Conductores con Vista tipo cards -->
	{#if isLoading}
		<div
			class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3"
			in:fly={{ y: 20, duration: 600, delay: 400 }}
		>
			{#each Array(6) as _}
				<div class="glass animate-pulse rounded-2xl border border-gray-200/50 p-6">
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="h-12 w-12 rounded-full bg-gray-300"></div>
							<div>
								<div class="mb-2 h-5 w-32 rounded bg-gray-300"></div>
								<div class="h-4 w-20 rounded bg-gray-300"></div>
							</div>
						</div>
						<div class="h-6 w-16 rounded bg-gray-300"></div>
					</div>
					<div class="space-y-2">
						<div class="h-4 w-full rounded bg-gray-300"></div>
						<div class="h-4 w-3/4 rounded bg-gray-300"></div>
						<div class="h-4 w-1/2 rounded bg-gray-300"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if error && conductores.length === 0}
		<div class="glass rounded-2xl border border-red-200/50 bg-red-50/30 p-8 text-center">
			<div class="mb-4 text-red-500">
				<svg class="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<h3 class="mb-2 text-lg font-semibold text-gray-900">Error al cargar conductores</h3>
			<p class="mb-6 text-gray-600">{error}</p>
			<button
				on:click={retryLoadConductores}
				class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
			>
				<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				Reintentar
			</button>
		</div>
	{:else if conductoresFiltrados.length === 0}
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
			<h3 class="mb-2 text-lg font-semibold text-gray-900">No se encontraron conductores</h3>
			<p class="text-gray-600">
				{#if searchTerm}
					No hay conductores que coincidan con "{searchTerm}"
				{:else}
					Ajusta los filtros para ver más resultados
				{/if}
			</p>
		</div>
	{:else}
		<div
			class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
			in:fly={{ y: 20, duration: 600, delay: 400 }}
		>
			{#each conductoresPaginaActual as conductor (conductor.id)}
				<div
					class="glass apple-transition group rounded-xl border p-4 transition-all duration-200
						{modoSeleccion
						? 'cursor-default hover:shadow-lg'
						: 'cursor-pointer hover:scale-[1.01] hover:shadow-lg'}
						{conductoresSeleccionados.has(conductor.id)
						? 'border-purple-500 bg-purple-50/50 ring-2 ring-purple-300'
						: 'border-gray-200/50'}"
					in:fade={{ duration: 200 }}
					on:click={() => !modoSeleccion && navigateToConductorProfile(conductor.id)}
					on:keydown={(e) =>
						e.key === 'Enter' && !modoSeleccion && navigateToConductorProfile(conductor.id)}
					role="button"
					tabindex="0"
					aria-label={`Ver perfil de ${conductor.nombre} ${conductor.apellido}`}
				>
					<!-- Checkbox de selección (solo visible en modo selección) -->
					{#if modoSeleccion}
						<div class="mb-3 flex items-center justify-end" transition:scale={{ duration: 150 }}>
							<label class="flex cursor-pointer items-center gap-2">
								<input
									type="checkbox"
									checked={conductoresSeleccionados.has(conductor.id)}
									on:click={(e) => toggleSeleccionConductor(e, conductor.id)}
									class="h-5 w-5 cursor-pointer rounded border-gray-300 text-purple-600 focus:ring-2 focus:ring-purple-500 focus:ring-offset-0"
								/>
								<span class="text-sm font-medium text-gray-700">Seleccionar</span>
							</label>
						</div>
					{/if}

					<!-- Header de la Tarjeta -->
					<div class="mb-3 flex items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<div
								class="apple-transition flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-600 shadow-md
									{!modoSeleccion && 'group-hover:scale-110'}"
							>
								{#if conductor.foto_signed_url}
									<img
										src={conductor.foto_signed_url}
										alt={`${conductor.nombre} ${conductor.apellido}`}
										class="h-10 w-10 rounded-full object-cover"
									/>
								{:else}
									<span class="text-sm font-semibold text-white">
										{conductor.nombre.charAt(0)}{conductor.apellido.charAt(0)}
									</span>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<h3
									class="w-full max-w-xs truncate text-sm font-bold text-gray-900"
									title={`${conductor.nombre} ${conductor.apellido}`}
								>
									{`${conductor.nombre} ${conductor.apellido}`.length > 30
										? `${conductor.nombre} ${conductor.apellido}`.substring(0, 30) + '...'
										: `${conductor.nombre} ${conductor.apellido}`}
								</h3>
								<p class="text-xs text-gray-500">
									{conductor.numero_identificacion} · {conductor.tipo_identificacion || 'CC'}
								</p>
							</div>
						</div>
						<span
							class={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getEstadoColor(conductor.estado)}`}
						>
							{getEstadoLabel(conductor.estado as EstadoConductor)}
						</span>
					</div>

					<!-- Información Principal -->
					<div class="mb-3 space-y-2">
						<div class="flex items-center gap-1.5">
							<svg
								class="h-3.5 w-3.5 shrink-0 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21L6.374 11.5l8.25 8.25 2.113-3.85a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V20.72a2 2 0 01-2 2h-1.28C10.5 22.72 1.28 13.5 1.28 2.72V1.44a2 2 0 012-2H6.5z"
								/>
							</svg>
							<span class="text-xs text-gray-900">
								{hasValidData(conductor.telefono)
									? conductor.telefono
									: getFallbackText('telefono')}
							</span>
						</div>

						<div class="flex items-start gap-1.5">
							<svg
								class="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M3 8l7.89 7.89a2 2 0 002.83 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
								/>
							</svg>
							<span
								class="truncate text-xs text-gray-600"
								title={conductor.email || getFallbackText('email')}
							>
								{hasValidData(conductor.email) ? conductor.email : getFallbackText('email')}
							</span>
						</div>

						<div class="flex items-center gap-1.5">
							<svg
								class="h-3.5 w-3.5 shrink-0 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 11c0-1.657-1.343-3-3-3S6 9.343 6 11s1.343 3 3 3 3-1.343 3-3zM19 11c0-1.657-1.343-3-3-3s-3 1.343-3 3 1.343 3 3 3 3-1.343 3-3z"
								/>
							</svg>
							<span class="text-xs text-gray-600">
								{hasValidData(conductor.cargo) ? conductor.cargo : getFallbackText('cargo')}
							</span>
						</div>

						<div class="flex items-center gap-1.5">
							<svg
								class="h-3.5 w-3.5 shrink-0 text-gray-400"
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
							<span class="text-xs text-gray-600">
								{hasValidData(conductor.sede_trabajo)
									? conductor.sede_trabajo
									: getFallbackText('sede_trabajo')}
							</span>
						</div>
					</div>

					<!-- Características Especiales -->
					<div class="mb-3 flex flex-wrap gap-1.5">
						{#if hasValidData(conductor.categoria_licencia)}
							<span
								class="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700"
							>
								Licencia {conductor.categoria_licencia}
							</span>
						{/if}
						{#if hasValidData(conductor.tipo_sangre)}
							<span
								class="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
							>
								Tipo de sangre {conductor.tipo_sangre}
							</span>
						{/if}
						{#if hasValidData(conductor.vencimiento_licencia)}
							<span
								class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
							>
								Licencia vence {formatDate(conductor.vencimiento_licencia)}
							</span>
						{/if}
					</div>

					<!-- Acciones -->
					{#if !modoSeleccion}
						<div class="flex gap-2 border-t border-gray-200/50 pt-3">
							<button
								on:click|stopPropagation={() => navigateToConductorProfile(conductor.id)}
								class="apple-transition flex-1 rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100"
							>
								Ver Perfil
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Información de Paginación y Controles -->
		{#if pagination.total > 0}
			<div
				class="glass mt-6 rounded-xl border border-gray-200/50 p-4"
				in:fly={{ y: 20, duration: 600, delay: 500 }}
			>
				<div class="flex flex-col items-center justify-between gap-4 lg:flex-row">
					<!-- Info de registros -->
					<div class="flex items-center gap-3 text-xs text-gray-600">
						<div class="flex items-center gap-1.5">
							<svg
								class="h-3.5 w-3.5 text-orange-500"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2V7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 00-2 2h-2a2 2 0 00-2 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
							<span>
								<strong>{(pagination.page - 1) * pagination.limit + 1}</strong>
								-
								<strong>{Math.min(pagination.page * pagination.limit, pagination.total)}</strong>
								de <strong>{pagination.total}</strong>
							</span>
						</div>

						<div class="h-3 w-px bg-gray-300"></div>

						<div class="flex items-center gap-1.5">
							<span
								>Página <strong>{pagination.page}</strong> /
								<strong>{pagination.pages}</strong></span
							>
						</div>
					</div>

					<!-- Controles de navegación -->
					<div class="flex items-center gap-3">
						<div class="flex items-center gap-1">
							<button
								disabled={!pagination.hasPrev}
								on:click={previousPage}
								class="apple-transition rounded-lg border border-gray-300 bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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

							<div class="flex items-center gap-1">
								{#each getPageNumbers() as pageNum}
									{#if pageNum === '...'}
										<span class="px-2 text-xs text-gray-400">...</span>
									{:else}
										<button
											on:click={() => goToPage(pageNum as number)}
											class="apple-transition flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold shadow-sm {pageNum ===
											pagination.page
												? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md ring-2 ring-orange-300'
												: 'bg-white text-gray-700 hover:bg-gray-50'}"
										>
											{pageNum}
										</button>
									{/if}
								{/each}
							</div>

							<button
								disabled={!pagination.hasNext}
								on:click={nextPage}
								class="apple-transition rounded-lg border border-gray-300 bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
