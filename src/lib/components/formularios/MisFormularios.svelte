<!--
	«Mis formularios»: lo que a MÍ me toca diligenciar, para un usuario del
	dashboard.

	Se monta desde dos sitios y por eso es un componente y no una página:

	  - `/dashboard/mis-formularios`, ruta propia con permiso `general: true`,
	    que es la que alcanza a las áreas sin acceso al constructor. Es la que de
	    verdad habilita la función.
	  - la pestaña «Mis formularios» de `/dashboard/formularios`, para quien
	    gestiona el módulo y no quiere cambiar de pantalla.

	No es el portal del conductor reescrito: aquí NO hay IndexedDB, ni outbox, ni
	socket. Un usuario de oficina está en línea, y arrastrar 1.700 líneas de
	sincronización offline a una pantalla de escritorio añadiría una fuente de
	fallos —dos identidades compartiendo la misma base local del navegador— para
	resolver un problema que aquí no existe.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { misFormulariosAPI, MisFormulariosError } from '$lib/api/mis-formularios';
	import type { PortalAssignmentCard, PortalListMeta } from '$lib/api/formularios-portal';
	import { FREQUENCY_LABELS, type AssignmentFrequency } from '$lib/formularios/types';

	interface Props {
		/** Base de las rutas del runner. La pestaña y la ruta propia comparten una. */
		base?: string;
	}

	let { base = '/dashboard/mis-formularios' }: Props = $props();

	let asignaciones = $state<PortalAssignmentCard[]>([]);
	let meta = $state<PortalListMeta | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	async function cargar() {
		try {
			const { data, meta: m } = await misFormulariosAPI.listar();
			asignaciones = data;
			meta = m;
			error = null;
		} catch (err) {
			error =
				err instanceof MisFormulariosError ? err.message : 'No se pudieron cargar tus formularios.';
		} finally {
			cargando = false;
		}
	}

	onMount(() => {
		void cargar();

		/**
		 * Refresco al volver a la pestaña.
		 *
		 * Sustituye al socket del portal, cuyo gateway solo admite rooms de
		 * conductor. Cubre el caso real —HSEQ asigna algo mientras la pantalla
		 * está abierta en otra pestaña— sin abrir una segunda conexión ni
		 * sondear en bucle.
		 */
		function alVolver() {
			if (document.visibilityState === 'visible') void cargar();
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => document.removeEventListener('visibilitychange', alVolver);
	});

	/// `AVAILABLE` arriba: es lo accionable. El resto son tarjetas de consulta.
	const disponibles = $derived(asignaciones.filter((a) => a.dueState === 'AVAILABLE'));
	const completados = $derived(asignaciones.filter((a) => a.dueState !== 'AVAILABLE'));

	function etiquetaFrecuencia(f: string): string {
		return FREQUENCY_LABELS[f as AssignmentFrequency] ?? f;
	}

	function haceCuanto(iso: string): string {
		const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
		if (minutos < 1) return 'hace un momento';
		if (minutos < 60) return `hace ${minutos} min`;
		const horas = Math.round(minutos / 60);
		if (horas < 24) return `hace ${horas} h`;
		return `hace ${Math.round(horas / 24)} d`;
	}
</script>

<section class="mis">
	{#if cargando}
		<p class="estado">Cargando tus formularios…</p>
	{:else if error}
		<p class="estado estado--error">{error}</p>
		<button type="button" class="btn" onclick={() => void cargar()}>Reintentar</button>
	{:else if asignaciones.length === 0}
		<!--
			Mensaje explícito sobre el porqué: la causa casi siempre es que la
			asignación no incluye su área, no que el módulo esté vacío. Decir solo
			«no hay nada» mandaría a la persona a preguntar por soporte.
		-->
		<p class="estado">
			No tienes formularios asignados. Aparecen aquí cuando alguien de HSEQ o
			administración crea una asignación que alcanza a tu área, tu cargo o a ti.
		</p>
	{:else}
		{#if meta}
			<p class="resumen">
				{meta.pending} por diligenciar · {meta.drafts} en borrador · al {meta.today}
			</p>
		{/if}

		{#if disponibles.length}
			<ul class="tarjetas">
				{#each disponibles as a (a.assignmentId)}
					<li class="tarjeta">
						<div class="tarjeta__cabeza">
							<span class="tarjeta__code">{a.code}</span>
							<span class="tarjeta__titulo">{a.title}</span>
							<span class="tarjeta__meta">
								{etiquetaFrecuencia(a.frequency)}
								{#if a.requiresContext.length}· pide {a.requiresContext.join(', ')}{/if}
							</span>
						</div>

						<!--
							Un botón POR borrador, igual que en el portal: con
							`ONE_PER_CONTEXT` es normal llevar varios abiertos a la vez, y
							ofrecer solo el último dejaba el resto inalcanzable.
						-->
						{#if a.drafts.length}
							<ul class="borradores">
								{#each a.drafts as d (d.clientSubmissionId)}
									<li>
										<a class="borrador" href="{base}/{a.assignmentId}?draft={d.clientSubmissionId}">
											Continuar borrador · {d.progress}% · {haceCuanto(d.updatedAt)}
										</a>
									</li>
								{/each}
							</ul>
						{/if}

						<a class="tarjeta__accion" href="{base}/{a.assignmentId}?nuevo=1">
							{a.drafts.length ? 'Empezar otro' : 'Diligenciar'}
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if completados.length}
			<h3 class="subtitulo">Ya completados en este período</h3>
			<ul class="tarjetas">
				{#each completados as a (a.assignmentId)}
					<li class="tarjeta tarjeta--hecha">
						<span class="tarjeta__code">{a.code}</span>
						<span class="tarjeta__titulo">{a.title}</span>
						<span class="tarjeta__meta">{etiquetaFrecuencia(a.frequency)}</span>
						<span class="tarjeta__badge">✓ {a.submittedThisPeriod}</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.mis {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.estado {
		margin: 0;
		padding: 1.5rem 0;
		max-width: 46rem;
		color: var(--text-muted, #64748b);
	}

	.estado--error {
		color: var(--red-600, #dc2626);
	}

	.resumen {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted, #64748b);
	}

	.subtitulo {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted, #64748b);
	}

	.tarjetas {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 12px;
	}

	.tarjeta--hecha {
		opacity: 0.75;
	}

	.tarjeta__cabeza {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.tarjeta__code {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--emerald-700, #047857);
	}

	.tarjeta__titulo {
		font-weight: 600;
		line-height: 1.3;
	}

	.tarjeta__meta {
		font-size: 0.75rem;
		color: var(--text-muted, #64748b);
	}

	.borradores {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.borrador,
	.tarjeta__accion {
		display: block;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 500;
		text-align: center;
		text-decoration: none;
		border-radius: 8px;
	}

	.borrador {
		color: var(--amber-800, #92400e);
		background: #fffbeb;
		border: 1px solid #fde68a;
	}

	.tarjeta__accion {
		margin-top: auto;
		color: #fff;
		background: var(--emerald-600, #059669);
	}

	.tarjeta__badge {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
	}

	.btn {
		align-self: flex-start;
		min-height: 36px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.8rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
		cursor: pointer;
	}
</style>
