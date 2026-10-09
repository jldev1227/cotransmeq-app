<script lang="ts">
	/**
	 * Últimos movimientos de la gente de mis áreas (el admin ve a todos). Lo
	 * llena el registro de actividad del backend; el enlace lleva al histórico
	 * completo con filtros.
	 */
	import { onMount } from 'svelte';
	import { RefreshCw } from 'lucide-svelte';
	import { listarActividad, type RegistroActividad } from '$lib/api/dashboard';
	import { etiquetaModulo } from '$lib/dashboard/modulos';
	import { haceCuanto, iniciales } from '$lib/dashboard/formato';
	import Tarjeta from './Tarjeta.svelte';

	interface Props {
		limite?: number;
		columnas?: number;
	}
	let { limite = 15, columnas = 12 }: Props = $props();

	let items = $state<RegistroActividad[]>([]);
	let cargando = $state(true);
	let ahora = $state(Date.now());

	async function cargar() {
		cargando = true;
		try {
			const res = await listarActividad({ limit: limite });
			items = res.data;
			ahora = Date.now();
		} catch {
			items = [];
		} finally {
			cargando = false;
		}
	}

	onMount(() => {
		void cargar();
		const t = setInterval(() => (ahora = Date.now()), 60_000);
		return () => clearInterval(t);
	});

	/// Un color estable por persona, para distinguir avatares de un vistazo.
	function tonoDe(nombre: string): number {
		let h = 0;
		for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 360;
		return h;
	}
</script>

<Tarjeta
	titulo="Actividad reciente"
	subtitulo="Lo último que hizo tu equipo"
	enlace="/dashboard/actividad"
	enlaceTexto="Ver historial"
	{columnas}
>
	{#snippet extra()}
		<button
			type="button"
			class="ar-refrescar"
			onclick={cargar}
			disabled={cargando}
			aria-label="Actualizar"
		>
			<RefreshCw size={14} strokeWidth={2.2} class={cargando ? 'ar-girar' : ''} />
		</button>
	{/snippet}

	{#if cargando && items.length === 0}
		<ul class="ar ar--esqueleto" aria-hidden="true">
			{#each Array(5) as _, i (i)}
				<li class="ar-fila"><span class="ar-avatar"></span><span class="ar-hueso"></span></li>
			{/each}
		</ul>
	{:else if items.length === 0}
		<p class="ar-vacio">
			Todavía no hay actividad registrada. Aquí verás lo que vaya haciendo tu equipo.
		</p>
	{:else}
		<ul class="ar">
			{#each items as it (it.id)}
				<li class="ar-fila">
					<span class="ar-avatar" style="--h: {tonoDe(it.usuario_nombre)}"
						>{iniciales(it.usuario_nombre)}</span
					>
					<div class="ar-texto">
						<p class="ar-linea">
							<strong>{it.usuario_nombre}</strong>
							{it.descripcion}
						</p>
						<p class="ar-meta">
							<span class="ar-modulo">{etiquetaModulo(it.modulo)}</span>
							<span>·</span>
							<time datetime={it.created_at}>{haceCuanto(it.created_at, ahora)}</time>
						</p>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Tarjeta>

<style>
	.ar {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 0.35rem 1.25rem;
	}
	.ar-fila {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.45rem 0;
		border-bottom: 1px dashed var(--border-subtle);
		min-width: 0;
	}
	.ar-avatar {
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: hsl(var(--h, 160) 45% 92%);
		color: hsl(var(--h, 160) 45% 28%);
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.02em;
	}
	.ar-texto {
		min-width: 0;
	}
	.ar-linea {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.35;
		color: var(--text-secondary);
	}
	.ar-linea strong {
		color: var(--text-primary);
		font-weight: 700;
	}
	.ar-meta {
		margin: 0.15rem 0 0;
		display: flex;
		gap: 0.35rem;
		font-size: 0.68rem;
		color: var(--text-very-muted);
	}
	.ar-modulo {
		font-weight: 700;
		color: var(--au-primary-strong);
	}
	.ar-vacio {
		margin: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--text-very-muted);
	}
	.ar-refrescar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--border-subtle);
		border-radius: 9px;
		background: var(--bg-surface);
		color: var(--text-muted);
		cursor: pointer;
	}
	.ar-refrescar:hover:not(:disabled) {
		color: var(--au-dark);
		border-color: var(--au-primary);
	}
	:global(.ar-girar) {
		animation: ar-girar 0.9s linear infinite;
	}
	@keyframes ar-girar {
		to {
			transform: rotate(360deg);
		}
	}
	.ar--esqueleto .ar-avatar {
		background: var(--bg-base);
	}
	.ar-hueso {
		height: 12px;
		flex: 1;
		margin-top: 9px;
		border-radius: 999px;
		background: var(--bg-base);
	}
</style>
