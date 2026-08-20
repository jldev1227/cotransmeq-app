<!--
	Detalle inmutable de un envío.

	Se renderiza con la definición VERSIONADA que devuelve el backend junto al
	envío, no con la versión vigente del formulario. Es la diferencia entre leer lo
	que el conductor realmente contestó y leer las preguntas de hoy sobre las
	respuestas de hace un año.

	Lo único que se puede hacer aquí es ANULAR, y anular no borra: conserva las
	respuestas, exige un motivo y registra al actor en la bitácora.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import { enviosFormularioAPI, FormApiError } from '$lib/api/formularios';
	import { createRunnerState, type RunnerState } from '$lib/formularios/runner-state.svelte';
	import {
		SUBMISSION_STATUS_LABELS,
		type FormVersionDto,
		type SubmissionDetailDto
	} from '$lib/formularios/types';
	import FormRenderer from '$lib/components/formularios/FormRenderer.svelte';

	const submissionId = $derived($page.params.submissionId!);

	let envio = $state<SubmissionDetailDto | null>(null);
	let definicion = $state<FormVersionDto | null>(null);
	let runner = $state<RunnerState | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	let modalAnular = $state(false);
	let motivo = $state('');
	let anulando = $state(false);

	async function cargar() {
		cargando = true;
		try {
			const { submission, definition } = await enviosFormularioAPI.obtener(submissionId);
			envio = submission;
			definicion = definition;
			/// Las respuestas se cargan en el runner en modo lectura: el detalle usa el
			/// MISMO renderer que el portal, así que se ve exactamente como lo vio el
			/// conductor.
			runner = createRunnerState({
				sections: definition.sections,
				answers: submission.answers.map((a) => ({
					fieldId: a.fieldId,
					occurrenceId: a.occurrenceId,
					rowIndex: a.rowIndex,
					value: a.optionValues.length ? undefined : a.value,
					optionValues: a.optionValues.length ? a.optionValues : undefined
				})),
				attachments: submission.attachments.map((at) => ({
					clientAttachmentId: at.clientAttachmentId,
					fieldId: String((at.metadata as any)?.fieldId ?? ''),
					occurrenceId: (at.metadata as any)?.occurrenceId ?? null,
					kind: at.kind,
					mimeType: at.mimeType,
					byteSize: at.byteSize ?? 0
				})),
				readonly: true
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo cargar el envío.';
			toast.error(error);
		} finally {
			cargando = false;
		}
	}

	onMount(cargar);

	async function anular() {
		if (motivo.trim().length < 10) {
			toast.error('El motivo debe tener al menos 10 caracteres: queda en la auditoría.');
			return;
		}
		anulando = true;
		try {
			const { submission, definition } = await enviosFormularioAPI.anular(submissionId, motivo.trim());
			envio = submission;
			definicion = definition;
			modalAnular = false;
			motivo = '';
			toast.success('Envío anulado. Las respuestas se conservan.');
		} catch (err) {
			if (err instanceof FormApiError) toast.error(err.message);
			else toast.error('No se pudo anular el envío.');
		} finally {
			anulando = false;
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

	const adjuntosSubidos = $derived((envio?.attachments ?? []).filter((a) => a.status === 'UPLOADED'));
</script>

<svelte:head>
	<title>{envio ? `Envío ${envio.version?.code ?? ''}` : 'Envío'} · Formularios</title>
</svelte:head>

<div class="pagina">
	<nav class="migas" aria-label="Ruta">
		<a href="/dashboard/formularios">Formularios</a>
		<span aria-hidden="true">›</span>
		<a href="/dashboard/formularios/envios">Envíos</a>
		<span aria-hidden="true">›</span>
		<span>Detalle</span>
	</nav>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando el envío…</div>
	{:else if error || !envio || !definicion || !runner}
		<div class="estado estado--error">{error ?? 'No se pudo cargar el envío.'}</div>
	{:else}
		<header class="head">
			<div>
				<span class="head__code">
					{envio.version?.code ?? '—'} · v{envio.version?.versionNumber}
				</span>
				<h1 class="head__titulo">{definicion.title}</h1>
				<span class="chip chip--{envio.status.toLowerCase()}">
					{SUBMISSION_STATUS_LABELS[envio.status]}
				</span>
			</div>
			{#if envio.status === 'SUBMITTED'}
				<button type="button" class="btn btn--peligro" onclick={() => (modalAnular = true)}>
					Anular envío
				</button>
			{/if}
		</header>

		{#if envio.status === 'VOIDED'}
			<div class="anulado" role="note">
				<p class="anulado__titulo">Envío anulado el {fechaHora(envio.voidedAt)}</p>
				{#if envio.voidReason}<p class="anulado__motivo">Motivo: {envio.voidReason}</p>{/if}
				<p class="anulado__nota">
					Las respuestas se conservan íntegras. Anular no reabre el registro: una corrección es un
					envío nuevo.
				</p>
			</div>
		{/if}

		<section class="ficha">
			<dl class="ficha__lista">
				<div class="ficha__par">
					<dt>Conductor</dt>
					<dd>
						{envio.conductor?.nombre ?? '—'}
						{#if envio.conductor?.numeroIdentificacion}
							<span class="mono">({envio.conductor.numeroIdentificacion})</span>
						{/if}
					</dd>
				</div>
				<div class="ficha__par">
					<dt>Vehículo</dt>
					<dd class="mono">{envio.vehiculo?.placa ?? '—'}</dd>
				</div>
				<div class="ficha__par">
					<dt>Asignación</dt>
					<dd>{envio.assignment?.name ?? '—'}</dd>
				</div>
				<div class="ficha__par">
					<dt>Fecha de negocio</dt>
					<dd class="mono">{envio.businessDate ?? '—'}</dd>
				</div>
				<div class="ficha__par">
					<dt>Período</dt>
					<dd class="mono">{envio.periodKey ?? '—'}</dd>
				</div>
				<div class="ficha__par">
					<dt>Iniciado</dt>
					<dd class="mono">{fechaHora(envio.startedAt)}</dd>
				</div>
				<div class="ficha__par">
					<dt>Enviado</dt>
					<dd class="mono">{fechaHora(envio.submittedAt)}</dd>
				</div>
				<div class="ficha__par">
					<dt>ID del dispositivo</dt>
					<dd class="mono">{String(envio.device?.installationId ?? '—')}</dd>
				</div>
				<div class="ficha__par">
					<dt>Creado sin conexión</dt>
					<dd>{envio.device?.offlineCreated ? 'Sí' : 'No'}</dd>
				</div>
				{#if envio.supersedesSubmissionId}
					<div class="ficha__par">
						<dt>Corrige a</dt>
						<dd>
							<a href={`/dashboard/formularios/envios/${envio.supersedesSubmissionId}`}>
								envío anterior
							</a>
						</dd>
					</div>
				{/if}
			</dl>
		</section>

		<section class="bloque">
			<h2 class="bloque__titulo">Respuestas</h2>
			<div class="respuestas">
				<FormRenderer
					{runner}
					title={null}
					instructions={definicion.instructions}
					showErrorSummary={false}
				/>
			</div>
		</section>

		{#if adjuntosSubidos.length}
			<section class="bloque">
				<h2 class="bloque__titulo">Evidencia ({adjuntosSubidos.length})</h2>
				<ul class="adjuntos">
					{#each adjuntosSubidos as adjunto (adjunto.id)}
						<li class="adjunto">
							<span class="adjunto__meta">
								<span class="adjunto__kind">{adjunto.kind}</span>
								<span class="mono">
									{adjunto.mimeType} · {((adjunto.byteSize ?? 0) / 1024).toFixed(0)} KB
								</span>
								<span class="adjunto__hash mono">{adjunto.sha256.slice(0, 12)}…</span>
							</span>
							{#if adjunto.url}
								<!-- URL firmada con caducidad: se abre en pestaña nueva y NUNCA se
								     guarda en caché compartida. -->
								<a
									class="btn btn--mini"
									href={adjunto.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									Abrir
								</a>
							{:else}
								<span class="adjunto__sin">Sin URL disponible</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="bloque">
			<h2 class="bloque__titulo">Auditoría</h2>
			<ol class="eventos">
				{#each envio.events as evento (evento.id)}
					<li class="evento">
						<span class="evento__tipo">{evento.eventType}</span>
						<span class="evento__actor">{evento.actorType}</span>
						<span class="evento__fecha mono">{fechaHora(evento.createdAt)}</span>
						{#if Object.keys(evento.payload).length}
							<code class="evento__payload">{JSON.stringify(evento.payload)}</code>
						{/if}
					</li>
				{/each}
			</ol>
			{#if envio.events.length === 0}
				<p class="bloque__nota">Sin eventos registrados.</p>
			{/if}
		</section>
	{/if}
</div>

{#if modalAnular}
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="anular-titulo"
		tabindex="-1"
		onkeydown={(e) => {
			if (e.key === 'Escape') modalAnular = false;
		}}
	>
		<div class="modal__caja">
			<h2 class="modal__titulo" id="anular-titulo">Anular envío</h2>
			<p class="modal__cuerpo">
				Anular conserva todas las respuestas y adjuntos, y queda registrado con tu usuario y el
				motivo. No reabre el registro: si hay que corregirlo, el conductor debe hacer un envío nuevo.
			</p>
			<label class="campo">
				<span class="campo__label">Motivo (mínimo 10 caracteres)</span>
				<textarea
					class="input input--area"
					rows="3"
					bind:value={motivo}
					placeholder="Duplicado por reintento del dispositivo; se conserva el envío de las 06:12."
				></textarea>
			</label>
			<div class="modal__acciones">
				<button type="button" class="btn" onclick={() => (modalAnular = false)}>Cancelar</button>
				<button type="button" class="btn btn--peligro-solido" disabled={anulando} onclick={anular}>
					{anulando ? 'Anulando…' : 'Anular envío'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.25rem 1rem 3rem;
		max-width: 60rem;
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

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.head__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.head__titulo {
		margin: 0.125rem 0 0.375rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.2;
	}

	.chip {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
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

	.anulado {
		padding: 0.75rem 0.875rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 12px;
	}

	.anulado__titulo {
		font-size: 0.875rem;
		font-weight: 700;
		color: #991b1b;
	}

	.anulado__motivo {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: #b91c1c;
		line-height: 1.45;
	}

	.anulado__nota {
		margin-top: 0.375rem;
		font-size: 0.75rem;
		color: #b91c1c;
		line-height: 1.45;
	}

	.ficha,
	.bloque {
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
	}

	.ficha__lista {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.625rem 1rem;
	}

	.ficha__par dt {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.ficha__par dd {
		margin-top: 0.0625rem;
		font-size: 0.875rem;
		color: var(--text-primary, #1a1a1a);
	}

	.ficha__par dd a {
		color: var(--emerald-700, #047857);
	}

	.bloque__titulo {
		margin-bottom: 0.625rem;
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

	.respuestas {
		/* El renderer se reutiliza tal cual; los controles ya salen desactivados
		   porque el runner va en modo lectura. */
		pointer-events: none;
	}

	.adjuntos,
	.eventos {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		list-style: none;
	}

	.adjunto {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.625rem;
		background: var(--gray-50, #f9fafb);
		border-radius: 8px;
	}

	.adjunto__meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.adjunto__kind {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--emerald-700, #047857);
	}

	.adjunto__hash {
		color: var(--text-very-muted, #9a9a9a);
	}

	.adjunto__sin {
		font-size: 0.75rem;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	.evento {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.375rem 0.5rem;
		background: var(--gray-50, #f9fafb);
		border-radius: 6px;
		font-size: 0.75rem;
	}

	.evento__tipo {
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.evento__actor {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted, #6b6b6b);
	}

	.evento__fecha {
		color: var(--text-very-muted, #9a9a9a);
	}

	.evento__payload {
		flex: 1;
		min-width: 12rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
		overflow-wrap: anywhere;
	}

	.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
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

	.btn--peligro {
		color: #b91c1c;
		border-color: #fecaca;
	}

	.btn--peligro-solido {
		color: #fff;
		background: #dc2626;
		border-color: #dc2626;
		font-weight: 600;
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
	}

	.estado--error {
		color: #b91c1c;
	}

	.modal {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 31, 26, 0.45);
	}

	.modal__caja {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 28rem;
		padding: 1.125rem;
		background: var(--bg-surface, #fff);
		border-radius: 16px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
	}

	.modal__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.125rem;
		font-weight: 600;
	}

	.modal__cuerpo {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary, #4a4a4a);
	}

	.modal__acciones {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
	}

	.campo__label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.input {
		width: 100%;
		min-height: 42px;
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.875rem;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 9px;
	}

	.input--area {
		min-height: 4.5rem;
		resize: vertical;
	}

	.input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}
</style>
