<script lang="ts">
	/**
	 * Lista ordenada con una barra proporcional: clientes frecuentes, placas
	 * con más mantenimientos, conductores con más días… Cada fila puede ser un
	 * enlace a la ficha.
	 */
	import { numero, pesos, horas } from '$lib/dashboard/formato';

	export interface ItemRanking {
		etiqueta: string;
		valor: number;
		/** Texto pequeño a la derecha del nombre (NIT, placa, área…). */
		secundario?: string;
		/** Texto que sustituye al valor formateado. */
		valorTexto?: string;
		href?: string;
		tono?: 'normal' | 'ambar' | 'rojo';
	}

	interface Props {
		items: ItemRanking[];
		formato?: 'numero' | 'pesos' | 'horas';
		/** Qué unidad va tras el número: «servicios», «días»… */
		unidad?: string;
		vacio?: string;
		numerado?: boolean;
	}
	let {
		items,
		formato = 'numero',
		unidad = '',
		vacio = 'Sin datos en este periodo',
		numerado = true
	}: Props = $props();

	const max = $derived(Math.max(1, ...items.map((i) => i.valor)));
	const fmt = $derived((v: number) =>
		formato === 'pesos'
			? pesos(v)
			: formato === 'horas'
				? horas(v)
				: `${numero(v)}${unidad ? ` ${unidad}` : ''}`
	);
</script>

{#if items.length === 0}
	<p class="rk-vacio">{vacio}</p>
{:else}
	<ol class="rk">
		{#each items as it, i (it.etiqueta + i)}
			<li class="rk-fila rk-fila--{it.tono ?? 'normal'}">
				{#if numerado}<span class="rk-num">{i + 1}</span>{/if}
				<div class="rk-centro">
					<div class="rk-linea">
						{#if it.href}
							<a class="rk-nombre" href={it.href}>{it.etiqueta}</a>
						{:else}
							<span class="rk-nombre">{it.etiqueta}</span>
						{/if}
						{#if it.secundario}<span class="rk-sec">{it.secundario}</span>{/if}
						<span class="rk-valor">{it.valorTexto ?? fmt(it.valor)}</span>
					</div>
					<div class="rk-barra" aria-hidden="true">
						<span style="width: {Math.max(2, (it.valor / max) * 100)}%"></span>
					</div>
				</div>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.rk {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.rk-fila {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.rk-num {
		flex-shrink: 0;
		width: 1.35rem;
		height: 1.35rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.rk-centro {
		flex: 1;
		min-width: 0;
	}
	.rk-linea {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.rk-nombre {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
		text-decoration: none;
	}
	a.rk-nombre:hover {
		color: var(--au-primary-strong);
	}
	.rk-sec {
		flex-shrink: 0;
		font-size: 0.7rem;
		color: var(--text-very-muted);
	}
	.rk-valor {
		flex-shrink: 0;
		font-size: 0.78rem;
		font-weight: 800;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.rk-barra {
		margin-top: 0.25rem;
		height: 5px;
		border-radius: 999px;
		background: var(--bg-base);
		overflow: hidden;
	}
	.rk-barra span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--au-primary);
	}
	.rk-fila--ambar .rk-barra span {
		background: #f59e0b;
	}
	.rk-fila--rojo .rk-barra span {
		background: #ef4444;
	}
	.rk-vacio {
		margin: 0.5rem 0;
		font-size: 0.8rem;
		color: var(--text-very-muted);
	}
</style>
