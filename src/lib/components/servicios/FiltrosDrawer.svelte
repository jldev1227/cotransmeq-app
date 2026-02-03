<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
	import type { EstadoServicio, PropositoServicio } from '$lib/types/servicios';

	const dispatch = createEventDispatcher();

	export let visible = false;
	export let filters: {
		estado: EstadoServicio | null;
		proposito: PropositoServicio | null;
		fechaDesde: string;
		fechaHasta: string;
		municipioOrigen: string | null;
		municipioDestino: string | null;
	};

	// Estados y propósitos disponibles
	const estados: { value: EstadoServicio; label: string; color: string }[] = [
		{ value: 'solicitado', label: 'Solicitado', color: '#3B82F6' },
		{ value: 'en_curso', label: 'En Curso', color: '#F59E0B' },
		{ value: 'planificado', label: 'Planificado', color: '#8B5CF6' },
		{ value: 'realizado', label: 'Realizado', color: '#10B981' },
		{ value: 'cancelado', label: 'Cancelado', color: '#EF4444' }
	];

	const propositos: { value: PropositoServicio; label: string }[] = [
		{ value: 'contratos', label: 'Contratos' },
		{ value: 'ocasional', label: 'Ocasional' },
		{ value: 'turismo', label: 'Turismo' }
	];

	function handleClose() {
		dispatch('close');
	}

	function handleReset() {
		filters.estado = null;
		filters.proposito = null;
		filters.fechaDesde = '';
		filters.fechaHasta = '';
		filters.municipioOrigen = null;
		filters.municipioDestino = null;
		dispatch('change', filters);
	}

	function handleApply() {
		dispatch('change', filters);
		handleClose();
	}
</script>

{#if visible}
	<!-- Overlay -->
	<button
		on:click={handleClose}
		class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		aria-label="Cerrar filtros"
	></button>

	<!-- Drawer -->
	<div
		class="fixed top-0 right-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl sm:w-96"
		transition:fly={{ x: 400, duration: 300 }}
	>
		<!-- Header -->
		<div
			class="sticky top-0 z-10 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-white p-6"
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600"
					>
						<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
							/>
						</svg>
					</div>
					<h2 class="text-xl font-bold text-gray-900">Filtros</h2>
				</div>
				<button
					on:click={handleClose}
					class="apple-transition flex h-10 w-10 items-center justify-center rounded-xl hover:bg-gray-100"
					aria-label="Cerrar filtros"
				>
					<svg class="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
		<div class="space-y-6 p-6">
			<!-- Estado -->
			<div>
				<div class="mb-3 block text-sm font-semibold text-gray-700">Estado del Servicio</div>
				<div class="grid grid-cols-2 gap-2">
					{#each estados as estado}
						<button
							on:click={() =>
								(filters.estado = filters.estado === estado.value ? null : estado.value)}
							class="apple-transition rounded-xl border px-4 py-3 text-sm font-medium {filters.estado ===
							estado.value
								? 'border-2'
								: 'border hover:border-gray-300'}"
							style="background-color: {filters.estado === estado.value
								? `${estado.color}15`
								: 'white'}; border-color: {filters.estado === estado.value
								? estado.color
								: '#E5E7EB'}; color: {filters.estado === estado.value ? estado.color : '#6B7280'}"
						>
							{estado.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Propósito -->
			<div>
				<div class="mb-3 block text-sm font-semibold text-gray-700">Propósito del Servicio</div>
				<div class="space-y-2">
					{#each propositos as proposito}
						<button
							on:click={() =>
								(filters.proposito =
									filters.proposito === proposito.value ? null : proposito.value)}
							class="apple-transition flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium {filters.proposito ===
							proposito.value
								? 'border-orange-500 bg-orange-50 text-orange-700'
								: 'border-gray-200 text-gray-700 hover:border-gray-300'}"
						>
							<span>{proposito.label}</span>
							{#if filters.proposito === proposito.value}
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
										d="M5 13l4 4L19 7"
									/>
								</svg>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- Rango de Fechas -->
			<div>
				<div class="mb-3 block text-sm font-semibold text-gray-700">Rango de Fechas</div>
				<div class="space-y-3">
					<div>
						<label for="fecha-desde" class="mb-1 block text-xs text-gray-500">Desde</label>
						<input
							id="fecha-desde"
							type="date"
							bind:value={filters.fechaDesde}
							class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
						/>
					</div>
					<div>
						<label for="fecha-hasta" class="mb-1 block text-xs text-gray-500">Hasta</label>
						<input
							id="fecha-hasta"
							type="date"
							bind:value={filters.fechaHasta}
							class="apple-transition w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
						/>
					</div>
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="sticky bottom-0 space-y-3 border-t border-gray-200 bg-white p-6">
			<button
				on:click={handleApply}
				class="apple-transition w-full rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white shadow-lg shadow-orange-500/30 hover:from-orange-600 hover:to-orange-700"
			>
				Aplicar Filtros
			</button>
			<button
				on:click={handleReset}
				class="apple-transition w-full rounded-xl bg-gray-100 px-6 py-3 font-semibold text-gray-700 hover:bg-gray-200"
			>
				Limpiar Filtros
			</button>
		</div>
	</div>
{/if}
