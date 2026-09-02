<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { clickOutside } from '$lib/utils/clickOutside';

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

	// Sugerencia devuelta por /api/maps/autocomplete (HERE).
	// NO incluye coordenadas: HERE Autocomplete no devuelve `position`.
	// Las coordenadas se obtienen en un 2º paso via /api/maps/lookup?id=...
	interface AutocompleteSuggestion {
		id: string;
		title: string;
		subtitle: string;
		address: string;
	}

	interface LookupResult {
		id: string;
		title: string;
		address: string;
		city?: string;
		county?: string;
		country?: string;
		lat: number;
		lng: number;
	}

	let searchQuery = '';
	let suggestions: AutocompleteSuggestion[] = [];
	let isLoading = false;
	let isLookingUp = false;
	let lookupError = '';
	let showDropdown = false;
	let selectedIndex = -1;
	let searchTimeout: ReturnType<typeof setTimeout>;
	let inputElement: HTMLInputElement;
	let selectedData: AutocompleteSuggestion | null = null;

	let showManualMode = false;
	let manualNombre = '';
	let manualLat = '';
	let manualLng = '';
	let manualCategoria = '';
	let manualError = '';
	let savingPlace = false;
	let savePlaceError = '';

	$: if (value && !selectedData && !searchQuery) {
		searchQuery = value;
	}

	async function buscarLugares(query: string) {
		if (!query || query.trim().length < 3) {
			suggestions = [];
			showDropdown = false;
			return;
		}
		isLoading = true;
		try {
			const res = await fetch(
				`/api/maps/autocomplete?q=${encodeURIComponent(query.trim())}&limit=8&countryCode=COL&lang=es`
			);
			const data = await res.json();
			if (Array.isArray(data?.results) && data.results.length > 0) {
				suggestions = data.results;
				showDropdown = true;
			} else {
				suggestions = [];
				showDropdown = false;
			}
		} catch (e) {
			console.error('[AddressSearch] autocomplete error:', e);
			suggestions = [];
			showDropdown = false;
		} finally {
			isLoading = false;
		}
	}

	async function fetchLookup(id: string): Promise<LookupResult | null> {
		try {
			const res = await fetch(
				`/api/maps/lookup?id=${encodeURIComponent(id)}&lang=es`
			);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.error ?? `HTTP ${res.status}`);
			}
			return (await res.json()) as LookupResult;
		} catch (e: any) {
			console.error('[AddressSearch] lookup error:', e);
			return null;
		}
	}

	async function seleccionarSugerencia(item: AutocompleteSuggestion) {
		selectedData = item;
		searchQuery = item.address || item.title;
		value = item.address || item.title;
		suggestions = [];
		showDropdown = false;
		selectedIndex = -1;
		lookupError = '';

		isLookingUp = true;
		const detail = await fetchLookup(item.id);
		isLookingUp = false;

		if (!detail) {
			lookupError = 'No pudimos obtener las coordenadas. Intenta con otro lugar o ingrésalas manualmente.';
			return;
		}

		const coordinates: [number, number] = [detail.lng, detail.lat];
		onSelect({
			address: item.title,
			coordinates,
			context: {
				subtitle: item.subtitle,
				id: item.id,
				resultType: detail.title,
				city: detail.city,
				county: detail.county,
				country: detail.country
			},
			placeName: item.address
		});
	}

	async function confirmarManual() {
		manualError = '';
		lookupError = '';
		savePlaceError = '';
		const lat = parseFloat(manualLat.replace(',', '.'));
		const lng = parseFloat(manualLng.replace(',', '.'));

		if (!manualNombre.trim()) {
			manualError = 'El nombre del lugar es obligatorio.';
			return;
		}
		if (isNaN(lat) || lat < -90 || lat > 90) {
			manualError = 'Latitud inválida. Ejemplo para Colombia: 5.353627';
			return;
		}
		if (isNaN(lng) || lng < -180 || lng > 180) {
			manualError = 'Longitud inválida. Ejemplo para Colombia: -72.398956';
			return;
		}

		const placeName = manualNombre.trim();
		searchQuery = placeName;
		value = placeName;
		selectedData = null;
		const savedCategoria = manualCategoria || null;
		showManualMode = false;
		manualNombre = '';
		manualLat = '';
		manualLng = '';
		manualCategoria = '';

		// 1) Notificar al padre inmediatamente (UX no espera al backend)
		onSelect({
			address: placeName,
			coordinates: [lng, lat],
			context: { source: 'manual', categoria: savedCategoria },
			placeName
		});

		// 2) Guardar en la base de datos en background.
		// Si falla, NO revertimos: el lugar ya está usable localmente.
		// Solo informamos al usuario.
		savingPlace = true;
		try {
			const res = await fetch('/api/maps/custom-place', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					nombre: placeName,
					latitud: lat,
					longitud: lng,
					categoria: savedCategoria
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				// 401: usuario no logueado → guardado anónimo, no pasa nada
				if (res.status !== 401) {
					console.warn('[AddressSearch] No se pudo guardar el lugar:', err?.error);
					savePlaceError = err?.error || 'No se pudo guardar el lugar para futuros usos';
				}
			}
		} catch (e) {
			console.warn('[AddressSearch] Error guardando lugar:', e);
		} finally {
			savingPlace = false;
		}
	}

	function cancelarManual() {
		showManualMode = false;
		manualNombre = '';
		manualLat = '';
		manualLng = '';
		manualCategoria = '';
		manualError = '';
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
		value = target.value;
		selectedIndex = -1;
		selectedData = null;
		lookupError = '';
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => buscarLugares(searchQuery), 300);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!showDropdown || !suggestions.length) return;
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
				if (selectedIndex >= 0) seleccionarSugerencia(suggestions[selectedIndex]);
				break;
			case 'Escape':
				showDropdown = false;
				break;
		}
	}

	function clearSearch() {
		searchQuery = '';
		value = '';
		selectedData = null;
		suggestions = [];
		showDropdown = false;
		lookupError = '';
		savePlaceError = '';
		inputElement?.focus();
	}

	function closeDropdown() {
		showDropdown = false;
	}
</script>

{#if label}
	<label for="address-search-input" class="mb-2 block text-sm font-semibold text-gray-700">
		{label}
		{#if required}<span class="text-red-500">*</span>{/if}
	</label>
{/if}

<div class="relative" use:clickOutside={closeDropdown}>
	{#if !showManualMode}
		<div class="relative h-12 w-full">
			<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
				</svg>
			</div>

			<input
				bind:this={inputElement}
				id="address-search-input"
				type="text"
				bind:value={searchQuery}
				on:input={handleInput}
				on:keydown={handleKeydown}
				on:focus={() => { if (suggestions.length > 0) showDropdown = true; }}
				{placeholder}
				{disabled}
				class="h-full w-full rounded-lg border {error || lookupError
					? 'border-red-300'
					: 'border-gray-300'} bg-white px-12 text-sm text-gray-900 placeholder-gray-400 transition-colors duration-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
			/>

			<div class="absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1">
				{#if isLoading || isLookingUp}
					<svg class="h-4 w-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24" transition:fade={{ duration: 150 }}>
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
					</svg>
				{:else if searchQuery}
					<button
						type="button"
						on:click={clearSearch}
						class="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
						transition:fade={{ duration: 150 }}
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}

				<button
					type="button"
					on:click={() => { showManualMode = true; showDropdown = false; }}
					title="Ingresar nombre y coordenadas manualmente"
					class="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 transition-colors hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600"
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
					</svg>
				</button>
			</div>
		</div>

		{#if showDropdown && suggestions.length > 0}
			<div
				class="absolute top-full right-0 left-0 z-[99999] mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
				transition:slide={{ duration: 200 }}
			>
				<ul class="py-1">
					{#each suggestions as item, index}
						<li>
							<button
								type="button"
								on:click={() => seleccionarSugerencia(item)}
								class="w-full px-4 py-3 text-left transition-colors hover:bg-orange-50 {selectedIndex === index ? 'bg-orange-50' : ''}"
							>
								<div class="font-semibold text-gray-900">{item.title}</div>
								{#if item.subtitle}
									<div class="mt-0.5 text-sm text-gray-500">{item.subtitle}</div>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
				<div class="border-t border-gray-100 px-4 py-2">
					<button
						type="button"
						on:click={() => { showDropdown = false; showManualMode = true; }}
						class="flex w-full items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-orange-600"
					>
						<svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						¿No encuentras el lugar? Ingresa las coordenadas manualmente
					</button>
				</div>
			</div>
		{/if}

		{#if lookupError}
			<p
				class="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600"
				transition:fade={{ duration: 150 }}
			>
				<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				{lookupError}
			</p>
		{/if}

		{#if savingPlace}
			<p
				class="mt-2 flex items-center gap-1.5 text-xs text-orange-700"
				transition:fade={{ duration: 150 }}
			>
				<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
				</svg>
				Guardando lugar para futuros usos…
			</p>
		{/if}

		{#if savePlaceError}
			<p
				class="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"
				transition:fade={{ duration: 150 }}
			>
				<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
				</svg>
				<span>
					{savePlaceError}.
					<span class="opacity-80">El lugar se usó igual, pero no se guardó para búsquedas futuras.</span>
				</span>
			</p>
		{/if}
	{:else}
		<div class="rounded-xl border border-orange-200 bg-orange-50/60 p-4 shadow-sm" transition:slide={{ duration: 200 }}>
			<div class="mb-3 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<svg class="h-4 w-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
					</svg>
					<span class="text-xs font-semibold text-orange-800">Ingresar coordenadas manualmente</span>
				</div>
				<button
					type="button"
					on:click={cancelarManual}
					class="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white hover:text-gray-600"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="space-y-3">
				<div>
					<label class="mb-1 block text-xs font-medium text-gray-600">
						Nombre del lugar <span class="text-red-500">*</span>
					</label>
					<input
						type="text"
						bind:value={manualNombre}
						placeholder="Ej: Pozo Rubiales, Campamento El Jardín, Patio de tanques..."
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
					/>
				</div>

				<div>
					<label class="mb-1 block text-xs font-medium text-gray-600">
						Categoría <span class="text-gray-400 font-normal">(opcional, ayuda a clasificar)</span>
					</label>
					<select
						bind:value={manualCategoria}
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
					>
						<option value="">Sin categoría</option>
						<option value="POZO">Pozo petrolero</option>
						<option value="CAMPAMENTO">Campamento</option>
						<option value="PATIO">Patio de tanques</option>
						<option value="VEREDA">Vereda</option>
						<option value="FINCA">Finca</option>
						<option value="BASE">Base operativa</option>
						<option value="ESTACION">Estación</option>
						<option value="OTRO">Otro</option>
					</select>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<div>
						<label class="mb-1 block text-xs font-medium text-gray-600">
							Latitud <span class="text-red-500">*</span>
							<span class="text-gray-400 font-normal"> (ej: 5.3536)</span>
						</label>
						<input
							type="text"
							bind:value={manualLat}
							placeholder="5.353627"
							inputmode="decimal"
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs font-medium text-gray-600">
							Longitud <span class="text-red-500">*</span>
							<span class="text-gray-400 font-normal"> (ej: -72.398)</span>
						</label>
						<input
							type="text"
							bind:value={manualLng}
							placeholder="-72.398956"
							inputmode="decimal"
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
						/>
					</div>
				</div>

				<p class="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
					<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Para obtener las coordenadas: abre Google Maps o Bing Maps, haz clic derecho sobre el punto y selecciona <strong>"¿Qué hay aquí?"</strong>. Verás la latitud y longitud en la parte inferior.
				</p>

				{#if manualError}
					<p class="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" transition:fade={{ duration: 150 }}>
						<svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						{manualError}
					</p>
				{/if}

				<div class="flex gap-2 pt-0.5">
					<button
						type="button"
						on:click={cancelarManual}
						class="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
					>
						Cancelar
					</button>
					<button
						type="button"
						on:click={confirmarManual}
						class="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
						Confirmar ubicación
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

{#if error}
	<p class="mt-1 text-sm text-red-600">{error}</p>
{/if}

<style>
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
