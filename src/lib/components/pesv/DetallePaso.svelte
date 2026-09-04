<script lang="ts">
	/**
	 * Detalle de un paso: soportes exigidos, evidencias aportadas e historial.
	 *
	 * Aquí es donde el módulo hace visible su regla central: **adjuntar no
	 * acredita**. Cada soporte obligatorio muestra si está satisfecho, cada
	 * evidencia muestra su estado de revisión, y quien la aportó no ve el botón
	 * de aprobar sobre lo suyo — porque el servidor lo va a rechazar y ofrecer
	 * un botón que falla es peor que no ofrecerlo.
	 */
	import { toast } from '$lib/stores/toast';
	import type { DetallePaso, PermisosPesv } from '$lib/types/pesv-centro';
	import {
		actualizarRequisito,
		crearEvidencia,
		descargarEvidencia,
		firmarSubida,
		retirarEvidencia,
		revisarEvidencia,
		sha256DelArchivo,
		subirArchivoAS3
	} from '$lib/api/pesv-centro';
	import EstadoBadge from './EstadoBadge.svelte';
	import {
		ESTADO_REQUISITO,
		ESTADO_REVISION,
		etiquetaArea,
		formatearFecha,
		formatearInstante
	} from './estados';

	interface Props {
		detalle: DetallePaso;
		anio: number;
		permisos: PermisosPesv;
		onCerrar: () => void;
		onCambio: () => void;
	}

	let { detalle, anio, permisos, onCerrar, onCambio }: Props = $props();

	let dialogo = $state<HTMLDivElement | null>(null);
	let botonCerrar = $state<HTMLButtonElement | null>(null);
	let guardando = $state(false);

	// ── Alta de evidencia ────────────────────────────────────────────────
	let soporteElegido = $state<string>('');
	let titulo = $state('');
	let descripcion = $state('');
	let vigenciaHasta = $state('');
	let archivo = $state<File | null>(null);
	let subiendo = $state(false);
	let progreso = $state('');

	// ── Revisión ─────────────────────────────────────────────────────────
	let revisando = $state<string | null>(null);
	let observacion = $state('');

	$effect(() => {
		botonCerrar?.focus();
	});

	function alTeclado(evento: KeyboardEvent) {
		if (evento.key === 'Escape') {
			onCerrar();
			return;
		}
		if (evento.key !== 'Tab' || !dialogo) return;
		const focusables = dialogo.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (focusables.length === 0) return;
		const primero = focusables[0];
		const ultimo = focusables[focusables.length - 1];
		if (evento.shiftKey && document.activeElement === primero) {
			evento.preventDefault();
			ultimo.focus();
		} else if (!evento.shiftKey && document.activeElement === ultimo) {
			evento.preventDefault();
			primero.focus();
		}
	}

	/**
	 * Sube el archivo y registra la evidencia.
	 *
	 * Tres pasos y en este orden: firmar, subir a S3 (directo desde el
	 * navegador, sin pasar por la API) y confirmar. El backend comprueba contra
	 * S3 que el objeto existe y que su tamaño coincide antes de crear la fila,
	 * así que una subida a medias no deja una evidencia fantasma.
	 */
	async function aportarArchivo(evento: SubmitEvent) {
		evento.preventDefault();
		if (!archivo || !titulo.trim()) return;

		subiendo = true;
		try {
			progreso = 'Calculando la huella del archivo…';
			const sha256 = await sha256DelArchivo(archivo);

			progreso = 'Solicitando permiso de subida…';
			const firma = await firmarSubida({
				requirementId: detalle.requirementId,
				nombreArchivo: archivo.name,
				mimeType: archivo.type || 'application/octet-stream',
				sizeBytes: archivo.size,
				sha256
			});

			progreso = 'Subiendo el archivo…';
			await subirArchivoAS3(firma.uploadUrl, archivo);

			progreso = 'Registrando la evidencia…';
			await crearEvidencia({
				origen: 'ARCHIVO',
				requirementId: detalle.requirementId,
				soporteClave: soporteElegido || null,
				titulo: titulo.trim(),
				descripcion: descripcion.trim() || null,
				objectKey: firma.objectKey,
				nombreArchivo: archivo.name,
				mimeType: archivo.type || 'application/octet-stream',
				sizeBytes: archivo.size,
				sha256,
				vigenciaHasta: vigenciaHasta || null
			});

			toast.success('Evidencia aportada. Queda pendiente de revisión de HSEQ.');
			titulo = '';
			descripcion = '';
			vigenciaHasta = '';
			archivo = null;
			soporteElegido = '';
			onCambio();
		} catch (error) {
			toast.error(mensajeDeError(error, 'No se pudo aportar la evidencia.'));
		} finally {
			subiendo = false;
			progreso = '';
		}
	}

	async function decidir(id: string, decision: 'APROBADO' | 'RECHAZADO') {
		if (decision === 'RECHAZADO' && !observacion.trim()) {
			toast.error(
				'Un rechazo exige una observación: quien la aportó tiene que saber qué corregir.'
			);
			return;
		}
		guardando = true;
		try {
			await revisarEvidencia(id, decision, observacion.trim() || undefined);
			toast.success(decision === 'APROBADO' ? 'Evidencia aprobada.' : 'Evidencia rechazada.');
			revisando = null;
			observacion = '';
			onCambio();
		} catch (error) {
			toast.error(mensajeDeError(error, 'No se pudo registrar la decisión.'));
		} finally {
			guardando = false;
		}
	}

	async function descargar(id: string) {
		try {
			const { url } = await descargarEvidencia(id);
			window.open(url, '_blank', 'noopener');
		} catch (error) {
			toast.error(mensajeDeError(error, 'No se pudo abrir el archivo.'));
		}
	}

	async function retirar(id: string) {
		guardando = true;
		try {
			await retirarEvidencia(id);
			toast.success('Evidencia retirada. Su historial de revisión se conserva.');
			onCambio();
		} catch (error) {
			toast.error(mensajeDeError(error, 'No se pudo retirar la evidencia.'));
		} finally {
			guardando = false;
		}
	}

	async function cambiarEstado(estado: string) {
		guardando = true;
		try {
			await actualizarRequisito(detalle.stepNumber, anio, { estado });
			toast.success('Estado del paso actualizado.');
			onCambio();
		} catch (error) {
			toast.error(mensajeDeError(error, 'No se pudo cambiar el estado.'));
		} finally {
			guardando = false;
		}
	}

	/** Extrae el mensaje del error de dominio; el `code` viaja en la respuesta. */
	function mensajeDeError(error: unknown, respaldo: string): string {
		const e = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
		return e?.response?.data?.error?.message ?? e?.message ?? respaldo;
	}
</script>

<svelte:window on:keydown={alTeclado} />

<div class="fondo">
	<!-- Botón real y no un `div` con `onclick`: cerrar al pulsar fuera tiene que
	     ser alcanzable por teclado, y un `role="presentation"` con manejador deja
	     esa acción solo para el ratón. Se oculta a lectores porque `Esc` ya
	     ofrece lo mismo de forma estándar. -->
	<button type="button" class="tapa" onclick={onCerrar} tabindex="-1" aria-hidden="true"></button>
	<div
		class="dialogo"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-labelledby="detalle-paso-titulo"
		bind:this={dialogo}
	>
		<header>
			<div>
				<span class="paso">Paso {detalle.stepNumber} · {detalle.faseEtiqueta}</span>
				<h2 id="detalle-paso-titulo">{detalle.nombre}</h2>
			</div>
			<button type="button" class="cerrar" onclick={onCerrar} bind:this={botonCerrar}>
				<span aria-hidden="true">×</span>
				<span class="sr-only">Cerrar el detalle del paso</span>
			</button>
		</header>

		<div class="cuerpo">
			<p class="descripcion">{detalle.descripcion}</p>

			<section class="estado-actual">
				<EstadoBadge token={ESTADO_REQUISITO[detalle.estado]} tamano="md" />
				<span class="meta-dato">Responsable: {etiquetaArea(detalle.areaResponsable)}</span>
				{#if detalle.fechaLimite}
					<span class="meta-dato">Plazo: {formatearFecha(detalle.fechaLimite)}</span>
				{/if}

				{#if permisos.puedeRevisar}
					<div class="acciones-estado">
						<!-- `CUMPLE` solo se ofrece si el servidor dice que se puede. Con
						     soportes obligatorios sin resolver, la API lo rechazaría. -->
						<button
							type="button"
							disabled={!detalle.puedeCumplir || guardando || detalle.estado === 'CUMPLE'}
							onclick={() => cambiarEstado('CUMPLE')}
							title={detalle.puedeCumplir
								? 'Declarar el paso cumplido'
								: 'Hay soportes obligatorios sin evidencia aprobada y vigente'}
						>
							Declarar cumplido
						</button>
						<button type="button" disabled={guardando} onclick={() => cambiarEstado('EN_PROGRESO')}>
							Reabrir
						</button>
					</div>
				{/if}
			</section>

			{#if detalle.bloqueos.length > 0}
				<section class="bloqueos" role="note">
					<h3>Qué falta para poder cumplir</h3>
					<ul>
						{#each detalle.bloqueos as b, i (i)}
							<li>{b}</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section>
				<h3>Soportes exigidos</h3>
				<ul class="soportes">
					{#each detalle.soportes as s (s.clave)}
						<li class:satisfecho={s.satisfecho}>
							<span class="marca" aria-hidden="true">{s.satisfecho ? '✓' : '○'}</span>
							<div class="soporte-texto">
								<strong>
									{s.etiqueta}
									{#if s.obligatorio}<span class="obligatorio">obligatorio</span>{/if}
								</strong>
								<span class="conteos">
									{s.aprobadas} aprobadas · {s.pendientes} por revisar · {s.rechazadas} rechazadas
									{#if s.vencidas > 0}· <span class="mal">{s.vencidas} vencidas</span>{/if}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			</section>

			{#if permisos.puedeAportar}
				<section class="aportar">
					<h3>Aportar evidencia</h3>
					<form onsubmit={aportarArchivo}>
						<div class="campos">
							<label>
								<span>Soporte que cubre</span>
								<select bind:value={soporteElegido}>
									<option value="">Sin asignar a un soporte</option>
									{#each detalle.soportes as s (s.clave)}
										<option value={s.clave}>{s.etiqueta}</option>
									{/each}
								</select>
							</label>

							<label>
								<span>Título <span class="req" aria-hidden="true">*</span></span>
								<input type="text" bind:value={titulo} required maxlength="255" />
							</label>

							<label>
								<span>Vigencia hasta</span>
								<input type="date" bind:value={vigenciaHasta} />
							</label>

							<label class="ancho">
								<span>Descripción</span>
								<textarea bind:value={descripcion} rows="2"></textarea>
							</label>

							<label class="ancho">
								<span>Archivo <span class="req" aria-hidden="true">*</span></span>
								<input
									type="file"
									required
									accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx"
									onchange={(e) => (archivo = e.currentTarget.files?.[0] ?? null)}
								/>
							</label>
						</div>

						<p class="aviso">
							La evidencia queda <strong>pendiente</strong> hasta que HSEQ o Administración la revisen.
							Adjuntar un archivo no acredita el requisito.
						</p>

						<button
							type="submit"
							class="primario"
							disabled={subiendo || !archivo || !titulo.trim()}
						>
							{subiendo ? progreso || 'Subiendo…' : 'Aportar evidencia'}
						</button>
					</form>
				</section>
			{/if}

			<section>
				<h3>Evidencias del paso ({detalle.evidenciasDetalle.length})</h3>
				{#if detalle.evidenciasDetalle.length === 0}
					<p class="vacio">Todavía no se ha aportado ninguna evidencia para este paso.</p>
				{:else}
					<ul class="evidencias">
						{#each detalle.evidenciasDetalle as e (e.id)}
							{@const esPropia = e.cargado_por?.id === permisos.usuarioId}
							<li>
								<div class="ev-cabecera">
									<div class="ev-titulo">
										<strong>{e.titulo}</strong>
										<span class="ev-meta">
											{e.origen === 'ARCHIVO' ? e.nombre_archivo : `Vínculo a ${e.source_domain}`}
											· aportada por {e.cargado_por?.nombre ?? 'desconocido'}
											· {formatearInstante(e.created_at)}
										</span>
									</div>
									<EstadoBadge token={ESTADO_REVISION[e.estado_revision]} />
								</div>

								{#if e.vigencia_hasta}
									<p class="ev-vigencia">Vigente hasta {formatearFecha(e.vigencia_hasta)}</p>
								{/if}

								{#if e.observacion_revision}
									<p class="ev-observacion">
										<strong>Observación de la revisión:</strong>
										{e.observacion_revision}
									</p>
								{/if}

								{#if e.origen === 'REGISTRO' && e.source_snapshot_json}
									<!-- Snapshot del registro fuente. Se conserva para que una
									     edición posterior no cambie lo que se auditó. -->
									<dl class="snapshot">
										{#each Object.entries(e.source_snapshot_json) as [clave, valor] (clave)}
											{#if valor !== null && typeof valor !== 'object'}
												<div>
													<dt>{clave}</dt>
													<dd>{String(valor)}</dd>
												</div>
											{/if}
										{/each}
									</dl>
								{/if}

								<div class="ev-acciones">
									{#if e.origen === 'ARCHIVO'}
										<button type="button" onclick={() => descargar(e.id)}>Abrir archivo</button>
									{/if}

									{#if permisos.puedeRevisar && e.estado_revision === 'PENDIENTE'}
										{#if esPropia}
											<!-- Nadie aprueba lo suyo, ni con permiso de revisión. Se
											     dice en vez de esconder el botón: si no, parecería un
											     fallo de permisos. -->
											<span class="propia">
												Usted aportó esta evidencia: debe revisarla otra persona de HSEQ o
												Administración.
											</span>
										{:else if revisando === e.id}
											<div class="revision">
												<label class="ancho">
													<span>Observación</span>
													<textarea bind:value={observacion} rows="2"></textarea>
												</label>
												<button
													type="button"
													class="aprobar"
													disabled={guardando}
													onclick={() => decidir(e.id, 'APROBADO')}
												>
													Aprobar
												</button>
												<button
													type="button"
													class="rechazar"
													disabled={guardando}
													onclick={() => decidir(e.id, 'RECHAZADO')}
												>
													Rechazar
												</button>
												<button type="button" onclick={() => (revisando = null)}>Cancelar</button>
											</div>
										{:else}
											<button type="button" class="primario" onclick={() => (revisando = e.id)}>
												Revisar
											</button>
										{/if}
									{/if}

									{#if permisos.puedeRevisar || (esPropia && e.estado_revision === 'PENDIENTE')}
										<button
											type="button"
											class="retirar"
											disabled={guardando}
											onclick={() => retirar(e.id)}
										>
											Retirar
										</button>
									{/if}
								</div>

								{#if e.revisiones.length > 0}
									<details>
										<summary>Historial de revisiones ({e.revisiones.length})</summary>
										<ol class="historial">
											{#each e.revisiones as r (r.id)}
												<li>
													<EstadoBadge token={ESTADO_REVISION[r.decision]} />
													<span>{r.revisor_nombre ?? 'Revisor no identificado'}</span>
													<span class="fecha">{formatearInstante(r.created_at)}</span>
													{#if r.observacion}<p>{r.observacion}</p>{/if}
												</li>
											{/each}
										</ol>
									</details>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	</div>
</div>

<style>
	.fondo {
		position: fixed;
		inset: 0;
		background: rgb(15 23 42 / 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 2rem 1rem;
		z-index: 60;
		overflow-y: auto;
	}

	.tapa {
		position: absolute;
		inset: 0;
		border: none;
		background: transparent;
		cursor: default;
		padding: 0;
	}

	.dialogo {
		position: relative;
		background: #ffffff;
		border-radius: 0.875rem;
		width: 100%;
		/* Ventana centrada, no contenedor de página. */
		max-width: 56rem;
		box-shadow: 0 20px 50px rgb(15 23 42 / 0.25);
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 4rem);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 0.75rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.paso {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #64748b;
	}

	h2 {
		margin: 0.125rem 0 0;
		font-size: 1.125rem;
		font-weight: 700;
		color: #0f172a;
	}

	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.cerrar {
		background: none;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		font-size: 1.5rem;
		line-height: 1;
		color: #475569;
		cursor: pointer;
		min-width: 2.75rem;
		min-height: 2.75rem;
	}

	.cerrar:hover {
		background: #f1f5f9;
	}

	.cuerpo {
		padding: 1rem 1.5rem 1.5rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.descripcion {
		margin: 0;
		color: #475569;
		font-size: 0.875rem;
		max-width: 44rem;
	}

	.estado-actual {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
	}

	.meta-dato {
		font-size: 0.8125rem;
		color: #475569;
	}

	.acciones-estado {
		margin-left: auto;
		display: flex;
		gap: 0.5rem;
	}

	.bloqueos {
		padding: 0.75rem 0.875rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 0.625rem;
	}

	.bloqueos h3 {
		color: #92400e;
	}

	.bloqueos ul {
		margin: 0;
		padding-left: 1.125rem;
		color: #92400e;
		font-size: 0.875rem;
	}

	.soportes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 0.5rem;
	}

	.soportes li {
		display: flex;
		gap: 0.625rem;
		padding: 0.625rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
	}

	.soportes li.satisfecho {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}

	.marca {
		font-weight: 700;
		color: #94a3b8;
	}

	.soportes li.satisfecho .marca {
		color: #15803d;
	}

	.soporte-texto {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.obligatorio {
		display: inline-block;
		margin-left: 0.375rem;
		padding: 0 0.375rem;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		background: #e2e8f0;
		color: #475569;
		font-weight: 700;
	}

	.conteos {
		color: #64748b;
	}

	.mal {
		color: #b91c1c;
		font-weight: 600;
	}

	.campos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8125rem;
		color: #334155;
	}

	label.ancho {
		grid-column: 1 / -1;
	}

	.req {
		color: #b91c1c;
	}

	input,
	select,
	textarea {
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		font-size: 0.875rem;
		font-family: inherit;
		min-height: 2.75rem;
		background: #ffffff;
		color: #0f172a;
	}

	textarea {
		min-height: 3.5rem;
		resize: vertical;
	}

	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 1px;
		border-color: #0f172a;
	}

	.aviso {
		margin: 0.75rem 0;
		padding: 0.5rem 0.625rem;
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: #1e40af;
		max-width: 44rem;
	}

	.evidencias {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.evidencias > li {
		padding: 0.875rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		background: #ffffff;
	}

	.ev-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.ev-titulo {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.ev-meta {
		font-size: 0.75rem;
		color: #64748b;
	}

	.ev-vigencia,
	.ev-observacion {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: #475569;
	}

	.ev-observacion {
		padding: 0.5rem 0.625rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 0.5rem;
		color: #92400e;
	}

	.snapshot {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.375rem;
		margin: 0.625rem 0 0;
		padding: 0.625rem;
		background: #f8fafc;
		border-radius: 0.5rem;
		font-size: 0.75rem;
	}

	.snapshot dt {
		color: #64748b;
	}

	.snapshot dd {
		margin: 0;
		color: #0f172a;
		word-break: break-word;
	}

	.ev-acciones {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.revision {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
		width: 100%;
	}

	.propia {
		font-size: 0.8125rem;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 0.5rem;
		padding: 0.375rem 0.625rem;
	}

	button {
		padding: 0.5rem 0.875rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		background: #ffffff;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #0f172a;
		cursor: pointer;
		min-height: 2.75rem;
	}

	button:hover:not(:disabled) {
		background: #f1f5f9;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
	}

	.primario {
		background: #0f172a;
		border-color: #0f172a;
		color: #ffffff;
	}

	.primario:hover:not(:disabled) {
		background: #1e293b;
	}

	.aprobar {
		border-color: #bbf7d0;
		background: #f0fdf4;
		color: #15803d;
	}

	.rechazar {
		border-color: #fecaca;
		background: #fef2f2;
		color: #b91c1c;
	}

	.retirar {
		color: #b91c1c;
	}

	details {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
	}

	summary {
		cursor: pointer;
		color: #475569;
		min-height: 2.75rem;
		display: flex;
		align-items: center;
	}

	.historial {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.historial li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: #f8fafc;
		border-radius: 0.5rem;
	}

	.historial p {
		width: 100%;
		margin: 0.25rem 0 0;
		color: #475569;
	}

	.fecha {
		color: #64748b;
		font-size: 0.75rem;
	}

	.vacio {
		margin: 0;
		font-size: 0.875rem;
		color: #64748b;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
