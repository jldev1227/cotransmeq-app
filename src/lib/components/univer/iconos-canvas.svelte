<!--
	Iconografía compartida de las acciones de los canvas.

	POR QUÉ EXISTE
	Cada canvas declaraba sus propios `{#snippet ico…}` con el SVG a mano, así
	que la misma acción acabó dibujada distinto según la página. El caso que lo
	destapó: «enviar por correo» es un sobre en cierres, en ocasionales y en
	ingresos, pero en nómina era un avión de papel —que a 15 px se lee como un
	pin de ubicación, no como un correo—. Nadie lo hizo mal: simplemente no
	había un sitio donde estuviera dibujado UNA vez.

	Estos son los trazos que ya usaba la mayoría; el que quedaba fuera se trae
	aquí en vez de inventar un juego nuevo, para que la migración no cambie el
	aspecto de los canvas que ya estaban de acuerdo.

	CÓMO SE USA
	Los snippets se exportan desde `<script module>`, así que se importan como
	cualquier otra cosa y se pasan tal cual a `RailItem.icon`:

	    import { icoCorreo, icoVer } from '$lib/components/univer/iconos-canvas.svelte';
	    …
	    { id: 'enviar', label: 'Enviar…', icon: icoCorreo, onSelect: … }

	CUÁNDO *NO* USARLOS
	Para acciones propias de un canvas —«traer ítems», «impuestos», «liquidar»—
	sigue siendo correcto declarar el snippet en su página: son conceptos de ese
	dominio y no se repiten. Aquí solo vive lo que aparece en más de un canvas.
-->
<script lang="ts" module>
	export {
		icoVer,
		icoExcel,
		icoZip,
		icoCorreo,
		icoHistorial,
		icoRecargar,
		icoVersion,
		icoBorradores
	};
</script>

<!--
	Todos comparten caja y grosor para que pesen lo mismo en el carril: 15×15
	sobre una rejilla de 24, trazo 1.8 y `currentColor` —el color lo pone el
	botón según su `tone`, no el icono—.
-->

{#snippet icoVer()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
		<path
			d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
		/>
	</svg>
{/snippet}

<!-- Cuadrícula, no una hoja con una «X»: lo que se exporta es una TABLA. -->
{#snippet icoExcel()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<rect x="3.5" y="4" width="17" height="16" rx="2" />
		<path d="M3.5 9.5h17M3.5 15h17M9.5 4v16M15 4v16" />
	</svg>
{/snippet}

<!-- Carpeta con cremallera. Una flecha de descarga diría «descargar», que es
     lo que hacen también el Excel y el PDF; lo que distingue a esta acción es
     que lo que baja viene EMPAQUETADO. -->
{#snippet icoZip()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path
			d="M4.5 6.75A2.25 2.25 0 016.75 4.5h3.129c.53 0 1.039.21 1.414.586l1.121 1.121c.375.375.884.586 1.414.586h3.522A2.25 2.25 0 0119.5 9.043v8.207a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25V6.75z"
		/>
		<path d="M12 9.5v1M12 12v1M12 14.5v1.25" />
	</svg>
{/snippet}

<!-- Sobre. Era un avión de papel en nómina y a este tamaño se leía como un pin
     de ubicación. -->
{#snippet icoCorreo()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<rect x="3" y="5" width="18" height="14" rx="2.5" />
		<path d="M3.5 7l8.5 6 8.5-6" />
	</svg>
{/snippet}

<!-- Reloj CON la flecha de retroceso: sin ella es el icono de «versión» y las
     dos acciones conviven en el mismo carril. -->
{#snippet icoHistorial()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M12 8v4l3 2" />
		<path d="M3.05 11a9 9 0 1 1 .5 4" />
		<path d="M3 4v5h5" />
	</svg>
{/snippet}

{#snippet icoRecargar()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M4 4v5h5M20 20v-5h-5" />
		<path d="M20 9A8 8 0 006.3 6.3L4 9m0 6a8 8 0 0013.7 2.7L20 15" />
	</svg>
{/snippet}

<!-- Reloj limpio: guardar una versión es fijar un punto en el tiempo. -->
{#snippet icoVersion()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 8v4l3 2" />
	</svg>
{/snippet}

<!-- Documento con «+»: generar borradores CREA registros que antes no estaban. -->
{#snippet icoBorradores()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
		<path d="M14 3v5h5" />
		<path d="M12 11v6M15 14H9" />
	</svg>
{/snippet}
