<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { goto } from '$app/navigation';
	import StatusBadge from './StatusBadge.svelte';
	import CausasDots from './CausasDots.svelte';
	import RiskDot from './RiskDot.svelte';
	import {
		formatDate,
		isUrgent,
		getInitials,
		resumenRevision,
		formatearDiasRelativo
	} from '$lib/acciones-correctivas/dashboard-utils';
	import type { AccionCorrectivaPreventiva } from '$lib/api/acciones-correctivas';

	export let accion: AccionCorrectivaPreventiva;
	export let highlight: boolean = false;
	export let loadingAction: 'duplicar' | 'eliminar' | 'restaurar' | 'eliminar-permanente' | 'pdf' | null = null;

	const dispatch = createEventDispatcher<{
		duplicar: { id: string };
		eliminar: { id: string };
		restaurar: { id: string };
		pdf: { id: string}
		'eliminar-permanente': { id: string };
	}>();

	$: isDeleted = !!accion.deleted_at;
	$: urgent = isUrgent(accion.fecha_limite_cierre_accion || '');
	$: initials = getInitials(accion.responsable_ejecucion || 'Sin asignar');
	$: creatorInitials = getInitials(accion.usuarios?.nombre || '');
	$: fechaFormateada = formatDate(accion.fecha_limite_cierre_accion || '');
	$: revision = resumenRevision(accion);
	$: proximaRevisionLabel =
		revision.proximaFecha ? formatDate(revision.proximaFecha) : '';
	$: revisionDiasLabel = formatearDiasRelativo(revision.diasHasta);
	$: mostrarRevision = !isDeleted && revision.estado !== 'cerrada';

	const tipoColors: Record<string, { bg: string; color: string }> = {
		CORRECTIVA: { bg: '#fef3c7', color: '#92400e' },
		PREVENTIVA: { bg: '#ede9fe', color: '#5b21b6' },
		MEJORA: { bg: '#d1fae5', color: '#166534' }
	};
	$: tipoStyle = tipoColors[accion.tipo_accion_ejecutar || ''] ?? { bg: '#f3f4f6', color: '#374151' };

	function handleDuplicar() {
		dispatch('duplicar', { id: accion.id });
	}

	function handleEliminar() {
		dispatch('eliminar', { id: accion.id });
	}

	function handleRestaurar() {
		dispatch('restaurar', { id: accion.id });
	}

	function handleEliminarPermanente() {
		dispatch('eliminar-permanente', { id: accion.id });
	}

	function handleExportPDF() {
		dispatch('pdf', { id: accion.id });
	}
</script>

<article
	class="card"
	class:card-vencida={!isDeleted && accion.estado_accion === 'Vencidas'}
	class:card-highlight={highlight}
	class:card-deleted={isDeleted}
>
	<div class="card-head">
		<div class="head-left">
			<span class="accion-num">{accion.accion_numero || 'Sin número'}</span>
			{#if !isDeleted}
				<RiskDot nivel={accion.valoracion_riesgo || ''} />
			{/if}
		</div>
		{#if isDeleted}
			<span class="badge-deleted">Eliminada</span>
		{:else}
			<StatusBadge estado={accion.estado_accion || ''} />
		{/if}
	</div>

	<div class="tags">
		<span class="tag" style="background: {tipoStyle.bg}; color: {tipoStyle.color}">
			{accion.tipo_accion_ejecutar || 'Sin tipo'}
		</span>
		<span class="tag tag-neutral">{accion.tipo_hallazgo_detectado || 'Sin clasificar'}</span>
	</div>

	<p class="description" title={accion.descripcion_hallazgo || 'Sin descripción'}>
		{accion.descripcion_hallazgo || 'Sin descripción'}
	</p>

	{#if accion.causas && accion.causas.length > 0}
		<CausasDots causas={accion.causas} />
	{:else}
		<div class="sin-causas">Sin causas registradas</div>
	{/if}

	<div class="card-meta">
		<div class="meta-location">
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
			<span>{accion.lugar_sede || 'Sin sede'}</span>
		</div>
	</div>

	<footer class="card-footer">
		<div class="footer-left">
			<div class="fecha" class:fecha-urgente={urgent}>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
				{#if isDeleted}
					<span class="deleted-date">
						Eliminada: {accion.deleted_at ? new Date(accion.deleted_at).toLocaleDateString('es-CO') : ''}
					</span>
				{:else if fechaFormateada}
					<span>Cierre: {fechaFormateada}</span>
					{#if urgent}
						<span class="urgente-label">vencida</span>
					{/if}
				{:else}
					<span class="sin-fecha">Sin fecha de cierre</span>
				{/if}
			</div>

			{#if mostrarRevision}
				<div
					class="revision"
					class:revision-vencida={revision.estado === 'vencida'}
					class:revision-hoy={revision.estado === 'hoy'}
					class:revision-proxima={revision.estado === 'proxima'}
					class:revision-al-dia={revision.estado === 'al-dia'}
					class:revision-sin={revision.estado === 'sin-actividad'}
					title={revision.ultimaFecha
						? `Última actividad: ${formatDate(revision.ultimaFecha)} · Cadencia de revisión cada 15 días`
						: 'Sin actividad registrada'}
				>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
					{#if revision.estado === 'sin-actividad'}
						<span>Sin seguimientos</span>
					{:else}
						<span>Próx. revisión: <strong>{proximaRevisionLabel}</strong></span>
						<span class="revision-tag">
							{revisionDiasLabel}
						</span>
					{/if}
				</div>
			{/if}

			<div class="responsable">
				<div class="avatar">{initials}</div>
				<span>{accion.responsable_ejecucion || 'Sin asignar'}</span>
			</div>
			{#if accion.usuarios}
				<div class="creado-por">
					<div class="avatar avatar-sm">{creatorInitials}</div>
					<span>{accion.usuarios.nombre}</span>
				</div>
			{/if}
		</div>
		<div class="actions" role="group" aria-label="Acciones para {accion.accion_numero}">
			{#if isDeleted}
				<button
					class="act-btn act-btn-restore"
					class:act-btn-loading={loadingAction === 'restaurar'}
					title="Restaurar acción"
					on:click={handleRestaurar}
					disabled={loadingAction === 'restaurar'}
				>
					{#if loadingAction === 'restaurar'}
						<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
					{/if}
				</button>
				<button
					class="act-btn act-btn-delete-perm"
					class:act-btn-loading={loadingAction === 'eliminar-permanente'}
					title="Eliminar permanentemente"
					on:click={handleEliminarPermanente}
					disabled={loadingAction === 'eliminar-permanente'}
				>
					{#if loadingAction === 'eliminar-permanente'}
						<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
					{/if}
				</button>
			{:else}
				<button
					class="act-btn"
					title="Ver detalle"
					on:click={() => goto(`/dashboard/acciones-correctivas/${accion.id}`)}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
				</button>
				<button
					class="act-btn"
					title="Editar"
					on:click={() => goto(`/dashboard/acciones-correctivas/editar/${accion.id}`)}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
				</button>
				<button
					class="act-btn"
					class:act-btn-loading={loadingAction === 'duplicar'}
					title="Duplicar acción"
					on:click={handleDuplicar}
					disabled={loadingAction === 'duplicar'}
				>
					{#if loadingAction === 'duplicar'}
						<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
					{/if}
				</button>
				<button
					class="act-btn act-btn-delete"
					class:act-btn-loading={loadingAction === 'eliminar'}
					title="Mover a papelera"
					on:click={handleEliminar}
					disabled={loadingAction === 'eliminar'}
				>
					{#if loadingAction === 'eliminar'}
						<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					{/if}
				</button>
				<button
					class="act-btn"
					class:act-btn-loading={loadingAction === 'pdf'}
					title="Exportar PDF"
					on:click={handleExportPDF}
					disabled={loadingAction === 'pdf'}
				>
					{#if loadingAction === 'pdf'}
						<svg class="spinner-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
					{/if}
				</button>
			{/if}
		</div>
	</footer>
</article>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		cursor: default;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.card:hover {
		border-color: rgba(249, 115, 22, 0.3);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(249, 115, 22, 0.1);
	}
	.card-vencida { border-color: rgba(239, 68, 68, 0.25); }
	.card-vencida:hover { border-color: rgba(239, 68, 68, 0.5); box-shadow: 0 8px 24px rgba(239, 68, 68, 0.1); }

	.card-highlight {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-ring), 0 8px 24px rgba(249, 115, 22, 0.15);
		animation: cardPulse 2.5s ease-out;
	}
	@keyframes cardPulse {
		0% { box-shadow: 0 0 0 0 var(--accent-ring), 0 0 0 0 var(--accent-ring); }
		40% { box-shadow: 0 0 0 6px var(--accent-ring), 0 0 12px var(--accent-ring); }
		100% { box-shadow: 0 0 0 3px var(--accent-ring), 0 8px 24px rgba(249, 115, 22, 0.15); }
	}

	.card-deleted {
		opacity: 0.65;
		filter: grayscale(0.4);
		border-color: rgba(239, 68, 68, 0.25);
	}
	.card-deleted:hover {
		opacity: 0.85;
		filter: grayscale(0.2);
		border-color: rgba(239, 68, 68, 0.5);
	}

	.badge-deleted {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: rgba(220, 38, 38, 0.06);
		color: #b91c1c;
		border: 1px solid rgba(220, 38, 38, 0.18);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.head-left { display: flex; align-items: center; gap: 0.5rem; }
	.accion-num {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}

	.tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		padding: 0.15rem 0.5rem;
		border-radius: 5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.tag-neutral { background: var(--tag-bg); color: var(--text-muted); }

	.description {
		font-size: 0.82rem;
		color: var(--text-secondary);
		line-height: 1.55;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		flex: 1;
	}

	.card-meta { display: flex; align-items: center; gap: 0.4rem; }
	.meta-location {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.card-footer {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.footer-left { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
	.fecha {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.fecha-urgente { color: #b91c1c; }
	.sin-fecha { font-style: italic; opacity: 0.6; }
	.sin-causas {
		font-size: 0.7rem;
		color: var(--text-muted);
		font-style: italic;
		opacity: 0.6;
	}
	.deleted-date { font-style: italic; color: #b91c1c; font-size: 0.7rem; }
	.urgente-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		border: 1px solid rgba(220, 38, 38, 0.18);
	}

	.revision {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		flex-wrap: wrap;
	}
	.revision strong {
		font-weight: 600;
		color: var(--text-secondary);
	}
	.revision-tag {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.revision-vencida { color: #b91c1c; }
	.revision-vencida .revision-tag {
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.22);
	}
	.revision-hoy { color: #b91c1c; }
	.revision-hoy .revision-tag {
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.28);
	}
	.revision-proxima { color: #b45309; }
	.revision-proxima .revision-tag {
		background: rgba(245, 158, 11, 0.1);
		color: #b45309;
		border-color: rgba(245, 158, 11, 0.28);
	}
	.revision-al-dia { color: var(--text-muted); }
	.revision-al-dia .revision-tag {
		background: rgba(34, 197, 94, 0.08);
		color: #15803d;
		border-color: rgba(34, 197, 94, 0.22);
	}
	.revision-sin { color: var(--text-muted); font-style: italic; opacity: 0.85; }
	.responsable {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		overflow: hidden;
	}
	.responsable span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.creado-por {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		color: var(--text-muted);
		opacity: 0.75;
		overflow: hidden;
	}
	.creado-por span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.avatar {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #ffffff;
		font-size: 0.55rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: 0 1px 3px rgba(249, 115, 22, 0.3);
	}
	.avatar-sm {
		width: 16px;
		height: 16px;
		font-size: 0.5rem;
	}

	.actions { display: flex; gap: 0.25rem; flex-shrink: 0; }
	.act-btn {
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.act-btn:hover {
		border-color: rgba(249, 115, 22, 0.3);
		background: rgba(249, 115, 22, 0.06);
		color: var(--accent-hover);
	}
	.act-btn:active { transform: scale(0.92); }

	.act-btn-delete:hover {
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.06);
		color: #b91c1c;
	}
	.act-btn-restore:hover {
		border-color: rgba(37, 99, 235, 0.3);
		background: rgba(37, 99, 235, 0.06);
		color: #1d4ed8;
	}
	.act-btn-delete-perm:hover {
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
	}

	.act-btn-loading {
		pointer-events: none;
		opacity: 0.7;
	}
	.act-btn-loading svg {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
