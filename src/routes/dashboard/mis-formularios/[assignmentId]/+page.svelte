<!--
	Runner de «Mis formularios»: diligenciar desde el dashboard.

	Es el mismo formulario que ve un conductor —mismo `FormRenderer`, mismas
	reglas condicionales, misma validación de servidor— pero SIN la pila offline.
	La diferencia se reduce a dónde vive el borrador:

	  - En el portal, en IndexedDB, y la outbox lo entrega cuando hay señal. Eso
	    existe porque el conductor diligencia en un patio sin cobertura.
	  - Aquí, en el servidor. Un usuario de oficina está en línea; montarle
	    IndexedDB y una outbox añadiría una fuente de fallos —dos identidades
	    compartiendo el almacén local del navegador— sin resolver nada.

	El precedente exacto de esta reutilización ya existía:
	`/dashboard/formularios/[formId]/preview/[versionId]` monta `FormRenderer` +
	`createRunnerState` con el cliente del dashboard. Esto es ese preview, más
	evidencias reales, borrador contra servidor y envío.

	Lo que SÍ se conserva del portal, porque no es offline sino corrección:

	  - `clientSubmissionId` generado antes de escribir nada. Es la clave de
	    idempotencia: si la respuesta del POST se pierde en la red, reintentar
	    devuelve el mismo envío en vez de crear un duplicado.
	  - `?draft=` en la URL desde el primer instante, para que recargar reanude
	    ESTE borrador y no cree otro vacío.
	  - `?nuevo=1` para empezar un segundo formulario de la misma asignación, que
	    con `ONE_PER_CONTEXT` es lo normal.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import { misFormulariosAPI, MisFormulariosError } from '$lib/api/mis-formularios';
	import { invalidarMisFormularios } from '$lib/formularios/mis-formularios-cache';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { createRunnerState, type RunnerState } from '$lib/formularios/runner-state.svelte';
	import { computeProgress, type DraftAnswer } from '$lib/formularios/validate-answers';
	import type { FormVersionDto } from '$lib/formularios/types';
	import type { PreparedMedia } from '$lib/offline/forms-media';
	import { ordenarPorEtiqueta } from '$lib/utils/ordenarOpciones';
	import FormRenderer from '$lib/components/formularios/FormRenderer.svelte';
	import EvidenceCapture from '$lib/components/formularios/EvidenceCapture.svelte';
	import Autocomplete from '$lib/components/Autocomplete.svelte';

	const assignmentId = $derived($page.params.assignmentId!);

	/**
	 * Autoguardado contra el SERVIDOR cada 2 s de inactividad.
	 *
	 * El portal usa 250 ms porque escribe en IndexedDB, que es local y barato.
	 * Aquí cada guardado es una petición HTTP que reescribe el árbol de
	 * respuestas: a 250 ms serían cuatro por segundo mientras alguien teclea una
	 * observación. Dos segundos cuestan, como mucho, la última frase.
	 */
	const AUTOSAVE_MS = 2000;

	let definicion = $state<FormVersionDto | null>(null);
	let contextoRequerido = $state<string[]>([]);
	let titulo = $state('');
	let codigo = $state('');

	let clientSubmissionId = $state<string>('');
	let contexto = $state<Record<string, unknown>>({});
	let runner = $state<RunnerState | null>(null);

	/**
	 * Evidencias del borrador, en memoria.
	 *
	 * Cada una se sube a S3 en cuanto se captura, así que el estado que hace
	 * falta conservar es el mínimo para pintarlas y para declararlas en el
	 * envío. El `blob` se guarda solo para la miniatura de `EvidenceCapture`; al
	 * recargar la página se pierde y la vista cae a los datos del servidor, que
	 * es lo correcto: el archivo ya está subido.
	 */
	interface EvidenciaLocal {
		clientAttachmentId: string;
		serverId: string | null;
		fieldId: string;
		occurrenceId: string | null;
		kind: 'PHOTO' | 'FILE' | 'SIGNATURE';
		mimeType: string;
		byteSize: number;
		sha256: string;
		originalName: string | null;
		blob?: Blob;
	}
	let adjuntos = $state<EvidenciaLocal[]>([]);

	let cargando = $state(true);
	let error = $state<string | null>(null);
	let enviando = $state(false);
	let guardadoEn = $state<Date | null>(null);
	let guardando = $state(false);
	let vehiculos = $state<{ id: string; placa: string }[]>([]);

	let timerLocal: ReturnType<typeof setTimeout> | null = null;
	/// Se salta el primer disparo del `$effect`: sembrar el runner cuenta como
	/// cambio, y sin esta guarda cada apertura mandaría un PUT redundante.
	let listoParaAutoguardar = false;

	onMount(async () => {
		try {
			await cargar();
		} catch (err) {
			error = err instanceof Error ? err.message : 'No se pudo abrir el formulario.';
		} finally {
			cargando = false;
		}
	});

	onDestroy(() => {
		if (timerLocal) clearTimeout(timerLocal);
	});

	async function cargar() {
		const respuesta = await misFormulariosAPI.definicion(assignmentId);
		definicion = respuesta.definition;
		titulo = respuesta.definition.title;
		codigo = respuesta.assignment.name;
		contextoRequerido = Object.entries(respuesta.assignment.contextSchema ?? {})
			.filter(([, v]) => v?.required)
			.map(([k]) => k);

		const forzarNuevo = $page.url.searchParams.get('nuevo') === '1';
		const draftParam = $page.url.searchParams.get('draft');

		if (!forzarNuevo && draftParam) {
			await reanudar(draftParam);
		} else {
			empezarNuevo();
			await guardarEnServidor();
		}

		fijarUrl();
		if (contextoRequerido.includes('vehicleId')) await cargarVehiculos();
		listoParaAutoguardar = true;
	}

	/**
	 * Reanuda un borrador del servidor.
	 *
	 * Si no existe —lo descartaron desde otra pestaña, o el enlace es viejo— se
	 * empieza uno nuevo en vez de dejar la pantalla en error: quien abrió el
	 * formulario quiere diligenciarlo, no leer un 404.
	 */
	async function reanudar(clientId: string) {
		try {
			const { submission } = await misFormulariosAPI.borrador(clientId);
			if (submission.status !== 'DRAFT') {
				toast.info('Ese formulario ya fue entregado. Se abre uno nuevo.');
				empezarNuevo();
				return;
			}
			clientSubmissionId = clientId;
			contexto = { ...(submission.context ?? {}) };
			runner = createRunnerState({
				sections: definicion!.sections,
				answers: respuestasDeEnvio(submission)
			});
			/**
			 * `fieldId`/`occurrenceId` salen de `metadata`, no de columnas propias.
			 *
			 * `form_attachments` no las tiene: la evidencia se enlaza a su respuesta
			 * al ENVIAR (`answer_id`), y mientras es borrador todavía no hay
			 * respuesta a la que colgarse. `attachments/init` las guarda en
			 * `metadata_json` justamente para poder recolocar cada archivo en su
			 * campo al reabrir. Leerlas del nivel superior devolvería `undefined` y
			 * la evidencia aparecería huérfana: el runner pediría una foto
			 * obligatoria que en realidad ya está subida.
			 */
			adjuntos = (submission.attachments ?? []).map((a: any) => ({
				clientAttachmentId: a.clientAttachmentId,
				serverId: a.id,
				fieldId: String(a.metadata?.fieldId ?? ''),
				occurrenceId: (a.metadata?.occurrenceId as string | null) ?? null,
				kind: a.kind,
				mimeType: a.mimeType,
				byteSize: a.byteSize ?? 0,
				sha256: a.sha256,
				originalName: a.originalName ?? null
			}));
			sincronizarAdjuntosConRunner();
		} catch (err) {
			if (err instanceof MisFormulariosError && err.status === 404) {
				empezarNuevo();
				return;
			}
			throw err;
		}
	}

	/**
	 * Respuestas de un borrador del servidor, en la forma que espera el runner.
	 *
	 * Un DRAFT y un SUBMITTED guardan las respuestas en columnas DISJUNTAS: el
	 * borrador mete el valor crudo en `value_json` envuelto en `draftValue`/
	 * `draftOptionValues` —un número a medio teclear («12,») no es un decimal
	 * válido y tiparlo perdería lo escrito— mientras que el entregado usa las
	 * columnas tipadas y `form_answer_options`.
	 *
	 * Esa diferencia NO llega hasta aquí: `toAnswerDto` deshace la envoltura y
	 * expone siempre `value`/`optionValues`. Se dejó de hacer en cada consumidor
	 * justamente porque el panel de envíos recibía `{"draftOptionValues":["B"]}`
	 * donde esperaba `["B"]` y un preoperacional al 100 % se veía en blanco.
	 */
	function respuestasDeEnvio(submission: any): DraftAnswer[] {
		return (submission.answers ?? []).map((a: any) => ({
			fieldId: a.fieldId,
			occurrenceId: a.occurrenceId ?? null,
			rowIndex: a.rowIndex ?? null,
			value: a.value,
			optionValues: a.optionValues ?? []
		}));
	}

	function empezarNuevo() {
		/// Antes de escribir NADA: es la clave de idempotencia del envío.
		clientSubmissionId = crypto.randomUUID();
		contexto = {};
		adjuntos = [];
		runner = createRunnerState({ sections: definicion!.sections });
		runner.seedMinRows();
	}

	/// La URL identifica el borrador desde el primer instante, así que recargar
	/// reanuda ESTE y no crea otro. Se retira `nuevo` o cada recarga dejaría un
	/// rastro de formularios en blanco.
	function fijarUrl() {
		const url = new URL($page.url);
		url.searchParams.set('draft', clientSubmissionId);
		url.searchParams.delete('nuevo');
		history.replaceState(history.state, '', url);
	}

	async function cargarVehiculos() {
		try {
			const respuesta: any = await vehiculosAPI.getAll();
			const lista = Array.isArray(respuesta?.data) ? respuesta.data : (respuesta ?? []);
			vehiculos = ordenarPorEtiqueta(
				lista.map((v: any) => ({ id: v.id, placa: v.placa })).filter((v: any) => v.id && v.placa),
				(v) => v.placa
			);
		} catch {
			/// Sin catálogo se escribe la placa a mano. El servidor valida el
			/// contexto al enviar de todas formas.
			vehiculos = [];
		}
	}

	const vehiculoOptions = $derived(
		vehiculos.map((v) => ({ id: v.id, label: v.placa, placa: v.placa }))
	);

	// ── Guardado ─────────────────────────────────────────────────────────────

	async function guardarEnServidor() {
		if (!runner || !definicion || !clientSubmissionId) return;
		guardando = true;
		try {
			const resultado = await misFormulariosAPI.guardarBorrador(clientSubmissionId, {
				assignmentId,
				versionId: definicion.id,
				/// `$state.snapshot` porque `contexto` es un Proxy de Svelte y
				/// `JSON.stringify` sobre él serializa de más.
				context: $state.snapshot(contexto),
				answers: runner.toPayloadAnswers(),
				progress: computeProgress(runner.validation)
			});
			if (resultado.alreadySubmitted) {
				toast.info('Este formulario ya fue entregado.');
				await goto(`/dashboard/formularios/envios/${resultado.id}`);
				return;
			}
			guardadoEn = new Date();
			/// La lista cachea 15 s. Sin esto, volver atrás justo después de que el
			/// autoguardado creara el borrador enseñaría la tarjeta sin él.
			invalidarMisFormularios();
		} finally {
			guardando = false;
		}
	}

	/**
	 * Avisa una sola vez por sesión de un fallo de autoguardado.
	 *
	 * Repetirlo cada dos segundos sería inusable, pero callarlo del todo es peor
	 * que en el portal: allí el trabajo estaba a salvo en IndexedDB aunque el
	 * servidor no respondiera; aquí el servidor es el único sitio donde vive.
	 */
	let avisoFalloGuardado = false;
	function reportar(err: unknown) {
		console.error('[mis-formularios] fallo guardando el borrador', err);
		if (avisoFalloGuardado) return;
		avisoFalloGuardado = true;
		toast.error('No se está pudiendo guardar. Revisa tu conexión antes de seguir escribiendo.');
	}

	function programarGuardado() {
		if (timerLocal) clearTimeout(timerLocal);
		timerLocal = setTimeout(() => {
			guardarEnServidor()
				.then(() => {
					avisoFalloGuardado = false;
				})
				.catch(reportar);
		}, AUTOSAVE_MS);
	}

	/// Leer `runner.answers` y `contexto` aquí es lo que suscribe el efecto.
	$effect(() => {
		if (!runner) return;
		void runner.answers;
		void contexto;
		if (!listoParaAutoguardar) return;
		programarGuardado();
	});

	// ── Contexto ─────────────────────────────────────────────────────────────

	async function cambiarVehiculo(vehicleId: string, placa?: string) {
		const anterior = contexto.vehicleId;
		if (anterior && anterior !== vehicleId && runner && runner.answers.size > 0) {
			const ok = confirm(
				'Cambiar de vehículo puede invalidar las respuestas que ya diligenciaste para el anterior. ¿Limpiar esas respuestas?'
			);
			if (ok) {
				/// Solo las que DEPENDEN del vehículo: fecha, nombre y demás campos
				/// generales siguen siendo válidos.
				const campoVehiculo = definicion?.sections
					.flatMap((s) => s.fields)
					.find((f) => f.type === 'LOOKUP' && (f.config as any)?.source === 'VEHICLE');
				if (campoVehiculo) runner.clearDependents(campoVehiculo.key);
			}
		}
		contexto = { ...contexto, vehicleId, vehiclePlate: placa ?? '' };
		await guardarEnServidor();
	}

	// ── Evidencia ────────────────────────────────────────────────────────────

	/**
	 * Captura y sube una evidencia: INIT → PUT firmado a S3 → COMPLETE.
	 *
	 * En línea y en el acto, sin outbox. Si algo falla se avisa y NO se añade al
	 * runner: una evidencia a medias haría que el envío se rechazara con
	 * `ATTACHMENT_MISSING` sin que nadie supiera por qué.
	 */
	async function agregarEvidencia(
		field: { id: string; type: string },
		occurrenceId: string | null,
		media: PreparedMedia
	) {
		const kind =
			field.type === 'SIGNATURE' ? 'SIGNATURE' : field.type === 'PHOTO' ? 'PHOTO' : 'FILE';
		const clientAttachmentId = crypto.randomUUID();

		try {
			/// El borrador tiene que existir en el servidor antes del INIT: la fila
			/// del adjunto cuelga de él.
			await guardarEnServidor();

			const inicio = await misFormulariosAPI.iniciarAdjunto({
				clientSubmissionId,
				clientAttachmentId,
				fieldId: field.id,
				occurrenceId,
				kind,
				mimeType: media.mimeType,
				byteSize: media.byteSize,
				sha256: media.sha256,
				originalName: media.originalName
			});

			/// `alreadyUploaded` cubre el reintento tras un fallo de red posterior al
			/// COMPLETE: el objeto ya está en S3 y volver a subirlo sería gastar
			/// ancho de banda para obtener el mismo resultado.
			if (inicio.uploadUrl && !inicio.alreadyUploaded) {
				await misFormulariosAPI.subirBinario(inicio.uploadUrl, media.blob, media.mimeType);
				await misFormulariosAPI.completarAdjunto(inicio.attachmentId, {
					sha256: media.sha256,
					byteSize: media.byteSize
				});
			}

			adjuntos = [
				...adjuntos,
				{
					clientAttachmentId,
					serverId: inicio.attachmentId,
					fieldId: field.id,
					occurrenceId,
					kind,
					mimeType: media.mimeType,
					byteSize: media.byteSize,
					sha256: media.sha256,
					originalName: media.originalName ?? null,
					blob: media.blob
				}
			];
			runner?.addAttachment({
				clientAttachmentId,
				fieldId: field.id,
				occurrenceId,
				kind,
				mimeType: media.mimeType,
				byteSize: media.byteSize
			});
			runner?.markTouched(field.id, occurrenceId);
		} catch (err) {
			toast.error(
				err instanceof MisFormulariosError
					? `No se pudo subir la evidencia: ${err.message}`
					: 'No se pudo subir la evidencia.'
			);
		}
	}

	/**
	 * Quita una evidencia, también del servidor.
	 *
	 * El descarte remoto no es opcional: el envío rechaza los adjuntos que el
	 * payload no declara (`ATTACHMENT_NOT_DECLARED`), así que dejar la fila
	 * huérfana bloquearía el formulario sin explicación.
	 */
	async function quitarEvidencia(clientAttachmentId: string) {
		const previo = adjuntos.find((a) => a.clientAttachmentId === clientAttachmentId);
		adjuntos = adjuntos.filter((a) => a.clientAttachmentId !== clientAttachmentId);
		runner?.removeAttachment(clientAttachmentId);

		if (previo?.serverId) {
			try {
				await misFormulariosAPI.descartarAdjunto(previo.serverId);
			} catch (err) {
				toast.error('No se pudo quitar la evidencia del servidor. Recarga antes de enviar.');
				console.error('[mis-formularios] fallo descartando adjunto', err);
			}
		}
	}

	/// Al reanudar, el runner tiene que conocer los adjuntos ya subidos o su
	/// validación pediría evidencia obligatoria que en realidad ya existe.
	function sincronizarAdjuntosConRunner() {
		if (!runner) return;
		for (const a of adjuntos) {
			const yaEsta = runner
				.attachmentsOf(a.fieldId, a.occurrenceId)
				.some((x) => x.clientAttachmentId === a.clientAttachmentId);
			if (yaEsta) continue;
			runner.addAttachment({
				clientAttachmentId: a.clientAttachmentId,
				fieldId: a.fieldId,
				occurrenceId: a.occurrenceId,
				kind: a.kind,
				mimeType: a.mimeType,
				byteSize: a.byteSize
			});
		}
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

	const bytesAdjuntos = $derived(adjuntos.reduce((suma, a) => suma + a.byteSize, 0));

	// ── Envío ────────────────────────────────────────────────────────────────

	function faltaContexto(): string[] {
		return contextoRequerido.filter((clave) => {
			const valor = contexto[clave];
			return valor === undefined || valor === null || valor === '';
		});
	}

	async function enviar() {
		if (!runner || !definicion || enviando) return;

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

		/// `SUBMITTED` es terminal. Hay que saberlo ANTES, no descubrirlo al
		/// intentar corregir.
		if (!confirm('Después de enviar no podrás editar este formulario. ¿Enviar ahora?')) return;

		enviando = true;
		if (timerLocal) clearTimeout(timerLocal);
		try {
			const resultado = await misFormulariosAPI.enviarFormulario({
				clientSubmissionId,
				assignmentId,
				versionId: definicion.id,
				context: $state.snapshot(contexto),
				completedAt: new Date().toISOString(),
				answers: runner.toPayloadAnswers(),
				attachments: adjuntos.map((a) => ({
					clientAttachmentId: a.clientAttachmentId,
					fieldId: a.fieldId,
					occurrenceId: a.occurrenceId,
					kind: a.kind,
					mimeType: a.mimeType,
					byteSize: a.byteSize,
					sha256: a.sha256,
					originalName: a.originalName
				})),
				device: { platform: navigator.userAgent.slice(0, 60) }
			});

			toast.success(
				resultado.idempotentReplay ? 'Este formulario ya estaba entregado.' : 'Formulario enviado.'
			);
			/// El envío mueve la asignación de «por diligenciar» a «completada» y le
			/// quita el borrador: la lista cacheada ya no describe la realidad.
			invalidarMisFormularios();
			await goto(`/dashboard/formularios/envios/${resultado.submissionId}`);
		} catch (err) {
			toast.error(
				err instanceof MisFormulariosError ? err.message : 'No se pudo enviar el formulario.'
			);
		} finally {
			enviando = false;
		}
	}

	const progreso = $derived(runner ? computeProgress(runner.validation) : 0);
	const pendientes = $derived(runner?.validation.errors.length ?? 0);
</script>

<svelte:head><title>{titulo || 'Formulario'} · Mis formularios</title></svelte:head>

<div class="runner">
	<header class="barra">
		<a class="barra__volver" href="/dashboard/mis-formularios" aria-label="Volver a la lista">←</a>
		<div class="barra__id">
			{#if codigo}<span class="barra__code">{codigo}</span>{/if}
			<span class="barra__titulo">{titulo || 'Formulario'}</span>
		</div>
		<!-- Sustituye al `SyncStatus` del portal: aquí no hay cola que mostrar,
		     solo si lo último quedó guardado. -->
		<span class="barra__estado" aria-live="polite">
			{#if guardando}
				Guardando…
			{:else if guardadoEn}
				Guardado {guardadoEn.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
			{/if}
		</span>
	</header>

	{#if cargando}
		<div class="estado" aria-busy="true">Abriendo el formulario…</div>
	{:else if error || !runner || !definicion}
		<div class="estado estado--error">
			<p>{error ?? 'No se pudo abrir el formulario.'}</p>
			<a class="btn" href="/dashboard/mis-formularios">Volver</a>
		</div>
	{:else}
		{#if contextoRequerido.includes('vehicleId')}
			<section class="contexto">
				<div class="contexto__campo">
					<span class="contexto__label">Vehículo <span class="req">*</span></span>
					{#if vehiculos.length}
						<!-- Buscador y no `<select>`: a un conductor el portal le propone
						     solo sus vehículos, pero aquí hay que buscar en toda la flota. -->
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
					{:else}
						<input
							class="contexto__input"
							placeholder="Placa del vehículo"
							value={String(contexto.vehiclePlate ?? '')}
							oninput={(e) => (contexto = { ...contexto, vehiclePlate: e.currentTarget.value })}
						/>
					{/if}
				</div>
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
						try {
							await guardarEnServidor();
							toast.success('Borrador guardado.');
						} catch (err) {
							reportar(err);
						}
					}}
				>
					Guardar
				</button>
				<button type="button" class="btn btn--primario" disabled={enviando} onclick={enviar}>
					{enviando ? 'Enviando…' : 'Enviar'}
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
		padding: 0.75rem 0.875rem 7rem;
	}

	.barra {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.barra__volver {
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		font-size: 1.125rem;
		color: var(--text-secondary, #4a4a4a);
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 10px;
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
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--emerald-700, #047857);
	}

	.barra__titulo {
		font-size: 0.9rem;
		font-weight: 600;
	}

	.barra__estado {
		flex-shrink: 0;
		font-size: 0.7rem;
		color: var(--text-muted, #64748b);
	}

	.estado {
		padding: 2rem 0;
		color: var(--text-muted, #64748b);
	}

	.estado--error {
		color: var(--red-600, #dc2626);
	}

	.contexto {
		padding: 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 12px;
	}

	.contexto__campo {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.contexto__label {
		font-size: 0.75rem;
		font-weight: 600;
	}

	.req {
		color: var(--red-600, #dc2626);
	}

	.contexto__input {
		min-height: 40px;
		padding: 0 0.625rem;
		font: inherit;
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
	}

	.cuerpo {
		min-width: 0;
	}

	/* Sticky abajo: el botón de enviar tiene que estar siempre alcanzable en un
	   formulario de doscientos campos. */
	.pie {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 20;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		background: var(--bg-surface, #fff);
		border-top: 1px solid var(--border, #e2e8f0);
	}

	.pie__progreso {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 12rem;
	}

	.pie__barra {
		flex: 1;
		height: 6px;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
	}

	.pie__relleno {
		display: block;
		height: 100%;
		background: var(--emerald-600, #059669);
	}

	.pie__texto {
		font-size: 0.75rem;
		color: var(--text-muted, #64748b);
	}

	.pie__acciones {
		display: flex;
		gap: 0.5rem;
	}

	.btn {
		min-height: 40px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
		cursor: pointer;
		text-decoration: none;
		display: inline-grid;
		place-items: center;
	}

	.btn--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
