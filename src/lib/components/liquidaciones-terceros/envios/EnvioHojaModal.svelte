<script lang="ts">
	/**
	 * Envío por correo de UNA hoja: los canvas de ingresos y ocasional.
	 *
	 * Es el hermano de `EnviosCierresModal` para los canvas SIN un tercero por
	 * fila: aquí no hay destinatario por defecto —el correo se escribe a
	 * mano— y el adjunto es el PDF de la hoja ACTIVA, compuesto del detalle
	 * en memoria con el mismo taller del preview y el export ZIP
	 * (`componer-hojas.ts`). El backend renderiza con Chromium, envía por la
	 * misma cola con constancia en `liquidacion_tercero_envio` (tipo
	 * INGRESO/OCASIONAL) y el progreso vuelve por socket.
	 *
	 * La constancia se muestra como HISTORIAL plano del periodo, no como
	 * agregado por placa: sin cierres por vehículo, la pregunta es «¿qué se
	 * ha enviado ya de este mes, a quién y cuándo?».
	 */

	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { DocumentoPreview } from '$lib/components/liquidaciones-terceros/preview/tipos';
	import type { ScopePreview } from '$lib/components/liquidaciones-terceros/preview/columnas';
	import { documentoCss } from '$lib/components/liquidaciones-terceros/preview/documento.css';
	import { componerHojasHtml } from '$lib/components/liquidaciones-terceros/preview/componer-hojas';
	import ChipsCorreos from './ChipsCorreos.svelte';
	import {
		liquidacionesTercerosEnviosAPI,
		type EnvioHistorialFila,
		type EnvioTipo
	} from '$lib/api/liquidaciones-terceros-envios';
	import { enviosLiqQueue, enviosLiqStore } from '$lib/stores/enviosLiquidaciones';
	import { getSocket } from '$lib/socketClient';

	interface Props {
		tipo: Extract<EnvioTipo, 'INGRESO' | 'OCASIONAL'>;
		/** Scope de composición/columnas del canvas ('ingresos' | 'ocasional'). */
		scope: ScopePreview;
		anio: number;
		mes: number;
		/** Nombre de la hoja para la constancia y el {PLACA} del asunto. */
		hojaLabel: string;
		/** Título del correo (cabecera verde), ej. «Liquidación de otros ingresos». */
		tituloCorreo: string;
		/** Nombre del PDF adjunto, sin extensión. */
		nombreArchivo: string;
		/**
		 * Cifra(s) de cierre de la hoja, para la tarjeta de resumen del correo.
		 *
		 * El destinatario abre el correo antes que el PDF, y hasta ahora ese
		 * correo no decía de cuánto era la liquidación: había que descargar el
		 * adjunto para saberlo. Va ya formateada y la calcula el canvas con
		 * `calcularTotales`, la MISMA fuente que pinta la hoja, para que el
		 * cuerpo del correo y el papel no puedan discrepar.
		 */
		resumen?: Array<{ etiqueta: string; valor: string }>;
		/** Cabecera del periodo si ya existe (constancia con origen). */
		origenId: string | null;
		/**
		 * Documento de la hoja activa, compuesto AL ENVIAR: lo que sale por
		 * correo es lo que hay en pantalla en ese momento, igual que el ZIP.
		 */
		obtenerDocumento: () => DocumentoPreview | null;
		onClose: () => void;
	}

	let {
		tipo,
		scope,
		anio,
		mes,
		hojaLabel,
		tituloCorreo,
		nombreArchivo,
		resumen = [],
		origenId,
		obtenerDocumento,
		onClose
	}: Props = $props();

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];
	const periodo = `${MESES[mes - 1] ?? mes} ${anio}`;

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const esCorreo = (c: string) => EMAIL_RE.test(c.trim());
	/** Tope de los adjuntos extra, alineado con el backend. */
	const MAX_ADJUNTOS = 15_000_000;

	// ── Destinatarios (sin default: se escriben a mano) ──
	let correosChips = $state('');
	let correoBorrador = $state('');

	const destinatarios = $derived.by(() => {
		const pendiente = correoBorrador.trim();
		const crudos = [
			...correosChips.split(/[,;]/).map((p) => p.trim()).filter(Boolean),
			...(pendiente ? [pendiente] : [])
		];
		if (crudos.length === 0 || !crudos.every(esCorreo)) return [] as string[];
		const vistos = new Set<string>();
		return crudos.filter((c) => {
			const k = c.toLowerCase();
			if (vistos.has(k)) return false;
			vistos.add(k);
			return true;
		});
	});
	const copias = $derived(destinatarios.slice(1));
	const hayTexto = $derived(correosChips.trim() !== '' || correoBorrador.trim() !== '');

	// ── Mensaje ──
	let asunto = $state(`Liquidación {PLACA} — {PERIODO} · Cotransmeq`);
	let mensaje = $state(
		'Reciba un cordial saludo.\n\n' +
			'Adjunto encontrará la liquidación correspondiente al periodo indicado, ' +
			'junto con los documentos de soporte.\n\n' +
			'Cualquier inquietud con gusto será atendida respondiendo a este correo.'
	);

	// ── Adjuntos extra ──
	let adjuntos = $state<Array<{ filename: string; contentType: string; base64: string; size: number }>>([]);
	const totalAdjuntos = $derived(adjuntos.reduce((s, a) => s + a.size, 0));

	// ── Modo prueba ──
	let esPrueba = $state(false);
	let destinoPrueba = $state('');

	// ── Historial (la constancia del periodo) ──
	let historial = $state<EnvioHistorialFila[]>([]);
	let proveedor = $state<string | null>(null);
	let cargandoHistorial = $state(true);
	/**
	 * Por qué falló la última consulta de estado, si falló.
	 *
	 * `proveedor === null` NO significa «el servidor no tiene correo»: es
	 * también el valor inicial y el que queda cuando la petición nunca llegó
	 * (backend caído, sesión vencida, 500). Sin distinguir los dos casos, el
	 * modal acusaba de «no hay proveedor configurado» un fallo que era de red.
	 */
	let errorConsulta = $state<string | null>(null);
	/** El servidor CONFIRMÓ que no puede enviar correo. */
	const sinProveedor = $derived(!cargandoHistorial && errorConsulta === null && proveedor === null);

	// ── Lanzamiento ──
	let componiendo = $state(false);

	const job = $derived($enviosLiqStore);
	const enCurso = $derived(job != null && (job.status === 'queued' || job.status === 'running'));

	async function cargarHistorial() {
		cargandoHistorial = true;
		try {
			const r = await liquidacionesTercerosEnviosAPI.historialPeriodo(tipo, anio, mes);
			historial = r.historial;
			proveedor = r.proveedor;
			errorConsulta = null;
		} catch (e: any) {
			const detalle: string = e?.response?.data?.error || e?.message || 'error desconocido';
			errorConsulta = detalle;
			toast.error('No se pudo consultar el historial de envíos', {
				description: detalle
			});
		} finally {
			cargandoHistorial = false;
		}
	}

	onMount(() => {
		void cargarHistorial();

		// El room ANUAL del canvas ya está unido por la sesión de hoja: si otro
		// usuario envía este periodo, la constancia se repinta sola.
		const socket = getSocket();
		const onActualizado = (d: any) => {
			if (d?.tipo === tipo && d.anio === anio && d.mes === mes) void cargarHistorial();
		};
		socket?.on('envio-liquidacion:actualizado', onActualizado);
		return () => {
			socket?.off('envio-liquidacion:actualizado', onActualizado);
		};
	});

	async function agregarAdjuntos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		for (const f of files) {
			if (totalAdjuntos + f.size > MAX_ADJUNTOS) {
				toast.error(`No cabe "${f.name}": los adjuntos extra no pueden superar 15 MB en total.`);
				continue;
			}
			const base64 = await new Promise<string>((resolve, reject) => {
				const lector = new FileReader();
				lector.onloadend = () => resolve(String(lector.result).split(',')[1] ?? '');
				lector.onerror = reject;
				lector.readAsDataURL(f);
			});
			adjuntos = [
				...adjuntos,
				{ filename: f.name, contentType: f.type || 'application/octet-stream', base64, size: f.size }
			];
		}
	}

	function quitarAdjunto(i: number) {
		adjuntos = adjuntos.filter((_, idx) => idx !== i);
	}

	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
		return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fmtFecha(iso: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleString('es-CO', {
				day: '2-digit',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	const puedeEnviar = $derived(
		esPrueba ? EMAIL_RE.test(destinoPrueba.trim()) : destinatarios.length > 0
	);

	async function enviar() {
		if (componiendo || enCurso || !puedeEnviar) return;

		const documento = obtenerDocumento();
		if (!documento) {
			toast.error('La hoja no tiene datos que enviar.');
			return;
		}

		componiendo = true;
		try {
			const { documentos, fallidas } = await componerHojasHtml(scope, [
				{ nombreArchivo, documento }
			]);
			if (fallidas.length > 0 || documentos.length === 0) {
				toast.error('No se pudo componer la hoja.');
				return;
			}

			const r = await enviosLiqQueue.start({
				tipo,
				anio,
				mes,
				css: documentoCss(1, true),
				asunto,
				mensaje,
				es_prueba: esPrueba,
				destino_prueba: esPrueba ? destinoPrueba.trim() : undefined,
				items: [
					{
						cierre_id: null,
						origen_id: origenId,
						tercero_id: null,
						placa: hojaLabel,
						tercero_nombre: '',
						titulo: tituloCorreo,
						// En modo prueba puede no haber destinatario escrito: el
						// destino real lo pone el backend con `destino_prueba`.
						to: destinatarios[0] ?? destinoPrueba.trim(),
						cc: copias.length > 0 ? copias : undefined,
						filename: nombreArchivo,
						html: documentos[0].html,
						resumen: resumen.length > 0 ? resumen : undefined
					}
				],
				adjuntos_extra: adjuntos.map(({ filename, contentType, base64 }) => ({
					filename,
					contentType,
					base64
				}))
			});

			if (r.status === 'locked') {
				toast.warning(
					`${(r as any).locked_by?.userName ?? 'Otro usuario'} ya está enviando este periodo.`
				);
			}
		} catch (e: any) {
			toast.error('No se pudo lanzar el envío', { description: e?.message || '' });
		} finally {
			componiendo = false;
		}
	}

	function cancelarJob() {
		if (job?.jobId) void enviosLiqQueue.cancel(job.jobId);
	}

	function cerrarResultado() {
		enviosLiqQueue.dismiss();
		void cargarHistorial();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !enCurso && !componiendo) onClose();
	}}
/>

<div class="env-backdrop">
	<div class="env" role="dialog" aria-modal="true" aria-label="Enviar por correo" tabindex="-1">
		<header class="env-head">
			<div>
				<h2>Enviar por correo — {hojaLabel}</h2>
				<p class="env-sub">
					{periodo} · va el PDF de la hoja tal como está en pantalla ({nombreArchivo}.pdf)
				</p>
				<!-- La cifra de cierre, también aquí y no solo en el correo: es lo
				     que delata de un vistazo que se está enviando la hoja
				     equivocada, antes de que salga. -->
				{#if resumen.length > 0}
					<p class="env-cifra">
						{#each resumen as r (r.etiqueta)}
							<span><strong>{r.etiqueta}</strong> {r.valor}</span>
						{/each}
					</p>
				{/if}
			</div>
			<button class="env-x" onclick={onClose} disabled={enCurso || componiendo} aria-label="Cerrar">×</button>
		</header>

		{#if job && (enCurso || job.status === 'complete' || job.status === 'cancelled' || job.status === 'error' || job.status === 'locked')}
			<!-- ── Progreso / resultado ── -->
			<section class="env-body">
				{#if job.status === 'locked'}
					<div class="env-aviso env-aviso-ambar">
						<strong>{job.lockedBy?.userName ?? 'Otro usuario'}</strong> ya está enviando este
						periodo. Cuando termine podrás lanzar el tuyo.
					</div>
				{:else}
					<p class="env-paso">{job.currentStep}</p>
					<div class="env-barra">
						<div class="env-barra-fill" style="width: {job.progress}%"></div>
					</div>
					<p class="env-pct">{job.progress}%</p>

					{#if job.resultados.length > 0}
						<ul class="env-resultados">
							{#each job.resultados as r ((r.cierre_id ?? r.origen_id ?? r.placa) + r.to + (r.enviado_at ?? ''))}
								<li class={r.estado === 'ENVIADO' ? 'ok' : 'err'}>
									<span class="env-res-placa">{r.placa}</span>
									<span class="env-res-to">{r.to}</span>
									{#if r.estado === 'ENVIADO'}
										<span class="env-chip env-chip-ok">Enviado</span>
									{:else}
										<span class="env-chip env-chip-err" title={r.error}>Error</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if job.status === 'error'}
						<div class="env-aviso env-aviso-rojo">{job.error}</div>
					{/if}
					{#if job.status === 'cancelled'}
						<div class="env-aviso env-aviso-ambar">
							Cancelado. Los correos ya despachados no se pueden retirar; quedaron registrados.
						</div>
					{/if}
				{/if}
			</section>

			<footer class="env-foot">
				{#if enCurso}
					<span class="env-hint">Al cancelar se detiene tras el envío en curso.</span>
					<button class="env-btn-ghost" onclick={cancelarJob}>Cancelar envío</button>
				{:else}
					<button class="env-btn-ghost" onclick={cerrarResultado}>Preparar otro envío</button>
					<button class="env-btn-primary" onclick={onClose}>Cerrar</button>
				{/if}
			</footer>
		{:else}
			<!-- ── Formulario ── -->
			<section class="env-body">
				{#if errorConsulta}
					<div class="env-aviso env-aviso-ambar">
						No se pudo consultar el estado del servicio de correo ({errorConsulta}). Puede ser
						que el servidor esté caído o la sesión haya vencido; el envío se puede intentar
						igual y el resultado quedará en la constancia.
						<button class="env-aviso-link" onclick={cargarHistorial}>Reintentar</button>
					</div>
				{:else if sinProveedor}
					<div class="env-aviso env-aviso-rojo">
						No hay proveedor de correo configurado en el servidor. Configura
						CONTABILIDAD_SMTP_USER/PASSWORD o RESEND_API_KEY.
					</div>
				{:else if proveedor === 'resend' || proveedor === 'smtp'}
					<div class="env-aviso env-aviso-info">
						Los correos salen a nombre de <strong>Contabilidad Cotransmeq S.A.S.</strong> y las
						respuestas llegan a <strong>contabilidadtransmeraldasas@gmail.com</strong> (que además
						recibe copia de constancia de cada envío real).
					</div>
				{:else if proveedor === 'smtp-contabilidad'}
					<div class="env-aviso env-aviso-info">
						Enviando directamente desde <strong>contabilidadtransmeraldasas@gmail.com</strong>.
					</div>
				{/if}

				<h3 class="env-h3">1 · Destinatarios</h3>
				<p class="env-nota env-nota-bloque">
					Escribe el correo del destinatario. Para enviar <strong>con copia</strong>, separa los
					correos con coma: el primero va en «Para» y los demás en copia (CC).
				</p>
				<div class="env-correo-celda">
					<ChipsCorreos
						bind:value={correosChips}
						bind:borrador={correoBorrador}
						esValido={esCorreo}
						invalido={hayTexto && destinatarios.length === 0}
						placeholder="correo del destinatario (coma para añadir copia)"
					/>
					{#if copias.length > 0}
						<span
							class="env-chip env-chip-cc"
							title={`Para: ${destinatarios[0]} · Copia: ${copias.join(', ')}`}
						>
							+{copias.length} CC
						</span>
					{/if}
				</div>

				<h3 class="env-h3">2 · Mensaje</h3>
				<label class="env-campo">
					<span>Asunto <em>(admite {'{PLACA}'} = {hojaLabel} y {'{PERIODO}'})</em></span>
					<input type="text" bind:value={asunto} maxlength="300" />
				</label>
				<label class="env-campo">
					<span>Cuerpo del mensaje</span>
					<textarea rows="5" bind:value={mensaje} maxlength="5000"></textarea>
				</label>

				<h3 class="env-h3">3 · Adjuntos adicionales</h3>
				<div class="env-adjuntos">
					<label class="env-btn-ghost env-btn-file">
						+ Añadir archivos
						<input type="file" multiple onchange={agregarAdjuntos} hidden />
					</label>
					{#if adjuntos.length > 0}
						<ul class="env-adj-lista">
							{#each adjuntos as a, i (a.filename + i)}
								<li>
									<span class="env-adj-nombre" title={a.filename}>📎 {a.filename}</span>
									<span class="env-adj-size">{fmtBytes(a.size)}</span>
									<button class="env-adj-x" onclick={() => quitarAdjunto(i)} aria-label="Quitar">×</button>
								</li>
							{/each}
						</ul>
						<p class="env-nota">{fmtBytes(totalAdjuntos)} de 15 MB</p>
					{:else}
						<p class="env-nota">Sin adjuntos extra. El PDF de la hoja va siempre.</p>
					{/if}
				</div>

				<h3 class="env-h3">4 · Modo prueba</h3>
				<div class="env-prueba" class:activa={esPrueba}>
					<label class="env-check">
						<input type="checkbox" bind:checked={esPrueba} />
						<span>
							<strong>Enviar como prueba:</strong> el correo va a un único destino, con asunto
							[PRUEBA], sin copia a contabilidad y sin contar como envío real.
						</span>
					</label>
					{#if esPrueba}
						<input
							class="env-correo env-correo-prueba"
							type="email"
							placeholder="correo de prueba"
							bind:value={destinoPrueba}
						/>
					{/if}
				</div>

				<h3 class="env-h3">Historial de envíos <em>({periodo})</em></h3>
				{#if cargandoHistorial}
					<p class="env-nota">Consultando…</p>
				{:else if historial.length === 0}
					<p class="env-nota">Este periodo no tiene envíos registrados.</p>
				{:else}
					<ul class="env-hist">
						{#each historial as h (h.id)}
							<li>
								<span class="env-hist-hoja">{h.placa}</span>
								<span class="env-hist-to" title={h.email_destino}>{h.email_destino}</span>
								<span class="env-hist-fecha">{fmtFecha(h.enviado_at ?? h.created_at)}</span>
								{#if h.es_prueba}
									<span class="env-chip env-chip-neutro">Prueba</span>
								{:else if h.estado === 'ENVIADO'}
									<span class="env-chip env-chip-ok">Enviado</span>
								{:else if h.estado === 'ERROR'}
									<span class="env-chip env-chip-err" title={h.error ?? ''}>Error</span>
								{:else}
									<span class="env-chip env-chip-neutro">{h.estado}</span>
								{/if}
								{#if h.enviado_por}
									<span class="env-hist-por" title={`Enviado por ${h.enviado_por}`}>
										{h.enviado_por}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<footer class="env-foot">
				<span class="env-hint">
					{#if esPrueba}
						Prueba a un único destino
					{:else if destinatarios.length === 0}
						Escribe al menos un correo válido
					{:else}
						Para: {destinatarios[0]}{copias.length > 0 ? ` · ${copias.length} en copia` : ''}
					{/if}
				</span>
				<button
					class="env-btn-primary"
					disabled={componiendo || !puedeEnviar || sinProveedor}
					onclick={enviar}
				>
					{componiendo ? 'Componiendo la hoja…' : esPrueba ? 'Enviar PRUEBA' : 'Enviar correo'}
				</button>
			</footer>
		{/if}
	</div>
</div>

<style>
	.env-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 24px;
	}
	.env {
		width: min(720px, 100%);
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		background: #fff;
		border-radius: 14px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
		overflow: hidden;
	}
	.env-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 22px 14px;
		border-bottom: 1px solid #e2e8f0;
	}
	.env-head h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 800;
		color: #0f172a;
	}
	.env-sub {
		margin: 4px 0 0;
		font-size: 12.5px;
		color: #64748b;
	}
	.env-x {
		border: none;
		background: none;
		font-size: 22px;
		line-height: 1;
		color: #64748b;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 6px;
	}
	.env-x:hover:not(:disabled) {
		background: #f1f5f9;
		color: #0f172a;
	}
	.env-body {
		padding: 16px 22px;
		overflow-y: auto;
		flex: 1 1 auto;
		min-height: 0;
	}
	.env-h3 {
		margin: 18px 0 8px;
		font-size: 13px;
		font-weight: 800;
		color: #334155;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.env-h3:first-of-type {
		margin-top: 4px;
	}
	.env-h3 em {
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: #94a3b8;
		font-style: normal;
	}
	.env-aviso {
		border-radius: 10px;
		padding: 10px 14px;
		font-size: 13px;
		line-height: 1.55;
		margin-bottom: 12px;
	}
	.env-aviso-info {
		background: #f0fdf4;
		color: #166534;
	}
	.env-aviso-ambar {
		background: #fefce8;
		color: #713f12;
	}
	.env-aviso-rojo {
		background: #fef2f2;
		color: #991b1b;
	}
	.env-cifra {
		margin: 4px 0 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 12.5px;
		color: #166534;
	}
	.env-cifra strong {
		font-weight: 600;
		color: #c2410c;
	}
	.env-aviso-link {
		background: none;
		border: none;
		padding: 0;
		margin-left: 6px;
		font: inherit;
		color: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
	}
	.env-check {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
		color: #334155;
		cursor: pointer;
	}
	.env-check input {
		margin-top: 2px;
	}
	.env-nota {
		font-size: 12px;
		color: #64748b;
	}
	.env-nota-bloque {
		margin: 0 0 8px;
	}
	.env-correo-celda {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.env-correo-celda > :global(.chips) {
		flex: 1;
		min-width: 0;
	}
	.env-chip {
		font-size: 11px;
		font-weight: 700;
		border-radius: 999px;
		padding: 3px 9px;
		white-space: nowrap;
	}
	.env-chip-ok {
		background: #dcfce7;
		color: #166534;
	}
	.env-chip-err {
		background: #fee2e2;
		color: #991b1b;
	}
	.env-chip-neutro {
		background: #e0e7ff;
		color: #3730a3;
	}
	.env-chip-cc {
		background: #e0e7ff;
		color: #3730a3;
	}
	.env-correo {
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 5px 9px;
		font-size: 12.5px;
		color: #0f172a;
		width: 100%;
	}
	.env-correo:focus {
		outline: 2px solid #ea580c55;
		border-color: #ea580c;
	}
	.env-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
	}
	.env-campo span {
		font-size: 12.5px;
		color: #475569;
		font-weight: 600;
	}
	.env-campo em {
		font-weight: 400;
		color: #94a3b8;
		font-style: normal;
	}
	.env-campo input,
	.env-campo textarea {
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
		font-family: inherit;
		color: #0f172a;
		resize: vertical;
	}
	.env-campo input:focus,
	.env-campo textarea:focus {
		outline: 2px solid #ea580c55;
		border-color: #ea580c;
	}
	.env-adjuntos {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.env-btn-file {
		align-self: flex-start;
		cursor: pointer;
	}
	.env-adj-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.env-adj-lista li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		background: #f8fafc;
		border-radius: 8px;
		padding: 5px 10px;
	}
	.env-adj-nombre {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #334155;
	}
	.env-adj-size {
		color: #94a3b8;
		font-variant-numeric: tabular-nums;
	}
	.env-adj-x {
		border: none;
		background: none;
		color: #94a3b8;
		font-size: 15px;
		cursor: pointer;
		border-radius: 4px;
		padding: 0 4px;
	}
	.env-adj-x:hover {
		color: #b91c1c;
		background: #fee2e2;
	}
	.env-prueba {
		border: 1px dashed #cbd5e1;
		border-radius: 10px;
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.env-prueba.activa {
		border-color: #f59e0b;
		background: #fffbeb;
	}
	.env-correo-prueba {
		max-width: 320px;
	}
	.env-hist {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		max-height: 220px;
		overflow-y: auto;
	}
	.env-hist li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		font-size: 12.5px;
		border-bottom: 1px solid #f1f5f9;
	}
	.env-hist li:last-child {
		border-bottom: none;
	}
	.env-hist-hoja {
		font-weight: 800;
		color: #0f172a;
		min-width: 88px;
	}
	.env-hist-to {
		flex: 1;
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.env-hist-fecha {
		color: #94a3b8;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.env-hist-por {
		color: #94a3b8;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.env-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding: 12px 22px;
		border-top: 1px solid #e2e8f0;
		background: #f8fafc;
	}
	.env-hint {
		margin-right: auto;
		font-size: 12px;
		color: #64748b;
	}
	.env-btn-primary {
		background: #ea580c;
		color: #fff;
		border: none;
		border-radius: 9px;
		padding: 9px 18px;
		font-size: 13.5px;
		font-weight: 700;
		cursor: pointer;
	}
	.env-btn-primary:hover:not(:disabled) {
		background: #c2410c;
	}
	.env-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.env-btn-ghost {
		background: #fff;
		color: #334155;
		border: 1px solid #cbd5e1;
		border-radius: 9px;
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.env-btn-ghost:hover {
		background: #f1f5f9;
	}
	.env-paso {
		margin: 4px 0 10px;
		font-size: 14px;
		color: #0f172a;
		font-weight: 600;
	}
	.env-barra {
		height: 10px;
		border-radius: 999px;
		background: #e2e8f0;
		overflow: hidden;
	}
	.env-barra-fill {
		height: 100%;
		background: linear-gradient(90deg, #ea580c, #f97316);
		transition: width 0.4s ease;
	}
	.env-pct {
		margin: 6px 0 12px;
		font-size: 12px;
		color: #64748b;
	}
	.env-resultados {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		max-height: 260px;
		overflow-y: auto;
	}
	.env-resultados li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		font-size: 12.5px;
		border-bottom: 1px solid #f1f5f9;
	}
	.env-resultados li:last-child {
		border-bottom: none;
	}
	.env-res-placa {
		font-weight: 800;
		color: #0f172a;
		min-width: 76px;
	}
	.env-res-to {
		flex: 1;
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
