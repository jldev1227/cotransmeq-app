<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { flotaStore } from '$lib/stores/flota';

	export let isOpen = false;
	export let vehiculo: any = null;

	const dispatch = createEventDispatcher();

	let isDeleting = false;
	let showSuccessAnimation = false;
	let cierreTimer: ReturnType<typeof setTimeout> | null = null;

	const handleClose = () => {
		if (isDeleting) return;
		isOpen = false;
		showSuccessAnimation = false;
		dispatch('close');
	};

	/// Cierra el aviso de éxito; lo llama el temporizador o el botón «Listo».
	function terminar() {
		if (cierreTimer) clearTimeout(cierreTimer);
		cierreTimer = null;
		showSuccessAnimation = false;
		isOpen = false;
		dispatch('success');
	}

	onDestroy(() => {
		if (cierreTimer) clearTimeout(cierreTimer);
	});

	const handleConfirmDelete = async () => {
		if (!vehiculo) return;

		try {
			isDeleting = true;

			// Llamar al endpoint de soft delete
			await vehiculosAPI.delete(vehiculo.id);

			// Emitir evento por socket
			socketUtils.emit('vehiculo-eliminado', {
				vehiculoId: vehiculo.id
			});

			// Remover del store
			flotaStore.removeVehiculo(vehiculo.id);

			// Mostrar animación de éxito
			showSuccessAnimation = true;

			// Cerrar después de 2 segundos (o antes, con «Listo»)
			cierreTimer = setTimeout(terminar, 2000);
		} catch (error) {
			console.error('Error al eliminar vehículo:', error);
			alert('Error al eliminar el vehículo. Por favor, intente nuevamente.');
		} finally {
			isDeleting = false;
		}
	};
</script>

<!-- Una sola tarjeta: al eliminar pasa de la pregunta al aviso de éxito sin cerrarse. -->
<ConfirmDialog
	open={isOpen}
	title={showSuccessAnimation ? '¡Eliminado!' : `¿Eliminar el vehículo ${vehiculo?.placa ?? ''}?`}
	message={showSuccessAnimation
		? 'El vehículo ha sido eliminado exitosamente.'
		: 'Esta acción se puede revertir si eres administrador. El vehículo será marcado como eliminado y no aparecerá en la lista principal.'}
	tone={showSuccessAnimation ? 'success' : 'danger'}
	confirmText={showSuccessAnimation ? 'Listo' : 'Eliminar'}
	cancelText={showSuccessAnimation ? null : 'Cancelar'}
	loadingText="Eliminando…"
	loading={isDeleting}
	onconfirm={showSuccessAnimation ? terminar : handleConfirmDelete}
	oncancel={showSuccessAnimation ? terminar : handleClose}
>
	{#if showSuccessAnimation}
		<div class="barra"><div class="barra-relleno"></div></div>
	{/if}
</ConfirmDialog>

<style>
	.barra {
		height: 4px;
		overflow: hidden;
		border-radius: 999px;
		background: var(--border-default);
	}
	.barra-relleno {
		height: 100%;
		background: var(--emerald-500);
		animation: progressBar 2s linear forwards;
	}
	@keyframes progressBar {
		from {
			width: 0%;
		}
		to {
			width: 100%;
		}
	}
</style>
