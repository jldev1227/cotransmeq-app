<script lang="ts">
	/**
	 * Canvas de INGRESOS DE COTRANSMEQ.
	 *
	 * Réplica de las hojas «OTROS INGRESOS <MES>» y «ADICIONALES <MES>» del
	 * formato GAF-FR-11. El libro tiene SOLO las DOS hojas del mes que se está
	 * mirando —«INGRESOS» y «ADICIONALES»—; el mes se elige en el selector del
	 * header y reconstruye el libro. Antes eran las 24 del año en la sheet bar,
	 * y encontrar la del mes que se estaba liquidando era el paso más lento de
	 * la vista.
	 *
	 * LA TABLA ES DERIVADA, LA CAPA DE ENCIMA NO. Las filas son items de
	 * `liquidacion_tercero` que dejaron ingreso a la empresa
	 * (`ingreso_empresa != 0`, positivo o negativo), cuyo servicio está
	 * FACTURADO y que no se liquidaron ya por la vía OCASIONAL. Se leen en
	 * vivo — una fila por SERVICIO, no consolidadas por cliente. Sin factura
	 * el ingreso todavía no es cobrable; y lo que ya se pagó al tercero en un
	 * ocasional se contaría dos veces. Son dos condiciones distintas y no se
	 * solapan (ver la medición en `whereIngresos`,
	 * `liquidaciones-terceros-ingresos.service.ts`); el filtro vive ahí, no
	 * en el cliente.
	 *
	 * Lo que sí se guarda es lo que el equipo decide sobre ellas: qué
	 * servicios bajan a la hoja de adicionales (columna INCLUIR), con qué
	 * cantidad y porcentajes, y los conceptos del pie de cada hoja. Eso vive en
	 * `liquidacion_ingreso_transmeralda*` y es lo que persiste el autoguardado.
	 *
	 * EL CIRCUITO ENTRE LAS DOS HOJAS: la de adicionales liquida por su cuenta
	 * hasta un TRANSPORTE POR PAGAR, y ese número vuelve a la de ingresos como
	 * «TOTAL DESCUENTOS LIQUIDACIÓN ADICIONALES <MES> <AÑO>».
	 *
	 * MARCAR INCLUIR NO REMONTA EL LIBRO. Lo hacía, porque la hoja de
	 * adicionales ganaba o perdía una fila entera y con ella se movían su pie y
	 * la referencia que la otra hoja hace a su total; cada clic en una casilla
	 * desmontaba Univer y lo volvía a montar, y lo que se veía era la pantalla
	 * en blanco medio segundo. Ahora la hoja de adicionales lleva SIEMPRE una
	 * fila por cada servicio del mes y esconde las no marcadas, así que su
	 * geometría no depende de la columna INCLUIR: la casilla entra en las
	 * fórmulas de su fila, el motor recalcula el documento entero solo, y aquí
	 * solo queda enseñar u ocultar esa fila (`sincronizarIncluir` del engine).
	 * El porqué largo está en el encabezado del builder.
	 *
	 * Se refleja EN EL ACTO, sin esperar al guardado: el adicional aparece en su
	 * hoja mientras el autoguardado viaja, y se anuncia por el socket para que
	 * quien tenga el mes abierto lo vea aparecer también.
	 *
	 * El eje del libro es el PERIODO: cambiar de mes remonta el engine.
	 */

	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		liquidacionesTercerosIngresosAPI,
		type ConceptoIngreso,
		type EstadoIngresoMes,
		type HojaIngreso,
		type IngresoTerceroRow
	} from '$lib/api/liquidaciones-terceros-ingresos';
	import {
		createIngresosEngine,
		disposeEngine,
		type IngresosEngineContext
	} from '$lib/editor/univer/ingresos-terceros-engine';
	import { installIngresosCellPermission } from '$lib/editor/univer/cell-permission-ingresos';
	import { attachIngresosCellChangeAdapter } from '$lib/editor/univer/adapters/cell-change-ingresos';
	import { clearIngresosBindings } from '$lib/editor/business/ingresos-cell-binding';
	import {
		alcanceIngresos,
		calcularTotales,
		conceptosParaGuardar,
		ensureConceptosIngresos,
		esClientePrioritario,
		idsSembrados,
		nombresDeFabrica,
		indexarFilas,
		ordenarFilasIngresos,
		porcentajesDe,
		siguienteOrden
	} from '$lib/editor/business/ingresos-transmeralda';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import * as realtimeCollab from '$lib/stores/realtimeCollab';
	import { canvasAnotacionesAPI, type AnotacionesPorMes } from '$lib/api/canvas-anotaciones';
	import { createSheetSession, type SheetSession } from '$lib/editor/canvas/sheet-session.svelte';
	import {
		VersionesAnotaciones,
		emitirAnotacion,
		parseIdAnotacion
	} from '$lib/editor/canvas/anotaciones';
	import type { ICellData } from '@univerjs/core';
	import { filaDeAncla, numeroDeCapa } from '$lib/editor/business/zona-libre';
	import { authStore } from '$lib/stores/auth';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import UniverSideRail from '$lib/components/univer/UniverSideRail.svelte';
	import ModalFilasIngresos from '$lib/components/univer/ModalFilasIngresos.svelte';
	import SelectorCanvasTerceros from '$lib/components/univer/SelectorCanvasTerceros.svelte';
	import PreviewCanvasModal from '$lib/components/liquidaciones-terceros/preview/PreviewCanvasModal.svelte';
	import EnvioHojaModal from '$lib/components/liquidaciones-terceros/envios/EnvioHojaModal.svelte';
	import {
		documentoIngresos,
		HOJAS_INGRESOS
	} from '$lib/components/liquidaciones-terceros/preview/datos/ingresos.doc';
	import {
		exportarExcelLibro,
		type HojaLibro
	} from '$lib/components/liquidaciones-terceros/preview/exportar-excel';
	import {
		exportarZipPdfs,
		type HojaPdf
	} from '$lib/components/liquidaciones-terceros/preview/exportar-zip';
	import {
		nombreArchivoAnual,
		nombreArchivoHoja
	} from '$lib/components/liquidaciones-terceros/preview/formato';
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
	// El eje del WORKBOOK es el PERIODO: el libro solo lleva las dos hojas de
	// un mes, así que cambiar `anio` O `mesActivo` implica otro unitId y por
	// tanto teardown + remount. `hojaActiva` sí es solo la pestaña.
	let anio = $state(Number($page.url.searchParams.get('anio')) || new Date().getFullYear());
	let mesActivo = $state(mesValido(Number($page.url.searchParams.get('mes'))));
	/// Cuál de las dos hojas del mes está en pantalla. Va en la URL para que un
	/// enlace pueda apuntar directo a la de adicionales.
	let hojaActiva = $state<HojaIngreso>(
		$page.url.searchParams.get('hoja') === 'adic' ? 'ADICIONALES' : 'INGRESOS'
	);

	let loading = $state(true);
	let loadError = $state('');
	let container: HTMLDivElement | null = $state(null);
	let ctx: IngresosEngineContext | null = null;
	let canvasDisposers: Array<() => void> = [];

	/// Filas derivadas por mes (claves 1..12), tal cual llegan del servidor.
	let filasPorMes = $state<Record<number, IngresoTerceroRow[]>>({});
	/// Capa EDITABLE por mes: cabecera con los porcentajes, overrides por
	/// servicio y conceptos del pie. Es lo único que persiste este canvas.
	let estadoPorMes = $state<Record<number, EstadoIngresoMes>>({});

	/**
	 * Capa de ANOTACIONES.
	 *
	 * Esta vista es DERIVADA: no hay nada suyo que editar. Las notas son lo
	 * único escribible, y justo por eso valen aquí — es la forma de dejar una
	 * observación sobre unos números que se recalculan solos.
	 */
	let anotaciones = $state<AnotacionesPorMes>({});
	let session: SheetSession | null = null;
	const versionesAnot = new VersionesAnotaciones();
	/// `true` mientras se pinta una anotación remota (guarda anti-eco).
	let aplicandoRemoto = false;

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
			aplicandoRemoto = true;
			rango?.setValue(valorDeAnotacion(valor, rango?.getCellData?.() ?? null));
		} catch (e) {
			console.warn('[ingresos-canvas] no se pudo pintar la anotación', e);
		} finally {
			aplicandoRemoto = false;
		}
	}

	/**
	 * Aplica un INCLUIR marcado por OTRO usuario.
	 *
	 * No se marca el mes como sucio: quien lo marcó es el que lo está
	 * guardando. Lo que sí hay que hacer es llevarlo a la hoja, que es lo que
	 * hace `programarSincronizacionIncluir` — y ahí incluye escribir la propia
	 * casilla, porque este cambio no ha pasado por el teclado de nadie aquí.
	 */
	function aplicarIncluirRemoto(mes: number, itemId: string, incluir: boolean) {
		const estado = estadoPorMes[mes] ?? { cabecera: null, filas: [], conceptos: [] };
		const idx = estado.filas.findIndex((f) => f.liquidacion_tercero_id === itemId);
		if (idx >= 0 && estado.filas[idx].incluir_adicional === incluir) return;
		const filas = [...estado.filas];
		if (idx >= 0) filas[idx] = { ...filas[idx], incluir_adicional: incluir };
		// Se materializa incluso un `false`: sin la fila, la preselección de
		// clientes prioritarios volvería a marcarlo en la siguiente lectura.
		else filas.push({ liquidacion_tercero_id: itemId, incluir_adicional: incluir, cantidad: 1 });
		setEstadoMes(mes, { filas });
		programarSincronizacionIncluir(mes);
	}

	/// Sesión de colaboración: la capa de notas y el INCLUIR, que es la única
	/// decisión con la que dos personas pueden pisarse en vivo.
	function abrirSesion() {
		if (session || !$authStore.user) return;
		session = createSheetSession({
			scope: 'ingresos',
			anio,
			user: {
				id: $authStore.user.id,
				name: $authStore.user.nombre || $authStore.user.correo || 'Usuario'
			},
			onAck: ({ entity_id, version }) => {
				// El acuse del INCLUIR comparte canal con el de las notas, pero su
				// `entity_id` es un uuid de servicio y no un ancla: guardarlo en el
				// registro de versiones de anotaciones lo llenaría de basura.
				if (version != null && parseIdAnotacion(entity_id)) {
					versionesAnot.set(mesActivo, entity_id, version);
				}
			},
			onRemotePatch: (p) => {
				if (p.entity_type === 'fila' && p.field === 'incluir_adicional') {
					aplicarIncluirRemoto(Number(p.mes), String(p.entity_id), p.value === true);
					return;
				}
				if (p.entity_type !== 'anotacion') return;
				const a = parseIdAnotacion(p.entity_id);
				if (!a) return;
				versionesAnot.set(p.mes, p.entity_id, p.version);
				pintarAnotacion(p.mes, aCelda(a.ancla), p.value as string | null);
			},
			onConflict: (c) => {
				const a = parseIdAnotacion(c.entity_id);
				if (!a || !c.server_row) return;
				versionesAnot.set(mesActivo, c.entity_id, (c.server_row as any).version);
				pintarAnotacion(mesActivo, aCelda(a.ancla), (c.server_row as any).valor ?? null);
			}
		});
	}

	let filasMesActivo = $derived(ordenarFilasIngresos(filasPorMes[mesActivo] ?? []));
	let periodDisplay = $derived(`${MESES[mesActivo - 1] || ''} ${anio}`);
	let estadoMesActivo = $derived(
		estadoPorMes[mesActivo] ?? { cabecera: null, filas: [], conceptos: [] }
	);
	let pctActivos = $derived(porcentajesDe(estadoMesActivo.cabecera));

	/**
	 * Totales del mes activo, calculados con las MISMAS expresiones que pinta
	 * la hoja (`calcularTotales` es su única implementación en el cliente).
	 *
	 * Sin esto el subtítulo tendría su propia aritmética y acabaría
	 * contradiciendo a la hoja que el usuario tiene delante, que es
	 * exactamente el fallo que hubo que perseguir en los otros canvas.
	 */
	let totalesMesActivo = $derived.by(() =>
		calcularTotales({
			items: filasMesActivo,
			porItem: indexarFilas(estadoMesActivo.filas),
			conceptos: ensureConceptosIngresos(
				estadoMesActivo.conceptos,
				alcanceIngresos(anio, mesActivo)
			),
			pct: pctActivos
		})
	);

	/**
	 * Cifra de cierre de la HOJA ACTIVA, para la tarjeta de resumen del correo.
	 *
	 * Es `VALOR SERVICIO DE TRANSPORTE A FACTURAR` (`valorAFacturar`), no el
	 * `VALOR SERVICIO DE TRANSPORTE` bruto que hay unas líneas más arriba en
	 * la hoja: lo que se factura es lo que queda DESPUÉS de los descuentos
	 * —gastos del vehículo, diversos, personal—. En adicionales de junio 2026
	 * el bruto es $7.475.410 y lo facturable $7.422.186; poner el primero
	 * anunciaba al destinatario una cifra que su liquidación no le cobra.
	 *
	 * Sale de `totalesMesActivo`, o sea de `calcularTotales`, la misma función
	 * que alimenta la hoja y el preview. Cada hoja tiene la suya: mandar la
	 * del mes en vez de la de la hoja sería un número que su PDF no contiene.
	 */
	let resumenEnvio = $derived([
		{
			etiqueta: 'Valor servicio de transporte a facturar',
			valor: `$${formatCOP(
				hojaActiva === 'INGRESOS'
					? totalesMesActivo.ingresos.valorAFacturar
					: totalesMesActivo.adicionales.valorAFacturar
			)}`
		}
	]);

	let serviciosCount = $derived(filasMesActivo.length);
	let marcadosCount = $derived(totalesMesActivo.filasAdicionales.length);
	/// Servicios con ingreso NEGATIVO. Se cuentan aparte porque son los que hay
	/// que revisar: un mes con muchos suele ser un error de captura.
	let negativosCount = $derived(filasMesActivo.filter((f) => (f.ingreso_empresa || 0) < 0).length);
	let totalIngresoAnual = $derived(
		Object.values(filasPorMes)
			.flat()
			.reduce((s, f) => s + (f.ingreso_empresa || 0), 0)
	);

	/**
	 * Preview del documento de la HOJA ACTIVA, con exportación a PDF.
	 *
	 * Un preview es de UNA hoja. Las dos del mes se imprimen, se archivan y se
	 * entregan por separado, así que meterlas en el mismo PDF —como se hacía—
	 * dejaba sin forma de mandar solo la de adicionales. Siguen encadenadas
	 * (el TRANSPORTE POR PAGAR de adicionales es una línea del pie de
	 * ingresos) y por eso `documentoIngresos` calcula las dos aunque emita
	 * una; lo que ya no comparten es el papel.
	 *
	 * La hoja que se previsualiza es la que está en pantalla, y desde la barra
	 * del preview se puede saltar a la otra sin cerrarlo.
	 *
	 * Se monta encima del canvas y no en otra ruta: salir desmontaría el
	 * libro Univer y volver costaría recargar el año entero.
	 */
	// ─── Filas del pie ─────────────────────────────────────
	/**
	 * El pie abre un número FIJO de filas libres por bloque (ver `semillasIngresos`).
	 * Mientras alcancen se editan en la propia hoja, que es mejor sitio; este
	 * modal es para cuando NO alcanzan —un quinto gasto, una quinta retención— y
	 * para quitar las que se añadieron de más.
	 */
	let modalFilas = $state(false);
	let guardandoFila = $state(false);

	/// Los conceptos del mes ya SEMBRADOS: es lo que pinta la hoja, y es contra
	/// eso contra lo que el modal cuenta y compara nombres.
	let conceptosSembrados = $derived(
		ensureConceptosIngresos(estadoMesActivo.conceptos, alcanceIngresos(anio, mesActivo))
	);
	let sembradosDelMes = $derived(idsSembrados(alcanceIngresos(anio, mesActivo)));
	/// Cuántas filas del pie de la HOJA ACTIVA puso alguien a mano. Es el badge
	/// del carril: lo sembrado no cuenta, que está siempre.
	let filasManualesHoja = $derived(
		conceptosSembrados.filter(
			(c) => c.hoja === hojaActiva && c.id && !sembradosDelMes.has(c.id)
		).length
	);

	/// Hubo altas, bajas o ediciones desde que se abrió el modal.
	let hayCambiosEnFilas = $state(false);

	/**
	 * Aplica un cambio en las filas del pie SIN remontar la hoja.
	 *
	 * El remonte se hace UNA vez, al cerrar el modal (`cerrarModalFilas`). Antes
	 * cada alta guardaba y releía el mes de forma síncrona: eran doce segundos
	 * de espera por fila, y editar el nombre de una celda habría mandado una
	 * petición por letra. Aquí solo se toca el modelo —así la lista del modal se
	 * repinta al momento— y el autoguardado hace el resto.
	 */
	function aplicarFilas(conceptos: ConceptoIngreso[]) {
		setEstadoMes(mesActivo, { conceptos });
		marcarSucio(mesActivo);
		scheduleSave(mesActivo);
		hayCambiosEnFilas = true;
	}

	/**
	 * Cierra el modal y, si algo cambió, deja la hoja al día.
	 *
	 * El remonte es obligatorio y no cosmético: el pie gana o pierde filas
	 * enteras, y con ellas se mueven los totales y —en la hoja de adicionales—
	 * la fila que la de ingresos referencia con `TOTAL DESCUENTOS LIQUIDACIÓN
	 * ADICIONALES`. Repintar celdas sueltas dejaría esa referencia apuntando a
	 * una fila que ya no es la del total.
	 */
	async function cerrarModalFilas() {
		modalFilas = false;
		if (!hayCambiosEnFilas) return;
		hayCambiosEnFilas = false;
		const mes = mesActivo;
		guardandoFila = true;
		try {
			await flushSave(mes);
			await recargarMes(mes);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudieron aplicar los cambios del pie');
		} finally {
			guardandoFila = false;
		}
	}

	function editarFilaPie(id: string, cambios: Partial<ConceptoIngreso>) {
		aplicarFilas(conceptosSembrados.map((c) => (c.id === id ? { ...c, ...cambios } : c)));
	}

	/**
	 * Devuelve una fila del pie a su nombre de fábrica y a cero.
	 *
	 * Es lo que sustituye a «borrar» en las filas sembradas: borrarlas no sirve
	 * de nada porque `ensureConceptosIngresos` las repone en la siguiente
	 * lectura. Vaciadas, el guardado las descarta y vuelven a ser lo que eran.
	 */
	function vaciarFilaPie(id: string) {
		const original = nombresDeFabrica(alcanceIngresos(anio, mesActivo)).get(id);
		aplicarFilas(
			conceptosSembrados.map((c) =>
				c.id === id
					? {
							...c,
							concepto: original ?? c.concepto,
							valor_total: 0,
							valor_unitario: 0,
							dias: null
						}
					: c
			)
		);
	}

	function agregarFilaPie(nueva: {
		hoja: HojaIngreso;
		tipo: 'GASTO_OPERATIVO' | 'ANTICIPO' | 'IMPUESTO';
		concepto: string;
		valor_total: number;
		porcentaje: number | null;
	}) {
		if (guardandoFila) return;
		{
			// `crypto.randomUUID()` y no un id de semilla: `conceptosParaGuardar`
			// conserva SIEMPRE lo que no corresponde a ninguna semilla, así que una
			// fila con id propio sobrevive aunque se quede en cero.
			const fila: ConceptoIngreso = {
				id: crypto.randomUUID(),
				hoja: nueva.hoja,
				tipo: nueva.tipo,
				concepto: nueva.concepto,
				persona: null,
				dias: null,
				valor_unitario: 0,
				porcentaje: nueva.porcentaje,
				valor_total: nueva.valor_total,
				base_calculo: nueva.tipo === 'IMPUESTO' ? 0 : null,
				orden: siguienteOrden(conceptosSembrados, nueva.hoja, nueva.tipo)
			};
			aplicarFilas([...conceptosSembrados, fila]);
		}
	}

	function eliminarFilaPie(id: string) {
		if (guardandoFila) return;
		// Basta con no mandarla: el guardado reemplaza los conceptos en bloque.
		aplicarFilas(conceptosSembrados.filter((c) => c.id !== id));
	}

	let previewAbierto = $state(false);
	/**
	 * Envío por correo de la HOJA ACTIVA: el PDF adjunto es este mismo
	 * documento, compuesto AL ENVIAR con lo que hay en pantalla (igual que
	 * el preview y el ZIP). No hay destinatario por defecto: se escribe en
	 * el modal, y la constancia queda en `liquidacion_tercero_envio`.
	 */
	let envioAbierto = $state(false);
	function documentoHojaActiva() {
		if (!filasMesActivo.length) return null;
		return documentoIngresos({
			hoja: hojaActiva,
			items: filasMesActivo,
			filas: estadoMesActivo.filas,
			conceptos: ensureConceptosIngresos(
				estadoMesActivo.conceptos,
				alcanceIngresos(anio, mesActivo)
			),
			pct: pctActivos,
			mes: mesActivo,
			anio
		});
	}
	let documentoPreview = $derived(
		previewAbierto
			? documentoIngresos({
					hoja: hojaActiva,
					items: filasMesActivo,
					filas: estadoMesActivo.filas,
					conceptos: ensureConceptosIngresos(
						estadoMesActivo.conceptos,
						alcanceIngresos(anio, mesActivo)
					),
					pct: pctActivos,
					mes: mesActivo,
					anio
				})
			: null
	);

	/**
	 * Exportación del LIBRO del año a un solo XLSX.
	 *
	 * Aquí «todas las hojas» son DOS por mes —otros ingresos y adicionales—,
	 * porque eso es lo que el canvas tiene: hasta veinticuatro pestañas. En
	 * el papel van separadas a propósito (ver la nota del preview), pero el
	 * XLSX es lo contrario: se abre para cuadrar el año de una sentada, y
	 * partirlo en dos ficheros obligaría a cruzarlos a mano —cuando además
	 * están encadenados, que el TRANSPORTE POR PAGAR de adicionales es una
	 * línea del pie de ingresos.
	 *
	 * Se compone de lo que hay EN MEMORIA, igual que el preview.
	 */
	let exportandoExcel = $state(false);

	async function exportarLibroExcel() {
		if (exportandoExcel) return;

		const hojas: HojaLibro[] = [];
		for (let m = 1; m <= 12; m++) {
			const filas = ordenarFilasIngresos(filasPorMes[m] ?? []);
			// Un mes sin servicios no da pestaña —ni la de ingresos ni la de
			// adicionales, que sale de los mismos servicios marcados.
			if (!filas.length) continue;

			const estado = estadoPorMes[m] ?? { cabecera: null, filas: [], conceptos: [] };
			const comun = {
				items: filas,
				filas: estado.filas,
				conceptos: ensureConceptosIngresos(estado.conceptos, alcanceIngresos(anio, m)),
				pct: porcentajesDe(estado.cabecera),
				mes: m,
				anio
			};

			// El orden importa: las dos hojas de un mes van seguidas, que es
			// como se leen. Doce meses de ingresos y luego doce de adicionales
			// obligaría a saltar de un extremo al otro del libro.
			for (const hoja of ['INGRESOS', 'ADICIONALES'] as HojaIngreso[]) {
				hojas.push({
					nombre: `${MESES[m - 1]} · ${HOJAS_INGRESOS[hoja].chip}`,
					documento: documentoIngresos({ hoja, ...comun })
				});
			}
		}

		if (hojas.length === 0) {
			toast.error(`${anio} no tiene ingresos de terceros en ningún mes.`);
			return;
		}

		exportandoExcel = true;
		const aviso = toast.loading(`Generando el Excel de ${hojas.length} hoja(s)…`);
		try {
			await exportarExcelLibro('ingresos', hojas, nombreArchivoAnual('INGRESOS', anio));
			toast.success(`Excel de ${anio} generado con ${hojas.length} hoja(s).`, {
				id: aviso,
				description: 'Cada mes lleva su hoja de otros ingresos y la de adicionales.'
			});
		} catch (e: any) {
			console.error('[ingresos-canvas] export XLSX', e);
			toast.error('No se pudo generar el Excel', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoExcel = false;
		}
	}

	/**
	 * Un PDF por hoja, todas las del año en un ZIP.
	 *
	 * Aquí son DOS por mes: otros ingresos y adicionales van por separado a
	 * propósito —ver la nota del preview—, así que el lote las mantiene
	 * separadas también, cada una en su fichero. Es el mismo papel del
	 * preview, hoja por hoja; ver `exportar-zip.ts`.
	 */
	let exportandoZip = $state(false);

	async function exportarZipPdf() {
		if (exportandoZip) return;

		const hojas: HojaPdf[] = [];
		for (let m = 1; m <= 12; m++) {
			const filas = ordenarFilasIngresos(filasPorMes[m] ?? []);
			if (!filas.length) continue;

			const estado = estadoPorMes[m] ?? { cabecera: null, filas: [], conceptos: [] };
			const comun = {
				items: filas,
				filas: estado.filas,
				conceptos: ensureConceptosIngresos(estado.conceptos, alcanceIngresos(anio, m)),
				pct: porcentajesDe(estado.cabecera),
				mes: m,
				anio
			};
			for (const hoja of ['INGRESOS', 'ADICIONALES'] as HojaIngreso[]) {
				hojas.push({
					nombreArchivo: nombreArchivoHoja(HOJAS_INGRESOS[hoja].archivo, m, anio),
					documento: documentoIngresos({ hoja, ...comun })
				});
			}
		}

		if (hojas.length === 0) {
			toast.error(`${anio} no tiene ingresos de terceros en ningún mes.`);
			return;
		}

		exportandoZip = true;
		const aviso = toast.loading(`Generando 0 de ${hojas.length} PDF…`);
		try {
			const { generados, fallidas } = await exportarZipPdfs(
				'ingresos',
				hojas,
				nombreArchivoAnual('INGRESOS', anio),
				{
					onProgreso: (hechas, total) =>
						toast.loading(`Generando ${hechas} de ${total} PDF…`, { id: aviso })
				}
			);
			toast.success(`ZIP con ${generados} PDF de ${anio}.`, {
				id: aviso,
				description: fallidas.length
					? `${fallidas.length} no se pudo(ieron) renderizar.`
					: 'Cada mes lleva su PDF de otros ingresos y el de adicionales.'
			});
		} catch (e: any) {
			console.error('[ingresos-canvas] export ZIP', e);
			toast.error('No se pudo generar el ZIP', {
				id: aviso,
				description: e?.message || 'Error desconocido'
			});
		} finally {
			exportandoZip = false;
		}
	}

	/// Las dos hojas del mes, para el selector de la barra del preview. Con la
	/// etiqueta corta: el título largo ya está en la propia barra.
	const PESTANAS_PREVIEW = [
		{ id: 'INGRESOS', label: HOJAS_INGRESOS.INGRESOS.chip },
		{ id: 'ADICIONALES', label: HOJAS_INGRESOS.ADICIONALES.chip }
	];

	let anios = $derived.by(() => {
		const actual = new Date().getFullYear();
		const out: number[] = [];
		for (let a = actual - 3; a <= actual + 1; a++) out.push(a);
		if (!out.includes(anio)) out.unshift(anio);
		return out;
	});

	/**
	 * Token de montaje. `mountEngineNow` es async, así que cambiar de año
	 * dos veces seguidas puede solapar un mount con un teardown en curso y
	 * dejar el canvas atado a un engine ya destruido. Cada montaje
	 * incrementa el token y aborta si al volver de un `await` el token ya
	 * no es el suyo.
	 */
	let mountToken = 0;

	// ─── Sincronización de la URL ──────────────────────────
	/// `replaceState` y no `goto`: un `goto` reejecutaría el load de la ruta
	/// y, en el peor caso, remontaría el canvas al cambiar de pestaña.
	function syncUrl() {
		if (!browser) return;
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(anio));
		url.searchParams.set('mes', String(mesActivo));
		url.searchParams.set('hoja', hojaActiva === 'ADICIONALES' ? 'adic' : 'ing');
		window.history.replaceState({}, '', url);
	}

	// ─── Autosave por mes ──────────────────────────────────
	// Un timer y un flag en vuelo POR MES: cada mes persiste contra SU cabecera
	// (`@@unique([mes, anio])`), así que un flush de MARZO no debe cancelar ni
	// esperar al de ABRIL.
	const SAVE_DELAY = 800;
	const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const savingMeses = new Set<number>();

	let isSaving = $state(false);
	let lastSavedAt: string | null = $state(null);
	let mesesSucios = $state<Set<number>>(new Set());
	let isDirty = $derived(mesesSucios.size > 0);

	/**
	 * Nº de edición por mes. Sube con CADA cambio.
	 *
	 * El guardado tarda, y en ese rato el usuario sigue escribiendo. Sin este
	 * contador, dar el mes por limpio al terminar la petición daba por guardado
	 * TAMBIÉN lo que se escribió mientras viajaba: se veía en pantalla, ya no
	 * estaba sucio y no se enviaba nunca.
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

	function setEstadoMes(mes: number, patch: Partial<EstadoIngresoMes>) {
		const actual = estadoPorMes[mes] ?? { cabecera: null, filas: [], conceptos: [] };
		estadoPorMes = { ...estadoPorMes, [mes]: { ...actual, ...patch } };
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

		const estado = estadoPorMes[mes];
		if (!estado) return;

		savingMeses.add(mes);
		isSaving = true;
		realtimeCollab.setSaveStatus('saving');
		// Revisión que ESTE envío deja guardada. Lo que se edite a partir de aquí
		// sube el contador y no puede darse por limpio al terminar.
		const revisionEnviada = revisionPorMes.get(mes) ?? 0;
		try {
			const pct = porcentajesDe(estado.cabecera);
			const r = await liquidacionesTercerosIngresosAPI.guardar({
				mes,
				anio,
				pct_admon_ingresos: pct.admonIngresos,
				pct_ganancia_adicionales: pct.gananciaAdicionales,
				pct_admon_adicionales: pct.admonAdicionales,
				filas: estado.filas,
				// Se SIEMBRA y luego se FILTRA. Sembrar, porque una fila del pie
				// que el usuario acaba de rellenar puede no existir todavía en la
				// base; filtrar, porque el pie abre filas libres para poder
				// nombrar un gasto cualquiera y las que nadie tocó no tienen nada
				// que guardar. `conceptosParaGuardar` descarta también los tipos
				// retirados que arrastre el mes.
				conceptos: conceptosParaGuardar(
					ensureConceptosIngresos(estado.conceptos, alcanceIngresos(anio, mes)),
					alcanceIngresos(anio, mes)
				)
			});
			lastSavedAt = new Date().toISOString();
			// Los totales que devuelve el servidor mandan: son los que quedaron
			// guardados, y el subtítulo debe reflejar eso y no lo que calculó el
			// cliente antes de enviar.
			if (estado.cabecera) {
				setEstadoMes(mes, {
					cabecera: { ...estado.cabecera, ...(r.totales as any) }
				});
			}
			if ((revisionPorMes.get(mes) ?? 0) === revisionEnviada) {
				marcarLimpio(mes);
				realtimeCollab.setSaveStatus('saved', lastSavedAt);
			} else {
				// Llegaron cambios mientras se guardaba: el mes sigue sucio y se
				// vuelve a encolar. El indicador no debe decir «guardado».
				scheduleSave(mes);
			}
		} catch (e: any) {
			realtimeCollab.setSaveStatus('error');
			console.error(`[ingresos-canvas] flushSave ${mes}/${anio}`, e);
			toast.error(`${MESES[mes - 1]}: ${e?.message || 'Error al guardar'}`);
		} finally {
			savingMeses.delete(mes);
			isSaving = savingMeses.size > 0;
		}
	}

	async function flushTodo() {
		await Promise.all(Array.from(mesesSucios).map((mes) => flushSave(mes)));
	}

	// ─── Montaje / teardown ────────────────────────────────
	async function mountEngineNow() {
		if (!container) return;
		const token = mountToken;
		try {
			const newCtx = createIngresosEngine({
				anotaciones,
				container,
				anio,
				filasPorMes,
				estadoPorMes,
				mesActivo,
				hojaActiva
			});
			if (token !== mountToken) {
				// Otro montaje ganó la carrera mientras construíamos: descartar
				// este engine para no dejar un Univer huérfano con su Worker.
				disposeEngine(newCtx.univer, newCtx.fUniver, newCtx.unitId, container);
				return;
			}
			ctx = newCtx;

			canvasDisposers.push(installIngresosCellPermission(newCtx.univer));

			const { ICommandService } = await import('@univerjs/core');
			if (token !== mountToken) return;
			const commandService = (newCtx.univer as any).__getInjector().get(ICommandService);

			canvasDisposers.push(
				attachIngresosCellChangeAdapter({
					unitId: newCtx.unitId,
					commandService,
					getWorkbook: () => newCtx.fUniver.getActiveWorkbook() as any,
					resolveMes: newCtx.resolveMes,
					resolveHoja: newCtx.resolveHoja,
					isApplyingRemote: () => aplicandoRemoto,
					getState: (mes) => {
						const e = estadoPorMes[mes];
						return {
							filas: e?.filas ?? [],
							// Con los conceptos SEMBRADOS, no los crudos. La hoja pinta
							// el pie completo desde el primer día, pero esas filas no
							// existen en la base hasta el primer guardado: buscándolas
							// en la lista cruda no aparecían y la edición se descartaba
							// en silencio — un cero escrito en PAPELERÍA no llegaba a
							// ninguna parte.
							conceptos: ensureConceptosIngresos(e?.conceptos ?? [], alcanceIngresos(anio, mes))
						};
					},
					setState: (mes, next) => {
						setEstadoMes(mes, next);
						marcarSucio(mes);
						scheduleSave(mes);
					},
					onActiveSheetChange: (mes, hoja) => {
						if (mes === mesActivo && hoja === hojaActiva) return;
						mesActivo = mes;
						hojaActiva = hoja;
						syncUrl();
					},
					// Cada hoja del mes tiene su propia `sheet_key` en la capa de
					// notas: sin distinguirlas, una nota escrita en la de
					// adicionales reaparecería en la de ingresos.
					sheetKeyDe: (sheetId) => (newCtx.resolveHoja(sheetId) === 'ADICIONALES' ? 'adic' : ''),
					onAnotacion: ({ mes, sheetKey, ancla, valor }) => {
						emitirAnotacion({
							session,
							versiones: versionesAnot,
							mes,
							sheetKey,
							ancla,
							valor
						});
					},
					/**
					 * Marcar o desmarcar INCLUIR enseña o esconde la fila del
					 * servicio en la hoja de adicionales; sus fórmulas y las del pie
					 * cuelgan de la propia casilla, así que el motor recalcula solo.
					 * Nada se mueve de sitio y no hace falta reconstruir el libro.
					 *
					 * Se refleja YA, con el estado local, y el autoguardado que
					 * `setState` acaba de programar sigue su curso: esperar al
					 * round-trip dejaba casi un segundo en el que la hoja de
					 * adicionales todavía no tenía el servicio recién marcado. Y se
					 * anuncia por el socket, para que quien tenga el mismo mes
					 * abierto lo vea aparecer en el momento.
					 */
					onIncluirCambiado: (mes, cambios) => {
						programarSincronizacionIncluir(mes);
						for (const c of cambios) {
							session?.enviarPatch({
								mes,
								entity_type: 'fila',
								entity_id: c.itemId,
								field: 'incluir_adicional',
								value: c.incluir,
								base_version: 0
							});
						}
					}
				})
			);
		} catch (e: any) {
			console.error('[ingresos-canvas] mount error', e);
			toast.error('Error al renderizar el canvas: ' + (e?.message || ''));
		}
	}

	/// Teardown completo: disposers de los plugins primero y `disposeEngine`
	/// (que además termina el Worker de fórmulas) al final. Invertir ese
	/// orden deja el injector inconsistente y la siguiente página Univer
	/// crashea al montar.
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
			// Sin esto los bindings del año quedarían apuntando a filas que ya no
			// existen y una edición escribiría en el registro equivocado.
			clearIngresosBindings(ctx.unitId);
		}
		ctx = null;
	}

	/// Remount completo. Se dispara al cambiar de PERIODO (año o mes), al
	/// recargar datos y al marcar INCLUIR: la geometría de las hojas cambia y
	/// repintar celdas sueltas no bastaría.
	async function remountEngine() {
		if (!container) return;
		// El libro se reconstruye desde el estado, así que ya nace con el INCLUIR
		// puesto: una sincronización en cola solo podría repintar contra la
		// geometría del engine anterior.
		if (syncPendiente) {
			clearTimeout(syncPendiente);
			syncPendiente = null;
		}
		mesesPorSincronizar = new Set();
		mountToken++;
		teardownEngine();
		await tick();
		await mountEngineNow();
	}

	/**
	 * Remount diferido y coalescido.
	 *
	 * Los avisos del adaptador se disparan DENTRO del `onCommandExecuted` de
	 * Univer: destruir ahí el mismo motor que está despachando el comando lo
	 * deja a medio camino. Se sale de la pila con un `setTimeout(0)`, que
	 * además agrupa varias celdas editadas de una vez en un solo montaje.
	 */
	let remountPendiente: ReturnType<typeof setTimeout> | null = null;
	function programarRemount() {
		if (remountPendiente) clearTimeout(remountPendiente);
		remountPendiente = setTimeout(() => {
			remountPendiente = null;
			remountEngine();
		}, 0);
	}

	// ─── INCLUIR en caliente ───────────────────────────────────
	/**
	 * Lleva a la hoja el INCLUIR de un mes sin reconstruir el libro.
	 *
	 * Diferido por lo mismo que el remount: esto se dispara dentro del
	 * `onCommandExecuted` de Univer, y despachar comandos desde ahí es
	 * despachar sobre un despacho en curso. El `setTimeout(0)` sale de esa pila
	 * y de paso agrupa un rango entero de casillas marcadas de una vez.
	 *
	 * NO se guarda qué cambió, solo QUÉ MES: al vaciar la cola se lee el estado
	 * de ese mes y se le pide al engine que se ponga al día con él. Así el
	 * resultado es el mismo llegue como llegue el cambio —una casilla, un
	 * pegado, un patch remoto— y una sincronización que se pierda la arregla la
	 * siguiente en vez de dejar la hoja describiendo algo que ya no es.
	 */
	let mesesPorSincronizar = new Set<number>();
	let syncPendiente: ReturnType<typeof setTimeout> | null = null;

	function programarSincronizacionIncluir(mes: number) {
		mesesPorSincronizar.add(mes);
		if (syncPendiente) clearTimeout(syncPendiente);
		syncPendiente = setTimeout(sincronizarIncluirPendiente, 0);
	}

	function sincronizarIncluirPendiente() {
		syncPendiente = null;
		const meses = [...mesesPorSincronizar];
		mesesPorSincronizar = new Set();
		for (const mes of meses) {
			// El libro solo lleva las dos hojas del mes activo: para el resto no
			// hay nada que pintar y el estado ya está puesto al día.
			if (mes !== mesActivo || !ctx) continue;
			const marcados = new Set(
				(estadoPorMes[mes]?.filas ?? [])
					.filter((f) => f.incluir_adicional)
					.map((f) => f.liquidacion_tercero_id)
			);
			// Guarda anti-eco: el engine escribe la casilla cuando el cambio no
			// vino del teclado de aquí (un patch remoto), y ese `setValue`
			// dispararía el adaptador como si fuera una edición local.
			aplicandoRemoto = true;
			let ok = false;
			try {
				ok = ctx.sincronizarIncluir(mes, (id) => marcados.has(id));
			} finally {
				aplicandoRemoto = false;
			}
			// El engine se planta cuando hay demasiado que repintar o cuando la
			// hoja ya no es la que él conoce. Reconstruir es lento y parpadea,
			// pero deja el libro coherente, que es lo que no se puede perder.
			if (!ok) programarRemount();
		}
	}

	// ─── Carga ─────────────────────────────────────────────
	async function loadInicial() {
		loading = true;
		loadError = '';
		try {
			const [datos, anot] = await Promise.all([
				liquidacionesTercerosIngresosAPI.obtenerAnual(anio),
				canvasAnotacionesAPI.listar('ingresos', anio).catch((e) => {
					// Que falle la capa de notas no puede impedir abrir el canvas.
					console.warn('[ingresos-canvas] anotaciones no disponibles', e);
					return {} as AnotacionesPorMes;
				})
			]);
			filasPorMes = datos.filasPorMes;
			estadoPorMes = preseleccionar(datos.filasPorMes, datos.estadoPorMes);
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
			loadError = e?.message || 'Error al cargar los ingresos del año';
		} finally {
			loading = false;
		}
	}

	/**
	 * Relee UN mes del servidor y reconstruye el libro.
	 *
	 * Se traen las DOS mitades —las filas derivadas y la capa editable— porque
	 * la hoja necesita ambas para pintar, y remontar con una recién leída y la
	 * otra en memoria dejaría las dos hojas del mes describiendo estados
	 * distintos.
	 */
	async function recargarMes(mes: number) {
		try {
			const [frescas, estado] = await Promise.all([
				liquidacionesTercerosIngresosAPI.obtenerPorPeriodo(mes, anio),
				liquidacionesTercerosIngresosAPI.obtenerEstado(mes, anio)
			]);
			filasPorMes = { ...filasPorMes, [mes]: frescas };
			estadoPorMes = preseleccionar({ [mes]: frescas }, { ...estadoPorMes, [mes]: estado });
			marcarLimpio(mes);
			await remountEngine();
		} catch (e: any) {
			console.error(`[ingresos-canvas] recargarMes ${mes}/${anio}`, e);
			toast.error(`No se pudo recargar ${MESES[mes - 1]}`);
		}
	}

	/**
	 * Deja marcados con INCLUIR los servicios de los clientes prioritarios que
	 * el equipo todavía no ha tocado.
	 *
	 * Son la mayoría de los que acaban bajando a la hoja de adicionales, así
	 * que arrancar con ellos marcados ahorra recorrer la tabla entera.
	 *
	 * SOLO EN MESES QUE NADIE HA GUARDADO TODAVÍA (`cabecera == null`). Este era
	 * el otro INCLUIR fantasma: el backend guarda las decisiones de forma
	 * dispersa y descarta las filas que no dicen nada —sin marcar y con
	 * cantidad 1—, así que desmarcar un FEPCO borraba su fila, y al releer el
	 * mes esta preselección volvía a marcarlo. La casilla se desmarcaba, se
	 * guardaba bien y reaparecía marcada. Con una cabecera ya creada, lo
	 * guardado ES la decisión del equipo y no se toca.
	 *
	 * La preselección NO se guarda sola: vive en memoria hasta que el usuario
	 * edite algo del mes. Guardarla al abrir crearía cabeceras y filas para
	 * meses que nadie ha mirado.
	 */
	function preseleccionar(
		filas: Record<number, IngresoTerceroRow[]>,
		estados: Record<number, EstadoIngresoMes>
	): Record<number, EstadoIngresoMes> {
		const out = { ...estados };
		for (const [mesStr, items] of Object.entries(filas)) {
			const mes = Number(mesStr);
			const estado = out[mes] ?? { cabecera: null, filas: [], conceptos: [] };
			if (estado.cabecera) continue;
			const yaTiene = new Set(estado.filas.map((f) => f.liquidacion_tercero_id));
			const nuevas = items
				.filter((it) => esClientePrioritario(it.cliente_nombre) && !yaTiene.has(it.id))
				.map((it) => ({
					liquidacion_tercero_id: it.id,
					incluir_adicional: true,
					cantidad: 1
				}));
			out[mes] = nuevas.length ? { ...estado, filas: [...estado.filas, ...nuevas] } : estado;
		}
		return out;
	}

	async function cambiarAnio(nuevo: number) {
		if (nuevo === anio) return;
		// El autoguardado va con debounce: sin este flush, cambiar de año dentro
		// de esa ventana perdería lo último escrito sin avisar.
		if (isDirty) await flushTodo();
		anio = nuevo;
		await loadInicial();
	}

	/**
	 * Cambia de mes o de hoja.
	 *
	 * Cambiar de HOJA es solo activar la otra pestaña del libro. Cambiar de MES
	 * es un libro distinto —solo lleva las dos hojas del suyo—, así que remonta;
	 * antes de eso se vacía el autoguardado pendiente, porque la cola va con
	 * debounce y salir de un mes dentro de esa ventana perdería lo último
	 * escrito.
	 */
	async function irAMes(mes: number, hoja: HojaIngreso = hojaActiva) {
		if (mes === mesActivo && hoja === hojaActiva) return;
		const cambiaMes = mes !== mesActivo;
		if (cambiaMes && mesesSucios.has(mesActivo)) await flushSave(mesActivo);
		mesActivo = mes;
		hojaActiva = hoja;
		syncUrl();
		if (cambiaMes) await remountEngine();
		else ctx?.activarMes(mes, hoja);
	}

	/**
	 * Cambia el porcentaje de la cabecera del mes activo.
	 *
	 * Los tres —administración de ingresos, ganancia de adicionales y
	 * administración de adicionales— entran en las FÓRMULAS de la hoja, así que
	 * cambiarlos obliga a reconstruirla: no basta con repintar celdas.
	 */
	async function cambiarPorcentaje(
		campo: 'pct_admon_ingresos' | 'pct_ganancia_adicionales' | 'pct_admon_adicionales',
		valor: number
	) {
		if (!Number.isFinite(valor)) return;
		const estado = estadoPorMes[mesActivo] ?? {
			cabecera: null,
			filas: [],
			conceptos: []
		};
		const pct = porcentajesDe(estado.cabecera);
		const cabecera = {
			...(estado.cabecera ?? {}),
			pct_admon_ingresos: pct.admonIngresos,
			pct_ganancia_adicionales: pct.gananciaAdicionales,
			pct_admon_adicionales: pct.admonAdicionales,
			[campo]: valor
		} as any;
		setEstadoMes(mesActivo, { cabecera });
		marcarSucio(mesActivo);
		try {
			await flushSave(mesActivo);
			await recargarMes(mesActivo);
		} catch (e: any) {
			toast.error('No se pudo aplicar el porcentaje: ' + (e?.message || ''));
		}
	}

	/// Vuelve al canvas de CIERRES, que es el nuevo índice del módulo, con el
	/// mismo periodo que se estaba viendo aquí: `/dashboard/liquidaciones-terceros`
	/// ya no tiene listado y su redirect aterrizaría en el mes en curso.
	function closeAndGo() {
		if (isDirty) flushTodo();
		goto(`/dashboard/liquidaciones-terceros/canvas?anio=${anio}&mes=${mesActivo}`);
	}

	onMount(() => {
		if (!browser) return;
		// Sin `connectSocket()`: de la colaboración solo se usa la capa de notas,
		// que abre su propia sesión.
		loadInicial();

		/**
		 * Aviso al recargar o cerrar con cambios sin confirmar.
		 *
		 * Hasta que el servidor responde, lo marcado solo existe en esta pestaña.
		 * Se intenta además un último flush: en muchos navegadores da tiempo a
		 * que salga la petición mientras el usuario decide en el diálogo.
		 */
		const avisarSiPendiente = (e: BeforeUnloadEvent) => {
			if (!isDirty && !isSaving) return;
			flushTodo();
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', avisarSiPendiente);
		return () => window.removeEventListener('beforeunload', avisarSiPendiente);
	});

	onDestroy(() => {
		session?.dispose();
		session = null;
		for (const t of saveTimers.values()) clearTimeout(t);
		saveTimers.clear();
		if (remountPendiente) clearTimeout(remountPendiente);
		if (syncPendiente) clearTimeout(syncPendiente);
		teardownEngine();
	});
</script>

<svelte:head>
	<title>Ingresos Cotransmeq {anio} (canvas) · Cotransmeq</title>
</svelte:head>

<UniverToolbar
	title="INGRESOS DE COTRANSMEQ: {periodDisplay}"
	hoja={hojaActiva}
	subtitle="{serviciosCount} servicio(s)  ·  {marcadosCount} en adicionales{negativosCount
		? `  ·  ${negativosCount} en negativo`
		: ''}  ·  Σ facturado ${formatCOP(
		totalesMesActivo.ingresos.facturado
	)}  ·  Liq. adicionales ${formatCOP(
		totalesMesActivo.adicionales.transportePorPagar
	)}  ·  TOTAL INGRESO ${formatCOP(
		totalesMesActivo.ingresos.totalIngresoTransmeralda
	)}  ·  Σ ingreso año ${formatCOP(totalIngresoAnual)}"
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

		<select
			class="univer-month-picker"
			value={hojaActiva}
			onchange={(e) =>
				irAMes(mesActivo, (e.currentTarget as HTMLSelectElement).value as HojaIngreso)}
			title="Ir a la hoja"
		>
			<option value="INGRESOS">Otros ingresos</option>
			<option value="ADICIONALES">Adicionales</option>
		</select>

		<!-- Los tres porcentajes de la cabecera del mes. Van aquí y no en la
		     hoja porque son de TODO el documento: cada uno entra en las fórmulas
		     de decenas de filas, y tenerlos en una celda suelta obligaría a
		     buscarla para cambiarlos. -->
		<label class="univer-pct" title="Administración sobre los ingresos del mes">
			<span>Admon</span>
			<input
				type="number"
				step="0.5"
				value={pctActivos.admonIngresos}
				onchange={(e) =>
					cambiarPorcentaje(
						'pct_admon_ingresos',
						Number((e.currentTarget as HTMLInputElement).value)
					)}
			/>
			<span>%</span>
		</label>

		<label class="univer-pct" title="Ganancia con la que un ingreso baja a la hoja de adicionales">
			<span>Ganancia</span>
			<input
				type="number"
				step="1"
				value={pctActivos.gananciaAdicionales}
				onchange={(e) =>
					cambiarPorcentaje(
						'pct_ganancia_adicionales',
						Number((e.currentTarget as HTMLInputElement).value)
					)}
			/>
			<span>%</span>
		</label>

		<label class="univer-pct" title="Administración de la hoja de adicionales">
			<span>Admon adic.</span>
			<input
				type="number"
				step="0.5"
				value={pctActivos.admonAdicionales}
				onchange={(e) =>
					cambiarPorcentaje(
						'pct_admon_adicionales',
						Number((e.currentTarget as HTMLInputElement).value)
					)}
			/>
			<span>%</span>
		</label>

		<!-- Las ACCIONES viven en el carril derecho. Aquí se quedan solo los
		     CAMPOS: año, mes, hoja y los tres porcentajes, que no son acciones
		     sino datos de la cabecera del documento y hay que poder leerlos sin
		     abrir nada. Mismo reparto que el canvas de placas.

		     Y sobre todo: eran cuatro botones en una fila que se recorta en
		     silencio al desbordar. Con los tres porcentajes delante, «Recargar
		     mes» caía fuera de pantalla en un portátil. -->

		<PresenceAvatars />
		<AutosaveIndicator />

		<!-- Sustituye al botón «Volver» que había aquí: `onBack` del toolbar ya
		     pone uno a la izquierda, así que el duplicado solo gastaba espacio
		     en una fila que se recorta en silencio al desbordar. -->
		<SelectorCanvasTerceros actual="ingresos" {anio} mes={mesActivo} />
	{/snippet}
</UniverToolbar>

{#snippet icoFilasPie()}
	<!-- Misma rejilla con «+» que «Filas del cierre» en placas y «Filas del
	     ocasional»: las tres abren lo mismo —las filas sueltas del pie— y
	     compartir silueta ahorra buscarla al saltar de un canvas a otro. -->
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M13.5 16.875h6.75M16.875 13.5v6.75" />
		<rect x="3.75" y="3.75" width="6.75" height="6.75" rx="2.25" />
		<rect x="3.75" y="13.5" width="6.75" height="6.75" rx="2.25" />
		<rect x="13.5" y="3.75" width="6.75" height="6.75" rx="2.25" />
	</svg>
{/snippet}

{#snippet icoOjo2()}
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
		<path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
	</svg>
{/snippet}

{#snippet icoZip2()}
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M4.5 6.75A2.25 2.25 0 016.75 4.5h3.129c.53 0 1.039.21 1.414.586l1.121 1.121c.375.375.884.586 1.414.586h3.522A2.25 2.25 0 0119.5 9.043v8.207a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25V6.75z" />
		<path d="M12 9.5v1M12 12v1M12 14.5v1.25" />
	</svg>
{/snippet}

{#snippet icoExcel2()}
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<rect x="3.5" y="4" width="17" height="16" rx="2" />
		<path d="M3.5 9.5h17M3.5 15h17M9.5 4v16M15 4v16" />
	</svg>
{/snippet}

{#snippet icoCorreoEnv()}
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
		<rect x="3" y="5" width="18" height="14" rx="2.5" />
		<path d="M3.5 7l8.5 6 8.5-6" />
	</svg>
{/snippet}

{#snippet icoRecargar()}
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
		<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
	</svg>
{/snippet}

<div class="ing-body">
	<div class="ing-canvas">
		<UniverCanvasHost
			bind:container
			{loading}
			error={loadError}
			loadingLabel="Cargando ingresos de {anio}..."
			onRetry={loadInicial}
			errorLabel="Reintentar"
		/>
	</div>

	<UniverSideRail
		ariaLabel="Acciones de ingresos de Cotransmeq"
		items={[
			{
				id: 'filas',
				label: 'Filas del pie',
				hint: `Añadir o quitar gastos del vehículo, anticipos${hojaActiva === 'ADICIONALES' ? ' y retenciones' : ''} del pie de ${HOJAS_INGRESOS[hojaActiva].chip}. El pie abre unas cuantas filas libres solo; esto es para cuando no alcanzan.`,
				icon: icoFilasPie,
				badge: filasManualesHoja || null,
				disabled: loading || !!loadError,
				disabledHint: 'El mes todavía se está cargando.',
				onSelect: () => (modalFilas = true)
			},
			{ type: 'sep' },
			{
				id: 'preview',
				label: 'Vista previa',
				hint: `Ver el documento de ${HOJAS_INGRESOS[hojaActiva].titulo} de ${periodDisplay} y exportarlo a PDF.`,
				icon: icoOjo2,
				onSelect: () => (previewAbierto = true)
			},
			{
				id: 'zip',
				label: 'Exportar PDF (ZIP)',
				hint: `Descargar un ZIP con un PDF por hoja de ${anio}: otros ingresos y adicionales de cada mes.`,
				icon: icoZip2,
				busy: exportandoZip,
				onSelect: exportarZipPdf
			},
			{
				id: 'excel',
				label: 'Exportar Excel',
				hint: `Descargar un .xlsx de ${anio} con TODAS las hojas del año: otros ingresos y adicionales de cada mes.`,
				icon: icoExcel2,
				busy: exportandoExcel,
				onSelect: exportarLibroExcel
			},
			{
				id: 'envio',
				label: 'Enviar por correo',
				hint: `Enviar por correo el PDF de ${HOJAS_INGRESOS[hojaActiva].titulo} de ${periodDisplay}, con destinatario y copias escritos a mano, mensaje y adjuntos adicionales. Sale a nombre de contabilidad y deja constancia de a quién y cuándo se envió.`,
				icon: icoCorreoEnv,
				disabled: loading || !!loadError || serviciosCount === 0,
				disabledHint: serviciosCount === 0 ? 'El mes no tiene servicios.' : 'El mes todavía se está cargando.',
				onSelect: () => (envioAbierto = true)
			},
			{ type: 'sep' },
			{
				id: 'recargar',
				label: 'Recargar mes',
				hint: `Volver a leer ${periodDisplay} desde el servidor. Trae los adicionales y los servicios que hayan cambiado desde que se abrió el canvas.`,
				icon: icoRecargar,
				onSelect: () => recargarMes(mesActivo)
			}
		]}
	/>
</div>

<ModalFilasIngresos
	open={modalFilas}
	hoja={hojaActiva}
	periodo={periodDisplay}
	conceptos={conceptosSembrados}
	sembrados={sembradosDelMes}
	guardando={guardandoFila}
	onAgregar={agregarFilaPie}
	onEliminar={eliminarFilaPie}
	onEditar={editarFilaPie}
	onVaciar={vaciarFilaPie}
	onClose={cerrarModalFilas}
/>

{#if envioAbierto}
	<EnvioHojaModal
		tipo="INGRESO"
		scope="ingresos"
		{anio}
		mes={mesActivo}
		hojaLabel={HOJAS_INGRESOS[hojaActiva].archivo}
		tituloCorreo={`Liquidación de ${HOJAS_INGRESOS[hojaActiva].chip.toLowerCase()}`}
		nombreArchivo={nombreArchivoHoja(HOJAS_INGRESOS[hojaActiva].archivo, mesActivo, anio)}
		resumen={resumenEnvio}
		origenId={estadoMesActivo.cabecera?.id ?? null}
		obtenerDocumento={documentoHojaActiva}
		onClose={() => (envioAbierto = false)}
	/>
{/if}

{#if previewAbierto && documentoPreview}
	<!-- El subtítulo describe LA HOJA que se está viendo, no el mes entero:
	     el documento es de una sola y su cifra de cierre es distinta en cada
	     una (TOTAL INGRESO en ingresos, TRANSPORTE POR PAGAR en adicionales). -->
	<PreviewCanvasModal
		scope="ingresos"
		documento={documentoPreview}
		subtitulo="{periodDisplay}  ·  {hojaActiva === 'INGRESOS'
			? `${serviciosCount} servicio(s)  ·  TOTAL INGRESO ${formatCOP(
					totalesMesActivo.ingresos.totalIngresoTransmeralda
				)}`
			: `${marcadosCount} servicio(s) marcado(s)  ·  TRANSPORTE POR PAGAR ${formatCOP(
					totalesMesActivo.adicionales.transportePorPagar
				)}`}"
		pestanas={PESTANAS_PREVIEW}
		pestanaActiva={hojaActiva}
		onPestana={(id) => irAMes(mesActivo, id as HojaIngreso)}
		onClose={() => (previewAbierto = false)}
	/>
{/if}

<style>
	/* Fila: canvas elástico + carril de 32px. Misma estructura que el canvas de
	   placas y el de ocasionales: `.ing-canvas` es COLUMNA para que
	   `.univer-host` conserve el padre flex-column del que cuelga su cadena de
	   altura, y `min-width: 0` evita que su `width:100%` empuje al carril fuera
	   de la pantalla. */
	.ing-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		position: relative;
	}
	.ing-canvas {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* Los selectores de periodo (.univer-year-picker / .univer-month-picker)
	   y `.univer-badge` viven en `toolbar.css`, compartidos por todos los
	   canvas. Lo de aquí abajo es propio de este canvas: los tres porcentajes
	   de la cabecera, que ningún otro tiene. */
	.univer-pct {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 30px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 8px;
		font-size: 11px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		white-space: nowrap;
	}
	.univer-pct input {
		width: 52px;
		background: rgba(255, 255, 255, 0.1);
		border: none;
		border-radius: 5px;
		padding: 3px 5px;
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		text-align: right;
	}
	.univer-pct input:focus {
		outline: 2px solid rgba(255, 255, 255, 0.45);
	}
</style>
