<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		asistenciasAPI,
		type FormularioAsistencia,
		type ConfirmacionAsistencia
	} from '$lib/api/asistencias';
	import { getDeviceFingerprint } from '$lib/utils/fingerprint';
	import SignatureCanvas from '$lib/components/asistencias/SignatureCanvas.svelte';
	import SuccessAnimation from '$lib/components/asistencias/SuccessAnimation.svelte';

	let token = '';
	let formulario: FormularioAsistencia | null = null;
	let yaRespondio = false;
	/// Solo nombre y fecha: la verificación pública ya no devuelve documento,
	/// teléfono ni firma (los entregaba sin sesión a quien tuviera el QR).
	let confirmacion: ConfirmacionAsistencia | null = null;
	let deviceFingerprint = '';
	let isLoading = true;
	let isSubmitting = false;
	let showSuccessAnimation = false;

	// Form fields
	let nombreCompleto = '';
	let numeroDocumento = '';
	let cargo = '';
	let numeroTelefono = '';
	let perteneceComite: boolean | undefined = undefined;
	let nombreComite = '';
	let firma = '';

	// Lista de comités
	const comites = [
		'COPASST/ VIGIA SST',
		'COMITÉ CONVIVENCIA LABORAL',
		'COMITÉ SEGURIDAD VIAL',
		'LIDER PESV',
		'ALTA DIRECCIÓN'
	];

	// Errors
	let errors = {
		nombreCompleto: '',
		numeroDocumento: '',
		cargo: '',
		numeroTelefono: '',
		nombreComite: '',
		firma: ''
	};

	onMount(async () => {
		token = $page.params.token ?? '';

		// Obtener fingerprint del dispositivo
		deviceFingerprint = await getDeviceFingerprint();

		// Cargar formulario
		await cargarFormulario();
	});

	async function cargarFormulario() {
		isLoading = true;
		try {
			// Primero verificar si ya respondió (antes de cargar el formulario completo)
			const verificacion = await asistenciasAPI.verificarRespuesta(token, deviceFingerprint);

			yaRespondio = verificacion.respondido;
			confirmacion = verificacion.respondido ? verificacion : null;

			// Obtener formulario
			formulario = await asistenciasAPI.obtenerFormularioPorToken(token);
		} catch (error: any) {
			toast.error(error.message || 'Formulario no encontrado');
		} finally {
			isLoading = false;
		}
	}

	function validateForm(): boolean {
		let isValid = true;

		// Limpiar errores
		errors = {
			nombreCompleto: '',
			numeroDocumento: '',
			cargo: '',
			numeroTelefono: '',
			nombreComite: '',
			firma: ''
		};

		if (!nombreCompleto.trim()) {
			errors.nombreCompleto = 'El nombre completo es requerido';
			isValid = false;
		}

		if (!numeroDocumento.trim()) {
			errors.numeroDocumento = 'El número de documento es requerido';
			isValid = false;
		}

		if (!cargo.trim()) {
			errors.cargo = 'El cargo es requerido';
			isValid = false;
		}

		if (!numeroTelefono.trim()) {
			errors.numeroTelefono = 'El número de teléfono es requerido';
			isValid = false;
		}

		if (perteneceComite === true && !nombreComite.trim()) {
			errors.nombreComite = 'Debe seleccionar el comité al que pertenece';
			isValid = false;
		}

		if (!firma.trim()) {
			errors.firma = 'La firma es requerida';
			isValid = false;
		}

		return isValid;
	}

	async function handleSubmit() {
		if (!validateForm()) {
			toast.error('Por favor completa todos los campos obligatorios');
			return;
		}

		// Validar nuevamente si ya respondió antes de enviar
		if (yaRespondio) {
			toast.error('Ya has enviado una respuesta para este formulario');
			return;
		}

		isSubmitting = true;

		try {
			await asistenciasAPI.enviarRespuesta(token, {
				nombre_completo: nombreCompleto.trim(),
				numero_documento: numeroDocumento.trim(),
				cargo: cargo.trim(),
				numero_telefono: numeroTelefono.trim(),
				pertenece_comite: perteneceComite,
				nombre_comite: perteneceComite === true ? nombreComite.trim() : undefined,
				firma,
				device_fingerprint: deviceFingerprint
			});

			// Mostrar animación de éxito
			showSuccessAnimation = true;

			// Después de 3 segundos, recargar para mostrar estado "ya respondió"
			setTimeout(async () => {
				showSuccessAnimation = false;
				await cargarFormulario();
			}, 3000);
		} catch (error: any) {
			// Si el error es 409 (Conflict), significa que ya respondió
			if (error.message?.includes('Ya has enviado')) {
				toast.error('Ya has enviado una respuesta para este formulario');
				// Recargar para mostrar el estado correcto
				await cargarFormulario();
			} else {
				toast.error(error.message || 'Error al enviar la respuesta');
			}
		} finally {
			isSubmitting = false;
		}
	}

	function formatFecha(fechaISO: string): string {
		const fecha = new Date(fechaISO);
		// Usar UTC para evitar problemas de zona horaria
		const year = fecha.getUTCFullYear();
		const month = fecha.getUTCMonth();
		const day = fecha.getUTCDate();

		// Crear fecha en formato local sin conversión de zona horaria
		const fechaLocal = new Date(year, month, day);

		return fechaLocal.toLocaleDateString('es-CO', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{formulario?.tematica || 'Formulario de Asistencia'} - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-gray-50 to-orange-50/30 p-4 py-12">
	{#if isLoading}
		<!-- Loading -->
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<svg
					class="mx-auto h-12 w-12 animate-spin text-orange-600"
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
				<p class="mt-4 text-gray-600">Cargando formulario...</p>
			</div>
		</div>
	{:else if !formulario}
		<!-- Error -->
		<div class="mx-auto max-w-2xl" in:fade={{ duration: 300 }}>
			<div
				class="glass soft-shadow rounded-2xl border border-gray-200/50 bg-white p-12 text-center"
			>
				<svg
					class="mx-auto h-16 w-16 text-red-500"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
					/>
				</svg>
				<h2 class="mt-4 text-2xl font-bold text-gray-900">Formulario no encontrado</h2>
				<p class="mt-2 text-gray-600">
					El enlace puede estar incorrecto o el formulario ya no está disponible.
				</p>
			</div>
		</div>
	{:else}
		<!-- Formulario -->
		<div in:fade={{ duration: 600 }}>
			<!-- Header con título -->
			<div class="mb-6 text-center">
				<div class="mb-4 flex justify-center">
					<div
						class="soft-shadow flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600"
					>
						<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
				</div>
				<h1 class="text-3xl font-bold text-gray-900">{formulario.tematica}</h1>
			</div>

			<!-- Grid: Información + Formulario -->
			<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<!-- COLUMNA IZQUIERDA: Información del Evento -->
				<div
					class="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50 p-6"
				>
					<h2 class="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
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
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						Información del Evento
					</h2>
					<div class="grid grid-cols-1 gap-4 text-left">
						<!-- Tipo de Evento -->
						{#if formulario.tipo_evento}
							<div class="flex items-start gap-3">
								<div class="flex-shrink-0 rounded-lg bg-purple-100 p-2">
									<svg
										class="h-5 w-5 text-purple-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
										/>
									</svg>
								</div>
								<div>
									<p class="text-xs font-medium text-gray-500 uppercase">Tipo de Evento</p>
									<p class="text-sm font-semibold text-gray-900">
										{#if formulario.tipo_evento === 'capacitacion'}Capacitación
										{:else if formulario.tipo_evento === 'asesoria'}Asesoría
										{:else if formulario.tipo_evento === 'charla'}Charla
										{:else if formulario.tipo_evento === 'induccion'}Inducción
										{:else if formulario.tipo_evento === 'reunion'}Reunión
										{:else if formulario.tipo_evento === 'divulgacion'}Divulgación
										{:else if formulario.tipo_evento === 'otro'}{formulario.tipo_evento_otro ||
												'Otro'}
										{:else}Capacitación
										{/if}
									</p>
								</div>
							</div>
						{/if}

						<!-- Fecha -->
						<div class="flex items-start gap-3">
							<div class="flex-shrink-0 rounded-lg bg-blue-100 p-2">
								<svg
									class="h-5 w-5 text-blue-600"
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
							</div>
							<div>
								<p class="text-xs font-medium text-gray-500 uppercase">Fecha</p>
								<p class="text-sm font-semibold text-gray-900">{formatFecha(formulario.fecha)}</p>
							</div>
						</div>

						<!-- Horario -->
						{#if formulario.hora_inicio || formulario.hora_finalizacion}
							<div class="flex items-start gap-3">
								<div class="flex-shrink-0 rounded-lg bg-amber-100 p-2">
									<svg
										class="h-5 w-5 text-amber-600"
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
								</div>
								<div>
									<p class="text-xs font-medium text-gray-500 uppercase">Horario</p>
									<p class="text-sm font-semibold text-gray-900">
										{formulario.hora_inicio || '--:--'} - {formulario.hora_finalizacion || '--:--'}
									</p>
								</div>
							</div>
						{/if}

						<!-- Duración -->
						{#if formulario.duracion_minutos}
							<div class="flex items-start gap-3">
								<div class="flex-shrink-0 rounded-lg bg-indigo-100 p-2">
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
											d="M13 10V3L4 14h7v7l9-11h-7z"
										/>
									</svg>
								</div>
								<div>
									<p class="text-xs font-medium text-gray-500 uppercase">Duración</p>
									<p class="text-sm font-semibold text-gray-900">
										{#if formulario.duracion_minutos >= 60}
											{Math.floor(formulario.duracion_minutos / 60)}h {formulario.duracion_minutos %
												60}m
										{:else}
											{formulario.duracion_minutos}m
										{/if}
									</p>
								</div>
							</div>
						{/if}

						<!-- Lugar -->
						{#if formulario.lugar_sede}
							<div class="flex items-start gap-3">
								<div class="flex-shrink-0 rounded-lg bg-orange-100 p-2">
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
											d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
										/>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
										/>
									</svg>
								</div>
								<div>
									<p class="text-xs font-medium text-gray-500 uppercase">Lugar / Sede</p>
									<p class="text-sm font-semibold text-gray-900">{formulario.lugar_sede}</p>
								</div>
							</div>
						{/if}

						<!-- Instructor -->
						{#if formulario.nombre_instructor}
							<div class="flex items-start gap-3">
								<div class="flex-shrink-0 rounded-lg bg-rose-100 p-2">
									<svg
										class="h-5 w-5 text-rose-600"
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
								</div>
								<div>
									<p class="text-xs font-medium text-gray-500 uppercase">Instructor</p>
									<p class="text-sm font-semibold text-gray-900">{formulario.nombre_instructor}</p>
								</div>
							</div>
						{/if}
					</div>

					<!-- Objetivo -->
					{#if formulario.objetivo}
						<div class="mt-4 border-t border-gray-200 pt-4">
							<p class="mb-2 text-xs font-medium text-gray-500 uppercase">Objetivo del Evento</p>
							<p class="text-sm leading-relaxed text-gray-700">{formulario.objetivo}</p>
						</div>
					{/if}
				</div>

				<!-- COLUMNA DERECHA: Formulario o Estado "Ya Respondió" -->
				<div>
					{#if yaRespondio && confirmacion}
						<!-- Ya respondió - Mensaje amigable -->
						<div
							class="glass soft-shadow space-y-6 rounded-2xl border border-gray-200/50 bg-white p-8"
							in:fly={{ y: 20, duration: 400 }}
						>
							<!-- Icono de éxito -->
							<div class="text-center">
								<div class="mb-4 flex justify-center">
									<div class="relative">
										<div
											class="absolute inset-0 animate-ping rounded-full bg-orange-400 opacity-20"
										></div>
										<div class="relative rounded-full bg-orange-100 p-6">
											<svg class="h-16 w-16 text-orange-600" fill="none" viewBox="0 0 24 24">
												<path
													stroke="currentColor"
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>
										</div>
									</div>
								</div>
								<h2 class="text-3xl font-bold text-gray-900">¡Gracias por tu participación!</h2>
								<p class="mt-3 text-lg text-gray-600">
									Ya has enviado tu respuesta para este formulario
								</p>
								<div
									class="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-2 text-sm text-orange-700"
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<span>
										Enviado el {new Date(confirmacion.fecha ?? '').toLocaleDateString('es-CO', {
											day: 'numeric',
											month: 'long',
											year: 'numeric',
											hour: '2-digit',
											minute: '2-digit'
										})}
									</span>
								</div>
							</div>

							<!-- Divider -->
							<div class="relative py-4">
								<div class="absolute inset-0 flex items-center">
									<div class="w-full border-t border-gray-200"></div>
								</div>
								<div class="relative flex justify-center text-sm">
									<span class="bg-white px-4 text-gray-500">Firma registrada a nombre de</span>
								</div>
							</div>

							<!-- Solo el nombre: la verificación pública no devuelve más datos -->
							<div class="space-y-4">
								<!-- Nombre -->
								<div
									class="group rounded-xl bg-gradient-to-br from-gray-50 to-gray-100/50 p-5 transition-all hover:shadow-md"
								>
									<div class="flex items-start gap-3">
										<div class="mt-0.5 rounded-lg bg-white p-2 shadow-sm">
											<svg
												class="h-5 w-5 text-gray-600"
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
										</div>
										<div class="flex-1">
											<p class="text-xs font-medium tracking-wider text-gray-500 uppercase">
												Nombre Completo
											</p>
											<p class="mt-1 text-lg font-semibold text-gray-900">
												{confirmacion.nombre}
											</p>
										</div>
									</div>
								</div>
							</div>

							<!-- Mensaje informativo -->
							<div class="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
								<div class="flex gap-3">
									<svg
										class="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<div class="flex-1">
										<h4 class="font-semibold text-blue-900">Respuesta registrada exitosamente</h4>
										<p class="mt-1 text-sm text-blue-700">
											Tu información ha sido guardada correctamente. No es necesario volver a enviar
											el formulario.
										</p>
									</div>
								</div>
							</div>
						</div>
					{:else}
						<!-- Formulario de entrada -->
						<form
							on:submit|preventDefault={handleSubmit}
							class="glass soft-shadow space-y-6 rounded-2xl border border-gray-200/50 bg-white p-8"
							in:fly={{ y: 20, duration: 400 }}
						>
							<!-- Nombre Completo -->
							<div>
								<label for="nombre" class="mb-1 block text-sm font-medium text-gray-700">
									Nombre Completo <span class="text-red-500">*</span>
								</label>
								<input
									id="nombre"
									type="text"
									bind:value={nombreCompleto}
									placeholder="Ej: Juan Pérez González"
									class="input-glow w-full rounded-xl border {errors.nombreCompleto
										? 'border-red-300'
										: 'border-gray-200'} px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
									disabled={isSubmitting}
								/>
								{#if errors.nombreCompleto}
									<p class="mt-1 text-sm text-red-500" transition:fade={{ duration: 200 }}>
										{errors.nombreCompleto}
									</p>
								{/if}
							</div>

							<!-- Documento y Teléfono -->
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label for="documento" class="mb-1 block text-sm font-medium text-gray-700">
										Número de Documento <span class="text-red-500">*</span>
									</label>
									<input
										id="documento"
										type="text"
										bind:value={numeroDocumento}
										placeholder="Ej: 1234567890"
										class="input-glow w-full rounded-xl border {errors.numeroDocumento
											? 'border-red-300'
											: 'border-gray-200'} px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
										disabled={isSubmitting}
									/>
									{#if errors.numeroDocumento}
										<p class="mt-1 text-sm text-red-500" transition:fade={{ duration: 200 }}>
											{errors.numeroDocumento}
										</p>
									{/if}
								</div>

								<div>
									<label for="telefono" class="mb-1 block text-sm font-medium text-gray-700">
										Número de Teléfono <span class="text-red-500">*</span>
									</label>
									<input
										id="telefono"
										type="tel"
										bind:value={numeroTelefono}
										placeholder="Ej: 3001234567"
										class="input-glow w-full rounded-xl border {errors.numeroTelefono
											? 'border-red-300'
											: 'border-gray-200'} px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
										disabled={isSubmitting}
									/>
									{#if errors.numeroTelefono}
										<p class="mt-1 text-sm text-red-500" transition:fade={{ duration: 200 }}>
											{errors.numeroTelefono}
										</p>
									{/if}
								</div>
							</div>

							<!-- Cargo -->
							<div>
								<label for="cargo" class="mb-1 block text-sm font-medium text-gray-700">
									Cargo <span class="text-red-500">*</span>
								</label>
								<input
									id="cargo"
									type="text"
									bind:value={cargo}
									placeholder="Ej: Conductor, Mecánico, Supervisor..."
									class="input-glow w-full rounded-xl border {errors.cargo
										? 'border-red-300'
										: 'border-gray-200'} px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
									disabled={isSubmitting}
								/>
								{#if errors.cargo}
									<p class="mt-1 text-sm text-red-500" transition:fade={{ duration: 200 }}>
										{errors.cargo}
									</p>
								{/if}
							</div>

							<!-- ¿Pertenece a Comité? -->
							<fieldset>
								<legend class="mb-1.5 block text-sm font-medium text-gray-700">
									¿Pertenece a algún comité?
									<span class="font-normal text-gray-400">(opcional)</span>
								</legend>
								<div class="grid grid-cols-2 gap-3">
									<button
										type="button"
										on:click={() => (perteneceComite = true)}
										disabled={isSubmitting}
										class="apple-transition flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium {perteneceComite === true
											? 'border-orange-500 bg-orange-50 text-orange-700'
											: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
										Sí
									</button>
									<button
										type="button"
										on:click={() => (perteneceComite = false)}
										disabled={isSubmitting}
										class="apple-transition flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium {perteneceComite === false
											? 'border-gray-400 bg-gray-100 text-gray-800'
											: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
										No
									</button>
								</div>
							</fieldset>

							<!-- Selección de Comité (solo si perteneceComite es true) -->
							{#if perteneceComite === true}
								<div transition:fly={{ y: -10, duration: 300 }}>
									<label for="comite" class="mb-1 block text-sm font-medium text-gray-700">
										Seleccione el comité <span class="text-red-500">*</span>
									</label>
									<select
										id="comite"
										bind:value={nombreComite}
										class="input-glow w-full rounded-xl border {errors.nombreComite
											? 'border-red-300'
											: 'border-gray-200'} px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
										disabled={isSubmitting}
									>
										<option value="">-- Seleccione un comité --</option>
										{#each comites as comite}
											<option value={comite}>{comite}</option>
										{/each}
									</select>
									{#if errors.nombreComite}
										<p class="mt-1 text-sm text-red-500" transition:fade={{ duration: 200 }}>
											{errors.nombreComite}
										</p>
									{/if}
								</div>
							{/if}

							<!-- Firma -->
							<SignatureCanvas bind:value={firma} error={errors.firma} disabled={isSubmitting} />

							<!-- Submit Button -->
							<div class="pt-4">
								<button
									type="submit"
									class="btn-primary apple-transition flex w-full items-center justify-center gap-3 disabled:cursor-not-allowed"
									disabled={isSubmitting}
								>
									{#if isSubmitting}
										<svg
											class="h-5 w-5 animate-spin"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
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
										<span>Enviando...</span>
									{:else}
										<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
										<span>Enviar Respuesta</span>
									{/if}
								</button>
							</div>
						</form>
					{/if}
				</div>
			</div>

			<!-- Footer -->
			<div class="mt-8 text-center">
				<p class="text-sm text-gray-500">
					Powered by <span class="font-semibold text-orange-600">Cotransmeq</span>
				</p>
			</div>
		</div>
	{/if}
</div>

<!-- Success Animation -->
<SuccessAnimation
	show={showSuccessAnimation}
	message="¡Respuesta enviada exitosamente!"
	subtitle="Gracias por tu participación"
/>
