<script lang="ts">
	import type { CausaAccion } from '$lib/api/acciones-correctivas';
	export let causas: CausaAccion[];

	$: porEstado = {
		cumplida: causas.filter((c) => c.estado_seguimiento === 'Cumplida').length,
		enProceso: causas.filter((c) => c.estado_seguimiento === 'En Proceso').length,
		vencida: causas.filter((c) => c.estado_seguimiento === 'Vencida').length
	};

	function dotColor(estado: string | undefined): string {
		if (estado === 'Cumplida') return '#22c55e';
		if (estado === 'En Proceso') return '#3b82f6';
		return '#ef4444';
	}

	function dotHalo(estado: string | undefined): string {
		if (estado === 'Cumplida') return 'rgba(34, 197, 94, 0.18)';
		if (estado === 'En Proceso') return 'rgba(59, 130, 246, 0.18)';
		return 'rgba(239, 68, 68, 0.18)';
	}
</script>

<div class="causas-wrap">
	<span class="causas-label">{porEstado.cumplida}/{causas.length} causas</span>
	<div class="dots" role="list" aria-label="estado de causas">
		{#each causas as causa (causa.orden)}
			<span
				class="dot"
				style="background: {dotColor(causa.estado_seguimiento)}; box-shadow: 0 0 0 3px {dotHalo(causa.estado_seguimiento)};"
				role="listitem"
				title="{causa.estado_seguimiento}"
				aria-label="Causa {causa.orden}: {causa.estado_seguimiento}"
			></span>
		{/each}
	</div>
	<div class="sub-stats">
		{#if porEstado.enProceso > 0}
			<span class="stat stat-proceso">
				<span class="stat-dot"></span>
				{porEstado.enProceso}
			</span>
		{/if}
		{#if porEstado.vencida > 0}
			<span class="stat stat-vencida">
				<span class="stat-dot"></span>
				{porEstado.vencida}
			</span>
		{/if}
		{#if porEstado.cumplida > 0}
			<span class="stat stat-cumplida">
				<span class="stat-dot"></span>
				{porEstado.cumplida}
			</span>
		{/if}
	</div>
</div>

<style>
	.causas-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		flex-wrap: wrap;
	}
	.causas-label {
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.dots { display: flex; gap: 4px; flex-wrap: wrap; }
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		opacity: 0.85;
	}
	.sub-stats {
		display: flex;
		gap: 6px;
		margin-left: auto;
	}
	.stat {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 10px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.stat-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.stat-proceso { color: #3b82f6; }
	.stat-proceso .stat-dot { background: #3b82f6; }
	.stat-vencida { color: #ef4444; }
	.stat-vencida .stat-dot { background: #ef4444; }
	.stat-cumplida { color: #22c55e; }
	.stat-cumplida .stat-dot { background: #22c55e; }
</style>
