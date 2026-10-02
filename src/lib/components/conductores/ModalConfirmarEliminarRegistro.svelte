<script lang="ts">
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { toast } from 'svelte-sonner';
	import { diasLaboradosAPI } from '$lib/api/apiClient';

	export interface RegistroParaEliminar {
		id: string;
		fecha: string;
		tipo: 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';
		observaciones: string | null;
		segmentos_count: number;
		conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
	}

	type Props = {
		open: boolean;
		registro: RegistroParaEliminar | null;
		onclose: () => void;
		onsaved?: () => void;
	};

	let { open, registro, onclose, onsaved }: Props = $props();

	let procesando = $state<boolean>(false);
	let errorMsg = $state<string>('');

	$effect(() => {
		if (open) {
			errorMsg = '';
		}
	});

	const conductorLabel = $derived(
		registro?.conductor
			? `${registro.conductor.nombre} ${registro.conductor.apellido}`
			: '—'
	);

	const tipoLabel: Record<string, string> = {
		LABORADO: 'Día laborado',
		DISPONIBLE: 'Disponible',
		DESCANSO: 'Descanso',
		MANTENIMIENTO: 'Mantenimiento'
	};

	const tipoColor: Record<string, string> = {
		LABORADO: '#c2410c',
		DISPONIBLE: '#2563eb',
		DESCANSO: '#d97706',
		MANTENIMIENTO: '#dc2626'
	};

	async function confirmar() {
		if (!registro) return;
		procesando = true;
		errorMsg = '';
		try {
			const res = await diasLaboradosAPI.eliminarRegistro(registro.id);
			if (res.data?.success) {
				toast.success('Día eliminado');
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

{#if registro}
	<ConfirmDialog
		{open}
		title="¿Eliminar el día completo?"
		message={`${conductorLabel} · ${registro.fecha}. Se marcará el día y ${
			registro.segmentos_count > 0
				? `sus ${registro.segmentos_count} tramo${registro.segmentos_count === 1 ? '' : 's'}`
				: 'todos sus tramos'
		} como eliminados (soft delete): no se borra de la base de datos, pero dejan de verse en el canvas de Recorridos y en el calendario. Los bonos asociados también se ocultan.`}
		tone="danger"
		eyebrow="ELIMINAR DÍA COMPLETO"
		confirmText="Sí, eliminar día"
		loadingText="Eliminando…"
		loading={procesando}
		onconfirm={confirmar}
		oncancel={onclose}
	>
		<dl class="resumen">
			<dt>Tipo</dt>
			<dd>
				<span class="punto" style:background-color={tipoColor[registro.tipo] || '#9ca3af'}></span>
				{tipoLabel[registro.tipo] || registro.tipo}
			</dd>
			{#if registro.segmentos_count > 0}
				<dt>Tramos</dt>
				<dd>{registro.segmentos_count} tramo{registro.segmentos_count === 1 ? '' : 's'}</dd>
			{/if}
			{#if registro.observaciones}
				<dt>Obs.</dt>
				<dd><em>{registro.observaciones}</em></dd>
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
