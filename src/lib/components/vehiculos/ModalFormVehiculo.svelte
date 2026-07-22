<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { flotaStore } from '$lib/stores/flota';

	export let isOpen = false;
	export let vehiculoId: string | null = null;

	const dispatch = createEventDispatcher();

	let isSubmitting = false;
	let error: string | null = null;
	let fieldErrors: { [key: string]: string } = {};
	let showSuccessAnimation = false;
	let successMessage = '';

	// Form data
	let formData = {
		placa: '',
		marca: '',
		modelo: '',
		ano: new Date().getFullYear(),
		clase_vehiculo: '',
		capacidad_pasajeros: 1,
		estado: 'DISPONIBLE'
	};

	const claseVehiculoOptions = [
		'automovil',
		'camioneta',
		'van',
		'bus',
		'camion',
		'motocicleta',
		'otro'
	];

	const estadoOptions = [
		{ value: 'DISPONIBLE', label: 'Disponible' },
		{ value: 'disponible', label: 'Disponible' },
		{ value: 'SERVICIO', label: 'En Servicio' },
		{ value: 'servicio', label: 'En Servicio' },
		{ value: 'MANTENIMIENTO', label: 'Mantenimiento' },
		{ value: 'mantenimiento', label: 'Mantenimiento' },
		{ value: 'INACTIVO', label: 'Inactivo' },
		{ value: 'inactivo', label: 'Inactivo' },
		{ value: 'NO_DISPONIBLE', label: 'No Disponible' },
		{ value: 'no_disponible', label: 'No Disponible' },
		{ value: 'DESVINCULADO', label: 'Desvinculado' },
		{ value: 'desvinculado', label: 'Desvinculado' }
	];

	const handleClose = () => {
		if (isSubmitting) return;
		isOpen = false;
		resetForm();
		dispatch('close');
	};

	const resetForm = () => {
		formData = {
			placa: '',
			marca: '',
			modelo: '',
			ano: new Date().getFullYear(),
			clase_vehiculo: '',
			capacidad_pasajeros: 1,
			estado: 'DISPONIBLE'
		};
		error = null;
		fieldErrors = {};
		showSuccessAnimation = false;
		successMessage = '';
	};

	const parseBackendError = (err: any): string => {
		// Si es un error de validación de Zod del backend
		if (err.response?.data?.errors) {
			const errors = err.response.data.errors;

			// Mapear errores de campos específicos a mensajes amigables
			if (errors.estado) {
				return 'El estado seleccionado no es válido. Por favor, seleccione un estado de la lista.';
			}

			if (errors.capacidad_pasajeros) {
				return 'La capacidad de pasajeros debe ser al menos 1 persona.';
			}

			if (errors.placa) {
				return 'La placa debe tener al menos 6 caracteres.';
			}

			if (errors.marca) {
				return 'La marca debe tener al menos 2 caracteres.';
			}

			if (errors.clase_vehiculo) {
				return 'La clase de vehículo es requerida.';
			}

			// Si hay múltiples errores, mostrar el primero
			const firstError = Object.values(errors)[0];
			if (typeof firstError === 'string') {
				return firstError;
			}

			return 'Por favor, corrija los errores en el formulario.';
		}

		// Si es un mensaje directo del backend
		if (err.response?.data?.message) {
			const message = err.response.data.message;

			// Traducir mensajes comunes del backend
			if (message.includes('estado must be equal to one of the allowed values')) {
				return 'El estado seleccionado no es válido. Seleccione: Disponible, En Servicio, Mantenimiento, Inactivo, No Disponible o Desvinculado.';
			}

			if (message.includes('capacidad_pasajeros must be >= 1')) {
				return 'La capacidad de pasajeros debe ser al menos 1 persona.';
			}

			if (
				message.includes('placa already exists') ||
				(message.includes('placa') && message.includes('unique'))
			) {
				return 'Ya existe un vehículo registrado con esta placa.';
			}

			return message;
		}

		// Error genérico
		return 'Error al guardar el vehículo. Por favor, intente nuevamente.';
	};

	const handleSubmit = async () => {
		error = null;
		fieldErrors = {};

		// Validaciones del frontend
		if (!formData.placa.trim()) {
			error = 'La placa es obligatoria';
			fieldErrors.placa = 'Este campo es obligatorio';
			return;
		}

		if (formData.placa.trim().length < 6) {
			error = 'La placa debe tener al menos 6 caracteres';
			fieldErrors.placa = 'Mínimo 6 caracteres';
			return;
		}

		if (!formData.marca.trim()) {
			error = 'La marca es obligatoria';
			fieldErrors.marca = 'Este campo es obligatorio';
			return;
		}

		if (!formData.modelo.trim()) {
			error = 'El modelo es obligatorio';
			fieldErrors.modelo = 'Este campo es obligatorio';
			return;
		}

		if (formData.ano < 1900 || formData.ano > new Date().getFullYear() + 1) {
			error = `El año debe estar entre 1900 y ${new Date().getFullYear() + 1}`;
			fieldErrors.ano = 'Año inválido';
			return;
		}

		if (!formData.clase_vehiculo) {
			error = 'La clase de vehículo es obligatoria';
			fieldErrors.clase_vehiculo = 'Seleccione una opción';
			return;
		}

		if (formData.capacidad_pasajeros < 1) {
			error = 'La capacidad de pasajeros debe ser al menos 1 persona';
			fieldErrors.capacidad_pasajeros = 'Mínimo 1 pasajero';
			return;
		}

		try {
			isSubmitting = true;

			const payload = {
				...formData,
				placa: formData.placa.toUpperCase().trim(),
				marca: formData.marca.trim(),
				modelo: formData.modelo.trim(),
				clase_vehiculo: formData.clase_vehiculo.trim()
			};

			let response;
			if (vehiculoId) {
				response = await vehiculosAPI.update(vehiculoId, payload);
				const vehiculo = response.data.data;

				successMessage = 'Vehículo actualizado exitosamente';

				// Emitir evento de actualización por socket
				socketUtils.emit('vehiculo-actualizado', {
					vehiculoId,
					vehiculo
				});

				// Actualizar en el store
				flotaStore.updateVehiculo(vehiculoId, vehiculo);
			} else {
				response = await vehiculosAPI.create(payload);
				successMessage = 'Vehículo registrado exitosamente';

				// Emitir evento de creación por socket
				socketUtils.emit('vehiculo-creado', {
					vehiculo: response.data
				});

				// Agregar al store con flag isNew
				flotaStore.addVehiculo(response.data);
			}

			// Mostrar animación de éxito
			showSuccessAnimation = true;

			// Cerrar el modal después de 2 segundos
			setTimeout(() => {
				showSuccessAnimation = false;
				isOpen = false;
				resetForm();
				dispatch('success');
			}, 2000);
		} catch (err: any) {
			console.error('Error al guardar vehículo:', err);
			error = parseBackendError(err);
		} finally {
			isSubmitting = false;
		}
	};

	// Load vehiculo data if editing
	$: if (isOpen && vehiculoId) {
		loadVehiculo();
	}

	async function loadVehiculo() {
		try {
			const response = await vehiculosAPI.getById(vehiculoId!);
			const vehiculo = response.data.data;

			formData = {
				placa: vehiculo.placa || '',
				marca: vehiculo.marca || '',
				modelo: vehiculo.modelo || '',
				ano: vehiculo.ano || new Date().getFullYear(),
				clase_vehiculo: vehiculo.clase_vehiculo.toLowerCase() || '',
				capacidad_pasajeros: vehiculo.capacidad_pasajeros || 1,
				estado: vehiculo.estado || 'DISPONIBLE'
			};
		} catch (err) {
			console.error('Error al cargar vehículo:', err);
			error = 'Error al cargar los datos del vehículo';
		}
	}
</script>

{#if isOpen}
	<!-- Backdrop con blur (paleta landing) -->
	<button
		type="button"
		class="fixed inset-0 z-[60] cursor-default border-0 p-0"
		style="background: linear-gradient(135deg, rgba(15, 31, 26, 0.40), rgba(10, 20, 16, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
		aria-label="Cerrar modal"
		on:click={handleClose}
		transition:fade={{ duration: 200 }}
	></button>

	<!-- Modal Container -->
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center p-4"
		role="presentation"
	>
		<div
			class="relative w-full max-w-2xl overflow-hidden"
			style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
			role="dialog"
			aria-modal="true"
			transition:fly={{ y: 20, duration: 300, easing: quintOut }}
		>
			<!-- Header editorial (paleta landing) -->
			<div
				class="px-6 py-5"
				style="border-bottom: 1px solid var(--border-subtle); background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);"
			>
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-3">
						<div
							class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
							style="background: linear-gradient(135deg, #f97316, #ea580c); box-shadow: 0 6px 16px rgba(249, 115, 22, 0.30);"
						>
							<svg
								class="h-5 w-5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M8 9l4-4 4 4m0 6l-4 4-4-4"
								/>
							</svg>
						</div>
						<div class="min-w-0 flex-1">
							<p
								class="font-mono-meta mb-1 inline-block rounded-md px-2 py-0.5 text-[10px]"
								style="color: var(--emerald-500); background: rgba(249, 115, 22, 0.08); letter-spacing: 0.12em;"
							>
								{vehiculoId ? 'EDICIÓN' : 'NUEVO REGISTRO'}
							</p>
							<h2 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 500;">
								{vehiculoId ? 'Editar Vehículo' : 'Registrar Nuevo Vehículo'}
							</h2>
							<p class="mt-0.5 text-sm" style="color: var(--text-muted);">
								Complete la información básica del vehículo
							</p>
						</div>
					</div>
					<button
						on:click={handleClose}
						disabled={isSubmitting}
						class="filter-close"
						title="Cerrar"
						aria-label="Cerrar modal"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Body -->
			<form on:submit|preventDefault={handleSubmit} class="p-6">
				{#if showSuccessAnimation}
					<!-- Animación de Éxito -->
					<div
						class="flex flex-col items-center justify-center py-12"
						in:scale={{ duration: 500, start: 0.5 }}
					>
						<!-- Icono de verificación animado -->
						<div class="relative mb-6">
							<div
								class="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600"
								in:scale={{ duration: 600, delay: 100 }}
							>
								<svg
									class="h-12 w-12 text-white"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									in:scale={{ duration: 400, delay: 400 }}
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="3"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</div>
							<!-- Círculo de expansión -->
							<div
								class="absolute inset-0 rounded-full bg-orange-500 opacity-25"
								in:scale={{ duration: 800, start: 0.5 }}
							></div>
						</div>

						<!-- Mensaje de éxito -->
						<h3
							class="mb-2 text-2xl font-bold text-gray-900"
							in:fly={{ y: 20, duration: 500, delay: 300 }}
						>
							¡Éxito!
						</h3>
						<p class="mb-4 text-center text-gray-600" in:fly={{ y: 20, duration: 500, delay: 400 }}>
							{successMessage}
						</p>

						<!-- Barra de progreso de cierre -->
						<div class="mt-4 w-64 overflow-hidden rounded-full bg-gray-200">
							<div
								class="h-1 bg-gradient-to-r from-orange-500 to-teal-600"
								style="animation: progressBar 2s linear forwards;"
							></div>
						</div>
					</div>
				{:else}
					<!-- Formulario normal -->
					{#if error}
						<div
							class="mb-4 rounded-lg border border-red-200 bg-red-50 p-4"
							transition:fly={{ y: -10, duration: 300 }}
						>
							<div class="flex items-center gap-2">
								<svg
									class="h-5 w-5 text-red-600"
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
								<p class="text-sm text-red-800">{error}</p>
							</div>
						</div>
					{/if}

					<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
						<!-- Placa -->
						<div>
							<label for="placa" class="mb-2 block text-sm font-medium text-gray-700">
								Placa <span class="text-red-500">*</span>
							</label>
							<input
								id="placa"
								type="text"
								bind:value={formData.placa}
								disabled={isSubmitting}
								placeholder="ABC-123"
								class="h-10 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
								required
							/>
						</div>

						<!-- Marca -->
						<div>
							<label for="marca" class="mb-2 block text-sm font-medium text-gray-700">
								Marca <span class="text-red-500">*</span>
							</label>
							<input
								id="marca"
								type="text"
								bind:value={formData.marca}
								disabled={isSubmitting}
								placeholder="Toyota, Ford, etc."
								class="h-10 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
								required
							/>
						</div>

						<!-- Modelo -->
						<div>
							<label for="modelo" class="mb-2 block text-sm font-medium text-gray-700">
								Modelo <span class="text-red-500">*</span>
							</label>
							<input
								id="modelo"
								type="text"
								bind:value={formData.modelo}
								disabled={isSubmitting}
								placeholder="Corolla, F-150, etc."
								class="h-10 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
								required
							/>
						</div>

						<!-- Año -->
						<div>
							<label for="ano" class="mb-2 block text-sm font-medium text-gray-700">
								Año <span class="text-red-500">*</span>
							</label>
							<input
								id="ano"
								type="number"
								bind:value={formData.ano}
								disabled={isSubmitting}
								min="1900"
								max={new Date().getFullYear() + 1}
								class="h-10 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
								required
							/>
						</div>

						<!-- Clase de Vehículo -->
						<div>
							<label for="clase_vehiculo" class="mb-2 block text-sm font-medium text-gray-700">
								Clase de Vehículo <span class="text-red-500">*</span>
							</label>
							<select
								id="clase_vehiculo"
								bind:value={formData.clase_vehiculo}
								disabled={isSubmitting}
								class="h-10 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
								required
							>
								<option value="">Seleccione...</option>
								{#each claseVehiculoOptions as clase}
									<option value={clase}>{clase}</option>
								{/each}
							</select>
						</div>

						<!-- Capacidad de Pasajeros -->
						<div>
							<label for="capacidad_pasajeros" class="mb-2 block text-sm font-medium text-gray-700">
								Capacidad de Pasajeros <span class="text-red-500">*</span>
							</label>
							<input
								id="capacidad_pasajeros"
								type="number"
								bind:value={formData.capacidad_pasajeros}
								disabled={isSubmitting}
								min="1"
								placeholder="1"
								class="h-10 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 {fieldErrors.capacidad_pasajeros
									? 'border-red-300 focus:border-red-500 focus:ring-red-200'
									: 'border-gray-300 focus:border-orange-500 focus:ring-orange-200'}"
								required
							/>
							{#if fieldErrors.capacidad_pasajeros}
								<p class="mt-1 text-xs text-red-600">{fieldErrors.capacidad_pasajeros}</p>
							{:else}
								<p class="mt-1 text-xs text-gray-500">Mínimo 1 pasajero</p>
							{/if}
						</div>

						<!-- Estado -->
						<div>
							<label for="estado" class="mb-2 block text-sm font-medium text-gray-700">
								Estado <span class="text-red-500">*</span>
							</label>
							<select
								id="estado"
								bind:value={formData.estado}
								disabled={isSubmitting}
								class="h-10 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 {fieldErrors.estado
									? 'border-red-300 focus:border-red-500 focus:ring-red-200'
									: 'border-gray-300 focus:border-orange-500 focus:ring-orange-200'}"
								required
							>
								{#each estadoOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
							{#if fieldErrors.estado}
								<p class="mt-1 text-xs text-red-600">{fieldErrors.estado}</p>
							{:else}
								<p class="mt-1 text-xs text-gray-500">Estado actual del vehículo</p>
							{/if}
						</div>
					</div>

					<!-- Footer -->
					<div class="mt-6 flex justify-end gap-3 border-t border-gray-200 pt-6">
						<button
							type="button"
							on:click={handleClose}
							disabled={isSubmitting}
							class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
						>
							Cancelar
						</button>
						<button
							type="submit"
							disabled={isSubmitting}
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-teal-600 px-6 py-2 text-sm font-medium text-white transition-all hover:shadow-lg disabled:opacity-50"
						>
							{#if isSubmitting}
								<svg
									class="h-4 w-4 animate-spin"
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
								<span>Guardando...</span>
							{:else}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
								<span>{vehiculoId ? 'Actualizar' : 'Registrar'}</span>
							{/if}
							</button>
					</div>
				{/if}
			</form>
		</div>
	</div>
{/if}

<style>
	@keyframes progressBar {
		from {
			width: 0%;
		}
		to {
			width: 100%;
		}
	}
</style>
