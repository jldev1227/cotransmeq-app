<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { socketUtils } from '$lib/socket';
	import { mascota } from '$lib/mascot';
	import PreguntaCard from '$lib/components/evaluaciones/PreguntaCard.svelte';
	import PastillaTipo from '$lib/components/evaluaciones/PastillaTipo.svelte';
	import ModalConfirmar from '$lib/components/evaluaciones/ModalConfirmar.svelte';
	import {
		acierto,
		iniciales,
		pluralPreguntas,
		porcentaje,
		tonoPuntaje
	} from '$lib/components/evaluaciones/tipos';
	import '$lib/components/evaluaciones/evaluaciones.css';

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
		tipo:
			'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO';
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
	/** Confirmación de borrado de la evaluación. */
	let confirmarEliminar = false;
	let eliminando = false;

	$: evaluacionId = $page.params.id;
	$: puntajeMaximo = evaluacion ? evaluacion.preguntas.reduce((s, p) => s + p.puntaje, 0) : 0;

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

	function formatDate(dateString: string) {
		return new Date(dateString).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function generarEnlacePublico() {
		const publicUrl = `${window.location.origin}/evaluaciones/${evaluacionId}`;
		navigator.clipboard.writeText(publicUrl);
		toast.success('Enlace copiado al portapapeles');
	}

	async function eliminarEvaluacion() {
		if (!evaluacion) return;
		eliminando = true;
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
		} finally {
			eliminando = false;
			confirmarEliminar = false;
		}
	}

	function descargarBlob(blob: Blob, nombre: string) {
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', nombre);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		window.URL.revokeObjectURL(url);
	}

	function nombreArchivo(ext: string) {
		return `evaluacion_${evaluacion?.titulo?.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${ext}`;
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

			descargarBlob(await response.blob(), nombreArchivo('pdf'));

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

			descargarBlob(await response.blob(), nombreArchivo('pdf'));

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

			descargarBlob(await response.blob(), nombreArchivo('zip'));

			toast.dismiss();
			toast.success('PDFs generados exitosamente');
		} catch (error: any) {
			toast.dismiss();
			toast.error(error.message || 'Error al generar los PDFs');
		}
	}

	const ACIERTO_TEXTO = {
		correcta: 'Correcta',
		parcial: 'Parcial',
		incorrecta: 'Incorrecta'
	} as const;
</script>

<svelte:head>
	<title>{evaluacion?.titulo || 'Evaluación'} - Cotransmeq</title>
</svelte:head>

<div class="ev-pagina" in:fade={{ duration: 300 }}>
	<!-- ═══ HERO OSCURO ═══
	     Identidad de la evaluación a la izquierda, acciones a la derecha. Es
	     el mismo hero de «Mis formularios» y del perfil: fondo oscuro de la
	     marca, eyebrow en el tono claro y las cifras como chips. -->
	<header class="ev-hero">
		<span class="ev-orbe ev-orbe--grande" aria-hidden="true"></span>
		<span class="ev-orbe ev-orbe--chico" aria-hidden="true"></span>

		<div class="ev-hero-principal">
			<button
				type="button"
				class="ev-hero-volver"
				on:click={() => goto('/dashboard/evaluaciones')}
				aria-label="Volver a evaluaciones"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
			</button>
			<div class="ev-hero-texto">
				<span class="ev-hero-eyebrow">Formación · Evaluación</span>
				<h1 class="ev-hero-titulo">{evaluacion?.titulo || 'Cargando…'}</h1>
				{#if evaluacion?.descripcion}
					<p class="ev-hero-desc">{evaluacion.descripcion}</p>
				{/if}
				{#if evaluacion}
					<div class="ev-hero-chips">
						<span class="ev-chip"><strong>{evaluacion.preguntas.length}</strong> preguntas</span>
						<span class="ev-chip"><strong>{puntajeMaximo}</strong> puntos</span>
						<span class="ev-chip"><strong>{resultados.length}</strong> respuestas</span>
						{#if evaluacion.requiere_firma}
							<span class="ev-chip ev-chip--claro">Requiere firma</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if evaluacion}
			<div class="ev-hero-acciones">
				<button
					type="button"
					class="ev-hero-btn ev-hero-btn--solido"
					on:click={exportarPDF}
					title="Exportar resumen de resultados a PDF"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
						/>
					</svg>
					PDF resumen
				</button>
				<button
					type="button"
					class="ev-hero-btn"
					on:click={exportarPDFTodos}
					title="Descargar un ZIP con el PDF de cada respuesta"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
						/>
					</svg>
					Exportar todo
				</button>
				<button
					type="button"
					class="ev-hero-btn"
					on:click={() => goto(`/dashboard/evaluaciones/${evaluacionId}/editar`)}
					title="Editar evaluación"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
						/>
					</svg>
					Editar
				</button>
				<button
					type="button"
					class="ev-hero-btn"
					on:click={generarEnlacePublico}
					title="Copiar enlace público"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
						/>
					</svg>
					Copiar enlace
				</button>
				<button
					type="button"
					class="ev-hero-btn ev-hero-btn--peligro"
					on:click={() => (confirmarEliminar = true)}
					title="Eliminar evaluación"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					Eliminar
				</button>
			</div>
		{/if}
	</header>

	{#if isLoading}
		<div class="ev-card ev-cargando">
			<span class="ev-spinner" aria-hidden="true"></span>
			Cargando evaluación…
		</div>
	{:else if error}
		<div class="ev-aviso ev-aviso--error" role="alert">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
			{error}
		</div>
	{:else if evaluacion}
		{#if resultadoSeleccionado}
			<!-- ═══ DETALLE DE UNA RESPUESTA — a ancho completo ═══ -->
			{@const sel = resultadoSeleccionado}
			{@const tono = tonoPuntaje(sel.puntaje_total, puntajeMaximo)}
			<div class="ev-detalle-respuesta" in:fade={{ duration: 200 }}>
				<section class="ev-card ev-res-cab">
					<button
						type="button"
						class="btn-icon"
						on:click={cerrarDetalleResultado}
						aria-label="Volver a la evaluación"
					>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
					</button>

					<div class="ev-res-identidad">
						<span class="ev-avatar ev-avatar--grande" aria-hidden="true"
							>{iniciales(sel.nombre_completo)}</span
						>
						<div class="ev-res-identidad-texto">
							<span class="eyebrow">Respuesta de</span>
							<h2>{sel.nombre_completo}</h2>
							<p>
								{sel.cargo} · CC {sel.numero_documento} · {formatDate(sel.created_at)}
							</p>
						</div>
					</div>

					<!-- El puntaje va en la barra, no en una tarjeta gigante de una
					     columna lateral: es un dato, no una sección. -->
					<div class="ev-nota-grande ev-nota--{tono}">
						<strong
							>{sel.puntaje_total}<span style="font-size:0.95rem"> / {puntajeMaximo}</span></strong
						>
						<span>{porcentaje(sel.puntaje_total, puntajeMaximo)} % de acierto</span>
					</div>

					<button type="button" class="btn-primary" on:click={() => exportarPDFIndividual(sel.id)}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
							/>
						</svg>
						Exportar PDF
					</button>
				</section>

				{#if sel.firma}
					<section class="ev-card">
						<h3 class="ev-card-titulo">Firma <small>Capturada al terminar la evaluación</small></h3>
						<img class="ev-firma" src={sel.firma} alt="Firma de {sel.nombre_completo}" />
					</section>
				{/if}

				<section class="ev-card">
					<header class="ev-card-cab">
						<h2 class="ev-card-titulo">
							Respuestas detalladas
							<small>{pluralPreguntas(sel.respuestas.length)}</small>
						</h2>
					</header>

					<!-- Rejilla fluida, no una columna: en una evaluación de veinte
					     preguntas la lista en columna única es kilométrica, y con
					     `auto-fit` se adapta sola al ancho real del `main` cuando la
					     barra lateral se colapsa, sin puntos de ruptura que mantener. -->
					<div class="ev-respuestas">
						{#each sel.respuestas as respuesta, index}
							{#if respuesta.pregunta}
								{@const estado = acierto(respuesta.puntaje, respuesta.pregunta.puntaje)}
								<article class="ev-resp ev-resp--{estado}">
									<header class="ev-resp-cab">
										<span class="ev-resp-num">{index + 1}</span>
										<PastillaTipo tipo={respuesta.pregunta.tipo} />
										<span
											class="ev-resp-pts ev-nota--{estado === 'correcta'
												? 'alto'
												: estado === 'parcial'
													? 'medio'
													: 'bajo'}"
											title={ACIERTO_TEXTO[estado]}
										>
											{respuesta.puntaje} / {respuesta.pregunta.puntaje} pts
										</span>
									</header>
									<p class="ev-resp-pregunta">{respuesta.pregunta.texto}</p>

									<div class="ev-resp-cuerpo">
										<span class="ev-resp-etiqueta">Respuesta del evaluado</span>

										{#if respuesta.pregunta.tipo === 'TEXTO'}
											{#if respuesta.valor_texto}
												<p class="ev-resp-valor">{respuesta.valor_texto}</p>
											{:else}
												<p class="ev-resp-vacia">Sin respuesta</p>
											{/if}
											<p class="ev-resp-nota">Respuesta abierta · calificada por IA.</p>
										{:else if respuesta.pregunta.tipo === 'NUMERICA'}
											<p class="ev-resp-valor">
												<strong
													>{respuesta.valor_numero ??
														respuesta.valor_texto ??
														'Sin respuesta'}</strong
												>
											</p>
											{#if respuesta.pregunta.respuestaCorrecta !== undefined && respuesta.pregunta.respuestaCorrecta !== null}
												<p class="ev-resp-nota">
													Respuesta correcta: <strong>{respuesta.pregunta.respuestaCorrecta}</strong
													>
												</p>
											{/if}
										{:else if respuesta.pregunta.tipo === 'RELACION'}
											{@const relaciones = Array.isArray(respuesta.relacion)
												? respuesta.relacion
												: []}
											{#if relaciones.length > 0}
												<ul class="ev-resp-lista">
													{#each relaciones as rel}
														{@const idx = respuesta.pregunta.relacionIzq.indexOf(rel.izq)}
														{@const ok =
															idx !== -1 && respuesta.pregunta.relacionDer[idx] === rel.der}
														<li
															class="ev-resp-item"
															class:ev-resp-item--ok={ok}
															class:ev-resp-item--mal={!ok}
														>
															<span
																class="ev-resp-icono {ok
																	? 'ev-resp-icono--ok'
																	: 'ev-resp-icono--mal'}"
																aria-hidden="true"
															>
																{#if ok}
																	<svg
																		viewBox="0 0 24 24"
																		fill="none"
																		stroke="currentColor"
																		stroke-width="3"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			d="M5 13l4 4L19 7"
																		/></svg
																	>
																{:else}
																	<svg
																		viewBox="0 0 24 24"
																		fill="none"
																		stroke="currentColor"
																		stroke-width="3"
																		><path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			d="M6 18L18 6M6 6l12 12"
																		/></svg
																	>
																{/if}
															</span>
															<span class="ev-resp-par">
																<span class="ev-resp-par-lado">{rel.izq}</span>
																<svg
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="2"
																	aria-hidden="true"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		d="M14 5l7 7m0 0l-7 7m7-7H3"
																	/></svg
																>
																<span class="ev-resp-par-lado">{rel.der}</span>
															</span>
														</li>
													{/each}
												</ul>
											{:else}
												<p class="ev-resp-vacia">Sin respuesta</p>
											{/if}
										{:else if respuesta.pregunta.tipo === 'VERDADERO_FALSO'}
											{@const respuestaUsuario = respuesta.valor_numero}
											{@const respuestaCorrectaVF = respuesta.pregunta.respuestaCorrecta}
											{@const esCorrectoVF =
												typeof respuestaUsuario === 'number' &&
												respuestaCorrectaVF !== null &&
												respuestaCorrectaVF !== undefined &&
												respuestaUsuario === respuestaCorrectaVF}
											{#if typeof respuestaUsuario === 'number'}
												<ul class="ev-resp-lista">
													<li
														class="ev-resp-item"
														class:ev-resp-item--ok={esCorrectoVF}
														class:ev-resp-item--mal={!esCorrectoVF}
													>
														<span
															class="ev-resp-icono {esCorrectoVF
																? 'ev-resp-icono--ok'
																: 'ev-resp-icono--mal'}"
															aria-hidden="true"
														>
															{#if esCorrectoVF}
																<svg
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="3"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		d="M5 13l4 4L19 7"
																	/></svg
																>
															{:else}
																<svg
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="3"
																	><path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		d="M6 18L18 6M6 6l12 12"
																	/></svg
																>
															{/if}
														</span>
														{respuestaUsuario === 1 ? 'Verdadero' : 'Falso'}
													</li>
												</ul>
												{#if !esCorrectoVF && respuestaCorrectaVF !== null && respuestaCorrectaVF !== undefined}
													<p class="ev-resp-nota">
														Respuesta correcta: <strong
															>{respuestaCorrectaVF === 1 ? 'Verdadero' : 'Falso'}</strong
														>
													</p>
												{/if}
											{:else}
												<p class="ev-resp-vacia">Sin respuesta</p>
											{/if}
										{:else}
											<!-- OPCION_UNICA / OPCION_MULTIPLE -->
											{@const selectedIds = Array.isArray(respuesta.opcionesIds)
												? respuesta.opcionesIds
												: []}
											{#if selectedIds.length > 0}
												<ul class="ev-resp-lista">
													{#each respuesta.pregunta.opciones as opcion}
														{@const fueSeleccionada = selectedIds.includes(opcion.id)}
														{#if fueSeleccionada}
															<li
																class="ev-resp-item"
																class:ev-resp-item--ok={opcion.esCorrecta}
																class:ev-resp-item--mal={!opcion.esCorrecta}
															>
																<span
																	class="ev-resp-icono {opcion.esCorrecta
																		? 'ev-resp-icono--ok'
																		: 'ev-resp-icono--mal'}"
																	aria-hidden="true"
																>
																	{#if opcion.esCorrecta}
																		<svg
																			viewBox="0 0 24 24"
																			fill="none"
																			stroke="currentColor"
																			stroke-width="3"
																			><path
																				stroke-linecap="round"
																				stroke-linejoin="round"
																				d="M5 13l4 4L19 7"
																			/></svg
																		>
																	{:else}
																		<svg
																			viewBox="0 0 24 24"
																			fill="none"
																			stroke="currentColor"
																			stroke-width="3"
																			><path
																				stroke-linecap="round"
																				stroke-linejoin="round"
																				d="M6 18L18 6M6 6l12 12"
																			/></svg
																		>
																	{/if}
																</span>
																{opcion.texto}
															</li>
														{:else if opcion.esCorrecta}
															<li class="ev-resp-item ev-resp-item--omitida">
																<span
																	class="ev-resp-icono ev-resp-icono--omitida"
																	aria-hidden="true"
																></span>
																{opcion.texto}
																<span class="ev-resp-nota">· correcta, no marcada</span>
															</li>
														{/if}
													{/each}
												</ul>
											{:else}
												<p class="ev-resp-vacia">Sin respuesta</p>
											{/if}
										{/if}
									</div>
								</article>
							{/if}
						{/each}
					</div>
				</section>
			</div>
		{:else}
			<div class="ev-grid-detalle" in:fly={{ y: 12, duration: 400, delay: 80 }}>
				<!-- ── Preguntas ── -->
				<section class="ev-card">
					<header class="ev-card-cab">
						<h2 class="ev-card-titulo">
							Preguntas
							<small
								>{pluralPreguntas(evaluacion.preguntas.length)} · {puntajeMaximo} puntos en total</small
							>
						</h2>
					</header>
					<div class="ev-preguntas">
						{#each evaluacion.preguntas as pregunta, index (pregunta.id)}
							<PreguntaCard {pregunta} indice={index} />
						{/each}
					</div>
				</section>

				<!-- ── Resultados ── -->
				<aside>
					<section class="ev-card ev-card--pegada">
						<header class="ev-card-cab">
							<h2 class="ev-card-titulo">
								Resultados
								<small>
									{resultados.length === 0
										? 'Nadie ha respondido todavía'
										: `${resultados.length} ${resultados.length === 1 ? 'respuesta' : 'respuestas'} · las más recientes primero`}
								</small>
							</h2>
							{#if nuevosResultadosCount > 0}
								<button
									type="button"
									class="ev-nuevos"
									on:click={limpiarNuevosResultados}
									in:fly={{ y: -12, duration: 300 }}
								>
									{nuevosResultadosCount} nuevo{nuevosResultadosCount > 1 ? 's' : ''}
								</button>
							{/if}
						</header>

						{#if isLoadingResultados}
							<div class="ev-cargando">
								<span class="ev-spinner" aria-hidden="true"></span>
								Cargando respuestas…
							</div>
						{:else if resultados.length === 0}
							{@const img = mascota('vacio')}
							<div class="ev-vacio">
								<img src={img.src} alt={img.alt} width="418" height="418" />
								<h3>Sin respuestas aún</h3>
								<p>Comparte el enlace público: las respuestas aparecen aquí en tiempo real.</p>
								<button type="button" class="btn-secondary" on:click={generarEnlacePublico}>
									Copiar enlace
								</button>
							</div>
						{:else}
							<div class="ev-res-lista">
								{#each resultados.slice(0, 10) as resultado, index (resultado.id)}
									<div class="ev-res-fila" class:ev-res-fila--nueva={index < nuevosResultadosCount}>
										<span class="ev-avatar" aria-hidden="true"
											>{iniciales(resultado.nombre_completo)}</span
										>
										<div class="ev-res-texto">
											<span class="ev-res-nombre">{resultado.nombre_completo}</span>
											<span class="ev-res-meta">
												{resultado.cargo || 'Sin cargo'} · CC {resultado.numero_documento}
											</span>
											<span class="ev-res-meta">{formatDate(resultado.created_at)}</span>
										</div>
										<span
											class="ev-nota ev-nota--{tonoPuntaje(resultado.puntaje_total, puntajeMaximo)}"
										>
											{resultado.puntaje_total}/{puntajeMaximo}
											<small>· {porcentaje(resultado.puntaje_total, puntajeMaximo)} %</small>
										</span>
										<!-- Dos botones a todo el ancho por resultado eran 38 botones
										     grandes en una evaluación de 19 respuestas, apilados en una
										     columna estrecha. La fila entera abre el detalle y el PDF
										     queda como acción secundaria. -->
										<div class="ev-res-acciones">
											<button
												type="button"
												class="ev-res-btn ev-res-btn--principal"
												on:click={() => verDetalleResultado(resultado)}
											>
												Ver respuestas
											</button>
											<button
												type="button"
												class="ev-res-btn"
												on:click={() => exportarPDFIndividual(resultado.id)}
												title="Exportar esta respuesta a PDF"
												aria-label="Exportar a PDF la respuesta de {resultado.nombre_completo}"
											>
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
													<polyline points="7 10 12 15 17 10" />
													<line x1="12" y1="15" x2="12" y2="3" />
												</svg>
												PDF
											</button>
										</div>
									</div>
								{/each}
							</div>

							{#if resultados.length > 10}
								<p class="ev-mas">Mostrando 10 de {resultados.length} respuestas</p>
							{/if}
						{/if}
					</section>
				</aside>
			</div>
		{/if}
	{/if}
</div>

{#if confirmarEliminar && evaluacion}
	<ModalConfirmar
		titulo="Eliminar evaluación"
		mensaje={`Se eliminará «${evaluacion.titulo}» con sus ${pluralPreguntas(evaluacion.preguntas.length)} y las ${resultados.length} respuestas recibidas. Esta acción no se puede deshacer.`}
		confirmar="Eliminar evaluación"
		procesando={eliminando}
		onConfirmar={eliminarEvaluacion}
		onCancelar={() => (confirmarEliminar = false)}
	/>
{/if}

<style>
	.ev-detalle-respuesta {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
