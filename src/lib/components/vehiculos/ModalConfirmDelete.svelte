<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { flotaStore } from '$lib/stores/flota';

	export let isOpen = false;
	export let vehiculo: any = null;

	const dispatch = createEventDispatcher();

	let isDeleting = false;
	let showSuccessAnimation = false;

	const handleClose = () => {
		if (isDeleting) return;
		isOpen = false;
		showSuccessAnimation = false;
		dispatch('close');
	};

	const handleConfirmDelete = async () => {
		if (!vehiculo) return;

		try {
			isDeleting = true;

			// Llamar al endpoint de soft delete
			await vehiculosAPI.delete(vehiculo.id);

			// Emitir evento por socket
			socketUtils.emit('vehiculo-eliminado', {
				vehiculoId: vehiculo.id
			});

			// Remover del store
			flotaStore.removeVehiculo(vehiculo.id);

			// Mostrar animación de éxito
			showSuccessAnimation = true;

			// Cerrar después de 2 segundos
			setTimeout(() => {
				showSuccessAnimation = false;
				isOpen = false;
				dispatch('success');
			}, 2000);
		} catch (error) {
			console.error('Error al eliminar vehículo:', error);
			alert('Error al eliminar el vehículo. Por favor, intente nuevamente.');
		} finally {
			isDeleting = false;
		}
	};
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
			transition:fly={{ y: 20, duration: 300 }}
		>
			{#if showSuccessAnimation}
				<div
					class="flex flex-col items-center justify-center px-6 py-12"
					in:scale={{ duration: 500, start: 0.5 }}
				>
					<!-- Icono de verificación animado -->
					<div class="relative mb-6">
						<div
							class="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-red-600"
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
							class="absolute inset-0 rounded-full bg-red-500 opacity-25"
							in:scale={{ duration: 800, start: 0.5 }}
						></div>
					</div>

					<!-- Mensaje de éxito -->
					<h3
						class="mb-2 text-2xl font-bold text-gray-900"
						in:fly={{ y: 20, duration: 500, delay: 300 }}
					>
						¡Eliminado!
					</h3>
					<p class="mb-4 text-center text-gray-600" in:fly={{ y: 20, duration: 500, delay: 400 }}>
						El vehículo ha sido eliminado exitosamente
					</p>

					<!-- Barra de progreso de cierre -->
					<div class="mt-4 w-64 overflow-hidden rounded-full bg-gray-200">
						<div
							class="h-1 bg-gradient-to-r from-red-500 to-red-600"
							style="animation: progressBar 2s linear forwards;"
						></div>
					</div>
				</div>
			{:else}
				<!-- Header -->
				<div class="border-b border-gray-200 px-6 py-4">
					<div class="flex items-center gap-3">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-red-600"
						>
							<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
						</div>
						<h2 class="text-xl font-semibold text-gray-900">Confirmar Eliminación</h2>
					</div>
				</div>

				<!-- Content -->
				<div class="px-6 py-6">
					<p class="mb-4 text-gray-700">
						¿Está seguro de que desea eliminar el vehículo
						<span class="font-semibold text-gray-900">{vehiculo?.placa}</span>?
					</p>
					<p class="text-sm text-gray-500">
						Esta acción se puede revertir si eres administrador. El vehículo será marcado como
						eliminado y no aparecerá en la lista principal.
					</p>
				</div>

				<!-- Footer -->
				<div class="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
					<button
						type="button"
						on:click={handleClose}
						disabled={isDeleting}
						class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						type="button"
						on:click={handleConfirmDelete}
						disabled={isDeleting}
						class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-6 py-2 text-sm font-medium text-white transition-all hover:shadow-lg disabled:opacity-50"
					>
						{#if isDeleting}
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
							<span>Eliminando...</span>
						{:else}
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							<span>Eliminar</span>
						{/if}
					</button>
				</div>
			{/if}
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
