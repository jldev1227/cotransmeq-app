<!--
	SelectorCanvasTerceros — el «Ir a…» compartido por los cuatro canvas del
	módulo de liquidaciones de terceros.

	POR QUÉ EXISTE: el listado de `/dashboard/liquidaciones-terceros` era el
	único sitio con enlaces a los cuatro canvas; al sustituirlo por un redirect
	al de cierres, la navegación entre ellos se quedó sin hogar. Este selector
	la devuelve, y desde CUALQUIERA de los cuatro, no solo desde cierres.

	POR QUÉ UN <select> Y NO BOTONES: el lado derecho del toolbar va justo de
	espacio y `.univer-shell-header` recorta con `overflow: hidden` SIN
	scrollbar — lo que desborda desaparece en silencio.

	OJO: no se arregla ese apretón poniendo `overflow` en
	`.univer-toolbar-right`. Los desplegables de `SelectorHojaCierre` y
	`CierreEstadoHeader` son `position: absolute` hijos suyos, y convertirlo en
	contenedor de scroll los recorta y deforma la fila entera.
-->
<script lang="ts">
	import { goto } from '$app/navigation';

	type Canvas = 'cierres' | 'ocasional' | 'adicionales' | 'ingresos';

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
		/// Opción propia del canvas anfitrión (p. ej. la vista previa PDF).
		extra?: OpcionExtra;
	}

	let { actual, anio, mes, onSalir, extra }: Props = $props();

	const RUTAS: Record<Canvas, string> = {
		cierres: '/dashboard/liquidaciones-terceros/canvas',
		ocasional: '/dashboard/liquidaciones-terceros/ocasional/canvas',
		adicionales: '/dashboard/liquidaciones-terceros/adicionales/canvas',
		ingresos: '/dashboard/liquidaciones-terceros/ingresos/canvas'
	};

	const ETIQUETAS: Record<Canvas, string> = {
		cierres: 'Cierres finales',
		ocasional: 'Ocasionales',
		adicionales: 'Adicionales',
		ingresos: 'Ingresos por cliente'
	};

	const destinos = $derived(
		(Object.keys(RUTAS) as Canvas[]).filter((c) => c !== actual)
	);

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
		// search params al montar, así que sin esto salir de MARZO 2025
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
