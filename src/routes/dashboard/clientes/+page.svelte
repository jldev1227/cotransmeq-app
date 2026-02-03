<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { clientesAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';

	// Constante para TipoCliente
	const TipoCliente = {
		EMPRESA: 'EMPRESA',
		PERSONA_NATURAL: 'PERSONA_NATURAL'
	} as const;

	type TipoCliente = (typeof TipoCliente)[keyof typeof TipoCliente];

	// Interface para Cliente (actualizada según API response)
	interface Cliente {
		id: string;
		nit: string;
		nombre: string;
		representante: string | null;
		cedula: string | null;
		telefono: string;
		direccion: string;
		correo: string | null; // Puede ser null según la API
		requiere_osi: boolean;
		paga_recargos: boolean;
		tipo: TipoCliente;
		createdAt: string;
		updatedAt: string;
		deletedAt?: string | null; // Campo adicional de la API
		_count?: {
			// Contadores adicionales de la API
			recargos: number;
			pernotes: number;
			servicio: number;
		};
		showDropdown?: boolean; // Propiedad opcional para el dropdown
	}

	// Estado del componente
	let clientes: Cliente[] = [];
	let pagination = {
		page: 1,
		limit: 10,
		total: 0,
		pages: 0,
		hasNext: false,
		hasPrev: false
	};
	let isLoading = false;
	let error: string | null = null;
	let filtroTipo: TipoCliente | 'TODOS' = 'TODOS';
	let searchTerm = '';
	let selectedCliente: Cliente | null = null;
	let searchTimeout: NodeJS.Timeout;
	let mostrarOcultos = false; // Toggle para ver registros ocultos

	// Modal de confirmación para eliminar
	let showDeleteModal = false;
	let clienteToDelete: Cliente | null = null;
	// Función para abrir el modal de confirmación de borrado
	function openDeleteModal(cliente: Cliente) {
		clienteToDelete = cliente;
		showDeleteModal = true;
	}

	// Función para cerrar el modal
	function closeDeleteModal() {
		showDeleteModal = false;
		clienteToDelete = null;
	}

	// Función para eliminar (soft delete) un cliente
	async function deleteCliente() {
		if (!clienteToDelete) return;
		isLoading = true;
		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/clientes/${clienteToDelete.id}`,
				{
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' }
				}
			);
			if (!response.ok) {
				throw new Error('Error al eliminar el cliente');
			}
			// Eliminar del array local
			clientes = clientes.filter((c) => c.id !== clienteToDelete?.id);
			closeDeleteModal();
		} catch (err: any) {
			error = err.message || 'Error al eliminar el cliente';
		} finally {
			isLoading = false;
		}
	}

	// Reactive statements para manejar cambios en búsqueda y filtros
	$: {
		if (searchTerm !== '' && typeof searchTerm === 'string') {
			handleSearch();
		}
	}

	$: {
		if (filtroTipo !== 'TODOS') {
			handleFilterChange();
		}
	}

	// Filtrado reactivo - solo para vista local, el filtrado real se hace en el servidor
	$: clientesFiltrados = clientes;

	// Estadísticas (usar el total de la API cuando esté disponible)
	$: stats = {
		total: pagination.total || clientes.length,
		totalPagina: clientes.length,
		empresas: clientes.filter((c) => c.tipo === TipoCliente.EMPRESA).length,
		personasNaturales: clientes.filter((c) => c.tipo === TipoCliente.PERSONA_NATURAL).length,
		conOSI: clientes.filter((c) => c.requiere_osi).length,
		conRecargos: clientes.filter((c) => c.paga_recargos).length
	};

	onMount(() => {
		loadClientes();
		socketUtils.on('cliente:created', handleClienteCreated);
		socketUtils.on('cliente:updated', handleClienteUpdated);
		socketUtils.on('cliente:deleted', handleClienteDeleted);
	});

	onDestroy(() => {
		socketUtils.off('cliente:created', handleClienteCreated);
		socketUtils.off('cliente:updated', handleClienteUpdated);
		socketUtils.off('cliente:deleted', handleClienteDeleted);
	});

	async function loadClientes(page = 1, search = '', tipo = 'TODOS') {
		isLoading = true;
		error = null;

		try {
			console.log('🔄 Iniciando request a /api/clientes...', {
				page,
				search,
				tipo,
				mostrarOcultos
			});

			// Si mostrarOcultos está activo, usar endpoint diferente
			if (mostrarOcultos) {
				const response = await fetch(`${import.meta.env.VITE_API_URL}/clientes/ocultos`, {
					headers: {
						Authorization: `Bearer ${localStorage.getItem('token')}`
					}
				}).then((r) => r.json());

				console.log('✅ Response de ocultos:', response);
				clientes = response.data || [];

				// Actualizar paginación manual ya que ocultos no tiene paginación
				pagination = {
					page: 1,
					limit: clientes.length,
					total: clientes.length,
					pages: 1,
					hasNext: false,
					hasPrev: false
				};

				console.log('🎯 Clientes ocultos cargados:', clientes.length);
				return;
			}

			// Construir parámetros de consulta para clientes normales
			const params: any = {
				page: page.toString(),
				limit: pagination.limit.toString()
			};

			if (search && search.trim() !== '') {
				params.search = search.trim();
			}

			if (tipo !== 'TODOS') {
				params.tipo = tipo;
			}

			const response = await clientesAPI.getAll(params);

			console.log('✅ Response completa recibida:', response);
			console.log('📊 Estructura de data:', response.data);

			// Verificar la estructura del response según el formato especificado
			if (response.data && response.data.success && Array.isArray(response.data.data)) {
				clientes = response.data.data;

				// Actualizar información de paginación
				if (response.data.pagination) {
					pagination = response.data.pagination;
					console.log('📄 Información de paginación:', pagination);
				}

				console.log('🎯 Clientes cargados exitosamente:', {
					totalClientes: clientes.length,
					paginaActual: pagination.page,
					totalPaginas: pagination.pages,
					totalRegistros: pagination.total,
					filtros: { search, tipo }
				});

				// Log detallado de los primeros clientes para debug
				console.log('👥 Primeros 3 clientes:', clientes.slice(0, 3));
			} else {
				console.warn('⚠️ Formato de respuesta inesperado:', {
					hasData: !!response.data,
					hasSuccess: response.data?.success,
					hasDataArray: Array.isArray(response.data?.data),
					actualStructure: Object.keys(response.data || {})
				});
				clientes = [];
			}
		} catch (err: any) {
			console.error('❌ Error cargando clientes:', err);
			console.error('📋 Detalles del error:', {
				message: err.message,
				status: err.response?.status,
				data: err.response?.data,
				config: err.config
			});

			error = err.response?.data?.message || err.message || 'Error al cargar los clientes';

			// Datos de ejemplo para desarrollo/testing
			console.log('🔧 Cargando datos de ejemplo...');
			clientes = [
				{
					id: '1',
					nit: '900123456-1',
					nombre: 'Transportes del Valle S.A.S.',
					representante: 'Juan Carlos Pérez',
					cedula: null,
					telefono: '3201234567',
					direccion: 'Calle 15 #23-45, Valle del Cauca',
					correo: 'gerencia@transportesvalle.com',
					requiere_osi: true,
					paga_recargos: true,
					tipo: TipoCliente.EMPRESA,
					createdAt: '2024-01-15T10:30:00Z',
					updatedAt: '2024-01-15T10:30:00Z'
				},
				{
					id: '2',
					nit: '12345678',
					nombre: 'María Esperanza García López',
					representante: null,
					cedula: '12345678',
					telefono: '3109876543',
					direccion: 'Carrera 45 #23-12, Sector Centro, Medellín',
					correo: 'maria.garcia@email.com',
					requiere_osi: false,
					paga_recargos: true,
					tipo: TipoCliente.PERSONA_NATURAL,
					createdAt: '2024-01-16T14:20:00Z',
					updatedAt: '2024-01-16T14:20:00Z'
				},
				{
					id: '3',
					nit: '800987654-3',
					nombre: 'Logística Andina Ltda.',
					representante: 'Ana María Rodríguez',
					cedula: null,
					telefono: '3157894561',
					direccion: 'Zona Industrial Norte, Km 5 Vía Bogotá',
					correo: 'contacto@logisticaandina.co',
					requiere_osi: true,
					paga_recargos: false,
					tipo: TipoCliente.EMPRESA,
					createdAt: '2024-01-17T09:15:00Z',
					updatedAt: '2024-01-17T09:15:00Z'
				},
				{
					id: '4',
					nit: '87654321',
					nombre: 'Carlos Alberto Mendoza Silva',
					representante: null,
					cedula: '87654321',
					telefono: '3201234567',
					direccion: 'Avenida Central #12-34, Barrio La Esperanza, Cali',
					correo: 'carlos.mendoza@gmail.com',
					requiere_osi: false,
					paga_recargos: false,
					tipo: TipoCliente.PERSONA_NATURAL,
					createdAt: '2024-01-18T16:45:00Z',
					updatedAt: '2024-01-18T16:45:00Z'
				},
				{
					id: '5',
					nit: '901234567-5',
					nombre: 'Comercializadora del Pacífico S.A.',
					representante: 'Luis Fernando Castro',
					cedula: null,
					telefono: '3184567890',
					direccion: 'Centro Comercial Plaza Mayor, Local 205',
					correo: 'ventas@comercializadorapacifico.com',
					requiere_osi: true,
					paga_recargos: true,
					tipo: TipoCliente.EMPRESA,
					createdAt: '2024-01-19T11:20:00Z',
					updatedAt: '2024-01-19T11:20:00Z'
				},
				{
					id: '6',
					nit: '13579024',
					nombre: 'Diana Patricia Morales Ruiz',
					representante: null,
					cedula: '13579024',
					telefono: '3051234567',
					direccion: 'Transversal 8 #45-23, Barrio El Prado, Barranquilla',
					correo: 'diana.morales@hotmail.com',
					requiere_osi: true,
					paga_recargos: false,
					tipo: TipoCliente.PERSONA_NATURAL,
					createdAt: '2024-01-20T14:30:00Z',
					updatedAt: '2024-01-20T14:30:00Z'
				}
			];
		} finally {
			isLoading = false;
			console.log('🏁 LoadClientes finalizado. Total clientes:', clientes.length);
		}
	}

	function handleClienteCreated(data: Cliente) {
		clientes = [data, ...clientes];
	}

	function handleClienteUpdated(data: Cliente) {
		const index = clientes.findIndex((c) => c.id === data.id);
		if (index !== -1) {
			clientes[index] = data;
			clientes = [...clientes];
		}
	}

	function handleClienteDeleted(data: { id: string }) {
		clientes = clientes.filter((c) => c.id !== data.id);
	}

	// Función para navegar a la página de agregar cliente
	function navigateToAddCliente() {
		goto('/dashboard/clientes/agregar');
	}

	// Función para reintentar carga
	function retryLoadClientes() {
		loadClientes(pagination.page, searchTerm, filtroTipo);
	}

	// Funciones para manejar búsqueda y filtros
	function handleSearch() {
		// Debounce para evitar múltiples requests
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}

		searchTimeout = setTimeout(() => {
			console.log('🔍 Realizando búsqueda:', searchTerm);
			pagination.page = 1; // Reset a la primera página
			loadClientes(1, searchTerm, filtroTipo);
		}, 500); // 500ms de delay
	}

	function handleFilterChange() {
		console.log('🔽 Cambiando filtro:', filtroTipo);
		pagination.page = 1; // Reset a la primera página
		loadClientes(1, searchTerm, filtroTipo);
	}

	// Función para manejar cambio de página
	function goToPage(page: number) {
		if (page >= 1 && page <= pagination.pages && page !== pagination.page) {
			console.log('📄 Cambiando a página:', page);
			loadClientes(page, searchTerm, filtroTipo);
		}
	}

	// Función para ir a página anterior
	function previousPage() {
		if (pagination.hasPrev) {
			goToPage(pagination.page - 1);
		}
	}

	// Función para ir a página siguiente
	function nextPage() {
		if (pagination.hasNext) {
			goToPage(pagination.page + 1);
		}
	}

	function getTipoColor(tipo: TipoCliente) {
		switch (tipo) {
			case TipoCliente.EMPRESA:
				return 'bg-blue-100 text-blue-800';
			case TipoCliente.PERSONA_NATURAL:
				return 'bg-orange-100 text-orange-800';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	}

	function getTipoLabel(tipo: TipoCliente | 'TODOS') {
		if (tipo === 'TODOS') return 'Todos';
		return tipo === TipoCliente.EMPRESA ? 'Empresa' : 'Persona Natural';
	}

	function formatDate(dateString: string) {
		return new Date(dateString).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatPhoneNumber(phone: string) {
		// Formatear número de teléfono colombiano
		const cleaned = phone.replace(/\D/g, '');
		const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
		if (match) {
			return `${match[1]} ${match[2]} ${match[3]}`;
		}
		return phone;
	}

	// Función para verificar si un campo tiene datos válidos
	function hasValidData(value: string | null | undefined): boolean {
		return value !== null && value !== undefined && value.trim() !== '';
	}

	// Función para obtener texto de fallback
	function getFallbackText(fieldName: string): string {
		const fallbacks: Record<string, string> = {
			representante: 'Sin representante registrado',
			telefono: 'Sin teléfono registrado',
			correo: 'Sin correo registrado',
			direccion: 'Sin dirección registrada'
		};
		return fallbacks[fieldName] || 'Sin información registrada';
	}

	// Función para obtener los números de página a mostrar
	function getPageNumbers(): (number | string)[] {
		const pages: (number | string)[] = [];
		const current = pagination.page;
		const total = pagination.pages;

		// Si hay 10 o menos páginas, mostrar todas
		if (total <= 10) {
			for (let i = 1; i <= total; i++) {
				pages.push(i);
			}
			return pages;
		}

		// Siempre mostrar primera página
		pages.push(1);

		// Calcular rango alrededor de la página actual
		let startPage = Math.max(2, current - 2);
		let endPage = Math.min(total - 1, current + 2);

		// Ajustar si estamos cerca del inicio
		if (current <= 4) {
			startPage = 2;
			endPage = 6;
		}

		// Ajustar si estamos cerca del final
		if (current >= total - 3) {
			startPage = total - 5;
			endPage = total - 1;
		}

		// Agregar puntos suspensivos al inicio si es necesario
		if (startPage > 2) {
			pages.push('...');
		}

		// Agregar páginas del rango
		for (let i = startPage; i <= endPage; i++) {
			pages.push(i);
		}

		// Agregar puntos suspensivos al final si es necesario
		if (endPage < total - 1) {
			pages.push('...');
		}

		// Siempre mostrar última página
		pages.push(total);

		return pages;
	}

	// Función para navegar al perfil del cliente
	function navigateToClientProfile(clienteId: string) {
		goto(`/dashboard/clientes/${clienteId}`);
	}
</script>

<svelte:head>
	<title>Gestión de Clientes - Cotransmeq</title>
</svelte:head>

<div class="space-y-8 p-6">
	<!-- Header con Acciones Rápidas -->
	<div
		class="glass rounded-3xl border border-orange-200/30 bg-gradient-to-r from-orange-50/50 to-amber-50/50 p-8"
		in:fade={{ duration: 600 }}
	>
		<div class="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
			<div class="flex-1">
				<div class="mb-2 flex items-center gap-3">
					<div
						class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg"
					>
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
							/>
						</svg>
					</div>
					<div>
						<h1 class="text-2xl font-bold text-gray-900">Gestión de Clientes</h1>
						<p class="text-gray-600">
							Centro de control para administrar toda la información de clientes
						</p>
					</div>
				</div>

				<!-- Métricas Rápidas -->
				<div class="mt-4 flex flex-wrap gap-4">
					<div
						class="flex items-center gap-2 rounded-xl border border-white/20 bg-white/60 px-4 py-2 backdrop-blur-sm"
					>
						<div class="h-2 w-2 rounded-full bg-orange-500"></div>
						<span class="text-sm font-medium text-gray-700">
							{stats.total} Clientes Totales
							{#if stats.totalPagina !== stats.total}
								<span class="text-xs text-gray-500">({stats.totalPagina} en página)</span>
							{/if}
						</span>
					</div>
					<div
						class="flex items-center gap-2 rounded-xl border border-white/20 bg-white/60 px-4 py-2 backdrop-blur-sm"
					>
						<div class="h-2 w-2 rounded-full bg-blue-500"></div>
						<span class="text-sm font-medium text-gray-700">{stats.empresas} Empresas</span>
					</div>
					<div
						class="flex items-center gap-2 rounded-xl border border-white/20 bg-white/60 px-4 py-2 backdrop-blur-sm"
					>
						<div class="h-2 w-2 rounded-full bg-orange-500"></div>
						<span class="text-sm font-medium text-gray-700">{stats.personasNaturales} Personas</span
						>
					</div>
					{#if pagination.total > 0}
						<div
							class="flex items-center gap-2 rounded-xl border border-white/20 bg-white/60 px-4 py-2 backdrop-blur-sm"
						>
							<div class="h-2 w-2 rounded-full bg-purple-500"></div>
							<span class="text-sm font-medium text-gray-700"
								>Página {pagination.page}/{pagination.pages}</span
							>
						</div>
					{/if}
				</div>
			</div>

			<div class="flex flex-col gap-3 sm:flex-row">
				<button
					on:click={navigateToAddCliente}
					class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
				>
					<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Nuevo Cliente
				</button>
			</div>
		</div>
	</div>

	<!-- Dashboard de Estadísticas -->
	<div
		class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
		in:fly={{ y: 20, duration: 600, delay: 200 }}
	>
		<!-- Total Clientes -->
		<div
			class="glass apple-transition group rounded-xl border border-gray-200/50 p-4 hover:shadow-lg"
		>
			<div class="mb-2 flex items-center justify-between">
				<div
					class="apple-transition flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 group-hover:scale-110"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
						/>
					</svg>
				</div>
				<div class="text-right">
					<p class="text-xl font-bold text-gray-900">{stats.total}</p>
					<p class="text-xs font-medium text-gray-600">Total Clientes</p>
				</div>
			</div>
			<div class="flex items-center justify-between text-xs">
				<span class="font-medium text-orange-600">↗ +12% este mes</span>
				<span class="text-gray-500">Activos</span>
			</div>
		</div>

		<!-- Empresas -->
		<div
			class="glass apple-transition group rounded-xl border border-gray-200/50 p-4 hover:shadow-lg"
		>
			<div class="mb-2 flex items-center justify-between">
				<div
					class="apple-transition flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 group-hover:scale-110"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
						/>
					</svg>
				</div>
				<div class="text-right">
					<p class="text-xl font-bold text-gray-900">{stats.empresas}</p>
					<p class="text-xs font-medium text-gray-600">Empresas</p>
				</div>
			</div>
			<div class="flex items-center justify-between text-xs">
				<span class="font-medium text-blue-600"
					>{Math.round((stats.empresas / stats.total) * 100)}% del total</span
				>
				<span class="text-gray-500">Corporativo</span>
			</div>
		</div>

		<!-- Personas Naturales -->
		<div
			class="glass apple-transition group rounded-xl border border-gray-200/50 p-4 hover:shadow-lg"
		>
			<div class="mb-2 flex items-center justify-between">
				<div
					class="apple-transition flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 group-hover:scale-110"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
						/>
					</svg>
				</div>
				<div class="text-right">
					<p class="text-xl font-bold text-gray-900">{stats.personasNaturales}</p>
					<p class="text-xs font-medium text-gray-600">Personas</p>
				</div>
			</div>
			<div class="flex items-center justify-between text-xs">
				<span class="font-medium text-orange-600"
					>{Math.round((stats.personasNaturales / stats.total) * 100)}% del total</span
				>
				<span class="text-gray-500">Individual</span>
			</div>
		</div>

		<!-- Servicios Especiales -->
		<div
			class="glass apple-transition group rounded-xl border border-gray-200/50 p-4 hover:shadow-lg"
		>
			<div class="mb-2 flex items-center justify-between">
				<div
					class="apple-transition flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-400 to-purple-600 group-hover:scale-110"
				>
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
						/>
					</svg>
				</div>
				<div class="text-right">
					<p class="text-xl font-bold text-gray-900">{stats.conOSI}</p>
					<p class="text-xs font-medium text-gray-600">Con OSI</p>
				</div>
			</div>
			<div class="flex items-center justify-between text-xs">
				<span class="font-medium text-purple-600">{stats.conRecargos} con recargos</span>
				<span class="text-gray-500">Especiales</span>
			</div>
		</div>
	</div>

	<!-- Controles de Filtrado y Búsqueda -->
	<div
		class="glass rounded-xl border border-gray-200/50 p-4"
		in:fly={{ y: 20, duration: 600, delay: 300 }}
	>
		<div class="flex flex-col gap-3 lg:flex-row">
			<!-- Barra de Búsqueda Avanzada -->
			<div class="flex-1">
				<!-- Búsqueda para desktop -->
				<div
					class="apple-transition hidden items-center rounded-lg bg-gray-100/80 p-3 focus-within:bg-gray-100 focus-within:ring-2 focus-within:ring-orange-400/20 md:flex"
				>
					<svg
						class="mr-2 h-4 w-4 flex-shrink-0 text-gray-400 {isLoading ? 'animate-spin' : ''}"
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
					<input
						type="text"
						bind:value={searchTerm}
						disabled={isLoading}
						placeholder="Buscar por nombre, NIT, correo, representante o dirección..."
						class="min-w-0 flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none disabled:opacity-50"
					/>
					{#if isLoading}
						<div class="ml-2 text-xs text-gray-500">Buscando...</div>
					{/if}
				</div>

				<!-- Búsqueda para móvil -->
				<div class="md:hidden">
					<input
						type="text"
						bind:value={searchTerm}
						disabled={isLoading}
						placeholder="Buscar clientes..."
						class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-3 py-2 text-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500 disabled:opacity-50"
					/>
				</div>
			</div>

			<!-- Filtros -->
			<div class="flex gap-2">
				<select
					bind:value={filtroTipo}
					class="apple-transition rounded-lg border border-gray-200/50 bg-white/50 px-4 py-2 text-sm text-gray-900 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
				>
					<option value="TODOS">🌟 Todos los tipos</option>
					<option value={TipoCliente.EMPRESA}>🏢 Empresas</option>
					<option value={TipoCliente.PERSONA_NATURAL}>👤 Personas Naturales</option>
				</select>

				<button
					class="apple-transition rounded-lg border border-gray-200/50 bg-white/50 px-4 py-2 text-gray-700 backdrop-blur-sm hover:bg-white"
					aria-label="Filtros avanzados"
					title="Filtros avanzados"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.207A1 1 0 013 6.5V4z"
						/>
					</svg>
				</button>
			</div>
		</div>

		{#if searchTerm || filtroTipo !== 'TODOS'}
			<div class="mt-4 flex flex-wrap gap-2">
				<div class="text-sm text-gray-600">
					Mostrando {clientesFiltrados.length} de {stats.total} clientes
				</div>
				{#if searchTerm}
					<span
						class="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800"
					>
						Búsqueda: "{searchTerm}"
					</span>
				{/if}
				{#if filtroTipo !== 'TODOS'}
					<span
						class="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800"
					>
						Filtro: {getTipoLabel(filtroTipo)}
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Grid de Clientes con Vista Detallada -->
	{#if isLoading}
		<div
			class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3"
			in:fly={{ y: 20, duration: 600, delay: 400 }}
		>
			{#each Array(6) as _}
				<div class="glass animate-pulse rounded-2xl border border-gray-200/50 p-6">
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="h-12 w-12 rounded-xl bg-gray-300"></div>
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
	{:else if error && clientes.length === 0}
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
			<h3 class="mb-2 text-lg font-semibold text-gray-900">Error al cargar clientes</h3>
			<p class="mb-6 text-gray-600">{error}</p>
			<button
				class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl"
				on:click={retryLoadClientes}
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
	{:else if clientesFiltrados.length === 0}
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
			<h3 class="mb-2 text-lg font-semibold text-gray-900">No se encontraron clientes</h3>
			<p class="text-gray-600">
				{#if searchTerm}
					No hay clientes que coincidan con "{searchTerm}"
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
			{#each clientesFiltrados as cliente (cliente.id)}
				<div
					class="glass apple-transition group cursor-pointer rounded-xl border border-gray-200/50 p-4 hover:scale-[1.01] hover:shadow-lg"
					in:fade={{ delay: parseInt(cliente.id) * 50 }}
					on:click={() => (selectedCliente = cliente)}
					on:keydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							selectedCliente = cliente;
						}
					}}
					role="button"
					tabindex="0"
					aria-label="Ver detalles de {cliente.nombre}"
				>
					<!-- Header de la Tarjeta -->
					<div class="mb-3 flex items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<div
								class="apple-transition flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-amber-600 shadow-md group-hover:scale-110"
							>
								{#if cliente.tipo === TipoCliente.EMPRESA}
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
											d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
										/>
									</svg>
								{:else}
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
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<h3
									class="w-full max-w-xs truncate text-sm font-bold text-gray-900"
									title={cliente.nombre}
								>
									{cliente.nombre.length > 30
										? cliente.nombre.substring(0, 30) + '...'
										: cliente.nombre}
								</h3>
								<p class="text-xs text-gray-500">NIT: {cliente.nit}</p>
							</div>
						</div>
						<span
							class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold {getTipoColor(
								cliente.tipo
							)} shrink-0"
						>
							{getTipoLabel(cliente.tipo)}
						</span>
					</div>

					<!-- Información Principal -->
					<div class="mb-3 space-y-2">
						{#if cliente.representante && cliente.representante.trim() !== ''}
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
										d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
									/>
								</svg>
								<span class="truncate text-xs text-gray-600" title={cliente.representante}>
									{cliente.representante}
								</span>
							</div>
						{/if}

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
								{cliente.telefono && cliente.telefono.trim() !== ''
									? cliente.telefono
									: 'Sin teléfono'}
							</span>
						</div>

						{#if cliente.correo && cliente.correo.trim() !== ''}
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
								<span class="truncate text-xs text-gray-600" title={cliente.correo}>
									{cliente.correo}
								</span>
							</div>
						{/if}

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
									d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
							<span
								class="line-clamp-2 text-xs leading-tight text-gray-600"
								title={cliente.direccion || 'Sin dirección'}
							>
								{cliente.direccion && cliente.direccion.trim() !== ''
									? cliente.direccion
									: 'Sin dirección'}
							</span>
						</div>
					</div>

					<!-- Características Especiales con Fallback -->
					<div class="mb-3 flex flex-wrap gap-1.5">
						{#if cliente.requiere_osi}
							<span
								class="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700"
							>
								OSI
							</span>
						{/if}
						{#if cliente.paga_recargos}
							<span
								class="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700"
							>
								Recargos
							</span>
						{/if}
					</div>

					<!-- Acciones -->
					<div class="flex gap-2 border-t border-gray-200/50 pt-3">
						<button
							on:click={() => navigateToClientProfile(cliente.id)}
							class="apple-transition flex-1 rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100"
						>
							Ver Perfil
						</button>
						<div class="relative">
							<button
								class="apple-transition rounded-lg bg-gray-50 p-1.5 text-gray-700 hover:bg-gray-100"
								aria-label="Más opciones para {cliente.nombre}"
								title="Más opciones"
								on:click={() => (cliente.showDropdown = !cliente.showDropdown)}
								tabindex="0"
							>
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
									/>
								</svg>
							</button>
							{#if cliente.showDropdown}
								<div
									class="absolute right-0 bottom-full z-10 mb-1 w-32 rounded-lg border border-gray-200 bg-white shadow-lg"
									transition:fly={{ y: 10, duration: 200 }}
								>
									<button
										class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-gray-700 hover:bg-gray-100"
										on:click={() => goto(`/clientes/${cliente.id}/editar`)}
									>
										<svg
											class="h-3.5 w-3.5 text-gray-500"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-2.828 0L9 13zm-4 6h16"
											/>
										</svg>
										Editar
									</button>
								</div>
							{/if}
						</div>
					</div>
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
								<strong>{(pagination.page - 1) * pagination.limit + 1}</strong> -
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
						<!-- Selector de items por página -->
						<div
							class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5"
						>
							<span class="text-xs font-semibold text-gray-700">Mostrar:</span>
							<select
								bind:value={pagination.limit}
								on:change={() => {
									pagination.page = 1;
									loadClientes(1, searchTerm, filtroTipo);
								}}
								class="apple-transition border-0 bg-transparent pr-6 text-xs font-bold text-gray-900 focus:ring-0 focus:outline-none"
							>
								<option value={10}>10</option>
								<option value={20}>20</option>
								<option value={50}>50</option>
								<option value={100}>100</option>
							</select>
						</div>

						<!-- Botones de navegación -->
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
											on:click={() => goToPage(pageNum)}
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

<!-- Modal de confirmación de borrado -->
{#if showDeleteModal && clienteToDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" in:fade={{ duration: 200 }}>
		<div
			class="glass w-full max-w-md rounded-2xl border border-red-200/50 bg-white p-8 shadow-2xl"
			in:fly={{ y: 20, duration: 300 }}
		>
			<h2 class="mb-4 text-lg font-semibold text-gray-900">¿Eliminar cliente?</h2>
			<p class="mb-6 text-gray-700">
				¿Estás seguro de que deseas eliminar el cliente <span class="font-bold"
					>{clienteToDelete.nombre}</span
				>? Esta acción es reversible (soft delete).
			</p>
			<div class="flex justify-end gap-3">
				<button
					class="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200"
					on:click={closeDeleteModal}
					disabled={isLoading}>Cancelar</button
				>
				<button
					class="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
					on:click={deleteCliente}
					disabled={isLoading}
				>
					{isLoading ? 'Eliminando...' : 'Eliminar'}
				</button>
			</div>
		</div>
	</div>
{/if}
