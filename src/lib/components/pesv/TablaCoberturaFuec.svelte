<script lang="ts">
	/**
	 * Cobertura contractual por servicio.
	 *
	 * Responde a la única pregunta que hace un inspector en carretera: *este
	 * servicio, ¿está amparado?* Y cuando la respuesta es no, dice exactamente
	 * qué falta y enlaza al registro de Extractos donde se corrige.
	 *
	 * Extractos sigue siendo el módulo operativo: aquí no se expide nada, se
	 * controla la cobertura.
	 */
	import type { PermisosPesv, RespuestaCobertura } from '$lib/types/pesv-centro';
	import EstadoBadge from './EstadoBadge.svelte';
	import EstadoPanel from './EstadoPanel.svelte';
	import { ESTADO_COBERTURA, formatearFecha } from './estados';

	interface Props {
		datos: RespuestaCobertura | null;
		cargando: boolean;
		error: string | null;
		filtroEstado: string;
		permisos: PermisosPesv;
		onFiltrar: (estado: string) => void;
		onReintentar: () => void;
		onImportar?: () => void;
	}

	let {
		datos,
		cargando,
		error,
		filtroEstado,
		permisos,
		onFiltrar,
		onReintentar,
		onImportar
	}: Props = $props();

	const ESTADOS = [
		{ valor: '', etiqueta: 'Todos los estados' },
		{ valor: 'CUBIERTO', etiqueta: 'Cubiertos' },
		{ valor: 'SIN_CONTRATO', etiqueta: 'Sin contrato' },
		{ valor: 'SIN_FUEC', etiqueta: 'Sin FUEC' },
		{ valor: 'VENCIDO', etiqueta: 'Vigencia expirada' },
		{ valor: 'VEHICULO_NO_COINCIDE', etiqueta: 'Vehículo no coincide' },
		{ valor: 'CONDUCTOR_NO_COINCIDE', etiqueta: 'Conductor no coincide' },
		{ valor: 'DOCUMENTOS_NO_VIGENTES', etiqueta: 'Documentos no vigentes' },
		{ valor: 'FUEC_ANULADO', etiqueta: 'FUEC anulado' }
	];
</script>

{#if cargando}
	<EstadoPanel tipo="cargando" mensaje="Evaluando la cobertura contractual…" />
{:else if error}
	<EstadoPanel tipo="error" mensaje={error} accion="Reintentar" onAccion={onReintentar} />
{:else if datos}
	<div class="cobertura">
		<div class="tarjetas">
			<div class="t">
				<span>Servicios evaluados</span>
				<strong>{datos.resumen.total}</strong>
			</div>
			<div class="t">
				<span>Cubiertos</span>
				<strong class="ok">{datos.resumen.cubiertos}</strong>
			</div>
			<div class="t destacada">
				<span>Sin cobertura demostrable</span>
				<strong class="mal">{datos.resumen.sinCobertura}</strong>
			</div>
			<div class="t">
				<span>Porcentaje cubierto</span>
				<strong>
					<!-- Sin servicios que evaluar NO es 0 %: es la ausencia de
					     denominador, y se dice con palabras. -->
					{datos.resumen.porcentaje === null ? 'Sin servicios' : `${datos.resumen.porcentaje} %`}
				</strong>
			</div>
		</div>

		<div class="controles">
			<label>
				<span>Estado de cobertura</span>
				<select value={filtroEstado} onchange={(e) => onFiltrar(e.currentTarget.value)}>
					{#each ESTADOS as e (e.valor)}
						<option value={e.valor}>{e.etiqueta}</option>
					{/each}
				</select>
			</label>

			{#if permisos.puedeGestionar && onImportar}
				<button type="button" class="importar" onclick={onImportar}>
					Importar extractos históricos
				</button>
			{/if}

			<a class="enlace-modulo" href="/dashboard/extractos">Abrir Extractos</a>
		</div>

		{#if datos.filas.length === 0}
			<EstadoPanel
				tipo="vacio"
				titulo="Sin servicios"
				mensaje="No hay servicios en el período que coincidan con el filtro."
			/>
		{:else}
			<div class="tabla-scroll">
				<table>
					<caption class="sr-only">Servicios con su estado de cobertura contractual</caption>
					<thead>
						<tr>
							<th scope="col">Fecha</th>
							<th scope="col">Planilla</th>
							<th scope="col">Cliente</th>
							<th scope="col">Vehículo</th>
							<th scope="col">Conductor</th>
							<th scope="col">Contrato</th>
							<th scope="col">FUEC</th>
							<th scope="col">Cobertura</th>
							<th scope="col"><span class="sr-only">Enlaces</span></th>
						</tr>
					</thead>
					<tbody>
						{#each datos.filas as f (f.servicioId)}
							<tr class:sin-cobertura={f.estado !== 'CUBIERTO'}>
								<td class="tab">{formatearFecha(f.fecha)}</td>
								<td class="tab">{f.numeroPlanilla ?? '—'}</td>
								<td>{f.clienteNombre ?? '—'}</td>
								<td class="placa">{f.vehiculoPlaca ?? '—'}</td>
								<td>{f.conductorNombre ?? '—'}</td>
								<td>
									{#if f.contrato}
										<span class="num">{f.contrato.numero}</span>
										<span class="sub">{f.contrato.contratanteNombre}</span>
									{:else}
										<span class="sin">Sin contrato</span>
									{/if}
								</td>
								<td>
									{#if f.fuec}
										<span class="num">{f.fuec.numeroCompleto}</span>
										<span class="sub">hasta {formatearFecha(f.fuec.vigenciaHasta)}</span>
									{:else}
										<span class="sin">Sin extracto</span>
									{/if}
								</td>
								<td>
									<EstadoBadge token={ESTADO_COBERTURA[f.estado]} />
									{#if f.documentosFaltantes.length > 0}
										<ul class="faltantes">
											{#each f.documentosFaltantes as d, i (i)}
												<li>{d}</li>
											{/each}
										</ul>
									{/if}
								</td>
								<td class="enlaces">
									<a href={f.enlaceServicio}>Servicio</a>
									<a href={f.enlaceExtractos}>Extracto</a>
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
	.cobertura {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tarjetas {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
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
	.mal {
		color: #b91c1c;
	}

	.controles {
		display: flex;
		align-items: flex-end;
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
		min-width: 14rem;
		background: #ffffff;
		color: #0f172a;
	}

	.importar,
	.enlace-modulo {
		padding: 0.5rem 0.875rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #ffffff;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #0f172a;
		cursor: pointer;
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
		text-decoration: none;
	}

	.importar:hover,
	.enlace-modulo:hover {
		background: #f1f5f9;
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
		min-width: 68rem;
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

	tbody tr.sin-cobertura {
		box-shadow: inset 3px 0 0 #b91c1c;
	}

	.tab {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.placa {
		font-weight: 600;
	}

	.num {
		display: block;
		font-weight: 600;
		color: #0f172a;
	}

	.sub {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
	}

	.sin {
		color: #b91c1c;
		font-weight: 600;
	}

	.faltantes {
		margin: 0.375rem 0 0;
		padding-left: 1rem;
		font-size: 0.75rem;
		color: #92400e;
	}

	.enlaces {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	a {
		color: #0f172a;
		font-weight: 600;
	}

	a:focus-visible,
	button:focus-visible,
	select:focus-visible {
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
