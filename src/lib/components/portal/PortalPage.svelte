<!--
	Contenedor de una pantalla del portal.

	Existe para que las cinco páginas compartan ancho, respiración y el hueco
	inferior que deja libre la barra de navegación. Antes cada una traía su propio
	`.pagina` / `.page-body` con paddings distintos, y al saltar entre pestañas el
	contenido se movía de sitio.

	El `padding-bottom` generoso NO es decorativo: la barra inferior es fija y sin
	ese hueco la última tarjeta queda debajo, fuera del alcance del pulgar.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="portal-page">
	{@render children()}
</div>

<style>
	.portal-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 720px;
		margin: 0 auto;
		padding: 1rem 0.875rem 5rem;
	}
</style>
