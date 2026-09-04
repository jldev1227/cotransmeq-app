<script lang="ts">
	/**
	 * Matriz normativa de los 24 pasos.
	 *
	 * Cada fila muestra estado, responsable, plazo y **qué falta exactamente**
	 * para poder cumplir. El detalle de los bloqueos es lo que distingue esta
	 * pantalla de una lista de casillas: «no hay evidencia aportada» y «la
	 * evidencia está vencida» piden acciones distintas de personas distintas.
	 *
	 * Un paso no muestra `CUMPLE` mientras tenga un soporte obligatorio
	 * pendiente, rechazado o vencido: ese estado lo decide el servidor y aquí
	 * solo se refleja.
	 */
	import type { FilaMatriz, ResumenMatriz } from '$lib/types/pesv-centro';
	import EstadoBadge from './EstadoBadge.svelte';
	import EstadoPanel from './EstadoPanel.svelte';
	import { ESTADO_REQUISITO, describirPlazo, etiquetaArea, formatearFecha } from './estados';

	interface Props {
		filas: FilaMatriz[];
		resumen: ResumenMatriz;
		cargando: boolean;
		onAbrirPaso: (paso: number) => void;
	}

	let { filas, resumen, cargando, onAbrirPaso }: Props = $props();

	/// Agrupadas por fase: la metodología se lee así, y una tabla plana de 24
	/// filas pierde de vista a qué bloque pertenece cada requisito.
	const porFase = $derived.by(() => {
		const grupos = new Map<string, FilaMatriz[]>();
		for (const f of filas) {
			const lista = grupos.get(f.faseEtiqueta) ?? [];
			lista.push(f);
			grupos.set(f.faseEtiqueta, lista);
		}
		return Array.from(grupos.entries());
	});
</script>

{#if cargando}
	<EstadoPanel tipo="cargando" mensaje="Cargando la matriz de cumplimiento…" />
{:else if filas.length === 0}
	<EstadoPanel
		tipo="vacio"
		titulo="Ningún paso coincide"
		mensaje="Ajuste los filtros de fase, estado, área o búsqueda."
	/>
{:else}
	<div class="matriz">
		{#each porFase as [fase, pasos] (fase)}
			<section aria-labelledby="fase-{pasos[0].fase}">
				<h3 id="fase-{pasos[0].fase}">
					{fase}
					<span class="conteo">
						{pasos.filter((p) => p.estado === 'CUMPLE').length} de {pasos.length} cumplen
					</span>
				</h3>

				<div class="tabla-scroll">
					<table>
						<caption class="sr-only">
							Pasos de {fase} con su estado, responsable, plazo y evidencias
						</caption>
						<thead>
							<tr>
								<th scope="col" class="col-num">#</th>
								<th scope="col">Requisito</th>
								<th scope="col">Estado</th>
								<th scope="col">Responsable</th>
								<th scope="col">Plazo</th>
								<th scope="col">Evidencias</th>
								<th scope="col"><span class="sr-only">Acciones</span></th>
							</tr>
						</thead>
						<tbody>
							{#each pasos as p (p.stepNumber)}
								<tr class:vencido={p.vencido}>
									<td class="col-num">{p.stepNumber}</td>
									<td>
										<button type="button" class="nombre" onclick={() => onAbrirPaso(p.stepNumber)}>
											{p.nombre}
										</button>
										<p class="descripcion">{p.descripcion}</p>
										{#if p.bloqueos.length > 0}
											<!-- Lo que falta, en concreto. Sin esto la fila diría «en
											     revisión» y nadie sabría qué hacer con ella. -->
											<ul class="bloqueos">
												{#each p.bloqueos as b, i (i)}
													<li>{b}</li>
												{/each}
											</ul>
										{/if}
										{#if p.indicadores.length > 0}
											<p class="indicadores">
												Alimenta: {p.indicadores.join(', ')}
											</p>
										{/if}
									</td>
									<td>
										<EstadoBadge token={ESTADO_REQUISITO[p.estado]} />
										{#if p.justificacion}
											<p class="justificacion" title={p.justificacion}>{p.justificacion}</p>
										{/if}
									</td>
									<td>
										<span class="area">{etiquetaArea(p.areaResponsable)}</span>
										{#if p.responsable}
											<span class="persona">{p.responsable.nombre}</span>
										{/if}
									</td>
									<td>
										{#if p.fechaLimite}
											<span class="fecha">{formatearFecha(p.fechaLimite)}</span>
											<span class="plazo" class:tarde={p.vencido}>
												{describirPlazo(p.diasParaVencer)}
											</span>
										{:else}
											<span class="sin-plazo">Sin plazo definido</span>
										{/if}
									</td>
									<td>
										<span class="evidencias">
											<span class="ok">{p.evidencias.aprobadas}</span> aprobadas
										</span>
										{#if p.evidencias.pendientes > 0}
											<span class="evidencias pend">{p.evidencias.pendientes} por revisar</span>
										{/if}
										{#if p.evidencias.rechazadas > 0}
											<span class="evidencias mal">{p.evidencias.rechazadas} rechazadas</span>
										{/if}
										{#if p.evidencias.vencidas > 0}
											<span class="evidencias mal">{p.evidencias.vencidas} vencidas</span>
										{/if}
									</td>
									<td>
										<button type="button" class="abrir" onclick={() => onAbrirPaso(p.stepNumber)}>
											Abrir
											<span class="sr-only">el paso {p.stepNumber}: {p.nombre}</span>
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/each}

		<p class="pie-resumen">
			{resumen.porEstado.CUMPLE} de {resumen.aplicables} pasos aplicables cumplen.
			{#if resumen.vencidos > 0}
				<strong>{resumen.vencidos}</strong> con plazo vencido.
			{/if}
			{#if resumen.bloqueados > 0}
				<strong>{resumen.bloqueados}</strong> en revisión con soportes obligatorios sin resolver.
			{/if}
		</p>
	</div>
{/if}

<style>
	.matriz {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	h3 {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin: 0 0 0.625rem;
		font-size: 0.9375rem;
		font-weight: 700;
		color: #0f172a;
	}

	.conteo {
		font-size: 0.75rem;
		font-weight: 500;
		color: #64748b;
	}

	/* La tabla hace scroll dentro de su caja; la página nunca se desplaza en
	   horizontal. */
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
		min-width: 60rem;
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
		padding: 0.75rem;
		border-bottom: 1px solid #f1f5f9;
		vertical-align: top;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	tbody tr.vencido {
		/* Además del borde, el texto del plazo dice «venció hace N días»: el
		   color no es el único canal. */
		box-shadow: inset 3px 0 0 #b91c1c;
	}

	.col-num {
		width: 3rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #64748b;
	}

	.nombre {
		background: none;
		border: none;
		padding: 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: #0f172a;
		cursor: pointer;
		text-align: left;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.descripcion {
		margin: 0.25rem 0 0;
		color: #64748b;
		max-width: 44rem;
	}

	.bloqueos {
		margin: 0.375rem 0 0;
		padding-left: 1rem;
		color: #92400e;
	}

	.indicadores {
		margin: 0.375rem 0 0;
		font-size: 0.75rem;
		color: #64748b;
	}

	.justificacion {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: #64748b;
		max-width: 16rem;
		/* Medida del propio control: la celda no debe crecer por una
		   justificación larga. */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.area {
		display: block;
		font-weight: 600;
		color: #0f172a;
	}

	.persona {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
	}

	.fecha {
		display: block;
		font-variant-numeric: tabular-nums;
		color: #0f172a;
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

	.sin-plazo {
		color: #94a3b8;
	}

	.evidencias {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
		white-space: nowrap;
	}

	.evidencias .ok {
		font-weight: 700;
		color: #15803d;
	}

	.evidencias.pend {
		color: #b45309;
	}

	.evidencias.mal {
		color: #b91c1c;
	}

	.abrir {
		padding: 0.5rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #ffffff;
		font-size: 0.75rem;
		font-weight: 600;
		color: #0f172a;
		cursor: pointer;
		min-height: 2.75rem;
		white-space: nowrap;
	}

	.abrir:hover {
		background: #f1f5f9;
	}

	.pie-resumen {
		margin: 0;
		font-size: 0.8125rem;
		color: #475569;
	}

	button:focus-visible {
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
