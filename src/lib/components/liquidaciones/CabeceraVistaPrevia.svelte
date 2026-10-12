<script lang="ts" module>
	export type HojaVistaPrevia = 'liquidacion' | 'recargos' | 'liquidador' | 'terceros';

	/** Un paso de la trazabilidad que se muestra junto al estado (liquidada, aprobada…). */
	export interface HitoVistaPrevia {
		etiqueta: string;
		/** Fecha completa, para el `title`. */
		fecha: string;
		/** Fecha corta, la que se ve. */
		corta: string;
		por?: string | null;
	}
</script>

<script lang="ts">
	/**
	 * Cabecera del visor de una liquidación de servicio: las cuatro hojas del
	 * documento oficial (liquidación, recargos, liquidador y terceros).
	 *
	 * El visor sigue siendo una capa a pantalla completa porque de ahí sale la
	 * impresión (`@media print` lo vuelve estático y solo deja las hojas). Lo
	 * que cambió es su cabecera: era una barra propia con pestañas, zoom y
	 * botones dibujados a mano, y ahora habla el lenguaje de los detalles del
	 * dashboard (`servicios/[id]`): fondo verde claro, botón redondo de volver,
	 * título fuerte, el estado como punto y las hojas con `TabsVista`.
	 *
	 * Es idéntico en los dos repos. Los colores salen de las variables de cada
	 * marca; los del estado los da quien llama (son semáforo).
	 */
	import {
		ChevronLeft,
		FileSpreadsheet,
		History,
		Maximize2,
		Minus,
		Plus,
		Printer,
		RotateCcw
	} from 'lucide-svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import TabsVista, { type TabVista } from '$lib/components/ui/TabsVista.svelte';

	interface Props {
		hoja: HojaVistaPrevia;
		verTerceros: boolean;
		consecutivo: string | null;
		/** «Octubre 2026». */
		periodo: string;
		cliente: string | null;
		estado: { etiqueta: string; color: string; apagado?: boolean } | null;
		/** Mientras carga solo se pinta la fila del título, sin hojas ni acciones. */
		cargando?: boolean;
		zoom: number;
		/** «Volver al listado», «Volver al editor» o «Cerrar»: el destino lo decide el editor. */
		volverEtiqueta: string;
		hitos?: HitoVistaPrevia[];
		/** Excel y trazabilidad solo existen para una liquidación guardada. */
		conAcciones?: boolean;
		excelCargando?: boolean;
		historialCargando?: boolean;
		onHoja: (hoja: HojaVistaPrevia) => void;
		onZoom: (zoom: number) => void;
		onAjustar: () => void;
		onVolver: () => void;
		onImprimir: () => void;
		onExcel?: () => void;
		onHistorial?: () => void;
	}

	let {
		hoja,
		verTerceros,
		consecutivo,
		periodo,
		cliente,
		estado,
		cargando = false,
		zoom,
		volverEtiqueta,
		hitos = [],
		conAcciones = false,
		excelCargando = false,
		historialCargando = false,
		onHoja,
		onZoom,
		onAjustar,
		onVolver,
		onImprimir,
		onExcel,
		onHistorial
	}: Props = $props();

	/// Mismos límites y paso que tenía la barra anterior: quien ya estaba
	/// acostumbrado a «dos clics para leer la letra pequeña» sigue igual.
	const ZOOM_MIN = 0.3;
	const ZOOM_MAX = 2.5;
	const ZOOM_PASO = 0.05;

	/// Código del formato de cada hoja, tal como va impreso en el documento.
	const FORMATOS: Record<HojaVistaPrevia, { codigo: string; nombre: string }> = {
		liquidacion: { codigo: 'OP-FR-07', nombre: 'Liquidación de servicios' },
		recargos: { codigo: 'OP-FR-06', nombre: 'Recargos (horas)' },
		liquidador: { codigo: 'OP-FR-06', nombre: 'Liquidador de recargos' },
		terceros: { codigo: 'GAF-FR-11', nombre: 'Liquidación de terceros' }
	};

	const pestanas = $derived<TabVista[]>([
		{ id: 'liquidacion', label: 'Liquidación' },
		{ id: 'recargos', label: 'Recargos' },
		{ id: 'liquidador', label: 'Liquidador' },
		...(verTerceros ? [{ id: 'terceros', label: 'Terceros' }] : [])
	]);

	const formato = $derived(FORMATOS[hoja] ?? FORMATOS.liquidacion);
	const numeroHoja = $derived(Math.max(1, pestanas.findIndex((p) => p.id === hoja) + 1));
	const titulo = $derived(
		cargando
			? 'Cargando liquidación…'
			: consecutivo
				? `Liquidación ${consecutivo}`
				: 'Liquidación sin consecutivo'
	);
	const meta = $derived([cliente || 'Sin cliente', periodo].filter(Boolean).join(' · '));

	function cambiarZoom(delta: number) {
		const siguiente = Math.round((zoom + delta) * 100) / 100;
		onZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, siguiente)));
	}
</script>

<header class="vp no-print" class:vp--cargando={cargando}>
	<div class="vp-fila">
		<button type="button" class="vp-volver" onclick={onVolver} aria-label={volverEtiqueta} title={volverEtiqueta}>
			<ChevronLeft size={20} strokeWidth={2.4} aria-hidden="true" />
		</button>

		<div class="vp-titulos">
			<span class="vp-eyebrow">
				{formato.codigo} · {cargando ? 'Vista previa' : `Hoja ${numeroHoja} de ${pestanas.length}`}
			</span>
			<div class="vp-titulo-fila">
				<h1 class="vp-titulo">{titulo}</h1>
				{#if estado && !cargando}
					<EstadoPunto etiqueta={estado.etiqueta} color={estado.color} apagado={estado.apagado} />
				{/if}
			</div>
			{#if !cargando}
				<p class="vp-meta">
					<span class="vp-meta-dato">{meta}</span>
					{#each hitos as hito (hito.etiqueta)}
						<span
							class="vp-hito"
							title="{hito.etiqueta}: {hito.fecha}{hito.por ? ` por ${hito.por}` : ''}"
						>
							{hito.etiqueta} <strong>{hito.corta}</strong>{#if hito.por}<span class="vp-hito-por"
									>· {hito.por}</span
								>{/if}
						</span>
					{/each}
				</p>
			{/if}
		</div>

		{#if !cargando}
			<div class="vp-acciones">
				{#if conAcciones}
					<button
						type="button"
						class="btn-secondary vp-accion"
						onclick={onExcel}
						disabled={excelCargando}
						title="Descargar el Excel: liquidación, recargos y trazabilidad"
						aria-label="Descargar Excel"
					>
						<FileSpreadsheet size={15} aria-hidden="true" />
						<span class="vp-accion-texto">{excelCargando ? 'Generando…' : 'Excel'}</span>
					</button>
					<button
						type="button"
						class="btn-secondary vp-accion"
						onclick={onHistorial}
						disabled={historialCargando}
						title="Ver la trazabilidad de estados"
						aria-label="Trazabilidad"
					>
						<History size={15} aria-hidden="true" />
						<span class="vp-accion-texto">Trazabilidad</span>
					</button>
				{/if}
				<button type="button" class="btn-primary vp-accion" onclick={onImprimir}>
					<Printer size={15} aria-hidden="true" />
					<span class="vp-accion-texto">Imprimir / PDF</span>
					<span class="vp-accion-corto">PDF</span>
				</button>
			</div>
		{/if}
	</div>

	{#if !cargando}
		<div class="vp-fila vp-fila--hojas">
			<div class="vp-hojas">
				<TabsVista
					tabs={pestanas}
					activa={hoja}
					etiqueta="Hojas del documento"
					onCambiar={(id) => onHoja(id as HojaVistaPrevia)}
				/>
			</div>
			<div class="vp-zoom" role="group" aria-label="Zoom de la hoja">
				<button
					type="button"
					onclick={() => cambiarZoom(-ZOOM_PASO)}
					disabled={zoom <= ZOOM_MIN}
					aria-label="Reducir zoom"
					title="Reducir zoom"
				>
					<Minus size={14} strokeWidth={2.4} aria-hidden="true" />
				</button>
				<span class="vp-zoom-valor" aria-live="polite">{Math.round(zoom * 100)} %</span>
				<button
					type="button"
					onclick={() => cambiarZoom(ZOOM_PASO)}
					disabled={zoom >= ZOOM_MAX}
					aria-label="Aumentar zoom"
					title="Aumentar zoom"
				>
					<Plus size={14} strokeWidth={2.4} aria-hidden="true" />
				</button>
				<span class="vp-zoom-sep" aria-hidden="true"></span>
				<button type="button" onclick={onAjustar} aria-label="Ajustar al ancho" title="Ajustar al ancho">
					<Maximize2 size={14} aria-hidden="true" />
				</button>
				<button
					type="button"
					class="vp-zoom-reset"
					onclick={() => onZoom(1)}
					aria-label="Volver al 100 %"
					title="Volver al 100 %"
				>
					<RotateCcw size={14} aria-hidden="true" />
				</button>
			</div>
		</div>
	{/if}
</header>

<style>
	.vp {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.85rem 1.5rem 0;
		background: var(--color-emerald-50);
	}
	.vp--cargando {
		padding-bottom: 0.85rem;
		border-bottom: 1.5px solid var(--border-default);
	}

	.vp-fila {
		display: flex;
		align-items: center;
		gap: 0.75rem 1rem;
		min-width: 0;
	}

	/* Mismo botón redondo que el detalle de servicios. */
	.vp-volver {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border: 0;
		border-radius: 999px;
		background: #fff;
		color: var(--color-emerald-900);
		box-shadow: 0 4px 12px rgba(1, 67, 57, 0.08);
		cursor: pointer;
		transition: transform 0.15s ease;
	}
	.vp-volver:hover {
		transform: translateX(-1px);
	}
	.vp-volver:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}

	.vp-titulos {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.vp-eyebrow {
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.vp-titulo-fila {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		min-width: 0;
	}
	.vp-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.3125rem;
		font-weight: 800;
		line-height: 1.25;
		letter-spacing: -0.02em;
		color: var(--color-gray-950);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.vp-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.vp-meta-dato {
		font-weight: 600;
		color: var(--text-secondary);
	}
	.vp-hito {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.75);
		border: 1px solid var(--border-default);
		font-size: 0.72rem;
		white-space: nowrap;
	}
	.vp-hito strong {
		color: var(--text-primary);
		font-weight: 700;
	}
	.vp-hito-por {
		color: var(--text-muted);
	}

	.vp-acciones {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.vp-accion {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		white-space: nowrap;
	}
	.vp-accion-corto {
		display: none;
	}

	/* Fila de hojas: pestañas a la izquierda, zoom a la derecha. La línea de
	   las pestañas es el borde inferior de la cabecera. */
	.vp-fila--hojas {
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.vp-hojas {
		flex: 1 1 auto;
		min-width: 0;
	}
	/* La pestaña activa toma el color del escritorio de abajo (el fondo del
	   visor en `LiquidacionEditor`), así la hoja se lee como «abierta». */
	.vp-hojas :global(.tv--claro .tv-tab.activa) {
		background: var(--color-gray-100);
	}

	.vp-zoom {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		flex-shrink: 0;
		margin-bottom: 0.4rem;
		padding: 0.2rem;
		background: #fff;
		border: 1px solid var(--border-default);
		border-radius: 10px;
	}
	.vp-zoom button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.vp-zoom button:hover:not(:disabled) {
		background: var(--color-emerald-50);
		color: var(--color-emerald-900);
	}
	.vp-zoom button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.vp-zoom button:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: -2px;
	}
	.vp-zoom-valor {
		min-width: 3.25rem;
		text-align: center;
		font-size: 0.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.vp-zoom-sep {
		width: 1px;
		height: 18px;
		margin: 0 0.15rem;
		background: var(--border-default);
	}

	@media (max-width: 900px) {
		.vp {
			padding: 0.75rem 1rem 0;
		}
		/* Los hitos ya están en «Trazabilidad»: en pantallas medianas estorban. */
		.vp-hito {
			display: none;
		}
	}

	@media (max-width: 640px) {
		.vp {
			gap: 0.5rem;
			padding: 0.6rem 0.75rem 0;
		}
		.vp-fila {
			gap: 0.6rem;
		}
		.vp-titulo {
			font-size: 1.05rem;
		}
		.vp-eyebrow {
			font-size: 0.62rem;
		}
		/* Acciones en solo ícono; «Imprimir / PDF» se queda como «PDF». */
		.vp-accion-texto {
			display: none;
		}
		.vp-accion-corto {
			display: inline;
		}
		.vp-acciones {
			gap: 0.35rem;
		}
		.vp-zoom-valor,
		.vp-zoom-reset,
		.vp-zoom-sep {
			display: none;
		}
	}

	@media print {
		.vp {
			display: none !important;
		}
	}
</style>
