<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
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
		'Automóvil',
		'Camioneta',
		'Van',
		'Bus',
		'Camión',
		'Motocicleta',
		'Otro'
	];

	const estadoOptions = [
		{ value: 'DISPONIBLE', label: 'Disponible' },
		{ value: 'SERVICIO', label: 'En Servicio' },
		{ value: 'MANTENIMIENTO', label: 'Mantenimiento' },
		{ value: 'INACTIVO', label: 'Inactivo' },
		{ value: 'NO_DISPONIBLE', label: 'No Disponible' },
		{ value: 'DESVINCULADO', label: 'Desvinculado' }
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
				successMessage = 'Vehículo actualizado exitosamente';

				// Emitir evento de actualización por socket
				socketUtils.emit('vehiculo-actualizado', {
					vehiculoId,
					vehiculo: response.data
				});

				// Actualizar en el store
				flotaStore.updateVehiculo(vehiculoId, response.data);
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
			const vehiculo = response.data;

			formData = {
				placa: vehiculo.placa || '',
				marca: vehiculo.marca || '',
				modelo: vehiculo.modelo || '',
				ano: vehiculo.ano || new Date().getFullYear(),
				clase_vehiculo: vehiculo.clase_vehiculo || '',
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
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="border-b border-gray-200 bg-gradient-to-r from-orange-500 to-amber-600 p-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="rounded-lg bg-white/20 p-2 backdrop-blur-sm">
							<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 9l4-4 4 4m0 6l-4 4-4-4"
								/>
							</svg>
						</div>
						<div>
							<h2 class="text-xl font-bold text-white">
								{vehiculoId ? 'Editar Vehículo' : 'Registrar Nuevo Vehículo'}
							</h2>
							<p class="text-sm text-orange-50">Complete la información básica del vehículo</p>
						</div>
					</div>
					<button
						on:click={handleClose}
						disabled={isSubmitting}
						class="rounded-lg p-2 text-white transition-colors hover:bg-white/20 disabled:opacity-50"
						title="Cerrar"
						aria-label="Cerrar modal"
					>
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
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
								class="h-1 bg-gradient-to-r from-orange-500 to-amber-600"
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
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-2 text-sm font-medium text-white transition-all hover:shadow-lg disabled:opacity-50"
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
