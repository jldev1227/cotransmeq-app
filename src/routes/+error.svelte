<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { mascota } from '$lib/mascot';

	const estado = $derived($page.status);
	const esNoEncontrada = $derived(estado === 404);
	const rutaPedida = $derived($page.url.pathname);

	/**
	 * `+error.svelte` es el catch-all de SvelteKit: atiende el 404 y también
	 * cualquier error lanzado en un `load`. El 404 tiene copy propio porque es
	 * el único caso en que la culpa no es del sistema.
	 */
	const titulo = $derived(esNoEncontrada ? 'Esta página no existe' : 'Algo salió mal');

	const detalle = $derived(
		esNoEncontrada
			? 'La dirección que abriste no corresponde a ninguna pantalla del sistema. Puede que el enlace esté viejo o que la sección se haya movido.'
			: ($page.error?.message ??
					'El sistema no pudo completar la operación. Vuelve a intentarlo en unos segundos.')
	);

	/** La mascota busca sin encontrar en el 404; avisa en cualquier otro error. */
	const imagen = $derived(mascota(esNoEncontrada ? 'vacio' : 'advertencia'));

	/** `history.length > 1` evita ofrecer un «atrás» que no lleva a ningún lado. */
	let puedeVolver = $state(false);
	onMount(() => {
		puedeVolver = history.length > 1;
	});
</script>

<svelte:head>
	<title>{esNoEncontrada ? 'Página no encontrada' : 'Error'} · Cotransmeq</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="error-page">
	<div class="error-inner" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
		<img class="error-mascot" src={imagen.src} alt={imagen.alt} width="418" height="418" />

		<span class="error-badge">Error {estado}</span>

		<h1 class="error-title">{titulo}</h1>

		<p class="error-detail">{detalle}</p>

		{#if esNoEncontrada}
			<p class="error-path" in:fade={{ duration: 300, delay: 150 }}>{rutaPedida}</p>
		{/if}

		<div class="error-actions">
			<!--
				El destino es `/` y no una ruta calculada aquí: `routes/+page.svelte`
				ya resuelve las tres ramas —sesión administrativa al panel,
				dispositivo marcado a SU portal, y el resto al login— y es la única
				copia de esa decisión. Repetirla en el 404 significaría mantener dos,
				y la de aquí llegaría con la respuesta equivocada: el `authStore` se
				hidrata de forma asíncrona, así que en el primer pintado todavía no
				sabe si hay sesión.
			-->
			<a href="/" class="btn-primary">Ir al inicio</a>

			{#if puedeVolver}
				<button type="button" onclick={() => history.back()} class="btn-secondary">
					Volver atrás
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		min-height: 100dvh;
		padding: 2rem 1.25rem;
		background: var(--au-bg);
		color: var(--au-text);
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
	}

	.error-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		width: 100%;
		max-width: 32rem;
	}

	.error-mascot {
		width: 12rem;
		height: 12rem;
		object-fit: contain;
		margin-bottom: 0.5rem;
	}
	@media (min-width: 640px) {
		.error-mascot {
			width: 15rem;
			height: 15rem;
		}
	}

	.error-badge {
		display: inline-block;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--au-primary-strong);
		background: var(--au-tint);
	}

	.error-title {
		font-size: clamp(1.7rem, 5vw, 2.4rem);
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: -0.03em;
		margin: 1.25rem 0 0;
	}

	.error-detail {
		font-size: 0.95rem;
		line-height: 1.6;
		color: var(--au-muted);
		margin: 0.85rem 0 0;
		max-width: 28rem;
	}

	.error-path {
		display: inline-block;
		max-width: 100%;
		margin: 1.25rem 0 0;
		padding: 0.4rem 0.8rem;
		border: 1.5px solid var(--au-border);
		border-radius: 10px;
		background: var(--au-surface);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--au-muted);
		word-break: break-all;
	}

	.error-actions {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.75rem;
		width: 100%;
		margin-top: 2rem;
	}
	@media (min-width: 640px) {
		.error-actions {
			flex-direction: row;
			justify-content: center;
			width: auto;
		}
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 3.25rem;
		padding: 0.85rem 1.75rem;
		border-radius: 14px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
		transition:
			background-color 0.2s ease,
			transform 0.15s ease;
	}
	.btn-primary {
		color: #ffffff;
		background: var(--au-primary);
		border: none;
		box-shadow: 0 8px 20px rgba(var(--au-primary-rgb), 0.28);
	}
	.btn-primary:hover {
		background: var(--au-primary-strong);
		transform: translateY(-1px);
	}
	.btn-secondary {
		color: var(--au-dark);
		background: transparent;
		border: 1.5px solid var(--au-primary);
	}
	.btn-secondary:hover {
		background: var(--au-tint);
	}
	.btn-primary:focus-visible,
	.btn-secondary:focus-visible {
		outline: none;
		box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb), 0.25);
	}
</style>
