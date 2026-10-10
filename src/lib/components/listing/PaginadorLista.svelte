<script lang="ts">
	import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-svelte';

	/**
	 * Paginador ÚNICO de las tablas de la app.
	 *
	 * El mismo bloque estaba copiado a mano en conductores, clientes, servicios,
	 * terceros, sarlaft, formularios, liquidaciones… con textos y comportamientos
	 * distintos —unas mostraban «11–20 de 340» y otras solo «página 2 de 17», unas
	 * con flechas «‹ ›» y otras con «Anterior / Siguiente»—. Da igual cómo sea la
	 * tabla de encima: el pie de paginación es este.
	 *
	 * No incluye la lógica: la página decide qué hacer con el número (en las
	 * listas migradas, escribirlo en la URL para que un enlace compartido abra en
	 * la misma página).
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
		/** Sin borde superior ni fondo: para paginadores fuera de una tabla. */
		suelto?: boolean;
		/**
		 * Tamaños de página que se ofrecen; `0` es «Todas». Sin esto (o sin
		 * `onCambiarPorPagina`) no se pinta el selector y el paginador queda
		 * como siempre en las demás pantallas.
		 */
		opcionesPorPagina?: number[];
		onCambiarPorPagina?: (porPagina: number) => void;
	}

	let {
		pagina,
		total,
		porPagina,
		onCambiar,
		cargando = false,
		nombreItems = 'registros',
		suelto = false,
		opcionesPorPagina,
		onCambiarPorPagina
	}: Props = $props();

	/// `porPagina = 0` es «Todas»: una sola página con todo.
	const todas = $derived(porPagina <= 0);
	const tamano = $derived(todas ? Math.max(1, total) : porPagina);
	const totalPaginas = $derived(Math.max(1, Math.ceil(total / tamano)));
	const desde = $derived(total === 0 ? 0 : (pagina - 1) * tamano + 1);
	const hasta = $derived(Math.min(pagina * tamano, total));
	const conSelector = $derived(!!opcionesPorPagina?.length && !!onCambiarPorPagina);

	/**
	 * Ventana de páginas alrededor de la actual: cinco botones centrados en ella,
	 * corriendo la ventana en los extremos para que no se encoja al principio ni
	 * al final.
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

<!-- El rango se muestra aunque quepa todo en una página: el pie es siempre el
     mismo y dice cuántos hay. Los botones solo cuando hay a dónde ir. -->
{#if total > 0}
	<nav class="paginador" class:suelto aria-label="Paginación">
		<div class="izquierda">
			<p class="rango">
				<span class="fuerte">{desde}–{hasta}</span> de
				<span class="fuerte">{total.toLocaleString('es-CO')}</span>
				{nombreItems}
			</p>
			{#if conSelector}
				<label class="filas">
					<span>Filas</span>
					<select
						value={String(porPagina)}
						disabled={cargando}
						onchange={(e) =>
							onCambiarPorPagina?.(Number((e.currentTarget as HTMLSelectElement).value))}
					>
						{#each opcionesPorPagina ?? [] as n (n)}
							<option value={String(n)}>{n === 0 ? 'Todas' : n}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>

		{#if totalPaginas > 1}
			<div class="botones">
				<button
					type="button"
					class="extremo"
					onclick={() => ir(1)}
					disabled={pagina === 1 || cargando}
					aria-label="Primera página"
				>
					<ChevronsLeft size={16} strokeWidth={2.5} />
				</button>
				<button
					type="button"
					onclick={() => ir(pagina - 1)}
					disabled={pagina === 1 || cargando}
					aria-label="Página anterior"
				>
					<ChevronLeft size={16} strokeWidth={2.5} />
				</button>

				{#each ventana as n (n)}
					<button
						type="button"
						class="num"
						class:activa={n === pagina}
						onclick={() => ir(n)}
						disabled={cargando && n !== pagina}
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
					aria-label="Página siguiente"
				>
					<ChevronRight size={16} strokeWidth={2.5} />
				</button>
				<button
					type="button"
					class="extremo"
					onclick={() => ir(totalPaginas)}
					disabled={pagina === totalPaginas || cargando}
					aria-label="Última página"
				>
					<ChevronsRight size={16} strokeWidth={2.5} />
				</button>
			</div>
		{/if}
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
	.paginador.suelto {
		padding: 0.75rem 0 0;
		border-top: 0;
		background: transparent;
	}

	.izquierda {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.filas {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	.filas select {
		height: 2.25rem;
		padding: 0 0.5rem;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface, #fff);
		color: var(--bg-charcoal-deep);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	.rango {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	.fuerte {
		font-weight: 800;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.botones {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	/* Misma familia que los botones de la app: esquinas de 12, borde neutro,
	   activo en el color de acción plano. */
	button {
		min-width: 2.25rem;
		height: 2.25rem;
		padding: 0 0.6rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface, #fff);
		color: var(--bg-charcoal-deep);
		font-size: 0.8125rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}
	button:hover:not(:disabled):not(.activa) {
		border-color: var(--border-emphasis);
		background: var(--bg-base);
	}
	button:active:not(:disabled) {
		transform: scale(0.96);
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	button.activa {
		background: var(--accion);
		border-color: var(--accion);
		color: #fff;
		font-weight: 800;
		box-shadow: var(--shadow-btn);
		cursor: default;
	}

	@media (max-width: 640px) {
		.paginador {
			justify-content: center;
		}
		.rango {
			width: 100%;
			text-align: center;
		}
		.extremo {
			display: none;
		}
	}
</style>
