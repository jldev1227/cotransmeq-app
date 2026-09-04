<script lang="ts">
	/**
	 * Controles de paginación de una lista.
	 *
	 * El mismo bloque estaba copiado a mano en conductores, clientes, servicios,
	 * terceros y sarlaft, con textos y comportamientos ligeramente distintos —
	 * unas mostraban el rango «11–20 de 340» y otras solo «página 2 de 17»—.
	 *
	 * No incluye la lógica: la página decide qué hacer con el número, que en
	 * las listas migradas significa escribirlo en la URL. Antes ninguna lo
	 * hacía, así que compartir un enlace devolvía siempre a la primera página.
	 */

	interface Props {
		pagina: number;
		/** Total de registros en el servidor, no los de esta página. */
		total: number;
		porPagina: number;
		onCambiar: (pagina: number) => void;
		cargando?: boolean;
		/** Para el texto: «… de 340 vehículos». */
		nombreItems?: string;
	}

	let {
		pagina,
		total,
		porPagina,
		onCambiar,
		cargando = false,
		nombreItems = 'registros'
	}: Props = $props();

	const totalPaginas = $derived(Math.max(1, Math.ceil(total / porPagina)));
	const desde = $derived(total === 0 ? 0 : (pagina - 1) * porPagina + 1);
	const hasta = $derived(Math.min(pagina * porPagina, total));

	/**
	 * Ventana de páginas alrededor de la actual.
	 *
	 * Con 60 páginas no caben todos los botones, así que se muestran cinco
	 * centrados en la actual, corriendo la ventana en los extremos para que
	 * siempre haya cinco y no se encoja al principio y al final.
	 */
	const ventana = $derived.by(() => {
		const maximo = 5;
		if (totalPaginas <= maximo) {
			return Array.from({ length: totalPaginas }, (_, i) => i + 1);
		}
		let inicio = Math.max(1, pagina - Math.floor(maximo / 2));
		const fin = Math.min(totalPaginas, inicio + maximo - 1);
		inicio = Math.max(1, fin - maximo + 1);
		return Array.from({ length: fin - inicio + 1 }, (_, i) => inicio + i);
	});

	function ir(destino: number) {
		if (cargando) return;
		if (destino < 1 || destino > totalPaginas || destino === pagina) return;
		onCambiar(destino);
	}
</script>

{#if totalPaginas > 1}
	<nav class="paginador" aria-label="Paginación">
		<p class="rango">
			<span class="fuerte">{desde}–{hasta}</span> de
			<span class="fuerte">{total}</span>
			{nombreItems}
		</p>

		<div class="botones">
			<button type="button" onclick={() => ir(1)} disabled={pagina === 1 || cargando}
				aria-label="Primera página">«</button
			>
			<button type="button" onclick={() => ir(pagina - 1)} disabled={pagina === 1 || cargando}
				aria-label="Página anterior">‹</button
			>

			{#each ventana as n (n)}
				<button
					type="button"
					class:activa={n === pagina}
					onclick={() => ir(n)}
					disabled={cargando}
					aria-current={n === pagina ? 'page' : undefined}
					aria-label={`Página ${n}`}
				>
					{n}
				</button>
			{/each}

			<button
				type="button"
				onclick={() => ir(pagina + 1)}
				disabled={pagina === totalPaginas || cargando}
				aria-label="Página siguiente">›</button
			>
			<button
				type="button"
				onclick={() => ir(totalPaginas)}
				disabled={pagina === totalPaginas || cargando}
				aria-label="Última página">»</button
			>
		</div>
	</nav>
{/if}

<style>
	.paginador {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-base);
	}

	.rango {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.fuerte {
		font-weight: 600;
		color: var(--text-primary);
	}

	.botones {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	button {
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.5rem;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-surface, #fff);
		color: var(--text-primary);
		font-size: 0.8125rem;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}

	button:hover:not(:disabled) {
		border-color: var(--accent, var(--emerald-500));
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	button.activa {
		background: var(--accent, var(--emerald-500));
		border-color: var(--accent, var(--emerald-500));
		color: #fff;
		font-weight: 600;
	}
</style>
