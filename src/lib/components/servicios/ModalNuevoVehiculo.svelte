<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { apiClient } from '$lib/api/apiClient';
	import { toast } from '$lib/stores/toast';

	export let isOpen = false;
	export let onClose: () => void;
	export let onSuccess: (vehiculo: any) => void;

	let placa = '';
	let clase_vehiculo = '';
	let marca = '';
	let modelo = '';
	let linea = '';
	let capacidad_pasajeros = '';
	let loading = false;

	function handleClose() {
		resetForm();
		onClose();
	}

	function resetForm() {
		placa = '';
		clase_vehiculo = '';
		marca = '';
		modelo = '';
		linea = '';
		capacidad_pasajeros = '';
	}

	async function handleSubmit() {
		if (!placa || !clase_vehiculo) {
			toast.warning('Por favor complete los campos obligatorios (Placa y Clase de Vehículo)');
			return;
		}

		loading = true;

		try {
			// Preparar datos con validación estricta
			const marcaTrim = marca?.trim() || '';
			const modeloTrim = modelo?.trim() || '';
			const lineaTrim = linea?.trim() || '';

			const vehiculoData: any = {
				placa: placa.trim(),
				clase_vehiculo
			};

			// Solo agregar campos opcionales si tienen valor válido
			if (marcaTrim.length >= 2) {
				vehiculoData.marca = marcaTrim;
			}
			if (modeloTrim.length >= 1) {
				vehiculoData.modelo = modeloTrim;
			}
			if (lineaTrim.length >= 2) {
				vehiculoData.linea = lineaTrim;
			}
			if (capacidad_pasajeros) {
				vehiculoData.capacidad_pasajeros = parseInt(capacidad_pasajeros);
			}

			console.log('🚗 [ModalNuevoVehiculo] Datos a enviar:', vehiculoData);

			const response = await apiClient.post('/api/vehiculos', vehiculoData);

			console.log('🔍 [ModalNuevoVehiculo] Respuesta completa del servidor:', response);
			console.log('📦 [ModalNuevoVehiculo] response.data:', response.data);
			console.log('🚗 [ModalNuevoVehiculo] Vehículo creado - ID:', response.data?.data?.id);
			console.log('🚗 [ModalNuevoVehiculo] Vehículo creado - Placa:', response.data?.data?.placa);
			console.log(
				'🚗 [ModalNuevoVehiculo] Vehículo creado - Clase:',
				response.data?.data?.clase_vehiculo
			);

			toast.success('Vehículo creado exitosamente');
			onSuccess(response.data.data); // <-- Fix: response.data.data
			handleClose();
		} catch (error: any) {
			console.error('Error creando vehículo:', error);

			// Extraer título y descripción del error
			const errorData = error?.response?.data;
			const title = errorData?.message || 'Error al crear el vehículo';
			const description = errorData?.error || error?.message || 'Ocurrió un error inesperado';

			// Mostrar toast con título y descripción
			toast.error(title, {
				description: description,
				duration: 5000
			});
		} finally {
			loading = false;
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="glass soft-shadow w-full max-w-md rounded-2xl border border-gray-200/50 bg-white p-6"
			role="document"
			transition:fly={{ y: 50, duration: 300 }}
		>
			<h3 class="mb-4 text-xl font-bold text-gray-900">Nuevo Vehículo</h3>

			<form on:submit|preventDefault={handleSubmit} class="space-y-4">
				<div>
					<label for="placa" class="mb-1 block text-sm font-medium text-gray-700">
						Placa <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="placa"
						bind:value={placa}
						required
						maxlength="6"
						minlength="6"
						on:input={(e) => {
							const target = e.target as HTMLInputElement;
							target.value = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
							placa = target.value;
						}}
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 uppercase focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Ej: ABC123"
						title="La placa debe tener exactamente 6 caracteres alfanuméricos (letras y números)"
					/>
				</div>

				<div>
					<label for="clase_vehiculo" class="mb-1 block text-sm font-medium text-gray-700">
						Clase de Vehículo <span class="text-red-500">*</span>
					</label>
					<select
						id="clase_vehiculo"
						bind:value={clase_vehiculo}
						required
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
					>
						<option value="">Seleccione una clase</option>
						<option value="CAMIONETA">Camioneta</option>
						<option value="BUS">Bus</option>
						<option value="BUSETA">Buseta</option>
						<option value="BUSETON">Busetón</option>
						<option value="MICROBUS">Microbús</option>
					</select>
				</div>

				<div>
					<label for="marca" class="mb-1 block text-sm font-medium text-gray-700"> Marca </label>
					<input
						type="text"
						id="marca"
						bind:value={marca}
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Ej: Toyota, Chevrolet"
					/>
				</div>

				<div>
					<label for="linea" class="mb-1 block text-sm font-medium text-gray-700"> Línea </label>
					<input
						type="text"
						id="linea"
						bind:value={linea}
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Ej: Corolla, Aveo"
					/>
				</div>

				<div>
					<label for="modelo" class="mb-1 block text-sm font-medium text-gray-700">
						Modelo (Año)
					</label>
					<input
						type="text"
						id="modelo"
						bind:value={modelo}
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Ej: 2023"
					/>
				</div>

				<div>
					<label for="capacidad_pasajeros" class="mb-1 block text-sm font-medium text-gray-700">
						Capacidad de Pasajeros
					</label>
					<input
						type="number"
						id="capacidad_pasajeros"
						bind:value={capacidad_pasajeros}
						min="1"
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Ej: 5"
					/>
				</div>

				<div class="flex justify-end gap-3 pt-4">
					<button
						type="button"
						on:click={handleClose}
						class="apple-transition apple-hover rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
					>
						Cancelar
					</button>
					<button
						type="submit"
						disabled={loading}
						class="apple-transition apple-hover rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2 text-sm font-medium text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
					>
						{loading ? 'Guardando...' : 'Crear Vehículo'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
