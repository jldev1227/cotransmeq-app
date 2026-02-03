<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { io, type Socket } from 'socket.io-client';

	interface Evaluacion {
		id: string;
		titulo: string;
		descripcion: string | null;
		requiere_firma: boolean;
		created_at: string;
		updated_at: string;
		preguntas: Pregunta[];
	}

	interface Pregunta {
		id: string;
		texto: string;
		tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION';
		puntaje: number;
		opciones: Opcion[];
		relacionIzq: string[];
		relacionDer: string[];
		respuestaCorrecta?: number;
	}

	interface Opcion {
		id: string;
		texto: string;
		esCorrecta: boolean;
	}

	interface Resultado {
		id: string;
		nombre_completo: string;
		numero_documento: string;
		cargo: string;
		lugar_proceso: string;
		correo: string;
		telefono: string;
		puntaje_total: number;
		firma: string | null;
		created_at: string;
		respuestas: RespuestaDetalle[];
	}

	interface RespuestaDetalle {
		id: string;
		pregunta_id: string;
		respuesta_texto: string | null;
		puntaje_obtenido: number;
		pregunta?: Pregunta;
	}

	let evaluacion: Evaluacion | null = null;
	let resultados: Resultado[] = [];
	let isLoading = false;
	let isLoadingResultados = false;
	let error: string | null = null;
	let showResultados = true;
	let socket: Socket | null = null;
	let nuevosResultadosCount = 0;
	let resultadoSeleccionado: Resultado | null = null;
	let showModalDetalle = false;

	$: evaluacionId = $page.params.id;

	onMount(() => {
		loadEvaluacion();
		loadResultados();
		initSocket();
	});

	onDestroy(() => {
		if (socket) {
			socket.disconnect();
		}
	});

	function initSocket() {
		socket = io(import.meta.env.VITE_API_URL, {
			transports: ['websocket', 'polling']
		});

		socket.on('connect', () => {
			console.log('Socket conectado');
			// Unirse a la sala de esta evaluación
			socket?.emit('join-evaluacion', evaluacionId);
		});

		socket.on('nueva-respuesta', (data: Resultado) => {
			console.log('Nueva respuesta recibida:', data);
			// Agregar al inicio del array
			resultados = [data, ...resultados];
			nuevosResultadosCount++;
			toast.success(`Nueva respuesta de ${data.nombre_completo}`);
		});

		socket.on('disconnect', () => {
			console.log('Socket desconectado');
		});
	}

	async function loadEvaluacion() {
		isLoading = true;
		error = null;
		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}`
			);
			const data = await response.json();
			if (data.success) {
				evaluacion = data.data;
			} else {
				error = 'Error al cargar la evaluación';
			}
		} catch (err: any) {
			error = err.message || 'Error al cargar la evaluación';
			console.error('Error:', err);
		} finally {
			isLoading = false;
		}
	}

	async function loadResultados() {
		isLoadingResultados = true;
		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/resultados`
			);

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Error response:', errorText);
				return;
			}

			const data = await response.json();
			if (data.success) {
				resultados = data.data;
				console.log('📊 Resultados cargados:', resultados.length);
				if (resultados.length > 0) {
					console.log('📋 Primer resultado:', resultados[0]);
				}
			}
		} catch (err: any) {
			console.error('Error:', err);
		} finally {
			isLoadingResultados = false;
		}
	}

	function verDetalleResultado(resultado: Resultado) {
		console.log('🔍 Resultado seleccionado:', resultado);
		console.log('📝 Respuestas:', resultado.respuestas);
		resultadoSeleccionado = resultado;
		showModalDetalle = true;
	}

	function cerrarModalDetalle() {
		showModalDetalle = false;
		resultadoSeleccionado = null;
	}

	function limpiarNuevosResultados() {
		nuevosResultadosCount = 0;
	}

	function getTipoColor(tipo: string) {
		const colors: Record<string, string> = {
			OPCION_UNICA: 'bg-blue-100 text-blue-800',
			OPCION_MULTIPLE: 'bg-purple-100 text-purple-800',
			NUMERICA: 'bg-orange-100 text-orange-800',
			TEXTO: 'bg-orange-100 text-orange-800',
			RELACION: 'bg-pink-100 text-pink-800'
		};
		return colors[tipo] || 'bg-gray-100 text-gray-800';
	}

	function getTipoLabel(tipo: string) {
		const labels: Record<string, string> = {
			OPCION_UNICA: 'Opción Única',
			OPCION_MULTIPLE: 'Opción Múltiple',
			NUMERICA: 'Numérica',
			TEXTO: 'Texto',
			RELACION: 'Relación'
		};
		return labels[tipo] || tipo;
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

	function calcularPuntajeTotal() {
		if (!evaluacion) return 0;
		return evaluacion.preguntas.reduce((sum, p) => sum + p.puntaje, 0);
	}

	function generarEnlacePublico() {
		const publicUrl = `${window.location.origin}/evaluaciones/${evaluacionId}`;
		navigator.clipboard.writeText(publicUrl);
		toast.success('Enlace copiado al portapapeles');
	}

	async function eliminarEvaluacion() {
		if (!evaluacion) return;
		if (!confirm(`¿Estás seguro de eliminar la evaluación "${evaluacion.titulo}"?`)) return;

		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}`,
				{
					method: 'DELETE'
				}
			);
			if (response.ok) {
				toast.success('Evaluación eliminada correctamente');
				goto('/dashboard/evaluaciones');
			} else {
				toast.error('Error al eliminar la evaluación');
			}
		} catch (err) {
			console.error('Error:', err);
			toast.error('Error al eliminar la evaluación');
		}
	}
</script>

<svelte:head>
	<title>{evaluacion?.titulo || 'Evaluación'} - Cotransmeq</title>
</svelte:head>

<div class="space-y-6 p-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-4">
			<button
				on:click={() => goto('/dashboard/evaluaciones')}
				class="apple-transition rounded-lg bg-gray-200 p-2 text-gray-700 hover:bg-gray-300"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19l-7-7 7-7"
					/>
				</svg>
			</button>
			<div>
				<h1 class="text-3xl font-bold text-gray-900">{evaluacion?.titulo || 'Cargando...'}</h1>
				<p class="text-gray-600">Detalle de la evaluación</p>
			</div>
		</div>

		{#if evaluacion}
			<div class="flex gap-2">
				<button
					on:click={() => goto(`/dashboard/evaluaciones/${evaluacionId}/editar`)}
					class="apple-transition rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
				>
					<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
						/>
					</svg>
					Editar
				</button>
				<button
					on:click={generarEnlacePublico}
					class="apple-transition rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600"
				>
					<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
						/>
					</svg>
					Copiar Enlace Público
				</button>
				<button
					on:click={eliminarEvaluacion}
					class="apple-transition rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
				>
					<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					Eliminar
				</button>
			</div>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="text-center">
				<div
					class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"
				></div>
				<p class="text-gray-600">Cargando evaluación...</p>
			</div>
		</div>
	{:else if error}
		<div class="glass rounded-2xl border border-red-200/50 bg-red-50/30 p-8 text-center">
			<p class="text-red-600">{error}</p>
		</div>
	{:else if evaluacion}
		<!-- Layout de 2 columnas -->
		<div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
			<!-- Columna izquierda: Info y Preguntas -->
			<div class="space-y-6 xl:col-span-2">
				<!-- Información básica -->
				<div class="glass rounded-2xl border border-gray-200/50 p-6" in:fade>
					<div class="mb-4 flex items-center gap-4">
						<div class="flex flex-wrap gap-3">
							<div class="rounded-lg bg-orange-50 px-4 py-2">
								<span class="text-2xl font-bold text-orange-600">
									{evaluacion.preguntas.length}
								</span>
								<span class="ml-2 text-sm text-gray-600">Preguntas</span>
							</div>
							<div class="rounded-lg bg-blue-50 px-4 py-2">
								<span class="text-2xl font-bold text-blue-600">
									{calcularPuntajeTotal()}
								</span>
								<span class="ml-2 text-sm text-gray-600">Puntos</span>
							</div>
							{#if evaluacion.requiere_firma}
								<div class="rounded-lg bg-purple-50 px-4 py-2">
									<svg
										class="inline h-5 w-5 text-purple-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
										/>
									</svg>
									<span class="ml-2 text-sm font-semibold text-purple-600">Requiere Firma</span>
								</div>
							{/if}
							<div class="rounded-lg bg-orange-50 px-4 py-2">
								<span class="text-2xl font-bold text-orange-600">
									{resultados.length}
								</span>
								<span class="ml-2 text-sm text-gray-600">Respuestas</span>
							</div>
						</div>
					</div>

					{#if evaluacion.descripcion}
						<p class="text-gray-600">{evaluacion.descripcion}</p>
					{/if}
				</div>

				<!-- Preguntas -->
				<div class="glass rounded-2xl border border-gray-200/50 p-6" in:fade={{ delay: 100 }}>
					<h2 class="mb-4 text-xl font-bold text-gray-900">Preguntas</h2>

					<div class="space-y-3">
						{#each evaluacion.preguntas as pregunta, index}
							<div class="rounded-lg border border-gray-200 bg-white p-4">
								<div class="mb-2 flex items-start justify-between">
									<div class="flex-1">
										<div class="mb-2 flex items-center gap-2">
											<span class="font-bold text-gray-700">#{index + 1}</span>
											<span
												class="rounded-full px-2 py-1 text-xs font-semibold {getTipoColor(
													pregunta.tipo
												)}"
											>
												{getTipoLabel(pregunta.tipo)}
											</span>
											<span
												class="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800"
											>
												{pregunta.puntaje} pts
											</span>
										</div>
										<p class="text-gray-900">{pregunta.texto}</p>
									</div>
								</div>

								<!-- Opciones -->
								{#if pregunta.opciones && pregunta.opciones.length > 0}
									<div class="mt-2 space-y-1">
										{#each pregunta.opciones as opcion}
											<div class="flex items-center gap-2 rounded bg-gray-50 px-3 py-1.5 text-sm">
												{#if opcion.esCorrecta}
													<svg
														class="h-4 w-4 text-orange-600"
														fill="currentColor"
														viewBox="0 0 20 20"
													>
														<path
															fill-rule="evenodd"
															d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
															clip-rule="evenodd"
														/>
													</svg>
												{:else}
													<div class="h-4 w-4 rounded-full border-2 border-gray-300"></div>
												{/if}
												<span
													class:text-orange-600={opcion.esCorrecta}
													class:font-semibold={opcion.esCorrecta}
												>
													{opcion.texto}
												</span>
											</div>
										{/each}
									</div>
								{/if}

								<!-- Relaciones -->
								{#if pregunta.tipo === 'RELACION' && pregunta.relacionIzq && pregunta.relacionDer}
									<div class="mt-2 grid grid-cols-2 gap-2">
										<div class="space-y-1">
											{#each pregunta.relacionIzq as item}
												<div class="rounded bg-blue-50 px-2 py-1 text-xs">{item}</div>
											{/each}
										</div>
										<div class="space-y-1">
											{#each pregunta.relacionDer as item}
												<div class="rounded bg-purple-50 px-2 py-1 text-xs">{item}</div>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>

			<!-- Columna derecha: Resultados -->
			<div class="xl:col-span-1">
				<div
					class="glass sticky top-6 rounded-2xl border border-gray-200/50 p-6"
					in:fade={{ delay: 200 }}
				>
					<div class="mb-4 flex items-center justify-between">
						<h2 class="text-xl font-bold text-gray-900">Resultados Recientes</h2>
						{#if nuevosResultadosCount > 0}
							<button
								on:click={limpiarNuevosResultados}
								class="relative rounded-full bg-orange-500 px-3 py-1 text-xs font-bold text-white shadow-lg hover:bg-orange-600"
								in:fly={{ y: -20, duration: 300 }}
							>
								{nuevosResultadosCount} Nuevo{nuevosResultadosCount > 1 ? 's' : ''}
							</button>
						{/if}
					</div>

					{#if isLoadingResultados}
						<div class="py-8 text-center">
							<div
								class="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"
							></div>
							<p class="text-sm text-gray-500">Cargando...</p>
						</div>
					{:else if resultados.length === 0}
						<div class="py-8 text-center">
							<svg
								class="mx-auto mb-3 h-12 w-12 text-gray-300"
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
							<p class="text-sm text-gray-500">No hay respuestas aún</p>
						</div>
					{:else}
						<div class="space-y-3">
							{#each resultados.slice(0, 10) as resultado, index}
								<div
									class="rounded-lg border border-gray-200 bg-white p-3 transition-all hover:shadow-md"
									class:border-orange-300={index < nuevosResultadosCount}
									class:bg-orange-50={index < nuevosResultadosCount}
								>
									<div class="mb-2 flex items-start justify-between">
										<div class="flex-1">
											<p class="font-semibold text-gray-900">{resultado.nombre_completo}</p>
											<p class="text-xs text-gray-500">{resultado.cargo}</p>
										</div>
										<div
											class="rounded-full px-2 py-1 text-xs font-bold {resultado.puntaje_total >=
											calcularPuntajeTotal() * 0.7
												? 'bg-orange-100 text-orange-800'
												: resultado.puntaje_total >= calcularPuntajeTotal() * 0.5
													? 'bg-yellow-100 text-yellow-800'
													: 'bg-red-100 text-red-800'}"
										>
											{resultado.puntaje_total}/{calcularPuntajeTotal()}
										</div>
									</div>
									<div class="flex items-center justify-between gap-2 text-xs text-gray-500">
										<span>{resultado.numero_documento}</span>
										<span>{formatDate(resultado.created_at)}</span>
									</div>
									<button
										on:click={() => verDetalleResultado(resultado)}
										class="mt-2 w-full rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
									>
										Ver Detalles
									</button>
								</div>
							{/each}
						</div>

						{#if resultados.length > 10}
							<p class="mt-4 text-center text-xs text-gray-500">
								Mostrando 10 de {resultados.length} resultados
							</p>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Modal de Detalle de Resultado -->
{#if showModalDetalle && resultadoSeleccionado && evaluacion}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		on:click={cerrarModalDetalle}
		transition:fade
	>
		<div
			class="max-h-[35rem] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
			on:click|stopPropagation
			transition:fly={{ y: 50, duration: 300 }}
		>
			<!-- Header -->
			<div class="sticky top-0 z-10 bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-6">
				<div class="flex items-start justify-between">
					<div class="flex-1">
						<h2 class="mb-2 text-2xl font-bold text-white">
							{resultadoSeleccionado.nombre_completo}
						</h2>
						<div class="flex flex-wrap gap-2 text-sm text-orange-50">
							<span>{resultadoSeleccionado.cargo}</span>
							<span>•</span>
							<span>{resultadoSeleccionado.numero_documento}</span>
							<span>•</span>
							<span>{formatDate(resultadoSeleccionado.created_at)}</span>
						</div>
					</div>
					<button
						on:click={cerrarModalDetalle}
						class="rounded-lg bg-white/20 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
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
			</div>

			<!-- Layout de 2 columnas -->
			<div class="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
				<!-- Columna Izquierda: Info General -->
				<div class="space-y-4 lg:col-span-1">
					<!-- Puntaje -->
					<div class="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6 text-center">
						<div class="mb-2 inline-flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
							<svg class="h-8 w-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
						</div>
						<p class="mb-2 text-sm font-medium text-orange-700">Puntaje Total</p>
					<p class="mb-2 text-5xl font-bold text-orange-600">{resultadoSeleccionado.puntaje_total}</p>
					<div class="text-orange-700">
						<span class="text-lg font-semibold">de {calcularPuntajeTotal()}</span>
						<span class="text-sm"> puntos</span>
					</div>
					<div class="mt-4">
						<div class="mb-2 h-2 overflow-hidden rounded-full bg-orange-200">
							<div class="h-full bg-orange-600 transition-all" style="width: {((resultadoSeleccionado.puntaje_total / calcularPuntajeTotal()) * 100)}%"></div>
						</div>
						<p class="text-sm font-semibold text-orange-700">{((resultadoSeleccionado.puntaje_total / calcularPuntajeTotal()) * 100).toFixed(1)}%</p>
					</div>
				</div>					<!-- Información de Contacto -->
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
						<div class="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3">
							<h3 class="flex items-center gap-2 text-lg font-bold text-white">
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
								</svg>
								Información de Contacto
							</h3>
						</div>
						<div class="space-y-3 p-4">
							<div class="border-b border-gray-100 pb-3">
								<p class="text-xs text-gray-500">Correo</p>
								<p class="font-medium text-gray-900">{resultadoSeleccionado.correo}</p>
							</div>
							<div class="border-b border-gray-100 pb-3">
								<p class="text-xs text-gray-500">Teléfono</p>
								<p class="font-medium text-gray-900">{resultadoSeleccionado.telefono}</p>
							</div>
							<div>
								<p class="text-xs text-gray-500">Lugar del Proceso</p>
								<p class="font-medium text-gray-900">{resultadoSeleccionado.lugar_proceso}</p>
							</div>
						</div>
					</div>

					<!-- Firma -->
					{#if resultadoSeleccionado.firma}
						<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
							<div class="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3">
								<h3 class="flex items-center gap-2 text-lg font-bold text-white">
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
									</svg>
									Firma Digital
								</h3>
							</div>
							<div class="p-4">
								<img src={resultadoSeleccionado.firma} alt="Firma" class="w-full rounded-lg border border-gray-200 bg-gray-50" />
							</div>
						</div>
					{/if}
				</div>

				<!-- Columna Derecha: Respuestas Detalladas -->
				<div class="lg:col-span-2">
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
						<div class="bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-4">
							<h3 class="flex items-center gap-2 text-lg font-bold text-white">
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
								Respuestas Detalladas
								<span class="ml-auto text-sm font-normal text-orange-100">
									{resultadoSeleccionado.respuestas.length} preguntas
								</span>
							</h3>
						</div>

						<div class="space-y-4 p-6">
							{#each resultadoSeleccionado.respuestas as respuesta, index}
								{#if respuesta.pregunta}
									<div class="rounded-lg border border-gray-200 bg-white p-4">
										<div class="mb-3 flex items-start justify-between">
											<div class="flex-1">
												<div class="mb-2 flex items-center gap-2">
													<span class="font-bold text-gray-700">#{index + 1}</span>
													<span class="rounded-full px-2 py-1 text-xs font-semibold {getTipoColor(respuesta.pregunta.tipo)}">
														{getTipoLabel(respuesta.pregunta.tipo)}
													</span>
													<span class="rounded-full {respuesta.puntaje_obtenido === respuesta.pregunta.puntaje ? 'bg-orange-100 text-orange-800' : respuesta.puntaje_obtenido > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'} px-2 py-1 text-xs font-semibold">
														{respuesta.puntaje_obtenido} / {respuesta.pregunta.puntaje} pts
													</span>
												</div>
												<p class="font-medium text-gray-900">{respuesta.pregunta.texto}</p>
											</div>
										</div>

										<div class="rounded-lg bg-gray-50 p-3">
											<p class="mb-1 text-xs font-semibold text-gray-600">Respuesta del usuario:</p>
											{#if respuesta.pregunta.tipo === 'TEXTO'}
												<p class="text-sm text-gray-900">{respuesta.respuesta_texto || 'Sin respuesta'}</p>
												<p class="mt-2 text-xs italic text-blue-600">✨ Esta respuesta será evaluada por IA</p>
											{:else if respuesta.pregunta.tipo === 'NUMERICA'}
												<p class="text-sm font-semibold text-gray-900">{respuesta.respuesta_texto}</p>
												{#if respuesta.pregunta.respuestaCorrecta !== undefined}
													<p class="mt-1 text-xs text-gray-600">Respuesta correcta: {respuesta.pregunta.respuestaCorrecta}</p>
												{/if}
											{:else if respuesta.pregunta.tipo === 'RELACION'}
												{@const relaciones = respuesta.respuesta_texto ? JSON.parse(respuesta.respuesta_texto) : []}
												<div class="space-y-1">
													{#each relaciones as rel}
														<div class="flex items-center gap-2 text-sm">
															<span class="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">{rel.izq}</span>
															<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
															</svg>
															<span class="rounded bg-purple-100 px-2 py-1 text-xs font-medium text-purple-800">{rel.der}</span>
														</div>
													{/each}
												</div>
											{:else}
												{@const opcionesIds = respuesta.respuesta_texto ? JSON.parse(respuesta.respuesta_texto) : []}
												<div class="space-y-1">
													{#each respuesta.pregunta.opciones as opcion}
														{@const fueSeleccionada = opcionesIds.includes(opcion.id)}
														{#if fueSeleccionada}
															<div class="flex items-center gap-2 text-sm">
																{#if opcion.esCorrecta}
																	<svg class="h-4 w-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
																		<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
																	</svg>
																{:else}
																	<svg class="h-4 w-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
																		<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
																	</svg>
																{/if}
																<span class:text-orange-700={opcion.esCorrecta} class:font-semibold={opcion.esCorrecta} class:text-red-700={!opcion.esCorrecta}>
																	{opcion.texto}
																</span>
															</div>
														{/if}
													{/each}
												</div>
											{/if}
										</div>
									</div>
								{/if}
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
