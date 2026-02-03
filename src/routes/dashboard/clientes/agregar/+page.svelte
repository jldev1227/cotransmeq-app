<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly, scale, fade } from 'svelte/transition';
	import { quintOut, elasticOut } from 'svelte/easing';
	import { clientesAPI } from '$lib/api/apiClient';

	// Enum para TipoCliente
	const TipoCliente = {
		EMPRESA: 'EMPRESA',
		PERSONA_NATURAL: 'PERSONA_NATURAL'
	} as const;

	type TipoClienteType = (typeof TipoCliente)[keyof typeof TipoCliente];

	// Estado del formulario
	let formData = {
		tipo: TipoCliente.EMPRESA as TipoClienteType,
		nit: '',
		nombre: '',
		representante: '',
		cedula: '',
		telefono: '',
		direccion: '',
		correo: '',
		requiere_osi: false,
		paga_recargos: false
	};

	let isSubmitting = false;
	let errors: Record<string, string> = {};
	let successMessage = '';

	// Función para validar el formulario
	function validateForm() {
		errors = {};

		if (!formData.nombre.trim()) {
			errors.nombre = 'El nombre es requerido';
		}

		if (!formData.nit.trim()) {
			errors.nit = 'El NIT/CC es requerido';
		}

		if (!formData.telefono.trim()) {
			errors.telefono = 'El teléfono es requerido';
		}

		if (!formData.direccion.trim()) {
			errors.direccion = 'La dirección es requerida';
		}

		if (formData.tipo === TipoCliente.EMPRESA && !formData.representante.trim()) {
			errors.representante = 'El representante es requerido para empresas';
		}

		if (formData.tipo === TipoCliente.PERSONA_NATURAL && !formData.cedula.trim()) {
			errors.cedula = 'La cédula es requerida para personas naturales';
		}

		return Object.keys(errors).length === 0;
	}

	// Función para enviar el formulario
	async function handleSubmit() {
		if (!validateForm()) return;

		isSubmitting = true;
		errors = {};
		successMessage = '';

		try {
			// Preparar los datos según el tipo de cliente
			const clienteData = {
				...formData,
				representante: formData.tipo === TipoCliente.EMPRESA ? formData.representante : null,
				cedula: formData.tipo === TipoCliente.PERSONA_NATURAL ? formData.cedula : null,
				correo: formData.correo.trim() || null
			};

			console.log('📤 Enviando nuevo cliente:', clienteData);

			const response = await clientesAPI.create(clienteData);

			console.log('✅ Cliente creado exitosamente:', response.data);

			successMessage = 'Cliente creado exitosamente';

			// Resetear formulario
			formData = {
				tipo: TipoCliente.EMPRESA as TipoClienteType,
				nit: '',
				nombre: '',
				representante: '',
				cedula: '',
				telefono: '',
				direccion: '',
				correo: '',
				requiere_osi: false,
				paga_recargos: false
			};

			// Redirigir a la lista de clientes después de un breve delay
			setTimeout(() => {
				goto('/dashboard/clientes');
			}, 2000);
		} catch (error: any) {
			console.error('❌ Error creando cliente:', error);

			// Manejar errores de validación del servidor
			if (error.response?.status === 400 && error.response?.data?.errors) {
				errors = error.response.data.errors;
			} else {
				errors.general = error.response?.data?.message || 'Error al crear el cliente';
			}
		} finally {
			isSubmitting = false;
		}
	}

	// Función para regresar a la lista
	function goBack() {
		goto('/dashboard/clientes');
	}
</script>

<svelte:head>
	<title>Agregar Cliente - Dashboard</title>
</svelte:head>

<!-- Container principal -->
<div class="min-h-screen bg-gray-50 p-4 md:p-8">
	<div class="mx-auto max-w-6xl">
		<!-- Header de la página -->
		<div class="mb-8" in:fly={{ y: -20, duration: 500 }}>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<button
						on:click={goBack}
						class="apple-transition flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-100 hover:text-gray-700"
						aria-label="Volver a clientes"
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

					<div class="flex items-center gap-3">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg"
						>
							<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
								/>
							</svg>
						</div>
						<div>
							<h1
								class="bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-3xl font-bold text-transparent"
							>
								Agregar Cliente
							</h1>
							<p class="text-gray-600">Completa la información del nuevo cliente</p>
						</div>
					</div>
				</div>

				<!-- Breadcrumb -->
				<nav class="hidden items-center space-x-2 text-sm text-gray-500 md:flex">
					<a href="/dashboard" class="transition-colors hover:text-orange-600">Dashboard</a>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5l7 7-7 7"
						/>
					</svg>
					<a href="/dashboard/clientes" class="transition-colors hover:text-orange-600">Clientes</a
					>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5l7 7-7 7"
						/>
					</svg>
					<span class="font-medium text-orange-600">Agregar</span>
				</nav>
			</div>
		</div>

		<!-- Mensaje de éxito -->
		{#if successMessage}
			<div
				class="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4"
				in:fly={{ y: -10, duration: 300 }}
			>
				<div class="flex items-center gap-2">
					<svg
						class="h-5 w-5 text-orange-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5 13l4 4L19 7"
						/>
					</svg>
					<p class="text-sm font-medium text-orange-700">{successMessage}. Redirigiendo...</p>
				</div>
			</div>
		{/if}

		<!-- Card principal del formulario -->
		<div
			class="rounded-xl border border-gray-200 bg-white shadow-lg"
			in:scale={{ duration: 800, easing: elasticOut, start: 0.9 }}
		>
			<!-- Contenido del formulario -->
			<div class="p-6 md:p-8">
				<!-- Formulario -->
				<form on:submit|preventDefault={handleSubmit} class="space-y-6">
					<!-- Error general -->
					{#if errors.general}
						<div
							class="rounded-xl border border-red-200 bg-red-50 p-4"
							in:fly={{ y: -10, duration: 300 }}
						>
							<div class="flex items-center gap-2">
								<svg
									class="h-5 w-5 text-red-500"
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
								<p class="text-sm font-medium text-red-700">{errors.general}</p>
							</div>
						</div>
					{/if}

					<!-- Tipo de Cliente -->
					<div
						class="rounded-xl border border-gray-200 bg-gray-50 p-6"
						in:fly={{ y: 20, duration: 500, delay: 100 }}
					>
						<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
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
									d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
								/>
							</svg>
							Tipo de Cliente
						</h3>

						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<label class="relative cursor-pointer">
								<input
									type="radio"
									bind:group={formData.tipo}
									value={TipoCliente.EMPRESA}
									class="peer sr-only"
								/>
								<div
									class="apple-transition rounded-xl border-2 border-gray-200 bg-white p-4 peer-checked:border-orange-500 peer-checked:bg-orange-50 hover:bg-gray-50"
								>
									<div class="flex items-center gap-3">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600"
										>
											<svg
												class="h-4 w-4 text-white"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="1.5"
													d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
												/>
											</svg>
										</div>
										<div>
											<p class="font-medium text-gray-900">Empresa</p>
											<p class="text-xs text-gray-600">Persona jurídica</p>
										</div>
									</div>
								</div>
							</label>

							<label class="relative cursor-pointer">
								<input
									type="radio"
									bind:group={formData.tipo}
									value={TipoCliente.PERSONA_NATURAL}
									class="peer sr-only"
								/>
								<div
									class="apple-transition rounded-xl border-2 border-gray-200 bg-white p-4 peer-checked:border-orange-500 peer-checked:bg-orange-50 hover:bg-gray-50"
								>
									<div class="flex items-center gap-3">
										<div
											class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600"
										>
											<svg
												class="h-4 w-4 text-white"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="1.5"
													d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
												/>
											</svg>
										</div>
										<div>
											<p class="font-medium text-gray-900">Persona Natural</p>
											<p class="text-xs text-gray-600">Persona física</p>
										</div>
									</div>
								</div>
							</label>
						</div>
					</div>

					<!-- Grid de dos columnas para el resto del formulario -->
					<div
						class="grid grid-cols-1 items-start gap-6 rounded-xl border border-gray-200 bg-white shadow-sm lg:grid-cols-2"
					>
						<!-- Columna izquierda: Información básica -->
						<div class="space-y-6" in:fly={{ x: -20, duration: 500, delay: 200 }}>
							<!-- Información Básica -->
							<div class="h-full p-6">
								<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
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
									Información Básica
								</h3>

								<div class="space-y-4">
									<!-- Nombre -->
									<div>
										<label for="nombre" class="mb-2 block text-sm font-medium text-gray-700">
											{formData.tipo === TipoCliente.EMPRESA ? 'Razón Social' : 'Nombre Completo'} *
										</label>
										<input
											id="nombre"
											type="text"
											bind:value={formData.nombre}
											class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
											placeholder={formData.tipo === TipoCliente.EMPRESA
												? 'Ej: Transportes ABC S.A.S.'
												: 'Ej: Juan Pérez García'}
											class:border-red-300={errors.nombre}
										/>
										{#if errors.nombre}
											<p class="mt-1 text-sm text-red-600">{errors.nombre}</p>
										{/if}
									</div>

									<!-- NIT/CC -->
									<div>
										<label for="nit" class="mb-2 block text-sm font-medium text-gray-700">
											{formData.tipo === TipoCliente.EMPRESA ? 'NIT' : 'Cédula'} *
										</label>
										<input
											id="nit"
											type="text"
											bind:value={formData.nit}
											class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
											placeholder={formData.tipo === TipoCliente.EMPRESA
												? 'Ej: 900.123.456-1'
												: 'Ej: 12.345.678'}
											class:border-red-300={errors.nit}
										/>
										{#if errors.nit}
											<p class="mt-1 text-sm text-red-600">{errors.nit}</p>
										{/if}
									</div>

									<!-- Representante (solo para empresas) -->
									{#if formData.tipo === TipoCliente.EMPRESA}
										<div in:fly={{ y: 10, duration: 300 }}>
											<label
												for="representante"
												class="mb-2 block text-sm font-medium text-gray-700"
											>
												Representante Legal *
											</label>
											<input
												id="representante"
												type="text"
												bind:value={formData.representante}
												class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
												placeholder="Ej: María García López"
												class:border-red-300={errors.representante}
											/>
											{#if errors.representante}
												<p class="mt-1 text-sm text-red-600">{errors.representante}</p>
											{/if}
										</div>
									{/if}

									<!-- Cédula del representante (solo para personas naturales) -->
									{#if formData.tipo === TipoCliente.PERSONA_NATURAL}
										<div in:fly={{ y: 10, duration: 300 }}>
											<label for="cedula" class="mb-2 block text-sm font-medium text-gray-700">
												Número de Cédula *
											</label>
											<input
												id="cedula"
												type="text"
												bind:value={formData.cedula}
												class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
												placeholder="Ej: 12.345.678"
												class:border-red-300={errors.cedula}
											/>
											{#if errors.cedula}
												<p class="mt-1 text-sm text-red-600">{errors.cedula}</p>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						</div>

						<!-- Columna derecha: Contacto -->
						<div
							class="space-y-6 border-l border-gray-200"
							in:fly={{ x: 20, duration: 500, delay: 300 }}
						>
							<!-- Información de Contacto -->
							<div class="h-full rounded-xl p-6">
								<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
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
											d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
										/>
									</svg>
									Información de Contacto
								</h3>

								<div class="space-y-4">
									<!-- Teléfono -->
									<div>
										<label for="telefono" class="mb-2 block text-sm font-medium text-gray-700">
											Teléfono *
										</label>
										<input
											id="telefono"
											type="tel"
											bind:value={formData.telefono}
											class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
											placeholder="Ej: 312 345 6789"
											class:border-red-300={errors.telefono}
										/>
										{#if errors.telefono}
											<p class="mt-1 text-sm text-red-600">{errors.telefono}</p>
										{/if}
									</div>

									<!-- Correo -->
									<div>
										<label for="correo" class="mb-2 block text-sm font-medium text-gray-700">
											Correo Electrónico
										</label>
										<input
											id="correo"
											type="email"
											bind:value={formData.correo}
											class="apple-transition w-full rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
											placeholder="Ej: cliente@ejemplo.com"
											class:border-red-300={errors.correo}
										/>
										{#if errors.correo}
											<p class="mt-1 text-sm text-red-600">{errors.correo}</p>
										{/if}
									</div>

									<!-- Dirección -->
									<div>
										<label for="direccion" class="mb-2 block text-sm font-medium text-gray-700">
											Dirección *
										</label>
										<textarea
											id="direccion"
											bind:value={formData.direccion}
											rows="3"
											class="apple-transition w-full resize-none rounded-lg border border-gray-200/50 bg-white/50 px-4 py-3 backdrop-blur-sm focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-500"
											placeholder="Ej: Calle 123 #45-67, Barrio Centro"
											class:border-red-300={errors.direccion}
										></textarea>
										{#if errors.direccion}
											<p class="mt-1 text-sm text-red-600">{errors.direccion}</p>
										{/if}
									</div>
								</div>
							</div>
						</div>
					</div>

					<!-- Servicios Adicionales - Sección separada -->
					<div
						class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
						in:fly={{ y: 20, duration: 500, delay: 400 }}
					>
						<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
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
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/>
							</svg>
							Servicios Adicionales
						</h3>

						<div class="flex gap-4">
							<!-- Requiere OSI -->
							<label class="group relative cursor-pointer">
								<input type="checkbox" bind:checked={formData.requiere_osi} class="peer sr-only" />
								<div
									class="relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-4 transition-all duration-300 ease-in-out
											group-active:scale-[0.98] peer-checked:scale-[1.02] peer-checked:border-orange-500 peer-checked:bg-orange-50
											peer-checked:shadow-lg hover:scale-[1.02] hover:border-orange-300 hover:bg-orange-50/30
											hover:shadow-md"
								>
									<!-- Indicador de selección -->
									<div
										class="absolute top-2 right-2 transform transition-all duration-300 ease-in-out
												{formData.requiere_osi ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}"
									>
										<div
											class="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-white"
										>
											<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="3"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</div>
									</div>

									<div class="flex items-center gap-3 pr-8">
										<div
											class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg transition-all duration-300
													{formData.requiere_osi ? 'scale-110 shadow-orange-200' : 'shadow-gray-200'}"
										>
											<svg
												class="h-5 w-5 text-white transition-transform duration-300 {formData.requiere_osi
													? 'scale-110'
													: ''}"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
												/>
											</svg>
										</div>
										<div class="flex-1">
											<p
												class="font-semibold text-gray-900 transition-colors duration-300 {formData.requiere_osi
													? 'text-orange-900'
													: ''}"
											>
												Requiere OSI
											</p>
											<p
												class="text-sm text-gray-600 transition-colors duration-300 {formData.requiere_osi
													? 'text-orange-700'
													: ''}"
											>
												Servicio especializado de seguridad
											</p>
										</div>
									</div>

									<!-- Efecto de brillo al seleccionar -->
									<div
										class="absolute inset-0 bg-gradient-to-r from-orange-400/0 via-orange-400/20 to-orange-400/0 transition-opacity duration-500
												{formData.requiere_osi ? 'animate-pulse opacity-100' : 'opacity-0'}"
									></div>
								</div>
							</label>

							<!-- Paga Recargos -->
							<label class="group relative cursor-pointer">
								<input type="checkbox" bind:checked={formData.paga_recargos} class="peer sr-only" />
								<div
									class="relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-4 transition-all duration-300 ease-in-out
											group-active:scale-[0.98] peer-checked:scale-[1.02] peer-checked:border-purple-500 peer-checked:bg-purple-50
											peer-checked:shadow-lg hover:scale-[1.02] hover:border-purple-300 hover:bg-purple-50/30
											hover:shadow-md"
								>
									<!-- Indicador de selección -->
									<div
										class="absolute top-2 right-2 transform transition-all duration-300 ease-in-out
												{formData.paga_recargos ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}"
									>
										<div
											class="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500 text-white"
										>
											<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="3"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</div>
									</div>

									<div class="flex items-center gap-3 pr-8">
										<div
											class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 shadow-lg transition-all duration-300
													{formData.paga_recargos ? 'scale-110 shadow-purple-200' : 'shadow-gray-200'}"
										>
											<svg
												class="h-5 w-5 text-white transition-transform duration-300 {formData.paga_recargos
													? 'scale-110'
													: ''}"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
												/>
											</svg>
										</div>
										<div class="flex-1">
											<p
												class="font-semibold text-gray-900 transition-colors duration-300 {formData.paga_recargos
													? 'text-purple-900'
													: ''}"
											>
												Paga Recargos
											</p>
											<p
												class="text-sm text-gray-600 transition-colors duration-300 {formData.paga_recargos
													? 'text-purple-700'
													: ''}"
											>
												Tarifas adicionales por servicios extra
											</p>
										</div>
									</div>

									<!-- Efecto de brillo al seleccionar -->
									<div
										class="absolute inset-0 bg-gradient-to-r from-purple-400/0 via-purple-400/20 to-purple-400/0 transition-opacity duration-500
												{formData.paga_recargos ? 'animate-pulse opacity-100' : 'opacity-0'}"
									></div>
								</div>
							</label>
						</div>
					</div>

					<!-- Botones de acción -->
					<div
						class="flex flex-col gap-4 pt-6 sm:flex-row"
						in:fly={{ y: 20, duration: 500, delay: 400 }}
					>
						<button
							type="button"
							on:click={goBack}
							class="apple-transition order-2 cursor-pointer rounded-xl border border-gray-200/50 bg-white/50 px-6 py-3 font-medium text-gray-700 backdrop-blur-sm hover:bg-white hover:shadow-md sm:order-1"
							disabled={isSubmitting}
						>
							Cancelar
						</button>

						<button
							type="submit"
							class="apple-transition order-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-8 py-3 font-semibold text-white shadow-lg hover:scale-105 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
							disabled={isSubmitting}
						>
							{#if isSubmitting}
								<svg
									class="h-5 w-5 animate-spin"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
								Guardando Cliente...
							{:else}
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
								Guardar Cliente
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	</div>
</div>

<style>
	/* Clases utilitarias personalizadas */
	.apple-transition {
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
</style>
