<!--
	Documento imprimible de un envío, para el conductor.

	── Por qué existe, si ya está el recibo ──
	`../+page.svelte` es un RECIBO: confirma que el envío llegó y repite las
	respuestas con el renderer del formulario, que lista la evidencia como texto
	(«image/jpeg · 280 KB»). Sirve en pantalla y no sirve en papel: el PDF que la
	app móvil descarga salía sin firmas y sin fotos.

	Lo que el conductor necesita es EL MISMO documento que el dashboard exporta a
	los administradores —`PreviewEnvioPDF`, con la cabecera del formato HSEQ, las
	firmas dibujadas y las fotos embebidas—, y ese componente vivía solo detrás
	de la autenticación del dashboard. Aquí se consume tal cual, con los datos
	que el portal ya devuelve: `obtenerEnvioPortal` entrega `{ submission,
	definition }` con las URL de S3 ya firmadas, exactamente la misma forma que
	la del dashboard. Un solo documento y un solo sitio que mantener.

	── Es una hoja, no una pantalla ──
	Rompe la cadena de layouts del portal (`+page@public.svelte`): sin barra
	superior, sin menú lateral, sin navegación inferior y sin el arranque de la
	outbox. No hay nada que pulsar porque nadie entra aquí a pulsar: se entra a
	imprimir. La barra «Exportar PDF» del propio componente se oculta por lo
	mismo —el PDF lo compone quien navega esta página, no un botón de dentro.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { portalFormulariosAPI } from '$lib/api/formularios-portal';
	import type { FormVersionDto, SubmissionDetailDto } from '$lib/formularios/types';
	import PreviewEnvioPDF from '$lib/components/formularios/PreviewEnvioPDF.svelte';

	const submissionId = $derived($page.params.id!);

	let envio = $state<SubmissionDetailDto | null>(null);
	let definicion = $state<FormVersionDto | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			/// El token del magic link lo pone `portalFormulariosAPI` en la cabecera
			/// `Authorization`, leyéndolo de `portalSession`. Es la misma puerta que
			/// el resto del portal, y el backend filtra por `conductor_id`: un envío
			/// ajeno da 404 aquí igual que en cualquier otra pantalla.
			const { submission, definition } = await portalFormulariosAPI.envio(submissionId);
			envio = submission;
			definicion = definition;
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo cargar el documento.';
		} finally {
			cargando = false;
		}
	});
</script>

<svelte:head><title>Documento del envío · Portal del Conductor</title></svelte:head>

<!-- `data-listo` es la señal de «ya tengo mis datos» para quien imprime esta
     página desde fuera, igual que en el recibo: el PDF lo genera Chromium
     navegando aquí, y en una SPA el evento `load` llega ANTES de la respuesta
     del primer `fetch`, así que sin esta marca se imprimiría el «Cargando
     documento…». Se distingue `error` de `si` para que una carga fallida NO se
     imprima: el impresor espera `[data-listo="si"]` y prefiere agotar su
     espera —y fallar— antes que entregar una hoja en blanco como si fuera el
     registro. -->
<div class="hoja" data-listo={cargando ? 'no' : error ? 'error' : 'si'}>
	{#if cargando}
		<p class="estado" aria-busy="true">Cargando documento…</p>
	{:else if error}
		<p class="estado estado--error" role="alert">{error}</p>
	{:else if envio && definicion}
		<PreviewEnvioPDF {envio} {definicion} />
	{/if}
</div>

<style>
	/* Lienzo blanco. El caparazón público pinta un beige de marca que, con
	   `printBackground`, saldría de fondo en todas las hojas del PDF. */
	.hoja,
	.hoja :global(.visor) {
		background: #fff;
	}

	:global(.public-shell) {
		background: #fff;
	}

	/* La barra de herramientas del componente («Exportar PDF») se oculta SIEMPRE,
	   no solo al imprimir: aquí no hay nada que exportar desde dentro, porque
	   esta página ES el documento que se está exportando. */
	.hoja :global(.no-print) {
		display: none !important;
	}

	@media print {
		/* Contenedores de bloque, no flex.
		   El visor del componente es una columna flex —tiene sentido en pantalla,
		   donde separa la barra del documento—, y Chromium fragmenta mal un
		   contenedor flex: con el documento dentro de uno salía una hoja de más,
		   en blanco salvo el pie corrido. En papel la barra ya no existe y solo
		   queda un hijo, así que `block` da exactamente la misma disposición y
		   deja que el motor parta el documento por donde el propio documento
		   dice. El PDF del dashboard nunca vio esto porque exporta el `<article>`
		   suelto, sin el visor. */
		.hoja,
		.hoja :global(.visor) {
			display: block;
		}
	}

	.estado {
		padding: 3rem 1rem;
		text-align: center;
		color: #6b6b6b;
	}

	.estado--error {
		color: #b91c1c;
	}
</style>
