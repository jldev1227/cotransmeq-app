<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { fly, fade, scale } from 'svelte/transition';
	import { page } from '$app/stores';
	import { conductoresAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import TablaDiasLaborados from '$lib/components/conductores/TablaDiasLaborados.svelte';
	import FilterDrawer from '$lib/components/ui/FilterDrawer.svelte';

	type VistaActual = 'ACTIVOS' | 'OCULTOS' | 'PAPELERA';
	type EstadoConductor =
		| 'TODOS'
		| 'ACTIVO'
		| 'INACTIVO'
		| 'VACACIONES'
		| 'INCAPACITADO'
		| 'RETIRADO';

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

	let vistaActual: VistaActual = 'ACTIVOS';
	type VistaTab = 'lista' | 'calendario';
	let vistaTab: VistaTab = 'lista';
	let conductores: Conductor[] = [];
	let isLoading = true;
	let error: string | null = null;
	let searchTerm = '';
	let filtroEstado: EstadoConductor = 'TODOS';
	let filtroSede: 'TODOS' | 'YOPAL' | 'VILLANUEVA' = 'TODOS';
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let mostrarFiltros = false;

	$: isAdmin = $authStore.user?.role === 'admin' || $authStore.user?.rol === 'admin';
	$: isOperaciones = $authStore.user?.area?.includes('operaciones');
	$: isTalentoHumano = $authStore.user?.area?.includes('talento_humano');
	$: canAccessSpecialViews = isAdmin || isOperaciones || isTalentoHumano;
	// Permiso individual para gestionar bonos de planilla (no por área)
	$: canManageBonos = $authStore.user?.permisos?.['bonos-planilla'] === true;

	// ══════════════════════════════════════════════════════
	//  URL PARAMS: sincroniza el estado del page con la URL
	//  para que sea compartible / bookmarkable.
	//
	//  Soporta:
	//    ?vista=lista|calendario
	//    ?q=juan           → búsqueda libre del tab lista
	//    ?estado=ACTIVO
	//    ?sede=YOPAL
	//    ?vista_lista=ACTIVOS|OCULTOS|PAPELERA
	//    ?conductor=<id>   → cuando se navega desde un conductor
	//                        específico al tab de recorridos
	// ══════════════════════════════════════════════════════
	function readUrlParams() {
		if (!browser) return;
		const url = $page.url;
		const p = url.searchParams;

		const vistaParam = p.get('vista');
		if (vistaParam === 'lista' || vistaParam === 'calendario') vistaTab = vistaParam;

		const qParam = p.get('q');
		if (qParam !== null) searchTerm = qParam;

		const estadoParam = p.get('estado');
		if (
			estadoParam === 'TODOS' ||
			estadoParam === 'ACTIVO' ||
			estadoParam === 'INACTIVO' ||
			estadoParam === 'VACACIONES' ||
			estadoParam === 'INCAPACITADO' ||
			estadoParam === 'RETIRADO'
		) {
			filtroEstado = estadoParam;
		}

		const sedeParam = p.get('sede');
		if (sedeParam === 'TODOS' || sedeParam === 'YOPAL' || sedeParam === 'VILLANUEVA') {
			filtroSede = sedeParam;
		}

		const vistaLista = p.get('vista_lista');
		if (vistaLista === 'ACTIVOS' || vistaLista === 'OCULTOS' || vistaLista === 'PAPELERA') {
			vistaActual = vistaLista;
		}
	}

	function syncUrlParams() {
		if (!browser) return;
		const p = new URLSearchParams();
		if (vistaTab !== 'lista') p.set('vista', vistaTab);
		if (searchTerm.trim()) p.set('q', searchTerm.trim());
		if (filtroEstado !== 'TODOS') p.set('estado', filtroEstado);
		if (filtroSede !== 'TODOS') p.set('sede', filtroSede);
		if (vistaActual !== 'ACTIVOS') p.set('vista_lista', vistaActual);

		const qs = p.toString();
		const newUrl = qs ? `${$page.url.pathname}?${qs}` : $page.url.pathname;
		// Usar replaceState para no llenar el history con cada keystroke
		try {
			window.history.replaceState(window.history.state, '', newUrl);
		} catch {
			// Fallback silencioso
		}
	}

	// Lee los params una sola vez al montar
	let urlParamsRead = false;
	onMount(() => {
		readUrlParams();
		urlParamsRead = true;
	});

	// Sincroniza la URL cuando cambian los filtros (sin disparar recarga)
	$: if (browser && urlParamsRead) syncUrlParams();

	// Leer conductor_id del URL para pasarlo a TablaDiasLaborados
	$: urlConductorId = $page.url.searchParams.get('conductor') || '';

	// Estados para modo selección
	let conductoresSeleccionados = new Set<string>();
	let ultimoSeleccionadoIndex: number | null = null;
	let shiftPressed = false;
	let procesandoMasivo = false;

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
	let modalEliminar: ModalEliminar | null = null;
	let confirmacionTexto = '';

	$: totalRelaciones = modalEliminar?.relaciones?.reduce((s, r) => s + r.cantidad, 0) ?? 0;
	$: relacionesBloqueantes =
		modalEliminar?.relaciones?.filter((r) => r.bloquea && r.cantidad > 0) ?? [];
	$: relacionesInfo = modalEliminar?.relaciones?.filter((r) => r.cantidad > 0 && !r.bloquea) ?? [];
	$: confirmacionValida = confirmacionTexto.trim().toUpperCase() === 'ELIMINAR';

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = true;
	}

	function handleKeyup(e: KeyboardEvent) {
		if (e.key === 'Shift') shiftPressed = false;
	}

	let pagination = {
		page: 1,
		limit: 20,
		pages: 1,
		total: 0
	};

	let stats = {
		total: 0,
		activos: 0,
		inactivos: 0,
		vacaciones: 0,
		incapacitados: 0,
		retirados: 0
	};

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
	$: activeFilters = [
		...(filtroEstado !== 'TODOS'
			? [
					{
						key: 'estado',
						label: 'Estado',
						value: ESTADO_FILTER_LABELS[filtroEstado] ?? filtroEstado
					}
				]
			: []),
		...(filtroSede !== 'TODOS' ? [{ key: 'sede', label: 'Sede', value: filtroSede }] : []),
		...(searchTerm.trim()
			? [{ key: 'search', label: 'Búsqueda', value: `"${searchTerm.trim()}"` }]
			: [])
	];

	function clearFilter(key: string) {
		if (key === 'estado') {
			filtroEstado = 'TODOS';
			loadConductores();
		}
		if (key === 'sede') {
			filtroSede = 'TODOS';
			loadConductores();
		}
		if (key === 'search') {
			searchTerm = '';
			loadConductores();
		}
	}

	const getEstadoColor = (estado: string) => {
		switch (estado?.toUpperCase()) {
			case 'ACTIVO':
				return '#10b981'; // emerald-500
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
				return estado || 'Sin estado';
		}
	};

	async function loadConductores(forceRefresh = false) {
		isLoading = true;
		error = null;
		if (forceRefresh) {
			conductoresSeleccionados.clear();
			conductoresSeleccionados = conductoresSeleccionados;
		}

		try {
			let response;
			const params = {
				page: pagination.page,
				limit: pagination.limit,
				search: searchTerm,
				estado: filtroEstado !== 'TODOS' ? filtroEstado : undefined,
				sede_trabajo: filtroSede !== 'TODOS' ? filtroSede : undefined
			};

			if (vistaActual === 'ACTIVOS') {
				response = await conductoresAPI.getAll(params);
			} else if (vistaActual === 'OCULTOS') {
				response = await conductoresAPI.getOcultos(params);
			} else if (vistaActual === 'PAPELERA') {
				response = await conductoresAPI.getPapelera(params);
			}

			if (response?.data?.success) {
				conductores = response.data.data || response.data.conductores || [];
				pagination.total = response.data.pagination?.total || conductores.length;
				pagination.pages = response.data.pagination?.totalPages || 1;

				// Actualizar stats (esto debería venir del backend idealmente, pero calculamos local para consistencia UI)
				if (
					vistaActual === 'ACTIVOS' &&
					!searchTerm &&
					filtroEstado === 'TODOS' &&
					filtroSede === 'TODOS'
				) {
					stats.total = pagination.total;
					stats.activos = conductores.filter((c) => c.estado?.toUpperCase() === 'ACTIVO').length;
					stats.inactivos = conductores.filter(
						(c) => c.estado?.toUpperCase() === 'INACTIVO'
					).length;
					stats.vacaciones = conductores.filter(
						(c) => c.estado?.toUpperCase() === 'VACACIONES'
					).length;
					stats.incapacitados = conductores.filter(
						(c) => c.estado?.toUpperCase() === 'INCAPACITADO'
					).length;
					stats.retirados = conductores.filter(
						(c) => c.estado?.toUpperCase() === 'RETIRADO'
					).length;
				}
			} else {
				throw new Error('Error en el formato de respuesta del servidor');
			}
		} catch (err: any) {
			console.error('Error cargando conductores:', err);
			error = err.message || 'Error al cargar conductores';
			if (error) toast.error(error);
		} finally {
			isLoading = false;
		}
	}

	const handleSearch = () => {
		if (searchTimeout) clearTimeout(searchTimeout);
		// Sync URL inmediatamente para que la búsqueda sea compartible
		syncUrlParams();
		searchTimeout = setTimeout(() => {
			pagination.page = 1;
			loadConductores();
		}, 400);
	};

	function cambiarVista(nuevaVista: VistaActual) {
		if (vistaActual === nuevaVista) return;
		vistaActual = nuevaVista;
		pagination.page = 1;
		// Solo resetea los filtros cuando se cambia desde la UI; respeta los
		// que vinieron del URL
		if (!browser || !$page.url.searchParams.has('q')) searchTerm = '';
		if (!browser || !$page.url.searchParams.has('estado')) filtroEstado = 'TODOS';
		if (!browser || !$page.url.searchParams.has('sede')) filtroSede = 'TODOS';
		loadConductores(true);
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
				loadConductores(true);
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
			loadConductores(true);
		} catch (err: any) {
			modalEliminar.procesando = false;
			modalEliminar.error = err.response?.data?.message || 'Error al eliminar permanentemente';
		}
	}

	function cerrarModalEliminar() {
		modalEliminar = null;
		confirmacionTexto = '';
	}

	async function irPagina(pagina: number) {
		if (pagina >= 1 && pagina <= pagination.pages) {
			pagination.page = pagina;
			await loadConductores();
		}
	}

	function limpiarFiltros() {
		searchTerm = '';
		filtroEstado = 'TODOS';
		filtroSede = 'TODOS';
		pagination.page = 1;
		loadConductores(true);
	}

	// ═══════════════════════════════
	// SOCKET: refrescar calendario y tabla en tiempo real
	// ═══════════════════════════════
	let tablaRefreshKey = 0;
	let calendarRefreshKey = 0;

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

		// Refrescar la tabla de días laborados (que internamente escucha el socket
		// también, pero forzamos recarga para que la lista de conductores del filtro
		// se actualice si es uno nuevo).
		if (vistaTab === 'calendario') {
			tablaRefreshKey++;
		}

		// Si el registro es del mes actual de la tabla, recargar
		if (vistaTab === 'lista') {
			loadConductores(true);
		}
	}



	onMount(() => {
		loadConductores();
		socketUtils.on('conductores:actualizacion-masiva', () => loadConductores(true));
		socketUtils.on('dias-laborados:registro-actualizado', handleRegistroActualizado);

		// Pedir permiso para notificaciones web (silencioso, no molesta)
		if (browser && typeof Notification !== 'undefined' && Notification.permission === 'default') {
			Notification.requestPermission().catch(() => {});
		}
	});

	onDestroy(() => {
		socketUtils.off('conductores:actualizacion-masiva');
		socketUtils.off('dias-laborados:registro-actualizado');
	});
</script>

<svelte:head>
	<title>Conductores — Transmeralda</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-4 p-6" in:fade={{ duration: 400 }}>
	<!-- ── HEADER (page-card editorial) ─────────────────────── -->
	<div class="page-card flex-shrink-0" style="padding: 1.25rem 1.5rem;">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<!-- Título -->
			<div class="flex items-center gap-3">
				<div
					class="brand-gradient flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);"
				>
					<svg
						class="h-5 w-5 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
						/>
					</svg>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 400;">
							Gestión de Conductores
						</h1>
						<span
							class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
							style="background: rgba(16,185,129,0.08); color: var(--emerald-800);"
						>
							<span
								class="h-1.5 w-1.5 animate-pulse rounded-full"
								style="background-color: var(--emerald-500);"
							></span>
							En vivo
						</span>
					</div>
					<p class="text-xs" style="color: var(--text-muted);">
						Administra y supervisa todo el personal de conducción
					</p>
				</div>
			</div>

			<!-- Búsqueda + acciones -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Tabs Lista / Recorridos (segmented) -->
				<div
					class="inline-flex gap-1 rounded-xl p-1"
					style="background-color: var(--bg-base); border: 1px solid var(--border-default);"
					role="tablist"
				>
					<button
						on:click={() => (vistaTab = 'lista')}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
						style="background-color: {vistaTab === 'lista' ? 'white' : 'transparent'};
							color: {vistaTab === 'lista' ? 'var(--emerald-700)' : 'var(--text-secondary)'};
							box-shadow: {vistaTab === 'lista' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'};"
						role="tab"
						aria-selected={vistaTab === 'lista'}
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
						on:click={() => (vistaTab = 'calendario')}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
						style="background-color: {vistaTab === 'calendario' ? 'white' : 'transparent'};
							color: {vistaTab === 'calendario' ? 'var(--emerald-700)' : 'var(--text-secondary)'};
							box-shadow: {vistaTab === 'calendario' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'};"
						role="tab"
						aria-selected={vistaTab === 'calendario'}
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

				<!-- Vistas Rápidas (Icon Buttons) -->
				{#if canAccessSpecialViews}
					<div class="mr-1 flex items-center gap-1">
						<button
							on:click={() => cambiarVista(vistaActual === 'OCULTOS' ? 'ACTIVOS' : 'OCULTOS')}
							title={vistaActual === 'OCULTOS' ? 'Ver Activos' : 'Ver Ocultos'}
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
							on:click={() => cambiarVista(vistaActual === 'PAPELERA' ? 'ACTIVOS' : 'PAPELERA')}
							title={vistaActual === 'PAPELERA' ? 'Ver Activos' : 'Ver Papelera'}
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
					</div>
				{/if}

			<!-- Acciones del LISTADO (solo visibles en tab 'lista') -->
			{#if vistaTab === 'lista'}
				<!-- Búsqueda -->
				<div class="relative">
					<input
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Buscar conductores…"
						class="input-glow apple-transition w-64 rounded-xl border py-2 pr-4 pl-9 text-sm"
						style="border-color: var(--border-default); background-color: var(--bg-surface); color: var(--text-primary);"
					/>
					<svg
						class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
						style="color: var(--text-very-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</div>

				<!-- Filtros -->
				<button
					on:click={() => (mostrarFiltros = !mostrarFiltros)}
					class="btn-secondary"
					style="border-color: {mostrarFiltros
						? 'var(--emerald-500)'
						: 'var(--border-default)'}; color: {mostrarFiltros
						? 'var(--emerald-700)'
						: 'var(--text-secondary)'}; background-color: {mostrarFiltros
						? 'rgba(16,185,129,0.04)'
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
					{#if filtroEstado !== 'TODOS' || filtroSede !== 'TODOS'}
						<span
							class="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
							style="background-color: var(--emerald-500);">!</span
						>
					{/if}
				</button>

				<!-- Nuevo -->
				<button on:click={() => goto('/dashboard/conductores/agregar')} class="btn-primary">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					Nuevo Conductor
				</button>
			{/if}
			</div>
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
						<button class="filter-chip" on:click={() => clearFilter(chip.key)}>
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
						{#if filtroEstado !== 'TODOS'}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select id="filtro-estado" bind:value={filtroEstado} on:change={() => loadConductores()}>
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
						{#if filtroSede !== 'TODOS'}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<select id="filtro-sede" bind:value={filtroSede} on:change={() => loadConductores()}>
						<option value="TODOS">Todas las sedes</option>
						<option value="YOPAL">Yopal</option>
						<option value="VILLANUEVA">Villanueva</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="filtro-busqueda" class="filter-field-label">
						Búsqueda por nombre o identificación
						{#if searchTerm.trim()}<span class="filter-field-label-hint">filtrado</span>{/if}
					</label>
					<input
						id="filtro-busqueda"
						type="text"
						bind:value={searchTerm}
						on:input={handleSearch}
						placeholder="Ej. Juan Pérez, 1234567890…"
					/>
				</div>
			</div>

			<div slot="footer">
				<button
					class="filter-clear"
					on:click={limpiarFiltros}
					disabled={activeFilters.length === 0}
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
					Limpiar
				</button>
				<button class="btn-primary" on:click={() => (mostrarFiltros = false)}>
					Ver resultados
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7l7 7-7 7" /></svg
					>
				</button>
			</div>
		</FilterDrawer>
	</div>

	{#if vistaTab === 'lista'}
		<!-- ── STATS CARDS (estilo landing, radius 16) ────────── -->
		{#if vistaActual === 'ACTIVOS'}
			<div
				class="grid flex-shrink-0 grid-cols-3 gap-3 lg:grid-cols-6"
				in:fly={{ y: 12, duration: 400, delay: 100 }}
			>
				<!-- Total -->
				<div class="stat-card">
					<div class="flex items-center justify-between">
						<div>
							<p class="stat-label">Total</p>
							<p class="stat-value">{stats.total}</p>
						</div>
						<div
							class="flex h-7 w-7 items-center justify-center rounded-lg"
							style="background: linear-gradient(135deg, #6b6b6b, #4a4a4a);"
						>
							<svg
								class="h-3.5 w-3.5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
								/>
							</svg>
						</div>
					</div>
				</div>
				<!-- Activos -->
				<button
					on:click={() => {
						filtroEstado = 'ACTIVO';
						loadConductores();
					}}
					class="stat-card apple-transition text-left"
					style="border-color: {filtroEstado === 'ACTIVO'
						? 'var(--emerald-500)'
						: 'var(--border-subtle)'}; background-color: {filtroEstado === 'ACTIVO'
						? 'rgba(16,185,129,0.04)'
						: 'var(--bg-surface)'};"
				>
					<div class="flex items-center justify-between">
						<div>
							<p class="stat-label">Activos</p>
							<p class="stat-value" style="color: var(--emerald-600);">{stats.activos}</p>
						</div>
						<div
							class="flex h-7 w-7 items-center justify-center rounded-lg"
							style="background-color: var(--emerald-500);"
						>
							<svg
								class="h-3.5 w-3.5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
					</div>
				</button>
				<!-- Inactivos -->
				<button
					on:click={() => {
						filtroEstado = 'INACTIVO';
						loadConductores();
					}}
					class="stat-card apple-transition text-left"
					style="border-color: {filtroEstado === 'INACTIVO'
						? '#6b6b6b'
						: 'var(--border-subtle)'}; background-color: {filtroEstado === 'INACTIVO'
						? 'rgba(107,107,107,0.04)'
						: 'var(--bg-surface)'};"
				>
					<div class="flex items-center justify-between">
						<div>
							<p class="stat-label">Inactivos</p>
							<p class="stat-value" style="color: #6b6b6b;">{stats.inactivos}</p>
						</div>
						<div
							class="flex h-7 w-7 items-center justify-center rounded-lg"
							style="background-color: #6b6b6b;"
						>
							<svg
								class="h-3.5 w-3.5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
								/>
							</svg>
						</div>
					</div>
				</button>
				<!-- Vacaciones -->
				<button
					on:click={() => {
						filtroEstado = 'VACACIONES';
						loadConductores();
					}}
					class="stat-card apple-transition text-left"
					style="border-color: {filtroEstado === 'VACACIONES'
						? '#3b82f6'
						: 'var(--border-subtle)'}; background-color: {filtroEstado === 'VACACIONES'
						? 'rgba(59,130,246,0.04)'
						: 'var(--bg-surface)'};"
				>
					<div class="flex items-center justify-between">
						<div>
							<p class="stat-label">Vacaciones</p>
							<p class="stat-value" style="color: #3b82f6;">{stats.vacaciones}</p>
						</div>
						<div
							class="flex h-7 w-7 items-center justify-center rounded-lg"
							style="background-color: #3b82f6;"
						>
							<svg
								class="h-3.5 w-3.5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
								/>
							</svg>
						</div>
					</div>
				</button>
				<!-- Incapacitados -->
				<button
					on:click={() => {
						filtroEstado = 'INCAPACITADO';
						loadConductores();
					}}
					class="stat-card apple-transition text-left"
					style="border-color: {filtroEstado === 'INCAPACITADO'
						? '#f59e0b'
						: 'var(--border-subtle)'}; background-color: {filtroEstado === 'INCAPACITADO'
						? 'rgba(245,158,11,0.04)'
						: 'var(--bg-surface)'};"
				>
					<div class="flex items-center justify-between">
						<div>
							<p class="stat-label">Incapacitados</p>
							<p class="stat-value" style="color: #f59e0b;">{stats.incapacitados}</p>
						</div>
						<div
							class="flex h-7 w-7 items-center justify-center rounded-lg"
							style="background-color: #f59e0b;"
						>
							<svg
								class="h-3.5 w-3.5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 17c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
						</div>
					</div>
				</button>
				<!-- Retirados -->
				<button
					on:click={() => {
						filtroEstado = 'RETIRADO';
						loadConductores();
					}}
					class="stat-card apple-transition text-left"
					style="border-color: {filtroEstado === 'RETIRADO'
						? '#dc2626'
						: 'var(--border-subtle)'}; background-color: {filtroEstado === 'RETIRADO'
						? 'rgba(220,38,38,0.04)'
						: 'var(--bg-surface)'};"
				>
					<div class="flex items-center justify-between">
						<div>
							<p class="stat-label">Retirados</p>
							<p class="stat-value" style="color: #dc2626;">{stats.retirados}</p>
						</div>
						<div
							class="flex h-7 w-7 items-center justify-center rounded-lg"
							style="background-color: #dc2626;"
						>
							<svg
								class="h-3.5 w-3.5 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6"
								/>
							</svg>
						</div>
					</div>
				</button>
			</div>
		{/if}

		<!-- ── TABLA (table-card editorial) ──────────────────── -->
		<div
			class="table-card flex min-h-0 flex-1 flex-col {shiftPressed ? 'select-none' : ''}"
			in:fly={{ y: 12, duration: 400, delay: 150 }}
		>
			{#if isLoading}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
					<div class="spinner" style="width: 2.5rem; height: 2.5rem; border-width: 4px;"></div>
					<p class="text-sm" style="color: var(--text-muted);">Cargando conductores…</p>
				</div>
			{:else if conductores.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
					<div
						class="flex h-14 w-14 items-center justify-center rounded-2xl"
						style="background-color: var(--bg-base);"
					>
						<svg
							class="h-7 w-7"
							style="color: var(--text-very-muted);"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
							/>
						</svg>
					</div>
					<div class="text-center">
						<h3 class="mb-1 font-display text-lg" style="color: var(--bg-charcoal);">
							No hay conductores
						</h3>
						<p class="text-sm" style="color: var(--text-muted);">
							{searchTerm || filtroEstado !== 'TODOS'
								? 'No se encontraron resultados con los filtros aplicados'
								: 'Comienza registrando un nuevo conductor'}
						</p>
					</div>
					{#if searchTerm || filtroEstado !== 'TODOS'}
						<button on:click={limpiarFiltros} class="btn-primary">Limpiar filtros</button>
					{/if}
				</div>
			{:else}
				<!-- Cards grid: 1 col mobile, 2 sm/md, 3 lg, 4 xl -->
				<div class="min-h-0 flex-1 overflow-y-auto p-3">
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each conductores as conductor, index (conductor.id)}
							<article
								class="list-card"
								style="border-left: 4px solid {getEstadoColor(conductor.estado)};
								background-color: {conductoresSeleccionados.has(conductor.id)
									? 'rgba(16, 185, 129, 0.04)'
									: 'var(--bg-surface)'};
								border-color: {conductoresSeleccionados.has(conductor.id)
									? 'var(--emerald-500)'
									: 'var(--border-subtle)'};
								border-left-color: {getEstadoColor(conductor.estado)};"
								in:fly={{ y: 8, duration: 200, delay: Math.min(index * 20, 200) }}
								on:click={(e) => toggleSeleccion(conductor.id, index, e)}
								role="button"
								tabindex="0"
							>
								<!-- Avatar: foto o fallback iniciales -->
								<div class="flex-shrink-0">
									<div
										class="flex h-full w-16 items-center justify-center overflow-hidden rounded-sm"
										style="border: 1px solid {getEstadoColor(
											conductor.estado
										)}30; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);"
									>
										{#if conductor.foto_signed_url}
											<img
												src={conductor.foto_signed_url}
												alt="{conductor.nombre} {conductor.apellido}"
												class="h-full w-full object-cover"
												loading="lazy"
											/>
										{:else}
											<div
												class="flex h-full w-full items-center justify-center font-display text-sm font-medium"
												style="background: linear-gradient(135deg, {getEstadoColor(
													conductor.estado
												)}15, {getEstadoColor(conductor.estado)}30); color: {getEstadoColor(
													conductor.estado
												)};"
											>
												{conductor.nombre[0]}{conductor.apellido[0]}
											</div>
										{/if}
									</div>
								</div>

								<!-- Contenido principal -->
								<div class="min-w-0 flex-1">
									<!-- Header: nombre + status pill -->
									<div class="mb-1 flex items-start justify-between gap-2">
										<p
											class="truncate text-sm leading-snug font-semibold"
											style="color: var(--text-primary);"
										>
											{conductor.nombre}
											{conductor.apellido}
										</p>
									</div>

									<!-- Identificación (mono) + tipo -->
									<p
										class="font-mono-meta text-[10px]"
										style="color: var(--text-very-muted); letter-spacing: 0.05em;"
									>
										{conductor.tipo_identificacion || 'CC'} · {conductor.numero_identificacion}
									</p>

									<!-- Sede + cargo -->
									<p class="mt-1.5 truncate text-[11px]" style="color: var(--text-secondary);">
										{conductor.sede_trabajo || 'Sin sede'} · {conductor.cargo || 'CONDUCTOR'}
									</p>

									<!-- Footer: contacto + email -->
									<div
										class="mt-1.5 flex items-center justify-between gap-2 text-[10px]"
										style="color: var(--text-muted);"
									>
										{#if conductor.telefono}
											<span class="flex items-center gap-1 truncate">
												<svg
													class="h-3 w-3 flex-shrink-0"
													style="color: var(--text-very-muted);"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
													/>
												</svg>
												<span class="truncate">{conductor.telefono}</span>
											</span>
										{:else}
											<span class="italic" style="color: var(--text-very-muted);">Sin teléfono</span
											>
										{/if}
										{#if conductor.email}
											<span class="truncate" style="color: var(--text-very-muted);"
												>{conductor.email}</span
											>
										{/if}
									</div>
								</div>

								<!-- Actions (vertical) -->
								<div class="flex flex-shrink-0 flex-col gap-1" on:click|stopPropagation>
									<button
										on:click={() => goto(`/dashboard/conductores?vista=calendario&conductor=${conductor.id}`)}
										class="apple-transition rounded-md p-1.5"
										style="color: #1d4ed8; background-color: rgba(59, 130, 246, 0.08);"
										title="Ver recorridos / bonos de planilla"
										aria-label="Ver recorridos del conductor"
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
									</button>
									<button
										on:click={() => goto(`/dashboard/conductores/${conductor.id}`)}
										class="apple-transition rounded-md p-1.5"
										style="color: var(--emerald-600); background-color: rgba(16, 185, 129, 0.06);"
										title="Ver detalle"
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
												d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
											/>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
											/>
										</svg>
									</button>
									{#if vistaActual === 'OCULTOS'}
										<button
											on:click={() => {
												conductoresSeleccionados.clear();
												conductoresSeleccionados.add(conductor.id);
												ejecutarAccionMasiva('mostrar');
											}}
											class="apple-transition rounded-md p-1.5"
											style="color: var(--emerald-600); background-color: rgba(16, 185, 129, 0.06);"
											title="Mostrar"
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
													d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
												/>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
												/>
											</svg>
										</button>
									{:else if vistaActual === 'PAPELERA'}
										<button
											on:click={() => {
												conductoresSeleccionados.clear();
												conductoresSeleccionados.add(conductor.id);
												ejecutarAccionMasiva('restaurar');
											}}
											class="apple-transition rounded-md p-1.5"
											style="color: var(--emerald-600); background-color: rgba(16, 185, 129, 0.06);"
											title="Restaurar"
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
													d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
												/>
											</svg>
										</button>
										<button
											on:click={() => eliminarPermanente(conductor.id)}
											class="apple-transition rounded-md p-1.5"
											style="color: #dc2626; background-color: rgba(220, 38, 38, 0.06);"
											title="Eliminar Permanente"
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
													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
												/>
											</svg>
										</button>
									{:else}
										<button
											on:click={() => {
												conductoresSeleccionados.clear();
												conductoresSeleccionados.add(conductor.id);
												ejecutarAccionMasiva('ocultar');
											}}
											class="apple-transition rounded-md p-1.5"
											style="color: var(--text-very-muted); background-color: var(--bg-base);"
											title="Ocultar"
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
													d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
												/>
											</svg>
										</button>
									{/if}
								</div>
							</article>
						{/each}
					</div>
				</div>

				<!-- Paginación -->
				{#if pagination.pages > 1}
					<div
						class="flex flex-shrink-0 items-center justify-between px-4 py-3"
						style="border-top: 1px solid var(--border-subtle); background-color: var(--bg-base);"
					>
						<p class="text-xs" style="color: var(--text-muted);">
							Mostrando <span class="font-semibold" style="color: var(--text-primary);"
								>{(pagination.page - 1) * pagination.limit + 1}–{Math.min(
									pagination.page * pagination.limit,
									pagination.total
								)}</span
							>
							de
							<span class="font-semibold" style="color: var(--text-primary);"
								>{pagination.total}</span
							> conductores
						</p>
						<div class="flex items-center gap-1">
							<button
								on:click={() => irPagina(1)}
								disabled={pagination.page === 1 || isLoading}
								class="apple-transition rounded-lg border p-1.5"
								style="border-color: var(--border-default); color: {pagination.page === 1 ||
								isLoading
									? 'var(--text-very-muted)'
									: 'var(--text-secondary)'}; background-color: {pagination.page === 1 || isLoading
									? 'var(--bg-base)'
									: 'white'}; cursor: {pagination.page === 1 || isLoading
									? 'not-allowed'
									: 'pointer'};"
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
										d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
									/></svg
								>
							</button>
							<button
								on:click={() => irPagina(pagination.page - 1)}
								disabled={pagination.page === 1 || isLoading}
								class="apple-transition rounded-lg border p-1.5"
								style="border-color: var(--border-default); color: {pagination.page === 1 ||
								isLoading
									? 'var(--text-very-muted)'
									: 'var(--text-secondary)'}; background-color: {pagination.page === 1 || isLoading
									? 'var(--bg-base)'
									: 'white'}; cursor: {pagination.page === 1 || isLoading
									? 'not-allowed'
									: 'pointer'};"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg
								>
							</button>
							{#each Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
								const start = Math.max(1, Math.min(pagination.page - 2, pagination.pages - 4));
								return start + i;
							}) as pagina}
								<button
									on:click={() => irPagina(pagina)}
									disabled={isLoading}
									class="apple-transition min-w-[2rem] rounded-lg border px-2 py-1 text-xs"
									style="border-color: {pagination.page === pagina
										? 'var(--emerald-500)'
										: 'var(--border-default)'}; background-color: {pagination.page === pagina
										? 'var(--emerald-500)'
										: 'white'}; color: {pagination.page === pagina
										? 'white'
										: 'var(--text-secondary)'}; font-weight: {pagination.page === pagina
										? '600'
										: '500'};">{pagina}</button
								>
							{/each}
							<button
								on:click={() => irPagina(pagination.page + 1)}
								disabled={pagination.page === pagination.pages || isLoading}
								class="apple-transition rounded-lg border p-1.5"
								style="border-color: var(--border-default); color: {pagination.page ===
									pagination.pages || isLoading
									? 'var(--text-very-muted)'
									: 'var(--text-secondary)'}; background-color: {pagination.page ===
									pagination.pages || isLoading
									? 'var(--bg-base)'
									: 'white'}; cursor: {pagination.page === pagination.pages || isLoading
									? 'not-allowed'
									: 'pointer'};"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg
								>
							</button>
							<button
								on:click={() => irPagina(pagination.pages)}
								disabled={pagination.page === pagination.pages || isLoading}
								class="apple-transition rounded-lg border p-1.5"
								style="border-color: var(--border-default); color: {pagination.page ===
									pagination.pages || isLoading
									? 'var(--text-very-muted)'
									: 'var(--text-secondary)'}; background-color: {pagination.page ===
									pagination.pages || isLoading
									? 'var(--bg-base)'
									: 'white'}; cursor: {pagination.page === pagination.pages || isLoading
									? 'not-allowed'
									: 'pointer'};"
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
										d="M13 5l7 7-7 7M5 5l7 7-7 7"
									/></svg
								>
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- ── Vista Tabla de días laborados con marcación de bonos ── -->
	{#if vistaTab === 'calendario'}
		<TablaDiasLaborados
			refreshKey={tablaRefreshKey}
			conductorIdInicial={urlConductorId || undefined}
			canManageBonos={canManageBonos}
		/>
	{/if}

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
						<button
							on:click={() => ejecutarAccionMasiva('ocultar')}
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
						<button
							on:click={() => ejecutarAccionMasiva('eliminar')}
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
					{:else if vistaActual === 'OCULTOS'}
						<button
							on:click={() => ejecutarAccionMasiva('mostrar')}
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
					{:else if vistaActual === 'PAPELERA'}
						<button
							on:click={() => ejecutarAccionMasiva('restaurar')}
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
				</div>
				<button
					on:click={() => {
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
			style="background: linear-gradient(135deg, rgba(15, 31, 26, 0.40), rgba(10, 20, 16, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
			aria-label="Cerrar modal"
			on:click={cerrarModalEliminar}
		></button>

		<div
			class="fixed inset-0 z-[100] flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
			on:keydown={(e) => e.key === 'Escape' && cerrarModalEliminar()}
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
						on:click={cerrarModalEliminar}
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
						on:click={cerrarModalEliminar}
						class="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
					>
						Cancelar
					</button>
					<button
						on:click={() => confirmarEliminarPermanente(true)}
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
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.glass {
		background: rgba(255, 255, 255, 0.7);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}
	.soft-shadow {
		box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
	}
	.emerald-glow:hover {
		box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
	}

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
