<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly, scale } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		asistenciasAPI,
		type FormularioAsistencia,
		type RespuestaAsistencia
	} from '$lib/api/asistencias';
	import ModalFormularioAsistencia from '$lib/components/asistencias/ModalFormularioAsistencia.svelte';
	import { socketUtils } from '$lib/socket';

	let formularioId = '';
	let formulario: FormularioAsistencia | null = null;
	let respuestas: RespuestaAsistencia[] = [];
	let isLoading = true;

	// Filtros
	let searchQuery = '';
	let sortBy: 'fecha' | 'nombre' | 'documento' = 'fecha';
	let sortOrder: 'asc' | 'desc' = 'desc';

	// Signature modal
	let selectedSignature = '';
	let showSignatureModal = false;

	// Edit modal
	let showEditModal = false;

	// Socket listener
	const onRespuestaCreated = ({ respuesta, formularioId: formId }: any) => {
		// Solo actualizar si es para este formulario
		if (formId === formularioId) {
			console.log('📥 Socket: Nueva respuesta en tiempo real', respuesta);
			respuestas = [respuesta, ...respuestas];
			toast.success('Nueva respuesta recibida en tiempo real');
		}
	};

	onMount(async () => {
		formularioId = $page.params.id;
		await cargarDatos();
		setupSocketListener();
	});

	onDestroy(() => {
		cleanupSocketListener();
	});

	function setupSocketListener() {
		socketUtils.on('asistencias:respuesta:created', onRespuestaCreated);
	}

	function cleanupSocketListener() {
		socketUtils.off('asistencias:respuesta:created', onRespuestaCreated);
	}

	async function cargarDatos() {
		isLoading = true;
		try {
			const [formData, respuestasData] = await Promise.all([
				asistenciasAPI.obtenerFormulario(formularioId),
				asistenciasAPI.obtenerRespuestas(formularioId)
			]);

			formulario = formData;
			respuestas = respuestasData;
		} catch (error: any) {
			toast.error(error.message || 'Error al cargar los datos');
			goto('/dashboard/asistencias');
		} finally {
			isLoading = false;
		}
	}

	function volver() {
		goto('/dashboard/asistencias');
	}

	function verFirma(firma: string) {
		selectedSignature = firma;
		showSignatureModal = true;
	}

	function closeSignatureModal() {
		showSignatureModal = false;
		selectedSignature = '';
	}

	function openEditModal() {
		showEditModal = true;
	}

	function closeEditModal() {
		showEditModal = false;
	}

	async function handleFormularioUpdated(event: CustomEvent) {
		showEditModal = false;

		// Si el evento trae la data actualizada, usarla directamente
		if (event.detail?.formulario) {
			// Forzar reactividad creando un nuevo objeto
			formulario = { ...event.detail.formulario };
			toast.success('Formulario actualizado exitosamente');
		} else {
			// Fallback: recargar si no viene la data
			await cargarDatos();
		}
	}

	function exportarCSV() {
		if (!respuestas.length) {
			toast.error('No hay respuestas para exportar');
			return;
		}

		const headers = [
			'Fecha',
			'Nombre Completo',
			'Documento',
			'Cargo',
			'Teléfono',
			'IP',
			'Navegador'
		];

		const rows = respuestasOrdenadas.map((r) => [
			new Date(r.created_at).toLocaleString('es-CO'),
			r.nombre_completo,
			r.numero_documento,
			r.cargo,
			r.numero_telefono,
			r.ip_address || '',
			r.user_agent || ''
		]);

		const csvContent =
			'data:text/csv;charset=utf-8,' +
			[headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
				'\n'
			);

		const encodedUri = encodeURI(csvContent);
		const link = document.createElement('a');
		link.setAttribute('href', encodedUri);
		link.setAttribute('download', `respuestas_${formulario?.tematica}_${Date.now()}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		toast.success('CSV exportado exitosamente');
	}

	async function exportarPDF() {
		if (!respuestas.length) {
			toast.error('No hay respuestas para exportar');
			return;
		}

		try {
			toast.loading('Generando PDF...');
			const blob = await asistenciasAPI.exportarPDF(formularioId);

			// Crear URL del blob y descargar
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute(
				'download',
				`asistencia_${formulario?.tematica.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`
			);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			toast.success('PDF generado exitosamente');
		} catch (error: any) {
			toast.error(error.message || 'Error al generar el PDF');
		}
	}

	function formatFecha(fechaISO: string): string {
		const fecha = new Date(fechaISO);
		return fecha.toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	$: respuestasFiltradas = respuestas.filter((r) => {
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		return (
			r.nombre_completo.toLowerCase().includes(q) ||
			r.numero_documento.toLowerCase().includes(q) ||
			r.cargo.toLowerCase().includes(q)
		);
	});

	$: respuestasOrdenadas = [...respuestasFiltradas].sort((a, b) => {
		let comparison = 0;

		if (sortBy === 'fecha') {
			comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
		} else if (sortBy === 'nombre') {
			comparison = a.nombre_completo.localeCompare(b.nombre_completo);
		} else if (sortBy === 'documento') {
			comparison = a.numero_documento.localeCompare(b.numero_documento);
		}

		return sortOrder === 'asc' ? comparison : -comparison;
	});
</script>

<svelte:head>
	<title>Respuestas - {formulario?.tematica || 'Asistencias'}</title>
</svelte:head>

<div class="px-4 py-6 sm:px-6 lg:px-8">
	<div class="space-y-6">
		{#if isLoading}
			<!-- Loading State -->
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
					<p class="mt-4 text-gray-600">Cargando respuestas...</p>
				</div>
			</div>
		{:else if formulario}
			<!-- Header -->
			<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<button
					on:click={volver}
					class="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
					in:fade={{ duration: 300 }}
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M10 19l-7-7m0 0l7-7m-7 7h18"
						/>
					</svg>
				</button>

				<div class="flex gap-2">
					<button
						on:click={exportarCSV}
						class="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-orange-600"
						in:fade={{ duration: 300, delay: 100 }}
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						Exportar Excel
					</button>

					<button
						on:click={exportarPDF}
						class="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-600"
						in:fade={{ duration: 300, delay: 150 }}
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						Exportar PDF
					</button>
				</div>
			</div>

			<!-- Información del Formulario -->
			<div
				class="rounded-2xl border border-gray-200 bg-white p-6"
				in:fly={{ y: -20, duration: 400, delay: 100 }}
			>
				<div class="flex items-start justify-between gap-4">
					<div class="flex-1 space-y-4">
						<!-- Título y Estado -->
						<div class="flex items-center gap-3">
							<h2 class="text-xl font-bold text-gray-900">{formulario.tematica}</h2>
							<span
								class="rounded-full px-3 py-1 text-xs font-medium {formulario.activo
									? 'bg-orange-100 text-orange-700'
									: 'bg-gray-100 text-gray-700'}"
							>
								{formulario.activo ? 'Activo' : 'Inactivo'}
							</span>
							<!-- Tipo de Evento Badge -->
							<span
								class="inline-flex items-center rounded-md bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700"
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
								{:else if formulario.tipo_evento === 'otro'}{formulario.tipo_evento_otro || 'Otro'}
								{:else}{formulario.tipo_evento}
								{/if}
							</span>
						</div>

						<!-- Objetivo -->
						{#if formulario.objetivo}
							<p class="text-sm text-gray-600">{formulario.objetivo}</p>
						{/if}

						<!-- Grid de Información Detallada -->
						<div
							class="grid grid-cols-1 gap-4 border-t border-gray-100 pt-3 md:grid-cols-2 lg:grid-cols-3"
						>
							<!-- Fecha -->
							<div class="flex items-center gap-2 text-sm">
								<svg
									class="h-4 w-4 flex-shrink-0 text-blue-500"
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
								<div>
									<p class="text-xs text-gray-500">Fecha</p>
									<p class="font-medium text-gray-900">
										{new Date(formulario.fecha).toLocaleDateString('es-CO', {
											day: '2-digit',
											month: 'long',
											year: 'numeric'
										})}
									</p>
								</div>
							</div>

							<!-- Horario -->
							{#if formulario.hora_inicio || formulario.hora_finalizacion}
								<div class="flex items-center gap-2 text-sm">
									<svg
										class="h-4 w-4 flex-shrink-0 text-amber-500"
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
									<div>
										<p class="text-xs text-gray-500">Horario</p>
										<p class="font-medium text-gray-900">
											{formulario.hora_inicio || '--:--'} - {formulario.hora_finalizacion ||
												'--:--'}
											{#if formulario.duracion_minutos}
												<span class="ml-1 text-xs text-gray-500">
													({Math.floor(formulario.duracion_minutos / 60)}h {formulario.duracion_minutos %
														60}m)
												</span>
											{/if}
										</p>
									</div>
								</div>
							{/if}

							<!-- Lugar -->
							{#if formulario.lugar_sede}
								<div class="flex items-center gap-2 text-sm">
									<svg
										class="h-4 w-4 flex-shrink-0 text-orange-500"
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
									<div>
										<p class="text-xs text-gray-500">Lugar / Sede</p>
										<p class="font-medium text-gray-900">{formulario.lugar_sede}</p>
									</div>
								</div>
							{/if}

							<!-- Instructor -->
							{#if formulario.nombre_instructor}
								<div class="flex items-center gap-2 text-sm">
									<svg
										class="h-4 w-4 flex-shrink-0 text-indigo-500"
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
									<div>
										<p class="text-xs text-gray-500">Instructor</p>
										<p class="font-medium text-gray-900">{formulario.nombre_instructor}</p>
									</div>
								</div>
							{/if}

							<!-- Respuestas -->
							<div class="flex items-center gap-2 text-sm">
								<svg
									class="h-4 w-4 flex-shrink-0 text-blue-500"
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
								<div>
									<p class="text-xs text-gray-500">Respuestas</p>
									<p class="font-medium text-gray-900">
										{respuestas.length}
										{respuestas.length === 1 ? 'respuesta' : 'respuestas'}
									</p>
								</div>
							</div>

							<!-- Creado por -->
							{#if formulario.creado_por}
								<div class="flex items-center gap-2 text-sm">
									<svg
										class="h-4 w-4 flex-shrink-0 text-gray-500"
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
									<div>
										<p class="text-xs text-gray-500">Creado por</p>
										<p class="font-medium text-gray-900">{formulario.creado_por.nombre}</p>
									</div>
								</div>
							{/if}
						</div>

						<!-- Observaciones -->
						{#if formulario.observaciones}
							<div class="border-t border-gray-100 pt-3">
								<div class="flex items-start gap-2 text-sm">
									<svg
										class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
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
									<div class="flex-1">
										<p class="mb-1 text-xs text-gray-500">Observaciones</p>
										<p class="text-sm leading-relaxed text-gray-700">{formulario.observaciones}</p>
									</div>
								</div>
							</div>
						{/if}
					</div>

					<!-- Botón de edición -->
					<button
						on:click={openEditModal}
						class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
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
						Editar
					</button>
				</div>
			</div>

			<!-- Filters -->
			<div
				class="glass flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:flex-row md:items-center"
				in:fly={{ y: -20, duration: 400 }}
			>
				<!-- Search -->
				<div class="flex-1">
					<div class="relative">
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
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Buscar por nombre, documento o cargo..."
							class="input-glow w-full rounded-xl border border-gray-200 bg-white py-2 pr-4 pl-10 text-gray-900 placeholder-gray-400 transition-all focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						/>
					</div>
				</div>

				<!-- Sort -->
				<div class="flex gap-2">
					<select
						bind:value={sortBy}
						class="input-glow rounded-xl border border-gray-200 bg-white px-4 py-2 text-gray-900 transition-all focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
					>
						<option value="fecha">Fecha</option>
						<option value="nombre">Nombre</option>
						<option value="documento">Documento</option>
					</select>

					<button
						on:click={() => (sortOrder = sortOrder === 'asc' ? 'desc' : 'asc')}
						class="flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 transition-all hover:bg-gray-50"
						title={sortOrder === 'asc' ? 'Ascendente' : 'Descendente'}
					>
						<svg
							class="h-5 w-5 text-gray-900 transition-transform {sortOrder === 'desc'
								? 'rotate-180'
								: ''}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 15l7-7 7 7"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Respuestas -->
			{#if respuestasOrdenadas.length === 0}
				<div
					class="glass rounded-2xl border border-gray-200 bg-white p-12 text-center"
					in:fade={{ duration: 300 }}
				>
					<svg class="mx-auto h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24">
						<path
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
					<h3 class="mt-4 text-lg font-semibold text-gray-900">
						{searchQuery ? 'No se encontraron resultados' : 'Aún no hay respuestas'}
					</h3>
					<p class="mt-2 text-gray-600">
						{searchQuery
							? 'Intenta con otros términos de búsqueda'
							: 'Las respuestas aparecerán aquí'}
					</p>
				</div>
			{:else}
				<!-- Vista Desktop: Tabla -->
				<div class="hidden overflow-hidden rounded-xl border border-gray-200 bg-white lg:block">
					<!-- Encabezados -->
					<div
						class="grid grid-cols-12 gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-700"
					>
						<div class="col-span-2">Nombre Completo</div>
						<div class="col-span-2">Documento</div>
						<div class="col-span-2">Cargo</div>
						<div class="col-span-1">Teléfono</div>
						<div class="col-span-2">Fecha</div>
						<div class="col-span-3 text-center">Firma Digital</div>
					</div>

					<!-- Filas -->
					<div class="divide-y divide-gray-200">
						{#each respuestasOrdenadas as respuesta, i (respuesta.id)}
							<div
								class="grid grid-cols-12 gap-4 px-4 py-3 transition-colors hover:bg-gray-50"
								in:fly={{ y: 20, duration: 300, delay: i * 20 }}
							>
								<!-- Nombre -->
								<div class="col-span-2">
									<p class="text-sm font-medium text-gray-900">{respuesta.nombre_completo}</p>
								</div>

								<!-- Documento -->
								<div class="col-span-2">
									<p class="text-sm text-gray-600">{respuesta.numero_documento}</p>
								</div>

								<!-- Cargo -->
								<div class="col-span-2">
									<p class="text-sm text-gray-600">{respuesta.cargo}</p>
								</div>

								<!-- Teléfono -->
								<div class="col-span-1">
									<p class="text-sm text-gray-600">{respuesta.numero_telefono}</p>
								</div>

								<!-- Fecha -->
								<div class="col-span-2">
									<p class="text-sm text-gray-600">{formatFecha(respuesta.created_at)}</p>
								</div>

								<!-- Firma -->
								<div class="col-span-3 flex justify-center">
									<button
										on:click={() => verFirma(respuesta.firma)}
										class="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 p-1 transition-all hover:border-orange-400"
									>
										<img
											src={respuesta.firma}
											alt="Firma"
											class="h-12 w-24 rounded object-contain"
										/>
										<div
											class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
										>
											<svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
												<path
													stroke="currentColor"
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
												/>
											</svg>
										</div>
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Vista Mobile/Tablet: Cards -->
				<div class="space-y-4 lg:hidden">
					{#each respuestasOrdenadas as respuesta, i (respuesta.id)}
						<div
							class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
							in:fly={{ y: 20, duration: 300, delay: i * 20 }}
						>
							<!-- Header con nombre y fecha -->
							<div
								class="mb-3 flex items-start justify-between gap-3 border-b border-gray-100 pb-3"
							>
								<div class="flex-1">
									<h3 class="font-semibold text-gray-900">{respuesta.nombre_completo}</h3>
									<p class="mt-1 text-xs text-gray-500">{formatFecha(respuesta.created_at)}</p>
								</div>
								<button
									on:click={() => verFirma(respuesta.firma)}
									class="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 p-1 transition-all hover:border-orange-400"
								>
									<img src={respuesta.firma} alt="Firma" class="h-16 w-20 rounded object-contain" />
									<div
										class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
									>
										<svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
											<path
												stroke="currentColor"
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
											/>
										</svg>
									</div>
								</button>
							</div>

							<!-- Datos en grid -->
							<div class="grid grid-cols-2 gap-3">
								<div>
									<p class="text-xs font-medium text-gray-500">Documento</p>
									<p class="mt-1 text-sm text-gray-900">{respuesta.numero_documento}</p>
								</div>
								<div>
									<p class="text-xs font-medium text-gray-500">Teléfono</p>
									<p class="mt-1 text-sm text-gray-900">{respuesta.numero_telefono}</p>
								</div>
								<div class="col-span-2">
									<p class="text-xs font-medium text-gray-500">Cargo</p>
									<p class="mt-1 text-sm text-gray-900">{respuesta.cargo}</p>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Signature Modal -->
{#if showSignatureModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm select-none"
		on:click={closeSignatureModal}
		on:keydown={(e) => e.key === 'Escape' && closeSignatureModal()}
		role="button"
		tabindex="0"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="max-w-4xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl select-none"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="button"
			tabindex="0"
			transition:fade={{ duration: 150 }}
		>
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-xl font-bold text-gray-900">Firma Digital</h3>
				<button
					on:click={closeSignatureModal}
					class="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white p-4">
				<img
					src={selectedSignature}
					alt="Firma ampliada"
					class="pointer-events-none w-full select-none"
					draggable="false"
				/>
			</div>
		</div>
	</div>
{/if}

<!-- Modal de Edición -->
<ModalFormularioAsistencia
	bind:isOpen={showEditModal}
	formularioEdit={formulario}
	on:close={closeEditModal}
	on:save={handleFormularioUpdated}
/>
