<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		liquidacionesTercerosAdicionalesAPI,
		type AdicionalListado
	} from '$lib/api/liquidaciones-terceros-adicionales';
	import {
		createAdicionalesEngine,
		disposeEngine,
		type AdicionalesEngineContext
	} from '$lib/editor/univer/adicionales-engine';
	import { installAdicionalesCellPermission } from '$lib/editor/univer/cell-permission-adicionales';
	import { attachAdicionalesCellChangeAdapter } from '$lib/editor/univer/adapters/cell-change-adicionales';
	import { canvasAnotacionesAPI, type AnotacionesPorMes } from '$lib/api/canvas-anotaciones';
	import {
		VersionesAnotaciones,
		emitirAnotacion,
		parseIdAnotacion
	} from '$lib/editor/canvas/anotaciones';
	import type { ICellData } from '@univerjs/core';
	import { filaDeAncla, numeroDeCapa } from '$lib/editor/business/zona-libre';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConfiguracionDescuento
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import { DIAS_POR_DEFECTO } from '$lib/editor/business/costos-laborales';
	import {
		clearAdicionalesBindings,
		getAdicionalesCellFor
	} from '$lib/editor/business/adicionales-cell-binding';
	import {
		isApplyingRemote,
		suprimirEco,
		aplicarCeldaRemota
	} from '$lib/editor/univer/apply-remote-patch';
	import {
		createSheetSession,
		type SheetSession,
		type SheetPatchApplied
	} from '$lib/editor/canvas/sheet-session.svelte';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import SelectorCanvasTerceros from '$lib/components/univer/SelectorCanvasTerceros.svelte';
	import PreviewCanvasModal from '$lib/components/liquidaciones-terceros/preview/PreviewCanvasModal.svelte';
	import { documentoAdicionales } from '$lib/components/liquidaciones-terceros/preview/datos/adicionales.doc';
	import {
		exportarExcelLibro,
		type HojaLibro
	} from '$lib/components/liquidaciones-terceros/preview/exportar-excel';
	import {
		exportarZipPdfs,
		type HojaPdf
	} from '$lib/components/liquidaciones-terceros/preview/exportar-zip';
	import * as realtimeCollab from '$lib/stores/realtimeCollab';
	import { connectSocket } from '$lib/socketClient';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import SnapshotPanel from '$lib/components/univer/SnapshotPanel.svelte';

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
	// `anio` es el eje del WORKBOOK: cambiarlo implica un unitId distinto y
	// por tanto teardown + remount. `mesActivo` es solo la hoja activa, así
	// que cambiarlo NO remonta nada.
	let anio = $state(Number($page.url.searchParams.get('anio')) || new Date().getFullYear());
	let mesActivo = $state(mesValido(Number($page.url.searchParams.get('mes'))));

	let loading = $state(true);
	let loadError = $state('');
	let container: HTMLDivElement | null = $state(null);
	let ctx: AdicionalesEngineContext | null = null;
	let canvasDisposers: Array<() => void> = [];

	/// Items por mes (claves 1..12). Cada hoja tiene su propio arreglo y su
	/// propio ciclo de autoguardado.
	let itemsPorMes = $state<Record<number, AdicionalListado[]>>({});

	let itemsMesActivo = $derived(itemsPorMes[mesActivo] ?? []);
	let periodDisplay = $derived(`${MESES[mesActivo - 1] || ''} ${anio}`);
	let cierresCount = $derived(new Set(itemsMesActivo.map((i) => i.cierre_id)).size);
	let totalLiq = $derived(itemsMesActivo.reduce((s, it) => s + (it.valor_liquidar || 0), 0));
	let totalFacturado = $derived(
		itemsMesActivo.reduce((s, it) => s + (it.valor_unitario || 0) * (it.cantidad || 0), 0)
	);
	let totalAnual = $derived(
		Object.values(itemsPorMes)
			.flat()
			.reduce((s, it) => s + (it.valor_liquidar || 0), 0)
	);

	let anios = $derived.by(() => {
		const actual = new Date().getFullYear();
		const out: number[] = [];
		for (let a = actual - 3; a <= actual + 1; a++) out.push(a);
		if (!out.includes(anio)) out.unshift(anio);
		return out;
	});

	// ─── State del autosave ────────────────────────────────
	// `realtimeCollab.setSaveStatus` se sigue usando SOLO para alimentar a
	// `AutosaveIndicator`, que lee estado de módulo. El resto del singleton
	// (colas, rooms, drafts) ya no interviene aquí: la persistencia va por
	// `SheetSession` con patches por celda.
	let lastSavedAt: string | null = $state(null);
	/// Meses con cambios sin persistir.
	let mesesSucios = $state<Set<number>>(new Set());
	let isDirty = $derived(mesesSucios.size > 0);

	/**
	 * Token de montaje. `mountEngineNow` es async (fetch anual + tick), así
	 * que cambiar de año dos veces seguidas puede solapar un mount con un
	 * teardown en curso y dejar el canvas atado a un engine ya destruido.
	 * Cada montaje incrementa el token y aborta si al volver de un `await`
	 * el token ya no es el suyo.
	 */
	let mountToken = 0;

	/// Sesión colaborativa del LIBRO. Instanciable (una por año), a diferencia
	/// de `realtimeCollab`, que es un singleton de una sola room.
	let historialAbierto = $state(false);
	let session: SheetSession | null = null;

	/**
	 * Preview del documento del mes activo, con exportación a PDF.
	 *
	 * Se compone SOLO mientras está abierto: es una copia entera del mes en
	 * estructuras de presentación, y mantenerla viva mientras el usuario
	 * edita significaría rehacerla en cada tecla.
	 *
	 * Se monta encima del canvas y no en una ruta aparte porque salir de
	 * aquí desmontaría el libro Univer y la sesión colaborativa, y volver
	 * costaría una recarga completa del año.
	 */
	let previewAbierto = $state(false);
	let documentoPreview = $derived(
		previewAbierto
			? documentoAdicionales({
					items: itemsMesActivo,
					mes: mesActivo,
					anio,
					totalAnual
				})
			: null
	);
	/**
	 * Exportación del LIBRO del año a un solo XLSX: una pestaña por mes.
	 *
	 * El preview es de UN mes porque el documento se imprime y se archiva
	 * mes a mes. El XLSX no: se abre para cuadrar el año, y para eso los
	 * doce meses tienen que estar en el mismo fichero.
	 *
	 * Se compone de `itemsPorMes`, que es lo que hay EN MEMORIA: lo
	 * exportado es lo que se ve en el canvas ahora mismo, no lo guardado.
	 */
	let exportandoExcel = $state(false);

	async function exportarLibroExcel() {
		if (exportandoExcel) return;

		// Los meses vacíos NO entran: una pestaña con la cabecera y «Sin
		// filas.» solo estorba al pasar por las doce buscando dónde hay algo.
		const hojas: HojaLibro[] = [];
		for (let m = 1; m <= 12; m++) {
			const items = itemsPorMes[m] ?? [];
			if (!items.length) continue;
			hojas.push({
				nombre: MESES[m - 1],
				documento: documentoAdicionales({ items, mes: m, anio, totalAnual })
			});
		}

		if (hojas.length === 0) {
			toast.error(`${anio} no tiene adicionales en ningún mes.`);
			return;
		}

		exportandoExcel = true;
		const aviso = toast.loading(`Generando el Excel de ${hojas.length} mes(es)…`);
		try {
			await exportarExcelLibro('adicionales', hojas, `adicionales_cierres_${anio}`);
			toast.success(`Excel de ${anio} generado con ${hojas.length} hoja(s).`, { id: aviso });
		} catch (e: any) {
			console.error('[adicionales-canvas] export XLSX', e);
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
	 * El documento de adicionales se archiva mes a mes, así que el lote son
	 * doce PDF y no uno de doce bloques: quien lo recibe quiere el de su mes.
	 * Es el mismo papel del preview, hoja por hoja; ver `exportar-zip.ts`.
	 */
	let exportandoZip = $state(false);

	async function exportarZipPdf() {
		if (exportandoZip) return;

		const hojas: HojaPdf[] = [];
		for (let m = 1; m <= 12; m++) {
			const items = itemsPorMes[m] ?? [];
			// Los meses vacíos no dan PDF: sería una hoja con la cabecera y
			// «Sin filas.», y ensucia la carpeta al descomprimir.
			if (!items.length) continue;
			hojas.push({
				nombreArchivo: `adicionales ${MESES[m - 1]} ${anio}`,
				documento: documentoAdicionales({ items, mes: m, anio, totalAnual })
			});
		}

		if (hojas.length === 0) {
			toast.error(`${anio} no tiene adicionales en ningún mes.`);
			return;
		}

		exportandoZip = true;
		const aviso = toast.loading(`Generando 0 de ${hojas.length} PDF…`);
		try {
			const { generados, fallidas } = await exportarZipPdfs(
				'adicionales',
				hojas,
				`adicionales_cierres_${anio}`,
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
			console.error('[adicionales-canvas] export ZIP', e);
			toast.error('No se pudo generar el ZIP', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoZip = false;
		}
	}

	let presence = $state<Array<{ id: string; name: string; mes: number | null }>>([]);

	// ─── Sincronización de la URL ──────────────────────────
	/// `replaceState` y no `goto`: un `goto` reejecutaría el load de la ruta
	/// y, en el peor caso, remontaría el canvas al cambiar de pestaña.
	function syncUrl() {
		if (!browser) return;
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(anio));
		url.searchParams.set('mes', String(mesActivo));
		window.history.replaceState({}, '', url);
	}

	// ─── Montaje / teardown ────────────────────────────────
	async function mountEngineNow() {
		if (!container) return;
		const token = mountToken;
		try {
			const newCtx = createAdicionalesEngine({
				anotaciones,
				porcentajesLaborales,
				diasLaborales: DIAS_POR_DEFECTO,
				container,
				anio,
				itemsPorMes,
				mesActivo
			});
			if (token !== mountToken) {
				// Otro montaje ganó la carrera mientras construíamos: descartar
				// este engine para no dejar un Univer huérfano con su Worker.
				disposeEngine(newCtx.univer, newCtx.fUniver, newCtx.unitId, container);
				return;
			}
			ctx = newCtx;

			canvasDisposers.push(installAdicionalesCellPermission(newCtx.univer));

			const commandService = (newCtx.univer as any)
				.__getInjector()
				.get((await import('@univerjs/core')).ICommandService);
			if (token !== mountToken) return;

			canvasDisposers.push(
				attachAdicionalesCellChangeAdapter({
					unitId: newCtx.unitId,
					commandService,
					getWorkbook: () => newCtx.fUniver.getActiveWorkbook() as any,
					resolveMes: newCtx.resolveMes,
					getItems: (mes) => itemsPorMes[mes] ?? [],
					// Celda de la ZONA LIBRE: no es un campo del adicional, así
					// que va a la capa de anotaciones y no al modelo.
					onAnotacion: ({ mes, ancla, valor }) => {
						emitirAnotacion({
							session,
							versiones: versionesAnot,
							mes,
							sheetKey: '',
							ancla,
							valor
						});
					},
					setItems: (mes, next) => {
						// Reasignación completa: Svelte 5 necesita ver un objeto
						// nuevo para reevaluar los `$derived`.
						itemsPorMes = { ...itemsPorMes, [mes]: next };
					},
					// Persistencia colaborativa: un patch por celda, con la
					// versión base. El servidor hace compare-and-swap, calcula
					// las columnas derivadas y difunde al resto del room
					// excluyendo al emisor.
					onFieldChange: (mes, cambios) => {
						marcarSucio(mes);
						for (const c of cambios) {
							session?.enviarPatch({
								mes,
								entity_type: 'adicional',
								entity_id: c.entityId,
								field: c.field,
								value: c.value,
								base_version: c.baseVersion
							});
						}
					},
					isApplyingRemote,
					onActiveSheetChange: (mes) => {
						if (mes === mesActivo) return;
						mesActivo = mes;
						session?.setHojaActiva(mes);
						syncUrl();
					}
				})
			);
		} catch (e: any) {
			console.error('[adicionales-canvas] mount error', e);
			toast.error('Error al renderizar el canvas: ' + (e?.message || ''));
		}
	}

	/// Teardown completo: disposers del cell-permission y del adapter,
	/// `disposeEngine` (que además termina el Worker de fórmulas) y limpieza
	/// del registry de bindings del workbook actual.
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
			clearAdicionalesBindings(ctx.unitId);
		}
		ctx = null;
	}

	/// Remount completo. Solo se dispara cuando cambia el AÑO o cuando el
	/// snapshot de datos cambia por debajo (carga inicial, update remoto).
	/// Editar celdas NO remonta: las columnas derivadas son fórmulas vivas.
	async function remountEngine() {
		if (!container) return;
		mountToken++;
		teardownEngine();
		await tick();
		await mountEngineNow();
	}

	// ─── Persistencia colaborativa ─────────────────────────
	//
	// Ya NO hay debounce ni guardado del mes completo. Cada edición viaja
	// como un patch de UNA celda con su `base_version`; el servidor hace
	// compare-and-swap, recalcula las columnas derivadas y difunde al resto
	// del room. El guardado del mes entero era lo que hacía que dos usuarios
	// en la misma hoja se pisaran el trabajo.
	//
	// `mesesSucios` pasa a ser solo indicación visual: se marca al emitir y
	// se limpia con el `ack`.

	function marcarSucio(mes: number) {
		if (mesesSucios.has(mes)) return;
		const next = new Set(mesesSucios);
		next.add(mes);
		mesesSucios = next;
		realtimeCollab.setSaveStatus('saving');
	}

	function marcarLimpio(mes: number) {
		if (!mesesSucios.has(mes)) return;
		const next = new Set(mesesSucios);
		next.delete(mes);
		mesesSucios = next;
		if (next.size === 0) {
			lastSavedAt = new Date().toISOString();
			realtimeCollab.setSaveStatus('saved', lastSavedAt);
		}
	}

	/// Aplica en el modelo JS la fila que devuelve el servidor. El servidor es
	/// la fuente de verdad de `valor_admin`, `valor_liquidar` y `version`.
	function fusionarFila(mes: number, row: any) {
		if (!row?.id) return;
		const actuales = itemsPorMes[mes] ?? [];
		const idx = actuales.findIndex((a) => a.id === row.id);
		if (idx < 0) return;
		const next = [...actuales];
		next[idx] = { ...next[idx], ...row };
		itemsPorMes = { ...itemsPorMes, [mes]: next };
	}

	/// Pinta un cambio de otro usuario SIN remontar el engine.
	function aplicarPatchRemoto(p: SheetPatchApplied) {
		if (!ctx) return;
		fusionarFila(p.mes, p.row);

		const celda = getAdicionalesCellFor(ctx.unitId, p.entity_id, p.field);
		// Sin celda mapeada = columna derivada (ADMON/TOTAL/V-LIQUIDAR). No se
		// pinta: son fórmulas vivas y el formula engine las recalcula solo en
		// cuanto cambia la celda de la que dependen.
		if (!celda) return;

		aplicarCeldaRemota(ctx, celda, p.value);
	}

	/// Capa de ANOTACIONES: celdas libres bajo el bloque estructurado.
	let anotaciones = $state<AnotacionesPorMes>({});
	const versionesAnot = new VersionesAnotaciones();

	/// Porcentajes de prestaciones y seguridad social. Misma configuración que
	/// usa el canvas de cierres: única fuente de verdad.
	let porcentajesLaborales = $state<Record<string, number>>({});

	/// Pinta una anotación en su hoja. No toca `itemsPorMes`: una nota no es
	/// un campo de la liquidación y no debe ensuciar el modelo.
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
	 * La capa viaja como texto por el protocolo, pero hay celdas suyas de las que
	 * cuelga una fórmula (el % de ADMON del canvas de ocasionales). Si «12» se
	 * pinta como cadena, la fórmula que la multiplica devuelve 0. Lo que parece un
	 * número se devuelve como número.
	 */
	function valorDeAnotacion(valor: string | null, destino: ICellData | null): string | number {
		if (valor == null || valor === '') return '';
		// Solo se convierte sobre una celda que ya era numérica.
		if (destino?.t !== 2) return valor;
		return numeroDeCapa(valor) ?? valor;
	}

	function pintarAnotacion(
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
			const rango = wb?.getSheetBySheetId?.(sheetId)?.getRange?.(fila, ancla.columna);
			// Bajo guarda de eco: `setValue` emite `set-range-values`, el adapter
			// lo lee como edición propia y lo reemite. Ver el mismo comentario en
			// el canvas de cierres.
			suprimirEco(() => rango?.setValue(valorDeAnotacion(valor, rango?.getCellData?.() ?? null)));
		} catch (e) {
			console.warn('[adicionales-canvas] no se pudo pintar la anotación', e);
		}
	}

	// ─── Sesión colaborativa ───────────────────────────────
	/// Abre (o reabre) la sesión del libro del año actual. Idempotente: si ya
	/// hay una, se cierra antes — así los handlers nunca se duplican.
	function abrirSesion() {
		if (!$authStore.user) return;
		session?.dispose();
		session = createSheetSession({
			scope: 'adicionales',
			anio,
			user: {
				id: $authStore.user.id,
				name: $authStore.user.nombre || $authStore.user.correo || 'Usuario'
			},
			onPresence: (users) => {
				presence = users;
			},
			onRemotePatch: (p) => {
				// Las anotaciones no son filas del modelo: se pintan y se sale.
				if (p.entity_type === 'anotacion') {
					const a = parseIdAnotacion(p.entity_id);
					if (!a) return;
					versionesAnot.set(p.mes, p.entity_id, p.version);
					pintarAnotacion(p.mes, aCelda(a.ancla), p.value as string | null);
					return;
				}
				aplicarPatchRemoto(p);
			},
			onAck: ({ entity_id, row, version }) => {
				// Anotación confirmada: solo hay que adoptar la versión nueva.
				if (parseIdAnotacion(entity_id) && version != null && !row?.cierre_id) {
					versionesAnot.set(mesActivo, entity_id, version);
					return;
				}
				// Fusionar la fila del servidor es OBLIGATORIO, no cosmético: trae
				// la `version` nueva. Sin ella, el siguiente patch de esa misma
				// fila saldría con una `base_version` obsoleta y el servidor lo
				// rechazaría por conflicto contra el propio usuario.
				const mes = row?.cierre_id ? mesDeCierre(row.cierre_id) : null;
				if (mes) {
					fusionarFila(mes, row);
					marcarLimpio(mes);
				}
			},
			onInvalidate: ({ mes }) => {
				// Alta/baja de filas o guardado en lote: cambia la geometría, así
				// que hay que releer y reconstruir esa hoja.
				recargarMes(mes);
			},
			onConflict: (c) => {
				// El servidor manda también en las notas: se repinta con su
				// valor y se adopta su versión.
				const anot = parseIdAnotacion(c.entity_id);
				if (anot && c.server_row && 'valor' in (c.server_row as any)) {
					versionesAnot.set(mesActivo, c.entity_id, (c.server_row as any).version);
					pintarAnotacion(mesActivo, aCelda(anot.ancla), (c.server_row as any).valor ?? null);
					return;
				}
				// Otro usuario ganó la carrera. Repintamos con SU valor: perder
				// la tecleada de uno es preferible a que los dos vean cosas
				// distintas. Sin esto, el cliente perdedor se quedaría mostrando
				// un valor que el servidor rechazó.
				if (c.server_row) {
					const mes = mesDeCierre(c.server_row.cierre_id) ?? mesActivo;
					fusionarFila(mes, c.server_row);
					if (ctx) {
						const celda = getAdicionalesCellFor(ctx.unitId, c.entity_id, c.field);
						if (celda) {
							aplicarCeldaRemota(ctx, celda, (c.server_row as any)[c.field]);
						}
					}
				}
				toast.warning(
					c.reason === 'epoch'
						? 'La hoja fue restaurada mientras editabas. Se recargó el valor del servidor.'
						: 'Otro usuario editó esa celda antes que tú. Se aplicó su valor.'
				);
				realtimeCollab.setSaveStatus('saved', new Date().toISOString());
			},
			onReverted: ({ mes }) => {
				// Una reversión cambia la geometría de la hoja: no basta con
				// repintar celdas.
				toast.info(`${MESES[mes - 1]} fue restaurado a una versión anterior.`);
				recargarMes(mes);
			}
		});
		session.setHojaActiva(mesActivo);
	}

	/// A qué mes pertenece un cierre, según lo que ya tenemos cargado.
	function mesDeCierre(cierreId: string): number | null {
		for (let m = 1; m <= 12; m++) {
			if ((itemsPorMes[m] ?? []).some((a) => a.cierre_id === cierreId)) return m;
		}
		return null;
	}

	// ─── Carga ─────────────────────────────────────────────
	async function loadInicial() {
		loading = true;
		loadError = '';
		try {
			// En paralelo: las anotaciones no dependen de los adicionales.
			const [items, anot, cfg] = await Promise.all([
				liquidacionesTercerosAdicionalesAPI.obtenerAnual(anio),
				canvasAnotacionesAPI.listar('adicionales', anio).catch((e) => {
					// Que falle la capa de notas no puede impedir abrir el canvas.
					console.warn('[adicionales-canvas] anotaciones no disponibles', e);
					return {} as AnotacionesPorMes;
				}),
				liquidacionesTercerosDescuentosAPI.obtenerConfiguracion().catch((e) => {
					// Sin config las filas de nómina salen a 0.0%, como antes.
					console.warn('[adicionales-canvas] configuración de descuentos no disponible', e);
					return [] as ConfiguracionDescuento[];
				})
			]);
			porcentajesLaborales = Object.fromEntries(
				(cfg ?? [])
					.filter(
						(c) =>
							c.activo !== false &&
							(c.categoria === 'PRESTACION_SOCIAL' || c.categoria === 'SEGURIDAD_SOCIAL')
					)
					.map((c) => [c.concepto, Number(c.porcentaje) || 0])
			);
			itemsPorMes = items;
			anotaciones = anot;
			versionesAnot.limpiar();
			for (const [m, porHoja] of Object.entries(anot)) {
				versionesAnot.hidratar(porHoja, Number(m));
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
			loadError = e?.message || 'Error al cargar los adicionales del año';
		} finally {
			loading = false;
		}
	}

	/// Relee UN mes del servidor y reconstruye el libro.
	///
	/// Hace falta el remount porque la geometría de la hoja puede cambiar
	/// (filas nuevas o borradas); repintar celdas sueltas no bastaría.
	async function recargarMes(mes: number) {
		try {
			const frescos = await liquidacionesTercerosAdicionalesAPI.obtenerPorPeriodo(mes, anio);
			itemsPorMes = { ...itemsPorMes, [mes]: frescos };
			marcarLimpio(mes);
			await remountEngine();
		} catch (e: any) {
			console.error(`[adicionales-canvas] recargarMes ${mes}/${anio}`, e);
			toast.error(`No se pudo recargar ${MESES[mes - 1]}`);
		}
	}

	async function cambiarAnio(nuevo: number) {
		if (nuevo === anio) return;
		// Ya no hay debounce que vaciar: cada edición se emitió al servidor en
		// el momento. `mesesSucios` solo refleja patches sin ACK todavía.
		if (
			isDirty &&
			!confirm('Hay cambios sin confirmar por el servidor. ¿Cambiar de año igualmente?')
		) {
			return;
		}
		session?.dispose();
		session = null;
		anio = nuevo;
		await loadInicial();
	}

	function irAMes(mes: number) {
		if (mes === mesActivo) return;
		mesActivo = mes;
		ctx?.activarMes(mes);
		session?.setHojaActiva(mes);
		syncUrl();
	}

	/// Gancho previo a saltar a otro canvas: suelta la sesión de este libro.
	function antesDeSalir(): boolean {
		session?.dispose();
		session = null;
		return true;
	}

	/// Vuelve al canvas de CIERRES, que es el nuevo índice del módulo, con el
	/// mismo periodo que se estaba viendo aquí: `/dashboard/liquidaciones-terceros`
	/// ya no tiene listado y su redirect aterrizaría en el mes en curso.
	function closeAndGo() {
		session?.dispose();
		session = null;
		goto(`/dashboard/liquidaciones-terceros/canvas?anio=${anio}&mes=${mesActivo}`);
	}

	onMount(() => {
		if (!browser) return;
		// El token va en el handshake: el servidor firma las escrituras con la
		// identidad del JWT, no con la que declare el cliente en cada evento.
		connectSocket();
		loadInicial();
		// Los eventos remotos (patch aplicado, invalidación, reversión,
		// presencia) los gestiona `SheetSession`, que registra y da de baja sus
		// propios handlers en `dispose()`.
	});

	onDestroy(() => {
		session?.dispose();
		session = null;
		teardownEngine();
	});
</script>

<svelte:head>
	<title>Adicionales cierres finales {anio} (canvas) · Cotransmeq</title>
</svelte:head>

<UniverToolbar
	title="ADICIONALES DE CIERRES FINALES"
	hoja={periodDisplay}
	subtitle="{itemsMesActivo.length} fila(s)  ·  {cierresCount} cierre(s)  ·  Σ facturado ${formatCOP(
		totalFacturado
	)}  ·  Σ v/liq ${formatCOP(totalLiq)}  ·  Σ año ${formatCOP(totalAnual)}"
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
					{nombre}{mesesSucios.has(i + 1) ? ' •' : ''}
				</option>
			{/each}
		</select>

		<button
			class="univer-btn univer-btn-dark"
			onclick={() => (previewAbierto = true)}
			title="Ver el documento de {periodDisplay} y exportarlo a PDF"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
			onclick={() => (historialAbierto = true)}
			title="Ver y restaurar versiones de {periodDisplay}"
		>
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
					d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			Historial
		</button>

		<button
			class="univer-btn univer-btn-dark"
			onclick={() => recargarMes(mesActivo)}
			title="Volver a leer {periodDisplay} desde el servidor"
		>
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
					d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
				/>
			</svg>
			Recargar mes
		</button>

		<PresenceAvatars users={presence} />
		<AutosaveIndicator />

		<!-- Sustituye al botón «Volver» que había aquí: `onBack` del toolbar ya
		     pone uno a la izquierda, así que el duplicado solo gastaba espacio
		     en una fila que se recorta en silencio al desbordar. -->
		<SelectorCanvasTerceros actual="adicionales" {anio} mes={mesActivo} onSalir={antesDeSalir} />
	{/snippet}
</UniverToolbar>

<UniverCanvasHost
	bind:container
	{loading}
	error={loadError}
	loadingLabel="Cargando adicionales de {anio}..."
	onRetry={loadInicial}
	errorLabel="Reintentar"
/>

{#if previewAbierto && documentoPreview}
	<PreviewCanvasModal
		scope="adicionales"
		documento={documentoPreview}
		subtitulo="{periodDisplay}  ·  {itemsMesActivo.length} fila(s)  ·  Σ v/liq ${formatCOP(
			totalLiq
		)}"
		onClose={() => (previewAbierto = false)}
	/>
{/if}

<SnapshotPanel
	open={historialAbierto}
	scope="adicionales"
	{anio}
	mes={mesActivo}
	onClose={() => (historialAbierto = false)}
	onReverted={(m) => recargarMes(m)}
/>

<style>
	/* Los selectores de periodo (.univer-year-picker / .univer-month-picker)
	   viven ahora en `toolbar.css`, compartidos por todos los canvas. Estaban
	   copiados aquí y en el canvas de al lado. */
</style>
