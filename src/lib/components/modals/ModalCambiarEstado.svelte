<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, scale } from 'svelte/transition';

	export let isOpen = false;
	export let itemCount = 0;
	export let loading = false;

	const dispatch = createEventDispatcher<{
		confirm: { estado: string };
		cancel: void;
	}>();

	// Todos los estados disponibles según el enum
	const estados = [
		{ value: 'pendiente', label: 'Pendiente', icon: '⏳', color: 'bg-amber-100 text-amber-800 border-amber-300' },
		{ value: 'liquidada', label: 'Liquidada', icon: '💰', color: 'bg-purple-100 text-purple-800 border-purple-300' },
		{ value: 'facturada', label: 'Facturada', icon: '🧾', color: 'bg-orange-100 text-orange-800 border-orange-300' },
		{ value: 'encontrada', label: 'Encontrada', icon: '✅', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
		{ value: 'cancelado', label: 'Cancelada', icon: '\u{1F6AB}', color: 'bg-red-100 text-red-800 border-red-300' },
		{ value: 'no_esta', label: 'No está', icon: '❌', color: 'bg-red-100 text-red-800 border-red-300' }
	];

	let selectedEstado: string | null = null;

	function handleConfirm() {
		if (!selectedEstado) return;
		dispatch('confirm', { estado: selectedEstado });
	}

	function handleCancel() {
		if (!loading) {
			selectedEstado = null;
			dispatch('cancel');
			isOpen = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !loading) {
			handleCancel();
		}
	}

	// Reset selection when modal opens
	$: if (isOpen) {
		selectedEstado = null;
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		transition:fade={{ duration: 150 }}
		on:click={handleCancel}
		on:keydown={(e) => e.key === 'Escape' && handleCancel()}
		role="button"
		tabindex="0"
	>
		<div
			class="w-full max-w-xl rounded-xl bg-white shadow-2xl"
			transition:scale={{ duration: 150, start: 0.95 }}
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Header -->
			<div class="flex items-start gap-4 border-b border-gray-200 p-6">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
					<svg class="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				</div>
				<div class="flex-1">
					<h3 class="text-lg font-semibold text-gray-900">Cambiar Estado</h3>
					<p class="mt-1 text-sm text-gray-600">
						Selecciona el nuevo estado para {itemCount}
						{itemCount === 1 ? 'recargo' : 'recargos'} seleccionado{itemCount === 1 ? '' : 's'}.
					</p>
				</div>
				<!-- Close button -->
				<button
					on:click={handleCancel}
					disabled={loading}
					class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					aria-label="Cerrar"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content: Estado list -->
			<div class="max-h-[400px] overflow-y-auto p-6">
				<div class="grid grid-cols-2 gap-3">
					{#each estados as estado}
						<button
							type="button"
							on:click={() => (selectedEstado = estado.value)}
							disabled={loading}
							class="flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all {selectedEstado === estado.value
								? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200'
								: 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'} disabled:cursor-not-allowed disabled:opacity-50"
						>
							<span class="text-xl">{estado.icon}</span>
							<div class="flex-1">
								<div class="text-sm font-medium text-gray-900">{estado.label}</div>
							</div>
							{#if selectedEstado === estado.value}
								<svg class="h-5 w-5 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
									<path
										fill-rule="evenodd"
										d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
										clip-rule="evenodd"
									/>
								</svg>
							{:else}
								<div class="h-5 w-5 rounded-full border-2 border-gray-300"></div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-gray-200 px-6 py-4">
				<div class="text-sm text-gray-500">
					{#if selectedEstado}
						{@const sel = estados.find((e) => e.value === selectedEstado)}
						<span class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium {sel?.color || ''}">
							{sel?.icon}
							{sel?.label}
						</span>
					{:else}
						<span class="text-gray-400 italic">Ningún estado seleccionado</span>
					{/if}
				</div>
				<div class="flex gap-3">
					<button
						on:click={handleCancel}
						disabled={loading}
						class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						on:click={handleConfirm}
						disabled={loading || !selectedEstado}
						class="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if loading}
							<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							Actualizando...
						{:else}
							Cambiar Estado ({itemCount})
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
