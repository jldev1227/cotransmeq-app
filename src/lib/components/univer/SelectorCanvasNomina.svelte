<!--
	SelectorCanvasNomina — el «Ir a…» compartido por los canvas del módulo de
	nómina.

	POR QUÉ EXISTE: es el gemelo de `SelectorCanvasTerceros` y nace del mismo
	problema. Cuando el listado de `/dashboard/nomina` deja de ser el hogar de
	las tres vistas —liquidaciones, primas y análisis— y cada una pasa a vivir
	en su propio canvas, la navegación entre ellas se queda sin sitio. Este
	selector la devuelve, y desde CUALQUIERA de los canvas, no solo desde uno.

	POR QUÉ UN <select> Y NO BOTONES: el lado derecho del toolbar va justo de
	espacio y `.univer-shell-header` recorta con `overflow: hidden` SIN
	scrollbar — lo que desborda desaparece en silencio. Con tres destinos hoy
	cabrían botones; con el cuarto, no, y el fallo no avisa.

	OJO: no se arregla ese apretón poniendo `overflow` en
	`.univer-toolbar-right`. Los desplegables que cuelgan de él son
	`position: absolute` hijos suyos, y convertirlo en contenedor de scroll los
	recorta y deforma la fila entera.
-->
<script lang="ts">
	import { goto } from '$app/navigation';

	type Canvas = 'liquidaciones' | 'primas' | 'analisis';

	interface OpcionExtra {
		value: string;
		label: string;
		disabled?: boolean;
		onSelect: () => void;
	}

	interface Props {
		/// Canvas en el que vive el selector; se omite de su propia lista.
		actual: Canvas;
		anio: number;
		mes: number;
		/**
		 * Gancho previo a navegar: aquí cada canvas suelta su sesión, vacía su
		 * cola o pide confirmación. Devolver `false` cancela el salto.
		 */
		onSalir?: () => boolean;
		/// Opción propia del canvas anfitrión (p. ej. una vista previa).
		extra?: OpcionExtra;
	}

	let { actual, anio, mes, onSalir, extra }: Props = $props();

	/// Solo se listan destinos que existen: un «Ir a…» que promete llevarte a
	/// algún sitio y da un 404 es peor que no ofrecerlo.
	const RUTAS: Record<Canvas, string> = {
		liquidaciones: '/dashboard/nomina/canvas',
		primas: '/dashboard/nomina/primas/canvas',
		analisis: '/dashboard/nomina/analisis/canvas'
	};

	const ETIQUETAS: Record<Canvas, string> = {
		liquidaciones: 'Liquidaciones',
		primas: 'Primas',
		analisis: 'Análisis'
	};

	const destinos = $derived((Object.keys(RUTAS) as Canvas[]).filter((c) => c !== actual));

	function elegir(e: Event) {
		const sel = e.currentTarget as HTMLSelectElement;
		const valor = sel.value;
		// Vuelve a mostrar el placeholder aunque se cancele el salto.
		sel.value = '';
		if (!valor) return;

		if (extra && valor === extra.value) {
			extra.onSelect();
			return;
		}
		if (onSalir && onSalir() === false) return;
		// El periodo abierto viaja al destino: todos leen `anio`/`mes` de sus
		// search params al montar, así que sin esto salir de MARZO 2026
		// aterrizaría en el mes en curso.
		goto(`${RUTAS[valor as Canvas]}?anio=${anio}&mes=${mes}`);
	}
</script>

<select
	class="univer-month-picker"
	value=""
	title="Abrir otro canvas del módulo con este mismo periodo"
	onchange={elegir}
>
	<option value="" disabled>Ir a…</option>
	{#each destinos as d (d)}
		<option value={d}>{ETIQUETAS[d]}</option>
	{/each}
	{#if extra}
		<option value={extra.value} disabled={extra.disabled}>{extra.label}</option>
	{/if}
</select>
