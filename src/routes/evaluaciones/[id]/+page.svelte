<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly, slide } from 'svelte/transition';
	import SignaturePad from 'signature_pad';
	import { getDeviceFingerprint } from '$lib/utils/fingerprint';
	import { dndzone } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';

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
		tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION';
		puntaje: number;
		opciones: Opcion[];
		relacionIzq: string[];
		relacionDer: string[];
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
	let canvasElement: HTMLCanvasElement;
	let firmaData: string | null = null;

	// Resultado
	let resultado: any = null;
	let showResultado = false;
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

	onMount(async () => {
		// Generar fingerprint del dispositivo
		deviceFingerprint = await getDeviceFingerprint();
		console.log('Device fingerprint generado:', deviceFingerprint);

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
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}`
			);
			const data = await response.json();
			if (data.success) {
				evaluacion = data.data;
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

	function initSignaturePad() {
		if (canvasElement && !signaturePad) {
			// Ajustar el tamaño del canvas al contenedor
			const container = canvasElement.parentElement;
			if (container) {
				const rect = container.getBoundingClientRect();
				canvasElement.width = rect.width;
				canvasElement.height = 200;
			}

			signaturePad = new SignaturePad(canvasElement, {
				backgroundColor: 'rgb(255, 255, 255)',
				penColor: 'rgb(0, 0, 0)'
			});
		}
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
			} else if (preguntaActual.tipo === 'RELACION') {
				if (!respuesta.relacion || respuesta.relacion.length === 0) {
					mostrarToast('Por favor relaciona los elementos', 'error');
					return;
				}
			}
		}

		currentStep++;

		// Si llegamos a la firma, inicializar signature pad
		if (currentStep === totalPreguntas + 1 && evaluacion?.requiere_firma) {
			setTimeout(initSignaturePad, 100);
		}
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

			console.log('Enviando payload:', JSON.stringify(payload, null, 2));

			const response = await fetch(
				`${import.meta.env.VITE_API_URL}/api/evaluaciones/${evaluacionId}/responder`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				}
			);

			const data = await response.json();
			
			console.log('📦 Respuesta del servidor:', data);

			// Manejar error 409 (dispositivo ya respondió)
			if (response.status === 409) {
				mostrarToast(
					data.message || 'Este dispositivo ya ha enviado una respuesta para esta evaluación',
					'error'
				);
				return;
			}

			if (data.success) {
				console.log('✅ Resultado recibido:', data.data);
				console.log('📋 Evaluación en resultado:', data.data.evaluacion);
				console.log('📝 Respuestas en resultado:', data.data.respuestas);
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

	function getTipoNombre(tipo: string): string {
		const nombres: Record<string, string> = {
			OPCION_UNICA: 'Opción Única',
			OPCION_MULTIPLE: 'Opción Múltiple',
			NUMERICA: 'Numérica',
			TEXTO: 'Texto',
			RELACION: 'Relación'
		};
		return nombres[tipo] || tipo;
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

	function calcularPuntajeTotal() {
		if (!evaluacion) return 0;
		return evaluacion.preguntas.reduce((sum, p) => sum + p.puntaje, 0);
	}
</script>

<svelte:head>
	<title>{evaluacion?.titulo || 'Evaluación'} - cotransmeq</title>
</svelte:head>

<!-- Toast Notification -->
{#if showToast}
	<div
		class="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border px-6 py-4 shadow-lg transition-all duration-300"
		class:bg-red-50={toastType === 'error'}
		class:border-red-200={toastType === 'error'}
		class:bg-orange-50={toastType === 'success'}
		class:border-orange-200={toastType === 'success'}
		class:bg-blue-50={toastType === 'info'}
		class:border-blue-200={toastType === 'info'}
		in:fade
		out:fade
	>
		{#if toastType === 'error'}
			<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<span class="font-medium text-red-800">{toastMessage}</span>
		{:else if toastType === 'success'}
			<svg class="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<span class="font-medium text-orange-800">{toastMessage}</span>
		{:else}
			<svg class="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<span class="font-medium text-blue-800">{toastMessage}</span>
		{/if}
	</div>
{/if}

<div class="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50">
	<!-- Header con Logo Cotransmeq -->
	<div class="border-b border-gray-200 bg-white shadow-sm">
		<div class="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<!-- Logo Cotransmeq -->
					<img src="/assets/logo.png" alt="Cotransmeq Logo" class="h-12 w-auto sm:h-14 lg:h-16" />
				</div>
				{#if evaluacion && !showResultado}
					<div class="hidden items-center gap-2 text-sm text-gray-600 sm:flex">
						<svg
							class="h-5 w-5 text-orange-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span class="font-semibold">Paso {currentStep} de {totalPreguntas + 1}</span>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
		{#if isLoading}
			<div class="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
				<div
					class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"
				></div>
				<p class="text-gray-600">Cargando evaluación...</p>
			</div>
		{:else if error}
			<div class="rounded-xl border border-red-200 bg-white p-12 text-center shadow-sm">
				<svg
					class="mx-auto mb-4 h-16 w-16 text-red-500"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<h2 class="mb-2 text-xl font-bold text-gray-900">Error</h2>
				<p class="text-gray-600">{error}</p>
			</div>
		{:else if yaRespondio && miResultado}
			<!-- Mostrar resultado cuando ya respondió -->
			<div class="overflow-hidden rounded-xl border border-orange-200 bg-white shadow-lg" in:fade>
				<!-- Header con colores orange -->
				<div class="bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-8 sm:px-8">
					<div class="flex items-center justify-center gap-4">
						<div class="rounded-full bg-white/20 p-3 backdrop-blur-sm">
							<svg
								class="h-12 w-12 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<div class="text-center">
							<h1 class="text-2xl font-bold text-white sm:text-3xl">
								¡Ya has respondido esta evaluación!
							</h1>
							<p class="mt-2 text-orange-50">
								Este dispositivo ya envió una respuesta anteriormente
							</p>
						</div>
					</div>
				</div>

				<!-- Layout de 2 columnas: Info General (izquierda) y Respuestas (derecha) -->
				<div class="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-3">
					<!-- Columna Izquierda: Información General -->
					<div class="space-y-6 lg:col-span-1">
						<!-- Puntaje destacado -->
						<div
							class="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6"
						>
							<div class="text-center">
								<div
									class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-orange-100"
								>
									<svg
										class="h-8 w-8 text-orange-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
										/>
									</svg>
								</div>
								<p class="mb-2 text-sm font-medium text-orange-700">Tu Puntaje Total</p>
								<p class="mb-2 text-5xl font-bold text-orange-600">{miResultado.puntaje_total}</p>
								<div class="inline-flex items-center gap-2 text-orange-700">
									<div class="h-px flex-1 bg-orange-300"></div>
									<p class="text-sm font-medium">
										de {evaluacion?.preguntas.reduce((sum, p) => sum + p.puntaje, 0)} puntos
									</p>
									<div class="h-px flex-1 bg-orange-300"></div>
								</div>

								<!-- Porcentaje -->
								<div class="mt-4">
									<div class="h-3 w-full overflow-hidden rounded-full bg-orange-100">
										<div
											class="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-1000"
											style="width: {Math.round(
												(miResultado.puntaje_total /
													(evaluacion?.preguntas.reduce((sum, p) => sum + p.puntaje, 0) || 1)) *
													100
											)}%"
										></div>
									</div>
									<p class="mt-2 text-sm font-semibold text-orange-700">
										{Math.round(
											(miResultado.puntaje_total /
												(evaluacion?.preguntas.reduce((sum, p) => sum + p.puntaje, 0) || 1)) *
												100
										)}% de aciertos
									</p>
								</div>
							</div>
						</div>

						<!-- Información Personal -->
						<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
							<div class="bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3">
								<h2 class="flex items-center gap-2 text-lg font-bold text-white">
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
									Información Personal
								</h2>
							</div>
							<div class="space-y-3 p-4">
								<div class="border-b border-gray-100 pb-3">
									<p class="mb-1 text-xs font-medium text-gray-500">Nombre Completo</p>
									<p class="font-semibold text-gray-900">{miResultado.nombre_completo}</p>
								</div>
								<div class="border-b border-gray-100 pb-3">
									<p class="mb-1 text-xs font-medium text-gray-500">Documento</p>
									<p class="font-semibold text-gray-900">{miResultado.numero_documento}</p>
								</div>
								<div class="border-b border-gray-100 pb-3">
									<p class="mb-1 text-xs font-medium text-gray-500">Cargo</p>
									<p class="font-semibold text-gray-900">{miResultado.cargo}</p>
								</div>
								<div class="border-b border-gray-100 pb-3">
									<p class="mb-1 text-xs font-medium text-gray-500">Correo Electrónico</p>
									<p class="text-sm font-semibold break-all text-gray-900">{miResultado.correo}</p>
								</div>
								<div class="pb-1">
									<p class="mb-1 text-xs font-medium text-gray-500">Teléfono</p>
									<p class="font-semibold text-gray-900">{miResultado.telefono}</p>
								</div>
							</div>
						</div>

						<!-- Firma si existe -->
						{#if miResultado.firma}
							<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
								<div class="border-b border-gray-200 bg-gray-50 px-4 py-3">
									<h3 class="flex items-center gap-2 text-sm font-semibold text-gray-700">
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
											/>
										</svg>
										Tu Firma
									</h3>
								</div>
								<div class="bg-gray-50 p-4">
									<img
										src={miResultado.firma}
										alt="Firma"
										class="w-full rounded-lg border border-gray-300 bg-white"
									/>
								</div>
							</div>
						{/if}
					</div>

					<!-- Columna Derecha: Tus Respuestas -->
					<div class="lg:col-span-2">
						<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
							<div class="bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-4">
								<h2 class="flex items-center gap-2 text-xl font-bold text-white">
									<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
										/>
									</svg>
									Tus Respuestas
								</h2>
								<p class="mt-1 text-sm text-orange-50">
									Revisa tus respuestas y calificaciones obtenidas
								</p>
							</div>

							<div class="space-y-4 p-6">
								{#each miResultado.respuestas as respuesta, index}
									{@const pregunta = evaluacion?.preguntas.find(
										(p) => p.id === respuesta.preguntaId
									)}
									{#if pregunta}
										<div
											class="rounded-lg border border-gray-200 bg-gradient-to-r from-white to-gray-50 p-5 transition-shadow hover:shadow-md"
										>
											<!-- Header de la pregunta -->
											<div
												class="mb-4 flex items-start justify-between border-b border-gray-200 pb-3"
											>
												<div class="flex-1">
													<div class="mb-2 flex items-center gap-2">
														<span
															class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700"
														>
															{index + 1}
														</span>
														<span
															class="rounded px-2 py-1 text-xs font-semibold {pregunta.tipo ===
															'TEXTO'
																? 'bg-orange-100 text-orange-700'
																: pregunta.tipo === 'NUMERICA'
																	? 'bg-blue-100 text-blue-700'
																	: pregunta.tipo === 'OPCION_UNICA'
																		? 'bg-purple-100 text-purple-700'
																		: pregunta.tipo === 'OPCION_MULTIPLE'
																			? 'bg-pink-100 text-pink-700'
																			: 'bg-indigo-100 text-indigo-700'}"
														>
															{pregunta.tipo === 'TEXTO'
																? 'Texto'
																: pregunta.tipo === 'NUMERICA'
																	? 'Numérica'
																	: pregunta.tipo === 'OPCION_UNICA'
																		? 'Opción Única'
																		: pregunta.tipo === 'OPCION_MULTIPLE'
																			? 'Opción Múltiple'
																			: 'Relación'}
														</span>
													</div>
													<p class="leading-relaxed font-medium text-gray-900">{pregunta.texto}</p>
												</div>
												<span
													class="ml-4 flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-bold shadow-sm {respuesta.puntaje ===
													pregunta.puntaje
														? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300'
														: respuesta.puntaje > 0
															? 'bg-yellow-100 text-yellow-700 ring-2 ring-yellow-300'
															: 'bg-red-100 text-red-700 ring-2 ring-red-300'}"
												>
													{respuesta.puntaje}/{pregunta.puntaje} pts
												</span>
											</div>

											<!-- Mostrar respuesta según el tipo -->
											{#if pregunta.tipo === 'TEXTO' && respuesta.valor_texto}
												<div
													class="mt-3 rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4"
												>
													<p
														class="mb-2 flex items-center gap-1 text-xs font-semibold text-orange-700"
													>
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
															/>
														</svg>
														Tu respuesta:
													</p>
													<p class="leading-relaxed text-gray-900">{respuesta.valor_texto}</p>
												</div>
											{:else if pregunta.tipo === 'NUMERICA' && respuesta.valor_numero !== null && respuesta.valor_numero !== undefined}
												<div
													class="mt-3 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4"
												>
													<p class="mb-2 text-xs font-semibold text-blue-700">Tu respuesta:</p>
													<p class="text-2xl font-bold text-blue-900">{respuesta.valor_numero}</p>
												</div>
											{:else if (pregunta.tipo === 'OPCION_UNICA' || pregunta.tipo === 'OPCION_MULTIPLE') && respuesta.opcionesIds && respuesta.opcionesIds.length > 0}
												<div class="mt-3 space-y-2">
													<p class="mb-2 text-xs font-semibold text-gray-700">Opciones:</p>
													{#each pregunta.opciones as opcion}
														{@const seleccionada = respuesta.opcionesIds.includes(opcion.id)}
														{@const correcta = opcion.esCorrecta}
														<div
															class="flex items-center gap-3 rounded-lg p-3 transition-all {seleccionada
																? correcta
																	? 'border-2 border-orange-300 bg-gradient-to-r from-orange-50 to-orange-50'
																	: 'border-2 border-red-300 bg-gradient-to-r from-red-50 to-pink-50'
																: correcta
																	? 'border border-gray-300 bg-gray-50'
																	: 'border border-gray-200 bg-white'}"
														>
															{#if seleccionada}
																{#if correcta}
																	<div class="flex-shrink-0">
																		<svg
																			class="h-6 w-6 text-orange-600"
																			fill="currentColor"
																			viewBox="0 0 20 20"
																		>
																			<path
																				fill-rule="evenodd"
																				d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
																				clip-rule="evenodd"
																			/>
																		</svg>
																	</div>
																{:else}
																	<div class="flex-shrink-0">
																		<svg
																			class="h-6 w-6 text-red-600"
																			fill="currentColor"
																			viewBox="0 0 20 20"
																		>
																			<path
																				fill-rule="evenodd"
																				d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
																				clip-rule="evenodd"
																			/>
																		</svg>
																	</div>
																{/if}
															{:else if correcta}
																<div class="flex-shrink-0">
																	<svg
																		class="h-6 w-6 text-gray-400"
																		fill="none"
																		stroke="currentColor"
																		viewBox="0 0 24 24"
																	>
																		<path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			stroke-width="2"
																			d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
																		/>
																	</svg>
																</div>
															{:else}
																<div class="h-6 w-6"></div>
															{/if}
															<div class="flex-1">
																<span
																	class="{seleccionada ? 'font-bold' : 'font-medium'} {correcta &&
																	!seleccionada
																		? 'text-gray-600'
																		: seleccionada && correcta
																			? 'text-orange-900'
																			: seleccionada && !correcta
																				? 'text-red-900'
																				: 'text-gray-700'}"
																>
																	{opcion.texto}
																</span>
																{#if correcta && !seleccionada}
																	<span
																		class="ml-2 rounded bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-500"
																		>Respuesta correcta</span
																	>
																{/if}
															</div>
														</div>
													{/each}
												</div>
											{:else if pregunta.tipo === 'RELACION' && respuesta.relacion}
												<div
													class="mt-3 rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-4"
												>
													<p class="mb-3 text-xs font-semibold text-indigo-700">Tus relaciones:</p>
													<div class="space-y-2">
														{#each respuesta.relacion as rel}
															<div
																class="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm"
															>
																<span
																	class="rounded bg-indigo-100 px-3 py-1 text-sm font-semibold text-indigo-800"
																	>{rel.izq}</span
																>
																<svg
																	class="h-5 w-5 text-indigo-600"
																	fill="none"
																	stroke="currentColor"
																	viewBox="0 0 24 24"
																>
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		stroke-width="2"
																		d="M13 7l5 5m0 0l-5 5m5-5H6"
																	/>
																</svg>
																<span
																	class="rounded bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-800"
																	>{rel.der}</span
																>
															</div>
														{/each}
													</div>
												</div>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						</div>
					</div>
				</div>
			</div>
		{:else if evaluacion && !showResultado}
			<!-- Card de Evaluación -->
			<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg" in:fade>
				<!-- Header de la Evaluación -->
				<div class="bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-6 sm:px-8">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div class="flex-1">
							<h2 class="mb-2 text-2xl font-bold text-white sm:text-3xl">{evaluacion.titulo}</h2>
							{#if evaluacion.descripcion}
								<p class="text-orange-50">{evaluacion.descripcion}</p>
							{/if}
						</div>
						<div class="sm:text-right">
							<div
								class="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 backdrop-blur-sm"
							>
								<span class="text-3xl font-bold text-white">{Math.round(progreso)}%</span>
							</div>
						</div>
					</div>
					<!-- Barra de progreso -->
					<div class="mt-4 h-2 overflow-hidden rounded-full bg-white/30">
						<div
							class="h-full bg-white shadow-lg transition-all duration-500"
							style="width: {progreso}%"
						></div>
					</div>
				</div>

				<!-- Contenido -->
				<div class="p-6 sm:p-8 lg:p-10">
					{#if currentStep === 0}
						<!-- Datos personales -->
						<div in:fly={{ x: 50, duration: 300 }}>
							<div class="mb-8">
								<h3 class="mb-2 text-xl font-bold text-gray-900 sm:text-2xl">
									Información Personal
								</h3>
								<p class="text-gray-600">
									Por favor completa tus datos para comenzar la evaluación
								</p>
							</div>

							<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
								<div class="md:col-span-2">
									<label
										class="mb-2 block flex items-center gap-2 text-sm font-semibold text-gray-700"
									>
										<svg
											class="h-4 w-4 text-orange-600"
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
										Nombre Completo *
									</label>
									<input
										bind:value={nombre_completo}
										type="text"
										class="w-full rounded-lg border-2 px-4 py-3 text-base transition-all outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
										class:border-red-300={errores.nombre_completo}
										class:border-gray-200={!errores.nombre_completo}
										class:bg-red-50={errores.nombre_completo}
										placeholder="Ej: Juan Pérez González"
									/>
									{#if errores.nombre_completo}
										<p class="mt-1.5 flex items-center gap-1 text-sm text-red-600">
											<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
													clip-rule="evenodd"
												/>
											</svg>
											{errores.nombre_completo}
										</p>
									{/if}
								</div>

								<div>
									<label
										class="mb-2 block flex items-center gap-2 text-sm font-semibold text-gray-700"
									>
										<svg
											class="h-4 w-4 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
											/>
										</svg>
										Número de Documento *
									</label>
									<input
										bind:value={numero_documento}
										type="number"
										class="w-full rounded-lg border-2 px-4 py-3 text-base transition-all outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
										class:border-red-300={errores.numero_documento}
										class:border-gray-200={!errores.numero_documento}
										class:bg-red-50={errores.numero_documento}
										placeholder="1234567890"
									/>
									{#if errores.numero_documento}
										<p class="mt-1.5 flex items-center gap-1 text-sm text-red-600">
											<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
													clip-rule="evenodd"
												/>
											</svg>
											{errores.numero_documento}
										</p>
									{/if}
								</div>

								<div>
									<label
										class="mb-2 block flex items-center gap-2 text-sm font-semibold text-gray-700"
									>
										<svg
											class="h-4 w-4 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
											/>
										</svg>
										Cargo *
									</label>
									<input
										bind:value={cargo}
										type="text"
										class="w-full rounded-lg border-2 px-4 py-3 text-base transition-all outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
										class:border-red-300={errores.cargo}
										class:border-gray-200={!errores.cargo}
										class:bg-red-50={errores.cargo}
										placeholder="Conductor"
									/>
									{#if errores.cargo}
										<p class="mt-1.5 flex items-center gap-1 text-sm text-red-600">
											<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
													clip-rule="evenodd"
												/>
											</svg>
											{errores.cargo}
										</p>
									{/if}
								</div>


								<div>
									<label
										class="mb-2 block flex items-center gap-2 text-sm font-semibold text-gray-700"
									>
										<svg
											class="h-4 w-4 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
											/>
										</svg>
										Correo Electrónico *
									</label>
									<input
										bind:value={correo}
										type="email"
										class="w-full rounded-lg border-2 px-4 py-3 text-base transition-all outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
										class:border-red-300={errores.correo}
										class:border-gray-200={!errores.correo}
										class:bg-red-50={errores.correo}
										placeholder="juan.perez@ejemplo.com"
									/>
									{#if errores.correo}
										<p class="mt-1.5 flex items-center gap-1 text-sm text-red-600">
											<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
													clip-rule="evenodd"
												/>
											</svg>
											{errores.correo}
										</p>
									{/if}
								</div>

								<div>
									<label
										class="mb-2 block flex items-center gap-2 text-sm font-semibold text-gray-700"
									>
										<svg
											class="h-4 w-4 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
											/>
										</svg>
										Teléfono *
									</label>
									<input
										bind:value={telefono}
										type="number"
										class="w-full rounded-lg border-2 px-4 py-3 text-base transition-all outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
										class:border-red-300={errores.telefono}
										class:border-gray-200={!errores.telefono}
										class:bg-red-50={errores.telefono}
										placeholder="3001234567"
									/>
									{#if errores.telefono}
										<p class="mt-1.5 flex items-center gap-1 text-sm text-red-600">
											<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
												<path
													fill-rule="evenodd"
													d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
													clip-rule="evenodd"
												/>
											</svg>
											{errores.telefono}
										</p>
									{/if}
								</div>
							</div>
						</div>
					{:else if currentStep <= totalPreguntas}
						<!-- Pregunta actual -->
						{@const pregunta = evaluacion.preguntas[currentStep - 1]}
						{@const respuesta = respuestas.get(pregunta.id)}

						<div in:fly={{ x: 50, duration: 300 }}>
							<div class="mb-6">
								<div class="mb-3 flex items-center gap-2">
									<span class="text-sm font-semibold text-gray-500">Pregunta {currentStep}</span>
									<span
										class="rounded-full px-2 py-1 text-xs font-semibold {getTipoColor(
											pregunta.tipo
										)}"
									>
										{getTipoNombre(pregunta.tipo)}
									</span>
									<span
										class="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800"
									>
										{pregunta.puntaje} pts
									</span>
								</div>
								<h2 class="text-xl font-bold text-gray-900">{pregunta.texto}</h2>
							</div>

							<!-- Opción Única -->
							{#if pregunta.tipo === 'OPCION_UNICA'}
								<div class="space-y-3">
									{#each pregunta.opciones as opcion}
										<button
											on:click={() => handleOpcionUnica(pregunta.id, opcion.id)}
											class="apple-transition w-full rounded-lg border-2 p-4 text-left {respuesta
												?.opcionesIds?.[0] === opcion.id
												? 'border-orange-500 bg-orange-50'
												: 'border-gray-200 bg-white hover:border-orange-300'}"
										>
											<div class="flex items-center gap-3">
												<div
													class="flex h-5 w-5 items-center justify-center rounded-full border-2 {respuesta
														?.opcionesIds?.[0] === opcion.id
														? 'border-orange-500 bg-orange-500'
														: 'border-gray-300'}"
												>
													{#if respuesta?.opcionesIds?.[0] === opcion.id}
														<div class="h-2 w-2 rounded-full bg-white"></div>
													{/if}
												</div>
												<span class="flex-1 font-medium text-gray-900">{opcion.texto}</span>
											</div>
										</button>
									{/each}
								</div>
							{/if}

							<!-- Opción Múltiple -->
							{#if pregunta.tipo === 'OPCION_MULTIPLE'}
								<div class="space-y-3">
									{#each pregunta.opciones as opcion}
										<label
											class="apple-transition flex cursor-pointer items-center gap-3 rounded-lg border-2 p-4 {respuesta?.opcionesIds?.includes(
												opcion.id
											)
												? 'border-orange-500 bg-orange-50'
												: 'border-gray-200 bg-white hover:border-orange-300'}"
										>
											<input
												type="checkbox"
												checked={respuesta?.opcionesIds?.includes(opcion.id)}
												on:change={(e) =>
													handleOpcionMultiple(pregunta.id, opcion.id, e.currentTarget.checked)}
												class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
											/>
											<span class="flex-1 font-medium text-gray-900">{opcion.texto}</span>
										</label>
									{/each}
								</div>
							{/if}

							<!-- Numérica -->
							{#if pregunta.tipo === 'NUMERICA'}
								<div>
									<input
										type="number"
										value={respuesta?.valor_numero ?? ''}
										on:input={(e) => handleNumerica(pregunta.id, Number(e.currentTarget.value))}
										class="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-lg focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
										placeholder="Ingresa un número"
									/>
								</div>
							{/if}

							<!-- Texto -->
							{#if pregunta.tipo === 'TEXTO'}
								<div>
									<textarea
										value={respuesta?.valor_texto ?? ''}
										on:input={(e) => handleTexto(pregunta.id, e.currentTarget.value)}
										class="w-full rounded-lg border-2 border-gray-300 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
										rows="5"
										placeholder="Escribe tu respuesta aquí..."
									></textarea>
								</div>
							{/if}

							<!-- Relación -->
							{#if pregunta.tipo === 'RELACION'}
								{@const _ = initRelacionItems(pregunta)}
								{@const itemsIzq = itemsIzqShuffled.get(pregunta.id) || []}
								{@const itemsDer = itemsDerShuffled.get(pregunta.id) || []}
								{@const relaciones = relacionesSeleccionadas.get(pregunta.id) || new Map()}
								
								<div class="space-y-6">
									<div class="rounded-lg bg-blue-50 border border-blue-200 p-4">
										<div class="flex items-start gap-3">
											<svg class="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
											</svg>
											<div class="flex-1">
												<p class="font-semibold text-blue-900 mb-1">¿Cómo funciona?</p>
												<p class="text-sm text-blue-800">
													Haz clic en un elemento de la <strong>columna izquierda</strong> y luego en su par correspondiente de la <strong>columna derecha</strong> para crear una conexión.
												</p>
											</div>
										</div>
									</div>

									<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
										<!-- Columna Izquierda -->
										<div class="space-y-3">
											<div class="flex items-center gap-2 mb-3">
												<div class="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
													A
												</div>
												<h3 class="font-bold text-gray-900 text-lg">Columna A</h3>
											</div>
											
											<div class="space-y-2">
												{#each itemsIzq as itemIzq (itemIzq.id)}
													{@const isSelected = relaciones.has(itemIzq.id)}
													{@const isPendingSelection = selectedLeftItem === itemIzq.id && !isSelected}
													{@const pairedItemDerId = relaciones.get(itemIzq.id)}
													{@const pairedItem = itemsDer.find(item => item.id === pairedItemDerId)}
													
													<button
														type="button"
														on:click={() => {
															selectedLeftItem = itemIzq.id;
														}}
														class="w-full text-left group relative cursor-pointer transition-all duration-200 {isSelected 
															? 'ring-2 ring-orange-500 ring-offset-2' 
															: isPendingSelection 
																? 'ring-2 ring-blue-500 ring-offset-2 shadow-lg' 
																: 'hover:shadow-md'}"
														animate:flip={{ duration: 300 }}
													>
														<div class="rounded-lg border-2 {isSelected 
															? 'border-orange-500 bg-orange-50' 
															: isPendingSelection
																? 'border-blue-500 bg-blue-100'
																: 'border-blue-200 bg-blue-50 hover:border-blue-400'} p-4">
															<div class="flex items-center justify-between gap-3">
																<div class="flex-1">
																	<p class="font-medium text-gray-900 leading-snug">{itemIzq.texto}</p>
																	{#if isSelected && pairedItem}
																		<div class="mt-2 flex items-center gap-2 text-xs">
																			<svg class="h-3.5 w-3.5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
																			</svg>
																			<span class="text-orange-700 font-medium truncate">{pairedItem.texto}</span>
																		</div>
																	{:else if isPendingSelection}
																		<div class="mt-2 flex items-center gap-2 text-xs">
																			<svg class="h-3.5 w-3.5 text-blue-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
																			</svg>
																			<span class="text-blue-700 font-medium">Selecciona en columna B →</span>
																		</div>
																	{/if}
																</div>
																{#if isSelected}
																	<div class="flex-shrink-0">
																		<div class="h-6 w-6 rounded-full bg-orange-500 flex items-center justify-center">
																			<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
																			</svg>
																		</div>
																	</div>
																{:else if isPendingSelection}
																	<div class="flex-shrink-0">
																		<div class="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center animate-pulse">
																			<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/>
																			</svg>
																		</div>
																	</div>
																{:else}
																	<div class="flex-shrink-0">
																		<div class="h-6 w-6 rounded-full border-2 border-blue-300 group-hover:border-blue-500 transition-colors"></div>
																	</div>
																{/if}
															</div>
														</div>
													</button>
												{/each}
											</div>
										</div>

										<!-- Columna Derecha -->
										<div class="space-y-3 {!selectedLeftItem ? 'opacity-50 pointer-events-none' : ''}">
											<div class="flex items-center gap-2 mb-3">
												<div class="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
													B
												</div>
												<h3 class="font-bold text-gray-900 text-lg">Columna B</h3>
												{#if !selectedLeftItem}
													<div class="ml-auto">
														<div class="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-xs text-blue-700 font-medium">
															<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
															</svg>
															<span>Selecciona Columna A primero</span>
														</div>
													</div>
												{/if}
											</div>
											
											<div class="space-y-2">
												{#each itemsDer as itemDer (itemDer.id)}
													{@const isPaired = Array.from(relaciones.values()).includes(itemDer.id)}
													{@const pairedIzqId = Array.from(relaciones.entries()).find(([, derId]) => derId === itemDer.id)?.[0]}
													{@const pairedItem = itemsIzq.find(item => item.id === pairedIzqId)}
													
													<button
														type="button"
														on:click={() => {
															if (selectedLeftItem) {
																toggleRelacion(pregunta.id, selectedLeftItem, itemDer.id);
															}
														}}
														disabled={!selectedLeftItem && !isPaired}
														class="w-full text-left group transition-all duration-200 {isPaired 
															? 'ring-2 ring-orange-500 ring-offset-2' 
															: selectedLeftItem ? 'hover:shadow-md' : 'cursor-not-allowed'}"
														animate:flip={{ duration: 300 }}
													>
														<div class="rounded-lg border-2 {isPaired 
															? 'border-orange-500 bg-orange-50' 
															: 'border-purple-200 bg-purple-50 hover:border-purple-400'} p-4">
															<div class="flex items-center justify-between gap-3">
																{#if isPaired}
																	<div class="flex-shrink-0">
																		<div class="h-6 w-6 rounded-full bg-orange-500 flex items-center justify-center">
																			<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
																			</svg>
																		</div>
																	</div>
																{:else}
																	<div class="flex-shrink-0">
																		<div class="h-6 w-6 rounded-full border-2 border-purple-300 group-hover:border-purple-500 transition-colors"></div>
																	</div>
																{/if}
																<div class="flex-1">
																	<p class="font-medium text-gray-900 leading-snug">{itemDer.texto}</p>
																	{#if isPaired && pairedItem}
																		<div class="mt-2 flex items-center gap-2 text-xs">
																			<svg class="h-3.5 w-3.5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 17l-5-5m0 0l5-5m-5 5h12"/>
																			</svg>
																			<span class="text-orange-700 font-medium truncate">{pairedItem.texto}</span>
																		</div>
																	{/if}
																</div>
															</div>
														</div>
													</button>
												{/each}
											</div>
										</div>
									</div>

									<!-- Contador de relaciones completadas y botón limpiar -->
									<div class="flex items-center justify-between gap-3 p-4 rounded-lg bg-gray-50 border border-gray-200">
										<div class="flex items-center gap-3">
											<svg class="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
											</svg>
											<span class="text-sm font-semibold text-gray-700">
												Relaciones: <span class="text-orange-600">{relaciones.size}</span> / <span class="text-gray-900">{itemsIzq.length}</span>
											</span>
										</div>
										
										{#if relaciones.size > 0}
											<button
												type="button"
												on:click={() => limpiarRelaciones(pregunta.id)}
												class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 hover:border-red-300 transition-all duration-200 hover:shadow-md"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
												</svg>
												<span>Limpiar todo</span>
											</button>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{:else if currentStep === totalPreguntas + 1 && evaluacion.requiere_firma}
						<!-- Firma -->
						<div in:fly={{ x: 50, duration: 300 }}>
							<h2 class="mb-6 text-xl font-bold text-gray-900">Firma Digital</h2>
							<p class="mb-4 text-gray-600">Por favor firma en el recuadro para finalizar</p>

							<div class="relative mb-4">
								<canvas
									bind:this={canvasElement}
									class="w-full touch-none rounded-lg border-2 border-gray-300 bg-white"
									style="height: 200px;"
								></canvas>
							</div>

							<button
								on:click={clearSignature}
								class="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
							>
								Limpiar Firma
							</button>
						</div>
					{/if}

					<!-- Botones de navegación -->
					<div
						class="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-gray-200 pt-6 sm:flex-row"
					>
						{#if currentStep > 0 && currentStep <= totalPreguntas + 1}
							<button
								on:click={anterior}
								class="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-8 py-3.5 font-semibold text-gray-700 transition-colors hover:bg-gray-200 sm:w-auto"
							>
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 19l-7-7 7-7"
									/>
								</svg>
								Anterior
							</button>
						{:else}
							<div></div>
						{/if}

						{#if currentStep < totalPreguntas}
							<button
								on:click={siguiente}
								class="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-8 py-3.5 font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl sm:w-auto"
							>
								Siguiente
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/>
								</svg>
							</button>
						{:else if currentStep === totalPreguntas && !evaluacion.requiere_firma}
							<button
								on:click={enviarEvaluacion}
								disabled={isSubmitting}
								class="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-8 py-3.5 font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl disabled:opacity-50 sm:w-auto"
							>
								{#if isSubmitting}
									<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									Enviando...
								{:else}
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									Finalizar Evaluación
								{/if}
							</button>
						{:else if currentStep === totalPreguntas}
							<button
								on:click={siguiente}
								class="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-8 py-3.5 font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl sm:w-auto"
							>
								Continuar a Firma
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 5l7 7-7 7"
									/>
								</svg>
							</button>
						{:else if currentStep === totalPreguntas + 1}
							<button
								on:click={enviarEvaluacion}
								disabled={isSubmitting}
								class="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-8 py-3.5 font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl disabled:opacity-50 sm:w-auto"
							>
								{#if isSubmitting}
									<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									Enviando...
								{:else}
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									Finalizar Evaluación
								{/if}
							</button>
						{/if}
					</div>
				</div>
			</div>
		{:else if showResultado && resultado}
			<!-- Resultado -->
			<div
				class="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-lg sm:p-8 lg:p-12"
				in:fade
			>
				<div class="mb-6">
					<div
						class="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-600"
					>
						<svg class="h-12 w-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<h2 class="mb-2 text-3xl font-bold text-gray-900">¡Evaluación Completada!</h2>
					<p class="text-gray-600">Has finalizado exitosamente la evaluación</p>
				</div>

				<div class="mb-8 rounded-2xl bg-gradient-to-r from-orange-50 to-amber-50 p-8">
					<div class="mb-2 text-5xl font-bold text-orange-600">
						{resultado.puntaje_total} / {calcularPuntajeTotal()}
					</div>
					<div class="text-lg font-semibold text-gray-700">Puntaje Obtenido</div>
					{#if resultado.puntaje_total !== undefined}
						{@const porcentaje = (resultado.puntaje_total / calcularPuntajeTotal()) * 100}
						<div class="mt-4">
							<div
								class="text-2xl font-bold {porcentaje >= 70
									? 'text-orange-600'
									: porcentaje >= 50
										? 'text-yellow-600'
										: 'text-red-600'}"
							>
								{porcentaje.toFixed(1)}%
							</div>
						</div>
					{/if}
				</div>

				<div class="rounded-lg bg-white p-6 text-left">
					<h3 class="mb-4 font-bold text-gray-900">Detalle de Respuestas</h3>
					<div class="space-y-2">
						{#each resultado.respuestas as resp, index}
							<div class="flex items-center justify-between rounded-lg bg-gray-50 p-3">
								<span class="text-sm text-gray-700">Pregunta {index + 1}</span>
								<span
									class="rounded-full px-3 py-1 text-sm font-bold {resp.puntaje > 0
										? 'bg-orange-100 text-orange-800'
										: 'bg-red-100 text-red-800'}"
								>
									{resp.puntaje} pts
								</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="mt-8 text-sm text-gray-500">
					<p>Gracias por completar la evaluación</p>
					<p>Los resultados han sido registrados exitosamente</p>
				</div>
			</div>
		{/if}
	</div>
</div>
