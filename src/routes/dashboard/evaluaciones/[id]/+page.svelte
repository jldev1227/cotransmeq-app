<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { socketUtils } from '$lib/socket';

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
		tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO';
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
		valor_texto: string | null;
		valor_numero: number | null;
		opcionesIds: string[];
		relacion: { izq: string; der: string }[] | null;
		puntaje: number;
		pregunta?: Pregunta;
	}

	let evaluacion: Evaluacion | null = null;
	let resultados: Resultado[] = [];
	let isLoading = false;
	let isLoadingResultados = false;
	let error: string | null = null;
	let showResultados = true;
	let nuevosResultadosCount = 0;
	/**
	 * Respuesta que se está mirando en detalle.
	 *
	 * Con valor, la página CAMBIA a la vista de detalle en vez de abrir un
	 * modal. El modal era de 4xl con las respuestas en un tercio de su ancho:
	 * en una evaluación de veinte preguntas eso obligaba a hacer scroll dentro
	 * de una ventana que ya estaba dentro de otra pantalla con scroll.
	 */
	let resultadoSeleccionado: Resultado | null = null;

	$: evaluacionId = $page.params.id;

	onMount(() => {
		loadEvaluacion();
		loadResultados();
		initSocket();
	});

	onDestroy(() => {
		/// Además de darse de baja, hay que SALIR del room: sin esto el servidor
		/// seguía contando esta pestaña como presente en la evaluación.
		socketUtils.emit('leave-evaluacion', evaluacionId);
		bajaNuevaRespuesta?.();
	});

	/// Antes esta página abría su PROPIA conexión con `io(...)`, sin token y sin
	/// darse de baja de nada: cada visita dejaba un socket más contra el
	/// servidor. Ahora usa el cliente compartido, que ya está autenticado.
	let bajaNuevaRespuesta: (() => void) | undefined;

	function initSocket() {
		socketUtils.emit('join-evaluacion', evaluacionId);

		bajaNuevaRespuesta = socketUtils.on('nueva-respuesta', (data: Resultado) => {
			// Agregar al inicio del array
			resultados = [data, ...resultados];
			nuevosResultadosCount++;
			toast.success(`Nueva respuesta de ${data.nombre_completo}`);
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
			}
		} catch (err: any) {
			console.error('Error:', err);
		} finally {
			isLoadingResultados = false;
		}
	}

	function verDetalleResultado(resultado: Resultado) {
		resultadoSeleccionado = resultado;
		// Al abrir un detalle desde media página desplazada, el contenido nuevo
		// empieza fuera de la vista y parece que no ha pasado nada.
		if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function cerrarDetalleResultado() {
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
			RELACION: 'bg-pink-100 text-pink-800',
			VERDADERO_FALSO: 'bg-teal-100 text-teal-800'
		};
		return colors[tipo] || 'bg-gray-100 text-gray-800';
	}

	function getTipoLabel(tipo: string) {
		const labels: Record<string, string> = {
			OPCION_UNICA: 'Opción Única',
			OPCION_MULTIPLE: 'Opción Múltiple',
			NUMERICA: 'Numérica',
			TEXTO: 'Texto',
			RELACION: 'Relación',
			VERDADERO_FALSO: 'Verdadero o Falso'
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

	async function exportarPDF() {
		if (!resultados.length) {
			toast.error('No hay resultados para exportar');
			return;
		}

		try {
			toast.loading('Generando PDF...');
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/exportar-pdf`
			);

			if (!response.ok) {
				throw new Error('Error al generar el PDF');
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute(
				'download',
				`evaluacion_${evaluacion?.titulo?.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`
			);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			toast.dismiss();
			toast.success('PDF generado exitosamente');
		} catch (error: any) {
			toast.dismiss();
			toast.error(error.message || 'Error al generar el PDF');
		}
	}

	async function exportarPDFIndividual(resultadoId: string) {
		if (!resultados.length) {
			toast.error('No hay resultado para exportar');
			return;
		}

		try {
			toast.loading('Generando PDF...');
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/resultados/${resultadoId}/exportar-pdf`
			);

			if (!response.ok) {
				throw new Error('Error al generar el PDF');
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute(
				'download',
				`evaluacion_${evaluacion?.titulo?.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`
			);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			toast.dismiss();
			toast.success('PDF generado exitosamente');
		} catch (error: any) {
			toast.dismiss();
			toast.error(error.message || 'Error al generar el PDF');
		}
	}

	async function exportarPDFTodos() {
		if (!resultados.length) {
			toast.error('No hay resultados para exportar');
			return;
		}

		try {
			toast.loading('Generando PDF...');
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/exportar-zip`
			);

			if (!response.ok) {
				throw new Error('Error al generar el PDF');
			}

			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.setAttribute(
				'download',
				`evaluacion_${evaluacion?.titulo?.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.zip`
			);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			toast.dismiss();
			toast.success('PDFs generados exitosamente');
		} catch (error: any) {
			toast.dismiss();
			toast.error(error.message || 'Error al generar los PDFs');
		}
	}
</script>

<svelte:head>
	<title>{evaluacion?.titulo || 'Evaluación'} - Cotransmeq</title>
</svelte:head>

<div class="pagina">
	<!-- ═══ HERO EDITORIAL ═══
	     Antes era un `<h1>` de Tailwind con un botón gris al lado. Mismo
	     patrón que la lista, SARLAFT y salidas-NC: identidad a la izquierda,
	     acciones a la derecha, rejilla fluida sin puntos de ruptura. -->
	<header class="page-hero">
		<div class="hero-left">
			<button
				on:click={() => goto('/dashboard/evaluaciones')}
				class="hero-volver"
				aria-label="Volver a evaluaciones"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
			</button>
			<div class="hero-text">
				<span class="eyebrow">Formación · Evaluación</span>
				<h1>{evaluacion?.titulo || 'Cargando…'}</h1>
				{#if evaluacion?.descripcion}
					<p>{evaluacion.descripcion}</p>
				{/if}
				{#if evaluacion}
					<div class="hero-stats">
						<span class="stat-item">
							<span class="stat-label">Preguntas</span>
							<span class="stat-value">{evaluacion.preguntas.length}</span>
						</span>
						<span class="stat-item">
							<span class="stat-label">Puntos</span>
							<span class="stat-value">{calcularPuntajeTotal()}</span>
						</span>
						<span class="stat-item">
							<span class="stat-label">Respuestas</span>
							<span class="stat-value">{resultados.length}</span>
						</span>
						{#if evaluacion.requiere_firma}
							<span class="stat-item stat-item--firma">
								<span class="stat-label">Requiere firma</span>
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if evaluacion}
			<div class="flex flex-wrap gap-1.5">
  <button
    on:click={exportarPDF}
    class="btn-accion"
    title="Exportar resultados a PDF"
  >
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
    </svg>
    <span class="hidden sm:inline">PDF</span>
  </button>

  <button
    on:click={exportarPDFTodos}
    class="btn-accion"
    title="Exportar todos los resultados"
  >
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
    </svg>
    <span class="hidden sm:inline">Exportar todo</span>
  </button>

  <button
    on:click={() => goto(`/dashboard/evaluaciones/${evaluacionId}/editar`)}
    class="btn-accion"
    title="Editar evaluación"
  >
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
    </svg>
    <span class="hidden sm:inline">Editar</span>
  </button>

  <button
    on:click={generarEnlacePublico}
    class="btn-accion"
    title="Copiar enlace público"
  >
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
    </svg>
    <span class="hidden sm:inline">Enlace</span>
  </button>

  <button
    on:click={eliminarEvaluacion}
    class="btn-accion btn-accion--peligro"
    title="Eliminar evaluación"
  >
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
    </svg>
    <span class="hidden sm:inline">Eliminar</span>
  </button>
</div>
		{/if}
	</header>

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
		{#if resultadoSeleccionado}
			<!-- ═══ DETALLE DE UNA RESPUESTA — a ancho completo ═══
			     Antes esto era un modal `max-w-4xl` con las respuestas metidas en
			     un tercio de su ancho. El ancho de la pantalla estaba ahí, sin
			     usar, mientras el contenido que de verdad importa —qué contestó
			     cada uno— se leía por una rendija con scroll propio. -->
			<div class="space-y-6" in:fade={{ duration: 200 }}>
				<div class="glass flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200/50 p-5">
					<button
						on:click={cerrarDetalleResultado}
						class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
						aria-label="Volver a la evaluación"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
					</button>

					<div class="min-w-0 flex-1">
						<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Respuesta de</p>
						<h2 class="truncate text-xl font-bold text-gray-900">
							{resultadoSeleccionado.nombre_completo}
						</h2>
						<p class="text-xs text-gray-500">
							{resultadoSeleccionado.cargo} · {resultadoSeleccionado.numero_documento} · {formatDate(
								resultadoSeleccionado.created_at
							)}
						</p>
					</div>

					<!-- El puntaje va en la barra, no en una tarjeta gigante de una
					     columna lateral: es un dato, no una sección. -->
					<div
						class="rounded-xl px-4 py-2 text-center {resultadoSeleccionado.puntaje_total >=
						calcularPuntajeTotal() * 0.7
							? 'bg-green-50 text-green-800'
							: resultadoSeleccionado.puntaje_total >= calcularPuntajeTotal() * 0.5
								? 'bg-yellow-50 text-yellow-800'
								: 'bg-red-50 text-red-800'}"
					>
						<span class="text-2xl font-bold">{resultadoSeleccionado.puntaje_total}</span>
						<span class="text-sm font-medium">/ {calcularPuntajeTotal()} pts</span>
					</div>

					<button
						on:click={() => exportarPDFIndividual(resultadoSeleccionado!.id)}
						class="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600"
					>
						Exportar PDF
					</button>
				</div>

				{#if resultadoSeleccionado.firma}
					<div class="glass overflow-hidden rounded-2xl border border-gray-200/50">
						<div class="border-b border-gray-100 px-5 py-3">
							<h3 class="text-sm font-semibold text-gray-900">Firma</h3>
						</div>
						<div class="p-4">
							<img
								src={resultadoSeleccionado.firma}
								alt="Firma de {resultadoSeleccionado.nombre_completo}"
								class="max-h-40 rounded-lg border border-gray-200 bg-gray-50"
							/>
						</div>
					</div>
				{/if}

				<div class="glass overflow-hidden rounded-2xl border border-gray-200/50">
					<div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
						<h3 class="text-sm font-semibold text-gray-900">Respuestas detalladas</h3>
						<span class="text-xs text-gray-500">
							{resultadoSeleccionado.respuestas.length} preguntas
						</span>
					</div>

					<!-- Rejilla fluida, no una columna: en una evaluación de veinte
					     preguntas la lista en columna única es kilométrica, y con
					     `auto-fit` se adapta sola al ancho real del `main` cuando la
					     barra lateral se colapsa, sin puntos de ruptura que mantener. -->
					<div
						class="grid gap-4 p-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))]"
					>
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
										<span class="rounded-full {respuesta.puntaje === respuesta.pregunta.puntaje ? 'bg-green-100 text-green-800' : respuesta.puntaje > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'} px-2 py-1 text-xs font-semibold">
											{respuesta.puntaje} / {respuesta.pregunta.puntaje} pts
										</span>
									</div>
									<p class="font-medium text-gray-900">{respuesta.pregunta.texto}</p>
								</div>
							</div>

							<div class="rounded-lg bg-gray-50 p-3">
								<p class="mb-1 text-xs font-semibold text-gray-600">Respuesta del usuario:</p>
								{#if respuesta.pregunta.tipo === 'TEXTO'}
									<p class="text-sm text-gray-900">{respuesta.valor_texto || 'Sin respuesta'}</p>
									<p class="mt-2 text-xs italic text-blue-600">✨ Esta respuesta fue evaluada por IA</p>
								{:else if respuesta.pregunta.tipo === 'NUMERICA'}
									<p class="text-sm font-semibold text-gray-900">{respuesta.valor_numero ?? respuesta.valor_texto ?? 'Sin respuesta'}</p>
									{#if respuesta.pregunta.respuestaCorrecta !== undefined && respuesta.pregunta.respuestaCorrecta !== null}
										<p class="mt-1 text-xs text-gray-600">Respuesta correcta: {respuesta.pregunta.respuestaCorrecta}</p>
									{/if}
								{:else if respuesta.pregunta.tipo === 'RELACION'}
									{@const relaciones = Array.isArray(respuesta.relacion) ? respuesta.relacion : []}
									{#if relaciones.length > 0}
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
										<p class="text-sm text-gray-500">Sin respuesta</p>
									{/if}
								{:else if respuesta.pregunta.tipo === 'VERDADERO_FALSO'}
									{@const respuestaUsuario = respuesta.valor_numero}
									{@const respuestaCorrectaVF = respuesta.pregunta.respuestaCorrecta}
									{@const esCorrectoVF = typeof respuestaUsuario === 'number' && respuestaCorrectaVF !== null && respuestaCorrectaVF !== undefined && respuestaUsuario === respuestaCorrectaVF}
									{#if typeof respuestaUsuario === 'number'}
										<div class="flex items-center gap-3">
											<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold {esCorrectoVF ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
												{#if esCorrectoVF}
													<svg class="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
														<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
													</svg>
												{:else}
													<svg class="h-5 w-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
														<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
													</svg>
												{/if}
												{respuestaUsuario === 1 ? 'Verdadero' : 'Falso'}
											</div>
											{#if !esCorrectoVF && respuestaCorrectaVF !== null && respuestaCorrectaVF !== undefined}
												<span class="text-xs text-gray-500">
													Respuesta correcta: <span class="font-semibold text-green-700">{respuestaCorrectaVF === 1 ? 'Verdadero' : 'Falso'}</span>
												</span>
											{/if}
										</div>
									{:else}
										<p class="text-sm text-gray-500">Sin respuesta</p>
									{/if}
								{:else}
									<!-- OPCION_UNICA / OPCION_MULTIPLE -->
									{@const selectedIds = Array.isArray(respuesta.opcionesIds) ? respuesta.opcionesIds : []}
									{#if selectedIds.length > 0}
										<div class="space-y-1">
											{#each respuesta.pregunta.opciones as opcion}
												{@const fueSeleccionada = selectedIds.includes(opcion.id)}
												{#if fueSeleccionada}
													<div class="flex items-center gap-2 text-sm">
														{#if opcion.esCorrecta}
															<svg class="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
																<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
															</svg>
														{:else}
															<svg class="h-4 w-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
																<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
															</svg>
														{/if}
														<span class:text-green-700={opcion.esCorrecta} class:font-semibold={opcion.esCorrecta} class:text-red-700={!opcion.esCorrecta}>
															{opcion.texto}
														</span>
													</div>
												{/if}
											{/each}
										</div>
									{:else}
										<p class="text-sm text-gray-500">Sin respuesta</p>
									{/if}
								{/if}
							</div>
						</div>
					{/if}
				{/each}
					</div>
				</div>
			</div>
		{:else}
		<!-- Layout de 2 columnas -->
		<div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
			<!-- Columna izquierda: Info y Preguntas -->
			<div class="space-y-6 xl:col-span-2">
				<!-- La tarjeta de «Información básica» que había aquí se fue al hero.
				     Tenía cuatro cifras en cuatro tarjetas de colores distintos
				     —esmeralda, azul, morado, naranja— y debajo repetía la MISMA
				     descripción que ya sale en la cabecera. Cuatro números no
				     necesitan una tarjeta cada uno. -->

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

								<!-- Verdadero o Falso -->
								{#if pregunta.tipo === 'VERDADERO_FALSO'}
									<div class="mt-2">
										<span class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold {pregunta.respuestaCorrecta === 1 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}">
											{#if pregunta.respuestaCorrecta === 1}
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
												Respuesta correcta: Verdadero
											{:else}
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
												Respuesta correcta: Falso
											{/if}
										</span>
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
									<!-- Dos botones a todo el ancho por resultado eran 38 botones
									     grandes en una evaluación de 19 respuestas, apilados en una
									     columna estrecha. La fila entera abre el detalle y el PDF
									     queda como acción secundaria. -->
									<div class="res-acciones">
										<button
											on:click={() => verDetalleResultado(resultado)}
											class="res-btn res-btn--principal"
										>
											Ver respuestas
										</button>
										<button
											on:click={() => exportarPDFIndividual(resultado.id)}
											class="res-btn"
											title="Exportar esta respuesta a PDF"
											aria-label="Exportar a PDF la respuesta de {resultado.nombre_completo}"
										>
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
												<polyline points="7 10 12 15 17 10" />
												<line x1="12" y1="15" x2="12" y2="3" />
											</svg>
										</button>
									</div>
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
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════════════════════════════
	   HERO
	   ═══════════════════════════════════════════════════════════════
	   Mismas medidas que la lista de evaluaciones, SARLAFT y salidas-NC. La
	   rejilla es fluida a propósito: el ancho que manda es el del `main` del
	   layout, que cambia al colapsar la barra lateral, y un punto de ruptura
	   atado al viewport se desincroniza de él. */
	.page-hero {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 24px;
		padding: 1.35rem 1.5rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);

		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
		align-items: center;
		gap: 1.1rem 2rem;
	}
	.hero-left {
		display: flex;
		gap: 0.85rem;
		align-items: flex-start;
	}
	.hero-volver {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #e5e7eb;
		background: #f9fafb;
		border-radius: 12px;
		color: #4b5563;
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s;
	}
	.hero-volver:hover {
		background: #f3f4f6;
		color: #111827;
	}
	.hero-volver svg {
		width: 18px;
		height: 18px;
	}
	.hero-text {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
	}
	/* `.eyebrow` es `inline-block`, pero como hijo de un flex en columna lo
	   estira el `align-items: stretch` por defecto. */
	.hero-text .eyebrow {
		align-self: flex-start;
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: #ffedd5;
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
	}
	.hero-text h1 {
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.4rem, 3vw, 1.9rem);
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: -0.01em;
		color: #111827;
		margin: 0;
	}
	/* ═══════════════════════════════════════════════════════════════
	   CÁSCARA DE PÁGINA
	   ═══════════════════════════════════════════════════════════════
	   Las mismas medidas que la lista, SARLAFT y salidas-NC. Antes era un
	   `space-y-6 p-6` de Tailwind sobre fondo blanco: la pantalla no se
	   parecía ni a su propia lista. */
	.pagina {
		min-height: 100vh;
		background: #faf7f2;
		font-family: 'Inter Tight', system-ui, sans-serif;
		padding: 1.5rem 1.25rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* Las cifras de la evaluación, en el hero y en pastillas mono: es el
	   mismo lenguaje que usan SARLAFT y salidas-NC para lo mismo. */
	.hero-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.35rem;
		font-family: 'JetBrains Mono', monospace;
	}
	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.6rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 9px;
	}
	.stat-item--firma {
		background: #ede9fe;
		border-color: #ddd6fe;
	}
	.stat-item--firma .stat-label {
		color: #6d28d9;
	}
	.stat-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6b7280;
	}
	.stat-value {
		font-size: 0.9rem;
		font-weight: 700;
		color: #111827;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ACCIONES DE LA CABECERA
	   ═══════════════════════════════════════════════════════════════
	   Eran cinco botones sólidos en cinco colores —rojo, rojo, verde, azul y
	   rojo—: una barra de semáforos donde ninguna acción destacaba sobre las
	   demás. Ahora todas son secundarias salvo la destructiva, que es la
	   única que merece un color. */
	.btn-accion {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		color: #374151;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 9px;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color 0.15s, border-color 0.15s, color 0.15s;
	}
	.btn-accion:hover {
		background: #f9fafb;
		border-color: #d1d5db;
		color: #111827;
	}
	.btn-accion :global(svg) {
		width: 0.85rem;
		height: 0.85rem;
		flex-shrink: 0;
	}
	.btn-accion--peligro {
		color: #dc2626;
		border-color: #fecaca;
	}
	.btn-accion--peligro:hover {
		background: #fef2f2;
		border-color: #fca5a5;
		color: #b91c1c;
	}

	/* ═══════════════════════════════════════════════════════════════
	   RESULTADOS RECIENTES
	   ═══════════════════════════════════════════════════════════════ */
	.res-acciones {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	.res-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.35rem 0.6rem;
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		color: #4b5563;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s;
	}
	.res-btn svg {
		width: 0.85rem;
		height: 0.85rem;
	}
	.res-btn:hover {
		background: #f3f4f6;
		color: #111827;
	}
	.res-btn--principal {
		flex: 1;
		background: #ffedd5;
		border-color: #fed7aa;
		color: #9a3412;
	}
	.res-btn--principal:hover {
		background: #fed7aa;
		color: #7c2d12;
	}

	.hero-text p {
		font-size: 0.88rem;
		line-height: 1.55;
		color: #4b5563;
		margin: 0;
		/* Tope de legibilidad; con dos columnas manda la columna. */
		max-width: 44rem;
	}
</style>
