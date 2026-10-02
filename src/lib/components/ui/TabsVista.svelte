<script lang="ts" module>
	export interface TabVista {
		id: string;
		label: string;
		/** Número que acompaña la etiqueta: registros, versiones… */
		cuenta?: number | null;
		/** Errores de validación en la pestaña: se marcan en rojo. */
		errores?: number;
	}
</script>

<script lang="ts">
	/**
	 * Pestañas de vista: las mismas de los modales de directorio
	 * (`ModalEntidad`) y de las páginas que separan su contenido en vistas.
	 *
	 * - `oscuro`: sobre el encabezado verde profundo del modal; la activa es
	 *   la superficie blanca del cuerpo, como una carpeta.
	 * - `claro`: sobre la página; misma forma, la activa se recorta contra la
	 *   línea inferior.
	 */
	interface Props {
		tabs: TabVista[];
		activa: string;
		variante?: 'oscuro' | 'claro';
		/** Etiqueta accesible del grupo. */
		etiqueta?: string;
		onCambiar?: (id: string) => void;
	}

	let {
		tabs,
		activa = $bindable(),
		variante = 'claro',
		etiqueta = 'Vistas',
		onCambiar
	}: Props = $props();

	function elegir(id: string) {
		if (id === activa) return;
		activa = id;
		onCambiar?.(id);
	}

	/// Flechas izquierda/derecha entre pestañas, como un tablist nativo.
	function teclado(e: KeyboardEvent, i: number) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
		elegir(tabs[j].id);
		(e.currentTarget as HTMLElement).parentElement
			?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
			[j]?.focus();
	}
</script>

<div class="tv tv--{variante}" role="tablist" aria-label={etiqueta}>
	{#each tabs as tab, i (tab.id)}
		{@const errores = tab.errores ?? 0}
		<button
			type="button"
			role="tab"
			class="tv-tab"
			class:activa={activa === tab.id}
			aria-selected={activa === tab.id}
			tabindex={activa === tab.id ? 0 : -1}
			onclick={() => elegir(tab.id)}
			onkeydown={(e) => teclado(e, i)}
		>
			{tab.label}
			{#if errores > 0}
				<span class="tv-badge tv-badge--error" aria-label="{errores} error(es)">{errores}</span>
			{:else if tab.cuenta != null}
				<span class="tv-badge">{tab.cuenta.toLocaleString('es-CO')}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.tv {
		position: relative;
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tv::-webkit-scrollbar {
		display: none;
	}
	.tv-tab {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		border: 0;
		border-radius: 12px 12px 0 0;
		background: transparent;
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.tv-tab:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: -2px;
	}

	/* Oscuro: sobre el verde profundo del encabezado del modal. */
	.tv--oscuro .tv-tab {
		color: rgba(255, 255, 255, 0.7);
	}
	.tv--oscuro .tv-tab:hover {
		color: #fff;
	}
	.tv--oscuro .tv-tab.activa {
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.tv--oscuro .tv-badge {
		background: rgba(255, 255, 255, 0.16);
		color: #fff;
	}
	.tv--oscuro .tv-tab.activa .tv-badge {
		background: color-mix(in srgb, var(--accion) 14%, transparent);
		color: var(--bg-charcoal-deep);
	}

	/* Claro: la misma carpeta, sobre la página. La línea inferior es del
	   contenedor; la pestaña activa la tapa con su propio fondo. */
	.tv--claro {
		border-bottom: 1.5px solid var(--border-default);
	}
	.tv--claro .tv-tab {
		margin-bottom: -1.5px;
		border: 1.5px solid transparent;
		border-bottom: 0;
		color: var(--text-muted);
	}
	.tv--claro .tv-tab:hover {
		color: var(--text-primary);
		background: var(--bg-base);
	}
	.tv--claro .tv-tab.activa {
		background: var(--bg-surface);
		border-color: var(--border-default);
		color: var(--bg-charcoal-deep);
		box-shadow: inset 0 3px 0 var(--accion);
	}
	.tv--claro .tv-badge {
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.tv--claro .tv-tab.activa .tv-badge {
		background: var(--accion);
		color: #fff;
	}

	.tv-badge {
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		display: inline-grid;
		place-items: center;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.tv .tv-badge--error,
	.tv .tv-tab.activa .tv-badge--error {
		background: #dc2626;
		color: #fff;
	}
</style>
