<script lang="ts">
	import { tick } from 'svelte';

	type Opcion = {
		value: string;
		label: string;
		labelSecundario?: string;
		labelTerciario?: string;
		searchLabel?: string;
	};

	type Props = {
		opciones: Opcion[];
		valor: string | null;
		placeholder?: string;
		placeholderBusqueda?: string;
		deshabilitado?: boolean;
		onSeleccionar: (valor: string | null) => void;
	};

	let {
		opciones,
		valor,
		placeholder = 'Seleccionar…',
		placeholderBusqueda = 'Buscar…',
		deshabilitado = false,
		onSeleccionar
	}: Props = $props();

	let abierto = $state(false);
	let busqueda = $state('');
	let highlightIndex = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);
	let wrapperEl: HTMLDivElement | null = $state(null);
	let dropdownId = `dropdown-${Math.random().toString(36).slice(2, 9)}`;

	let opcionesFiltradas = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		if (!q) return opciones;
		return opciones.filter((o) =>
			(o.searchLabel || `${o.label} ${o.labelSecundario || ''}`).toLowerCase().includes(q)
		);
	});

	let seleccionado = $derived(opciones.find((o) => o.value === valor) || null);

	let isPlaceholder = $derived(seleccionado === null);
	let isEmpty = $derived(opcionesFiltradas.length === 0);

	$effect(() => {
		if (busqueda !== undefined) highlightIndex = 0;
	});

	async function scrollHighlightedIntoView() {
		await tick();
		const container = document.getElementById(dropdownId);
		if (!container) return;
		const items = container.querySelectorAll('[data-dropdown-item]');
		items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (deshabilitado) return;

		if (e.key === 'ArrowDown' || (!abierto && (e.key === 'Enter' || e.key === ' '))) {
			e.preventDefault();
			abierto = true;
			if (e.key === 'ArrowDown') {
				highlightIndex = Math.min(highlightIndex + 1, opcionesFiltradas.length - 1);
				scrollHighlightedIntoView();
			}
		} else if (e.key === 'ArrowUp' && abierto) {
			e.preventDefault();
			highlightIndex = Math.max(highlightIndex - 1, 0);
			scrollHighlightedIntoView();
		} else if (e.key === 'Enter' && abierto && opcionesFiltradas.length > 0) {
			e.preventDefault();
			const opt = opcionesFiltradas[highlightIndex];
			if (opt) {
				onSeleccionar(opt.value);
				abierto = false;
				busqueda = '';
			}
		} else if (e.key === 'Escape' && abierto) {
			abierto = false;
			highlightIndex = 0;
		} else if (e.key === 'Backspace' && !abierto && seleccionado && busqueda === '') {
			onSeleccionar(null);
		}
	}

	function seleccionarOpcion(opt: Opcion) {
		onSeleccionar(opt.value);
		abierto = false;
		busqueda = '';
		highlightIndex = 0;
	}

	function limpiar() {
		onSeleccionar(null);
		abierto = false;
		busqueda = '';
		highlightIndex = 0;
		inputEl?.focus();
	}
</script>

<div class="relative w-full" class:opacity-60={deshabilitado} bind:this={wrapperEl}>
	<div
		class="apple-transition flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2
			{abierto ? 'border-orange-500 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-300'}
			{deshabilitado ? 'cursor-not-allowed bg-gray-100' : 'cursor-text'}"
		onclick={() => {
			if (!deshabilitado) {
				abierto = true;
				inputEl?.focus();
			}
		}}
		onkeydown={handleKeydown}
		role="combobox"
		aria-expanded={abierto}
		aria-controls={dropdownId}
		aria-haspopup="listbox"
		tabindex={-1}
	>
		{#if isPlaceholder || !seleccionado}
			<span class="flex-1 truncate text-sm text-gray-400">{placeholder}</span>
		{:else}
			<div class="flex min-w-0 flex-1 items-baseline gap-1.5">
				{#if seleccionado.labelSecundario}
					<span class="truncate text-[10px] text-gray-400">{seleccionado.labelSecundario}</span>
				{/if}
			</div>
		{/if}

		{#if valor}
			<button
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					limpiar();
				}}
				class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
				aria-label="Limpiar selección"
				tabindex={-1}
			>
				<svg
					class="h-3 w-3"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2.5"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{/if}

		<svg
			class="h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform {abierto
				? 'rotate-180'
				: ''}"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			stroke-width="2"
		>
			<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
		</svg>
	</div>

	<input
		bind:this={inputEl}
		bind:value={busqueda}
		type="text"
		class="sr-only"
		tabindex={deshabilitado ? -1 : 0}
		placeholder={placeholderBusqueda}
		onblur={(e) => {
			const next = e.relatedTarget as Node | null;
			if (next && wrapperEl && wrapperEl.contains(next)) return;
			setTimeout(() => {
				if (wrapperEl && wrapperEl.contains(document.activeElement)) return;
				abierto = false;
			}, 150);
		}}
		onkeydown={handleKeydown}
		aria-autocomplete="list"
		aria-controls={dropdownId}
	/>

	{#if abierto}
		<div
			id={dropdownId}
			class="absolute right-0 left-0 z-[100] mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl"
			role="listbox"
		>
			<div class="sticky top-0 border-b border-gray-100 bg-white px-3 py-2">
				<div class="flex items-center gap-2">
					<input
						type="text"
						bind:value={busqueda}
						placeholder={placeholderBusqueda}
						class="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
						onkeydown={handleKeydown}
					/>
				</div>
			</div>

			{#if isEmpty}
				<div class="px-3 py-6 text-center">
					<svg
						class="mx-auto mb-1.5 h-8 w-8 text-gray-300"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
					<p class="text-xs text-gray-500">Sin resultados</p>
				</div>
			{:else}
				<div class="py-1">
					{#each opcionesFiltradas as opcion, i (opcion.value)}
						{@const isHighlighted = highlightIndex === i}
						{@const isSelected = opcion.value === valor}
						<button
							type="button"
							data-dropdown-item
							onclick={() => seleccionarOpcion(opcion)}
							onmouseenter={() => (highlightIndex = i)}
							role="option"
							aria-selected={isSelected}
							class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors
								{isHighlighted ? 'bg-orange-50' : 'bg-white hover:bg-gray-50'}
								{isSelected ? 'bg-orange-50/70' : ''}"
						>
							<div class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-[13px] leading-tight font-semibold text-gray-900"
									>{opcion.label}</span
								>
								{#if opcion.labelSecundario}
									<span
										class="truncate text-[10px] leading-tight tracking-wide {opcion.labelSecundario.startsWith(
											'Sin '
										) ||
										opcion.labelSecundario.includes('sin ') ||
										opcion.labelSecundario.startsWith('Conductor sin')
											? 'text-gray-300 italic'
											: 'text-gray-500'}">{opcion.labelSecundario}</span
									>
								{/if}
							</div>
							{#if isSelected}
								<svg
									class="h-4 w-4 flex-shrink-0 text-orange-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2.5"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
