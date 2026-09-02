<!--
	El editor de liquidaciones DENTRO del canvas: crear, editar y ver.

	Monta el mismo `LiquidacionEditor` que usan `/liquidaciones-servicios/nueva`,
	`/editar/[id]` y `/[id]`. Se reutiliza el componente entero en vez de extraer
	«solo el formulario» o «solo el preview» porque son ~9.700 líneas con sus
	cuatro hojas, sus recargos y su hoja de terceros: una copia divergiría en
	cuanto alguien tocara una de las dos.

	Va en un overlay y no en una navegación para no perder el canvas: el usuario
	llega aquí después de filtrar por año, seleccionar filas y hacer scroll, y
	salir de la ruta remontaría el engine de Univer y tiraría ese trabajo.

	Los tres modos viven en UN solo componente a propósito. El editor usa
	`document.querySelector` sin acotar (posición del desplegable de placa,
	navegación con Enter entre celdas) y una clave de borrador por id en
	localStorage: dos instancias montadas a la vez se pisarían. Como `solicitud`
	es un único objeto, solo puede haber una.

	El import es DINÁMICO. Esas ~9.700 líneas arrastran los catálogos, el
	generador de PDF y la búsqueda de terceros; cargarlas junto al canvas
	retrasaría la primera pintura de la hoja para todo el mundo, cuando el editor
	solo lo abre quien pulsa un botón.

	SIN cabecera, SIN velo y SIN Escape — al revés que `ModalConfigLiquidador` y
	el resto de modales del canvas. No es un descuido:

	- El chrome es la toolbar del propio editor, que ya trae Volver, Cancelar y
	  Guardar. Una cabecera encima añadiría un segundo «cerrar» compitiendo con
	  su «Volver», y en la vista de impresión quedaría tapada por `.pdf-wrap`,
	  que es `position: fixed`. Ese es justo el fallo que tenía el preview
	  anterior: su ✕ era inalcanzable y la única salida visible navegaba fuera.
	- Escape ya significa otra cosa aquí dentro: el editor lo usa para salir de
	  una celda, y sus modales de impresión e historial lo esperan para cerrarse.
	  Un formulario de 9.700 líneas con datos sin guardar no es una hoja que se
	  cierre sin querer.
	- No hay fondo sobre el que hacer clic: la capa es opaca y ocupa el viewport.
-->
<script lang="ts" module>
	export type ModoEditor = 'crear' | 'editar' | 'ver';

	export interface SolicitudEditor {
		modo: ModoEditor;
		/// `null` solo en `crear`.
		id: string | null;
	}
</script>

<script lang="ts">
	import type { Component } from 'svelte';
	import type { LiquidacionServicio } from '$lib/api/liquidaciones-servicios';

	interface Props {
		/// `null` = cerrado. Un objeto y no `(modo, id)` sueltos para que abrir sea
		/// una sola asignación que no pueda quedar a medias.
		solicitud: SolicitudEditor | null;
		onClose: () => void;
		onGuardada: (l: LiquidacionServicio) => void;
	}

	let { solicitud, onClose, onGuardada }: Props = $props();

	/// Los props que le pasamos, escritos aquí porque `LiquidacionEditor` se
	/// carga dinámicamente y no hay import estático del que inferirlos. Tipado y
	/// no `any`: es lo único que avisa si un día cambia su contrato.
	type PropsEditor = {
		editId: string | null;
		viewMode: boolean;
		onClose: () => void;
		onGuardada: (l: LiquidacionServicio) => void;
	};

	let Editor = $state<Component<PropsEditor> | null>(null);
	let cargandoModulo = $state(false);
	let errorModulo = $state('');

	$effect(() => {
		/// `!errorModulo` no sobra: al fallar, `cargandoModulo` vuelve a `false` y
		/// eso reactiva este efecto. Sin el guard, una carga que falla de verdad
		/// (red caída, chunk que ya no está tras un despliegue) reintentaría en
		/// bucle cerrado en vez de enseñar el aviso una vez.
		if (solicitud && !Editor && !cargandoModulo && !errorModulo) {
			cargandoModulo = true;
			import('$lib/components/LiquidacionEditor.svelte')
				.then((m) => {
					Editor = m.default as unknown as Component<PropsEditor>;
				})
				.catch((e) => {
					errorModulo = e?.message || 'No se pudo cargar el editor';
				})
				.finally(() => {
					cargandoModulo = false;
				});
		}
	});

	const etiqueta = $derived(
		solicitud?.modo === 'crear'
			? 'Nueva liquidación'
			: solicitud?.modo === 'editar'
				? 'Editar liquidación'
				: 'Preview de la liquidación'
	);

	/// El editor lee `editId` solo al montar, así que cambiar de liquidación o de
	/// modo con el overlay abierto tiene que remontarlo.
	const clave = $derived(`${solicitud?.modo}:${solicitud?.id ?? 'nuevo'}`);
</script>

{#if solicitud}
	<div class="ml-capa" role="dialog" aria-modal="true" aria-label={etiqueta}>
		{#if errorModulo}
			<p class="ml-aviso ml-error">{errorModulo}</p>
		{:else if !Editor}
			<p class="ml-aviso">Cargando el editor…</p>
		{:else}
			{#key clave}
				<Editor editId={solicitud.id} viewMode={solicitud.modo === 'ver'} {onClose} {onGuardada} />
			{/key}
		{/if}
	</div>
{/if}

<style>
	.ml-capa {
		position: fixed;
		inset: 0;
		/* 1200 y no 70 como el preview anterior: `.univer-host` es
		   `position: relative` SIN `z-index` (UniverCanvasHost.svelte:75-82), así
		   que no crea contexto de apilamiento y los elementos `fixed` internos de
		   Univer —el editor de celda y la raíz de portales, `z-index: 1000`—
		   competirían de tú a tú con este overlay y asomarían por encima. */
		z-index: 1200;
		/* El mismo fondo que `.wb-shell`, para que no se vea una costura mientras
		   el editor carga. */
		background: #fcfcfb;
		overflow: hidden;
	}
	.ml-aviso {
		margin: 0;
		padding: 40px 0;
		text-align: center;
		font-size: 13px;
		color: #64748b;
	}
	.ml-error {
		color: #b91c1c;
	}
</style>
