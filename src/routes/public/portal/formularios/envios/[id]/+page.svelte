<!--
	Recibo de un envío.

	Sirve para dos estados distintos y por eso el `id` admite dos formas:

	  - `pendiente-<clientSubmissionId>`: el envío está en la outbox y todavía no
	    tiene id de servidor. Se muestra el recibo LOCAL, porque el conductor acaba
	    de pulsar Enviar y necesita una confirmación de que su trabajo está a salvo,
	    aunque no haya señal.
	  - un UUID: el envío ya está en el servidor y se pide el detalle completo.

	Sin el primer caso, quien envía en modo avión vería un error justo después de
	terminar dos horas de inspección.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { portalFormulariosAPI, PortalApiError } from '$lib/api/formularios-portal';
	import { getReceipt, operationsFor, type StoredReceipt } from '$lib/offline/forms-db';
	import { receiptEvents, syncState, wakeAll } from '$lib/offline/forms-sync';
	import { createRunnerState, type RunnerState } from '$lib/formularios/runner-state.svelte';
	import { fechaDeFormularioDe } from '$lib/formularios/fecha-diligenciamiento';
	import type { FormVersionDto, SubmissionDetailDto } from '$lib/formularios/types';
	import FormRenderer from '$lib/components/formularios/FormRenderer.svelte';
	import SyncStatus from '$lib/components/formularios/SyncStatus.svelte';

	const idParam = $derived($page.params.id!);
	const esPendiente = $derived(idParam.startsWith('pendiente-'));
	const clientSubmissionId = $derived(esPendiente ? idParam.slice('pendiente-'.length) : null);

	let recibo = $state<StoredReceipt | null>(null);
	let envio = $state<SubmissionDetailDto | null>(null);

	/// Cuándo se empezó el formulario. Solo la trae el envío ya sincronizado; el
	/// recibo local no guarda el contexto.
	const fechaDelFormulario = $derived(fechaDeFormularioDe(envio?.context));
	let definicion = $state<FormVersionDto | null>(null);
	let runner = $state<RunnerState | null>(null);
	let operacionesRestantes = $state(0);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	async function cargarPendiente(csid: string) {
		recibo = (await getReceipt(csid)) ?? null;
		const operaciones = await operationsFor(csid);
		operacionesRestantes = operaciones.length;

		/// Si ya llegó el recibo del servidor, se salta al detalle completo.
		if (recibo?.submissionId) await cargarServidor(recibo.submissionId);
	}

	async function cargarServidor(submissionId: string) {
		try {
			const { submission, definition } = await portalFormulariosAPI.envio(submissionId);
			envio = submission;
			definicion = definition;
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
			/// Sin red no se puede traer el detalle, pero el recibo local ya confirma
			/// el envío. No es un error que deba alarmar al conductor.
			if (err instanceof PortalApiError && (err.code === 'NETWORK_ERROR' || err.needsAuth)) return;
			throw err;
		}
	}

	async function cargar() {
		cargando = true;
		error = null;
		try {
			if (esPendiente && clientSubmissionId) await cargarPendiente(clientSubmissionId);
			else await cargarServidor(idParam);
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo cargar el recibo.';
		} finally {
			cargando = false;
		}
	}

	onMount(cargar);

	/// Cuando la outbox entrega el envío, el recibo local aparece y esta pantalla
	/// pasa de «pendiente» a «entregado» sin que el conductor recargue.
	$effect(() => {
		const evento = $receiptEvents;
		if (!evento || evento.clientSubmissionId !== clientSubmissionId) return;
		void cargar();
	});

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

	const entregado = $derived(Boolean(envio?.submittedAt || recibo?.submittedAt));
</script>

<svelte:head><title>Recibo de envío · Portal del Conductor</title></svelte:head>

<div class="pagina">
	<header class="barra">
		<a class="barra__volver" href="/public/portal/formularios" aria-label="Volver a formularios">←</a>
		<span class="barra__titulo">Recibo</span>
		<SyncStatus variant="chip" />
	</header>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando recibo…</div>
	{:else if error}
		<div class="estado estado--error">
			<p>{error}</p>
			<button type="button" class="btn" onclick={cargar}>Reintentar</button>
		</div>
	{:else}
		<!-- Bloque de confirmación. Es lo primero y lo más grande: es la razón por
		     la que el conductor entra a esta pantalla. -->
		<section
			class="sello"
			class:sello--pendiente={!entregado}
			role="status"
			aria-live="polite"
		>
			<span class="sello__icono" aria-hidden="true">{entregado ? '✓' : '↑'}</span>
			<p class="sello__titulo">
				{entregado ? 'Formulario entregado' : 'Guardado en este teléfono'}
			</p>
			<p class="sello__cuerpo">
				{#if entregado}
					El servidor confirmó la recepción. Ya no se puede editar.
				{:else if $syncState.phase === 'offline'}
					Se enviará automáticamente en cuanto haya señal. Puedes cerrar la aplicación.
				{:else if operacionesRestantes > 0}
					Enviando… quedan {operacionesRestantes} paso{operacionesRestantes === 1 ? '' : 's'}
					(la evidencia sube antes del formulario).
				{:else}
					Preparando el envío.
				{/if}
			</p>

			{#if !entregado && $syncState.phase !== 'syncing'}
				<button type="button" class="btn btn--claro" onclick={() => wakeAll()}>
					Intentar enviar ahora
				</button>
			{/if}
		</section>

		{#if recibo?.idempotentReplay}
			<p class="nota" role="note">
				Este envío ya estaba registrado en el servidor: se reconoció como el mismo y no se duplicó.
			</p>
		{/if}

		<section class="ficha">
			<dl class="ficha__lista">
				<div>
					<dt>Formulario</dt>
					<dd>
						{#if envio?.version?.code || recibo?.code}
							<span class="mono">{envio?.version?.code ?? recibo?.code}</span>
						{/if}
						{envio?.version?.title ?? recibo?.title ?? '—'}
					</dd>
				</div>
				{#if envio?.version?.versionNumber}
					<div>
						<dt>Versión</dt>
						<dd class="mono">v{envio.version.versionNumber}</dd>
					</div>
				{/if}
				<div>
					<dt>Fecha de negocio</dt>
					<dd class="mono">{envio?.businessDate ?? recibo?.businessDate ?? '—'}</dd>
				</div>
				{#if fechaDelFormulario}
					<!-- Solo si la trae: los envíos anteriores a este campo no la tienen
					     y una casilla vacía en el recibo del conductor solo confunde. -->
					<div>
						<dt>Fecha del formulario</dt>
						<dd class="mono">{fechaDelFormulario}</dd>
					</div>
				{/if}
				<div>
					<dt>Enviado</dt>
					<dd class="mono">{fechaHora(envio?.submittedAt ?? recibo?.submittedAt ?? null)}</dd>
				</div>
				{#if envio?.vehiculo?.placa}
					<div>
						<dt>Vehículo</dt>
						<dd class="mono">{envio.vehiculo.placa}</dd>
					</div>
				{/if}
				{#if envio?.id}
					<div>
						<dt>Consecutivo</dt>
						<dd class="mono mono--corto">{envio.id}</dd>
					</div>
				{/if}
			</dl>
		</section>

		{#if envio?.status === 'VOIDED'}
			<div class="anulado" role="alert">
				<p class="anulado__titulo">Este envío fue anulado por la administración</p>
				{#if envio.voidReason}<p class="anulado__motivo">{envio.voidReason}</p>{/if}
				<p class="anulado__nota">
					Tus respuestas se conservan. Si te piden rehacerlo, diligencia el formulario otra vez.
				</p>
			</div>
		{/if}

		{#if runner && definicion}
			<section class="respuestas">
				<h2 class="respuestas__titulo">Lo que enviaste</h2>
				<div class="respuestas__marco">
					<FormRenderer {runner} title={null} instructions={null} showErrorSummary={false} />
				</div>
			</section>
		{:else if !entregado}
			<p class="nota">
				El detalle completo aparecerá cuando el envío llegue al servidor.
			</p>
		{/if}

		<a class="btn btn--ancho" href="/public/portal/formularios">Volver a mis formularios</a>
	{/if}
</div>

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem 4rem;
	}

	.barra {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.barra__volver {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		font-size: 1.125rem;
		color: var(--text-secondary, #4a4a4a);
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 12px;
		text-decoration: none;
	}

	.barra__titulo {
		flex: 1;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.sello {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 1.5rem 1rem;
		text-align: center;
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		border-radius: 16px;
	}

	.sello--pendiente {
		background: #fffbeb;
		border-color: #fde68a;
	}

	.sello__icono {
		width: 3rem;
		height: 3rem;
		display: grid;
		place-items: center;
		font-size: 1.5rem;
		font-weight: 700;
		color: #166534;
		background: rgba(255, 255, 255, 0.8);
		border-radius: 999px;
	}

	.sello--pendiente .sello__icono {
		color: #92400e;
	}

	.sello__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.sello__cuerpo {
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary, #4a4a4a);
		max-width: 24rem;
	}

	.nota {
		padding: 0.625rem 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--text-muted, #6b6b6b);
		background: var(--gray-50, #f9fafb);
		border-radius: 10px;
	}

	.ficha {
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
	}

	.ficha__lista {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.625rem;
	}

	@media (min-width: 420px) {
		.ficha__lista {
			grid-template-columns: 1fr 1fr;
		}
	}

	.ficha__lista dt {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.ficha__lista dd {
		margin-top: 0.0625rem;
		font-size: 0.875rem;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.35;
	}

	.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
	}

	.mono--corto {
		font-size: 0.6875rem;
		overflow-wrap: anywhere;
	}

	.anulado {
		padding: 0.875rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 12px;
	}

	.anulado__titulo {
		font-size: 0.9375rem;
		font-weight: 700;
		color: #991b1b;
	}

	.anulado__motivo,
	.anulado__nota {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: #b91c1c;
	}

	.respuestas__titulo {
		margin-bottom: 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted, #6b6b6b);
	}

	.respuestas__marco {
		/* Solo lectura: el runner ya deshabilita los controles, y esto evita
		   cualquier interacción residual (por ejemplo el botón de ubicación). */
		pointer-events: none;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 50px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 12px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn--claro {
		margin-top: 0.5rem;
		background: rgba(255, 255, 255, 0.9);
	}

	.btn--ancho {
		width: 100%;
	}

	.btn:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.estado {
		padding: 2.5rem 1rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.estado--error {
		color: #b91c1c;
	}
</style>
