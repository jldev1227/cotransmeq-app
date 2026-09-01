<!--
	Explorador de envíos.

	Los filtros son ESTRUCTURADOS (formulario, versión, conductor, vehículo, rango
	de fechas de negocio) y la búsqueda libre solo mira conductor y placa. No hay
	búsqueda dentro de las respuestas a propósito: sería un LIKE sobre
	`form_answers` sin índice, con millones de filas.

	El CSV solo despliega columnas por pregunta cuando se filtra por una versión
	concreta. Formularios distintos —o versiones distintas del mismo— no comparten
	preguntas, y mezclarlas produciría un archivo ilegible.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import { enviosFormularioAPI, formulariosAPI, type FiltrosEnvios } from '$lib/api/formularios';
	import {
		SUBMISSION_STATUS_LABELS,
		type FormDefinitionDto,
		type SubmissionStatus,
		type SubmissionSummaryDto
	} from '$lib/formularios/types';

	let envios = $state<SubmissionSummaryDto[]>([]);
	let formularios = $state<FormDefinitionDto[]>([]);
	let cargando = $state(true);
	let exportando = $state(false);

	let pagina = $state(1);
	let totalPages = $state(1);
	let total = $state(0);

	let filtroFormId = $state('');
	let filtroVersionId = $state('');
	let filtroEstado = $state<SubmissionStatus | ''>('');
	let filtroBusqueda = $state('');
	let filtroDesde = $state('');
	let filtroHasta = $state('');

	let timerBusqueda: ReturnType<typeof setTimeout> | null = null;

	/// Las versiones del formulario elegido: sin filtrar por versión no se pueden
	/// desplegar las respuestas en el CSV.
	const versionesDisponibles = $derived(
		formularios.find((f) => f.id === filtroFormId)?.versions ?? []
	);

	function filtros(): FiltrosEnvios {
		return {
			page: pagina,
			limit: 25,
			formId: filtroFormId || undefined,
			versionId: filtroVersionId || undefined,
			status: filtroEstado || undefined,
			search: filtroBusqueda.trim() || undefined,
			businessDateFrom: filtroDesde || undefined,
			businessDateTo: filtroHasta || undefined
		};
	}

	async function cargar() {
		cargando = true;
		try {
			const { data, meta } = await enviosFormularioAPI.listar(filtros());
			envios = data;
			total = meta.total ?? 0;
			totalPages = meta.totalPages ?? 1;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los envíos.');
		} finally {
			cargando = false;
		}
	}

	onMount(async () => {
		/// El `formId` puede venir del resumen del formulario, para llegar aquí ya
		/// filtrado.
		filtroFormId = $page.url.searchParams.get('formId') ?? '';
		try {
			const { data } = await formulariosAPI.listar({ limit: 100 });
			formularios = data;
		} catch {
			formularios = [];
		}
		await cargar();
	});

	function cambiarFiltro(fn: () => void) {
		fn();
		pagina = 1;
		void cargar();
	}

	function onBuscar(valor: string) {
		filtroBusqueda = valor;
		pagina = 1;
		if (timerBusqueda) clearTimeout(timerBusqueda);
		timerBusqueda = setTimeout(cargar, 350);
	}

	async function exportar() {
		exportando = true;
		try {
			const blob = await enviosFormularioAPI.exportarCsv({ ...filtros(), page: 1, limit: 100 });
			/// Descarga con `URL.createObjectURL` y revocación inmediata: sin revocar,
			/// cada export deja el blob en memoria hasta recargar la página.
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `envios-formularios-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			if (!filtroVersionId) {
				toast.info('Sin filtrar por versión, el CSV trae solo la cabecera de cada envío.');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo exportar.');
		} finally {
			exportando = false;
		}
	}

	function fechaHora(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head><title>Envíos de formularios · Transmeralda</title></svelte:head>

<div class="pagina">
	<header class="cabecera">
		<div>
			<nav class="migas" aria-label="Ruta">
				<a href="/dashboard/formularios">Formularios</a>
				<span aria-hidden="true">›</span>
				<span>Envíos</span>
			</nav>
			<h1 class="cabecera__titulo">Envíos</h1>
		</div>
		<button type="button" class="btn" disabled={exportando} onclick={exportar}>
			{exportando ? 'Generando…' : 'Exportar CSV'}
		</button>
	</header>

	<div class="filtros">
		<label class="filtro filtro--ancho">
			<span class="filtro__label">Buscar</span>
			<input
				class="input"
				type="search"
				placeholder="Conductor, cédula o placa…"
				value={filtroBusqueda}
				oninput={(e) => onBuscar(e.currentTarget.value)}
			/>
		</label>

		<label class="filtro">
			<span class="filtro__label">Formulario</span>
			<select
				class="input"
				value={filtroFormId}
				onchange={(e) =>
					cambiarFiltro(() => {
						filtroFormId = e.currentTarget.value;
						/// La versión se limpia al cambiar de formulario: una versión de
						/// otro formulario devolvería cero resultados sin explicación.
						filtroVersionId = '';
					})}
			>
				<option value="">Todos</option>
				{#each formularios as f (f.id)}
					<option value={f.id}>{f.code} — {f.name}</option>
				{/each}
			</select>
		</label>

		<label class="filtro">
			<span class="filtro__label">Versión</span>
			<select
				class="input"
				value={filtroVersionId}
				disabled={!filtroFormId}
				onchange={(e) => cambiarFiltro(() => (filtroVersionId = e.currentTarget.value))}
			>
				<option value="">Todas</option>
				{#each versionesDisponibles as v (v.id)}
					<option value={v.id}>v{v.versionNumber} · {v.status}</option>
				{/each}
			</select>
		</label>

		<label class="filtro">
			<span class="filtro__label">Estado</span>
			<select
				class="input"
				value={filtroEstado}
				onchange={(e) =>
					cambiarFiltro(() => (filtroEstado = e.currentTarget.value as SubmissionStatus | ''))}
			>
				<option value="">Todos</option>
				<option value="SUBMITTED">Entregados</option>
				<option value="VOIDED">Anulados</option>
				<option value="DRAFT">Borradores</option>
			</select>
		</label>

		<label class="filtro">
			<span class="filtro__label">Desde</span>
			<input
				class="input"
				type="date"
				value={filtroDesde}
				onchange={(e) => cambiarFiltro(() => (filtroDesde = e.currentTarget.value))}
			/>
		</label>

		<label class="filtro">
			<span class="filtro__label">Hasta</span>
			<input
				class="input"
				type="date"
				value={filtroHasta}
				onchange={(e) => cambiarFiltro(() => (filtroHasta = e.currentTarget.value))}
			/>
		</label>
	</div>

	<p class="conteo">{total} envío{total === 1 ? '' : 's'}</p>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando envíos…</div>
	{:else if envios.length === 0}
		<div class="estado">Sin envíos que coincidan con los filtros.</div>
	{:else}
		<!-- La tabla scrollea en su propio contenedor: la página nunca desborda en
		     horizontal, ni en un portátil de 13". -->
		<div class="tabla-scroll">
			<table class="tabla">
				<thead>
					<tr>
						<th scope="col">Formulario</th>
						<th scope="col">Diligenciado por</th>
						<th scope="col">Vehículo</th>
						<th scope="col">Fecha negocio</th>
						<th scope="col">Enviado</th>
						<th scope="col">Estado</th>
						<th scope="col"><span class="sr-only">Acciones</span></th>
					</tr>
				</thead>
				<tbody>
					{#each envios as envio (envio.id)}
						<tr class:fila--anulada={envio.status === 'VOIDED'}>
							<td>
								<span class="mono">{envio.version?.code ?? '—'}</span>
								<span class="sub">v{envio.version?.versionNumber} · {envio.assignment?.name ?? ''}</span>
							</td>
							<td>
								<!--
									El autor puede ser un conductor o un usuario interno: desde que
									una asignación alcanza a las dos poblaciones, leer solo
									`conductor` dejaba media lista con un guion.
								-->
								{envio.actor?.nombre ?? '—'}
								{#if envio.conductor?.numeroIdentificacion}
									<span class="sub mono">{envio.conductor.numeroIdentificacion}</span>
								{:else if envio.actor?.kind === 'USER'}
									<span class="sub">Personal interno</span>
								{/if}
							</td>
							<td class="mono">{envio.vehiculo?.placa ?? '—'}</td>
							<td class="mono">{envio.businessDate ?? '—'}</td>
							<td class="mono">{fechaHora(envio.submittedAt)}</td>
							<td>
								<span class="chip chip--{envio.status.toLowerCase()}">
									{SUBMISSION_STATUS_LABELS[envio.status]}
								</span>
							</td>
							<td>
								<a class="btn btn--mini" href={`/dashboard/formularios/envios/${envio.id}`}>Ver</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if totalPages > 1}
			<nav class="paginacion" aria-label="Paginación de envíos">
				<button
					type="button"
					class="btn btn--mini"
					disabled={pagina <= 1}
					onclick={() => {
						pagina -= 1;
						void cargar();
					}}
				>
					Anterior
				</button>
				<span class="paginacion__estado">Página {pagina} de {totalPages}</span>
				<button
					type="button"
					class="btn btn--mini"
					disabled={pagina >= totalPages}
					onclick={() => {
						pagina += 1;
						void cargar();
					}}
				>
					Siguiente
				</button>
			</nav>
		{/if}
	{/if}
</div>

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.25rem 1.25rem 3rem;
	}

	.cabecera {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.migas {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.migas a {
		color: var(--emerald-700, #047857);
		text-decoration: none;
	}

	.cabecera__titulo {
		margin-top: 0.1875rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.filtros {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.filtro {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		min-width: 0;
	}

	.filtro--ancho {
		grid-column: span 2;
	}

	.filtro__label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.input {
		width: 100%;
		min-height: 40px;
		padding: 0.3125rem 0.5rem;
		font: inherit;
		font-size: 0.8125rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 8px;
	}

	.input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.conteo {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.tabla-scroll {
		overflow-x: auto;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.tabla {
		width: 100%;
		min-width: 52rem;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.tabla th {
		padding: 0.5rem 0.625rem;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
		background: var(--gray-50, #f9fafb);
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		white-space: nowrap;
	}

	.tabla td {
		padding: 0.5rem 0.625rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		vertical-align: top;
	}

	.tabla tr:last-child td {
		border-bottom: none;
	}

	.fila--anulada {
		background: #fef2f2;
	}

	.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}

	.sub {
		display: block;
		margin-top: 0.0625rem;
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.chip {
		padding: 0.125rem 0.4375rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip--submitted {
		background: #f0fdf4;
		color: #166534;
	}

	.chip--voided {
		background: #fef2f2;
		color: #991b1b;
	}

	.chip--draft {
		background: #fffbeb;
		color: #92400e;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn--mini {
		min-height: 34px;
		padding: 0 0.5625rem;
		font-size: 0.75rem;
	}

	.btn:hover:not(:disabled) {
		background: var(--gray-50, #f9fafb);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.estado {
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--text-muted, #6b6b6b);
		background: var(--bg-surface, #fff);
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 12px;
	}

	.paginacion {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}

	.paginacion__estado {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
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
		border: 0;
	}
</style>
