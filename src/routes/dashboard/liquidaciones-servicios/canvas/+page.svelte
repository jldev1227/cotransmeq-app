<!--
	Canvas del HISTORIAL DE LIQUIDACIONES DE SERVICIOS.

	Una fila = una liquidación, en una sola hoja. Operaciones pidió poder ver el
	histórico completo y facturar desde ahí mismo, sin ir saltando entre el
	listado, el modal y el tab de facturas.

	La hoja es de SOLO LECTURA (ver `cell-permission-servicios-historial.ts`):
	editar una liquidación exige recalcular IVA y totales, y eso vive en su
	formulario. Lo que sí se hace aquí es trabajar con facturas — crear una,
	asociar a una existente, desasociar — y para eso el carril lateral opera
	sobre las FILAS SELECCIONADAS en la hoja, que es la novedad respecto de los
	canvas de terceros: allí las acciones en lote se hacían en un modal con su
	propia lista de checkboxes, obligando a volver a buscar lo que ya estaba en
	pantalla.
-->
<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';

	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import UniverSideRail from '$lib/components/univer/UniverSideRail.svelte';
	import UniverActionOverlay, {
		type AccionEnCurso
	} from '$lib/components/univer/UniverActionOverlay.svelte';
	import ModalFacturar from '$lib/components/ModalFacturar.svelte';

	import {
		createHistorialEngine,
		disposeEngine,
		type HistorialEngineContext
	} from '$lib/editor/univer/servicios-historial-engine';
	import { installHistorialCellPermission, repintando } from '$lib/editor/univer/cell-permission-servicios-historial';
	import { attachSelectionPlugin } from '$lib/editor/univer/plugins/selection.plugin';
	import {
		COL,
		estiloCeldaEstado,
		estiloCeldaFactura,
		type FilaHistorial
	} from '$lib/editor/builders/servicios-historial.builder';
	import { exportarHistorialXLSX } from '$lib/editor/builders/servicios-historial-excel';

	import {
		liquidacionesServiciosAPI,
		type LiquidacionServicio
	} from '$lib/api/liquidaciones-servicios';
	import {
		facturacionLiquidacionesAPI,
		type FacturaLiquidacion,
		type LiquidacionAfectada
	} from '$lib/api/facturacionLiquidaciones';
	import { socketUtils } from '$lib/socket';

	// ─── Estado ────────────────────────────────────────────────────────

	let container = $state<HTMLDivElement | null>(null);
	let ctx: HistorialEngineContext | null = null;
	let canvasDisposers: Array<() => void> = [];
	/// Descarta engines de un montaje que perdió la carrera contra otro.
	let mountToken = 0;

	let liquidaciones = $state<LiquidacionServicio[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let accionEnCurso = $state<AccionEnCurso | null>(null);

	/// Filas (coordenadas de Univer) seleccionadas ahora mismo en la hoja.
	let filasSeleccionadas = $state<number[]>([]);

	let modalFacturar = $state(false);
	let facturasActivas = $state<FacturaLiquidacion[]>([]);
	let cargandoFacturas = $state(false);
	let busquedaFactura = $state('');
	let exportando = $state(false);

	/// Año del histórico. Sin valor = todo. Viaja en la URL para poder
	/// compartir el enlace de un año concreto.
	const anio = $derived($page.url.searchParams.get('anio') ?? '');

	// ─── Selección → liquidaciones ─────────────────────────────────────

	/**
	 * Las filas seleccionadas traducidas a liquidaciones.
	 *
	 * El encabezado y el pie de totales también entran en un rango que el
	 * usuario arrastre de arriba abajo; se descartan aquí, porque no tienen
	 * entrada en el índice del builder.
	 */
	const seleccion = $derived.by<FilaHistorial[]>(() => {
		if (!ctx) return [];
		const out: FilaHistorial[] = [];
		for (const f of filasSeleccionadas) {
			const info = ctx.modelo.filas.get(f);
			if (info) out.push(info);
		}
		return out;
	});

	const facturables = $derived(
		seleccion.filter((s) => s.estado === 'LIQUIDADA' || s.estado === 'APROBADA')
	);
	const yaFacturadas = $derived(seleccion.filter((s) => s.estado === 'FACTURADA' && s.factura_id));

	const totalSeleccionado = $derived(seleccion.reduce((s, l) => s + l.total, 0));

	const COP = (v: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(v || 0);

	/// Las liquidaciones completas correspondientes a la selección facturable:
	/// `ModalFacturar` espera objetos `LiquidacionServicio`, no el índice del
	/// builder.
	const facturablesCompletas = $derived.by(() => {
		const ids = new Set(facturables.map((f) => f.id));
		return liquidaciones.filter((l) => ids.has(l.id));
	});

	const facturasFiltradas = $derived.by(() => {
		const q = busquedaFactura.trim().toLowerCase();
		if (!q) return facturasActivas;
		return facturasActivas.filter((f) => f.numero_factura.toLowerCase().includes(q));
	});

	// ─── Carga ─────────────────────────────────────────────────────────

	async function loadInicial() {
		loading = true;
		loadError = '';
		try {
			/// Todo el histórico de un tirón: son ~520 liquidaciones vivas y el
			/// backend clampea `limit` a 2000. Paginar aquí obligaría a inventar
			/// un scroll infinito dentro de una hoja de cálculo, que es justo lo
			/// que la hoja evita.
			const res = await liquidacionesServiciosAPI.listar({
				page: 1,
				limit: 2000,
				...(anio ? { anio: Number(anio) } : {})
			});
			liquidaciones = res.liquidaciones ?? [];
			await remountEngine();
		} catch (e: any) {
			loadError = e?.message || 'No se pudo cargar el historial';
		} finally {
			loading = false;
		}
	}

	// ─── Engine ────────────────────────────────────────────────────────

	async function mountEngineNow() {
		if (!container || liquidaciones.length === 0) return;
		const token = mountToken;

		try {
			const nuevo = createHistorialEngine({ container, liquidaciones });
			if (token !== mountToken) {
				// Otro montaje ganó la carrera: se descarta este para no dejar un
				// Univer huérfano con su Worker de fórmulas vivo.
				disposeEngine(nuevo.univer, nuevo.fUniver, nuevo.unitId, container);
				return;
			}
			ctx = nuevo;

			canvasDisposers.push(
				installHistorialCellPermission(nuevo.univer, {
					onBloqueado: ({ titulo, detalle }) =>
						/// `id` fijo: un intento dispara el comando y su mutación, y el
						/// menú contextual puede encadenar varios. Sin la clave salen
						/// tres o cuatro avisos idénticos apilados.
						toast.warning(titulo, {
							id: 'historial-solo-lectura',
							description: detalle,
							duration: 7000
						})
				})
			);

			canvasDisposers.push(
				attachSelectionPlugin({
					fUniver: nuevo.fUniver,
					container,
					onChange: (filas) => {
						filasSeleccionadas = filas;
					}
				})
			);
		} catch (e: any) {
			console.error('[historial] error al montar el canvas', e);
			toast.error('Error al renderizar el canvas: ' + (e?.message || ''));
		}
	}

	function teardownEngine() {
		for (const d of canvasDisposers) {
			try {
				d();
			} catch {
				/* noop */
			}
		}
		canvasDisposers = [];
		if (ctx && container) {
			disposeEngine(ctx.univer, ctx.fUniver, ctx.unitId, container);
		}
		ctx = null;
		filasSeleccionadas = [];
	}

	async function remountEngine() {
		if (!container) return;
		mountToken++;
		teardownEngine();
		await tick();
		await mountEngineNow();
	}

	// ─── Repintado puntual ─────────────────────────────────────────────

	/**
	 * Refleja en la hoja el cambio de estado/factura de unas liquidaciones,
	 * sin reconstruir el libro.
	 *
	 * Remontar tras cada acción costaría rehacer 520 filas y —lo que de verdad
	 * molesta— devolvería el scroll al principio, perdiendo de vista justo la
	 * fila sobre la que se acaba de actuar.
	 */
	function aplicarCambios(cambios: LiquidacionAfectada[]) {
		if (!ctx) return;
		repintando(() => {
			for (const c of cambios) {
				const fila = ctx!.modelo.filaPorLiquidacion.get(c.id);
				if (fila == null) continue;

				ctx!.pintarCelda(fila, COL.ESTADO, c.estado, estiloCeldaEstado(fila, c.estado));
				ctx!.pintarCelda(
					fila,
					COL.FACTURA,
					c.numero_factura ?? '',
					estiloCeldaFactura(fila, !!c.numero_factura)
				);

				// El índice del builder es la fuente de verdad de qué se puede
				// hacer con cada fila; si no se actualiza, el carril seguiría
				// ofreciendo "Facturar" sobre algo ya facturado.
				const info = ctx!.modelo.filas.get(fila);
				if (info) {
					info.estado = c.estado;
					info.factura_id = c.factura_id;
					info.numero_factura = c.numero_factura;
				}

				// Y el array de origen, para que ModalFacturar y el XLSX no vean
				// un estado viejo.
				const l = liquidaciones.find((x) => x.id === c.id);
				if (l) {
					l.estado = c.estado;
					l.factura_items = c.factura_id
						? [
								{
									factura: {
										id: c.factura_id,
										numero_factura: c.numero_factura!,
										estado: 'ACTIVA'
									}
								}
							]
						: [];
				}
			}
		});
		// Fuerza el recálculo de los `$derived` que dependen del índice mutado.
		filasSeleccionadas = [...filasSeleccionadas];
	}

	// ─── Acciones del carril ───────────────────────────────────────────

	async function conOverlay<T>(
		accion: AccionEnCurso,
		fn: () => Promise<T>
	): Promise<T | undefined> {
		// El velo tapa los botones, pero el teclado puede activar uno que
		// tuviera el foco.
		if (accionEnCurso) return;
		accionEnCurso = accion;
		try {
			return await fn();
		} finally {
			accionEnCurso = null;
		}
	}

	function abrirFacturar() {
		if (facturables.length === 0) return;
		modalFacturar = true;
	}

	function onFacturaCreada(factura: FacturaLiquidacion) {
		modalFacturar = false;
		aplicarCambios(
			factura.items.map((i) => ({
				id: i.liquidacion_id,
				consecutivo: i.liquidacion?.consecutivo ?? '',
				estado: 'FACTURADA' as const,
				factura_id: factura.id,
				numero_factura: factura.numero_factura
			}))
		);
		toast.success(`Factura ${factura.numero_factura} creada`, {
			description: `${factura.items.length} liquidaciones por ${COP(factura.valor_total)}.`
		});
	}

	async function cargarFacturasActivas() {
		if (cargandoFacturas) return;
		cargandoFacturas = true;
		try {
			const res = await facturacionLiquidacionesAPI.listar({
				page: 1,
				limit: 200,
				estado: 'ACTIVA'
			});
			facturasActivas = res.facturas ?? [];
		} catch (e: any) {
			toast.error('No se pudieron cargar las facturas: ' + (e?.message || ''));
		} finally {
			cargandoFacturas = false;
		}
	}

	async function asociarA(factura: FacturaLiquidacion) {
		const ids = facturables.map((f) => f.id);
		if (ids.length === 0) return;

		await conOverlay(
			{
				titulo: `Asociando a la factura ${factura.numero_factura}`,
				detalle: `${ids.length} liquidación(es) por ${COP(
					facturables.reduce((s, f) => s + f.total, 0)
				)}.`
			},
			async () => {
				try {
					const res = await facturacionLiquidacionesAPI.agregarLiquidaciones(factura.id, ids);
					aplicarCambios(res.liquidaciones_afectadas);
					// La factura cambió de total: la copia del panel quedaría vieja.
					facturasActivas = facturasActivas.map((f) =>
						f.id === res.factura.id ? res.factura : f
					);
					toast.success(`Asociadas a ${factura.numero_factura}`, {
						description: `La factura suma ahora ${COP(res.factura.valor_total)}.`
					});
				} catch (e: any) {
					toast.error('No se pudo asociar', {
						description: e?.response?.data?.error || e?.message || ''
					});
				}
			}
		);
	}

	async function desasociarSeleccion() {
		const objetivo = [...yaFacturadas];
		if (objetivo.length === 0) return;

		const consecutivos = objetivo.map((o) => o.consecutivo).join(', ');
		if (
			!confirm(
				`¿Quitar ${objetivo.length} liquidación(es) de su factura?\n\n${consecutivos}\n\n` +
					'Volverán a estado LIQUIDADA y el total de la factura se recalculará.'
			)
		) {
			return;
		}

		await conOverlay(
			{
				titulo: 'Desasociando de su factura',
				detalle: `${objetivo.length} liquidación(es).`
			},
			async () => {
				const cambios: LiquidacionAfectada[] = [];
				const fallos: string[] = [];
				let alguna: string | null = null;

				// Secuencial y no en paralelo: cada llamada recalcula el
				// `valor_total` de la misma factura, y varias a la vez sobre una
				// fila la dejarían con el total de la última que ganara.
				for (const o of objetivo) {
					try {
						const res = await facturacionLiquidacionesAPI.quitarLiquidacion(
							o.factura_id!,
							o.id
						);
						cambios.push(...res.liquidaciones_afectadas);
						if (res.quedo_vacia) alguna = o.numero_factura;
					} catch (e: any) {
						fallos.push(`${o.consecutivo}: ${e?.response?.data?.error || e?.message || ''}`);
					}
				}

				if (cambios.length > 0) aplicarCambios(cambios);

				if (fallos.length > 0) {
					toast.error(`${fallos.length} no se pudieron quitar`, {
						description: fallos.slice(0, 3).join(' · ')
					});
				} else {
					toast.success(`${cambios.length} liquidación(es) desasociadas`);
				}
				if (alguna) {
					toast.warning(`La factura ${alguna} se quedó sin liquidaciones`, {
						description: 'No se borra sola: anúlala y elimínala desde el tab de Facturas.',
						duration: 9000
					});
				}
			}
		);
	}

	async function exportar() {
		if (exportando || liquidaciones.length === 0) return;
		exportando = true;
		try {
			const sufijo = anio || 'completo';
			await exportarHistorialXLSX(liquidaciones, `historial_liquidaciones_${sufijo}.xlsx`);
		} catch (e: any) {
			toast.error('No se pudo exportar: ' + (e?.message || ''));
		} finally {
			exportando = false;
		}
	}

	// ─── Sockets ───────────────────────────────────────────────────────

	/// Otro usuario facturó o anuló: se repinta esa fila. Es el mismo evento
	/// que consume el listado clásico, así que ambas vistas van a la par.
	function onFacturada(data: any) {
		if (!data?.id) return;
		aplicarCambios([
			{
				id: data.id,
				consecutivo: '',
				estado: data.estado === 'FACTURADA' ? 'FACTURADA' : 'LIQUIDADA',
				factura_id: data.factura_id ?? null,
				numero_factura: data.numero_factura ?? null
			}
		]);
	}

	// ─── Ciclo de vida ─────────────────────────────────────────────────

	onMount(() => {
		loadInicial();
		socketUtils.on('liquidacion-servicio-facturada', onFacturada);
	});

	onDestroy(() => {
		socketUtils.off('liquidacion-servicio-facturada', onFacturada);
		teardownEngine();
	});
</script>

<UniverToolbar
	title="Historial de liquidaciones de servicios"
	subtitle={anio
		? `Año ${anio} · ${liquidaciones.length} liquidaciones`
		: `${liquidaciones.length} liquidaciones`}
	onBack={() => goto('/dashboard/liquidaciones-servicios')}
>
	{#snippet actions()}
		<select
			class="hs-select"
			value={anio}
			onchange={(e) => {
				const v = (e.currentTarget as HTMLSelectElement).value;
				goto(v ? `?anio=${v}` : '?', { replaceState: true, noScroll: true }).then(loadInicial);
			}}
			aria-label="Filtrar por año"
		>
			<option value="">Todo el histórico</option>
			{#each Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i) as y}
				<option value={String(y)}>{y}</option>
			{/each}
		</select>

		{#if seleccion.length > 0}
			<span class="univer-badge">
				{seleccion.length} sel. · {COP(totalSeleccionado)}
			</span>
		{/if}
	{/snippet}
</UniverToolbar>

<div class="hs-body">
	<div class="hs-canvas">
		{#if !loading && !loadError && liquidaciones.length === 0}
			<div class="hs-vacio">
				<h2>No hay liquidaciones</h2>
				<p>
					{anio
						? `No se registró ninguna liquidación de servicios en ${anio}.`
						: 'Todavía no hay liquidaciones de servicios en el histórico.'}
				</p>
			</div>
		{:else}
			<!-- `loading && !accionEnCurso`: durante una acción del carril el velo
			     lo pone `UniverActionOverlay`, que además tapa el carril y dice QUÉ
			     se está haciendo. Los dos a la vez apilarían dos desenfoques. -->
			<UniverCanvasHost
				bind:container
				loading={loading && !accionEnCurso}
				error={loadError}
				loadingLabel="Cargando historial…"
				onRetry={loadInicial}
				errorLabel="Reintentar"
			/>
		{/if}
	</div>

	<!-- El array se arma AQUÍ y no en el <script> porque referencia snippets,
	     que solo están en ámbito desde la plantilla. -->
	<UniverSideRail
		ariaLabel="Acciones del historial de liquidaciones"
		items={[
			{
				id: 'facturar',
				label: 'Crear factura',
				hint: `Crea una factura nueva con las ${facturables.length} liquidación(es) facturables de la selección.`,
				icon: icoFactura,
				tone: 'green',
				disabled: facturables.length === 0 || !!accionEnCurso,
				disabledHint:
					seleccion.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las filas seleccionadas está en LIQUIDADA o APROBADA.',
				onSelect: abrirFacturar
			},
			{
				id: 'asociar',
				label: 'Asociar a factura existente',
				hint: `Engancha las ${facturables.length} liquidación(es) facturables a una factura ya creada.`,
				icon: icoAsociar,
				tone: 'blue',
				disabled: facturables.length === 0 || !!accionEnCurso,
				disabledHint:
					seleccion.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las filas seleccionadas está en LIQUIDADA o APROBADA.',
				panel: panelAsociar,
				panelWidth: 340
			},
			{
				id: 'desasociar',
				label: 'Quitar de su factura',
				hint: `Devuelve a LIQUIDADA las ${yaFacturadas.length} fila(s) facturadas de la selección y recalcula el total de su factura.`,
				icon: icoDesasociar,
				tone: 'red',
				disabled: yaFacturadas.length === 0 || !!accionEnCurso,
				disabledHint:
					seleccion.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las filas seleccionadas está facturada.',
				onSelect: desasociarSeleccion
			},
			{ type: 'sep' },
			{
				id: 'excel',
				label: exportando ? 'Generando…' : 'Exportar a Excel',
				hint: 'Descarga el histórico visible como XLSX, con los importes como número y filtros en la cabecera.',
				icon: icoExcel,
				busy: exportando,
				disabled: liquidaciones.length === 0,
				disabledHint: 'No hay nada que exportar.',
				onSelect: exportar
			}
		]}
	/>

	<!-- Último hijo de `.hs-body` para que cubra también el carril. -->
	<UniverActionOverlay accion={accionEnCurso} />
</div>

<ModalFacturar
	open={modalFacturar}
	liquidaciones={facturablesCompletas}
	preselectedIds={facturables.map((f) => f.id)}
	on:created={(e) => onFacturaCreada(e.detail.factura)}
	on:close={() => (modalFacturar = false)}
/>

{#snippet panelAsociar()}
	<div class="hs-panel">
		<p class="hs-panel-intro">
			{facturables.length} liquidación(es) ·
			<strong>{COP(facturables.reduce((s, f) => s + f.total, 0))}</strong>
		</p>
		<input
			class="hs-buscar"
			type="search"
			placeholder="Buscar factura por número…"
			bind:value={busquedaFactura}
			onfocus={() => {
				if (facturasActivas.length === 0) cargarFacturasActivas();
			}}
		/>
		{#if cargandoFacturas}
			<p class="hs-panel-nota">Cargando facturas…</p>
		{:else if facturasActivas.length === 0}
			<button class="univer-btn univer-btn-blue" onclick={cargarFacturasActivas}>
				Cargar facturas activas
			</button>
		{:else if facturasFiltradas.length === 0}
			<p class="hs-panel-nota">Ninguna factura activa coincide con «{busquedaFactura}».</p>
		{:else}
			<ul class="hs-facturas">
				{#each facturasFiltradas.slice(0, 40) as f (f.id)}
					<li>
						<button onclick={() => asociarA(f)} disabled={!!accionEnCurso}>
							<span class="hs-factura-num">{f.numero_factura}</span>
							<span class="hs-factura-meta">
								{f.total_liquidaciones ?? f.items.length} liq. · {COP(f.valor_total)}
							</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if facturasFiltradas.length > 40}
				<p class="hs-panel-nota">
					Se muestran 40 de {facturasFiltradas.length}. Afina la búsqueda.
				</p>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet icoFactura()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2Z" />
		<path d="M8 8h8M8 12h8M8 16h5" />
	</svg>
{/snippet}

{#snippet icoAsociar()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
		<path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
	</svg>
{/snippet}

{#snippet icoDesasociar()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M18.8 12.2 20 11a5 5 0 0 0-7-7l-1.2 1.2" />
		<path d="M5.2 11.8 4 13a5 5 0 0 0 7 7l1.2-1.2" />
		<path d="M2 2l20 20" />
	</svg>
{/snippet}

{#snippet icoExcel()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
		<path d="M14 2v6h6" />
		<path d="m9 13 6 5M15 13l-6 5" />
	</svg>
{/snippet}

<style>
	/* Fila: canvas elástico + carril.
	   `.hs-canvas` es una COLUMNA para que `.univer-host` conserve el padre
	   flex-column del que depende su cadena de altura (REGLA #2 en
	   UniverCanvasHost). `min-width: 0` es obligatorio: sin él el `width:100%`
	   del host le gana al `flex` y empuja el carril fuera de pantalla. */
	.hs-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		/* Ancla de `UniverActionOverlay`, que es absolute y cubre canvas Y carril. */
		position: relative;
	}
	.hs-canvas {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.hs-select {
		height: 30px;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		font-size: 12px;
		padding: 0 8px;
		cursor: pointer;
	}
	.hs-select option {
		color: #0f172a;
	}

	.hs-vacio {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 40px 24px;
		text-align: center;
		background: #f8fafc;
		color: #334155;
	}
	.hs-vacio h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
	}
	.hs-vacio p {
		margin: 0;
		max-width: 44rem;
		font-size: 13px;
		line-height: 1.6;
		color: #64748b;
	}

	/* ─── Panel de asociar ─────────────────────────────────────────── */
	.hs-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.hs-panel-intro {
		margin: 0;
		font-size: 12px;
		color: #475569;
	}
	.hs-panel-nota {
		margin: 0;
		font-size: 11px;
		color: #64748b;
	}
	.hs-buscar {
		height: 30px;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 0 8px;
		font-size: 12px;
	}
	.hs-facturas {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 280px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.hs-facturas button {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.hs-facturas button:hover:not(:disabled) {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.hs-facturas button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hs-factura-num {
		font-size: 12px;
		font-weight: 700;
		color: #166534;
	}
	.hs-factura-meta {
		font-size: 11px;
		color: #64748b;
	}
</style>
