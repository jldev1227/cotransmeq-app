<!--
	Captura de evidencia: foto, archivo y firma.

	Se monta SOLO en el runner del portal, no en el preview: el builder no debe
	subir nada a ningún sitio, y el preview no tiene `clientSubmissionId` al que
	colgar el adjunto.

	La firma se dibuja con eventos de puntero, no de ratón ni táctiles por
	separado: `PointerEvent` cubre dedo, lápiz y ratón con un solo código, y
	`setPointerCapture` evita que el trazo se corte si el dedo sale del canvas.
-->
<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { ATTACHMENT_LIMITS, type FormFieldDto } from '$lib/formularios/types';
	import {
		bytesLegibles,
		canvasEstaVacio,
		MediaError,
		prepararArchivo,
		prepararFirma,
		prepararFoto,
		type PreparedMedia
	} from '$lib/offline/forms-media';

	interface Props {
		field: FormFieldDto;
		occurrenceId?: string | null;
		/** Adjuntos ya capturados para este campo y ocurrencia. */
		existentes: { clientAttachmentId: string; byteSize: number; mimeType: string; blob?: Blob }[];
		/** Bytes ya usados por el borrador completo, para el tope de 100 MB. */
		draftBytes: number;
		disabled?: boolean;
		onadd: (media: PreparedMedia) => Promise<void> | void;
		onremove: (clientAttachmentId: string) => void;
	}

	let { field, occurrenceId = null, existentes, draftBytes, disabled = false, onadd, onremove }: Props =
		$props();

	const maxFiles = $derived(
		Number(field.validation?.maxFiles ?? 0) || (field.type === 'SIGNATURE' ? 1 : 5)
	);
	const puedeAgregar = $derived(!disabled && existentes.length < maxFiles);

	let procesando = $state(false);
	let firmando = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let trazando = false;
	let hayTrazo = $state(false);

	/**
	 * Comprueba el tope por borrador ANTES de guardar.
	 *
	 * El tope existe para que un envío no agote la cuota de IndexedDB y el
	 * navegador desaloje la base entera —con los borradores de otros formularios
	 * dentro—. Se avisa con el número, no con un «no hay espacio» genérico.
	 */
	function cabeEnElBorrador(bytes: number): boolean {
		if (draftBytes + bytes <= ATTACHMENT_LIMITS.maxDraftBytes) return true;
		toast.error(
			`Este formulario ya acumula ${bytesLegibles(draftBytes)} de evidencia (tope ${bytesLegibles(
				ATTACHMENT_LIMITS.maxDraftBytes
			)}). Envíalo antes de añadir más.`
		);
		return false;
	}

	async function onArchivoElegido(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const archivos = [...(input.files ?? [])];
		/// El input se limpia siempre: sin esto, elegir el mismo archivo dos veces
		/// no dispara `change` la segunda.
		input.value = '';
		if (!archivos.length) return;

		procesando = true;
		try {
			for (const archivo of archivos) {
				if (existentes.length >= maxFiles) {
					toast.error(`Máximo ${maxFiles} archivo(s) en «${field.label}».`);
					break;
				}
				const media =
					field.type === 'PHOTO' ? await prepararFoto(archivo) : await prepararArchivo(archivo);

				if (!cabeEnElBorrador(media.byteSize)) break;

				await onadd(media);

				if (field.type === 'PHOTO' && media.originalBytes > media.byteSize * 1.4) {
					toast.success(
						`Foto guardada (${bytesLegibles(media.byteSize)}, comprimida desde ${bytesLegibles(
							media.originalBytes
						)}).`
					);
				}
			}
		} catch (err) {
			if (err instanceof MediaError) toast.error(err.message);
			else toast.error('No se pudo procesar el archivo.');
		} finally {
			procesando = false;
		}
	}

	// ── Firma ────────────────────────────────────────────────────────────────

	function iniciarFirma() {
		firmando = true;
		hayTrazo = false;
		/// El canvas se dimensiona tras el render: leer `clientWidth` antes de que
		/// exista daría 0 y la firma saldría de 0×0 píxeles.
		requestAnimationFrame(() => prepararCanvas());
	}

	function prepararCanvas() {
		const canvas = canvasEl;
		if (!canvas) return;
		/// Se dibuja a la resolución real del dispositivo (`devicePixelRatio`): en un
		/// móvil con pantalla 3x, un canvas de 300 px lógicos guardado a 300 px
		/// reales produce una firma pixelada e ilegible al imprimirla.
		const ratio = Math.min(window.devicePixelRatio || 1, 3);
		const ancho = canvas.clientWidth;
		const alto = canvas.clientHeight;
		canvas.width = Math.round(ancho * ratio);
		canvas.height = Math.round(alto * ratio);

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.scale(ratio, ratio);
		ctx.lineWidth = 2.2;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = '#0f1f1a';
		ctx.clearRect(0, 0, ancho, alto);
	}

	function puntoDe(event: PointerEvent, canvas: HTMLCanvasElement) {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function onPointerDown(event: PointerEvent) {
		const canvas = canvasEl;
		if (!canvas) return;
		event.preventDefault();
		/// `setPointerCapture` mantiene los eventos aunque el dedo salga del canvas:
		/// sin él, una firma que se pasa del borde se corta a mitad de trazo.
		canvas.setPointerCapture(event.pointerId);
		trazando = true;
		hayTrazo = true;
		const ctx = canvas.getContext('2d');
		const p = puntoDe(event, canvas);
		ctx?.beginPath();
		ctx?.moveTo(p.x, p.y);
	}

	function onPointerMove(event: PointerEvent) {
		if (!trazando || !canvasEl) return;
		event.preventDefault();
		const ctx = canvasEl.getContext('2d');
		const p = puntoDe(event, canvasEl);
		ctx?.lineTo(p.x, p.y);
		ctx?.stroke();
	}

	function onPointerUp(event: PointerEvent) {
		if (!canvasEl) return;
		trazando = false;
		try {
			canvasEl.releasePointerCapture(event.pointerId);
		} catch {
			/// El puntero ya se liberó.
		}
	}

	function limpiarFirma() {
		const canvas = canvasEl;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		ctx?.clearRect(0, 0, canvas.width, canvas.height);
		hayTrazo = false;
	}

	async function guardarFirma() {
		const canvas = canvasEl;
		if (!canvas) return;
		/// Se comprueba el canal alfa y no solo el flag `hayTrazo`: un toque sin
		/// desplazamiento marca el flag pero no dibuja nada, y guardaría un acta
		/// firmada en blanco.
		if (canvasEstaVacio(canvas)) {
			toast.error('La firma está vacía. Dibuja tu firma antes de guardar.');
			return;
		}
		procesando = true;
		try {
			const media = await prepararFirma(canvas);
			if (!cabeEnElBorrador(media.byteSize)) return;
			await onadd(media);
			firmando = false;
			toast.success('Firma guardada.');
		} catch (err) {
			if (err instanceof MediaError) toast.error(err.message);
			else toast.error('No se pudo guardar la firma.');
		} finally {
			procesando = false;
		}
	}

	/** URL temporal para la miniatura. Se revoca al desmontar el nodo. */
	function objectUrl(node: HTMLImageElement, blob: Blob | undefined) {
		if (!blob) return {};
		const url = URL.createObjectURL(blob);
		node.src = url;
		return {
			destroy() {
				URL.revokeObjectURL(url);
			}
		};
	}

	const aceptaMime = $derived(
		field.type === 'PHOTO'
			? ATTACHMENT_LIMITS.allowedPhotoMime.join(',')
			: ATTACHMENT_LIMITS.allowedFileMime.join(',')
	);
</script>

<div class="captura">
	{#if existentes.length}
		<ul class="lista">
			{#each existentes as adjunto (adjunto.clientAttachmentId)}
				<li class="item">
					{#if adjunto.mimeType.startsWith('image/') && adjunto.blob}
						<img class="item__thumb" alt="Evidencia adjunta" use:objectUrl={adjunto.blob} />
					{:else}
						<span class="item__icono" aria-hidden="true">📄</span>
					{/if}
					<span class="item__meta">
						<span class="item__tipo">{adjunto.mimeType.split('/')[1] ?? adjunto.mimeType}</span>
						<span class="item__peso">{bytesLegibles(adjunto.byteSize)}</span>
					</span>
					{#if !disabled}
						<button
							type="button"
							class="item__quitar"
							aria-label="Quitar evidencia"
							onclick={() => onremove(adjunto.clientAttachmentId)}
						>
							Quitar
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if puedeAgregar}
		{#if field.type === 'SIGNATURE'}
			{#if !firmando}
				<button type="button" class="boton" disabled={procesando} onclick={iniciarFirma}>
					✍ Firmar
				</button>
			{:else}
				<div class="firma">
					<!-- `touch-action: none` en el CSS: sin eso, el navegador interpreta el
					     trazo como scroll y la firma no se dibuja en móvil. -->
					<canvas
						class="firma__canvas"
						bind:this={canvasEl}
						onpointerdown={onPointerDown}
						onpointermove={onPointerMove}
						onpointerup={onPointerUp}
						onpointercancel={onPointerUp}
					></canvas>
					<p class="firma__hint">Firma con el dedo dentro del recuadro.</p>
					<div class="firma__acciones">
						<button type="button" class="boton boton--plano" onclick={() => (firmando = false)}>
							Cancelar
						</button>
						<button type="button" class="boton boton--plano" disabled={!hayTrazo} onclick={limpiarFirma}>
							Limpiar
						</button>
						<button
							type="button"
							class="boton boton--primario"
							disabled={procesando || !hayTrazo}
							onclick={guardarFirma}
						>
							{procesando ? 'Guardando…' : 'Guardar firma'}
						</button>
					</div>
				</div>
			{/if}
		{:else}
			<input
				class="oculto"
				type="file"
				bind:this={inputEl}
				accept={aceptaMime}
				capture={field.type === 'PHOTO' ? 'environment' : undefined}
				multiple={maxFiles > 1}
				onchange={onArchivoElegido}
			/>
			<button
				type="button"
				class="boton"
				disabled={procesando}
				onclick={() => inputEl?.click()}
			>
				{procesando
					? 'Procesando…'
					: field.type === 'PHOTO'
						? '📷 Tomar o elegir foto'
						: '📎 Adjuntar archivo'}
			</button>
			<p class="hint">
				{#if field.type === 'PHOTO'}
					Se comprime en el teléfono antes de guardarla (máx. {ATTACHMENT_LIMITS.photoMaxEdge} px).
				{:else}
					PDF o imagen, hasta {bytesLegibles(ATTACHMENT_LIMITS.maxFileBytes)}.
				{/if}
				{#if maxFiles > 1}
					Hasta {maxFiles} archivos.
				{/if}
			</p>
		{/if}
	{:else if !disabled}
		<p class="hint">Se alcanzó el máximo de {maxFiles} archivo(s) para este campo.</p>
	{/if}
</div>

<style>
	.captura {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.lista {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		list-style: none;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: var(--gray-50, #f9fafb);
		border-radius: 10px;
	}

	.item__thumb {
		width: 44px;
		height: 44px;
		object-fit: cover;
		border-radius: 8px;
		background: #fff;
	}

	.item__icono {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		font-size: 1.25rem;
		background: #fff;
		border-radius: 8px;
	}

	.item__meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.item__tipo {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		text-transform: uppercase;
	}

	.item__peso {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.item__quitar {
		min-height: 40px;
		padding: 0 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		color: #b91c1c;
		background: none;
		border: 1px solid #fecaca;
		border-radius: 8px;
		cursor: pointer;
	}

	.boton {
		align-self: flex-start;
		min-height: 48px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 12px;
		cursor: pointer;
	}

	.boton--plano {
		color: var(--text-secondary, #4a4a4a);
		background: #fff;
		border-color: var(--border-default, rgba(0, 0, 0, 0.12));
	}

	.boton--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
	}

	.boton:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.boton:focus-visible,
	.item__quitar:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.hint,
	.firma__hint {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-very-muted, #9a9a9a);
	}

	.oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.firma {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.firma__canvas {
		width: 100%;
		height: 10rem;
		background: #fff;
		border: 2px dashed var(--border-emphasis, rgba(0, 0, 0, 0.24));
		border-radius: 12px;
		/* Imprescindible: sin esto el navegador se queda el gesto como scroll y no
		   se dibuja nada en un teléfono. */
		touch-action: none;
		cursor: crosshair;
	}

	.firma__acciones {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.firma__acciones .boton {
		align-self: auto;
		min-height: 44px;
		font-size: 0.875rem;
	}
</style>
