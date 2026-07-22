<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
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

			const response = await apiClient.post('/api/vehiculos', vehiculoData);

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
			class="w-full max-w-md overflow-hidden"
			style="background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
			role="dialog"
			aria-modal="true"
			transition:fly={{ y: 50, duration: 300, easing: quintOut }}
		>
			<!-- Header editorial -->
			<div
				class="flex items-center justify-between gap-3 px-6 py-5"
				style="border-bottom: 1px solid var(--border-subtle); background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);"
			>
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
							NUEVO REGISTRO
						</p>
						<h2 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 500;">
							Nuevo Vehículo
						</h2>
					</div>
				</div>
				<button
					on:click={handleClose}
					class="filter-close"
					aria-label="Cerrar"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/></svg
					>
				</button>
			</div>

			<form on:submit|preventDefault={handleSubmit} class="space-y-4 px-6 py-5">
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
