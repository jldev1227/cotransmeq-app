<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	export let isOpen = false;
	export let title = '¿Confirmar eliminación?';
	export let message = '¿Estás seguro de que deseas eliminar este elemento?';
	export let itemCount = 1;
	export let loading = false;

	const dispatch = createEventDispatcher();

	function handleConfirm() {
		dispatch('confirm');
	}

	/// `ConfirmDialog` ya ignora Escape y el fondo mientras `loading`.
	function handleCancel() {
		if (!loading) {
			dispatch('cancel');
			isOpen = false;
		}
	}
</script>

<ConfirmDialog
	open={isOpen}
	{title}
	{message}
	tone="danger"
	eyebrow="ACCIÓN DESTRUCTIVA"
	confirmText="Eliminar"
	loadingText="Eliminando…"
	{loading}
	onconfirm={handleConfirm}
	oncancel={handleCancel}
>
	{#if itemCount > 1}
		<p class="conteo">Se eliminarán {itemCount} elemento(s)</p>
	{/if}
</ConfirmDialog>

<style>
	.conteo {
		margin: 0;
		font-size: 14px;
		font-weight: 800;
		color: #b42318;
	}
</style>
