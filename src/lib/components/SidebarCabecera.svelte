<script lang="ts">
	/**
	 * Cabecera del menú lateral: una franja de marca de la misma altura que la
	 * barra superior (64 px), para que las dos formen una sola línea. Lleva el
	 * logotipo sobre el verde con los círculos decorativos del menú de la app.
	 *
	 * No repite el nombre del usuario: ya está en la barra superior. Con el
	 * menú contraído (`compacta`) queda solo el isotipo.
	 */
	export let compacta = false;
	/// En el cajón móvil la cabecera llega hasta arriba: respeta el notch.
	export let conSafeArea = false;
	export let logo = '/assets/logo_nombre_white.webp';
	export let logoCompacto = '/favicon-32x32.png';
	export let alt = 'Cotransmeq';
</script>

<div class="cabecera" class:cabecera--compacta={compacta} class:cabecera--safe={conSafeArea}>
	<span class="orbe orbe--grande" aria-hidden="true"></span>
	<span class="orbe orbe--chico" aria-hidden="true"></span>
	{#if compacta}
		<img class="logo logo--compacto" src={logoCompacto} {alt} title={alt} />
	{:else}
		<img class="logo" src={logo} {alt} />
	{/if}
</div>

<style>
	.cabecera {
		position: relative;
		overflow: hidden;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		height: 4rem; /* = h-16 de la barra superior */
		padding: 0 1.25rem;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 100%);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.cabecera--safe {
		height: calc(4rem + env(safe-area-inset-top, 0px));
		padding-top: env(safe-area-inset-top, 0px);
	}
	.cabecera--compacta {
		justify-content: center;
		padding: 0 0.5rem;
	}
	.orbe {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.07);
	}
	.orbe--grande {
		width: 120px;
		height: 120px;
		right: -40px;
		top: -70px;
	}
	.orbe--chico {
		width: 56px;
		height: 56px;
		left: -20px;
		bottom: -34px;
	}
	.logo {
		position: relative;
		z-index: 1;
		height: 2.6rem;
		max-width: 100%;
		width: auto;
		object-fit: contain;
	}
	.logo--compacto {
		height: 2rem;
		max-width: 4.5rem;
	}
</style>
