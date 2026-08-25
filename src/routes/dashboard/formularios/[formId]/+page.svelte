<!--
	Resumen de un formulario: metadatos, historial de versiones y asignaciones.

	Es el sitio donde se toman las decisiones de ciclo de vida, y por eso cada
	acción explica su consecuencia antes de ejecutarla:

	  - **Clonar** es la única forma de "editar" una publicada. Crea un borrador con
	    ids nuevos; la publicada sigue intacta y sus envíos siguen cuadrando.
	  - **Archivar una versión** impide asignaciones y envíos nuevos, pero conserva
	    la consulta histórica. Exige cerrar antes sus asignaciones.
	  - **Duplicar el formulario** arranca uno nuevo desde este snapshot (así se
	    saca el FR-09 del FR-08, que comparten casi todo).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import {
		asignacionesFormularioAPI,
		enviosFormularioAPI,
		formulariosAPI,
		FormApiError
	} from '$lib/api/formularios';
	import {
		ASSIGNMENT_STATUS_LABELS,
		FREQUENCY_LABELS,
		LIMIT_POLICY_LABELS,
		SUBMISSION_STATUS_LABELS,
		type AssignmentDto,
		type FormDefinitionDto,
		type SubmissionSummaryDto
	} from '$lib/formularios/types';
	import AssignmentEditor from '$lib/components/formularios/AssignmentEditor.svelte';

	const formId = $derived($page.params.formId!);

	let form = $state<FormDefinitionDto | null>(null);
	let asignaciones = $state<AssignmentDto[]>([]);
	let cargando = $state(true);
	let trabajando = $state(false);
	let editorAsignacion = $state<{ versionId: string; existing?: AssignmentDto } | null>(null);

	/**
	 * Los envíos de este formato, aquí mismo.
	 *
	 * Antes había un botón a una pantalla de envíos filtrada. Un salto de página
	 * para llegar a lo que uno viene a ver —quién diligenció y qué respondió— es
	 * un salto de más: los registros son la razón de existir del formato, no un
	 * apéndice suyo.
	 */
	let envios = $state<SubmissionSummaryDto[]>([]);
	let totalEnvios = $state(0);
	let cargandoEnvios = $state(true);

	async function cargar() {
		cargando = true;
		try {
			const [definicion, lista] = await Promise.all([
				formulariosAPI.obtener(formId),
				asignacionesFormularioAPI.listar({ formId, limit: 100 })
			]);
			form = definicion;
			asignaciones = lista.data;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo cargar el formulario.');
		} finally {
			cargando = false;
		}
	}

	/**
	 * Los envíos van en su propia petición, no en el `Promise.all` de arriba.
	 *
	 * La ficha del formato tiene que pintarse aunque el listado tarde o falle: son
	 * dos consultas de coste muy distinto —una lee metadatos, la otra recorre
	 * `form_submissions`— y encadenarlas dejaría la pantalla en blanco por culpa de
	 * la lenta.
	 */
	async function cargarEnvios() {
		cargandoEnvios = true;
		try {
			const { data, meta } = await enviosFormularioAPI.listar({ formId, limit: 25 });
			envios = data;
			totalEnvios = meta?.total ?? data.length;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los envíos.');
		} finally {
			cargandoEnvios = false;
		}
	}

	function fechaHora(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	onMount(() => {
		void cargar();
		void cargarEnvios();
	});

	async function clonar(versionId: string, versionNumber: number) {
		if (
			!confirm(
				`Clonar la v${versionNumber} en un borrador nuevo? La versión actual queda intacta y sus envíos no cambian.`
			)
		)
			return;
		trabajando = true;
		try {
			const nueva = await formulariosAPI.clonarVersion(formId, versionId);
			toast.success(`Se creó el borrador v${nueva.versionNumber}.`);
			await goto(`/dashboard/formularios/${formId}/editar/${nueva.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo clonar.');
		} finally {
			trabajando = false;
		}
	}

	async function archivarVersion(versionId: string, versionNumber: number) {
		if (
			!confirm(
				`Archivar la v${versionNumber}? Dejará de admitir asignaciones y envíos nuevos; el histórico se conserva.`
			)
		)
			return;
		trabajando = true;
		try {
			await formulariosAPI.archivarVersion(formId, versionId);
			toast.success(`v${versionNumber} archivada.`);
			await cargar();
		} catch (err) {
			if (err instanceof FormApiError) toast.error(err.message);
			else toast.error('No se pudo archivar la versión.');
		} finally {
			trabajando = false;
		}
	}

	async function duplicarFormulario() {
		const code = prompt('Código HSEQ del formulario nuevo (ej.: HSEQ-FR-09)');
		if (!code?.trim()) return;
		const name = prompt('Nombre del formulario nuevo', `${form?.name} (copia)`);
		if (!name?.trim()) return;

		trabajando = true;
		try {
			const nuevo = await formulariosAPI.duplicar(formId, { code: code.trim(), name: name.trim() });
			toast.success(`${nuevo.code} creado desde este formulario.`);
			await goto(`/dashboard/formularios/${nuevo.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo duplicar.');
		} finally {
			trabajando = false;
		}
	}

	async function cambiarEstadoAsignacion(
		a: AssignmentDto,
		accion: 'pausar' | 'reactivar' | 'cerrar'
	) {
		if (
			accion === 'cerrar' &&
			!confirm('Cerrar es definitivo: la asignación no se puede reabrir. ¿Continuar?')
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
			toast.error(err instanceof Error ? err.message : 'No se pudo actualizar la asignación.');
		} finally {
			trabajando = false;
		}
	}

	function fecha(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	const versiones = $derived(form?.versions ?? []);
	const publicadas = $derived(versiones.filter((v) => v.status === 'PUBLISHED'));
</script>

<svelte:head><title>{form ? `${form.code} · Formularios` : 'Formulario'}</title></svelte:head>

<div class="pagina">
	<nav class="migas" aria-label="Ruta">
		<a href="/dashboard/formularios">Formularios</a>
		<span aria-hidden="true">›</span>
		<span>{form?.code ?? '…'}</span>
	</nav>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando…</div>
	{:else if !form}
		<div class="estado estado--error">No se encontró el formulario.</div>
	{:else}
		<header class="head">
			<div class="head__texto">
				<span class="head__code">{form.code}</span>
				<h1 class="head__titulo">{form.name}</h1>
				{#if form.description}<p class="head__desc">{form.description}</p>{/if}
				<p class="head__meta">
					Área {form.ownerArea} · slug <code>{form.slug}</code> · actualizado {fecha(
						form.updatedAt
					)}
				</p>
			</div>
			<div class="head__acciones">
				{#if form.draftVersion}
					<a
						class="btn btn--primario"
						href={`/dashboard/formularios/${formId}/editar/${form.draftVersion.id}`}
					>
						Continuar borrador v{form.draftVersion.versionNumber}
					</a>
				{:else if form.activeVersion}
					<button
						type="button"
						class="btn btn--primario"
						disabled={trabajando}
						onclick={() => clonar(form!.activeVersion!.id, form!.activeVersion!.versionNumber)}
					>
						Editar (clonar v{form!.activeVersion!.versionNumber})
					</button>
				{/if}
				<button type="button" class="btn" disabled={trabajando} onclick={duplicarFormulario}>
					Duplicar formulario
				</button>
			</div>
		</header>

		<section class="bloque">
			<h2 class="bloque__titulo">Versiones</h2>
			<ul class="versiones">
				{#each versiones as v (v.id)}
					<li class="ver">
						<div class="ver__id">
							<span class="ver__num">v{v.versionNumber}</span>
							<span class="chip chip--{v.status.toLowerCase()}">{v.status}</span>
						</div>
						<div class="ver__cuerpo">
							<p class="ver__titulo">{v.title}</p>
							<p class="ver__meta">
								revisión {v.revision} · creada {fecha(v.createdAt)}
								{#if v.publishedAt}· publicada {fecha(v.publishedAt)}{/if}
								{#if v.archivedAt}· archivada {fecha(v.archivedAt)}{/if}
							</p>
						</div>
						<div class="ver__acciones">
							<a class="btn btn--mini" href={`/dashboard/formularios/${formId}/preview/${v.id}`}>
								Preview
							</a>
							<a class="btn btn--mini" href={`/dashboard/formularios/${formId}/editar/${v.id}`}>
								{v.status === 'DRAFT' ? 'Editar' : 'Ver estructura'}
							</a>
							{#if v.status === 'PUBLISHED'}
								<button
									type="button"
									class="btn btn--mini"
									disabled={trabajando}
									onclick={() => (editorAsignacion = { versionId: v.id })}
								>
									Asignar
								</button>
								<button
									type="button"
									class="btn btn--mini"
									disabled={trabajando}
									onclick={() => clonar(v.id, v.versionNumber)}
								>
									Clonar
								</button>
								<button
									type="button"
									class="btn btn--mini btn--peligro"
									disabled={trabajando}
									onclick={() => archivarVersion(v.id, v.versionNumber)}
								>
									Archivar
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			{#if publicadas.length === 0}
				<p class="bloque__nota">
					Ninguna versión publicada todavía: los conductores no ven este formulario.
				</p>
			{/if}
		</section>

		<section class="bloque">
			<div class="bloque__head">
				<h2 class="bloque__titulo">Asignaciones</h2>
				{#if form.activeVersion}
					<button
						type="button"
						class="btn btn--mini"
						onclick={() => (editorAsignacion = { versionId: form!.activeVersion!.id })}
					>
						+ Nueva asignación
					</button>
				{/if}
			</div>

			{#if asignaciones.length === 0}
				<p class="bloque__nota">
					Sin asignaciones. Un formulario publicado sin asignar no le aparece a nadie.
				</p>
			{:else}
				<ul class="asig">
					{#each asignaciones as a (a.id)}
						<li class="asig__item">
							<div class="asig__cuerpo">
								<p class="asig__nombre">{a.name}</p>
								<p class="asig__meta">
									v{a.version?.versionNumber} · {FREQUENCY_LABELS[a.frequency]} ·
									{LIMIT_POLICY_LABELS[a.limitPolicy]} · {a.targets.length} target{a.targets
										.length === 1
										? ''
										: 's'}
									{#if a.submissionCount != null}· {a.submissionCount} envío{a.submissionCount === 1
											? ''
											: 's'}{/if}
								</p>
								<p class="asig__vigencia">
									{a.startsAt ? `Desde ${fecha(a.startsAt)}` : 'Sin fecha de inicio'}
									· {a.endsAt ? `hasta ${fecha(a.endsAt)}` : 'sin fecha de fin'}
								</p>
							</div>
							<span class="chip chip--{a.status.toLowerCase()}">
								{ASSIGNMENT_STATUS_LABELS[a.status]}
							</span>
							<div class="asig__acciones">
								<button
									type="button"
									class="btn btn--mini"
									disabled={trabajando || a.status === 'CLOSED'}
									onclick={() => (editorAsignacion = { versionId: a.versionId, existing: a })}
								>
									Editar
								</button>
								{#if a.status === 'ACTIVE'}
									<button
										type="button"
										class="btn btn--mini"
										disabled={trabajando}
										onclick={() => cambiarEstadoAsignacion(a, 'pausar')}
									>
										Pausar
									</button>
								{:else if a.status === 'PAUSED'}
									<button
										type="button"
										class="btn btn--mini"
										disabled={trabajando}
										onclick={() => cambiarEstadoAsignacion(a, 'reactivar')}
									>
										Reactivar
									</button>
								{/if}
								{#if a.status !== 'CLOSED'}
									<button
										type="button"
										class="btn btn--mini btn--peligro"
										disabled={trabajando}
										onclick={() => cambiarEstadoAsignacion(a, 'cerrar')}
									>
										Cerrar
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="bloque">
			<div class="bloque__cabeza">
				<h2 class="bloque__titulo">
					Registros diligenciados
					{#if totalEnvios > 0}<span class="cuenta">{totalEnvios}</span>{/if}
				</h2>
				{#if totalEnvios > envios.length}
					<a class="btn btn--mini" href={`/dashboard/formularios/envios?formId=${formId}`}>
						Ver los {totalEnvios} con filtros
					</a>
				{/if}
			</div>

			{#if cargandoEnvios}
				<p class="vacio" aria-busy="true">Cargando registros…</p>
			{:else if envios.length === 0}
				<p class="vacio">
					Todavía no hay envíos de este formato. Aparecerán aquí en cuanto un conductor entregue
					uno.
				</p>
			{:else}
				<!-- Filas, no tarjetas: son registros que se comparan entre sí, y una
				     rejilla alineada deja leer la columna de fecha o de placa en
				     vertical. La fila entera es el enlace al envío. -->
				<ul class="registros">
					<li class="registros__cab" aria-hidden="true">
						<span>Entregado</span>
						<span>Conductor</span>
						<span>Vehículo</span>
						<span>Versión</span>
						<span>Respuestas</span>
						<span>Estado</span>
					</li>
					{#each envios as envio (envio.id)}
						<li>
							<a class="registro" href={`/dashboard/formularios/envios/${envio.id}`}>
								<span class="registro__fecha"
									>{fechaHora(envio.submittedAt ?? envio.startedAt)}</span
								>
								<span class="registro__conductor">
									{envio.conductor?.nombre ?? '—'}
									{#if envio.conductor?.numeroIdentificacion}
										<small>{envio.conductor.numeroIdentificacion}</small>
									{/if}
								</span>
								<span class="mono">{envio.vehiculo?.placa ?? '—'}</span>
								<span class="mono">v{envio.version?.versionNumber ?? '—'}</span>
								<span class="mono">{envio.answerCount ?? '—'}</span>
								<span class="chip chip--{envio.status.toLowerCase()}">
									{SUBMISSION_STATUS_LABELS[envio.status]}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

{#if editorAsignacion}
	<!-- `{#key}` fuerza el remount: el editor siembra sus campos UNA vez desde
	     `existing`, así que reusar la instancia al cambiar de asignación mostraría
	     los datos de la anterior. -->
	{#key editorAsignacion.existing?.id ?? editorAsignacion.versionId}
		<AssignmentEditor
			versionId={editorAsignacion.versionId}
			existing={editorAsignacion.existing}
			onclose={() => (editorAsignacion = null)}
			onsaved={async () => {
				editorAsignacion = null;
				await cargar();
			}}
		/>
	{/key}
{/if}

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
		padding: 1.25rem 1.25rem 3rem;
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

	.migas a:hover {
		text-decoration: underline;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.875rem;
	}

	.head__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.head__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.2;
	}

	.head__desc {
		margin-top: 0.25rem;
		font-size: 0.875rem;
		color: var(--text-secondary, #4a4a4a);
		line-height: 1.45;
	}

	.head__meta {
		margin-top: 0.375rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.head__acciones {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.bloque {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
	}

	.bloque__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.bloque__cabeza {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.625rem;
	}

	.cuenta {
		margin-left: 0.375rem;
		padding: 0.0625rem 0.375rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--text-secondary, #4a4a4a);
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
	}

	.vacio {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary, #4a4a4a);
	}

	.mono {
		font-family: var(--font-mono, monospace);
	}

	/* Rejilla de registros. Las mismas columnas en la cabecera y en cada fila,
	   con una variable: si cambia el reparto, cambia en los dos sitios a la vez
	   y no se desalinean. */
	.registros {
		--cols: minmax(9rem, 0.9fr) minmax(11rem, 1.6fr) 6rem 4rem 6rem 7rem;
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		list-style: none;
		padding: 0;
	}

	.registros__cab,
	.registro {
		display: grid;
		grid-template-columns: var(--cols);
		align-items: center;
		gap: 0.75rem;
		padding: 0.4375rem 0.625rem;
	}

	.registros__cab {
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary, #4a4a4a);
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	/* La fila entera es el enlace: un destino táctil de una fila completa no se
	   falla, y no obliga a apuntar a un «ver» de doce píxeles. */
	.registro {
		font-size: 0.8125rem;
		color: inherit;
		text-decoration: none;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
	}

	.registro:hover {
		border-color: var(--emerald-600, #059669);
		background: var(--gray-50, #f9fafb);
	}

	.registro:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.registro__fecha {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}

	.registro__conductor {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-weight: 600;
	}

	.registro__conductor small {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 400;
		color: var(--text-secondary, #4a4a4a);
	}

	.chip--submitted {
		color: #166534;
		background: #f0fdf4;
		border-color: #bbf7d0;
	}

	.chip--voided {
		color: #991b1b;
		background: #fef2f2;
		border-color: #fecaca;
	}

	/* Por debajo de esta anchura la rejilla de seis columnas deja de caber sin
	   comprimir los nombres a dos letras: se apila. */
	@media (max-width: 860px) {
		.registros__cab {
			display: none;
		}

		.registro {
			grid-template-columns: 1fr auto;
			gap: 0.25rem 0.75rem;
		}
	}

	.bloque__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.bloque__nota {
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	.versiones,
	.asig {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
	}

	.ver,
	.asig__item {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		background: var(--gray-50, #f9fafb);
		border-radius: 10px;
	}

	@media (min-width: 800px) {
		.ver {
			grid-template-columns: 9rem 1fr auto;
			align-items: center;
		}

		.asig__item {
			grid-template-columns: 1fr auto auto;
			align-items: center;
		}
	}

	.ver__id {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.ver__num {
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		font-weight: 700;
	}

	.ver__titulo,
	.asig__nombre {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
	}

	.ver__meta,
	.asig__meta,
	.asig__vigencia {
		margin-top: 0.125rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
		line-height: 1.45;
	}

	.ver__acciones,
	.asig__acciones {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
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

	.chip--published,
	.chip--active {
		background: #f0fdf4;
		color: #166534;
	}

	.chip--draft,
	.chip--paused {
		background: #fffbeb;
		color: #92400e;
	}

	.chip--archived,
	.chip--closed {
		background: #f3f4f6;
		color: #4b5563;
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
		min-height: 36px;
		padding: 0 0.625rem;
		font-size: 0.8125rem;
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

	.btn--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
		font-weight: 600;
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
	}

	.estado--error {
		color: #b91c1c;
	}

	code {
		font-family: var(--font-mono, monospace);
	}
</style>
