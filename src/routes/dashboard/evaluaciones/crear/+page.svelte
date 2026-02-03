<script lang="ts">
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	type TipoPregunta = 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION';

	interface Pregunta {
		texto: string;
		tipo: TipoPregunta;
		puntaje: number;
		opciones: Opcion[];
		relacionIzq: string[];
		relacionDer: string[];
		respuestaCorrecta?: number; // Para preguntas numéricas
	}

	interface Opcion {
		texto: string;
		esCorrecta: boolean;
	}

	let titulo = '';
	let descripcion = '';
	let requiere_firma = false;
	let preguntas: Pregunta[] = [];
	let isSubmitting = false;
	let error: string | null = null;
	let showRestoreMessage = false;

	const CACHE_KEY = 'evaluacion_en_progreso';

	// Estado del formulario de pregunta
	let showPreguntaForm = false;
	let preguntaActual: Pregunta = crearPreguntaVacia();
	let editIndex: number | null = null;

	onMount(() => {
		// Restaurar datos del caché si existen
		if (browser) {
			const cached = localStorage.getItem(CACHE_KEY);
			if (cached) {
				try {
					const data = JSON.parse(cached);
					titulo = data.titulo || '';
					descripcion = data.descripcion || '';
					requiere_firma = data.requiere_firma || false;
					preguntas = data.preguntas || [];
					showRestoreMessage = true;
					setTimeout(() => showRestoreMessage = false, 5000);
				} catch (e) {
					console.error('Error al restaurar caché:', e);
				}
			}
		}
	});

	// Guardar en caché cada vez que cambian los datos
	$: if (browser) {
		const data = { titulo, descripcion, requiere_firma, preguntas };
		localStorage.setItem(CACHE_KEY, JSON.stringify(data));
	}

	function limpiarCache() {
		if (browser) {
			localStorage.removeItem(CACHE_KEY);
		}
	}

	function crearPreguntaVacia(): Pregunta {
		return {
			texto: '',
			tipo: 'OPCION_UNICA',
			puntaje: 1,
			opciones: [{ texto: '', esCorrecta: false }],
			relacionIzq: [''],
			relacionDer: [''],
			respuestaCorrecta: undefined
		};
	}

	function agregarOpcion() {
		preguntaActual.opciones = [...preguntaActual.opciones, { texto: '', esCorrecta: false }];
	}

	function eliminarOpcion(index: number) {
		preguntaActual.opciones = preguntaActual.opciones.filter((_, i) => i !== index);
	}

	function agregarParRelacion() {
		// Agregar un par: uno a la izquierda y uno a la derecha simultáneamente
		preguntaActual.relacionIzq = [...preguntaActual.relacionIzq, ''];
		preguntaActual.relacionDer = [...preguntaActual.relacionDer, ''];
	}

	function eliminarParRelacion(index: number) {
		// Eliminar el par completo
		preguntaActual.relacionIzq = preguntaActual.relacionIzq.filter((_, i) => i !== index);
		preguntaActual.relacionDer = preguntaActual.relacionDer.filter((_, i) => i !== index);
	}

	function abrirFormPregunta() {
		preguntaActual = crearPreguntaVacia();
		editIndex = null;
		showPreguntaForm = true;
	}

	function editarPregunta(index: number) {
		preguntaActual = JSON.parse(JSON.stringify(preguntas[index]));
		editIndex = index;
		showPreguntaForm = true;
	}

	function guardarPregunta() {
		// Validar
		if (!preguntaActual.texto.trim()) {
			alert('El texto de la pregunta es requerido');
			return;
		}

		// Limpiar opciones/relaciones según tipo
		if (preguntaActual.tipo === 'OPCION_UNICA' || preguntaActual.tipo === 'OPCION_MULTIPLE') {
			preguntaActual.opciones = preguntaActual.opciones.filter((o) => o.texto.trim());
			if (preguntaActual.opciones.length === 0) {
				alert('Debe agregar al menos una opción');
				return;
			}
			preguntaActual.relacionIzq = [];
			preguntaActual.relacionDer = [];
			preguntaActual.respuestaCorrecta = undefined;
		} else if (preguntaActual.tipo === 'NUMERICA') {
			if (preguntaActual.respuestaCorrecta === undefined || preguntaActual.respuestaCorrecta === null) {
				alert('Debe ingresar la respuesta correcta numérica');
				return;
			}
			preguntaActual.opciones = [];
			preguntaActual.relacionIzq = [];
			preguntaActual.relacionDer = [];
		} else if (preguntaActual.tipo === 'RELACION') {
			preguntaActual.relacionIzq = preguntaActual.relacionIzq.filter((r) => r.trim());
			preguntaActual.relacionDer = preguntaActual.relacionDer.filter((r) => r.trim());
			if (preguntaActual.relacionIzq.length === 0 || preguntaActual.relacionDer.length === 0) {
				alert('Debe agregar al menos un par de elementos');
				return;
			}
			if (preguntaActual.relacionIzq.length !== preguntaActual.relacionDer.length) {
				alert('Debe haber la misma cantidad de elementos en ambos lados');
				return;
			}
			preguntaActual.opciones = [];
			preguntaActual.respuestaCorrecta = undefined;
		} else {
			preguntaActual.opciones = [];
			preguntaActual.relacionIzq = [];
			preguntaActual.relacionDer = [];
			preguntaActual.respuestaCorrecta = undefined;
		}

		if (editIndex !== null) {
			preguntas[editIndex] = preguntaActual;
			preguntas = [...preguntas];
		} else {
			preguntas = [...preguntas, preguntaActual];
		}

		showPreguntaForm = false;
		preguntaActual = crearPreguntaVacia();
		editIndex = null;
	}

	function eliminarPregunta(index: number) {
		if (confirm('¿Eliminar esta pregunta?')) {
			preguntas = preguntas.filter((_, i) => i !== index);
		}
	}

	async function crearEvaluacion() {
		if (!titulo.trim()) {
			alert('El título es requerido');
			return;
		}
		if (preguntas.length === 0) {
			alert('Debe agregar al menos una pregunta');
			return;
		}

		isSubmitting = true;
		error = null;

		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/evaluaciones`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					titulo,
					descripcion: descripcion.trim() || null,
					requiere_firma,
					preguntas
				})
			});

			const data = await response.json();

			if (data.success) {
				limpiarCache(); // Limpiar caché después de crear exitosamente
				goto('/dashboard/evaluaciones');
			} else {
				console.error('Error del servidor:', data);
				error = data.errors?.[0]?.message || data.message || 'Error al crear la evaluación';
				alert(`Error: ${error}`);
			}
		} catch (err: any) {
			error = err.message || 'Error al crear la evaluación';
			console.error('Error:', err);
		} finally {
			isSubmitting = false;
		}
	}

	function getTipoLabel(tipo: TipoPregunta) {
		const labels: Record<TipoPregunta, string> = {
			OPCION_UNICA: 'Opción Única',
			OPCION_MULTIPLE: 'Opción Múltiple',
			NUMERICA: 'Numérica',
			TEXTO: 'Texto',
			RELACION: 'Relación'
		};
		return labels[tipo];
	}
</script>

<svelte:head>
	<title>Crear Evaluación - Cotransmeq</title>
</svelte:head>

<div class="space-y-6 p-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold text-gray-900">Crear Evaluación</h1>
			<p class="text-gray-600">Define el título, preguntas y opciones de respuesta</p>
		</div>
		<button
			on:click={() => goto('/dashboard/evaluaciones')}
			class="apple-transition rounded-lg bg-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-300"
		>
			Cancelar
		</button>
	</div>

	<!-- Mensaje de restauración -->
	{#if showRestoreMessage}
		<div class="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800" in:fade>
			<div class="flex items-center gap-2">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
				</svg>
				<span>Se ha restaurado tu progreso anterior automáticamente</span>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800" in:fade>
			{error}
		</div>
	{/if}

	<!-- Información básica -->
	<div class="glass rounded-2xl border border-gray-200/50 p-6">
		<h2 class="mb-4 text-xl font-bold text-gray-900">Información Básica</h2>

		<div class="space-y-4">
			<div>
				<label class="mb-2 block text-sm font-semibold text-gray-700">Título *</label>
				<input
					bind:value={titulo}
					type="text"
					class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					placeholder="Ej: Evaluación de Seguridad Vial"
				/>
			</div>

			<div>
				<label class="mb-2 block text-sm font-semibold text-gray-700">Descripción</label>
				<textarea
					bind:value={descripcion}
					class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					rows="3"
					placeholder="Breve descripción de la evaluación"
				></textarea>
			</div>

			<div class="flex items-center gap-2">
				<input bind:checked={requiere_firma} type="checkbox" id="firma" class="h-4 w-4" />
				<label for="firma" class="text-sm font-semibold text-gray-700">Requiere firma digital</label
				>
			</div>
		</div>
	</div>

	<!-- Preguntas -->
	<div class="glass rounded-2xl border border-gray-200/50 p-6">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-xl font-bold text-gray-900">
				Preguntas ({preguntas.length})
			</h2>
			<button
				on:click={abrirFormPregunta}
				class="apple-transition rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
			>
				<svg class="mr-2 inline h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/>
				</svg>
				Agregar Pregunta
			</button>
		</div>

		<!-- Lista de preguntas -->
		{#if preguntas.length === 0}
			<div class="py-8 text-center text-gray-500">
				No hay preguntas. Haz clic en "Agregar Pregunta" para comenzar.
			</div>
		{:else}
			<div class="space-y-4">
				{#each preguntas as pregunta, index (index)}
					<div class="rounded-lg border border-gray-200 bg-white p-4" in:fade>
						<div class="mb-2 flex items-start justify-between">
							<div class="flex-1">
								<div class="mb-1 flex items-center gap-2">
									<span class="font-bold text-gray-700">#{index + 1}</span>
									<span
										class="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800"
									>
										{getTipoLabel(pregunta.tipo)}
									</span>
									<span class="text-sm text-gray-500">{pregunta.puntaje} pts</span>
								</div>
								<p class="text-gray-900">{pregunta.texto}</p>
							</div>
							<div class="flex gap-2">
								<button
									on:click={() => editarPregunta(index)}
									class="rounded-lg bg-blue-100 p-2 text-blue-600 hover:bg-blue-200"
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
								<button
									on:click={() => eliminarPregunta(index)}
									class="rounded-lg bg-red-100 p-2 text-red-600 hover:bg-red-200"
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

						<!-- Opciones -->
						{#if pregunta.opciones.length > 0}
							<div class="mt-2 space-y-1">
								{#each pregunta.opciones as opcion}
									<div class="flex items-center gap-2 text-sm">
										{#if opcion.esCorrecta}
											<svg class="h-4 w-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
													clip-rule="evenodd"
												/>
											</svg>
										{:else}
											<svg class="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
													clip-rule="evenodd"
												/>
											</svg>
										{/if}
										<span class:text-orange-600={opcion.esCorrecta}>{opcion.texto}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Botones de acción -->
	<div class="flex justify-end gap-4">
		<button
			on:click={() => goto('/dashboard/evaluaciones')}
			class="rounded-lg bg-gray-200 px-6 py-3 font-semibold text-gray-700 hover:bg-gray-300"
		>
			Cancelar
		</button>
		<button
			on:click={crearEvaluacion}
			disabled={isSubmitting}
			class="apple-transition rounded-lg bg-orange-500 px-6 py-3 font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
		>
			{isSubmitting ? 'Creando...' : 'Crear Evaluación'}
		</button>
	</div>
</div>

<!-- Modal para agregar/editar pregunta -->
{#if showPreguntaForm}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" in:fade>
		<div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
			<h3 class="mb-4 text-xl font-bold text-gray-900">
				{editIndex !== null ? 'Editar' : 'Agregar'} Pregunta
			</h3>

			<div class="space-y-4">
				<!-- Texto de la pregunta -->
				<div>
					<label class="mb-2 block text-sm font-semibold text-gray-700">Pregunta *</label>
					<textarea
						bind:value={preguntaActual.texto}
						class="w-full rounded-lg border border-gray-300 px-4 py-2"
						rows="2"
						placeholder="Escribe la pregunta aquí"
					></textarea>
				</div>

				<!-- Tipo de pregunta -->
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="mb-2 block text-sm font-semibold text-gray-700">Tipo *</label>
						<select
							bind:value={preguntaActual.tipo}
							class="w-full rounded-lg border border-gray-300 px-4 py-2"
						>
							<option value="OPCION_UNICA">Opción Única</option>
							<option value="OPCION_MULTIPLE">Opción Múltiple</option>
							<option value="NUMERICA">Numérica</option>
							<option value="TEXTO">Texto</option>
							<option value="RELACION">Relación</option>
						</select>
					</div>
					<div>
						<label class="mb-2 block text-sm font-semibold text-gray-700">Puntaje *</label>
						<input
							bind:value={preguntaActual.puntaje}
							type="number"
							min="0"
							class="w-full rounded-lg border border-gray-300 px-4 py-2"
						/>
					</div>
				</div>

				<!-- Opciones (solo para opción única/múltiple) -->
				{#if preguntaActual.tipo === 'OPCION_UNICA' || preguntaActual.tipo === 'OPCION_MULTIPLE'}
					<div>
						<div class="mb-2 flex items-center justify-between">
							<label class="text-sm font-semibold text-gray-700">Opciones</label>
							<button
								on:click={agregarOpcion}
								class="rounded-lg bg-blue-100 px-3 py-1 text-sm text-blue-600 hover:bg-blue-200"
							>
								+ Agregar
							</button>
						</div>
						<div class="space-y-2">
							{#each preguntaActual.opciones as opcion, i}
								<div class="flex gap-2">
									<input bind:checked={opcion.esCorrecta} type="checkbox" class="mt-3 h-4 w-4" />
									<input
										bind:value={opcion.texto}
										type="text"
										class="flex-1 rounded-lg border border-gray-300 px-4 py-2"
										placeholder="Texto de la opción"
									/>
									<button
										on:click={() => eliminarOpcion(i)}
										class="rounded-lg bg-red-100 p-2 text-red-600 hover:bg-red-200"
									>
										<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M6 18L18 6M6 6l12 12"
											/>
										</svg>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Respuesta Correcta para NUMERICA -->
				{#if preguntaActual.tipo === 'NUMERICA'}
					<div>
						<label class="mb-2 block text-sm font-semibold text-gray-700">Respuesta Correcta *</label>
						<input
							bind:value={preguntaActual.respuestaCorrecta}
							type="number"
							step="any"
							class="w-full rounded-lg border border-gray-300 px-4 py-2"
							placeholder="Ingrese el número correcto"
						/>
						<p class="mt-1 text-xs text-gray-500">Los estudiantes deberán ingresar este valor exacto</p>
					</div>
				{/if}

				<!-- Relaciones (solo para tipo RELACION) -->
				{#if preguntaActual.tipo === 'RELACION'}
					<div>
						<div class="mb-3 flex items-center justify-between">
							<label class="text-sm font-semibold text-gray-700">Pares de Relación</label>
							<button
								on:click={agregarParRelacion}
								class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
							>
								<svg class="mr-1 inline h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
								</svg>
								Agregar Par
							</button>
						</div>
						<p class="mb-3 text-xs text-gray-500">Cada fila representa un par que se debe relacionar correctamente. Al diligenciar, se mostrarán aleatorizados.</p>
						
						<div class="space-y-2">
							{#each preguntaActual.relacionIzq as item, i}
								<div class="grid grid-cols-[1fr_auto_1fr_auto] gap-3 items-center rounded-lg border border-gray-200 bg-gray-50 p-3">
									<!-- Lado A -->
									<div>
										<input
											bind:value={preguntaActual.relacionIzq[i]}
											type="text"
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
											placeholder="Lado A"
										/>
									</div>
									
									<!-- Flecha -->
									<div class="text-gray-400">
										<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
										</svg>
									</div>
									
									<!-- Lado B -->
									<div>
										<input
											bind:value={preguntaActual.relacionDer[i]}
											type="text"
											class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
											placeholder="Lado B"
										/>
									</div>
									
									<!-- Botón Eliminar -->
									<button
										on:click={() => eliminarParRelacion(i)}
										class="rounded-lg bg-red-100 p-2 text-red-600 hover:bg-red-200"
										title="Eliminar este par"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
										</svg>
									</button>
								</div>
							{/each}
							
							{#if preguntaActual.relacionIzq.length === 0}
								<div class="text-center py-8 text-gray-400">
									<p class="text-sm">No hay pares agregados. Haz clic en "Agregar Par" para comenzar.</p>
								</div>
							{/if}
						</div>
					</div>
				{/if}

			</div>

			<!-- Botones del modal -->
			<div class="mt-6 flex justify-end gap-4">
				<button
					on:click={() => (showPreguntaForm = false)}
					class="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-300"
				>
					Cancelar
				</button>
				<button
					on:click={guardarPregunta}
					class="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white hover:bg-orange-600"
				>
					Guardar
				</button>
			</div>
		</div>
	</div>
{/if}
