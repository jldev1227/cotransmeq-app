<!--
	Listado global de asignaciones.

	Es la vista operativa: qué formularios están efectivamente en la calle, contra
	qué versión y con qué audiencia. Desde el resumen de cada formulario se ven las
	suyas; aquí se ven todas juntas, que es lo que hace falta para responder «¿por
	qué a este conductor no le aparece nada?».
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { asignacionesFormularioAPI, FormApiError } from '$lib/api/formularios';
	import {
		ASSIGNMENT_STATUS_LABELS,
		FREQUENCY_LABELS,
		LIMIT_POLICY_LABELS,
		TARGET_TYPE_LABELS,
		type AssignmentDto,
		type AssignmentStatus
	} from '$lib/formularios/types';

	let asignaciones = $state<AssignmentDto[]>([]);
	let cargando = $state(true);
	let trabajando = $state(false);
	let filtroEstado = $state<AssignmentStatus | ''>('ACTIVE');
	let busqueda = $state('');
	let pagina = $state(1);
	let totalPages = $state(1);
	let total = $state(0);

	let timerBusqueda: ReturnType<typeof setTimeout> | null = null;

	async function cargar() {
		cargando = true;
		try {
			const { data, meta } = await asignacionesFormularioAPI.listar({
				page: pagina,
				limit: 25,
				status: filtroEstado || undefined,
				search: busqueda.trim() || undefined
			});
			asignaciones = data;
			total = meta.total ?? 0;
			totalPages = meta.totalPages ?? 1;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudieron cargar las asignaciones.');
		} finally {
			cargando = false;
		}
	}

	onMount(cargar);

	function onBuscar(valor: string) {
		busqueda = valor;
		pagina = 1;
		if (timerBusqueda) clearTimeout(timerBusqueda);
		timerBusqueda = setTimeout(cargar, 350);
	}

	async function cambiarEstado(a: AssignmentDto, accion: 'pausar' | 'reactivar' | 'cerrar') {
		if (
			accion === 'cerrar' &&
			!confirm(
				`Cerrar «${a.name}» es definitivo: no se puede reabrir y los conductores dejan de verla. ¿Continuar?`
			)
		)
			return;

		trabajando = true;
		try {
			if (accion === 'pausar') await asignacionesFormularioAPI.pausar(a.id);
			else if (accion === 'reactivar') await asignacionesFormularioAPI.reactivar(a.id);
			else await asignacionesFormularioAPI.cerrar(a.id);
			toast.success('Asignación actualizada.');
			await cargar();
		} catch (err) {
			if (err instanceof FormApiError) toast.error(err.message);
			else toast.error('No se pudo actualizar la asignación.');
		} finally {
			trabajando = false;
		}
	}

	function fecha(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	/** Resume la audiencia en una frase corta. */
	function audiencia(a: AssignmentDto): string {
		if (a.targets.some((t) => t.type === 'ALL_CONDUCTORS')) return 'Todos los conductores';
		const porTipo = new Map<string, number>();
		for (const t of a.targets) porTipo.set(t.type, (porTipo.get(t.type) ?? 0) + 1);
		return [...porTipo.entries()]
			.map(([tipo, n]) => `${n} ${TARGET_TYPE_LABELS[tipo as keyof typeof TARGET_TYPE_LABELS]}`)
			.join(' · ');
	}

	/// Una asignación ACTIVE con vigencia vencida no le aparece a nadie aunque su
	/// estado diga «Activa». Se señala porque es la causa más común de «el
	/// formulario no me sale».
	function vencida(a: AssignmentDto): boolean {
		return a.status === 'ACTIVE' && a.endsAt != null && new Date(a.endsAt) < new Date();
	}

	function futura(a: AssignmentDto): boolean {
		return a.status === 'ACTIVE' && a.startsAt != null && new Date(a.startsAt) > new Date();
	}
</script>

<svelte:head><title>Asignaciones de formularios · Transmeralda</title></svelte:head>

<div class="pagina">
	<header class="cabecera">
		<div>
			<nav class="migas" aria-label="Ruta">
				<a href="/dashboard/formularios">Formularios</a>
				<span aria-hidden="true">›</span>
				<span>Asignaciones</span>
			</nav>
			<h1 class="cabecera__titulo">Asignaciones</h1>
			<p class="cabecera__sub">
				Para crear una asignación, entra al formulario y elige la versión publicada.
			</p>
		</div>
	</header>

	<div class="filtros">
		<label class="filtro filtro--ancho">
			<span class="filtro__label">Buscar</span>
			<input
				class="input"
				type="search"
				placeholder="Nombre de la asignación…"
				value={busqueda}
				oninput={(e) => onBuscar(e.currentTarget.value)}
			/>
		</label>
		<label class="filtro">
			<span class="filtro__label">Estado</span>
			<select
				class="input"
				value={filtroEstado}
				onchange={(e) => {
					filtroEstado = e.currentTarget.value as AssignmentStatus | '';
					pagina = 1;
					void cargar();
				}}
			>
				<option value="">Todos</option>
				<option value="ACTIVE">Activas</option>
				<option value="PAUSED">Pausadas</option>
				<option value="CLOSED">Cerradas</option>
			</select>
		</label>
		<span class="filtro__total">{total} asignación{total === 1 ? '' : 'es'}</span>
	</div>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando…</div>
	{:else if asignaciones.length === 0}
		<div class="estado">Sin asignaciones que coincidan con los filtros.</div>
	{:else}
		<ul class="lista">
			{#each asignaciones as a (a.id)}
				<li class="item">
					<div class="item__cuerpo">
						<div class="item__titulos">
							<span class="item__code">{a.version?.code ?? '—'} v{a.version?.versionNumber}</span>
							<p class="item__nombre">{a.name}</p>
						</div>
						<p class="item__meta">
							{FREQUENCY_LABELS[a.frequency]} · {LIMIT_POLICY_LABELS[a.limitPolicy]} · {audiencia(a)}
							{#if a.submissionCount != null}
								· {a.submissionCount} envío{a.submissionCount === 1 ? '' : 's'}
							{/if}
						</p>
						<p class="item__vigencia">
							{a.startsAt ? `Desde ${fecha(a.startsAt)}` : 'Sin inicio'} ·
							{a.endsAt ? `hasta ${fecha(a.endsAt)}` : 'sin fin'} · zona {a.timezone}
						</p>

						{#if vencida(a)}
							<p class="alerta">
								Vigencia vencida: sigue marcada como activa pero ya no le aparece a nadie.
							</p>
						{:else if futura(a)}
							<p class="alerta alerta--info">
								Todavía no empieza: aparecerá a partir del {fecha(a.startsAt)}.
							</p>
						{/if}
					</div>

					<span class="chip chip--{a.status.toLowerCase()}">{ASSIGNMENT_STATUS_LABELS[a.status]}</span>

					<div class="item__acciones">
						{#if a.version}
							<a class="btn btn--mini" href={`/dashboard/formularios/${a.version.formId}`}>
								Formulario
							</a>
						{/if}
						<a class="btn btn--mini" href={`/dashboard/formularios/envios?assignmentId=${a.id}`}>
							Envíos
						</a>
						{#if a.status === 'ACTIVE'}
							<button
								type="button"
								class="btn btn--mini"
								disabled={trabajando}
								onclick={() => cambiarEstado(a, 'pausar')}
							>
								Pausar
							</button>
						{:else if a.status === 'PAUSED'}
							<button
								type="button"
								class="btn btn--mini"
								disabled={trabajando}
								onclick={() => cambiarEstado(a, 'reactivar')}
							>
								Reactivar
							</button>
						{/if}
						{#if a.status !== 'CLOSED'}
							<button
								type="button"
								class="btn btn--mini btn--peligro"
								disabled={trabajando}
								onclick={() => cambiarEstado(a, 'cerrar')}
							>
								Cerrar
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		{#if totalPages > 1}
			<nav class="paginacion" aria-label="Paginación de asignaciones">
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
		padding: 1.25rem 1rem 3rem;
		max-width: 68rem;
		margin: 0 auto;
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

	.cabecera__sub {
		margin-top: 0.1875rem;
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
	}

	.filtros {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.625rem;
		padding: 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.filtro {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		min-width: 9rem;
	}

	.filtro--ancho {
		flex: 1;
		min-width: 14rem;
	}

	.filtro__label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.filtro__total {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
		padding-bottom: 0.625rem;
	}

	.input {
		width: 100%;
		min-height: 42px;
		padding: 0.375rem 0.5rem;
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

	.lista {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		list-style: none;
	}

	.item {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
	}

	@media (min-width: 900px) {
		.item {
			grid-template-columns: 1fr auto auto;
			align-items: center;
			gap: 0.875rem;
		}
	}

	.item__titulos {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.item__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.item__nombre {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.item__meta,
	.item__vigencia {
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
		line-height: 1.45;
	}

	.item__vigencia {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.alerta {
		margin-top: 0.375rem;
		padding: 0.3125rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: #92400e;
		background: #fffbeb;
		border-left: 3px solid #f59e0b;
		border-radius: 6px;
	}

	.alerta--info {
		color: #1e40af;
		background: #eff6ff;
		border-left-color: #3b82f6;
	}

	.chip {
		align-self: flex-start;
		padding: 0.125rem 0.5rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip--active {
		background: #f0fdf4;
		color: #166534;
	}

	.chip--paused {
		background: #fffbeb;
		color: #92400e;
	}

	.chip--closed {
		background: #f3f4f6;
		color: #4b5563;
	}

	.item__acciones {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		padding: 0 0.625rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 9px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn--mini {
		min-height: 34px;
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

	.btn--peligro {
		color: #b91c1c;
	}

	.btn--peligro:hover:not(:disabled) {
		background: #fef2f2;
		border-color: #fecaca;
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
</style>
