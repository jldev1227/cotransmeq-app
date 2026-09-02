<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { tick } from 'svelte';
	import { liquidacionesTercerosOcasionalAPI, type TerceroCandidato } from '$lib/api/liquidaciones-terceros-ocasional';

	export let isOpen = false;
	export let mes: number;
	export let anio: number;
	export let onClose: () => void = () => { isOpen = false; };
	export let onConfirm: (tercerosSeleccionados: TerceroCandidato[]) => void = () => {};

	type FiltroTipo = 'documento' | 'placa' | 'nombre';
	let filtroTipo: FiltroTipo = 'nombre';
	let busqueda = '';
	let loading = false;
	let terceros: TerceroCandidato[] = [];
	let selected = new Set<string>();
	let searchInput: HTMLInputElement;

	$: if (isOpen && searchInput) {
		tick().then(() => searchInput?.focus());
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	$: if (isOpen && mes && anio) {
		loadTerceros();
	}
	$: busqueda, scheduleSearch();

	function scheduleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(loadTerceros, 250);
	}

	async function loadTerceros() {
		loading = true;
		try {
			const r = await liquidacionesTercerosOcasionalAPI.buscarTercerosCandidatos({
				mes,
				anio,
				busqueda,
				filtro_tipo: filtroTipo
			});
			terceros = r.items;
		} catch (e) {
			console.error('[modal-terceros-ocasionales] loadTerceros error', e);
			terceros = [];
		} finally {
			loading = false;
		}
	}

	function toggle(t: TerceroCandidato) {
		if (selected.has(t.tercero_id)) {
			selected.delete(t.tercero_id);
		} else {
			selected.add(t.tercero_id);
		}
		selected = new Set(selected);
	}

	function toggleAll() {
		if (terceros.every((t) => selected.has(t.tercero_id))) {
			selected = new Set();
		} else {
			selected = new Set(terceros.map((t) => t.tercero_id));
		}
	}

	function handleConfirm() {
		const picked = terceros.filter((t) => selected.has(t.tercero_id));
		onConfirm(picked);
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'Enter' && selected.size > 0) {
			e.preventDefault();
			handleConfirm();
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		on:click={onClose}
		on:keydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
			on:click|stopPropagation
			role="document"
			transition:scale={{ duration: 200, easing: cubicOut, start: 0.95 }}
		>
			<!-- Header -->
			<div class="flex items-center gap-3 border-b border-gray-100 p-5">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600">
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<h2 class="text-base font-bold text-gray-900">Seleccionar terceros ocasionales</h2>
					<p class="text-xs text-gray-500">
						Mes {mes}/{anio} — elige los terceros que deseas incluir en la liquidación mensual
					</p>
				</div>
				<button
					class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
					on:click={onClose}
					aria-label="Cerrar"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Filtros -->
			<div class="space-y-3 border-b border-gray-100 p-5">
				<!-- Tabs de filtro -->
				<div class="flex gap-1 rounded-xl bg-gray-100 p-1">
					{#each [
						{ value: 'nombre' as FiltroTipo, label: 'Nombre' },
						{ value: 'documento' as FiltroTipo, label: 'NIT / Documento' },
						{ value: 'placa' as FiltroTipo, label: 'Placa' }
					] as opt}
						<button
							class="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors {filtroTipo === opt.value
								? 'bg-white text-orange-700 shadow-sm'
								: 'text-gray-600 hover:text-gray-900'}"
							on:click={() => (filtroTipo = opt.value)}
							type="button"
						>
							{opt.label}
						</button>
					{/each}
				</div>

				<!-- Búsqueda -->
				<div class="relative">
					<svg
						class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						bind:this={searchInput}
						bind:value={busqueda}
						type="text"
						placeholder={filtroTipo === 'documento'
							? 'Buscar por NIT o número de documento...'
							: filtroTipo === 'placa'
								? 'Buscar por placa...'
								: 'Buscar por nombre del tercero...'}
						class="input-glow apple-transition w-full rounded-xl border border-gray-200 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400"
					/>
				</div>

				<!-- Hint -->
				<p class="text-[10px] text-gray-500">
					Búsqueda insensible a mayúsculas. Aparecen terceros con items pendientes de cierre en este mes.
				</p>
			</div>

			<!-- Lista -->
			<div class="max-h-96 overflow-y-auto p-3">
				{#if loading}
					<div class="flex items-center justify-center py-12">
						<div class="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
					</div>
				{:else if terceros.length === 0}
					<div class="flex flex-col items-center justify-center py-12 text-center">
						<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
							<svg class="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
						</div>
						<p class="text-sm font-semibold text-gray-900">Sin terceros</p>
						<p class="text-xs text-gray-500">No hay items pendientes de cierre para este filtro en {mes}/{anio}.</p>
					</div>
				{:else}
					<div class="space-y-1">
						{#if terceros.length > 1}
							<button
								class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-orange-700 hover:bg-orange-50"
								on:click={toggleAll}
								type="button"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
								</svg>
								{terceros.every((t) => selected.has(t.tercero_id))
									? 'Deseleccionar todos'
									: 'Seleccionar todos'}
							</button>
						{/if}
						{#each terceros as t (t.tercero_id)}
							{@const isSelected = selected.has(t.tercero_id)}
							{@const hasBlocked = t.cierres_bloqueados > 0}
							<button
								class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors {isSelected
									? 'border-orange-300 bg-orange-50'
									: 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}"
								on:click={() => toggle(t)}
								type="button"
							>
								<div
									class="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 {isSelected
										? 'border-orange-500 bg-orange-500 text-white'
										: 'border-gray-300 bg-white'}"
								>
									{#if isSelected}
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<p class="truncate text-sm font-semibold text-gray-900">
											{t.tercero_nombre}
										</p>
										{#if hasBlocked}
											<span
												class="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700"
											>
												{t.cierres_bloqueados} bloqueado{t.cierres_bloqueados > 1 ? 's' : ''}
											</span>
										{/if}
									</div>
									<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
										{#if t.tercero_documento}
											<span>
												<span class="font-medium text-gray-600">Doc:</span>
												{t.tercero_documento}
											</span>
										{/if}
										<span>
											<span class="font-medium text-gray-600">Placas:</span>
											{t.placas.join(', ')}
										</span>
										<span>
											<span class="font-medium text-gray-600">Cierres:</span>
											{t.cierres_count}
										</span>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50/50 p-4">
				<p class="text-xs text-gray-600">
					<span class="font-semibold text-gray-900">{selected.size}</span>
					{selected.size === 1 ? 'tercero seleccionado' : 'terceros seleccionados'}
				</p>
				<div class="flex items-center gap-2">
					<button
						class="apple-transition rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						on:click={onClose}
						type="button"
					>
						Cancelar
					</button>
					<button
						class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
						on:click={handleConfirm}
						disabled={selected.size === 0}
						type="button"
					>
						Generar borrador ({selected.size})
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
