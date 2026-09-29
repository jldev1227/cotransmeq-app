<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';

	import {
		nominaCanvasAPI,
		nominaEnviosAPI,
		type PeriodoNominaDTO,
		type CambioEstado,
		nominaBorradoresAPI
	} from '$lib/api/nomina-canvas';
	import { toggleDesprendibleTablasVisible } from '$lib/api/nomina';
	import { nominaSheetId } from '$lib/editor/builders/nomina.builder';
	import {
		createNominaEngine,
		disposeEngine,
		type NominaEngineContext
	} from '$lib/editor/univer/nomina-engine';
	import {
		installNominaCellPermission,
		repintando
	} from '$lib/editor/univer/cell-permission-nomina';
	import { attachCellChangeNomina } from '$lib/editor/univer/adapters/cell-change-nomina';
	import { clearNominaBindings, getNominaCellFor } from '$lib/editor/business/nomina-cell-binding';
	import {
		claseBadgeEstado,
		esEditable,
		ESTADOS_BLOQUEADOS,
		permiteRefrescarDias,
		type AccionEstado
	} from '$lib/editor/builders/nomina-estado';
	import {
		isApplyingRemote,
		suprimirEco,
		aplicarCeldaRemota
	} from '$lib/editor/univer/apply-remote-patch';
	import { createSheetSession, type SheetSession } from '$lib/editor/canvas/sheet-session.svelte';

	import {
		documentoNomina,
		nombreArchivoDesprendible
	} from '$lib/components/liquidaciones-terceros/preview/datos/nomina.doc';
	import {
		exportarExcelLibro,
		type HojaLibro
	} from '$lib/components/liquidaciones-terceros/preview/exportar-excel';
	// El desprendible —vista previa, PDF suelto y ZIP— sale SIEMPRE de
	// `pdfDesprendible.ts`, que es el mismo documento que ve el conductor en
	// el portal. Aquí no se maqueta nada.
	import {
		abrirDesprendible,
		blobDesprendible,
		limpiarCacheDesprendibles
	} from '$lib/editor/canvas/desprendible-nomina';
	import { crearZip } from '$lib/components/liquidaciones-terceros/preview/zip';
	import SnapshotPanel from '$lib/components/univer/SnapshotPanel.svelte';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import SelectorCanvasNomina from '$lib/components/univer/SelectorCanvasNomina.svelte';
	import SelectorHojaNomina from '$lib/components/univer/SelectorHojaNomina.svelte';
	import ModalEnviarDesprendibles from '$lib/components/univer/ModalEnviarDesprendibles.svelte';
	import ModalNotificarNomina from '$lib/components/univer/ModalNotificarNomina.svelte';
	/// Iconos COMPARTIDOS por todos los canvas. Los propios de nómina —liquidar,
	/// aprobar, pagar…— se siguen declarando abajo: son de este dominio.
	import {
		icoVer,
		icoExcel,
		icoZip,
		icoCorreo,
		icoCampana,
		icoHistorial,
		icoRecargar,
		icoVersion,
		icoBorradores
	} from '$lib/components/univer/iconos-canvas.svelte';
	import GenerarBorradoresNominaModal from '$lib/components/nomina/GenerarBorradoresNominaModal.svelte';
	import NominaEstadoPanel from '$lib/components/nomina/NominaEstadoPanel.svelte';
	import ConceptosAdicionalesModal from '$lib/components/nomina/ConceptosAdicionalesModal.svelte';
	import DiasDesprendibleModal from '$lib/components/nomina/DiasDesprendibleModal.svelte';
	import PeriodoDesprendibleModal from '$lib/components/nomina/PeriodoDesprendibleModal.svelte';
	import type { MarcasDias } from '$lib/utils/marcasDias';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import UniverSideRail, { type RailItem } from '$lib/components/univer/UniverSideRail.svelte';
	import UniverActionOverlay from '$lib/components/univer/UniverActionOverlay.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import { authStore } from '$lib/stores/auth';

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

	const formatCOP = (v: number) =>
		new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(v || 0));

	const mesValido = (n: number) => (n >= 1 && n <= 12 ? n : new Date().getMonth() + 1);

	// ─── Ejes ──────────────────────────────────────────────
	// `anio` y `mes` son el eje del LIBRO: cambiar cualquiera de los dos
	// implica otro `unitId` y por tanto teardown + remount. El conductor
	// activo es solo la hoja, así que cambiarlo no remonta nada.
	let anio = $state(Number($page.url.searchParams.get('anio')) || new Date().getFullYear());
	let mes = $state(mesValido(Number($page.url.searchParams.get('mes'))));
	/**
	 * Día de corte del periodo. Los Excel van del 21 al 20, pero eso está
	 * deducido de los archivos y no de ninguna regla escrita, así que se deja
	 * a la vista y editable en vez de clavado en el código.
	 */
	let corte = $state(Number($page.url.searchParams.get('desde')) || 21);

	/**
	 * RANGO ESPECÍFICO en vez del corte, o `null` para liquidar por corte.
	 *
	 * Para lo que no cabe en un 21→20: un retiro del 21 al 30, un ingreso a
	 * mitad de periodo. Con rango el libro son exactamente esos días, sus hojas
	 * son las liquidaciones que CABEN dentro, y los borradores nacen con esas
	 * fechas y sus días comerciales. `anio`/`mes` siguen siendo la llave del
	 * libro (sala del socket), y se toman del mes en que termina el rango.
	 */
	const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
	const MAX_DIAS_RANGO = 62;
	function rangoDeUrl(): { desde: string; hasta: string } | null {
		const a = $page.url.searchParams.get('inicio') ?? '';
		const b = $page.url.searchParams.get('fin') ?? '';
		return FECHA_ISO.test(a) && FECHA_ISO.test(b) && a <= b ? { desde: a, hasta: b } : null;
	}
	let rango = $state<{ desde: string; hasta: string } | null>(rangoDeUrl());
	/// Lo que viaja a cada llamada del carril: el periodo tal como está en
	/// pantalla, corte o rango. Una sola fuente para no olvidar el rango en
	/// ninguna.
	const refPeriodo = () => ({
		anio,
		mes,
		corte,
		...(rango ? { inicio: rango.desde, fin: rango.hasta } : {})
	});

	let loading = $state(true);
	let loadError = $state('');
	let container: HTMLDivElement | null = $state(null);
	let ctx: NominaEngineContext | null = null;
	let canvasDisposers: Array<() => void> = [];
	let session: SheetSession | null = null;

	let datos = $state<PeriodoNominaDTO | null>(null);
	let conductorActivo = $state<string | null>(null);

	/**
	 * Hoja pedida por la URL.
	 *
	 * El enlace llevaba solo el PERIODO (`anio`, `mes`, `desde`), así que abría
	 * siempre en la primera hoja del libro: no había forma de mandarle a nadie
	 * «mira la nómina de este conductor» ni de que recargar la página te dejara
	 * donde estabas. Con veinticinco hojas eso es volver a buscar en el selector
	 * cada vez.
	 *
	 * Se acepta `liquidacion` —que es lo que se tiene a mano viniendo del listado
	 * de liquidaciones— y `conductor` como alternativa, porque una hoja sin
	 * borrador generado todavía NO tiene liquidación y aun así hay que poder
	 * enlazarla.
	 */
	const liquidacionPedida = $page.url.searchParams.get('liquidacion');
	const conductorPedido = $page.url.searchParams.get('conductor');
	const abrirPreviewPedido = $page.url.searchParams.get('preview') === '1';
	let previewAutomaticoConsumido = false;
	let previewFirmadoUrl = $state<string | null>(null);
	let previewFirmadoNombre = $state('Desprendible firmado');
	let accionEnCurso = $state<{ titulo: string; detalle?: string } | null>(null);
	let presencia = $state<{ id: string; name: string }[]>([]);
	let conectado = $state(true);
	let historialAbierto = $state(false);

	/**
	 * Escrituras en vuelo y escrituras perdidas, para el indicador de guardado.
	 *
	 * Este canvas no tiene botón de guardar: cada celda sale sola por socket en
	 * cuanto se sale de ella. Sin contador, la única señal de que el cambio
	 * llegó era que no apareciera un toast de error, que es pedirle al usuario
	 * que deduzca el éxito de la ausencia de un fallo. `pendientes` sube al
	 * emitir y baja con el acuse, el conflicto o el abandono; `fallidas` cuenta
	 * lo que el servidor rechazó o nunca acusó.
	 */
	let pendientes = $state(0);
	let fallidas = $state(0);
	/// Hora del último acuse. Propia y no la del store de `realtimeCollab`,
	/// que es de módulo y traería la del canvas por el que se pasó antes.
	let ultimoGuardado = $state<string | null>(null);

	/**
	 * `liquidacion_id → resumen de envío`, para marcar en el selector quién ya
	 * recibió su desprendible.
	 *
	 * El backend lo registra desde que existe el módulo —la propia firma del
	 * servicio dice «para pintar el estado en el canvas»— pero nadie lo pedía,
	 * así que «¿a quién ya se le mandó?» solo se podía responder mirando la
	 * base. Se carga aparte del periodo y sin bloquear: si falla, el canvas
	 * sigue funcionando y solo se pierde la marca.
	 */
	let envios = $state<Record<string, any>>({});
	let mostrarEnviar = $state(false);
	let mostrarNotificar = $state(false);

	async function cargarEnvios() {
		try {
			envios = await nominaEnviosAPI.estadoPeriodo(anio, mes);
		} catch {
			envios = {};
		}
	}

	/**
	 * Token de montaje. `mountEngineNow` es async, así que dos cambios de
	 * periodo seguidos pueden solaparse; sin el token, el montaje lento
	 * pisaría al rápido y quedaría un Univer huérfano con su Worker vivo.
	 */
	let mountToken = 0;

	const anios = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i);

	// ─── Derivados de cabecera ─────────────────────────────
	let hojaActiva = $derived(
		datos?.hojas.find((h) => h.conductorId === conductorActivo) ?? datos?.hojas[0] ?? null
	);
	let totalNeto = $derived(
		(datos?.hojas ?? []).reduce((s, h) => s + (h.totales?.sueldoTotal ?? 0), 0)
	);
	let conPlanilla = $derived((datos?.hojas ?? []).filter((h) => h.dias.length > 0).length);
	let sinPlanilla = $derived((datos?.hojas.length ?? 0) - conPlanilla);
	let areas = $derived(($authStore as any)?.user?.area ?? null);
	/**
	 * Las hojas del periodo que siguen en BORRADOR.
	 *
	 * Con liquidación: sin ella no hay estado que mover, y el conductor que
	 * todavía no la tiene aparece igualmente como BORRADOR en el índice.
	 */
	let borradoresDelPeriodo = $derived(
		(datos?.hojas ?? [])
			.filter((h) => h.liquidacionId && h.estado === 'BORRADOR')
			.map((h) => ({ liquidacionId: h.liquidacionId!, nombre: h.nombre }))
	);

	// ─── Tablas de recargos del desprendible ───────────────
	/**
	 * `mostrar_recargos` es NOT NULL con default `true`, así que la ausencia
	 * del campo —un snapshot viejo, una hoja sin liquidación— se lee como
	 * encendido: es lo que el desprendible venía haciendo.
	 */
	let hojasConLiquidacion = $derived(
		(datos?.hojas ?? []).filter((h) => h.liquidacionId)
	);
	let hojasSinTablas = $derived(
		hojasConLiquidacion.filter((h) => h.mostrarRecargos === false)
	);
	let tablasEnHojaActiva = $derived(hojaActiva?.mostrarRecargos !== false);
	let cambiandoTablas = $state(false);

	// ─── Conceptos adicionales ─────────────────────────────
	/**
	 * El alta y la baja de conceptos adicionales viven en un modal y no en una
	 * celda: añadirlos AÑADE UNA FILA al desprendible, y una hoja de cálculo
	 * no tiene dónde teclear «una fila más». Cambiar el importe de uno que ya
	 * existe sí se hace en su celda, que está bindeada como el resto.
	 */
	let mostrarAdicionales = $state(false);

	/**
	 * Los conceptos de la hoja abierta, leídos de sus propios devengos.
	 *
	 * No hay un campo aparte en el DTO a propósito: el desprendible ya los
	 * trae y duplicarlos daría dos listas que podrían decir cosas distintas.
	 * El rótulo se pinta en MAYÚSCULAS, que es también como viaja en el campo
	 * del patch (el servidor compara sin distinguir mayúsculas).
	 */
	let conceptosAdicionales = $derived(
		(hojaActiva?.devengos ?? [])
			.filter((d) => d.clave.startsWith('adicional:'))
			.map((d) => ({ nombre: d.nombre, valor: d.valor }))
	);

	/**
	 * Altas y bajas en vuelo, por campo.
	 *
	 * Sirve para distinguir en el acuse lo que CAMBIÓ LA GEOMETRÍA —una fila
	 * más o una menos, que obliga a rehacer la hoja— de un simple retoque del
	 * importe en la celda, que el canvas ya tiene pintado. Sin esta distinción
	 * cada tecleo en una celda de concepto remontaría el libro entero.
	 */
	const adicionalesEnVuelo = new Set<string>();

	function motivoBloqueoAdicionales(): string {
		if (!hojaActiva) return 'Abre la hoja de un conductor primero.';
		if (!hojaActiva.liquidacionId)
			return 'Este conductor todavía no tiene liquidación en el periodo.';
		if (ESTADOS_BLOQUEADOS.includes(hojaActiva.estado))
			return `La liquidación está en ${hojaActiva.estado}. Devuélvela a LIQUIDADA para editarla.`;
		return '';
	}

	// ─── Bonos: recálculo con rebote y restauración desde recorridos ──────
	/**
	 * Editar una celda de bono NO se puede repintar celda a celda.
	 *
	 * El servidor recalcula y devuelve los totales, pero lo que cambia en la
	 * hoja es media zona: `TOTAL BONOS` de la matriz, las líneas de bono del
	 * desprendible —que pueden nacer, irse a cero o partirse en dos cuando el
	 * corte cruza dos meses—, el subtotal de bonificaciones, el devengado y el
	 * neto. Antes no se repintaba nada: la cabecera de la página sí movía su
	 * total y la hoja seguía enseñando las cifras viejas, o sea la misma
	 * pantalla diciendo dos cosas.
	 *
	 * Tampoco sirve una fórmula viva contra la matriz, que es como se resuelven
	 * las líneas de recargo: la celda de un bono descuadrado contiene el TEXTO
	 * `«2 → 5»` y `SUM` lo leería como cero, y una placa que se queda sin
	 * columna por ancho no estaría en el rango.
	 *
	 * Así que se relee el periodo, CON REBOTE: recorrer los meses de un bono
	 * son varias ediciones seguidas y remontar el libro en cada una sería
	 * insoportable. Se espera a que pare el tecleo y se rehace una sola vez.
	 */
	/**
	 * Campos cuyo cambio obliga a releer el periodo.
	 *
	 * Son los que entran en el cálculo del servidor más allá de su propia
	 * celda: el básico y los días prorrateados arrastran deducciones y neto.
	 */
	const CAMPOS_QUE_REHACEN_LA_HOJA = new Set(['salario_basico', 'dias_laborados']);
	/**
	 * `dias_laborados_villanueva` y `dias_ajuste_deducciones` ESTUVIERON AQUÍ.
	 *
	 * Remontar el libro por mover un número de días hacía parpadear el canvas y
	 * perder el sitio, justo mientras se está tecleando. Salieron cuando la
	 * BASE PRESTACIONAL, la salud y la pensión dejaron de ser cifras del
	 * servidor y pasaron a ser fórmulas sobre esas mismas celdas: ahora la hoja
	 * se mueve sola y el servidor confirma en el siguiente viaje.
	 *
	 * Las tres casillas de ajuste tampoco están, por lo mismo.
	 *
	 * `salario_basico` y `dias_laborados` SÍ se quedan: arrastran el salario
	 * devengado, el auxilio, los bonos prorrateados y el reparto, que son más
	 * celdas de las que una fórmula puede cubrir sin duplicar medio cálculo.
	 */

	const REBOTE_RECALCULO_MS = 800;
	/// Tope de esperas por patches en vuelo (~8 s). Ver `pedirRecalculo`.
	const MAX_ESPERAS_RECALCULO = 10;
	let recalculoPendiente = $state(false);
	let temporizadorRecalculo: ReturnType<typeof setTimeout> | null = null;
	let esperasRecalculo = 0;

	function pedirRecalculo() {
		recalculoPendiente = true;
		if (temporizadorRecalculo) clearTimeout(temporizadorRecalculo);
		temporizadorRecalculo = setTimeout(() => {
			temporizadorRecalculo = null;
			/**
			 * Con algo todavía en vuelo se espera otra vuelta: releer ahora
			 * traería del servidor un estado ANTERIOR al que el usuario ya ve
			 * escrito en la celda, y la hoja daría un salto atrás.
			 *
			 * Pero con tope. `pendientes` lo bajan el acuse, el conflicto y el
			 * fallo, así que en condiciones normales drena solo; si por lo que
			 * sea se quedara clavado en uno, sin este límite el temporizador se
			 * reprogramaría cada 800 ms para siempre y la hoja NUNCA se
			 * refrescaría — el mismo síntoma que esto viene a arreglar.
			 */
			if (pendientes > 0 && esperasRecalculo < MAX_ESPERAS_RECALCULO) {
				esperasRecalculo++;
				pedirRecalculo();
				return;
			}
			esperasRecalculo = 0;
			recalculoPendiente = false;
			void loadInicial();
		}, REBOTE_RECALCULO_MS);
	}

	function cancelarRecalculo() {
		if (temporizadorRecalculo) clearTimeout(temporizadorRecalculo);
		temporizadorRecalculo = null;
		esperasRecalculo = 0;
		recalculoPendiente = false;
	}

	/**
	 * Celdas de bono con cifra PROPIA de la liquidación distinta de lo marcado.
	 *
	 * Una celda que salió de recorridos se copió tal cual, así que por
	 * construcción coincide: que difiera significa que alguien la tecleó. Es lo
	 * que se va a perder al restaurar, y por eso se cuenta antes de preguntar.
	 */
	let celdasDescuadradas = $derived.by(() => {
		const m = hojaActiva?.matrizBonos;
		if (!m?.filas.length || m.hayRecorridos !== true) return 0;
		const fila = (celdas: unknown, i: number): number[] => {
			const f = (celdas as any)?.[i];
			return Array.isArray(f) ? (f as number[]) : [Number(f ?? 0)];
		};
		let n = 0;
		for (const f of m.filas) {
			for (let i = 0; i < m.placas.length; i++) {
				const cant = fila(f.cantidades, i);
				const rec = fila(f.cantidadesRecorridos, i);
				const largo = Math.max(cant.length, rec.length);
				for (let j = 0; j < largo; j++) if ((cant[j] ?? 0) !== (rec[j] ?? 0)) n++;
			}
		}
		return n;
	});

	let rehaciendoBonos = $state(false);

	/**
	 * Vuelve a montar los bonos de la hoja desde lo marcado en recorridos.
	 *
	 * Pisa a propósito, así que se pregunta antes DICIENDO CUÁNTO se pierde: un
	 * «¿seguro?» que no dice qué se lleva por delante no es una confirmación,
	 * es un trámite.
	 */
	async function rehacerBonos() {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId || rehaciendoBonos) return;
		if (!hoja.matrizBonos?.hayRecorridos) {
			toast.warning('Este conductor no tiene bonos marcados en recorridos.', {
				description: 'No hay de dónde restaurarlos.'
			});
			return;
		}
		const n = celdasDescuadradas;
		const ok = confirm(
			`Se vuelven a montar los bonos de ${hoja.nombre} desde lo marcado en recorridos.\n\n` +
				(n
					? `Se pierden las cantidades tecleadas a mano en ${n} ${n === 1 ? 'celda que se separó' : 'celdas que se separaron'}.`
					: 'Ahora mismo ninguna celda se ha separado de lo marcado, así que no debería cambiar nada.') +
				'\n\nEl precio unitario de cada bono no se toca; las vacaciones y el resto del desprendible tampoco.'
		);
		if (!ok) return;

		/// Lo que venga por rebote sobra: esto recarga igual y con datos más
		/// nuevos que los de la edición que lo programó.
		cancelarRecalculo();
		rehaciendoBonos = true;
		await conOverlay('Restaurando bonos', hoja.nombre, async () => {
			const r = await nominaBorradoresAPI.rehacerBonos(hoja.liquidacionId!, refPeriodo());
			await loadInicial();
			toast.success(
				r.celdas
					? `${hoja.nombre}: ${r.celdas} ${r.celdas === 1 ? 'celda restaurada' : 'celdas restauradas'}${r.creadas ? ` · ${r.creadas} ${r.creadas === 1 ? 'bono nuevo' : 'bonos nuevos'}` : ''}.`
					: `${hoja.nombre}: los bonos ya coincidían con recorridos.`
			);
		});
		rehaciendoBonos = false;
	}

	// ─── Rehacer las filas de recargos de la hoja ─────────
	/**
	 * Escribe en `recargos` lo que el desprendible necesita para no salir en cero.
	 *
	 * POR QUÉ HACE FALTA UN BOTÓN: el comprobante no lee la columna
	 * `total_recargos` de la liquidación, sino las FILAS de la tabla `recargos`.
	 * El generador de borradores escribía la columna y ninguna fila, así que el
	 * PDF del conductor salía con «Otros … $ 0» y el neto corto en todos los
	 * recargos del mes. Los borradores nuevos ya nacen con sus filas; esto es
	 * para los que se crearon antes.
	 *
	 * NO PREGUNTA, a diferencia de «Rehacer bonos»: no pisa nada. Los recargos
	 * escritos a mano se quedan, los bonos solo se siembran si no hay ninguno y
	 * los días ni se miran. Lo único que cambia es que aparece lo que faltaba.
	 */
	let rehaciendoRecargos = $state(false);

	async function repararRecargos() {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId || rehaciendoRecargos) return;

		cancelarRecalculo();
		rehaciendoRecargos = true;
		await conOverlay('Rehaciendo recargos', hoja.nombre, async () => {
			const r = await nominaBorradoresAPI.repararRecargos(hoja.liquidacionId!, refPeriodo());
			await loadInicial();
			const partes: string[] = [];
			if (r.filas) partes.push(`${r.filas} ${r.filas === 1 ? 'fila' : 'filas'} de recargo`);
			if (r.bonos) partes.push(`${r.bonos} ${r.bonos === 1 ? 'bono' : 'bonos'}`);
			if (partes.length) {
				toast.success(`${hoja.nombre}: ${partes.join(' y ')} en el desprendible.`, {
					description: r.total
						? `Suman $ ${formatCOP(r.total)}, el mismo total que ya tenía la liquidación.`
						: undefined
				});
			} else {
				toast.info(`${hoja.nombre}: no había nada que rehacer.`, {
					description: r.sinAtribuir
						? `Quedan $ ${formatCOP(r.sinAtribuir)} sin poder repartir: el corte no tiene días con recargo valorado.`
						: 'El desprendible ya tenía sus recargos.'
				});
			}
		});
		rehaciendoRecargos = false;
	}

	// ─── Días en el desprendible (ocultar / no sumar) ───────
	/**
	 * Las marcas se guardan de una vez y el servidor decide si hay dinero que
	 * mover: si cambian los días que no suman, rehace los recargos y el neto.
	 * En cualquier caso la hoja se relee entera: la cabecera de cada día marcado,
	 * las fórmulas de reparto y los bloques por empresa cambian de geometría.
	 */
	let mostrarDiasDesprendible = $state(false);
	let guardandoMarcas = $state(false);
	const diasMarcados = $derived(
		(hojaActiva?.dias ?? []).filter((d) => d.oculto || d.noSuma).length
	);

	async function guardarMarcasDias(marcas: MarcasDias) {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId || guardandoMarcas) return;
		cancelarRecalculo();
		guardandoMarcas = true;
		try {
			const r = await nominaBorradoresAPI.guardarMarcasDias(hoja.liquidacionId, {
				...refPeriodo(),
				marcas
			});
			mostrarDiasDesprendible = false;
			await loadInicial();
			toast.success(`${hoja.nombre}: días del desprendible guardados.`, {
				description: r.recargos
					? `Se rehicieron los recargos: ahora suman $ ${formatCOP(r.recargos.total)}.`
					: 'Los recargos no cambian.'
			});
		} catch (e: any) {
			toast.error('No se pudieron guardar los días del desprendible.', {
				description: e?.response?.data?.error ?? e?.message
			});
		} finally {
			guardandoMarcas = false;
		}
	}

	// ─── Periodo del desprendible (fechas de la liquidación) ───
	/**
	 * Cambia las fechas que imprime el comprobante de la hoja abierta. El
	 * servidor rehace recargos y neto con la ventana nueva; aquí, si esas fechas
	 * no son las del libro, se reabre el libro en modo RANGO con ellas para que
	 * la hoja calcule con los mismos días que va a imprimir.
	 */
	let mostrarPeriodo = $state(false);
	let guardandoPeriodo = $state(false);

	async function guardarPeriodo(p: { inicio: string; fin: string; ajustarDias: boolean }) {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId || guardandoPeriodo) return;
		cancelarRecalculo();
		guardandoPeriodo = true;
		try {
			const r = await nominaBorradoresAPI.cambiarPeriodo(hoja.liquidacionId, p);
			mostrarPeriodo = false;
			toast.success(`${hoja.nombre}: periodo del ${p.inicio} al ${p.fin}.`, {
				description: [
					r.diasLaborados != null ? `${r.diasLaborados} días laborados` : null,
					r.recargos ? `recargos rehechos: $ ${formatCOP(r.recargos.total)}` : null
				]
					.filter(Boolean)
					.join(' · ')
			});
			const dias = datos?.periodo.dias ?? [];
			const libro = { desde: dias[0]?.fecha, hasta: dias[dias.length - 1]?.fecha };
			if (libro.desde === p.inicio && libro.hasta === p.fin) await loadInicial();
			else await cambiarRango({ desde: p.inicio, hasta: p.fin });
		} catch (e: any) {
			toast.error('No se pudo cambiar el periodo.', {
				description: e?.response?.data?.error ?? e?.message
			});
		} finally {
			guardandoPeriodo = false;
		}
	}

	// ─── Retirar el borrador de la hoja ───────────────────
	/**
	 * SOLO BORRADOR, y con doble confirmación escrita.
	 *
	 * Es la acción más destructiva del carril: se lleva la liquidación entera
	 * del conductor en este corte. Marca la fila y NO toca las tablas hijas
	 * —ahí está la firma del conductor sobre su desprendible—, así que es
	 * reversible en la base, pero desde la pantalla no hay «deshacer».
	 *
	 * Una liquidación ya liquidada, aprobada, pagada o anulada no se toca desde
	 * aquí: para dejarla sin efecto está ANULAR, que pide motivo y deja
	 * historial. Borrarla sería perder la decisión sin rastro.
	 */
	let eliminandoBorrador = $state(false);

	async function eliminarBorradorDeLaHoja() {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId || eliminandoBorrador) return;
		if (hoja.estado !== 'BORRADOR') {
			toast.warning(`La liquidación está en ${hoja.estado}.`, {
				description:
					'Solo se elimina un borrador. Para dejarla sin efecto, anúlala: eso pide motivo y deja historial.'
			});
			return;
		}

		const ok = confirm(
			`Se retira el borrador de ${hoja.nombre} del corte ${datos?.etiqueta ?? ''}.\n\n` +
				'Se pierde lo que lleve tecleado: días corregidos, bonos, vacaciones y conceptos ' +
				'adicionales. Su hoja queda de solo lectura, y desaparece del libro si el conductor ' +
				'no entra por su cuenta en la nómina del periodo.\n\n' +
				'Se puede volver a generar, partiendo otra vez de las planillas.'
		);
		if (!ok) return;

		eliminandoBorrador = true;
		await conOverlay('Eliminando borrador', hoja.nombre, async () => {
			await nominaBorradoresAPI.eliminarBorrador(hoja.liquidacionId!, refPeriodo());
			/// El conductor activo NO se toca: su hoja sigue en el libro, ahora
			/// sin liquidación y de solo lectura, con el botón «Crear borrador»
			/// en la barra. Soltarlo haría saltar a otra pestaña sin motivo.
			await loadInicial();
			toast.success(`Borrador de ${hoja.nombre} eliminado.`);
		});
		eliminandoBorrador = false;
	}

	/** Manda el alta/baja por el socket. `valor: null` es la baja. */
	function patchAdicional(nombre: string, valor: number | null) {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId) {
			toast.warning('Este conductor todavía no tiene liquidación en el periodo.');
			return;
		}
		if (!session) {
			toast.error('Sin conexión con el servidor: el cambio no se guardó.');
			return;
		}
		const field = `adicional|${nombre}`;
		adicionalesEnVuelo.add(field);
		pendientes++;
		session.enviarPatch({
			mes,
			entity_type: 'liquidacion',
			entity_id: hoja.liquidacionId,
			field,
			value: valor,
			base_version: hoja.version
		});
	}

	function syncUrl() {
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(anio));
		url.searchParams.set('mes', String(mes));
		url.searchParams.set('desde', String(corte));
		if (rango) {
			url.searchParams.set('inicio', rango.desde);
			url.searchParams.set('fin', rango.hasta);
		} else {
			url.searchParams.delete('inicio');
			url.searchParams.delete('fin');
		}

		/// Se escribe la liquidación cuando la hay y el conductor cuando no: así
		/// la URL siempre identifica la hoja abierta, tenga borrador o no. Y se
		/// borra la otra, para no dejar dos identificadores que puedan discrepar
		/// después de cambiar de periodo.
		if (hojaActiva?.liquidacionId) {
			url.searchParams.set('liquidacion', hojaActiva.liquidacionId);
			url.searchParams.delete('conductor');
		} else if (hojaActiva?.conductorId) {
			url.searchParams.set('conductor', hojaActiva.conductorId);
			url.searchParams.delete('liquidacion');
		}

		window.history.replaceState({}, '', url);
	}

	/// `replaceState` y no `goto`: cambiar de hoja no es navegar —no debe llenar
	/// el historial de veinticinco entradas ni remontar la página—, pero la barra
	/// de direcciones sí tiene que poder copiarse en cualquier momento.
	///
	/// Un `$effect` y no una llamada dentro de `irAConductor()`: a la hoja activa
	/// también se llega pulsando la pestaña del propio Univer, y ese camino no
	/// pasa por el selector.
	$effect(() => {
		if (hojaActiva) syncUrl();
	});

	/**
	 * Vuelve a traer los días de la hoja desde las planillas.
	 *
	 * El borrador tiene COPIA PROPIA de los días: se hizo al generarlo y desde
	 * entonces vive aparte, para poder corregir horas sin tocar la planilla que
	 * se le cobra al cliente. Esto sirve para lo contrario — cuando alguien
	 * cargó días nuevos en Recargos y hay que volver a partir de ahí.
	 *
	 * Se pregunta antes porque DESCARTA las correcciones manuales de los días:
	 * es el sentido del botón, pero no algo que se deba descubrir después.
	 */
	let refrescandoDias = $state(false);

	async function refrescarDiasDeLaHoja() {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId || refrescandoDias) return;
		/**
		 * La misma regla que el servidor, repetida aquí a propósito.
		 *
		 * El botón ya no se pinta fuera de BORRADOR, así que esto no debería
		 * alcanzarse nunca; está para que la función no dependa de quién la
		 * llame. Si un día se invoca desde un atajo, desde la consola o desde
		 * otro sitio de la barra, la petición destructiva sigue sin salir.
		 */
		if (!permiteRefrescarDias(hoja.estado)) {
			toast.warning(`La liquidación está en ${hoja.estado}.`, {
				description:
					'Sus días ya no se vuelven a traer de las planillas. Devuélvela a BORRADOR si de verdad hay que rehacerlos.'
			});
			return;
		}
		const ok = confirm(
			`Se volverán a traer los días de ${hoja.nombre} desde las planillas.\n\n` +
				'Las horas que hayas corregido a mano en los días se pierden. Los bonos, ' +
				'las vacaciones y el resto del desprendible no se tocan.'
		);
		if (!ok) return;

		refrescandoDias = true;
		try {
			const res = await nominaBorradoresAPI.refrescarDias(hoja.liquidacionId, refPeriodo());
			await loadInicial();
			toast.success(`Días actualizados desde las planillas (${res.dias}).`);
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'No se pudieron actualizar los días.');
		} finally {
			refrescandoDias = false;
		}
	}

	// ─── Carga ─────────────────────────────────────────────
	async function loadInicial() {
		loading = true;
		loadError = '';
		/// Releer el periodo trae lo que hay en el servidor, así que lo que se
		/// quedó sin guardar ya no está en pantalla: dejar el contador en pie
		/// diría «tienes cambios sin guardar» señalando a celdas que muestran
		/// justo el valor del servidor.
		fallidas = 0;
		try {
			datos = await nominaCanvasAPI.periodo(anio, mes, corte, rango);
			if (!conductorActivo && datos.hojas.length) {
				/// La hoja de la URL solo manda en la PRIMERA carga. Al cambiar de
				/// periodo el conductor sigue seleccionado por su cuenta, y si no
				/// existe en el periodo nuevo se cae a la primera hoja —lo que ya
				/// pasaba— en vez de quedarse en un identificador de otro mes.
				const pedida =
					(liquidacionPedida &&
						datos.hojas.find((h) => h.liquidacionId === liquidacionPedida)) ||
					(conductorPedido && datos.hojas.find((h) => h.conductorId === conductorPedido)) ||
					null;
				if (!pedida && (liquidacionPedida || conductorPedido)) {
					toast.info('La hoja del enlace no está en este periodo; se abrió la primera.');
				}
				conductorActivo = (pedida ?? datos.hojas[0]).conductorId;
			}
			/// Sin `await`: la marca de envío es información de apoyo, y esperarla
			/// retrasaría el montaje del canvas por algo que no bloquea a nadie.
			void cargarEnvios();
			for (const aviso of datos.avisos) toast.warning(aviso, { duration: 8000 });
			await remountEngine();
			if (abrirPreviewPedido && liquidacionPedida && !previewAutomaticoConsumido) {
				const hoja = datos.hojas.find((item) => item.liquidacionId === liquidacionPedida);
				if (hoja?.liquidacionId) {
					previewAutomaticoConsumido = true;
					await abrirPreviewFirmado(hoja);
				}
			}
		} catch (e: any) {
			loadError = e?.response?.data?.error || e?.message || 'No se pudo cargar el periodo.';
		} finally {
			loading = false;
		}
	}

	// ─── Montaje / teardown ────────────────────────────────
	async function mountEngineNow() {
		if (!container || !datos) return;
		const token = mountToken;
		try {
			const nuevo = createNominaEngine({
				container,
				periodo: datos,
				conductorActivo: conductorActivo ?? undefined
			});
			if (token !== mountToken) {
				// Otro montaje ganó la carrera: se descarta este para no dejar
				// un Univer huérfano con su Worker de fórmulas vivo.
				disposeEngine(nuevo.univer, nuevo.fUniver, nuevo.unitId, container);
				return;
			}
			ctx = nuevo;
			/// Solo en desarrollo: un asidero para probar el canvas desde la
			/// consola —y desde Playwright— sin pasar por el ratón. Univer pinta
			/// en un `<canvas>`, así que sin esto no hay forma de escribir en una
			/// celda desde fuera. Mismo patrón que el canvas de recorridos.
			if (import.meta.env.DEV) (window as any).__nominaEngine = nuevo;

			canvasDisposers.push(
				installNominaCellPermission(nuevo.univer, {
					unitId: nuevo.unitId,
					estadoPorHoja: () => nuevo.estadoPorHoja(),
					estadosBloqueados: ESTADOS_BLOQUEADOS,
					/// La hoja del canvas conoce su liquidación; el permiso de celda
					/// no, y sin ese dato su aviso manda a corregir la planilla
					/// cuando lo que falta es el borrador.
					sinLiquidacion: (sheetId: string) =>
						!datos?.hojas.find((h) => nominaSheetId(h.conductorId) === sheetId)?.liquidacionId,
					onBloqueado: ({ titulo, detalle }) =>
						toast.warning(titulo, { description: detalle, duration: 7000 })
				})
			);

			canvasDisposers.push(
				attachCellChangeNomina({
					fUniver: nuevo.fUniver,
					unitId: nuevo.unitId,
					onValorInvalido: ({ texto }) =>
						toast.error(`«${texto}» no es un número`, {
							description: 'La celda no se guardó. Escribe solo la cifra.'
						}),
					// Cambiar de pestaña en la barra de Univer tiene que mover
					// también la cabecera y el selector: si no, el carril de
					// estado actuaría sobre el conductor que ya no se ve.
					onHojaActiva: (sheetId) => {
						const id = nuevo.resolveConductor(sheetId);
						if (id && id !== conductorActivo) {
							conductorActivo = id;
							session?.setHojaActiva(mes, sheetId);
						}
					},
					onPatch: ({ binding, valor, sheetId, row, column }) => {
						/**
						 * El color de la franja de recargos es parte del dato, así que
						 * se repinta ANTES de saber si el servidor acepta: quien teclea
						 * una hora tiene que ver el bloque de color en el acto, igual
						 * que ve el número. Si el patch se rechaza, el aviso manda a
						 * recargar y el builder vuelve a decidir el color desde cero.
						 *
						 * En un microtask porque esto corre DENTRO del manejador del
						 * comando que acaba de escribir la celda, y pintar ahí mismo
						 * sería despachar un comando de Univer desde dentro de otro.
						 */
						queueMicrotask(() => ctx?.repintarRecargosDelDia(sheetId, row, column));

						const hoja = datos?.hojas.find((h) => h.liquidacionId === binding.entityId);
						// Sin hoja no hay `version` que mandar, y sin versión el
						// compare-and-swap no compara nada: el servidor
						// aceptaría el cambio pisando lo que hubiera. Mejor no
						// enviarlo y decirlo.
						if (!hoja) {
							toast.error('No se pudo guardar: recarga el periodo.');
							return;
						}
						if (!session) {
							toast.error('Sin conexión con el servidor: el cambio no se guardó.');
							return;
						}
						pendientes++;
						session.enviarPatch({
							mes,
							entity_type: 'liquidacion',
							entity_id: binding.entityId,
							field: binding.field,
							value: valor,
							// El CAS: si otro cambió la liquidación mientras
							// tanto, el servidor rechaza y devuelve su versión.
							base_version: hoja.version
						});
					}
				})
			);
		} catch (e: any) {
			console.error('[nomina-canvas] mount error', e);
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
			clearNominaBindings(ctx.unitId);
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

	// ─── Cambios de periodo ────────────────────────────────
	async function cambiarPeriodo(nuevoAnio: number, nuevoMes: number, nuevoCorte: number) {
		// Otro periodo, otras liquidaciones: la caché de desprendibles del
		// anterior ya no vale, y el rebote pendiente apuntaba al libro viejo.
		limpiarCacheDesprendibles();
		cancelarRecalculo();
		anio = nuevoAnio;
		mes = nuevoMes;
		corte = nuevoCorte;
		/// Elegir año, mes o corte es volver a liquidar por corte.
		rango = null;
		syncUrl();
		conectarSesion();
		await loadInicial();
	}

	/**
	 * Aplica un rango específico. Valida aquí para no pedir un libro que el
	 * servidor va a rechazar: fechas en orden y hasta `MAX_DIAS_RANGO` días.
	 */
	async function cambiarRango(nuevo: { desde: string; hasta: string }) {
		if (!FECHA_ISO.test(nuevo.desde) || !FECHA_ISO.test(nuevo.hasta)) return;
		if (nuevo.desde > nuevo.hasta) {
			toast.warning('La fecha inicial tiene que ser anterior a la final.');
			return;
		}
		const dias =
			(Date.parse(`${nuevo.hasta}T00:00:00Z`) - Date.parse(`${nuevo.desde}T00:00:00Z`)) /
				86400000 +
			1;
		if (dias > MAX_DIAS_RANGO) {
			toast.warning(`Un rango puede tener como mucho ${MAX_DIAS_RANGO} días.`);
			return;
		}
		limpiarCacheDesprendibles();
		cancelarRecalculo();
		rango = { ...nuevo };
		/// La llave del libro es el mes en que TERMINA, como en un corte.
		anio = Number(nuevo.hasta.slice(0, 4));
		mes = Number(nuevo.hasta.slice(5, 7));
		syncUrl();
		conectarSesion();
		await loadInicial();
	}

	/// Pasar a «Rango» arranca con las fechas del libro abierto, para ajustar
	/// solo el extremo que cambia en vez de teclear las dos.
	function activarRango() {
		const dias = datos?.periodo.dias ?? [];
		const desde = dias[0]?.fecha;
		const hasta = dias[dias.length - 1]?.fecha;
		if (desde && hasta) void cambiarRango({ desde, hasta });
	}

	function irAConductor(conductorId: string) {
		conductorActivo = conductorId;
		ctx?.activarConductor(conductorId);
	}

	// ─── Sesión colaborativa ───────────────────────────────
	function conectarSesion() {
		/// `dispose` limpia los temporizadores de acuse, así que los patches que
		/// estuvieran en vuelo no volverán a avisar de nada: sin este reinicio el
		/// contador se quedaría clavado en «Guardando 2…» para siempre.
		session?.dispose();
		pendientes = 0;
		fallidas = 0;
		ultimoGuardado = null;
		const user = ($authStore as any)?.user;
		if (!user?.id) return;

		session = createSheetSession({
			scope: 'nomina',
			anio,
			mes,
			user: { id: user.id, name: user.nombre ?? user.name ?? 'Usuario' },
			onPresence: (users) => (presencia = users),
			onConexion: (c) => (conectado = c),

			// Acuse del servidor: trae la versión nueva y los totales ya
			// recalculados. Sin fusionar la versión, el siguiente patch de esa
			// misma liquidación iría con una `base_version` vieja y el servidor
			// lo rechazaría por conflicto contra el propio usuario.
			onAck: ({ entity_id, field, version, totales }) => {
				pendientes = Math.max(0, pendientes - 1);
				ultimoGuardado = new Date().toISOString();
				const hoja = datos?.hojas.find((h) => h.liquidacionId === entity_id);
				if (hoja) {
					hoja.version = version;
					if (totales) hoja.totales = totales as any;
				}
				/// Un alta o una baja de concepto adicional CAMBIA LA GEOMETRÍA del
				/// desprendible: hay una fila más o una menos y todo lo que va
				/// debajo se corre. Repintar una celda no sirve; hay que rehacer la
				/// hoja. Solo se recarga por eso: el retoque del importe en la
				/// celda no entra en `adicionalesEnVuelo` y no remonta nada.
				if (adicionalesEnVuelo.delete(String(field))) void loadInicial();

				/// Un bono editado mueve media hoja —`TOTAL BONOS`, las líneas del
				/// desprendible, el subtotal, el devengado y el neto— y ninguna de
				/// esas celdas es fórmula viva. Se relee, pero con rebote: ver
				/// `pedirRecalculo`.
				if (String(field ?? '').startsWith('bono|')) pedirRecalculo();

				/**
				 * El básico y los días prorrateados mueven lo mismo, y por la misma
				 * razón: el desprendible ya recalcula SALARIO y AUXILIO solo —son
				 * fórmulas contra la celda de cantidad— pero la salud, la pensión y
				 * el neto los calcula el servidor y se quedarían con la cifra
				 * vieja al lado de un devengado nuevo.
				 */
				if (CAMPOS_QUE_REHACEN_LA_HOJA.has(String(field ?? ''))) pedirRecalculo();
			},

			onRemotePatch: (p) => {
				if (!ctx) return;
				const destino = getNominaCellFor(ctx.unitId, String(p.entity_id), String(p.field));
				/// Un concepto adicional SIN celda es uno que acaba de nacer (o que
				/// acaban de quitar) en otro navegador: la fila no existe en esta
				/// hoja, así que no hay nada que repintar y toca releer el periodo.
				if (!destino) {
					if (String(p.field).startsWith('adicional|')) void loadInicial();
					return;
				}
				// `aplicarCeldaRemota` marca la ventana de eco: sin ella, esta
				// escritura dispararía el adapter y volvería al emisor en bucle.
				aplicarCeldaRemota(ctx, destino, p.value as any);
				/// Y el color de la franja, por lo mismo que en la edición propia:
				/// si no, la hora del otro llega sin su bloque y las dos pantallas
				/// enseñan el mismo día de distinto color.
				ctx.repintarRecargosDelDia(destino.sheetId, destino.row, destino.column);
				const hoja = datos?.hojas.find((h) => h.liquidacionId === p.entity_id);
				if (hoja && typeof p.version === 'number') hoja.version = p.version;
			},

			onConflict: ({ entity_id, server_row }) => {
				pendientes = Math.max(0, pendientes - 1);
				const hoja = datos?.hojas.find((h) => h.liquidacionId === entity_id);
				toast.warning('Otra persona cambió esta liquidación', {
					description: hoja
						? `Se recargó la hoja de ${hoja.nombre} con lo que hay en el servidor.`
						: 'Se recargó el periodo.',
					duration: 8000
				});
				if (server_row?.version && hoja) hoja.version = server_row.version;
				void loadInicial();
			},

			onPatchFallido: ({ error, motivo }) => {
				pendientes = Math.max(0, pendientes - 1);
				fallidas++;
				toast.error(motivo === 'timeout' ? 'El cambio no llegó al servidor' : 'Cambio rechazado', {
					description: error || 'Vuelve a intentarlo; si sigue, recarga el periodo.',
					duration: 9000
				});
			},

			onInvalidate: () => void loadInicial(),
			onReverted: () => {
				toast.info('Se restauró una versión del periodo');
				void loadInicial();
			}
		});
	}

	// ─── Acciones ──────────────────────────────────────────
	async function conOverlay<T>(
		titulo: string,
		detalle: string | undefined,
		fn: () => Promise<T>
	): Promise<T | null> {
		accionEnCurso = { titulo, detalle };
		try {
			return await fn();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || e?.message || 'La acción falló.');
			return null;
		} finally {
			accionEnCurso = null;
		}
	}

	async function cambiarEstado(accion: AccionEstado) {
		if (!hojaActiva?.liquidacionId) {
			toast.warning('Este conductor todavía no tiene liquidación en el periodo.');
			return;
		}
		let motivo: string | null = null;
		if (accion.exigeMotivo) {
			motivo = window.prompt(`Motivo para ${accion.etiqueta.toLowerCase()}:`);
			if (!motivo?.trim()) return;
		}
		const hoja = hojaActiva;
		await conOverlay(accion.etiqueta, hoja.nombre, async () => {
			const r = await nominaCanvasAPI.cambiarEstado({
				liquidacionId: hoja.liquidacionId!,
				estado: accion.estado,
				motivo,
				baseVersion: hoja.version
			});
			hoja.estado = r.estado;
			hoja.version = r.version;
			ctx?.aplicarEstado(hoja.conductorId, r.estado);
			toast.success(`${hoja.nombre}: ${r.estado}`);
		});
	}

	/**
	 * Aplica lo que cambió el lote de estados.
	 *
	 * El servidor devuelve el parte hoja por hoja —el lote NO es atómico—, así
	 * que aquí se toca solo lo que confirmó. Releer el periodo entero sería más
	 * corto de escribir y peor: son 25 hojas y el libro se remontaría para
	 * cambiar una palabra en cada pestaña.
	 */
	function aplicarCambiosDeLote(cambios: CambioEstado[]) {
		if (!cambios.length) return;
		const porId = new Map(cambios.map((c) => [c.id, c]));
		for (const hoja of datos?.hojas ?? []) {
			const c = hoja.liquidacionId ? porId.get(hoja.liquidacionId) : undefined;
			if (!c) continue;
			hoja.estado = c.estado;
			hoja.version = c.version;
			ctx?.aplicarEstado(hoja.conductorId, c.estado);
		}
		toast.success(`${cambios.length} liquidación(es) en LIQUIDADA.`);
	}

	async function guardarVersion() {
		await conOverlay('Guardando versión', datos?.etiqueta, async () => {
			const r = await nominaCanvasAPI.capturarSnapshot(anio, mes, corte);
			if ((r as any).sinCambios) {
				toast.info('No hay cambios desde la última versión.');
			} else {
				toast.success(`Versión ${(r as any).version} guardada.`);
			}
		});
	}

	async function recargar() {
		await conOverlay('Recalculando el periodo', datos?.etiqueta, () => loadInicial());
	}

	/** Abre el desprendible de la hoja activa. Es la vista previa Y la descarga. */
	async function verDesprendible() {
		if (!hojaActiva?.liquidacionId) {
			toast.warning('Este conductor todavía no tiene liquidación en el periodo.');
			return;
		}
		const hoja = hojaActiva;
		await conOverlay('Generando el desprendible', hoja.nombre, async () => {
			await abrirDesprendible(hoja.liquidacionId!);
		});
	}

	async function abrirPreviewFirmado(hoja: NonNullable<typeof hojaActiva>) {
		await conOverlay('Generando el desprendible firmado', hoja.nombre, async () => {
			// La notificación significa que la firma acaba de cambiar: nunca se
			// debe servir aquí el blob que el canvas pudiera tener en memoria.
			limpiarCacheDesprendibles();
			const blob = await blobDesprendible(hoja.liquidacionId!);
			if (previewFirmadoUrl) URL.revokeObjectURL(previewFirmadoUrl);
			previewFirmadoUrl = URL.createObjectURL(blob);
			previewFirmadoNombre = `Desprendible firmado · ${hoja.nombre}`;
		});
	}

	function cerrarPreviewFirmado() {
		if (previewFirmadoUrl) URL.revokeObjectURL(previewFirmadoUrl);
		previewFirmadoUrl = null;
	}

	async function exportarExcel() {
		if (!datos?.hojas.length) {
			toast.warning('No hay conductores en el periodo.');
			return;
		}
		await conOverlay('Exportando a Excel', `${datos.hojas.length} desprendible(s)`, async () => {
			const hojas: HojaLibro[] = datos!.hojas.map((h) => ({
				nombre: h.nombreHoja,
				documento: documentoNomina({ hoja: h, periodo: datos! })
			}));
			await exportarExcelLibro(
				'nomina',
				hojas,
				`Nomina_${datos!.anio}-${String(datos!.mes).padStart(2, '0')}`
			);
			toast.success(`${hojas.length} hoja(s) exportadas.`);
		});
	}

	/**
	 * Un PDF por conductor, todos en un ZIP.
	 *
	 * Se generan en el navegador con el MISMO generador que la vista previa,
	 * uno detrás de otro: pdfmake es síncrono y treinta a la vez congelan la
	 * pestaña. El ZIP se arma con `crearZip`, que no comprime —un PDF ya viene
	 * comprimido por dentro— y por eso no hace falta bajarse una librería.
	 */
	async function exportarZip() {
		const conLiquidacion = (datos?.hojas ?? []).filter((h) => h.liquidacionId);
		if (!conLiquidacion.length) {
			toast.warning('Ningún conductor del periodo tiene liquidación.');
			return;
		}

		const total = conLiquidacion.length;
		await conOverlay('Generando los desprendibles', `0 de ${total}`, async () => {
			const entradas: { nombre: string; datos: Uint8Array }[] = [];
			const fallidas: string[] = [];

			for (let i = 0; i < conLiquidacion.length; i++) {
				const h = conLiquidacion[i];
				accionEnCurso = {
					titulo: 'Generando los desprendibles',
					detalle: `${i + 1} de ${total} · ${h.nombre}`
				};
				try {
					const blob = await blobDesprendible(h.liquidacionId!);
					entradas.push({
						nombre: `${nombreArchivoDesprendible(h, datos!)}.pdf`,
						datos: new Uint8Array(await blob.arrayBuffer())
					});
				} catch (e: any) {
					// Uno que falla no aborta el resto, pero tiene que decirse:
					// un ZIP con 28 de 30 y sin aviso es peor que un error.
					console.error('[nomina-zip] fallo en', h.nombre, e);
					fallidas.push(h.nombre);
				}
			}

			if (!entradas.length) throw new Error('No se pudo generar ningún desprendible.');

			const zip = crearZip(entradas, new Date());
			const url = URL.createObjectURL(zip);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Desprendibles_${datos!.anio}-${String(datos!.mes).padStart(2, '0')}.zip`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);

			if (fallidas.length) {
				toast.warning(`${entradas.length} de ${total} desprendibles`, {
					description: `No se pudieron generar: ${fallidas.join(', ')}`,
					duration: 12000
				});
			} else {
				toast.success(`${entradas.length} desprendibles en el ZIP.`);
			}
		});
	}

	/**
	 * Envía los desprendibles del periodo.
	 *
	 * Solo se mandan las APROBADAS (y las PAGADAS, que ya pasaron por ahí).
	 *
	 * Antes bastaba con no ser BORRADOR ni ANULADA, así que entraban también las
	 * LIQUIDADA — y ese es justo el estado que todavía admite volver atrás:
	 * `LIQUIDADA → BORRADOR` está en las transiciones permitidas. Mandar en
	 * LIQUIDADA es mandar algo que aún puede cambiar, y un desprendible que
	 * llega al conductor y luego cambia es peor que uno que llega tarde.
	 * APROBADA es el primer estado que la propia máquina considera bloqueado
	 * (`ESTADOS_BLOQUEADOS`), y por eso es el que vale como «ya se puede mandar».
	 */
	/**
	 * Abre el modal de envío.
	 *
	 * El filtro de estado y la selección viven DENTRO del modal: quién entra y
	 * quién no es parte de lo que hay que poder revisar antes de mandar, no algo
	 * que se decida antes de enseñar la pantalla.
	 */
	function enviarDesprendibles() {
		if (!datos) return;
		mostrarEnviar = true;
	}

	function notificarEnApp() {
		if (!datos) return;
		mostrarNotificar = true;
	}

	/**
	 * Enciende o apaga las tablas de recargos de unas liquidaciones.
	 *
	 * Va por REST y no por el socket del canvas aunque `mostrar_recargos` esté
	 * registrado como `flag` parcheable: no es una celda de la hoja, así que no
	 * hay nada que repintar, y el endpoint en lote ya existía desde que esto se
	 * cambiaba desde el listado. Un patch por conductor sobre treinta hojas
	 * serían treinta idas al servidor para el mismo efecto.
	 *
	 * Lo que sí hay que hacer después es soltar la caché de desprendibles: si
	 * no, la vista previa seguiría dando el PDF con las tablas que se acaban de
	 * quitar.
	 */
	async function cambiarTablasRecargos(ids: string[], visible: boolean, detalle: string) {
		if (!ids.length || cambiandoTablas) return;
		cambiandoTablas = true;
		await conOverlay(
			visible ? 'Mostrando las tablas de recargos' : 'Ocultando las tablas de recargos',
			detalle,
			async () => {
				await toggleDesprendibleTablasVisible(ids, visible);
				limpiarCacheDesprendibles();
				await loadInicial();
				const cuantas = ids.length === 1 ? detalle : `${ids.length} desprendibles`;
				toast.success(
					visible
						? `${cuantas}: el desglose de recargos vuelve al desprendible.`
						: `${cuantas}: el desprendible sale sin el desglose de recargos.`,
					{ description: 'No cambia lo que se paga: los recargos siguen en el devengado.' }
				);
			}
		);
		cambiandoTablas = false;
	}

	function alternarTablasDeLaHoja() {
		const hoja = hojaActiva;
		if (!hoja?.liquidacionId) return;
		void cambiarTablasRecargos([hoja.liquidacionId], !tablasEnHojaActiva, hoja.nombre);
	}

	function tablasEnTodoElPeriodo(visible: boolean) {
		const ids = hojasConLiquidacion
			.filter((h) => (h.mostrarRecargos !== false) !== visible)
			.map((h) => h.liquidacionId!);
		if (!ids.length) {
			toast.info(
				visible
					? 'Todas las hojas del periodo ya imprimen el desglose.'
					: 'Ninguna hoja del periodo imprime ya el desglose.'
			);
			return;
		}
		void cambiarTablasRecargos(ids, visible, `${ids.length} hojas del periodo`);
	}

	function volver() {
		/// Al dashboard, no al listado: `/dashboard/nomina` ahora redirige a
		/// este mismo canvas, así que apuntar ahí sería un bucle.
		goto('/dashboard');
	}

	// ─── Carril ────────────────────────────────────────────
	let railItems = $derived<RailItem[]>([
		{
			id: 'recargar',
			label: 'Recalcular periodo',
			hint: 'Vuelve a leer las planillas y rehace todas las hojas.',
			icon: icoRecargar,
			onSelect: recargar,
			disabled: !!accionEnCurso
		},
		{
			id: 'version',
			label: 'Guardar versión',
			hint: 'Captura el libro entero para poder volver a este punto.',
			icon: icoVersion,
			onSelect: guardarVersion,
			/// El historial de versiones es por corte: un libro por rango se
			/// compararía y revertiría contra el del corte, que es otro libro.
			disabled: !!accionEnCurso || !!rango,
			disabledHint: rango ? 'Las versiones se guardan por corte, no por rango.' : undefined
		},
		{
			id: 'preview',
			label: 'Ver desprendible',
			hint: hojaActiva
				? `Abre el desprendible de ${hojaActiva.nombre}, el mismo que recibe el conductor.`
				: 'Abre una hoja primero',
			icon: icoVer,
			onSelect: verDesprendible,
			disabled: !!accionEnCurso || !hojaActiva?.liquidacionId,
			disabledHint:
				hojaActiva && !hojaActiva.liquidacionId
					? 'Este conductor todavía no tiene liquidación en el periodo.'
					: undefined
		},
		{
			id: 'tablas-recargos',
			label: 'Tablas de recargos',
			hint: hojaActiva?.liquidacionId
				? tablasEnHojaActiva
					? `El desprendible de ${hojaActiva.nombre} lleva el desglose de recargos.`
					: `El desprendible de ${hojaActiva.nombre} sale SIN el desglose de recargos.`
				: 'Decide si el desprendible imprime el desglose de recargos.',
			icon: iconoTablasRecargos,
			/// Cuántas hojas del periodo salen sin el desglose. Sin esto, apagarlo
			/// en una hoja y olvidarlo no se ve desde ningún sitio.
			badge: hojasSinTablas.length || null,
			panel: panelTablasRecargos,
			panelWidth: 320,
			disabled: !!accionEnCurso
		},
		{
			id: 'excel',
			label: 'Exportar a Excel',
			hint: 'Un libro con una hoja por conductor.',
			icon: icoExcel,
			onSelect: exportarExcel,
			disabled: !!accionEnCurso || !datos?.hojas.length
		},
		{
			id: 'zip',
			label: 'Descargar los desprendibles',
			hint: 'Un PDF por conductor, todos en un ZIP.',
			icon: icoZip,
			onSelect: exportarZip,
			disabled: !!accionEnCurso || !datos?.hojas.length
		},
		{
			id: 'generar',
			label: 'Generar borradores',
			hint: 'Crea la liquidación de los conductores que aún no la tienen.',
			icon: icoBorradores,
			tone: 'green' as const,
			onSelect: () => (mostrarGenerar = true),
			disabled: !!accionEnCurso
		},
		{
			id: 'eliminar-borrador',
			label: 'Eliminar borrador',
			hint: hojaActiva
				? `Retira la liquidación de ${hojaActiva.nombre} en este corte. Solo si sigue en BORRADOR.`
				: 'Abre la hoja de un conductor primero',
			icon: iconoEliminarBorrador,
			tone: 'red' as const,
			onSelect: eliminarBorradorDeLaHoja,
			disabled:
				!!accionEnCurso ||
				eliminandoBorrador ||
				!hojaActiva?.liquidacionId ||
				hojaActiva?.estado !== 'BORRADOR',
			disabledHint: !hojaActiva?.liquidacionId
				? 'Este conductor todavía no tiene liquidación en el periodo.'
				: hojaActiva?.estado !== 'BORRADOR'
					? `Está en ${hojaActiva?.estado}. Solo se elimina un borrador; para dejarla sin efecto, anúlala.`
					: undefined
		},
		{
			id: 'reparar-recargos',
			label: 'Rehacer recargos',
			hint: hojaActiva?.sinFilasDeRecargos
				? 'El desprendible de esta hoja saldría con los recargos en CERO. Esto los escribe desde las planillas.'
				: 'Vuelve a escribir las filas de recargo del desprendible desde las planillas del corte.',
			icon: iconoRehacerRecargos,
			/// El punto solo se enciende cuando el comprobante está roto: es la
			/// única forma de ver desde el carril que ESTA hoja necesita el botón.
			badge: hojaActiva?.sinFilasDeRecargos ? '!' : null,
			tone: hojaActiva?.sinFilasDeRecargos ? ('blue' as const) : undefined,
			onSelect: repararRecargos,
			disabled:
				!!accionEnCurso ||
				rehaciendoRecargos ||
				!hojaActiva?.liquidacionId ||
				!esEditable(hojaActiva?.estado ?? ''),
			disabledHint: !hojaActiva?.liquidacionId
				? 'Este conductor todavía no tiene liquidación en el periodo.'
				: !esEditable(hojaActiva?.estado ?? '')
					? `Está en ${hojaActiva?.estado} y esto cambia su neto. Devuélvela a LIQUIDADA para repararla.`
					: undefined
		},
		{
			id: 'rehacer-bonos',
			label: 'Rehacer bonos desde recorridos',
			hint: hojaActiva?.matrizBonos?.hayRecorridos
				? celdasDescuadradas
					? `Descarta las ${celdasDescuadradas} celdas tecleadas a mano y vuelve a lo marcado en los tramos.`
					: 'Vuelve a montar los bonos desde los tramos. Ahora mismo ya coinciden.'
				: 'Este conductor no tiene bonos marcados en recorridos.',
			icon: iconoRehacerBonos,
			badge: celdasDescuadradas || null,
			onSelect: rehacerBonos,
			disabled:
				!!accionEnCurso ||
				rehaciendoBonos ||
				!hojaActiva?.liquidacionId ||
				!hojaActiva?.matrizBonos?.hayRecorridos,
			disabledHint: !hojaActiva?.liquidacionId
				? 'Este conductor todavía no tiene liquidación en el periodo.'
				: !hojaActiva?.matrizBonos?.hayRecorridos
					? 'No hay bonos marcados en recorridos de los que partir.'
					: undefined
		},
		{
			id: 'periodo-desprendible',
			label: 'Periodo del desprendible',
			hint: hojaActiva?.periodoLiquidacion
				? `Fechas del comprobante de ${hojaActiva.nombre}: ${hojaActiva.periodoLiquidacion.desde} → ${hojaActiva.periodoLiquidacion.hasta}.`
				: 'Abre la hoja de un conductor primero',
			icon: iconoPeriodoDesprendible,
			onSelect: () => (mostrarPeriodo = true),
			disabled: !!accionEnCurso || guardandoPeriodo || !hojaActiva?.liquidacionId,
			disabledHint: motivoBloqueoAdicionales() || undefined
		},
		{
			id: 'dias-desprendible',
			label: 'Días en el desprendible',
			hint: hojaActiva
				? `Qué días de ${hojaActiva.nombre} salen en las tablas de recargos y cuáles se pagan.`
				: 'Abre la hoja de un conductor primero',
			icon: iconoDiasDesprendible,
			badge: diasMarcados || null,
			onSelect: () => (mostrarDiasDesprendible = true),
			disabled: !!accionEnCurso || guardandoMarcas || !hojaActiva?.liquidacionId,
			disabledHint: motivoBloqueoAdicionales() || undefined
		},
		{
			id: 'adicionales',
			label: 'Conceptos adicionales',
			hint: hojaActiva
				? `Bonos y ajustes pactados a mano de ${hojaActiva.nombre}. Van debajo de AUXILIO DE TRANSPORTE.`
				: 'Abre la hoja de un conductor primero',
			icon: iconoAdicional,
			badge: conceptosAdicionales.length || null,
			onSelect: () => (mostrarAdicionales = true),
			disabled: !!accionEnCurso || !hojaActiva?.liquidacionId,
			disabledHint: motivoBloqueoAdicionales() || undefined
		},
		{
			id: 'enviar',
			label: 'Enviar desprendibles',
			hint: 'Manda el PDF por correo a cada conductor y deja constancia.',
			icon: icoCorreo,
			tone: 'blue' as const,
			onSelect: enviarDesprendibles,
			disabled: !!accionEnCurso || !datos?.hojas.length
		},
		{
			id: 'notificar-app',
			label: 'Notificar en app',
			hint: 'Avisa por push que el desprendible pagado está listo para firmar y consultar.',
			icon: icoCampana,
			tone: 'blue' as const,
			onSelect: notificarEnApp,
			disabled: !!accionEnCurso || !datos?.hojas.some((h) => h.estado === 'PAGADA')
		},
		{
			id: 'historial',
			label: 'Versiones del periodo',
			hint: 'Ver y restaurar versiones guardadas.',
			icon: icoHistorial,
			onSelect: () => (historialAbierto = true),
			disabled: !!accionEnCurso
		},
		{ type: 'sep' },
		/**
		 * UN icono para todo el estado, no uno por transición.
		 *
		 * Antes cada acción disponible era su propio botón, así que el final
		 * del carril cambiaba de longitud y de contenido con cada conductor
		 * —tres iconos en una LIQUIDADA, uno en una PAGADA, ninguno en una
		 * ANULADA— y las acciones de debajo se movían de sitio. Un icono fijo
		 * que abre el desplegable mantiene el carril quieto, que es lo único
		 * que hace que un icono sirva de ancla.
		 */
		{
			id: 'estado',
			label: 'Estado de la hoja',
			hint: hojaActiva
				? `${hojaActiva.nombre} · ${hojaActiva.estado}`
				: 'Liquidar, aprobar, pagar o anular la hoja abierta.',
			icon: iconoEstado,
			/// Los borradores que quedan por liquidar en el periodo: es lo único
			/// del bloque de estado que hay que ver sin abrir el panel.
			badge: borradoresDelPeriodo.length || null,
			panel: panelEstado,
			panelTone: 'dark' as const,
			panelWidth: 300,
			disabled: !!accionEnCurso
		}
	]);

	// ─── Ciclo de vida ─────────────────────────────────────
	onMount(() => {
		syncUrl();
		conectarSesion();
		void loadInicial();
	});

	/**
	 * Gancho del «Ir a…»: antes de saltar a otro canvas hay que soltar la
	 * sesión colaborativa. Sin esto el socket sigue vivo y el avatar de quien
	 * se fue se queda pegado en la hoja para los demás.
	 */
	/// Generación de borradores en lote. Sustituye al viaje por el formulario:
	/// se eligen los conductores y el servidor genera, persiste y anuncia.
	let mostrarGenerar = $state(false);

	function antesDeSalir(): boolean {
		session?.dispose();
		session = null;
		return true;
	}

	onDestroy(() => {
		/// El rebote sobrevive al desmontaje si no se corta: dispararía
		/// `loadInicial` sobre un componente que ya no está.
		cancelarRecalculo();
		session?.dispose();
		teardownEngine();
		limpiarCacheDesprendibles();
		cerrarPreviewFirmado();
	});
</script>

{#snippet iconoEliminarBorrador()}
	<!-- Papelera sobre una hoja: se retira el documento, no una celda. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16" />
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"
		/>
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M6.2 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.8A1.6 1.6 0 0 0 17 19l.8-12"
		/>
		<path stroke-linecap="round" d="M10.2 11v6M13.8 11v6" />
	</svg>
{/snippet}

{#snippet iconoPeriodoDesprendible()}
	<!-- Calendario con dos marcas: el inicio y el fin del comprobante. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<rect x="3.5" y="5" width="17" height="15" rx="2" />
		<path stroke-linecap="round" d="M3.5 9.5h17M8 3v4M16 3v4" />
		<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 14.5h9M7.5 14.5l1.8-1.8M7.5 14.5l1.8 1.8M16.5 14.5l-1.8-1.8M16.5 14.5l-1.8 1.8" />
	</svg>
{/snippet}

{#snippet iconoDiasDesprendible()}
	<!-- Calendario con un ojo: qué días se ven en el desprendible. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<rect x="3.5" y="5" width="17" height="15" rx="2" />
		<path stroke-linecap="round" d="M3.5 9.5h17M8 3v4M16 3v4" />
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M7 15s1.8-2.6 5-2.6 5 2.6 5 2.6-1.8 2.6-5 2.6S7 15 7 15z"
		/>
		<circle cx="12" cy="15" r="1" />
	</svg>
{/snippet}

{#snippet iconoRehacerRecargos()}
	<!-- Documento con una flecha de vuelta: el desprendible recupera las líneas
	     que le faltaban. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"
		/>
		<path stroke-linecap="round" stroke-linejoin="round" d="M14 3l5 5v3" />
		<path stroke-linecap="round" d="M8 8h3M8 12h5" opacity="0.5" />
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M20.5 18.5a3.5 3.5 0 1 1-1-2.45"
		/>
		<path stroke-linecap="round" stroke-linejoin="round" d="M20.8 13.6v2.6h-2.6" />
	</svg>
{/snippet}

{#snippet iconoRehacerBonos()}
	<!-- Flecha de vuelta sobre una rejilla: las cantidades de la tabla regresan
	     a lo que dicen los tramos. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M20.5 12a8 8 0 1 1-2.6-5.9"
		/>
		<path stroke-linecap="round" stroke-linejoin="round" d="M20.5 3v4.2h-4.2" />
		<path stroke-linecap="round" d="M8.5 12h7M12 8.5v7" opacity="0.45" />
	</svg>
{/snippet}

{#snippet iconoAdicional()}
	<!-- Etiqueta con un «+»: un concepto que se añade al desprendible y lleva
	     rótulo propio. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M3 12.5V5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.41.59l6.5 6.5a2 2 0 0 1 0 2.82l-7.5 7.5a2 2 0 0 1-2.82 0L3.6 13.9"
		/>
		<circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
		<path stroke-linecap="round" d="M11 12h5M13.5 9.5v5" />
	</svg>
{/snippet}

<!-- El icono del bloque de estado. Los de cada transición —calculadora,
     sello, billete, flecha de vuelta, prohibido— se fueron con ellas a
     `NominaEstadoPanel`: son parte del vocabulario de estados, no de esta
     página. -->
{#snippet iconoEstado()}
	<svg
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

{#snippet iconoTablasRecargos()}
	<!-- Una tabla con una barra diagonal: el desglose que puede no imprimirse. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<rect x="3" y="4" width="18" height="16" rx="2" stroke-linejoin="round" />
		<path stroke-linecap="round" d="M3 9h18" />
		<path stroke-linecap="round" d="M9 9v11" opacity="0.6" />
		<path stroke-linecap="round" d="M4 20L20 4" />
	</svg>
{/snippet}

<!--
	Panel de las tablas de recargos.

	Dos alcances a la vez a propósito: el conductor que se está mirando y el
	periodo entero. Cuando un cliente no quiere el desglose no lo quiere para
	uno, lo quiere para todos; pero el caso de una sola hoja existe —un
	conductor que pidió su detalle— y obligar a recorrer treinta hojas para
	eso sería peor que el problema que esto resuelve.
-->
{#snippet panelTablasRecargos()}
	<div class="trec">
		<p class="trec-intro">
			El desglose hora a hora de cada planilla, que va en la segunda página del
			desprendible. Apagarlo <strong>no cambia lo que se paga</strong>: los
			recargos siguen sumando en la primera página.
		</p>

		<div class="trec-bloque">
			<span class="trec-titulo">Hoja abierta</span>
			{#if hojaActiva?.liquidacionId}
				<button
					type="button"
					class="trec-fila"
					role="switch"
					aria-checked={tablasEnHojaActiva}
					disabled={cambiandoTablas || !!accionEnCurso}
					onclick={alternarTablasDeLaHoja}
				>
					<span class="trec-nombre">{hojaActiva.nombre}</span>
					<span class="trec-switch" class:on={tablasEnHojaActiva}>
						<span class="trec-bola"></span>
					</span>
				</button>
				<span class="trec-estado">
					{tablasEnHojaActiva ? 'Imprime el desglose' : 'Sale sin el desglose'}
				</span>
			{:else}
				<span class="trec-vacio">
					Este conductor todavía no tiene liquidación en el periodo.
				</span>
			{/if}
		</div>

		<div class="trec-bloque">
			<span class="trec-titulo">
				Todo el periodo · {hojasConLiquidacion.length}
				{hojasConLiquidacion.length === 1 ? 'hoja' : 'hojas'}
			</span>
			<div class="trec-botones">
				<button
					type="button"
					disabled={cambiandoTablas || !!accionEnCurso || !hojasConLiquidacion.length}
					onclick={() => tablasEnTodoElPeriodo(false)}
				>
					Ocultar en todas
				</button>
				<button
					type="button"
					disabled={cambiandoTablas || !!accionEnCurso || !hojasConLiquidacion.length}
					onclick={() => tablasEnTodoElPeriodo(true)}
				>
					Mostrar en todas
				</button>
			</div>
			{#if hojasSinTablas.length}
				<span class="trec-estado">
					{hojasSinTablas.length}
					{hojasSinTablas.length === 1 ? 'hoja sale' : 'hojas salen'} sin el desglose.
				</span>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet panelEstado()}
	<NominaEstadoPanel
		hoja={hojaActiva
			? {
					liquidacionId: hojaActiva.liquidacionId,
					nombre: hojaActiva.nombre,
					estado: hojaActiva.estado
				}
			: null}
		{areas}
		borradores={borradoresDelPeriodo}
		hojas={datos?.hojas.map((h) => ({ liquidacionId: h.liquidacionId, estado: h.estado })) ?? []}
		periodo={datos?.etiqueta ?? `${MESES[mes - 1]} ${anio}`}
		onAccion={cambiarEstado}
		onLoteCambiado={aplicarCambiosDeLote}
	/>
{/snippet}

<svelte:head>
	<title>Nómina {MESES[mes - 1]} {anio} (canvas) · Cotransmeq</title>
</svelte:head>

<UniverToolbar
	title="NÓMINA"
	hoja={hojaActiva?.nombre ?? ''}
	subtitle="{datos?.etiqueta ?? ''}  ·  {datos?.hojas.length ??
		0} conductor(es)  ·  {conPlanilla} con planilla{sinPlanilla
		? `  ·  ${sinPlanilla} sin planilla`
		: ''}  ·  Σ neto ${formatCOP(totalNeto)}"
	onBack={volver}
	backLabel="Volver"
	inerte={!!accionEnCurso}
>
	{#snippet actions()}
		<!--
			Por CORTE (año, mes y día de inicio) o por RANGO específico (dos
			fechas). El rango es para lo que no se liquida por corte: un retiro
			del 21 al 30, un ingreso a mitad de periodo.
		-->
		<label class="univer-year-picker" title="Cómo se define el periodo del libro">
			<span>Periodo</span>
			<select
				value={rango ? 'rango' : 'corte'}
				onchange={(e) => {
					if ((e.currentTarget as HTMLSelectElement).value === 'rango') activarRango();
					else void cambiarPeriodo(anio, mes, corte);
				}}
			>
				<option value="corte">Corte</option>
				<option value="rango">Rango</option>
			</select>
		</label>

		{#if rango}
			<div class="univer-rango" title="Días que se liquidan, los dos incluidos">
				<label class="univer-year-picker">
					<span>Desde</span>
					<input
						type="date"
						value={rango.desde}
						max={rango.hasta}
						onchange={(e) =>
							void cambiarRango({ desde: e.currentTarget.value, hasta: rango!.hasta })}
					/>
				</label>
				<span class="univer-rango__sep" aria-hidden="true">—</span>
				<label class="univer-year-picker">
					<span>Hasta</span>
					<input
						type="date"
						value={rango.hasta}
						min={rango.desde}
						onchange={(e) =>
							void cambiarRango({ desde: rango!.desde, hasta: e.currentTarget.value })}
					/>
				</label>
			</div>
		{:else}
			<label class="univer-year-picker">
				<span>Año</span>
				<select
					value={anio}
					onchange={(e) =>
						cambiarPeriodo(Number((e.currentTarget as HTMLSelectElement).value), mes, corte)}
				>
					{#each anios as a (a)}
						<option value={a}>{a}</option>
					{/each}
				</select>
			</label>

			<select
				class="univer-month-picker"
				value={mes}
				onchange={(e) =>
					cambiarPeriodo(anio, Number((e.currentTarget as HTMLSelectElement).value), corte)}
				title="Mes de nómina"
			>
				{#each MESES as nombre, i (nombre)}
					<option value={i + 1}>{nombre}</option>
				{/each}
			</select>

			<!-- El corte va a la vista porque el 21→20 está deducido de los Excel,
			     no de una regla escrita: si algún mes se liquida distinto, se
			     cambia aquí en vez de tocar código. -->
			<label class="univer-year-picker" title="Día en que empieza el periodo">
				<span>Corte</span>
				<select
					value={corte}
					onchange={(e) =>
						cambiarPeriodo(anio, mes, Number((e.currentTarget as HTMLSelectElement).value))}
				>
					{#each [1, 15, 16, 20, 21, 25, 26] as d (d)}
						<option value={d}>{d}</option>
					{/each}
				</select>
			</label>
		{/if}

		<!-- Buscador y no `<select>`: con 25 conductores el desplegable nativo
		     obliga a recorrer la lista entera, no busca por cédula y no puede
		     enseñar ni el estado ni si el desprendible ya salió. Es el mismo
		     componente que el canvas de cierres usa para las placas. -->
		{#if datos?.hojas.length}
			<SelectorHojaNomina
				hojas={datos.hojas.map((h) => ({
					conductorId: h.conductorId,
					liquidacionId: h.liquidacionId,
					nombre: h.nombre,
					cedula: h.cedula,
					estado: h.estado,
					dias: h.dias.length
				}))}
				activo={conductorActivo}
				{envios}
				onSeleccionar={irAConductor}
			/>
		{/if}

		{#if hojaActiva}
			<span class="badge-estado {claseBadgeEstado(hojaActiva.estado)}">
				{hojaActiva.estado}
			</span>
			{#if !esEditable(hojaActiva.estado)}
				<span class="univer-badge" title="Las hojas en este estado son de solo lectura">
					solo lectura
				</span>
			{/if}
			<!--
				Sin liquidación no hay dónde guardar nada, así que la hoja es de
				solo lectura aunque su estado diga BORRADOR. El botón lo dice y lo
				resuelve en el sitio, en vez de mandar a «Generar borradores».
			-->
			<!--
				«Actualizar días» SOLO EN BORRADOR.

				Dos condiciones, y cada una dice algo distinto: sin liquidación no
				hay copia que refrescar, y a partir de LIQUIDADA no se debe. Esto
				último es más estricto que el «solo lectura» de la insignia —en
				LIQUIDADA la hoja se sigue editando— porque el botón no edita: tira
				la copia del corte y la rehace desde las planillas, con las horas
				corregidas a mano dentro.

				Se OCULTA en vez de deshabilitarse. Un botón apagado invita a
				buscar cómo encenderlo, y aquí la respuesta sería «devuelve la
				liquidación a BORRADOR», que es exactamente lo que no se quiere
				sugerir desde una barra. La insignia de al lado ya dice el estado.
			-->
			{#if hojaActiva.liquidacionId && permiteRefrescarDias(hojaActiva.estado)}
				<button
					type="button"
					class="btn-refrescar-dias"
					onclick={refrescarDiasDeLaHoja}
					disabled={refrescandoDias}
					title="Vuelve a traer los días desde las planillas. Descarta las horas corregidas a mano."
				>
					{refrescandoDias ? 'Actualizando…' : 'Actualizar días'}
				</button>
			{/if}
		{/if}

		<!-- «Generar borradores» vivía aquí y se fue al CARRIL, con el resto de
		     acciones. En la barra era el único botón que ejecutaba algo —lo demás
		     es contexto: periodo, hoja, estado— y encima competía por un espacio
		     que `.univer-shell-header` recorta sin scrollbar. La regla del canvas
		     de cierres ya era esa: «las ACCIONES viven en el carril de la derecha;
		     aquí solo queda el CONTEXTO». -->
		<span class="univer-divider-v"></span>

		<SelectorCanvasNomina actual="liquidaciones" {anio} {mes} onSalir={antesDeSalir} />

		<span class="univer-divider-v"></span>
		<!--
			El «Sin conexión» que había aquí lo dice ya el indicador, que además
			distingue las tres situaciones que ese badge metía en una: hay algo
			guardándose, todo está guardado, o hay cambios que se perdieron.
		-->
		<AutosaveIndicator {pendientes} {fallidas} {conectado} {ultimoGuardado} />
		<!--
			El rebote del recálculo, a la vista.
			Sin esto, entre que se confirma una celda de bono y la hoja se rehace
			hay casi un segundo en el que el desprendible de abajo enseña cifras
			viejas y nada dice que estén a punto de cambiar.
		-->
		{#if recalculoPendiente}
			<span class="nom-recalculo" title="Los bonos cambiaron: la hoja se rehace al parar de editar">
				<span class="nom-recalculo-punto"></span>
				Recalculando…
			</span>
		{/if}
		<PresenceAvatars users={presencia} />
	{/snippet}
</UniverToolbar>

<!-- Fila: canvas elástico + carril. El carril NO puede ser hermano suelto
     del host en la columna del shell: se lleva altura y Univer se monta con
     la que le quede (medido: 350px en vez del viewport). `.nom-canvas` es una
     COLUMNA para que `.univer-host` conserve el padre flex-column del que
     depende su cadena de altura (REGLA #2 de UniverCanvasHost). -->
<div class="nom-body">
	<div class="nom-canvas">
		<UniverCanvasHost
			bind:container
			{loading}
			error={loadError}
			loadingLabel="Cargando nómina de {MESES[mes - 1]} {anio}..."
			onRetry={loadInicial}
			errorLabel="Reintentar"
		/>

		<!--
			Periodo sin una sola liquidación: antes esto era un libro de pestañas
			vacías de solo lectura, una por conductor. Ahora el libro no se dibuja
			y se dice por qué, con el único botón que hace algo desde aquí.

			Va SUPERPUESTO y no en lugar del host: el contenedor de Univer tiene
			que seguir montado —el motor se ata a él al cargar el periodo— o
			generar los borradores dejaría el canvas en blanco hasta recargar.
		-->
		{#if !loading && !loadError && datos && !datos.hojas.length}
			<div class="nom-vacio">
				<h2>Sin liquidaciones en {datos.etiqueta}</h2>
				<p>
					El canvas edita las liquidaciones del periodo; todavía no hay ninguna. Generar los
					borradores crea una por conductor y entonces aparecen aquí sus hojas.
				</p>
				<button type="button" class="btn-crear-borrador" onclick={() => (mostrarGenerar = true)}>
					Generar borradores
				</button>
			</div>
		{/if}
	</div>

	<UniverSideRail ariaLabel="Acciones de nómina" items={railItems} />

	{#if accionEnCurso}
		<UniverActionOverlay accion={accionEnCurso} />
	{/if}
</div>

<SnapshotPanel
	open={historialAbierto}
	scope="nomina"
	{anio}
	{mes}
	onClose={() => (historialAbierto = false)}
	onReverted={() => loadInicial()}
/>

{#if mostrarEnviar && datos}
	<ModalEnviarDesprendibles
		hojas={datos.hojas
			.map((h) => ({
				liquidacionId: h.liquidacionId,
				nombre: h.nombre,
				correo: h.correo ?? null,
				estado: h.estado
			}))}
		{envios}
		etiquetaPeriodo={datos.etiqueta}
		{anio}
		{mes}
		onCerrar={() => (mostrarEnviar = false)}
		onEnviado={cargarEnvios}
	/>
{/if}

{#if mostrarNotificar && datos}
	<ModalNotificarNomina
		hojas={datos.hojas.map((h) => ({
			liquidacionId: h.liquidacionId,
			nombre: h.nombre,
			estado: h.estado
		}))}
		etiquetaPeriodo={datos.etiqueta}
		{anio}
		{mes}
		onCerrar={() => (mostrarNotificar = false)}
	/>
{/if}

{#if mostrarPeriodo && hojaActiva?.periodoLiquidacion}
	<PeriodoDesprendibleModal
		nombreHoja={hojaActiva.nombre}
		desde={hojaActiva.periodoLiquidacion.desde}
		hasta={hojaActiva.periodoLiquidacion.hasta}
		diasLaboradosActuales={hojaActiva.devengos.find((d) => d.clave === 'salario')?.cantidad ?? null}
		bloqueada={!!motivoBloqueoAdicionales()}
		motivoBloqueo={motivoBloqueoAdicionales()}
		guardando={guardandoPeriodo}
		onGuardar={guardarPeriodo}
		onClose={() => (mostrarPeriodo = false)}
	/>
{/if}

{#if mostrarDiasDesprendible && hojaActiva}
	<DiasDesprendibleModal
		nombreHoja={hojaActiva.nombre}
		dias={hojaActiva.dias}
		bloqueada={!!motivoBloqueoAdicionales()}
		motivoBloqueo={motivoBloqueoAdicionales()}
		guardando={guardandoMarcas}
		onGuardar={guardarMarcasDias}
		onClose={() => (mostrarDiasDesprendible = false)}
	/>
{/if}

{#if mostrarAdicionales && hojaActiva}
	<ConceptosAdicionalesModal
		nombreHoja={hojaActiva.nombre}
		conceptos={conceptosAdicionales}
		bloqueada={!!motivoBloqueoAdicionales()}
		motivoBloqueo={motivoBloqueoAdicionales()}
		guardando={pendientes > 0}
		onAgregar={(nombre, valor) => patchAdicional(nombre, valor)}
		onEliminar={(nombre) => patchAdicional(nombre, null)}
		onClose={() => (mostrarAdicionales = false)}
	/>
{/if}

{#if mostrarGenerar}
	<GenerarBorradoresNominaModal
		{anio}
		{mes}
		{corte}
		{rango}
		onClose={() => (mostrarGenerar = false)}
		onTerminado={() => void loadInicial()}
	/>
{/if}

{#if previewFirmadoUrl}
	<div class="fixed inset-0 z-[100] flex flex-col bg-slate-950/75 p-3 backdrop-blur-sm md:p-6" role="dialog" aria-modal="true" aria-label={previewFirmadoNombre}>
		<div class="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
			<header class="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 md:px-5">
				<div class="min-w-0">
					<p class="text-[10px] font-bold tracking-[0.16em] text-emerald-700">FIRMA RECIBIDA</p>
					<h2 class="truncate text-base font-bold text-slate-900">{previewFirmadoNombre}</h2>
				</div>
				<button class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onclick={cerrarPreviewFirmado}>Cerrar</button>
			</header>
			<iframe class="min-h-0 flex-1 bg-slate-100" src={previewFirmadoUrl} title={previewFirmadoNombre}></iframe>
		</div>
	</div>
{/if}

<style>
	/* Aviso de recálculo pendiente. Discreto a propósito: informa de una espera
	   de menos de un segundo y no debe competir con el indicador de guardado
	   que tiene al lado. */
	.nom-recalculo {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.7rem;
		color: var(--text-muted, #777);
		white-space: nowrap;
	}
	.nom-recalculo-punto {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #b45309;
		animation: nom-latido 1s ease-in-out infinite;
	}
	@keyframes nom-latido {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
	/* Quien pide menos movimiento no necesita un punto latiendo para entender
	   que algo está en curso: el texto ya lo dice. */
	@media (prefers-reduced-motion: reduce) {
		.nom-recalculo-punto {
			animation: none;
			opacity: 0.8;
		}
	}

	/* Fila: canvas elástico + carril. `min-width: 0` es obligatorio: sin él el
	   `width:100%` del host le gana al `flex` y empuja el carril fuera de la
	   pantalla. */
	.nom-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		/* Ancla de `UniverActionOverlay`, que es `position: absolute` y tiene
		   que cubrir canvas Y carril. */
		position: relative;
	}
	.nom-vacio {
		position: absolute;
		inset: 0;
		/* Por encima del lienzo de Univer, que va a `z-index: 8` dentro de este
		   mismo contexto de apilado: con menos, la rejilla vacía se pintaba
		   encima del cartel. */
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 2rem;
		text-align: center;
		background: var(--bg-base, #f8fafc);
	}
	.nom-vacio h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary, #0f172a);
	}
	.nom-vacio p {
		margin: 0;
		max-width: 46ch;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text-secondary, #475569);
	}

	.nom-canvas {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		/* Ancla de `.nom-vacio`, que se superpone al host sin desmontarlo. */
		position: relative;
	}

	/* La insignia de estado. El resto de controles de la barra vienen de
	   `toolbar.css`, compartido por todos los canvas. */
	.badge-estado {
		display: inline-flex;
		align-items: center;
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		white-space: nowrap;
		box-shadow: inset 0 0 0 1px currentColor;
	}

	/**
	 * Botón de «crear borrador»: ámbar, no verde.
	 *
	 * Verde diría «todo en orden» justo donde hay algo pendiente, y en esta
	 * cabecera compite con el badge de estado. El ámbar es el mismo que usa la
	 * hoja para lo que requiere atención.
	 */
	.btn-crear-borrador {
		border: 1px solid #fcd34d;
		background: #fffbeb;
		color: #92400e;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.15rem 0.55rem;
		border-radius: 6px;
		white-space: nowrap;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.btn-crear-borrador:hover:not(:disabled) {
		background: #fef3c7;
	}
	.btn-crear-borrador:disabled {
		opacity: 0.6;
		cursor: default;
	}

	/* Sobrio, no ámbar: refrescar es rutina, no una alerta. El ámbar está
	   reservado a «falta el borrador», que sí bloquea. */
	.btn-refrescar-dias {
		border: 1px solid var(--border-default);
		background: #ffffff;
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.55rem;
		border-radius: 6px;
		white-space: nowrap;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.btn-refrescar-dias:hover:not(:disabled) {
		background: var(--bg-base);
	}
	.btn-refrescar-dias:disabled {
		opacity: 0.6;
		cursor: default;
	}

	/* ─── Panel de tablas de recargos ─────────────────────────────────────
	   Es un flyout de 320px sobre el canvas, así que todo va apretado: el
	   texto explicativo es lo único que puede ocupar dos líneas. El acento
	   del interruptor es el de la marca, igual que el `tone: 'green'` del
	   carril, que en cotransmeq es naranja. */
	.trec {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.trec-intro {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--text-muted, #666);
	}
	.trec-intro strong {
		color: var(--text, #1f2937);
		font-weight: 600;
	}
	.trec-bloque {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.trec-titulo {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted, #8a8a8a);
	}
	.trec-fila {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.trec-fila:hover:not(:disabled) {
		border-color: #ea580c;
	}
	.trec-fila:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.trec-nombre {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text, #1f2937);
	}
	/* Interruptor dibujado a mano: un <input type=checkbox> con apariencia de
	   switch arrastra el estilo del navegador y aquí conviven Chrome y Safari.
	   El botón ya lleva role="switch" y aria-checked, así que para un lector
	   de pantalla esto es un interruptor de verdad. */
	.trec-switch {
		flex: 0 0 auto;
		position: relative;
		width: 32px;
		height: 18px;
		border-radius: 999px;
		background: #cbd5e1;
		transition: background 0.15s ease;
	}
	.trec-switch.on {
		background: #ea580c;
	}
	.trec-bola {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.15s ease;
	}
	.trec-switch.on .trec-bola {
		transform: translateX(14px);
	}
	@media (prefers-reduced-motion: reduce) {
		.trec-switch,
		.trec-bola {
			transition: none;
		}
	}
	.trec-estado {
		font-size: 0.68rem;
		color: var(--text-muted, #777);
	}
	.trec-vacio {
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-muted, #777);
	}
	.trec-botones {
		display: flex;
		gap: 0.4rem;
	}
	.trec-botones button {
		flex: 1 1 0;
		padding: 0.4rem 0.3rem;
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 8px;
		background: #fff;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text, #1f2937);
		cursor: pointer;
	}
	.trec-botones button:hover:not(:disabled) {
		border-color: #ea580c;
		color: #c2410c;
	}
	.trec-botones button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
