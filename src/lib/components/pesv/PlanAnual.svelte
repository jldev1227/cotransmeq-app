<script lang="ts">
	/**
	 * Plan anual: actividades, metas, programas críticos y formación.
	 *
	 * Las actividades siguen viniendo de `actividades_pesv`, que es el módulo
	 * que ya existía; lo que aporta esta vista es el resto del paso 9 y del 8 —
	 * metas contra las que medir, programas con cobertura de flota y eventos de
	 * formación con población congelada— y el hecho de que todo cuelgue del
	 * ciclo del año.
	 */
	import type {
		FormacionPesv,
		MetaPesv,
		PermisosPesv,
		ProgramaPesv,
		RiesgoPesv
	} from '$lib/types/pesv-centro';
	import type { ActividadPesv } from '$lib/types/actividadesPesv';
	import EstadoPanel from './EstadoPanel.svelte';
	import EstadoBadge from './EstadoBadge.svelte';
	import { NIVEL_RIESGO, formatearFecha } from './estados';

	interface Props {
		actividades: ActividadPesv[];
		metas: MetaPesv[];
		programas: ProgramaPesv[];
		formaciones: FormacionPesv[];
		riesgos: RiesgoPesv[];
		cargando: boolean;
		error: string | null;
		panel: string;
		filtroEstado: string;
		permisos: PermisosPesv;
		onPanel: (panel: string) => void;
		onFiltrarEstado: (estado: string) => void;
		onReintentar: () => void;
	}

	let {
		actividades,
		metas,
		programas,
		formaciones,
		riesgos,
		cargando,
		error,
		panel,
		filtroEstado,
		permisos,
		onPanel,
		onFiltrarEstado,
		onReintentar
	}: Props = $props();

	const PANELES = [
		{ id: 'actividades', etiqueta: 'Actividades' },
		{ id: 'metas', etiqueta: 'Metas' },
		{ id: 'programas', etiqueta: 'Programas' },
		{ id: 'riesgos', etiqueta: 'Riesgos' },
		{ id: 'formacion', etiqueta: 'Formación' }
	];

	const ESTADOS_ACTIVIDAD = [
		{ valor: '', etiqueta: 'Todos los estados' },
		{ valor: 'PENDIENTE', etiqueta: 'Pendientes' },
		{ valor: 'EN_PROGRESO', etiqueta: 'En progreso' },
		{ valor: 'COMPLETADA', etiqueta: 'Completadas' },
		{ valor: 'VENCIDA', etiqueta: 'Vencidas' },
		{ valor: 'CANCELADA', etiqueta: 'Canceladas' }
	];

	/// El estado de una actividad se pinta con clase y con TEXTO. Solo color
	/// dejaría fuera a quien no lo distingue.
	const CLASE_ESTADO: Record<string, string> = {
		PENDIENTE: 'neutro',
		EN_PROGRESO: 'info',
		COMPLETADA: 'ok',
		VENCIDA: 'mal',
		CANCELADA: 'apagado'
	};

	const numero = (v: string | number | null | undefined): string =>
		v === null || v === undefined ? '—' : String(v);
</script>

<div class="plan">
	<nav class="sub-nav" aria-label="Paneles del plan anual">
		{#each PANELES as p (p.id)}
			<button type="button" class:activo={panel === p.id} onclick={() => onPanel(p.id)}>
				{p.etiqueta}
			</button>
		{/each}
	</nav>

	{#if cargando}
		<EstadoPanel tipo="cargando" mensaje="Cargando el plan anual…" />
	{:else if error}
		<EstadoPanel tipo="error" mensaje={error} accion="Reintentar" onAccion={onReintentar} />
	{:else if panel === 'actividades'}
		<section>
			<label class="filtro">
				<span>Estado</span>
				<select value={filtroEstado} onchange={(e) => onFiltrarEstado(e.currentTarget.value)}>
					{#each ESTADOS_ACTIVIDAD as e (e.valor)}
						<option value={e.valor}>{e.etiqueta}</option>
					{/each}
				</select>
			</label>

			{#if actividades.length === 0}
				<EstadoPanel
					tipo="vacio"
					titulo="Sin actividades"
					mensaje="No hay actividades del plan anual con los filtros aplicados."
				/>
			{:else}
				<div class="tabla-scroll">
					<table>
						<caption class="sr-only">Actividades del plan anual de trabajo</caption>
						<thead>
							<tr>
								<th scope="col">#</th>
								<th scope="col">Actividad</th>
								<th scope="col">Unidad / programa</th>
								<th scope="col">Responsable</th>
								<th scope="col">Frecuencia</th>
								<th scope="col">Fecha límite</th>
								<th scope="col">Estado</th>
							</tr>
						</thead>
						<tbody>
							{#each actividades as a (a.id)}
								<tr>
									<td class="tab">{a.numero}</td>
									<td>
										<strong>{a.actividad}</strong>
										{#if a.alcance}<span class="sub">{a.alcance}</span>{/if}
									</td>
									<td>{a.unidad_programa}</td>
									<td>
										{a.responsable_ejecucion?.nombre ?? a.responsable_planeacion ?? '—'}
									</td>
									<td class="minus">{a.frecuencia.toLowerCase()}</td>
									<td class="tab">{formatearFecha(a.fecha_limite)}</td>
									<td>
										<span class="pastilla {CLASE_ESTADO[a.estado] ?? 'neutro'}">
											{a.estado.replace('_', ' ').toLowerCase()}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{:else if panel === 'metas'}
		<section>
			{#if metas.length === 0}
				<EstadoPanel
					tipo="vacio"
					titulo="Sin metas definidas"
					mensaje="Sin metas aprobadas, los indicadores se calculan pero no declaran cumplimiento: el semáforo queda en gris."
				/>
			{:else}
				<div class="tabla-scroll">
					<table>
						<caption class="sr-only">Metas del ciclo</caption>
						<thead>
							<tr>
								<th scope="col">Indicador</th>
								<th scope="col">Meta</th>
								<th scope="col">Línea base</th>
								<th scope="col">Objetivo</th>
								<th scope="col">Sentido</th>
								<th scope="col">Umbral de alerta</th>
								<th scope="col">Plazo</th>
								<th scope="col">Resultado</th>
							</tr>
						</thead>
						<tbody>
							{#each metas as m (m.id)}
								<tr>
									<td class="cod">{m.indicador_codigo ?? '—'}</td>
									<td>
										<strong>{m.nombre}</strong>
										{#if m.descripcion}<span class="sub">{m.descripcion}</span>{/if}
									</td>
									<td class="tab">{numero(m.linea_base)}</td>
									<td class="tab">{numero(m.valor_meta)} {m.unidad ?? ''}</td>
									<td class="minus">
										{m.sentido === 'MAYOR_ES_MEJOR' ? 'mayor es mejor' : 'menor es mejor'}
									</td>
									<td class="tab">{numero(m.umbral_alerta)}</td>
									<td class="tab">{formatearFecha(m.fecha_limite)}</td>
									<td>
										{#if m.lograda === null}
											<!-- Sin evaluar sale del denominador del indicador CMP; no
											     es lo mismo que «no lograda». -->
											<span class="pastilla neutro">sin evaluar</span>
										{:else if m.lograda}
											<span class="pastilla ok">lograda</span>
										{:else}
											<span class="pastilla mal">no lograda</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{:else if panel === 'programas'}
		<section>
			{#if programas.length === 0}
				<EstadoPanel
					tipo="vacio"
					titulo="Sin programas de gestión"
					mensaje="El paso 8 exige como mínimo velocidad segura, prevención de fatiga, prevención de distracción, cero tolerancia al alcohol y sustancias, y protección de actores viales vulnerables."
				/>
			{:else}
				<ul class="tarjetas">
					{#each programas as p (p.id)}
						<li>
							<span class="tipo">{p.tipo.replace(/_/g, ' ').toLowerCase()}</span>
							<strong>{p.nombre}</strong>
							{#if p.alcance}<p class="sub">{p.alcance}</p>{/if}
							<dl>
								<div>
									<dt>Vehículos cubiertos</dt>
									<dd class="tab">{p._count.vehiculos}</dd>
								</div>
								<div>
									<dt>Vigencia</dt>
									<dd>{formatearFecha(p.fecha_inicio)} — {formatearFecha(p.fecha_fin)}</dd>
								</div>
								<div>
									<dt>Responsable</dt>
									<dd>{p.responsable?.nombre ?? '—'}</dd>
								</div>
							</dl>
							{#if p.tipo === 'VELOCIDAD'}
								<p class="nota">La cobertura de este programa es el numerador del indicador GVE.</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else if panel === 'riesgos'}
		<section>
			{#if riesgos.length === 0}
				<EstadoPanel
					tipo="vacio"
					titulo="Sin riesgos caracterizados"
					mensaje="Sin matriz de riesgos, los indicadores RSVI y GRV quedan sin datos."
				/>
			{:else}
				<div class="tabla-scroll">
					<table>
						<caption class="sr-only">Matriz de riesgos viales</caption>
						<thead>
							<tr>
								<th scope="col">Código</th>
								<th scope="col">Peligro</th>
								<th scope="col">Proceso</th>
								<th scope="col">Actor vial</th>
								<th scope="col">Nivel inicial</th>
								<th scope="col">Nivel final</th>
								<th scope="col">Controles</th>
							</tr>
						</thead>
						<tbody>
							{#each riesgos as r (r.id)}
								<tr>
									<td class="cod">{r.codigo ?? '—'}</td>
									<td><strong>{r.peligro}</strong></td>
									<td>{r.proceso ?? '—'}</td>
									<td>{r.actor_vial ?? '—'}</td>
									<td>
										{#if r.nivel_inicial}
											<EstadoBadge token={NIVEL_RIESGO[r.nivel_inicial]} />
										{:else}
											<span class="sin">Sin valorar</span>
										{/if}
									</td>
									<td>
										{#if r.nivel_final}
											<EstadoBadge token={NIVEL_RIESGO[r.nivel_final]} />
										{:else}
											<span class="sin">Sin valoración final</span>
										{/if}
									</td>
									<td class="controles">{r.controles ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{:else if panel === 'formacion'}
		<section>
			{#if formaciones.length === 0}
				<EstadoPanel
					tipo="vacio"
					titulo="Sin plan de formación"
					mensaje="Sin eventos planificados, los indicadores CPFSV y CPF quedan sin datos."
				/>
			{:else}
				<div class="tabla-scroll">
					<table>
						<caption class="sr-only">Plan de formación en seguridad vial</caption>
						<thead>
							<tr>
								<th scope="col">Tema</th>
								<th scope="col">Tipo</th>
								<th scope="col">Trimestre</th>
								<th scope="col">Planificada</th>
								<th scope="col">Ejecutada</th>
								<th scope="col">Población objetivo</th>
								<th scope="col">Asistentes</th>
								<th scope="col">Estado</th>
							</tr>
						</thead>
						<tbody>
							{#each formaciones as f (f.id)}
								<tr>
									<td>
										<strong>{f.tema}</strong>
										{#if f.objetivo}<span class="sub">{f.objetivo}</span>{/if}
									</td>
									<td class="minus">{f.tipo.toLowerCase()}</td>
									<td class="tab">{f.trimestre ?? '—'}</td>
									<td class="tab">{formatearFecha(f.fecha_planificada)}</td>
									<td class="tab">{formatearFecha(f.fecha_ejecucion)}</td>
									<td class="tab">
										{f.poblacion_objetivo ?? '—'}
										{#if f.poblacion_objetivo}
											<span class="sub">congelada</span>
										{/if}
									</td>
									<td class="tab">
										{#if f.asistencia}
											<a href="/dashboard/asistencias?id={f.asistencia.id}">
												{f.asistencia._count.respuestas}
											</a>
										{:else}
											<span class="sin">Sin vincular</span>
										{/if}
									</td>
									<td>
										<span class="pastilla {f.ejecutado ? 'ok' : 'neutro'}">
											{f.ejecutado ? 'ejecutada' : 'planificada'}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	{#if !permisos.puedeGestionar}
		<p class="nota-permiso">
			Su nivel de acceso permite consultar el plan. Definir metas, programas y política solo lo
			hacen HSEQ y Administración.
		</p>
	{/if}
</div>

<style>
	.plan {
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

	.filtro {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #475569;
		margin-bottom: 0.75rem;
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
		min-width: 58rem;
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

	.cod {
		font-weight: 700;
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.minus {
		text-transform: capitalize;
	}

	.sub {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
	}

	.sin {
		color: #94a3b8;
	}

	.controles {
		max-width: 20rem;
	}

	.pastilla {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: capitalize;
		border: 1px solid;
	}

	.pastilla.ok {
		color: #15803d;
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.pastilla.mal {
		color: #b91c1c;
		background: #fef2f2;
		border-color: #fecaca;
	}
	.pastilla.info {
		color: #1d4ed8;
		background: #eff6ff;
		border-color: #bfdbfe;
	}
	.pastilla.neutro {
		color: #475569;
		background: #f8fafc;
		border-color: #e2e8f0;
	}
	.pastilla.apagado {
		color: #94a3b8;
		background: #f8fafc;
		border-color: #e2e8f0;
	}

	.tarjetas {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
		gap: 0.75rem;
	}

	.tarjetas li {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.875rem;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
	}

	.tipo {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.tarjetas dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.5rem;
		margin: 0.5rem 0 0;
	}

	.tarjetas dt {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.tarjetas dd {
		margin: 0;
		font-size: 0.875rem;
		color: #0f172a;
	}

	.nota,
	.nota-permiso {
		margin: 0.5rem 0 0;
		font-size: 0.75rem;
		color: #64748b;
		max-width: 44rem;
	}

	a {
		color: #0f172a;
		font-weight: 600;
	}

	button:focus-visible,
	select:focus-visible,
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
