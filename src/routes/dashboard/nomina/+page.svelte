<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		obtenerLiquidaciones,
		eliminarLiquidacion,
		generarDesprendibles,
		verificarEstadoDesprendibles
	} from '$lib/api/nomina';
	import type { LiquidacionesParams } from '$lib/api/nomina';
	import type { Liquidacion } from '$lib/types/nomina';
	import { toast } from 'svelte-sonner';
	import {
		Users,
		Plus,
		Edit,
		Trash2,
		Eye,
		FileText,
		Mail,
		TrendingUp,
		Clock,
		ChevronUp,
		ChevronDown,
		ChevronsUpDown,
		ChevronLeft,
		ChevronRight
	} from 'lucide-svelte';
	import LiquidacionDetalleModal from '$lib/components/nomina/LiquidacionDetalleModal.svelte';

	// ==================== ESTADO ====================
	let liquidaciones: Liquidacion[] = [];
	let loading = true;
	let searchTerm = '';
	let searchTimeout: ReturnType<typeof setTimeout>;
	let selectedLiquidaciones: Set<string> = new Set();
	let showDeleteModal = false;
	let liquidacionToDelete: string | null = null;
	let showDetalleModal = false;
	let detalleId = '';
	let generatingPDFs = false;
	let pdfProgress = 0;

	// Paginación
	let pagination = {
		total: 0,
		page: 1,
		limit: 20,
		totalPages: 0,
		hasNext: false,
		hasPrev: false
	};

	// Stats del servidor
	let stats = {
		totalRegistros: 0,
		totalPendientes: 0,
		montoTotal: 0
	};

	// Ordenamiento
	let sortBy = '';
	let sortOrder: 'asc' | 'desc' = 'desc';

	// Filtro mes de nómina
	let nominaMonth = '';

	// ==================== CARGA DE DATOS ====================
	onMount(async () => {
		await cargarLiquidaciones();
	});

	async function cargarLiquidaciones() {
		try {
			loading = true;
			const params: LiquidacionesParams = {
				page: pagination.page,
				limit: pagination.limit
			};

			if (searchTerm.trim()) params.search = searchTerm.trim();
			if (sortBy) {
				params.sortBy = sortBy;
				params.sortOrder = sortOrder;
			}
			if (nominaMonth) params.nomina_month = nominaMonth;

			const response = await obtenerLiquidaciones(params);
			liquidaciones = response.data || [];

			if (response.pagination) {
				pagination = { ...pagination, ...response.pagination };
			}

			if (response.stats) {
				stats = response.stats;
			}
		} catch (error: any) {
			console.error('Error cargando liquidaciones:', error);
			toast.error('Error al cargar las liquidaciones');
		} finally {
			loading = false;
		}
	}

	// ==================== BÚSQUEDA ====================
	function handleSearch() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			pagination.page = 1;
			cargarLiquidaciones();
		}, 400);
	}

	// ==================== ORDENAMIENTO ====================
	function toggleSort(column: string) {
		if (sortBy === column) {
			if (sortOrder === 'desc') {
				sortOrder = 'asc';
			} else {
				sortBy = '';
				sortOrder = 'desc';
			}
		} else {
			sortBy = column;
			sortOrder = 'desc';
		}
		pagination.page = 1;
		cargarLiquidaciones();
	}

	// ==================== FILTRO MES ====================
	function handleMonthChange() {
		pagination.page = 1;
		cargarLiquidaciones();
	}

	function clearMonthFilter() {
		nominaMonth = '';
		pagination.page = 1;
		cargarLiquidaciones();
	}

	// ==================== PAGINACIÓN ====================
	function goToPage(page: number) {
		if (page < 1 || page > pagination.totalPages) return;
		pagination.page = page;
		cargarLiquidaciones();
	}

	function handleLimitChange() {
		pagination.page = 1;
		cargarLiquidaciones();
	}

	function getPageNumbers(): (number | string)[] {
		const pages: (number | string)[] = [];
		const current = pagination.page;
		const total = pagination.totalPages;

		if (total <= 7) {
			for (let i = 1; i <= total; i++) pages.push(i);
		} else {
			pages.push(1);
			if (current > 3) pages.push('...');
			for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
				pages.push(i);
			}
			if (current < total - 2) pages.push('...');
			pages.push(total);
		}
		return pages;
	}

	// ==================== NAVEGACIÓN ====================
	function irACrear() {
		goto('/dashboard/nomina/agregar');
	}

	function irAEditar(id: string) {
		goto(`/dashboard/nomina/editar/${id}`);
	}

	function verDetalle(id: string) {
		detalleId = id;
		showDetalleModal = true;
	}

	// ==================== ELIMINAR ====================
	function confirmarEliminar(id: string) {
		liquidacionToDelete = id;
		showDeleteModal = true;
	}

	async function eliminar() {
		if (!liquidacionToDelete) return;
		try {
			await eliminarLiquidacion(liquidacionToDelete);
			toast.success('Liquidación eliminada correctamente');
			await cargarLiquidaciones();
			showDeleteModal = false;
			liquidacionToDelete = null;
		} catch (error: any) {
			console.error('Error eliminando liquidación:', error);
			toast.error('Error al eliminar la liquidación');
		}
	}

	// ==================== SELECCIÓN ====================
	function toggleSelection(id: string) {
		if (selectedLiquidaciones.has(id)) {
			selectedLiquidaciones.delete(id);
		} else {
			selectedLiquidaciones.add(id);
		}
		selectedLiquidaciones = selectedLiquidaciones;
	}

	function toggleSelectAll() {
		if (selectedLiquidaciones.size === liquidaciones.length) {
			selectedLiquidaciones.clear();
		} else {
			liquidaciones.forEach((liq) => selectedLiquidaciones.add(liq.id));
		}
		selectedLiquidaciones = selectedLiquidaciones;
	}

	// ==================== DESPRENDIBLES ====================
	async function generarDesprendiblesSeleccionados() {
		if (selectedLiquidaciones.size === 0) {
			toast.error('Selecciona al menos una liquidación');
			return;
		}
		try {
			generatingPDFs = true;
			pdfProgress = 0;
			const ids = Array.from(selectedLiquidaciones);
			const response = await generarDesprendibles(ids);
			const jobId = response.jobId;
			toast.success('Generando desprendibles...');

			const interval = setInterval(async () => {
				try {
					const status = await verificarEstadoDesprendibles(jobId);
					pdfProgress = status.progress || 0;
					if (status.status === 'completed') {
						clearInterval(interval);
						generatingPDFs = false;
						pdfProgress = 0;
						toast.success('Desprendibles generados y enviados correctamente');
						selectedLiquidaciones.clear();
						selectedLiquidaciones = selectedLiquidaciones;
					} else if (status.status === 'failed') {
						clearInterval(interval);
						generatingPDFs = false;
						pdfProgress = 0;
						toast.error('Error al generar desprendibles');
					}
				} catch {
					clearInterval(interval);
					generatingPDFs = false;
					pdfProgress = 0;
				}
			}, 2000);
		} catch {
			toast.error('Error al generar desprendibles');
			generatingPDFs = false;
			pdfProgress = 0;
		}
	}

	// ==================== FORMATOS ====================
	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(amount);
	}

	function formatDate(dateStr: string): string {
		if (!dateStr) return 'Sin fecha';
		const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
		if (isNaN(date.getTime())) return 'Sin fecha';
		return date.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	function formatDateShort(dateStr: string): string {
		if (!dateStr) return '';
		const date = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
		if (isNaN(date.getTime())) return '';
		return date.toLocaleDateString('es-CO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function getEstadoColor(estado: string): string {
		switch (estado) {
			case 'Liquidado':
				return 'bg-green-100 text-green-700';
			case 'Pendiente':
				return 'bg-yellow-100 text-yellow-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}
</script>

<svelte:head>
	<title>Nómina - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 p-6">
	<!-- Header -->
	<div class="mb-8">
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
					<div
						class="rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 p-3 shadow-lg shadow-orange-500/30"
					>
						<Users class="h-8 w-8 text-white" />
					</div>
					Sistema de Nómina
				</h1>
				<p class="mt-2 text-gray-600">Gestión de liquidaciones y desprendibles de pago</p>
			</div>

			<button
				on:click={irACrear}
				class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:shadow-xl hover:shadow-orange-500/40 hover:-translate-y-0.5"
			>
				<Plus class="h-5 w-5" />
				Nueva Liquidación
			</button>
		</div>

		<!-- Estadísticas -->
		<div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div class="rounded-xl bg-white p-4 shadow-md">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-600">Total Liquidaciones</p>
						<p class="text-2xl font-bold text-gray-900">{stats.totalRegistros}</p>
						<p class="text-xs text-gray-400 mt-1">registros</p>
					</div>
					<div class="rounded-lg bg-orange-100 p-3">
						<FileText class="h-6 w-6 text-orange-600" />
					</div>
				</div>
			</div>

			<div class="rounded-xl bg-white p-4 shadow-md">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-600">Liquidaciones Pendientes</p>
						<p class="text-2xl font-bold text-gray-900">{stats.totalPendientes}</p>
						<p class="text-xs text-gray-400 mt-1">por procesar</p>
					</div>
					<div class="rounded-lg bg-yellow-100 p-3">
						<Clock class="h-6 w-6 text-yellow-600" />
					</div>
				</div>
			</div>

			<div class="rounded-xl bg-white p-4 shadow-md">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm text-gray-600">Monto Total</p>
						<p class="text-2xl font-bold text-gray-900">{formatCurrency(stats.montoTotal)}</p>
					</div>
					<div class="rounded-lg bg-amber-100 p-3">
						<TrendingUp class="h-6 w-6 text-amber-600" />
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Barra de búsqueda, filtros y acciones -->
	<div class="mb-6 rounded-xl bg-white p-4 shadow-md">
		<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div class="flex flex-1 items-center gap-3">
				<!-- Búsqueda -->
				<div class="flex-1">
					<input
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Buscar por conductor, cédula o ID..."
						class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
					/>
				</div>

				<!-- Filtro mes nómina -->
				<div class="flex items-center gap-2">
					<label for="nomina-month" class="text-sm font-medium text-gray-600 whitespace-nowrap"
						>Nómina:</label
					>
					<input
						id="nomina-month"
						type="month"
						bind:value={nominaMonth}
						on:change={handleMonthChange}
						class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
					/>
				</div>

				{#if nominaMonth}
					<button
						on:click={clearMonthFilter}
						class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
						title="Limpiar filtro de mes"
					>
						✕
					</button>
				{/if}
			</div>

			<!-- Acciones masivas -->
			{#if selectedLiquidaciones.size > 0}
				<div class="flex gap-2">
					<button
						on:click={generarDesprendiblesSeleccionados}
						disabled={generatingPDFs}
						class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-white shadow-md transition-all hover:shadow-lg disabled:opacity-50"
					>
						{#if generatingPDFs}
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
							{pdfProgress}%
						{:else}
							<Mail class="h-4 w-4" />
							Generar y Enviar ({selectedLiquidaciones.size})
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Tabla de liquidaciones -->
	<div class="rounded-xl bg-white shadow-md overflow-hidden">
		{#if loading}
			<div class="flex items-center justify-center py-12">
				<div class="text-center">
					<div
						class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
					></div>
					<p class="text-gray-600">Cargando liquidaciones...</p>
				</div>
			</div>
		{:else if liquidaciones.length === 0}
			<div class="py-12 text-center">
				<FileText class="mx-auto h-12 w-12 text-gray-400" />
				<p class="mt-4 text-gray-600">No se encontraron liquidaciones</p>
				<button
					on:click={irACrear}
					class="mt-4 rounded-lg bg-orange-500 px-4 py-2 text-white hover:bg-orange-600"
				>
					Crear primera liquidación
				</button>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-4 py-3 text-left">
								<input
									type="checkbox"
									checked={selectedLiquidaciones.size === liquidaciones.length &&
										liquidaciones.length > 0}
									on:change={toggleSelectAll}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
							</th>
							<th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">
								<button
									on:click={() => toggleSort('periodo')}
									class="flex items-center gap-1 hover:text-orange-600 transition-colors"
								>
									Período
									{#if sortBy === 'periodo'}
										{#if sortOrder === 'desc'}<ChevronDown
												class="h-4 w-4 text-orange-600"
											/>{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}
									{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
								</button>
							</th>
							<th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">
								<button
									on:click={() => toggleSort('conductor')}
									class="flex items-center gap-1 hover:text-orange-600 transition-colors"
								>
									Conductor
									{#if sortBy === 'conductor'}
										{#if sortOrder === 'desc'}<ChevronDown
												class="h-4 w-4 text-orange-600"
											/>{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}
									{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
								</button>
							</th>
							<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700"
								>Días Lab.</th
							>
							<th class="px-4 py-3 text-right text-sm font-semibold text-gray-700">
								<button
									on:click={() => toggleSort('monto')}
									class="ml-auto flex items-center gap-1 hover:text-orange-600 transition-colors"
								>
									Monto
									{#if sortBy === 'monto'}
										{#if sortOrder === 'desc'}<ChevronDown
												class="h-4 w-4 text-orange-600"
											/>{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}
									{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
								</button>
							</th>
							<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">
								<button
									on:click={() => toggleSort('estado')}
									class="mx-auto flex items-center gap-1 hover:text-orange-600 transition-colors"
								>
									Estado
									{#if sortBy === 'estado'}
										{#if sortOrder === 'desc'}<ChevronDown
												class="h-4 w-4 text-orange-600"
											/>{:else}<ChevronUp class="h-4 w-4 text-orange-600" />{/if}
									{:else}<ChevronsUpDown class="h-4 w-4 text-gray-400" />{/if}
								</button>
							</th>
							<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700"
								>Acciones</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						{#each liquidaciones as liquidacion (liquidacion.id)}
							<tr class="hover:bg-gray-50 transition-colors">
								<td class="px-4 py-3">
									<input
										type="checkbox"
										checked={selectedLiquidaciones.has(liquidacion.id)}
										on:change={() => toggleSelection(liquidacion.id)}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
								</td>
								<td class="px-4 py-3">
									<p class="text-sm font-medium text-gray-900">
										{formatDate(liquidacion.periodo_inicio)}
									</p>
									<p class="text-sm text-gray-500">
										hasta {formatDate(liquidacion.periodo_fin)}
									</p>
								</td>
								<td class="px-4 py-3">
									<p class="font-medium text-gray-900">
										{liquidacion.conductor?.nombre || 'N/A'}
									</p>
									<p class="text-xs text-gray-500">
										ID: {liquidacion.id.substring(0, 8)}...
									</p>
								</td>
								<td class="px-4 py-3 text-center">
									<p class="font-semibold text-gray-900">
										{liquidacion.dias_laborados ?? 0}
									</p>
									{#if liquidacion.dias_laborados_villanueva}
										<p class="text-xs text-orange-600 font-medium">
											{liquidacion.dias_laborados_villanueva} en Villa.
										</p>
									{/if}
								</td>
								<td class="px-4 py-3 text-right">
									<p class="text-lg font-bold text-gray-900">
										{formatCurrency(liquidacion.total_devengado || 0)}
									</p>
									<p class="text-xs text-gray-500">
										Devengado: {formatCurrency(liquidacion.salario_devengado || 0)}
									</p>
								</td>
								<td class="px-4 py-3 text-center">
									<span
										class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {getEstadoColor(liquidacion.estado || 'Pendiente')}"
									>
										{liquidacion.estado || 'Pendiente'}
									</span>
									{#if liquidacion.fecha_liquidacion}
										<p class="text-xs text-gray-400 mt-1">
											{formatDateShort(liquidacion.fecha_liquidacion)}
										</p>
									{/if}
								</td>
								<td class="px-4 py-3">
									<div class="flex items-center justify-center gap-1">
										<button
											on:click={() => verDetalle(liquidacion.id)}
											class="rounded-lg p-2 text-blue-600 hover:bg-blue-50 transition-colors"
											title="Ver detalle"
										>
											<Eye class="h-4 w-4" />
										</button>
										<button
											on:click={() => irAEditar(liquidacion.id)}
											class="rounded-lg p-2 text-orange-600 hover:bg-orange-50 transition-colors"
											title="Editar"
										>
											<Edit class="h-4 w-4" />
										</button>
										<button
											on:click={() => confirmarEliminar(liquidacion.id)}
											class="rounded-lg p-2 text-red-600 hover:bg-red-50 transition-colors"
											title="Eliminar"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Paginación -->
			<div class="border-t border-gray-200 bg-gray-50 px-4 py-3">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="text-sm text-gray-600">
						Mostrando
						<span class="font-semibold"
							>{(pagination.page - 1) * pagination.limit + 1}</span
						>
						a
						<span class="font-semibold"
							>{Math.min(pagination.page * pagination.limit, pagination.total)}</span
						>
						de
						<span class="font-semibold">{pagination.total}</span> registros
					</div>

					<div class="flex items-center gap-4">
						<div class="flex items-center gap-2">
							<span class="text-xs font-medium text-gray-600">Mostrar:</span>
							<select
								bind:value={pagination.limit}
								on:change={handleLimitChange}
								class="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
							>
								<option value={10}>10</option>
								<option value={20}>20</option>
								<option value={50}>50</option>
								<option value={100}>100</option>
							</select>
						</div>

						<div class="flex items-center gap-1">
							<button
								disabled={!pagination.hasPrev}
								on:click={() => goToPage(pagination.page - 1)}
								class="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
								title="Página anterior"
							>
								<ChevronLeft class="h-4 w-4" />
							</button>

							<div class="flex items-center gap-1">
								{#each getPageNumbers() as pageNum}
									{#if pageNum === '...'}
										<span class="px-2 text-xs text-gray-400">...</span>
									{:else}
										<button
											on:click={() => goToPage(Number(pageNum))}
											class="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold shadow-sm transition-colors {pageNum ===
											pagination.page
												? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-md'
												: 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}"
										>
											{pageNum}
										</button>
									{/if}
								{/each}
							</div>

							<button
								disabled={!pagination.hasNext}
								on:click={() => goToPage(pagination.page + 1)}
								class="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
								title="Página siguiente"
							>
								<ChevronRight class="h-4 w-4" />
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Modal de detalle de liquidación -->
<LiquidacionDetalleModal
	liquidacionId={detalleId}
	bind:show={showDetalleModal}
	onClose={() => (showDetalleModal = false)}
/>

<!-- Modal de confirmación de eliminación -->
{#if showDeleteModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		on:click={() => (showDeleteModal = false)}
		on:keydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		role="button"
		tabindex="-1"
	>
		<div
			class="rounded-xl bg-white p-6 shadow-xl max-w-md w-full mx-4"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.preventDefault()}
			role="dialog"
			tabindex="0"
		>
			<h3 class="text-xl font-bold text-gray-900 mb-4">Confirmar eliminación</h3>
			<p class="text-gray-600 mb-6">
				¿Estás seguro de que deseas eliminar esta liquidación? Esta acción no se puede deshacer.
			</p>
			<div class="flex gap-3 justify-end">
				<button
					on:click={() => (showDeleteModal = false)}
					class="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100"
				>
					Cancelar
				</button>
				<button
					on:click={eliminar}
					class="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
				>
					Eliminar
				</button>
			</div>
		</div>
	</div>
{/if}
