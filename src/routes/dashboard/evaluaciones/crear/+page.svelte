<script lang="ts">
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { toast } from 'svelte-sonner';
	import { mascota } from '$lib/mascot';
	import PreguntaCard from '$lib/components/evaluaciones/PreguntaCard.svelte';
	import ModalPregunta from '$lib/components/evaluaciones/ModalPregunta.svelte';
	import ModalConfirmar from '$lib/components/evaluaciones/ModalConfirmar.svelte';
	import { pluralPreguntas, pluralPuntos } from '$lib/components/evaluaciones/tipos';
	import '$lib/components/evaluaciones/evaluaciones.css';
	import { authHeaders } from '$lib/api/evaluaciones';

	type TipoPregunta =
		'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO';

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
	/** Índice de la pregunta pendiente de confirmar su borrado. */
	let preguntaAEliminar: number | null = null;

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
					setTimeout(() => (showRestoreMessage = false), 5000);
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

	$: puntajeTotal = preguntas.reduce((s, p) => s + (Number(p.puntaje) || 0), 0);

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

	/** El modal devuelve la pregunta editada; la validación sigue aquí. */
	function recibirPregunta(p: Pregunta) {
		preguntaActual = p;
		guardarPregunta();
	}

	function guardarPregunta() {
		// Validar
		if (!preguntaActual.texto.trim()) {
			toast.error('El texto de la pregunta es requerido');
			return;
		}

		// Limpiar opciones/relaciones según tipo
		if (preguntaActual.tipo === 'OPCION_UNICA' || preguntaActual.tipo === 'OPCION_MULTIPLE') {
			preguntaActual.opciones = preguntaActual.opciones.filter((o) => o.texto.trim());
			if (preguntaActual.opciones.length === 0) {
				toast.error('Debe agregar al menos una opción');
				return;
			}
			preguntaActual.relacionIzq = [];
			preguntaActual.relacionDer = [];
			preguntaActual.respuestaCorrecta = undefined;
		} else if (preguntaActual.tipo === 'NUMERICA') {
			if (
				preguntaActual.respuestaCorrecta === undefined ||
				preguntaActual.respuestaCorrecta === null
			) {
				toast.error('Debe ingresar la respuesta correcta numérica');
				return;
			}
			preguntaActual.opciones = [];
			preguntaActual.relacionIzq = [];
			preguntaActual.relacionDer = [];
		} else if (preguntaActual.tipo === 'RELACION') {
			preguntaActual.relacionIzq = preguntaActual.relacionIzq.filter((r) => r.trim());
			preguntaActual.relacionDer = preguntaActual.relacionDer.filter((r) => r.trim());
			if (preguntaActual.relacionIzq.length === 0 || preguntaActual.relacionDer.length === 0) {
				toast.error('Debe agregar al menos un par de elementos');
				return;
			}
			if (preguntaActual.relacionIzq.length !== preguntaActual.relacionDer.length) {
				toast.error('Debe haber la misma cantidad de elementos en ambos lados');
				return;
			}
			preguntaActual.opciones = [];
			preguntaActual.respuestaCorrecta = undefined;
		} else if (preguntaActual.tipo === 'VERDADERO_FALSO') {
			if (
				preguntaActual.respuestaCorrecta === undefined ||
				preguntaActual.respuestaCorrecta === null
			) {
				toast.error('Debe seleccionar si la respuesta correcta es Verdadero o Falso');
				return;
			}
			preguntaActual.opciones = [];
			preguntaActual.relacionIzq = [];
			preguntaActual.relacionDer = [];
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
		preguntaAEliminar = index;
	}

	function confirmarEliminarPregunta() {
		if (preguntaAEliminar === null) return;
		preguntas = preguntas.filter((_, i) => i !== preguntaAEliminar);
		preguntaAEliminar = null;
	}

	async function crearEvaluacion() {
		if (!titulo.trim()) {
			toast.error('El título es requerido');
			return;
		}
		if (preguntas.length === 0) {
			toast.error('Debe agregar al menos una pregunta');
			return;
		}

		isSubmitting = true;
		error = null;

		try {
			const response = await fetch(`${import.meta.env.VITE_API_URL}/api/evaluaciones`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
				toast.error(`Error: ${error}`);
			}
		} catch (err: any) {
			error = err.message || 'Error al crear la evaluación';
			console.error('Error:', err);
		} finally {
			isSubmitting = false;
		}
	}

	function cancelar() {
		goto('/dashboard/evaluaciones');
	}
</script>

<svelte:head>
	<title>Crear Evaluación - Cotransmeq</title>
</svelte:head>

<div class="ev-pagina" in:fade={{ duration: 300 }}>
	<header class="page-card ev-cabecera" style="padding: 1.25rem 1.5rem;">
		<button type="button" class="btn-icon" on:click={cancelar} aria-label="Volver a evaluaciones">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
		</button>
		<div class="ev-cabecera-texto">
			<span class="eyebrow">Formación · Nueva evaluación</span>
			<h1 class="dir-titulo">Crear evaluación</h1>
			<p class="dir-desc">Define el título, las preguntas y las opciones de respuesta.</p>
		</div>
		<div class="ev-cabecera-acciones">
			<button type="button" class="btn-secondary" on:click={cancelar}>Cancelar</button>
			<button type="button" class="btn-primary" on:click={crearEvaluacion} disabled={isSubmitting}>
				{isSubmitting ? 'Creando…' : 'Crear evaluación'}
			</button>
		</div>
	</header>

	{#if showRestoreMessage}
		<div class="ev-aviso" transition:fade={{ duration: 200 }} role="status">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
				/>
			</svg>
			Se restauró tu progreso anterior automáticamente.
		</div>
	{/if}

	{#if error}
		<div class="ev-aviso ev-aviso--error" in:fade role="alert">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
			{error}
		</div>
	{/if}

	<div class="ev-grid-form" in:fly={{ y: 12, duration: 400, delay: 80 }}>
		<!-- ── Información básica ── -->
		<section class="ev-card">
			<h2 class="ev-card-titulo">
				Información básica
				<small>Lo que verá el evaluado al abrir el enlace</small>
			</h2>

			<div class="ev-campo">
				<label for="titulo">Título</label>
				<input
					id="titulo"
					bind:value={titulo}
					type="text"
					placeholder="Ej. Evaluación de seguridad vial"
				/>
			</div>

			<div class="ev-campo">
				<label for="descripcion">Descripción</label>
				<textarea
					id="descripcion"
					bind:value={descripcion}
					rows="3"
					placeholder="Breve descripción de la evaluación (opcional)"
				></textarea>
			</div>

			<label class="ev-toggle" for="firma">
				<span class="ev-toggle-texto">
					<strong>Requiere firma digital</strong>
					<small>El evaluado firma en pantalla al terminar; la firma va al PDF.</small>
				</span>
				<input bind:checked={requiere_firma} type="checkbox" id="firma" class="ev-switch" />
			</label>
		</section>

		<!-- ── Preguntas ── -->
		<section class="ev-card">
			<header class="ev-card-cab">
				<h2 class="ev-card-titulo">
					Preguntas
					<small>{pluralPreguntas(preguntas.length)} · {pluralPuntos(puntajeTotal)}</small>
				</h2>
				<button type="button" class="btn-primary" on:click={abrirFormPregunta}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Agregar pregunta
				</button>
			</header>

			{#if preguntas.length === 0}
				{@const img = mascota('vacio')}
				<div class="ev-vacio">
					<img src={img.src} alt={img.alt} width="418" height="418" />
					<h3>Todavía no hay preguntas</h3>
					<p>
						Agrega la primera pregunta: opción única o múltiple, verdadero o falso, numérica, texto
						o relación.
					</p>
					<button type="button" class="btn-secondary" on:click={abrirFormPregunta}>
						Agregar la primera
					</button>
				</div>
			{:else}
				<div class="ev-preguntas">
					{#each preguntas as pregunta, index (index)}
						<div in:fade={{ duration: 200 }}>
							<PreguntaCard
								{pregunta}
								indice={index}
								onEditar={() => editarPregunta(index)}
								onEliminar={() => eliminarPregunta(index)}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>

	<footer class="ev-pie">
		<button type="button" class="btn-secondary" on:click={cancelar}>Cancelar</button>
		<button type="button" class="btn-primary" on:click={crearEvaluacion} disabled={isSubmitting}>
			{isSubmitting ? 'Creando…' : 'Crear evaluación'}
		</button>
	</footer>
</div>

{#if showPreguntaForm}
	<ModalPregunta
		inicial={preguntaActual}
		editando={editIndex !== null}
		numero={editIndex ?? preguntas.length}
		onGuardar={recibirPregunta}
		onCancelar={() => (showPreguntaForm = false)}
	/>
{/if}

{#if preguntaAEliminar !== null}
	<ModalConfirmar
		titulo="Eliminar pregunta"
		mensaje={`Se quitará la pregunta ${preguntaAEliminar + 1} de la evaluación.`}
		confirmar="Eliminar pregunta"
		onConfirmar={confirmarEliminarPregunta}
		onCancelar={() => (preguntaAEliminar = null)}
	/>
{/if}
