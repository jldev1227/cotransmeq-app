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
<script lang="ts" module>
	/** Un filtro puesto en una columna de la hoja que se está mirando. */
	export interface FiltroToolbar {
		/// Índice de columna en Univer; se devuelve al quitar el chip.
		col: number;
		/// Etiqueta de la cabecera: «CLIENTE», «ESTADO»…
		columna: string;
		/// Qué deja ver, en corto: «ACME, Beta +3», «> 1000».
		resumen: string;
	}
</script>

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
		/// Apaga la toolbar mientras algo la tapa (un overlay a pantalla completa).
		/// `inert` quita del tabulador y del árbol de accesibilidad todo lo de
		/// dentro: sin él, el Tab sigue paseándose por unos botones que el usuario
		/// no ve.
		inerte?: boolean;
		/**
		 * Hoja que se está mirando, para el «Título / Hoja».
		 *
		 * Un libro Univer con sheet bar puede tener doce hojas (una por mes) u
		 * ochenta (una por placa): el título a secas no dice en cuál estás, y la
		 * pestaña activa queda abajo del todo, lejos de donde se mira.
		 */
		hoja?: string;
		/**
		 * Filtros puestos en la hoja actual. Se listan porque un filtro en una
		 * columna que quedó fuera de la pantalla es invisible, y entonces se leen
		 * doce filas creyendo que son todas las que hay.
		 */
		filtros?: FiltroToolbar[];
		/// Quitar el filtro de una columna desde su chip.
		onQuitarFiltro?: (col: number) => void;
		/// Quitar todos de golpe.
		onLimpiarFiltros?: () => void;
	}

	let {
		title,
		subtitle = '',
		onBack,
		backLabel = 'Volver',
		actions,
		inerte = false,
		hoja = '',
		filtros = [],
		onQuitarFiltro,
		onLimpiarFiltros
	}: Props = $props();
</script>

<div class="univer-toolbar" inert={inerte}>
	<div class="univer-toolbar-left">
		{#if onBack}
			<button class="univer-btn univer-btn-back" onclick={onBack} title="Volver">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M19 12H5M12 19l-7-7 7-7" />
				</svg>
				{backLabel}
			</button>
			<div class="univer-divider"></div>
		{/if}
		<div class="univer-info">
			<span class="univer-info-title">
				{title}
				{#if hoja}
					<span class="univer-info-sep" aria-hidden="true">/</span><span class="univer-info-hoja"
						>{hoja}</span
					>
				{/if}
			</span>
			{#if subtitle}
				<span class="univer-info-subtitle">{subtitle}</span>
			{/if}
		</div>
		{#if filtros.length}
			<div class="univer-divider"></div>
			<div class="univer-filtros" aria-label="Filtros aplicados en esta hoja">
				{#each filtros as f (f.col)}
					<span class="univer-filtro" title="{f.columna}: {f.resumen}">
						<span class="univer-filtro-col">{f.columna}</span>
						<span class="univer-filtro-val">{f.resumen}</span>
						{#if onQuitarFiltro}
							<button
								class="univer-filtro-x"
								onclick={() => onQuitarFiltro?.(f.col)}
								aria-label="Quitar el filtro de {f.columna}"
							>
								✕
							</button>
						{/if}
					</span>
				{/each}
				{#if onLimpiarFiltros && filtros.length > 1}
					<button class="univer-filtro-limpiar" onclick={onLimpiarFiltros}>Quitar todos</button>
				{/if}
			</div>
		{/if}
	</div>
	<div class="univer-toolbar-right">
		{#if actions}
			{@render actions()}
		{/if}
	</div>
</div>
