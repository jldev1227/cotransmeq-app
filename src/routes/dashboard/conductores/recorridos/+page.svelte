<script lang="ts">
	/**
	 * Canvas de RECORRIDOS.
	 *
	 * Un libro por PERIODO (`?anio=&mes=`), una hoja por conductor y UNA FILA
	 * POR RECORRIDO: dos recorridos el mismo día son dos filas seguidas, sin
	 * agrupar por día ni por cliente, ordenadas de la fecha más antigua a la más
	 * reciente.
	 *
	 * Editar está reservado a Administración y Operaciones; para el resto la
	 * hoja se monta sin bindings y queda de solo lectura (ver
	 * `cell-permission-recorridos.ts`). El backend vuelve a comprobarlo en cada
	 * patch, así que ocultar botones aquí es comodidad, no seguridad.
	 */
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
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
	import { crearRecorridosEngine, type RecorridosEngineContext } from '$lib/editor/univer/recorridos-engine';
	import { installRecorridosCellChangeAdapter } from '$lib/editor/univer/adapters/cell-change-recorridos';
	import { estaRepintando } from '$lib/editor/univer/cell-permission-recorridos';
	import { createSheetSession, type SheetSession } from '$lib/editor/canvas/sheet-session.svelte';
	import { conductorIdDeSheetId } from '$lib/editor/builders/recorridos-identidad';
	import { documentoRecorridos, hojasParaZip } from '$lib/components/liquidaciones-terceros/preview/datos/recorridos.doc';
	import { exportarPdfDocumento } from '$lib/components/liquidaciones-terceros/preview/exportar-pdf';
	import { exportarZipPdfs } from '$lib/components/liquidaciones-terceros/preview/exportar-zip';
	import type {
		FilaRecorrido,
		RecorridosPeriodoDTO
	} from '$lib/editor/builders/recorridos.builder';
	import {
		cortePorDefecto,
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

	function reindexar(d: RecorridosPeriodoDTO) {
		filaPorId.clear();
		for (const h of d.hojas) {
			for (const f of h.filas) {
				filaPorId.set(f.segmento_id ?? f.registro_dia_id, f);
			}
		}
	}

	// ── Carga y montaje ───────────────────────────────────────────────

	async function montar() {
		if (!browser || !contenedor) return;
		const token = ++mountToken;

		cargando = true;
		errorCarga = '';
		desmontarEngine();

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
					toast.warning(aviso.titulo, { description: aviso.detalle, id: 'recorridos-bloqueada' })
			});

			if (token !== mountToken) {
				engine.dispose();
				return;
			}
			ctx = engine;

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
				versionDe: (entityId) => filaPorId.get(entityId)?.version ?? null,
				onCambios: enviarCambios,
				onHojaActiva: (conductorId) => {
					conductorActivo = conductorId;
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
			if (pedido) engine.activar(pedido);
			else if (conductorInicial) {
				toast.info('Ese conductor no tiene recorridos en el periodo seleccionado');
			}
			abrirSesion();
		} catch (e: any) {
			if (token !== mountToken) return;
			errorCarga = e?.response?.data?.error ?? e?.message ?? 'No se pudo cargar el periodo';
		} finally {
			if (token === mountToken) cargando = false;
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
			},
			onAck: (a: any) => {
				pendientes = Math.max(0, pendientes - 1);
				const fila = filaPorId.get(String(a.entity_id));
				if (!fila) return;
				// La versión nueva es obligatoria: sin ella el siguiente patch de
				// esa fila iría con una `base_version` obsoleta y el servidor lo
				// rechazaría por conflicto contra el propio usuario.
				fila.version = a.version;
				if (a.derivados) {
					aplicarEnModelo(fila, '', null, a.derivados);
					ctx?.pintarFila(String(a.entity_id), fila);
				}
			},
			onConflict: (c: any) => {
				pendientes = Math.max(0, pendientes - 1);
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
			onPatchFallido: () => {
				pendientes = Math.max(0, pendientes - 1);
				fallidas++;
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

	function enviarCambios(cambios: Array<{
		tipoFila: 'segmento' | 'dia';
		entityId: string;
		field: string;
		value: string | number | boolean | null;
		baseVersion: number;
	}>) {
		if (!session) return;
		for (const c of cambios) {
			if (c.field.startsWith('bono:') && !puedeMarcarBonos) {
				toast.error('No tienes el permiso «bonos-planilla»', {
					description: 'Pide a un administrador que lo habilite en tu usuario.',
					id: 'recorridos-sin-bonos'
				});
				continue;
			}
			pendientes++;
			session.enviarPatch({
				mes,
				entity_type: c.tipoFila,
				entity_id: c.entityId,
				field: c.field,
				value: c.value,
				base_version: c.baseVersion
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
		if (pendientes > 0 && !confirm('Hay cambios sin confirmar. ¿Cambiar de corte igualmente?')) {
			return;
		}
		goto(`?desde=${propuesto.desde}&hasta=${propuesto.hasta}`, {
			keepFocus: true,
			noScroll: true
		});
	}

	/** Vuelve al corte 21→20 vivo. */
	function corteVivo() {
		cambiarCorte(cortePorDefecto());
	}

	const documentoPreview = $derived.by(() =>
		dto ? documentoRecorridos(dto, conductorActivo) : null
	);

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

	// Avisar antes de cerrar con escrituras en vuelo.
	$effect(() => {
		if (!browser) return;
		const handler = (e: BeforeUnloadEvent) => {
			if (pendientes > 0) {
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
			label: 'Vista previa PDF',
			hint: 'El documento tal y como saldrá impreso, con el resumen de bonos.',
			icon: iconoPreview,
			disabled: !dto?.hojas.length,
			disabledHint: 'No hay recorridos en este periodo.',
			onSelect: () => (previewAbierto = true)
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
		? `${dto.etiqueta} · ${dto.hojas.length} conductores · ${dto.hojas.reduce((n, h) => n + h.filas.length, 0)} recorridos`
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
		<label class="univer-year-picker">
			<span>Desde</span>
			<input
				type="date"
				value={corte.desde}
				max={corte.hasta}
				onchange={(e) => cambiarCorte({ desde: e.currentTarget.value })}
			/>
		</label>
		<label class="univer-year-picker">
			<span>Hasta</span>
			<input
				type="date"
				value={corte.hasta}
				min={corte.desde}
				onchange={(e) => cambiarCorte({ hasta: e.currentTarget.value })}
			/>
		</label>
		<button
			type="button"
			class="univer-btn univer-btn-dark"
			onclick={corteVivo}
			title="Volver al corte 21 → 20 en curso"
		>
			Corte actual
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
		subtitulo={dto?.etiqueta ?? ''}
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
