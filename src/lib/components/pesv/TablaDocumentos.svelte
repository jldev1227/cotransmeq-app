<script lang="ts">
	/**
	 * Vencimientos documentales de conductores, vehículos, terceros y contratos.
	 *
	 * Muestra los DOS ejes por separado —revisión y vigencia— porque cruzarlos
	 * en un solo estado es lo que hace que un SOAT aprobado hace un año y
	 * vencido ayer siga apareciendo en verde. La columna «acredita» es la
	 * conclusión de los dos, y es la única que responde a la pregunta que
	 * importa: ¿este documento habilita hoy?
	 */
	import type { PermisosPesv, RespuestaDocumentos } from '$lib/types/pesv-centro';
	import EstadoBadge from './EstadoBadge.svelte';
	import EstadoPanel from './EstadoPanel.svelte';
	import { ESTADO_REVISION, ESTADO_VIGENCIA, describirPlazo, formatearFecha } from './estados';

	interface Props {
		datos: RespuestaDocumentos | null;
		cargando: boolean;
		error: string | null;
		permisos: PermisosPesv;
		filtroVigencia: string;
		filtroAmbito: string;
		onFiltrar: (cambio: { estadoVigencia?: string; ambito?: string }) => void;
		onRevisar: (id: string, decision: 'APROBADO' | 'RECHAZADO') => void;
		onReintentar: () => void;
	}

	let {
		datos,
		cargando,
		error,
		permisos,
		filtroVigencia,
		filtroAmbito,
		onFiltrar,
		onRevisar,
		onReintentar
	}: Props = $props();

	const AMBITOS = [
		{ valor: '', etiqueta: 'Todos los ámbitos' },
		{ valor: 'CONDUCTOR', etiqueta: 'Conductores' },
		{ valor: 'VEHICULO', etiqueta: 'Vehículos' },
		{ valor: 'TERCERO', etiqueta: 'Terceros' },
		{ valor: 'CONTRATO', etiqueta: 'Contratos' },
		{ valor: 'EMPRESA', etiqueta: 'Empresa' }
	];

	const VIGENCIAS = [
		{ valor: '', etiqueta: 'Toda vigencia' },
		{ valor: 'VENCIDO', etiqueta: 'Vencidos' },
		{ valor: 'POR_VENCER', etiqueta: 'Por vencer' },
		{ valor: 'VIGENTE', etiqueta: 'Vigentes' },
		{ valor: 'SIN_FECHA', etiqueta: 'Sin fecha' }
	];
</script>

{#if cargando}
	<EstadoPanel tipo="cargando" mensaje="Consultando vencimientos documentales…" />
{:else if error}
	<EstadoPanel tipo="error" mensaje={error} accion="Reintentar" onAccion={onReintentar} />
{:else if datos}
	<div class="documentos">
		<div class="tarjetas">
			<div class="t">
				<span>Vencidos</span><strong class="mal">{datos.resumen.vencidos}</strong>
			</div>
			<div class="t">
				<span>Por vencer</span><strong class="aviso">{datos.resumen.porVencer}</strong>
			</div>
			<div class="t"><span>Vigentes</span><strong class="ok">{datos.resumen.vigentes}</strong></div>
			<div class="t"><span>Sin fecha</span><strong>{datos.resumen.sinFecha}</strong></div>
			<div class="t">
				<span>Sin revisar</span><strong class="aviso">{datos.resumen.pendientesRevision}</strong>
			</div>
			<div class="t destacada">
				<span>Obligatorios sin acreditar</span>
				<strong class="mal">{datos.resumen.obligatoriosSinAcreditar}</strong>
			</div>
		</div>

		<div class="filtros">
			<label>
				<span>Ámbito</span>
				<select value={filtroAmbito} onchange={(e) => onFiltrar({ ambito: e.currentTarget.value })}>
					{#each AMBITOS as a (a.valor)}
						<option value={a.valor}>{a.etiqueta}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Vigencia</span>
				<select
					value={filtroVigencia}
					onchange={(e) => onFiltrar({ estadoVigencia: e.currentTarget.value })}
				>
					{#each VIGENCIAS as v (v.valor)}
						<option value={v.valor}>{v.etiqueta}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if datos.filas.length === 0}
			<EstadoPanel
				tipo="vacio"
				titulo="Sin documentos"
				mensaje="No hay documentos que coincidan con los filtros aplicados."
			/>
		{:else}
			<div class="tabla-scroll">
				<table>
					<caption class="sr-only">Documentos con su vigencia, revisión y titular</caption>
					<thead>
						<tr>
							<th scope="col">Tipo</th>
							<th scope="col">Titular</th>
							<th scope="col">Número</th>
							<th scope="col">Vence</th>
							<th scope="col">Vigencia</th>
							<th scope="col">Revisión</th>
							<th scope="col">¿Acredita?</th>
							<th scope="col"><span class="sr-only">Acciones</span></th>
						</tr>
					</thead>
					<tbody>
						{#each datos.filas as d (d.id)}
							<tr>
								<td>
									<span class="tipo">{d.tipoEtiqueta}</span>
									{#if d.obligatorio}<span class="obligatorio">obligatorio</span>{/if}
									{#if !d.tipo}
										<!-- Sin tipo normalizado no hay umbral configurable que aplicar:
										     se dice, no se supone uno. -->
										<span class="sin-tipo">sin tipo normalizado</span>
									{/if}
								</td>
								<td>
									{#if d.titular.id}
										<a href={d.enlace}>{d.titular.etiqueta}</a>
									{:else}
										<span>{d.titular.etiqueta}</span>
									{/if}
									<span class="ambito">{d.ambito.toLowerCase()}</span>
								</td>
								<td class="numero">{d.numero ?? '—'}</td>
								<td>
									<span class="fecha">{formatearFecha(d.fechaVencimiento)}</span>
									<span class="plazo" class:tarde={d.estadoVigencia === 'VENCIDO'}>
										{describirPlazo(d.diasRestantes)}
									</span>
								</td>
								<td><EstadoBadge token={ESTADO_VIGENCIA[d.estadoVigencia]} /></td>
								<td><EstadoBadge token={ESTADO_REVISION[d.estadoRevision]} /></td>
								<td>
									<span class="acredita" class:si={d.acredita}>
										{d.acredita ? 'Sí' : 'No'}
									</span>
								</td>
								<td>
									{#if permisos.puedeRevisar && d.estadoRevision === 'PENDIENTE'}
										<div class="acciones">
											<button
												type="button"
												class="aprobar"
												onclick={() => onRevisar(d.id, 'APROBADO')}
											>
												Aprobar
											</button>
											<button
												type="button"
												class="rechazar"
												onclick={() => onRevisar(d.id, 'RECHAZADO')}
											>
												Rechazar
											</button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}

<style>
	.documentos {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tarjetas {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.625rem;
	}

	.t {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.75rem;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
	}

	.t.destacada {
		border-color: #fecaca;
		background: #fef2f2;
	}

	.t span {
		font-size: 0.75rem;
		color: #64748b;
	}

	.t strong {
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
		color: #0f172a;
	}

	.ok {
		color: #15803d;
	}
	.aviso {
		color: #b45309;
	}
	.mal {
		color: #b91c1c;
	}

	.filtros {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #475569;
	}

	select {
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		font-size: 0.875rem;
		min-height: 2.75rem;
		background: #ffffff;
		color: #0f172a;
		/* Medida del propio control, no del contenedor. */
		min-width: 12rem;
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
		min-width: 62rem;
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

	.tipo {
		display: block;
		font-weight: 600;
		color: #0f172a;
	}

	.obligatorio,
	.sin-tipo,
	.ambito {
		display: inline-block;
		margin-top: 0.125rem;
		padding: 0 0.375rem;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		background: #e2e8f0;
		color: #475569;
		font-weight: 700;
	}

	.sin-tipo {
		background: #fffbeb;
		color: #92400e;
	}

	.numero {
		font-variant-numeric: tabular-nums;
	}

	.fecha {
		display: block;
		font-variant-numeric: tabular-nums;
	}

	.plazo {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
	}

	.plazo.tarde {
		color: #b91c1c;
		font-weight: 600;
	}

	.acredita {
		font-weight: 700;
		color: #b91c1c;
	}

	.acredita.si {
		color: #15803d;
	}

	.acciones {
		display: flex;
		gap: 0.375rem;
	}

	button {
		padding: 0.375rem 0.625rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #ffffff;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 2.75rem;
		white-space: nowrap;
	}

	.aprobar {
		border-color: #bbf7d0;
		background: #f0fdf4;
		color: #15803d;
	}

	.rechazar {
		border-color: #fecaca;
		background: #fef2f2;
		color: #b91c1c;
	}

	button:focus-visible,
	select:focus-visible,
	a:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
		border-radius: 0.25rem;
	}

	a {
		color: #0f172a;
		font-weight: 600;
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
