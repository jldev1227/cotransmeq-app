<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	export let isOpen = false;
	export let title = '¿Confirmar eliminación?';
	export let message = '¿Estás seguro de que deseas eliminar este elemento?';
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
				class="modal-header delete-header"
				style="background: linear-gradient(135deg, rgba(220, 38, 38, 0.04), var(--bg-surface) 60%);"
			>
				<div class="modal-title-row">
					<div class="modal-icon icon-error">
						<svg
							class="h-6 w-6"
							style="color: #dc2626;"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					</div>
					<div class="modal-title-text">
						<p
							class="modal-eyebrow eyebrow-error"
							style="color: #dc2626; background: rgba(220, 38, 38, 0.08);"
						>
							ACCIÓN DESTRUCTIVA
						</p>
						<h3 style="font-family: 'Geist', sans-serif; font-size: 1.25rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em;">
							{title}
						</h3>
						<p class="modal-sub">{message}</p>
						{#if itemCount > 1}
							<p class="mt-2 text-sm font-semibold" style="color: #dc2626;">
								Se eliminarán {itemCount} elemento(s)
							</p>
						{/if}
					</div>
				</div>
			</div>

			<!-- Content: alert -->
			<div class="modal-body">
				<div
					class="flex items-start gap-3 rounded-xl p-4"
					style="background-color: rgba(220, 38, 38, 0.04); border: 1px solid rgba(220, 38, 38, 0.18);"
				>
					<svg
						class="mt-0.5 h-5 w-5 flex-shrink-0"
						style="color: #dc2626;"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-semibold" style="color: #991b1b;">Advertencia</p>
						<p class="mt-1 text-sm" style="color: #b91c1c;">
							Esta acción marcará el recargo como eliminado. Los datos se conservarán en el
							sistema pero no serán visibles.
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
					class="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
					style="background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 4px 16px rgba(220, 38, 38, 0.30);"
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
						Eliminando…
					{:else}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/></svg
						>
						Eliminar
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
