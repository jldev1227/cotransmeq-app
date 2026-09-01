<!--
	UniverToolbar — cabecera tipo Excel compartida por todas las pages Univer.

	CONTRATO:
	  • El shell (UniverShell) impone la altura del header vía CSS.
	    Esta toolbar SOLO renderiza estructura + contenido.
	  • Toda la parte dinámica (botones, handlers, textos) entra por
	    props + snippets. El estilo está centralizado en `toolbar.css`.
	  • El `title` se trunca con ellipsis. El `subtitle` se oculta en <720px
	    vía la media query del CSS.

	Uso típico:
	  <UniverToolbar title="..." subtitle="..." onBack={() => goto('...')}>
	    {#snippet actions()}
	      <PresenceAvatars /><AutosaveIndicator />
	      <button class="univer-btn univer-btn-blue" onclick={...}>Sync</button>
	    {/snippet}
	  </UniverToolbar>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		onBack?: () => void;
		backLabel?: string;
		/// Snippet del lado derecho del toolbar (botones, indicadores, etc.).
		/// El padre lo pasa con `{#snippet actions()}…{/snippet}`.
		actions?: Snippet;
	}

	let { title, subtitle = '', onBack, backLabel = 'Volver', actions }: Props = $props();
</script>

<div class="univer-toolbar">
	<div class="univer-toolbar-left">
		{#if onBack}
			<button class="univer-btn univer-btn-back" onclick={onBack} title="Volver">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M19 12H5M12 19l-7-7 7-7" />
				</svg>
				{backLabel}
			</button>
			<div class="univer-divider"></div>
		{/if}
		<div class="univer-info">
			<span class="univer-info-title">{title}</span>
			{#if subtitle}
				<span class="univer-info-subtitle">{subtitle}</span>
			{/if}
		</div>
	</div>
	<div class="univer-toolbar-right">
		{#if actions}
			{@render actions()}
		{/if}
	</div>
</div>