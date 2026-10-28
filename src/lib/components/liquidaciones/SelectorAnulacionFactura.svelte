<script lang="ts">
	import type {
		FacturaLiquidacionItem,
		TipoAnulacionFactura
	} from '$lib/api/facturacionLiquidaciones';

	interface Props {
		items: FacturaLiquidacionItem[];
		prefijoNombre: string;
		tipo: TipoAnulacionFactura;
		liquidacionesALiquidar: string[];
		liquidacionDuplicadaId: string;
		deshabilitado?: boolean;
		onTipoChange: (tipo: TipoAnulacionFactura) => void;
		onLiquidacionesALiquidarChange: (ids: string[]) => void;
		onLiquidacionDuplicadaChange: (id: string) => void;
	}

	let {
		items,
		prefijoNombre,
		tipo,
		liquidacionesALiquidar,
		liquidacionDuplicadaId,
		deshabilitado = false,
		onTipoChange,
		onLiquidacionesALiquidarChange,
		onLiquidacionDuplicadaChange
	}: Props = $props();

	function alternarLiquidacion(id: string) {
		const ids = new Set(liquidacionesALiquidar);
		if (ids.has(id)) ids.delete(id);
		else ids.add(id);
		onLiquidacionesALiquidarChange([...ids]);
	}
</script>

<fieldset class="sa-tipos" disabled={deshabilitado}>
	<legend>¿Qué debe pasar con las liquidaciones?</legend>

	<label class="sa-opcion" class:activa={tipo === 'SIN_MODIFICAR'}>
		<input
			type="radio"
			name={`${prefijoNombre}-tipo-anulacion`}
			value="SIN_MODIFICAR"
			checked={tipo === 'SIN_MODIFICAR'}
			onchange={() => onTipoChange('SIN_MODIFICAR')}
		/>
		<span>
			<strong>Anulación sin corregir liquidaciones</strong>
			<small>Todos los servicios del lote quedan APROBADOS.</small>
		</span>
	</label>

	<label class="sa-opcion" class:activa={tipo === 'MODIFICAR_LIQUIDACIONES'}>
		<input
			type="radio"
			name={`${prefijoNombre}-tipo-anulacion`}
			value="MODIFICAR_LIQUIDACIONES"
			checked={tipo === 'MODIFICAR_LIQUIDACIONES'}
			onchange={() => onTipoChange('MODIFICAR_LIQUIDACIONES')}
		/>
		<span>
			<strong>Corregir una o más liquidaciones</strong>
			<small>Marca las que deben volver a LIQUIDADA; las demás quedan APROBADAS.</small>
		</span>
	</label>
	{#if tipo === 'MODIFICAR_LIQUIDACIONES'}
		<div class="sa-list" aria-label="Liquidaciones que volverán a liquidada">
			{#each items as item (item.liquidacion_id)}
				<label class="sa-item">
					<input
						type="checkbox"
						checked={liquidacionesALiquidar.includes(item.liquidacion_id)}
						onchange={() => alternarLiquidacion(item.liquidacion_id)}
					/>
					<span>{item.liquidacion?.consecutivo ?? 'Liquidación sin consecutivo'}</span>
				</label>
			{/each}
		</div>
	{/if}

	<label class="sa-opcion" class:activa={tipo === 'DUPLICIDAD'}>
		<input
			type="radio"
			name={`${prefijoNombre}-tipo-anulacion`}
			value="DUPLICIDAD"
			checked={tipo === 'DUPLICIDAD'}
			onchange={() => onTipoChange('DUPLICIDAD')}
		/>
		<span>
			<strong>Servicio duplicado</strong>
			<small>La factura se anula; el servicio duplicado queda ANULADO y el resto APROBADO.</small>
		</span>
	</label>
	{#if tipo === 'DUPLICIDAD'}
		<div class="sa-list" role="radiogroup" aria-label="Servicio duplicado del lote">
			{#each items as item (item.liquidacion_id)}
				<label class="sa-item">
					<input
						type="radio"
						name={`${prefijoNombre}-servicio-duplicado`}
						value={item.liquidacion_id}
						checked={liquidacionDuplicadaId === item.liquidacion_id}
						onchange={() => onLiquidacionDuplicadaChange(item.liquidacion_id)}
					/>
					<span>{item.liquidacion?.consecutivo ?? 'Liquidación sin consecutivo'}</span>
				</label>
			{/each}
		</div>
	{/if}
</fieldset>

<style>
	.sa-tipos {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.sa-tipos legend {
		margin-bottom: 8px;
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 750;
	}
	.sa-opcion {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		cursor: pointer;
	}
	.sa-opcion.activa {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
	}
	.sa-opcion input,
	.sa-item input {
		margin-top: 2px;
		accent-color: var(--accion);
	}
	.sa-opcion span {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.sa-opcion strong {
		color: var(--text-primary);
		font-size: 12px;
	}
	.sa-opcion small {
		color: var(--text-muted);
		font-size: 11px;
		line-height: 1.4;
	}
	.sa-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 150px;
		overflow: auto;
		margin-left: 28px;
		padding: 8px 10px;
		border: 1px solid var(--border-default);
		border-radius: 10px;
	}
	.sa-item {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-secondary);
		font-size: 12px;
		cursor: pointer;
	}
</style>
