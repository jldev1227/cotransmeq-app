<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { tick } from 'svelte';
	import { apiClient } from '$lib/api/apiClient';

	export let isOpen = false;
	export let selectedValue: string = '';
	export let onClose: () => void = () => { isOpen = false; };
	export let onSelect: (conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string }) => void;
	export let title = 'Seleccionar Conductor';
	export let searchPlaceholder = 'Buscar por nombre o identificación...';

	interface Conductor {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
	}

	let searchQuery = '';
	let searchInput: HTMLInputElement;
	let highlightedIndex = 0;
	let listContainer: HTMLDivElement;
	let conductores: Conductor[] = [];
	let loading = false;
	let loaded = false;

	$: filteredItems = conductores
		.filter((c) => {
			const full = `${c.nombre} ${c.apellido} ${c.numero_identificacion}`.toLowerCase();
			return full.includes(searchQuery.toLowerCase());
		})
		.map((c) => ({
			value: c.id,
			label: `${c.nombre} ${c.apellido}`,
			sublabel: c.numero_identificacion || '',
		}));

	$: if (filteredItems) {
		highlightedIndex = 0;
	}

	$: if (isOpen && searchInput) {
		tick().then(() => {
			searchInput?.focus();
			searchQuery = '';
			highlightedIndex = 0;
		});
	}

	$: if (isOpen && !loaded) {
		loadConductores();
	}

	async function loadConductores() {
		loading = true;
		try {
			const res = await apiClient.get('/api/conductores', {
				params: { limit: 500 }
			});
			conductores = res.data?.data || res.data || [];
			loaded = true;
		} catch (e) {
			console.error('Error cargando conductores:', e);
		} finally {
			loading = false;
		}
	}

	function scrollToHighlighted() {
		tick().then(() => {
			if (!listContainer) return;
			const highlighted = listContainer.querySelector('[data-highlighted="true"]');
			if (highlighted) {
				highlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (filteredItems.length === 0) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = (highlightedIndex + 1) % filteredItems.length;
				scrollToHighlighted();
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = (highlightedIndex - 1 + filteredItems.length) % filteredItems.length;
				scrollToHighlighted();
				break;
			case 'Enter':
				e.preventDefault();
				if (filteredItems[highlightedIndex]) {
					const conductor = conductores.find(c => c.id === filteredItems[highlightedIndex].value);
					if (conductor) handleSelect(conductor);
				}
				break;
			case 'Escape':
				e.preventDefault();
				handleBackdropClick();
				break;
		}
	}

	function handleSelect(conductor: Conductor) {
		onSelect(conductor);
		onClose();
	}

	function handleBackdropClick() {
		onClose();
	}
</script>

{#if isOpen}
	<!-- Modal backdrop -->
	<div
		class="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		transition:fade={{ duration: 200 }}
		on:click={handleBackdropClick}
		on:keydown={(e) => e.key === 'Escape' && handleBackdropClick()}
		tabindex="-1"
	>
		<!-- Modal content -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
								<svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
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
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>

					<!-- Search -->
					<div class="relative mt-4">
						<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
							</svg>
						</div>
						<input
							bind:this={searchInput}
							type="text"
							bind:value={searchQuery}
							placeholder={searchPlaceholder}
							on:keydown={handleKeydown}
							class="w-full rounded-xl border border-gray-200 bg-white py-2.5 pr-4 pl-10 text-sm text-gray-900 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
						/>
					</div>
				</div>

				<!-- List -->
				<div class="max-h-[60vh] overflow-y-auto" bind:this={listContainer}>
					{#if loading}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<div class="spinner"></div>
							<p class="mt-3 text-sm font-medium text-gray-500">Cargando conductores...</p>
						</div>
					{:else if filteredItems.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<div class="mb-3 rounded-full bg-gray-100 p-3 text-gray-400">
								<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</div>
							<p class="text-sm font-medium text-gray-900">No se encontraron conductores</p>
							<p class="mt-1 text-xs text-gray-500">Intenta con otro término de búsqueda</p>
						</div>
					{:else}
						<div class="divide-y divide-gray-100">
							{#each filteredItems as item, i (item.value)}
								<button
									on:click={() => {
										const conductor = conductores.find(c => c.id === item.value);
										if (conductor) handleSelect(conductor);
									}}
									on:mouseenter={() => (highlightedIndex = i)}
									data-highlighted={i === highlightedIndex}
									class="group flex w-full items-center justify-between px-6 py-3.5 text-left transition-colors {i === highlightedIndex ? 'bg-orange-50' : 'hover:bg-orange-50'}"
								>
									<div>
										<span
											class="text-sm font-medium transition-colors {item.value === selectedValue
												? 'text-orange-600'
												: i === highlightedIndex
													? 'text-orange-600'
													: 'text-gray-900 group-hover:text-orange-600'}"
										>
											{item.label}
										</span>
										{#if item.sublabel}
											<span class="ml-2 text-xs text-gray-400">{item.sublabel}</span>
										{/if}
									</div>
									{#if item.value === selectedValue}
										<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
										</svg>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Footer -->
				{#if filteredItems.length > 0 && !loading}
					<div class="border-t border-gray-200 bg-gray-50 px-6 py-3">
						<p class="text-xs text-gray-500">
							{filteredItems.length}
							{filteredItems.length === 1 ? 'resultado' : 'resultados'}
							{#if searchQuery} encontrados{/if}
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #e2e8f0;
		border-top-color: #ea580c;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
