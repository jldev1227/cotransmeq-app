<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	export let selected: string[] = [];
	export let options: string[] = [];
	export let placeholder = 'Todos';
	export let labelFn: (v: string) => string = (v) => v;
	export let searchable = false;
	export let iconOnly = false;

	const dispatch = createEventDispatcher();
	let open = false;
	let searchInput = '';
	let triggerEl: HTMLElement | null = null;
	let dropdownStyle = '';

	function toggle(value: string) {
		if (selected.includes(value)) {
			selected = selected.filter((v) => v !== value);
		} else {
			selected = [...selected, value];
		}
		dispatch('change', selected);
	}

	function clearAll() {
		selected = [];
		dispatch('change', selected);
	}

	function openDropdown() {
		open = !open;
		searchInput = '';
		if (open && triggerEl) {
			const rect = triggerEl.getBoundingClientRect();
			const spaceBelow = window.innerHeight - rect.bottom;
			const spaceRight = window.innerWidth - rect.left;
			let top = rect.bottom + 2;
			let left = rect.left;
			// If not enough space below, open upward
			if (spaceBelow < 220) top = rect.top - 220;
			// If not enough space to the right, align right edge
			if (spaceRight < 200) left = rect.right - 200;
			dropdownStyle = `position:fixed;top:${top}px;left:${left}px;z-index:9999;`;
		}
	}

	$: filteredOptions = searchable && searchInput
		? options.filter((o) => labelFn(o).toLowerCase().includes(searchInput.toLowerCase()))
		: options;

	$: label = selected.length === 0
		? placeholder
		: selected.length === 1
		? labelFn(selected[0])
		: `${selected.length} selec.`;

	$: isActive = selected.length > 0;
</script>

<div class="relative inline-block">
	{#if iconOnly}
		<button
			type="button"
			bind:this={triggerEl}
			on:click|stopPropagation={openDropdown}
			class="inline-flex items-center justify-center rounded p-0.5 transition-colors
				{isActive ? 'text-orange-600' : 'text-gray-400 hover:text-gray-600'}"
			title={isActive ? `Filtrado: ${label}` : 'Filtrar'}
		>
			<svg class="h-3.5 w-3.5" fill="{isActive ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
			</svg>
			{#if isActive}
				<span class="ml-0.5 text-[9px] font-bold text-orange-600">{selected.length}</span>
			{/if}
		</button>
	{:else}
		<button
			type="button"
			bind:this={triggerEl}
			on:click|stopPropagation={openDropdown}
			class="flex w-full items-center justify-between gap-1 rounded border px-1 py-0.5 text-[11px] focus:outline-none
				{isActive ? 'border-orange-400 bg-orange-50 text-orange-700 font-semibold' : 'border-gray-300 bg-white text-gray-600'}"
		>
			<span class="truncate">{label}</span>
			<svg class="h-3 w-3 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>
	{/if}

	{#if open}
		<button type="button" class="fixed inset-0 z-[9998]" aria-label="Cerrar" on:click={() => (open = false)}></button>

		<div class="min-w-[180px] rounded border border-gray-200 bg-white shadow-lg" style={dropdownStyle}>

			{#if searchable}
				<div class="border-b border-gray-100 p-1.5">
					<input
						type="text"
						bind:value={searchInput}
						on:click|stopPropagation
						placeholder="Buscar..."
						class="w-full rounded border border-gray-300 px-2 py-0.5 text-[11px] focus:border-orange-400 focus:outline-none"
					/>
				</div>
			{/if}

			<div class="max-h-48 overflow-y-auto">
				{#if selected.length > 0}
					<button
						type="button"
						on:click|stopPropagation={clearAll}
						class="w-full px-2 py-1 text-left text-[11px] font-semibold text-red-500 hover:bg-red-50"
					>
						✕ Limpiar filtro
					</button>
					<hr class="border-gray-100" />
				{/if}

				{#each filteredOptions as option}
					<label class="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-orange-50">
						<input
							type="checkbox"
							checked={selected.includes(option)}
							on:change={() => toggle(option)}
							class="rounded border-gray-300 text-orange-500"
						/>
						<span class="text-[11px] text-gray-700">{labelFn(option)}</span>
					</label>
				{/each}

				{#if filteredOptions.length === 0}
					<p class="px-2 py-1 text-[11px] text-gray-400">Sin resultados</p>
				{/if}
			</div>
		</div>
	{/if}
</div>