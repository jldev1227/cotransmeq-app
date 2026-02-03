<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva,
		type ListarAccionesFiltros,
		type TipoAccion,
		type EstadoAccion,
		type ValoracionRiesgo,
		type EstadisticasAcciones
	} from '$lib/api/acciones-correctivas';
	import ModalFormularioAccion from '$lib/components/acciones-correctivas/ModalFormularioAccion.svelte';

	// Estado
	let acciones: AccionCorrectivaPreventiva[] = [];
	let estadisticas: EstadisticasAcciones | null = null;
	let isLoading = true;
	let isLoadingStats = true;

	// Paginación
	let page = 1;
	let limit = 10;
	let total = 0;
	let totalPages = 0;

	// Filtros
	let filtros: ListarAccionesFiltros = {
		page,
		limit
	};
	let busqueda = '';
	let tipoFiltro: TipoAccion | '' = '';
	let estadoFiltro: EstadoAccion | '' = '';
	let riesgoFiltro: ValoracionRiesgo | '' = '';
	let fechaDesde = '';
	let fechaHasta = '';

	// Modal
	let showModal = false;
	let accionEditar: AccionCorrectivaPreventiva | null = null;
	let modoEdicion = false;

	// Modal de confirmación de eliminación
	let showDeleteModal = false;
	let accionEliminar: { id: string; numero: string } | null = null;

	onMount(async () => {
		await Promise.all([cargarAcciones(), cargarEstadisticas()]);
	});

	async function cargarAcciones() {
		isLoading = true;
		try {
			filtros = {
				page,
				limit,
				...(busqueda && { busqueda }),
				...(tipoFiltro && { tipo: tipoFiltro }),
				...(estadoFiltro && { estado: estadoFiltro }),
				...(riesgoFiltro && { riesgo: riesgoFiltro }),
				...(fechaDesde && { fecha_desde: fechaDesde }),
				...(fechaHasta && { fecha_hasta: fechaHasta })
			};

			const resultado = await accionesCorrectivasAPI.listar(filtros);
			acciones = resultado.acciones;
			total = resultado.total;
			totalPages = resultado.totalPages;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al cargar las acciones';
			toast.error(message);
			acciones = [];
		} finally {
			isLoading = false;
		}
	}

	async function cargarEstadisticas() {
		isLoadingStats = true;
		try {
			estadisticas = await accionesCorrectivasAPI.obtenerEstadisticas();
		} catch (error) {
			console.error('Error al cargar estadísticas:', error);
		} finally {
			isLoadingStats = false;
		}
	}

	function aplicarFiltros() {
		page = 1;
		cargarAcciones();
	}

	function limpiarFiltros() {
		busqueda = '';
		tipoFiltro = '';
		estadoFiltro = '';
		riesgoFiltro = '';
		fechaDesde = '';
		fechaHasta = '';
		page = 1;
		cargarAcciones();
	}

	function cambiarPagina(nuevaPagina: number) {
		page = nuevaPagina;
		cargarAcciones();
	}

	function abrirModalCrear() {
		accionEditar = null;
		modoEdicion = false;
		showModal = true;
	}

	function abrirModalEditar(accion: AccionCorrectivaPreventiva) {
		accionEditar = accion;
		modoEdicion = true;
		showModal = true;
	}

	function cerrarModal() {
		showModal = false;
		accionEditar = null;
		modoEdicion = false;
	}

	async function handleGuardado() {
		cerrarModal();
		await Promise.all([cargarAcciones(), cargarEstadisticas()]);
		toast.success(modoEdicion ? 'Acción actualizada correctamente' : 'Acción creada correctamente');
	}

	function abrirModalEliminar(id: string, accion_numero: string) {
		accionEliminar = { id, numero: accion_numero };
		showDeleteModal = true;
	}

	function cerrarModalEliminar() {
		showDeleteModal = false;
		accionEliminar = null;
	}

	async function confirmarEliminacion() {
		if (!accionEliminar) return;

		try {
			await accionesCorrectivasAPI.eliminar(accionEliminar.id);
			toast.success('Acción eliminada correctamente');
			await Promise.all([cargarAcciones(), cargarEstadisticas()]);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al eliminar la acción';
			toast.error(message);
		} finally {
			cerrarModalEliminar();
		}
	}

	async function descargarPDF(id: string, accion_numero: string) {
		try {
			toast.loading('Generando PDF...');
			await accionesCorrectivasAPI.descargarPDF(id, accion_numero);
			toast.success('PDF descargado correctamente');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al descargar el PDF';
			toast.error(message);
		}
	}

	function formatearFecha(fecha: string | undefined): string {
		if (!fecha) return 'N/A';
		// Parsear la fecha como local para evitar problemas de zona horaria
		const [year, month, day] = fecha.split('T')[0].split('-');
		const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
		return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function getBadgeColorTipo(tipo: TipoAccion | undefined): string {
		switch (tipo) {
			case 'CORRECTIVA':
				return 'bg-red-100 text-red-700 border border-red-200';
			case 'PREVENTIVA':
				return 'bg-blue-100 text-blue-700 border border-blue-200';
			case 'MEJORA':
				return 'bg-orange-100 text-orange-700 border border-orange-200';
			default:
				return 'bg-gray-100 text-gray-700 border border-gray-200';
		}
	}

	function getBadgeColorEstado(estado: EstadoAccion | undefined): string {
		switch (estado) {
			case 'Cumplidas':
				return 'bg-orange-100 text-orange-700 border border-orange-200';
			case 'En Proceso':
				return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
			case 'Vencidas':
				return 'bg-red-100 text-red-700 border border-red-200';
			default:
				return 'bg-gray-100 text-gray-700 border border-gray-200';
		}
	}

	function getBadgeColorRiesgo(riesgo: ValoracionRiesgo | undefined): string {
		switch (riesgo) {
			case 'ALTO':
				return 'bg-red-100 text-red-700 border border-red-200';
			case 'MEDIO':
				return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
			case 'BAJO':
				return 'bg-orange-100 text-orange-700 border border-orange-200';
			default:
				return 'bg-gray-100 text-gray-700 border border-gray-200';
		}
	}
</script>

<div class="p-6">
	<!-- Header -->
	<div class="mb-6" in:fade={{ duration: 400 }}>
		<h1 class="mb-2 text-2xl font-bold text-gray-900">Acciones Correctivas y Preventivas</h1>
		<p class="text-gray-600">Matriz HSEQ-MTR-07 - Gestión de hallazgos y planes de acción</p>
	</div>

	<!-- Estadísticas -->
	{#if !isLoadingStats && estadisticas}
		<div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" transition:fade>
			<!-- Total -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 100 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">Total Acciones</p>
						<p class="text-3xl font-bold text-gray-900">{estadisticas.total}</p>
					</div>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-500/30"
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
				</div>
			</div>

			<!-- En Proceso -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 200 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">En Proceso</p>
						<p class="text-3xl font-bold text-yellow-600">
							{estadisticas.por_estado['En Proceso']}
						</p>
					</div>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-lg shadow-yellow-500/30"
					>
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
				</div>
			</div>

			<!-- Próximas a Vencer -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 300 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">Próximas a Vencer</p>
						<p class="text-3xl font-bold text-orange-600">{estadisticas.proximas_vencer}</p>
					</div>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-500/30"
					>
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					</div>
				</div>
			</div>

			<!-- Cumplidas -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 400 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">Cumplidas</p>
						<p class="text-3xl font-bold text-orange-600">{estadisticas.por_estado.Cumplidas}</p>
					</div>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-500/30"
					>
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
		</div>
	{/if}

	<!-- Filtros y Controles -->
	<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 500 }}>
		<div class="mb-4 flex flex-col gap-4 lg:flex-row">
			<!-- Búsqueda -->
			<div class="flex-1">
				<input
					type="text"
					bind:value={busqueda}
					placeholder="Buscar por número, descripción, lugar o responsable..."
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20"
					on:keypress={(e) => e.key === 'Enter' && aplicarFiltros()}
				/>
			</div>

			<!-- Botón Nueva Acción -->
			<button
				on:click={abrirModalCrear}
				class="apple-transition flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2.5 whitespace-nowrap text-white shadow-lg shadow-orange-500/30 hover:from-orange-600 hover:to-orange-700"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/>
				</svg>
				Nueva Acción
			</button>
		</div>

		<!-- Filtros avanzados -->
		<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
			<div>
				<label for="tipoFiltro" class="mb-1.5 block text-sm font-medium text-gray-700">
					Tipo de Acción
				</label>
				<select
					id="tipoFiltro"
					bind:value={tipoFiltro}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
				>
					<option value="">Todos los tipos</option>
					<option value="CORRECTIVA">Correctiva</option>
					<option value="PREVENTIVA">Preventiva</option>
					<option value="MEJORA">Mejora</option>
				</select>
			</div>

			<div>
				<label for="estadoFiltro" class="mb-1.5 block text-sm font-medium text-gray-700">
					Estado
				</label>
				<select
					id="estadoFiltro"
					bind:value={estadoFiltro}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
				>
					<option value="">Todos los estados</option>
					<option value="Cumplidas">Cumplidas</option>
					<option value="En Proceso">En Proceso</option>
					<option value="Vencidas">Vencidas</option>
				</select>
			</div>

			<div>
				<label for="riesgoFiltro" class="mb-1.5 block text-sm font-medium text-gray-700">
					Valoración del Riesgo
				</label>
				<select
					id="riesgoFiltro"
					bind:value={riesgoFiltro}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
				>
					<option value="">Todos los riesgos</option>
					<option value="ALTO">Alto</option>
					<option value="MEDIO">Medio</option>
					<option value="BAJO">Bajo</option>
				</select>
			</div>

			<div>
				<label for="fechaDesde" class="mb-1.5 block text-sm font-medium text-gray-700">
					Fecha Desde
				</label>
				<input
					id="fechaDesde"
					type="date"
					bind:value={fechaDesde}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
				/>
			</div>

			<div>
				<label for="fechaHasta" class="mb-1.5 block text-sm font-medium text-gray-700">
					Fecha Hasta
				</label>
				<input
					id="fechaHasta"
					type="date"
					bind:value={fechaHasta}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
				/>
			</div>
		</div>

		<!-- Botones de acción -->
		<div class="flex gap-2">
			<button
				on:click={aplicarFiltros}
				class="apple-transition rounded-lg bg-orange-600 px-4 py-2 text-white hover:bg-orange-700"
			>
				Aplicar Filtros
			</button>
			<button
				on:click={limpiarFiltros}
				class="apple-transition rounded-lg bg-white/80 px-4 py-2 text-gray-700 hover:bg-gray-100"
			>
				Limpiar
			</button>
		</div>
	</div>

	<!-- Tabla de Acciones -->
	{#if isLoading}
		<div class="glass flex items-center justify-center rounded-xl border border-gray-200 p-8">
			<div class="h-12 w-12 animate-spin rounded-full border-b-2 border-orange-500"></div>
		</div>
	{:else if acciones.length === 0}
		<div class="glass rounded-xl border border-gray-200 p-8 text-center">
			<svg
				class="mx-auto mb-4 h-12 w-12 text-orange-600/50"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
				/>
			</svg>
			<h3 class="mb-2 text-lg font-medium text-gray-900">No hay acciones registradas</h3>
			<p class="mb-4 text-gray-600">Comienza creando una nueva acción correctiva o preventiva.</p>
			<button
				on:click={abrirModalCrear}
				class="apple-transition soft-shadow rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2 text-white hover:from-orange-600 hover:to-orange-700"
			>
				Crear Primera Acción
			</button>
		</div>
	{:else}
		<!-- Vista Desktop: Tabla -->
		<div
			class="glass hidden overflow-hidden rounded-xl border border-gray-200 lg:block"
			transition:fade
		>
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-white/80">
						<tr>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Número
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Descripción
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Tipo
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Estado
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Riesgo
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Responsable
							</th>
							<th
								class="px-6 py-3 text-left text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Fecha Límite
							</th>
							<th
								class="px-6 py-3 text-right text-xs font-medium tracking-wider text-gray-600 uppercase"
							>
								Acciones
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						{#each acciones as accion (accion.id)}
							<tr
								class="apple-transition hover:bg-white/80"
								transition:fly={{ y: 20, duration: 300 }}
							>
								<td class="px-6 py-4 whitespace-nowrap">
									<span class="text-sm font-medium text-gray-900">{accion.accion_numero}</span>
								</td>
								<td class="px-6 py-4">
									<div class="max-w-xs truncate text-sm text-gray-900">
										{accion.descripcion_hallazgo || 'Sin descripción'}
									</div>
									<div class="text-xs text-gray-500">{accion.lugar_sede || 'Sin lugar'}</div>
								</td>
								<td class="px-6 py-4 whitespace-nowrap">
									<span
										class="rounded-full border px-2 py-1 text-xs font-semibold {getBadgeColorTipo(
											accion.tipo_accion_ejecutar
										)}"
									>
										{accion.tipo_accion_ejecutar || 'N/A'}
									</span>
								</td>
								<td class="px-6 py-4 whitespace-nowrap">
									<span
										class="rounded-full border px-2 py-1 text-xs font-semibold {getBadgeColorEstado(
											accion.estado_accion_planeada
										)}"
									>
										{accion.estado_accion_planeada || 'N/A'}
									</span>
								</td>
								<td class="px-6 py-4 whitespace-nowrap">
									<span
										class="rounded-full border px-2 py-1 text-xs font-semibold {getBadgeColorRiesgo(
											accion.valoracion_riesgo
										)}"
									>
										{accion.valoracion_riesgo || 'N/A'}
									</span>
								</td>
								<td class="px-6 py-4 whitespace-nowrap">
									<div class="text-sm text-gray-900">
										{accion.responsable_ejecucion || 'No asignado'}
									</div>
								</td>
								<td class="px-6 py-4 whitespace-nowrap">
									<div class="text-sm text-gray-900">
										{formatearFecha(accion.fecha_limite_implementacion)}
									</div>
								</td>
								<td class="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
									<div class="flex items-center justify-end gap-2">
										<button
											on:click={() => goto(`/dashboard/acciones-correctivas/${accion.id}`)}
											class="apple-transition text-purple-600 hover:text-purple-700"
											title="Ver Detalle"
										>
											<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
										</button>
										<button
											on:click={() => descargarPDF(accion.id, accion.accion_numero)}
											class="apple-transition text-orange-600 hover:text-orange-300"
											title="Descargar PDF"
										>
											<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
												/>
											</svg>
										</button>
										<button
											on:click={() => abrirModalEditar(accion)}
											class="apple-transition text-blue-400 hover:text-blue-300"
											title="Editar"
										>
											<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
												/>
											</svg>
										</button>
										<button
											on:click={() => abrirModalEliminar(accion.id, accion.accion_numero)}
											class="apple-transition text-red-400 hover:text-red-300"
											title="Eliminar"
										>
											<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
												/>
											</svg>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Paginación Desktop -->
			{#if totalPages > 1}
				<div
					class="flex items-center justify-between border-t border-gray-200 bg-white/80 px-4 py-3 sm:px-6"
				>
					<div class="flex flex-1 justify-between sm:hidden">
						<button
							on:click={() => cambiarPagina(page - 1)}
							disabled={page === 1}
							class="apple-transition relative inline-flex items-center rounded-md border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Anterior
						</button>
						<button
							on:click={() => cambiarPagina(page + 1)}
							disabled={page === totalPages}
							class="apple-transition relative ml-3 inline-flex items-center rounded-md border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
						>
							Siguiente
						</button>
					</div>
					<div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
						<div>
							<p class="text-sm text-gray-600">
								Mostrando <span class="font-medium text-gray-900">{(page - 1) * limit + 1}</span> a
								<span class="font-medium text-gray-900">{Math.min(page * limit, total)}</span> de
								<span class="font-medium text-gray-900">{total}</span> resultados
							</p>
						</div>
						<div>
							<nav
								class="relative z-0 inline-flex -space-x-px rounded-md shadow-sm"
								aria-label="Pagination"
							>
								<button
									on:click={() => cambiarPagina(page - 1)}
									disabled={page === 1}
									class="apple-transition relative inline-flex items-center rounded-l-md border border-gray-200 bg-white/80 px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<span class="sr-only">Anterior</span>
									<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
								<!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
								{#each Array(totalPages) as _page, i (i)}
									{#if i + 1 === 1 || i + 1 === totalPages || (i + 1 >= page - 1 && i + 1 <= page + 1)}
										<button
											on:click={() => cambiarPagina(i + 1)}
											class="apple-transition relative inline-flex items-center border border-gray-200 px-4 py-2 text-sm font-medium {page ===
											i + 1
												? 'z-10 bg-orange-500/20 text-orange-300'
												: 'bg-white/80 text-gray-700 hover:bg-gray-100'}"
										>
											{i + 1}
										</button>
									{:else if i + 1 === page - 2 || i + 1 === page + 2}
										<span
											class="relative inline-flex items-center border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700"
										>
											...
										</span>
									{/if}
								{/each}
								<button
									on:click={() => cambiarPagina(page + 1)}
									disabled={page === totalPages}
									class="apple-transition relative inline-flex items-center rounded-r-md border border-gray-200 bg-white/80 px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<span class="sr-only">Siguiente</span>
									<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
							</nav>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Vista Mobile/Tablet: Cards -->
		<div class="space-y-4 lg:hidden" transition:fade>
			{#each acciones as accion (accion.id)}
				<div class="glass rounded-xl border border-gray-200 p-4" in:fly={{ y: 20, duration: 300 }}>
					<!-- Header Card -->
					<div class="mb-3 flex items-start justify-between">
						<div class="flex-1">
							<h3 class="text-lg font-bold text-gray-900">{accion.accion_numero}</h3>
							<p class="mt-1 line-clamp-2 text-sm text-gray-600">
								{accion.descripcion_hallazgo && accion.descripcion_hallazgo.length > 80
									? accion.descripcion_hallazgo.substring(0, 80) + '...'
									: accion.descripcion_hallazgo || 'Sin descripción'}
							</p>
						</div>
					</div>

					<!-- Badges -->
					<div class="mb-3 flex flex-wrap gap-2">
						<span
							class="rounded-full border px-2.5 py-1 text-xs font-semibold {getBadgeColorTipo(
								accion.tipo_accion_ejecutar
							)}"
						>
							{accion.tipo_accion_ejecutar || 'N/A'}
						</span>
						<span
							class="rounded-full border px-2.5 py-1 text-xs font-semibold {getBadgeColorEstado(
								accion.estado_accion_planeada
							)}"
						>
							{accion.estado_accion_planeada || 'N/A'}
						</span>
						<span
							class="rounded-full border px-2.5 py-1 text-xs font-semibold {getBadgeColorRiesgo(
								accion.valoracion_riesgo
							)}"
						>
							Riesgo: {accion.valoracion_riesgo || 'N/A'}
						</span>
					</div>

					<!-- Info Grid -->
					<div class="mb-3 space-y-2 border-t border-gray-200 pt-3">
						<div class="flex items-center text-sm">
							<svg
								class="mr-2 h-4 w-4 text-gray-400"
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
							<span class="text-gray-600">{accion.lugar_sede || 'Sin lugar'}</span>
						</div>
						<div class="flex items-center text-sm">
							<svg
								class="mr-2 h-4 w-4 text-gray-400"
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
							<span class="text-gray-600">{accion.responsable_ejecucion || 'No asignado'}</span>
						</div>
						<div class="flex items-center text-sm">
							<svg
								class="mr-2 h-4 w-4 text-gray-400"
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
							<span class="text-gray-600"
								>Fecha límite: {formatearFecha(accion.fecha_limite_implementacion)}</span
							>
						</div>
					</div>

					<!-- Actions -->
					<div class="flex items-center justify-end gap-2 border-t border-gray-200 pt-3">
						<button
							on:click={() => goto(`/dashboard/acciones-correctivas/${accion.id}`)}
							class="apple-transition flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700"
							title="Ver Detalle"
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
							Ver
						</button>
						<button
							on:click={() => descargarPDF(accion.id, accion.accion_numero)}
							class="apple-transition flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700"
							title="Descargar PDF"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
							PDF
						</button>
						<button
							on:click={() => abrirModalEditar(accion)}
							class="apple-transition rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700"
							title="Editar"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
								/>
							</svg>
						</button>
						<button
							on:click={() => abrirModalEliminar(accion.id, accion.accion_numero)}
							class="apple-transition rounded-lg bg-red-600 p-2 text-white hover:bg-red-700"
							title="Eliminar"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

			<!-- Paginación Mobile/Tablet -->
			{#if totalPages > 1}
				<div class="glass flex items-center justify-between rounded-xl border border-gray-200 p-4">
					<button
						on:click={() => cambiarPagina(page - 1)}
						disabled={page === 1}
						class="apple-transition flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
							<path
								fill-rule="evenodd"
								d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
								clip-rule="evenodd"
							/>
						</svg>
						Anterior
					</button>
					<span class="text-sm text-gray-600">
						Página <span class="font-medium text-gray-900">{page}</span> de
						<span class="font-medium text-gray-900">{totalPages}</span>
					</span>
					<button
						on:click={() => cambiarPagina(page + 1)}
						disabled={page === totalPages}
						class="apple-transition flex items-center gap-1 rounded-lg border border-gray-200 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Siguiente
						<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
							<path
								fill-rule="evenodd"
								d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal -->
{#if showModal}
	<ModalFormularioAccion
		accion={accionEditar}
		{modoEdicion}
		on:close={cerrarModal}
		on:guardado={handleGuardado}
	/>
{/if}

<!-- Modal de Confirmación de Eliminación -->
{#if showDeleteModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		on:click={cerrarModalEliminar}
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
			transition:fly={{ y: 20, duration: 300 }}
			on:click={(e) => e.stopPropagation()}
			role="document"
		>
			<!-- Header -->
			<div class="bg-gradient-to-r from-red-500 to-red-600 px-6 py-5">
				<div class="flex items-center gap-3">
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm"
					>
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					</div>
					<h2 class="text-2xl font-bold text-white">Confirmar Eliminación</h2>
				</div>
			</div>

			<!-- Content -->
			<div class="px-6 py-6">
				<div class="mb-6">
					<p class="mb-2 text-gray-700">¿Está seguro de que desea eliminar la siguiente acción?</p>
					<div class="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
						<p class="font-semibold text-red-900">
							{accionEliminar?.numero}
						</p>
					</div>
					<p class="mt-4 text-sm text-gray-600">
						Esta acción no se puede deshacer. Todos los datos asociados a esta acción
						correctiva/preventiva serán eliminados permanentemente.
					</p>
				</div>

				<!-- Botones -->
				<div class="flex gap-3">
					<button
						type="button"
						on:click={cerrarModalEliminar}
						class="apple-transition flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50"
					>
						Cancelar
					</button>
					<button
						type="button"
						on:click={confirmarEliminacion}
						class="apple-transition flex-1 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-red-500/30 hover:from-red-600 hover:to-red-700"
					>
						Eliminar
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
