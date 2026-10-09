<script lang="ts">
	/**
	 * Tarjeta de un widget del panel: título, subtítulo, un enlace «Ver» a la
	 * pantalla de origen y el contenido. `tono="alerta"` la enmarca en ámbar
	 * para los avisos (pendientes, vencidos, sin cerrar).
	 */
	import type { Snippet } from 'svelte';
	import { ArrowUpRight } from 'lucide-svelte';

	interface Props {
		titulo: string;
		subtitulo?: string;
		enlace?: string;
		enlaceTexto?: string;
		tono?: 'normal' | 'alerta';
		/** Ancho en columnas de la rejilla de 12. */
		columnas?: number;
		children: Snippet;
		extra?: Snippet;
	}
	let {
		titulo,
		subtitulo,
		enlace,
		enlaceTexto = 'Ver',
		tono = 'normal',
		columnas = 4,
		children,
		extra
	}: Props = $props();
</script>

<section class="tj tj--{tono}" style="--col: {columnas}">
	<header class="tj-cab">
		<div class="tj-cab-texto">
			<h3 class="tj-titulo">{titulo}</h3>
			{#if subtitulo}<p class="tj-sub">{subtitulo}</p>{/if}
		</div>
		{#if extra}{@render extra()}{/if}
		{#if enlace}
			<a class="tj-enlace" href={enlace}>
				{enlaceTexto}
				<ArrowUpRight size={14} strokeWidth={2.4} />
			</a>
		{/if}
	</header>
	<div class="tj-cuerpo">
		{@render children()}
	</div>
</section>

<style>
	.tj {
		grid-column: span var(--col);
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 20px;
		padding: 1rem 1.15rem 1.1rem;
		box-shadow: var(--shadow-card);
	}
	.tj--alerta {
		border-color: #f6d59a;
		background: linear-gradient(180deg, #fffaf0 0%, var(--bg-surface) 70%);
	}
	.tj-cab {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.tj-cab-texto {
		min-width: 0;
	}
	.tj-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}
	.tj-sub {
		margin: 0.1rem 0 0;
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.tj-enlace {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--au-primary-strong);
		text-decoration: none;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		transition: background 0.15s var(--ease-apple);
	}
	.tj-enlace:hover {
		background: var(--au-tint);
	}
	.tj-cuerpo {
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	@media (max-width: 1100px) {
		.tj {
			grid-column: span 6;
		}
	}
	@media (max-width: 700px) {
		.tj {
			grid-column: span 12;
		}
	}
</style>
