<script lang="ts">
	/**
	 * Visor de un documento del vehículo: PDF en `iframe` o imagen, con la URL
	 * firmada de 15 minutos que entrega el backend (el bucket es privado).
	 */
	import { ExternalLink } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { vehiculosDocumentosAPI, type DocumentoVehiculo } from '$lib/api/vehiculosDocumentos';

	interface Props {
		vehiculoId: string | null;
		doc: DocumentoVehiculo | null;
		titulo: string;
		oncerrar: () => void;
	}
	let { vehiculoId, doc, titulo, oncerrar }: Props = $props();

	let url = $state<string | null>(null);
	let error = $state(false);

	$effect(() => {
		url = null;
		error = false;
		if (!doc || !vehiculoId) return;
		const id = doc.id;
		vehiculosDocumentosAPI
			.url(vehiculoId, id)
			.then((u) => {
				if (doc?.id === id) url = u;
			})
			.catch(() => (error = true));
	});

	const esImagen = $derived(doc?.mimetype.startsWith('image/') ?? false);
	const fmt = (iso: string) =>
		new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(
			new Date(`${iso}T12:00:00`)
		);
</script>

<ModalBase
	open={!!doc}
	eyebrow={titulo}
	title={doc?.nombre ?? ''}
	subtitle={doc?.fecha_vencimiento ? `Vence el ${fmt(doc.fecha_vencimiento)}` : null}
	tamano="xl"
	sinRelleno
	{oncerrar}
>
	<div class="vd">
		{#if error}
			<p class="vd-error">No se pudo abrir el archivo. Cierra y vuelve a intentarlo.</p>
		{:else if !url}
			<CargaMascota texto="Abriendo documento…" />
		{:else if esImagen}
			<img src={url} alt={doc?.nombre} />
		{:else}
			{#key url}<iframe src={url} title={doc?.nombre}></iframe>{/key}
		{/if}
	</div>

	{#snippet pie()}
		{#if url}
			<a class="btn-secondary" href={url} target="_blank" rel="noopener noreferrer">
				<ExternalLink size={15} />
				Abrir en otra pestaña
			</a>
		{/if}
		<button type="button" class="btn-primary" onclick={oncerrar}>Cerrar</button>
	{/snippet}
</ModalBase>

<style>
	.vd {
		display: flex;
		flex-direction: column;
		height: min(75vh, 900px);
		background: var(--bg-base);
	}
	.vd iframe {
		flex: 1;
		width: 100%;
		border: 0;
	}
	.vd img {
		max-width: 100%;
		max-height: 100%;
		margin: auto;
		object-fit: contain;
	}
	.vd-error {
		margin: auto;
		color: var(--text-secondary);
	}
</style>
