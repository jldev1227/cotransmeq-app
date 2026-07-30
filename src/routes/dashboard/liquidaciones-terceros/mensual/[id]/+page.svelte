<script lang="ts">
	import { onMount } from 'svelte';
	import { page as pageStore } from '$app/stores';
	import { fade } from 'svelte/transition';
	import { liquidacionesTercerosMensualAPI, type PreviewDataMensual } from '$lib/api/liquidaciones-terceros-mensual';
	import PreviewTerceroMensualPDF from '$lib/components/liquidaciones-terceros/PreviewTerceroMensualPDF.svelte';

	let id = $derived($pageStore.params.id || '');

	let loading = $state(true);
	let loadError = $state('');
	let data = $state<PreviewDataMensual | null>(null);

	async function load() {
		if (!id) {
			loadError = 'ID inválido';
			loading = false;
			return;
		}
		loading = true;
		loadError = '';
		try {
			const result = await liquidacionesTercerosMensualAPI.obtenerPreviewData(id);
			if (!result) {
				loadError = 'Liquidación mensual no encontrada';
			} else {
				data = result;
			}
		} catch (e: any) {
			console.error('Error cargando preview mensual:', e);
			loadError = e.message || 'Error al cargar';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		load();
	});
</script>

<svelte:head>
	<title>Preview Mensual · Liquidaciones de Terceros · Transmeralda</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col" in:fade={{ duration: 300 }}>
	{#if loading}
		<div class="flex flex-1 items-center justify-center p-12">
			<div class="flex flex-col items-center gap-3">
				<div class="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
				<p class="text-[13px] text-gray-500">Cargando preview mensual…</p>
			</div>
		</div>
	{:else if loadError}
		<div class="flex flex-1 items-center justify-center p-12">
			<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
				<p class="text-sm font-semibold text-red-900">{loadError}</p>
			</div>
		</div>
	{:else if data}
		<PreviewTerceroMensualPDF {data} />
	{/if}
</div>
