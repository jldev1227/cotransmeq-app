<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { fly, fade, scale } from 'svelte/transition';
	import { page as pageState } from '$app/state';
	import { conductoresAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import { mascota } from '$lib/mascot';
	import { Eye, EyeOff, Route, RotateCcw, Trash2 } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { crearListingStore } from '$lib/listing/listingStore';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		contarActivos,
		firma,
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';

	type VistaActual = 'ACTIVOS' | 'OCULTOS' | 'PAPELERA';
	type EstadoConductor =
		'TODOS' | 'ACTIVO' | 'INACTIVO' | 'VACACIONES' | 'INCAPACITADO' | 'RETIRADO';

	interface Conductor {
		id: string;
		nombre: string;
		apellido: string;
		tipo_identificacion?: string;
		numero_identificacion: string;
		email?: string;
		telefono?: string;
		estado: EstadoConductor | string;
		sede_trabajo?: string;
		cargo?: string;
		categoria_licencia?: string;
		vencimiento_licencia?: string;
		tipo_sangre?: string;
		foto_signed_url?: string;
		fecha_ingreso?: string;
		created_at?: string;
		deleted_at?: string;
		oculto?: boolean;
	}

	/**
	 * Filtros de la página.
	 *
	 * Los nombres de los parámetros son los que esta página ya usaba —`vista`,
	 * `q`, `estado`, `sede`, `vista_lista`— para no romper los enlaces que la
	 * gente tenga guardados. `pagina` es nuevo: antes no viajaba en la URL, así
	 * que compartir una vista siempre devolvía a la primera página.
	 */
	interface FiltrosConductores {
		/** Siempre `lista`. `calendario` era la tabla clásica de recorridos y
		 * ahora redirige al canvas; se lee solo para eso. */
		vista: string;
		q: string;
		estado: string;
		sede: string;
		/** `ACTIVOS` | `OCULTOS` | `PAPELERA`. */
		vista_lista: string;
		pagina: number;
	}

	// ── Permisos ──────────────────────────────────────────────────────
	// `Consulta` (`read`) entra a la pantalla pero no escribe. Se lee
	// `$authStore` a propósito para que el derived se recalcule cuando la
	// sesión termine de hidratarse. El backend aplica lo mismo sobre las
	// rutas de escritura de `conductores`; esto sólo evita ofrecer un botón
	// que iba a devolver 403.
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('conductores') === 'full'
	);

	const POR_PAGINA = 20;

	const DEFS: DefinicionesFiltros<FiltrosConductores> = {
		vista: opcion('lista'),
		q: texto(),
		estado: opcion('TODOS'),
		sede: opcion('TODOS'),
		vista_lista: opcion('ACTIVOS'),
		pagina: numero(1)
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	const listaConductores = crearListingStore<Conductor>();

	let filtros = $state<FiltrosConductores>(estadoUrl.leer(pageState.url));
	let mostrarFiltros = $state(false);

	/// Atajos de lectura, para no cambiar todo el marcado de golpe.
	const vistaActual = $derived(filtros.vista_lista as VistaActual);

	const isAdmin = $derived($authStore.user?.role === 'admin' || $authStore.user?.rol === 'admin');
	const isOperaciones = $derived($authStore.user?.area?.includes('operaciones'));
	const isTalentoHumano = $derived($authStore.user?.area?.includes('talento_humano'));
	const canAccessSpecialViews = $derived(isAdmin || isOperaciones || isTalentoHumano);

	// ══════════════════════════════════════════════════════
	//  URL PARAMS: sincroniza el estado del page con la URL
	//  para que sea compartible / bookmarkable.
	//
	//  Soporta:
	//    ?vista=calendario  → enlace antiguo: redirige al canvas de recorridos
	//    ?q=juan           → búsqueda libre del tab lista
	//    ?estado=ACTIVO
	//    ?sede=YOPAL
	//    ?vista_lista=ACTIVOS|OCULTOS|PAPELERA
	//    ?conductor=<id>   → acompaña a `vista=calendario`; viaja al canvas
	// ══════════════════════════════════════════════════════
	/**
	 * Filtros → URL.
	 *
	 * Aquí había un `readUrlParams()`/`syncUrlParams()` escritos a mano que
	 * escribían con `window.history.replaceState`. Eso cambia la barra de
	 * direcciones pero NO el store `page` de SvelteKit, así que `$page.url` se
	 * quedaba siempre con la URL de carga — y `cambiarVista()` decidía si
	 * conservar los filtros consultando esa URL obsoleta.
	 */
	/// `?vista=calendario` era la tabla clásica de recorridos, que ya no se
	/// monta aquí. Un enlace guardado con ella va al canvas, con el conductor
	/// si venía uno, y sin dejar rastro en el historial.
	const vaAlCanvas = $derived(filtros.vista === 'calendario');
	$effect(() => {
		if (!vaAlCanvas) return;
		const conductor = pageState.url.searchParams.get('conductor');
		goto(`/dashboard/conductores/recorridos${conductor ? `?conductor=${conductor}` : ''}`, {
			replaceState: true
		});
	});

	$effect(() => {
		if (vaAlCanvas) return;
		estadoUrl.escribir(pageState.url, filtros);
	});

	// Estados para modo selección
	let conductoresSeleccionados = $state(new Set<string>());
	let ultimoSeleccionadoIndex: number | null = null;
	let shiftPressed = $state(false);
	let procesandoMasivo = $state(false);

	// Modal de eliminación permanente con preview de relaciones
	interface RelacionConductor {
		tabla: string;
		etiqueta: string;
		icono: string;
		cantidad: number;
		bloquea: boolean;
		descripcion: string;
	}
	interface ModalEliminar {
		id: string;
		loading: boolean;
		procesando?: boolean;
		relaciones: RelacionConductor[] | null;
		conductor: { id: string; nombre: string; identificacion: string; en_papelera: boolean } | null;
		error: string;
	}
	let modalEliminar = $state<ModalEliminar | null>(null);
	let confirmacionTexto = $state('');

	const totalRelaciones = $derived(
		modalEliminar?.relaciones?.reduce((s, r) => s + r.cantidad, 0) ?? 0
	);
	const relacionesBloqueantes = $derived(
		modalEliminar?.relaciones?.filter((r) => r.bloquea && r.cantidad > 0) ?? []
	);
	const relacionesInfo = $derived(
		modalEliminar?.relaciones?.filter((r) => r.cantidad > 0 && !r.bloquea) ?? []
	);
	const confirmacionValida = $derived(confirmacionTexto.trim().toUpperCase() === 'ELIMINAR');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = true;
	}

	function handleKeyup(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = false;
	}

	const conductores = $derived($listaConductores._?.items ?? []);
	const isLoading = $derived($listaConductores._?.cargando ?? false);
	const error = $derived($listaConductores._?.error || null);
	const totalConductores = $derived($listaConductores._?.total ?? 0);

	let stats = $state({
		total: 0,
		activos: 0,
		inactivos: 0,
		vacaciones: 0,
		incapacitados: 0,
		retirados: 0
	});

	const formatDate = (dateStr?: string | null) => {
		if (!dateStr) return '—';
		const date = new Date(dateStr);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: '2-digit'
		});
	};

	// Filtros activos (para chips removibles)
	const ESTADO_FILTER_LABELS: Record<string, string> = {
		ACTIVO: 'Activo',
		INACTIVO: 'Inactivo',
		VACACIONES: 'Vacaciones',
		INCAPACITADO: 'Incapacitado',
		RETIRADO: 'Retirado'
	};
	const activeFilters = $derived([
		...(filtros.estado !== 'TODOS'
			? [
					{
						key: 'estado',
						label: 'Estado',
						value: ESTADO_FILTER_LABELS[filtros.estado] ?? filtros.estado
					}
				]
			: []),
		...(filtros.sede !== 'TODOS' ? [{ key: 'sede', label: 'Sede', value: filtros.sede }] : []),
		...(filtros.q.trim() ? [{ key: 'q', label: 'Búsqueda', value: `"${filtros.q.trim()}"` }] : [])
	]);

	/// El contador del panel ignora la búsqueda, la pestaña y la página: no son
	/// «filtros» a ojos de quien abre el panel.
	const numFiltrosActivos = $derived(
		contarActivos(DEFS, filtros, ['q', 'pagina', 'vista', 'vista_lista'])
	);

	function clearFilter(key: string) {
		ponerFiltro(
			key as keyof FiltrosConductores,
			DEFS[key as keyof FiltrosConductores].porDefecto as never
		);
	}

	const getEstadoColor = (estado: string) => {
		switch (estado?.toUpperCase()) {
			case 'ACTIVO':
				return '#16a34a'; // emerald-500
			case 'INACTIVO':
				return '#6b7280'; // gray-500
			case 'VACACIONES':
				return '#3b82f6'; // blue-500
			case 'INCAPACITADO':
				return '#f59e0b'; // amber-500
			case 'RETIRADO':
				return '#ef4444'; // red-500
			default:
				return '#9ca3af'; // gray-400
		}
	};

	const getEstadoText = (estado: string) => {
		switch (estado?.toUpperCase()) {
			case 'ACTIVO':
				return 'Activo';
			case 'INACTIVO':
				return 'Inactivo';
			case 'VACACIONES':
				return 'Vacaciones';
			case 'INCAPACITADO':
				return 'Incapacitado';
			case 'RETIRADO':
				return 'Retirado';
			default:
				return estado
					? estado.charAt(0).toUpperCase() + estado.slice(1).toLowerCase()
					: 'Sin estado';
		}
	};

	const COLUMNAS: ColumnDef<Conductor, any>[] = [
		{ id: 'conductor', header: 'Conductor', accessorKey: 'nombre', enableSorting: false },
		{ id: 'sede', header: 'Sede · Cargo', enableSorting: false, size: 180 },
		{ id: 'contacto', header: 'Contacto', enableSorting: false },
		{ id: 'estado', header: 'Estado', accessorKey: 'estado', enableSorting: false, size: 150 },
		{ id: 'acciones', header: '', enableSorting: false, size: 150 }
	];

	const SEGMENTOS_ESTADO = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		{ valor: 'ACTIVO', etiqueta: 'Activos', punto: '#16a34a' },
		{ valor: 'INACTIVO', etiqueta: 'Inactivos', punto: '#64748b' },
		{ valor: 'VACACIONES', etiqueta: 'Vacaciones', punto: '#3b82f6' },
		{ valor: 'INCAPACITADO', etiqueta: 'Incapacitados', punto: '#f59e0b' },
		{ valor: 'RETIRADO', etiqueta: 'Retirados', punto: '#ef4444' }
	];

	const SEGMENTOS_SEDE = [
		{ valor: 'TODOS', etiqueta: 'Todas' },
		{ valor: 'YOPAL', etiqueta: 'Yopal' },
		{ valor: 'VILLANUEVA', etiqueta: 'Villanueva' }
	];

	const conteos = $derived([
		{ clave: 'TODOS', etiqueta: 'Total', valor: stats.total },
		{ clave: 'ACTIVO', etiqueta: 'Activos', valor: stats.activos, color: '#16a34a' },
		{ clave: 'INACTIVO', etiqueta: 'Inactivos', valor: stats.inactivos, color: '#64748b' },
		{ clave: 'VACACIONES', etiqueta: 'Vacaciones', valor: stats.vacaciones, color: '#3b82f6' },
		{
			clave: 'INCAPACITADO',
			etiqueta: 'Incapacitados',
			valor: stats.incapacitados,
			color: '#f59e0b'
		},
		{ clave: 'RETIRADO', etiqueta: 'Retirados', valor: stats.retirados, color: '#ef4444' }
	]);

	/** Un conductor solo, por la misma vía que las acciones masivas. */
	function accionIndividual(id: string, accion: 'ocultar' | 'mostrar' | 'restaurar') {
		conductoresSeleccionados.clear();
		conductoresSeleccionados.add(id);
		ejecutarAccionMasiva(accion);
	}

	async function traerConductores(): Promise<{ items: Conductor[]; total: number }> {
		const params = {
			page: filtros.pagina,
			limit: POR_PAGINA,
			search: filtros.q,
			estado: filtros.estado !== 'TODOS' ? filtros.estado : undefined,
			sede_trabajo: filtros.sede !== 'TODOS' ? filtros.sede : undefined
		};

		const response =
			filtros.vista_lista === 'OCULTOS'
				? await conductoresAPI.getOcultos(params)
				: filtros.vista_lista === 'PAPELERA'
					? await conductoresAPI.getPapelera(params)
					: await conductoresAPI.getAll(params);

		if (!response?.data?.success) {
			throw new Error('Error en el formato de respuesta del servidor');
		}

		const items: Conductor[] = response.data.data || response.data.conductores || [];
		const total = response.data.pagination?.total ?? items.length;

		/// Las tarjetas de resumen solo se recalculan en la vista sin filtrar:
		/// con un filtro puesto contarían lo devuelto, no la plantilla real.
		if (
			filtros.vista_lista === 'ACTIVOS' &&
			!filtros.q &&
			filtros.estado === 'TODOS' &&
			filtros.sede === 'TODOS'
		) {
			const conductores = items;
			stats.total = total;
			stats.activos = conductores.filter((c) => c.estado?.toUpperCase() === 'ACTIVO').length;
			stats.inactivos = conductores.filter((c) => c.estado?.toUpperCase() === 'INACTIVO').length;
			stats.vacaciones = conductores.filter((c) => c.estado?.toUpperCase() === 'VACACIONES').length;
			stats.incapacitados = conductores.filter(
				(c) => c.estado?.toUpperCase() === 'INCAPACITADO'
			).length;
			stats.retirados = conductores.filter((c) => c.estado?.toUpperCase() === 'RETIRADO').length;
		}

		return { items, total };
	}

	/// Todos los filtros entran en la firma: el listado es de servidor, así que
	/// cualquiera de ellos cambia lo que se pide.
	const firmaDatos = $derived(firma(DEFS, filtros));

	async function cargar(forzar = false) {
		if (forzar) {
			listaConductores.invalidar();
			conductoresSeleccionados = new Set();
		}
		await listaConductores.cargar(firmaDatos, traerConductores);
	}

	function ponerFiltro<K extends keyof FiltrosConductores>(clave: K, valor: FiltrosConductores[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	/**
	 * Abre el canvas de recorridos.
	 *
	 * Es una RUTA aparte y no una vista embebida porque el canvas de Univer
	 * necesita la ventana entera: montado dentro del layout del dashboard, el
	 * `position: fixed` de su shell queda encajado en un contenedor con padding
	 * y la hoja sale recortada.
	 *
	 * La tabla clásica (`?vista=calendario`) se retiró: ese enlace redirige aquí.
	 */
	function irAlCanvasDeRecorridos(conductorId?: string) {
		// Sin fechas: el canvas abre el corte 21→20 vivo, que es lo que
		// Operaciones está trabajando. Desde ahí se cambia con los selectores.
		const params = new URLSearchParams();
		// El canvas abre la hoja de este conductor en vez de la primera.
		if (conductorId) params.set('conductor', conductorId);
		const query = params.toString();
		goto(`/dashboard/conductores/recorridos${query ? `?${query}` : ''}`);
	}

	/**
	 * Cambia entre activos, ocultos y papelera.
	 *
	 * Los demás filtros se CONSERVAN. Antes se reseteaban salvo que vinieran en
	 * la URL, pero esa comprobación miraba `$page.url`, que nunca reflejaba lo
	 * escrito con `history.replaceState`: en la práctica siempre leía la URL de
	 * carga. Conservarlos es además lo menos sorprendente — si estoy buscando
	 * «juan» y voy a papelera, quiero los «juan» de papelera.
	 */
	function cambiarVista(nuevaVista: VistaActual) {
		if (filtros.vista_lista === nuevaVista) return;
		ponerFiltro('vista_lista', nuevaVista);
	}

	function toggleSeleccion(id: string, index: number, event: MouseEvent | TouchEvent | any) {
		if (event.shiftKey && ultimoSeleccionadoIndex !== null) {
			const start = Math.min(ultimoSeleccionadoIndex, index);
			const end = Math.max(ultimoSeleccionadoIndex, index);

			const idsInRange = conductores.slice(start, end + 1).map((c) => c.id);
			const someNotSelected = idsInRange.some((id) => !conductoresSeleccionados.has(id));

			if (someNotSelected) {
				idsInRange.forEach((id) => conductoresSeleccionados.add(id));
			} else {
				idsInRange.forEach((id) => conductoresSeleccionados.delete(id));
			}
		} else {
			if (conductoresSeleccionados.has(id)) {
				conductoresSeleccionados.delete(id);
			} else {
				conductoresSeleccionados.add(id);
			}
			ultimoSeleccionadoIndex = index;
		}
		conductoresSeleccionados = conductoresSeleccionados;
	}

	function toggleSeleccionarTodo() {
		if (conductoresSeleccionados.size === conductores.length && conductores.length > 0) {
			conductoresSeleccionados.clear();
		} else {
			conductores.forEach((c) => conductoresSeleccionados.add(c.id));
		}
		conductoresSeleccionados = conductoresSeleccionados;
	}

	async function ejecutarAccionMasiva(accion: 'ocultar' | 'mostrar' | 'eliminar' | 'restaurar') {
		if (conductoresSeleccionados.size === 0) return;

		const ids = Array.from(conductoresSeleccionados);
		procesandoMasivo = true;

		try {
			const response = await conductoresAPI.masivo(ids, accion);
			if (response.data.success) {
				toast.success(response.data.message);
				cargar(true);
			}
		} catch (err: any) {
			toast.error('Error al ejecutar acción masiva');
		} finally {
			procesandoMasivo = false;
		}
	}

	async function eliminarPermanente(id: string) {
		// En lugar de un confirm() nativo, abrimos un modal que muestra
		// las relaciones existentes del conductor y pide confirmación explícita.
		modalEliminar = { id, loading: true, relaciones: null, conductor: null, error: '' };
		try {
			const res = await conductoresAPI.getRelaciones(id);
			modalEliminar.conductor = res.data?.data?.conductor || null;
			modalEliminar.relaciones = res.data?.data?.relaciones || [];
			modalEliminar.loading = false;
		} catch (err: any) {
			modalEliminar.loading = false;
			modalEliminar.error =
				err.response?.data?.message || 'No se pudieron cargar las relaciones del conductor';
		}
	}

	async function confirmarEliminarPermanente(forzar: boolean) {
		if (!modalEliminar?.id) return;
		modalEliminar.procesando = true;
		modalEliminar.error = '';
		try {
			await conductoresAPI.eliminarPermanente(modalEliminar.id, forzar);
			toast.success('Conductor eliminado permanentemente');
			cerrarModalEliminar();
			cargar(true);
		} catch (err: any) {
			modalEliminar.procesando = false;
			modalEliminar.error = err.response?.data?.message || 'Error al eliminar permanentemente';
		}
	}

	function cerrarModalEliminar() {
		modalEliminar = null;
		confirmacionTexto = '';
	}

	function irPagina(pagina: number) {
		filtros = { ...filtros, pagina };
	}

	function limpiarFiltros() {
		/// Se conservan la pestaña y la vista: limpiar filtros no debería
		/// sacarte del calendario ni de la papelera.
		filtros = limpiarFiltrosDe(DEFS, filtros, ['vista', 'vista_lista']);
	}

	/**
	 * Corrige una página que se quedó fuera de rango, por ejemplo al abrir un
	 * enlace guardado cuyo filtro ahora devuelve menos resultados.
	 */
	$effect(() => {
		const ultima = Math.max(1, Math.ceil(totalConductores / POR_PAGINA));
		if (!isLoading && totalConductores > 0 && filtros.pagina > ultima) {
			filtros = { ...filtros, pagina: ultima };
		}
	});

	// ═══════════════════════════════
	// SOCKET: refrescar la lista en tiempo real
	// ═══════════════════════════════

	function notificarWeb(titulo: string, cuerpo: string, tag = 'dias-laborados') {
		if (!browser) return;
		try {
			if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
				new Notification(titulo, { body: cuerpo, tag, icon: '/favicon.png' });
			}
		} catch {}
	}

	function handleRegistroActualizado(payload: any) {
		if (!payload) return;
		const nombre = [payload.conductor_nombre, payload.conductor_apellido].filter(Boolean).join(' ');
		const fecha = payload.fecha;
		const accion = payload.eliminado ? 'eliminó' : 'actualizó';
		const tipo = payload.tipo || 'registro';
		const segs = payload.segmentos_count ?? 0;

		// Toast siempre
		if (payload.eliminado) {
			toast.info(`${nombre} eliminó el registro del ${fecha}`);
		} else {
			toast.success(
				`${nombre} ${accion} ${tipo.toLowerCase()} del ${fecha}` +
					(segs > 0 ? ` (${segs} ${segs === 1 ? 'tramo' : 'tramos'})` : '')
			);
		}

		// Notificación web del navegador (si la pestaña no está activa)
		if (browser && document.visibilityState !== 'visible') {
			notificarWeb(
				`${nombre} ${accion} su día`,
				`${fecha} · ${tipo}${segs > 0 ? ` · ${segs} tramos` : ''}`
			);
		}

		// La lista se recarga por si el conductor es nuevo o cambió de estado.
		cargar(true);
	}

	let bajasSocket: Array<() => void> = [];

	$effect(() => {
		void firmaDatos;
		void cargar();
	});

	onMount(() => {
		bajasSocket.push(socketUtils.on('conductores:actualizacion-masiva', () => cargar(true)));
		bajasSocket.push(
			socketUtils.on('dias-laborados:registro-actualizado', handleRegistroActualizado)
		);

		// Pedir permiso para notificaciones web (silencioso, no molesta)
		if (browser && typeof Notification !== 'undefined' && Notification.permission === 'default') {
			Notification.requestPermission().catch(() => {});
		}
	});

	onDestroy(() => {
		/// Se dan de baja solo NUESTROS listeners. El `off('evento')` que había
		/// aquí se llevaba por delante el de `dias-laborados:registro-actualizado`
		/// del canvas de recorridos, que dejaba de actualizarse al salir de esta
		/// página sin que nada lo avisara.
		for (const baja of bajasSocket) baja();
		bajasSocket = [];
	});
</script>

<svelte:head>
	<title>Conductores — Cotransmeq</title>
</svelte:head>

<div class="dir-pagina {shiftPressed ? 'select-none' : ''}" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, conteos y acciones ─────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Conductores</h1>
			<p class="dir-desc">Administra y supervisa todo el personal de conducción.</p>
			{#if vistaActual === 'ACTIVOS'}
				<div class="dir-conteos">
					<ResumenConteos
						{conteos}
						activo={filtros.estado === 'TODOS' ? null : filtros.estado}
						onElegir={(clave) => ponerFiltro('estado', filtros.estado === clave ? 'TODOS' : clave)}
					/>
				</div>
			{/if}
		</div>

		<div class="dir-cabecera-acciones">
			<!-- Lista / Recorridos -->
			<div
				class="inline-flex gap-1 rounded-xl p-1"
				style="background-color: var(--bg-base); border: 1px solid var(--border-default);"
				role="tablist"
			>
				<button
					onclick={() => ponerFiltro('vista', 'lista')}
					class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
					style="background-color: white; color: var(--emerald-800); box-shadow: 0 1px 3px rgba(0,0,0,0.06);"
					role="tab"
					aria-selected="true"
				>
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 6h16M4 10h16M4 14h16M4 18h16"
						/>
					</svg>
					Lista
				</button>
				<button
					onclick={() => irAlCanvasDeRecorridos()}
					class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
					style="background-color: transparent; color: var(--text-secondary);"
					role="tab"
					aria-selected="false"
				>
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
						/>
					</svg>
					Recorridos
				</button>
			</div>

			<!-- Vistas rápidas: ocultos y papelera -->
			{#if canAccessSpecialViews}
				<button
					onclick={() => cambiarVista(vistaActual === 'OCULTOS' ? 'ACTIVOS' : 'OCULTOS')}
					title={vistaActual === 'OCULTOS' ? 'Ver activos' : 'Ver ocultos'}
					class="btn-icon"
					style="border-color: {vistaActual === 'OCULTOS'
						? '#f59e0b'
						: 'var(--border-default)'}; background-color: {vistaActual === 'OCULTOS'
						? 'rgba(245,158,11,0.06)'
						: 'white'}; color: {vistaActual === 'OCULTOS' ? '#b45309' : 'var(--text-muted)'};"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
						/>
					</svg>
				</button>
				<button
					onclick={() => cambiarVista(vistaActual === 'PAPELERA' ? 'ACTIVOS' : 'PAPELERA')}
					title={vistaActual === 'PAPELERA' ? 'Ver activos' : 'Ver papelera'}
					class="btn-icon"
					style="border-color: {vistaActual === 'PAPELERA'
						? '#dc2626'
						: 'var(--border-default)'}; background-color: {vistaActual === 'PAPELERA'
						? 'rgba(220,38,38,0.06)'
						: 'white'}; color: {vistaActual === 'PAPELERA' ? '#dc2626' : 'var(--text-muted)'};"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
				</button>
			{/if}

			<button
				onclick={() => (mostrarFiltros = !mostrarFiltros)}
				class="btn-secondary"
				style="border-color: {mostrarFiltros
					? 'var(--emerald-500)'
					: 'var(--border-default)'}; color: {mostrarFiltros
					? 'var(--emerald-800)'
					: 'var(--text-secondary)'}; background-color: {mostrarFiltros
					? 'var(--au-tint)'
					: 'white'};"
			>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
					/>
				</svg>
				Filtros
				{#if numFiltrosActivos > 0}
					<span
						class="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
						style="background-color: var(--emerald-500);">!</span
					>
				{/if}
			</button>

			{#if puedeEditar}
				<button onclick={() => goto('/dashboard/conductores/agregar')} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Nuevo conductor
				</button>
			{/if}
		</div>

		<!-- Panel de filtros (drawer lateral) — siempre montado para que las
		     animaciones de entrada Y salida del FilterDrawer se ejecuten -->
		<FilterDrawer
			open={mostrarFiltros}
			onClose={() => (mostrarFiltros = false)}
			eyebrow="Filtros"
			title="Refinar resultados"
			subtitle="Encuentra conductores por estado, sede o palabra clave."
			activeCount={activeFilters.length}
		>
			<div slot="chips" class="flex flex-wrap gap-1.5">
				{#each activeFilters as chip, i (chip.key)}
					<span class="chip-pop-in" style="animation-delay: {i * 60}ms">
						<button class="filter-chip" onclick={() => clearFilter(chip.key)}>
							<span style="color: var(--text-muted); font-weight: 500;">{chip.label}:</span>
							<span>{chip.value}</span>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
						</button>
					</span>
				{/each}
			</div>

			<div class="flex flex-col gap-5">
				<div class="filter-field">
					<label for="filtro-estado" class="filter-field-label">
						Estado del conductor
						{#if filtros.estado !== 'TODOS'}<span class="filter-field-label-hint">filtrado</span
							>{/if}
					</label>
					<select
						id="filtro-estado"
						value={filtros.estado}
						onchange={(e) => ponerFiltro('estado', e.currentTarget.value)}
					>
						<option value="TODOS">Todos los estados</option>
						<option value="ACTIVO">Activo</option>
						<option value="INACTIVO">Inactivo</option>
						<option value="VACACIONES">Vacaciones</option>
						<option value="INCAPACITADO">Incapacitado</option>
						<option value="RETIRADO">Retirado</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-sede" class="filter-field-label">
						Sede de trabajo
						{#if filtros.sede !== 'TODOS'}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select
						id="filtro-sede"
						value={filtros.sede}
						onchange={(e) => ponerFiltro('sede', e.currentTarget.value)}
					>
						<option value="TODOS">Todas las sedes</option>
						<option value="YOPAL">Yopal</option>
						<option value="VILLANUEVA">Villanueva</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-busqueda" class="filter-field-label">
						Búsqueda por nombre o identificación
						{#if filtros.q.trim()}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<BuscadorLista
						valor={filtros.q}
						onBuscar={(termino) => ponerFiltro('q', termino)}
						placeholder="Ej. Juan Pérez, 1234567890…"
						etiqueta="Buscar conductores por nombre o identificación"
					/>
				</div>
			</div>

			<div slot="footer">
				<button class="filter-clear" onclick={limpiarFiltros} disabled={activeFilters.length === 0}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
					Limpiar
				</button>
				<button class="btn-primary" onclick={() => (mostrarFiltros = false)}>
					Ver resultados
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7l7 7-7 7" /></svg
					>
				</button>
			</div>
		</FilterDrawer>
	</header>

	<!-- ── FILTROS A LA VISTA: buscador + estado + sede ────── -->
	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(termino) => ponerFiltro('q', termino)}
				placeholder="Nombre, cédula, teléfono o correo…"
				etiqueta="Buscar conductores"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Estado"
			opciones={SEGMENTOS_ESTADO}
			valor={filtros.estado}
			onCambiar={(v) => ponerFiltro('estado', v)}
		/>
		<SegmentosFiltro
			etiqueta="Sede"
			opciones={SEGMENTOS_SEDE}
			valor={filtros.sede}
			onCambiar={(v) => ponerFiltro('sede', v)}
		/>
	</div>

	<!-- ── LISTA ───────────────────────────────────────────── -->
	<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
		<div class="dir-lista-scroll">
			<TablaLista
				columnas={COLUMNAS}
				datos={conductores}
				claveFila={(c) => c.id}
				cargando={isLoading}
				onFila={(c) => goto(`/dashboard/conductores/${c.id}`)}
				etiqueta="Conductores"
			>
				{#snippet celda({ columnaId, fila: c })}
					{#if columnaId === 'conductor'}
						<div class="flex items-center">
							<span class="dir-check">
								<input
									type="checkbox"
									checked={conductoresSeleccionados.has(c.id)}
									onclick={(e) => {
										e.stopPropagation();
										toggleSeleccion(c.id, conductores.indexOf(c), e);
									}}
									aria-label="Seleccionar {c.nombre} {c.apellido}"
								/>
							</span>
							<CeldaIdentidad
								titulo="{c.nombre} {c.apellido}"
								subtitulo="{c.tipo_identificacion || 'CC'} {c.numero_identificacion}"
								foto={c.foto_signed_url}
								punto={getEstadoColor(c.estado)}
							/>
						</div>
					{:else if columnaId === 'sede'}
						<div class="dir-celda">
							{#if c.sede_trabajo}<span>{c.sede_trabajo}</span>{:else}<span class="dir-nulo"
									>Sin sede</span
								>{/if}
							<small>{c.cargo || 'Conductor'}</small>
						</div>
					{:else if columnaId === 'contacto'}
						<div class="dir-celda">
							{#if c.telefono}<span>{c.telefono}</span>{:else}<span class="dir-nulo"
									>Sin teléfono</span
								>{/if}
							{#if c.email}<small>{c.email}</small>{/if}
						</div>
					{:else if columnaId === 'estado'}
						<EstadoPunto
							etiqueta={getEstadoText(c.estado)}
							color={getEstadoColor(c.estado)}
							apagado={['INACTIVO', 'RETIRADO'].includes(c.estado?.toUpperCase())}
						/>
					{:else if columnaId === 'acciones'}
						<AccionesFila
							acciones={[
								{
									id: 'recorridos',
									etiqueta: 'Ver recorridos / bonos de planilla',
									icono: Route,
									onClick: () => irAlCanvasDeRecorridos(c.id)
								},
								{
									id: 'ver',
									etiqueta: 'Ver detalle',
									icono: Eye,
									onClick: () => goto(`/dashboard/conductores/${c.id}`)
								},
								{
									id: 'ocultar',
									etiqueta: 'Ocultar',
									icono: EyeOff,
									onClick: () => accionIndividual(c.id, 'ocultar'),
									oculta: !puedeEditar || vistaActual !== 'ACTIVOS'
								},
								{
									id: 'mostrar',
									etiqueta: 'Mostrar',
									icono: Eye,
									onClick: () => accionIndividual(c.id, 'mostrar'),
									oculta: !puedeEditar || vistaActual !== 'OCULTOS'
								},
								{
									id: 'restaurar',
									etiqueta: 'Restaurar',
									icono: RotateCcw,
									onClick: () => accionIndividual(c.id, 'restaurar'),
									oculta: !puedeEditar || vistaActual !== 'PAPELERA'
								},
								{
									id: 'eliminar',
									etiqueta: 'Eliminar permanentemente',
									icono: Trash2,
									onClick: () => eliminarPermanente(c.id),
									peligrosa: true,
									oculta: !puedeEditar || vistaActual !== 'PAPELERA'
								}
							]}
						/>
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota('vacio')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>No hay conductores</h3>
						<p>
							{activeFilters.length
								? 'No se encontraron conductores con los filtros aplicados.'
								: 'Registra el primer conductor para verlo aquí.'}
						</p>
						{#if activeFilters.length}
							<button onclick={limpiarFiltros} class="btn-secondary">Limpiar filtros</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>

		<PaginadorLista
			pagina={filtros.pagina}
			total={totalConductores}
			porPagina={POR_PAGINA}
			cargando={isLoading}
			nombreItems="conductores"
			onCambiar={irPagina}
		/>
	</div>

	<!-- Bulk Actions Bar — fondo charcoal profundo (no glass) -->
	{#if conductoresSeleccionados.size > 0}
		<div class="bulk-actions-container">
			<div
				class="flex items-center gap-4 rounded-2xl p-2.5 shadow-2xl"
				style="background-color: var(--bg-charcoal); border: 1px solid rgba(255,255,255,0.08); color: white;"
				in:scale={{ duration: 300, start: 0.9 }}
			>
				<span
					class="px-2 text-xs font-medium"
					style="border-right: 1px solid rgba(255,255,255,0.15);"
				>
					{conductoresSeleccionados.size} seleccionados
				</span>
				<div class="flex gap-1.5">
					{#if vistaActual === 'ACTIVOS'}
						{#if puedeEditar}
							<button
								onclick={() => ejecutarAccionMasiva('ocultar')}
								disabled={procesandoMasivo}
								class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
								style="background-color: rgba(255,255,255,0.08);"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
									/></svg
								>
								Ocultar
							</button>
						{/if}
						{#if puedeEditar}
							<button
								onclick={() => ejecutarAccionMasiva('eliminar')}
								disabled={procesandoMasivo}
								class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
								style="background-color: rgba(220,38,38,0.85);"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
									/></svg
								>
								Papelera
							</button>
						{/if}
					{:else if vistaActual === 'OCULTOS'}
						{#if puedeEditar}
							<button
								onclick={() => ejecutarAccionMasiva('mostrar')}
								disabled={procesandoMasivo}
								class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
								style="background-color: var(--emerald-600);"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/></svg
								>
								Mostrar
							</button>
						{/if}
					{:else if vistaActual === 'PAPELERA'}
						{#if puedeEditar}
							<button
								onclick={() => ejecutarAccionMasiva('restaurar')}
								disabled={procesandoMasivo}
								class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
								style="background-color: var(--emerald-600);"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/></svg
								>
								Restaurar
							</button>
						{/if}
					{/if}
				</div>
				<button
					onclick={() => {
						conductoresSeleccionados.clear();
						conductoresSeleccionados = conductoresSeleccionados;
					}}
					class="apple-transition ml-2"
					style="color: rgba(255,255,255,0.5);"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
				</button>
			</div>
		</div>
	{/if}

	<!-- Modal de eliminación permanente con preview de relaciones -->
	{#if modalEliminar}
		<!-- Backdrop con blur (paleta landing) -->
		<button
			type="button"
			class="fixed inset-0 z-[100] cursor-default border-0 p-0"
			style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.40), rgba(20, 83, 45, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
			aria-label="Cerrar modal"
			onclick={cerrarModalEliminar}
		></button>

		<div
			class="fixed inset-0 z-[100] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
			onkeydown={(e) => e.key === 'Escape' && cerrarModalEliminar()}
		>
			<div
				class="w-full max-w-xl"
				style="max-height: 90vh; overflow-y: auto; background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);"
				in:scale={{ duration: 200, start: 0.95 }}
			>
				<!-- Header -->
				<div
					class="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4"
					style="background: linear-gradient(135deg, rgba(220,38,38,0.04), white); border-bottom: 1px solid var(--border-subtle);"
				>
					<div class="flex items-start gap-3">
						<div
							class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full"
							style="background-color: rgba(220,38,38,0.08);"
						>
							<svg
								class="h-5 w-5"
								style="color: #dc2626;"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
						</div>
						<div>
							<h3 class="text-base font-bold text-gray-900">Eliminar permanentemente</h3>
							{#if modalEliminar.conductor}
								<p class="mt-0.5 text-xs text-gray-500">
									<span class="font-semibold text-gray-700">{modalEliminar.conductor.nombre}</span>
									· CC {modalEliminar.conductor.identificacion}
								</p>
							{/if}
						</div>
					</div>
					<button
						onclick={cerrarModalEliminar}
						class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/></svg
						>
					</button>
				</div>

				<!-- Body -->
				<div class="px-5 py-4">
					{#if modalEliminar.loading}
						<div class="flex flex-col items-center justify-center py-12 text-gray-500">
							<svg class="h-8 w-8 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24"
								><circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle><path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
								></path></svg
							>
							<p class="mt-3 text-sm">Analizando relaciones del conductor…</p>
						</div>
					{:else if modalEliminar.error}
						<div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
							⚠ {modalEliminar.error}
						</div>
					{:else}
						<p class="text-xs text-gray-600">
							Esta acción <span class="font-bold text-red-600">no se puede deshacer</span>. Antes de
							continuar revisa la información asociada al conductor:
						</p>

						<!-- Resumen de relaciones -->
						<div class="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
							<div class="flex items-center justify-between">
								<p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
									Información relacionada
								</p>
								<span
									class="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-700 ring-1 ring-gray-200"
								>
									{totalRelaciones}
									{totalRelaciones === 1 ? 'registro' : 'registros'}
								</span>
							</div>

							{#if totalRelaciones === 0}
								<div
									class="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 ring-1 ring-emerald-200"
								>
									<svg
										class="h-4 w-4 flex-shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
										/></svg
									>
									Este conductor <strong>no tiene información relacionada</strong>. El borrado se
									puede realizar sin afectar otros registros.
								</div>
							{:else}
								<!-- Bloqueantes -->
								{#if relacionesBloqueantes.length > 0}
									<div class="mt-3">
										<p
											class="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-red-600 uppercase"
										>
											<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
												/></svg
											>
											Datos históricos protegidos
										</p>
										<ul class="space-y-1">
											{#each relacionesBloqueantes as r}
												<li
													class="flex items-start gap-2 rounded-md bg-white px-2.5 py-2 ring-1 ring-red-100"
												>
													<span class="text-base leading-none">{r.icono}</span>
													<div class="min-w-0 flex-1">
														<div class="flex items-center justify-between gap-2">
															<p class="truncate text-xs font-semibold text-gray-800">
																{r.etiqueta}
															</p>
															<span
																class="flex-shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 ring-1 ring-red-200"
															>
																{r.cantidad}
															</span>
														</div>
														<p class="mt-0.5 text-[10px] text-gray-500">{r.descripcion}</p>
													</div>
												</li>
											{/each}
										</ul>
									</div>
								{/if}

								<!-- No bloqueantes -->
								{#if relacionesInfo.length > 0}
									<div class="mt-3">
										<p class="mb-1.5 text-[10px] font-bold tracking-wide text-gray-500 uppercase">
											También se eliminarán
										</p>
										<ul class="space-y-1">
											{#each relacionesInfo as r}
												<li
													class="flex items-start gap-2 rounded-md bg-white px-2.5 py-1.5 ring-1 ring-gray-200"
												>
													<span class="text-sm leading-none">{r.icono}</span>
													<div class="min-w-0 flex-1">
														<div class="flex items-center justify-between gap-2">
															<p class="truncate text-xs font-medium text-gray-700">{r.etiqueta}</p>
															<span
																class="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600"
															>
																{r.cantidad}
															</span>
														</div>
													</div>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
							{/if}
						</div>

						<!-- Advertencia legal si hay bloqueantes -->
						{#if relacionesBloqueantes.length > 0}
							<div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
								<div class="flex items-start gap-2">
									<svg
										class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/></svg
									>
									<div class="text-xs text-amber-800">
										<p class="font-semibold">Recomendación: mantener en la papelera</p>
										<p class="mt-1 text-amber-700">
											Este conductor tiene información de nómina, liquidaciones, firmas o servicios.
											Eliminarlo permanentemente borrará todo el historial relacionado, lo cual
											puede afectar la trazabilidad contable y legal. Considera mantenerlo en la
											papelera de reciclaje.
										</p>
									</div>
								</div>
							</div>
						{/if}

						<!-- Confirmación por texto -->
						<div class="mt-4">
							<label for="confirm-eliminar" class="text-xs font-semibold text-gray-700">
								Para confirmar, escribe <span
									class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-red-600">ELIMINAR</span
								> en el campo:
							</label>
							<input
								id="confirm-eliminar"
								type="text"
								bind:value={confirmacionTexto}
								class="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tracking-wide uppercase focus:border-red-400 focus:ring-2 focus:ring-red-200 focus:outline-none"
								placeholder="Escribe ELIMINAR"
								autocomplete="off"
							/>
						</div>

						{#if modalEliminar.error}
							<div
								class="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
							>
								⚠ {modalEliminar.error}
							</div>
						{/if}
					{/if}
				</div>

				<!-- Footer -->
				<div
					class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3"
				>
					<button
						onclick={cerrarModalEliminar}
						class="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
					>
						Cancelar
					</button>
					{#if puedeEditar}
						<button
							onclick={() => confirmarEliminarPermanente(true)}
							disabled={!confirmacionValida || modalEliminar.loading || modalEliminar.procesando}
							class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{#if modalEliminar.procesando}
								<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24"
									><circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									></circle><path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
									></path></svg
								>
								Eliminando...
							{:else}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
									/></svg
								>
								Eliminar definitivamente
							{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.bulk-actions-container {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes slide-up {
		0% {
			transform: translate(-50%, 100%);
			opacity: 0;
		}
		100% {
			transform: translate(-50%, 0);
			opacity: 1;
		}
	}
</style>
