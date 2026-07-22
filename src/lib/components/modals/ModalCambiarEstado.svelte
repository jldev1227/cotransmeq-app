<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	export let isOpen = false;
	export let itemCount = 0;
	export let loading = false;

	const dispatch = createEventDispatcher<{
		confirm: { estado: string };
		cancel: void;
	}>();

	const estados = [
		{ value: 'pendiente', label: 'Pendiente', icon: '⏳' },
		{ value: 'liquidada', label: 'Liquidada', icon: '💰' },
		{ value: 'facturada', label: 'Facturada', icon: '🧾' },
		{ value: 'encontrada', label: 'Encontrada', icon: '✅' },
		{ value: 'cancelado', label: 'Cancelada', icon: '🚫' },
		{ value: 'no_esta', label: 'No está', icon: '❌' }
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

	$: if (isOpen) {
		selectedEstado = null;
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

	<!-- Modal Container (card estilo landing) -->
	<div class="modal-overlay" role="presentation" style="pointer-events: none;">
		<div
			class="modal-content"
			style="max-width: 36rem; pointer-events: auto; background-color: var(--bg-surface); border: 1px solid var(--border-subtle); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
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
					<div class="modal-icon">
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
							class="modal-eyebrow"
							style="color: var(--emerald-500); background: rgba(249, 115, 22, 0.08);"
						>
							ACCIÓN MASIVA
						</p>
						<h3 style="font-family: 'Geist', sans-serif; font-size: 1.25rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em;">
							Cambiar Estado
						</h3>
						<p class="modal-sub">
							Selecciona el nuevo estado para {itemCount}
							{itemCount === 1 ? 'recargo' : 'recargos'} seleccionado{itemCount === 1 ? '' : 's'}.
						</p>
					</div>
				</div>
				<button
					on:click={handleCancel}
					disabled={loading}
					class="modal-close"
					aria-label="Cerrar"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/></svg
					>
				</button>
			</div>

			<!-- Content: Estado grid -->
			<div class="modal-body" style="max-height: 400px;">
				<div class="grid grid-cols-2 gap-3">
					{#each estados as estado}
						<button
							type="button"
							on:click={() => (selectedEstado = estado.value)}
							disabled={loading}
							class="modal-select-card"
							style="background-color: {selectedEstado === estado.value
								? 'rgba(249, 115, 22, 0.06)'
								: 'var(--bg-surface)'}; border-color: {selectedEstado === estado.value
								? 'var(--emerald-500)'
								: 'var(--border-default)'};"
						>
							<span class="text-xl">{estado.icon}</span>
							<div class="min-w-0 flex-1">
								<div
									class="text-sm font-semibold"
									style="color: {selectedEstado === estado.value
										? 'var(--emerald-700)'
										: 'var(--text-primary)'};"
								>
									{estado.label}
								</div>
							</div>
							{#if selectedEstado === estado.value}
								<svg
									class="h-5 w-5 flex-shrink-0"
									style="color: var(--emerald-500);"
									fill="currentColor"
									viewBox="0 0 20 20"
								>
									<path
										fill-rule="evenodd"
										d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
										clip-rule="evenodd"
									/>
								</svg>
							{:else}
								<div
									class="h-5 w-5 flex-shrink-0 rounded-full"
									style="border: 2px solid var(--border-default);"
								></div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- Footer -->
			<div
				class="modal-footer"
				style="background-color: var(--bg-base);"
			>
				<div class="min-w-0 flex-1 text-sm" style="color: var(--text-muted);">
					{#if selectedEstado}
						{@const sel = estados.find((e) => e.value === selectedEstado)}
						<span
							class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
							style="background: rgba(249, 115, 22, 0.10); color: var(--emerald-700); border: 1px solid rgba(249, 115, 22, 0.25);"
						>
							{sel?.icon}
							{sel?.label}
						</span>
					{:else}
						<span class="italic" style="color: var(--text-very-muted);">Ningún estado seleccionado</span>
					{/if}
				</div>
				<div class="flex flex-shrink-0 gap-2">
					<button on:click={handleCancel} disabled={loading} class="btn-secondary">
						Cancelar
					</button>
					<button
						on:click={handleConfirm}
						disabled={loading || !selectedEstado}
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
							Actualizando…
						{:else}
							Cambiar Estado ({itemCount})
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
