<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';

	import { nominaCanvasAPI, nominaEnviosAPI, type PeriodoNominaDTO } from '$lib/api/nomina-canvas';
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
		accionesDisponibles,
		claseBadgeEstado,
		esEditable,
		ESTADOS_BLOQUEADOS,
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
	/// Iconos COMPARTIDOS por todos los canvas. Los propios de nómina —liquidar,
	/// aprobar, pagar…— se siguen declarando abajo: son de este dominio.
	import {
		icoVer,
		icoExcel,
		icoZip,
		icoCorreo,
		icoHistorial,
		icoRecargar,
		icoVersion,
		icoBorradores
	} from '$lib/components/univer/iconos-canvas.svelte';
	import GenerarBorradoresNominaModal from '$lib/components/nomina/GenerarBorradoresNominaModal.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import UniverSideRail, { type RailItem } from '$lib/components/univer/UniverSideRail.svelte';
	import UniverActionOverlay from '$lib/components/univer/UniverActionOverlay.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
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
	let accionEnCurso = $state<{ titulo: string; detalle?: string } | null>(null);
	let presencia = $state<{ id: string; name: string }[]>([]);
	let conectado = $state(true);
	let historialAbierto = $state(false);

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
	let acciones = $derived<AccionEstado[]>(
		hojaActiva ? accionesDisponibles(hojaActiva.estado, areas) : []
	);

	function syncUrl() {
		const url = new URL(window.location.href);
		url.searchParams.set('anio', String(anio));
		url.searchParams.set('mes', String(mes));
		url.searchParams.set('desde', String(corte));

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

	// ─── Carga ─────────────────────────────────────────────
	async function loadInicial() {
		loading = true;
		loadError = '';
		try {
			datos = await nominaCanvasAPI.periodo(anio, mes, corte);
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

			canvasDisposers.push(
				installNominaCellPermission(nuevo.univer, {
					unitId: nuevo.unitId,
					estadoPorHoja: () => nuevo.estadoPorHoja(),
					estadosBloqueados: ESTADOS_BLOQUEADOS,
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
					onPatch: ({ binding, valor }) => {
						const hoja = datos?.hojas.find((h) => h.liquidacionId === binding.entityId);
						// Sin hoja no hay `version` que mandar, y sin versión el
						// compare-and-swap no compara nada: el servidor
						// aceptaría el cambio pisando lo que hubiera. Mejor no
						// enviarlo y decirlo.
						if (!hoja) {
							toast.error('No se pudo guardar: recarga el periodo.');
							return;
						}
						session?.enviarPatch({
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
		// anterior ya no vale.
		limpiarCacheDesprendibles();
		anio = nuevoAnio;
		mes = nuevoMes;
		corte = nuevoCorte;
		syncUrl();
		conectarSesion();
		await loadInicial();
	}

	function irAConductor(conductorId: string) {
		conductorActivo = conductorId;
		ctx?.activarConductor(conductorId);
	}

	// ─── Sesión colaborativa ───────────────────────────────
	function conectarSesion() {
		session?.dispose();
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
			onAck: ({ entity_id, version, totales }) => {
				const hoja = datos?.hojas.find((h) => h.liquidacionId === entity_id);
				if (!hoja) return;
				hoja.version = version;
				if (totales) hoja.totales = totales as any;
			},

			onRemotePatch: (p) => {
				if (!ctx) return;
				const destino = getNominaCellFor(ctx.unitId, String(p.entity_id), String(p.field));
				if (!destino) return;
				// `aplicarCeldaRemota` marca la ventana de eco: sin ella, esta
				// escritura dispararía el adapter y volvería al emisor en bucle.
				aplicarCeldaRemota(ctx, destino, p.value as any);
				const hoja = datos?.hojas.find((h) => h.liquidacionId === p.entity_id);
				if (hoja && typeof p.version === 'number') hoja.version = p.version;
			},

			onConflict: ({ entity_id, server_row }) => {
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
			disabled: !!accionEnCurso
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
			id: 'enviar',
			label: 'Enviar desprendibles',
			hint: 'Manda el PDF por correo a cada conductor y deja constancia.',
			icon: icoCorreo,
			tone: 'blue' as const,
			onSelect: enviarDesprendibles,
			disabled: !!accionEnCurso || !datos?.hojas.length
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
		...acciones.map((a) => ({
			id: `estado-${a.estado}`,
			label: a.etiqueta,
			hint: hojaActiva ? `${hojaActiva.nombre} · ${hojaActiva.estado}` : '',
			// Un icono por acción, no uno para todas: con el mismo visto bueno
			// en «Liquidar», «Aprobar» y «Devolver a borrador» el carril pedía
			// leer el popover para saber cuál era cuál.
			icon: ICONO_ESTADO[a.estado],
			tone: a.tono === 'peligro' ? ('red' as const) : ('green' as const),
			onSelect: () => cambiarEstado(a),
			disabled: !!accionEnCurso || !hojaActiva?.liquidacionId,
			disabledHint: !hojaActiva?.liquidacionId
				? 'Este conductor todavía no tiene liquidación en el periodo.'
				: undefined
		}))
	]);

	/**
	 * Icono por estado destino. Cada acción tiene el suyo:
	 *   LIQUIDADA → calculadora (se hacen las cuentas)
	 *   APROBADA  → sello de visto bueno
	 *   PAGADA    → billete
	 *   BORRADOR  → flecha de vuelta atrás
	 *   ANULADA   → prohibido
	 */
	const ICONO_ESTADO: Record<string, any> = $derived({
		LIQUIDADA: iconoLiquidar,
		APROBADA: iconoAprobar,
		PAGADA: iconoPagar,
		BORRADOR: iconoDevolver,
		ANULADA: iconoAnular
	});

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
		session?.dispose();
		teardownEngine();
		limpiarCacheDesprendibles();
	});
</script>

{#snippet iconoLiquidar()}
	<!-- Calculadora: liquidar es hacer las cuentas. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<rect x="5" y="3" width="14" height="18" rx="2" />
		<path
			stroke-linecap="round"
			d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h4"
		/>
	</svg>
{/snippet}

{#snippet iconoAprobar()}
	<!-- Sello: aprobar congela el documento. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M12 3l2.5 1.6 3-.3 1 2.8 2.4 1.8-1.3 2.7 1.3 2.7-2.4 1.8-1 2.8-3-.3L12 20l-2.5-1.6-3 .3-1-2.8L3.1 14l1.3-2.7L3.1 8.6l2.4-1.8 1-2.8 3 .3z"
		/>
		<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4" />
	</svg>
{/snippet}

{#snippet iconoPagar()}
	<!-- Billete: pagada es que el dinero salió. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<rect x="2" y="6" width="20" height="12" rx="2" />
		<circle cx="12" cy="12" r="2.5" />
		<path stroke-linecap="round" d="M6 12h.01M18 12h.01" />
	</svg>
{/snippet}

{#snippet iconoDevolver()}
	<!-- Flecha de vuelta: devolver a borrador es deshacer. -->
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M9 14l-5-5 5-5" />
		<path stroke-linecap="round" stroke-linejoin="round" d="M4 9h10a6 6 0 010 12H8" />
	</svg>
{/snippet}

{#snippet iconoAnular()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<circle cx="12" cy="12" r="9" />
		<path stroke-linecap="round" d="M6 6l12 12" />
	</svg>
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
		<PresenceAvatars users={presencia} />
		{#if !conectado}
			<span class="univer-badge" title="Los cambios no se están guardando">Sin conexión</span>
		{/if}
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

{#if mostrarGenerar}
	<GenerarBorradoresNominaModal
		{anio}
		{mes}
		{corte}
		onClose={() => (mostrarGenerar = false)}
		onTerminado={() => void loadInicial()}
	/>
{/if}

<style>
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
	.nom-canvas {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
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
</style>
