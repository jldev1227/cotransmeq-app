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
	import { exportarPdfCompuesto, exportarPdfDocumento } from './exportar-pdf';
	import DocumentoHoja from './DocumentoHoja.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
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
		/**
		 * Documentos hermanos que se NAVEGAN de uno en uno: «3 / 42 · NOMBRE».
		 *
		 * Para cuando son demasiados para pestañas —un conductor por hoja en el
		 * consolidado de recorridos—. En pantalla solo está el visible; las
		 * flechas del teclado pasan página.
		 */
		paginador?: {
			indice: number;
			total: number;
			etiqueta: string;
			onIr: (indice: number) => void;
		};
		/**
		 * Un segundo botón de exportación para un documento que NO es el visible:
		 * el consolidado de todos los conductores desde el preview paginado. Se
		 * compone fuera de pantalla y se abre igual que el visible.
		 */
		exportarTodo?: { documento: DocumentoPreview; etiqueta: string };
		/**
		 * Versión para PAPEL del documento visible, si difiere del que se enseña.
		 *
		 * El preview y el PDF son el mismo documento, pero no siempre con el
		 * mismo reparto de columnas: en pantalla sobra ancho y en papel no. Si
		 * viene, «Exportar» compone ESTE fuera de pantalla en vez de clonar el
		 * DOM visible.
		 */
		documentoPdf?: DocumentoPreview;
		onClose: () => void;
	}

	let {
		scope,
		documento,
		subtitulo = '',
		pestanas,
		pestanaActiva,
		onPestana,
		paginador,
		exportarTodo,
		documentoPdf,
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
	let rootEl: HTMLElement | null = $state(null);
	let bodyEl: HTMLElement | null = $state(null);
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
		/// Ancho del lienzo dentro del modal (menos su relleno); sin él aún, la
		/// ventana con el margen del modal.
		const disponible = Math.max(280, bodyEl ? bodyEl.clientWidth - 44 : window.innerWidth - 120);
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
		// Escape lo gestiona ModalBase.
		if (!paginador) return;
		// Pasar página con el teclado, salvo que el foco esté en un control DEL
		// PREVIEW (el selector de columnas, por ejemplo). El foco suele seguir
		// en el botón del carril que abrió el modal: ese no cuenta.
		const objetivo = e.target as HTMLElement | null;
		if (rootEl?.contains(objetivo) && objetivo?.closest?.('input, select, textarea, button')) return;
		if (e.key === 'ArrowRight' || e.key === 'PageDown') paginador.onIr(paginador.indice + 1);
		if (e.key === 'ArrowLeft' || e.key === 'PageUp') paginador.onIr(paginador.indice - 1);
	}

	let exportandoTodo = $state(false);

	async function exportarTodos() {
		if (!exportarTodo || exportandoTodo) return;
		exportandoTodo = true;
		try {
			await exportarPdfCompuesto(
				scope,
				exportarTodo.documento,
				exportarTodo.documento.nombreArchivo,
				seleccion
			);
		} catch (e: any) {
			console.error('[preview-canvas] export PDF (todos)', e);
			toast.error('No se pudo generar el PDF de todos', {
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoTodo = false;
		}
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
			if (documentoPdf) {
				await exportarPdfCompuesto(scope, documentoPdf, documentoPdf.nombreArchivo, seleccion);
			} else {
				await exportarPdfDocumento(docEl, documento.nombreArchivo);
			}
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

<!-- Documentos hermanos del mismo periodo, como pestañas del encabezado. -->
{#snippet hojas()}
	<TabsVista
		tabs={pestanas ?? []}
		activa={pestanaActiva ?? ''}
		variante="oscuro"
		etiqueta="Hoja del documento"
		onCambiar={(id) => onPestana?.(id)}
	/>
{/snippet}

<ModalBase
	open={true}
	eyebrow="Vista previa"
	title={documento.titulo}
	subtitle={subtitulo || null}
	tamano="full"
	sinRelleno
	oncerrar={onClose}
	cabecera={pestanas && pestanas.length > 1 ? hojas : undefined}
>
	<div class="prev-root" bind:this={rootEl}>
		<!-- ── BARRA DE HERRAMIENTAS ── -->
		<div class="prev-tools no-print">
			{#if paginador && paginador.total > 1}
				<div class="prev-pager" aria-label="Conductor del documento">
					<button
						type="button"
						onclick={() => paginador?.onIr(paginador.indice - 1)}
						disabled={paginador.indice <= 0}
						title="Anterior (←)"
						aria-label="Anterior"
					>
						‹
					</button>
					<span class="prev-pager-pos">{paginador.indice + 1} / {paginador.total}</span>
					<span class="prev-pager-nombre" title={paginador.etiqueta}>{paginador.etiqueta}</span>
					<button
						type="button"
						onclick={() => paginador?.onIr(paginador.indice + 1)}
						disabled={paginador.indice >= paginador.total - 1}
						title="Siguiente (→)"
						aria-label="Siguiente"
					>
						›
					</button>
				</div>
			{/if}

			<div class="prev-tools-r">
				<div class="prev-zoom">
					<button type="button" onclick={() => fijarZoom(zoom - 0.05)} title="Reducir">−</button>
					<span class="prev-zoom-val">{Math.round(zoom * 100)}%</span>
					<button type="button" onclick={() => fijarZoom(zoom + 0.05)} title="Aumentar">+</button>
					<button type="button" onclick={() => fijarZoom(1)} title="Tamaño real">↺</button>
					<button type="button" onclick={ajustarAlAncho} title="Ajustar al ancho">⤢</button>
				</div>

				<SelectorColumnasPreview {scope} {seleccion} onCambio={aplicarSeleccion} />
			</div>
		</div>

		<!-- ── LIENZO ── -->
		<div class="prev-body" bind:this={bodyEl}>
			<div class="prev-scale" style="width: {ANCHO_LIENZO * zoom}px; height: {altoEscalado}px;">
				<DocumentoHoja {scope} {documento} {seleccion} ancho={ANCHO_LIENZO} {zoom} bind:el={docEl} />
			</div>
		</div>
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={onClose}>Cerrar</button>

		{#if exportarTodo}
			<button type="button" class="btn-secondary" onclick={exportarTodos} disabled={exportandoTodo}>
				{#if exportandoTodo}
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
							d="M8 7V5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-2M5 8h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2z"
						/>
					</svg>
					{exportarTodo.etiqueta}
				{/if}
			</button>
		{/if}

		<button type="button" class="btn-primary" onclick={exportar} disabled={exportando}>
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
				{exportarTodo ? 'Exportar este' : 'Exportar PDF'}
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.prev-root {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.prev-tools {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px;
		padding: 10px 22px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
	}
	.prev-tools-r {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* Paginador del consolidado: un documento por conductor, de uno en uno. */
	.prev-pager,
	.prev-zoom {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: 12px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
	}
	.prev-pager {
		gap: 4px;
		max-width: 380px;
		min-width: 0;
	}
	.prev-pager button,
	.prev-zoom button {
		width: 30px;
		height: 30px;
		border: none;
		background: none;
		color: var(--text-primary);
		font-size: 14px;
		line-height: 1;
		border-radius: 9px;
		cursor: pointer;
	}
	.prev-pager button {
		font-size: 17px;
	}
	.prev-pager button:hover:not(:disabled),
	.prev-zoom button:hover {
		background: var(--bg-surface);
	}
	.prev-pager button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.prev-pager-pos,
	.prev-zoom-val {
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.prev-zoom-val {
		min-width: 44px;
		text-align: center;
	}
	.prev-pager-nombre {
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		padding: 0 4px;
	}
	/* El selector de columnas trae un botón pensado para barra oscura: aquí
	   va sobre la barra clara del modal. */
	.prev-tools :global(.cols-btn) {
		min-height: 38px;
		padding: 6px 12px;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 13px;
	}
	.prev-tools :global(.cols-btn:hover) {
		background: var(--bg-base);
	}
	.prev-tools :global(.cols-count) {
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.prev-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid currentColor;
		border-top-color: transparent;
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
		/* La «mesa» del preview: un tono por debajo del fondo para que la hoja
		   blanca se lea como papel. */
		background: color-mix(in srgb, var(--bg-charcoal-deep) 10%, var(--bg-base));
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
		box-shadow: 0 10px 40px rgba(0, 29, 23, 0.18);
	}
</style>
