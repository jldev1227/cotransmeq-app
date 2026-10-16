<script lang="ts">
	import { resolve } from '$app/paths';

	interface Sugerencia {
		id: string;
		prioridad: 'critica' | 'alta' | 'oportunidad' | 'info';
		titulo: string;
		evidencia: string;
		accion: string;
		enlace?: string | null;
	}

	interface Props {
		titulo: string;
		bajada: string;
		items: Sugerencia[];
	}

	let { titulo, bajada, items }: Props = $props();
	// Los enlaces llegan como strings de rutas internas; el tipo generado solo acepta literales.
	const resolverRuta = resolve as unknown as (enlace: string) => string;
	const resolverEnlace = (enlace: string) => resolverRuta(enlace);
	const NIVELES = {
		critica: 'Prioridad alta',
		alta: 'Atención',
		oportunidad: 'Oportunidad',
		info: 'Seguimiento'
	} as const;
</script>

<section class="ps page-card" aria-label={titulo}>
	<header class="ps-cabecera">
		<div>
			<p class="ps-eyebrow">LECTURA DEL PERIODO</p>
			<h2>{titulo}</h2>
			<p class="ps-bajada">{bajada}</p>
		</div>
		<span class="ps-total">{items.length} {items.length === 1 ? 'señal' : 'señales'}</span>
	</header>

	{#if items.length}
		<div class="ps-lista">
			{#each items as item (item.id)}
				<article
					class="ps-item"
					class:ps-critica={item.prioridad === 'critica'}
					class:ps-alta={item.prioridad === 'alta'}
				>
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<div class="ps-marca" aria-hidden="true"></div>
					<div class="ps-contenido">
						<span class="ps-nivel">{NIVELES[item.prioridad]}</span>
						<h3>{item.titulo}</h3>
						<p class="ps-evidencia">{item.evidencia}</p>
						<p class="ps-accion"><strong>Acción sugerida:</strong> {item.accion}</p>
					</div>
					{#if item.enlace}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href ya se procesa con resolve() en resolverEnlace. -->
						<a
							class="ps-enlace"
							href={resolverEnlace(item.enlace)}
							aria-label={`Revisar: ${item.titulo}`}>Revisar <span aria-hidden="true">↗</span></a
						>
					{/if}
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</article>
			{/each}
		</div>
	{:else}
		<div class="ps-vacio">
			<span class="ps-vacio-punto" aria-hidden="true">✓</span>
			<div>
				<strong>Sin alertas relevantes en este periodo</strong>
				<p>Los indicadores consultados no muestran acciones urgentes.</p>
			</div>
		</div>
	{/if}
</section>

<style>
	.ps {
		overflow: hidden;
		margin-bottom: 0.85rem;
	}
	.ps-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.15rem 0.9rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.ps-eyebrow {
		margin: 0 0 0.25rem;
		color: var(--au-primary-strong);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
	}
	.ps-cabecera h2 {
		margin: 0;
		color: var(--text-primary);
		font-size: 1rem;
		font-weight: 750;
	}
	.ps-bajada {
		margin: 0.2rem 0 0;
		color: var(--text-muted);
		font-size: 0.75rem;
	}
	.ps-total {
		flex: none;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		padding: 0.26rem 0.55rem;
		color: var(--text-secondary);
		background: var(--bg-surface);
		font-size: 0.68rem;
		font-weight: 700;
	}
	.ps-lista {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
	}
	.ps-item {
		position: relative;
		display: grid;
		grid-template-columns: 4px minmax(0, 1fr) auto;
		align-items: stretch;
		gap: 0.8rem;
		min-width: 0;
		padding: 0.95rem 1.15rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.ps-item:nth-child(odd) {
		border-right: 1px solid var(--border-subtle);
	}
	.ps-marca {
		align-self: stretch;
		border-radius: 999px;
		background: var(--au-primary);
	}
	.ps-critica .ps-marca {
		background: #dc2626;
	}
	.ps-alta .ps-marca {
		background: #d97706;
	}
	.ps-contenido {
		min-width: 0;
	}
	.ps-nivel {
		display: inline-block;
		margin: 0 0 0.28rem;
		color: var(--au-primary-strong);
		font-size: 0.61rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}
	.ps-critica .ps-nivel {
		color: #b91c1c;
	}
	.ps-alta .ps-nivel {
		color: #a16207;
	}
	.ps-item h3 {
		margin: 0;
		color: var(--text-primary);
		font-size: 0.84rem;
		line-height: 1.35;
	}
	.ps-evidencia,
	.ps-accion {
		margin: 0.3rem 0 0;
		color: var(--text-secondary);
		font-size: 0.74rem;
		line-height: 1.45;
	}
	.ps-accion strong {
		color: var(--text-primary);
	}
	.ps-enlace {
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
		color: var(--au-primary-strong);
		font-size: 0.72rem;
		font-weight: 750;
		text-decoration: none;
	}
	.ps-enlace:hover {
		text-decoration: underline;
	}
	.ps-vacio {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 1rem 1.15rem;
	}
	.ps-vacio-punto {
		display: grid;
		width: 1.7rem;
		height: 1.7rem;
		place-items: center;
		border-radius: 50%;
		color: var(--au-primary-strong);
		background: rgba(var(--au-primary-rgb), 0.1);
		font-weight: 800;
	}
	.ps-vacio strong {
		color: var(--text-primary);
		font-size: 0.8rem;
	}
	.ps-vacio p {
		margin: 0.15rem 0 0;
		color: var(--text-muted);
		font-size: 0.72rem;
	}
	@media (max-width: 620px) {
		.ps-item {
			grid-template-columns: 4px minmax(0, 1fr);
		}
		.ps-enlace {
			grid-column: 2;
			justify-self: start;
		}
		.ps-item:nth-child(odd) {
			border-right: 0;
		}
	}
</style>
