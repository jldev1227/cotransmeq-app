<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { asistenciasAPI, type CreateFormularioInput } from '$lib/api/asistencias';

	export let isOpen = false;
	export let formularioEdit: any = null;

	const dispatch = createEventDispatcher();

	let tematica = '';
	let descripcion = '';
	let fecha = '';
	let isSubmitting = false;

	$: if (isOpen && formularioEdit) {
		tematica = formularioEdit.tematica || '';
		descripcion = formularioEdit.descripcion || '';
		// Convertir fecha a formato YYYY-MM-DD para el input
		fecha = formularioEdit.fecha ? formularioEdit.fecha.split('T')[0] : '';
	}

	$: if (isOpen && !formularioEdit) {
		resetForm();
	}

	function resetForm() {
		tematica = '';
		descripcion = '';
		// Fecha por defecto: hoy
		fecha = new Date().toISOString().split('T')[0];
	}

	function closeModal() {
		isOpen = false;
		resetForm();
		dispatch('close');
	}

	async function handleSubmit() {
		if (!tematica.trim()) {
			toast.error('La temática es requerida');
			return;
		}

		if (!fecha) {
			toast.error('La fecha es requerida');
			return;
		}

		isSubmitting = true;

		try {
			const data: CreateFormularioInput = {
				tematica: tematica.trim(),
				descripcion: descripcion.trim() || undefined,
				fecha: new Date(fecha).toISOString()
			};

			let formulario;

			if (formularioEdit) {
				// Actualizar - devolver la data actualizada
				formulario = await asistenciasAPI.actualizarFormulario(formularioEdit.id, data);
				console.log('📝 [Modal] Formulario actualizado desde API:', formulario);
			} else {
				// Crear - también devolver la data creada
				formulario = await asistenciasAPI.crearFormulario(data);
				console.log('📝 [Modal] Formulario creado desde API:', formulario);
				toast.success('Formulario creado exitosamente');
			}

			console.log('📝 [Modal] Emitiendo evento save con formulario:', formulario);
			// Siempre emitir el formulario actualizado/creado
			dispatch('save', { formulario });
			closeModal();
		} catch (error: any) {
			toast.error(error.message || 'Error al guardar el formulario');
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
		on:click={closeModal}
		on:keydown={(e) => e.key === 'Escape' && closeModal()}
		role="button"
		tabindex="0"
		transition:fade={{ duration: 200 }}
	>
		<!-- Modal -->
		<div
			class="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			transition:fly={{ y: 50, duration: 300 }}
		>
			<!-- Header -->
			<div class="mb-6 flex items-center justify-between">
				<h3 class="text-xl font-bold text-gray-900">
					{formularioEdit ? 'Editar Formulario' : 'Nuevo Formulario de Asistencia'}
				</h3>
				<button
					on:click={closeModal}
					class="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					disabled={isSubmitting}
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

			<!-- Form -->
			<form on:submit|preventDefault={handleSubmit} class="space-y-5">
				<!-- Temática -->
				<div>
					<label for="tematica" class="mb-2 block text-sm font-medium text-gray-900">
						Temática <span class="text-red-500">*</span>
					</label>
					<input
						id="tematica"
						type="text"
						bind:value={tematica}
						placeholder="Ej: Reunión General Enero 2026"
						class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
						disabled={isSubmitting}
						required
					/>
				</div>

				<!-- Descripción -->
				<div>
					<label for="descripcion" class="mb-2 block text-sm font-medium text-gray-900">
						Descripción
					</label>
					<textarea
						id="descripcion"
						bind:value={descripcion}
						placeholder="Describe el propósito o contexto del formulario..."
						rows="3"
						class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
						disabled={isSubmitting}
					></textarea>
				</div>

				<!-- Fecha -->
				<div>
					<label for="fecha" class="mb-2 block text-sm font-medium text-gray-900">
						Fecha del Evento <span class="text-red-500">*</span>
					</label>
					<input
						id="fecha"
						type="date"
						bind:value={fecha}
						class="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
						disabled={isSubmitting}
						required
					/>
				</div>

				<!-- Actions -->
				<div class="flex justify-end gap-3 border-t border-gray-200 pt-5">
					<button
						type="button"
						on:click={closeModal}
						class="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
						disabled={isSubmitting}
					>
						Cancelar
					</button>
					<button
						type="submit"
						class="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={isSubmitting}
					>
						{#if isSubmitting}
							<span class="flex items-center gap-2">
								<svg
									class="h-4 w-4 animate-spin"
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
								Guardando...
							</span>
						{:else}
							{formularioEdit ? 'Actualizar' : 'Crear Formulario'}
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
