<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { tick } from 'svelte';

	export let isOpen = false;
	export let items: Array<{ value: string; label: string }> = [];
	export let selectedValue: string = '';
	export let onClose: () => void;
	export let onSelect: (value: string) => void;
	export let title = 'Seleccionar';
	export let searchPlaceholder = 'Buscar...';
	export let emptyMessage = 'No se encontraron resultados';
	export let icon: 'building' | 'user' | 'truck' | 'location' = 'building';

	let searchQuery = '';
	let searchInput: HTMLInputElement;

	$: filteredItems = items.filter((item) =>
		item.label.toLowerCase().includes(searchQuery.toLowerCase())
	);

	// Enfocar el input cuando el modal se abre
	$: if (isOpen && searchInput) {
		tick().then(() => {
			searchInput?.focus();
		});
	}

	function handleSelect(value: string) {
		onSelect(value);
		onClose();
	}

	function handleBackdropClick() {
		onClose();
	}

	function getIcon() {
		switch (icon) {
			case 'building':
				return '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />';
			case 'user':
				return '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />';
			case 'truck':
				return '<path stroke-linecap="round" stroke-linejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />';
			case 'location':
				return '<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />';
		}
	}
</script>

{#if isOpen}
	<!-- Modal backdrop -->
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		transition:fade={{ duration: 200 }}
		on:click={handleBackdropClick}
		on:keydown={(e) => e.key === 'Escape' && handleBackdropClick()}
		tabindex="-1"
	>
		<!-- Modal content -->
		<div
			class="relative w-full max-w-2xl"
			role="document"
			on:click|stopPropagation
			on:keydown|stopPropagation
			in:scale={{ start: 0.95, opacity: 0, duration: 250, easing: cubicOut }}
			out:scale={{ start: 0.98, opacity: 0, duration: 150, easing: cubicOut }}
		>
			<div class="overflow-hidden rounded-2xl bg-white shadow-2xl">
				<!-- Header -->
				<div class="border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white px-6 py-4">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="rounded-lg bg-orange-100 p-2 text-orange-600">
								<svg
									class="h-5 w-5"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									viewBox="0 0 24 24"
								>
									{@html getIcon()}
								</svg>
							</div>
							<h3 class="text-lg font-semibold text-gray-900">{title}</h3>
						</div>
						<button
							on:click={handleBackdropClick}
							class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
							aria-label="Cerrar"
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

					<!-- Search -->
					<div class="relative mt-4">
						<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
						</div>
						<input
							bind:this={searchInput}
							type="text"
							bind:value={searchQuery}
							placeholder={searchPlaceholder}
							class="w-full rounded-xl border border-gray-200 bg-white py-2.5 pr-4 pl-10 text-sm text-gray-900 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
						/>
					</div>
				</div>

				<!-- List -->
				<div class="max-h-[60vh] overflow-y-auto">
					{#if filteredItems.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<div class="mb-3 rounded-full bg-gray-100 p-3 text-gray-400">
								<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
							<p class="text-sm font-medium text-gray-900">{emptyMessage}</p>
							<p class="mt-1 text-xs text-gray-500">Intenta con otro término de búsqueda</p>
						</div>
					{:else}
						<div class="divide-y divide-gray-100">
							{#each filteredItems as item (item.value)}
								<button
									on:click={() => handleSelect(item.value)}
									class="group flex w-full items-center justify-between px-6 py-3.5 text-left transition-colors hover:bg-orange-50"
								>
									<span
										class="text-sm font-medium transition-colors {item.value === selectedValue
											? 'text-orange-600'
											: 'text-gray-900 group-hover:text-orange-600'}"
									>
										{item.label}
									</span>
									{#if item.value === selectedValue}
										<svg
											class="h-5 w-5 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2.5"
												d="M5 13l4 4L19 7"
											/>
										</svg>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Footer -->
				{#if filteredItems.length > 0}
					<div class="border-t border-gray-200 bg-gray-50 px-6 py-3">
						<p class="text-xs text-gray-500">
							{filteredItems.length}
							{filteredItems.length === 1 ? 'resultado' : 'resultados'}
							{#if searchQuery}encontrados{/if}
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
