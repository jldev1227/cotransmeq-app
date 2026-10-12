<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import {
		sarlaftAPI,
		TIPO_FORMULARIO_LABELS,
		ESTADO_LABELS,
		TIPO_DOCUMENTO_LABELS,
		CONTACTO_POR_TIPO,
		waLink,
		telLink,
		mailtoLink,
		type SarlaftFormularioDetalle,
		type EstadoSarlaft,
		type TipoFormularioSarlaft
	} from '$lib/api/sarlaft';
	import SarlaftRespuestas from '$lib/sarlaft/SarlaftRespuestas.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { mascota } from '$lib/mascot';
	import { listadoSarlaft } from '$lib/stores/volverListado';
	import { toast } from 'svelte-sonner';
	import { confirmar } from '$lib/stores/confirm';

	let detalle = $state<SarlaftFormularioDetalle | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let downloading = $state<Record<string, boolean>>({});
	let downloadingPdf = $state(false);
	let downloadingZip = $state(false);

	// Estado de edición
	let editEstado = $state<EstadoSarlaft | ''>('');
	let editConcepto = $state('');
	let editObservaciones = $state('');
	let saving = $state(false);

	/// Vuelve al listado con los filtros con los que se salió de él (búsqueda,
	/// tipo, estado, orden y página). Antes iba a la ruta pelada y había que
	/// filtrar otra vez después de cada formulario revisado.
	function volver() {
		goto(listadoSarlaft.url());
	}

	const tipoCliente = $derived.by(() => {
		if (!detalle) return null;
		const cliIg01 = detalle.respuestas?.['CLI-IG-01'];
		if (cliIg01 === 'Persona Natural') return 'Persona Natural' as const;
		if (cliIg01 === 'Persona Jurídica') return 'Persona Jurídica' as const;
		return null;
	});

	const contacto = $derived.by(() => {
		if (!detalle) return null;
		return CONTACTO_POR_TIPO[detalle.tipo_formulario as TipoFormularioSarlaft] ?? null;
	});

	const detallesResumen = $derived.by(() => {
		if (!detalle) return { secciones: 0, campos: 0, tablas: 0, docs: 0 };
		const r = detalle.respuestas ?? {};
		const seccionesConDatos = new Set<string>();
		let camposConValor = 0;
		let tablasCount = 0;
		for (const [key, value] of Object.entries(r)) {
			if (key === '__documentos_confirmados') continue;
			if (value === null || value === undefined || value === '') continue;
			if (key.endsWith('__rows')) {
				const prefijo = key.split('-').slice(0, -1).join('-');
				seccionesConDatos.add(prefijo);
				if (Array.isArray(value)) {
					tablasCount += value.length;
				}
				continue;
			}
			const [tipo, sec] = key.split('-');
			if (sec) seccionesConDatos.add(`${tipo}-${sec}`);
			camposConValor++;
		}
		return {
			secciones: seccionesConDatos.size,
			campos: camposConValor,
			tablas: tablasCount,
			docs: detalle.documentos?.length ?? 0
		};
	});

	/// Las cifras del formulario, en las mismas pastillas que los conteos de
	/// los listados. No filtran nada: son solo lectura.
	const conteosResumen = $derived([
		{ clave: 'secciones', etiqueta: 'Secciones', valor: detallesResumen.secciones },
		{ clave: 'campos', etiqueta: 'Campos', valor: detallesResumen.campos },
		{ clave: 'tablas', etiqueta: 'Tablas', valor: detallesResumen.tablas },
		{ clave: 'docs', etiqueta: 'Documentos', valor: detallesResumen.docs },
		{
			clave: 'enviado',
			etiqueta: 'Enviado',
			valor: detalle ? tiempoRelativo(detalle.fecha_envio) : '—'
		}
	]);

	/// Turno de la última carga: al pasar de un formulario a otro, una
	/// respuesta lenta del anterior podía pintar sus datos sobre el nuevo.
	let turnoCarga = 0;

	async function load(id: string) {
		const turno = ++turnoCarga;
		isLoading = true;
		error = null;
		try {
			const fetched = await sarlaftAPI.obtenerDetalle(id);
			if (turno !== turnoCarga) return;
			detalle = fetched;
			editEstado = fetched.estado;
			editConcepto = fetched.evaluacion_concepto ?? '';
			editObservaciones = fetched.evaluacion_observaciones ?? '';
		} catch (err: any) {
			if (turno !== turnoCarga) return;
			error = err?.response?.data?.error || err?.message || 'Error al cargar el detalle';
			if (error) toast.error(error);
		} finally {
			if (turno === turnoCarga) isLoading = false;
		}
	}

	async function descargar(documentoId: string, nombre: string) {
		downloading = { ...downloading, [documentoId]: true };
		try {
			const data = await sarlaftAPI.obtenerUrlDescarga(documentoId);
			const link = document.createElement('a');
			link.href = data.url;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.download = data.nombre_archivo;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			toast.success(`Descarga iniciada: ${nombre}`);
		} catch (err: any) {
			toast.error(
				`Error al descargar ${nombre}: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`
			);
		} finally {
			downloading = { ...downloading, [documentoId]: false };
		}
	}

	async function handleDescargarPDF() {
		if (!detalle) return;
		downloadingPdf = true;
		try {
			const filename = await sarlaftAPI.descargarPDF(detalle.id);
			toast.success(`PDF descargado: ${filename}`);
		} catch (err: any) {
			toast.error(
				`Error al descargar PDF: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`
			);
		} finally {
			downloadingPdf = false;
		}
	}

	async function handleDescargarZip() {
		if (!detalle) return;
		downloadingZip = true;
		try {
			const filename = await sarlaftAPI.descargarEvidencia(detalle.id);
			toast.success(`Evidencia descargada: ${filename}`);
		} catch (err: any) {
			toast.error(
				`Error al descargar evidencia: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`
			);
		} finally {
			downloadingZip = false;
		}
	}

	/** Decisiones que cierran la evaluación. En los formatos con documento
	 *  controlado, cada una emite una versión documental NUEVA e inmutable. */
	const DECISIONES_FINALES = ['aprobado', 'condicionado', 'rechazado'];

	async function guardarEvaluacion() {
		if (!detalle || !editEstado) return;

		// Emitir una versión documental es irreversible: la versión anterior no
		// se sobrescribe, pero la nueva queda archivada y numerada. Se confirma
		// antes para que no ocurra por un clic accidental en el selector.
		if (emiteVersionDocumental) {
			const etiqueta = ESTADO_LABELS[editEstado as EstadoSarlaft]?.label ?? editEstado;
			const versionNueva = (detalle.documentos_generados?.length ?? 0) + 1;
			const ok = await confirmar({
				title: `¿Registrar el resultado "${etiqueta}"?`,
				message:
					`Radicado ${detalle.radicado}.\n\n` +
					`Se emitirá la versión documental ${versionNueva} del formato, con esa casilla marcada. ` +
					`La versión recibida no se modifica.`,
				tone: 'warning',
				confirmText: 'Registrar resultado'
			});
			if (!ok) return;
		}

		saving = true;
		try {
			const actualizado = await sarlaftAPI.actualizarEvaluacion(detalle.id, {
				estado: editEstado as EstadoSarlaft,
				concepto: editConcepto || undefined,
				observaciones: editObservaciones || undefined
			});
			detalle = { ...detalle, ...actualizado };
			toast.success('Evaluación actualizada');
			// El backend acaba de emitir una versión documental: se recarga el
			// detalle para que la lista de versiones y sus hashes queden al día
			// sin obligar al usuario a refrescar la página.
			if (emiteVersionDocumental) {
				try {
					detalle = await sarlaftAPI.obtenerDetalle(detalle.id);
				} catch {
					/* El guardado sí ocurrió; solo no se pudo refrescar la vista. */
				}
			}
		} catch (err: any) {
			toast.error(err?.response?.data?.error || err?.message || 'Error al guardar la evaluación');
		} finally {
			saving = false;
		}
	}

	/** Versiones documentales, de la más reciente a la más antigua. */
	const documentosGenerados = $derived(detalle?.documentos_generados ?? []);
	/** `true` si guardar con el estado elegido emitirá una versión nueva. */
	const emiteVersionDocumental = $derived(
		documentosGenerados.length > 0 && DECISIONES_FINALES.includes(editEstado)
	);

	let descargandoVersion = $state<Record<string, boolean>>({});

	async function handleDescargarVersion(documentoId: string, version: number) {
		if (!detalle) return;
		descargandoVersion = { ...descargandoVersion, [documentoId]: true };
		try {
			const filename = await sarlaftAPI.descargarVersionDocumental(
				detalle.id,
				documentoId,
				`${detalle.radicado}_v${version}.pdf`
			);
			toast.success(`Documento descargado: ${filename}`);
		} catch (err: any) {
			toast.error(
				`Error al descargar la versión ${version}: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`
			);
		} finally {
			descargandoVersion = { ...descargandoVersion, [documentoId]: false };
		}
	}

	/** Etiqueta legible del canal de entrega. */
	const CANAL_LABELS: Record<string, string> = {
		email_declarante: 'Copia al declarante',
		email_interno: 'Notificación interna',
		descarga: 'Enlace de descarga'
	};

	function formatBytes(bytes: number | string): string {
		const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(2)} MB`;
	}

	function formatFecha(iso: string | null | undefined): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatFechaLarga(iso: string | null | undefined): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	function tiempoRelativo(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const min = Math.floor(diff / 60000);
		if (min < 1) return 'hace un momento';
		if (min < 60) return `hace ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `hace ${h} h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `hace ${d} d`;
		return formatFechaLarga(iso);
	}

	/// `page` de `$app/state` (no el store legacy de `$app/stores`, que no
	/// propaga bien en modo runes). Solo el id suscribe el efecto.
	$effect(() => {
		const id = page.params.id;
		if (id) untrack(() => load(id));
	});
</script>

<svelte:head>
	<title>{detalle ? `${detalle.radicado} · SARLAFT` : 'Cargando…'}</title>
</svelte:head>

{#if isLoading}
	<CargaMascota tamano="pantalla" texto="Cargando el formulario…" />
{:else if error || !detalle}
	{@const img = mascota('advertencia')}
	<div class="dir-pagina sl-pagina" in:fade={{ duration: 300 }}>
		<div class="page-card">
			<div class="dir-vacio">
				<img src={img.src} alt={img.alt} width="418" height="418" />
				<h3>No pudimos cargar el formulario</h3>
				<p>{error ?? 'Formulario no encontrado.'}</p>
				<div class="sl-error-acciones">
					<button
						type="button"
						class="btn-secondary"
						onclick={() => page.params.id && load(page.params.id)}
					>
						Reintentar
					</button>
					<button type="button" class="btn-primary" onclick={volver}>Volver al listado</button>
				</div>
			</div>
		</div>
	</div>
{:else}
	{@const estado = ESTADO_LABELS[detalle.estado]}
	<!-- Cáscara de los directorios (`dir-*` de app.css), como el detalle de
	     asistencias: volver, etiquetas, título, datos y cifras en la cabecera;
	     las descargas, en sus acciones. -->
	<div class="dir-pagina sl-pagina" in:fade={{ duration: 300 }}>
		<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
			<div class="dir-cabecera-texto">
				<button type="button" class="sl-volver" onclick={volver}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.4">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
					</svg>
					SARLAFT
				</button>
				<div class="sl-etiquetas">
					<span class="radicado-pill">{detalle.radicado}</span>
					<span class="codigo-pill">{detalle.codigo_formulario} · v{detalle.version}</span>
					<span
						class="estado-pill"
						style="background-color: {estado.bg}; color: {estado.color}; border-color: {estado.border}"
					>
						<span class="estado-dot" style="background-color: {estado.dot}"></span>
						{estado.label}
					</span>
				</div>
				<h1 class="dir-titulo">{detalle.nombre_completo ?? 'Sin nombre'}</h1>
				<p class="dir-desc sl-meta">
					<span class="meta-item">{TIPO_FORMULARIO_LABELS[detalle.tipo_formulario]}</span>
					{#if tipoCliente}
						<span class="meta-item">{tipoCliente}</span>
					{/if}
					{#if detalle.numero_documento}
						<span class="meta-item"
							>{detalle.tipo_documento ?? 'Doc'}: {detalle.numero_documento}</span
						>
					{/if}
					{#if detalle.correo}
						<a href={`mailto:${detalle.correo}`} class="meta-item meta-item--link">
							{detalle.correo}
						</a>
					{/if}
					{#if detalle.telefono}
						<span class="meta-item">{detalle.telefono}</span>
					{/if}
				</p>
				<div class="dir-conteos">
					<ResumenConteos conteos={conteosResumen} />
				</div>
			</div>

			<div class="dir-cabecera-acciones">
				<button
					type="button"
					class="btn-secondary"
					onclick={handleDescargarPDF}
					disabled={downloadingPdf}
					title="PDF con las respuestas y la firma"
				>
					{#if downloadingPdf}
						<span class="sl-giro" aria-hidden="true"></span>
						Generando…
					{:else}
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
							/>
						</svg>
						Descargar PDF
					{/if}
				</button>
				<button
					type="button"
					class="btn-secondary"
					onclick={handleDescargarZip}
					disabled={downloadingZip}
					title="ZIP con todo: el PDF y los adjuntos originales"
				>
					{#if downloadingZip}
						<span class="sl-giro" aria-hidden="true"></span>
						Empaquetando…
					{:else}
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
							/>
						</svg>
						Descargar ZIP
					{/if}
				</button>
			</div>
		</header>

		<!-- Dos columnas fluidas, sin punto de ruptura: el lateral pide 22rem y
		     las respuestas 34rem; cuando no caben las dos, el lateral baja solo.
		     Antes era un `@media (min-width: 1024px)` atado al viewport, que no
		     se entera de si la barra lateral del dashboard está abierta. -->
		<div class="sl-columnas">
			<section class="sl-principal">
				<header class="sl-principal-cab">
					<span class="sl-eyebrow">Snapshot del formulario</span>
					<h2>Respuestas del titular</h2>
					<p>
						Información capturada al momento del envío. Solo lectura, refleja la versión final
						radicada.
					</p>
				</header>
				<div class="respuestas-wrap" in:fade={{ duration: 400, delay: 100 }}>
					<SarlaftRespuestas
						respuestas={detalle.respuestas}
						{tipoCliente}
						tipoFormulario={detalle.tipo_formulario}
						definicion={detalle.definicion}
					/>
				</div>
			</section>

			<!-- Lateral: anexos, documento controlado, evaluación, canal y trazabilidad -->
			<aside class="sl-lateral">
				<!-- Documentos -->
				<section
					class="page-card sl-tarjeta"
					in:fly={{ y: 12, duration: 320, delay: 40, easing: quintOut }}
				>
					<header class="sl-tarjeta-cab">
						<div>
							<span class="sl-eyebrow">Anexos</span>
							<h3>Documentos adjuntos</h3>
						</div>
						<span class="badge-count">
							{detalle.documentos?.length ?? 0}
						</span>
					</header>
					<div class="sl-tarjeta-cuerpo">
						{#if detalle.documentos && detalle.documentos.length > 0}
							<div class="docs-list">
								{#each detalle.documentos as doc (doc.id)}
									<button
										type="button"
										onclick={() => descargar(doc.id, doc.nombre_archivo)}
										disabled={downloading[doc.id]}
										class="doc-row"
									>
										<div class="doc-icon" aria-hidden="true">
											{#if doc.mime_type === 'application/pdf'}
												<svg
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
													/>
												</svg>
											{:else}
												<svg
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h15a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v10.5A2.25 2.25 0 006 18.75z"
													/>
												</svg>
											{/if}
										</div>
										<div class="doc-info">
											<p class="doc-tipo">
												{TIPO_DOCUMENTO_LABELS[doc.tipo_documento] ?? doc.tipo_documento}
											</p>
											<p class="doc-name">{doc.nombre_archivo}</p>
											<p class="doc-meta">
												<span>{formatBytes(doc.tamano_bytes)}</span>
												<span class="doc-sep">·</span>
												<span>{formatFecha(doc.created_at)}</span>
											</p>
										</div>
										<div class="doc-action" aria-hidden="true">
											{#if downloading[doc.id]}
												<span class="sl-giro"></span>
											{:else}
												<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
													/>
												</svg>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						{:else}
							<p class="sl-vacio-mini">No hay documentos adjuntos.</p>
						{/if}
					</div>
				</section>

				<!-- Documento generado sobre el formato controlado de la marca.
				     Solo aparece en los formatos que lo producen; los otros
				     cuatro siguen mostrando únicamente el PDF de respuestas. -->
				{#if documentosGenerados.length > 0}
					<section
						class="page-card sl-tarjeta"
						in:fly={{ y: 12, duration: 320, delay: 80, easing: quintOut }}
					>
						<header class="sl-tarjeta-cab">
							<div>
								<span class="sl-eyebrow">Formato controlado</span>
								<h3>Documento generado</h3>
							</div>
							<span class="badge-count">{documentosGenerados.length}</span>
						</header>
						<div class="sl-tarjeta-cuerpo">
							<ul class="version-list">
								{#each documentosGenerados as doc (doc.id)}
									<li class="version-item">
										<div class="version-head">
											<span class="version-num">Versión {doc.version_documento}</span>
											<span
												class="version-estado"
												class:version-recibida={doc.estado_documental === 'recibida'}
												class:version-evaluada={doc.estado_documental === 'evaluada'}
											>
												{doc.estado_documental === 'recibida' ? 'Recibida' : 'Evaluada'}
											</span>
										</div>
										<dl class="version-meta">
											<div>
												<dt>Formato</dt>
												<dd>{doc.codigo_template} v{doc.version_template}</dd>
											</div>
											<div>
												<dt>Tamaño</dt>
												<dd>{formatBytes(doc.tamano_bytes)}</dd>
											</div>
											<div>
												<dt>Emitida</dt>
												<dd>{formatFecha(doc.created_at)}</dd>
											</div>
											{#if doc.generado_por}
												<div>
													<dt>Por</dt>
													<dd>{doc.generado_por.nombre}</dd>
												</div>
											{/if}
										</dl>
										<div class="version-hash">
											<span class="hash-label">SHA-256 del PDF</span>
											<code>{doc.pdf_sha256}</code>
										</div>

										{#if doc.entregas.length > 0}
											<ul class="entrega-list">
												{#each doc.entregas as e (e.id)}
													<li class="entrega-item">
														<span class="entrega-canal">{CANAL_LABELS[e.canal] ?? e.canal}</span>
														<span class="entrega-estado entrega-{e.estado}">{e.estado}</span>
														{#if e.destinatario}
															<span class="entrega-dest">{e.destinatario}</span>
														{/if}
														{#if e.provider_message_id}
															<span class="entrega-msgid" title="Provider message ID">
																{e.provider_message_id}
															</span>
														{/if}
														{#if e.error_codigo}
															<span class="entrega-error">{e.error_codigo}</span>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}

										<button
											type="button"
											class="btn-secondary sl-boton-version"
											disabled={descargandoVersion[doc.id]}
											onclick={() => handleDescargarVersion(doc.id, doc.version_documento)}
										>
											{descargandoVersion[doc.id] ? 'Descargando…' : 'Descargar esta versión'}
										</button>
									</li>
								{/each}
							</ul>
							<p class="version-nota">
								Cada versión es inmutable. La versión 1 es la que recibió y firmó el declarante;
								cada decisión final emite una nueva sin modificar las anteriores.
							</p>
						</div>
					</section>
				{/if}

				<!-- Evaluación interna -->
				<section
					class="page-card sl-tarjeta"
					in:fly={{ y: 12, duration: 320, delay: 120, easing: quintOut }}
				>
					<header class="sl-tarjeta-cab">
						<div>
							<span class="sl-eyebrow">Concepto del Oficial</span>
							<h3>Evaluación interna</h3>
						</div>
						{#if detalle.evaluado_por}
							<span class="evaluado-por">
								por <strong>{detalle.evaluado_por.nombre}</strong>
							</span>
						{/if}
					</header>
					<div class="sl-tarjeta-cuerpo">
						<div class="eval-form">
							<div class="field">
								<label for="eval-estado" class="field-label">Estado</label>
								<select id="eval-estado" bind:value={editEstado} class="campo">
									<option value="">— Seleccionar —</option>
									<option value="recibido">Recibido</option>
									<option value="en_revision">En revisión</option>
									<option value="aprobado">Aprobado</option>
									<option value="condicionado">Condicionado</option>
									<option value="rechazado">Rechazado</option>
									<option value="escalado">Escalado</option>
								</select>
							</div>
							<div class="field">
								<label for="eval-concepto" class="field-label">Concepto técnico</label>
								<input
									id="eval-concepto"
									type="text"
									bind:value={editConcepto}
									placeholder="Ej. Validación satisfactoria"
									class="campo"
								/>
							</div>
							<div class="field">
								<label for="eval-observaciones" class="field-label">Observaciones</label>
								<textarea
									id="eval-observaciones"
									bind:value={editObservaciones}
									rows="3"
									placeholder="Notas para el expediente, alertas, próximos pasos…"
									class="campo campo--texto"
								></textarea>
							</div>

							{#if detalle.evaluado_at}
								<div class="eval-meta">
									<svg
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<span>Última evaluación: <strong>{formatFecha(detalle.evaluado_at)}</strong></span
									>
								</div>
							{/if}

							{#if emiteVersionDocumental}
								<p class="eval-aviso">
									Al guardar se emitirá una versión documental nueva con este resultado marcado. La
									versión recibida no se modifica.
								</p>
							{/if}

							<button
								type="button"
								class="btn-primary sl-bloque"
								disabled={saving || !editEstado}
								onclick={guardarEvaluacion}
							>
								{#if saving}
									<span class="sl-giro" aria-hidden="true"></span>
									Guardando…
								{:else}
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M4.5 12.75l6 6 9-13.5"
										/>
									</svg>
									Guardar evaluación
								{/if}
							</button>
						</div>
					</div>
				</section>

				<!-- Canal de notificación: a quién se avisó del radicado. Antes iba
				     dentro de «Exportar», que ahora son los botones de la cabecera. -->
				{#if contacto}
					<section
						class="page-card sl-tarjeta"
						in:fly={{ y: 12, duration: 320, delay: 160, easing: quintOut }}
					>
						<header class="sl-tarjeta-cab">
							<div>
								<span class="sl-eyebrow">Notificación</span>
								<h3>Canal de notificación</h3>
							</div>
						</header>
						<div class="sl-tarjeta-cuerpo">
							<p class="contacto-texto">
								Se notificó a <strong>{contacto.area_responsable}</strong>
								{#if contacto.emails.length > 0}
									(<span>{contacto.emails.join(', ')}</span>)
								{/if}
							</p>
							<div class="contacto-actions">
								<a class="contacto-link" href={telLink(contacto)} aria-label="Llamar al área">
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
										/>
									</svg>
									{contacto.telefono_principal}
								</a>
								<a
									class="contacto-link"
									href={waLink(contacto)}
									target="_blank"
									rel="noopener noreferrer"
									aria-label="Contactar por WhatsApp"
								>
									<svg fill="currentColor" viewBox="0 0 24 24" stroke="none">
										<path
											d="M20.52 3.48A11.93 11.93 0 0012 0C5.37 0 0 5.37 0 12a11.94 11.94 0 001.64 6L0 24l6.18-1.62A11.93 11.93 0 0012 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52zM12 22a9.94 9.94 0 01-5.07-1.39l-.36-.21-3.67.96.98-3.58-.23-.37A9.94 9.94 0 0112 22zm5.51-7.46c-.3-.15-1.78-.88-2.05-.98s-.47-.15-.67.15-.77.98-.95 1.18-.35.22-.65.07a8.18 8.18 0 01-2.41-1.49 9.06 9.06 0 01-1.67-2.08c-.17-.3 0-.46.13-.61s.3-.35.45-.52.2-.3.3-.5.05-.37-.02-.52-.67-1.62-.92-2.22-.49-.51-.67-.52H7.43a1.16 1.16 0 00-.85.4 3.55 3.55 0 00-1.1 2.64c0 1.55 1.13 3.05 1.29 3.27s2.22 3.4 5.4 4.77a18.5 18.5 0 001.8.67 4.34 4.34 0 002 .13 3.27 3.27 0 002.15-1.52 2.66 2.66 0 00.19-1.52c-.08-.13-.28-.21-.58-.36z"
										/>
									</svg>
									WhatsApp
								</a>
								<a
									class="contacto-link"
									href={mailtoLink(contacto)}
									aria-label="Enviar correo al área"
								>
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
										/>
									</svg>
									Correo
								</a>
							</div>
						</div>
					</section>
				{/if}

				<!-- Metadata técnica -->
				<details
					class="page-card sl-tarjeta sl-tarjeta--meta"
					in:fly={{ y: 12, duration: 320, delay: 200, easing: quintOut }}
				>
					<summary class="sl-tarjeta-cab sl-tarjeta-cab--resumen">
						<div>
							<span class="sl-eyebrow">Trazabilidad</span>
							<h3>Detalles técnicos</h3>
						</div>
						<svg
							class="chevron"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19.5 8.25l-7.5 7.5-7.5-7.5"
							/>
						</svg>
					</summary>
					<div class="sl-tarjeta-cuerpo">
						<dl class="tech-list">
							{#if detalle.ip_origen}
								<div>
									<dt>IP de origen</dt>
									<dd>{detalle.ip_origen}</dd>
								</div>
							{/if}
							{#if detalle.user_agent}
								<div>
									<dt>User-Agent</dt>
									<dd class="ua">{detalle.user_agent}</dd>
								</div>
							{/if}
							{#if detalle.referer}
								<div>
									<dt>Referer</dt>
									<dd class="ua">{detalle.referer}</dd>
								</div>
							{/if}
							<div>
								<dt>ID interno</dt>
								<dd class="tech-id">{detalle.id}</dd>
							</div>
						</dl>
					</div>
				</details>
			</aside>
		</div>
	</div>
{/if}

<style>
	/* La ficha crece con su contenido y la página desplaza entera: el
	   `height: 100%` de `.dir-pagina` es para listados con scroll propio. */
	.sl-pagina {
		height: auto;
		min-height: 100%;
	}

	.sl-error-acciones {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	/* ═══ Cabecera ═══ */
	.sl-volver {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		width: fit-content;
		margin-bottom: 0.25rem;
		padding: 0;
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-muted);
		cursor: pointer;
	}
	.sl-volver:hover {
		color: var(--emerald-500);
	}
	.sl-volver svg {
		width: 16px;
		height: 16px;
	}
	.sl-etiquetas {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.radicado-pill {
		display: inline-flex;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--emerald-700);
		background: var(--au-tint);
		padding: 0.22rem 0.6rem;
		border-radius: 6px;
		letter-spacing: 0.04em;
	}
	.codigo-pill {
		display: inline-flex;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		padding: 0.2rem 0.55rem;
		border-radius: 6px;
		letter-spacing: 0.04em;
	}
	/* Pastilla del estado: es un semáforo, sus colores vienen de
	   `ESTADO_LABELS` y no de la marca. */
	.estado-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.22rem 0.55rem;
		border-radius: 6px;
		border: 1px solid;
	}
	.estado-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	/* Datos del declarante: separados por un punto que pone el CSS, así no
	   queda un «·» colgando al final de la línea cuando envuelven. */
	.sl-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem 0;
	}
	.meta-item {
		display: inline-flex;
		align-items: center;
	}
	.meta-item + .meta-item::before {
		content: '·';
		margin: 0 0.45rem;
		color: var(--text-very-muted);
	}
	.meta-item--link {
		color: var(--emerald-500);
		text-decoration: none;
	}
	.meta-item--link:hover {
		text-decoration: underline;
	}

	/* ═══ Columnas ═══ */
	.sl-columnas {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 1.25rem;
	}
	/* El 999 hace que todo el espacio sobrante vaya a las respuestas y el
	   lateral se quede en su base mientras quepan las dos columnas. */
	.sl-principal {
		flex: 999 1 34rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sl-lateral {
		flex: 1 1 22rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sl-principal-cab h2 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--text-primary);
		margin: 0.3rem 0 0.2rem;
	}
	/* Texto corrido: tope de legibilidad, no de página. */
	.sl-principal-cab p {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
		max-width: 44rem;
		line-height: 1.5;
	}
	.respuestas-wrap {
		display: flex;
		flex-direction: column;
	}

	.sl-eyebrow {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--emerald-500);
	}

	/* ═══ Tarjetas del lateral ═══ */
	.sl-tarjeta {
		padding: 0;
		overflow: hidden;
	}
	.sl-tarjeta-cab {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem 1.25rem 0.85rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.sl-tarjeta-cab h3 {
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--text-primary);
		margin: 0.2rem 0 0;
	}
	.sl-tarjeta-cab--resumen {
		cursor: pointer;
		list-style: none;
		user-select: none;
		border-bottom: none;
	}
	.sl-tarjeta-cab--resumen::-webkit-details-marker {
		display: none;
	}
	.sl-tarjeta-cab--resumen:hover {
		background: var(--bg-base);
	}
	details[open] .sl-tarjeta-cab--resumen {
		border-bottom: 1px solid var(--border-subtle);
	}
	.chevron {
		width: 16px;
		height: 16px;
		color: var(--text-muted);
		transition: transform 0.2s;
		flex-shrink: 0;
		align-self: center;
	}
	details[open] .chevron {
		transform: rotate(180deg);
	}
	.sl-tarjeta-cuerpo {
		padding: 1rem 1.25rem 1.25rem;
	}
	.evaluado-por {
		font-size: 0.72rem;
		color: var(--text-muted);
		text-align: right;
	}
	.evaluado-por strong {
		color: var(--text-primary);
		font-weight: 700;
	}
	.badge-count {
		display: inline-flex;
		align-items: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--emerald-700);
		background: var(--au-tint);
		padding: 0.22rem 0.6rem;
		border-radius: 999px;
	}
	.sl-vacio-mini {
		margin: 0;
		padding: 1rem;
		text-align: center;
		font-size: 0.8rem;
		color: var(--text-muted);
		background: var(--bg-base);
		border: 1px dashed var(--border-default);
		border-radius: 12px;
	}

	/* Giro pequeño DENTRO de un botón mientras trabaja (descargas y
	   guardado): toma el color del texto, así sirve en las dos marcas. */
	.sl-giro {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: sl-girar 0.8s linear infinite;
	}
	@keyframes sl-girar {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sl-giro {
			animation-duration: 2.4s;
		}
	}

	/* ═══ Documentos adjuntos ═══ */
	.docs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.doc-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.7rem 0.8rem;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		transition:
			background-color 0.15s,
			border-color 0.15s;
	}
	.doc-row:hover:not(:disabled) {
		background: var(--bg-surface);
		border-color: var(--emerald-500);
	}
	.doc-row:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	/* Icono de archivo en rojo: es el color del tipo de documento, no de la
	   marca, y se queda igual en las dos empresas. */
	.doc-icon {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: rgba(239, 68, 68, 0.08);
		color: #dc2626;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.doc-icon svg {
		width: 18px;
		height: 18px;
	}
	.doc-info {
		flex: 1;
		min-width: 0;
	}
	.doc-tipo {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.1rem;
	}
	.doc-name {
		font-size: 0.72rem;
		color: var(--text-secondary);
		margin: 0 0 0.15rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-meta {
		font-size: 0.68rem;
		color: var(--text-muted);
		margin: 0;
	}
	.doc-sep {
		margin: 0 0.3rem;
		color: var(--text-very-muted);
	}
	.doc-action {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--emerald-500);
	}
	.doc-action svg {
		width: 14px;
		height: 14px;
	}

	/* ═══ Versiones documentales (declaración de empresa de transporte) ═══ */
	.version-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.version-item {
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 12px 14px;
	}
	.version-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}
	.version-num {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	/* Semáforo documental: azul recibida, violeta evaluada. Hex a propósito,
	   iguales en las dos marcas. */
	.version-estado {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 3px 8px;
		border-radius: 999px;
	}
	.version-recibida {
		background: #eff6ff;
		color: #1e3a8a;
		border: 1px solid #bfdbfe;
	}
	.version-evaluada {
		background: #f5f3ff;
		color: #5b21b6;
		border: 1px solid #ddd6fe;
	}
	.version-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 6px 10px;
		margin: 0 0 8px;
	}
	.version-meta dt {
		font-size: 0.68rem;
		color: var(--text-muted);
	}
	.version-meta dd {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.version-hash {
		margin-bottom: 8px;
	}
	.hash-label {
		display: block;
		font-size: 0.68rem;
		color: var(--text-muted);
		margin-bottom: 2px;
	}
	.version-hash code {
		font-size: 0.64rem;
		word-break: break-all;
		line-height: 1.4;
	}
	.entrega-list {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.entrega-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 0.7rem;
	}
	.entrega-canal {
		font-weight: 600;
	}
	.entrega-estado {
		padding: 1px 6px;
		border-radius: 999px;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.6rem;
		letter-spacing: 0.04em;
	}
	.entrega-enviado,
	.entrega-descargado {
		background: #f0fdf4;
		color: #14532d;
	}
	.entrega-pendiente {
		background: #fffbeb;
		color: #92400e;
	}
	.entrega-fallido,
	.entrega-revocado {
		background: #fef2f2;
		color: #991b1b;
	}
	.entrega-dest,
	.entrega-msgid {
		color: var(--text-muted);
		font-size: 0.64rem;
		word-break: break-all;
	}
	.entrega-error {
		color: #991b1b;
		font-weight: 600;
	}
	.version-nota {
		font-size: 0.7rem;
		color: var(--text-muted);
		margin: 10px 0 0;
	}
	.sl-boton-version {
		width: 100%;
		min-height: 38px;
		font-size: 0.8rem;
	}

	/* ═══ Evaluación ═══ */
	.eval-form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field-label {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.campo {
		width: 100%;
		min-height: 42px;
		padding: 0.55rem 0.85rem;
		font-family: inherit;
		font-size: 0.85rem;
		color: var(--text-primary);
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		outline: none;
		box-sizing: border-box;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.campo::placeholder {
		color: var(--text-very-muted);
	}
	.campo:focus {
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--emerald-500) 15%, transparent);
	}
	.campo--texto {
		resize: vertical;
		line-height: 1.5;
	}
	.eval-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.75rem;
		background: var(--au-tint);
		border-radius: 10px;
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
	.eval-meta svg {
		width: 14px;
		height: 14px;
		color: var(--emerald-500);
		flex-shrink: 0;
	}
	.eval-meta strong {
		font-weight: 700;
		color: var(--text-primary);
	}
	/* Aviso en ámbar: semáforo, igual en las dos marcas. */
	.eval-aviso {
		font-size: 0.72rem;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 8px 10px;
		margin: 0;
	}
	.sl-bloque {
		width: 100%;
	}

	/* ═══ Canal de notificación ═══ */
	.contacto-texto {
		font-size: 0.8rem;
		color: var(--text-secondary);
		line-height: 1.55;
		margin: 0 0 0.7rem;
		word-break: break-word;
	}
	.contacto-texto strong {
		color: var(--text-primary);
		font-weight: 700;
	}
	.contacto-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.contacto-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--text-primary);
		text-decoration: none;
		font-size: 0.76rem;
		font-weight: 700;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}
	.contacto-link:hover {
		border-color: var(--emerald-500);
		background: var(--bg-base);
	}
	.contacto-link svg {
		width: 14px;
		height: 14px;
		color: var(--emerald-500);
	}

	/* ═══ Detalles técnicos ═══ */
	.sl-tarjeta--meta {
		box-shadow: none;
	}
	.tech-list {
		display: flex;
		flex-direction: column;
		margin: 0;
	}
	.tech-list > div {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-subtle);
	}
	.tech-list > div:last-child {
		border-bottom: none;
	}
	.tech-list dt {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.tech-list dd {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-primary);
		word-break: break-all;
	}
	.tech-list dd.ua {
		font-size: 0.72rem;
		line-height: 1.5;
	}
	.tech-id {
		font-size: 0.7rem;
		color: var(--text-muted);
	}
</style>
