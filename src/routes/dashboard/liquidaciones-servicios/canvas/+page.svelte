<!--
	Canvas del HISTORIAL DE LIQUIDACIONES DE SERVICIOS.

	Tres hojas en un libro: Liquidaciones (una fila por ÍTEM), Facturas y
	Terceros — los mismos tres tabs del listado clásico, sin tabs: la
	navegación es la sheet bar de Univer.

	UNA FILA = UN ÍTEM, con los datos de la liquidación repetidos en cada fila
	de su bloque. La redundancia es deliberada: es lo que permite filtrar y
	ordenar por cualquier columna sin celdas vacías «de agrupado».

	La hoja es de SOLO LECTURA (ver `cell-permission-servicios-historial.ts`):
	editar una liquidación exige recalcular IVA y totales, y eso vive en su
	formulario. Lo que sí se hace aquí es operar en lote sobre las FILAS
	SELECCIONADAS —aprobar, facturar, eliminar— y abrir el preview desde la
	columna ACCIONES, que va la primera a propósito.

	Los permisos son los MISMOS del listado clásico (`checkAccess` + áreas),
	no unos nuevos: si el canvas dejara aprobar a quien el listado no deja, el
	guard del listado sería decorativo.
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
	import ModalConfigLiquidador from '$lib/components/univer/ModalConfigLiquidador.svelte';
	import ModalOperadoras from '$lib/components/ModalOperadoras.svelte';
	import ModalLiquidacion, {
		type SolicitudEditor
	} from '$lib/components/univer/ModalLiquidacion.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import { upsertLiquidacion, yaEstaba } from '$lib/editor/canvas/upsert-liquidacion';

	import {
		createHistorialEngine,
		disposeEngine,
		type HistorialEngineContext,
		type HojaHistorial
	} from '$lib/editor/univer/servicios-historial-engine';
	import { installHistorialCellPermission } from '$lib/editor/univer/cell-permission-servicios-historial';
	import { attachSelectionPlugin } from '$lib/editor/univer/plugins/selection.plugin';
	import { attachAccionesPlugin } from '$lib/editor/univer/plugins/acciones.plugin';
	import { attachEnlacesPlugin } from '$lib/editor/univer/plugins/enlaces.plugin';
	import { FCOL } from '$lib/editor/builders/servicios-historial-facturas.builder';
	import { TCOL } from '$lib/editor/builders/servicios-historial-terceros.builder';
	import {
		COL,
		estiloCeldaEstado,
		estiloCeldaFactura,
		type FilaHistorial
	} from '$lib/editor/builders/servicios-historial.builder';
	import { exportarHistorialXLSX } from '$lib/editor/builders/servicios-historial-excel';

	import {
		liquidacionesServiciosAPI,
		liquidacionesTercerosAPI,
		type LiquidacionServicio,
		type EstadoLiquidacionServicio,
		type TerceroItemHistorial
	} from '$lib/api/liquidaciones-servicios';
	import {
		facturacionLiquidacionesAPI,
		type FacturaLiquidacion,
		type LiquidacionAfectada
	} from '$lib/api/facturacionLiquidaciones';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import {
		createHistorialSession,
		type HistorialSession,
		type HistorialPresenceUser
	} from '$lib/editor/canvas/historial-servicios-session.svelte';

	// ─── Estado ────────────────────────────────────────────────────────

	let container = $state<HTMLDivElement | null>(null);
	/// `$state.raw` y no `$state`: los `$derived` de la selección leen
	/// `ctx.modelo`, así que el reemplazo del engine tiene que notificarles.
	/// Pero un `$state` normal envolvería la instancia de Univer en un proxy
	/// profundo, y esa instancia tiene identidad (el injector, el Worker, los
	/// disposables) que un proxy rompe.
	let ctx = $state.raw<HistorialEngineContext | null>(null);
	let canvasDisposers: Array<() => void> = [];
	/// Descarta engines de un montaje que perdió la carrera contra otro.
	let mountToken = 0;

	let liquidaciones = $state<LiquidacionServicio[]>([]);
	let facturas = $state<FacturaLiquidacion[]>([]);
	let terceros = $state<TerceroItemHistorial[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let accionEnCurso = $state<AccionEnCurso | null>(null);

	/// Filas (coordenadas de Univer) seleccionadas ahora mismo en la hoja.
	let filasSeleccionadas = $state<number[]>([]);
	/// Se incrementa cada vez que el usuario toca el autofiltro. Es la única
	/// forma de que los derivados de selección se enteren: las filas ocultas
	/// viven dentro de `ctx`, que es `$state.raw` y no notifica sus mutaciones.
	let versionFiltro = $state(0);
	let hojaVisible = $state<HojaHistorial>('liquidaciones');

	let modalFacturar = $state(false);
	let modalConfig = $state(false);
	let modalOperadoras = $state(false);
	/// El editor de liquidaciones montado encima del canvas. `null` = cerrado.
	/// Uno solo, y no un id de preview más otro de edición: el editor usa
	/// selectores globales y una clave de borrador compartida, así que dos
	/// instancias a la vez se pisarían.
	let solicitudEditor = $state<SolicitudEditor | null>(null);
	let facturasActivas = $state<FacturaLiquidacion[]>([]);
	let cargandoFacturas = $state(false);
	let busquedaFactura = $state('');
	let exportando = $state(false);

	// Tiempo real
	let session: HistorialSession | null = null;
	let presencia = $state<HistorialPresenceUser[]>([]);
	let conectado = $state(true);
	let resincronizando = $state(false);

	/// Año del histórico. Sin valor = todo. Viaja en la URL para poder
	/// compartir el enlace de un año concreto.
	const anio = $derived($page.url.searchParams.get('anio') ?? '');

	// ─── Permisos ──────────────────────────────────────────────────────
	//
	// Copia EXACTA de los del listado clásico (`+page.svelte:510-529`). Se
	// repiten aquí y no se extraen a un helper compartido porque el listado
	// es Svelte 4 (`$:`) y esto es Svelte 5 (runes): un módulo común tendría
	// que devolver un objeto plano y perdería la reactividad en uno de los
	// dos. Si divergen, el síntoma es un botón que promete algo que el
	// backend rechaza con 403.

	const acceso = $derived(
		checkAccess(
			$authStore.user?.role,
			$authStore.user?.area,
			'liquidaciones-servicios',
			$authStore.user?.permisos_rutas
		)
	);
	const isFull = $derived(acceso.level === 'full');
	const isLimited = $derived(acceso.level === 'limited');
	const userAreas = $derived.by<string[]>(() => {
		const a = $authStore.user?.area;
		if (Array.isArray(a)) return a as string[];
		return a ? [a as unknown as string] : [];
	});
	const isAdmin = $derived(userAreas.includes('administracion'));
	const isFacturacion = $derived(userAreas.includes('facturacion'));
	const isOperaciones = $derived(userAreas.includes('operaciones'));

	/// Espejo EXACTO de `+page.svelte` (el listado, líneas 528-532). Aquí no se
	/// inventa ningún permiso: si el canvas dejara hacer algo que el listado no
	/// deja, el usuario lo intentaría y el backend le devolvería un 403 después
	/// de haber seleccionado cuarenta filas.
	/// BORRADOR → LIQUIDADA.
	const canLiquidar = $derived(isFull);
	/// LIQUIDADA → APROBADA. Solo administración.
	const canAprobar = $derived(isAdmin);
	/// LIQUIDADA → BORRADOR.
	const canRevertirABorrador = $derived(isFull);
	/// APROBADA → LIQUIDADA. Solo administración — y el backend lo vuelve a
	/// exigir: cualquier cambio de estado sobre una APROBADA pide el área.
	const canRevertirALiquidada = $derived(isAdmin);
	/// Soft-delete. `isFull` y solo sobre BORRADOR (lo exige el listado; el
	/// backend además rechaza si hay una factura activa asociada).
	const canEliminar = $derived(isFull);
	const canFacturar = $derived((isFull || isLimited) && (isFacturacion || isAdmin));
	const canConfigurar = $derived(isAdmin || isOperaciones);

	// ─── Selección → liquidaciones ─────────────────────────────────────

	/**
	 * Las filas seleccionadas traducidas a filas del índice.
	 *
	 * El encabezado y el pie de totales también entran en un rango que el
	 * usuario arrastre de arriba abajo; se descartan aquí, porque no tienen
	 * entrada en el índice del builder.
	 *
	 * Y se descarta lo que el autofiltro tenga oculto. Con un filtro puesto,
	 * seleccionar de arriba abajo abarca también las filas escondidas: sin este
	 * corte, «filtrar por BORRADOR, seleccionar todo y eliminar» borraría
	 * además las que no estaban en pantalla.
	 */
	const seleccion = $derived.by<FilaHistorial[]>(() => {
		/// Lectura deliberada: es lo que suscribe este derivado a los cambios de
		/// filtro. `ctx` es `$state.raw` y sus mutaciones internas no notifican,
		/// así que sin esta línea la selección se quedaría con el filtro anterior.
		versionFiltro;
		if (!ctx || hojaVisible !== 'liquidaciones') return [];
		const ocultas = ctx.filasFiltradas('liquidaciones');
		const out: FilaHistorial[] = [];
		for (const f of filasSeleccionadas) {
			if (ocultas.has(f)) continue;
			const info = ctx.modelo.filas.get(f);
			if (info) out.push(info);
		}
		return out;
	});

	/**
	 * La selección deduplicada por LIQUIDACIÓN.
	 *
	 * Con una fila por ítem, seleccionar un bloque de 8 filas puede ser UNA
	 * sola liquidación. Todas las acciones operan sobre liquidaciones, así
	 * que sin este colapso se mandarían 8 PATCH idénticos y los contadores
	 * de la UI dirían «8 aprobadas» cuando fue una.
	 */
	const seleccionLiq = $derived.by<FilaHistorial[]>(() => {
		const vistos = new Set<string>();
		const out: FilaHistorial[] = [];
		for (const s of seleccion) {
			if (vistos.has(s.id)) continue;
			vistos.add(s.id);
			out.push(s);
		}
		return out;
	});

	const porEstado = (e: EstadoLiquidacionServicio) => seleccionLiq.filter((s) => s.estado === e);

	/**
	 * Resalta el BLOQUE completo de las liquidaciones tocadas por la selección.
	 *
	 * Una liquidación ocupa una fila por ítem, así que tocar una celda cualquiera
	 * deja al usuario sin saber dónde empieza y acaba lo que va a aprobar. Se
	 * resalta el bloque entero, que es la unidad sobre la que opera TODA la barra
	 * de acciones —`seleccionLiq` ya colapsa por liquidación por ese mismo motivo—.
	 *
	 * Va en un `$effect` y no dentro del derivado de selección porque pinta: un
	 * derivado debe poder recalcularse sin efectos secundarios sobre la hoja.
	 */
	$effect(() => {
		const ids = seleccionLiq.map((s) => s.id);
		if (!ctx) return;
		ctx.resaltarLiquidaciones(hojaVisible === 'liquidaciones' ? ids : []);
	});

	/// Crear factura: solo APROBADA. `ModalFacturar` filtra a APROBADA por su
	/// cuenta, así que ofrecer también las LIQUIDADA daría un contador que no
	/// coincide con lo que el modal acaba mostrando.
	const aprobadas = $derived(porEstado('APROBADA'));
	/// Asociar a una factura existente: el backend acepta LIQUIDADA y APROBADA.
	const facturables = $derived(
		seleccionLiq.filter((s) => s.estado === 'LIQUIDADA' || s.estado === 'APROBADA')
	);
	const aprobables = $derived(porEstado('LIQUIDADA'));
	const borradores = $derived(porEstado('BORRADOR'));
	/// Mismo conjunto que `aprobables`, con otro nombre porque son dos acciones
	/// distintas sobre él: aprobar (adelante) y devolver a borrador (atrás).
	const devolvibles = $derived(porEstado('LIQUIDADA'));
	const reversables = $derived(porEstado('APROBADA'));
	const yaFacturadas = $derived(
		seleccionLiq.filter((s) => s.estado === 'FACTURADA' && s.factura_id)
	);

	/// Mismo guard que el botón «Editar» del listado clásico (`+page.svelte`, el
	/// modal de detalle): BORRADOR para cualquiera con acceso pleno, y LIQUIDADA
	/// solo para admin. Si aquí fuera más permisivo, el usuario abriría el
	/// formulario para que el PUT le devolviera un 403 tras veinte minutos de
	/// trabajo. Está duplicado por el mismo motivo que el resto de permisos de
	/// esta página (ver el comentario del bloque de permisos): el listado es
	/// Svelte 4 y no comparte derivados.
	const editable = $derived(
		seleccionLiq.length === 1 &&
			isFull &&
			(seleccionLiq[0].estado === 'BORRADOR' ||
				(isAdmin && seleccionLiq[0].estado === 'LIQUIDADA'))
	);

	const motivoNoEditable = $derived(
		!isFull
			? 'Tu área no puede editar liquidaciones.'
			: seleccionLiq.length === 0
				? 'Selecciona la liquidación que quieres editar.'
				: seleccionLiq.length > 1
					? 'Se edita de una en una; hay varias seleccionadas.'
					: `${seleccionLiq[0].consecutivo} está en ${seleccionLiq[0].estado} y ya no se edita.`
	);

	/// Cómo se llama la hoja que se está mirando, para el «Título / Hoja» de la
	/// barra: la pestaña activa de Univer queda abajo del todo, lejos de donde
	/// se mira.
	const NOMBRE_HOJA: Record<HojaHistorial, string> = {
		liquidaciones: 'Liquidaciones',
		facturas: 'Facturas',
		terceros: 'Terceros'
	};
	const nombreHojaVisible = $derived(NOMBRE_HOJA[hojaVisible]);

	/// Los filtros puestos en la hoja actual. Depende de `versionFiltro` y de
	/// `hojaVisible`: el primero porque las mutaciones de `ctx` ($state.raw) no
	/// notifican, el segundo porque cada hoja tiene los suyos.
	const filtrosDeLaHoja = $derived.by(() => {
		versionFiltro;
		if (!ctx) return [];
		return ctx.filtrosActivos(hojaVisible);
	});

	const totalSeleccionado = $derived(seleccionLiq.reduce((s, l) => s + l.total, 0));

	/// Se cuenta desde el array de origen y no desde `ctx.modelo.totalItems`
	/// porque `ctx` es `$state.raw`: sus mutaciones internas (altas por
	/// socket) no notifican, y el subtítulo se quedaría con el número del
	/// montaje. El `|| 1` refleja la regla del builder: una liquidación sin
	/// ítems ocupa igualmente una fila.
	const totalItemsVisibles = $derived(
		liquidaciones.reduce((s, l) => s + (l.items?.length || 1), 0)
	);

	const COP = (v: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(v || 0);

	/// Las liquidaciones completas correspondientes a la selección aprobada:
	/// `ModalFacturar` espera objetos `LiquidacionServicio`, no el índice del
	/// builder.
	const aprobadasCompletas = $derived.by(() => {
		const ids = new Set(aprobadas.map((f) => f.id));
		return liquidaciones.filter((l) => ids.has(l.id));
	});

	const facturasFiltradas = $derived.by(() => {
		const q = busquedaFactura.trim().toLowerCase();
		if (!q) return facturasActivas;
		return facturasActivas.filter((f) => f.numero_factura.toLowerCase().includes(q));
	});

	// ─── Carga ─────────────────────────────────────────────────────────

	/**
	 * Trae las tres hojas.
	 *
	 * `include_items=true` es lo que hace posible la fila por ítem: sin él el
	 * backend solo manda `placas[]` y `total_items`, y el canvas pintaría una
	 * fila por liquidación con la columna de ítem vacía.
	 *
	 * Las tres van en paralelo: son endpoints distintos y encadenarlas
	 * triplicaría el tiempo de apertura sin ganar nada.
	 */
	async function traerDatos() {
		const filtroAnio: Record<string, number> = anio ? { anio: Number(anio) } : {};
		const [liq, fac, ter] = await Promise.all([
			/// Todo el histórico de un tirón: el backend clampea `limit` a 2000.
			/// Paginar aquí obligaría a inventar un scroll infinito dentro de
			/// una hoja de cálculo, que es justo lo que la hoja evita.
			liquidacionesServiciosAPI.listar({
				page: 1,
				limit: 2000,
				include_items: true,
				...filtroAnio
			}),
			facturacionLiquidacionesAPI.listar({ page: 1, limit: 500 }),
			liquidacionesTercerosAPI
				.listarHistorial({ page: 1, limit: 2000, ...filtroAnio })
				// El histórico de terceros es accesorio: si falla, el canvas
				// sigue siendo útil con las otras dos hojas.
				.catch((e) => {
					console.warn('[historial] terceros no disponibles', e);
					return { items: [] as TerceroItemHistorial[], total: 0, totalPages: 0, page: 1 };
				})
		]);
		return {
			liquidaciones: liq.liquidaciones ?? [],
			facturas: fac.facturas ?? [],
			terceros: ter.items ?? []
		};
	}

	async function loadInicial() {
		loading = true;
		loadError = '';
		try {
			const datos = await traerDatos();
			liquidaciones = datos.liquidaciones;
			facturas = datos.facturas;
			terceros = datos.terceros;
			await remountEngine();
		} catch (e: any) {
			loadError = e?.message || 'No se pudo cargar el historial';
		} finally {
			loading = false;
		}
	}

	/**
	 * Re-lectura tras recuperar la conexión.
	 *
	 * Remonta el libro entero, y eso pierde el scroll y la selección. Es
	 * intencional: tras un hueco de red no sabemos QUÉ cambió (los eventos
	 * perdidos no se reenvían), así que un parcheo selectivo sería adivinar.
	 * Se avisa con un toast para que el salto no parezca un fallo.
	 */
	async function resincronizar() {
		if (resincronizando || loading) return;
		resincronizando = true;
		try {
			const datos = await traerDatos();
			liquidaciones = datos.liquidaciones;
			facturas = datos.facturas;
			terceros = datos.terceros;
			await remountEngine();
			toast.success('Historial resincronizado', {
				description: 'Se recuperó la conexión y se recargaron los datos.'
			});
		} catch (e: any) {
			toast.error('No se pudo resincronizar', {
				description: e?.message || 'Vuelve a intentarlo desde el botón de recargar.'
			});
		} finally {
			resincronizando = false;
		}
	}

	// ─── Engine ────────────────────────────────────────────────────────

	async function mountEngineNow() {
		if (!container || liquidaciones.length === 0) return;
		const token = mountToken;

		try {
			const nuevo = createHistorialEngine({
				container,
				datos: { liquidaciones, facturas, terceros },
				onFiltroCambiado: () => versionFiltro++
			});
			if (token !== mountToken) {
				// Otro montaje ganó la carrera: se descarta este para no dejar un
				// Univer huérfano con su Worker de fórmulas vivo.
				disposeEngine(nuevo.univer, nuevo.fUniver, nuevo.unitId, container);
				return;
			}
			ctx = nuevo;
			hojaVisible = nuevo.hojaActiva() ?? 'liquidaciones';
			session?.setHojaActiva(nuevo.sheetIds[hojaVisible]);

			/**
			 * Columnas que ENLAZAN, por hoja. Se usan para callar el aviso de solo
			 * lectura cuando el doble clic era «sígueme el enlace» y no «déjame
			 * escribir».
			 *
			 * El doble clic sobre una celda-enlace hace las dos cosas a la vez:
			 * `enlaces.plugin.ts` navega y Univer intenta abrir el editor, que el
			 * permiso corta. Sin esta comprobación, seguir un enlace —la acción
			 * más normal de esta pantalla— regañaba al usuario por editar.
			 */
			const COLUMNAS_ENLACE: Record<string, number> = {
				[nuevo.sheetIds.liquidaciones]: COL.FACTURA,
				[nuevo.sheetIds.facturas]: FCOL.CONSECUTIVOS,
				[nuevo.sheetIds.terceros]: TCOL.CONSECUTIVO
			};

			/// `true` si la celda activa es una de esas columnas. Se pregunta a la
			/// hoja en el momento del bloqueo, que es cuando la selección ya está
			/// puesta sobre la celda que se acaba de pulsar.
			const enCeldaEnlace = (): boolean => {
				try {
					const ws: any = nuevo.fUniver.getActiveWorkbook()?.getActiveSheet?.();
					const columna = COLUMNAS_ENLACE[ws?.getSheetId?.()];
					if (columna === undefined) return false;
					const r: any = ws.getSelection?.()?.getActiveRange?.();
					const rango = typeof r?.getRange === 'function' ? r.getRange() : (r?.range ?? r);
					return rango?.startColumn === columna;
				} catch {
					return false;
				}
			};

			canvasDisposers.push(
				installHistorialCellPermission(nuevo.univer, {
					onBloqueado: ({ titulo, detalle }) => {
						if (enCeldaEnlace()) return;
						/// `id` fijo: un intento dispara el comando y su mutación, y el
						/// menú contextual puede encadenar varios. Sin la clave salen
						/// tres o cuatro avisos idénticos apilados.
						toast.warning(titulo, {
							id: 'historial-solo-lectura',
							description: detalle,
							duration: 7000
						});
					}
				})
			);

			canvasDisposers.push(
				attachSelectionPlugin({
					fUniver: nuevo.fUniver,
					container,
					onChange: (filas) => {
						filasSeleccionadas = filas;
						// La hoja activa puede haber cambiado por la sheet bar, que
						// no emite ningún evento que podamos escuchar; se relee en
						// cada interacción, que es cuando importa.
						const hoja = nuevo.hojaActiva();
						if (hoja && hoja !== hojaVisible) {
							hojaVisible = hoja;
							session?.setHojaActiva(nuevo.sheetIds[hoja]);
						}
					}
				})
			);

			canvasDisposers.push(
				attachAccionesPlugin({
					fUniver: nuevo.fUniver,
					container,
					columna: COL.ACCIONES,
					sheetId: () => nuevo.sheetIds.liquidaciones,
					onAccion: (fila) => {
						const info = nuevo.modelo.filas.get(fila);
						if (info) solicitudEditor = { modo: 'ver', id: info.id };
					}
				})
			);

			/**
			 * Enlaces entre hojas: liquidación ⇄ factura, en los dos sentidos y
			 * desde las tres hojas.
			 *
			 * Doble clic navega; el clic simple sigue seleccionando la celda para
			 * copiar. La razón de existir es que «N° FACTURA» y «CONSECUTIVOS» son
			 * la misma relación vista desde los dos lados, y cruzarla a mano
			 * significa cambiar de hoja y buscar el número entre cuatrocientas
			 * filas.
			 */
			canvasDisposers.push(
				attachEnlacesPlugin({
					fUniver: nuevo.fUniver,
					container,
					columnas: [
						// Liquidaciones → Facturas
						{
							sheetId: () => nuevo.sheetIds.liquidaciones,
							columna: COL.FACTURA,
							alSeguir: (fila) => {
								const info = nuevo.modelo.filas.get(fila);
								return info?.factura_id ? nuevo.irAFactura(info.factura_id) : false;
							}
						},
						// Facturas → Liquidaciones. La celda lista N consecutivos y
						// se salta al PRIMERO: es lo único determinista sin saber
						// sobre cuál de los nombres cayó el cursor.
						{
							sheetId: () => nuevo.sheetIds.facturas,
							columna: FCOL.CONSECUTIVOS,
							alSeguir: (_fila, texto) => {
								const id = idPorConsecutivo(texto);
								return id ? nuevo.irALiquidacion(id) : false;
							}
						},
						// Terceros → Liquidaciones
						{
							sheetId: () => nuevo.sheetIds.terceros,
							columna: TCOL.CONSECUTIVO,
							alSeguir: (_fila, texto) => {
								const id = idPorConsecutivo(texto);
								return id ? nuevo.irALiquidacion(id) : false;
							}
						}
					],
					onSinDestino: () => {
						toast.info('Esa fila no tiene a dónde saltar todavía.', {
							description: 'La liquidación aún no está facturada.'
						});
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
	 * Remontar tras cada acción costaría rehacer miles de filas y —lo que de
	 * verdad molesta— devolvería el scroll al principio, perdiendo de vista
	 * justo las filas sobre las que se acaba de actuar.
	 *
	 * Repinta TODAS las filas del bloque de cada liquidación: el estado está
	 * repetido en cada fila de su ítem, así que tocar solo la primera dejaría
	 * el resto mintiendo.
	 */
	function aplicarCambios(cambios: LiquidacionAfectada[]) {
		if (!ctx) return;
		for (const c of cambios) {
			const filas = ctx.modelo.filasPorLiquidacion.get(c.id);
			if (!filas) continue;

			for (const fila of filas) {
				const info = ctx.modelo.filas.get(fila);
				const zebra = info?.zebra ?? false;

				ctx.pintarCelda(
					'liquidaciones',
					fila,
					COL.ESTADO,
					c.estado,
					estiloCeldaEstado(zebra, c.estado as EstadoLiquidacionServicio)
				);
				ctx.pintarCelda(
					'liquidaciones',
					fila,
					COL.FACTURA,
					c.numero_factura ?? '',
					estiloCeldaFactura(zebra, !!c.numero_factura)
				);

				// El índice del builder es la fuente de verdad de qué se puede
				// hacer con cada fila; si no se actualiza, el carril seguiría
				// ofreciendo «Facturar» sobre algo ya facturado.
				if (info) {
					info.estado = c.estado as EstadoLiquidacionServicio;
					info.factura_id = c.factura_id;
					info.numero_factura = c.numero_factura;
				}
			}

			// Y el array de origen, para que ModalFacturar y el XLSX no vean
			// un estado viejo.
			const l = liquidaciones.find((x) => x.id === c.id);
			if (l) {
				l.estado = c.estado as EstadoLiquidacionServicio;
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
		/**
		 * Destello de los cambios de estado.
		 *
		 * Cubre TODO el flujo —liquidar, aprobar, reversar, facturar,
		 * desasociar— tanto si lo hizo esta pestaña como si llegó por socket:
		 * las dos vías terminan aquí. Es la diferencia entre ver que la columna
		 * ESTADO cambió de color y no enterarse en una hoja de cuatrocientas
		 * filas.
		 */
		for (const c of cambios) ctx.destellarLiquidacion(c.id);

		// Fuerza el recálculo de los `$derived` que dependen del índice mutado.
		filasSeleccionadas = [...filasSeleccionadas];
	}

	// ─── Acciones del carril ───────────────────────────────────────────

	async function conOverlay<T>(
		accion: AccionEnCurso,
		fn: (progreso: (detalle: string) => void) => Promise<T>
	): Promise<T | undefined> {
		// El velo tapa los botones, pero el teclado puede activar uno que
		// tuviera el foco.
		if (accionEnCurso) return;
		accionEnCurso = accion;
		try {
			return await fn((detalle) => {
				if (accionEnCurso) accionEnCurso = { ...accionEnCurso, detalle };
			});
		} finally {
			accionEnCurso = null;
		}
	}

	/**
	 * Ejecuta `fn` sobre cada elemento con concurrencia acotada.
	 *
	 * No hay endpoint de lote para aprobar ni para eliminar: son N llamadas
	 * 1-a-1. En serie, 40 liquidaciones son 40 viajes encadenados; sin límite,
	 * son 40 peticiones simultáneas contra el mismo backend. Cuatro a la vez
	 * es el punto medio, y como cada liquidación es una fila independiente no
	 * hay carrera entre ellas.
	 */
	async function enLotes<T>(
		items: T[],
		fn: (item: T) => Promise<void>,
		onAvance: (hechos: number, total: number) => void,
		concurrencia = 4
	) {
		let siguiente = 0;
		let hechos = 0;
		const trabajador = async () => {
			while (siguiente < items.length) {
				const i = siguiente++;
				try {
					await fn(items[i]);
				} finally {
					hechos++;
					onAvance(hechos, items.length);
				}
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(concurrencia, items.length) }, trabajador)
		);
	}

	/**
	 * Mueve un lote de liquidaciones a otro estado.
	 *
	 * Las cuatro transiciones del canvas —liquidar, aprobar, devolver a borrador
	 * y reversar aprobación— son la MISMA operación con otro destino y otro
	 * texto: confirmación, lote con progreso, parcheo local y recuento de
	 * fallos. Estaban escritas a mano una vez y duplicarlas cuatro veces
	 * garantizaba que la cuarta olvidara el `aplicarCambios` o el `catch`.
	 *
	 * No hay endpoint de lote para cambiar estado: son N llamadas, y por eso
	 * cada una acumula su fallo por separado en vez de abortar el conjunto —un
	 * 403 en la fila doce no debe deshacer las once que ya pasaron—.
	 */
	async function moverEstadoSeleccion(
		objetivo: FilaHistorial[],
		destino: EstadoLiquidacionServicio,
		textos: {
			/** Pregunta del confirm, sin la lista de consecutivos. */
			pregunta: string;
			/** Qué va a pasar. Se muestra bajo la lista. */
			consecuencia: string;
			/** Título del overlay de progreso. */
			titulo: string;
			/** Participio para los toasts: «3 liquidación(es) aprobadas». */
			hecho: string;
		},
		permitido: boolean
	) {
		if (objetivo.length === 0 || !permitido) return;

		if (
			!confirm(
				`${textos.pregunta.replace('{n}', String(objetivo.length))}\n\n` +
					objetivo.map((o) => o.consecutivo).join(', ') +
					`\n\n${textos.consecuencia}`
			)
		) {
			return;
		}

		await conOverlay(
			{ titulo: textos.titulo, detalle: `0 de ${objetivo.length}.` },
			async (progreso) => {
				const cambios: LiquidacionAfectada[] = [];
				const fallos: string[] = [];

				await enLotes(
					objetivo,
					async (o) => {
						try {
							await liquidacionesServiciosAPI.cambiarEstado(o.id, destino);
							cambios.push({
								id: o.id,
								consecutivo: o.consecutivo,
								estado: destino as any,
								factura_id: o.factura_id,
								numero_factura: o.numero_factura
							});
						} catch (e: any) {
							fallos.push(`${o.consecutivo}: ${mensajeError(e)}`);
						}
					},
					(hechos, total) => progreso(`${hechos} de ${total}.`)
				);

				if (cambios.length > 0) aplicarCambios(cambios);
				if (fallos.length > 0) {
					toast.error(`${fallos.length} no se pudieron cambiar`, {
						description: fallos.slice(0, 3).join(' · ')
					});
				}
				if (cambios.length > 0) {
					toast.success(`${cambios.length} liquidación(es) ${textos.hecho}`);
				}
			}
		);
	}

	const liquidarSeleccion = () =>
		moverEstadoSeleccion(
			[...borradores],
			'LIQUIDADA',
			{
				pregunta: '¿Liquidar {n} liquidación(es) en BORRADOR?',
				consecuencia:
					'Pasarán de BORRADOR a LIQUIDADA: quedarán visibles para aprobación y ya no se podrán editar libremente.',
				titulo: 'Liquidando',
				hecho: 'liquidadas'
			},
			canLiquidar
		);

	const aprobarSeleccion = () =>
		moverEstadoSeleccion(
			[...aprobables],
			'APROBADA',
			{
				pregunta: '¿Aprobar {n} liquidación(es)?',
				consecuencia: 'Pasarán de LIQUIDADA a APROBADA y quedarán listas para facturar.',
				titulo: 'Aprobando liquidaciones',
				hecho: 'aprobadas'
			},
			canAprobar
		);

	const devolverABorradorSeleccion = () =>
		moverEstadoSeleccion(
			[...devolvibles],
			'BORRADOR',
			{
				pregunta: '¿Devolver {n} liquidación(es) a BORRADOR?',
				consecuencia:
					'Volverán a BORRADOR y se borrarán su liquidador y su fecha de liquidación. Al volver a liquidarlas quedarán a tu nombre y con la fecha de hoy.',
				titulo: 'Devolviendo a borrador',
				hecho: 'devueltas a borrador'
			},
			canRevertirABorrador
		);

	const reversarAprobacionSeleccion = () =>
		moverEstadoSeleccion(
			[...reversables],
			'LIQUIDADA',
			{
				pregunta: '¿Reversar la aprobación de {n} liquidación(es)?',
				consecuencia:
					'Volverán a LIQUIDADA y se borrarán su aprobador y su fecha de aprobación. Dejarán de estar disponibles para crear factura.',
				titulo: 'Reversando aprobación',
				hecho: 'reversadas a LIQUIDADA'
			},
			canRevertirALiquidada
		);

	async function eliminarSeleccion() {
		const objetivo = [...borradores];
		if (objetivo.length === 0 || !canEliminar) return;

		if (
			!confirm(
				`¿Eliminar ${objetivo.length} liquidación(es) en BORRADOR?\n\n` +
					objetivo.map((o) => o.consecutivo).join(', ') +
					'\n\nSe archivan (soft-delete): dejan de aparecer en el historial, ' +
					'pero se pueden restaurar desde el backend.'
			)
		) {
			return;
		}

		await conOverlay(
			{ titulo: 'Eliminando liquidaciones', detalle: `0 de ${objetivo.length}.` },
			async (progreso) => {
				const borradas: string[] = [];
				const fallos: string[] = [];

				await enLotes(
					objetivo,
					async (o) => {
						try {
							await liquidacionesServiciosAPI.eliminar(o.id);
							borradas.push(o.id);
						} catch (e: any) {
							fallos.push(`${o.consecutivo}: ${mensajeError(e)}`);
						}
					},
					(hechos, total) => progreso(`${hechos} de ${total}.`)
				);

				for (const id of borradas) {
					ctx?.eliminarLiquidacion(id);
					liquidaciones = liquidaciones.filter((l) => l.id !== id);
				}
				filasSeleccionadas = [];

				if (fallos.length > 0) {
					toast.error(`${fallos.length} no se pudieron eliminar`, {
						description: fallos.slice(0, 3).join(' · ')
					});
				}
				if (borradas.length > 0) {
					toast.success(`${borradas.length} liquidación(es) eliminadas`);
				}
			}
		);
	}

	function abrirFacturar() {
		if (aprobadas.length === 0) return;
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
		// La hoja de Facturas también es «la verdad» para el usuario: si la
		// factura recién creada no apareciera ahí, parecería que no se creó.
		ctx?.insertarFactura(factura);
		facturas = [factura, ...facturas];
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
					ctx?.actualizarFactura(res.factura);
					// La factura cambió de total: la copia del panel quedaría vieja.
					facturasActivas = facturasActivas.map((f) =>
						f.id === res.factura.id ? res.factura : f
					);
					facturas = facturas.map((f) => (f.id === res.factura.id ? res.factura : f));
					toast.success(`Asociadas a ${factura.numero_factura}`, {
						description: `La factura suma ahora ${COP(res.factura.valor_total)}.`
					});
				} catch (e: any) {
					toast.error('No se pudo asociar', { description: mensajeError(e) });
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
						ctx?.actualizarFactura(res.factura);
						facturas = facturas.map((f) => (f.id === res.factura.id ? res.factura : f));
						if (res.quedo_vacia) alguna = o.numero_factura;
					} catch (e: any) {
						fallos.push(`${o.consecutivo}: ${mensajeError(e)}`);
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

	/**
	 * Traduce el texto de una celda a la liquidación que nombra.
	 *
	 * La hoja de Facturas lista varios consecutivos en una sola celda
	 * («LS-0042, LS-0043») y la de Terceros lleva uno suelto. En los dos casos
	 * se toma el PRIMERO: es lo único determinista, porque el doble clic no dice
	 * sobre cuál de los nombres cayó el cursor dentro del texto.
	 *
	 * Se resuelve por consecutivo y no por un índice fila → id porque la hoja de
	 * Terceros no tiene índice: su modelo solo guarda el total de filas. El
	 * consecutivo es único, así que basta.
	 */
	function idPorConsecutivo(texto: string): string | null {
		const primero = texto.split(/[,;\n]/)[0]?.trim();
		if (!primero) return null;
		return liquidaciones.find((l) => l.consecutivo === primero)?.id ?? null;
	}

	/// El backend manda el motivo en `error` y axios lo envuelve; un
	/// `e.message` pelado deja al usuario con «Request failed with status 400».
	function mensajeError(e: any): string {
		return e?.response?.data?.error || e?.message || 'Error desconocido';
	}

	// ─── Tiempo real ───────────────────────────────────────────────────

	/**
	 * Mete una liquidación en la hoja venga de donde venga: del socket o del
	 * formulario que se acaba de guardar en el overlay.
	 *
	 * IDEMPOTENTE a propósito. Al guardar desde aquí llegan las dos vías —el
	 * `onGuardada` del editor y el eco del socket, porque el guardado va por HTTP
	 * y el backend reemite a la sala incluyendo a quien guardó—. El engine ya
	 * deduplicaba; el array no, y el síntoma no habría sido una fila repetida
	 * sino el contador del encabezado mintiendo.
	 */
	function aplicarLiquidacion(l: LiquidacionServicio, destellar = true) {
		if (anio && String(l.anio) !== anio) return false; // fuera del filtro visible
		const estaba = yaEstaba(liquidaciones, l.id);
		liquidaciones = upsertLiquidacion(liquidaciones, l);
		/// `insertarLiquidacion` delega en `actualizarLiquidacion` si el id ya
		/// está, así que sirve para los dos casos.
		ctx?.insertarLiquidacion(l);
		/**
		 * Destello.
		 *
		 * Un alta entra ARRIBA DEL TODO —el listado ordena por `created_at desc`—
		 * y eso empuja hacia abajo lo que el usuario estaba mirando. Sin marcar
		 * cuál es la fila nueva, el movimiento parece un salto de scroll
		 * inexplicable. En una edición el destello dice qué cambió, que si no hay
		 * que buscarlo comparando de memoria.
		 *
		 * Se hace en el siguiente frame: el bloque acaba de escribirse y el
		 * índice de filas todavía no refleja su posición final.
		 */
		if (destellar) requestAnimationFrame(() => ctx?.destellarLiquidacion(l.id));
		return !estaba;
	}

	/**
	 * Otra sesión creó una liquidación: entra en la hoja sin recargar.
	 *
	 * El payload del socket trae la entidad, pero SIN los ítems (el `create`
	 * del backend los incluye, aunque el mapeo de la entidad emitida no
	 * garantiza la misma forma que `listar`). Se pide el detalle para que la
	 * fila nueva tenga exactamente los mismos datos que sus vecinas — una
	 * fila «casi igual» es peor que ninguna, porque nadie sabe en qué difiere.
	 */
	async function altaEnVivo(id: string, etiqueta: string, actor: string) {
		try {
			const l = await liquidacionesServiciosAPI.obtenerPorId(id);
			if (aplicarLiquidacion(l)) {
				toast.info(`Nueva liquidación ${l.consecutivo}`, {
					description: `${actor} la agregó al historial.`
				});
			}
		} catch (e) {
			console.warn('[historial] no se pudo traer la liquidación nueva', etiqueta, e);
		}
	}

	/**
	 * Acaba de guardarse en el overlay, sin salir del canvas.
	 *
	 * El aviso de «fuera del filtro» va aquí y no en `aplicarLiquidacion`: cuando
	 * la que cae fuera del año la creó OTRA sesión, el silencio es lo correcto;
	 * cuando la acabas de guardar tú, un formulario que se cierra sin que aparezca
	 * nada se lee como «no se guardó».
	 */
	function guardadaEnElModal(l: LiquidacionServicio) {
		if (anio && String(l.anio) !== anio) {
			toast.info(`${l.consecutivo} se guardó`, {
				description: `Es de ${l.anio} y el canvas está filtrado por ${anio}: por eso no la ves aquí.`
			});
			return;
		}
		aplicarLiquidacion(l);
	}

	async function edicionEnVivo(id: string, entidad: any) {
		const existente = liquidaciones.find((l) => l.id === id);
		if (!existente) return;
		try {
			// Igual que en el alta: se relee para no mezclar dos formas del
			// mismo objeto en la misma hoja.
			const l = await liquidacionesServiciosAPI.obtenerPorId(id);
			aplicarLiquidacion(l);
		} catch {
			// Si el detalle no llega, al menos el estado se refleja.
			if (entidad?.estado) {
				aplicarCambios([
					{
						id,
						consecutivo: existente.consecutivo,
						estado: entidad.estado,
						factura_id: null,
						numero_factura: null
					}
				]);
			}
		}
	}

	function iniciarSesion() {
		const u = $authStore.user;
		if (!u) return;
		session = createHistorialSession({
			user: { id: u.id, name: u.nombre },
			anio: anio ? Number(anio) : new Date().getFullYear(),

			onPresence: (users) => {
				presencia = users;
			},
			onConexion: (ok) => {
				conectado = ok;
			},
			onResync: () => {
				resincronizar();
			},

			onLiquidacionCreada: (c) => {
				altaEnVivo(c.id, c.etiqueta, c.actor?.nombre ?? 'Alguien');
			},
			onLiquidacionActualizada: (c) => {
				edicionEnVivo(c.id, c.entidad);
			},
			onLiquidacionEliminada: (c) => {
				if (!liquidaciones.some((l) => l.id === c.id)) return;
				ctx?.eliminarLiquidacion(c.id);
				liquidaciones = liquidaciones.filter((l) => l.id !== c.id);
				toast.info(`Liquidación ${c.etiqueta} eliminada`, {
					description: `${c.actor?.nombre ?? 'Alguien'} la quitó del historial.`
				});
			},
			onLiquidacionFacturada: (c) => {
				aplicarCambios([
					{
						id: c.id,
						consecutivo: c.etiqueta,
						estado: (c.estado === 'FACTURADA' ? 'FACTURADA' : 'LIQUIDADA') as any,
						factura_id: c.factura_id ?? null,
						numero_factura: c.numero_factura ?? null
					}
				]);
			},

			onFacturaCreada: (f) => {
				if (facturas.some((x) => x.id === f.id)) return;
				facturas = [f, ...facturas];
				ctx?.insertarFactura(f);
				/// Mismo motivo que en las liquidaciones: una factura nueva entra
				/// arriba y desplaza lo que se estaba mirando.
				requestAnimationFrame(() => ctx?.destellarFactura(f.id));
			},
			onFacturaActualizada: (f) => {
				facturas = facturas.map((x) => (x.id === f.id ? f : x));
				ctx?.actualizarFactura(f);
				requestAnimationFrame(() => ctx?.destellarFactura(f.id));
			},
			onFacturaAnulada: (f, tipo) => {
				if (tipo === 'deleted') {
					facturas = facturas.filter((x) => x.id !== f.id);
					ctx?.eliminarFactura(f.id);
				} else {
					facturas = facturas.map((x) => (x.id === f.id ? f : x));
					ctx?.actualizarFactura(f);
				}
			}
		});
		conectado = session.conectado;
	}

	// ─── Ciclo de vida ─────────────────────────────────────────────────

	onMount(() => {
		loadInicial();
		iniciarSesion();
	});

	onDestroy(() => {
		session?.dispose();
		session = null;
		teardownEngine();
	});
</script>

<UniverToolbar
	title="Historial de liquidaciones de servicios"
	subtitle={anio
		? `Año ${anio} · ${liquidaciones.length} liquidaciones · ${totalItemsVisibles} ítems`
		: `${liquidaciones.length} liquidaciones · ${totalItemsVisibles} ítems`}
	hoja={nombreHojaVisible}
	filtros={filtrosDeLaHoja}
	onQuitarFiltro={(col) => {
		ctx?.quitarFiltro(hojaVisible, col);
	}}
	onLimpiarFiltros={() => {
		ctx?.limpiarFiltros(hojaVisible);
	}}
	onBack={() => goto('/dashboard/liquidaciones-servicios')}
	inerte={!!solicitudEditor}
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

		{#if seleccionLiq.length > 0}
			<span class="univer-badge">
				{seleccionLiq.length} liq. · {seleccion.length} filas · {COP(totalSeleccionado)}
			</span>
		{/if}

		<!-- Estado de la conexión. Va SIEMPRE visible y no solo cuando se
		     cae: en un canvas que se actualiza solo, un indicador que
		     desaparece en reposo se lee como «no hay tiempo real». -->
		<span class="hs-conexion" class:hs-conexion-off={!conectado}>
			<span class="hs-dot"></span>
			{#if resincronizando}
				Resincronizando…
			{:else if conectado}
				En vivo
			{:else}
				Sin conexión
			{/if}
		</span>

		<PresenceAvatars users={presencia.map((p) => ({ id: p.id, name: p.name }))} />
	{/snippet}
</UniverToolbar>

<!-- `inert` mientras el editor está encima: es opaco y ocupa el viewport, así
     que el canvas y el carril no se ven, pero sin esto el Tab seguiría bajando
     hasta ellos y el lector de pantalla anunciándolos. -->
<div class="hs-body" inert={!!solicitudEditor}>
	<div class="hs-canvas">
		{#if !loading && !loadError && liquidaciones.length === 0}
			<div class="hs-vacio">
				<h2>No hay liquidaciones</h2>
				<p>
					{anio
						? `No se registró ninguna liquidación de servicios en ${anio}.`
						: 'Todavía no hay liquidaciones de servicios en el histórico.'}
				</p>
				<button
					class="univer-btn univer-btn-dark"
					onclick={() => (solicitudEditor = { modo: 'crear', id: null })}
				>
					Crear la primera liquidación
				</button>
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
				id: 'nueva',
				label: 'Nueva liquidación',
				hint:
					'Abre el formulario encima del canvas. Al guardar o cancelar vuelves aquí, con los filtros y la selección intactos.',
				icon: icoNueva,
				tone: 'green',
				disabled: !isFull || !!solicitudEditor,
				disabledHint: 'Tu área no puede crear liquidaciones.',
				onSelect: () => (solicitudEditor = { modo: 'crear', id: null })
			},
			{
				id: 'preview',
				label: 'Ver preview',
				hint:
					seleccionLiq.length === 1
						? `Abre el preview de ${seleccionLiq[0].consecutivo}.`
						: 'También se abre pulsando 👁 VER en la primera columna.',
				icon: icoOjo,
				disabled: seleccionLiq.length !== 1 || !!solicitudEditor,
				disabledHint:
					seleccionLiq.length === 0
						? 'Selecciona una fila, o pulsa 👁 VER en la columna de acciones.'
						: 'El preview es de una sola liquidación; hay varias seleccionadas.',
				onSelect: () => {
					if (seleccionLiq.length === 1)
						solicitudEditor = { modo: 'ver', id: seleccionLiq[0].id };
				}
			},
			{
				id: 'editar',
				label: 'Editar',
				hint:
					seleccionLiq.length === 1
						? `Abre ${seleccionLiq[0].consecutivo} para editarla, sin salir del canvas.`
						: 'Selecciona una liquidación en BORRADOR para editarla.',
				icon: icoEditar,
				disabled: !editable || !!solicitudEditor,
				disabledHint: motivoNoEditable,
				onSelect: () => {
					if (editable) solicitudEditor = { modo: 'editar', id: seleccionLiq[0].id };
				}
			},
			{ type: 'sep' },
			{
				id: 'liquidar',
				label: 'Liquidar',
				hint: `Pasa a LIQUIDADA las ${borradores.length} fila(s) en BORRADOR de la selección.`,
				icon: icoAprobar,
				tone: 'green',
				badge: borradores.length || null,
				disabled: borradores.length === 0 || !canLiquidar || !!accionEnCurso,
				disabledHint: !canLiquidar
					? 'Liquidar requiere área de Administración u Operaciones.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las liquidaciones seleccionadas está en BORRADOR.',
				onSelect: liquidarSeleccion
			},
			{
				id: 'aprobar',
				label: 'Aprobar liquidaciones',
				hint: `Pasa a APROBADA las ${aprobables.length} fila(s) en LIQUIDADA de la selección.`,
				icon: icoAprobar,
				tone: 'green',
				badge: aprobables.length || null,
				disabled: aprobables.length === 0 || !canAprobar || !!accionEnCurso,
				disabledHint: !canAprobar
					? 'Solo Administración puede aprobar liquidaciones.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las liquidaciones seleccionadas está en LIQUIDADA.',
				onSelect: aprobarSeleccion
			},
			{
				id: 'facturar',
				label: 'Crear factura',
				hint: `Crea una factura nueva con las ${aprobadas.length} liquidación(es) APROBADAS de la selección.`,
				icon: icoFactura,
				tone: 'green',
				badge: aprobadas.length || null,
				disabled: aprobadas.length === 0 || !canFacturar || !!accionEnCurso,
				disabledHint: !canFacturar
					? 'Facturar requiere área de Facturación o Administración.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las liquidaciones seleccionadas está APROBADA.',
				onSelect: abrirFacturar
			},
			{
				id: 'asociar',
				label: 'Asociar a factura existente',
				hint: `Engancha las ${facturables.length} liquidación(es) facturables a una factura ya creada.`,
				icon: icoAsociar,
				tone: 'blue',
				disabled: facturables.length === 0 || !canFacturar || !!accionEnCurso,
				disabledHint: !canFacturar
					? 'Facturar requiere área de Facturación o Administración.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las filas seleccionadas está en LIQUIDADA o APROBADA.',
				panel: panelAsociar,
				panelWidth: 340
			},
			{
				id: 'desasociar',
				label: 'Quitar de su factura',
				hint: `Devuelve a LIQUIDADA las ${yaFacturadas.length} liquidación(es) facturadas de la selección y recalcula el total de su factura.`,
				icon: icoDesasociar,
				tone: 'red',
				disabled: yaFacturadas.length === 0 || !canFacturar || !!accionEnCurso,
				disabledHint: !canFacturar
					? 'Facturar requiere área de Facturación o Administración.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las filas seleccionadas está facturada.',
				onSelect: desasociarSeleccion
			},
			{
				id: 'reversar-aprobacion',
				label: 'Reversar aprobación',
				hint: `Devuelve a LIQUIDADA las ${reversables.length} fila(s) APROBADAS de la selección.`,
				icon: icoDesasociar,
				tone: 'red',
				badge: reversables.length || null,
				disabled: reversables.length === 0 || !canRevertirALiquidada || !!accionEnCurso,
				disabledHint: !canRevertirALiquidada
					? 'Solo Administración puede reversar una aprobación.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las liquidaciones seleccionadas está APROBADA.',
				onSelect: reversarAprobacionSeleccion
			},
			{
				id: 'devolver-borrador',
				label: 'Devolver a borrador',
				hint: `Devuelve a BORRADOR las ${devolvibles.length} fila(s) en LIQUIDADA de la selección.`,
				icon: icoDesasociar,
				tone: 'red',
				badge: devolvibles.length || null,
				disabled: devolvibles.length === 0 || !canRevertirABorrador || !!accionEnCurso,
				disabledHint: !canRevertirABorrador
					? 'Devolver a borrador requiere área de Administración u Operaciones.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Ninguna de las liquidaciones seleccionadas está en LIQUIDADA.',
				onSelect: devolverABorradorSeleccion
			},
			{
				id: 'eliminar',
				label: 'Eliminar liquidaciones',
				hint: `Archiva (soft-delete) las ${borradores.length} liquidación(es) en BORRADOR de la selección.`,
				icon: icoPapelera,
				tone: 'red',
				badge: borradores.length || null,
				disabled: borradores.length === 0 || !canEliminar || !!accionEnCurso,
				disabledHint: !canEliminar
					? 'Tu área no puede eliminar liquidaciones.'
					: seleccionLiq.length === 0
						? 'Selecciona filas en la hoja para empezar.'
						: 'Solo se pueden eliminar liquidaciones en BORRADOR.',
				onSelect: eliminarSeleccion
			},
			{ type: 'sep' },
			{
				id: 'config',
				label: 'Configuración del liquidador',
				hint: 'Salario base, porcentajes y valores por defecto del cálculo.',
				icon: icoEngranaje,
				disabled: !canConfigurar,
				disabledHint: 'Solo Administración u Operaciones pueden ver la configuración.',
				onSelect: () => (modalConfig = true)
			},
			{
				id: 'operadoras',
				label: 'Operadoras',
				hint: 'Añadir o retirar operadoras del desplegable del formulario.',
				icon: icoEngranaje,
				disabled: !canConfigurar,
				disabledHint: 'Solo Administración u Operaciones administran el catálogo.',
				onSelect: () => (modalOperadoras = true)
			},
			{
				id: 'recargar',
				label: resincronizando ? 'Resincronizando…' : 'Recargar historial',
				hint: 'Vuelve a leer liquidaciones, facturas y terceros desde el servidor.',
				icon: icoRecargar,
				busy: resincronizando,
				disabled: loading || !!accionEnCurso,
				onSelect: resincronizar
			},
			{
				id: 'excel',
				label: exportando ? 'Generando…' : 'Exportar a Excel',
				hint: 'Descarga el histórico visible como XLSX, una fila por ítem, con los importes como número y filtros en la cabecera.',
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
	liquidaciones={aprobadasCompletas}
	preselectedIds={aprobadas.map((f) => f.id)}
	on:created={(e) => onFacturaCreada(e.detail.factura)}
	on:close={() => (modalFacturar = false)}
/>

<ModalConfigLiquidador open={modalConfig} onClose={() => (modalConfig = false)} />

<!-- `onCambios` recarga el historial: la columna OPERADORA de la hoja se pinta
     con el texto que traen las liquidaciones, así que renombrar una operadora
     no cambia lo ya pintado hasta que se relee. -->
<ModalOperadoras
	open={modalOperadoras}
	onClose={() => (modalOperadoras = false)}
	onCambios={resincronizar}
/>

<ModalLiquidacion
	solicitud={solicitudEditor}
	onClose={() => (solicitudEditor = null)}
	onGuardada={guardadaEnElModal}
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

{#snippet icoNueva()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M12 5v14M5 12h14" />
	</svg>
{/snippet}

{#snippet icoEditar()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
	</svg>
{/snippet}

{#snippet icoOjo()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
		<circle cx="12" cy="12" r="3" />
	</svg>
{/snippet}

{#snippet icoAprobar()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
		<path d="m9 11 3 3L22 4" />
	</svg>
{/snippet}

{#snippet icoPapelera()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
		<path d="M10 11v6M14 11v6" />
	</svg>
{/snippet}

{#snippet icoEngranaje()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.5a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
		/>
	</svg>
{/snippet}

{#snippet icoRecargar()}
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<path d="M21 12a9 9 0 1 1-3-6.7" />
		<path d="M21 3v6h-6" />
	</svg>
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

	.hs-conexion {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		white-space: nowrap;
	}
	.hs-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #34d399;
	}
	.hs-conexion-off {
		color: #fca5a5;
	}
	.hs-conexion-off .hs-dot {
		background: #f87171;
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
