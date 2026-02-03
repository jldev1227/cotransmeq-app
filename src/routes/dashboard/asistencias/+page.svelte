<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { asistenciasAPI, type FormularioAsistencia } from '$lib/api/asistencias';
	import ModalFormularioAsistencia from '$lib/components/asistencias/ModalFormularioAsistencia.svelte';
	import ModalConfirm from '$lib/components/common/ModalConfirm.svelte';
	import { asistenciasStore, type FormularioWithStatus } from '$lib/stores/asistencias';
	import { socketUtils } from '$lib/socket';

	let formularios: FormularioWithStatus[] = [];
	let isLoading = true;
	let showModalForm = false;
	let formularioEdit: FormularioAsistencia | null = null;
	let showModalDelete = false;
	let formularioToDelete: FormularioAsistencia | null = null;
	let isDeletingFormulario = false;
	let searchQuery = '';
	let filterActivo: 'all' | 'activo' | 'inactivo' = 'all';
	let sortBy: 'fecha' | 'tematica' | 'respuestas' = 'fecha';
	let sortOrder: 'asc' | 'desc' = 'desc';

	// Suscribirse al store
	const unsubscribe = asistenciasStore.subscribe((value) => {
		formularios = value;
	});

	// Callbacks para eventos socket
	const onFormularioCreated = ({ formulario }: any) => {
		console.log('📥 Socket: Nuevo formulario creado', formulario);
		asistenciasStore.addFormulario(formulario, 'created');
		toast.success(`Nuevo formulario: ${formulario.tematica}`);
	};

	const onFormularioUpdated = ({ formulario }: any) => {
		console.log('📥 Socket: Formulario actualizado', formulario);
		asistenciasStore.updateFormulario(formulario, 'updated');
	};

	const onFormularioDisabled = ({ formulario }: any) => {
		console.log('📥 Socket: Formulario deshabilitado', formulario);
		asistenciasStore.updateFormulario(formulario, 'disabled');
	};

	const onRespuestaCreated = ({ formularioId }: any) => {
		console.log('📥 Socket: Nueva respuesta recibida para formulario', formularioId);
		asistenciasStore.incrementResponseCount(formularioId);
		toast.success('Nueva respuesta recibida');
	};

	onMount(() => {
		cargarFormularios();
		setupSocketListeners();
	});

	onDestroy(() => {
		unsubscribe();
		cleanupSocketListeners();
	});

	function setupSocketListeners() {
		// Escuchar eventos de asistencias
		socketUtils.on('asistencias:formulario:created', onFormularioCreated);
		socketUtils.on('asistencias:formulario:updated', onFormularioUpdated);
		socketUtils.on('asistencias:formulario:disabled', onFormularioDisabled);
		socketUtils.on('asistencias:respuesta:created', onRespuestaCreated);
	}

	function cleanupSocketListeners() {
		// Limpiar listeners
		socketUtils.off('asistencias:formulario:created', onFormularioCreated);
		socketUtils.off('asistencias:formulario:updated', onFormularioUpdated);
		socketUtils.off('asistencias:formulario:disabled', onFormularioDisabled);
		socketUtils.off('asistencias:respuesta:created', onRespuestaCreated);
	}

	async function cargarFormularios() {
		isLoading = true;
		try {
			const data = await asistenciasAPI.obtenerFormularios();
			asistenciasStore.set(data);
		} catch (error: any) {
			toast.error('Error al cargar los formularios');
			console.error(error);
		} finally {
			isLoading = false;
		}
	}

	async function handleFormularioSaved(event: CustomEvent) {
		// Si el evento trae la data actualizada, actualizar solo ese formulario
		if (event.detail?.formulario) {
			const updatedFormulario = event.detail.formulario;
			console.log('📝 Formulario guardado desde modal:', updatedFormulario);

			// Verificar si existe
			const exists = formularios.find((f) => f.id === updatedFormulario.id);

			if (exists) {
				// ACTUALIZACIÓN: Aplicar indicador visual
				console.log('✏️ Actualizando formulario existente con status "updated"');
				asistenciasStore.updateFormulario(updatedFormulario, 'updated');
				toast.success('Formulario actualizado exitosamente');
			} else {
				// CREACIÓN: No hacer nada, el socket ya lo agregará
				// El backend emite el evento socket automáticamente
				console.log('✨ Formulario creado, esperando evento socket...');
			}
		}
	}

	function openCreateModal() {
		formularioEdit = null;
		showModalForm = true;
	}

	function openEditModal(formulario: FormularioAsistencia) {
		formularioEdit = formulario;
		showModalForm = true;
	}

	async function toggleActivo(formulario: FormularioAsistencia) {
		try {
			const updatedFormulario = await asistenciasAPI.actualizarFormulario(formulario.id, {
				activo: !formulario.activo
			});

			// Actualizar localmente SIN indicador (el socket lo mostrará para otros usuarios)
			asistenciasStore.update((formularios) => {
				const index = formularios.findIndex((f) => f.id === updatedFormulario.id);
				if (index !== -1) {
					formularios[index] = updatedFormulario;
				}
				return [...formularios];
			});

			toast.success(updatedFormulario.activo ? 'Formulario activado' : 'Formulario desactivado');
		} catch (error: any) {
			toast.error('Error al actualizar el formulario');
		}
	}

	async function eliminarFormulario(formulario: FormularioAsistencia) {
		formularioToDelete = formulario;
		showModalDelete = true;
	}

	async function confirmarEliminarFormulario() {
		if (!formularioToDelete) return;

		isDeletingFormulario = true;
		try {
			await asistenciasAPI.eliminarFormulario(formularioToDelete.id);

			// Eliminar del store local
			asistenciasStore.update((formularios) =>
				formularios.filter((f) => f.id !== formularioToDelete!.id)
			);

			toast.success('Formulario eliminado exitosamente');
			showModalDelete = false;
			formularioToDelete = null;
		} catch (error: any) {
			toast.error('Error al eliminar el formulario');
		} finally {
			isDeletingFormulario = false;
		}
	}

	function copiarEnlace(formulario: FormularioAsistencia) {
		const url = asistenciasAPI.generarUrlPublica(formulario.token);
		navigator.clipboard.writeText(url);
		toast.success('Enlace copiado al portapapeles');
	}

	// Filtrado y ordenamiento
	$: formulariosFiltered = formularios
		.filter((f) => {
			// Filtro de búsqueda (ahora incluye más campos)
			const matchSearch =
				searchQuery === '' ||
				f.tematica.toLowerCase().includes(searchQuery.toLowerCase()) ||
				f.objetivo?.toLowerCase().includes(searchQuery.toLowerCase()) ||
				f.tipo_evento?.toLowerCase().includes(searchQuery.toLowerCase()) ||
				f.tipo_evento_otro?.toLowerCase().includes(searchQuery.toLowerCase()) ||
				f.lugar_sede?.toLowerCase().includes(searchQuery.toLowerCase()) ||
				f.nombre_instructor?.toLowerCase().includes(searchQuery.toLowerCase());

			// Filtro de activo/inactivo
			const matchActivo =
				filterActivo === 'all' ||
				(filterActivo === 'activo' && f.activo) ||
				(filterActivo === 'inactivo' && !f.activo);

			return matchSearch && matchActivo;
		})
		.sort((a, b) => {
			let comparison = 0;

			if (sortBy === 'fecha') {
				comparison = new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
			} else if (sortBy === 'tematica') {
				comparison = a.tematica.localeCompare(b.tematica);
			} else if (sortBy === 'respuestas') {
				comparison = (a._count?.respuestas || 0) - (b._count?.respuestas || 0);
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

	function formatFecha(fechaISO: string): string {
		const fecha = new Date(fechaISO);
		// Usar UTC para evitar problemas de zona horaria
		const year = fecha.getUTCFullYear();
		const month = fecha.getUTCMonth();
		const day = fecha.getUTCDate();

		// Crear fecha en formato local sin conversión de zona horaria
		const fechaLocal = new Date(year, month, day);

		return fechaLocal.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Asistencias - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen p-6">
	<!-- Header -->
	<div class="mb-8" in:fade={{ duration: 600 }}>
		<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">Formularios de Asistencia</h1>
				<p class="mt-2 text-gray-600">
					Crea y administra formularios para recolectar asistencias con firma digital
				</p>
			</div>
			<button
				on:click={openCreateModal}
				class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-medium text-white shadow-lg transition-all hover:shadow-orange-500/50"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/>
				</svg>
				Nuevo Formulario
			</button>
		</div>
	</div>

	<!-- Filters -->
	<div class="glass mb-6 rounded-2xl p-6" in:fly={{ y: 20, duration: 400, delay: 100 }}>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<!-- Búsqueda -->
			<div class="md:col-span-1">
				<div class="relative">
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Buscar formularios..."
						class="w-full rounded-xl border border-gray-200 bg-white/80 py-3 pr-4 pl-11 text-gray-900 placeholder-gray-400 backdrop-blur-sm transition-all focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
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
			</div>

			<!-- Filtro Activo -->
			<div>
				<select
					bind:value={filterActivo}
					class="w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-3 text-gray-900 backdrop-blur-sm transition-all focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
				>
					<option value="all">Todos los formularios</option>
					<option value="activo">Solo activos</option>
					<option value="inactivo">Solo inactivos</option>
				</select>
			</div>

			<!-- Ordenamiento -->
			<div class="flex gap-2">
				<select
					bind:value={sortBy}
					class="flex-1 rounded-xl border border-gray-200 bg-white/80 px-4 py-3 text-gray-900 backdrop-blur-sm transition-all focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
				>
					<option value="fecha">Fecha</option>
					<option value="tematica">Temática</option>
					<option value="respuestas">Respuestas</option>
				</select>
				<button
					on:click={() => (sortOrder = sortOrder === 'asc' ? 'desc' : 'asc')}
					class="rounded-xl border border-gray-200 bg-white/80 p-3 text-gray-700 backdrop-blur-sm transition-all hover:bg-gray-50"
					title={sortOrder === 'asc' ? 'Ascendente' : 'Descendente'}
				>
					<svg
						class="h-5 w-5 transition-transform {sortOrder === 'desc' ? 'rotate-180' : ''}"
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
				</button>
			</div>
		</div>
	</div>

	<!-- Lista de Formularios -->
	{#if isLoading}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<svg
					class="mx-auto h-12 w-12 animate-spin text-orange-500"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="4"
					/>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
				<p class="mt-4 text-gray-600">Cargando formularios...</p>
			</div>
		</div>
	{:else if formulariosFiltered.length === 0}
		<div
			class="rounded-2xl border border-gray-200 bg-white p-12 text-center"
			in:fade={{ duration: 300 }}
		>
			<svg
				class="mx-auto h-16 w-16 text-gray-300"
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
			<p class="mt-4 text-xl font-semibold text-gray-700">
				{searchQuery || filterActivo !== 'all'
					? 'No se encontraron formularios'
					: 'No hay formularios creados'}
			</p>
			<p class="mt-2 text-gray-500">
				{searchQuery || filterActivo !== 'all'
					? 'Intenta ajustar los filtros de búsqueda'
					: 'Crea tu primer formulario de asistencia'}
			</p>
		</div>
	{:else}
		<!-- Lista estilo tabla sin columnas -->
		<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
			<div class="divide-y divide-gray-200">
				{#each formulariosFiltered as formulario, index (formulario.id)}
					<div
						class="group relative p-6 transition-colors hover:bg-gray-50
							{formulario._status === 'created' ? 'border-l-4 border-orange-500 bg-orange-50/30' : ''}
							{formulario._status === 'updated' ? 'border-l-4 border-blue-500 bg-blue-50/30' : ''}
							{formulario._status === 'disabled' ? 'border-l-4 border-orange-500 bg-orange-50/30' : ''}"
						in:fly={{ y: 20, duration: 400, delay: index * 50 + 200 }}
					>
						<!-- Fila única con toda la información -->
						<div class="flex flex-wrap items-center gap-x-8 gap-y-3">
							<!-- Columna 1: Título, objetivo y tipo de evento -->
							<div class="min-w-[300px] flex-1">
								<h3 class="mb-1 text-base font-bold text-gray-900">
									{formulario.tematica}
								</h3>
								{#if formulario.objetivo}
									<p class="mb-2 line-clamp-1 text-sm text-gray-600">
										{formulario.objetivo}
									</p>
								{/if}

								<!-- Tipo de Evento Badge -->
								<span
									class="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700"
								>
									<svg class="mr-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
										/>
									</svg>
									{#if formulario.tipo_evento === 'capacitacion'}Capacitación
									{:else if formulario.tipo_evento === 'asesoria'}Asesoría
									{:else if formulario.tipo_evento === 'charla'}Charla
									{:else if formulario.tipo_evento === 'induccion'}Inducción
									{:else if formulario.tipo_evento === 'reunion'}Reunión
									{:else if formulario.tipo_evento === 'divulgacion'}Divulgación
									{:else if formulario.tipo_evento === 'otro'}{formulario.tipo_evento_otro ||
											'Otro'}
									{:else}{formulario.tipo_evento}
									{/if}
								</span>
							</div>

							<!-- Columna 2: Fecha y Horario -->
							<div class="flex items-center gap-6">
								<div class="flex items-center gap-2 text-sm">
									<svg
										class="h-4 w-4 text-blue-500"
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
									<span class="font-medium text-gray-700">{formatFecha(formulario.fecha)}</span>
								</div>

								{#if formulario.hora_inicio || formulario.hora_finalizacion}
									<div class="flex items-center gap-2 text-sm">
										<svg
											class="h-4 w-4 text-amber-500"
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
										<span class="text-gray-700">
											{formulario.hora_inicio || '--:--'} - {formulario.hora_finalizacion ||
												'--:--'}
											{#if formulario.duracion_minutos}
												<span class="ml-1 text-xs text-gray-500">
													({Math.floor(formulario.duracion_minutos / 60)}h {formulario.duracion_minutos %
														60}m)
												</span>
											{/if}
										</span>
									</div>
								{/if}
							</div>

							<!-- Columna 3: Lugar e Instructor -->
							<div class="flex items-center gap-6">
								{#if formulario.lugar_sede}
									<div class="flex items-center gap-2 text-sm">
										<svg
											class="h-4 w-4 text-orange-500"
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
										<span class="max-w-[200px] truncate text-gray-700">{formulario.lugar_sede}</span
										>
									</div>
								{/if}

								{#if formulario.nombre_instructor}
									<div class="flex items-center gap-2 text-sm">
										<svg
											class="h-4 w-4 text-indigo-500"
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
										<span class="max-w-[180px] truncate text-gray-700"
											>{formulario.nombre_instructor}</span
										>
									</div>
								{/if}
							</div>

							<!-- Columna 4: Estado y Respuestas -->
							<div class="flex items-center gap-4">
								<!-- Estado Badge -->
								<div class="flex-shrink-0">
									{#if formulario.activo}
										<span
											class="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700"
										>
											<span class="mr-1 h-1.5 w-1.5 rounded-full bg-orange-500"></span>
											Activo
										</span>
									{:else}
										<span
											class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
										>
											<span class="mr-1 h-1.5 w-1.5 rounded-full bg-gray-400"></span>
											Inactivo
										</span>
									{/if}
								</div>

								<!-- Respuestas -->
								<div class="flex items-center gap-2">
									<svg
										class="h-4 w-4 text-blue-500"
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
									<div class="relative inline-flex items-center gap-1">
										<span
											class="inline-flex items-center justify-center rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700"
										>
											{formulario._count?.respuestas || 0}
										</span>
										{#if formulario._newResponsesCount && formulario._newResponsesCount > 0}
											<span
												class="inline-flex animate-bounce items-center justify-center rounded-full bg-orange-500 px-2 py-0.5 text-xs font-bold text-white shadow-lg"
												transition:scale={{ duration: 300 }}
											>
												+{formulario._newResponsesCount}
											</span>
										{/if}
									</div>
								</div>
							</div>

							<!-- Columna 5: Acciones -->
							<div class="ml-auto flex items-center gap-2">
								<div class="flex gap-2">
									<!-- Ver Respuestas -->
									<button
										on:click={() => goto(`/dashboard/asistencias/${formulario.id}/respuestas`)}
										class="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100"
										title="Ver todas las respuestas"
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

									<!-- Copiar Enlace -->
									<button
										on:click={() => copiarEnlace(formulario)}
										class="rounded-lg bg-purple-50 p-1.5 text-purple-600 transition-colors hover:bg-purple-100"
										title="Copiar enlace público"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
											/>
										</svg>
									</button>
								</div>

								<div class="flex gap-2">
									<!-- Editar -->
									<button
										on:click={() => openEditModal(formulario)}
										class="rounded-lg bg-amber-50 p-1.5 text-amber-600 transition-colors hover:bg-amber-100"
										title="Editar formulario"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
											/>
										</svg>
									</button>

									<!-- Activar/Desactivar -->
									<button
										on:click={() => toggleActivo(formulario)}
										class="rounded-lg {formulario.activo
											? 'bg-orange-50 text-orange-600 hover:bg-orange-100'
											: 'bg-orange-50 text-orange-600 hover:bg-orange-100'} p-1.5 transition-colors"
										title={formulario.activo ? 'Desactivar' : 'Activar'}
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											{#if formulario.activo}
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
												/>
											{:else}
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											{/if}
										</svg>
									</button>

									<!-- Eliminar -->
									<button
										on:click={() => eliminarFormulario(formulario)}
										class="rounded-lg bg-red-50 p-1.5 text-red-600 transition-colors hover:bg-red-100"
										title="Eliminar formulario"
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
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Modal Formulario -->
<ModalFormularioAsistencia
	bind:isOpen={showModalForm}
	bind:formularioEdit
	on:save={handleFormularioSaved}
/>

<!-- Modal Confirmar Eliminación -->
<ModalConfirm
	bind:isOpen={showModalDelete}
	title="¿Eliminar formulario?"
	message={formularioToDelete
		? `Se eliminará permanentemente el formulario "${formularioToDelete.tematica}" y todas sus ${formularioToDelete._count?.respuestas || 0} respuestas asociadas. Esta acción no se puede deshacer.`
		: ''}
	confirmText="Eliminar"
	cancelText="Cancelar"
	type="danger"
	isLoading={isDeletingFormulario}
	on:confirm={confirmarEliminarFormulario}
	on:cancel={() => {
		showModalDelete = false;
		formularioToDelete = null;
	}}
/>

<style>
	/* Hacer que los tooltips aparezcan más rápido */
	:global([title]) {
		position: relative;
	}
</style>
