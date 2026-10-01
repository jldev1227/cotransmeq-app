<!--
	Genera el desprendible para la app móvil.

	No es una pantalla: la abre Puppeteer desde el backend
	(`GET /conductor-portal/desprendibles/:id/pdf`) con un token de 180 s que
	solo sirve para leer los datos de ESTE desprendible.

	Ejecuta el mismo constructor que el canvas de nómina con los mismos datos
	que el canvas —liquidación con firmas, recargos de la hoja del canvas— y
	publica el PDF en `window.__desprendible`. Así el móvil recibe byte a byte el
	documento del canvas, en vez del de una plantilla aparte que divergía.

	Rompe la cadena de layouts del portal (`@public`): nada de barra superior ni
	menú, porque aquí no entra nadie a navegar.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { portalFetch } from '$lib/stores/portalStore';
	import { generarBase64Desprendible } from '$lib/utils/pdfDesprendible';

	const liquidacionId = $derived($page.params.id!);
	let estado = $state<'cargando' | 'listo' | 'error'>('cargando');
	let mensaje = $state('');

	onMount(async () => {
		try {
			const res: any = await portalFetch(
				`/conductor-portal/desprendibles/${encodeURIComponent(liquidacionId)}/datos`
			);
			const { liquidacion, firmas, recargosData } = res.data;
			const base64 = await generarBase64Desprendible(liquidacion, firmas, recargosData);
			(window as any).__desprendible = { ok: true, base64 };
			estado = 'listo';
		} catch (err: any) {
			/// `portalFetch` lanza un objeto plano con la respuesta del backend, no
			/// un `Error`: el mensaje puede venir en cualquiera de los dos sitios.
			mensaje = err?.message || 'No se pudo generar el desprendible.';
			(window as any).__desprendible = { ok: false, error: mensaje };
			estado = 'error';
		}
	});
</script>

<svelte:head><title>Desprendible · Portal del Conductor</title></svelte:head>

<p data-estado={estado}>
	{estado === 'cargando' ? 'Generando desprendible…' : estado === 'listo' ? 'Desprendible listo.' : mensaje}
</p>
