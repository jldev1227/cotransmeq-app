<script lang="ts">
	/**
	 * Asistente dentro de un canvas Univer (nómina, terceros, liquidaciones,
	 * recorridos).
	 *
	 * Esas pantallas usan `+layout@.svelte` para saltarse el layout del
	 * dashboard —y con él la cabecera donde vive el disparador y el panel—, así
	 * que aquí se montan los dos de nuevo: el mismo panel (la conversación vive
	 * en el store y sobrevive al cambio de pantalla) y un botón flotante con el
	 * atajo ⌘K. Cuando el panel se abre, `html.asistente-abierto` hace que el
	 * `body` fijo del shell se encoja 420px para que la hoja no quede tapada
	 * (regla global en app.css).
	 */
	import { Sparkles } from 'lucide-svelte';
	import AsistentePanel from './AsistentePanel.svelte';
	import { asistenteAbierto } from '$lib/stores/asistente';

	function alternar() {
		asistenteAbierto.update((v) => !v);
	}

	function atajo(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			alternar();
		}
	}
</script>

<svelte:window onkeydown={atajo} />

<AsistentePanel />

{#if !$asistenteAbierto}
	<button
		type="button"
		class="asis-flotante"
		onclick={alternar}
		aria-haspopup="dialog"
		aria-expanded={$asistenteAbierto}
		aria-label="Abrir el asistente (⌘K)"
		title="Asistente (⌘K)"
	>
		<Sparkles size={18} strokeWidth={1.8} aria-hidden="true" />
	</button>
{/if}

<style>
	/* Esquina inferior derecha de la hoja: libre en los cuatro canvas (las
	   pestañas de Univer van abajo a la izquierda y el carril lateral arriba). */
	.asis-flotante {
		position: fixed;
		right: 1rem;
		bottom: 1.25rem;
		z-index: 880;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 999px;
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		background: var(--au-primary, #047857);
		color: #fff;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}
	.asis-flotante:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
	}
	.asis-flotante:focus-visible {
		outline: 2px solid var(--au-primary, #047857);
		outline-offset: 2px;
	}
	@media print {
		.asis-flotante {
			display: none;
		}
	}
</style>
