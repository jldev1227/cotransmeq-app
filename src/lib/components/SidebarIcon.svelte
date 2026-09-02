<script context="module" lang="ts">
	/// Grosor y tamaño únicos para toda la barra. Los SVG escritos a mano que
	/// había antes mezclaban `stroke-width` 1.5 y 2, y varios rellenaban con
	/// `fill="currentColor"` en vez de trazar (las ventanas del edificio, las
	/// teclas de la calculadora): en la misma columna convivían iconos de línea
	/// fina con manchas sólidas. Se exportan para que el chevron de «Contraer» y
	/// la «X» del drawer —que no son iconos de módulo— no vuelvan a desviarse.
	export const SIDEBAR_ICON_STROKE = 1.75;
	export const SIDEBAR_ICON_SIZE = 20;
</script>

<script lang="ts">
	import type { ComponentType } from 'svelte';

	/// El menú se pinta dos veces, en la barra de escritorio y en el drawer móvil.
	/// Con un `<svg>` copiado en cada plantilla, tocar el tamaño o el color activo
	/// en una dejaba la otra atrás; aquí solo hay un sitio donde tocarlo.

	/** Componente de `lucide-svelte` que representa el módulo. */
	export let icon: ComponentType;
	/** Tiñe el icono de esmeralda cuando su entrada es la sección abierta. */
	export let active = false;
</script>

<span
	class="apple-transition flex h-5 w-5 flex-shrink-0 items-center justify-center"
	style="color: {active ? 'var(--orange-500)' : 'currentColor'};"
>
	<svelte:component
		this={icon}
		class="h-5 w-5"
		size={SIDEBAR_ICON_SIZE}
		strokeWidth={SIDEBAR_ICON_STROKE}
	/>
</span>
