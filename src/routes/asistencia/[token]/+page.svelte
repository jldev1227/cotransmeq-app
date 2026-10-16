<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
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

<div class="min-h-screen bg-[#F5F7F6] p-4 py-8 font-sans text-[#1A1A1A] antialiased sm:px-6 sm:py-10">
	{#if isLoading}
		<!-- Loading -->
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<svg
					class="mx-auto h-10 w-10 animate-spin text-[#166534]"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle
						class="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						stroke-width="3"
					/>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
				<p class="mt-4 font-mono text-sm text-[#6B6B6B]">Cargando formulario…</p>
			</div>
		</div>
	{:else if !formulario}
		<!-- Error -->
		<div class="mx-auto max-w-2xl" in:fade={{ duration: 300 }}>
			<div class="soft-shadow rounded-3xl border border-black/8 bg-white p-12 text-center">
				<div
					class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(239,68,68,0.06)]"
				>
					<svg
						class="h-8 w-8 text-red-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<h2 class="mt-5 font-display text-2xl font-medium text-[#0F1F1A]">
					Formulario no encontrado
				</h2>
				<p class="mt-2 text-sm text-[#6B6B6B]">
					El enlace puede estar incorrecto o el formulario ya no está disponible.
				</p>
			</div>
		</div>
	{:else}
		<!-- Formulario -->
		<div class="mx-auto w-full max-w-5xl" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
			<!-- Grid: Información + Formulario -->
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-5">
				<!-- COLUMNA IZQUIERDA: Información del Evento (2/5) -->
				<aside class="soft-shadow rounded-3xl border border-black/8 bg-white p-5 sm:p-6 lg:col-span-2">
					<header class="mb-4 border-b border-black/8 pb-4">
						<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
							<img
								src="/assets/logo_nombre.webp"
								alt="Cotransmeq"
								class="h-9 w-auto shrink-0"
								loading="eager"
								decoding="async"
							/>
							<span class="eyebrow shrink-0">Registro de Asistencia</span>
						</div>
						<h1
							class="break-words font-display text-lg font-medium leading-snug tracking-tight text-[#0F1F1A] sm:text-xl"
						>
							{formulario.tematica}
						</h1>
					</header>
					<h2 class="mb-5 flex items-center gap-2 font-display text-lg font-medium text-[#0F1F1A]">
						<svg
							class="h-5 w-5 text-[#166534]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						Información del Evento
					</h2>
					<dl class="space-y-4">
						<!-- Tipo de Evento -->
						{#if formulario.tipo_evento}
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#166534]"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
										/>
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<dt
										class="font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
									>
										Tipo de Evento
									</dt>
									<dd class="mt-0.5 text-sm font-semibold text-[#1A1A1A]">
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
									</dd>
								</div>
							</div>
						{/if}

						<!-- Fecha -->
						<div class="flex items-start gap-3">
							<div
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#166534]"
							>
								<svg
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<dt
									class="font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
								>
									Fecha
								</dt>
								<dd class="mt-0.5 text-sm font-semibold text-[#1A1A1A]">
									{formatFecha(formulario.fecha)}
								</dd>
							</div>
						</div>

						<!-- Horario -->
						{#if formulario.hora_inicio || formulario.hora_finalizacion}
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#166534]"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<dt
										class="font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
									>
										Horario
									</dt>
									<dd class="mt-0.5 font-mono text-sm font-semibold text-[#1A1A1A]">
										{formulario.hora_inicio || '--:--'} – {formulario.hora_finalizacion || '--:--'}
									</dd>
								</div>
							</div>
						{/if}

						<!-- Duración -->
						{#if formulario.duracion_minutos}
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#166534]"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M13 10V3L4 14h7v7l9-11h-7z"
										/>
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<dt
										class="font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
									>
										Duración
									</dt>
									<dd class="mt-0.5 text-sm font-semibold text-[#1A1A1A]">
										{#if formulario.duracion_minutos >= 60}
											{Math.floor(formulario.duracion_minutos / 60)}h {formulario.duracion_minutos %
												60}m
										{:else}
											{formulario.duracion_minutos}m
										{/if}
									</dd>
								</div>
							</div>
						{/if}

						<!-- Lugar -->
						{#if formulario.lugar_sede}
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#166534]"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
										/>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
										/>
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<dt
										class="font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
									>
										Lugar / Sede
									</dt>
									<dd class="mt-0.5 text-sm font-semibold text-[#1A1A1A]">
										{formulario.lugar_sede}
									</dd>
								</div>
							</div>
						{/if}

						<!-- Instructor -->
						{#if formulario.nombre_instructor}
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0fdf4] text-[#166534]"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<dt
										class="font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
									>
										Instructor
									</dt>
									<dd class="mt-0.5 text-sm font-semibold text-[#1A1A1A]">
										{formulario.nombre_instructor}
									</dd>
								</div>
							</div>
						{/if}
					</dl>

					<!-- Objetivo -->
					{#if formulario.objetivo}
						<div class="mt-5 border-t border-black/8 pt-5">
							<p
								class="mb-2 font-mono text-[0.65rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
							>
								Objetivo del Evento
							</p>
							<p class="text-sm leading-relaxed text-[#4A4A4A]">{formulario.objetivo}</p>
						</div>
					{/if}
				</aside>

				<!-- COLUMNA DERECHA: Formulario o Estado "Ya Respondió" (3/5) -->
				<div class="lg:col-span-3">
					{#if yaRespondio && confirmacion}
						<!-- Ya respondió - Card de confirmación estilo landing -->
						<div
							class="soft-shadow rounded-3xl border border-black/8 bg-white p-5 sm:p-8 lg:p-10"
							in:fly={{ y: 20, duration: 500, easing: quintOut }}
						>
							<!-- Icono de éxito circular estilo confirm-icon -->
							<div class="mb-6 flex flex-col items-center text-center">
								<div
									class="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full"
									style="background: linear-gradient(135deg, #22c55e, #166534); box-shadow: 0 8px 24px rgba(22, 101, 52, 0.22);"
								>
									<svg
										class="h-9 w-9 text-white"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2.2"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
									</svg>
								</div>
								<h2
									class="font-display text-[2rem] font-medium text-[#0F1F1A]"
									style="line-height: 1.2"
								>
									¡Gracias por tu participación!
								</h2>
								<p class="mt-3 text-[0.95rem] text-[#4A4A4A]">
									Ya has enviado tu respuesta para este formulario.
								</p>
								<div
									class="mt-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.78rem] font-semibold text-[#166534]"
									style="background: rgba(22, 101, 52, 0.08);"
								>
									<svg
										class="h-3.5 w-3.5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<span class="font-mono">
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

							<!-- Divider con label -->
							<div class="relative my-6 flex items-center">
								<div class="flex-1 border-t border-black/8"></div>
								<span
									class="px-3 font-mono text-[0.7rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
								>
									Firma registrada a nombre de
								</span>
								<div class="flex-1 border-t border-black/8"></div>
							</div>

							<!-- Solo el nombre: la verificación pública no devuelve más datos -->
							<dl
								class="mb-5 space-y-0 rounded-2xl border border-black/6 p-5"
								style="background: #F5F7F6;"
							>
								<div class="flex flex-col">
									<dt
										class="font-mono text-[0.7rem] font-bold tracking-wider text-[#6B6B6B] uppercase"
									>
										Nombre Completo
									</dt>
									<dd class="mt-1 text-[0.95rem] font-medium text-[#0F1F1A]">
										{confirmacion.nombre}
									</dd>
								</div>
							</dl>

							<!-- Mensaje informativo estilo instructivo-hint -->
							<div
								class="rounded-2xl p-4"
								style="background: linear-gradient(135deg, rgba(22, 101, 52, 0.04), rgba(22, 101, 52, 0.08)); border: 1px solid rgba(22, 101, 52, 0.15);"
							>
								<div class="flex gap-3">
									<svg
										class="mt-0.5 h-5 w-5 shrink-0 text-[#166534]"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<div>
										<span
											class="mb-1.5 inline-block font-mono text-[0.6rem] font-bold tracking-wider text-[#166534] uppercase"
											style="background: white; padding: 0.15rem 0.5rem; border-radius: 4px;"
										>
											Información
										</span>
										<p class="mt-1 text-[0.85rem] leading-relaxed text-[#166534]">
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
							class="soft-shadow space-y-5 rounded-3xl border border-black/8 bg-white p-5 sm:p-8 lg:p-10"
							in:fly={{ y: 20, duration: 500, easing: quintOut }}
						>
							<!-- Header del formulario -->
							<div class="mb-2">
								<span class="eyebrow">Tu Información</span>
								<h3 class="mt-2 font-display text-xl font-medium text-[#0F1F1A]">
									Completa el registro
								</h3>
							</div>

							<!-- Nombre Completo -->
							<div>
								<label
									for="nombre"
									class="mb-1.5 block text-[0.78rem] font-semibold text-[#0F1F1A]"
								>
									Nombre Completo <span class="text-red-500">*</span>
								</label>
								<input
									id="nombre"
									type="text"
									bind:value={nombreCompleto}
									placeholder="Ej: Juan Pérez González"
									class="input-glow apple-transition w-full rounded-xl border px-3.5 py-2.5 text-sm text-[#0F1F1A] placeholder-[#9A9A9A] focus:outline-none {errors.nombreCompleto
										? 'border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.03)]'
										: 'border-black/12 bg-white'}"
									disabled={isSubmitting}
								/>
								{#if errors.nombreCompleto}
									<p class="mt-1 text-[0.72rem] text-[#B91C1C]" transition:fade={{ duration: 200 }}>
										{errors.nombreCompleto}
									</p>
								{/if}
							</div>

							<!-- Documento y Teléfono -->
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label
										for="documento"
										class="mb-1.5 block text-[0.78rem] font-semibold text-[#0F1F1A]"
									>
										Número de Documento <span class="text-red-500">*</span>
									</label>
									<input
										id="documento"
										type="text"
										bind:value={numeroDocumento}
										placeholder="Ej: 1234567890"
										class="input-glow apple-transition w-full rounded-xl border px-3.5 py-2.5 text-sm text-[#0F1F1A] placeholder-[#9A9A9A] focus:outline-none {errors.numeroDocumento
											? 'border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.03)]'
											: 'border-black/12 bg-white'}"
										disabled={isSubmitting}
									/>
									{#if errors.numeroDocumento}
										<p
											class="mt-1 text-[0.72rem] text-[#B91C1C]"
											transition:fade={{ duration: 200 }}
										>
											{errors.numeroDocumento}
										</p>
									{/if}
								</div>

								<div>
									<label
										for="telefono"
										class="mb-1.5 block text-[0.78rem] font-semibold text-[#0F1F1A]"
									>
										Número de Teléfono <span class="text-red-500">*</span>
									</label>
									<input
										id="telefono"
										type="tel"
										bind:value={numeroTelefono}
										placeholder="Ej: 3001234567"
										class="input-glow apple-transition w-full rounded-xl border px-3.5 py-2.5 text-sm text-[#0F1F1A] placeholder-[#9A9A9A] focus:outline-none {errors.numeroTelefono
											? 'border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.03)]'
											: 'border-black/12 bg-white'}"
										disabled={isSubmitting}
									/>
									{#if errors.numeroTelefono}
										<p
											class="mt-1 text-[0.72rem] text-[#B91C1C]"
											transition:fade={{ duration: 200 }}
										>
											{errors.numeroTelefono}
										</p>
									{/if}
								</div>
							</div>

							<!-- Cargo -->
							<div>
								<label for="cargo" class="mb-1.5 block text-[0.78rem] font-semibold text-[#0F1F1A]">
									Cargo <span class="text-red-500">*</span>
								</label>
								<input
									id="cargo"
									type="text"
									bind:value={cargo}
									placeholder="Ej: Conductor, Mecánico, Supervisor…"
									class="input-glow apple-transition w-full rounded-xl border px-3.5 py-2.5 text-sm text-[#0F1F1A] placeholder-[#9A9A9A] focus:outline-none {errors.cargo
										? 'border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.03)]'
										: 'border-black/12 bg-white'}"
									disabled={isSubmitting}
								/>
								{#if errors.cargo}
									<p class="mt-1 text-[0.72rem] text-[#B91C1C]" transition:fade={{ duration: 200 }}>
										{errors.cargo}
									</p>
								{/if}
							</div>

							<!-- ¿Pertenece a Comité? -->
							<fieldset>
								<legend class="mb-2 block text-[0.78rem] font-semibold text-[#0F1F1A]">
									¿Pertenece a algún comité?
									<span class="ml-1 font-normal text-[#9A9A9A]">(opcional)</span>
								</legend>
								<div class="flex gap-2">
									<button
										type="button"
										on:click={() => (perteneceComite = true)}
										disabled={isSubmitting}
										class="apple-transition flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold {perteneceComite ===
										true
											? 'border-[#166534] bg-[#f0fdf4] text-[#166534]'
											: 'border-black/12 bg-white text-[#4A4A4A] hover:border-black/20'}"
									>
										<svg
											class="h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
										Sí
									</button>
									<button
										type="button"
										on:click={() => (perteneceComite = false)}
										disabled={isSubmitting}
										class="apple-transition flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold {perteneceComite ===
										false
											? 'border-black/30 bg-black/5 text-[#1A1A1A]'
											: 'border-black/12 bg-white text-[#4A4A4A] hover:border-black/20'}"
									>
										<svg
											class="h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M6 18L18 6M6 6l12 12"
											/>
										</svg>
										No
									</button>
								</div>
							</fieldset>

							<!-- Selección de Comité (solo si perteneceComite es true) -->
							{#if perteneceComite === true}
								<div transition:fly={{ y: -10, duration: 300 }}>
									<label
										for="comite"
										class="mb-1.5 block text-[0.78rem] font-semibold text-[#0F1F1A]"
									>
										Seleccione el comité <span class="text-red-500">*</span>
									</label>
									<select
										id="comite"
										bind:value={nombreComite}
										class="input-glow apple-transition w-full rounded-xl border px-3.5 py-2.5 text-sm text-[#0F1F1A] focus:outline-none {errors.nombreComite
											? 'border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.03)]'
											: 'border-black/12 bg-white'}"
										disabled={isSubmitting}
									>
										<option value="">-- Seleccione un comité --</option>
										{#each comites as comite}
											<option value={comite}>{comite}</option>
										{/each}
									</select>
									{#if errors.nombreComite}
										<p
											class="mt-1 text-[0.72rem] text-[#B91C1C]"
											transition:fade={{ duration: 200 }}
										>
											{errors.nombreComite}
										</p>
									{/if}
								</div>
							{/if}

							<!-- Firma -->
							<SignatureCanvas bind:value={firma} error={errors.firma} disabled={isSubmitting} />

							<!-- Submit: botón primario global (estilo app) -->
							<div class="pt-2">
								<button type="submit" class="btn-primary w-full" disabled={isSubmitting}>
									{#if isSubmitting}
										<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
											<circle
												class="opacity-25"
												cx="12"
												cy="12"
												r="10"
												stroke="currentColor"
												stroke-width="3"
											/>
											<path
												class="opacity-75"
												fill="currentColor"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
											/>
										</svg>
										<span>Enviando…</span>
									{:else}
										<svg
											class="h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
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
			<footer class="mt-10 text-center">
				<p class="font-mono text-[0.7rem] tracking-wider text-[#9A9A9A] uppercase">
					Powered by <span class="font-bold text-[#166534]">Cotransmeq</span>
				</p>
			</footer>
		</div>
	{/if}
</div>

<!-- Success Animation -->
<SuccessAnimation
	show={showSuccessAnimation}
	message="¡Respuesta enviada exitosamente!"
	subtitle="Gracias por tu participación"
/>
