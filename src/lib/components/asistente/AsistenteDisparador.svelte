<script lang="ts">
	/**
	 * Disparador del asistente en la cabecera.
	 *
	 * Ocupa el sitio del antiguo buscador «Ir a un módulo…»: mismo aspecto de
	 * campo, mismo atajo (⌘K / Ctrl K). La diferencia es que ahora abre un chat
	 * que, además de llevarte a un módulo, consulta datos y explica la app. La
	 * navegación por nombre sigue existiendo: se la pides al asistente.
	 *
	 * `compacto` lo reduce a un botón de solo ícono para la cabecera en móvil y
	 * tablet, donde el campo completo no cabe. Esa variante NO registra el atajo
	 * de teclado: la cabecera monta las dos variantes a la vez (una oculta por
	 * CSS) y dos oyentes de ⌘K se anularían entre sí.
	 */
	import { Sparkles } from 'lucide-svelte';
	import { asistenteAbierto } from '$lib/stores/asistente';

	let { compacto = false }: { compacto?: boolean } = $props();

	const esMac =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

	function alternar() {
		asistenteAbierto.update((v) => !v);
	}

	function atajo(e: KeyboardEvent) {
		if (compacto) return;
		/// Un ⌘K que ya atendió un oyente más específico de la pantalla —el chat
		/// del cierre de terceros (`ChatLiquidacionFab`)— no abre además el
		/// asistente: antes se abrían los dos encimados.
		if (e.defaultPrevented) return;
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			alternar();
		}
	}
</script>

<svelte:window onkeydown={atajo} />

{#if compacto}
	<button
		type="button"
		class="apple-transition btn-icon asis-disparador-compacto"
		onclick={alternar}
		aria-haspopup="dialog"
		aria-expanded={$asistenteAbierto}
		aria-label="Abrir el asistente"
		title="Asistente"
	>
		<Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
	</button>
{:else}
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
{/if}

<style>
	/* Variante compacta: mismo lenguaje que los demás iconos translúcidos de la
	   cabecera (`.cab-icono` en Header.svelte), replicado aquí porque los
	   estilos de la cabecera no alcanzan a este componente. */
	.asis-disparador-compacto {
		flex-shrink: 0;
		background: rgba(255, 255, 255, 0.08) !important;
		border-color: rgba(255, 255, 255, 0.12) !important;
		color: rgba(255, 255, 255, 0.85) !important;
	}
	.asis-disparador-compacto:hover,
	.asis-disparador-compacto[aria-expanded='true'] {
		background: rgba(255, 255, 255, 0.16) !important;
		border-color: rgba(255, 255, 255, 0.28) !important;
		color: #fff !important;
	}
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
