<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { clickOutside } from '$lib/utils/clickOutside';

	// Props
	export let value = '';
	export let label = '';
	export let placeholder = 'Buscar ubicación...';
	export let required = false;
	export let disabled = false;
	export let error = '';
	export let onSelect: (data: {
		address: string;
		coordinates: [number, number];
		context: any;
		placeName: string;
	}) => void = () => {};

	// State
	let searchQuery = '';
	let suggestions: any[] = [];
	let isLoading = false;
	let showDropdown = false;
	let selectedIndex = -1;
	let searchTimeout: any;
	let inputElement: HTMLInputElement;
	let selectedData: any = null;

	// Mapbox token from env
	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

	// Initialize searchQuery with value
	$: if (value && !selectedData) {
		searchQuery = value;
	}

	// Search function
	async function searchLocations(query: string) {
		if (!query || query.length < 3) {
			suggestions = [];
			showDropdown = false;
			return;
		}

		isLoading = true;

		try {
			const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=co&language=es&types=poi,address,place,locality,neighborhood&limit=5`;

			const response = await fetch(url);
			const data = await response.json();

			if (data.features && data.features.length > 0) {
				suggestions = data.features;
				showDropdown = true;
			} else {
				suggestions = [];
				showDropdown = false;
			}
		} catch (error) {
			console.error('Error searching locations:', error);
			suggestions = [];
			showDropdown = false;
		} finally {
			isLoading = false;
		}
	}

	// Handle input change
	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
		value = target.value;
		selectedIndex = -1;
		selectedData = null; // Reset selected data when user types

		// Debounce search
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchLocations(searchQuery);
		}, 300);
	}

	// Handle suggestion selection
	function selectSuggestion(suggestion: any) {
		const coordinates: [number, number] = suggestion.center;
		const placeName = suggestion.place_name;
		const address = suggestion.text || suggestion.place_name;
		const context = suggestion.context || [];

		// Update state
		selectedData = suggestion;
		searchQuery = placeName;
		value = placeName;
		showDropdown = false;
		suggestions = [];

		// Call callback
		onSelect({
			address,
			coordinates,
			context,
			placeName
		});
	}

	// Handle keyboard navigation
	function handleKeydown(e: KeyboardEvent) {
		if (!showDropdown || suggestions.length === 0) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				break;
			case 'Enter':
				e.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
					selectSuggestion(suggestions[selectedIndex]);
				}
				break;
			case 'Escape':
				showDropdown = false;
				break;
		}
	}

	// Clear search
	function clearSearch() {
		searchQuery = '';
		value = '';
		selectedData = null;
		suggestions = [];
		showDropdown = false;
		inputElement?.focus();
	}

	// Close dropdown
	function closeDropdown() {
		showDropdown = false;
	}
</script>

{#if label}
	<label for="mapbox-search-input" class="mb-2 block text-sm font-semibold text-gray-700">
		{label}
		{#if required}
			<span class="text-red-500">*</span>
		{/if}
	</label>
{/if}

<div class="relative" use:clickOutside={closeDropdown}>
	<div class="relative h-12 w-full">
		<!-- Search Icon -->
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

		<!-- Input -->
		<input
			bind:this={inputElement}
			id="mapbox-search-input"
			type="text"
			bind:value={searchQuery}
			on:input={handleInput}
			on:keydown={handleKeydown}
			on:focus={() => {
				if (suggestions.length > 0) showDropdown = true;
			}}
			{placeholder}
			{disabled}
			class="h-full w-full rounded-lg border {error
				? 'border-red-300'
				: 'border-gray-300'} bg-white px-12 text-sm text-gray-900 placeholder-gray-400 transition-colors duration-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		/>

		<!-- Loading/Clear Icon -->
		<div class="absolute top-1/2 right-3 -translate-y-1/2">
			{#if isLoading}
				<svg
					class="h-5 w-5 animate-spin text-gray-400"
					fill="none"
					viewBox="0 0 24 24"
					transition:fade={{ duration: 150 }}
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
			{:else if searchQuery}
				<button
					type="button"
					on:click={clearSearch}
					class="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					transition:fade={{ duration: 150 }}
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- Dropdown -->
	{#if showDropdown && suggestions.length > 0}
		<div
			class="absolute top-full right-0 left-0 z-[99999] mt-2 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
			transition:slide={{ duration: 200 }}
		>
			<ul class="py-1">
				{#each suggestions as suggestion, index}
					<li>
						<button
							type="button"
							on:click={() => selectSuggestion(suggestion)}
							class="w-full px-4 py-3 text-left transition-colors hover:bg-orange-50 {selectedIndex ===
							index
								? 'bg-orange-50'
								: ''}"
						>
							<div class="font-semibold text-gray-900">
								{suggestion.text}
							</div>
							<div class="mt-0.5 text-sm text-gray-500">
								{suggestion.place_name}
							</div>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<!-- Error message -->
{#if error}
	<p class="mt-1 text-sm text-red-600">{error}</p>
{/if}

{#if !MAPBOX_TOKEN}
	<div
		class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
		transition:fade
	>
		<div class="flex items-center gap-2">
			<svg class="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
			<span
				>Token de Mapbox no configurado. Por favor configura VITE_MAPBOX_ACCESS_TOKEN en tu archivo
				.env</span
			>
		</div>
	</div>
{/if}

<style>
	/* Scrollbar personalizado para el dropdown */
	div::-webkit-scrollbar {
		width: 6px;
	}

	div::-webkit-scrollbar-track {
		background: #f1f1f1;
		border-radius: 3px;
	}

	div::-webkit-scrollbar-thumb {
		background: #d1d5db;
		border-radius: 3px;
	}

	div::-webkit-scrollbar-thumb:hover {
		background: #9ca3af;
	}
</style>
