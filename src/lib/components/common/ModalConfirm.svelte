<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	export let isOpen = false;
	export let title = '¿Estás seguro?';
	export let message = '';
	export let confirmText = 'Confirmar';
	export let cancelText = 'Cancelar';
	export let type: 'danger' | 'warning' | 'info' = 'danger';
	export let isLoading = false;

	const dispatch = createEventDispatcher();

	function handleConfirm() {
		dispatch('confirm');
	}

	/// `ConfirmDialog` ya ignora Escape y el fondo mientras `isLoading`.
	function handleCancel() {
		dispatch('cancel');
		isOpen = false;
	}
</script>

<ConfirmDialog
	open={isOpen}
	{title}
	{message}
	tone={type}
	{confirmText}
	{cancelText}
	loading={isLoading}
	loadingText="Procesando…"
	onconfirm={handleConfirm}
	oncancel={handleCancel}
/>
