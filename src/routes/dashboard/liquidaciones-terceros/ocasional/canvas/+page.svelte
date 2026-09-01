<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		liquidacionesTercerosOcasionalAPI,
		type ConceptoOcasional,
		type LiquidacionOcasional,
		type TerceroCandidato
	} from '$lib/api/liquidaciones-terceros-ocasional';
	import ModalSelectTercerosOcasionales from '$lib/components/ui/ModalSelectTercerosOcasionales.svelte';
	import ModalGastosVehiculo from '$lib/components/univer/ModalGastosVehiculo.svelte';
	import SnapshotPanel from '$lib/components/univer/SnapshotPanel.svelte';
	import {
		createOcasionalEngine,
		disposeEngine,
		type OcasionalEngineContext,
		type OcasionalMesInput
	} from '$lib/editor/univer/ocasional-engine';
	import { installOcasionalCellPermission } from '$lib/editor/univer/cell-permission-ocasional';
	import { attachOcasionalCellChangeAdapter } from '$lib/editor/univer/adapters/cell-change-ocasional';
	import { clearOcasionalBindings } from '$lib/editor/business/ocasional-cell-binding';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import SelectorCanvasTerceros from '$lib/components/univer/SelectorCanvasTerceros.svelte';
	import PreviewCanvasModal from '$lib/components/liquidaciones-terceros/preview/PreviewCanvasModal.svelte';
	import {
		exportarExcelLibro,
		type HojaLibro
	} from '$lib/components/liquidaciones-terceros/preview/exportar-excel';
	import {
		exportarZipPdfs,
		type HojaPdf
	} from '$lib/components/liquidaciones-terceros/preview/exportar-zip';
	import { documentoOcasional } from '$lib/components/liquidaciones-terceros/preview/datos/ocasional.doc';
	import * as realtimeCollab from '$lib/stores/realtimeCollab';
	import { connectSocket } from '$lib/socketClient';
	import { canvasAnotacionesAPI, type AnotacionesPorMes } from '$lib/api/canvas-anotaciones';
	import { createSheetSession, type SheetSession } from '$lib/editor/canvas/sheet-session.svelte';
	import {
		VersionesAnotaciones,
		emitirAnotacion,
		parseIdAnotacion
	} from '$lib/editor/canvas/anotaciones';
	import type { ICellData } from '@univerjs/core';
	import { filaDeAncla, numeroDeCapa } from '$lib/editor/business/zona-libre';
	import {
		ensureCostosLaborales,
		ensureGastosVehiculo,
		GASTOS_VEHICULO
	} from '$lib/editor/business/costos-laborales';
	import { alcanceOcasional } from '$lib/editor/business/id-sintetico';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConfiguracionDescuento
	} from '$lib/api/liquidaciones-terceros-descuentos';
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
	// `anio` es el eje del WORKBOOK (unitId distinto ⇒ teardown + remount).
	// `mesActivo` es solo la hoja activa ⇒ cambiarlo no remonta nada.
	let anio = $state(Number($page.url.searchParams.get('anio')) || new Date().getFullYear());
	let mesActivo = $state(mesValido(Number($page.url.searchParams.get('mes'))));

	let loading = $state(true);
	let loadError = $state('');
	let container: HTMLDivElement | null = $state(null);
	let ctx: OcasionalEngineContext | null = null;
	let canvasDisposers: Array<() => void> = [];

	/// Estado por mes (claves 1..12). Una hoja = una cabecera.
	let mesesData = $state<OcasionalMesInput[]>([]);

	/**
	 * Capa de ANOTACIONES: las celdas libres bajo el bloque estructurado.
	 *
	 * Van por `sheet-session` y no por el autoguardado de documento completo
	 * que usa el resto de esta page: son por celda, viajan al instante al
	 * resto del equipo y no tocan ninguna tabla de negocio.
	 */
	let anotaciones = $state<AnotacionesPorMes>({});
	/// `false` si la capa no cargó: se avisa al escribir en vez de perderlo callando.
	let capaDisponible = $state(true);
	let session: SheetSession | null = null;
	/// `true` mientras se pinta una anotación remota (guarda anti-eco).
	let aplicandoRemoto = false;
	const versionesAnot = new VersionesAnotaciones();

	/// Porcentajes de prestaciones y seguridad social. Se leen de la misma
	/// configuración que usa el canvas de cierres: única fuente de verdad.
	let configDescuentos: ConfiguracionDescuento[] = [];

	let porMes = $derived.by(() => {
		const m = new Map<number, OcasionalMesInput>();
		for (const d of mesesData) m.set(d.mes, d);
		return m;
	});

	let datosMesActivo = $derived(porMes.get(mesActivo) ?? null);
	let cabeceraActiva = $derived<LiquidacionOcasional | null>(datosMesActivo?.cabecera ?? null);
	let periodDisplay = $derived(`${MESES[mesActivo - 1] || ''} ${anio}`);

	let mesesConBorrador = $derived(mesesData.filter((d) => d.cabecera).length);
	let totalPagarMes = $derived(Number(cabeceraActiva?.total_pagar) || 0);
	let totalPagarAnual = $derived(
		mesesData.reduce((s, d) => s + (Number(d.cabecera?.total_pagar) || 0), 0)
	);

	let anios = $derived.by(() => {
		const actual = new Date().getFullYear();
		const out: number[] = [];
		for (let a = actual - 3; a <= actual + 1; a++) out.push(a);
		if (!out.includes(anio)) out.unshift(anio);
		return out;
	});

	// ─── State del autosave ────────────────────────────────
	let isSaving = $state(false);
	let lastSavedAt: string | null = $state(null);
	let mesesSucios = $state<Set<number>>(new Set());
	let isDirty = $derived(mesesSucios.size > 0);

	/**
	 * Token de montaje: `mountEngineNow` es async, así que cambiar de año dos
	 * veces seguidas podría solapar un mount con un teardown en curso y dejar
	 * el canvas atado a un engine ya destruido.
	 */
	let mountToken = 0;
	/// Año cuyo room de colaboración está activo. `null` = sin join.
	let roomAnio: number | null = null;

	// ─── Sincronización de la URL ──────────────────────────
	/// `replaceState` y no `goto`: un `goto` reejecutaría el load de la ruta
	/// y podría remontar el canvas al cambiar de pestaña.
	function syncUrl() {
		if (!browser) return;
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(anio));
		url.searchParams.set('mes', String(mesActivo));
		window.history.replaceState({}, '', url);
	}

	function setMesData(mes: number, patch: Partial<OcasionalMesInput>) {
		mesesData = mesesData.map((d) => (d.mes === mes ? { ...d, ...patch } : d));
	}

	// ─── Montaje / teardown ────────────────────────────────
	async function mountEngineNow() {
		if (!container) return;
		const token = mountToken;
		try {
			const newCtx = createOcasionalEngine({
				container,
				anio,
				meses: mesesData,
				mesActivo,
				anotaciones
			});
			if (token !== mountToken) {
				// Otro montaje ganó la carrera: descartar este engine para no
				// dejar un Univer huérfano con su Worker de fórmulas vivo.
				disposeEngine(newCtx.univer, newCtx.fUniver, newCtx.unitId, container);
				return;
			}
			ctx = newCtx;

			canvasDisposers.push(installOcasionalCellPermission(newCtx.univer));

			const commandService = (newCtx.univer as any)
				.__getInjector()
				.get((await import('@univerjs/core')).ICommandService);
			if (token !== mountToken) return;

			canvasDisposers.push(
				attachOcasionalCellChangeAdapter({
					unitId: newCtx.unitId,
					anio,
					commandService,
					getWorkbook: () => newCtx.fUniver.getActiveWorkbook() as any,
					resolveMes: newCtx.resolveMes,
					getState: (mes) => {
						const d = porMes.get(mes);
						return {
							items: d?.items ?? [],
							adicionales: d?.adicionales ?? [],
							conceptos: d?.conceptos ?? []
						};
					},
					setState: (mes, next) => {
						setMesData(mes, next);
						marcarSucio(mes);
						scheduleSave(mes);
					},
					onActiveSheetChange: (mes) => {
						if (mes === mesActivo) return;
						mesActivo = mes;
						syncUrl();
					},
					// Libro anual: la hoja la identifica el mes, así que la
					// `sheet_key` va vacía.
					// Sin esto, el `setValue` de una anotación remota volvería a
					// entrar por aquí como edición local y se reemitiría: eco infinito.
					isApplyingRemote: () => aplicandoRemoto,
					sheetKeyDe: () => '',
					// Celda de la ZONA LIBRE: no es un campo de la liquidación,
					// así que NO entra en el autoguardado de documento — viaja
					// por socket como anotación y llega al resto al instante.
					/**
					 * Filas de items eliminadas.
					 *
					 * El adaptador ya las quitó del modelo; aquí se fuerza el
					 * guardado SIN esperar al debounce y se remonta la hoja. El
					 * backend borra en lógico todo item que no venga en el
					 * payload, así que el guardado ES el borrado.
					 *
					 * Remontar no es opcional: al desaparecer filas cambian el
					 * pie de la tabla, las fórmulas del resumen y las anclas de
					 * la capa. Sin remontar, la hoja queda describiendo un
					 * layout que ya no existe.
					 */
					onFilasEliminadas: async (mes, ids) => {
						console.log('[ocasional-canvas] items eliminados', mes, ids);
						try {
							await flushSave(mes);
							await recargarMes(mes);
							toast.success(
								ids.length === 1 ? 'Item eliminado.' : `${ids.length} items eliminados.`
							);
						} catch (e: any) {
							toast.error('No se pudo guardar la eliminación: ' + (e?.message || ''));
						}
					},
					onAnotacion: ({ mes, sheetKey, ancla, valor }) => {
						if (!capaDisponible) {
							toast.error('La capa de hoja no está disponible: ese texto no se guardará.');
							return;
						}
						emitirAnotacion({
							session,
							versiones: versionesAnot,
							mes,
							sheetKey,
							ancla,
							valor
						});
					}
				})
			);
		} catch (e: any) {
			console.error('[ocasional-canvas] mount error', e);
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
			clearOcasionalBindings(ctx.unitId);
		}
		ctx = null;
	}

	async function remountEngine() {
		if (!container) return;
		mountToken++;
		teardownEngine();
		await tick();
		await mountEngineNow();
	}

	// ─── Autosave por hoja ─────────────────────────────────
	// Un timer y un flag en vuelo POR MES: cada hoja persiste contra SU
	// cabecera (`@@unique([mes, anio])`), así que un flush de MARZO no debe
	// cancelar ni esperar al de ABRIL.
	const SAVE_DELAY = 800;
	const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const savingMeses = new Set<number>();

	/**
	 * Nº de edición por mes. Sube con CADA cambio.
	 *
	 * El guardado tarda segundos, y en ese rato el usuario sigue escribiendo.
	 * Sin este contador, `marcarLimpio()` al terminar la petición daba por
	 * guardado TAMBIÉN lo que se escribió mientras viajaba: esos valores se
	 * veían en pantalla, ya no estaban sucios y no se enviaban nunca. Eran los
	 * «valores fantasma» que desaparecían al recargar.
	 */
	const revisionPorMes = new Map<number, number>();

	function marcarSucio(mes: number) {
		revisionPorMes.set(mes, (revisionPorMes.get(mes) ?? 0) + 1);
		const next = new Set(mesesSucios);
		next.add(mes);
		mesesSucios = next;
	}

	function marcarLimpio(mes: number) {
		const next = new Set(mesesSucios);
		next.delete(mes);
		mesesSucios = next;
	}

	function scheduleSave(mes: number) {
		const prev = saveTimers.get(mes);
		if (prev) clearTimeout(prev);
		saveTimers.set(
			mes,
			setTimeout(() => {
				saveTimers.delete(mes);
				flushSave(mes);
			}, SAVE_DELAY)
		);
	}

	async function flushSave(mes: number) {
		const timer = saveTimers.get(mes);
		if (timer) {
			clearTimeout(timer);
			saveTimers.delete(mes);
		}
		// Ya hay una petición en vuelo para este mes. NO se descarta el cambio:
		// se reprograma, y el `finally` de la petición en curso lo recogerá.
		if (savingMeses.has(mes)) {
			scheduleSave(mes);
			return;
		}

		const datos = porMes.get(mes);
		// Un mes sin cabecera no tiene contra qué guardar: primero hay que
		// generar el borrador desde la barra superior.
		if (!datos?.cabecera) return;

		savingMeses.add(mes);
		isSaving = true;
		realtimeCollab.setSaveStatus('saving');
		// Revisión que ESTE envío deja guardada. Lo que se edite a partir de
		// aquí sube el contador y no puede darse por limpio al terminar.
		const revisionEnviada = revisionPorMes.get(mes) ?? 0;
		try {
			await liquidacionesTercerosOcasionalAPI.guardarBorrador({
				id: datos.cabecera.id,
				mes,
				anio,
				observaciones: datos.cabecera.observaciones || null,
				items: datos.items,
				adicionales: datos.adicionales,
				conceptos: datos.conceptos
			});
			lastSavedAt = new Date().toISOString();
			if ((revisionPorMes.get(mes) ?? 0) === revisionEnviada) {
				marcarLimpio(mes);
				realtimeCollab.setSaveStatus('saved', lastSavedAt);
			} else {
				// Llegaron cambios mientras se guardaba: el mes sigue sucio y se
				// vuelve a encolar. El indicador no debe decir «guardado».
				scheduleSave(mes);
			}
		} catch (e: any) {
			const msg = e?.message || 'Error al guardar';
			realtimeCollab.setSaveStatus('error');
			console.error(`[ocasional-canvas] flushSave ${mes}/${anio} error:`, e);
			toast.error(`${MESES[mes - 1]}: ${msg}`);
		} finally {
			savingMeses.delete(mes);
			isSaving = savingMeses.size > 0;
		}
	}

	async function flushTodo() {
		await Promise.all(Array.from(mesesSucios).map((mes) => flushSave(mes)));
	}

	/// `Ancla` (lo que viaja en el protocolo) → la forma que espera `filaDeAncla`.
	const aCelda = (a: { tipo: string; ref: string; offset: number; columna: number }) => ({
		ancla_tipo: a.tipo,
		ancla_ref: a.ref,
		offset_fila: a.offset,
		columna: a.columna
	});

	/**
	 * Valor a pintar en la hoja para una anotación remota.
	 *
	 * La capa viaja como TEXTO por el protocolo, pero hay celdas suyas que son
	 * numéricas y de las que cuelga una fórmula (el % de ADMON del canvas de
	 * ocasionales). Pintar «15.00%» como cadena ahí deja el cálculo en cero.
	 * Solo se convierte si la celda de destino YA era numérica: en una celda de
	 * texto, «15%» es lo que alguien quiso escribir.
	 */
	function valorDeAnotacion(valor: string | null, destino: ICellData | null): string | number {
		if (valor == null || valor === '') return '';
		// Solo se convierte sobre una celda que ya era numérica.
		if (destino?.t !== 2) return valor;
		return numeroDeCapa(valor) ?? valor;
	}

	/**
	 * Pinta una celda de la capa llegada de otro usuario.
	 *
	 * Se escribe directo en la hoja y NO se toca `mesesData`: la capa no es un
	 * campo de la liquidación, así que no debe ensuciar el estado que viaja al
	 * autoguardado ni marcar el mes como sucio.
	 */
	function pintarAnotacionRemota(
		mes: number,
		ancla: { ancla_tipo?: string; ancla_ref?: string; offset_fila: number; columna: number },
		valor: string | null
	) {
		const sheetId = ctx?.sheetIdPorMes?.[mes];
		if (!ctx || !sheetId) return;
		const fila = filaDeAncla(ctx.unitId, sheetId, ancla);
		// Sin fila: el item al que estaba atada ya no está en la hoja.
		if (fila == null || fila < 0) return;

		try {
			const wb = ctx.fUniver.getActiveWorkbook() as any;
			const hoja = wb?.getSheetBySheetId?.(sheetId);
			const rango = hoja?.getRange?.(fila, ancla.columna);
			if (!rango) return;
			// La guarda de eco: sin ella este `setValue` volvería a entrar por
			// el adapter como si fuera una edición local y se reemitiría.
			aplicandoRemoto = true;
			rango.setValue(valorDeAnotacion(valor, rango?.getCellData?.() ?? null));
		} catch (e) {
			console.warn('[ocasional-canvas] no se pudo pintar la anotación remota', e);
		} finally {
			aplicandoRemoto = false;
		}
	}

	/**
	 * Sesión de colaboración SOLO para la capa de anotaciones.
	 *
	 * El guardado de los campos de la liquidación sigue por el autoguardado de
	 * documento completo de esta page, que ya funciona y es por mes. Lo que
	 * necesitaba transporte por celda eran las notas, y `sheet-session` es
	 * exactamente eso: room propia, handlers propios y `dispose()` propio.
	 */
	function abrirSesion() {
		if (session || !$authStore.user) return;
		session = createSheetSession({
			scope: 'ocasional',
			anio,
			user: {
				id: $authStore.user.id,
				name: $authStore.user.nombre || $authStore.user.correo || 'Usuario'
			},
			onAck: ({ entity_id, version }) => {
				const p = parseIdAnotacion(entity_id);
				if (p) versionesAnot.set(mesActivo, entity_id, version);
			},
			onRemotePatch: (patch) => {
				if (patch.entity_type !== 'anotacion') return;
				const p = parseIdAnotacion(patch.entity_id);
				if (!p) return;
				versionesAnot.set(patch.mes, patch.entity_id, patch.version);
				pintarAnotacionRemota(patch.mes, aCelda(p.ancla), patch.value as string | null);
			},
			onPatchFallido: ({ entity_id, error }) => {
				if (!parseIdAnotacion(entity_id)) return;
				console.error('[ocasional-canvas] la capa rechazó un cambio', error);
				toast.error('No se pudo guardar esa celda: ' + (error || 'error del servidor'));
			},
			onConflict: ({ entity_id, server_row }) => {
				// El servidor manda: se repinta con su valor y se adopta su
				// versión, o el siguiente intento chocaría igual.
				const p = parseIdAnotacion(entity_id);
				if (!p || !server_row) return;
				versionesAnot.set(mesActivo, entity_id, server_row.version);
				pintarAnotacionRemota(mesActivo, aCelda(p.ancla), server_row.valor ?? null);
			}
		});
	}

	// ─── Carga ─────────────────────────────────────────────

	/**
	 * Conceptos de un mes con TODAS las filas que la hoja pinta garantizadas.
	 *
	 * Las dos tablas de descuentos se dibujan siempre completas, pero sus
	 * celdas solo son editables-y-persistentes si el concepto existe con un id:
	 * sin él no hay binding, y el adaptador descarta la edición en silencio.
	 * Por eso se siembran ANTES de que el builder vea los datos, tanto al
	 * cargar el año como al recargar un mes suelto.
	 */
	function conConceptosBase(conceptos: any[], mes: number, cfg: typeof configDescuentos) {
		const alcance = alcanceOcasional(anio, mes);
		return ensureGastosVehiculo(ensureCostosLaborales(conceptos, cfg, alcance), alcance);
	}

	async function loadInicial() {
		loading = true;
		loadError = '';
		try {
			// En paralelo: las anotaciones no dependen de la liquidación y no
			// deben añadir un salto de red al montaje.
			const [datos, anot, cfg] = await Promise.all([
				liquidacionesTercerosOcasionalAPI.obtenerAnual(anio),
				canvasAnotacionesAPI.listar('ocasional', anio).catch((e) => {
					// Que falle la capa no puede impedir abrir el canvas, pero SÍ hay
					// que decirlo: en silencio el usuario escribe, ve el texto y lo
					// pierde al recargar sin entender por qué.
					console.warn('[ocasional-canvas] capa de hoja no disponible', e);
					capaDisponible = false;
					toast.error(
						'La capa de hoja no está disponible: lo que escribas fuera de los ' +
							'campos de la liquidación no se guardará.',
						{ duration: 8000 }
					);
					return {} as AnotacionesPorMes;
				}),
				liquidacionesTercerosDescuentosAPI.obtenerConfiguracion().catch((e) => {
					// Sin config los conceptos laborales salen a 0%, como antes.
					console.warn('[ocasional-canvas] configuración de descuentos no disponible', e);
					return [] as ConfiguracionDescuento[];
				})
			]);
			configDescuentos = cfg;
			// El ocasional se genera con `conceptos: []`, así que sin esto la
			// tabla de descuentos por conductor salía entera a 0.00% y la de
			// gastos de vehículo sin binding: lo que se escribiera ahí no se
			// guardaba en ninguna parte.
			mesesData = datos.map((d) => ({
				...d,
				conceptos: conConceptosBase(d.conceptos ?? [], d.mes, cfg)
			}));
			anotaciones = anot;
			versionesAnot.limpiar();
			for (const [mes, porHoja] of Object.entries(anot)) {
				versionesAnot.hidratar(porHoja, Number(mes));
			}

			// Guarda contra doble join: `joinRoom` registra sus listeners sin
			// hacer `off` previo, así que llamarlo dos veces para el mismo año
			// duplicaría los handlers.
			if ($authStore.user && roomAnio !== anio) {
				const user = {
					id: $authStore.user.id,
					name: $authStore.user.nombre || $authStore.user.correo || 'Usuario'
				};
				realtimeCollab.initCollab(user);
				// Room por AÑO: la presencia es a nivel de libro.
				realtimeCollab.joinRoom('liquidacion-tercero-ocasional', String(anio), user);
				roomAnio = anio;
			}
			abrirSesion();

			await tick();
			if (!container) {
				loadError = 'Container no disponible';
				return;
			}
			syncUrl();
			await remountEngine();
		} catch (e: any) {
			loadError = e?.message || 'Error al cargar las liquidaciones del año';
		} finally {
			loading = false;
		}
	}

	async function recargarMes(mes: number) {
		try {
			const cab = await liquidacionesTercerosOcasionalAPI.obtenerPorPeriodo(mes, anio);
			setMesData(mes, {
				cabecera: cab,
				items: cab?.items ?? [],
				adicionales: cab?.adicionales ?? [],
				conceptos: conConceptosBase(cab?.conceptos ?? [], mes, configDescuentos)
			});
			marcarLimpio(mes);
			// La geometría de la hoja cambia (filas nuevas/borradas, o pasar de
			// placeholder a hoja real), así que no basta con repintar celdas.
			await remountEngine();
		} catch (e: any) {
			console.error(`[ocasional-canvas] recargarMes ${mes}`, e);
			toast.error(`No se pudo recargar ${MESES[mes - 1]}`);
		}
	}

	async function cambiarAnio(nuevo: number) {
		if (nuevo === anio) return;
		if (isDirty) {
			const meses = Array.from(mesesSucios)
				.sort((a, b) => a - b)
				.map((m) => MESES[m - 1])
				.join(', ');
			if (!confirm(`Hay cambios sin guardar en ${meses}. ¿Guardar y cambiar de año?`)) {
				return;
			}
			await flushTodo();
		}
		realtimeCollab.leaveRoom();
		// La sesión lleva el año en su room: cambiar de año exige una nueva.
		session?.dispose();
		session = null;
		roomAnio = null;
		anio = nuevo;
		await loadInicial();
	}

	function irAMes(mes: number) {
		if (mes === mesActivo) return;
		mesActivo = mes;
		ctx?.activarMes(mes);
		syncUrl();
	}

	/**
	 * Gancho previo a saltar a otro canvas del módulo: el autosave va con
	 * debounce de 800 ms, así que se fuerza el flush de los meses sucios antes
	 * de irse (navegación de cliente: `beforeunload` no se dispara).
	 */
	function antesDeSalir(): boolean {
		if (isDirty) flushTodo();
		realtimeCollab.leaveRoom();
		return true;
	}

	/// Vuelve al canvas de CIERRES, que es el nuevo índice del módulo, con el
	/// mismo periodo que se estaba viendo aquí: `/dashboard/liquidaciones-terceros`
	/// ya no tiene listado y su redirect aterrizaría en el mes en curso.
	function closeAndGo() {
		if (isDirty) flushTodo();
		realtimeCollab.leaveRoom();
		goto(`/dashboard/liquidaciones-terceros/canvas?anio=${anio}&mes=${mesActivo}`);
	}

	// ─── Acciones del header (antes vivían en páginas intermedias) ──────
	// Toda la gestión se centraliza aquí: generar borradores, cerrar y
	// distribuir, y ver el PDF. Ya no hay listados ni editores tabulares
	// de por medio.

	let historialAbierto = $state(false);
	let modalTercerosOpen = $state(false);
	let generando = $state(false);

	/// Genera el borrador del MES ACTIVO.
	///
	/// Con selección de terceros: el backend espera `terceros_filtro` como
	/// una lista plana que mezcla ids de tercero y placas (rescatado de la
	/// antigua `ocasional/+page.svelte`). Sin selección: genera el mes
	/// completo, como hacía `TabAdicionalesOcasional`.
	async function generarBorrador(seleccionados?: TerceroCandidato[]) {
		if (generando) return;
		generando = true;
		try {
			const tercerosFiltro = seleccionados?.length
				? seleccionados.flatMap((t) => [t.tercero_id, ...t.placas])
				: undefined;

			const r = await liquidacionesTercerosOcasionalAPI.generarBorrador({
				mes: mesActivo,
				anio,
				terceros_filtro: tercerosFiltro
			});

			if (!r.ok) {
				toast.error(r.message);
				return;
			}
			toast.success(r.message);
			// Recarga solo este mes: pasa de hoja placeholder a hoja real.
			await recargarMes(mesActivo);
		} catch (e: any) {
			toast.error(e?.message || 'Error al generar borrador');
		} finally {
			generando = false;
			modalTercerosOpen = false;
		}
	}

	// ─── Gastos de vehículo añadidos a mano ────────────────────────────
	// La tabla «GASTOS DE VEHÍCULO» de la hoja tiene cinco filas fijas dentro de
	// celdas combinadas. Un gasto puntual —unas llantas, su IVA, un anticipo de
	// taller— no cabe en ninguna, y la fila que inserta Univer con «insertar
	// fila» nace fuera de las combinaciones y sin binding: lo que se escriba ahí
	// se descarta en silencio. Por eso la fila se crea aquí, como un concepto
	// `GASTO_OPERATIVO` con id, y el builder la pinta con la misma estructura
	// que las fijas.

	let modalGastosOpen = $state(false);
	/// Bloquea el modal mientras se guarda: dos altas seguidas dentro del mismo
	/// ciclo trabajarían sobre el estado de antes y la segunda pisaría a la
	/// primera.
	let guardandoGasto = $state(false);

	/// Los del mes activo que NO son una de las cinco filas fijas.
	let gastosExtraMes = $derived(
		(datosMesActivo?.conceptos ?? []).filter(
			(c) => c.tipo === 'GASTO_OPERATIVO' && !GASTOS_VEHICULO.includes(c.concepto)
		)
	);

	/**
	 * Persiste el alta o la baja de un gasto y vuelve a leer el mes.
	 *
	 * El guardado es SÍNCRONO (no entra al debounce de 800 ms) y va seguido de
	 * `recargarMes`, que releva el mes del servidor y remonta la hoja. Las dos
	 * cosas son necesarias: la tabla cambia de tamaño —el pie de gastos, el
	 * TOTAL DESCUENTOS y el ancla de la zona libre se desplazan— y releer es lo
	 * que garantiza que la fila que se ve en pantalla existe de verdad en la
	 * base, en vez de ser un registro fantasma que desaparece al recargar.
	 */
	async function persistirGastos(conceptos: ConceptoOcasional[], exito: string) {
		setMesData(mesActivo, { conceptos });
		marcarSucio(mesActivo);
		const mes = mesActivo;
		try {
			await flushSave(mes);
			await recargarMes(mes);
			toast.success(exito);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo guardar el gasto');
		}
	}

	async function agregarGastoVehiculo(nuevo: {
		concepto: string;
		cantidad: number;
		valor_unitario: number;
		placa_aplicada: string | null;
		observaciones: string | null;
	}) {
		if (guardandoGasto) return;
		const datos = porMes.get(mesActivo);
		if (!datos?.cabecera) {
			toast.error('Este mes todavía no tiene borrador: genéralo antes de añadir gastos.');
			return;
		}
		guardandoGasto = true;
		try {
			// `orden` decide la posición de la fila en la hoja. Se cuelga del mayor
			// que haya para que las nuevas caigan siempre al final y no bailen
			// entre recargas.
			const orden =
				datos.conceptos
					.filter((c) => c.tipo === 'GASTO_OPERATIVO')
					.reduce((m, c) => Math.max(m, Number(c.orden) || 0), 0) + 1;

			const concepto: ConceptoOcasional = {
				id: crypto.randomUUID(),
				tipo: 'GASTO_OPERATIVO',
				concepto: nuevo.concepto,
				conductor_id: null,
				placa_aplicada: nuevo.placa_aplicada,
				dias: nuevo.cantidad,
				valor_unitario: nuevo.valor_unitario,
				porcentaje: null,
				valor_total: nuevo.cantidad * nuevo.valor_unitario,
				base_calculo: 0,
				calculado: false,
				observaciones: nuevo.observaciones,
				orden
			};
			await persistirGastos([...datos.conceptos, concepto], `«${nuevo.concepto}» agregado.`);
		} finally {
			guardandoGasto = false;
		}
	}

	async function eliminarGastoVehiculo(id: string) {
		if (guardandoGasto) return;
		const datos = porMes.get(mesActivo);
		if (!datos?.cabecera) return;
		guardandoGasto = true;
		try {
			// El borrado ES el guardado: el backend marca como eliminado todo
			// concepto que no venga en el payload.
			await persistirGastos(
				datos.conceptos.filter((c) => c.id !== id),
				'Gasto eliminado.'
			);
		} finally {
			guardandoGasto = false;
		}
	}

	let refrescando = $state(false);

	/**
	 * Trae al borrador los items que se volvieron elegibles DESPUÉS de
	 * generarlo: servicios liquidados más tarde en el mes, o placas que dejaron
	 * de tener cierre final.
	 *
	 * Es aditivo —no toca lo ya guardado—, pero antes se fuerza el guardado de
	 * lo pendiente: si el backend inserta filas mientras hay ediciones en el
	 * debounce, el siguiente autoguardado saldría sin ellas y el barrido de «lo
	 * que no viene en el payload se elimina» las borraría recién creadas.
	 */
	async function refrescarMes() {
		if (refrescando) return;
		refrescando = true;
		try {
			if (mesesSucios.has(mesActivo)) await flushSave(mesActivo);
			const r = await liquidacionesTercerosOcasionalAPI.refrescar(mesActivo, anio);
			if (!r.ok) {
				toast.error(r.message);
				return;
			}
			if ((r.agregados ?? 0) === 0) {
				toast.info(r.message);
				return;
			}
			toast.success(r.message);
			// Cambia la geometría de la hoja: hay que releer y remontar.
			await recargarMes(mesActivo);
		} catch (e: any) {
			toast.error(e?.message || 'Error al refrescar');
		} finally {
			refrescando = false;
		}
	}

	async function cerrarYDistribuir() {
		const cab = cabeceraActiva;
		if (!cab) return;
		if (!confirm(`¿Cerrar y distribuir ${cab.consecutivo}? Pasará a estado LIQUIDADA.`)) {
			return;
		}
		// Persistir antes de cerrar: si hay ediciones en el debounce, el
		// backend cerraría sobre datos viejos.
		if (mesesSucios.has(mesActivo)) await flushSave(mesActivo);
		try {
			const r = await liquidacionesTercerosOcasionalAPI.cerrarYDistribuir(cab.id);
			toast.success(r.message);
			await recargarMes(mesActivo);
		} catch (e: any) {
			if (e?.statusCode === 409 && Array.isArray(e.placas_faltantes)) {
				const lista = e.placas_faltantes.map((p: { placa: string }) => p.placa).join(', ');
				toast.error(
					`Placas sin cierre final: ${lista}. Créalos primero desde Liquidaciones de Terceros.`,
					{ duration: 8000 }
				);
			} else {
				toast.error(e?.message || 'Error al cerrar y distribuir');
			}
		}
	}

	/**
	 * Documento OFICIAL de la liquidación, en su propia ruta.
	 *
	 * Lo compone el servidor a partir de lo guardado (`obtenerPreviewData`),
	 * así que no refleja las ediciones que todavía estén en el debounce. Es
	 * el papel que se entrega; el preview del canvas —el de aquí al lado— es
	 * el que se usa para revisar lo que hay en pantalla ahora mismo.
	 */
	function verDocumentoOficial() {
		const cab = cabeceraActiva;
		if (!cab) return;
		goto(`/dashboard/liquidaciones-terceros/ocasional/${cab.id}?mode=view`);
	}

	/**
	 * Preview del documento del mes activo, con selector de columnas y
	 * exportación a PDF. Se compone SOLO mientras está abierto: es una copia
	 * entera del mes, y rehacerla en cada tecla no tendría sentido.
	 *
	 * Se monta encima del canvas para no desmontar el libro Univer ni la
	 * sesión colaborativa, que es lo que costaría navegar fuera.
	 */
	let previewAbierto = $state(false);
	let documentoPreview = $derived(
		previewAbierto
			? documentoOcasional({
					cabecera: cabeceraActiva,
					items: datosMesActivo?.items ?? [],
					adicionales: datosMesActivo?.adicionales ?? [],
					conceptos: datosMesActivo?.conceptos ?? [],
					mes: mesActivo,
					anio
				})
			: null
	);

	/**
	 * Exportación del LIBRO del año a un solo XLSX: una pestaña por mes.
	 *
	 * El preview es de UN mes —el documento de la liquidación ocasional se
	 * imprime y se archiva mes a mes—, pero el XLSX se abre para cuadrar el
	 * año, y ahí los doce meses tienen que venir en el mismo fichero.
	 *
	 * Se compone de `mesesData`, lo que hay EN MEMORIA: lo exportado es lo
	 * que se ve en el canvas ahora mismo, no lo que el servidor tenga
	 * guardado.
	 */
	let exportandoExcel = $state(false);

	async function exportarLibroExcel() {
		if (exportandoExcel) return;

		// Un mes sin borrador y sin filas no da pestaña: sería la cabecera y
		// nada más, y estorba al recorrer el libro buscando dónde hay datos.
		const hojas: HojaLibro[] = [];
		for (let m = 1; m <= 12; m++) {
			const d = porMes.get(m);
			if (!d) continue;
			if (!d.cabecera && !d.items.length && !d.adicionales.length) continue;
			hojas.push({
				nombre: MESES[m - 1],
				documento: documentoOcasional({
					cabecera: d.cabecera,
					items: d.items,
					adicionales: d.adicionales,
					conceptos: d.conceptos,
					mes: m,
					anio
				})
			});
		}

		if (hojas.length === 0) {
			toast.error(`${anio} no tiene liquidaciones ocasionales en ningún mes.`);
			return;
		}

		exportandoExcel = true;
		const aviso = toast.loading(`Generando el Excel de ${hojas.length} mes(es)…`);
		try {
			await exportarExcelLibro('ocasional', hojas, `liquidacion_ocasional_${anio}`);
			toast.success(`Excel de ${anio} generado con ${hojas.length} hoja(s).`, { id: aviso });
		} catch (e: any) {
			console.error('[ocasional-canvas] export XLSX', e);
			toast.error('No se pudo generar el Excel', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoExcel = false;
		}
	}

	/**
	 * Un PDF por mes, todos en un ZIP.
	 *
	 * La liquidación ocasional se archiva y se entrega mes a mes, así que el
	 * lote son doce PDF y no uno solo que habría que partir. Es el mismo
	 * papel del preview, hoja por hoja; ver `exportar-zip.ts`.
	 */
	let exportandoZip = $state(false);

	async function exportarZipPdf() {
		if (exportandoZip) return;

		const hojas: HojaPdf[] = [];
		for (let m = 1; m <= 12; m++) {
			const d = porMes.get(m);
			if (!d) continue;
			// Un mes sin borrador y sin filas no da PDF.
			if (!d.cabecera && !d.items.length && !d.adicionales.length) continue;
			hojas.push({
				nombreArchivo: `${d.cabecera?.consecutivo || 'ocasional'} ${MESES[m - 1]} ${anio}`,
				documento: documentoOcasional({
					cabecera: d.cabecera,
					items: d.items,
					adicionales: d.adicionales,
					conceptos: d.conceptos,
					mes: m,
					anio
				})
			});
		}

		if (hojas.length === 0) {
			toast.error(`${anio} no tiene liquidaciones ocasionales en ningún mes.`);
			return;
		}

		exportandoZip = true;
		const aviso = toast.loading(`Generando 0 de ${hojas.length} PDF…`);
		try {
			const { generados, fallidas } = await exportarZipPdfs(
				'ocasional',
				hojas,
				`liquidacion_ocasional_${anio}`,
				{
					onProgreso: (hechas, total) =>
						toast.loading(`Generando ${hechas} de ${total} PDF…`, { id: aviso })
				}
			);
			toast.success(`ZIP con ${generados} PDF de ${anio}.`, {
				id: aviso,
				description: fallidas.length
					? `${fallidas.length} no se pudo(ieron) renderizar.`
					: undefined
			});
		} catch (e: any) {
			console.error('[ocasional-canvas] export ZIP', e);
			toast.error('No se pudo generar el ZIP', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoZip = false;
		}
	}

	onMount(() => {
		if (!browser) return;
		connectSocket();
		loadInicial();

		/// Cambios remotos: solo se recarga el MES afectado.
		const handler = (e: any) => {
			const d = e?.detail;
			if (!d?.id) return;
			// Ignorar el eco propio.
			if (d.updatedById && d.updatedById === $authStore.user?.id) return;
			const entry = mesesData.find((m) => m.cabecera?.id === d.id);
			if (!entry) return;
			console.log('[ocasional-canvas] remote update', d);
			recargarMes(entry.mes);
		};
		window.addEventListener('collab:remote-update', handler as any);

		/**
		 * Aviso al recargar o cerrar con cambios sin confirmar.
		 *
		 * El guardado de una hoja llena tarda varios segundos, y hasta que el
		 * servidor responde lo escrito solo existe en esta pestaña. Recargar en
		 * esa ventana lo pierde sin dejar rastro. Se intenta además un último
		 * flush: en muchos navegadores da tiempo a que salga la petición
		 * mientras el usuario decide en el diálogo.
		 */
		const avisarSiPendiente = (e: BeforeUnloadEvent) => {
			if (!isDirty && !isSaving) return;
			flushTodo();
			e.preventDefault();
			// Los navegadores modernos ignoran el texto y muestran el suyo, pero
			// `returnValue` sigue siendo lo que dispara el diálogo.
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', avisarSiPendiente);

		return () => {
			window.removeEventListener('collab:remote-update', handler as any);
			window.removeEventListener('beforeunload', avisarSiPendiente);
		};
	});

	onDestroy(() => {
		session?.dispose();
		session = null;
		for (const t of saveTimers.values()) clearTimeout(t);
		saveTimers.clear();
		teardownEngine();
		realtimeCollab.leaveRoom();
	});
</script>

<svelte:head>
	<title>Liquidaciones ocasionales {anio} (canvas) · Cotransmeq</title>
</svelte:head>

<UniverToolbar
	title="LIQUIDACIONES OCASIONALES: {periodDisplay}"
	subtitle={cabeceraActiva
		? `${cabeceraActiva.consecutivo}  ·  ${cabeceraActiva.estado}  ·  Total a pagar $${formatCOP(totalPagarMes)}  ·  ${mesesConBorrador}/12 meses  ·  Σ año $${formatCOP(totalPagarAnual)}`
		: `Sin borrador para ${periodDisplay}  ·  ${mesesConBorrador}/12 meses con borrador`}
	onBack={closeAndGo}
	backLabel="Volver"
>
	{#snippet actions()}
		<label class="univer-year-picker">
			<span>Año</span>
			<select
				value={anio}
				onchange={(e) => cambiarAnio(Number((e.currentTarget as HTMLSelectElement).value))}
			>
				{#each anios as a (a)}
					<option value={a}>{a}</option>
				{/each}
			</select>
		</label>

		<select
			class="univer-month-picker"
			value={mesActivo}
			onchange={(e) => irAMes(Number((e.currentTarget as HTMLSelectElement).value))}
			title="Ir al mes"
		>
			{#each MESES as nombre, i (nombre)}
				<option value={i + 1}>
					{nombre}{porMes.get(i + 1)?.cabecera ? '' : ' (vacío)'}{mesesSucios.has(i + 1)
						? ' •'
						: ''}
				</option>
			{/each}
		</select>

		{#if !cabeceraActiva}
			<button
				class="univer-btn univer-btn-green"
				onclick={() => generarBorrador()}
				disabled={generando}
				title="Generar el borrador de {periodDisplay} con todos los terceros del mes"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				{generando ? 'Generando…' : 'Generar borrador'}
			</button>
			<button
				class="univer-btn univer-btn-dark"
				onclick={() => (modalTercerosOpen = true)}
				disabled={generando}
				title="Elegir qué terceros incluir en el borrador"
			>
				Elegir terceros…
			</button>
		{:else}
			<button
				class="univer-btn univer-btn-dark"
				onclick={refrescarMes}
				disabled={refrescando}
				title="Buscar items del mes que aún no están en el borrador (solo placas sin cierre final)"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
				</svg>
				{refrescando ? 'Buscando…' : 'Refrescar'}
			</button>
			<button
				class="univer-btn univer-btn-dark"
				onclick={() => (modalGastosOpen = true)}
				title="Añadir una fila a la tabla de gastos de vehículo de {periodDisplay}"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				Gasto de vehículo{gastosExtraMes.length ? ` (${gastosExtraMes.length})` : ''}
			</button>
			<button
				class="univer-btn univer-btn-dark"
				onclick={() => (historialAbierto = true)}
				title="Ver y restaurar versiones de {periodDisplay}"
			>
				Historial
			</button>
			<button
				class="univer-btn univer-btn-dark"
				onclick={() => (previewAbierto = true)}
				title="Ver el documento de {periodDisplay} con lo que hay en pantalla y exportarlo a PDF"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
					/>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
					/>
				</svg>
				Vista previa
			</button>
			<button
				class="univer-btn univer-btn-dark"
				onclick={verDocumentoOficial}
				title="Abrir el documento guardado en el servidor para {periodDisplay}"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
				Documento oficial
			</button>
			{#if cabeceraActiva.estado === 'BORRADOR'}
				<button
					class="univer-btn univer-btn-green"
					onclick={cerrarYDistribuir}
					title="Cerrar y distribuir {cabeceraActiva.consecutivo}"
				>
					Cerrar y distribuir
				</button>
			{/if}
		{/if}

		<button
			class="univer-btn univer-btn-dark"
			onclick={exportarZipPdf}
			disabled={exportandoZip}
			title="Descargar un ZIP con un PDF por mes de {anio}"
		>
			<svg
				width="14"
				height="14"
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
			{exportandoZip ? 'Generando…' : 'Exportar PDF (ZIP)'}
		</button>

		<button
			class="univer-btn univer-btn-dark"
			onclick={exportarLibroExcel}
			disabled={exportandoExcel}
			title="Descargar un .xlsx de {anio} con TODAS las hojas del año: una pestaña por mes"
		>
			<svg
				width="14"
				height="14"
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
			{exportandoExcel ? 'Generando…' : 'Exportar Excel'}
		</button>

		<PresenceAvatars />
		<AutosaveIndicator />

		<!-- Sustituye al botón «Volver» que había aquí: `onBack` del toolbar ya
		     pone uno a la izquierda, así que el duplicado solo gastaba espacio
		     en una fila que se recorta en silencio al desbordar. -->
		<SelectorCanvasTerceros actual="ocasional" {anio} mes={mesActivo} onSalir={antesDeSalir} />
	{/snippet}
</UniverToolbar>

<!-- Selección de terceros para el borrador del mes activo. Se monta solo
     cuando está abierto: el componente dispara `loadTerceros()` de forma
     reactiva en cuanto ve `isOpen && mes && anio`. -->
<SnapshotPanel
	open={historialAbierto}
	scope="ocasional"
	{anio}
	mes={mesActivo}
	cabeceraId={cabeceraActiva?.id ?? null}
	onClose={() => (historialAbierto = false)}
	onReverted={(m) => recargarMes(m)}
/>

<ModalGastosVehiculo
	open={modalGastosOpen}
	mes={mesActivo}
	{anio}
	gastos={gastosExtraMes}
	guardando={guardandoGasto}
	onAgregar={agregarGastoVehiculo}
	onEliminar={eliminarGastoVehiculo}
	onClose={() => (modalGastosOpen = false)}
/>

{#if modalTercerosOpen}
	<ModalSelectTercerosOcasionales
		isOpen={modalTercerosOpen}
		mes={mesActivo}
		{anio}
		onClose={() => (modalTercerosOpen = false)}
		onConfirm={(seleccionados) => generarBorrador(seleccionados)}
	/>
{/if}

<UniverCanvasHost
	bind:container
	{loading}
	error={loadError}
	loadingLabel="Cargando liquidaciones ocasionales de {anio}..."
	onRetry={loadInicial}
	errorLabel="Reintentar"
/>

{#if previewAbierto && documentoPreview}
	<PreviewCanvasModal
		scope="ocasional"
		documento={documentoPreview}
		subtitulo="{periodDisplay}  ·  {cabeceraActiva?.consecutivo ??
			'sin borrador'}  ·  Total a pagar ${formatCOP(totalPagarMes)}"
		onClose={() => (previewAbierto = false)}
	/>
{/if}

<style>
	/* Los selectores de periodo (.univer-year-picker / .univer-month-picker)
	   viven ahora en `toolbar.css`, compartidos por todos los canvas. Estaban
	   copiados aquí y en el canvas de al lado. */
</style>
