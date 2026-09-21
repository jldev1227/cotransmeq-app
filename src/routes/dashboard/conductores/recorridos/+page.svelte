<script lang="ts">
	/**
	 * Canvas de RECORRIDOS.
	 *
	 * Un libro por CORTE (`?desde=&hasta=`), una hoja por conductor y UNA FILA
	 * POR RECORRIDO: dos recorridos el mismo día son dos filas seguidas, sin
	 * agrupar por día ni por cliente, ordenadas de la fecha más antigua a la más
	 * reciente.
	 *
	 * Editar está reservado a Administración y Operaciones; para el resto la
	 * hoja se monta sin bindings y queda de solo lectura (ver
	 * `cell-permission-recorridos.ts`). El backend vuelve a comprobarlo en cada
	 * patch, así que ocultar botones aquí es comodidad, no seguridad.
	 *
	 * ── FILAS INSERTADAS: BORRADORES ──────────────────────────────────────
	 *
	 * Una fila que el usuario inserta no existe en el servidor hasta que tiene
	 * lo mínimo para ser algo: fecha + placa + horario (un recorrido) o fecha +
	 * tipo de día (un día sin recorrido). Hasta entonces sus celdas escriben en
	 * un BORRADOR local —`borradores`— y la fila se ve en ámbar. En cuanto está
	 * completa se da de alta por REST, el servidor devuelve la fila con sus ids
	 * y su versión, y el engine la vincula: a partir de ahí es una fila como las
	 * demás y sus celdas viajan como patch.
	 */
	import { onDestroy, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { toast } from 'svelte-sonner';

	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import UniverCanvasHost from '$lib/components/univer/UniverCanvasHost.svelte';
	import UniverSideRail, { type RailItem } from '$lib/components/univer/UniverSideRail.svelte';
	import UniverActionOverlay from '$lib/components/univer/UniverActionOverlay.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import ModalConfigBonos from '$lib/components/conductores/ModalConfigBonos.svelte';
	import SnapshotPanel from '$lib/components/univer/SnapshotPanel.svelte';
	import PreviewCanvasModal from '$lib/components/liquidaciones-terceros/preview/PreviewCanvasModal.svelte';

	import { authStore } from '$lib/stores/auth';
	import { recorridosCanvasAPI, recorridosSnapshotsAPI } from '$lib/api/recorridos-canvas';
	import {
		crearRecorridosEngine,
		PREFIJO_FILA_NUEVA,
		type FilaEliminada,
		type RecorridosEngineContext
	} from '$lib/editor/univer/recorridos-engine';
	import {
		installRecorridosCellChangeAdapter,
		type CambioRecorrido
	} from '$lib/editor/univer/adapters/cell-change-recorridos';
	import { estaRepintando } from '$lib/editor/univer/cell-permission-recorridos';
	import { createSheetSession, type SheetSession } from '$lib/editor/canvas/sheet-session.svelte';
	import { conductorIdDeSheetId } from '$lib/editor/builders/recorridos-identidad';
	import { documentoRecorridos, hojasParaZip } from '$lib/components/liquidaciones-terceros/preview/datos/recorridos.doc';
	import { exportarZipPdfs } from '$lib/components/liquidaciones-terceros/preview/exportar-zip';
	import {
		faltantesDeBorrador,
		fechaDesdeCelda,
		horaDesdeCelda,
		horasDesdeCelda,
		placaDesdeCelda
	} from '$lib/editor/business/recorridos-celdas';
	import type {
		FilaRecorrido,
		HojaRecorridos,
		RecorridosPeriodoDTO
	} from '$lib/editor/builders/recorridos.builder';
	import {
		corteAnterior,
		cortePorDefecto,
		corteSiguiente,
		etiquetaCorte,
		esFechaValida,
		periodoDeCorte,
		type Corte
	} from '$lib/utils/corte-periodo';

	// ── Corte (de la URL) ─────────────────────────────────────────────
	//
	// Los recorridos se liquidan por CORTE, del 21 de un mes al 20 del
	// siguiente, no por mes natural: filtrar por «agosto» partía en dos el
	// periodo que Operaciones estaba revisando. Las dos fechas son libres; lo
	// que se ofrece por defecto es el corte 21→20 vivo.
	const corte = $derived.by<Corte>(() => {
		const desde = $page.url.searchParams.get('desde');
		const hasta = $page.url.searchParams.get('hasta');
		if (esFechaValida(desde) && esFechaValida(hasta) && desde! <= hasta!) {
			return { desde: desde!, hasta: hasta! };
		}
		return cortePorDefecto();
	});

	/// Mes en que cierra el corte. Identifica el room de socket y los snapshots.
	const periodo = $derived(periodoDeCorte(corte));
	const anio = $derived(periodo.anio);
	const mes = $derived(periodo.mes);

	/// Conductor con el que abrir, si se llegó desde la ficha de uno concreto.
	const conductorInicial = $derived($page.url.searchParams.get('conductor'));

	// ── Permisos ──────────────────────────────────────────────────────
	// Se lee `$authStore` a propósito para que el derived se recalcule cuando
	// termine de hidratarse la sesión.
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('recorridos') === 'full'
	);
	const puedeMarcarBonos = $derived(
		puedeEditar && $authStore.user?.permisos?.['bonos-planilla'] === true
	);

	// ── Estado ────────────────────────────────────────────────────────
	// `$state.raw`: un `$state` normal envolvería la instancia de Univer en un
	// proxy profundo y rompería el injector, el Worker y los disposables.
	let ctx = $state.raw<RecorridosEngineContext | null>(null);
	let contenedor = $state<HTMLDivElement | null>(null);
	let cargando = $state(true);
	let errorCarga = $state('');
	let dto = $state.raw<RecorridosPeriodoDTO | null>(null);
	let session = $state.raw<SheetSession | null>(null);
	let desinstalarAdapter: (() => void) | null = null;

	let pendientes = $state(0);
	let fallidas = $state(0);
	let conectado = $state(true);
	let presencia = $state.raw<Array<{ id: string; name: string }>>([]);

	let modalBonos = $state(false);
	let panelVersiones = $state(false);
	let previewAbierto = $state(false);
	/**
	 * Qué entra en el preview: la hoja que se está mirando o el periodo entero.
	 *
	 * Con «todos» el preview se NAVEGA conductor por conductor: se monta solo el
	 * documento del que se está viendo, no los cuarenta a la vez —que es lo que
	 * dejaba el navegador sin responder—, y desde él se exporta uno o el
	 * consolidado completo.
	 */
	let alcancePreview = $state<'hoja' | 'todos'>('hoja');
	/** Conductor visible en el preview de «todos». */
	let previewIndice = $state(0);
	let accionEnCurso = $state<{ titulo: string; detalle?: string } | null>(null);
	let conductorActivo = $state<string | null>(null);

	/**
	 * Descarta engines de un montaje que perdió la carrera.
	 *
	 * Sin esto, cambiar de mes dos veces seguidas deja un Univer huérfano con su
	 * Worker vivo.
	 */
	let mountToken = 0;

	/** Índice vivo de filas por id, para resolver versiones y repintar. */
	const filaPorId = new Map<string, FilaRecorrido>();

	/**
	 * Placas de la flota, para rechazar en el acto una placa que no existe y
	 * aconsejar registrarla. Vacío hasta que carga; entonces se confía en el
	 * servidor, que la comprueba igual.
	 */
	let placasValidas = new Set<string>();

	interface Borrador {
		sheetId: string;
		row: number;
		conductorId: string;
		valores: Record<string, unknown>;
		bonos: Set<string>;
		guardando: boolean;
	}
	/** Filas insertadas y aún sin guardar, por su id local. */
	const borradores = new Map<string, Borrador>();
	let borradoresPendientes = $state(0);

	/**
	 * Valor que tenía una celda antes de una edición aún sin confirmar, por
	 * `entityId:field`. Si el servidor la rechaza, se repone: dejar en pantalla
	 * un valor que no se guardó es la forma más silenciosa de perder datos.
	 */
	const previos = new Map<string, unknown>();

	/** Última alta o baja de filas hecha desde AQUÍ, para ignorar su propio eco. */
	let ultimaEstructuraPropia = 0;

	function reindexar(d: RecorridosPeriodoDTO) {
		filaPorId.clear();
		for (const h of d.hojas) {
			for (const f of h.filas) {
				filaPorId.set(f.segmento_id ?? f.registro_dia_id, f);
			}
		}
	}

	function hojaDe(conductorId: string): HojaRecorridos | undefined {
		return dto?.hojas.find((h) => h.conductor_id === conductorId);
	}

	/** El DTO cambió por dentro: se reasigna para que los derivados lo noten. */
	function notificarDto() {
		if (dto) dto = { ...dto, hojas: [...dto.hojas] };
	}

	// ── Carga y montaje ───────────────────────────────────────────────

	async function montar() {
		if (!browser || !contenedor) return;
		const token = ++mountToken;

		cargando = true;
		errorCarga = '';
		desmontarEngine();
		borradores.clear();
		borradoresPendientes = 0;
		previos.clear();

		try {
			const d = await recorridosCanvasAPI.periodo({ ...corte });
			if (token !== mountToken) return;

			dto = d;
			reindexar(d);
			for (const aviso of d.avisos) toast.info(aviso, { id: `aviso-${aviso.slice(0, 24)}` });

			await tick();
			if (token !== mountToken || !contenedor) return;

			const engine = crearRecorridosEngine({
				container: contenedor,
				dto: d,
				editable: puedeEditar,
				onBloqueado: (aviso) =>
					// `id` fijo: sin clave salen tres o cuatro avisos apilados por un
					// solo intento de escribir en una celda derivada.
					toast.warning(aviso.titulo, { description: aviso.detalle, id: 'recorridos-bloqueada' }),
				onFilaNueva: (e) => {
					borradores.set(e.entityId, {
						sheetId: e.sheetId,
						row: e.row,
						conductorId: e.conductorId,
						valores: {},
						bonos: new Set(),
						guardando: false
					});
					borradoresPendientes = borradores.size;
					toast.info('Fila nueva', {
						description:
							'Escribe la fecha y, o bien placa y horario (recorrido), o bien el tipo de día. Se guarda sola al completarla.',
						id: 'recorridos-fila-nueva'
					});
				},
				onFilasEliminadas: (e) => void eliminarFilas(e.filas),
				onRepintarFilas: (ids) => {
					for (const id of ids) {
						const fila = filaPorId.get(id);
						if (fila) ctx?.pintarFila(id, fila);
					}
				}
			});

			if (token !== mountToken) {
				engine.dispose();
				return;
			}
			ctx = engine;
			/// Solo en desarrollo: un asidero para probar el canvas desde la consola
			/// (insertar filas, ejecutar comandos) sin pasar por el menú contextual.
			if (import.meta.env.DEV) (window as any).__recorridosEngine = engine;

			desinstalarAdapter = installRecorridosCellChangeAdapter({
				unitId: engine.unitId,
				commandService: engine.univer.__getInjector().get(
					// El servicio de comandos se resuelve del injector del propio
					// Univer: importarlo por token aquí crearía otra instancia.
					(await import('@univerjs/core')).ICommandService
				),
				getWorkbook: () => engine.fUniver.getActiveWorkbook() as never,
				resolveConductor: (sheetId) =>
					engine.conductorPorSheetId.get(sheetId) ?? conductorIdDeSheetId(sheetId),
				// Un borrador no tiene versión que comparar: sus celdas no viajan
				// como patch, se acumulan hasta guardarlo.
				versionDe: (entityId) =>
					entityId.startsWith(PREFIJO_FILA_NUEVA) ? 0 : (filaPorId.get(entityId)?.version ?? null),
				onCambios: enviarCambios,
				onHojaActiva: (conductorId) => {
					conductorActivo = conductorId;
					sincronizarUrl();
					session?.setHojaActiva(mes, engine.sheetIdPorConductor[conductorId] ?? null);
				},
				// Sin esto, cada celda que el canvas pinta al aplicar un patch se lee
				// como una edición del usuario y se reenvía: eco infinito.
				isApplyingRemote: () => estaRepintando()
			});

			// Si se llegó desde la ficha de un conductor, se abre SU hoja; si esa
			// persona no tiene recorridos este mes, se cae a la primera.
			const pedido =
				conductorInicial && d.hojas.some((h) => h.conductor_id === conductorInicial)
					? conductorInicial
					: null;
			conductorActivo = pedido ?? d.hojas[0]?.conductor_id ?? null;
			/// La URL queda diciendo qué se está mirando, aunque se entrara sin
			/// parámetros: así recargar, compartir el enlace o volver con el
			/// botón atrás devuelve el mismo corte y la misma hoja, en vez del
			/// corte por defecto del día en que se abra.
			sincronizarUrl();
			if (pedido) engine.activar(pedido);
			else if (conductorInicial) {
				toast.info('Ese conductor no tiene recorridos en el periodo seleccionado');
			}
			abrirSesion();
			void cargarPlacas();
		} catch (e: any) {
			if (token !== mountToken) return;
			errorCarga = e?.response?.data?.error ?? e?.message ?? 'No se pudo cargar el periodo';
		} finally {
			if (token === mountToken) cargando = false;
		}
	}

	async function cargarPlacas() {
		if (!puedeEditar || placasValidas.size) return;
		try {
			const placas = await recorridosCanvasAPI.placas();
			placasValidas = new Set(placas.map((p) => p.placa.toUpperCase().replace(/\s+/g, '')));
		} catch (e) {
			// Sin la lista se valida solo en el servidor: peor aviso, mismo resultado.
			console.warn('[recorridos] no se pudo cargar la lista de placas', e);
		}
	}

	function desmontarEngine() {
		try {
			desinstalarAdapter?.();
		} catch {
			/* noop */
		}
		desinstalarAdapter = null;
		try {
			ctx?.dispose();
		} catch {
			/* noop */
		}
		ctx = null;
	}

	// ── Tiempo real ───────────────────────────────────────────────────

	function abrirSesion() {
		session?.dispose();
		const user = $authStore.user;
		if (!user) return;

		session = createSheetSession({
			scope: 'recorridos',
			anio,
			mes,
			user: { id: user.id, name: user.nombre ?? user.correo ?? 'Usuario' },
			onRemotePatch: (p: any) => {
				const fila = filaPorId.get(String(p.entity_id));
				if (!fila) return;
				aplicarEnModelo(fila, p.field, p.value, p.derivados);
				fila.version = p.version;
				ctx?.pintarFila(String(p.entity_id), fila);
				propagarAfectados(p.afectados, p.derivados);
			},
			onAck: (a: any) => {
				pendientes = Math.max(0, pendientes - 1);
				previos.delete(`${a.entity_id}:${a.field}`);
				const fila = filaPorId.get(String(a.entity_id));
				if (!fila) return;
				// La versión nueva es obligatoria: sin ella el siguiente patch de
				// esa fila iría con una `base_version` obsoleta y el servidor lo
				// rechazaría por conflicto contra el propio usuario.
				fila.version = a.version;
				if (a.derivados && Object.keys(a.derivados).length) {
					aplicarEnModelo(fila, '', null, a.derivados);
					ctx?.pintarFila(String(a.entity_id), fila);
				}
				propagarAfectados(a.afectados, a.derivados);
			},
			onConflict: (c: any) => {
				pendientes = Math.max(0, pendientes - 1);
				previos.delete(`${c.entity_id}:${c.field}`);
				const fila = filaPorId.get(String(c.entity_id));
				if (fila && c.server_row) {
					Object.assign(fila, c.server_row);
					if (typeof c.server_row.version === 'number') fila.version = c.server_row.version;
					ctx?.pintarFila(String(c.entity_id), fila);
				}
				toast.warning('Otro usuario cambió esa fila antes que tú', {
					description: 'Se recuperó el valor del servidor. Vuelve a aplicar tu cambio si sigue haciendo falta.',
					id: 'recorridos-conflicto'
				});
			},
			onPatchError: (e: any) => {
				pendientes = Math.max(0, pendientes - 1);
				fallidas++;
				toast.error(e?.error ?? 'No se pudo guardar el cambio', { id: 'recorridos-error' });
			},
			onPatchFallido: (e: { entity_id: string; field: string; motivo: 'error' | 'timeout'; error?: string }) => {
				pendientes = Math.max(0, pendientes - 1);
				fallidas++;
				reponerValor(e.entity_id, e.field);
				if (e.motivo === 'error' && e.error) {
					toast.error(e.error, { id: 'recorridos-error', duration: 7000 });
				}
			},
			onInvalidate: (i: { accion?: string; by?: string | null }) => {
				if (i.accion !== 'filas') return;
				// El propio eco: la fila ya está en la hoja, no hay nada que releer.
				if (i.by === user.id && Date.now() - ultimaEstructuraPropia < 5000) return;
				if (pendientes > 0 || borradores.size > 0) {
					toast.info('Otro usuario añadió o quitó filas', {
						description: 'Recarga cuando termines lo que tienes a medias.',
						id: 'recorridos-invalidate'
					});
					return;
				}
				void montar();
			},
			onPresence: (users: any[]) => {
				presencia = users.map((u) => ({ id: u.id, name: u.name }));
			},
			onConexion: (c: boolean) => {
				conectado = c;
			},
			onReverted: () => {
				toast.info('Se revirtió una versión del periodo. Recargando…', { id: 'recorridos-revert' });
				void montar();
			}
		} as never);
	}

	/**
	 * Mover una FECHA mueve el día entero: el servidor devuelve qué otros
	 * recorridos de esa jornada cambiaron y se repintan con la fecha nueva.
	 */
	function propagarAfectados(afectados: unknown, derivados: Record<string, unknown> | undefined) {
		if (!Array.isArray(afectados) || !derivados) return;
		for (const id of afectados) {
			const otra = filaPorId.get(String(id));
			if (!otra) continue;
			aplicarEnModelo(otra, '', null, derivados);
			ctx?.pintarFila(String(id), otra);
		}
	}

	/** Aplica en el modelo local lo que confirmó o difundió el servidor. */
	function aplicarEnModelo(
		fila: FilaRecorrido,
		field: string,
		value: unknown,
		derivados?: Record<string, unknown>
	) {
		const escribir = (campo: string, v: unknown) => {
			if (campo.startsWith('bono:')) {
				const id = campo.slice('bono:'.length);
				fila.bonos = { ...(fila.bonos ?? {}), [id]: v === true || v === 'SÍ' || v === 'SI' };
				return;
			}
			if (campo === 'pernocte') {
				fila.pernocte = v === true || v === 'SÍ' || v === 'SI';
				return;
			}
			if (campo) (fila as unknown as Record<string, unknown>)[campo] = v;
		};

		if (field) escribir(field, value);
		// Los derivados van DESPUÉS: el servidor resuelve el nombre del cliente y
		// la placa a partir del texto tecleado, y su versión es la buena.
		for (const [k, v] of Object.entries(derivados ?? {})) escribir(k, v);
	}

	function leerCampo(fila: FilaRecorrido, field: string): unknown {
		if (field.startsWith('bono:')) return fila.bonos?.[field.slice('bono:'.length)] === true;
		return (fila as unknown as Record<string, unknown>)[field];
	}

	/** Devuelve a la celda el valor que tenía antes de una edición rechazada. */
	function reponerValor(entityId: string, field: string) {
		const clave = `${entityId}:${field}`;
		if (!previos.has(clave)) return;
		const previo = previos.get(clave);
		previos.delete(clave);
		const fila = filaPorId.get(entityId);
		if (fila) aplicarEnModelo(fila, field, previo);
		ctx?.pintarCelda(entityId, field, previo);
	}

	// ── Validación local de lo tecleado ───────────────────────────────

	/**
	 * Valida y normaliza un valor ANTES de enviarlo o de apuntarlo en un
	 * borrador. Devuelve el valor listo, o `null` si se rechazó (ya avisado).
	 *
	 * Solo lo que el usuario puede corregir al instante y que el servidor no
	 * puede explicar mejor: la fecha fuera del corte —que se guardaría y
	 * desaparecería del libro en la siguiente recarga— y la placa que no existe.
	 */
	function validarLocal(field: string, value: unknown): { ok: true; valor: unknown } | { ok: false } {
		if (field === 'fecha') {
			const fecha = fechaDesdeCelda(value);
			if (!fecha) {
				toast.error('Fecha no válida', {
					description: 'Escríbela como AAAA-MM-DD, por ejemplo 2026-09-03.',
					id: 'recorridos-fecha'
				});
				return { ok: false };
			}
			if (fecha < corte.desde || fecha > corte.hasta) {
				toast.error(`El ${fecha} queda fuera del corte`, {
					description: `Este libro va del ${corte.desde} al ${corte.hasta}. Corrige la fecha o cambia de corte en la barra superior.`,
					id: 'recorridos-fecha',
					duration: 8000
				});
				return { ok: false };
			}
			return { ok: true, valor: fecha };
		}
		if (field === 'vehiculo_placa') {
			const placa = placaDesdeCelda(value);
			if (placa && placasValidas.size && !placasValidas.has(placa)) {
				toast.error(`La placa ${placa} no está registrada`, {
					description: 'Regístrala en Flota y vuelve a escribirla aquí.',
					id: 'recorridos-placa',
					duration: 8000,
					action: { label: 'Ir a Flota', onClick: () => void goto('/dashboard/flota') }
				});
				return { ok: false };
			}
			return { ok: true, valor: placa };
		}
		if (field === 'hora_inicio' || field === 'hora_fin') return { ok: true, valor: horaDesdeCelda(value) };
		if (field === 'horas_conducidas') return { ok: true, valor: horasDesdeCelda(value) };
		return { ok: true, valor: value };
	}

	function enviarCambios(cambios: CambioRecorrido[]) {
		for (const c of cambios) {
			if (c.field.startsWith('bono:') && !puedeMarcarBonos) {
				toast.error('No tienes el permiso «bonos-planilla»', {
					description: 'Pide a un administrador que lo habilite en tu usuario.',
					id: 'recorridos-sin-bonos'
				});
				if (c.tipoFila !== 'nueva') reponerValor(c.entityId, c.field);
				continue;
			}

			if (c.tipoFila === 'nueva') {
				anotarEnBorrador(c);
				continue;
			}

			const fila = filaPorId.get(String(c.entityId));
			if (!fila || !session) continue;

			const clave = `${c.entityId}:${c.field}`;
			if (!previos.has(clave)) previos.set(clave, leerCampo(fila, c.field));

			const validado = validarLocal(c.field, c.value);
			if (!validado.ok) {
				reponerValor(c.entityId, c.field);
				continue;
			}
			/// Lo normalizado se pinta ya: una fecha tecleada como serial de Excel
			/// o una hora como fracción del día tienen que verse como texto.
			if (validado.valor !== c.value) ctx?.pintarCelda(c.entityId, c.field, validado.valor);

			/**
			 * El cambio se apunta en el modelo ANTES de enviarlo.
			 *
			 * El acuse del servidor no devuelve el valor, solo la versión y los
			 * `derivados` —que en un campo normal vienen vacíos—, así que al
			 * repintar la fila con el ack el canvas usaba el modelo, y el modelo
			 * todavía tenía el valor ANTERIOR: la casilla volvía sola a su
			 * estado de partida. Se guardaba en la base y al recargar aparecía
			 * bien, pero en pantalla parecía que desmarcar no hacía nada.
			 *
			 * Si el servidor rechaza el patch, `onConflict` y `onPatchFallido`
			 * reponen la fila con lo que diga el servidor o con el valor previo.
			 */
			aplicarEnModelo(fila, c.field, validado.valor);
			if (c.field === 'fecha') ctx?.pintarCelda(c.entityId, 'fecha', validado.valor);

			pendientes++;
			session.enviarPatch({
				mes,
				entity_type: c.tipoFila,
				entity_id: c.entityId,
				field: c.field,
				value: validado.valor as string | number | boolean | null,
				base_version: c.baseVersion
			});
		}
	}

	// ── Borradores: filas insertadas ──────────────────────────────────

	function anotarEnBorrador(c: CambioRecorrido) {
		const b = borradores.get(c.entityId);
		if (!b) return;

		if (c.field.startsWith('bono:')) {
			const id = c.field.slice('bono:'.length);
			if (c.value === 'SÍ' || c.value === 'SI' || c.value === true) b.bonos.add(id);
			else b.bonos.delete(id);
			return;
		}

		const validado = validarLocal(c.field, c.value);
		if (!validado.ok) {
			ctx?.pintarCelda(c.entityId, c.field, b.valores[c.field] ?? '');
			return;
		}
		const vacio = validado.valor === '' || validado.valor === null || validado.valor === undefined;
		if (vacio) delete b.valores[c.field];
		else b.valores[c.field] = validado.valor;
		/// La fecha se repinta siempre: así se rellena el día de la semana en el
		/// borrador, igual que en una fila guardada.
		if (c.field === 'fecha' || validado.valor !== c.value) {
			ctx?.pintarCelda(c.entityId, c.field, validado.valor ?? '');
		}

		void intentarGuardarBorrador(c.entityId);
	}

	/**
	 * Dice qué le falta a la fila para guardarse, en un solo aviso que se va
	 * reemplazando. Una fila con «+» que no se guarda y no explica por qué es
	 * una fila que se queda así: el usuario no tiene por qué saber la regla.
	 */
	function orientarBorrador(b: Borrador) {
		const faltan = faltantesDeBorrador(b.valores);
		if (!faltan.length) return;
		const tipo = String(b.valores.tipo_dia ?? '').trim().toUpperCase();
		toast.info(
			tipo === 'LABORADO' || faltan.some((f) => f.startsWith('la placa') || f.includes('hora'))
				? 'Un día LABORADO es un recorrido: lleva placa y horario'
				: 'Fila sin guardar todavía',
			{
				description: `Falta ${faltan.join(', ')}. Se guarda sola al completarla.`,
				id: 'recorridos-borrador-falta',
				duration: 6000
			}
		);
	}

	/**
	 * ¿Tiene el borrador lo mínimo para ser una fila?
	 *
	 * Espejo de `clasificarFilaNueva` en el servidor: fecha y, o bien el trío
	 * placa/inicio/fin (recorrido), o bien un tipo de día que no sea LABORADO
	 * (día sin recorrido; MANTENIMIENTO además con placa).
	 */
	function borradorCompleto(b: Borrador): boolean {
		const v = b.valores;
		if (!v.fecha) return false;
		const tipo = String(v.tipo_dia ?? '').trim().toUpperCase();
		const tieneTramo = !!(v.vehiculo_placa || v.hora_inicio || v.hora_fin);
		if (tipo === 'MANTENIMIENTO') return !!v.vehiculo_placa;
		if (tieneTramo) return !!(v.vehiculo_placa && v.hora_inicio && v.hora_fin);
		return !!tipo && tipo !== 'LABORADO';
	}

	async function intentarGuardarBorrador(entityId: string) {
		const b = borradores.get(entityId);
		if (!b || b.guardando || !dto) return;
		if (!borradorCompleto(b)) {
			orientarBorrador(b);
			return;
		}
		b.guardando = true;
		ultimaEstructuraPropia = Date.now();
		/// Foto de lo que viaja: lo que el usuario escriba MIENTRAS se guarda
		/// (la descripción, justo después del tipo) no entra en el alta y se
		/// manda después como patch sobre la fila ya guardada.
		const enviados: Record<string, unknown> = { ...b.valores };
		const bonosEnviados = new Set(b.bonos);
		try {
			const r = await recorridosCanvasAPI.crearFila({
				conductor_id: b.conductorId,
				desde: corte.desde,
				hasta: corte.hasta,
				fecha: String(enviados.fecha),
				tipo_dia: (enviados.tipo_dia as string) ?? null,
				vehiculo_placa: (enviados.vehiculo_placa as string) ?? null,
				hora_inicio: (enviados.hora_inicio as string) ?? null,
				hora_fin: (enviados.hora_fin as string) ?? null,
				horas_conducidas: (enviados.horas_conducidas as number) ?? null,
				cliente_nombre: (enviados.cliente_nombre as string) ?? null,
				km_inicial: (enviados.km_inicial as number) ?? null,
				km_final: (enviados.km_final as number) ?? null,
				pernocte: (enviados.pernocte as string) ?? null,
				observaciones: (enviados.observaciones as string) ?? null,
				bonos: [...bonosEnviados]
			});

			borradores.delete(entityId);
			borradoresPendientes = borradores.size;

			const fila = r.fila;
			const id = fila.segmento_id ?? fila.registro_dia_id;
			filaPorId.set(id, fila);
			const hoja = hojaDe(b.conductorId);
			if (hoja) insertarOrdenada(hoja.filas, fila);
			notificarDto();
			ctx?.vincularFila(entityId, fila);

			// Lo tecleado durante el alta, como patches normales sobre la fila.
			const rezagados: CambioRecorrido[] = [];
			for (const [campo, valor] of Object.entries(b.valores)) {
				if (enviados[campo] === valor) continue;
				rezagados.push({
					tipoFila: fila.tipo_fila,
					entityId: id,
					field: campo,
					value: valor as string | number | boolean | null,
					baseVersion: fila.version,
					conductorId: b.conductorId,
					registroDiaId: fila.registro_dia_id
				});
			}
			for (const bono of b.bonos) {
				if (bonosEnviados.has(bono)) continue;
				rezagados.push({
					tipoFila: fila.tipo_fila,
					entityId: id,
					field: `bono:${bono}`,
					value: 'SÍ',
					baseVersion: fila.version,
					conductorId: b.conductorId,
					registroDiaId: fila.registro_dia_id
				});
			}
			if (rezagados.length) enviarCambios(rezagados);

			toast.success(fila.tipo_fila === 'segmento' ? 'Recorrido guardado' : 'Día guardado', {
				description: `${fila.fecha}${fila.vehiculo_placa ? ` · ${fila.vehiculo_placa}` : ''}`,
				id: `recorridos-alta-${id}`
			});

			if (r.recargar) {
				// El día ya existía sin recorridos y este es el primero: su antigua
				// fila de día sobra. Se relee el libro, que es lo honesto.
				toast.info('El día ya existía; se recarga el libro para dejarlo coherente', {
					id: 'recorridos-recarga'
				});
				void montar();
			}
		} catch (e: any) {
			toast.error(e?.response?.data?.error ?? e?.message ?? 'No se pudo guardar la fila', {
				id: `recorridos-alta-${entityId}`,
				duration: 9000
			});
		} finally {
			const vivo = borradores.get(entityId);
			if (vivo) vivo.guardando = false;
		}
	}

	/** Mantiene las filas de la hoja en orden cronológico, como las sirve el servidor. */
	function insertarOrdenada(filas: FilaRecorrido[], fila: FilaRecorrido) {
		let i = filas.length;
		while (i > 0 && filas[i - 1].fecha > fila.fecha) i--;
		filas.splice(i, 0, fila);
	}

	// ── Filas eliminadas ──────────────────────────────────────────────

	async function eliminarFilas(filas: FilaEliminada[]) {
		if (!dto) return;
		ultimaEstructuraPropia = Date.now();
		let retiradas = 0;
		let fallo: string | null = null;

		for (const f of filas) {
			if (f.tipoFila === 'nueva') {
				borradores.delete(f.entityId);
				continue;
			}
			const fila = filaPorId.get(f.entityId);
			try {
				await recorridosCanvasAPI.eliminarFila({
					tipo: f.tipoFila,
					id: f.entityId,
					baseVersion: fila?.version ?? null,
					desde: corte.desde,
					hasta: corte.hasta
				});
				filaPorId.delete(f.entityId);
				for (const h of dto.hojas) {
					const i = h.filas.findIndex((x) => (x.segmento_id ?? x.registro_dia_id) === f.entityId);
					if (i >= 0) h.filas.splice(i, 1);
				}
				retiradas++;
			} catch (e: any) {
				fallo = e?.response?.data?.error ?? e?.message ?? 'No se pudo eliminar la fila';
				break;
			}
		}
		borradoresPendientes = borradores.size;
		notificarDto();

		if (fallo) {
			// La hoja ya no dice la verdad: se relee del servidor.
			toast.error(fallo, { id: 'recorridos-baja', duration: 9000 });
			void montar();
			return;
		}
		if (retiradas) {
			toast.success(retiradas === 1 ? 'Fila eliminada' : `${retiradas} filas eliminadas`, {
				description: 'Se retiró del periodo. Un día borrado se puede volver a insertar con la misma fecha.',
				id: 'recorridos-baja'
			});
		}
	}

	// ── Acciones ──────────────────────────────────────────────────────

	async function conOverlay(titulo: string, fn: () => Promise<void>, detalle?: string) {
		if (accionEnCurso) return;
		accionEnCurso = { titulo, detalle };
		try {
			await fn();
		} catch (e: any) {
			toast.error(e?.response?.data?.error ?? e?.message ?? 'La acción falló');
		} finally {
			accionEnCurso = null;
		}
	}

	/**
	 * Cambia el corte. Remonta el libro: el `unitId` depende de las dos fechas.
	 *
	 * Se valida antes de navegar porque un `<input type="date">` a medio teclear
	 * emite valores incompletos en cada pulsación, y cada uno dispararía una
	 * recarga del periodo.
	 */
	function cambiarCorte(nuevo: Partial<Corte>) {
		const propuesto: Corte = { ...corte, ...nuevo };
		if (!esFechaValida(propuesto.desde) || !esFechaValida(propuesto.hasta)) return;
		if (propuesto.desde > propuesto.hasta) {
			toast.warning('La fecha inicial no puede ser posterior a la final');
			return;
		}
		if (propuesto.desde === corte.desde && propuesto.hasta === corte.hasta) return;
		if (
			(pendientes > 0 || borradores.size > 0) &&
			!confirm('Hay cambios sin confirmar o filas sin guardar. ¿Cambiar de corte igualmente?')
		) {
			return;
		}
		goto(`?desde=${propuesto.desde}&hasta=${propuesto.hasta}`, {
			keepFocus: true,
			noScroll: true
		});
	}

	/**
	 * Escribe en la URL lo que se está mirando: corte y conductor.
	 *
	 * `replaceState` y no `goto`: es el mismo estado, no una navegación. Con
	 * `goto` cada cambio de hoja dejaría una entrada en el historial y el botón
	 * atrás recorrería conductores uno a uno en vez de salir de la pantalla.
	 */
	function sincronizarUrl() {
		if (!browser) return;
		const url = new URL(window.location.href);
		url.searchParams.set('desde', corte.desde);
		url.searchParams.set('hasta', corte.hasta);
		if (conductorActivo) url.searchParams.set('conductor', conductorActivo);
		else url.searchParams.delete('conductor');
		if (url.href !== window.location.href) {
			history.replaceState(history.state, '', url);
		}
	}

	/** Vuelve al corte 21→20 que toca hoy. */
	function corteVivo() {
		cambiarCorte(cortePorDefecto());
	}

	/// Saltar de corte en corte sin teclear fechas: llegar al corte anterior
	/// obligaba a escribir las dos, y escribir «20» donde iba «21» deja un
	/// libro que parece el de siempre con un día de menos.
	function irCorteAnterior() {
		cambiarCorte(corteAnterior(corte));
	}

	function irCorteSiguiente() {
		cambiarCorte(corteSiguiente(corte));
	}

	// ── Preview ───────────────────────────────────────────────────────

	/** Conductor que enseña el preview: el activo, o el paginado en «todos». */
	const conductorPreview = $derived.by(() => {
		if (!dto?.hojas.length) return null;
		if (alcancePreview === 'hoja') return conductorActivo;
		const i = Math.min(Math.max(previewIndice, 0), dto.hojas.length - 1);
		return dto.hojas[i]?.conductor_id ?? null;
	});

	const documentoPreview = $derived.by(() =>
		dto && conductorPreview ? documentoRecorridos(dto, conductorPreview) : null
	);

	/** El documento visible, con el reparto de columnas del PAPEL. */
	const documentoPdfHoja = $derived.by(() =>
		dto && conductorPreview ? documentoRecorridos(dto, conductorPreview, 'pdf') : null
	);

	/** El consolidado del periodo, que solo se compone al exportarlo. Va al papel. */
	const documentoTodos = $derived.by(() => (dto ? documentoRecorridos(dto, null, 'pdf') : null));

	function nombreDe(conductorId: string | null): string {
		const hoja = conductorId ? hojaDe(conductorId) : undefined;
		return hoja ? `${hoja.nombre} ${hoja.apellido}`.replace(/\s+/g, ' ').trim() : '';
	}

	/** Nombre del conductor de la hoja abierta, para los rótulos del menú. */
	const nombreConductorActivo = $derived(nombreDe(conductorActivo));

	const paginadorPreview = $derived.by(() => {
		if (alcancePreview !== 'todos' || !dto?.hojas.length) return undefined;
		const total = dto.hojas.length;
		const indice = Math.min(Math.max(previewIndice, 0), total - 1);
		return {
			indice,
			total,
			etiqueta: nombreDe(dto.hojas[indice]?.conductor_id ?? null),
			onIr: (i: number) => {
				previewIndice = Math.min(Math.max(i, 0), total - 1);
			}
		};
	});

	function abrirPreview(alcance: 'hoja' | 'todos') {
		alcancePreview = alcance;
		if (alcance === 'todos' && dto) {
			const i = dto.hojas.findIndex((h) => h.conductor_id === conductorActivo);
			previewIndice = i >= 0 ? i : 0;
		}
		previewAbierto = true;
	}

	async function exportarZip() {
		if (!dto) return;
		const hojas = hojasParaZip(dto);
		await conOverlay(
			'Generando el ZIP',
			async () => {
				const r = await exportarZipPdfs(
					'recorridos',
					hojas,
					`RECORRIDOS_${corte.desde}_${corte.hasta}`
				);
				// Una hoja que falla no aborta el lote: hay que decir cuáles, o el
				// ZIP parece completo y le faltan conductores.
				if (r.fallidas.length) {
					toast.warning(`${r.fallidas.length} hoja(s) no se pudieron componer`, {
						description: r.fallidas.join(', ')
					});
				} else {
					toast.success(`${r.generados} PDF en el ZIP`);
				}
			},
			`Un PDF por conductor (${hojas.length}). Puede tardar según cuántos haya.`
		);
	}

	async function capturarSnapshot() {
		await conOverlay('Guardando una versión', async () => {
			const r = await recorridosSnapshotsAPI.capturar(anio, mes);
			if ((r as any).sinCambios) toast.info('No había cambios que guardar');
			else toast.success(`Versión ${(r as any).version} guardada`);
		});
	}

	// ── Ciclo de vida ─────────────────────────────────────────────────

	/**
	 * Remonta el libro cuando cambia el periodo o aparece el contenedor.
	 *
	 * `untrack` alrededor de `montar()` NO es decorativo: la función lee estado
	 * reactivo por dentro (`puedeEditar`, `conductorInicial`, `$authStore`) y sin
	 * aislarlo el efecto se suscribe a todo eso, se vuelve a disparar en cuanto
	 * la propia carga toca cualquiera de esas señales, y se montan decenas de
	 * instancias de Univer en bucle —cada una con su Worker— hasta colgar la
	 * pestaña. Medido: 250 engines en dos segundos.
	 *
	 * Las tres dependencias reales se leen ARRIBA, fuera del `untrack`.
	 */
	$effect(() => {
		const d = corte.desde;
		const h = corte.hasta;
		const hayContenedor = !!contenedor;
		if (!browser || !hayContenedor) return;
		void d;
		void h;
		untrack(() => {
			void montar();
		});
	});

	onDestroy(() => {
		mountToken++;
		desmontarEngine();
		session?.dispose();
		session = null;
	});

	// Avisar antes de cerrar con escrituras en vuelo o filas sin guardar.
	$effect(() => {
		if (!browser) return;
		const handler = (e: BeforeUnloadEvent) => {
			if (pendientes > 0 || borradoresPendientes > 0) {
				e.preventDefault();
				e.returnValue = '';
			}
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

	const acciones = $derived.by<RailItem[]>(() => [
		{
			id: 'bonos',
			label: 'Bonos visibles',
			hint: 'Elige qué bonos se muestran como columna en el canvas.',
			icon: iconoBonos,
			onSelect: () => (modalBonos = true)
		},
		{
			id: 'preview',
			label: 'PDF de esta hoja',
			hint: nombreConductorActivo
				? `Solo ${nombreConductorActivo}, tal y como saldrá impreso.`
				: 'Solo el conductor abierto, tal y como saldrá impreso.',
			icon: iconoPreview,
			disabled: !dto?.hojas.length,
			disabledHint: 'No hay recorridos en este periodo.',
			onSelect: () => abrirPreview('hoja')
		},
		{
			id: 'preview-todos',
			label: 'PDF de todos los conductores',
			hint: `Se navega conductor por conductor (${dto?.hojas.length ?? 0} en el periodo) y se exporta uno o el consolidado completo.`,
			icon: iconoPreviewTodos,
			disabled: !dto?.hojas.length,
			disabledHint: 'No hay recorridos en este periodo.',
			onSelect: () => abrirPreview('todos')
		},
		{
			id: 'zip',
			label: 'Exportar ZIP',
			hint: 'Un PDF por conductor, empaquetados.',
			icon: iconoZip,
			disabled: !dto?.hojas.length,
			onSelect: () => void exportarZip()
		},
		{ type: 'sep', id: 's1' },
		{
			id: 'version',
			label: 'Guardar versión',
			hint: 'Captura el estado del periodo para poder volver a él.',
			icon: iconoVersion,
			tone: 'green',
			disabled: !puedeEditar,
			disabledHint: 'Solo Administración y Operaciones.',
			onSelect: () => void capturarSnapshot()
		},
		{
			id: 'versiones',
			label: 'Historial de versiones',
			hint: 'Compara con una versión anterior y restaura el periodo.',
			icon: iconoHistorial,
			onSelect: () => (panelVersiones = true)
		},
		{
			id: 'recargar',
			label: 'Recargar',
			hint: 'Vuelve a leer el periodo del servidor.',
			icon: iconoRecargar,
			badge: borradoresPendientes || null,
			onSelect: () => void montar()
		}
	]);
</script>

<!--
	Iconos del carril. SVG de trazo con `currentColor` y `stroke-width` 1.8,
	como en los canvas de cierres, servicios y nómina: los emoji se pintaban con
	la fuente del sistema, no heredaban el color del botón ni el estado
	deshabilitado, y cada plataforma los dibujaba de un tamaño distinto.
-->
{#snippet iconoBonos()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M3 7.5A1.5 1.5 0 014.5 6h6.19a1.5 1.5 0 011.06.44l8.31 8.31a1.5 1.5 0 010 2.12l-5.19 5.19a1.5 1.5 0 01-2.12 0L4.44 13.75A1.5 1.5 0 014 12.69V7.5z"
		/>
		<circle cx="8" cy="10" r="1.4" />
	</svg>
{/snippet}

{#snippet iconoPreview()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M2.5 12C3.7 7.9 7.5 5 12 5s8.3 2.9 9.5 7c-1.2 4.1-5 7-9.5 7s-8.3-2.9-9.5-7z"
		/>
	</svg>
{/snippet}

<!-- El ojo con un «+» en la esquina: el mismo preview, pero de TODOS y
     navegable conductor por conductor. -->
{#snippet iconoPreviewTodos()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M14.5 12.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M3 12.5c1.1-3.7 4.6-6.5 9-6.5 1.2 0 2.3.2 3.3.6M21 12.5c-1.1 3.7-4.6 6.5-9 6.5s-7.9-2.8-9-6.5"
		/>
		<circle cx="18.5" cy="6" r="4.2" fill="currentColor" stroke="none" />
		<path d="M18.5 3.9v4.2M16.4 6h4.2" stroke="#1e2429" stroke-width="1.6" stroke-linecap="round" />
	</svg>
{/snippet}

{#snippet iconoZip()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4" />
		<path stroke-linecap="round" d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
	</svg>
{/snippet}

{#snippet iconoVersion()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 2" />
		<circle cx="12" cy="12" r="9" />
	</svg>
{/snippet}

{#snippet iconoRecargar()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5" />
		<path
			stroke-linecap="round"
			stroke-linejoin="round"
			d="M20 9A8 8 0 006.3 6.3L4 9m0 6a8 8 0 0013.7 2.7L20 15"
		/>
	</svg>
{/snippet}

{#snippet iconoHistorial()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
		<path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 109-9 9 9 0 00-7.6 4.2" />
		<path stroke-linecap="round" stroke-linejoin="round" d="M3 4v4h4M12 7v5l3 2" />
	</svg>
{/snippet}

<UniverToolbar
	title="Recorridos"
	subtitle={dto
		? `${dto.etiqueta} · ${dto.hojas.length} conductores · ${dto.hojas.reduce((n, h) => n + h.filas.length, 0)} filas${borradoresPendientes ? ` · ${borradoresPendientes} sin guardar` : ''}`
		: `${etiquetaCorte(corte)} · cargando…`}
	onBack={() => goto('/dashboard/conductores')}
	backLabel="Conductores"
	inerte={!!accionEnCurso}
>
	{#snippet actions()}
		<!--
			El corte, no un mes: los recorridos se liquidan del 21 al 20. Las dos
			fechas son libres y se aplican a TODAS las hojas del libro.
		-->
		<div class="univer-rango">
			<label class="univer-year-picker">
				<span>Desde</span>
				<input
					type="date"
					value={corte.desde}
					max={corte.hasta}
					onchange={(e) => cambiarCorte({ desde: e.currentTarget.value })}
				/>
			</label>
			<span class="univer-rango__sep" aria-hidden="true">—</span>
			<label class="univer-year-picker">
				<span>Hasta</span>
				<input
					type="date"
					value={corte.hasta}
					min={corte.desde}
					onchange={(e) => cambiarCorte({ hasta: e.currentTarget.value })}
				/>
			</label>
		</div>
		<button
			type="button"
			class="univer-btn"
			onclick={irCorteAnterior}
			title="Corte anterior"
			aria-label="Corte anterior"
		>
			‹
		</button>
		<button
			type="button"
			class="univer-btn univer-btn-dark"
			onclick={corteVivo}
			title="Volver al corte 21 → 20 que se está trabajando"
		>
			Corte actual
		</button>
		<button
			type="button"
			class="univer-btn"
			onclick={irCorteSiguiente}
			title="Corte siguiente"
			aria-label="Corte siguiente"
		>
			›
		</button>

		{#if !puedeEditar}
			<span class="univer-badge" title="Tu área tiene acceso de consulta">Solo consulta</span>
		{/if}

		<span class="univer-divider-v"></span>
		<AutosaveIndicator {pendientes} {fallidas} {conectado} />
		<PresenceAvatars users={presencia} />
	{/snippet}
</UniverToolbar>

<div class="rc-body" class:inerte={!!accionEnCurso}>
	<div class="rc-canvas">
		<UniverCanvasHost
			bind:container={contenedor}
			loading={cargando}
			error={errorCarga}
			onRetry={() => void montar()}
			loadingLabel="Cargando los recorridos del periodo…"
		/>
	</div>

	<UniverSideRail items={acciones} ariaLabel="Acciones de recorridos" />
	<UniverActionOverlay accion={accionEnCurso} />
</div>

<SnapshotPanel
	open={panelVersiones}
	scope="recorridos"
	{anio}
	{mes}
	onClose={() => (panelVersiones = false)}
	onReverted={() => {
		// Restaurar cambia las filas de todas las hojas: se remonta el libro en
		// vez de repintar, que es lo barato y lo honesto.
		panelVersiones = false;
		void montar();
	}}
/>

<ModalConfigBonos
	open={modalBonos}
	{anio}
	canManageBonos={puedeMarcarBonos}
	onclose={() => (modalBonos = false)}
	onsaved={() => {
		modalBonos = false;
		// Cambiar qué bonos son visibles cambia el NÚMERO de columnas de todas
		// las hojas, así que no se puede aplicar en caliente: se remonta.
		toast.success('Columnas de bono actualizadas');
		void montar();
	}}
/>

{#if previewAbierto && documentoPreview}
	<PreviewCanvasModal
		scope="recorridos"
		documento={documentoPreview}
		subtitulo={alcancePreview === 'todos'
			? `${dto?.etiqueta ?? ''} · todos los conductores`
			: `${dto?.etiqueta ?? ''}${nombreConductorActivo ? ` · ${nombreConductorActivo}` : ''}`}
		paginador={paginadorPreview}
		documentoPdf={documentoPdfHoja ?? undefined}
		exportarTodo={alcancePreview === 'todos' && documentoTodos
			? { documento: documentoTodos, etiqueta: `Exportar todos (${dto?.hojas.length ?? 0})` }
			: undefined}
		onClose={() => (previewAbierto = false)}
	/>
{/if}

<style>
	/* `min-width: 0` en el canvas es obligatorio: sin él, el `width: 100%` del
	   host empuja el carril fuera de la pantalla. */
	.rc-body {
		position: relative;
		display: flex;
		flex-direction: row;
		flex: 1 1 auto;
		min-height: 0;
	}
	.rc-canvas {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}
	.inerte {
		pointer-events: none;
	}
</style>
