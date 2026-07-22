<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	export let isOpen = false;
	export let title = '¿Confirmar restauración?';
	export let message = '¿Estás seguro de que deseas restaurar este elemento?';
	export let itemCount = 1;
	export let loading = false;

	const dispatch = createEventDispatcher();

	function handleConfirm() {
		dispatch('confirm');
	}

	function handleCancel() {
		if (!loading) {
			dispatch('cancel');
			isOpen = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !loading) {
			handleCancel();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
	<!-- Backdrop con blur (paleta landing) -->
	<button
		type="button"
		class="modal-overlay cursor-default"
		style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
		aria-label="Cerrar modal"
		on:click={handleCancel}
		transition:fade={{ duration: 200, easing: quintOut }}
	></button>

	<!-- Modal Container -->
	<div class="modal-overlay" role="presentation" style="pointer-events: none;">
		<div
			class="modal-content"
			style="max-width: 28rem; pointer-events: auto; background-color: var(--bg-surface); border: 1px solid var(--border-subtle); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
			role="dialog"
			aria-modal="true"
			transition:fly={{ y: 20, duration: 400, easing: quintOut }}
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			<!-- Header -->
			<div
				class="modal-header"
				style="background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%);"
			>
				<div class="modal-title-row">
					<div class="modal-icon icon-success">
						<svg
							class="h-6 w-6 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
					</div>
					<div class="modal-title-text">
						<p
							class="modal-eyebrow eyebrow-success"
							style="color: var(--emerald-700); background: rgba(22, 101, 52, 0.10);"
						>
							ACCIÓN REVERSIBLE
						</p>
						<h3 style="font-family: 'Geist', sans-serif; font-size: 1.25rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em;">
							{title}
						</h3>
						<p class="modal-sub">{message}</p>
						{#if itemCount > 1}
							<p class="mt-2 text-sm font-semibold" style="color: var(--emerald-700);">
								Se restaurarán {itemCount} elemento(s)
							</p>
						{/if}
					</div>
				</div>
			</div>

			<!-- Content: alert -->
			<div class="modal-body">
				<div
					class="flex items-start gap-3 rounded-xl p-4"
					style="background: linear-gradient(135deg, rgba(249, 115, 22, 0.04), rgba(249, 115, 22, 0.08)); border: 1px solid rgba(249, 115, 22, 0.18);"
				>
					<svg
						class="mt-0.5 h-5 w-5 flex-shrink-0"
						style="color: var(--emerald-600);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-semibold" style="color: var(--emerald-700);">Información</p>
						<p class="mt-1 text-sm" style="color: var(--emerald-700);">
							Esta acción marcará el recargo como activo. Los datos serán visibles en el sistema.
						</p>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div
				class="modal-footer"
				style="background-color: var(--bg-base);"
			>
				<button on:click={handleCancel} disabled={loading} class="btn-secondary">
					Cancelar
				</button>
				<button
					on:click={handleConfirm}
					disabled={loading}
					class="btn-primary"
				>
					{#if loading}
						<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"
							><circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							/><path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/></svg
						>
						Restaurando…
					{:else}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/></svg
						>
						Restaurar
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
