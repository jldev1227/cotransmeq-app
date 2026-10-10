<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { socketUtils } from '$lib/socket';
	import { mascota } from '$lib/mascot';
	import PreguntaCard from '$lib/components/evaluaciones/PreguntaCard.svelte';
	import PastillaTipo from '$lib/components/evaluaciones/PastillaTipo.svelte';
	import SopaLetras from '$lib/components/evaluaciones/SopaLetras.svelte';
	import {
		palabrasDeSopa,
		trazosDeSopa,
		type ConfigSopa,
		type TrazoSopa
	} from '$lib/components/evaluaciones/tipos';
	import ModalConfirmar from '$lib/components/evaluaciones/ModalConfirmar.svelte';
	import {
		acierto,
		iniciales,
		pluralPreguntas,
		porcentaje,
		tonoPuntaje
	} from '$lib/components/evaluaciones/tipos';
	import '$lib/components/evaluaciones/evaluaciones.css';
	import {
		authHeaders,
		actualizarRespuestasResultado,
		obtenerResultado
	} from '$lib/api/evaluaciones';
	import { authStore } from '$lib/stores/auth';

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
			| 'OPCION_UNICA'
			| 'OPCION_MULTIPLE'
			| 'NUMERICA'
			| 'TEXTO'
			| 'RELACION'
			| 'VERDADERO_FALSO'
			| 'SOPA_LETRAS';
		puntaje: number;
		opciones: Opcion[];
		relacionIzq: string[];
		relacionDer: string[];
		respuestaCorrecta?: number;
		/** Sopa de letras: cuadrícula y ubicación de cada palabra. */
		configuracion?: ConfigSopa | null;
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
		/** Solo viene en el detalle; la lista trae `tiene_firma`. */
		firma?: string | null;
		tiene_firma?: boolean;
		created_at: string;
		respuestas: RespuestaDetalle[];
	}

	interface RespuestaDetalle {
		id: string;
		preguntaId: string;
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
		bajaRespuestaActualizada?.();
	});

	/// Antes esta página abría su PROPIA conexión con `io(...)`, sin token y sin
	/// darse de baja de nada: cada visita dejaba un socket más contra el
	/// servidor. Ahora usa el cliente compartido, que ya está autenticado.
	let bajaNuevaRespuesta: (() => void) | undefined;
	let bajaRespuestaActualizada: (() => void) | undefined;

	function initSocket() {
		socketUtils.emit('join-evaluacion', evaluacionId);

		bajaNuevaRespuesta = socketUtils.on('nueva-respuesta', (data: Resultado) => {
			// Agregar al inicio del array
			resultados = [data, ...resultados];
			nuevosResultadosCount++;
			toast.success(`Nueva respuesta de ${data.nombre_completo}`);
		});

		bajaRespuestaActualizada = socketUtils.on('respuesta-actualizada', (data: Resultado) => {
			reemplazarResultado(data);
		});
	}

	/** Sustituye un resultado en la lista y, si está abierto y no se está editando, en el detalle. */
	function reemplazarResultado(data: Resultado) {
		resultados = resultados.map((r) => (r.id === data.id ? data : r));
		if (resultadoSeleccionado?.id === data.id && !editandoRespuestas) {
			resultadoSeleccionado = data;
		}
	}

	async function loadEvaluacion() {
		isLoading = true;
		error = null;
		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}`,
				{ headers: authHeaders() }
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
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/resultados`,
				{ headers: authHeaders() }
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

	let isLoadingDetalle = false;

	/**
	 * La lista llega sin firma y sin la pregunta de cada respuesta (pesaba
	 * medio mega con quince respuestas y en producción no cargaba). Se abre
	 * con lo que hay y se completa con el detalle en cuanto llega.
	 */
	async function verDetalleResultado(resultado: Resultado) {
		resultadoSeleccionado = resultado;
		// Al abrir un detalle desde media página desplazada, el contenido nuevo
		// empieza fuera de la vista y parece que no ha pasado nada.
		if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
		if (resultado.respuestas.every((r) => r.pregunta) && resultado.firma !== undefined) return;
		isLoadingDetalle = true;
		try {
			const res = await obtenerResultado<Resultado>(evaluacionId ?? '', resultado.id);
			if (res.success && resultadoSeleccionado?.id === resultado.id) {
				resultadoSeleccionado = res.data;
				resultados = resultados.map((r) => (r.id === res.data.id ? res.data : r));
			}
		} catch (err: any) {
			toast.error(err?.message || 'No se pudo cargar el detalle');
		} finally {
			isLoadingDetalle = false;
		}
	}

	function cerrarDetalleResultado() {
		resultadoSeleccionado = null;
		editandoRespuestas = false;
	}

	/**
	 * Las respuestas llegan en el orden en que la base las devuelve, que no es
	 * el de las preguntas; sin esto la «pregunta 1» del detalle podía ser la
	 * séptima de la evaluación.
	 */
	function ordenarPorPregunta(respuestas: RespuestaDetalle[]): RespuestaDetalle[] {
		if (!evaluacion) return respuestas;
		const posicion = new Map(evaluacion.preguntas.map((p, i) => [p.id, i]));
		return [...respuestas].sort(
			(a, b) =>
				(posicion.get(a.pregunta?.id ?? a.preguntaId) ?? Infinity) -
				(posicion.get(b.pregunta?.id ?? b.preguntaId) ?? Infinity)
		);
	}

	// ── Edición de respuestas por un administrador ──
	// Cuando la evaluación se edita después de que alguien respondió, las
	// opciones se recrean con ids nuevos y esa persona queda con 0 sin haber
	// fallado. Quien tenga acceso total a evaluaciones puede corregirlo.
	$: puedeEditarRespuestas =
		!!$authStore.user && authStore.getAccessLevel('evaluaciones') === 'full';

	interface BorradorRespuesta {
		opcionUnica: string;
		opcionesIds: string[];
		valor_numero: number | null;
		valor_texto: string;
		relacion: Record<string, string>;
		/** Sopa de letras: palabras que se dan por encontradas. */
		palabras: string[];
	}

	let editandoRespuestas = false;
	let guardandoRespuestas = false;
	let borrador: Record<string, BorradorRespuesta> = {};

	function iniciarEdicionRespuestas() {
		if (!evaluacion || !resultadoSeleccionado) return;
		const previas = new Map(
			resultadoSeleccionado.respuestas.map((r) => [r.pregunta?.id ?? r.preguntaId, r])
		);
		const nuevo: Record<string, BorradorRespuesta> = {};
		// Se recorren las preguntas de la evaluación, no las respuestas: así
		// también se puede contestar una pregunta añadida después.
		for (const pregunta of evaluacion.preguntas) {
			const previa = previas.get(pregunta.id);
			const ids = (previa?.opcionesIds ?? []).filter((id) =>
				pregunta.opciones.some((o) => o.id === id)
			);
			const relacion: Record<string, string> = {};
			for (const par of Array.isArray(previa?.relacion) ? previa.relacion : []) {
				relacion[par.izq] = par.der;
			}
			nuevo[pregunta.id] = {
				opcionUnica: ids[0] ?? '',
				opcionesIds: ids,
				valor_numero: previa?.valor_numero ?? null,
				valor_texto: previa?.valor_texto ?? '',
				relacion,
				palabras: pregunta.tipo === 'SOPA_LETRAS' ? [...(previa?.opcionesIds ?? [])] : []
			};
		}
		borrador = nuevo;
		editandoRespuestas = true;
	}

	/// Sin `bind:` aquí: un `bind:value` sobre `relacion[izq]` dentro del bucle
	/// anidado hacía que Svelte evaluara `izq` fuera de su alcance al invalidar
	/// `borrador` desde cualquier otro campo («izq is not defined»).
	function fijarRelacion(preguntaId: string, izq: string, der: string) {
		const b = borrador[preguntaId];
		borrador = { ...borrador, [preguntaId]: { ...b, relacion: { ...b.relacion, [izq]: der } } };
	}

	function cancelarEdicionRespuestas() {
		editandoRespuestas = false;
		borrador = {};
	}

	async function guardarRespuestas() {
		if (!evaluacion || !resultadoSeleccionado) return;
		const respuestas = evaluacion.preguntas.map((pregunta) => {
			const b = borrador[pregunta.id];
			const base = { preguntaId: pregunta.id };
			switch (pregunta.tipo) {
				case 'OPCION_UNICA':
					return { ...base, opcionesIds: b.opcionUnica ? [b.opcionUnica] : [] };
				case 'OPCION_MULTIPLE':
					return { ...base, opcionesIds: b.opcionesIds };
				case 'VERDADERO_FALSO':
				case 'NUMERICA':
					return typeof b.valor_numero === 'number' && !Number.isNaN(b.valor_numero)
						? { ...base, valor_numero: b.valor_numero }
						: base;
				case 'TEXTO':
					return { ...base, valor_texto: b.valor_texto };
				case 'SOPA_LETRAS':
					// El backend califica por trazos; el panel conoce dónde está cada
					// palabra y manda el trazo real de las que se dan por encontradas.
					return {
						...base,
						trazos: pregunta.configuracion
							? trazosDeSopa(pregunta.configuracion).filter((t) =>
									b.palabras.includes(t.palabra ?? '')
								)
							: []
					};
				case 'RELACION':
					return {
						...base,
						relacion: Object.entries(b.relacion)
							.filter(([, der]) => der)
							.map(([izq, der]) => ({ izq, der }))
					};
			}
		});

		guardandoRespuestas = true;
		try {
			const res = await actualizarRespuestasResultado(
				evaluacion.id,
				resultadoSeleccionado.id,
				respuestas
			);
			if (!res.success) throw new Error('No se pudo guardar');
			editandoRespuestas = false;
			borrador = {};
			reemplazarResultado(res.data);
			toast.success(
				`Respuestas corregidas · nuevo puntaje ${res.data.puntaje_total}/${puntajeMaximo}`
			);
		} catch (err: any) {
			const msg = err?.response?.data?.message || err?.message || 'No se pudo guardar';
			toast.error(msg);
		} finally {
			guardandoRespuestas = false;
		}
	}

	function limpiarNuevosResultados() {
		nuevosResultadosCount = 0;
	}

	// ── Búsqueda y paginación de resultados ──
	// El backend devuelve todas las respuestas de una vez; filtrar y paginar
	// aquí evita otra ida al servidor y mantiene el tiempo real intacto.
	const POR_PAGINA = 10;
	let busqueda = '';
	let paginaActual = 1;

	function normalizar(texto: string | number | null | undefined) {
		return String(texto ?? '')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.trim();
	}

	$: terminoBusqueda = normalizar(busqueda);
	$: resultadosFiltrados = terminoBusqueda
		? resultados.filter(
				(r) =>
					normalizar(r.nombre_completo).includes(terminoBusqueda) ||
					normalizar(r.numero_documento).includes(terminoBusqueda)
			)
		: resultados;
	$: totalPaginas = Math.max(1, Math.ceil(resultadosFiltrados.length / POR_PAGINA));
	$: if (paginaActual > totalPaginas) paginaActual = totalPaginas;
	$: resultadosVisibles = resultadosFiltrados.slice(
		(paginaActual - 1) * POR_PAGINA,
		paginaActual * POR_PAGINA
	);
	// Al cambiar el término de búsqueda se vuelve a la primera página.
	$: (terminoBusqueda, (paginaActual = 1));
	// Los «nuevos» se resaltan por id, no por posición: con filtro o en otra
	// página la posición ya no coincide con el orden de llegada.
	$: nuevosIds = new Set(resultados.slice(0, nuevosResultadosCount).map((r) => r.id));

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
					method: 'DELETE',
					headers: authHeaders()
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
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/exportar-pdf`,
				{ headers: authHeaders() }
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
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/resultados/${resultadoId}/exportar-pdf`,
				{ headers: authHeaders() }
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
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/exportar-zip`,
				{ headers: authHeaders() }
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
		<div class="ev-card">
			<CargaMascota texto="Cargando evaluación…" />
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

					{#if editandoRespuestas}
						<div class="ev-edicion-acciones">
							<button
								type="button"
								class="btn-secondary"
								disabled={guardandoRespuestas}
								on:click={cancelarEdicionRespuestas}
							>
								Cancelar
							</button>
							<button
								type="button"
								class="btn-primary"
								disabled={guardandoRespuestas}
								on:click={guardarRespuestas}
							>
								{guardandoRespuestas ? 'Guardando…' : 'Guardar y recalificar'}
							</button>
						</div>
					{:else}
						<div class="ev-edicion-acciones">
							{#if puedeEditarRespuestas}
								<button
									type="button"
									class="btn-secondary"
									on:click={iniciarEdicionRespuestas}
									title="Corregir las respuestas registradas y recalcular el puntaje"
								>
									Editar respuestas
								</button>
							{/if}
							<button
								type="button"
								class="btn-primary"
								on:click={() => exportarPDFIndividual(sel.id)}
							>
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
									/>
								</svg>
								Exportar PDF
							</button>
						</div>
					{/if}
				</section>

				{#if sel.firma}
					<section class="ev-card">
						<h3 class="ev-card-titulo">Firma <small>Capturada al terminar la evaluación</small></h3>
						<img class="ev-firma" src={sel.firma} alt="Firma de {sel.nombre_completo}" />
					</section>
				{/if}

				{#if isLoadingDetalle}
					<CargaMascota texto="Cargando el detalle…" />
				{/if}

				{#if editandoRespuestas}
					<section class="ev-card">
						<header class="ev-card-cab">
							<h2 class="ev-card-titulo">
								Corregir respuestas
								<small
									>Marca lo que {sel.nombre_completo} respondió. Al guardar se recalifica con la clave
									actual.</small
								>
							</h2>
						</header>
						<div class="ev-respuestas">
							{#each evaluacion.preguntas as pregunta, index (pregunta.id)}
								<article class="ev-resp ev-resp--edicion">
									<header class="ev-resp-cab">
										<span class="ev-resp-num">{index + 1}</span>
										<PastillaTipo tipo={pregunta.tipo} />
										<span class="ev-resp-pts">{pregunta.puntaje} pts</span>
									</header>
									<p class="ev-resp-pregunta">{pregunta.texto}</p>
									<div class="ev-resp-cuerpo">
										{#if pregunta.tipo === 'OPCION_UNICA'}
											{#each pregunta.opciones as opcion (opcion.id)}
												<label
													class="ev-edit-opcion"
													class:ev-edit-opcion--correcta={opcion.esCorrecta}
												>
													<input
														type="radio"
														name="edit-{pregunta.id}"
														value={opcion.id}
														bind:group={borrador[pregunta.id].opcionUnica}
													/>
													<span>{opcion.texto}</span>
													{#if opcion.esCorrecta}<span class="ev-edit-correcta">Correcta</span>{/if}
												</label>
											{/each}
										{:else if pregunta.tipo === 'OPCION_MULTIPLE'}
											{#each pregunta.opciones as opcion (opcion.id)}
												<label
													class="ev-edit-opcion"
													class:ev-edit-opcion--correcta={opcion.esCorrecta}
												>
													<input
														type="checkbox"
														value={opcion.id}
														bind:group={borrador[pregunta.id].opcionesIds}
													/>
													<span>{opcion.texto}</span>
													{#if opcion.esCorrecta}<span class="ev-edit-correcta">Correcta</span>{/if}
												</label>
											{/each}
										{:else if pregunta.tipo === 'VERDADERO_FALSO'}
											<label
												class="ev-edit-opcion"
												class:ev-edit-opcion--correcta={pregunta.respuestaCorrecta === 1}
											>
												<input
													type="radio"
													name="edit-{pregunta.id}"
													value={1}
													bind:group={borrador[pregunta.id].valor_numero}
												/>
												<span>Verdadero</span>
												{#if pregunta.respuestaCorrecta === 1}<span class="ev-edit-correcta"
														>Correcta</span
													>{/if}
											</label>
											<label
												class="ev-edit-opcion"
												class:ev-edit-opcion--correcta={pregunta.respuestaCorrecta === 0}
											>
												<input
													type="radio"
													name="edit-{pregunta.id}"
													value={0}
													bind:group={borrador[pregunta.id].valor_numero}
												/>
												<span>Falso</span>
												{#if pregunta.respuestaCorrecta === 0}<span class="ev-edit-correcta"
														>Correcta</span
													>{/if}
											</label>
										{:else if pregunta.tipo === 'NUMERICA'}
											<input
												class="ev-edit-campo"
												type="number"
												step="any"
												placeholder="Sin respuesta"
												bind:value={borrador[pregunta.id].valor_numero}
											/>
											{#if pregunta.respuestaCorrecta !== undefined && pregunta.respuestaCorrecta !== null}
												<p class="ev-resp-nota">
													Respuesta correcta: <strong>{pregunta.respuestaCorrecta}</strong>
												</p>
											{/if}
										{:else if pregunta.tipo === 'TEXTO'}
											<textarea
												class="ev-edit-campo"
												rows="3"
												placeholder="Sin respuesta"
												bind:value={borrador[pregunta.id].valor_texto}
											></textarea>
											<p class="ev-resp-nota">Si el texto cambia, la IA lo vuelve a calificar.</p>
										{:else if pregunta.tipo === 'SOPA_LETRAS'}
											{#each pregunta.configuracion ? palabrasDeSopa(pregunta.configuracion) : [] as palabra (palabra)}
												<label class="ev-edit-opcion">
													<input
														type="checkbox"
														value={palabra}
														bind:group={borrador[pregunta.id].palabras}
													/>
													<span>{palabra}</span>
												</label>
											{/each}
										{:else if pregunta.tipo === 'RELACION'}
											{#each pregunta.relacionIzq as izq, i (izq)}
												<label class="ev-edit-par">
													<span class="ev-resp-par-lado">
														{izq}
														<small class="ev-edit-par-clave"
															>correcta: {pregunta.relacionDer[i]}</small
														>
													</span>
													<select
														class="ev-edit-campo"
														value={borrador[pregunta.id].relacion[izq] ?? ''}
														on:change={(e) =>
															fijarRelacion(pregunta.id, izq, e.currentTarget.value)}
													>
														<option value="">— sin unir —</option>
														{#each pregunta.relacionDer as der (der)}
															<option value={der}>{der}</option>
														{/each}
													</select>
												</label>
											{/each}
										{/if}
									</div>
								</article>
							{/each}
						</div>
					</section>
				{:else}
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
							{#each ordenarPorPregunta(sel.respuestas) as respuesta, index (respuesta.id)}
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
														Respuesta correcta: <strong
															>{respuesta.pregunta.respuestaCorrecta}</strong
														>
													</p>
												{/if}
											{:else if respuesta.pregunta.tipo === 'SOPA_LETRAS'}
												{#if respuesta.pregunta.configuracion?.cuadricula?.length}
													<SopaLetras
														compacta
														cuadricula={respuesta.pregunta.configuracion.cuadricula}
														palabras={palabrasDeSopa(respuesta.pregunta.configuracion)}
														trazos={Array.isArray(respuesta.relacion)
															? (respuesta.relacion as unknown as TrazoSopa[])
															: []}
													/>
												{/if}
												<p class="ev-resp-nota">
													{(respuesta.opcionesIds ?? []).length} de {respuesta.pregunta
														.configuracion?.palabras.length ?? 0} palabras encontradas
												</p>
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
												{@const opcionesVigentes = respuesta.pregunta.opciones.filter((o) =>
													selectedIds.includes(o.id)
												).length}
												{#if selectedIds.length > 0 && opcionesVigentes === 0}
													<!-- La evaluación se editó después de esta respuesta: las
												     opciones se recrearon y lo marcado ya no apunta a nada. -->
													<p class="ev-resp-vacia">
														Marcó {selectedIds.length}
														{selectedIds.length === 1
															? 'opción que ya no existe'
															: 'opciones que ya no existen'}: la evaluación se editó después de
														esta respuesta.
														{#if puedeEditarRespuestas}Usa «Editar respuestas» para registrar lo que
															contestó.{/if}
													</p>
												{:else if selectedIds.length > 0}
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
				{/if}
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
							<CargaMascota texto="Cargando respuestas…" />
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
							<label class="ev-buscador">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<circle cx="11" cy="11" r="8" />
									<line x1="21" y1="21" x2="16.65" y2="16.65" />
								</svg>
								<input
									type="search"
									bind:value={busqueda}
									placeholder="Buscar por nombre o documento"
									aria-label="Buscar respuestas por nombre o documento"
								/>
							</label>

							{#if resultadosFiltrados.length === 0}
								<p class="ev-mas">Ninguna respuesta coincide con «{busqueda}»</p>
							{:else}
								<div class="ev-res-lista">
									{#each resultadosVisibles as resultado (resultado.id)}
										<div class="ev-res-fila" class:ev-res-fila--nueva={nuevosIds.has(resultado.id)}>
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
												class="ev-nota ev-nota--{tonoPuntaje(
													resultado.puntaje_total,
													puntajeMaximo
												)}"
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

								<nav class="ev-paginador" aria-label="Paginación de respuestas">
									<p class="ev-mas">
										Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(
											paginaActual * POR_PAGINA,
											resultadosFiltrados.length
										)} de {resultadosFiltrados.length}
										{resultadosFiltrados.length === 1 ? 'respuesta' : 'respuestas'}
									</p>
									{#if totalPaginas > 1}
										<div class="ev-paginador-botones">
											<button
												type="button"
												class="ev-res-btn"
												disabled={paginaActual === 1}
												on:click={() => (paginaActual -= 1)}
											>
												Anterior
											</button>
											<span class="ev-paginador-pagina">{paginaActual} / {totalPaginas}</span>
											<button
												type="button"
												class="ev-res-btn"
												disabled={paginaActual === totalPaginas}
												on:click={() => (paginaActual += 1)}
											>
												Siguiente
											</button>
										</div>
									{/if}
								</nav>
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
