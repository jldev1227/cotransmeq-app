<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
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
	import { toast } from 'svelte-sonner';

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

	async function load(id: string) {
		isLoading = true;
		error = null;
		try {
			const fetched = await sarlaftAPI.obtenerDetalle(id);
			detalle = fetched;
			editEstado = fetched.estado;
			editConcepto = fetched.evaluacion_concepto ?? '';
			editObservaciones = fetched.evaluacion_observaciones ?? '';
		} catch (err: any) {
			error = err?.response?.data?.error || err?.message || 'Error al cargar el detalle';
			if (error) toast.error(error);
		} finally {
			isLoading = false;
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
			toast.error(`Error al descargar ${nombre}: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`);
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
			toast.error(`Error al descargar PDF: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`);
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
			toast.error(`Error al descargar evidencia: ${err?.response?.data?.error || err?.message || 'Error desconocido'}`);
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
			const etiqueta =
				ESTADO_LABELS[editEstado as EstadoSarlaft]?.label ?? editEstado;
			const versionNueva = (detalle.documentos_generados?.length ?? 0) + 1;
			const ok = confirm(
				`Vas a registrar el resultado "${etiqueta}" del radicado ${detalle.radicado}.\n\n` +
					`Se emitirá la versión documental ${versionNueva} del formato, con esa casilla marcada. ` +
					`La versión recibida no se modifica.\n\n¿Continuar?`
			);
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

	$effect(() => {
		const id = $page.params.id;
		if (id) load(id);
	});
</script>

<svelte:head>
	<title>{detalle ? `${detalle.radicado} · SARLAFT` : 'Cargando…'}</title>
</svelte:head>

<div class="sarlaft-page" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
	<!-- Back link -->
	<button class="back-link" onclick={() => goto('/dashboard/sarlaft')}>
		<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
		</svg>
		Volver al listado
	</button>

	{#if isLoading}
		<div class="state-block" in:fade>
			<div class="spin-ring" aria-hidden="true"></div>
			<p>Cargando detalle del formulario…</p>
		</div>
	{:else if error || !detalle}
		<div class="alert alert-error" in:fade>
			<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
			</svg>
			<div class="alert-body">
				<strong>No pudimos cargar el detalle.</strong>
				<span>{error ?? 'Formulario no encontrado.'}</span>
			</div>
			<button class="btn-secondary btn-secondary--sm" onclick={() => $page.params.id && load($page.params.id)}>
				Reintentar
			</button>
		</div>
	{:else}
		{@const estado = ESTADO_LABELS[detalle.estado]}

		<!-- ═══ HERO DEL FORMULARIO ═══ -->
		<header class="page-hero" in:fade={{ duration: 400 }}>
			<div class="hero-top">
				<div class="hero-left">
					<div class="card-icon hero-icon" aria-hidden="true">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
					</div>
					<div class="hero-text">
						<div class="hero-tags">
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
						<h1>{detalle.nombre_completo ?? 'Sin nombre'}</h1>
						<div class="hero-meta">
							<span class="meta-item">
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12a8.25 8.25 0 1016.5 0 8.25 8.25 0 00-16.5 0zM12 6v6l3.75 2.25" />
								</svg>
								{TIPO_FORMULARIO_LABELS[detalle.tipo_formulario]}
							</span>
							{#if tipoCliente}
								<span class="meta-sep">·</span>
								<span class="meta-item">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
									</svg>
									{tipoCliente}
								</span>
							{/if}
							{#if detalle.numero_documento}
								<span class="meta-sep">·</span>
								<span class="meta-item">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0z" />
									</svg>
									<span class="mono">{detalle.tipo_documento ?? 'Doc'}: {detalle.numero_documento}</span>
								</span>
							{/if}
							{#if detalle.correo}
								<span class="meta-sep">·</span>
								<a href={`mailto:${detalle.correo}`} class="meta-item meta-item--link">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
									</svg>
									{detalle.correo}
								</a>
							{/if}
							{#if detalle.telefono}
								<span class="meta-sep">·</span>
								<span class="meta-item">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
									</svg>
									<span class="mono">{detalle.telefono}</span>
								</span>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Stats inline -->
			<div class="hero-stats">
				<div class="stat-item">
					<span class="stat-label">Secciones</span>
					<span class="stat-value">{detallesResumen.secciones}</span>
				</div>
				<span class="stat-sep">·</span>
				<div class="stat-item">
					<span class="stat-label">Campos</span>
					<span class="stat-value">{detallesResumen.campos}</span>
				</div>
				<span class="stat-sep">·</span>
				<div class="stat-item">
					<span class="stat-label">Tablas</span>
					<span class="stat-value">{detallesResumen.tablas}</span>
				</div>
				<span class="stat-sep">·</span>
				<div class="stat-item">
					<svg class="h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
					</svg>
					<span class="stat-label">Documentos</span>
					<span class="stat-value">{detallesResumen.docs}</span>
				</div>
				<span class="stat-sep">·</span>
				<div class="stat-item">
					<svg class="h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
					</svg>
					<span class="stat-label">Enviado</span>
					<span class="stat-value stat-value--text">{tiempoRelativo(detalle.fecha_envio)}</span>
				</div>
			</div>
		</header>

		<!-- ═══ LAYOUT 2 COLUMNAS ═══ -->
		<div class="layout-grid">
			<!-- COL IZQ: Respuestas -->
			<section class="col-main">
				<header class="col-head">
					<div>
						<span class="eyebrow">Snapshot del formulario</span>
						<h2>Respuestas del titular</h2>
						<p>Información capturada al momento del envío. Solo lectura, refleja la versión final radicada.</p>
					</div>
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

			<!-- COL DER: Sidebar con documentos + evaluación + metadata -->
			<aside class="col-side">
				<!-- Exportar / Descargar -->
				<section class="side-card" in:fly={{ y: 12, duration: 320, delay: 40, easing: quintOut }}>
					<header class="side-head">
						<div>
							<span class="eyebrow">Exportar</span>
							<h3>Descargar evidencia</h3>
						</div>
					</header>
					<div class="side-body">
						<p class="side-help">
							Genera el PDF con las respuestas + firma, o descarga un ZIP con todo (PDF + adjuntos originales).
						</p>
						<div class="export-grid">
							<button
								type="button"
								class="export-btn"
								onclick={handleDescargarPDF}
								disabled={downloadingPdf}
							>
								{#if downloadingPdf}
									<div class="spin-ring spin-ring--sm"></div>
									Generando…
								{:else}
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
										<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
									</svg>
									Descargar PDF
								{/if}
							</button>
							<button
								type="button"
								class="export-btn export-btn--zip"
								onclick={handleDescargarZip}
								disabled={downloadingZip}
							>
								{#if downloadingZip}
									<div class="spin-ring spin-ring--sm"></div>
									Empaquetando…
								{:else}
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
										<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
									</svg>
									Descargar ZIP
								{/if}
							</button>
						</div>
						{#if contacto}
							<div class="export-contacto">
								<span class="eyebrow eyebrow--mini">Canal de notificación</span>
								<p class="contacto-texto">
									Se notificó a <strong>{contacto.area_responsable}</strong>
									{#if contacto.emails.length > 0}
										(<span class="mono">{contacto.emails.join(', ')}</span>)
									{/if}
								</p>
								<div class="contacto-actions">
									<a class="contacto-link" href={telLink(contacto)} aria-label="Llamar al área">
										<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
										</svg>
										{contacto.telefono_principal}
									</a>
									<a class="contacto-link" href={waLink(contacto)} target="_blank" rel="noopener noreferrer" aria-label="Contactar por WhatsApp">
										<svg fill="currentColor" viewBox="0 0 24 24" stroke="none">
											<path d="M20.52 3.48A11.93 11.93 0 0012 0C5.37 0 0 5.37 0 12a11.94 11.94 0 001.64 6L0 24l6.18-1.62A11.93 11.93 0 0012 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.19-3.48-8.52zM12 22a9.94 9.94 0 01-5.07-1.39l-.36-.21-3.67.96.98-3.58-.23-.37A9.94 9.94 0 0112 22zm5.51-7.46c-.3-.15-1.78-.88-2.05-.98s-.47-.15-.67.15-.77.98-.95 1.18-.35.22-.65.07a8.18 8.18 0 01-2.41-1.49 9.06 9.06 0 01-1.67-2.08c-.17-.3 0-.46.13-.61s.3-.35.45-.52.2-.3.3-.5.05-.37-.02-.52-.67-1.62-.92-2.22-.49-.51-.67-.52H7.43a1.16 1.16 0 00-.85.4 3.55 3.55 0 00-1.1 2.64c0 1.55 1.13 3.05 1.29 3.27s2.22 3.4 5.4 4.77a18.5 18.5 0 001.8.67 4.34 4.34 0 002 .13 3.27 3.27 0 002.15-1.52 2.66 2.66 0 00.19-1.52c-.08-.13-.28-.21-.58-.36z"/>
										</svg>
										WhatsApp
									</a>
									<a class="contacto-link" href={mailtoLink(contacto)} aria-label="Enviar correo al área">
										<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
										</svg>
										Correo
									</a>
								</div>
							</div>
						{/if}
					</div>
				</section>

				<!-- Documentos -->
				<section class="side-card" in:fly={{ y: 12, duration: 320, delay: 80, easing: quintOut }}>
					<header class="side-head">
						<div>
							<span class="eyebrow">Anexos</span>
							<h3>Documentos adjuntos</h3>
						</div>
						<span class="badge-count">
							{detalle.documentos?.length ?? 0}
						</span>
					</header>
					<div class="side-body">
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
												<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
													<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
												</svg>
											{:else}
												<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
													<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M2.25 18.75h15a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v10.5A2.25 2.25 0 006 18.75z" />
												</svg>
											{/if}
										</div>
										<div class="doc-info">
											<p class="doc-tipo">{TIPO_DOCUMENTO_LABELS[doc.tipo_documento] ?? doc.tipo_documento}</p>
											<p class="doc-name mono">{doc.nombre_archivo}</p>
											<p class="doc-meta">
												<span class="mono">{formatBytes(doc.tamano_bytes)}</span>
												<span class="doc-sep">·</span>
												<span>{formatFecha(doc.created_at)}</span>
											</p>
										</div>
										<div class="doc-action" aria-hidden="true">
											{#if downloading[doc.id]}
												<div class="spin-ring spin-ring--sm"></div>
											{:else}
												<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
													<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
												</svg>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						{:else}
							<div class="empty-mini">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.4">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25M9.75 9h4.5m-4.5 3.75h4.5M9.75 16.5h4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<p>No hay documentos adjuntos</p>
							</div>
						{/if}
					</div>
				</section>

				<!-- Documento generado sobre el formato controlado de la marca.
				     Solo aparece en los formatos que lo producen; los otros
				     cuatro siguen mostrando únicamente el PDF de respuestas. -->
				{#if documentosGenerados.length > 0}
					<section class="side-card" in:fly={{ y: 12, duration: 320, delay: 120, easing: quintOut }}>
						<header class="side-head">
							<div>
								<span class="eyebrow">Formato controlado</span>
								<h3>Documento generado</h3>
							</div>
							<span class="badge-count">{documentosGenerados.length}</span>
						</header>
						<div class="side-body">
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
											<code class="mono">{doc.pdf_sha256}</code>
										</div>

										{#if doc.entregas.length > 0}
											<ul class="entrega-list">
												{#each doc.entregas as e (e.id)}
													<li class="entrega-item">
														<span class="entrega-canal">{CANAL_LABELS[e.canal] ?? e.canal}</span>
														<span class="entrega-estado entrega-{e.estado}">{e.estado}</span>
														{#if e.destinatario}
															<span class="entrega-dest mono">{e.destinatario}</span>
														{/if}
														{#if e.provider_message_id}
															<span class="entrega-msgid mono" title="Provider message ID">
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
											class="btn-ghost btn-block"
											disabled={descargandoVersion[doc.id]}
											onclick={() => handleDescargarVersion(doc.id, doc.version_documento)}
										>
											{descargandoVersion[doc.id] ? 'Descargando…' : 'Descargar esta versión'}
										</button>
									</li>
								{/each}
							</ul>
							<p class="version-nota">
								Cada versión es inmutable. La versión 1 es la que recibió y firmó el
								declarante; cada decisión final emite una nueva sin modificar las anteriores.
							</p>
						</div>
					</section>
				{/if}

				<!-- Evaluación interna -->
				<section class="side-card" in:fly={{ y: 12, duration: 320, delay: 140, easing: quintOut }}>
					<header class="side-head">
						<div>
							<span class="eyebrow">Concepto del Oficial</span>
							<h3>Evaluación interna</h3>
						</div>
						{#if detalle.evaluado_por}
							<span class="evaluado-por">
								por <strong>{detalle.evaluado_por.nombre}</strong>
							</span>
						{/if}
					</header>
					<div class="side-body">
						<div class="eval-form">
							<div class="field">
								<label for="eval-estado" class="field-label">Estado</label>
								<select id="eval-estado" bind:value={editEstado} class="select">
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
									class="input"
								/>
							</div>
							<div class="field">
								<label for="eval-observaciones" class="field-label">Observaciones</label>
								<textarea
									id="eval-observaciones"
									bind:value={editObservaciones}
									rows="3"
									placeholder="Notas para el expediente, alertas, próximos pasos…"
									class="input textarea"
								></textarea>
							</div>

							{#if detalle.evaluado_at}
								<div class="eval-meta">
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
									<span>Última evaluación: <strong class="mono">{formatFecha(detalle.evaluado_at)}</strong></span>
								</div>
							{/if}

							{#if emiteVersionDocumental}
								<p class="eval-aviso">
									Al guardar se emitirá una versión documental nueva con este
									resultado marcado. La versión recibida no se modifica.
								</p>
							{/if}

							<button class="btn-primary btn-block" disabled={saving || !editEstado} onclick={guardarEvaluacion}>
								{#if saving}
									<svg class="spin" viewBox="0 0 24 24" fill="none">
										<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
										<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
									</svg>
									Guardando…
								{:else}
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
									</svg>
									Guardar evaluación
								{/if}
							</button>
						</div>
					</div>
				</section>

				<!-- Metadata técnica -->
				<details class="side-card side-card--meta" in:fly={{ y: 12, duration: 320, delay: 200, easing: quintOut }}>
					<summary class="side-head side-head--summary">
						<div>
							<span class="eyebrow">Trazabilidad</span>
							<h3>Detalles técnicos</h3>
						</div>
						<svg class="h-4 w-4 chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
						</svg>
					</summary>
					<div class="side-body">
						<dl class="tech-list">
							{#if detalle.ip_origen}
								<div>
									<dt>IP de origen</dt>
									<dd class="mono">{detalle.ip_origen}</dd>
								</div>
							{/if}
							{#if detalle.user_agent}
								<div>
									<dt>User-Agent</dt>
									<dd class="mono ua">{detalle.user_agent}</dd>
								</div>
							{/if}
							{#if detalle.referer}
								<div>
									<dt>Referer</dt>
									<dd class="mono ua">{detalle.referer}</dd>
								</div>
							{/if}
							<div>
								<dt>ID interno</dt>
								<dd class="mono mono--sm">{detalle.id}</dd>
							</div>
						</dl>
					</div>
				</details>
			</aside>
		</div>
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════════════════════════════
	   PAGE BASE
	   ═══════════════════════════════════════════════════════════════ */
	.sarlaft-page {
		min-height: 100vh;
		background: #fcfcfb;
		font-family: 'Geist', system-ui, sans-serif;
		color: #1e293b;
		padding: 1.5rem 1.25rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   TYPOGRAPHY
	   ═══════════════════════════════════════════════════════════════ */
	.eyebrow {
		display: inline-block;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.55rem;
		border-radius: 4px;
	}
	h1,
	h2,
	h3 {
		font-family: 'Geist', system-ui, sans-serif;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.mono {
		font-family: 'Geist', ui-monospace, monospace;
	}
	.mono--sm {
		font-size: 0.7rem;
		color: #64748b;
	}

	/* ═══════════════════════════════════════════════════════════════
	   BACK LINK
	   ═══════════════════════════════════════════════════════════════ */
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		color: #64748b;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		padding: 0.3rem 0;
		transition: color 0.2s;
		font-family: inherit;
		width: fit-content;
	}
	.back-link:hover {
		color: #f97316;
	}
	.back-link svg {
		width: 14px;
		height: 14px;
	}

	/* ═══════════════════════════════════════════════════════════════
	   HERO
	   ═══════════════════════════════════════════════════════════════ */
	.page-hero {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 24px;
		padding: 1.5rem 1.75rem 1.25rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.hero-top {
		margin-bottom: 1.25rem;
	}
	.hero-left {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}
	.hero-icon {
		flex-shrink: 0;
	}
	.hero-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.hero-tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}
	.radicado-pill {
		display: inline-flex;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.78rem;
		font-weight: 700;
		color: #f97316;
		background: rgba(249, 115, 22, 0.1);
		padding: 0.25rem 0.65rem;
		border-radius: 6px;
		letter-spacing: 0.04em;
	}
	.codigo-pill {
		display: inline-flex;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 600;
		color: #64748b;
		background: rgba(0, 0, 0, 0.04);
		padding: 0.25rem 0.55rem;
		border-radius: 5px;
		letter-spacing: 0.04em;
	}
	.estado-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.25rem 0.6rem;
		border-radius: 5px;
		border: 1px solid;
	}
	.estado-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.hero-text h1 {
		font-size: clamp(1.5rem, 3.5vw, 1.95rem);
		font-weight: 500;
		line-height: 1.15;
		margin: 0;
	}
	.hero-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: #64748b;
	}
	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.meta-item svg {
		color: #94a3b8;
		flex-shrink: 0;
	}
	.meta-item--link {
		color: #f97316;
		text-decoration: none;
		transition: color 0.2s;
	}
	.meta-item--link:hover {
		color: #c2410c;
		text-decoration: underline;
	}
	.meta-sep {
		color: #cbd5e1;
	}

	/* Hero stats */
	.hero-stats {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
		padding-top: 1rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		font-family: 'Geist', ui-monospace, monospace;
	}
	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.stat-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}
	.stat-value {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
	}
	.stat-value--text {
		font-size: 0.82rem;
		font-weight: 600;
	}
	.stat-sep {
		color: #cbd5e1;
	}

	/* ═══════════════════════════════════════════════════════════════
	   LAYOUT 2 COLUMNAS
	   ═══════════════════════════════════════════════════════════════ */
	.layout-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
	}
	@media (min-width: 1024px) {
		.layout-grid {
			grid-template-columns: minmax(0, 1fr) 380px;
		}
	}

	.col-main {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.col-head h2 {
		font-size: 1.3rem;
		font-weight: 500;
		margin: 0.4rem 0 0.25rem;
		color: #0f172a;
	}
	.col-head p {
		font-size: 0.82rem;
		color: #475569;
		margin: 0;
		max-width: 600px;
		line-height: 1.5;
	}
	.respuestas-wrap {
		display: flex;
		flex-direction: column;
	}

	/* Sidebar */
	.col-side {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Side cards */
	.side-card {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 18px;
		overflow: hidden;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.side-card--meta {
		box-shadow: none;
	}
	.side-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: linear-gradient(180deg, #fcfcfb 0%, white 100%);
		border-bottom: 1px solid rgba(0, 0, 0, 0.05);
	}
	.side-head h3 {
		font-size: 1rem;
		font-weight: 500;
		margin: 0.35rem 0 0;
		color: #0f172a;
	}
	.side-head--summary {
		cursor: pointer;
		list-style: none;
		user-select: none;
		transition: background 0.2s;
	}
	.side-head--summary::-webkit-details-marker {
		display: none;
	}
	.side-head--summary:hover {
		background: #fcfcfb;
	}
	.chevron {
		color: #64748b;
		transition: transform 0.2s;
		flex-shrink: 0;
	}
	details[open] .chevron {
		transform: rotate(180deg);
	}
	.side-body {
		padding: 1rem 1.25rem 1.25rem;
	}
	.evaluado-por {
		font-size: 0.7rem;
		color: #64748b;
		font-family: 'Geist', system-ui, sans-serif;
		text-align: right;
	}
	.evaluado-por strong {
		color: #0f172a;
		font-weight: 600;
	}

	/* Docs list */
	.docs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   EXPORTAR / DESCARGAR
	   ═══════════════════════════════════════════════════════════════ */
	.side-help {
		font-size: 0.8rem;
		line-height: 1.55;
		color: #475569;
		margin: 0 0 0.85rem;
	}
	.export-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
	}
	.export-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.6rem 0.8rem;
		background: white;
		color: #1e293b;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 10px;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.export-btn:hover:not(:disabled) {
		background: #fcfcfb;
		border-color: rgba(249, 115, 22, 0.4);
		color: #9a3412;
	}
	.export-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.export-btn svg {
		width: 16px;
		height: 16px;
		color: #f97316;
	}
	.export-btn--zip {
		background: rgba(249, 115, 22, 0.06);
		border-color: rgba(249, 115, 22, 0.25);
		color: #9a3412;
	}
	.export-btn--zip:hover:not(:disabled) {
		background: rgba(249, 115, 22, 0.12);
		border-color: #f97316;
	}
	.export-contacto {
		padding: 0.7rem 0.85rem;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.05);
		border-radius: 10px;
	}
	.eyebrow--mini {
		font-size: 0.6rem !important;
		padding: 0.15rem 0.45rem !important;
	}
	.contacto-texto {
		font-size: 0.78rem;
		color: #475569;
		line-height: 1.55;
		margin: 0.4rem 0 0.6rem;
		word-break: break-word;
	}
	.contacto-texto strong {
		color: #0f172a;
		font-weight: 700;
	}
	.contacto-texto .mono {
		font-size: 0.72rem;
		color: #9a3412;
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
		padding: 0.4rem 0.7rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 8px;
		color: #1e293b;
		text-decoration: none;
		font-size: 0.75rem;
		font-weight: 600;
		transition: all 0.2s;
	}
	.contacto-link:hover {
		border-color: rgba(249, 115, 22, 0.3);
		color: #9a3412;
		background: rgba(249, 115, 22, 0.05);
	}
	.contacto-link svg {
		width: 14px;
		height: 14px;
		color: #f97316;
	}
	.doc-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.85rem;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.05);
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		transition: all 0.2s;
	}
	.doc-row:hover:not(:disabled) {
		background: white;
		border-color: rgba(249, 115, 22, 0.3);
		transform: translateY(-1px);
	}
	.doc-row:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
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
		font-weight: 600;
		color: #0f172a;
		margin: 0 0 0.15rem;
	}
	.doc-name {
		font-size: 0.72rem;
		color: #475569;
		margin: 0 0 0.2rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-meta {
		font-size: 0.68rem;
		color: #64748b;
		margin: 0;
	}
	.doc-meta .mono {
		font-size: 0.68rem;
	}
	.doc-sep {
		margin: 0 0.3rem;
		color: #cbd5e1;
	}
	.doc-action {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 8px;
		color: #f97316;
	}
	.doc-action svg {
		width: 14px;
		height: 14px;
	}
	.spin-ring--sm {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(249, 115, 22, 0.2);
		border-top-color: #f97316;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.empty-mini {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 1rem;
		text-align: center;
		background: #fcfcfb;
		border: 1px dashed rgba(0, 0, 0, 0.1);
		border-radius: 12px;
	}
	.empty-mini svg {
		width: 26px;
		height: 26px;
		color: #94a3b8;
	}
	.empty-mini p {
		font-size: 0.8rem;
		color: #64748b;
		margin: 0;
	}

	/* Badge count */
	/* ── Versiones documentales de la declaración de empresa de transporte ──
	   Estilos propios del panel nuevo. No redefinen nada existente. */
	.version-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.version-item {
		border: 1px solid #e5e7eb;
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
	}
	.version-estado {
		font-size: 0.68rem;
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
		color: #6b7280;
	}
	.version-meta dd {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.version-hash {
		margin-bottom: 8px;
	}
	.hash-label {
		display: block;
		font-size: 0.68rem;
		color: #6b7280;
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
		background: #ecfdf5;
		color: #065f46;
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
		color: #6b7280;
		font-size: 0.64rem;
		word-break: break-all;
	}
	.entrega-error {
		color: #991b1b;
		font-weight: 600;
	}
	.version-nota {
		font-size: 0.7rem;
		color: #6b7280;
		margin: 10px 0 0;
	}
	.eval-aviso {
		font-size: 0.72rem;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
		padding: 8px 10px;
		margin: 0 0 10px;
	}
	.btn-ghost {
		background: transparent;
		border: 1px solid #d4d4d8;
		border-radius: 8px;
		padding: 7px 12px;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}
	.btn-ghost:hover:not(:disabled) {
		background: #f4f4f5;
	}
	.btn-ghost:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.badge-count {
		display: inline-flex;
		align-items: center;
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.7rem;
		font-weight: 700;
		color: #9a3412;
		background: rgba(249, 115, 22, 0.1);
		padding: 0.25rem 0.6rem;
		border-radius: 5px;
	}

	/* Evaluación form */
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
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}
	.input,
	.select {
		width: 100%;
		padding: 0.55rem 0.8rem;
		font-family: inherit;
		font-size: 0.85rem;
		color: #1e293b;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.input::placeholder {
		color: #94a3b8;
	}
	.input:focus,
	.select:focus {
		background: white;
		border-color: rgba(249, 115, 22, 0.4);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}
	.textarea {
		resize: vertical;
		font-family: inherit;
		line-height: 1.5;
	}
	.eval-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.75rem;
		background: rgba(249, 115, 22, 0.06);
		border: 1px solid rgba(249, 115, 22, 0.15);
		border-radius: 10px;
		font-size: 0.78rem;
		color: #9a3412;
	}
	.eval-meta svg {
		color: #f97316;
		flex-shrink: 0;
	}
	.eval-meta strong {
		font-weight: 700;
	}

	/* Tech list (details) */
	.tech-list {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin: 0;
	}
	.tech-list > div {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.tech-list > div:last-child {
		border-bottom: none;
	}
	.tech-list dt {
		font-family: 'Geist', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}
	.tech-list dd {
		margin: 0;
		font-size: 0.78rem;
		color: #0f172a;
		word-break: break-all;
	}
	.tech-list dd.ua {
		font-size: 0.72rem;
		line-height: 1.5;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ESTADOS GENERALES
	   ═══════════════════════════════════════════════════════════════ */
	.state-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 4rem 1.5rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 20px;
		color: #64748b;
		font-size: 0.88rem;
	}
	.spin-ring {
		width: 30px;
		height: 30px;
		border: 2.5px solid rgba(249, 115, 22, 0.15);
		border-top-color: #f97316;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ═══════════════════════════════════════════════════════════════
	   ALERT
	   ═══════════════════════════════════════════════════════════════ */
	.alert {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.95rem 1.1rem;
		border-radius: 12px;
		font-size: 0.88rem;
	}
	.alert-error {
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.2);
		color: #991b1b;
	}
	.alert-error svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: #dc2626;
	}
	.alert-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.alert-body strong {
		font-weight: 700;
	}
	.alert-body span {
		font-size: 0.82rem;
		color: #b91c1c;
	}

	/* ═══════════════════════════════════════════════════════════════
	   BOTONES
	   ═══════════════════════════════════════════════════════════════ */
	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.65rem 1.15rem;
		font-family: 'Geist', system-ui, sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 11px;
		cursor: pointer;
		transition: all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.btn-primary {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.28);
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-secondary {
		background: white;
		color: #1e293b;
		border-color: rgba(0, 0, 0, 0.12);
	}
	.btn-secondary:hover:not(:disabled) {
		background: #fcfcfb;
		border-color: rgba(0, 0, 0, 0.2);
	}
	.btn-secondary--sm {
		padding: 0.45rem 0.85rem;
		font-size: 0.78rem;
	}
	.btn-block {
		width: 100%;
	}
	.btn-primary svg {
		width: 15px;
		height: 15px;
	}
	.spin {
		width: 14px;
		height: 14px;
		animation: spin 0.8s linear infinite;
	}

	/* Card icon */
	.card-icon {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.card-icon svg {
		width: 24px;
		height: 24px;
	}
</style>
