<!--
	Preview del documento de un canvas, con exportación a PDF.

	Es el mismo lenguaje que `PreviewTerceroPDF` —lienzo ancho, zoom con
	Ctrl+rueda, cabecera editorial, rejilla verde— pero genérico: pinta un
	`DocumentoPreview` en vez de una liquidación concreta, de modo que los
	cuatro canvas del módulo comparten una sola implementación del papel.

	Se monta como MODAL sobre el canvas y no como ruta aparte a propósito:
	el estado de un canvas (mes activo, ediciones sin confirmar, sesión
	colaborativa) vive en memoria, y navegar fuera para ver el preview
	obligaría a remontarlo entero al volver.

	El PAPEL en sí lo pinta `DocumentoHoja.svelte`, que este modal solo
	enmarca: el mismo componente lo monta `exportar-zip.ts` fuera de pantalla
	para sacar el cuerpo de cada PDF del lote. El PDF lo renderiza el backend
	a partir de ESE DOM; ver `exportar-pdf.ts`.
-->
<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { ESCALA_PREVIEW } from '$lib/styles/pdf-tokens';
	import { documentoCss } from './documento.css';
	import { cargarSeleccion, guardarSeleccion, type ScopePreview } from './columnas';
	import { exportarPdfDocumento } from './exportar-pdf';
	import DocumentoHoja from './DocumentoHoja.svelte';
	import SelectorColumnasPreview from './SelectorColumnasPreview.svelte';
	import type { DocumentoPreview } from './tipos';

	interface Props {
		scope: ScopePreview;
		documento: DocumentoPreview;
		/** Línea de contexto en la barra (periodo, consecutivo, totales…). */
		subtitulo?: string;
		/**
		 * Documentos HERMANOS entre los que alternar sin cerrar el preview.
		 *
		 * Un preview es de UN documento —se imprime y se archiva uno a uno—,
		 * pero un canvas puede emitir varios del mismo periodo: el de ingresos
		 * tiene una hoja de otros ingresos y otra de adicionales, y se revisan
		 * seguidas. Sin esto habría que cerrar, cambiar de hoja en el canvas y
		 * volver a abrir para ver la otra mitad del mismo mes.
		 *
		 * Se omite en los canvas de un solo documento y la barra no cambia.
		 */
		pestanas?: Array<{ id: string; label: string }>;
		/** Id de la pestaña activa, de `pestanas`. */
		pestanaActiva?: string;
		onPestana?: (id: string) => void;
		onClose: () => void;
	}

	let {
		scope,
		documento,
		subtitulo = '',
		pestanas,
		pestanaActiva,
		onPestana,
		onClose
	}: Props = $props();

	/**
	 * Ancho del lienzo, en px.
	 *
	 * Los documentos de estos canvas son apaisados y con muchas columnas.
	 * Se dibujan anchos y se reducen por CSS, que es lo que hace legible una
	 * tabla de veinte columnas en pantalla; `ESCALA_PREVIEW` compensa el
	 * cuerpo tipográfico. Ver la nota de `pdf-tokens.ts`.
	 */
	const ANCHO_LIENZO = 2480;

	const CSS_DOC = documentoCss(ESCALA_PREVIEW);

	// `untrack`: el scope de un preview montado no cambia —cada canvas monta
	// el suyo— así que la selección se lee UNA vez y a partir de ahí manda lo
	// que el usuario marque, no lo que hubiera guardado.
	let seleccion = $state<string[]>(untrack(() => cargarSeleccion(scope)));
	let zoom = $state(0.6);
	let altoEscalado = $state(1200);
	let docEl: HTMLElement | null = $state(null);
	let exportando = $state(false);

	function aplicarSeleccion(keys: string[]) {
		seleccion = keys;
		guardarSeleccion(scope, keys);
	}

	// ─── Zoom y medida ─────────────────────────────────────
	function medir() {
		if (!docEl) return;
		altoEscalado = docEl.scrollHeight * zoom;
	}

	function ajustarAlAncho() {
		if (typeof window === 'undefined') return;
		const disponible = Math.max(280, window.innerWidth - 80);
		zoom = Math.max(0.25, Math.min(2.5, (disponible * 0.96) / ANCHO_LIENZO));
	}

	function fijarZoom(v: number) {
		zoom = Math.max(0.25, Math.min(2.5, v));
	}

	/// Remedir tras cada cambio de zoom o de columnas: la altura del
	/// documento depende de las dos cosas y el hueco reservado en el scroll
	/// se quedaría corto o sobrado.
	$effect(() => {
		zoom;
		seleccion;
		documento;
		if (typeof window !== 'undefined') requestAnimationFrame(medir);
	});

	/// El alto del documento cambia solo —una tabla que envuelve una celda,
	/// una fuente que termina de cargar— y el hueco reservado en el scroll
	/// tiene que seguirlo. Antes era una acción `use:`; con el papel en otro
	/// componente, el nodo llega por `bind:this` y el observador se ata aquí.
	$effect(() => {
		const node = docEl;
		if (!node) return;
		const observer = new ResizeObserver(() => medir());
		observer.observe(node);
		const t = setTimeout(medir, 30);
		return () => {
			observer.disconnect();
			clearTimeout(t);
		};
	});

	function onWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		fijarZoom(zoom + (e.deltaY < 0 ? 0.05 : -0.05));
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	// ─── Exportación ───────────────────────────────────────
	async function exportar() {
		if (exportando) return;
		if (!docEl) {
			toast.error('El documento aún no está listo.');
			return;
		}
		exportando = true;
		try {
			await exportarPdfDocumento(docEl, documento.nombreArchivo);
		} catch (e: any) {
			console.error('[preview-canvas] export PDF', e);
			toast.error('No se pudo generar el PDF', {
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportando = false;
		}
	}

	onMount(() => {
		window.addEventListener('wheel', onWheel, { passive: false });
		window.addEventListener('keydown', onKey);
		setTimeout(() => {
			ajustarAlAncho();
			setTimeout(medir, 60);
		}, 40);
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		window.removeEventListener('wheel', onWheel);
		window.removeEventListener('keydown', onKey);
	});
</script>

<!-- La hoja de estilos del documento se inyecta aquí y no en el <style>
     del componente: el mismo texto se manda al backend para el PDF, y el
     CSS con hashes de scope de Svelte no serviría allí. -->
{@html `<style>${CSS_DOC}</style>`}

<div class="prev-root">
	<!-- ── BARRA ── -->
	<div class="prev-bar no-print">
		<div class="prev-bar-l">
			<div class="prev-bar-text">
				<div class="prev-title">{documento.titulo}</div>
				{#if subtitulo}<div class="prev-sub">{subtitulo}</div>{/if}
			</div>
		</div>

		<div class="prev-bar-r">
			{#if pestanas && pestanas.length > 1}
				<div class="prev-tabs" role="tablist" aria-label="Hoja del documento">
					{#each pestanas as p (p.id)}
						<button
							role="tab"
							aria-selected={p.id === pestanaActiva}
							class:activa={p.id === pestanaActiva}
							onclick={() => onPestana?.(p.id)}
						>
							{p.label}
						</button>
					{/each}
				</div>
			{/if}

			<div class="prev-zoom">
				<button onclick={() => fijarZoom(zoom - 0.05)} title="Reducir">−</button>
				<span class="prev-zoom-val">{Math.round(zoom * 100)}%</span>
				<button onclick={() => fijarZoom(zoom + 0.05)} title="Aumentar">+</button>
				<button onclick={() => fijarZoom(1)} title="Tamaño real">↺</button>
				<button onclick={ajustarAlAncho} title="Ajustar al ancho">⤢</button>
			</div>

			<SelectorColumnasPreview {scope} {seleccion} onCambio={aplicarSeleccion} />

			<button class="prev-btn prev-btn-pdf" onclick={exportar} disabled={exportando}>
				{#if exportando}
					<span class="prev-spinner" aria-hidden="true"></span>
					Generando PDF…
				{:else}
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
						/>
					</svg>
					Exportar PDF
				{/if}
			</button>

			<button class="prev-btn" onclick={onClose} title="Cerrar el preview (Esc)">
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
				Cerrar
			</button>
		</div>
	</div>

	<!-- ── LIENZO ── -->
	<div class="prev-body">
		<div class="prev-scale" style="width: {ANCHO_LIENZO * zoom}px; height: {altoEscalado}px;">
			<DocumentoHoja {scope} {documento} {seleccion} ancho={ANCHO_LIENZO} {zoom} bind:el={docEl} />
		</div>
	</div>
</div>

<style>
	.prev-root {
		position: fixed;
		inset: 0;
		z-index: 400;
		background: #b0b8c2;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.prev-bar {
		flex-shrink: 0;
		background: #1a2421;
		border-bottom: 1px solid rgba(16, 185, 129, 0.18);
		box-shadow: 0 3px 16px rgba(0, 0, 0, 0.4);
		padding: 11px 20px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.prev-bar-l {
		min-width: 0;
		flex: 1;
	}
	.prev-bar-text {
		min-width: 0;
	}
	.prev-title {
		color: #fff;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prev-sub {
		margin-top: 2px;
		color: rgba(255, 255, 255, 0.6);
		font-size: 11.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prev-bar-r {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	/* Alterna entre los documentos hermanos de un mismo periodo (las dos
	   hojas del canvas de ingresos). Mismo envoltorio que `.prev-zoom` para
	   que la barra siga leyéndose como una sola fila de controles. */
	.prev-tabs {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.14);
	}
	.prev-tabs button {
		padding: 5px 12px;
		border: none;
		background: none;
		color: rgba(255, 255, 255, 0.7);
		font-size: 12px;
		font-weight: 600;
		border-radius: 5px;
		cursor: pointer;
		white-space: nowrap;
	}
	.prev-tabs button:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}
	.prev-tabs button.activa {
		background: rgba(255, 255, 255, 0.92);
		color: #0f172a;
	}
	.prev-zoom {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.14);
	}
	.prev-zoom button {
		width: 26px;
		height: 24px;
		border: none;
		background: none;
		color: #fff;
		font-size: 13px;
		border-radius: 5px;
		cursor: pointer;
	}
	.prev-zoom button:hover {
		background: rgba(255, 255, 255, 0.16);
	}
	.prev-zoom-val {
		min-width: 42px;
		text-align: center;
		color: rgba(255, 255, 255, 0.85);
		font-size: 11px;
		font-family: 'SF Mono', 'JetBrains Mono', monospace;
	}
	.prev-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 7px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
	}
	.prev-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.2);
	}
	.prev-btn:disabled {
		opacity: 0.65;
		cursor: default;
	}
	.prev-btn-pdf {
		background: #0f4025;
		border-color: #14532d;
	}
	.prev-btn-pdf:hover:not(:disabled) {
		background: #166534;
	}
	.prev-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: prev-spin 0.7s linear infinite;
	}
	@keyframes prev-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.prev-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 22px;
		display: flex;
		justify-content: center;
	}
	.prev-scale {
		position: relative;
		flex-shrink: 0;
	}
	/* El documento es `.doc`, definido en documento.css.ts (global). Aquí
	   solo se le da la sombra de hoja sobre la mesa del preview. */
	.prev-scale :global(.doc) {
		background: #fff;
		padding: 26px 30px 34px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
	}
</style>
