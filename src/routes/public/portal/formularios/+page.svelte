<!--
	Lista de formularios del conductor.

	Abre SIEMPRE, con o sin señal: primero pinta lo que hay en IndexedDB y después
	reconcilia con el servidor. Al contrario —esperar la red para pintar— dejaría
	al conductor mirando un spinner en un patio sin cobertura, que es justo donde
	se diligencia un preoperacional.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { portalFormulariosAPI, PortalApiError } from '$lib/api/formularios-portal';
	import {
		allDrafts,
		allAssignments,
		allReceipts,
		putAssignments,
		putDefinition,
		pruneDefinitions,
		quotaInfo,
		type StoredAssignment,
		type StoredDraft,
		type StoredReceipt
	} from '$lib/offline/forms-db';
	import { receiptEvents, startSync, syncState, wakeAll } from '$lib/offline/forms-sync';
	import {
		connectPortalFormsSocket,
		disconnectPortalFormsSocket
	} from '$lib/offline/forms-portal-socket';
	import { FREQUENCY_LABELS, type AssignmentFrequency } from '$lib/formularios/types';
	import SyncStatus from '$lib/components/formularios/SyncStatus.svelte';

	let asignaciones = $state<StoredAssignment[]>([]);
	let borradores = $state<StoredDraft[]>([]);
	let recibos = $state<StoredReceipt[]>([]);
	let cargandoLocal = $state(true);
	let reconciliando = $state(false);
	let hoy = $state<string | null>(null);
	let avisoCuota = $state<string | null>(null);

	/** Borrador local de una asignación, si hay. */
	function borradorDe(assignmentId: string): StoredDraft | undefined {
		return borradores
			.filter((d) => d.assignmentId === assignmentId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
	}

	async function cargarLocal() {
		const [a, d, r] = await Promise.all([allAssignments(), allDrafts(), allReceipts()]);
		asignaciones = a;
		borradores = d;
		recibos = r;
		cargandoLocal = false;
	}

	/**
	 * Reconcilia con el servidor.
	 *
	 * El GET es la autoridad final, tal como dice el contrato: los eventos de
	 * socket solo invalidan y esto es lo que decide. Se cachean también las
	 * definiciones de lo que permite offline, porque si no el conductor no podría
	 * abrir el formulario sin señal.
	 */
	async function reconciliar() {
		if (reconciliando) return;
		reconciliando = true;
		try {
			const { data, meta } = await portalFormulariosAPI.listar();
			hoy = meta?.today ?? null;

			const registros: StoredAssignment[] = data.map((card) => ({
				assignmentId: card.assignmentId,
				formId: card.formId,
				versionId: card.versionId,
				code: card.code,
				title: card.title,
				name: card.name,
				frequency: card.frequency,
				limitPolicy: card.limitPolicy,
				dueState: card.dueState,
				submittedThisPeriod: card.submittedThisPeriod,
				periodKey: card.periodKey,
				businessDate: card.businessDate,
				allowOffline: card.allowOffline,
				requiresContext: card.requiresContext,
				revision: card.revision,
				cachedAt: new Date().toISOString()
			}));
			await putAssignments(registros);

			/// Precarga de definiciones. Se hace en serie y no en paralelo: son
			/// árboles grandes y diez peticiones simultáneas por datos móviles se
			/// estorban entre sí más que ayudan.
			for (const card of data) {
				if (!card.allowOffline) continue;
				try {
					const { notModified, etag, data: cuerpo } = await portalFormulariosAPI.definicion(
						card.assignmentId
					);
					if (notModified || !cuerpo) continue;
					await putDefinition({
						versionId: card.versionId,
						assignmentId: card.assignmentId,
						definition: cuerpo.definition,
						etag,
						fetchedAt: new Date().toISOString()
					});
				} catch {
					/// Una definición que no se pudo precargar no rompe la lista: el
					/// runner la pedirá al abrirla.
				}
			}

			await pruneDefinitions(data.map((c) => c.versionId));
			await cargarLocal();
		} catch (err) {
			if (err instanceof PortalApiError && err.needsAuth) {
				toast.error('Tu sesión venció. Solicita un enlace nuevo; tus datos están a salvo.');
			} else if (err instanceof PortalApiError && err.code === 'NETWORK_ERROR') {
				/// Silencio deliberado: la lista local ya está en pantalla y el chip de
				/// sincronización comunica el estado. Un toast por cada fallo de red
				/// sería ruido constante en ruta.
			} else {
				toast.error(err instanceof Error ? err.message : 'No se pudo actualizar la lista.');
			}
		} finally {
			reconciliando = false;
		}
	}

	onMount(async () => {
		await cargarLocal();
		await startSync();
		void reconciliar();

		/// El socket solo ACELERA: cada aviso se traduce en volver a pedir el GET,
		/// que es la autoridad. Los payloads llevan ids, no datos.
		connectPortalFormsSocket({
			onInvalidateList: () => void reconciliar(),
			onSubmissionChanged: () => void cargarLocal()
		});

		const info = await quotaInfo();
		if (info.ratio != null && info.ratio > 0.85) {
			avisoCuota =
				'El almacenamiento del teléfono está casi lleno. Envía los formularios pendientes para liberar espacio antes de tomar más fotos.';
		}
	});

	onDestroy(() => disconnectPortalFormsSocket());

	/// Un recibo nuevo (de esta pestaña o de otra) refresca la lista: la tarjeta
	/// debe pasar a «entregado» sin que el conductor recargue.
	$effect(() => {
		const evento = $receiptEvents;
		if (!evento) return;
		void cargarLocal();
		void reconciliar();
	});

	function abrir(a: StoredAssignment) {
		const draft = borradorDe(a.assignmentId);
		const query = draft ? `?draft=${draft.clientSubmissionId}` : '';
		goto(`/public/portal/formularios/${a.assignmentId}${query}`);
	}

	function fechaHora(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	const disponibles = $derived(asignaciones.filter((a) => a.dueState === 'AVAILABLE'));
	const completados = $derived(asignaciones.filter((a) => a.dueState !== 'AVAILABLE'));
	const recibosRecientes = $derived(
		[...recibos].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 8)
	);
</script>

<svelte:head><title>Formularios · Portal del Conductor</title></svelte:head>

<div class="pagina">
	<header class="head">
		<div>
			<h1 class="head__titulo">Formularios</h1>
			{#if hoy}<p class="head__fecha">Hoy: {hoy}</p>{/if}
		</div>
		<button
			type="button"
			class="head__refrescar"
			disabled={reconciliando}
			onclick={() => {
				void reconciliar();
				wakeAll();
			}}
			aria-label="Actualizar la lista"
		>
			{reconciliando ? '↻…' : '↻'}
		</button>
	</header>

	<SyncStatus variant="panel" />

	{#if avisoCuota}
		<p class="aviso" role="alert">{avisoCuota}</p>
	{/if}

	{#if cargandoLocal}
		<div class="estado" aria-busy="true">Cargando…</div>
	{:else if asignaciones.length === 0}
		<div class="estado">
			<p class="estado__t">No tienes formularios asignados</p>
			<p class="estado__d">
				{$syncState.phase === 'offline'
					? 'Estás sin conexión y este teléfono no tiene formularios guardados. Conéctate una vez para descargarlos.'
					: 'Cuando HSEQ te asigne un formato, aparecerá aquí.'}
			</p>
		</div>
	{:else}
		{#if disponibles.length}
			<section class="grupo">
				<h2 class="grupo__titulo">Por diligenciar</h2>
				<ul class="tarjetas">
					{#each disponibles as a (a.assignmentId)}
						{@const draft = borradorDe(a.assignmentId)}
						<li>
							<button type="button" class="tarjeta" onclick={() => abrir(a)}>
								<span class="tarjeta__code">{a.code}</span>
								<span class="tarjeta__titulo">{a.title}</span>
								<span class="tarjeta__meta">
									{FREQUENCY_LABELS[a.frequency as AssignmentFrequency] ?? a.frequency}
									{#if a.requiresContext.length}
										· requiere {a.requiresContext.includes('vehicleId') ? 'vehículo' : 'contexto'}
									{/if}
									{#if !a.allowOffline}· solo con conexión{/if}
								</span>

								{#if draft}
									<span class="tarjeta__draft">
										<span class="barra" aria-hidden="true">
											<span class="barra__relleno" style={`width:${draft.progress}%`}></span>
										</span>
										<span class="tarjeta__draft-texto">
											Empezado · {draft.progress}% · {fechaHora(draft.updatedAt)}
										</span>
									</span>
									{#if draft.blocked}
										<span class="tarjeta__bloqueado">
											Necesita corrección: {draft.blocked.message}
										</span>
									{/if}
								{:else}
									<span class="tarjeta__accion">Empezar →</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if completados.length}
			<section class="grupo">
				<h2 class="grupo__titulo">Ya entregados en este período</h2>
				<ul class="tarjetas">
					{#each completados as a (a.assignmentId)}
						<li>
							<div class="tarjeta tarjeta--hecha">
								<span class="tarjeta__code">{a.code}</span>
								<span class="tarjeta__titulo">{a.title}</span>
								<span class="tarjeta__meta">
									{a.submittedThisPeriod} entregado{a.submittedThisPeriod === 1 ? '' : 's'}
									{#if a.periodKey}· período {a.periodKey}{/if}
								</span>
								<span class="tarjeta__hecha-badge">✓ Completo</span>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}

	{#if recibosRecientes.length}
		<section class="grupo">
			<h2 class="grupo__titulo">Últimos envíos</h2>
			<ul class="recibos">
				{#each recibosRecientes as recibo (recibo.clientSubmissionId)}
					<li>
						<a class="recibo" href={`/public/portal/formularios/envios/${recibo.submissionId}`}>
							<span class="recibo__code">{recibo.code || 'Formulario'}</span>
							<span class="recibo__titulo">{recibo.title}</span>
							<span class="recibo__fecha">{fechaHora(recibo.submittedAt)}</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 0.875rem 5rem;
		max-width: 34rem;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.head__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.head__fecha {
		margin-top: 0.125rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.head__refrescar {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 1.125rem;
		color: var(--text-secondary, #4a4a4a);
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 12px;
		cursor: pointer;
	}

	.head__refrescar:disabled {
		opacity: 0.5;
	}

	.aviso {
		padding: 0.625rem 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 10px;
	}

	.grupo {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.grupo__titulo {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted, #6b6b6b);
	}

	.tarjetas,
	.recibos {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
	}

	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		width: 100%;
		/* 44 px de alto mínimo por objetivo táctil; en la práctica son más. */
		min-height: 44px;
		padding: 0.875rem;
		text-align: left;
		font: inherit;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
		cursor: pointer;
	}

	.tarjeta:active {
		transform: scale(0.995);
	}

	.tarjeta:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.tarjeta--hecha {
		cursor: default;
		background: var(--gray-50, #f9fafb);
		box-shadow: none;
	}

	.tarjeta__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.tarjeta__titulo {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.3;
	}

	.tarjeta__meta {
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
		line-height: 1.4;
	}

	.tarjeta__accion {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
	}

	.tarjeta__draft {
		margin-top: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.barra {
		display: block;
		height: 6px;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
		overflow: hidden;
	}

	.barra__relleno {
		display: block;
		height: 100%;
		background: var(--emerald-500, #10b981);
	}

	.tarjeta__draft-texto {
		font-size: 0.6875rem;
		font-weight: 600;
		color: #92400e;
	}

	.tarjeta__bloqueado {
		margin-top: 0.375rem;
		padding: 0.375rem 0.5rem;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: #991b1b;
		background: #fef2f2;
		border-radius: 8px;
	}

	.tarjeta__hecha-badge {
		margin-top: 0.375rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: #166534;
	}

	.recibo {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.625rem 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
		text-decoration: none;
		min-height: 44px;
	}

	.recibo__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.recibo__titulo {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
	}

	.recibo__fecha {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.estado {
		padding: 2rem 1rem;
		text-align: center;
		background: var(--bg-surface, #fff);
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 14px;
	}

	.estado__t {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.estado__d {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-very-muted, #9a9a9a);
	}
</style>
