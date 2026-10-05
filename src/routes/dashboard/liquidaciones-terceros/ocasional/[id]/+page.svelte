<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { onMount } from 'svelte';
	import { page as pageStore } from '$app/stores';
	import { fade } from 'svelte/transition';
	import { liquidacionesTercerosOcasionalAPI, type PreviewDataOcasional } from '$lib/api/liquidaciones-terceros-ocasional';
	import PreviewTerceroOcasionalPDF from '$lib/components/liquidaciones-terceros/PreviewTerceroOcasionalPDF.svelte';

	let id = $derived($pageStore.params.id || '');

	let loading = $state(true);
	let loadError = $state('');
	let data = $state<PreviewDataOcasional | null>(null);

	async function load() {
		if (!id) {
			loadError = 'ID inválido';
			loading = false;
			return;
		}
		loading = true;
		loadError = '';
		try {
			const result = await liquidacionesTercerosOcasionalAPI.obtenerPreviewData(id);
			if (!result) {
				loadError = 'Liquidación ocasional no encontrada';
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
	<title>Vista previa Ocasional · Liquidaciones de Terceros · Cotransmeq</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col" in:fade={{ duration: 300 }}>
	<!-- Único punto de entrada a esta vista es el botón «Vista previa» del
	     canvas anual, así que hace falta una salida explícita. `history.back()`
	     devuelve al canvas con el año y el mes que el usuario tenía abiertos;
	     un `goto` fijo perdería ese contexto. -->
	<div class="px-4 pt-4">
		<button
			onclick={() => history.back()}
			class="apple-transition inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
		>
			<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
			</svg>
			Volver al canvas
		</button>
	</div>

	{#if loading}
		<CargaMascota tamano="pantalla" texto="Cargando la vista previa mensual…" />
	{:else if loadError}
		<div class="flex flex-1 items-center justify-center p-12">
			<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
				<p class="text-sm font-semibold text-red-900">{loadError}</p>
			</div>
		</div>
	{:else if data}
		<PreviewTerceroOcasionalPDF {data} />
	{/if}
</div>
