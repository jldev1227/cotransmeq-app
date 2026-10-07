<script lang="ts">
	/**
	 * Pide un motivo antes de una acción que el conductor va a ver: anular un
	 * gasto o rechazar una solicitud. El motivo le llega en la notificación.
	 */
	import { untrack } from 'svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	interface Props {
		open: boolean;
		titulo: string;
		descripcion: string;
		textoConfirmar: string;
		placeholder?: string;
		oncerrar: () => void;
		/** Lanza si falla: el modal se queda abierto con lo escrito. */
		onconfirmar: (motivo: string) => Promise<void>;
	}
	let {
		open,
		titulo,
		descripcion,
		textoConfirmar,
		placeholder = 'Motivo…',
		oncerrar,
		onconfirmar
	}: Props = $props();

	let motivo = $state('');
	let enviando = $state(false);
	$effect(() => {
		if (open) untrack(() => (motivo = ''));
	});
	const valido = $derived(motivo.trim().length >= 3);

	async function confirmar() {
		if (!valido || enviando) return;
		enviando = true;
		try {
			await onconfirmar(motivo.trim());
			oncerrar();
		} catch {
			/* quien llama ya avisó con un toast */
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase {open} title={titulo} eyebrow="VIÁTICOS" tamano="sm" bloqueado={enviando} {oncerrar}>
	<div class="mm">
		<p class="mm-desc">{descripcion}</p>
		<label for="mm-motivo" class="mm-label">Motivo <span>*</span></label>
		<textarea id="mm-motivo" class="de-input" rows="3" {placeholder} bind:value={motivo}></textarea>
	</div>
	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
			>Cancelar</button
		>
		<button type="button" class="btn-danger" onclick={confirmar} disabled={!valido || enviando}>
			{enviando ? 'Guardando…' : textoConfirmar}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mm {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mm-desc {
		margin: 0 0 6px;
		color: var(--text-secondary);
		font-size: 14px;
	}
	.mm-label {
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.mm-label span {
		color: #dc2626;
	}
</style>
