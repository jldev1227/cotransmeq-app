<script lang="ts">
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { toast } from 'svelte-sonner';
	import { diasLaboradosAPI } from '$lib/api/apiClient';

	export interface SegmentoParaEliminar {
		id: string;
		orden: number;
		vehiculo_placa: string | null;
		cliente_nombre: string | null;
		hora_inicio: string | null;
		hora_fin: string | null;
		horas_conducidas: number | null;
		pernocte: boolean;
	}

	export interface RegistroParaEliminar {
		id: string;
		fecha: string;
		tipo: 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';
		conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
	}

	type Props = {
		open: boolean;
		segmento: SegmentoParaEliminar | null;
		registro: RegistroParaEliminar | null;
		onclose: () => void;
		onsaved?: () => void;
	};

	let { open, segmento, registro, onclose, onsaved }: Props = $props();

	let procesando = $state<boolean>(false);
	let errorMsg = $state<string>('');
	let confirmarTexto = $state<string>('');

	$effect(() => {
		if (open) {
			confirmarTexto = '';
			errorMsg = '';
		}
	});

	const conductorLabel = $derived(
		registro?.conductor
			? `${registro.conductor.nombre} ${registro.conductor.apellido}`
			: '—'
	);

	const requiereConfirmacion = $derived(!!segmento);

	async function confirmar() {
		if (!segmento) return;
		procesando = true;
		errorMsg = '';
		try {
			const res = await diasLaboradosAPI.eliminarSegmento(segmento.id);
			if (res.data?.success) {
				toast.success('Recorrido eliminado');
				onsaved?.();
				onclose();
			} else {
				errorMsg = res.data?.message || 'No se pudo eliminar';
			}
		} catch (err: any) {
			errorMsg = err?.response?.data?.message || err?.message || 'Error al eliminar';
		} finally {
			procesando = false;
		}
	}

</script>

{#if segmento}
	<ConfirmDialog
		{open}
		title={`¿Eliminar el tramo #${segmento.orden}?`}
		message={`${conductorLabel} · ${registro?.fecha ?? ''}. Se marca el recorrido como eliminado (soft delete): no se borra de la base de datos, pero deja de verse en el canvas de Recorridos y en el calendario. Los bonos asociados a este tramo también se ocultan.`}
		tone="danger"
		eyebrow="ELIMINAR RECORRIDO"
		confirmText="Sí, eliminar"
		loadingText="Eliminando…"
		loading={procesando}
		confirmDisabled={!requiereConfirmacion}
		onconfirm={confirmar}
		oncancel={onclose}
	>
		<dl class="resumen">
			{#if segmento.vehiculo_placa}
				<dt>Placa</dt>
				<dd class="mono">{segmento.vehiculo_placa}</dd>
			{/if}
			{#if segmento.cliente_nombre}
				<dt>Cliente</dt>
				<dd>{segmento.cliente_nombre}</dd>
			{/if}
			{#if segmento.hora_inicio && segmento.hora_fin}
				<dt>Horario</dt>
				<dd class="mono">{segmento.hora_inicio}–{segmento.hora_fin}</dd>
			{/if}
			{#if segmento.horas_conducidas != null}
				<dt>Horas</dt>
				<dd class="mono">{Number(segmento.horas_conducidas).toFixed(1)}h</dd>
			{/if}
			{#if segmento.pernocte}
				<dt>Pernocte</dt>
				<dd>Sí</dd>
			{/if}
		</dl>
		{#if errorMsg}
			<p class="error" role="alert">{errorMsg}</p>
		{/if}
	</ConfirmDialog>
{/if}

<style>
	.resumen {
		margin: 0;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1px solid var(--border-default);
		background: var(--bg-base, #f8faf9);
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 12px;
		font-size: 13px;
	}
	.resumen dt {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		align-self: center;
	}
	.resumen dd {
		margin: 0;
		color: var(--text-primary);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.punto {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 999px;
	}
	.mono {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
	}
	.error {
		margin: 0;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #b42318;
		font-size: 13px;
		font-weight: 600;
	}
</style>
