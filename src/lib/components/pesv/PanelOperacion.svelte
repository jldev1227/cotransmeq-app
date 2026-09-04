<script lang="ts">
	/**
	 * Operación segura: inspecciones, velocidad, mantenimiento y siniestros.
	 *
	 * Dos decisiones visibles en esta pantalla:
	 *
	 *  - **No se ofrece registro manual de preoperacional.** Formularios
	 *    Dinámicos es la fuente oficial; un segundo camino de captura crearía
	 *    dos verdades sobre si el vehículo se inspeccionó, y la manual siempre
	 *    ganaría por cómoda. Los registros manuales antiguos se muestran como
	 *    histórico, contados y etiquetados.
	 *  - **La serie mensual de excesos va aparte de los eventos.** Un total
	 *    cargado a mano no prueba un hecho observado, y mezclarlos haría creer
	 *    que tienen el mismo valor probatorio.
	 */
	import type { PermisosPesv, RespuestaOperacion } from '$lib/types/pesv-centro';
	import EstadoBadge from './EstadoBadge.svelte';
	import EstadoPanel from './EstadoPanel.svelte';
	import {
		SEVERIDAD_SINIESTRO,
		describirPlazo,
		formatearFecha,
		formatearInstante
	} from './estados';

	interface Props {
		datos: RespuestaOperacion | null;
		cargando: boolean;
		error: string | null;
		panel: string;
		permisos: PermisosPesv;
		onPanel: (panel: string) => void;
		onReintentar: () => void;
	}

	let { datos, cargando, error, panel, permisos, onPanel, onReintentar }: Props = $props();

	const PANELES = [
		{ id: 'inspecciones', etiqueta: 'Inspecciones' },
		{ id: 'velocidad', etiqueta: 'Velocidad' },
		{ id: 'mantenimiento', etiqueta: 'Mantenimiento' },
		{ id: 'siniestros', etiqueta: 'Siniestros' }
	];

	const numero = (v: string | number | null | undefined): string =>
		v === null || v === undefined ? '—' : String(v);

	const MESES = [
		'ene',
		'feb',
		'mar',
		'abr',
		'may',
		'jun',
		'jul',
		'ago',
		'sep',
		'oct',
		'nov',
		'dic'
	];
</script>

<div class="operacion">
	<nav class="sub-nav" aria-label="Paneles de operación segura">
		{#each PANELES as p (p.id)}
			<button type="button" class:activo={panel === p.id} onclick={() => onPanel(p.id)}>
				{p.etiqueta}
			</button>
		{/each}
	</nav>

	{#if cargando}
		<EstadoPanel tipo="cargando" mensaje="Consultando la operación del período…" />
	{:else if error}
		<EstadoPanel tipo="error" mensaje={error} accion="Reintentar" onAccion={onReintentar} />
	{:else if datos}
		{#if panel === 'inspecciones'}
			{#if !datos.inspecciones.hayAsignacion}
				<EstadoPanel
					tipo="sin-datos"
					titulo="Formularios no está etiquetado como preoperacional"
					mensaje={datos.inspecciones.advertencia ?? ''}
					enlace={datos.inspecciones.enlaceConfiguracion}
					enlaceTexto="Ir a asignaciones de Formularios"
				/>
			{:else}
				<section>
					<p class="fuente">
						Fuente oficial:
						{#each datos.inspecciones.asignaciones as a (a.id)}
							<span class="chip">{a.formulario}</span>
						{/each}
					</p>

					{#if datos.inspecciones.historicoManual && datos.inspecciones.historicoManual.registros > 0}
						<p class="historico" role="note">
							<strong>Histórico:</strong>
							{datos.inspecciones.historicoManual.registros} registros manuales anteriores.
							{datos.inspecciones.historicoManual.advertencia}
						</p>
					{/if}

					{#if datos.inspecciones.filas.length === 0}
						<EstadoPanel
							tipo="vacio"
							titulo="Sin inspecciones entregadas"
							mensaje="Ningún envío válido de la asignación preoperacional en el período."
						/>
					{:else}
						<div class="tabla-scroll">
							<table>
								<caption class="sr-only">Inspecciones preoperacionales entregadas</caption>
								<thead>
									<tr>
										<th scope="col">Fecha</th>
										<th scope="col">Vehículo</th>
										<th scope="col">Conductor</th>
										<th scope="col">Entregado</th>
										<th scope="col"><span class="sr-only">Enlace</span></th>
									</tr>
								</thead>
								<tbody>
									{#each datos.inspecciones.filas as f (f.envioId)}
										<tr>
											<td class="tab">{formatearFecha(f.fecha)}</td>
											<td class="placa">{f.placa}</td>
											<td>{f.conductor ?? '—'}</td>
											<td class="tab">{formatearInstante(f.entregadoAt)}</td>
											<td><a href={f.enlace}>Ver envío</a></td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</section>
			{/if}
		{:else if panel === 'velocidad'}
			<section>
				{#if datos.velocidad.eventos.length === 0}
					<EstadoPanel
						tipo="vacio"
						titulo="Sin eventos de velocidad"
						mensaje="No hay excesos individuales registrados en el período. Confirme que la fuente (GPS o registro manual) esté alimentando el módulo."
					/>
				{:else}
					<div class="tabla-scroll">
						<table>
							<caption class="sr-only">Eventos individuales de exceso de velocidad</caption>
							<thead>
								<tr>
									<th scope="col">Instante</th>
									<th scope="col">Vehículo</th>
									<th scope="col">Conductor</th>
									<th scope="col">Velocidad</th>
									<th scope="col">Límite</th>
									<th scope="col">Vía</th>
									<th scope="col">Fuente</th>
									<th scope="col">Servicio</th>
								</tr>
							</thead>
							<tbody>
								{#each datos.velocidad.eventos as e (e.id)}
									<tr>
										<td class="tab">{formatearInstante(e.ocurrido_at)}</td>
										<td class="placa">{e.vehiculo?.placa ?? '—'}</td>
										<td>{e.conductor ? `${e.conductor.nombre} ${e.conductor.apellido}` : '—'}</td>
										<td class="tab exceso">{numero(e.velocidad_kmh)} km/h</td>
										<td class="tab">{numero(e.limite_kmh)} km/h</td>
										<td>{e.via ?? '—'}</td>
										<td><span class="chip">{e.fuente}</span></td>
										<td>
											{#if e.servicio}
												<a href="/dashboard/servicios?id={e.servicio.id}">
													{e.servicio.numero_planilla ?? 'Ver'}
												</a>
											{:else}
												<span class="sin">Sin servicio</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				<!-- Serie histórica, deliberadamente separada. -->
				<section class="legacy">
					<h3>Serie histórica de totales mensuales</h3>
					<p class="historico" role="note">{datos.velocidad.historico.advertencia}</p>
					{#if datos.velocidad.historico.serie.length === 0}
						<p class="sin">Sin registros históricos para {datos.velocidad.historico.anio}.</p>
					{:else}
						<ul class="serie">
							{#each datos.velocidad.historico.serie as s (s.mes)}
								<li>
									<span class="mes">{MESES[s.mes - 1] ?? s.mes}</span>
									<span class="total">{s.total}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</section>
		{:else if panel === 'mantenimiento'}
			<section>
				{#if datos.mantenimiento.planes.length === 0 && datos.mantenimiento.intervenciones.length === 0}
					<EstadoPanel
						tipo="vacio"
						titulo="Sin alertas de mantenimiento"
						mensaje="Ningún plan ni intervención vencida o próxima a vencer."
					/>
				{:else}
					{#if datos.mantenimiento.planes.length > 0}
						<h3>Planes por vencer o vencidos</h3>
						<div class="tabla-scroll">
							<table>
								<caption class="sr-only">Planes de mantenimiento con alerta</caption>
								<thead>
									<tr>
										<th scope="col">Vehículo</th>
										<th scope="col">Plan</th>
										<th scope="col">Próxima fecha</th>
										<th scope="col">Kilómetros restantes</th>
										<th scope="col">Estado</th>
										<th scope="col"><span class="sr-only">Enlace</span></th>
									</tr>
								</thead>
								<tbody>
									{#each datos.mantenimiento.planes as p (p.planId)}
										<tr>
											<td class="placa">{p.placa}</td>
											<td>{p.nombre}</td>
											<td>
												<span class="tab">{formatearFecha(p.proximaFecha)}</span>
												<span class="plazo">{describirPlazo(p.diasRestantes)}</span>
											</td>
											<td class="tab">{p.kmRestantes ?? 'Sin odómetro'}</td>
											<td>
												<span class="estado" class:mal={p.estado === 'VENCIDO'}>
													{p.estado === 'VENCIDO' ? 'Vencido' : 'Próximo'}
												</span>
											</td>
											<td><a href={p.enlace}>Ver vehículo</a></td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					{#if datos.mantenimiento.intervenciones.length > 0}
						<h3>Intervenciones programadas</h3>
						<div class="tabla-scroll">
							<table>
								<caption class="sr-only">Intervenciones de mantenimiento programadas</caption>
								<thead>
									<tr>
										<th scope="col">Vehículo</th>
										<th scope="col">Descripción</th>
										<th scope="col">Programada</th>
										<th scope="col">Estado</th>
									</tr>
								</thead>
								<tbody>
									{#each datos.mantenimiento.intervenciones as i (i.eventoId)}
										<tr>
											<td class="placa">{i.placa}</td>
											<td>{i.descripcion}</td>
											<td>
												<span class="tab">{formatearFecha(i.fechaProgramada)}</span>
												<span class="plazo">{describirPlazo(i.diasRestantes)}</span>
											</td>
											<td>
												<span class="estado" class:mal={i.estado === 'VENCIDO'}>
													{i.estado === 'VENCIDO' ? 'Vencido' : 'Próximo'}
												</span>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</section>
		{:else if panel === 'siniestros'}
			<section>
				{#if datos.siniestros.length === 0}
					<EstadoPanel
						tipo="vacio"
						titulo="Sin siniestros registrados"
						mensaje="No hay eventos viales estructurados en el período consultado."
					/>
				{:else}
					<div class="tabla-scroll">
						<table>
							<caption class="sr-only">Siniestros viales del período</caption>
							<thead>
								<tr>
									<th scope="col">Fecha</th>
									<th scope="col">Severidad</th>
									<th scope="col">Trayecto</th>
									<th scope="col">Vehículo</th>
									<th scope="col">Conductor</th>
									<th scope="col">Lesionados</th>
									<th scope="col">Investigación</th>
									<th scope="col">Acción correctiva</th>
								</tr>
							</thead>
							<tbody>
								{#each datos.siniestros as s (s.id)}
									<tr>
										<td class="tab">{formatearFecha(s.fecha)}{s.hora ? ` ${s.hora}` : ''}</td>
										<td><EstadoBadge token={SEVERIDAD_SINIESTRO[s.severidad]} /></td>
										<td>{s.trayecto.replace('_', ' ').toLowerCase()}</td>
										<td class="placa">{s.vehiculo?.placa ?? '—'}</td>
										<td>{s.conductor ? `${s.conductor.nombre} ${s.conductor.apellido}` : '—'}</td>
										<td class="tab">
											{s.heridos ?? 0} heridos
											{#if (s.fallecidos ?? 0) > 0}
												<strong class="mal">· {s.fallecidos} fallecidos</strong>
											{/if}
										</td>
										<td>
											{#if s.investigacion_realizada}
												<span class="ok">Realizada</span>
											{:else}
												<!-- El paso 13 exige investigación de causas para cada
												     evento; sin ella el hallazgo no se puede cerrar. -->
												<span class="mal">Pendiente</span>
											{/if}
										</td>
										<td>
											{#if s.accion_correctiva}
												<a href="/dashboard/acciones-correctivas?id={s.accion_correctiva.id}">
													{s.accion_correctiva.accion_numero}
												</a>
											{:else}
												<span class="sin">Sin vincular</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				{#if !permisos.puedeAportar}
					<p class="nota">
						Su nivel de acceso permite consultar, no registrar. El registro de siniestros lo hacen
						HSEQ, Operaciones, Mantenimiento o Talento Humano.
					</p>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	.operacion {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sub-nav {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
		padding: 0.25rem;
		background: #f1f5f9;
		border-radius: 0.625rem;
		width: fit-content;
	}

	.sub-nav button {
		padding: 0.5rem 0.875rem;
		border: none;
		background: transparent;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
		min-height: 2.75rem;
	}

	.sub-nav button.activo {
		background: #ffffff;
		color: #0f172a;
		box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
	}

	h3 {
		margin: 0.5rem 0;
		font-size: 0.8125rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.tabla-scroll {
		overflow-x: auto;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		background: #ffffff;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		min-width: 55rem;
	}

	thead th {
		position: sticky;
		top: 0;
		background: #f8fafc;
		text-align: left;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
		white-space: nowrap;
	}

	tbody td {
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid #f1f5f9;
		vertical-align: top;
	}

	.tab {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.placa {
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.exceso {
		font-weight: 700;
		color: #b45309;
	}

	.chip {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		margin-right: 0.25rem;
		font-size: 0.6875rem;
		border-radius: 999px;
		background: #e2e8f0;
		color: #475569;
		font-weight: 600;
	}

	.fuente {
		margin: 0 0 0.75rem;
		font-size: 0.8125rem;
		color: #475569;
	}

	.historico {
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.625rem;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: #475569;
		max-width: 44rem;
	}

	.legacy {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px dashed #cbd5e1;
	}

	.serie {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
		gap: 0.5rem;
	}

	.serie li {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.5rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
	}

	.mes {
		font-size: 0.6875rem;
		text-transform: uppercase;
		color: #64748b;
	}

	.total {
		font-size: 1.125rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: #0f172a;
	}

	.plazo {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
	}

	.estado {
		font-weight: 600;
		color: #b45309;
	}

	.estado.mal,
	.mal {
		color: #b91c1c;
		font-weight: 600;
	}

	.ok {
		color: #15803d;
		font-weight: 600;
	}

	.sin {
		color: #94a3b8;
	}

	.nota {
		margin: 0.75rem 0 0;
		font-size: 0.8125rem;
		color: #64748b;
		max-width: 44rem;
	}

	a {
		color: #0f172a;
		font-weight: 600;
	}

	button:focus-visible,
	a:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
		border-radius: 0.25rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
