<script lang="ts">
	/**
	 * Novedades de un preoperacional: qué quedó en «Malo» y qué escribió el
	 * conductor. Es a donde lleva el aviso a mantenimiento (`preop_malo`).
	 *
	 * Vive aquí y no en `/dashboard/formularios/envios/<id>` porque esa
	 * pantalla es del módulo `formularios`, que el área mantenimiento no tiene.
	 * A quien sí lo tiene se le ofrece saltar al envío completo.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { CircleX } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import {
		fecha as fmtFecha,
		km as fmtKm,
		mantenimientoAPI,
		type NovedadesPreoperacional
	} from '$lib/api/mantenimiento';

	interface Props {
		open: boolean;
		envioId: string | null;
		puedeEscribir: boolean;
		puedeFormularios: boolean;
		oncerrar: () => void;
		oncrearcorrectiva: (inicial: { vehiculo_id: string; descripcion: string }) => void;
	}
	let { open, envioId, puedeEscribir, puedeFormularios, oncerrar, oncrearcorrectiva }: Props =
		$props();

	let envio = $state<NovedadesPreoperacional | null>(null);

	$effect(() => {
		if (!open || !envioId) return;
		const id = envioId;
		untrack(async () => {
			envio = null;
			try {
				envio = await mantenimientoAPI.preoperacional(id);
			} catch (e) {
				toast.error(e instanceof Error ? e.message : 'No se pudo abrir el preoperacional');
				oncerrar();
			}
		});
	});

	/// La orden correctiva nace con la lista de lo que falló: es lo que el
	/// taller tiene que revisar.
	function crearCorrectiva() {
		if (!envio?.vehiculo) return;
		const lista = envio.items
			.map((i) => `- ${i.label}${i.observacion ? `: ${i.observacion}` : ''}`)
			.join('\n');
		oncrearcorrectiva({
			vehiculo_id: envio.vehiculo.id,
			descripcion: `Novedades del preoperacional del ${fmtFecha(envio.fecha)}:\n${lista}`
		});
	}
</script>

<ModalBase
	{open}
	title={envio ? `Preoperacional · ${envio.vehiculo?.placa ?? 'sin placa'}` : 'Preoperacional'}
	eyebrow="NOVEDADES PARA MANTENIMIENTO"
	subtitle={envio
		? `${envio.conductor ?? 'Sin conductor'} · ${fmtFecha(envio.fecha)} · ${envio.codigo}`
		: null}
	tamano="md"
	{oncerrar}
>
	{#if !envio}
		<CargaMascota texto="Abriendo el preoperacional…" />
	{:else}
		<div class="np">
			{#if envio.vehiculo}
				<p class="np-vehiculo">
					{[envio.vehiculo.marca, envio.vehiculo.linea].filter(Boolean).join(' ') || 'Vehículo'} ·
					{fmtKm(envio.vehiculo.km_actual)} en la ficha
				</p>
			{/if}
			{#if envio.items.length === 0}
				<p class="np-vacio">Este preoperacional no tiene ítems en Malo.</p>
			{:else}
				<ul class="np-items">
					{#each envio.items as it (it.key)}
						<li>
							<CircleX size={17} />
							<div>
								<strong>{it.label}</strong>
								{#if it.observacion}<span>{it.observacion}</span>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
	{#snippet pie()}
		{#if envio}
			{#if puedeFormularios}
				<a class="btn-secondary" href={`/dashboard/formularios/envios/${envio.id}`}
					>Ver el envío completo</a
				>
			{/if}
			{#if puedeEscribir && envio.vehiculo && envio.items.length}
				<button type="button" class="btn-primary" onclick={crearCorrectiva}
					>Abrir orden correctiva</button
				>
			{/if}
		{/if}
	{/snippet}
</ModalBase>

<style>
	.np {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.np-vehiculo,
	.np-vacio {
		margin: 0;
		font-size: 0.84rem;
		color: var(--text-muted);
	}
	.np-items {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		overflow: hidden;
	}
	.np-items li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		color: #dc2626;
	}
	.np-items li + li {
		border-top: 1px solid var(--border-subtle);
	}
	.np-items div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.np-items strong {
		font-size: 0.88rem;
		color: var(--text-primary);
	}
	.np-items span {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
</style>
