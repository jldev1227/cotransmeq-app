<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
	import type { ServicioConRelaciones, CreateServicioDTO } from '$lib/types/servicios';

	const dispatch = createEventDispatcher();

	export let visible = false;
	export let servicio: ServicioConRelaciones | null = null;
	export let mode: 'create' | 'edit' = 'create';

	let formData: any = {
		cliente_id: '',
		origen_id: '',
		destino_id: '',
		proposito_servicio: 'ocasional',
		fecha_solicitud: new Date().toISOString().split('T')[0],
		valor: 0,
		origen_especifico: '',
		destino_especifico: ''
	};

	let loading = false;
	let error: string | null = null;

	// Resetear form cuando se abre/cierra
	$: if (visible && servicio && mode === 'edit') {
		formData = {
			cliente_id: servicio.cliente.id,
			origen_id: servicio.origen.id,
			destino_id: servicio.destino.id,
			proposito_servicio: servicio.proposito_servicio,
			fecha_solicitud: new Date(servicio.fecha_solicitud).toISOString().split('T')[0],
			valor: servicio.valor,
			origen_especifico: servicio.origen_especifico || '',
			destino_especifico: servicio.destino_especifico || '',
			observaciones: servicio.observaciones || ''
		};
	} else if (visible && mode === 'create') {
		formData = {
			cliente_id: '',
			origen_id: '',
			destino_id: '',
			proposito_servicio: 'ocasional',
			fecha_solicitud: new Date().toISOString().split('T')[0],
			valor: 0,
			origen_especifico: '',
			destino_especifico: ''
		};
	}

	function handleClose() {
		if (!loading) {
			error = null;
			dispatch('close');
		}
	}

	async function handleSubmit() {
		try {
			loading = true;
			error = null;

			// Validación básica
			if (!formData.cliente_id || !formData.origen_id || !formData.destino_id || !formData.valor) {
				error = 'Por favor complete todos los campos requeridos';
				return;
			}

			dispatch('submit', { ...formData });
			handleClose();
		} catch (err: any) {
			error = err.message || 'Error al guardar el servicio';
		} finally {
			loading = false;
		}
	}
</script>

{#if visible}
	<!-- Overlay -->
	<div
		on:click={handleClose}
		on:keydown={(e) => e.key === 'Escape' && handleClose()}
		role="button"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
	>
		<!-- Modal -->
		<div
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			aria-modal="true"
			tabindex="0"
			class="glass soft-shadow max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200/50"
			transition:scale={{ duration: 300, start: 0.95 }}
		>
			<!-- Header -->
			<div class="border-b border-gray-200/50 bg-gradient-to-r from-orange-50 to-white p-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600"
						>
							<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								{#if mode === 'create'}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 6v6m0 0v6m0-6h6m-6 0H6"
									/>
								{:else}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
									/>
								{/if}
							</svg>
						</div>
						<div>
							<h2 class="text-2xl font-bold text-gray-900">
								{mode === 'create' ? 'Crear Nuevo Servicio' : 'Editar Servicio'}
							</h2>
							<p class="text-sm text-gray-600">Complete la información del servicio</p>
						</div>
					</div>
					<button
						on:click={handleClose}
						disabled={loading}
						class="apple-transition flex h-10 w-10 items-center justify-center rounded-xl hover:bg-gray-100 disabled:opacity-50"
						aria-label="Cerrar modal"
					>
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
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Content -->
			<form
				on:submit|preventDefault={handleSubmit}
				class="max-h-[calc(90vh-180px)] overflow-y-auto"
			>
				<div class="space-y-6 p-6">
					{#if error}
						<div
							class="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4"
							transition:scale={{ duration: 200 }}
						>
							<svg
								class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
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
							<div class="flex-1">
								<p class="text-sm font-medium text-red-800">{error}</p>
							</div>
							<button
								on:click={() => (error = null)}
								class="text-red-600 hover:text-red-700"
								aria-label="Cerrar error"
							>
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
					{/if}

					<!-- Grid de campos -->
					<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
						<!-- Cliente ID (Temporal - debería ser un select) -->
						<div class="md:col-span-2">
							<label for="cliente_id" class="mb-2 block text-sm font-semibold text-gray-700">
								Cliente <span class="text-red-500">*</span>
							</label>
							<input
								id="cliente_id"
								type="text"
								bind:value={formData.cliente_id}
								required
								placeholder="ID del cliente"
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Origen ID -->
						<div>
							<label for="origen_id" class="mb-2 block text-sm font-semibold text-gray-700">
								Municipio Origen <span class="text-red-500">*</span>
							</label>
							<input
								id="origen_id"
								type="text"
								bind:value={formData.origen_id}
								required
								placeholder="ID del municipio"
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Destino ID -->
						<div>
							<label for="destino_id" class="mb-2 block text-sm font-semibold text-gray-700">
								Municipio Destino <span class="text-red-500">*</span>
							</label>
							<input
								id="destino_id"
								type="text"
								bind:value={formData.destino_id}
								required
								placeholder="ID del municipio"
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Dirección específica origen -->
						<div>
							<label for="origen_especifico" class="mb-2 block text-sm font-semibold text-gray-700">
								Dirección Origen Específica
							</label>
							<input
								id="origen_especifico"
								type="text"
								bind:value={formData.origen_especifico}
								placeholder="Ej: Calle 10 #20-30"
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Dirección específica destino -->
						<div>
							<label
								for="destino_especifico"
								class="mb-2 block text-sm font-semibold text-gray-700"
							>
								Dirección Destino Específica
							</label>
							<input
								id="destino_especifico"
								type="text"
								bind:value={formData.destino_especifico}
								placeholder="Ej: Carrera 5 #15-25"
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Propósito -->
						<div>
							<label for="proposito" class="mb-2 block text-sm font-semibold text-gray-700">
								Propósito <span class="text-red-500">*</span>
							</label>
							<select
								id="proposito"
								bind:value={formData.proposito_servicio}
								required
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							>
								<option value="ocasional">Ocasional</option>
								<option value="contratos">Contratos</option>
								<option value="turismo">Turismo</option>
							</select>
						</div>

						<!-- Fecha de solicitud -->
						<div>
							<label for="fecha_solicitud" class="mb-2 block text-sm font-semibold text-gray-700">
								Fecha de Solicitud <span class="text-red-500">*</span>
							</label>
							<input
								id="fecha_solicitud"
								type="date"
								bind:value={formData.fecha_solicitud}
								required
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Valor -->
						<div class="md:col-span-2">
							<label for="valor" class="mb-2 block text-sm font-semibold text-gray-700">
								Valor del Servicio (COP) <span class="text-red-500">*</span>
							</label>
							<input
								id="valor"
								type="number"
								bind:value={formData.valor}
								required
								min="0"
								step="1000"
								placeholder="0"
								class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-3 text-lg font-semibold focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							/>
						</div>

						<!-- Observaciones -->
						<div class="md:col-span-2">
							<label for="observaciones" class="mb-2 block text-sm font-semibold text-gray-700">
								Observaciones
							</label>
							<textarea
								id="observaciones"
								bind:value={formData.observaciones}
								rows="3"
								placeholder="Notas adicionales sobre el servicio..."
								class="apple-transition w-full resize-none rounded-xl border border-gray-200 px-4 py-3 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
							></textarea>
						</div>
					</div>
				</div>

				<!-- Footer -->
				<div class="flex gap-3 border-t border-gray-200/50 bg-gray-50/50 p-6">
					<button
						type="button"
						on:click={handleClose}
						disabled={loading}
						class="apple-transition flex-1 rounded-xl border border-gray-200 bg-white px-6 py-3 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						type="submit"
						disabled={loading}
						class="apple-transition flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-500/30 hover:from-orange-600 hover:to-orange-700 disabled:opacity-50"
					>
						{#if loading}
							<div
								class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
							<span>Guardando...</span>
						{:else}
							<span>{mode === 'create' ? 'Crear Servicio' : 'Guardar Cambios'}</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
