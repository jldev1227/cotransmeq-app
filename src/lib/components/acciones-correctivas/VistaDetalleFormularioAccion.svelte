<script lang="ts">
	import type { AccionCorrectivaPreventiva } from '$lib/api/acciones-correctivas';
	import Step4Approval from './Step4Approval.svelte';
	import {
		ESTADOS_EVIDENCIA,
		EVALUACIONES_CIERRE,
		parseListaCriterios,
		etiquetaResultadoCiclo,
		calcularProximoSeguimiento,
		accionTieneCierreDefinitivo,
		INTERVALO_SEGUIMIENTO_DIAS
	} from '$lib/acciones-correctivas/constants';

	export let accion: AccionCorrectivaPreventiva;
	export let formatearFecha: (fecha: string | undefined) => string;
	export let formatearValor: (valor: unknown) => string;

	$: listaCriterios = parseListaCriterios(accion.criterio_evaluacion_eficacia);
	$: proximoSeguimiento = calcularProximoSeguimiento(accion);
	$: cerrada = accionTieneCierreDefinitivo(accion);

	function etiquetaEvidencia(estado?: string) {
		return ESTADOS_EVIDENCIA.find((e) => e.value === estado)?.label ?? formatearValor(estado);
	}

	function etiquetaCierre(valor?: string) {
		return EVALUACIONES_CIERRE.find((e) => e.value === valor)?.label ?? formatearValor(valor);
	}
</script>

<Step4Approval {accion} tipoHallazgoDetectado={accion.tipo_hallazgo_detectado} />

<!-- Sección 6 completa -->
<div class="fm-card">
	<h2 class="fm-card-title">
		<svg class="section-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
		Análisis y evaluación de la eficacia
	</h2>

	{#if !cerrada && proximoSeguimiento}
		<div class="fm-alert">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
			<div>
				<p class="fm-alert-title">Próximo seguimiento sugerido</p>
				<p>{formatearFecha(proximoSeguimiento)} — intervalo de {INTERVALO_SEGUIMIENTO_DIAS} días.</p>
			</div>
		</div>
	{/if}

	<div class="fm-grid">
		<div class="fm-field">
			<span class="fm-label">Fecha límite evaluación de eficacia</span>
			<span class="fm-value">{formatearFecha(accion.fecha_limite_evaluacion_eficacia)}</span>
		</div>
		<div class="fm-field fm-span-2">
			<span class="fm-label">Criterio de evaluación de la eficacia</span>
			{#if listaCriterios.length > 0}
				<ul class="fm-bullet-list">
					{#each listaCriterios as criterio}
						<li class="fm-value">{criterio}</li>
					{/each}
				</ul>
			{:else}
				<span class="fm-value fm-block">{formatearValor(accion.criterio_evaluacion_eficacia)}</span>
			{/if}
		</div>
	</div>

	{#if accion.ciclos_eficacia && accion.ciclos_eficacia.length > 0}
		<div class="fm-subsection">
			<h3 class="fm-subsection-title">Ciclos de seguimiento a la eficacia</h3>
			<div class="fm-list">
				{#each accion.ciclos_eficacia as ciclo}
					<div class="fm-list-item">
						<p class="fm-list-item-label">Ciclo {ciclo.numero_ciclo}</p>
						<div class="fm-grid">
							<div class="fm-field">
								<span class="fm-label">Fecha de seguimiento</span>
								<span class="fm-value">{formatearFecha(ciclo.fecha_seguimiento)}</span>
							</div>
							<div class="fm-field">
								<span class="fm-label">Resultado</span>
								<span class="fm-value">{etiquetaResultadoCiclo(ciclo.resultado_ciclo)}</span>
							</div>
							{#if ciclo.responsable}
								<div class="fm-field">
									<span class="fm-label">Responsable</span>
									<span class="fm-value">{ciclo.responsable}</span>
								</div>
							{/if}
							{#if ciclo.cargo}
								<div class="fm-field">
									<span class="fm-label">Cargo</span>
									<span class="fm-value">{ciclo.cargo}</span>
								</div>
							{/if}
							{#if ciclo.descripcion}
								<div class="fm-field fm-span-2">
									<span class="fm-label">Descripción / actividades</span>
									<span class="fm-value fm-block">{ciclo.descripcion}</span>
								</div>
							{/if}
							{#if ciclo.criterios_cumplidos && Array.isArray(ciclo.criterios_cumplidos) && ciclo.criterios_cumplidos.length > 0}
								<div class="fm-field fm-span-2">
									<span class="fm-label">Criterios cumplidos</span>
									<ul class="fm-bullet-list">
										{#each ciclo.criterios_cumplidos as c}
											<li class="fm-value">{c}</li>
										{/each}
									</ul>
								</div>
							{/if}
							<div class="fm-field fm-span-2">
								<span class="fm-label">Adjunto</span>
								{#if ciclo.adjunto_url}
									<a href={ciclo.adjunto_url} target="_blank" rel="noopener noreferrer" class="adjunto-link">
										<span class="adjunto-icon">PDF</span>
										{ciclo.adjunto_url.split('?')[0].split('/').pop()}
									</a>
								{:else}
									<span class="adjunto-fallback">Sin adjunto</span>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if accion.evidencias_eficacia && accion.evidencias_eficacia.length > 0}
		<div class="fm-subsection">
			<h3 class="fm-subsection-title">Evidencias del cierre eficaz</h3>
			<div class="fm-list">
				{#each accion.evidencias_eficacia as ev}
					<div class="fm-list-item">
						<p class="fm-list-item-label">Evidencia #{ev.orden}</p>
						<div class="fm-grid">
							<div class="fm-field">
								<span class="fm-label">Tipo</span>
								<span class="fm-value">{formatearValor(ev.tipo_evidencia)}</span>
							</div>
							<div class="fm-field">
								<span class="fm-label">Fecha</span>
								<span class="fm-value">{formatearFecha(ev.fecha)}</span>
							</div>
							<div class="fm-field">
								<span class="fm-label">Estado / ubicación</span>
								<span class="fm-value">{etiquetaEvidencia(ev.estado_ubicacion)}</span>
							</div>
							{#if ev.descripcion}
								<div class="fm-field fm-span-2">
									<span class="fm-label">Descripción</span>
									<span class="fm-value fm-block">{ev.descripcion}</span>
								</div>
							{/if}
							<div class="fm-field fm-span-2">
								<span class="fm-label">Adjunto</span>
								{#if ev.adjunto_url}
									<a href={ev.adjunto_url} target="_blank" rel="noopener noreferrer" class="adjunto-link">
										<span class="adjunto-icon">PDF</span>
										{ev.adjunto_url.split('?')[0].split('/').pop()}
									</a>
								{:else}
									<span class="adjunto-fallback">Sin adjunto</span>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="fm-subsection">
		<h3 class="fm-subsection-title">Cierre definitivo</h3>
		<div class="fm-grid">
			<div class="fm-field">
				<span class="fm-label">Evaluación del cierre</span>
				<span class="fm-value">{etiquetaCierre(accion.evaluacion_cierre_eficaz)}</span>
			</div>
			<div class="fm-field">
				<span class="fm-label">Fecha de cierre definitivo</span>
				<span class="fm-value">{formatearFecha(accion.fecha_cierre_definitivo)}</span>
			</div>
			<div class="fm-field">
				<span class="fm-label">Responsable del cierre</span>
				<span class="fm-value">{formatearValor(accion.responsable_cierre)}</span>
			</div>
			<div class="fm-field">
				<span class="fm-label">Cargo</span>
				<span class="fm-value">{formatearValor(accion.cargo_responsable_cierre)}</span>
			</div>
			{#if accion.observaciones_cierre}
				<div class="fm-field fm-span-2">
					<span class="fm-label">Observaciones y lecciones aprendidas</span>
					<span class="fm-value fm-block">{accion.observaciones_cierre}</span>
				</div>
			{/if}
			{#if accion.analisis_evidencias_cierre}
				<div class="fm-field fm-span-2">
					<span class="fm-label">Análisis y evidencias (nivel acción)</span>
					<span class="fm-value fm-block">{accion.analisis_evidencias_cierre}</span>
				</div>
			{/if}
		</div>
	</div>
</div>
