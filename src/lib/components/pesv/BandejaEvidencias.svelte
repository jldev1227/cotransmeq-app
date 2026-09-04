<script lang="ts">
	/**
	 * Bandeja de revisión de evidencias.
	 *
	 * Ordenada por antigüedad ascendente: lo que lleva más tiempo esperando sale
	 * primero. Con orden descendente, una evidencia aportada en enero se hunde
	 * bajo las de esta semana y no la revisa nadie.
	 *
	 * Un aportante ve sus pendientes; un revisor ve la cola completa. Sobre lo
	 * propio nadie ve el botón de aprobar, porque el servidor lo va a rechazar
	 * con `AUTOAPROBACION_PROHIBIDA` y ofrecer un botón que falla es peor que no
	 * ofrecerlo.
	 */
	import type { EvidenciaBandeja, PermisosPesv } from '$lib/types/pesv-centro';
	import EstadoBadge from './EstadoBadge.svelte';
	import EstadoPanel from './EstadoPanel.svelte';
	import {
		ESTADO_REVISION,
		describirPlazo,
		etiquetaArea,
		formatearFecha,
		formatearInstante
	} from './estados';

	interface Props {
		evidencias: EvidenciaBandeja[];
		cargando: boolean;
		error: string | null;
		permisos: PermisosPesv;
		filtroEstado: string;
		soloMias: boolean;
		onFiltrar: (cambio: { estadoEvidencia?: string; mias?: boolean }) => void;
		onAbrirPaso: (paso: number) => void;
		onReintentar: () => void;
	}

	let {
		evidencias,
		cargando,
		error,
		permisos,
		filtroEstado,
		soloMias,
		onFiltrar,
		onAbrirPaso,
		onReintentar
	}: Props = $props();

	const ESTADOS = [
		{ valor: '', etiqueta: 'Todas' },
		{ valor: 'PENDIENTE', etiqueta: 'Pendientes de revisión' },
		{ valor: 'APROBADO', etiqueta: 'Aprobadas' },
		{ valor: 'RECHAZADO', etiqueta: 'Rechazadas' }
	];
</script>

<section class="bandeja" aria-labelledby="titulo-bandeja">
	<header>
		<h3 id="titulo-bandeja">
			{permisos.puedeRevisar ? 'Bandeja de revisión' : 'Mis evidencias aportadas'}
		</h3>

		<div class="controles">
			<label>
				<span>Estado</span>
				<select
					value={filtroEstado}
					onchange={(e) => onFiltrar({ estadoEvidencia: e.currentTarget.value })}
				>
					{#each ESTADOS as e (e.valor)}
						<option value={e.valor}>{e.etiqueta}</option>
					{/each}
				</select>
			</label>

			{#if permisos.puedeRevisar}
				<label class="casilla">
					<input
						type="checkbox"
						checked={soloMias}
						onchange={(e) => onFiltrar({ mias: e.currentTarget.checked })}
					/>
					<span>Solo las que yo aporté</span>
				</label>
			{/if}
		</div>
	</header>

	{#if cargando}
		<EstadoPanel tipo="cargando" mensaje="Consultando la bandeja…" />
	{:else if error}
		<EstadoPanel tipo="error" mensaje={error} accion="Reintentar" onAccion={onReintentar} />
	{:else if evidencias.length === 0}
		<EstadoPanel
			tipo="vacio"
			titulo="Sin evidencias"
			mensaje={filtroEstado === 'PENDIENTE'
				? 'No hay nada esperando revisión con los filtros actuales.'
				: 'No hay evidencias que coincidan con los filtros.'}
		/>
	{:else}
		<ul class="lista">
			{#each evidencias as e (e.id)}
				<li class:vencida={e.vencida}>
					<div class="fila">
						<div class="principal">
							<button type="button" class="paso" onclick={() => onAbrirPaso(e.stepNumber)}>
								Paso {e.stepNumber} · {e.pasoNombre}
							</button>
							<strong>{e.titulo}</strong>
							<span class="meta">
								{e.origen === 'ARCHIVO'
									? (e.nombreArchivo ?? 'archivo')
									: `vínculo a ${e.sourceDomain}`}
								· {etiquetaArea(e.areaResponsable)}
								· aportada por {e.cargadoPor?.nombre ?? 'desconocido'}
								{formatearInstante(e.createdAt)}
							</span>

							{#if e.vigenciaHasta}
								<span class="vigencia" class:tarde={e.vencida}>
									Vigencia hasta {formatearFecha(e.vigenciaHasta)} · {describirPlazo(
										e.diasParaVencer
									)}
								</span>
							{/if}

							{#if e.observacionRevision}
								<p class="observacion">{e.observacionRevision}</p>
							{/if}
						</div>

						<div class="lateral">
							<EstadoBadge token={ESTADO_REVISION[e.estadoRevision]} />

							{#if e.vencida}
								<span class="etiqueta-vencida">Aprobada pero vencida: ya no acredita</span>
							{/if}

							{#if permisos.puedeRevisar && e.estadoRevision === 'PENDIENTE'}
								{#if e.esPropia}
									<span class="propia">Aportada por usted: debe revisarla otra persona</span>
								{:else}
									<button type="button" class="revisar" onclick={() => onAbrirPaso(e.stepNumber)}>
										Revisar en el paso
									</button>
								{/if}
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.bandeja {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 1.25rem;
	}

	header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	h3 {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.controles {
		display: flex;
		align-items: flex-end;
		gap: 0.875rem;
		flex-wrap: wrap;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #475569;
	}

	label.casilla {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		min-height: 2.75rem;
	}

	select {
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		font-size: 0.875rem;
		min-height: 2.75rem;
		min-width: 14rem;
		background: #ffffff;
		color: #0f172a;
	}

	input[type='checkbox'] {
		width: 1.125rem;
		height: 1.125rem;
	}

	.lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.lista li {
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		padding: 0.75rem 0.875rem;
		background: #ffffff;
	}

	.lista li.vencida {
		border-color: #fecaca;
		background: #fef2f2;
	}

	.fila {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.principal {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1 1 22rem;
		min-width: 0;
	}

	.paso {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.principal strong {
		font-size: 0.875rem;
		color: #0f172a;
	}

	.meta {
		font-size: 0.75rem;
		color: #64748b;
	}

	.vigencia {
		font-size: 0.75rem;
		color: #64748b;
	}

	.vigencia.tarde {
		color: #b91c1c;
		font-weight: 600;
	}

	.observacion {
		margin: 0.375rem 0 0;
		padding: 0.375rem 0.5rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		color: #92400e;
		max-width: 44rem;
	}

	.lateral {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.375rem;
	}

	.etiqueta-vencida,
	.propia {
		font-size: 0.6875rem;
		color: #92400e;
		text-align: right;
		max-width: 14rem;
	}

	.revisar {
		padding: 0.5rem 0.75rem;
		border: 1px solid #0f172a;
		border-radius: 0.5rem;
		background: #0f172a;
		color: #ffffff;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 2.75rem;
		white-space: nowrap;
	}

	button:focus-visible,
	select:focus-visible,
	input:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
		border-radius: 0.25rem;
	}
</style>
