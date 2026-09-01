<script lang="ts">
	/**
	 * Canvas de CIERRES FINALES de terceros.
	 *
	 * El libro es un PERIODO (`?anio=&mes=`) y cada hoja es un CIERRE, es
	 * decir un par placa-propietario. Una misma placa puede aparecer dos
	 * veces en el mismo mes si se liquidó a dos propietarios distintos: son
	 * hojas separadas, y eso es deliberado.
	 *
	 * Diferencias con los canvas anuales (adicionales y ocasional), que
	 * explican por qué este fichero no es una copia de aquellos:
	 *
	 *  1. **El eje del libro es el periodo, no el año.** Cambiar de mes
	 *     implica otro `unitId` y por tanto remontar; cambiar de hoja no.
	 *  2. **El cliente no calcula nada.** Editar los `dias` de un SALARIO
	 *     cascadea a prestaciones, seguridad social, DOTACION,
	 *     EXAMEN_MEDICO y GASTOS_DIVERSOS. El servidor devuelve TODAS las
	 *     filas afectadas y aquí solo se pintan. Reproducir esa aritmética
	 *     en cliente sería una tercera copia de la misma lógica.
	 *  3. **Las hojas pueden aparecer solas.** La cola de borradores anuncia
	 *     cada cierre según lo va creando y se inserta en su sitio
	 *     alfabético sin recargar.
	 */

	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import {
		createCierresFinalesEngine,
		disposeEngine,
		posicionDeInsercion,
		type CierresFinalesEngineContext
	} from '$lib/editor/univer/cierres-finales-engine';
	import { installCierresCellPermission } from '$lib/editor/univer/cell-permission-cierres';
	import { attachCierresCellChangeAdapter } from '$lib/editor/univer/adapters/cell-change-cierres';
	import { canvasAnotacionesAPI, type AnotacionesPorMes } from '$lib/api/canvas-anotaciones';
	import {
		VersionesAnotaciones,
		emitirAnotacion,
		parseIdAnotacion
	} from '$lib/editor/canvas/anotaciones';
	import type { ICellData } from '@univerjs/core';
	import { filaDeAncla, numeroDeCapa } from '$lib/editor/business/zona-libre';
	import {
		clearCierreBindings,
		getCierreCellFor
	} from '$lib/editor/business/cierres-finales-cell-binding';
	import {
		isApplyingRemote,
		aplicarCeldaRemota,
		suprimirEco
	} from '$lib/editor/univer/apply-remote-patch';
	import { createSheetSession, type SheetSession } from '$lib/editor/canvas/sheet-session.svelte';
	import { crearColaEscritura } from '$lib/editor/canvas/cola-escritura.svelte';
	import type { CierreFinalCompleto } from '$lib/editor/builders/cierres-finales.builder';
	import { estiloAplicaImpuestos } from '$lib/editor/builders/cierres-finales.builder';
	import { aCierreCompleto, conHojaDelIndice } from '$lib/editor/builders/cierres-finales-mapper';
	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';
	import { esEditable, nombresUnicos } from '$lib/editor/builders/cierres-finales-identidad';
	import { colorDeHoja } from '$lib/editor/builders/cierres-finales-estado';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import UniverSideRail from '$lib/components/univer/UniverSideRail.svelte';
	import UniverActionOverlay, {
		type AccionEnCurso
	} from '$lib/components/univer/UniverActionOverlay.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import SelectorHojaCierre from '$lib/components/liquidaciones-terceros/SelectorHojaCierre.svelte';
	import SelectorCanvasTerceros from '$lib/components/univer/SelectorCanvasTerceros.svelte';
	import CierreEstadoHeader from '$lib/components/liquidaciones-terceros/CierreEstadoHeader.svelte';
	import GenerarBorradoresModal from '$lib/components/liquidaciones-terceros/GenerarBorradoresModal.svelte';
	import ConductoresCierreModal from '$lib/components/liquidaciones-terceros/ConductoresCierreModal.svelte';
	import ConceptosCierreModal from '$lib/components/liquidaciones-terceros/ConceptosCierreModal.svelte';
	import ItemsDisponiblesModal from '$lib/components/liquidaciones-terceros/ItemsDisponiblesModal.svelte';
	import PreviewCanvasModal from '$lib/components/liquidaciones-terceros/preview/PreviewCanvasModal.svelte';
	import { documentoCierre } from '$lib/components/liquidaciones-terceros/preview/datos/cierres.doc';
	import {
		exportarExcelLibro,
		type HojaLibro
	} from '$lib/components/liquidaciones-terceros/preview/exportar-excel';
	import {
		exportarZipPdfs,
		type HojaPdf
	} from '$lib/components/liquidaciones-terceros/preview/exportar-zip';
	import { fmtPlaca } from '$lib/components/liquidaciones-terceros/preview/formato';
	import * as realtimeCollab from '$lib/stores/realtimeCollab';
	import { connectSocket } from '$lib/socketClient';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';

	const MESES = [
		'ENERO',
		'FEBRERO',
		'MARZO',
		'ABRIL',
		'MAYO',
		'JUNIO',
		'JULIO',
		'AGOSTO',
		'SEPTIEMBRE',
		'OCTUBRE',
		'NOVIEMBRE',
		'DICIEMBRE'
	];

	/**
	 * Cierres cuyo detalle se pide por petición.
	 *
	 * El detalle de un cierre trae items, conceptos, adicionales y
	 * copropietarios; un mes con muchas placas puede ser de varios MB. Se
	 * piden por lotes para no lanzar 80 peticiones a la vez ni una sola
	 * gigantesca.
	 *
	 * ⚠️ Sin medir contra datos reales. Si un periodo típico tiene menos de
	 * ~25 cierres, un solo lote basta y esto sobra; si tiene 80, puede que
	 * haga falta además montar por hojas y no de golpe. La decisión pedía
	 * una medición que todavía no se ha hecho.
	 */
	const TAM_LOTE = 10;

	function formatCOP(v: number): string {
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(v || 0));
	}

	function mesValido(n: number): number {
		return n >= 1 && n <= 12 ? n : new Date().getMonth() + 1;
	}

	// ─── Ejes del canvas ───────────────────────────────────
	//
	// El PERIODO lo manda la URL, no el estado local. Cambiar de mes o de
	// año navega (`goto`), y este componente reacciona. Así el enlace es
	// compartible, el botón Atrás del navegador funciona y abrir
	// `?anio=2026&mes=3` desde cualquier sitio cae en la hoja correcta.
	//
	// La HOJA activa (`?cierre=`) no navega: se sincroniza con
	// `replaceState`, porque crear una entrada de historial por cada
	// pestaña que el usuario toca haría el botón Atrás inservible.
	const anio = $derived(Number($page.url.searchParams.get('anio')) || new Date().getFullYear());
	const mes = $derived(mesValido(Number($page.url.searchParams.get('mes'))));

	/// Periodo efectivamente cargado. Se compara con el de la URL para saber
	/// si hay que recargar; es una variable normal a propósito, para que
	/// escribirla no vuelva a disparar el efecto que la lee.
	let periodoCargado = { anio: 0, mes: 0 };

	let loading = $state(true);
	let progreso = $state('');
	let loadError = $state('');
	let container: HTMLDivElement | null = $state(null);
	let ctx: CierresFinalesEngineContext | null = null;
	let canvasDisposers: Array<() => void> = [];

	/// Índice de hojas (lite), ordenado por el servidor.
	let indice = $state<CierreHoja[]>([]);
	/// Detalle por cierre, la entrada del builder.
	let detalles = $state<Record<string, CierreFinalCompleto>>({});
	/// Cierre cuya hoja está activa.
	let cierreActivo = $state<string | null>($page.url.searchParams.get('cierre'));

	let modalBorradores = $state(false);
	let session: SheetSession | null = null;

	/**
	 * Preview de la HOJA ACTIVA, con exportación a PDF.
	 *
	 * Lleva todo lo que lleva la hoja —items, descuentos por conductor,
	 * gastos, anticipos, impuestos, el reparto por copropietario cuando lo
	 * hay, y el total de descuentos con el valor a pagar— compuesto a partir
	 * del detalle EN MEMORIA. Eso es lo que lo distingue del PDF del backend
	 * («Vista previa PDF (hoja activa)» en el selector), que lee lo guardado:
	 * aquí se ve lo que hay en pantalla ahora mismo, cascadas incluidas.
	 *
	 * Se compone solo mientras está abierto y se monta encima del canvas:
	 * navegar fuera desmontaría el libro Univer y la sesión colaborativa del
	 * periodo, y volver costaría recargar todas las hojas.
	 */
	let previewAbierto = $state(false);
	/// El detalle llega por lotes: hasta que el de la hoja activa esté, no
	/// hay nada que previsualizar y el botón se queda apagado.
	const detalleActivo = $derived(cierreActivo ? (detalles[cierreActivo] ?? null) : null);
	let documentoPreview = $derived(
		previewAbierto && detalleActivo ? documentoCierre({ cierre: detalleActivo, mes, anio }) : null
	);

	/**
	 * Exportación del LIBRO del periodo a un solo XLSX: una pestaña por
	 * cierre, con el mismo nombre que la pestaña del canvas.
	 *
	 * Es lo contrario del preview, que es de UNA hoja porque un documento se
	 * imprime y se archiva de uno en uno. El XLSX no se entrega a nadie: se
	 * abre para cuadrar el mes entero, y para eso las cuarenta placas tienen
	 * que estar en el mismo fichero.
	 *
	 * Se compone del detalle EN MEMORIA, igual que el preview: lo exportado
	 * es lo que hay en pantalla ahora mismo, cascadas incluidas, no lo que
	 * el servidor tenga guardado.
	 */
	let exportandoExcel = $state(false);

	/**
	 * Un PDF por hoja, todos en un ZIP.
	 *
	 * Cada hoja de este canvas es un par placa-propietario, y su documento
	 * se le entrega a ESE propietario: por eso el lote son cuarenta PDF y no
	 * uno de cuarenta páginas que habría que partir a mano. El nombre lleva
	 * placa, propietario y periodo, que es como se archivan.
	 *
	 * El papel es el mismo del preview, hoja por hoja; ver `exportar-zip.ts`.
	 */
	let exportandoZip = $state(false);

	async function exportarZipPdf() {
		if (exportandoZip) return;

		const hojas: HojaPdf[] = [];
		for (const h of indice) {
			const detalle = detalles[h.id];
			// Igual que en el Excel: el detalle llega por lotes y lo que aún no
			// esté cargado se queda fuera, pero se dice cuánto.
			if (!detalle) continue;
			hojas.push({
				nombreArchivo: `${fmtPlaca(h.placa)} ${h.tercero_nombre || 'SIN TERCERO'} ${
					MESES[mes - 1]
				} ${anio}`,
				documento: documentoCierre({ cierre: detalle, mes, anio })
			});
		}

		if (hojas.length === 0) {
			toast.error('No hay hojas cargadas que exportar.');
			return;
		}

		exportandoZip = true;
		const aviso = toast.loading(`Generando 0 de ${hojas.length} PDF…`);
		try {
			const { generados, fallidas } = await exportarZipPdfs(
				'cierres',
				hojas,
				`cierres_finales_${MESES[mes - 1]}_${anio}`,
				{
					onProgreso: (hechas, total) =>
						toast.loading(`Generando ${hechas} de ${total} PDF…`, { id: aviso })
				}
			);
			const faltan = indice.length - hojas.length;
			const notas = [
				faltan > 0 ? `${faltan} hoja(s) sin cargar quedaron fuera.` : '',
				fallidas.length ? `${fallidas.length} no se pudo(ieron) renderizar.` : ''
			].filter(Boolean);
			toast.success(`ZIP con ${generados} PDF de ${periodDisplay}.`, {
				id: aviso,
				description: notas.join(' ') || undefined
			});
		} catch (e: any) {
			console.error('[cierres-canvas] export ZIP', e);
			toast.error('No se pudo generar el ZIP', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoZip = false;
		}
	}

	async function exportarLibroExcel() {
		if (exportandoExcel) return;

		// Los detalles llegan por lotes. Si alguno falta —carga a medias, o
		// un lote que falló— se exporta lo que hay y se dice cuántas quedaron
		// fuera: un libro incompleto en silencio es peor que uno con aviso.
		const nombres = nombresUnicos(indice);
		const hojas: HojaLibro[] = [];
		for (const h of indice) {
			const detalle = detalles[h.id];
			if (!detalle) continue;
			hojas.push({
				nombre: nombres[h.id] ?? h.placa,
				documento: documentoCierre({ cierre: detalle, mes, anio })
			});
		}

		if (hojas.length === 0) {
			toast.error('No hay hojas cargadas que exportar.');
			return;
		}

		exportandoExcel = true;
		const aviso = toast.loading(`Generando el Excel de ${hojas.length} hoja(s)…`);
		try {
			await exportarExcelLibro(
				'cierres',
				hojas,
				`cierres_finales_${anio}-${String(mes).padStart(2, '0')}`
			);
			const faltan = indice.length - hojas.length;
			toast.success(`Excel generado con ${hojas.length} hoja(s).`, {
				id: aviso,
				description: faltan > 0 ? `${faltan} hoja(s) aún sin cargar quedaron fuera.` : undefined
			});
		} catch (e: any) {
			console.error('[cierres-canvas] export XLSX', e);
			toast.error('No se pudo generar el Excel', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoExcel = false;
		}
	}

	/// Capa de ANOTACIONES: celdas libres bajo el bloque estructurado. Van por
	/// el mismo `sheet:patch` que el resto, con `entity_type: 'anotacion'`.
	let anotaciones = $state<AnotacionesPorMes>({});
	const versionesAnot = new VersionesAnotaciones();
	let presence = $state<Array<{ id: string; name: string; mes: number | null }>>([]);
	let mountToken = 0;

	/// Entidades con patches sin confirmar. Solo indicación visual.
	let pendientes = $state<Set<string>>(new Set());

	/// Estado de la cola de escrituras HTTP, para el indicador del header.
	let colaPendientes = $state(0);
	let colaFallidas = $state(0);
	let colaUltimoGuardado = $state<string | null>(null);
	let conectado = $state(true);

	/**
	 * Cola de las escrituras que van por HTTP (hoy, el color de pestaña).
	 *
	 * `apiClient` no reintenta mutaciones a propósito; la cola sí puede
	 * porque sabe que las suyas son idempotentes. Además agrupa por clave:
	 * pintar una pestaña cinco veces seguidas produce UNA escritura.
	 */
	const cola = crearColaEscritura({
		onEstado: ({ pendientes: p, fallidas, ultimoGuardado }) => {
			colaPendientes = p;
			colaFallidas = fallidas;
			colaUltimoGuardado = ultimoGuardado;
		},
		onFallo: ({ descripcion, error }) => {
			toast.error(`No se pudo guardar ${descripcion}`, {
				description: `${error}. El valor sigue en pantalla; pulsa Reintentar en el header.`,
				duration: 8000
			});
		}
	});

	/// Pendientes totales: los de la cola HTTP más los patches por socket.
	const totalPendientes = $derived(colaPendientes + pendientes.size);

	const cierreActivoObj = $derived(indice.find((c) => c.id === cierreActivo) ?? null);
	const periodDisplay = $derived(`${MESES[mes - 1] || ''} ${anio}`);
	const borradores = $derived(indice.filter((c) => c.estado === 'BORRADOR').length);
	const totalPagar = $derived(indice.reduce((s, c) => s + (c.total_pagar || 0), 0));
	const totalLiquidar = $derived(indice.reduce((s, c) => s + (c.valor_liquidar || 0), 0));

	const anios = $derived.by(() => {
		const actual = new Date().getFullYear();
		const out: number[] = [];
		for (let a = actual - 3; a <= actual + 1; a++) out.push(a);
		if (!out.includes(anio)) out.unshift(anio);
		return out;
	});

	// ─── URL ───────────────────────────────────────────────
	/**
	 * Refleja la HOJA activa en la URL sin crear historial.
	 *
	 * `replaceState` y no `goto`: cada clic en una pestaña añadiría una
	 * entrada al historial y el botón Atrás dejaría de servir para volver
	 * al listado. El periodo, en cambio, sí navega — ver `cambiarPeriodo`.
	 *
	 * También completa `anio`/`mes` si faltan, para que la URL que el
	 * usuario copia lleve el periodo explícito.
	 */
	function syncUrl() {
		if (!browser) return;
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(anio));
		url.searchParams.set('mes', String(mes));
		if (cierreActivo) url.searchParams.set('cierre', cierreActivo);
		else url.searchParams.delete('cierre');
		window.history.replaceState({}, '', url);
	}

	/**
	 * Navega a otro periodo. La recarga la dispara el efecto que vigila la
	 * URL, no esta función: así da igual si el cambio viene de aquí, del
	 * botón Atrás o de un enlace pegado.
	 */
	function cambiarPeriodo(nuevoAnio: number, nuevoMes: number) {
		if (nuevoAnio === anio && nuevoMes === mes) return;
		if (
			pendientes.size > 0 &&
			!confirm('Hay cambios sin confirmar por el servidor. ¿Cambiar de periodo igualmente?')
		) {
			return;
		}
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(nuevoAnio));
		url.searchParams.set('mes', String(nuevoMes));
		// La hoja activa del periodo anterior no existe en el nuevo.
		url.searchParams.delete('cierre');
		goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
	}

	// ─── Versiones, para el compare-and-swap ───────────────
	/**
	 * Versión actual de una entidad.
	 *
	 * El adapter descarta el cambio si esto devuelve `null`: emitir un patch
	 * sin `base_version` sería volver al last-write-wins silencioso, que es
	 * justo lo que este canvas viene a evitar.
	 */
	function versionDe(cierreId: string, entityType: string, entityId: string): number | null {
		const d = detalles[cierreId];
		if (!d) return null;
		if (entityType === 'concepto') {
			const c = d.conceptos.find((x: any) => x.id === entityId);
			return c ? Number((c as any).version) || 1 : null;
		}
		if (entityType === 'adicional') {
			const a = d.adicionales.find((x) => x.id === entityId);
			return a ? Number(a.version) || 1 : null;
		}
		if (entityType === 'item') {
			// El pivote no tiene columna `version`, así que aquí no hay
			// compare-and-swap: se devuelve 1 para que el adapter no descarte
			// el cambio, y el servidor lo ignora para este tipo. Es la única
			// escritura del canvas sin protección de concurrencia; converge
			// porque el servidor difunde el estado resultante.
			return d.items.some((x) => x.pivoteId === entityId) ? 1 : null;
		}
		return null;
	}

	// ─── Montaje / teardown ────────────────────────────────
	async function mountEngineNow() {
		if (!container) return;
		const token = mountToken;
		const cierres = indice.map((h) => detalles[h.id]).filter(Boolean) as CierreFinalCompleto[];
		if (cierres.length === 0) return;

		try {
			const nuevo = createCierresFinalesEngine({
				container,
				anio,
				mes,
				cierres,
				cierreActivo,
				anotaciones
			});
			if (token !== mountToken) {
				// Otro montaje ganó la carrera: descartar este engine para no
				// dejar un Univer huérfano con su Worker de fórmulas vivo.
				disposeEngine(nuevo.univer, nuevo.fUniver, nuevo.unitId, container);
				return;
			}
			ctx = nuevo;

			canvasDisposers.push(
				installCierresCellPermission(nuevo.univer, {
					// Insertar una fila con el menú de Univer es lo primero que
					// intenta quien viene de Excel. Ahora se bloquea, y el aviso
					// dice dónde está el botón que sí crea la fila entera.
					onBloqueado: ({ titulo, detalle }) =>
						// `id` fijo: un solo intento dispara el comando y su mutación,
						// y el menú contextual puede encadenar varios. Sin la clave
						// salían tres o cuatro avisos idénticos apilados.
						toast.warning(titulo, {
							id: 'cierres-estructura-bloqueada',
							description: detalle,
							duration: 9000
						})
				})
			);

			const commandService = (nuevo.univer as any)
				.__getInjector()
				.get((await import('@univerjs/core')).ICommandService);
			if (token !== mountToken) return;

			canvasDisposers.push(
				attachCierresCellChangeAdapter({
					unitId: nuevo.unitId,
					commandService,
					getWorkbook: () => nuevo.fUniver.getActiveWorkbook() as any,
					resolveCierre: nuevo.resolveCierre,
					versionDe,
					isApplyingRemote,
					// Celda de la ZONA LIBRE: no es un campo del cierre, así que
					// no lleva `base_version` de entidad ni cascadea a totales.
					onAnotacion: ({ sheetKey, ancla, valor }) => {
						emitirAnotacion({
							session,
							versiones: versionesAnot,
							mes,
							sheetKey,
							ancla,
							valor
						});
					},
					onCambios: (cambios) => {
						for (const c of cambios) {
							marcarPendiente(c.entityId);
							session?.enviarPatch({
								mes,
								entity_type: c.entityType,
								entity_id: c.entityId,
								field: c.field,
								value: c.value,
								base_version: c.baseVersion,
								// El gateway lo exige para este scope: la hoja ES un
								// cierre, pero el patch viaja suelto y el servidor no
								// puede deducirlo del `entity_id` sin una consulta.
								cierre_id: c.cierreId
							});
						}
					},
					/**
					 * Alguien insertó o borró una fila y el bloqueo no llegó a
					 * tiempo. Se rehace la hoja desde el modelo.
					 *
					 * Diferido con `setTimeout(0)`: esto se dispara DENTRO del
					 * `onCommandExecuted` de Univer, y destruir ahí el mismo motor
					 * que está despachando el comando lo deja a medias. Es el
					 * mismo truco que usa el canvas de ingresos.
					 */
					onEstructural: () => {
						toast.warning('No se pueden insertar ni borrar filas en la hoja', {
							id: 'cierres-estructura-bloqueada',
							description:
								'Se ha deshecho el cambio. Usa los botones del carril de la derecha ' +
								'para añadir un gasto, un anticipo o un conductor: la fila nace con ' +
								'su combinación, su formato y su fórmula.',
							duration: 9000
						});
						setTimeout(() => void remountEngine(), 0);
					},
					onHojaActiva: (cierreId) => {
						if (cierreId === cierreActivo) return;
						cierreActivo = cierreId;
						session?.setHojaActiva(mes, cierreId);
						syncUrl();
					},
					onColorHoja: (cierreId, color) => {
						persistirColor(cierreId, color);
					}
				})
			);
		} catch (e: any) {
			console.error('[cierres-canvas] mount error', e);
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
			clearCierreBindings(ctx.unitId);
		}
		ctx = null;
	}

	/// Remount completo. Solo al cambiar de PERIODO o cuando cambia la
	/// geometría de una hoja. Editar celdas no remonta.
	async function remountEngine() {
		if (!container) return;
		mountToken++;
		teardownEngine();
		await tick();
		await mountEngineNow();
	}

	// ─── Estado de guardado ────────────────────────────────
	function marcarPendiente(entityId: string) {
		if (pendientes.has(entityId)) return;
		const next = new Set(pendientes);
		next.add(entityId);
		pendientes = next;
		realtimeCollab.setSaveStatus('saving');
	}

	function marcarConfirmado(entityId: string) {
		if (!pendientes.has(entityId)) return;
		const next = new Set(pendientes);
		next.delete(entityId);
		pendientes = next;
		if (next.size === 0) {
			realtimeCollab.setSaveStatus('saved', new Date().toISOString());
		}
	}

	// ─── Pintado de filas que devuelve el servidor ─────────
	/**
	 * Aplica en el modelo y en las celdas TODAS las filas que el servidor
	 * marcó como afectadas.
	 *
	 * Esto es lo que hace que la cascada se vea: editar `dias` de un SALARIO
	 * cambia además su `valor_total`, las bases y los totales de las
	 * prestaciones de ese conductor, los días de DOTACION y EXAMEN_MEDICO y
	 * el valor de GASTOS_DIVERSOS. Pintar solo la celda editada dejaría el
	 * resto de la hoja mostrando números viejos.
	 */
	function pintarFilas(cierreId: string, rows: any[] | undefined) {
		if (!rows?.length) return;
		const d = detalles[cierreId];
		if (!d) return;

		const porId = new Map(rows.map((r) => [r.id, r]));
		const conceptos = d.conceptos.map((c: any) =>
			porId.has(c.id) ? { ...c, ...porId.get(c.id) } : c
		);
		detalles = { ...detalles, [cierreId]: { ...d, conceptos } };

		if (!ctx) return;
		for (const row of rows) {
			for (const [campo, valor] of Object.entries(row)) {
				if (valor == null || typeof valor === 'object') continue;
				const celda = getCierreCellFor(ctx.unitId, row.id, campo);
				// Sin celda mapeada = ese campo no se pinta en la hoja
				// (`propietario_id`, `orden`, `version`…). No es un error.
				if (!celda) continue;
				aplicarCeldaRemota(ctx, celda, valor as any);
			}
		}
	}

	/**
	 * Aplica en el modelo y en las celdas las filas del PIVOTE que cambiaron.
	 *
	 * Solo llegan cuando el patch fue sobre un `item` (alternar
	 * `aplica_impuestos` o `excluido`). Se pintan como SÍ/NO, que es lo que
	 * la hoja muestra; el modelo guarda el booleano.
	 */
	function pintarItems(cierreId: string, items: any[] | undefined) {
		if (!items?.length) return;
		const d = detalles[cierreId];
		if (!d) return;

		const porId = new Map(items.map((i) => [i.id, i]));
		const nuevos = d.items.map((it) => {
			const upd = porId.get(it.pivoteId);
			if (!upd) return it;
			return {
				...it,
				aplica_impuestos: upd.aplica_impuestos !== false,
				excluido: !!upd.excluido,
				// El servidor manda las cuatro columnas de dinero cuando se
				// edita ADMON %. Se adoptan solo si vienen: el toggle de
				// impuestos las omite y un `?? it.x` evitaría machacarlas con
				// `undefined`, pero dejaría el modelo desalineado si algún día
				// llegan a null a propósito.
				...(upd.porcentaje_admin != null
					? {
							porcentaje_admin: Number(upd.porcentaje_admin),
							valor_admin: Number(upd.valor_admin),
							total_facturado: Number(upd.total_facturado),
							valor_liquidar: Number(upd.valor_liquidar)
						}
					: {})
			};
		});
		detalles = { ...detalles, [cierreId]: { ...d, items: nuevos } };

		if (!ctx) return;
		for (const upd of items) {
			for (const campo of ['aplica_impuestos', 'excluido'] as const) {
				if (upd[campo] == null) continue;
				const celda = getCierreCellFor(ctx.unitId, upd.id, campo);
				if (!celda) continue;
				// CON ESTILO: en estas celdas el color no decora, informa —
				// verde entra en la base imponible, rojo queda fuera—. Pintando
				// solo el valor, la celda se quedaba con el color del montaje y
				// acababa diciendo «SÍ» sobre fondo rojo. El estilo sale del
				// mismo sitio que usa el builder para que no puedan divergir.
				aplicarCeldaRemota(
					ctx,
					celda,
					upd[campo] ? 'SÍ' : 'NO',
					estiloAplicaImpuestos(!!upd[campo])
				);
			}
			// ADMON % y sus dos derivadas. Van como NÚMERO: las celdas llevan
			// patrón (`0.00"%"`, moneda) y mandar el texto ya formateado las
			// convertiría en cadenas, que es de donde venía el aviso de
			// «número almacenado como texto».
			//
			// La fila TOTALES de la tabla son SUM vivas sobre estas columnas,
			// así que se actualiza sola al repintarlas.
			for (const campo of ['porcentaje_admin', 'valor_admin', 'valor_liquidar'] as const) {
				if (upd[campo] == null) continue;
				const celda = getCierreCellFor(ctx.unitId, upd.id, campo);
				if (!celda) continue;
				aplicarCeldaRemota(ctx, celda, Number(upd[campo]));
			}
		}
	}

	/**
	 * Aplica la fila de un ADICIONAL que devuelve el servidor.
	 *
	 * Los adicionales se pintan dentro de la tabla de items (ver el builder),
	 * pero son otra entidad: viven en su propia tabla y SÍ tienen `version`,
	 * así que fusionarla en el modelo no es cosmético — es lo que mantiene al
	 * día el `base_version` del siguiente patch. Sin esto, la segunda edición
	 * seguida de la misma celda chocaba contra uno mismo.
	 */
	function pintarAdicional(cierreId: string, fila: any) {
		if (!fila?.id) return;
		const d = detalles[cierreId];
		if (!d) return;

		const adicionales = d.adicionales.map((a) => (a.id === fila.id ? { ...a, ...fila } : a));
		detalles = { ...detalles, [cierreId]: { ...d, adicionales } };

		if (!ctx) return;
		// ADMON $ y V/LIQUIDAR los deriva el servidor; V/UNIDAD, CANT y ADMON %
		// son los que se teclean, y vuelven porque el patch de uno redondea a
		// los otros. Van como NÚMERO: las celdas llevan patrón de moneda o de
		// porcentaje y el texto ya formateado las convertiría en cadenas.
		for (const campo of [
			'valor_unitario',
			'cantidad',
			'porcentaje_admin',
			'valor_admin',
			'valor_liquidar'
		] as const) {
			if (fila[campo] == null) continue;
			const celda = getCierreCellFor(ctx.unitId, fila.id, campo);
			if (!celda) continue;
			aplicarCeldaRemota(ctx, celda, Number(fila[campo]));
		}
		// APLICA IMP. con su estilo: aquí el color informa, no decora. Mismo
		// motivo que en `pintarItems`.
		if (fila.aplica_impuestos != null) {
			const celda = getCierreCellFor(ctx.unitId, fila.id, 'aplica_impuestos');
			if (celda) {
				aplicarCeldaRemota(
					ctx,
					celda,
					fila.aplica_impuestos ? 'SÍ' : 'NO',
					estiloAplicaImpuestos(!!fila.aplica_impuestos)
				);
			}
		}
	}

	/// Refresca los totales del cierre en el índice (cabecera y selector).
	function fusionarTotales(cierreId: string, totales: Record<string, number> | undefined) {
		if (!totales) return;
		indice = indice.map((c) =>
			c.id === cierreId
				? {
						...c,
						total_pagar: Number(totales.total_pagar ?? c.total_pagar),
						valor_liquidar: Number(totales.valor_liquidar ?? c.valor_liquidar)
					}
				: c
		);
	}

	// ─── Sesión colaborativa ───────────────────────────────
	function abrirSesion() {
		if (!$authStore.user) return;
		session?.dispose();
		/// `Ancla` (lo que viaja en el protocolo) → la forma que espera `filaDeAncla`.
		const aCelda = (a: { tipo: string; ref: string; offset: number; columna: number }) => ({
			ancla_tipo: a.tipo,
			ancla_ref: a.ref,
			offset_fila: a.offset,
			columna: a.columna
		});

		// Pinta una anotación (propia confirmada o de otro usuario). No toca el
		// modelo de cierres: una nota no es un campo de la liquidación.
		/**
		 * Valor a pintar en la hoja para una anotación remota.
		 *
		 * La capa viaja como TEXTO por el protocolo, pero hay celdas suyas que son
		 * numéricas y de las que cuelga una fórmula (el % de ADMON del canvas de
		 * ocasionales). Pintar «15.00%» como cadena ahí deja el cálculo en cero.
		 * Solo se convierte si la celda de destino YA era numérica: en una celda de
		 * texto, «15%» es lo que alguien quiso escribir.
		 */
		const valorDeAnotacion = (valor: string | null, destino: ICellData | null): string | number => {
			if (valor == null || valor === '') return '';
			// Solo se convierte sobre una celda que ya era numérica.
			if (destino?.t !== 2) return valor;
			return numeroDeCapa(valor) ?? valor;
		};

		const pintarAnotacion = (
			cierreId: string,
			ancla: { ancla_tipo?: string; ancla_ref?: string; offset_fila: number; columna: number },
			valor: string | null
		) => {
			const sheetId = ctx?.sheetIdPorCierre?.[cierreId];
			if (!ctx || !sheetId) return;
			const fila = filaDeAncla(ctx.unitId, sheetId, ancla);
			// Sin fila: el item al que estaba atada ya no está en la hoja.
			if (fila == null || fila < 0) return;
			try {
				const wb = ctx.fUniver.getActiveWorkbook() as any;
				const rango = wb?.getSheetBySheetId?.(sheetId)?.getRange?.(fila, ancla.columna);
				// BAJO GUARDA DE ECO, o esto no para nunca: `setValue` emite
				// `set-range-values`, que es justo lo que escucha el adapter, y
				// sin binding lo reemite como anotación. Con dos pestañas
				// abiertas, cada una repintaba lo del otro y volvía a mandarlo:
				// una escritura por segundo y por celda anotada, para siempre.
				suprimirEco(() => rango?.setValue(valorDeAnotacion(valor, rango?.getCellData?.() ?? null)));
			} catch (e) {
				console.warn('[cierres-canvas] no se pudo pintar la anotación', e);
			}
		};

		session = createSheetSession({
			scope: 'cierres-finales',
			anio,
			mes,
			user: {
				id: $authStore.user.id,
				name: $authStore.user.nombre || $authStore.user.correo || 'Usuario'
			},
			onPresence: (users) => {
				presence = users;
			},
			onRemotePatch: (p) => {
				// Las anotaciones no llevan `cierre_id` ni cascadean a totales:
				// se pintan y se sale antes de la lógica de cierres.
				if (p.entity_type === 'anotacion') {
					const a = parseIdAnotacion(p.entity_id);
					if (!a) return;
					versionesAnot.set(mes, p.entity_id, p.version);
					pintarAnotacion(a.sheetKey, aCelda(a.ancla), p.value as string | null);
					return;
				}
				const cierreId = p.cierre_id;
				if (!cierreId) return;

				// Los flags del pivote no tienen compare-and-swap: gana quien
				// escribe de último. Converge, pero hasta ahora era MUDO — te
				// pisaban el cambio y no te enterabas. Solo se avisa si tenías
				// algo pendiente sobre esa misma entidad: si no, es
				// simplemente el trabajo de otro y no hay conflicto.
				if (p.entity_type === 'item' && pendientes.has(p.entity_id)) {
					const placa = indice.find((c) => c.id === cierreId)?.placa ?? '';
					toast.warning(`${p.by?.name || 'Otro usuario'} cambió ${p.field} de ${placa}`, {
						description: 'Se aplicó su valor sobre el tuyo.'
					});
				}

				pintarFilas(cierreId, p.rows);
				pintarItems(cierreId, p.items);
				// `row` en singular: la fila del adicional editado. Los impuestos
				// que arrastra viajan en `rows` y ya los pintó `pintarFilas`.
				if (p.entity_type === 'adicional') pintarAdicional(cierreId, p.row);
				fusionarTotales(cierreId, p.totales);
			},
			onAck: ({ entity_id, rows, items, row, totales, version }) => {
				marcarConfirmado(entity_id);
				// Anotación confirmada: solo hay que adoptar la versión nueva,
				// no hay filas ni totales que fusionar.
				const anot = parseIdAnotacion(entity_id);
				if (anot && version != null && !rows && !items) {
					versionesAnot.set(mes, entity_id, version);
					return;
				}
				// Fusionar las filas del servidor es OBLIGATORIO: traen la
				// `version` nueva. Sin ella el siguiente patch de esa fila iría
				// con una `base_version` obsoleta y el servidor lo rechazaría
				// por conflicto contra el propio usuario.
				const cierreId = cierreDeEntidad(entity_id);
				if (cierreId) {
					pintarFilas(cierreId, rows);
					pintarItems(cierreId, items);
					// Solo la trae el ACK de un adicional, y solo entonces
					// `row.id` coincide con alguno del cierre.
					if (row) pintarAdicional(cierreId, row);
					fusionarTotales(cierreId, totales);
				}
			},
			onPatchFallido: ({ entity_id, field, motivo, error }) => {
				// Sin esto la entidad se quedaba pendiente para siempre y el
				// indicador atascado en «Guardando…». El valor local SE
				// CONSERVA: revertirlo perdería lo que el usuario tecleó.
				marcarConfirmado(entity_id);
				toast.error(
					motivo === 'timeout'
						? 'El servidor no confirmó un cambio'
						: 'El servidor rechazó un cambio',
					{
						description:
							(error ? `${error}. ` : '') +
							`Campo "${field}". El valor sigue en pantalla, pero NO está guardado.`,
						duration: 9000
					}
				);
			},
			onConexion: (ok) => {
				conectado = ok;
			},
			onConflict: (c) => {
				marcarConfirmado(c.entity_id);
				// El servidor manda: se repinta con su valor y se adopta su
				// versión, o el siguiente intento chocaría igual.
				const anot = parseIdAnotacion(c.entity_id);
				if (anot && c.server_row && 'valor' in (c.server_row as any)) {
					versionesAnot.set(mes, c.entity_id, (c.server_row as any).version);
					pintarAnotacion(anot.sheetKey, aCelda(anot.ancla), (c.server_row as any).valor ?? null);
					return;
				}
				const cierreId = cierreDeEntidad(c.entity_id);
				if (cierreId && c.server_row) pintarFilas(cierreId, [c.server_row]);
				toast.warning(
					c.reason === 'epoch'
						? 'La hoja se restauró mientras editabas. Se recargó el valor del servidor.'
						: 'Otro usuario editó esa celda antes que tú. Se aplicó su valor.'
				);
				realtimeCollab.setSaveStatus('saved', new Date().toISOString());
			},
			onEstadoChanged: ({ cierre_id, estado, version }) => {
				aplicarEstado(cierre_id, estado, version);
			},
			onColorChanged: ({ cierre_id, color, by }) => {
				// `sheet:hoja-color` se difunde a TODO el room, incluido quien
				// lo provocó — a diferencia de `sheet:patch:applied`, que
				// excluye al emisor. Volver a pintar aquí sería repintar lo que
				// el propio usuario acaba de hacer, y realimentar el ciclo.
				if (by?.id && by.id === $authStore.user?.id) {
					aplicarColorEnModelo(cierre_id, color);
					return;
				}
				aplicarColorEnModelo(cierre_id, color);
				const hoja = indice.find((c) => c.id === cierre_id);
				ctx?.pintarPestana(
					cierre_id,
					colorDeHoja({ estado: hoja?.estado ?? 'BORRADOR', color_hoja: color })
				);

				// Mismo criterio que con los flags: solo molesta si tenías una
				// escritura de ESE color todavía en la cola.
				if (colaPendientes > 0) {
					toast.info(`${by?.name || 'Otro usuario'} cambió el color de ${hoja?.placa ?? ''}`);
				}
			},
			onSheetAdded: ({ cierre, by }) => {
				void insertarHojaNueva(cierre as CierreHoja, by?.name);
			},
			onInvalidate: ({ cierreId }) => {
				// El eco de nuestro propio cambio: ya lo estamos aplicando.
				if (cierreId && refrescandoCierres.has(cierreId)) return;
				// Con `cierre_id` el cambio es de UNA hoja: releerla a ella y no
				// el periodo entero. En un mes de 52 placas, recargarlo todo por
				// un bloque de conductor son 6 lotes de red y un remonte largo.
				if (cierreId && detalles[cierreId]) {
					void recargarCierre(cierreId);
					return;
				}
				void loadInicial();
			}
		});
		session.setHojaActiva(mes, cierreActivo);
	}

	/// A qué cierre pertenece una entidad, según lo cargado.
	function cierreDeEntidad(entityId: string): string | null {
		for (const [cierreId, d] of Object.entries(detalles)) {
			if (d.conceptos.some((c: any) => c.id === entityId)) return cierreId;
			if (d.adicionales.some((a) => a.id === entityId)) return cierreId;
			if (d.items.some((i) => i.pivoteId === entityId)) return cierreId;
		}
		return null;
	}

	/**
	 * Guarda el color que el usuario acaba de elegir en la barra de pestañas.
	 *
	 * Univer ya lo pintó; esto solo lo persiste y deja que el servidor lo
	 * difunda. Si falla, se avisa pero NO se revierte el color local: dejar
	 * la pestaña como el usuario la puso y decirle que no se guardó es menos
	 * desconcertante que verla volver sola a su color anterior.
	 */
	function persistirColor(cierreId: string, color: string | null) {
		aplicarColorEnModelo(cierreId, color);
		const placa = indice.find((c) => c.id === cierreId)?.placa ?? cierreId;
		cola.encolar(
			`cierre:${cierreId}:color_hoja`,
			() => liquidacionesTercerosDescuentosAPI.fijarColorHoja(cierreId, color).then(() => {}),
			`el color de ${placa}`
		);
	}

	/// Actualiza `color_hoja` en el índice y en el detalle, sin tocar Univer.
	function aplicarColorEnModelo(cierreId: string, color: string | null) {
		indice = indice.map((c) => (c.id === cierreId ? { ...c, color_hoja: color } : c));
		const d = detalles[cierreId];
		if (d) {
			detalles = {
				...detalles,
				[cierreId]: { ...d, hoja: { ...d.hoja, color_hoja: color } }
			};
		}
	}

	/**
	 * Refleja un cambio de estado venido por socket.
	 *
	 * Reaccionar es obligatorio, no cosmético: el servidor rechaza los
	 * patches sobre cierres que ya no son BORRADOR, así que si la hoja
	 * siguiera editable el usuario teclearía y recibiría un error por celda.
	 * El remount es lo que repinta el aviso de bloqueo de la hoja.
	 */
	function aplicarEstado(cierreId: string, estado: string, version: number) {
		const antes = indice.find((c) => c.id === cierreId);
		if (!antes || antes.estado === estado) return;

		indice = indice.map((c) => (c.id === cierreId ? { ...c, estado, version } : c));
		const d = detalles[cierreId];
		if (d) {
			detalles = {
				...detalles,
				[cierreId]: { ...d, hoja: { ...d.hoja, estado, version } }
			};
		}

		// La pestaña sigue al estado SOLO si el usuario no eligió un color a
		// mano. Repintarla sobre su override le borraría la marca que puso.
		if (!antes.color_hoja) {
			ctx?.pintarPestana(cierreId, colorDeHoja({ estado, color_hoja: null }));
		}

		// Solo hace falta remontar si la hoja cruza la frontera de editable:
		// es lo que cambia su geometría (aparece o desaparece el aviso).
		if (esEditable(antes.estado) !== esEditable(estado)) void remountEngine();
	}

	/**
	 * Inserta una hoja recién creada por la cola de borradores.
	 *
	 * Se pide su detalle y se encola en el engine, que agrupa las altas de
	 * la misma ráfaga y restaura la hoja activa una sola vez. Sin eso, con
	 * 30 altas seguidas quien estuviera editando otra placa daría 30 saltos.
	 */
	async function insertarHojaNueva(hoja: CierreHoja, quien?: string) {
		if (!hoja?.id || indice.some((c) => c.id === hoja.id)) return;
		try {
			const [detalle] = await liquidacionesTercerosDescuentosAPI.detallePeriodo(anio, mes, [
				hoja.id
			]);
			if (!detalle) return;

			const completo = conHojaDelIndice(aCierreCompleto(detalle), hoja);
			detalles = { ...detalles, [hoja.id]: completo };

			const pos = posicionDeInsercion(indice, hoja);
			indice = [...indice.slice(0, pos), hoja, ...indice.slice(pos)];

			if (ctx) ctx.encolarCierre(completo);
			else await remountEngine();

			if (quien) toast.info(`${quien} creó el cierre de ${hoja.placa}`);
		} catch (e: any) {
			console.error('[cierres-canvas] insertarHojaNueva', e);
		}
	}

	// ─── Acciones del carril lateral ───────────────────────
	//
	// Las dos que hay aquí llaman a endpoints que YA EXISTÍAN y que se
	// quedaron sin invocar cuando se retiró el editor tabular. No son
	// funcionalidad nueva del servidor: son el disparador que faltaba.

	/**
	 * Acción del carril que está corriendo ahora mismo, o `null`.
	 *
	 * SUSTITUYE a los flags `sincronizando`/`recalculando` que solo encendían
	 * el spinner dentro del botón. Ese spinner vive en un icono de 40×40 en el
	 * borde derecho de una pantalla llena de celdas: quien acaba de pulsar
	 * está mirando la hoja, no el botón, así que la espera se leía como que no
	 * había pasado nada. Sincronizar con nómina son cuatro viajes al servidor
	 * seguidos de un remonte del libro — varios segundos sin señal.
	 *
	 * Al ser UNA sola variable, además, las acciones no se pueden solapar:
	 * todas acaban releyendo y remontando el mismo cierre, y dos a la vez
	 * dejaban al segundo remonte pisando al primero.
	 */
	let accionEnCurso = $state<AccionEnCurso | null>(null);

	/**
	 * Ejecuta una acción del carril con el velo puesto.
	 *
	 * Si ya hay otra corriendo, no hace nada: el velo tapa los botones, pero
	 * el teclado puede activar uno que tuviera el foco.
	 */
	async function conOverlay<T>(
		accion: AccionEnCurso,
		fn: () => Promise<T>
	): Promise<T | undefined> {
		if (accionEnCurso) return;
		accionEnCurso = accion;
		try {
			return await fn();
		} finally {
			accionEnCurso = null;
		}
	}

	let modalConductores = $state(false);
	let modalConceptos = $state(false);
	let modalTraerItems = $state(false);
	/// Hubo altas o bajas mientras el modal de conceptos estuvo abierto, así que
	/// al cerrarlo hay que remontar el libro una vez.
	let hayCambiosDeConceptos = $state(false);

	/**
	 * Cierres que ESTA pestaña está releyendo ahora mismo.
	 *
	 * `sheet:invalidate` se difunde a TODO el room, incluido quien lo
	 * provocó — a diferencia de `sheet:patch:applied`, que excluye al emisor.
	 * Sin esta guarda, guardar conductores lanzaba DOS refrescos a la vez: el
	 * local y el del eco. Cada uno arranca con su `teardownEngine`, así que el
	 * segundo desmontaba el libro que el primero acababa de montar y el canvas
	 * se quedaba EN BLANCO.
	 *
	 * Es el mismo criterio que ya usa `onColorChanged` para no repintar lo que
	 * el propio usuario acaba de hacer.
	 */
	const refrescandoCierres = new Set<string>();

	/**
	 * Relee un cierre del servidor y lo repinta.
	 *
	 * REMONTA EL LIBRO a propósito. `ctx.reconstruirHoja` solo refresca
	 * bindings y anclas — no reescribe celdas —, y estas acciones cambian la
	 * GEOMETRÍA de la hoja: añadir un conductor mete su recuadro entero,
	 * sincronizar nómina mete uno por conductor, recalcular impuestos añade
	 * cuatro filas donde antes decía «(sin impuestos)». Sin remontar, el
	 * modelo tendría los datos nuevos y la pantalla la hoja vieja.
	 *
	 * El remonte vacía el contenedor unos instantes; por eso se enciende el
	 * indicador de carga. Un canvas en blanco sin explicación se lee como una
	 * pantalla rota, y con el overlay se lee como lo que es.
	 */
	async function recargarCierre(cierreId: string, opts: { remontar?: boolean } = {}) {
		// `remontar: false` refresca SOLO el modelo. Lo usa el modal de gastos y
		// anticipos, donde se añaden filas en tanda: remontar el libro en cada
		// alta costaba ~3,5s de espera por fila con el canvas tapado por el
		// propio modal, que es tiempo que nadie está mirando. El remonte se hace
		// una sola vez al cerrar.
		const remontar = opts.remontar !== false;
		refrescandoCierres.add(cierreId);
		const placa = indice.find((c) => c.id === cierreId)?.placa ?? '';
		if (remontar) {
			progreso = `Actualizando ${placa}…`;
			loading = true;
		}
		try {
			const [detalle] = await liquidacionesTercerosDescuentosAPI.detallePeriodo(anio, mes, [
				cierreId
			]);
			if (!detalle) return;

			const completo = aCierreCompleto(detalle);
			// El ORDEN y el color los manda el índice (los calcula el servidor
			// con la misma clave para todos); los totales y el estado, el
			// detalle recién leído. Mezclar al revés movería la pestaña de sitio.
			const previa = indice.find((c) => c.id === cierreId);
			const hoja = previa
				? {
						...previa,
						estado: completo.hoja.estado,
						version: completo.hoja.version,
						total_pagar: completo.hoja.total_pagar,
						valor_liquidar: completo.hoja.valor_liquidar
					}
				: completo.hoja;

			detalles = { ...detalles, [cierreId]: { ...completo, hoja } };
			indice = indice.map((c) => (c.id === cierreId ? hoja : c));
			if (remontar) await remountEngine();
		} finally {
			loading = false;
			progreso = '';
			// El eco del `invalidate` llega por socket unos milisegundos después
			// de la respuesta HTTP, así que la guarda no se puede soltar en el
			// mismo tick o el eco entraría igual.
			setTimeout(() => refrescandoCierres.delete(cierreId), 4000);
		}
	}

	/**
	 * Trae de nómina los conceptos laborales del mes para la placa activa.
	 *
	 * ⚠️ `guardarConceptos` es un REEMPLAZO: en el servidor hace
	 * `deleteMany` + `createMany` sobre todos los conceptos del cierre. Por
	 * eso aquí se envía la lista COMPLETA — los costos laborales nuevos más
	 * los gastos, anticipos e impuestos que ya había—. Mandar solo lo que
	 * viene de nómina borraría el resto de la liquidación.
	 */
	async function sincronizarNomina() {
		const cierre = cierreActivoObj;
		const detalle = detalleActivo;
		if (!cierre || !detalle) return;

		await conOverlay(
			{
				titulo: 'Sincronizando con nómina',
				detalle:
					`${cierre.placa} · ${periodDisplay}. Trayendo días trabajados, ` +
					'bonificaciones y recargos, recalculando retenciones y rehaciendo la hoja.'
			},
			async () => {
				try {
					const nomina = await liquidacionesTercerosDescuentosAPI.autocompletarNomina({
						placa: cierre.placa,
						mes,
						anio
					});

					const conceptosNomina = nomina.conceptos ?? [];
					if (conceptosNomina.length === 0) {
						toast.warning(`Sin nómina para ${cierre.placa} en ${periodDisplay}`, {
							description:
								'El vehículo no tiene conductores liquidados en este periodo. ' +
								'No se ha modificado nada.',
							duration: 7000
						});
						return;
					}

					// Los COSTO_LABORAL se sustituyen enteros: son el reflejo de la
					// nómina del mes, y conservar los viejos junto a los nuevos
					// duplicaría cada conductor.
					const conservados = (detalle.conceptos as any[]).filter(
						(c) => c.tipo !== 'COSTO_LABORAL'
					);

					await liquidacionesTercerosDescuentosAPI.guardarConceptos(cierre.id, [
						...conceptosNomina,
						...conservados
					] as any);
					// Las retenciones gravan sobre lo liquidado, no sobre la nómina,
					// pero `guardarConceptos` solo recalcula totales: sin esto, las
					// filas de impuesto se quedarían con la base anterior.
					await liquidacionesTercerosDescuentosAPI.calcularImpuestos(cierre.id);
					await recargarCierre(cierre.id);

					const n = nomina.conductores?.length ?? 0;
					toast.success(`${cierre.placa}: ${n} conductor(es) sincronizado(s)`, {
						description: `${conceptosNomina.length} conceptos de nómina y las retenciones recalculadas.`
					});
				} catch (e: any) {
					console.error('[cierres-canvas] sincronizarNomina', e);
					toast.error('No se pudo sincronizar con nómina', {
						description: e?.response?.data?.message || e?.message || 'Error desconocido',
						duration: 9000
					});
				}
			}
		);
	}

	/**
	 * Recalcula RETENCION ICA, AVISOS Y TABLEROS, SOBRETASA BOMBERIL y
	 * RETENCION EN LA FUENTE con los porcentajes de configuración.
	 *
	 * Hace falta un disparador manual porque `generarBorrador` NO siembra
	 * las filas de impuesto: hasta ahora solo aparecían de rebote, al
	 * editar una celda o al marcar/desmarcar un item. Un borrador recién
	 * generado enseñaba «(sin impuestos)» y un TOTAL A PAGAR sin retenciones
	 * descontadas.
	 */
	async function recalcularImpuestos() {
		const cierre = cierreActivoObj;
		if (!cierre) return;

		await conOverlay(
			{
				titulo: 'Recalculando impuestos',
				detalle:
					`${cierre.placa} · ${periodDisplay}. Retención ICA, avisos y tableros, ` +
					'sobretasa bomberil y retención en la fuente.'
			},
			async () => {
				try {
					await liquidacionesTercerosDescuentosAPI.calcularImpuestos(cierre.id);
					await recargarCierre(cierre.id);
					toast.success(`Impuestos recalculados en ${cierre.placa}`);
				} catch (e: any) {
					console.error('[cierres-canvas] recalcularImpuestos', e);
					toast.error('No se pudieron recalcular los impuestos', {
						description: e?.response?.data?.message || e?.message || 'Error desconocido',
						duration: 9000
					});
				}
			}
		);
	}

	/// Una hoja solo acepta escrituras mientras es BORRADOR; el servidor
	/// rechaza el resto. El carril lo refleja apagando sus acciones.
	const hojaEditable = $derived(!!cierreActivoObj && esEditable(cierreActivoObj.estado));
	/// Motivo por el que una acción de escritura está apagada, para el popover.
	const motivoBloqueo = $derived(
		accionEnCurso
			? `${accionEnCurso.titulo}… Espera a que termine.`
			: !cierreActivoObj
				? 'No hay ninguna hoja activa.'
				: !detalleActivo
					? 'La hoja todavía se está cargando.'
					: !hojaEditable
						? `La hoja está ${cierreActivoObj.estado}; solo se puede editar en BORRADOR.`
						: ''
	);

	// ─── Carga ─────────────────────────────────────────────
	/**
	 * Carga en curso, para poder abortarla.
	 *
	 * Un periodo con muchas placas se pide en varios lotes secuenciales. Si
	 * el usuario cambia de mes a mitad, sin esto las peticiones del mes
	 * abandonado seguirían saliendo una tras otra y habría que esperarlas
	 * antes de ver el mes nuevo.
	 */
	let cargaEnCurso: AbortController | null = null;

	/**
	 * Contador de cargas, ADEMÁS del AbortController.
	 *
	 * Abortar no deshace una promesa que ya se había resuelto: esa respuesta
	 * todavía puede escribir `indice`/`detalles` cuando el usuario ya está en
	 * otro mes. El token es lo que impide que una carga vieja pise a la nueva.
	 */
	let cargaToken = 0;

	/** `true` si el error viene de un aborto nuestro y no de un fallo real. */
	function esCancelacion(e: any): boolean {
		return e?.name === 'CanceledError' || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED';
	}

	async function loadInicial() {
		// Abortar la anterior ANTES de tocar nada más.
		cargaEnCurso?.abort();
		const controller = new AbortController();
		cargaEnCurso = controller;
		const token = ++cargaToken;
		const { signal } = controller;
		const opts = { signal };

		// El libro viejo se desmonta al EMPEZAR, no al terminar: si no, el
		// usuario se queda mirando las hojas del mes anterior mientras carga
		// el nuevo y parece que el cambio no ha ocurrido.
		teardownEngine();

		loading = true;
		loadError = '';
		progreso = '';
		try {
			// En paralelo: las anotaciones no dependen del periodo y no deben
			// añadir un salto de red al montaje.
			const [periodo, anot] = await Promise.all([
				liquidacionesTercerosDescuentosAPI.listarPeriodo(anio, mes, opts),
				canvasAnotacionesAPI.listar('cierres-finales', anio, mes).catch((e) => {
					// Que falle la capa de notas no puede impedir abrir el canvas.
					console.warn('[cierres-canvas] anotaciones no disponibles', e);
					return {} as AnotacionesPorMes;
				})
			]);
			if (token !== cargaToken) return;
			indice = periodo.hojas ?? [];
			anotaciones = anot;
			versionesAnot.limpiar();
			versionesAnot.hidratar(anot[mes], mes);

			if (indice.length === 0) {
				detalles = {};
				abrirSesion();
				return;
			}

			// La hoja activa por defecto: la de la URL si sigue existiendo, si
			// no la primera del orden alfabético.
			if (!cierreActivo || !indice.some((c) => c.id === cierreActivo)) {
				cierreActivo = indice[0].id;
			}

			// Los detalles se piden por lotes. Se empieza por el lote que
			// contiene la hoja activa para que, si algo falla a mitad, al menos
			// esa esté completa.
			const ids = ordenarEmpezandoPorActiva(indice.map((c) => c.id));
			const acumulado: Record<string, CierreFinalCompleto> = {};
			const porId = new Map(indice.map((c) => [c.id, c]));

			for (let i = 0; i < ids.length; i += TAM_LOTE) {
				// Comprobar ENTRE lotes: abortar solo cancela la petición en
				// vuelo; sin esta guarda el bucle seguiría pidiendo los lotes
				// restantes del mes que el usuario ya abandonó.
				if (signal.aborted || token !== cargaToken) return;

				const lote = ids.slice(i, i + TAM_LOTE);
				progreso = `Cargando ${Math.min(i + lote.length, ids.length)} de ${ids.length} hojas…`;
				const detalle = await liquidacionesTercerosDescuentosAPI.detallePeriodo(
					anio,
					mes,
					lote,
					opts
				);
				for (const d of detalle) {
					if (!d?.id) continue;
					acumulado[d.id] = conHojaDelIndice(aCierreCompleto(d), porId.get(d.id));
				}
			}
			if (token !== cargaToken) return;
			detalles = acumulado;

			abrirSesion();
			await tick();
			if (token !== cargaToken) return;
			if (!container) {
				loadError = 'Container no disponible';
				return;
			}
			syncUrl();
			await remountEngine();
		} catch (e: any) {
			// Una cancelación es una acción deliberada del usuario, no un
			// fallo: mostrarla como error dejaría un mensaje rojo por haber
			// cambiado de mes.
			if (esCancelacion(e) || token !== cargaToken) return;
			loadError = e?.message || 'Error al cargar los cierres del periodo';
		} finally {
			// Solo la carga vigente puede apagar el indicador: si lo hiciera
			// una abortada, el mes nuevo se quedaría cargando sin spinner.
			if (token === cargaToken) {
				loading = false;
				progreso = '';
			}
		}
	}

	function ordenarEmpezandoPorActiva(ids: string[]): string[] {
		const i = ids.indexOf(cierreActivo ?? '');
		if (i < 0) return ids;
		const inicio = Math.floor(i / TAM_LOTE) * TAM_LOTE;
		return [...ids.slice(inicio), ...ids.slice(0, inicio)];
	}

	function irACierre(cierreId: string) {
		if (cierreId === cierreActivo) return;
		cierreActivo = cierreId;
		ctx?.activarCierre(cierreId);
		session?.setHojaActiva(mes, cierreId);
		syncUrl();
	}

	/**
	 * Salida del módulo.
	 *
	 * Va a `/dashboard/servicios` y no a `/dashboard/liquidaciones-terceros`:
	 * ese índice ahora redirige aquí mismo, así que apuntarle sería un bucle.
	 * Tampoco a `/dashboard`, que es solo un `onMount` que reenvía a servicios
	 * y produce un flash "Redirigiendo…".
	 *
	 * El botón no se puede quitar: este canvas monta bajo `+layout@.svelte` con
	 * `univer-shell-active` (`position:fixed; inset:0`), sin sidebar ni header.
	 */
	function closeAndGo() {
		session?.dispose();
		session = null;
		goto('/dashboard/servicios');
	}

	/**
	 * Gancho previo a saltar a otro canvas del módulo.
	 *
	 * `avisarSiPendiente` es un `beforeunload` y NO se dispara en navegación de
	 * cliente, así que sin este confirm la cola en memoria se perdería en
	 * silencio. Mismo criterio que `cambiarPeriodo`.
	 */
	function antesDeSalir(): boolean {
		if (
			totalPendientes > 0 &&
			!confirm('Hay cambios sin confirmar por el servidor. ¿Salir del canvas igualmente?')
		) {
			return false;
		}
		session?.dispose();
		session = null;
		return true;
	}

	/**
	 * La URL manda: si su periodo no es el cargado, se recarga.
	 *
	 * Cubre las tres formas de llegar a un periodo —los selectores del
	 * header, el botón Atrás del navegador y un enlace pegado— con un solo
	 * camino. `periodoCargado` es una variable normal, no `$state`: si lo
	 * fuera, escribirla dentro del efecto volvería a dispararlo.
	 */
	$effect(() => {
		const a = anio;
		const m = mes;
		if (!browser) return;
		if (periodoCargado.anio === a && periodoCargado.mes === m) return;
		periodoCargado = { anio: a, mes: m };
		// La sesión anterior es de otro room (el room lleva año y mes).
		session?.dispose();
		session = null;
		cierreActivo = $page.url.searchParams.get('cierre');
		void loadInicial();
	});

	onMount(() => {
		if (!browser) return;
		// El token va en el handshake: el servidor firma las escrituras con la
		// identidad del JWT, no con la que declare el cliente en cada evento.
		// La carga inicial la dispara el efecto de arriba, que ya se ejecuta
		// una vez al montar.
		connectSocket();
	});

	/**
	 * Aviso al cerrar con escrituras pendientes.
	 *
	 * La cola vive en memoria: recargar la pestaña las pierde. El aviso no lo
	 * impide, pero al menos el usuario se entera antes de perder el trabajo.
	 */
	function avisarSiPendiente(e: BeforeUnloadEvent) {
		if (!cola.hayPendientes() && pendientes.size === 0) return;
		e.preventDefault();
		e.returnValue = '';
	}

	onDestroy(() => {
		cola.dispose();
		cargaEnCurso?.abort();
		cargaEnCurso = null;
		session?.dispose();
		session = null;
		teardownEngine();
	});
</script>

<svelte:window onbeforeunload={avisarSiPendiente} />

<svelte:head>
	<title>Cierres finales {periodDisplay} (canvas) · Cotransmeq</title>
</svelte:head>

<UniverToolbar
	title="CIERRES FINALES DE TERCEROS: {periodDisplay}"
	subtitle="{indice.length} hoja(s) · {borradores} en borrador · Σ v/liquidar ${formatCOP(
		totalLiquidar
	)} · Σ a pagar ${formatCOP(totalPagar)}"
	onBack={closeAndGo}
	backLabel="Salir"
>
	{#snippet actions()}
		<label class="univer-year-picker">
			<span>Año</span>
			<select
				value={anio}
				onchange={(e) => cambiarPeriodo(Number((e.currentTarget as HTMLSelectElement).value), mes)}
			>
				{#each anios as a (a)}
					<option value={a}>{a}</option>
				{/each}
			</select>
		</label>

		<select
			class="univer-month-picker"
			value={mes}
			onchange={(e) => cambiarPeriodo(anio, Number((e.currentTarget as HTMLSelectElement).value))}
			title="Cambiar de periodo (remonta el libro)"
		>
			{#each MESES as nombre, i (nombre)}
				<option value={i + 1}>{nombre}</option>
			{/each}
		</select>

		<div class="univer-divider-v"></div>

		<SelectorCanvasTerceros
			actual="cierres"
			{anio}
			{mes}
			onSalir={antesDeSalir}
			extra={{
				value: 'preview',
				label: 'Vista previa PDF (hoja activa)',
				disabled: !cierreActivo,
				onSelect: () =>
					cierreActivo && goto(`/dashboard/liquidaciones-terceros/${cierreActivo}?mode=view`)
			}}
		/>

		<SelectorHojaCierre cierres={indice} activo={cierreActivo} onSeleccionar={irACierre} />

		<!-- Las ACCIONES viven ahora en el carril de la derecha. Aquí solo
		     queda el CONTEXTO: en qué periodo y en qué hoja estoy, quién más
		     está conectado y si queda algo sin guardar. Es lo que impedía que
		     el título cupiera cuando convivían nueve controles en la barra. -->
		<PresenceAvatars users={presence} />
		<AutosaveIndicator
			pendientes={totalPendientes}
			fallidas={colaFallidas}
			{conectado}
			onReintentar={() => cola.reintentarFallidas()}
		/>
		<!-- Sin botón "Volver" aquí: `onBack` ya pone uno a la izquierda del
		     toolbar. Con ocho controles a la derecha, el duplicado era lo
		     primero que empujaba a los selectores fuera de pantalla. -->
	{/snippet}
</UniverToolbar>

<!-- ─── Iconos del carril ───────────────────────────────────────────
     Inline y no como componentes: son 24×24 sin estado y heredan
     `currentColor`, así que un fichero por icono solo añadiría saltos. -->
{#snippet icoNomina()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M16.023 9.348h4.992V4.356" />
		<path d="M2.985 19.644v-4.992h4.992" />
		<path d="M2.985 14.652l3.181 3.183a8.25 8.25 0 0013.803-3.7" />
		<path d="M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.183" />
	</svg>
{/snippet}

{#snippet icoConductor()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M19 7.5v6M22 10.5h-6" />
		<path d="M13.5 7.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0z" />
		<path
			d="M4 19.235v-.11a6.375 6.375 0 0112.75 0v.11A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.765z"
		/>
	</svg>
{/snippet}

{#snippet icoConcepto()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M13.5 16.875h6.75M16.875 13.5v6.75" />
		<rect x="3.75" y="3.75" width="6.75" height="6.75" rx="2.25" />
		<rect x="3.75" y="13.5" width="6.75" height="6.75" rx="2.25" />
		<rect x="13.5" y="3.75" width="6.75" height="6.75" rx="2.25" />
	</svg>
{/snippet}

{#snippet icoTraerItems()}
	<!-- Bandeja con flecha ENTRANDO. No se reutiliza `icoConcepto` —la rejilla
	     con el «+»— porque las dos acciones viven seguidas en el carril y a
	     15px dos siluetas parecidas se confunden: aquella AÑADE filas nuevas,
	     esta TRAE filas que ya existen. -->
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M3.5 14.5h4l1.5 2.5h6l1.5-2.5h4" />
		<path d="M3.5 14.5v3.75a2.25 2.25 0 002.25 2.25h12.5a2.25 2.25 0 002.25-2.25V14.5" />
		<path d="M12 3.5v7.5" />
		<path d="M9 8.25L12 11.25 15 8.25" />
	</svg>
{/snippet}

{#snippet icoImpuestos()}
	<!-- Un porcentaje pelado y no el recibo-con-%: a 19px la silueta del
	     recibo se lee como un rectángulo vacío y el % interior se pierde. -->
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M18.5 5.5L5.5 18.5" />
		<circle cx="7.75" cy="7.75" r="2.75" />
		<circle cx="16.25" cy="16.25" r="2.75" />
	</svg>
{/snippet}

{#snippet icoOjo()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
		<path
			d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
		/>
	</svg>
{/snippet}

{#snippet icoExcel()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<rect x="3.5" y="4" width="17" height="16" rx="2" />
		<path d="M3.5 9.5h17M3.5 15h17M9.5 4v16M15 4v16" />
	</svg>
{/snippet}

{#snippet icoZip()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path
			d="M4.5 6.75A2.25 2.25 0 016.75 4.5h3.129c.53 0 1.039.21 1.414.586l1.121 1.121c.375.375.884.586 1.414.586h3.522A2.25 2.25 0 0119.5 9.043v8.207a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25V6.75z"
		/>
		<path d="M12 9.5v1M12 12v1M12 14.5v1.25" />
	</svg>
{/snippet}

{#snippet icoBorradores()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M12 9v6M15 12H9" />
		<path
			d="M19.5 14.25v5.25a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5V4.5A1.5 1.5 0 016 3h6.75L19.5 9.75v4.5z"
		/>
	</svg>
{/snippet}

{#snippet icoEstado()}
	<svg
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M9 12.75L11.25 15 15 9.75" />
		<path
			d="M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
		/>
	</svg>
{/snippet}

<!-- El bloque de estado entero se REUBICA, no se reescribe: son 660 líneas
     con su menú, sus diálogos de motivo y el cierre en lote. -->
{#snippet panelEstado()}
	<div class="cf-panel-estado">
		<CierreEstadoHeader
			cierre={cierreActivoObj
				? {
						id: cierreActivoObj.id,
						placa: cierreActivoObj.placa,
						tercero_nombre: cierreActivoObj.tercero_nombre,
						estado: cierreActivoObj.estado,
						version: cierreActivoObj.version
					}
				: null}
			{anio}
			{mes}
			areas={$authStore.user?.area ?? null}
			{borradores}
			onCambiado={({ id, estado, version }) => aplicarEstado(id, estado, version)}
			onLoteCambiado={(cambios) => {
				for (const c of cambios) aplicarEstado(c.id, c.estado, c.version);
			}}
			onConflicto={({ id, estado, version }) => aplicarEstado(id, estado, version)}
		/>
	</div>
{/snippet}

<div class="cf-body">
	<div class="cf-canvas">
		{#if !loading && !loadError && indice.length === 0}
			<div class="cf-vacio">
				<h2>Sin cierres en {periodDisplay}</h2>
				<p>
					Este periodo no tiene ninguna liquidación final de terceros. Genera los borradores a
					partir de las liquidaciones de servicio del mes.
				</p>
				<button class="univer-btn univer-btn-green" onclick={() => (modalBorradores = true)}>
					Generar borradores
				</button>
			</div>
		{:else}
			<!-- `loading && !accionEnCurso`: durante una acción del carril el velo
			     lo pone `UniverActionOverlay`, que además tapa el carril y dice
			     QUÉ se está haciendo. Los dos a la vez apilarían dos desenfoques
			     y dos mensajes distintos sobre lo mismo. -->
			<UniverCanvasHost
				bind:container
				loading={loading && !accionEnCurso}
				error={loadError}
				loadingLabel={progreso || `Cargando cierres de ${periodDisplay}…`}
				onRetry={loadInicial}
				errorLabel="Reintentar"
			/>
		{/if}
	</div>

	<!-- El array se arma AQUÍ y no en el <script> porque referencia snippets,
	     que solo están en ámbito desde la plantilla. -->
	<UniverSideRail
		ariaLabel="Acciones de cierres finales"
		items={[
			{
				id: 'nomina',
				label: 'Sincronizar con nómina',
				hint: `Trae los días trabajados, bonificaciones y recargos de ${cierreActivoObj?.placa ?? 'la placa'} en ${periodDisplay}, y recalcula las retenciones.`,
				icon: icoNomina,
				disabled: !hojaEditable || !detalleActivo || !!accionEnCurso,
				disabledHint: motivoBloqueo,
				onSelect: sincronizarNomina
			},
			{
				id: 'conductor',
				label: 'Conductores del cierre',
				hint: 'Añadir o quitar conductores de los descuentos por la prestación del servicio, y marcar cuál es el propietario del vehículo.',
				icon: icoConductor,
				disabled: !hojaEditable || !detalleActivo || !!accionEnCurso,
				disabledHint: motivoBloqueo,
				onSelect: () => (modalConductores = true)
			},
			{
				id: 'concepto',
				label: 'Filas del cierre',
				hint: 'Añadir o quitar gastos de vehículo, anticipos y adicionales, y quitar o devolver items de la liquidación.',
				icon: icoConcepto,
				disabled: !hojaEditable || !detalleActivo || !!accionEnCurso,
				disabledHint: motivoBloqueo,
				onSelect: () => (modalConceptos = true)
			},
			{
				id: 'traer-items',
				label: 'Traer items',
				hint: `Buscar items de liquidación de ${cierreActivoObj?.placa ?? 'la placa'} que no estén en ningún cierre —de cualquier mes, anterior o posterior— y añadirlos a esta hoja sin regenerar el borrador.`,
				icon: icoTraerItems,
				disabled: !hojaEditable || !detalleActivo || !!accionEnCurso,
				disabledHint: motivoBloqueo,
				onSelect: () => (modalTraerItems = true)
			},
			{
				id: 'impuestos',
				label: 'Recalcular impuestos',
				hint: 'Regenera RETENCIÓN ICA, AVISOS Y TABLEROS, SOBRETASA BOMBERIL y RETENCIÓN EN LA FUENTE con los porcentajes de configuración.',
				icon: icoImpuestos,
				disabled: !hojaEditable || !detalleActivo || !!accionEnCurso,
				disabledHint: motivoBloqueo,
				onSelect: recalcularImpuestos
			},
			{ type: 'sep' },
			{
				id: 'preview',
				label: 'Vista previa',
				hint: `Ver la hoja de ${cierreActivoObj?.placa ?? ''} tal y como está ahora y exportarla a PDF.`,
				icon: icoOjo,
				disabled: !detalleActivo,
				disabledHint: 'La hoja activa todavía se está cargando.',
				onSelect: () => (previewAbierto = true)
			},
			{
				id: 'excel',
				label: exportandoExcel ? 'Generando Excel…' : 'Exportar Excel',
				hint: `Un solo .xlsx de ${periodDisplay} con TODAS las hojas del periodo: una pestaña por cierre, con sus items, descuentos, gastos, anticipos e impuestos.`,
				icon: icoExcel,
				disabled: exportandoExcel || indice.length === 0,
				disabledHint: exportandoExcel
					? 'Ya se está generando el libro.'
					: 'El periodo no tiene hojas.',
				onSelect: exportarLibroExcel
			},
			{
				id: 'zip',
				label: exportandoZip ? 'Generando PDF…' : 'Exportar PDF (ZIP)',
				hint: `Un PDF por hoja de ${periodDisplay}, todos en un ZIP. Cada fichero se llama PLACA_PROPIETARIO_MES_AÑO.`,
				icon: icoZip,
				disabled: exportandoZip || indice.length === 0,
				disabledHint: exportandoZip
					? 'Ya se está generando el lote.'
					: 'El periodo no tiene hojas.',
				onSelect: exportarZipPdf
			},
			{
				id: 'borradores',
				label: 'Generar borradores',
				hint: `Crear los cierres de ${periodDisplay} a partir de las liquidaciones de servicio del mes.`,
				icon: icoBorradores,
				tone: 'green',
				onSelect: () => (modalBorradores = true)
			},
			{
				id: 'estado',
				label: 'Estado de la hoja',
				icon: icoEstado,
				badge: borradores,
				panel: panelEstado,
				panelTone: 'dark',
				panelWidth: 300
			}
		]}
	/>

	<!-- Último hijo de `.cf-body` para que cubra también el carril: mientras
	     una acción corre, ninguna otra debe poder empezar. -->
	<UniverActionOverlay accion={accionEnCurso} />
</div>

{#if previewAbierto && documentoPreview}
	<PreviewCanvasModal
		scope="cierres"
		documento={documentoPreview}
		subtitulo="{cierreActivoObj?.placa ?? ''}  ·  {cierreActivoObj?.tercero_nombre ??
			''}  ·  {periodDisplay}  ·  {cierreActivoObj?.estado ?? ''}"
		onClose={() => (previewAbierto = false)}
	/>
{/if}

{#if modalConductores && cierreActivoObj && detalleActivo}
	<ConductoresCierreModal
		cierreId={cierreActivoObj.id}
		placa={cierreActivoObj.placa}
		periodo={periodDisplay}
		conceptos={detalleActivo.conceptos}
		propietarios={detalleActivo.propietarios}
		onClose={() => (modalConductores = false)}
		onGuardado={async ({ agregados, eliminados }) => {
			modalConductores = false;
			// Altas y bajas cambian la geometría de la hoja, así que esto
			// remonta el libro; no basta con repintar celdas. Con el modal ya
			// cerrado, el remonte deja el canvas en blanco unos segundos: el
			// velo es lo que distingue "reconstruyendo" de "se rompió".
			await conOverlay(
				{
					titulo: 'Actualizando conductores',
					detalle: `${cierreActivoObj.placa} · rehaciendo la hoja con dotación y examen médico recalculados.`
				},
				() => recargarCierre(cierreActivoObj.id)
			);
			const partes: string[] = [];
			if (agregados) partes.push(`${agregados} agregado(s)`);
			if (eliminados) partes.push(`${eliminados} dado(s) de baja`);
			toast.success(`Conductores de ${cierreActivoObj.placa} actualizados`, {
				description: partes.length
					? `${partes.join(' · ')}. Dotación y examen médico recalculados.`
					: 'Días y propietario actualizados; dotación y examen médico recalculados.'
			});
		}}
	/>
{/if}

{#if modalConceptos && cierreActivoObj && detalleActivo}
	<ConceptosCierreModal
		cierreId={cierreActivoObj.id}
		placa={cierreActivoObj.placa}
		periodo={periodDisplay}
		conceptos={detalleActivo.conceptos}
		adicionales={detalleActivo.adicionales}
		items={detalleActivo.items}
		terceroNombre={cierreActivoObj.tercero_nombre}
		onClose={async () => {
			modalConceptos = false;
			// El remonte se hace UNA vez, al cerrar: las altas de dentro solo
			// refrescaron el modelo.
			if (hayCambiosDeConceptos) {
				hayCambiosDeConceptos = false;
				await conOverlay(
					{
						titulo: 'Aplicando cambios en las filas',
						detalle: `${cierreActivoObj.placa} · rehaciendo la hoja con las filas nuevas.`
					},
					() => recargarCierre(cierreActivoObj.id)
				);
			}
		}}
		onCambiado={async ({ accion, concepto }) => {
			// El modal se queda ABIERTO: los gastos se meten en tanda y cerrarlo
			// en cada alta obligaría a reabrirlo por cada fila. Solo se refresca
			// el MODELO —así la tabla del modal se repinta con la fila nueva— y
			// el libro se remonta al cerrar.
			hayCambiosDeConceptos = true;
			await recargarCierre(cierreActivoObj.id, { remontar: false });
			toast.success(
				accion === 'add'
					? `${concepto.replace(/_/g, ' ')} añadido a ${cierreActivoObj.placa}`
					: `${concepto.replace(/_/g, ' ')} eliminado de ${cierreActivoObj.placa}`
			);
		}}
	/>
{/if}

{#if modalTraerItems && cierreActivoObj && detalleActivo}
	<ItemsDisponiblesModal
		cierreId={cierreActivoObj.id}
		placa={cierreActivoObj.placa}
		periodo={periodDisplay}
		{mes}
		{anio}
		editable={hojaEditable}
		onClose={() => (modalTraerItems = false)}
		onAgregado={async (n) => {
			// A diferencia del modal de conceptos, este SÍ remonta al vuelo: se
			// cierra en cuanto añade, así que no hay tanda que agrupar y la hoja
			// tiene que enseñar las filas nuevas al momento.
			await conOverlay(
				{
					titulo: 'Trayendo items a la hoja',
					detalle: `${cierreActivoObj.placa} · ${n} item(s) nuevos en la liquidación.`
				},
				() => recargarCierre(cierreActivoObj.id)
			);
			toast.success(`${n} item(s) añadidos a ${cierreActivoObj.placa}`);
		}}
	/>
{/if}

{#if modalBorradores}
	<GenerarBorradoresModal
		{anio}
		{mes}
		cierresExistentes={indice}
		onClose={() => (modalBorradores = false)}
	/>
{/if}

<style>
	/* Fila: canvas elástico + carril de 32px.
	   `.cf-canvas` es una COLUMNA para que `.univer-host` siga teniendo el
	   mismo padre flex-column de antes — su cadena de altura depende de eso
	   (ver REGLA #2 en UniverCanvasHost). `min-width: 0` es obligatorio: sin
	   él, el `width:100%` del host le gana al `flex` y empuja al carril
	   fuera de la pantalla. */
	.cf-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		/* Ancla de `UniverActionOverlay`, que es `position: absolute` y tiene
		   que cubrir canvas Y carril. */
		position: relative;
	}
	.cf-canvas {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* El bloque de estado se escribió para una barra horizontal ancha; en un
	   flyout de 300px necesita envolver. */
	.cf-panel-estado :global(.ceh) {
		flex-wrap: wrap;
		gap: 8px;
	}

	.cf-vacio {
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
	.cf-vacio h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
	}
	.cf-vacio p {
		margin: 0;
		max-width: 460px;
		font-size: 13px;
		line-height: 1.6;
		color: #64748b;
	}
	.cf-vacio .univer-btn {
		margin-top: 6px;
	}
</style>
