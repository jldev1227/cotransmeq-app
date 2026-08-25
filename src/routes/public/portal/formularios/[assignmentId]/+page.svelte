<!--
	Runner del formulario. Es la pantalla donde el conductor diligencia.

	Cómo se comporta, y por qué:

	  - **Carga primero de IndexedDB.** Si la definición está cacheada, abre sin
	    red. Después revalida con ETag; un `304` no descarga nada.
	  - **Guarda cada 250 ms en local.** Es lo que hace que cerrar la app o quedarse
	    sin batería no cueste una inspección.
	  - **El backup al servidor va por la outbox**, nunca en línea con la captura:
	    escribir no puede depender de que haya señal.
	  - **Al enviar no se hace un POST directo.** Se encola en la outbox y se
	    navega al recibo. Así el conductor puede cerrar la app inmediatamente y el
	    envío sale igual cuando haya red.
	  - **Cambiar el vehículo pide confirmación** antes de limpiar las respuestas
	    que dependían de él: arrastrarlas produciría un preoperacional con datos de
	    otro vehículo.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import { portalFormulariosAPI, PortalApiError } from '$lib/api/formularios-portal';
	import {
		attachmentsForSubmission,
		deleteAttachment,
		draftAttachmentBytes,
		getAssignment,
		getAttachment,
		getDefinition,
		getDraft,
		draftsForAssignment,
		guardarPlacas,
		putAttachment,
		putDefinition,
		putDraft,
		requestPersistence,
		type StoredAttachment,
		type StoredDraft
	} from '$lib/offline/forms-db';
	import {
		encolarBackup,
		encolarDescarte,
		encolarEnvio,
		reintentarBloqueado,
		startSync
	} from '$lib/offline/forms-sync';
	import { createRunnerState, type RunnerState } from '$lib/formularios/runner-state.svelte';
	import { computeProgress } from '$lib/formularios/validate-answers';
	import type { FormVersionDto } from '$lib/formularios/types';
	import type { PreparedMedia } from '$lib/offline/forms-media';
	import { ordenarPorEtiqueta } from '$lib/utils/ordenarOpciones';
	import FormRenderer from '$lib/components/formularios/FormRenderer.svelte';
	import EvidenceCapture from '$lib/components/formularios/EvidenceCapture.svelte';
	import SyncStatus from '$lib/components/formularios/SyncStatus.svelte';
	/// El mismo buscador de placas del modal de días laborados. Un desplegable
	/// nativo obliga a recorrer toda la flota con el pulgar; aquí el conductor
	/// teclea tres letras de su placa y listo.
	import Autocomplete from '$lib/components/Autocomplete.svelte';

	const assignmentId = $derived($page.params.assignmentId!);

	/// Debounce de 250 ms para el guardado LOCAL: suficientemente corto para que un
	/// cierre inesperado cueste media palabra, y suficientemente largo para no
	/// escribir en IndexedDB en cada tecla.
	const AUTOSAVE_LOCAL_MS = 250;
	/// Backup al servidor cada 30 s como máximo, y solo mediante la outbox.
	const BACKUP_MS = 30_000;

	let definicion = $state<FormVersionDto | null>(null);
	let contextoRequerido = $state<string[]>([]);
	let titulo = $state('');
	let codigo = $state('');
	let permiteOffline = $state(true);

	let clientSubmissionId = $state<string>('');
	let contexto = $state<Record<string, unknown>>({});
	let runner = $state<RunnerState | null>(null);
	let adjuntos = $state<StoredAttachment[]>([]);
	let bytesAdjuntos = $state(0);
	let bloqueo = $state<StoredDraft['blocked'] | null>(null);

	let cargando = $state(true);
	let error = $state<string | null>(null);
	let enviando = $state(false);
	let vehiculos = $state<{ id: string; placa: string }[]>([]);

	let timerLocal: ReturnType<typeof setTimeout> | null = null;
	let timerBackup: ReturnType<typeof setInterval> | null = null;
	let pidioPersistencia = false;

	// ── Carga ────────────────────────────────────────────────────────────────

	onMount(async () => {
		await startSync();
		try {
			await cargar();
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo abrir el formulario.';
		} finally {
			cargando = false;
		}

		timerBackup = setInterval(() => {
			if (clientSubmissionId) encolarBackup(clientSubmissionId).catch(reportar);
		}, BACKUP_MS);
	});

	/// La limpieza va en `onDestroy` y no en el retorno de `onMount`: un `onMount`
	/// asíncrono devuelve una promesa, y Svelte no la trata como función de
	/// limpieza — los temporizadores sobrevivirían a la navegación.
	onDestroy(() => {
		if (timerLocal) clearTimeout(timerLocal);
		if (timerBackup) clearInterval(timerBackup);
	});

	async function cargar() {
		const asignacionLocal = await getAssignment(assignmentId);
		if (asignacionLocal) {
			titulo = asignacionLocal.title;
			codigo = asignacionLocal.code;
			contextoRequerido = asignacionLocal.requiresContext;
			permiteOffline = asignacionLocal.allowOffline;

			/// Primero lo cacheado: la pantalla se pinta sin esperar la red.
			const cacheada = await getDefinition(asignacionLocal.versionId);
			if (cacheada) definicion = cacheada.definition;
		}

		/// Revalidación. Si falla y ya hay definición cacheada, se sigue sin ella:
		/// es exactamente el caso «modo avión» que el módulo tiene que soportar.
		try {
			const cacheada = asignacionLocal ? await getDefinition(asignacionLocal.versionId) : undefined;
			const respuesta = await portalFormulariosAPI.definicion(assignmentId, cacheada?.etag);
			if (!respuesta.notModified && respuesta.data) {
				definicion = respuesta.data.definition;
				titulo = respuesta.data.definition.title;
				contextoRequerido = Object.entries(respuesta.data.assignment.contextSchema ?? {})
					.filter(([, v]) => v?.required)
					.map(([k]) => k);
				permiteOffline = respuesta.data.assignment.settings?.allowOffline !== false;
				await putDefinition({
					versionId: respuesta.data.definition.id,
					assignmentId,
					definition: respuesta.data.definition,
					etag: respuesta.etag,
					fetchedAt: new Date().toISOString()
				});
			}
		} catch (err) {
			if (!definicion) {
				if (err instanceof PortalApiError && err.needsAuth) {
					throw new Error('Tu sesión venció. Solicita un enlace nuevo para continuar.');
				}
				if (err instanceof PortalApiError && err.code === 'NETWORK_ERROR') {
					throw new Error(
						'Este formulario no está guardado en el teléfono y no hay conexión. Conéctate una vez para descargarlo.'
					);
				}
				throw err;
			}
		}

		if (!definicion) throw new Error('No se pudo obtener la definición del formulario.');

		// ── Borrador: reanudar el existente o crear uno nuevo ──────────────────
		//
		// Se busca en DOS sitios, y el segundo no es un lujo: es lo que hace que
		// recargar la página no pierda el trabajo.
		//
		//  1. `?draft=<id>` — lo añade la lista del portal al abrir una tarjeta con
		//     borrador. Identifica UNO concreto, que es lo que hace falta cuando el
		//     conductor tiene varios de la misma asignación (con `ONE_PER_CONTEXT`
		//     puede llevar uno por vehículo).
		//  2. Si no viene el parámetro, se busca por asignación. Recargar la URL del
		//     runner, volver desde el historial o compartir el enlace no llevan el
		//     parámetro, y sin este respaldo cada recarga empezaba de cero con un
		//     `clientSubmissionId` nuevo, dejando lo diligenciado huérfano en
		//     IndexedDB. Era el fallo que hacía parecer que el guardado local no
		//     funcionaba.
		//  3. `?nuevo=1` — lo añade el botón «Empezar otro» de la lista. Salta la
		//     reanudación por completo: es la ÚNICA forma de abrir un segundo
		//     formulario de la misma asignación, y sin él un conductor con un
		//     preoperacional a medias no podía empezar el del siguiente vehículo.
		const forzarNuevo = $page.url.searchParams.get('nuevo') === '1';
		const draftParam = $page.url.searchParams.get('draft');
		let existente = forzarNuevo ? undefined : draftParam ? await getDraft(draftParam) : undefined;

		if (!existente && !forzarNuevo) {
			/**
			 * Se prefiere el que TIENE contenido, y solo después el más reciente.
			 *
			 * «El más reciente» a secas es una trampa: cada recarga sin `?draft=`
			 * creaba un borrador vacío con fecha nueva, así que el vacío recién hecho
			 * le ganaba al que llevaba el trabajo de verdad. Ordenar primero por
			 * «tiene respuestas» recupera lo diligenciado incluso cuando ya quedaron
			 * vacíos sueltos de antes del arreglo.
			 */
			const candidatos = await draftsForAssignment(assignmentId);
			existente = candidatos.sort((a, b) => {
				const contenidoA = (a.answers?.length ?? 0) > 0 ? 1 : 0;
				const contenidoB = (b.answers?.length ?? 0) > 0 ? 1 : 0;
				if (contenidoA !== contenidoB) return contenidoB - contenidoA;
				return b.updatedAt.localeCompare(a.updatedAt);
			})[0];
		}

		if (existente && existente.assignmentId === assignmentId) {
			clientSubmissionId = existente.clientSubmissionId;
			contexto = { ...existente.context };
			bloqueo = existente.blocked ?? null;
			runner = createRunnerState({ sections: definicion.sections, answers: existente.answers });

			/// Se fija el `?draft=` en la URL sin añadir entrada al historial. Así una
			/// recarga posterior, o compartir el enlace, apunta a ESTE borrador y no
			/// depende de volver a resolver «el más reciente».
			if (draftParam !== clientSubmissionId) {
				const url = new URL($page.url);
				url.searchParams.set('draft', clientSubmissionId);
				history.replaceState(history.state, '', url);
			}
		} else {
			/// El id se genera AQUÍ, antes de escribir nada: es la clave de
			/// idempotencia del envío y el servidor la usa para deduplicar reintentos.
			clientSubmissionId = crypto.randomUUID();
			runner = createRunnerState({ sections: definicion.sections });
			runner.seedMinRows();
			await guardarLocal();

			/// Igual que arriba: la URL identifica el borrador desde el primer
			/// instante, así que una recarga inmediata reanuda este y no crea otro.
			/// Y se RETIRA `nuevo`: si se quedara, cada recarga crearía otro borrador
			/// vacío y el conductor iría dejando un rastro de formularios en blanco.
			const url = new URL($page.url);
			url.searchParams.set('draft', clientSubmissionId);
			url.searchParams.delete('nuevo');
			history.replaceState(history.state, '', url);
		}

		await refrescarAdjuntos();
		await cargarVehiculos();
	}

	/**
	 * Vehículos para el contexto.
	 *
	 * Solo se piden si la asignación exige `vehicleId`. Falla en silencio: sin red
	 * el conductor puede escribir la placa a mano, y bloquear el formulario por no
	 * poder cargar un desplegable sería absurdo en un patio sin cobertura.
	 *
	 * Va por `portalFormulariosAPI`, no por `apiClient`: aquel usa el token del
	 * magic link, este el JWT del dashboard —que el conductor no tiene— y su
	 * interceptor redirige a `/login` en el 401, tirando el borrador abierto.
	 */
	async function cargarVehiculos() {
		if (!contextoRequerido.includes('vehicleId')) return;
		try {
			const lista = await portalFormulariosAPI.listarVehiculos();
			/// Ordenado por placa: el backend las devuelve en orden de creación y el
			/// conductor busca la suya alfabéticamente, no por antigüedad del registro.
			vehiculos = ordenarPorEtiqueta(
				lista.map((v) => ({ id: v.id, placa: v.placa })).filter((v) => v.id && v.placa),
				(v) => v.placa
			);
			/// Se cachean para la LISTA, que debe abrir sin señal: allí un borrador se
			/// identifica por su placa, y pedir el catálogo al pintarla rompería el
			/// modo sin conexión.
			await guardarPlacas(vehiculos);
		} catch {
			vehiculos = [];
		}
	}

	/// Forma que espera el buscador: `label` es lo que filtra al teclear, y aquí
	/// lo que el conductor teclea es la placa.
	const vehiculoOptions = $derived(
		vehiculos.map((v) => ({ id: v.id, label: v.placa, placa: v.placa }))
	);

	async function refrescarAdjuntos() {
		if (!clientSubmissionId) return;
		adjuntos = await attachmentsForSubmission(clientSubmissionId);
		bytesAdjuntos = await draftAttachmentBytes(clientSubmissionId);
		/// El runner necesita conocerlos para validar `required` de evidencia.
		if (runner) {
			for (const adjunto of adjuntos) {
				const yaEsta = runner
					.attachmentsOf(adjunto.fieldId, adjunto.occurrenceId)
					.some((a) => a.clientAttachmentId === adjunto.clientAttachmentId);
				if (yaEsta) continue;
				runner.addAttachment({
					clientAttachmentId: adjunto.clientAttachmentId,
					fieldId: adjunto.fieldId,
					occurrenceId: adjunto.occurrenceId,
					kind: adjunto.kind,
					mimeType: adjunto.mimeType,
					byteSize: adjunto.byteSize
				});
			}
		}
	}

	// ── Guardado local ───────────────────────────────────────────────────────

	async function guardarLocal() {
		if (!runner || !definicion || !clientSubmissionId) return;
		await putDraft({
			clientSubmissionId,
			assignmentId,
			versionId: definicion.id,
			/// `$state.snapshot` obligatorio: `contexto` es un `$state` y por tanto un
			/// Proxy, que el clonado estructurado de IndexedDB rechaza con
			/// `DataCloneError`. Las respuestas ya vienen planas de
			/// `toPayloadAnswers()`.
			context: $state.snapshot(contexto),
			answers: runner.toPayloadAnswers(),
			progress: computeProgress(runner.validation),
			createdAt: new Date().toISOString(),
			...(bloqueo ? { blocked: bloqueo } : {})
		});
	}

	/**
	 * Registra un fallo de fondo sin tirar la pantalla.
	 *
	 * El autosave y el backup corren en temporizadores, así que un `void` dejaba el
	 * rechazo sin manejar y salía como «Uncaught (in promise)» en consola: ruido
	 * para quien depura y ninguna señal para el conductor. Se avisa una sola vez
	 * por sesión —repetirlo cada 250 ms sería inusable— y el detalle queda en
	 * consola.
	 */
	let avisoFalloLocal = false;
	function reportar(err: unknown) {
		console.error('[runner] fallo guardando en el dispositivo', err);
		if (avisoFalloLocal) return;
		avisoFalloLocal = true;
		toast.error('No se pudo guardar en este teléfono. Revisa el almacenamiento disponible.');
	}

	function programarGuardado() {
		if (timerLocal) clearTimeout(timerLocal);
		timerLocal = setTimeout(() => {
			guardarLocal().catch(reportar);
		}, AUTOSAVE_LOCAL_MS);
	}

	/// Cualquier cambio en respuestas o contexto reprograma el guardado local.
	/// Se observa `runner.answers` y `contexto`; leerlos aquí es lo que suscribe
	/// el efecto.
	$effect(() => {
		if (!runner) return;
		void runner.answers;
		void contexto;
		programarGuardado();
	});

	// ── Contexto ─────────────────────────────────────────────────────────────

	/**
	 * Cambia el vehículo del contexto.
	 *
	 * Si ya había respuestas, pide confirmación antes de limpiar las que dependían
	 * del vehículo: un preoperacional a medias con los datos de otro vehículo es
	 * peor que uno vacío.
	 */
	async function cambiarVehiculo(vehicleId: string, placa?: string) {
		const anterior = contexto.vehicleId;
		if (anterior && anterior !== vehicleId && runner && runner.answers.size > 0) {
			const ok = confirm(
				'Cambiar de vehículo puede invalidar las respuestas que ya diligenciaste para el anterior. ¿Limpiar esas respuestas?'
			);
			if (ok) {
				/// Se limpian por dependencia declarada, no todo: las respuestas
				/// generales (fecha, nombre, salud) siguen siendo válidas.
				const campoVehiculo = definicion?.sections
					.flatMap((s) => s.fields)
					.find((f) => f.type === 'LOOKUP' && f.config?.source === 'VEHICLE');
				if (campoVehiculo) runner.clearDependents(campoVehiculo.key);
			}
		}
		/// Se guarda también la placa: el borrador vive en el teléfono y, si el
		/// catálogo no está cargado al reabrirlo (sin señal), un id suelto no le
		/// dice nada al conductor —ni al recibo— sobre qué vehículo eligió.
		contexto = { ...contexto, vehicleId, vehiclePlate: placa ?? '' };
		await guardarLocal();
	}

	// ── Evidencia ────────────────────────────────────────────────────────────

	async function agregarEvidencia(
		field: { id: string; type: string },
		occurrenceId: string | null,
		media: PreparedMedia
	) {
		const kind =
			field.type === 'SIGNATURE' ? 'SIGNATURE' : field.type === 'PHOTO' ? 'PHOTO' : 'FILE';
		const clientAttachmentId = crypto.randomUUID();

		await putAttachment({
			clientAttachmentId,
			clientSubmissionId,
			fieldId: field.id,
			occurrenceId,
			kind,
			mimeType: media.mimeType,
			byteSize: media.byteSize,
			sha256: media.sha256,
			originalName: media.originalName,
			blob: media.blob,
			state: 'LOCAL',
			createdAt: new Date().toISOString()
		});

		runner?.addAttachment({
			clientAttachmentId,
			fieldId: field.id,
			occurrenceId,
			kind,
			mimeType: media.mimeType,
			byteSize: media.byteSize
		});
		runner?.markTouched(field.id, occurrenceId);
		await refrescarAdjuntos();
		await guardarLocal();

		/// Se pide persistencia tras el PRIMER adjunto, no al abrir la app: ahora sí
		/// hay algo que perder, y el conductor entiende para qué es el permiso.
		if (!pidioPersistencia) {
			pidioPersistencia = true;
			const concedida = await requestPersistence();
			if (!concedida) {
				toast.info(
					'El navegador no garantizó el almacenamiento. Envía los formularios en cuanto tengas señal.'
				);
			}
		}
	}

	async function quitarEvidencia(clientAttachmentId: string) {
		/**
		 * Se lee la fila ANTES de borrarla para quedarse con el `serverId`.
		 *
		 * Si el adjunto ya pasó por `attachments/init`, el servidor tiene una fila
		 * que este envío ya no va a declarar, y el submit lo rechazaría con
		 * `ATTACHMENT_NOT_DECLARED`. Encolar el descarte es lo que cierra ese hueco;
		 * hacerlo después del borrado local sería imposible, porque el `serverId`
		 * desaparece con la fila.
		 */
		const previo = await getAttachment(clientAttachmentId);

		await deleteAttachment(clientAttachmentId);
		runner?.removeAttachment(clientAttachmentId);

		if (previo) {
			await encolarDescarte(previo.clientSubmissionId, clientAttachmentId, previo.serverId ?? null);
		}

		await refrescarAdjuntos();
		await guardarLocal();
	}

	function adjuntosDe(fieldId: string, occurrenceId: string | null) {
		return adjuntos
			.filter((a) => a.fieldId === fieldId && (a.occurrenceId ?? null) === (occurrenceId ?? null))
			.map((a) => ({
				clientAttachmentId: a.clientAttachmentId,
				byteSize: a.byteSize,
				mimeType: a.mimeType,
				blob: a.blob
			}));
	}

	// ── Envío ────────────────────────────────────────────────────────────────

	function faltaContexto(): string[] {
		return contextoRequerido.filter((clave) => {
			const valor = contexto[clave];
			return valor === undefined || valor === null || valor === '';
		});
	}

	async function enviar() {
		if (!runner || enviando) return;

		const faltantes = faltaContexto();
		if (faltantes.length) {
			toast.error(
				faltantes.includes('vehicleId')
					? 'Selecciona el vehículo antes de enviar.'
					: `Falta el contexto obligatorio: ${faltantes.join(', ')}.`
			);
			return;
		}

		if (!runner.attemptSubmit()) {
			toast.error(`Faltan ${runner.validation.errors.length} respuestas obligatorias.`);
			return;
		}

		/// Confirmación explícita: `SUBMITTED` es terminal y el conductor debe
		/// saberlo ANTES, no descubrirlo al intentar corregir.
		if (!confirm('Después de enviar no podrás editar este formulario. ¿Enviar ahora?')) return;

		enviando = true;
		try {
			await guardarLocal();
			const draft = await getDraft(clientSubmissionId);
			if (!draft) throw new Error('No se encontró el borrador local.');
			const lista = await attachmentsForSubmission(clientSubmissionId);

			/// Se ENCOLA, no se envía en línea. Es lo que permite cerrar la app justo
			/// después: la outbox conserva el trabajo y lo entrega cuando haya red.
			await encolarEnvio(draft, lista, { offlineCreated: navigator.onLine === false });

			toast.success('Formulario listo para enviar. Se entregará en cuanto haya señal.');
			await goto(`/public/portal/formularios/envios/pendiente-${clientSubmissionId}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo preparar el envío.');
		} finally {
			enviando = false;
		}
	}

	async function reintentar() {
		await reintentarBloqueado(clientSubmissionId);
		bloqueo = null;
		toast.info('Se reintentará el envío con las correcciones.');
	}

	const progreso = $derived(runner ? computeProgress(runner.validation) : 0);
	const pendientes = $derived(runner?.validation.errors.length ?? 0);
</script>

<svelte:head><title>{titulo || 'Formulario'} · Portal del Conductor</title></svelte:head>

<div class="runner">
	<header class="barra">
		<a class="barra__volver" href="/public/portal/formularios" aria-label="Volver a la lista">←</a>
		<div class="barra__id">
			{#if codigo}<span class="barra__code">{codigo}</span>{/if}
			<span class="barra__titulo">{titulo || 'Formulario'}</span>
		</div>
		<SyncStatus variant="chip" />
	</header>

	{#if cargando}
		<div class="estado" aria-busy="true">Abriendo el formulario…</div>
	{:else if error || !runner || !definicion}
		<div class="estado estado--error">
			<p>{error ?? 'No se pudo abrir el formulario.'}</p>
			<a class="btn" href="/public/portal/formularios">Volver</a>
		</div>
	{:else}
		{#if bloqueo}
			<div class="bloqueo" role="alert">
				<p class="bloqueo__titulo">El servidor rechazó este envío</p>
				<p class="bloqueo__cuerpo">{bloqueo.message}</p>
				<p class="bloqueo__nota">Nada se perdió: corrige lo señalado y vuelve a enviar.</p>
				<button type="button" class="btn btn--primario" onclick={reintentar}>
					Reintentar envío
				</button>
			</div>
		{/if}

		{#if !permiteOffline && navigator.onLine === false}
			<p class="aviso" role="alert">
				Este formulario está configurado para diligenciarse solo con conexión. Puedes escribir, pero
				no se enviará hasta que recuperes señal.
			</p>
		{/if}

		{#if contextoRequerido.includes('vehicleId')}
			<section class="contexto">
				{#if vehiculos.length}
					<!-- Buscador de placas, no desplegable: en una flota de decenas de
					     vehículos el `<select>` nativo obliga a recorrer la lista entera
					     con el pulgar. Es el mismo componente del modal de días
					     laborados, así que el conductor ya sabe usarlo. -->
					<div class="contexto__campo">
						<span class="contexto__label" id="ctx-vehiculo-label">
							Vehículo <span class="req">*</span>
						</span>
						<!-- Si el borrador trae una placa que ya no está en el catálogo
						     (vehículo dado de baja), el buscador no puede resolver el id y el
						     campo se vería vacío; el placeholder al menos deja la placa a la
						     vista. Mismo patrón que días laborados. -->
						<Autocomplete
							options={vehiculoOptions}
							value={String(contexto.vehicleId ?? '')}
							placeholder={String(contexto.vehiclePlate ?? '') || '🔍 Buscar placa...'}
							inputId="ctx-vehiculo"
							ariaLabel="Buscar la placa del vehículo"
							on:select={(e) =>
								cambiarVehiculo(e.detail.id, e.detail.placa ?? e.detail.label).catch(reportar)}
							on:clear={() => cambiarVehiculo('').catch(reportar)}
						/>
					</div>
				{:else}
					<!-- Sin catálogo (sin red): se acepta la placa escrita para no
					     bloquear la captura. El servidor valida el contexto al enviar. -->
					<label class="contexto__campo">
						<span class="contexto__label">Vehículo <span class="req">*</span></span>
						<input
							class="contexto__input"
							placeholder="Placa del vehículo"
							value={String(contexto.vehiclePlate ?? '')}
							oninput={(e) => (contexto = { ...contexto, vehiclePlate: e.currentTarget.value })}
						/>
						<span class="contexto__hint">
							Sin conexión no se puede cargar la lista. Escribe la placa; se validará al enviar.
						</span>
					</label>
				{/if}
			</section>
		{/if}

		<main class="cuerpo">
			<FormRenderer
				{runner}
				title={definicion.title}
				instructions={definicion.instructions}
				showErrorSummary={true}
			>
				{#snippet evidence({ field, occurrenceId })}
					<EvidenceCapture
						{field}
						{occurrenceId}
						existentes={adjuntosDe(field.id, occurrenceId)}
						draftBytes={bytesAdjuntos}
						disabled={runner!.readonly}
						onadd={(media) => agregarEvidencia(field, occurrenceId, media)}
						onremove={quitarEvidencia}
					/>
				{/snippet}
			</FormRenderer>
		</main>

		<!-- Barra inferior sticky: progreso, guardar y enviar. El conductor
		     diligencia con una mano y necesita el botón siempre alcanzable. -->
		<footer class="pie">
			<div class="pie__progreso">
				<span class="pie__barra" aria-hidden="true">
					<span class="pie__relleno" style={`width:${progreso}%`}></span>
				</span>
				<span class="pie__texto">
					{progreso}%
					{#if pendientes > 0}· {pendientes} pendiente{pendientes === 1 ? '' : 's'}{/if}
				</span>
			</div>
			<div class="pie__acciones">
				<button
					type="button"
					class="btn"
					onclick={async () => {
						await guardarLocal();
						await encolarBackup(clientSubmissionId);
						toast.success('Borrador guardado en este teléfono.');
					}}
				>
					Guardar
				</button>
				<button type="button" class="btn btn--primario" disabled={enviando} onclick={enviar}>
					{enviando ? 'Preparando…' : 'Enviar'}
				</button>
			</div>
		</footer>
	{/if}
</div>

<style>
	.runner {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		/* Espacio para la barra de acciones y la navegación móvil. */
		padding: 0.75rem 0.875rem 11rem;
		max-width: 34rem;
		margin: 0 auto;
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

	.barra__id {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.barra__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.barra__titulo {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bloqueo {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.875rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 12px;
	}

	.bloqueo__titulo {
		font-size: 0.9375rem;
		font-weight: 700;
		color: #991b1b;
	}

	.bloqueo__cuerpo,
	.bloqueo__nota {
		font-size: 0.8125rem;
		line-height: 1.45;
		color: #b91c1c;
	}

	.bloqueo__nota {
		font-size: 0.75rem;
	}

	.bloqueo .btn {
		align-self: flex-start;
		margin-top: 0.25rem;
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

	.contexto {
		padding: 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 12px;
	}

	.contexto__campo {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.contexto__label {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted, #6b6b6b);
	}

	.req {
		color: #dc2626;
	}

	.contexto__input {
		width: 100%;
		min-height: 48px;
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 1rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
	}

	.contexto__input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	/* El buscador de placas viene dimensionado para el escritorio (0.9 rem, ~40 px).
	   Aquí se diligencia de pie y con una mano: 48 px de objetivo táctil y 16 px de
	   fuente, que es el umbral por debajo del cual iOS hace zoom al enfocar y
	   descuadra la pantalla a media inspección. */
	.contexto :global(.autocomplete-field) {
		min-height: 48px;
		font-size: 1rem;
		border-radius: 10px;
		border-color: var(--border-default, rgba(0, 0, 0, 0.12));
	}

	.contexto :global(.autocomplete-field:focus) {
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.contexto :global(.autocomplete-option) {
		min-height: 44px;
		font-size: 0.9375rem;
	}

	.contexto__hint {
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-very-muted, #9a9a9a);
	}

	.cuerpo {
		min-width: 0;
	}

	.pie {
		position: fixed;
		left: 0;
		right: 0;
		/* La navegación global ocupa 64 px en móvil. Sin este desplazamiento
		   cubría por completo Guardar y Enviar. */
		bottom: calc(64px + env(safe-area-inset-bottom, 0px));
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		/* `env(safe-area-inset-bottom)` para que la barra no quede bajo el gesto
		   de inicio en iPhone. */
		padding-bottom: calc(0.625rem + env(safe-area-inset-bottom, 0px));
		background: var(--bg-surface, #fff);
		border-top: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.08);
	}

	.pie__progreso {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.pie__barra {
		flex: 1;
		height: 6px;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
		overflow: hidden;
	}

	.pie__relleno {
		display: block;
		height: 100%;
		background: var(--emerald-500, #10b981);
	}

	.pie__texto {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-muted, #6b6b6b);
		white-space: nowrap;
	}

	.pie__acciones {
		display: flex;
		gap: 0.5rem;
	}

	.btn {
		flex: 1;
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

	.btn--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
	}

	.btn:disabled {
		opacity: 0.5;
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
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.estado--error {
		color: #b91c1c;
	}

	.estado .btn {
		flex: 0;
	}

	@media (min-width: 769px) {
		.runner {
			padding-bottom: 7rem;
		}

		.pie {
			bottom: 0;
		}
	}
</style>
