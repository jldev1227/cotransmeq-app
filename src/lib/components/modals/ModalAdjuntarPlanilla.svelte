<script lang="ts">
	import { CalendarDays, FileText, Loader2, Upload } from 'lucide-svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { getNombreMes } from '$lib/utils/recargosHelpers';
	import type { CanvasRecargo } from '$lib/types/recargos';

	interface Props {
		open: boolean;
		recargo: CanvasRecargo;
		cargando?: boolean;
		oncerrar: () => void;
		onsubir: (archivo: File) => void;
	}

	let { open, recargo, cargando = false, oncerrar, onsubir }: Props = $props();
	let archivo = $state<File | null>(null);

	const nombreConductor = $derived(
		`${recargo.conductor?.nombre ?? ''} ${recargo.conductor?.apellido ?? ''}`.trim() ||
			'Sin conductor'
	);
	const rangoDias = $derived.by(() => {
		const dias = [
			...new Set(
				(recargo.dias_laborales ?? [])
					.filter((dia) => dia.disponibilidad || Number(dia.total_horas) > 0)
					.map((dia) => Number(dia.dia))
			)
		].filter((dia) => Number.isInteger(dia) && dia > 0);
		const cantidad = Number(recargo.total_dias) || dias.length;
		const unidad = cantidad === 1 ? 'día registrado' : 'días registrados';
		const mes = getNombreMes(Number(recargo.mes)).toLocaleLowerCase('es-CO');

		if (dias.length > 0) {
			const inicio = Math.min(...dias);
			const fin = Math.max(...dias);
			const fechas = inicio === fin ? `${inicio} de ${mes}` : `del ${inicio} al ${fin} de ${mes}`;
			return `${fechas} de ${recargo.año} · ${cantidad} ${unidad}`;
		}

		return `${mes} de ${recargo.año} · ${cantidad} ${unidad}`;
	});

	function manejarArchivo(event: Event) {
		archivo = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
	}

	function tamanoArchivo(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<ModalBase
	{open}
	tamano="md"
	eyebrow="Adjunto de recargos"
	title={recargo.tiene_documento ? 'Reemplazar soporte' : 'Adjuntar soporte'}
	subtitle="Confirma la planilla y selecciona el archivo que quieres asociar."
	cerrarAlFondo={!cargando}
	bloqueado={cargando}
	{oncerrar}
>
	<div class="resumen-planilla">
		<div class="resumen-cabecera">
			<span class="resumen-icono"><FileText size={20} aria-hidden="true" /></span>
			<div class="resumen-titulo">
				<span>Planilla</span>
				<strong>{recargo.numero_planilla || 'Sin número asignado'}</strong>
			</div>
			{#if recargo.tiene_documento}
				<span class="estado-adjunto">Tiene soporte</span>
			{/if}
		</div>

		<dl class="resumen-datos">
			<div>
				<dt>Empresa</dt>
				<dd>{recargo.empresa?.nombre || 'Sin empresa'}</dd>
			</div>
			<div>
				<dt>Vehículo</dt>
				<dd>{recargo.vehiculo?.placa || 'Sin placa'}</dd>
			</div>
			<div>
				<dt>Conductor</dt>
				<dd>{nombreConductor}</dd>
			</div>
			<div class="resumen-periodo">
				<dt><CalendarDays size={14} aria-hidden="true" /> Período cubierto</dt>
				<dd>{rangoDias}</dd>
			</div>
		</dl>
		<p class="nota-rango">Se muestra el rango y el total; no se listan los días individuales.</p>
	</div>

	<div class="selector-archivo">
		<Campo id="adjunto-planilla-archivo" label="Archivo de soporte" requerido>
			<input
				id="adjunto-planilla-archivo"
				class="input-archivo"
				type="file"
				accept="application/pdf,image/jpeg,image/png,image/webp"
				required
				disabled={cargando}
				onchange={manejarArchivo}
			/>
		</Campo>
		<p class="ayuda-archivo">Formatos admitidos: PDF, JPG, PNG o WebP.</p>
		{#if archivo}
			<div class="archivo-seleccionado" role="status">
				<FileText size={17} aria-hidden="true" />
				<span class="archivo-nombre">{archivo.name}</span>
				<span class="archivo-tamano">{tamanoArchivo(archivo.size)}</span>
			</div>
		{/if}
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={cargando} onclick={oncerrar}>
			Cancelar
		</button>
		<button
			type="button"
			class="btn-primary"
			disabled={!archivo || cargando}
			onclick={() => archivo && onsubir(archivo)}
		>
			{#if cargando}
				<Loader2 size={16} class="animate-spin" aria-hidden="true" /> Subiendo…
			{:else}
				<Upload size={16} aria-hidden="true" />
				{recargo.tiene_documento ? 'Reemplazar soporte' : 'Subir soporte'}
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.resumen-planilla {
		padding: 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: 18px;
		background: var(--bg-surface);
	}
	.resumen-cabecera {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.resumen-icono {
		width: 42px;
		height: 42px;
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		border-radius: 14px;
		color: var(--emerald-700);
		background: color-mix(in srgb, var(--emerald-500) 12%, var(--bg-surface));
	}
	.resumen-titulo {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.resumen-titulo span,
	.resumen-datos dt {
		color: var(--text-muted);
		font-size: 0.69rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.resumen-titulo strong {
		overflow-wrap: anywhere;
		color: var(--text-primary);
		font-size: 1rem;
		font-weight: 800;
	}
	.estado-adjunto {
		padding: 0.3rem 0.55rem;
		border-radius: 999px;
		color: var(--emerald-700);
		background: color-mix(in srgb, var(--emerald-500) 12%, var(--bg-surface));
		font-size: 0.7rem;
		font-weight: 750;
		white-space: nowrap;
	}
	.resumen-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.85rem 1rem;
		margin: 0;
		padding: 1rem 0 0;
	}
	.resumen-datos div {
		min-width: 0;
	}
	.resumen-datos dt {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.25rem;
	}
	.resumen-datos dd {
		margin: 0;
		color: var(--text-primary);
		font-size: 0.88rem;
		font-weight: 650;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.resumen-periodo {
		grid-column: 1 / -1;
		padding: 0.75rem;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.nota-rango,
	.ayuda-archivo {
		margin: 0.55rem 0 0;
		color: var(--text-secondary);
		font-size: 0.76rem;
		line-height: 1.45;
	}
	.selector-archivo {
		margin-top: 1.1rem;
	}
	.input-archivo {
		width: 100%;
		padding: 0.55rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		color: var(--text-primary);
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.82rem;
	}
	.input-archivo::file-selector-button {
		margin-right: 0.7rem;
		padding: 0.45rem 0.7rem;
		border: 0;
		border-radius: 8px;
		color: var(--emerald-800);
		background: color-mix(in srgb, var(--emerald-500) 14%, var(--bg-surface));
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	.ayuda-archivo {
		margin-top: 0.4rem;
	}
	.archivo-seleccionado {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.75rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		color: var(--emerald-700);
		background: var(--bg-surface);
	}
	.archivo-nombre {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		color: var(--text-primary);
		font-size: 0.82rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.archivo-tamano {
		color: var(--text-muted);
		font-size: 0.72rem;
		white-space: nowrap;
	}
</style>
