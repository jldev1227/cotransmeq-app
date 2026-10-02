<script lang="ts">
	/**
	 * Confirmación de una acción que no se deshace.
	 *
	 * Sustituye al `confirm()` del navegador en las pantallas de evaluaciones.
	 * Se pinta con la tarjeta común (`ConfirmDialog`: encabezado oscuro con la
	 * mascota); quien la usa la monta dentro de un `{#if}`, así que siempre
	 * está abierta mientras exista.
	 */
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	interface Props {
		titulo: string;
		mensaje: string;
		/** Texto del botón que confirma. */
		confirmar?: string;
		cancelar?: string;
		/** Rojo: borrar, descartar. Sin él, el botón va en el primario. */
		peligrosa?: boolean;
		procesando?: boolean;
		onConfirmar: () => void;
		onCancelar: () => void;
	}

	let {
		titulo,
		mensaje,
		confirmar = 'Eliminar',
		cancelar = 'Cancelar',
		peligrosa = true,
		procesando = false,
		onConfirmar,
		onCancelar
	}: Props = $props();
</script>

<ConfirmDialog
	open
	title={titulo}
	message={mensaje}
	tone={peligrosa ? 'danger' : 'warning'}
	confirmText={confirmar}
	cancelText={cancelar}
	loading={procesando}
	loadingText="Un momento…"
	onconfirm={onConfirmar}
	oncancel={onCancelar}
/>
