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
		allDefinitions,
		allReceipts,
		putAssignments,
		putDefinition,
		placasCacheadas,
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
	/// Placas por id de vehículo. Es lo único que distingue dos borradores del
	/// mismo preoperacional, y viene de la caché para no depender de la red.
	let placas = $state<Record<string, string>>({});

	/**
	 * Cola visible de la descarga inicial.
	 *
	 * La primera vez hay que bajar el árbol completo de cada formulario y eso son
	 * varios segundos por datos móviles. Sin nada en pantalla el conductor cree
	 * que la app se colgó y la mata justo antes de terminar, que es el peor
	 * momento posible: se queda sin nada cacheado. En las sincronizaciones
	 * siguientes las definiciones ya están y el servidor responde 304, así que
	 * basta el rótulo general.
	 */
	interface ItemCola {
		assignmentId: string;
		code: string;
		title: string;
		estado: 'pendiente' | 'descargando' | 'listo' | 'error';
	}

	let cola = $state<ItemCola[]>([]);
	let colaVisible = $state(false);
	let temporizadorCola: ReturnType<typeof setTimeout> | null = null;

	const colaHechos = $derived(
		cola.filter((i) => i.estado === 'listo' || i.estado === 'error').length
	);
	const colaFallidos = $derived(cola.filter((i) => i.estado === 'error').length);
	const colaPorcentaje = $derived(cola.length ? Math.round((colaHechos / cola.length) * 100) : 0);

	function marcarEnCola(assignmentId: string, estado: ItemCola['estado']) {
		const item = cola.find((i) => i.assignmentId === assignmentId);
		if (item) item.estado = estado;
	}

	/// Se deja un instante con el 100 % pintado antes de ocultarla: una barra que
	/// desaparece en el mismo frame en que se llena se lee como un parpadeo raro,
	/// no como «terminó».
	function cerrarCola(demoraMs = 900) {
		if (temporizadorCola) clearTimeout(temporizadorCola);
		temporizadorCola = setTimeout(() => {
			colaVisible = false;
			cola = [];
			temporizadorCola = null;
		}, demoraMs);
	}

	/**
	 * TODOS los borradores locales de una asignación, del más reciente al más viejo.
	 *
	 * En plural a propósito: un conductor que atiende varios vehículos lleva un
	 * preoperacional por cada uno abierto a la vez. Mostrando solo el último, los
	 * demás quedaban inalcanzables —y uno atascado por fotos sin subir escondía
	 * al resto.
	 */
	function borradoresDe(assignmentId: string): StoredDraft[] {
		return borradores
			.filter((d) => d.assignmentId === assignmentId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	/** Etiqueta con la que el conductor reconoce un borrador entre varios. */
	function etiquetaBorrador(draft: StoredDraft): string {
		const vehicleId = draft.context?.vehicleId;
		if (typeof vehicleId === 'string' && placas[vehicleId]) return placas[vehicleId];
		/// Sin placa cacheada se cae a la hora de inicio: no es tan reconocible como
		/// la placa, pero distingue dos borradores del mismo día, que es lo mínimo
		/// para no tener que abrirlos a ciegas.
		return `Empezado ${fechaHora(draft.createdAt)}`;
	}

	async function cargarLocal() {
		const [a, d, r, p] = await Promise.all([
			allAssignments(),
			allDrafts(),
			allReceipts(),
			placasCacheadas()
		]);
		asignaciones = a;
		borradores = d;
		recibos = r;
		placas = p;
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
			/// Pintar ya las tarjetas: el conductor ve la lista mientras corre la
			/// descarga de definiciones, que es la parte lenta.
			await cargarLocal();

			/// Solo lo que falta va a la cola visible. Lo ya cacheado se revalida
			/// después y en silencio, porque son 304 y no hay nada que esperar.
			const cacheadas = new Set((await allDefinitions()).map((d) => d.versionId));
			const offline = data.filter((c) => c.allowOffline);
			const faltantes = offline.filter((c) => !cacheadas.has(c.versionId));
			const revalidables = offline.filter((c) => cacheadas.has(c.versionId));

			if (faltantes.length > 0) {
				if (temporizadorCola) {
					clearTimeout(temporizadorCola);
					temporizadorCola = null;
				}
				cola = faltantes.map((c) => ({
					assignmentId: c.assignmentId,
					code: c.code,
					title: c.title,
					estado: 'pendiente' as const
				}));
				colaVisible = true;
			}

			/// Precarga de definiciones. Se hace en serie y no en paralelo: son
			/// árboles grandes y diez peticiones simultáneas por datos móviles se
			/// estorban entre sí más que ayudan.
			for (const card of [...faltantes, ...revalidables]) {
				marcarEnCola(card.assignmentId, 'descargando');
				try {
					const {
						notModified,
						etag,
						data: cuerpo
					} = await portalFormulariosAPI.definicion(card.assignmentId);
					if (!notModified && cuerpo) {
						await putDefinition({
							versionId: card.versionId,
							assignmentId: card.assignmentId,
							definition: cuerpo.definition,
							etag,
							fetchedAt: new Date().toISOString()
						});
					}
					marcarEnCola(card.assignmentId, 'listo');
				} catch {
					/// Una definición que no se pudo precargar no rompe la lista: el
					/// runner la pedirá al abrirla. Se marca para que el conductor sepa
					/// cuál quedó sin guardar antes de salir a ruta.
					marcarEnCola(card.assignmentId, 'error');
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
			/// También cuando se cayó la red a mitad de la descarga: la cola no puede
			/// quedarse girando para siempre.
			if (colaVisible && !temporizadorCola) cerrarCola();
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

	onDestroy(() => {
		disconnectPortalFormsSocket();
		if (temporizadorCola) clearTimeout(temporizadorCola);
	});

	/// Un recibo nuevo (de esta pestaña o de otra) refresca la lista: la tarjeta
	/// debe pasar a «entregado» sin que el conductor recargue.
	$effect(() => {
		const evento = $receiptEvents;
		if (!evento) return;
		void cargarLocal();
		void reconciliar();
	});

	/** Reanuda un borrador concreto. */
	function abrirBorrador(assignmentId: string, clientSubmissionId: string) {
		goto(`/public/portal/formularios/${assignmentId}?draft=${clientSubmissionId}`);
	}

	/**
	 * Empieza un formulario NUEVO, aunque ya haya borradores de esa asignación.
	 *
	 * `nuevo=1` es imprescindible: sin él el runner reanuda el borrador existente
	 * y era imposible diligenciar el segundo vehículo del día.
	 */
	function empezarNuevo(assignmentId: string) {
		goto(`/public/portal/formularios/${assignmentId}?nuevo=1`);
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
			aria-label={reconciliando ? 'Sincronizando…' : 'Actualizar la lista'}
		>
			<span class="head__icono" class:girando={reconciliando} aria-hidden="true">↻</span>
		</button>
	</header>

	<SyncStatus variant="panel" />

	{#if colaVisible}
		<section class="cola" aria-live="polite">
			<div class="cola__cabeza">
				<span class="cola__icono girando" aria-hidden="true">↻</span>
				<div class="cola__texto">
					<p class="cola__titulo">Descargando tus formularios…</p>
					<p class="cola__detalle">
						{colaHechos} de {cola.length} · quedan guardados en el teléfono para diligenciarlos sin señal
					</p>
				</div>
				<span class="cola__porcentaje">{colaPorcentaje}%</span>
			</div>

			<div
				class="cola__barra"
				role="progressbar"
				aria-label="Progreso de la descarga"
				aria-valuenow={colaHechos}
				aria-valuemin="0"
				aria-valuemax={cola.length}
			>
				<div class="cola__relleno" style={`width:${colaPorcentaje}%`}></div>
			</div>

			<ul class="cola__lista">
				{#each cola as item (item.assignmentId)}
					<li class="cola__item cola__item--{item.estado}">
						<span class="cola__marca" aria-hidden="true">
							{#if item.estado === 'listo'}✓{:else if item.estado === 'error'}!{:else if item.estado === 'descargando'}<span
									class="cola__punto"
								></span>{:else}·{/if}
						</span>
						<span class="cola__nombre">{item.code} · {item.title}</span>
					</li>
				{/each}
			</ul>

			{#if colaFallidos > 0}
				<p class="cola__fallo">
					{colaFallidos} formulario{colaFallidos === 1 ? '' : 's'} no se pudo guardar para uso sin señal.
					Se intentará de nuevo; con conexión igual puedes abrirlo.
				</p>
			{/if}
		</section>
	{:else if reconciliando}
		<p class="sincronizando" aria-live="polite">
			<span class="girando" aria-hidden="true">↻</span> Sincronizando formularios…
		</p>
	{/if}

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
						{@const draftsDe = borradoresDe(a.assignmentId)}
						<li class="tarjeta">
							<div class="tarjeta__cabeza">
								<span class="tarjeta__code">{a.code}</span>
								<span class="tarjeta__titulo">{a.title}</span>
								<span class="tarjeta__meta">
									{FREQUENCY_LABELS[a.frequency as AssignmentFrequency] ?? a.frequency}
									{#if a.requiresContext.length}
										· requiere {a.requiresContext.includes('vehicleId') ? 'vehículo' : 'contexto'}
									{/if}
									{#if !a.allowOffline}· solo con conexión{/if}
								</span>
							</div>

							<!-- Un botón POR borrador. Antes la tarjeta entera era un solo botón
							     que abría «el último», así que el resto de borradores existía
							     pero no tenía dónde tocarse. -->
							{#each draftsDe as draft (draft.clientSubmissionId)}
								<button
									type="button"
									class="borrador"
									class:borrador--bloqueado={draft.blocked}
									onclick={() => abrirBorrador(a.assignmentId, draft.clientSubmissionId)}
								>
									<span class="borrador__fila">
										<span class="borrador__etiqueta">{etiquetaBorrador(draft)}</span>
										<span class="borrador__pct">{draft.progress}%</span>
									</span>
									<span class="barra" aria-hidden="true">
										<span class="barra__relleno" style={`width:${draft.progress}%`}></span>
									</span>
									<span class="borrador__meta">Guardado {fechaHora(draft.updatedAt)}</span>
									{#if draft.blocked}
										<span class="tarjeta__bloqueado">
											Necesita corrección: {draft.blocked.message}
										</span>
									{/if}
								</button>
							{/each}

							<!-- Siempre presente, haya o no borradores: es lo que permite atender
							     un segundo vehículo sin cerrar el primero. Con `ONE_PER_CONTEXT`
							     llevar varios a la vez es el caso normal, no la excepción. -->
							<button
								type="button"
								class="tarjeta__accion"
								onclick={() => empezarNuevo(a.assignmentId)}
							>
								{draftsDe.length ? 'Empezar otro →' : 'Empezar →'}
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
		opacity: 0.7;
		cursor: default;
	}

	.head__icono {
		display: block;
		line-height: 1;
	}

	/* Una sola animación para todo lo que «está trabajando»: botón, cola y
	   rótulo. Con movimiento reducido se queda quieta pero el texto ya dice lo
	   que pasa, que es lo que de verdad informa. */
	.girando {
		display: inline-block;
		animation: girar 1.1s linear infinite;
	}

	@keyframes girar {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.girando,
		.cola__punto {
			animation: none;
		}
	}

	.sincronizando {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: var(--emerald-50, #ecfdf5);
		border: 1px solid var(--emerald-200, #a7f3d0);
		border-radius: 10px;
	}

	.cola {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--emerald-200, #a7f3d0);
		border-radius: 14px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
	}

	.cola__cabeza {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.cola__icono {
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		display: grid;
		place-items: center;
		font-size: 0.9375rem;
		color: var(--emerald-700, #047857);
		background: var(--emerald-50, #ecfdf5);
		border-radius: 999px;
	}

	.cola__texto {
		flex: 1;
		min-width: 0;
	}

	.cola__titulo {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.cola__detalle {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-muted, #6b6b6b);
	}

	.cola__porcentaje {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.cola__barra {
		height: 8px;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
		overflow: hidden;
	}

	.cola__relleno {
		height: 100%;
		background: var(--emerald-500, #10b981);
		transition: width 0.25s ease;
	}

	.cola__lista {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		list-style: none;
		/* Con muchos formatos asignados la lista no puede empujar las tarjetas
		   fuera de la pantalla. */
		max-height: 9.5rem;
		overflow-y: auto;
	}

	.cola__item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text-very-muted, #9a9a9a);
	}

	.cola__item--descargando {
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.cola__item--listo {
		color: var(--text-muted, #6b6b6b);
	}

	.cola__item--error {
		color: #991b1b;
	}

	.cola__marca {
		flex-shrink: 0;
		width: 1rem;
		display: grid;
		place-items: center;
		font-weight: 700;
	}

	.cola__item--listo .cola__marca {
		color: var(--emerald-600, #059669);
	}

	.cola__punto {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--emerald-500, #10b981);
		animation: latir 1s ease-in-out infinite;
	}

	@keyframes latir {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.35;
			transform: scale(0.72);
		}
	}

	.cola__nombre {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cola__fallo {
		font-size: 0.6875rem;
		line-height: 1.4;
		color: #991b1b;
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

	/* La tarjeta ya NO es un botón: es el contenedor de N borradores más el de
	   «Empezar otro». Cuando era un botón solo cabía una acción, y esa era la
	   razón de fondo por la que no se podía llevar más de un formulario a la vez. */
	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		width: 100%;
		padding: 0.875rem;
		text-align: left;
		font: inherit;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
	}

	.tarjeta__cabeza {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
	}

	/* Un borrador. Objetivo táctil holgado: se toca en movimiento, con guantes y
	   al sol, y equivocarse abre el formulario del vehículo que no es. */
	.borrador {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		min-height: 44px;
		margin-top: 0.5rem;
		padding: 0.5rem 0.625rem;
		font: inherit;
		text-align: left;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 10px;
		cursor: pointer;
	}

	.borrador--bloqueado {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.borrador:active {
		transform: scale(0.995);
	}

	.borrador__fila {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.borrador__etiqueta {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.borrador__pct {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		color: #92400e;
	}

	.borrador__meta {
		font-size: 0.6875rem;
		color: var(--text-secondary, #4a4a4a);
	}

	.borrador:focus-visible,
	.tarjeta__accion:focus-visible {
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
		width: 100%;
		min-height: 44px;
		margin-top: 0.5rem;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 700;
		text-align: left;
		color: var(--emerald-700, #047857);
		background: var(--bg-surface, #fff);
		border: 1px dashed var(--emerald-600, #059669);
		border-radius: 10px;
		cursor: pointer;
	}

	.tarjeta__accion:active {
		transform: scale(0.995);
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
