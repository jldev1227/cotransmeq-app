<script lang="ts">
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import LiquidacionEditor from '$lib/components/LiquidacionEditor.svelte';

	$: editId = $page.params.id;
	$: viewMode = $page.url.searchParams.get('mode') === 'view';
</script>

<svelte:head>
	<title>Editar Liquidación · Cotransmeq</title>
</svelte:head>

<div
	class="workbook-page"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<LiquidacionEditor {editId} {viewMode} />
</div>

<style>
	.workbook-page {
		min-height: 100vh;
		padding: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	@media (max-width: 1279px) {
		.workbook-page {
			padding: 0;
		}
	}
</style>
