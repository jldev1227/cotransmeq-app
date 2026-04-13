<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { apiClient } from '$lib/api/apiClient';
	import { toast } from '$lib/stores/toast';

	export let isOpen = false;
	export let onClose: () => void;
	export let onSuccess: (conductor: any) => void;

	let nombre = '';
	let apellido = '';
	let numero_identificacion = '';
	let telefono = '';
	let email = '';
	let loading = false;

	function handleClose() {
		resetForm();
		onClose();
	}

	function resetForm() {
		nombre = '';
		apellido = '';
		numero_identificacion = '';
		telefono = '';
		email = '';
	}

	async function handleSubmit() {
		if (!nombre || !apellido || !numero_identificacion) {
			toast.warning(
				'Por favor complete los campos obligatorios (Nombre, Apellido y Número de Identificación)'
			);
			return;
		}

		loading = true;

		try {
			const response = await apiClient.post('/api/conductores', {
				nombre,
				apellido,
				numero_identificacion,
				telefono: telefono || null,
				email: email || null
			});

			toast.success('Conductor creado exitosamente');
			onSuccess(response.data.data); // <-- Aquí está el fix: response.data.data
			handleClose();
		} catch (error: any) {
			console.error('❌ [ModalNuevoConductor] Error creando conductor:', error);
			console.error('❌ [ModalNuevoConductor] Error response:', error?.response);
			console.error('❌ [ModalNuevoConductor] Error data:', error?.response?.data);

			// Extraer título y descripción del error
			const errorData = error?.response?.data;
			const title = errorData?.message || 'Error al crear el conductor';
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
			<h3 class="mb-4 text-xl font-bold text-gray-900">Nuevo Conductor</h3>

			<form on:submit|preventDefault={handleSubmit} class="space-y-4">
				<div>
					<label for="nombre" class="mb-1 block text-sm font-medium text-gray-700">
						Nombre <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="nombre"
						bind:value={nombre}
						required
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Nombre del conductor"
					/>
				</div>

				<div>
					<label for="apellido" class="mb-1 block text-sm font-medium text-gray-700">
						Apellido <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="apellido"
						bind:value={apellido}
						required
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Apellido del conductor"
					/>
				</div>

				<div>
					<label for="numero_identificacion" class="mb-1 block text-sm font-medium text-gray-700">
						Número de Identificación <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="numero_identificacion"
						bind:value={numero_identificacion}
						required
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Cédula o documento"
					/>
				</div>

				<div>
					<label for="telefono" class="mb-1 block text-sm font-medium text-gray-700">
						Teléfono
					</label>
					<input
						type="tel"
						id="telefono"
						bind:value={telefono}
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Teléfono de contacto"
					/>
				</div>

				<div>
					<label for="email" class="mb-1 block text-sm font-medium text-gray-700"> Email </label>
					<input
						type="email"
						id="email"
						bind:value={email}
						class="input-glow w-full rounded-xl border border-gray-200 px-3 py-2 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/50 focus:outline-none"
						placeholder="Email de contacto"
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
						{loading ? 'Guardando...' : 'Crear Conductor'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
