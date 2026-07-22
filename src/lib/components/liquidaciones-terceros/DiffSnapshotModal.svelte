<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';

	export let open = false;
	export let snapshotIdA = '';
	export let snapshotIdB = '';

	let diff: Array<{ path: string; anterior: any; nuevo: any }> = [];
	let loading = false;

	$: if (open && snapshotIdA && snapshotIdB) loadDiff();

	async function loadDiff() {
		loading = true;
		try {
			const res = await liquidacionesTercerosDescuentosAPI.compararSnapshots(snapshotIdA, snapshotIdB);
			diff = res.fields || [];
		} catch (e) {
			console.error('Error loading diff:', e);
			diff = [];
		} finally {
			loading = false;
		}
	}

	function fmtValue(v: any): string {
		if (v === null || v === undefined) return '—';
		if (typeof v === 'object') return JSON.stringify(v, null, 2);
		return String(v);
	}

	function fmtPath(p: string): string {
		return p
			.replace(/\./g, ' → ')
			.replace(/_/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}
</script>

{#if open}
	<div class="fixed inset-0 z-[9600] flex items-center justify-center bg-black/40 backdrop-blur-sm" on:click={() => open = false}>
		<div class="glass soft-shadow rounded-2xl border border-gray-200/50 w-full max-w-2xl max-h-[80vh] flex flex-col" on:click|stopPropagation in:fly={{ y: 20, duration: 300 }}>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-100 px-5 py-4">
				<div class="flex items-center gap-3">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600">
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
						</svg>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-gray-900">Comparación de Versiones</h3>
						<p class="text-[10px] text-gray-500">{diff.length} campo(s) modificado(s)</p>
					</div>
				</div>
				<button class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" on:click={() => open = false}>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto px-5 py-4">
				{#if loading}
					<div class="flex flex-col items-center justify-center py-12">
						<div class="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent"></div>
						<p class="mt-3 text-xs text-gray-500">Calculando diferencias...</p>
					</div>
				{:else if diff.length === 0}
					<div class="flex flex-col items-center justify-center py-12 text-center">
						<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50">
							<svg class="h-6 w-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
							</svg>
						</div>
						<p class="mt-3 text-sm font-medium text-gray-700">Sin cambios</p>
						<p class="text-xs text-gray-500">Las versiones son idénticas</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each diff as d}
							<div class="rounded-xl border border-amber-100 bg-amber-50/30 p-3">
								<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-700">{fmtPath(d.path)}</p>
								<div class="grid grid-cols-2 gap-3">
									<div class="rounded-lg bg-red-50 p-2">
										<p class="text-[9px] font-medium text-red-500">Anterior</p>
										<p class="mt-0.5 font-mono text-xs text-gray-700 break-all">{fmtValue(d.anterior)}</p>
									</div>
									<div class="rounded-lg bg-orange-50 p-2">
										<p class="text-[9px] font-medium text-orange-500">Nuevo</p>
										<p class="mt-0.5 font-mono text-xs text-gray-700 break-all">{fmtValue(d.nuevo)}</p>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
