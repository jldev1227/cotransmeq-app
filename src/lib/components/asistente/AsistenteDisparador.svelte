<script lang="ts">
	/**
	 * Disparador del asistente en la cabecera.
	 *
	 * Ocupa el sitio del antiguo buscador «Ir a un módulo…»: mismo aspecto de
	 * campo, mismo atajo (⌘K / Ctrl K). La diferencia es que ahora abre un chat
	 * que, además de llevarte a un módulo, consulta datos y explica la app. La
	 * navegación por nombre sigue existiendo: se la pides al asistente.
	 */
	import { Sparkles } from 'lucide-svelte';
	import { asistenteAbierto } from '$lib/stores/asistente';

	const esMac =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

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

<button
	type="button"
	class="asis-disparador"
	onclick={alternar}
	aria-haspopup="dialog"
	aria-expanded={$asistenteAbierto}
	aria-label="Abrir el asistente"
>
	<Sparkles size={16} strokeWidth={1.8} class="asis-disparador-icono" aria-hidden="true" />
	<span class="asis-disparador-texto">Pregúntale al asistente…</span>
	<kbd class="asis-disparador-atajo" aria-hidden="true">{esMac ? '⌘' : 'Ctrl'} K</kbd>
</button>

<style>
	.asis-disparador {
		display: flex;
		align-items: center;
		width: 100%;
		max-width: 26rem;
		height: 40px;
		padding: 0 0.75rem 0 0.85rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1.5px solid transparent;
		border-radius: 12px;
		color: rgba(255, 255, 255, 0.6);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.asis-disparador:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.18);
	}
	.asis-disparador :global(.asis-disparador-icono) {
		flex-shrink: 0;
	}
	.asis-disparador-texto {
		flex: 1;
		min-width: 0;
		margin: 0 0.6rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.55);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.asis-disparador-atajo {
		flex-shrink: 0;
		padding: 0.15rem 0.45rem;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.08);
		font-family: inherit;
		font-size: 0.65rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.6);
		letter-spacing: 0.04em;
	}
</style>
