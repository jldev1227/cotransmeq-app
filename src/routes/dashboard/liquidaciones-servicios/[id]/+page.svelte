<script lang="ts">
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { ChevronLeft, Eye } from 'lucide-svelte';
	import LiquidacionEditor from '$lib/components/LiquidacionEditor.svelte';
	import { urlListado } from '$lib/stores/volverLiquidaciones';

	$: editId = $page.params.id;
	$: viewMode = $page.url.searchParams.get('mode') === 'view';
</script>

<svelte:head>
	<title>Detalle Liquidación · Cotransmeq</title>
</svelte:head>

<div
	class="min-h-screen p-4 md:p-6"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<div class="mb-4 no-print">
		<button class="btn-ghost" on:click={() => goto(urlListado())}>
			<ChevronLeft class="h-3.5 w-3.5" />
			Volver al listado
		</button>
	</div>

	<div class="page-card no-print" style="padding: 1.25rem 1.5rem; margin-bottom: 1rem;">
		<div class="flex items-center gap-3">
			<div>
				<span class="eyebrow">Detalle</span>
				<h1 class="mt-1 font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 800;">
					Detalle de Liquidación
				</h1>
				<p class="text-xs" style="color: var(--text-muted);">
					Visualiza la información completa de la liquidación
				</p>
			</div>
		</div>
	</div>

	<LiquidacionEditor {editId} {viewMode} />
</div>
