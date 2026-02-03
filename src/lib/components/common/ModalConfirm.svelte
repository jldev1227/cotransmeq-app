<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	export let isOpen = false;
	export let title = '¿Estás seguro?';
	export let message = '';
	export let confirmText = 'Confirmar';
	export let cancelText = 'Cancelar';
	export let type: 'danger' | 'warning' | 'info' = 'danger';
	export let isLoading = false;

	const dispatch = createEventDispatcher();

	function handleConfirm() {
		dispatch('confirm');
	}

	function handleCancel() {
		dispatch('cancel');
		isOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !isLoading) {
			handleCancel();
		}
	}

	$: buttonColors = {
		danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
		warning: 'bg-orange-600 hover:bg-orange-700 focus:ring-orange-500',
		info: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
	};

	$: iconColors = {
		danger: 'bg-red-100 text-red-600',
		warning: 'bg-orange-100 text-orange-600',
		info: 'bg-blue-100 text-blue-600'
	};
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
		on:click={!isLoading ? handleCancel : undefined}
		on:keydown={(e) => e.key === 'Escape' && !isLoading && handleCancel()}
		role="button"
		tabindex="0"
		transition:fade={{ duration: 150 }}
	>
		<!-- Modal -->
		<div
			class="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			transition:fly={{ y: 20, duration: 200 }}
		>
			<!-- Icon -->
			<div class="mb-4 flex justify-center">
				<div class="flex h-12 w-12 items-center justify-center rounded-full {iconColors[type]}">
					{#if type === 'danger'}
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					{:else if type === 'warning'}
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					{:else}
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					{/if}
				</div>
			</div>

			<!-- Title -->
			<h3 id="modal-title" class="mb-2 text-center text-xl font-bold text-gray-900">
				{title}
			</h3>

			<!-- Message -->
			<p class="mb-6 text-center text-gray-600">
				{message}
			</p>

			<!-- Actions -->
			<div class="flex gap-3">
				<button
					on:click={handleCancel}
					disabled={isLoading}
					class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				>
					{cancelText}
				</button>
				<button
					on:click={handleConfirm}
					disabled={isLoading}
					class="flex-1 rounded-lg px-4 py-2.5 font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {buttonColors[
						type
					]}"
				>
					{#if isLoading}
						<div class="flex items-center justify-center gap-2">
							<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
							<span>Procesando...</span>
						</div>
					{:else}
						{confirmText}
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
