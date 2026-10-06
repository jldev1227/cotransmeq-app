<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly, slide } from 'svelte/transition';
	import SignaturePad from 'signature_pad';
	import { getDeviceFingerprint } from '$lib/utils/fingerprint';
	import { dndzone } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import PastillaTipo from '$lib/components/evaluaciones/PastillaTipo.svelte';
	import {
		acierto,
		porcentaje,
		tonoPuntaje,
		pluralPreguntas
	} from '$lib/components/evaluaciones/tipos';
	import { mascota } from '$lib/mascot';
	import SopaLetras from '$lib/components/evaluaciones/SopaLetras.svelte';
	import {
		palabrasDeSopa,
		type ConfigSopa,
		type ConfigSopaPublica,
		type TrazoSopa
	} from '$lib/components/evaluaciones/tipos';
	// La misma hoja del módulo de evaluaciones del panel: hero, tarjetas,
	// campos y semáforo del puntaje. Así la página pública y el detalle
	// que ve HSEQ son la misma familia.
	import '$lib/components/evaluaciones/evaluaciones.css';

	interface Evaluacion {
		id: string;
		titulo: string;
		descripcion: string | null;
		requiere_firma: boolean;
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
		/** Sopa de letras: cuadrícula y lista de palabras, sin ubicaciones. */
		/// Antes de responder llega sin ubicaciones; en el resultado, completa.
		configuracion?: ConfigSopaPublica | ConfigSopa | null;
	}

	interface Opcion {
		id: string;
		texto: string;
		esCorrecta?: boolean;
	}

	interface DndItem {
		id: string;
		texto: string;
	}

	interface Respuesta {
		preguntaId: string;
		valor_texto?: string;
		valor_numero?: number;
		opcionesIds?: string[];
		relacion?: { izq: string; der: string }[];
		/** Sopa de letras: líneas marcadas. */
		trazos?: TrazoSopa[];
	}

	let evaluacion: Evaluacion | null = null;
	let isLoading = false;
	let error: string | null = null;
	let currentStep = 0; // 0: datos personales, 1+: preguntas, final: firma y resultado
	let isSubmitting = false;

	// Datos personales
	let nombre_completo = '';
	let numero_documento = '';
	let cargo = '';
	let correo = '';
	let telefono = '';
	let deviceFingerprint = '';

	// Respuestas
	let respuestas: Map<string, Respuesta> = new Map();

	// Firma
	let signaturePad: SignaturePad | null = null;
	let firmaData: string | null = null;

	// Resultado
	let resultado: any = null;
	let yaRespondio = false;
	let miResultado: any = null;

	// Errores y Toast
	let errores: Record<string, string> = {};
	let toastMessage = '';
	let toastType: 'error' | 'success' | 'info' = 'info';
	let showToast = false;

	// Drag & Drop para relaciones
	let itemsIzqShuffled: Map<string, DndItem[]> = new Map();
	let itemsDerShuffled: Map<string, DndItem[]> = new Map();
	let relacionesSeleccionadas: Map<string, Map<string, string>> = new Map(); // preguntaId -> (itemIzqId -> itemDerId)
	let selectedLeftItem: string | null = null; // Item izquierdo seleccionado actualmente

	$: evaluacionId = $page.params.id;
	$: totalPreguntas = evaluacion?.preguntas.length || 0;
	$: progreso = currentStep === 0 ? 0 : (currentStep / (totalPreguntas + 1)) * 100;
	// La evaluación que se carga para responder viene sin la clave (`esCorrecta`,
	// `respuestaCorrecta`). La revisión la toma del resultado que devuelven
	// `responder` y `verificar`, que traen la evaluación completa.
	$: preguntasRevision = (miResultado?.evaluacion?.preguntas ??
		evaluacion?.preguntas ??
		[]) as Pregunta[];

	onMount(async () => {
		// Generar fingerprint del dispositivo
		deviceFingerprint = await getDeviceFingerprint();

		await loadEvaluacion();
		await verificarSiYaRespondio();
	});

	async function verificarSiYaRespondio() {
		if (!deviceFingerprint || !evaluacionId) return;

		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/verificar?device_fingerprint=${encodeURIComponent(deviceFingerprint)}`
			);

			if (response.ok) {
				const data = await response.json();
				if (data.success && data.data) {
					yaRespondio = true;
					miResultado = data.data;
					// Cargar los datos del usuario que ya respondió
					nombre_completo = miResultado.nombre_completo;
					numero_documento = miResultado.numero_documento;
					cargo = miResultado.cargo;
					correo = miResultado.correo;
					telefono = miResultado.telefono;
					firmaData = miResultado.firma;
				}
			}
		} catch (error) {
			console.error('Error al verificar si ya respondió:', error);
		}
	}

	function mostrarToast(mensaje: string, tipo: 'error' | 'success' | 'info' = 'info') {
		toastMessage = mensaje;
		toastType = tipo;
		showToast = true;
		setTimeout(() => {
			showToast = false;
		}, 3000);
	}

	async function loadEvaluacion() {
		isLoading = true;
		error = null;
		try {
			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/public/evaluaciones/${evaluacionId}`
			);
			const data = await response.json();
			if (data.success) {
				evaluacion = data.data;
				// Pre-inicializar items de relación para todas las preguntas de tipo RELACION
				if (evaluacion?.preguntas) {
					for (const pregunta of evaluacion.preguntas) {
						if (pregunta.tipo === 'RELACION' && pregunta.relacionIzq?.length > 0) {
							initRelacionItems(pregunta);
						}
					}
				}
			} else {
				error = 'Evaluación no encontrada';
			}
		} catch (err: any) {
			error = err.message || 'Error al cargar la evaluación';
			console.error('Error:', err);
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Acción del lienzo: una SignaturePad por cada canvas que se monta.
	 *
	 * Antes la librería se creaba con un `setTimeout` al llegar al paso y se
	 * guardaba con la guarda `!signaturePad`. Al pulsar «Anterior» el canvas se
	 * destruía y, al volver a la firma, la persona dibujaba sobre un lienzo al
	 * que la librería ya no escuchaba: `isEmpty()` daba true y el envío se
	 * rechazaba con «Por favor firma la evaluación» sin salida posible.
	 */
	function lienzoFirma(canvas: HTMLCanvasElement) {
		const contenedor = canvas.parentElement;
		if (contenedor) {
			canvas.width = contenedor.getBoundingClientRect().width;
			canvas.height = 200;
		}
		signaturePad = new SignaturePad(canvas, {
			backgroundColor: 'rgb(255, 255, 255)',
			penColor: 'rgb(0, 0, 0)'
		});
		return {
			destroy() {
				signaturePad?.off();
				signaturePad = null;
			}
		};
	}

	function clearSignature() {
		if (signaturePad) {
			signaturePad.clear();
		}
	}

	function siguiente() {
		errores = {};

		if (currentStep === 0) {
			// Validar datos personales
			if (!nombre_completo.trim()) errores.nombre_completo = 'El nombre completo es requerido';
			if (!numero_documento || numero_documento.toString().trim() === '')
				errores.numero_documento = 'El número de documento es requerido';
			if (!cargo.trim()) errores.cargo = 'El cargo es requerido';
			if (!correo.trim()) errores.correo = 'El correo es requerido';
			else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))
				errores.correo = 'El correo no es válido';
			if (!telefono || telefono.toString().trim() === '')
				errores.telefono = 'El teléfono es requerido';

			if (Object.keys(errores).length > 0) {
				mostrarToast('Por favor completa todos los campos obligatorios', 'error');
				return;
			}
		} else if (currentStep <= totalPreguntas) {
			// Validar respuesta actual
			const preguntaActual = evaluacion!.preguntas[currentStep - 1];
			const respuesta = respuestas.get(preguntaActual.id);

			if (!respuesta) {
				mostrarToast('Por favor responde la pregunta', 'error');
				return;
			}

			// Validaciones por tipo
			if (preguntaActual.tipo === 'OPCION_UNICA' || preguntaActual.tipo === 'OPCION_MULTIPLE') {
				if (!respuesta.opcionesIds || respuesta.opcionesIds.length === 0) {
					mostrarToast('Por favor selecciona al menos una opción', 'error');
					return;
				}
			} else if (preguntaActual.tipo === 'NUMERICA') {
				if (respuesta.valor_numero === undefined) {
					mostrarToast('Por favor ingresa un número', 'error');
					return;
				}
			} else if (preguntaActual.tipo === 'TEXTO') {
				if (!respuesta.valor_texto || respuesta.valor_texto.trim() === '') {
					mostrarToast('Por favor ingresa una respuesta', 'error');
					return;
				}
			} else if (preguntaActual.tipo === 'SOPA_LETRAS') {
				if (!respuesta.trazos || respuesta.trazos.length === 0) {
					mostrarToast('Marca al menos una palabra en la sopa de letras', 'error');
					return;
				}
			} else if (preguntaActual.tipo === 'RELACION') {
				if (!respuesta.relacion || respuesta.relacion.length === 0) {
					mostrarToast('Por favor relaciona los elementos', 'error');
					return;
				}
			} else if (preguntaActual.tipo === 'VERDADERO_FALSO') {
				if (respuesta.valor_numero === undefined || respuesta.valor_numero === null) {
					mostrarToast('Por favor selecciona Verdadero o Falso', 'error');
					return;
				}
			}
		}

		currentStep++;
	}

	function anterior() {
		if (currentStep > 0) currentStep--;
	}

	function handleOpcionUnica(preguntaId: string, opcionId: string) {
		respuestas.set(preguntaId, {
			preguntaId,
			opcionesIds: [opcionId]
		});
		respuestas = respuestas;
	}

	function handleOpcionMultiple(preguntaId: string, opcionId: string, checked: boolean) {
		const respuesta = respuestas.get(preguntaId) || { preguntaId, opcionesIds: [] };
		if (checked) {
			respuesta.opcionesIds = [...(respuesta.opcionesIds || []), opcionId];
		} else {
			respuesta.opcionesIds = (respuesta.opcionesIds || []).filter((id) => id !== opcionId);
		}
		respuestas.set(preguntaId, respuesta);
		respuestas = respuestas;
	}

	function handleNumerica(preguntaId: string, valor: number) {
		respuestas.set(preguntaId, {
			preguntaId,
			valor_numero: valor
		});
		respuestas = respuestas;
	}

	function handleTexto(preguntaId: string, valor: string) {
		respuestas.set(preguntaId, {
			preguntaId,
			valor_texto: valor
		});
		respuestas = respuestas;
	}

	function handleVerdaderoFalso(preguntaId: string, valor: number) {
		respuestas.set(preguntaId, {
			preguntaId,
			valor_numero: valor
		});
		respuestas = respuestas;
	}

	function handleSopa(preguntaId: string, trazos: TrazoSopa[]) {
		respuestas.set(preguntaId, {
			preguntaId,
			opcionesIds: trazos.map((t) => t.palabra ?? '').filter(Boolean),
			trazos
		});
		respuestas = respuestas;
	}

	function handleRelacion(preguntaId: string, izq: string, der: string) {
		const respuesta = respuestas.get(preguntaId) || { preguntaId, relacion: [] };
		const relacion = respuesta.relacion || [];

		// Verificar si ya existe esta relación
		const existeIndex = relacion.findIndex((r) => r.izq === izq);
		if (existeIndex >= 0) {
			relacion[existeIndex] = { izq, der };
		} else {
			relacion.push({ izq, der });
		}

		respuesta.relacion = relacion;
		respuestas.set(preguntaId, respuesta);
		respuestas = respuestas;
	}

	// Función para aleatorizar arrays (Fisher-Yates shuffle)
	function shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	// Inicializar items aleatorios para una pregunta de relación
	function initRelacionItems(pregunta: Pregunta) {
		if (!itemsIzqShuffled.has(pregunta.id)) {
			const itemsIzq = pregunta.relacionIzq.map((texto, index) => ({
				id: `izq-${pregunta.id}-${index}`,
				texto
			}));
			const itemsDer = pregunta.relacionDer.map((texto, index) => ({
				id: `der-${pregunta.id}-${index}`,
				texto
			}));

			itemsIzqShuffled.set(pregunta.id, shuffleArray(itemsIzq));
			itemsDerShuffled.set(pregunta.id, shuffleArray(itemsDer));
			// Reasignar para que Svelte detecte el cambio reactivo
			itemsIzqShuffled = itemsIzqShuffled;
			itemsDerShuffled = itemsDerShuffled;
		}
	}

	// Manejar drag & drop
	function handleDndConsider(preguntaId: string, lado: 'izq' | 'der', e: CustomEvent) {
		if (lado === 'izq') {
			itemsIzqShuffled.set(preguntaId, e.detail.items);
			itemsIzqShuffled = itemsIzqShuffled;
		} else {
			itemsDerShuffled.set(preguntaId, e.detail.items);
			itemsDerShuffled = itemsDerShuffled;
		}
	}

	function handleDndFinalize(preguntaId: string, lado: 'izq' | 'der', e: CustomEvent) {
		if (lado === 'izq') {
			itemsIzqShuffled.set(preguntaId, e.detail.items);
			itemsIzqShuffled = itemsIzqShuffled;
		} else {
			itemsDerShuffled.set(preguntaId, e.detail.items);
			itemsDerShuffled = itemsDerShuffled;
		}
	}

	// Manejar relación con drag & drop
	function toggleRelacion(preguntaId: string, itemIzqId: string, itemDerId: string) {
		if (!relacionesSeleccionadas.has(preguntaId)) {
			relacionesSeleccionadas.set(preguntaId, new Map());
		}

		const relaciones = relacionesSeleccionadas.get(preguntaId)!;
		const currentSelection = relaciones.get(itemIzqId);

		if (currentSelection === itemDerId) {
			// Si ya está seleccionado, deseleccionar
			relaciones.delete(itemIzqId);
		} else {
			// Seleccionar nueva relación
			relaciones.set(itemIzqId, itemDerId);
		}

		relacionesSeleccionadas = relacionesSeleccionadas;

		// Actualizar respuestas
		const itemsIzq = itemsIzqShuffled.get(preguntaId) || [];
		const itemsDer = itemsDerShuffled.get(preguntaId) || [];

		const respuestaRelacion = Array.from(relaciones.entries()).map(([izqId, derId]) => {
			const itemIzq = itemsIzq.find((item) => item.id === izqId);
			const itemDer = itemsDer.find((item) => item.id === derId);
			return {
				izq: itemIzq?.texto || '',
				der: itemDer?.texto || ''
			};
		});

		respuestas.set(preguntaId, {
			preguntaId,
			relacion: respuestaRelacion
		});
		respuestas = respuestas;
	}

	// Limpiar todas las relaciones de una pregunta
	function limpiarRelaciones(preguntaId: string) {
		// Limpiar selección actual
		selectedLeftItem = null;

		// Limpiar relaciones seleccionadas
		relacionesSeleccionadas.set(preguntaId, new Map());
		relacionesSeleccionadas = relacionesSeleccionadas;

		// Limpiar respuestas
		respuestas.set(preguntaId, {
			preguntaId,
			relacion: []
		});
		respuestas = respuestas;
	}

	async function enviarEvaluacion() {
		// Validar firma si es requerida
		if (evaluacion?.requiere_firma) {
			if (!signaturePad || signaturePad.isEmpty()) {
				mostrarToast('Por favor firma la evaluación', 'error');
				return;
			}
			firmaData = signaturePad.toDataURL();
		}

		isSubmitting = true;

		try {
			const respuestasArray = Array.from(respuestas.values());

			const payload: any = {
				nombre_completo,
				numero_documento: String(numero_documento),
				cargo,
				correo,
				telefono: String(telefono),
				device_fingerprint: deviceFingerprint, // Usar el fingerprint real del dispositivo
				respuestas: respuestasArray
			};

			// Solo agregar firma si existe
			if (firmaData) {
				payload.firma = firmaData;
			}

			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/responder`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				}
			);

			const data = await response.json();

			// Manejar error 409 (dispositivo ya respondió)
			if (response.status === 409) {
				mostrarToast(
					data.message || 'Este dispositivo ya ha enviado una respuesta para esta evaluación',
					'error'
				);
				return;
			}

			if (data.success) {
				resultado = data.data;
				yaRespondio = true;
				miResultado = data.data;
				mostrarToast('¡Evaluación completada exitosamente!', 'success');
			} else {
				mostrarToast(data.errors?.[0]?.message || 'Error al enviar la evaluación', 'error');
			}
		} catch (err: any) {
			console.error('Error:', err);
			mostrarToast('Error al enviar la evaluación', 'error');
		} finally {
			isSubmitting = false;
		}
	}

	// Referencia directa a `evaluacion`: una llamada a función no la rastrea.
	$: puntajeMaximo = evaluacion ? evaluacion.preguntas.reduce((s, p) => s + p.puntaje, 0) : 0;
	$: pasoEtiqueta =
		currentStep === 0
			? 'Tus datos'
			: currentStep <= totalPreguntas
				? `Pregunta ${currentStep} de ${totalPreguntas}`
				: 'Firma';
</script>

<svelte:head>
	<title>{evaluacion?.titulo || 'Evaluación'} - Cotransmeq</title>
</svelte:head>

{#if showToast}
	<div
		class="pe-toast pe-toast--{toastType}"
		role="status"
		in:fly={{ y: -14, duration: 220 }}
		out:fade={{ duration: 150 }}
	>
		{#if toastType === 'error'}
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path stroke-linecap="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
		{:else if toastType === 'success'}
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		{:else}
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
		{/if}
		<span>{toastMessage}</span>
	</div>
{/if}

<div class="pe-pagina">
	<header class="pe-barra">
		<img class="pe-logo" src="/assets/logo_nombre.webp" alt="Cotransmeq" />
		{#if evaluacion && !yaRespondio && !isLoading}
			<span class="pe-barra-paso">{pasoEtiqueta}</span>
		{/if}
	</header>

	<main class="pe-main">
		{#if isLoading}
			<section class="ev-card">
				<div class="ev-cargando">
					<span class="ev-spinner" aria-hidden="true"></span>
					Cargando la evaluación…
				</div>
			</section>
		{:else if error}
			{@const img = mascota('advertencia')}
			<section class="ev-card" in:fade>
				<div class="ev-vacio">
					<img src={img.src} alt={img.alt} width="418" height="418" />
					<h3>No se pudo abrir la evaluación</h3>
					<p>{error}</p>
				</div>
			</section>
		{:else if yaRespondio && miResultado}
			{@const tono = tonoPuntaje(miResultado.puntaje_total, puntajeMaximo)}
			<div class="pe-flujo" in:fade={{ duration: 200 }}>
				<section class="ev-hero pe-hero">
					<span class="ev-orbe ev-orbe--grande" aria-hidden="true"></span>
					<span class="ev-orbe ev-orbe--chico" aria-hidden="true"></span>
					<div class="pe-hero-fila">
						<div class="ev-hero-texto">
							<h1 class="ev-hero-titulo">
								{resultado ? 'Evaluación enviada' : 'Ya respondiste esta evaluación'}
							</h1>
							<p class="ev-hero-desc">
								{resultado
									? 'Tus respuestas quedaron registradas. Este es tu resultado.'
									: 'Este dispositivo ya envió una respuesta. Este es el resultado que quedó registrado.'}
							</p>
							{#if evaluacion}
								<p class="pe-hero-sub">{evaluacion.titulo}</p>
							{/if}
						</div>
						<div class="ev-nota-grande ev-nota--{tono} pe-nota-grande">
							<strong
								>{miResultado.puntaje_total}<span class="pe-nota-de">
									/ {puntajeMaximo}</span
								></strong
							>
							<span>{porcentaje(miResultado.puntaje_total, puntajeMaximo)} % de acierto</span>
						</div>
					</div>
				</section>

				<div class="pe-grid-resultado">
					<aside class="pe-lateral">
						<section class="ev-card">
							<h2 class="ev-card-titulo">Tus datos</h2>
							<dl class="pe-datos">
								<div>
									<dt>Nombre</dt>
									<dd>{miResultado.nombre_completo}</dd>
								</div>
								<div>
									<dt>Documento</dt>
									<dd>{miResultado.numero_documento}</dd>
								</div>
								<div>
									<dt>Cargo</dt>
									<dd>{miResultado.cargo}</dd>
								</div>
								<div>
									<dt>Correo</dt>
									<dd class="pe-dd-largo">{miResultado.correo}</dd>
								</div>
								<div>
									<dt>Teléfono</dt>
									<dd>{miResultado.telefono}</dd>
								</div>
							</dl>
						</section>
						{#if miResultado.firma}
							<section class="ev-card">
								<h2 class="ev-card-titulo">Firma <small>Capturada al terminar</small></h2>
								<img class="ev-firma" src={miResultado.firma} alt="Tu firma" />
							</section>
						{/if}
					</aside>

					<section class="ev-card">
						<header class="ev-card-cab">
							<h2 class="ev-card-titulo">
								Tus respuestas
								<small>{pluralPreguntas(preguntasRevision.length)}</small>
							</h2>
						</header>
						<div class="ev-respuestas pe-respuestas">
							{#each preguntasRevision as pregunta, index (pregunta.id)}
								{@const respuesta = miResultado.respuestas.find(
									(r: any) => r.preguntaId === pregunta.id
								)}
								{@const obtenido = respuesta?.puntaje ?? 0}
								{@const estado = acierto(obtenido, pregunta.puntaje)}
								<article class="ev-resp ev-resp--{estado}">
									<header class="ev-resp-cab">
										<span class="ev-resp-num">{index + 1}</span>
										<PastillaTipo tipo={pregunta.tipo} />
										<span
											class="ev-resp-pts ev-nota--{estado === 'correcta'
												? 'alto'
												: estado === 'parcial'
													? 'medio'
													: 'bajo'}"
										>
											{obtenido} / {pregunta.puntaje} pts
										</span>
									</header>
									<p class="ev-resp-pregunta">{pregunta.texto}</p>
									<div class="ev-resp-cuerpo">
										<span class="ev-resp-etiqueta">Tu respuesta</span>
										{#if !respuesta}
											<p class="ev-resp-vacia">Sin respuesta</p>
										{:else if pregunta.tipo === 'TEXTO'}
											{#if respuesta.valor_texto}
												<p class="ev-resp-valor">{respuesta.valor_texto}</p>
											{:else}
												<p class="ev-resp-vacia">Sin respuesta</p>
											{/if}
											<p class="ev-resp-nota">Respuesta abierta · calificada automáticamente.</p>
										{:else if pregunta.tipo === 'NUMERICA'}
											<p class="ev-resp-valor">
												<strong>{respuesta.valor_numero ?? 'Sin respuesta'}</strong>
											</p>
											{#if estado !== 'correcta' && pregunta.respuestaCorrecta !== undefined && pregunta.respuestaCorrecta !== null}
												<p class="ev-resp-nota">
													Respuesta correcta: <strong>{pregunta.respuestaCorrecta}</strong>
												</p>
											{/if}
										{:else if pregunta.tipo === 'VERDADERO_FALSO'}
											{#if typeof respuesta.valor_numero === 'number'}
												<ul class="ev-resp-lista">
													<li
														class="ev-resp-item"
														class:ev-resp-item--ok={estado === 'correcta'}
														class:ev-resp-item--mal={estado !== 'correcta'}
													>
														<span
															class="ev-resp-icono {estado === 'correcta'
																? 'ev-resp-icono--ok'
																: 'ev-resp-icono--mal'}"
															aria-hidden="true"
														>
															{#if estado === 'correcta'}
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
														{respuesta.valor_numero === 1 ? 'Verdadero' : 'Falso'}
													</li>
												</ul>
												{#if estado !== 'correcta' && pregunta.respuestaCorrecta !== undefined && pregunta.respuestaCorrecta !== null}
													<p class="ev-resp-nota">
														Respuesta correcta: <strong
															>{pregunta.respuestaCorrecta === 1 ? 'Verdadero' : 'Falso'}</strong
														>
													</p>
												{/if}
											{:else}
												<p class="ev-resp-vacia">Sin respuesta</p>
											{/if}
										{:else if pregunta.tipo === 'SOPA_LETRAS'}
											{#if pregunta.configuracion?.cuadricula?.length}
												<SopaLetras
													compacta
													cuadricula={pregunta.configuracion.cuadricula}
													palabras={palabrasDeSopa(pregunta.configuracion)}
													trazos={Array.isArray(respuesta.relacion) ? respuesta.relacion : []}
												/>
											{/if}
											<p class="ev-resp-nota">
												{(respuesta.opcionesIds ?? []).length} de {pregunta.configuracion?.palabras
													.length ?? 0} palabras encontradas
											</p>
										{:else if pregunta.tipo === 'RELACION'}
											{@const relaciones = Array.isArray(respuesta.relacion)
												? respuesta.relacion
												: []}
											{#if relaciones.length > 0}
												<ul class="ev-resp-lista">
													{#each relaciones as rel}
														{@const idx = pregunta.relacionIzq.indexOf(rel.izq)}
														{@const ok = idx !== -1 && pregunta.relacionDer[idx] === rel.der}
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
										{:else}
											{@const marcadas = Array.isArray(respuesta.opcionesIds)
												? respuesta.opcionesIds
												: []}
											{#if marcadas.length > 0}
												<ul class="ev-resp-lista">
													{#each pregunta.opciones as opcion (opcion.id)}
														{@const marcada = marcadas.includes(opcion.id)}
														{#if marcada}
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
																<span>
																	{opcion.texto}
																	<span class="ev-resp-nota">· correcta, no marcada</span>
																</span>
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
							{/each}
						</div>
					</section>
				</div>
			</div>
		{:else if evaluacion}
			<div class="pe-flujo" in:fade={{ duration: 200 }}>
				<section class="ev-hero pe-hero">
					<span class="ev-orbe ev-orbe--grande" aria-hidden="true"></span>
					<span class="ev-orbe ev-orbe--chico" aria-hidden="true"></span>
					<div class="ev-hero-texto">
						<h1 class="ev-hero-titulo" class:pe-hero-titulo--compacto={currentStep > 0}>
							{evaluacion.titulo}
						</h1>
						{#if currentStep === 0 && evaluacion.descripcion}
							<p class="ev-hero-desc">{evaluacion.descripcion}</p>
						{/if}
						{#if currentStep === 0}
							<div class="ev-hero-chips">
								<span class="ev-chip"><strong>{totalPreguntas}</strong> preguntas</span>
								<span class="ev-chip"><strong>{puntajeMaximo}</strong> puntos</span>
								{#if evaluacion.requiere_firma}
									<span class="ev-chip ev-chip--claro">Requiere firma</span>
								{/if}
							</div>
						{/if}
					</div>
					<div class="pe-progreso">
						<div
							class="pe-progreso-pista"
							role="progressbar"
							aria-label="Avance de la evaluación"
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={Math.round(progreso)}
						>
							<div class="pe-progreso-barra" style="transform: scaleX({progreso / 100})"></div>
						</div>
						<span class="pe-progreso-texto">
							{pasoEtiqueta}
							<strong>{Math.round(progreso)} %</strong>
						</span>
					</div>
				</section>

				<section class="ev-card pe-paso">
					{#key currentStep}
						<div class="pe-paso-cuerpo" in:fly={{ x: 28, duration: 260 }}>
							{#if currentStep === 0}
								<header class="pe-paso-cab">
									<h2 class="pe-paso-titulo">Tus datos</h2>
									<p class="pe-paso-desc">
										Con ellos se registra tu resultado. Todos los campos son obligatorios.
									</p>
								</header>
								<div class="pe-form">
									<label
										class="ev-campo pe-campo--ancho"
										class:pe-campo--error={errores.nombre_completo}
									>
										<span class="pe-etiqueta">Nombre completo</span>
										<input
											bind:value={nombre_completo}
											type="text"
											autocomplete="name"
											placeholder="Como aparece en tu documento"
										/>
										{#if errores.nombre_completo}<small class="pe-error"
												>{errores.nombre_completo}</small
											>{/if}
									</label>
									<label class="ev-campo" class:pe-campo--error={errores.numero_documento}>
										<span class="pe-etiqueta">Número de documento</span>
										<input
											bind:value={numero_documento}
											type="number"
											inputmode="numeric"
											placeholder="Sin puntos"
										/>
										{#if errores.numero_documento}<small class="pe-error"
												>{errores.numero_documento}</small
											>{/if}
									</label>
									<label class="ev-campo" class:pe-campo--error={errores.cargo}>
										<span class="pe-etiqueta">Cargo</span>
										<input
											bind:value={cargo}
											type="text"
											autocomplete="organization-title"
											placeholder="Conductor, auxiliar…"
										/>
										{#if errores.cargo}<small class="pe-error">{errores.cargo}</small>{/if}
									</label>
									<label class="ev-campo" class:pe-campo--error={errores.correo}>
										<span class="pe-etiqueta">Correo electrónico</span>
										<input
											bind:value={correo}
											type="email"
											autocomplete="email"
											placeholder="nombre@correo.com"
										/>
										{#if errores.correo}<small class="pe-error">{errores.correo}</small>{/if}
									</label>
									<label class="ev-campo" class:pe-campo--error={errores.telefono}>
										<span class="pe-etiqueta">Teléfono</span>
										<input
											bind:value={telefono}
											type="number"
											inputmode="tel"
											autocomplete="tel"
											placeholder="3001234567"
										/>
										{#if errores.telefono}<small class="pe-error">{errores.telefono}</small>{/if}
									</label>
								</div>
							{:else if currentStep <= totalPreguntas}
								{@const pregunta = evaluacion.preguntas[currentStep - 1]}
								{@const respuesta = respuestas.get(pregunta.id)}
								<header class="pe-paso-cab">
									<div class="pe-pregunta-meta">
										<span class="ev-resp-num">Pregunta {currentStep}</span>
										<PastillaTipo tipo={pregunta.tipo} />
										<span class="pe-pts"
											>{pregunta.puntaje} {pregunta.puntaje === 1 ? 'punto' : 'puntos'}</span
										>
									</div>
									<h2 class="pe-pregunta">{pregunta.texto}</h2>
								</header>

								{#if pregunta.tipo === 'OPCION_UNICA'}
									<div class="pe-opciones" role="radiogroup" aria-label="Opciones">
										{#each pregunta.opciones as opcion (opcion.id)}
											{@const activa = respuesta?.opcionesIds?.[0] === opcion.id}
											<button
												type="button"
												role="radio"
												aria-checked={activa}
												class="pe-opcion"
												class:pe-opcion--activa={activa}
												on:click={() => handleOpcionUnica(pregunta.id, opcion.id)}
											>
												<span class="pe-marca pe-marca--radio" aria-hidden="true"></span>
												<span class="pe-opcion-texto">{opcion.texto}</span>
											</button>
										{/each}
									</div>
								{:else if pregunta.tipo === 'OPCION_MULTIPLE'}
									<p class="pe-ayuda">Puedes marcar más de una.</p>
									<div class="pe-opciones">
										{#each pregunta.opciones as opcion (opcion.id)}
											{@const activa = !!respuesta?.opcionesIds?.includes(opcion.id)}
											<label class="pe-opcion" class:pe-opcion--activa={activa}>
												<input
													class="pe-oculto"
													type="checkbox"
													checked={activa}
													on:change={(e) =>
														handleOpcionMultiple(pregunta.id, opcion.id, e.currentTarget.checked)}
												/>
												<span class="pe-marca pe-marca--check" aria-hidden="true">
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
												</span>
												<span class="pe-opcion-texto">{opcion.texto}</span>
											</label>
										{/each}
									</div>
								{:else if pregunta.tipo === 'NUMERICA'}
									<label class="ev-campo pe-campo--numero">
										<span class="pe-etiqueta">Tu respuesta</span>
										<input
											type="number"
											step="any"
											inputmode="decimal"
											value={respuesta?.valor_numero ?? ''}
											on:input={(e) => handleNumerica(pregunta.id, Number(e.currentTarget.value))}
											placeholder="Escribe un número"
										/>
									</label>
								{:else if pregunta.tipo === 'TEXTO'}
									<label class="ev-campo">
										<span class="pe-etiqueta">Tu respuesta</span>
										<textarea
											rows="5"
											value={respuesta?.valor_texto ?? ''}
											on:input={(e) => handleTexto(pregunta.id, e.currentTarget.value)}
											placeholder="Responde con tus palabras"
										></textarea>
									</label>
								{:else if pregunta.tipo === 'VERDADERO_FALSO'}
									<div class="pe-vf" role="radiogroup" aria-label="Verdadero o falso">
										<button
											type="button"
											role="radio"
											aria-checked={respuesta?.valor_numero === 1}
											class="pe-vf-opcion"
											class:pe-vf-opcion--activa={respuesta?.valor_numero === 1}
											on:click={() => handleVerdaderoFalso(pregunta.id, 1)}
										>
											<span class="pe-vf-icono" aria-hidden="true">
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M5 13l4 4L19 7"
													/></svg
												>
											</span>
											Verdadero
										</button>
										<button
											type="button"
											role="radio"
											aria-checked={respuesta?.valor_numero === 0}
											class="pe-vf-opcion"
											class:pe-vf-opcion--activa={respuesta?.valor_numero === 0}
											on:click={() => handleVerdaderoFalso(pregunta.id, 0)}
										>
											<span class="pe-vf-icono" aria-hidden="true">
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M6 18L18 6M6 6l12 12"
													/></svg
												>
											</span>
											Falso
										</button>
									</div>
								{:else if pregunta.tipo === 'SOPA_LETRAS'}
									{#if pregunta.configuracion?.cuadricula?.length}
										<SopaLetras
											interactivo
											cuadricula={pregunta.configuracion.cuadricula}
											palabras={palabrasDeSopa(pregunta.configuracion)}
											trazos={respuesta?.trazos ?? []}
											onCambio={(trazos) => handleSopa(pregunta.id, trazos)}
										/>
									{:else}
										<p class="ev-resp-vacia">Esta sopa de letras no tiene cuadrícula generada.</p>
									{/if}
								{:else if pregunta.tipo === 'RELACION'}
									{@const _ = initRelacionItems(pregunta)}
									{@const itemsIzq = itemsIzqShuffled.get(pregunta.id) || []}
									{@const itemsDer = itemsDerShuffled.get(pregunta.id) || []}
									{@const relaciones = relacionesSeleccionadas.get(pregunta.id) || new Map()}
									<div class="ev-aviso">
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
											><path
												stroke-linecap="round"
												d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
											/></svg
										>
										Toca un elemento de la columna A y luego su pareja en la columna B.
									</div>
									<div class="pe-relacion">
										<div class="pe-columna">
											<h3 class="pe-columna-titulo">
												<span class="pe-columna-letra">A</span> Columna A
											</h3>
											{#each itemsIzq as itemIzq (itemIzq.id)}
												{@const unido = relaciones.has(itemIzq.id)}
												{@const pendiente = selectedLeftItem === itemIzq.id && !unido}
												{@const pareja = itemsDer.find(
													(item) => item.id === relaciones.get(itemIzq.id)
												)}
												<button
													type="button"
													class="pe-item"
													class:pe-item--unido={unido}
													class:pe-item--pendiente={pendiente}
													aria-pressed={pendiente}
													on:click={() => (selectedLeftItem = itemIzq.id)}
													animate:flip={{ duration: 300 }}
												>
													<span class="pe-item-texto">
														{itemIzq.texto}
														{#if unido && pareja}
															<small class="pe-item-pareja">→ {pareja.texto}</small>
														{:else if pendiente}
															<small class="pe-item-pareja">Ahora elige en la columna B</small>
														{/if}
													</span>
													<span class="pe-marca pe-marca--check" aria-hidden="true">
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
													</span>
												</button>
											{/each}
										</div>
										<div class="pe-columna" class:pe-columna--espera={!selectedLeftItem}>
											<h3 class="pe-columna-titulo">
												<span class="pe-columna-letra">B</span> Columna B
											</h3>
											{#each itemsDer as itemDer (itemDer.id)}
												{@const unido = Array.from(relaciones.values()).includes(itemDer.id)}
												{@const parejaId = Array.from(relaciones.entries()).find(
													([, derId]) => derId === itemDer.id
												)?.[0]}
												{@const pareja = itemsIzq.find((item) => item.id === parejaId)}
												<button
													type="button"
													class="pe-item"
													class:pe-item--unido={unido}
													disabled={!selectedLeftItem && !unido}
													on:click={() => {
														if (selectedLeftItem)
															toggleRelacion(pregunta.id, selectedLeftItem, itemDer.id);
													}}
													animate:flip={{ duration: 300 }}
												>
													<span class="pe-marca pe-marca--check" aria-hidden="true">
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
													</span>
													<span class="pe-item-texto">
														{itemDer.texto}
														{#if unido && pareja}
															<small class="pe-item-pareja">← {pareja.texto}</small>
														{/if}
													</span>
												</button>
											{/each}
										</div>
									</div>
									<div class="pe-relacion-pie">
										<span class="pe-relacion-cuenta">
											Parejas: <strong>{relaciones.size}</strong> de {itemsIzq.length}
										</span>
										{#if relaciones.size > 0}
											<button
												type="button"
												class="pe-enlace"
												on:click={() => limpiarRelaciones(pregunta.id)}
											>
												Deshacer todas
											</button>
										{/if}
									</div>
								{/if}
							{:else if currentStep === totalPreguntas + 1 && evaluacion.requiere_firma}
								<header class="pe-paso-cab">
									<h2 class="pe-paso-titulo">Firma</h2>
									<p class="pe-paso-desc">
										Firma dentro del recuadro para confirmar tus respuestas.
									</p>
								</header>
								<div class="pe-canvas-marco">
									<canvas use:lienzoFirma class="pe-canvas"></canvas>
								</div>
								<div>
									<button type="button" class="pe-enlace" on:click={clearSignature}
										>Borrar y firmar de nuevo</button
									>
								</div>
							{/if}
						</div>
					{/key}

					<footer class="pe-nav">
						{#if currentStep > 0 && currentStep <= totalPreguntas + 1}
							<button type="button" class="btn-secondary" on:click={anterior}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg
								>
								Anterior
							</button>
						{:else}
							<span></span>
						{/if}

						{#if currentStep < totalPreguntas}
							<button type="button" class="btn-primary" on:click={siguiente}>
								{currentStep === 0 ? 'Comenzar' : 'Siguiente'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg
								>
							</button>
						{:else if currentStep === totalPreguntas && evaluacion.requiere_firma}
							<button type="button" class="btn-primary" on:click={siguiente}>
								Continuar a la firma
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg
								>
							</button>
						{:else}
							<button
								type="button"
								class="btn-primary"
								disabled={isSubmitting}
								on:click={enviarEvaluacion}
							>
								{#if isSubmitting}
									<span class="ev-spinner pe-spinner-btn" aria-hidden="true"></span>
									Enviando…
								{:else}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
										/></svg
									>
									Enviar evaluación
								{/if}
							</button>
						{/if}
					</footer>
				</section>
			</div>
		{/if}
	</main>
</div>

<style>
	/* ── Cáscara ── */
	.pe-pagina {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--au-bg);
		color: var(--au-text);
		accent-color: var(--au-primary);
	}
	.pe-pagina ::selection {
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.pe-barra {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1.5rem;
		background: var(--au-surface);
		border-bottom: 1px solid var(--au-border);
	}
	.pe-logo {
		height: 2.75rem;
		width: auto;
	}
	.pe-barra-paso {
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		background: var(--au-tint);
		color: var(--au-dark);
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.02em;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	/* Sin tope de ancho: la página ocupa el viewport entero (ver la skill
	   diseno-paginas). Lo que se acota por legibilidad son los párrafos. */
	.pe-main {
		width: 100%;
		padding: 1.5rem;
		flex: 1;
	}
	.pe-flujo {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ── Hero ── */
	.pe-hero {
		gap: 1.1rem;
	}
	.pe-hero-fila {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.5rem;
	}
	.pe-hero-fila > .ev-hero-texto {
		flex: 1 1 18rem;
	}
	.pe-hero-titulo--compacto {
		font-size: clamp(1.05rem, 2vw, 1.3rem);
	}
	.pe-hero-sub {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--au-eyebrow);
		overflow-wrap: anywhere;
	}
	.pe-nota-grande {
		flex-shrink: 0;
		min-width: 9rem;
		background: rgba(255, 255, 255, 0.94);
	}
	.pe-nota-grande strong {
		font-size: 2.1rem;
	}
	.pe-nota-de {
		font-size: 1rem;
		font-weight: 700;
		opacity: 0.7;
	}
	.pe-progreso {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.pe-progreso-pista {
		height: 0.45rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.18);
		overflow: hidden;
	}
	.pe-progreso-barra {
		height: 100%;
		width: 100%;
		border-radius: 999px;
		background: #fff;
		transform-origin: left center;
		transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.pe-progreso-texto {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--au-hero-text);
		font-variant-numeric: tabular-nums;
	}
	.pe-progreso-texto strong {
		color: #fff;
		font-weight: 800;
	}

	/* ── Paso ── */
	.pe-paso {
		gap: 1.25rem;
		padding: 1.5rem 1.6rem 1.35rem;
	}
	.pe-paso-cuerpo {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.pe-paso-cab {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.pe-paso-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--au-text);
	}
	.pe-paso-desc {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--au-muted);
	}
	.pe-pregunta-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}
	.pe-pts {
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--au-muted);
	}
	.pe-pregunta {
		margin: 0.2rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.1rem, 2.2vw, 1.35rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.3;
		color: var(--au-text);
		text-wrap: balance;
		white-space: pre-line;
	}
	.pe-ayuda {
		margin: -0.5rem 0 0;
		font-size: 0.8rem;
		color: var(--au-muted);
	}

	/* ── Datos personales ── */
	.pe-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 1rem 1.1rem;
	}
	.pe-campo--ancho {
		grid-column: 1 / -1;
	}
	.pe-campo--numero {
		max-width: 20rem;
	}
	.pe-etiqueta {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--au-text);
	}
	/* La hoja compartida solo viste text y number; el correo necesita lo mismo. */
	.ev-campo input[type='email'] {
		width: 100%;
		padding: 0.65rem 0.85rem;
		border: 1.5px solid var(--au-border);
		border-radius: 14px;
		background: #fff;
		font-family: inherit;
		font-size: 0.9rem;
		color: var(--au-text);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.pe-campo--error input {
		border-color: var(--au-danger) !important;
		background: var(--au-danger-soft) !important;
	}
	.pe-error {
		font-size: 0.74rem !important;
		font-weight: 600;
		color: var(--au-danger) !important;
	}

	/* ── Opciones ── */
	.pe-opciones {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.pe-opcion {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		width: 100%;
		padding: 0.85rem 1rem;
		border: 1.5px solid var(--au-border);
		border-radius: 16px;
		background: #fff;
		font-family: inherit;
		font-size: 0.92rem;
		line-height: 1.4;
		color: var(--au-text);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.pe-opcion:hover {
		border-color: var(--au-primary);
	}
	.pe-opcion:focus-visible,
	.pe-opcion:has(:focus-visible) {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.2);
	}
	.pe-opcion--activa {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
		font-weight: 600;
	}
	.pe-opcion-texto {
		flex: 1;
		min-width: 0;
	}
	.pe-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	.pe-marca {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
		border: 1.5px solid var(--au-border);
		background: #fff;
		color: #fff;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.pe-marca--radio {
		border-radius: 50%;
	}
	.pe-marca--check {
		border-radius: 7px;
	}
	.pe-marca svg {
		width: 0.75rem;
		height: 0.75rem;
		opacity: 0;
	}
	.pe-opcion--activa .pe-marca,
	.pe-item--unido .pe-marca {
		border-color: var(--au-primary);
		background: var(--au-primary);
	}
	.pe-opcion--activa .pe-marca--radio {
		box-shadow: inset 0 0 0 3px #fff;
	}
	.pe-opcion--activa .pe-marca svg,
	.pe-item--unido .pe-marca svg {
		opacity: 1;
	}

	/* ── Verdadero / falso ── */
	.pe-vf {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.pe-vf-opcion {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 1.4rem 1rem;
		border: 1.5px solid var(--au-border);
		border-radius: 18px;
		background: #fff;
		font-family: var(--font-display);
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--au-text);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.pe-vf-opcion:hover {
		border-color: var(--au-primary);
	}
	.pe-vf-opcion:focus-visible {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.2);
	}
	.pe-vf-opcion--activa {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.pe-vf-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		background: var(--bg-base, #f7faf8);
		color: var(--au-muted);
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.pe-vf-icono svg {
		width: 1.35rem;
		height: 1.35rem;
	}
	.pe-vf-opcion--activa .pe-vf-icono {
		background: var(--au-primary);
		color: #fff;
	}

	/* ── Relación ── */
	.pe-relacion {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.pe-columna {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: opacity 0.2s ease;
	}
	.pe-columna--espera {
		opacity: 0.55;
	}
	.pe-columna-titulo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.2rem;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--au-muted);
	}
	.pe-columna-letra {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--au-dark);
		color: #fff;
		font-family: var(--font-display);
		font-size: 0.78rem;
	}
	.pe-item {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		padding: 0.75rem 0.9rem;
		border: 1.5px solid var(--au-border);
		border-radius: 14px;
		background: #fff;
		font-family: inherit;
		font-size: 0.88rem;
		line-height: 1.35;
		color: var(--au-text);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.pe-item:hover:not(:disabled) {
		border-color: var(--au-primary);
	}
	.pe-item:focus-visible {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.2);
	}
	.pe-item:disabled {
		cursor: default;
	}
	.pe-item--pendiente {
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.18);
	}
	.pe-item--unido {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
		font-weight: 600;
	}
	.pe-item-texto {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.pe-item-pareja {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--au-primary-strong);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pe-relacion-pie {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.7rem 0.9rem;
		border-radius: 14px;
		background: var(--bg-base, #f7faf8);
		font-size: 0.82rem;
		color: var(--au-muted);
	}
	.pe-relacion-cuenta strong {
		color: var(--au-dark);
		font-variant-numeric: tabular-nums;
	}
	.pe-enlace {
		padding: 0.2rem 0;
		border: 0;
		background: none;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--au-primary-strong);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.pe-enlace:hover {
		color: var(--au-dark);
	}
	.pe-enlace:focus-visible {
		outline: 2px solid var(--au-primary);
		outline-offset: 3px;
		border-radius: 4px;
	}

	/* ── Firma ── */
	.pe-canvas-marco {
		position: relative;
		border: 1.5px dashed var(--au-border);
		border-radius: 18px;
		background: #fff;
		overflow: hidden;
	}
	.pe-canvas-marco:focus-within {
		border-color: var(--au-primary);
	}
	.pe-canvas {
		display: block;
		width: 100%;
		height: 200px;
		touch-action: none;
		cursor: crosshair;
	}

	/* ── Navegación ── */
	.pe-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding-top: 1.1rem;
		border-top: 1px solid var(--au-border);
	}
	.pe-spinner-btn {
		width: 1rem;
		height: 1rem;
		border-width: 2px;
		border-color: rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
	}

	/* ── Resultado ── */
	.pe-grid-resultado {
		display: grid;
		gap: 1rem;
		align-items: start;
	}
	.pe-lateral {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.pe-datos {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		margin: 0;
	}
	.pe-datos > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding-bottom: 0.65rem;
		border-bottom: 1px solid var(--au-border);
	}
	.pe-datos > div:last-child {
		padding-bottom: 0;
		border-bottom: 0;
	}
	.pe-datos dt {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--au-muted);
	}
	.pe-datos dd {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--au-text);
	}
	.pe-dd-largo {
		overflow-wrap: anywhere;
	}
	.pe-paso-desc,
	.pe-ayuda {
		max-width: 44rem;
	}

	/* ── Toast ── */
	.pe-toast {
		position: fixed;
		top: 1rem;
		right: 1rem;
		left: 1rem;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-left: auto;
		max-width: 24rem;
		padding: 0.8rem 1rem;
		border-radius: 16px;
		background: var(--au-dark);
		color: #fff;
		font-size: 0.86rem;
		font-weight: 600;
		box-shadow: 0 10px 28px rgba(1, 67, 57, 0.28);
	}
	.pe-toast svg {
		width: 1.2rem;
		height: 1.2rem;
		flex-shrink: 0;
	}
	.pe-toast--error {
		background: var(--au-danger);
		box-shadow: 0 10px 28px rgba(180, 35, 24, 0.28);
	}
	.pe-toast--success {
		background: var(--au-primary-strong);
	}

	/* ── Anchos ── */
	@media (min-width: 900px) {
		.pe-grid-resultado {
			grid-template-columns: minmax(0, 4fr) minmax(0, 8fr);
		}
	}
	@media (max-width: 639.98px) {
		.pe-barra {
			padding: 0.7rem 1rem;
		}
		.pe-logo {
			height: 2.25rem;
		}
		.pe-main {
			padding: 1rem;
		}
		.pe-paso {
			padding: 1.2rem 1.1rem 1.1rem;
		}
		.pe-relacion {
			grid-template-columns: 1fr;
		}
		.pe-nav {
			flex-direction: column-reverse;
		}
		.pe-nav > * {
			width: 100%;
			justify-content: center;
		}
		.pe-nav > span {
			display: none;
		}
		.pe-toast {
			max-width: none;
		}
	}
	@media (max-width: 419.98px) {
		.pe-vf {
			grid-template-columns: 1fr;
		}
	}
</style>
