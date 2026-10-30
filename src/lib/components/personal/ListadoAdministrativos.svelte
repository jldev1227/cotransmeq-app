<script lang="ts">
	import { confirmar } from '$lib/stores/confirm';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { texto, opcion, numero, contarActivos, limpiar, firma } from '$lib/listing/filtros';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { coincide } from '$lib/listing/texto';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import ModalEditarUsuario from '$lib/components/usuarios/ModalEditarUsuario.svelte';
	import ModalPermisosModulos from '$lib/components/usuarios/ModalPermisosModulos.svelte';
	import ModalInvitarUsuario from '$lib/components/usuarios/ModalInvitarUsuario.svelte';
	import ModalNuevoUsuario from '$lib/components/usuarios/ModalNuevoUsuario.svelte';
	import { mascota } from '$lib/mascot';
	import {
		Ban,
		CircleCheck,
		Clock,
		Lock,
		MailPlus,
		Pencil,
		Power,
		RefreshCw,
		ShieldCheck,
		UserPlus,
		X
	} from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { usuariosAPI, type Usuario, hasBonosPlanilla } from '$lib/api/usuarios';
	import { sesionesAPI, type Sesion, type ActividadMovil } from '$lib/api/sesiones';
	import { apiClient } from '$lib/api/apiClient';
	import { authStore } from '$lib/stores/auth';
	import { AREA_LABELS, type Area } from '$lib/config/permissions';
	import { etiquetaVinculacion } from '$lib/config/personal';
	import { socketManager, socketUtils } from '$lib/socket';

	// ─── Estado unificado ────────────────────────────────────────────────
	let usuarios = $state<Usuario[]>([]);
	let loading = $state(true);
	/// Un fallo de carga se queda a la vista con «Reintentar». Antes solo
	/// saltaba un aviso y la lista se pintaba vacía, como si no hubiera nadie.
	let errorUsuarios = $state<string | null>(null);
	let onlineIds = $state(new Set<string>());
	/**
	 * Filtros de la página, y con ellos la URL.
	 *
	 * Esta ruta no tocaba `searchParams`: ni la búsqueda, ni el área, ni el
	 * estado, ni nada de la sección de sesiones. Recargar lo devolvía todo a
	 * cero y no había forma de enlazar «los usuarios de operaciones que están
	 * inactivos», que es justo lo que se comparte por chat.
	 *
	 * Todo se filtra en cliente: la lista de usuarios llega entera.
	 */
	type EstadoUsuario = 'TODOS' | 'ACTIVOS' | 'INACTIVOS' | 'EN_LINEA';
	type FiltroSesion = 'activas' | 'cerradas' | 'todas';
	type FiltroBonos = 'TODOS' | 'CON_PERMISO' | 'SIN_PERMISO';
	type TabUsuarios = 'equipo' | 'sesiones' | 'app-movil' | 'invitaciones' | 'permisos';
	type FiltroMovil = 'todos' | 'en_linea' | 'historial';

	/// Una sola cabecera para las cuatro pestañas, como en liquidaciones: la
	/// descripción y los conteos cambian con la pestaña abierta.
	const DESCRIPCION_TAB: Record<TabUsuarios, string> = {
		equipo: 'Quién entra a la plataforma, con qué áreas y quién está conectado ahora.',
		'app-movil': 'Accesos a la app de gestión y de conductores, con presencia en tiempo real.',
		sesiones:
			'Sesiones abiertas y cerradas de cada persona; las activas se pueden cerrar desde aquí.',
		invitaciones: 'Invitaciones enviadas por correo y en qué quedó cada una.',
		permisos: 'Permisos individuales que no dependen del área, como registrar bonos de planilla.'
	};

	const DEFS = {
		/// La pestaña es un filtro más: sin ella en la URL, «mándame las
		/// sesiones cerradas de Fulano» no se puede enlazar.
		tab: opcion<TabUsuarios>('equipo'),
		q: texto(),
		area: texto(),
		estado: opcion<EstadoUsuario>('TODOS'),
		/// Sesiones
		sesion: opcion<FiltroSesion>('activas'),
		qSesion: texto(),
		usuario: texto(),
		paginaSesiones: numero(1),
		qMovil: texto(),
		estadoMovil: opcion<FiltroMovil>('todos'),
		paginaMovil: numero(1),
		/// Permiso de bonos
		qBonos: texto(),
		bonos: opcion<FiltroBonos>('TODOS')
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	/// `leerInicial()` y no `leerDeParams(page.url)`: durante la hidratación
	/// `page` puede no reflejar todavía la URL con la que se abrió la pestaña,
	/// y el efecto que escribe la URL borraría los filtros del enlace antes de
	/// que nadie los leyera.
	let filtros = $state(estadoUrl.leerInicial());

	/// Los filtros a la URL. `escribir` no navega si ya dice lo mismo, que es lo
	/// que impide que este efecto se realimente.
	$effect(() => {
		void firma(DEFS, filtros);
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	/**
	 * Cambia de pestaña.
	 *
	 * Limpia la selección de bonos al salir de Permisos: la barra de acciones
	 * masivas mostraría «3 seleccionados» sobre una lista que ya no se ve, y
	 * al volver operaría sobre gente que el usuario ya no recuerda haber
	 * marcado.
	 */
	function cambiarTab(tab: TabUsuarios) {
		filtros.tab = tab;
		if (tab !== 'permisos') bonosSeleccionados = new Set();
	}

	/// Los filtros que NO son de la pestaña Equipo: los de sesiones y bonos
	/// tienen su propio control y no cuentan ni se limpian desde aquí.
	const AJENOS_A_EQUIPO = [
		'tab',
		'sesion',
		'qSesion',
		'usuario',
		'paginaSesiones',
		'qMovil',
		'estadoMovil',
		'paginaMovil',
		'qBonos',
		'bonos'
	] as const;

	/// Cuántos filtros de usuarios hay puestos.
	const filtrosActivos = $derived(contarActivos(DEFS, filtros, [...AJENOS_A_EQUIPO]));

	function limpiarFiltrosEquipo() {
		filtros = limpiar(DEFS, filtros, [...AJENOS_A_EQUIPO]);
	}

	const filteredUsuarios = $derived(
		usuarios.filter((u) => {
			/// `coincide` exige todas las palabras en cualquiera de los campos y pasa
			/// por alto las tildes: «julian lopez» encuentra a Julián López, que con
			/// el `includes` literal anterior no aparecía.
			if (!coincide(filtros.q, [u.nombre, u.correo, u.cargo])) return false;
			if (filtros.area && !(Array.isArray(u.area) && u.area.includes(filtros.area))) return false;
			if (filtros.estado === 'ACTIVOS' && u.activo === false) return false;
			if (filtros.estado === 'INACTIVOS' && u.activo !== false) return false;
			if (filtros.estado === 'EN_LINEA' && !onlineIds.has(u.id)) return false;
			return true;
		})
	);

	const currentUser = $derived($authStore.user);
	const enLineaCount = $derived(usuarios.filter((u) => onlineIds.has(u.id)).length);
	const activosCount = $derived(usuarios.filter((u) => u.activo !== false).length);
	const inactivosCount = $derived(usuarios.filter((u) => u.activo === false).length);

	// ─── Sesiones ────────────────────────────────────────────────────────
	let sesiones = $state<Sesion[]>([]);
	let loadingSesiones = $state(true);
	let errorSesiones = $state<string | null>(null);

	/**
	 * Cuántas sesiones se traen y cuántas se pintan de golpe.
	 *
	 * `GET /sesiones` acepta `limit` pero ni `page` ni `skip`, así que el
	 * recorte se hace aquí. El tope importa: los contadores («N activas») se
	 * calculan sobre lo traído, de modo que si el backend devuelve justo
	 * `LIMITE_SESIONES` la cifra puede quedarse corta — por eso se avisa en
	 * pantalla en vez de dejar que mienta en silencio.
	 */
	const LIMITE_SESIONES = 200;
	const POR_PAGINA_SESIONES = 20;

	const sesionesVisibles = $derived(
		sesiones.filter((s) => {
			if (filtros.sesion === 'activas' && !s.is_active) return false;
			if (filtros.sesion === 'cerradas' && s.is_active) return false;
			if (filtros.usuario && s.usuario_id !== filtros.usuario) return false;
			if (!coincide(filtros.qSesion, [s.usuario?.nombre, s.usuario?.correo, s.ip])) return false;
			return true;
		})
	);
	const activasCount = $derived(sesiones.filter((s) => s.is_active).length);
	const sesionesTruncadas = $derived(sesiones.length >= LIMITE_SESIONES);

	const sesionesPaginadas = $derived(
		sesionesVisibles.slice(
			(filtros.paginaSesiones - 1) * POR_PAGINA_SESIONES,
			filtros.paginaSesiones * POR_PAGINA_SESIONES
		)
	);

	/// Volver a la primera página cuando cambia lo que se está filtrando.
	/// La clave arranca con los valores que traía la URL, no vacía: si no, la
	/// primera pasada los vería «cambiados» y borraría el `?paginaSesiones=3`
	/// del enlace que acaban de abrir.
	let claveSesiones = untrack(() => `${filtros.sesion}|${filtros.qSesion}|${filtros.usuario}`);
	$effect(() => {
		const clave = `${filtros.sesion}|${filtros.qSesion}|${filtros.usuario}`;
		if (clave === claveSesiones) return;
		claveSesiones = clave;
		filtros.paginaSesiones = 1;
	});

	/// Recorte al rango válido. Guardado por `loadingSesiones` y por la lista
	/// vacía: sin eso, un `?paginaSesiones=3` se recorta a 1 porque antes del
	/// primer dato el total de páginas vale 1.
	$effect(() => {
		if (loadingSesiones || sesiones.length === 0) return;
		const totalPaginas = Math.max(1, Math.ceil(sesionesVisibles.length / POR_PAGINA_SESIONES));
		if (filtros.paginaSesiones > totalPaginas) filtros.paginaSesiones = totalPaginas;
		if (filtros.paginaSesiones < 1) filtros.paginaSesiones = 1;
	});

	// ─── Actividad de la app móvil ───────────────────────────────────────
	let actividadMovil = $state<ActividadMovil[]>([]);
	let loadingMovil = $state(false);
	let errorMovil = $state<string | null>(null);
	function usuarioTieneAreaAdministracion() {
		const area = $authStore.user?.area;
		return Array.isArray(area) ? area.includes('administracion') : area === 'administracion';
	}
	const soloAdmin = $derived(usuarioTieneAreaAdministracion());
	const POR_PAGINA_MOVIL = 20;
	const actividadVisible = $derived(
		actividadMovil.filter((a) => {
			if (filtros.estadoMovil === 'en_linea' && !a.en_linea) return false;
			if (filtros.estadoMovil === 'historial' && a.en_linea) return false;
			return coincide(filtros.qMovil, [a.nombre, a.correo, a.kind, a.platform]);
		})
	);
	const actividadPaginada = $derived(
		actividadVisible.slice((filtros.paginaMovil - 1) * POR_PAGINA_MOVIL, filtros.paginaMovil * POR_PAGINA_MOVIL)
	);
	let claveMovil = untrack(() => `${filtros.estadoMovil}|${filtros.qMovil}`);
	$effect(() => {
		const clave = `${filtros.estadoMovil}|${filtros.qMovil}`;
		if (clave !== claveMovil) {
			claveMovil = clave;
			filtros.paginaMovil = 1;
		}
	});
	$effect(() => {
		if (!soloAdmin && filtros.tab === 'app-movil') filtros.tab = 'equipo';
	});
	$effect(() => {
		if (loadingMovil) return;
		const maxPagina = Math.max(1, Math.ceil(actividadVisible.length / POR_PAGINA_MOVIL));
		if (filtros.paginaMovil > maxPagina) filtros.paginaMovil = maxPagina;
		if (filtros.paginaMovil < 1) filtros.paginaMovil = 1;
	});
	let peticionMovil = 0;
	async function cargarActividadMovil() {
		if (!soloAdmin) return;
		const peticion = ++peticionMovil;
		try {
			loadingMovil = actividadMovil.length === 0;
			errorMovil = null;
			const filas = await sesionesAPI.actividadMovil();
			if (peticion === peticionMovil) actividadMovil = filas;
		} catch {
			if (peticion === peticionMovil) errorMovil = 'No se pudieron cargar los accesos móviles.';
		} finally {
			if (peticion === peticionMovil) loadingMovil = false;
		}
	}
	function onActividadMovil() {
		void cargarActividadMovil();
	}
	const COLUMNAS_MOVIL: ColumnDef<ActividadMovil, any>[] = [
		{ id: 'persona', header: 'Persona', enableSorting: false },
		{ id: 'tipo', header: 'Acceso', enableSorting: false, size: 140 },
		{ id: 'dispositivo', header: 'Dispositivo', enableSorting: false, size: 130 },
		{ id: 'actividad', header: 'Actividad', enableSorting: false, size: 220 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 140 }
	];

	// ─── Invitaciones ────────────────────────────────────────────────────
	interface Invitacion {
		id: string;
		correo: string;
		area: string[];
		cargo?: string | null;
		tipo_vinculacion?: string;
		estado: string;
		expires_at: string;
		created_at: string;
		invitado_por: { id: string; nombre: string };
	}
	let invitaciones = $state<Invitacion[]>([]);
	let loadingInv = $state(true);
	let errorInv = $state<string | null>(null);
	let modalInvAbierto = $state(false);

	const invitacionesPendientes = $derived(invitaciones.filter((i) => i.estado === 'pendiente'));

	// ─── Alta manual ─────────────────────────────────────────────────────
	// El formulario y sus reglas viven en `ModalNuevoUsuario`; aquí solo se
	// abre y se recarga la lista al terminar.
	let modalNuevoAbierto = $state(false);

	// ─── Modales CRUD ───────────────────────────────────────────────────
	let showEditModal = $state(false);
	let editUsuario = $state<Usuario | null>(null);

	let showConfirmModal = $state(false);
	let confirmUsuario = $state<Usuario | null>(null);
	let confirmAction = $state<'disable' | 'enable'>('disable');
	let savingToggle = $state(false);

	let showPermisosModal = $state(false);
	let permisosUsuario = $state<Usuario | null>(null);

	let detailUsuario = $state<Usuario | null>(null);
	let detailSesiones = $state<Sesion[]>([]);

	// ─── Carga inicial ───────────────────────────────────────────────────
	/// Función de baja; antes se usaba `off('usuario-deshabilitado')` sin
	/// handler, que da de baja también los listeners de otros módulos.
	let bajaDeshabilitado: (() => void) | undefined;
	let bajaReconectarMovil: (() => void) | undefined;

	onMount(async () => {
		if (soloAdmin) {
			socketUtils.on('mobile-presence:changed', onActividadMovil);
			bajaReconectarMovil = socketUtils.onReconnect(onActividadMovil);
		}
		await Promise.all([cargarUsuarios(), cargarSesiones(), cargarInvitaciones(), ...(soloAdmin ? [cargarActividadMovil()] : [])]);
		const user = $authStore.user;
		if (user?.id) socketUtils.emit('join-dashboard', user.id);
		socketUtils.on('usuarios-online', onOnline);
		bajaDeshabilitado = socketManager.on('usuario-deshabilitado', (data: any) => {
			if (data?.usuarioId === currentUser?.id) {
				toast.error('Tu cuenta ha sido deshabilitada');
				setTimeout(() => authStore.logout(), 1500);
			}
		});
	});

	onDestroy(() => {
		socketUtils.emit('leave-dashboard');
		socketUtils.off('usuarios-online', onOnline);
		socketUtils.off('mobile-presence:changed', onActividadMovil);
		bajaReconectarMovil?.();
		bajaDeshabilitado?.();
	});

	function onOnline(ids: string[]) {
		onlineIds = new Set(ids);
	}

	async function cargarUsuarios() {
		try {
			loading = true;
			errorUsuarios = null;
			usuarios = await usuariosAPI.listar();
		} catch {
			errorUsuarios = 'No se pudo cargar la lista de usuarios.';
			toast.error('Error al cargar la lista de usuarios');
		} finally {
			loading = false;
		}
	}

	// ─── Helpers de UI ──────────────────────────────────────────────────
	function initials(name: string): string {
		if (!name) return '?';
		const parts = name.trim().split(/\s+/);
		if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	const COLUMNAS_EQUIPO: ColumnDef<Usuario, any>[] = [
		{ id: 'usuario', header: 'Usuario', accessorKey: 'nombre', enableSorting: false },
		{ id: 'areas', header: 'Áreas', enableSorting: false, size: 200 },
		{ id: 'vinculacion', header: 'Vinculación', enableSorting: false, size: 170 },
		{ id: 'cargo', header: 'Cargo', enableSorting: false, size: 170 },
		{ id: 'acceso', header: 'Último acceso', enableSorting: false, size: 170 },
		{ id: 'habilitado', header: 'Habilitado', enableSorting: false, size: 110 },
		{ id: 'acciones', header: '', enableSorting: false, size: 130 }
	];

	/// Una sesión por fila. Sin `accessorKey`: todas las celdas las pinta el
	/// snippet y `TablaLista` no intenta leer un valor plano.
	const COLUMNAS_SESIONES: ColumnDef<Sesion, any>[] = [
		{ id: 'usuario', header: 'Usuario', enableSorting: false },
		{ id: 'area', header: 'Área', enableSorting: false, size: 150 },
		{ id: 'dispositivo', header: 'Dispositivo', enableSorting: false, size: 170 },
		{ id: 'actividad', header: 'Actividad', enableSorting: false, size: 230 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 150 },
		{ id: 'acciones', header: '', enableSorting: false, size: 64 }
	];

	const COLUMNAS_INVITACIONES: ColumnDef<Invitacion, any>[] = [
		{ id: 'correo', header: 'Invitado', enableSorting: false },
		{ id: 'areas', header: 'Áreas', enableSorting: false, size: 220 },
		{ id: 'vinculacion', header: 'Vinculación', enableSorting: false, size: 170 },
		{ id: 'enviada', header: 'Enviada', enableSorting: false, size: 200 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 130 },
		{ id: 'acciones', header: '', enableSorting: false, size: 100 }
	];

	const COLUMNAS_BONOS: ColumnDef<Usuario, any>[] = [
		{ id: 'usuario', header: 'Usuario', enableSorting: false },
		{ id: 'cargo', header: 'Cargo', enableSorting: false, size: 220 },
		{ id: 'permiso', header: 'Bonos de planilla', enableSorting: false, size: 170 }
	];

	const STATUS_COLOR = { online: '#16a34a', offline: '#94a3b8', inactive: '#b42318' } as const;

	/// Estado de una invitación: punto y palabra, como el resto de estados de
	/// las listas. Los colores son de semáforo (literales), no de la marca.
	const ESTADO_INV: Record<string, { etiqueta: string; color: string; apagado?: boolean }> = {
		pendiente: { etiqueta: 'Pendiente', color: '#d97706' },
		aceptada: { etiqueta: 'Aceptada', color: STATUS_COLOR.online },
		expirada: { etiqueta: 'Expirada', color: '#dc2626' },
		revocada: { etiqueta: 'Revocada', color: STATUS_COLOR.offline, apagado: true },
		reemplazada: { etiqueta: 'Reemplazada', color: STATUS_COLOR.offline, apagado: true }
	};

	function estadoInv(estado: string) {
		return (
			ESTADO_INV[estado] ?? {
				etiqueta: estado ? estado.charAt(0).toUpperCase() + estado.slice(1) : 'Sin estado',
				color: STATUS_COLOR.offline,
				apagado: true
			}
		);
	}

	function statusOf(u: Usuario): 'online' | 'inactive' | 'offline' {
		if (u.activo === false) return 'inactive';
		if (onlineIds.has(u.id)) return 'online';
		return 'offline';
	}

	function lastAccess(u: Usuario): string {
		if (!u.ultimo_acceso) return 'Sin acceso';
		const d = new Date(u.ultimo_acceso);
		const diff = Date.now() - d.getTime();
		const min = Math.floor(diff / 60000);
		if (min < 1) return 'Ahora';
		if (min < 60) return `Hace ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `Hace ${h} h`;
		const days = Math.floor(h / 24);
		if (days < 7) return `Hace ${days} d`;
		return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function parseBrowser(ua: string | null): string {
		if (!ua) return 'Desconocido';
		if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
		if (ua.includes('Firefox')) return 'Firefox';
		if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
		if (ua.includes('Edg')) return 'Edge';
		return 'Otro';
	}

	function parseOS(ua: string | null): string {
		if (!ua) return '';
		if (ua.includes('Windows')) return 'Windows';
		if (ua.includes('Mac')) return 'macOS';
		if (ua.includes('Linux')) return 'Linux';
		if (ua.includes('Android')) return 'Android';
		if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
		return '';
	}

	function formatDate(d: string | null | undefined): string {
		if (!d) return '—';
		return new Date(d).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// ─── Cabecera: conteos y filtros a la vista ─────────────────────────
	/// Los conteos de cada pestaña van en la cabecera y filtran al pulsarlos;
	/// antes eran los contadores de los chips de cada sección. Cuentan sobre
	/// todo lo cargado, no sobre lo filtrado: son el estado del equipo.
	const conteos = $derived.by(() => {
		switch (filtros.tab) {
			case 'equipo':
				return [
					{ clave: 'TODOS', etiqueta: 'Total', valor: usuarios.length },
					{
						clave: 'EN_LINEA',
						etiqueta: 'En línea',
						valor: enLineaCount,
						color: STATUS_COLOR.online
					},
					{ clave: 'ACTIVOS', etiqueta: 'Activos', valor: activosCount },
					{
						clave: 'INACTIVOS',
						etiqueta: 'Inactivos',
						valor: inactivosCount,
						color: STATUS_COLOR.inactive
					}
				];
			case 'sesiones':
				return [
					{ clave: 'todas', etiqueta: 'Total', valor: sesiones.length },
					{
						clave: 'activas',
						etiqueta: 'Activas',
						valor: activasCount,
						color: STATUS_COLOR.online
					},
					{
						clave: 'cerradas',
						etiqueta: 'Cerradas',
						valor: sesiones.length - activasCount,
						color: STATUS_COLOR.offline
					}
				];
			case 'app-movil':
				return soloAdmin
					? [
						{ clave: 'todos', etiqueta: 'Con acceso', valor: actividadMovil.length },
						{ clave: 'en_linea', etiqueta: 'En línea', valor: actividadMovil.filter((a) => a.en_linea).length, color: STATUS_COLOR.online },
						{ clave: 'historial', etiqueta: 'Fuera de línea', valor: actividadMovil.filter((a) => !a.en_linea).length, color: STATUS_COLOR.offline }
					]
					: [];
			case 'invitaciones':
				return [
					{ clave: 'todas', etiqueta: 'Total', valor: invitaciones.length },
					...Object.entries(ESTADO_INV)
						.map(([clave, e]) => ({
							clave,
							etiqueta: e.etiqueta + 's',
							valor: invitaciones.filter((i) => i.estado === clave).length,
							color: e.color
						}))
						/// Las pendientes siempre: son las que piden hacer algo.
						.filter((c) => c.valor > 0 || c.clave === 'pendiente')
				];
			case 'permisos':
				return isAdminUser
					? [
							{ clave: 'TODOS', etiqueta: 'Total equipo', valor: usuarios.length },
							{
								clave: 'CON_PERMISO',
								etiqueta: 'Con permiso',
								valor: totalConPermiso,
								color: STATUS_COLOR.online
							},
							{
								clave: 'SIN_PERMISO',
								etiqueta: 'Sin permiso',
								valor: totalSinPermiso,
								color: STATUS_COLOR.offline
							}
						]
					: [];
		}
	});

	const conteoActivo = $derived(
		filtros.tab === 'equipo'
			? filtros.estado === 'TODOS'
				? null
				: filtros.estado
			: filtros.tab === 'sesiones'
				? filtros.sesion
				: filtros.tab === 'app-movil'
					? filtros.estadoMovil
				: filtros.tab === 'permisos'
					? filtros.bonos === 'TODOS'
						? null
						: filtros.bonos
					: null
	);

	/// Pulsar un conteo filtra por él; pulsar otra vez el puesto lo quita.
	/// Invitaciones no tiene filtro de estado, así que allí no son botones.
	function elegirConteo(clave: string) {
		if (filtros.tab === 'equipo') {
			filtros.estado = (filtros.estado === clave ? 'TODOS' : clave) as EstadoUsuario;
		} else if (filtros.tab === 'sesiones') {
			filtros.sesion = clave as FiltroSesion;
		} else if (filtros.tab === 'app-movil') {
			filtros.estadoMovil = clave as FiltroMovil;
		} else if (filtros.tab === 'permisos') {
			filtros.bonos = (filtros.bonos === clave ? 'TODOS' : clave) as FiltroBonos;
		}
	}

	const SEGMENTOS_ESTADO = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		{ valor: 'EN_LINEA', etiqueta: 'En línea', punto: STATUS_COLOR.online },
		{ valor: 'ACTIVOS', etiqueta: 'Activos' },
		{ valor: 'INACTIVOS', etiqueta: 'Inactivos', punto: STATUS_COLOR.inactive }
	];
	const SEGMENTOS_SESION = [
		{ valor: 'activas', etiqueta: 'Activas', punto: STATUS_COLOR.online },
		{ valor: 'cerradas', etiqueta: 'Cerradas', punto: STATUS_COLOR.offline },
		{ valor: 'todas', etiqueta: 'Todas' }
	];
	const SEGMENTOS_BONOS = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		{ valor: 'CON_PERMISO', etiqueta: 'Con permiso', punto: STATUS_COLOR.online },
		{ valor: 'SIN_PERMISO', etiqueta: 'Sin permiso' }
	];

	// ─── Gestión usuarios ───────────────────────────────────────────────
	function abrirEditModal(usuario: Usuario) {
		editUsuario = usuario;
		showEditModal = true;
	}

	/// El usuario se conserva al cerrar: el modal anima la salida con su
	/// contenido todavía a la vista.
	function cerrarEditModal() {
		showEditModal = false;
	}

	function alGuardarUsuario(actualizado: Usuario) {
		usuarios = usuarios.map((u) => (u.id === actualizado.id ? actualizado : u));
	}

	function abrirConfirmToggle(usuario: Usuario, e?: Event) {
		e?.stopPropagation();
		confirmUsuario = usuario;
		confirmAction = usuario.activo !== false ? 'disable' : 'enable';
		showConfirmModal = true;
	}
	function cerrarConfirmModal() {
		showConfirmModal = false;
	}

	async function confirmarToggle() {
		if (!confirmUsuario) return;
		savingToggle = true;
		const nuevoEstado = confirmAction === 'enable';
		const objetivo = confirmUsuario;
		try {
			const updated = await usuariosAPI.toggleActivo(objetivo.id, nuevoEstado);
			usuarios = usuarios.map((u) => (u.id === updated.id ? updated : u));
			if (!nuevoEstado) {
				// Cerrar las sesiones activas del usuario deshabilitado
				sesiones = sesiones.map((s) =>
					s.usuario_id === objetivo.id && s.is_active
						? { ...s, is_active: false, closed_at: new Date().toISOString() }
						: s
				);
			}
			toast.success(`${objetivo.nombre} ${nuevoEstado ? 'habilitado' : 'deshabilitado'}`);
			cerrarConfirmModal();
		} catch {
			toast.error('Error al cambiar estado del usuario');
		} finally {
			savingToggle = false;
		}
	}

	function abrirPermisos(usuario: Usuario) {
		permisosUsuario = usuario;
		showPermisosModal = true;
	}
	function cerrarPermisosModal() {
		showPermisosModal = false;
	}

	// ─── Detalle lateral de usuario ─────────────────────────────────────
	function verDetalleUsuario(usuario: Usuario) {
		detailUsuario = usuario;
		detailSesiones = sesiones.filter((s) => s.usuario_id === usuario.id);
		filtros.usuario = usuario.id;
		/// Otro usuario, otra lista: la página en la que estábamos no aplica.
		filtros.paginaSesiones = 1;
		filtros.tab = 'sesiones';
	}
	function limpiarFocoSesiones() {
		filtros.usuario = '';
		detailUsuario = null;
	}

	/// Filtros de la pestaña Sesiones que vacían la lista. El de estado
	/// (activas / cerradas) no entra: es la vista, no un filtro que estorbe.
	const hayFiltrosSesiones = $derived(!!filtros.qSesion.trim() || !!filtros.usuario);

	function limpiarFiltrosSesiones() {
		filtros.qSesion = '';
		limpiarFocoSesiones();
	}

	// ─── Sesiones ───────────────────────────────────────────────────────
	async function cargarSesiones() {
		try {
			loadingSesiones = true;
			errorSesiones = null;
			sesiones = await sesionesAPI.listar({ limit: LIMITE_SESIONES });
		} catch {
			errorSesiones = 'No se pudieron cargar las sesiones.';
			toast.error('Error al cargar las sesiones');
		} finally {
			loadingSesiones = false;
		}
	}

	async function cerrarSesion(id: string) {
		try {
			await sesionesAPI.cerrar(id);
			toast.success('Sesión cerrada');
			sesiones = sesiones.map((s) =>
				s.id === id ? { ...s, is_active: false, closed_at: new Date().toISOString() } : s
			);
			if (detailUsuario) detailSesiones = detailSesiones.filter((s) => s.id !== id);
		} catch {
			toast.error('Error al cerrar la sesión');
		}
	}

	async function cerrarTodasUsuario(usuarioId: string, nombre: string) {
		const ok = await confirmar({
			title: `¿Cerrar todas las sesiones de ${nombre}?`,
			message: 'Tendrá que volver a iniciar sesión en todos sus dispositivos.',
			tone: 'warning',
			confirmText: 'Cerrar sesiones'
		});
		if (!ok) return;
		try {
			await sesionesAPI.cerrarTodasUsuario(usuarioId);
			toast.success(`Sesiones de ${nombre} cerradas`);
			const now = new Date().toISOString();
			sesiones = sesiones.map((s) =>
				s.usuario_id === usuarioId && s.is_active ? { ...s, is_active: false, closed_at: now } : s
			);
			if (detailUsuario && detailUsuario.id === usuarioId) {
				detailSesiones = detailSesiones.map((s) => ({ ...s, is_active: false, closed_at: now }));
			}
		} catch {
			toast.error('Error al cerrar las sesiones');
		}
	}

	// ─── Invitaciones ───────────────────────────────────────────────────
	async function cargarInvitaciones() {
		try {
			loadingInv = true;
			errorInv = null;
			const res = await apiClient.get('/api/invitaciones');
			invitaciones = res.data;
		} catch {
			errorInv = 'No se pudieron cargar las invitaciones.';
			toast.error('Error cargando invitaciones');
		} finally {
			loadingInv = false;
		}
	}
	function abrirModalInv() {
		modalInvAbierto = true;
	}
	async function revocarInvitacion(id: string) {
		try {
			await apiClient.delete(`/api/invitaciones/${id}`);
			toast.success('Invitación revocada');
			cargarInvitaciones();
		} catch {
			toast.error('Error revocando invitación');
		}
	}
	async function reenviarInvitacion(inv: Invitacion) {
		try {
			await apiClient.post('/api/invitaciones', {
				correo: inv.correo,
				area: inv.area,
				cargo: inv.cargo,
				tipo_vinculacion: inv.tipo_vinculacion
			});
			toast.success(`Invitación reenviada a ${inv.correo}`);
			cargarInvitaciones();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'Error reenviando invitación');
		}
	}

	// ─── Alta manual ────────────────────────────────────────────────────
	function abrirModalNuevo() {
		modalNuevoAbierto = true;
	}

	// ─── Permiso individual: bonos de planilla ───────────────────
	// Estado: lista de usuarios con el permiso otorgado (o no)
	let bonosSeleccionados = $state(new Set<string>());
	let guardandoBonos = $state(false);

	const isAdminUser = $derived(usuarioTieneAreaAdministracion());

	const usuariosBonos = $derived(
		usuarios
			.filter((u) => {
				/// `coincide` en vez de tres `includes`: exige todas las palabras en
				/// cualquiera de los campos y pasa por alto las tildes, igual que
				/// el buscador de la pestaña Equipo.
				if (!coincide(filtros.qBonos, [u.nombre, u.correo, u.cargo])) return false;
				const has = hasBonosPlanilla(u);
				if (filtros.bonos === 'CON_PERMISO' && !has) return false;
				if (filtros.bonos === 'SIN_PERMISO' && has) return false;
				return true;
			})
			.sort((a, b) => {
				// Los que tienen permiso van primero
				const ha = hasBonosPlanilla(a) ? 1 : 0;
				const hb = hasBonosPlanilla(b) ? 1 : 0;
				if (hb !== ha) return hb - ha;
				return a.nombre.localeCompare(b.nombre);
			})
	);

	const totalConPermiso = $derived(usuarios.filter((u) => hasBonosPlanilla(u)).length);
	const totalSinPermiso = $derived(usuarios.length - totalConPermiso);

	/// Filtros de la pestaña Permisos que pueden dejar la lista vacía.
	const hayFiltrosBonos = $derived(!!filtros.qBonos.trim() || filtros.bonos !== 'TODOS');

	function limpiarFiltrosBonos() {
		filtros.qBonos = '';
		filtros.bonos = 'TODOS';
	}

	/**
	 * Selección de usuarios para el permiso de bonos.
	 *
	 * Se crea un `Set` nuevo en cada cambio en vez de mutar el que había y
	 * reasignárselo a sí mismo. Ese truco —`x = x`— funcionaba en Svelte 4,
	 * pero aquí asignar la MISMA referencia no repinta: las casillas y el
	 * contador «N seleccionados» se habrían quedado clavados.
	 *
	 * Pulsar la fila marca o desmarca, como pulsaba la tarjeta de antes; la
	 * casilla de la cabecera de la tabla marca todos los del filtro.
	 */
	function toggleSeleccionBonos(userId: string) {
		const siguiente = new Set(bonosSeleccionados);
		if (siguiente.has(userId)) siguiente.delete(userId);
		else siguiente.add(userId);
		bonosSeleccionados = siguiente;
	}

	/**
	 * «Seleccionar todos los del filtro», en la barra de acciones.
	 *
	 * Hace lo mismo que la casilla de la cabecera de la tabla, pero en el
	 * móvil la tabla pasa a tarjetas y la cabecera no se ve: sin esta casilla
	 * no habría forma de marcarlos todos. Con todos marcados, la desmarca
	 * entera; si no, deja marcados exactamente los del filtro.
	 */
	function seleccionarTodosBonos() {
		if (bonosSeleccionados.size === usuariosBonos.length) {
			bonosSeleccionados = new Set();
		} else {
			bonosSeleccionados = new Set(usuariosBonos.map((u) => u.id));
		}
	}

	async function setBonosPlanilla(granted: boolean) {
		// Si no hay selección, usamos el filtro actual (útil para
		// "otorgar a todos los del filtro" sin tener que marcar uno a uno)
		let ids: string[];
		if (bonosSeleccionados.size > 0) {
			ids = Array.from(bonosSeleccionados);
		} else {
			// Si no hay selección, operar sobre TODOS los usuarios que
			// actualmente coinciden con el filtro "opuesto": para no
			// "otorgar a todos" y "revocar a todos" al mismo tiempo.
			// Pedimos confirmación explícita.
			const ok = await confirmar({
				title: granted
					? `¿Otorgar el permiso a los ${usuariosBonos.length} usuarios?`
					: `¿Revocar el permiso a los ${usuariosBonos.length} usuarios?`,
				message: `No has seleccionado usuarios, así que se aplicará a TODOS los del filtro actual.`,
				tone: granted ? 'warning' : 'danger',
				confirmText: granted ? 'Otorgar a todos' : 'Revocar a todos'
			});
			if (!ok) return;
			ids = usuariosBonos.map((u) => u.id);
		}

		guardandoBonos = true;
		try {
			const res = await usuariosAPI.setBonosPlanilla(ids, granted);
			const updates: Usuario[] = res.updated || [];
			// Reflejar en el store local
			const updateMap = new Map(updates.map((u) => [u.id, u]));
			usuarios = usuarios.map((u) => updateMap.get(u.id) ?? u);
			toast.success(
				granted
					? `Permiso otorgado a ${updates.length} usuario${updates.length !== 1 ? 's' : ''}`
					: `Permiso revocado a ${updates.length} usuario${updates.length !== 1 ? 's' : ''}`
			);
			bonosSeleccionados = new Set();
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Error al actualizar el permiso';
			toast.error(msg);
		} finally {
			guardandoBonos = false;
		}
	}
</script>

<svelte:head><title>Equipo · Cotransmeq</title></svelte:head>

<!-- Carga y error de cada pestaña, dentro del mismo marco blanco que la tabla
     para que la página no salte al llegar los datos. -->
{#snippet bloqueCarga(mensaje: string)}
	<div class="usr-marco">
		<CargaMascota texto={mensaje} />
	</div>
{/snippet}

{#snippet bloqueError(mensaje: string, reintentar: () => void)}
	{@const img = mascota('advertencia')}
	<div class="usr-marco">
		<div class="dir-vacio" role="alert">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<h3>No se pudo cargar</h3>
			<p>{mensaje} Revisa la conexión e inténtalo de nuevo.</p>
			<button class="btn-secondary" onclick={reintentar}>Reintentar</button>
		</div>
	</div>
{/snippet}

<div class="dir-pagina usr-pagina" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, conteos de la pestaña y acciones ─────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Personas y accesos</h1>
			<p class="dir-desc">{DESCRIPCION_TAB[filtros.tab]}</p>
			{#if conteos.length > 0}
				<div class="dir-conteos">
					<ResumenConteos
						{conteos}
						activo={conteoActivo}
						onElegir={filtros.tab === 'invitaciones' ? undefined : elegirConteo}
					/>
				</div>
			{/if}
		</div>

		<div class="dir-cabecera-acciones">
			<button class="btn-secondary" onclick={abrirModalNuevo}>
				<UserPlus strokeWidth={2} aria-hidden="true" />
				Nuevo usuario
			</button>
			<button class="btn-primary" onclick={abrirModalInv}>
				<MailPlus strokeWidth={2} aria-hidden="true" />
				Invitar usuario
			</button>
		</div>
	</header>

	<!-- Las dos cifras que piden atención (sesiones activas, invitaciones
	     pendientes) van además en la pestaña: se ven sin entrar. -->
	<div in:fly={{ y: 12, duration: 400, delay: 60 }}>
		<TabsVista
			tabs={[
				{ id: 'equipo', label: 'Equipo' },
				{ id: 'sesiones', label: 'Sesiones', cuenta: activasCount || null },
				...(soloAdmin ? [{ id: 'app-movil', label: 'App móvil', cuenta: actividadMovil.filter((a) => a.en_linea).length || null }] : []),
				{
					id: 'invitaciones',
					label: 'Invitaciones',
					cuenta: invitacionesPendientes.length || null
				},
				{ id: 'permisos', label: 'Permisos' }
			]}
			activa={filtros.tab}
			etiqueta="Secciones de equipo"
			onCambiar={(t) => cambiarTab(t as TabUsuarios)}
		/>
	</div>

	{#if filtros.tab === 'equipo'}
		<section class="usr-seccion" in:fly={{ y: 8, duration: 300 }}>
			<div class="dir-filtros">
				<div class="dir-filtros-buscador">
					<BuscadorLista
						bind:valor={filtros.q}
						onBuscar={(termino) => (filtros.q = termino)}
						placeholder="Buscar por nombre, correo o cargo…"
						etiqueta="Buscar usuarios"
					/>
				</div>
				<SegmentosFiltro
					etiqueta="Estado"
					opciones={SEGMENTOS_ESTADO}
					valor={filtros.estado}
					onCambiar={(v) => (filtros.estado = v as EstadoUsuario)}
				/>
				<label class="usr-select">
					<span>Área</span>
					<select bind:value={filtros.area}>
						<option value="">Todas</option>
						{#each Object.entries(AREA_LABELS) as [key, label] (key)}
							<option value={key}>{label}</option>
						{/each}
					</select>
				</label>
				{#if filtrosActivos > 0}
					<button class="btn-secondary usr-btn-sm" onclick={limpiarFiltrosEquipo}>
						<X strokeWidth={2} aria-hidden="true" />
						Limpiar
					</button>
				{/if}
			</div>

			{#if loading}
				{@render bloqueCarga('Cargando equipo…')}
			{:else if errorUsuarios}
				{@render bloqueError(errorUsuarios, cargarUsuarios)}
			{:else}
				<div class="dir-lista">
					<TablaLista
						columnas={COLUMNAS_EQUIPO}
						datos={filteredUsuarios}
						claveFila={(u) => u.id}
						onFila={(u) => verDetalleUsuario(u)}
						etiqueta="Miembros del equipo"
					>
						{#snippet celda({ columnaId, fila: u })}
							{@const status = statusOf(u)}
							{#if columnaId === 'usuario'}
								<div class="flex items-center gap-2">
									<CeldaIdentidad
										titulo={u.nombre}
										subtitulo={u.correo}
										iniciales={initials(u.nombre)}
										punto={STATUS_COLOR[status]}
										tono={status === 'inactive' ? '#94a3b8' : undefined}
									/>
									{#if u.id === currentUser?.id}<span class="badge-self">tú</span>{/if}
								</div>
							{:else if columnaId === 'areas'}
								{#if u.area && u.area.length}
									<div class="dir-celda">
										<span>{u.area.map((a) => AREA_LABELS[a as Area] ?? a).join(' · ')}</span>
									</div>
								{:else}
									<span class="dir-nulo">Sin área asignada</span>
								{/if}
							{:else if columnaId === 'vinculacion'}
								<span class="dir-celda">{etiquetaVinculacion(u.tipo_vinculacion)}</span>
							{:else if columnaId === 'cargo'}
								{#if u.cargo}
									<span class="dir-celda">{u.cargo}</span>
								{:else}
									<span class="dir-nulo">—</span>
								{/if}
							{:else if columnaId === 'acceso'}
								<div class="dir-celda dir-celda--fecha">
									<span style="color: {status === 'online' ? 'var(--emerald-700)' : 'inherit'}">
										{status === 'online' ? 'En línea' : lastAccess(u)}
									</span>
									{#if status === 'online'}<small>{lastAccess(u)}</small>{/if}
								</div>
							{:else if columnaId === 'habilitado'}
								<!-- El interruptor no abre el detalle: solo cambia el estado. -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
									<button
										type="button"
										class="user-status-toggle"
										class:user-status-toggle--on={u.activo !== false}
										class:user-status-toggle--off={u.activo === false}
										role="switch"
										aria-checked={u.activo !== false}
										title={u.activo !== false ? 'Deshabilitar usuario' : 'Habilitar usuario'}
										aria-label={u.activo !== false
											? `Deshabilitar a ${u.nombre}`
											: `Habilitar a ${u.nombre}`}
										disabled={u.id === currentUser?.id}
										onclick={(e) => abrirConfirmToggle(u, e)}
									>
										<span class="user-status-knob"></span>
									</button>
								</div>
							{:else if columnaId === 'acciones'}
								<AccionesFila
									acciones={[
										{
											id: 'sesiones',
											etiqueta: 'Ver sesiones',
											icono: Clock,
											onClick: () => verDetalleUsuario(u)
										},
										{
											id: 'editar',
											etiqueta: 'Editar',
											icono: Pencil,
											onClick: () => abrirEditModal(u)
										},
										{
											id: 'permisos',
											etiqueta: 'Permisos',
											icono: ShieldCheck,
											onClick: () => abrirPermisos(u)
										}
									]}
								/>
							{/if}
						{/snippet}

						{#snippet vacio()}
							{@const img = mascota('vacio')}
							<div class="dir-vacio">
								<img src={img.src} alt={img.alt} width="418" height="418" />
								<h3>No hay usuarios</h3>
								<p>
									{filtrosActivos > 0
										? 'No se encontraron usuarios con los filtros aplicados.'
										: 'Invita al primer miembro del equipo o créale la cuenta a mano.'}
								</p>
								{#if filtrosActivos > 0}
									<button class="btn-secondary" onclick={limpiarFiltrosEquipo}>
										Limpiar filtros
									</button>
								{:else}
									<button class="btn-primary" onclick={abrirModalInv}>
										<MailPlus strokeWidth={2} aria-hidden="true" />
										Invitar usuario
									</button>
								{/if}
							</div>
						{/snippet}
					</TablaLista>
				</div>
			{/if}
		</section>
	{/if}

	{#if filtros.tab === 'sesiones'}
		<section class="usr-seccion" in:fly={{ y: 8, duration: 300 }}>
			{#if detailUsuario}
				<div class="foco-usuario">
					<p>
						Sesiones de <strong>{detailUsuario.nombre}</strong>.
						<button class="usr-enlace" onclick={limpiarFocoSesiones}>Ver todas</button>
					</p>
					<button
						class="btn-secondary usr-btn-sm"
						onclick={() => cerrarTodasUsuario(detailUsuario!.id, detailUsuario!.nombre)}
						disabled={!detailSesiones.some((s) => s.is_active)}
					>
						<Ban strokeWidth={2} aria-hidden="true" />
						Cerrar todas
					</button>
				</div>
			{/if}

			{#if sesionesTruncadas}
				<p class="tab-nota tab-nota--aviso">
					Se muestran las {LIMITE_SESIONES} sesiones más recientes. Los contadores se calculan sobre ellas,
					así que puede haber más de las que se ven.
				</p>
			{/if}

			<div class="dir-filtros">
				<div class="dir-filtros-buscador">
					<BuscadorLista
						bind:valor={filtros.qSesion}
						onBuscar={(termino) => (filtros.qSesion = termino)}
						placeholder="Buscar por usuario, correo o IP…"
						etiqueta="Buscar sesiones"
					/>
				</div>
				<SegmentosFiltro
					etiqueta="Sesiones"
					opciones={SEGMENTOS_SESION}
					valor={filtros.sesion}
					onCambiar={(v) => (filtros.sesion = v as FiltroSesion)}
				/>
			</div>

			{#if loadingSesiones}
				{@render bloqueCarga('Cargando sesiones…')}
			{:else if errorSesiones}
				{@render bloqueError(errorSesiones, cargarSesiones)}
			{:else}
				<div class="dir-lista">
					<TablaLista
						columnas={COLUMNAS_SESIONES}
						datos={sesionesPaginadas}
						claveFila={(s) => s.id}
						etiqueta="Sesiones de usuarios"
					>
						{#snippet celda({ columnaId, fila: s })}
							{#if columnaId === 'usuario'}
								<CeldaIdentidad
									titulo={s.usuario?.nombre || '—'}
									subtitulo={s.usuario?.correo ?? undefined}
									iniciales={initials(s.usuario?.nombre || '?')}
									punto={s.is_active ? STATUS_COLOR.online : STATUS_COLOR.offline}
								/>
							{:else if columnaId === 'area'}
								{#if s.usuario?.area}
									<span class="dir-celda"
										>{AREA_LABELS[s.usuario.area as Area] ?? s.usuario.area}</span
									>
								{:else}
									<span class="dir-nulo">—</span>
								{/if}
							{:else if columnaId === 'dispositivo'}
								<div class="dir-celda">
									<span>
										{parseBrowser(s.user_agent)}{#if parseOS(s.user_agent)}
											· {parseOS(s.user_agent)}{/if}
									</span>
									{#if s.ip}<small class="usr-mono">{s.ip}</small>{/if}
								</div>
							{:else if columnaId === 'actividad'}
								<!-- Duración y expiración las mostraba la tabla de
								     `/dashboard/sesiones`, que ahora redirige aquí. -->
								<div class="dir-celda dir-celda--fecha">
									{#if s.is_active}
										<span>Inicio: {formatDate(s.created_at)}</span>
										<small>Última act.: {formatDate(s.last_activity)}</small>
										<small>Expira: {formatDate(s.token_expiry)}</small>
									{:else if s.closed_at}
										<span>Cerrada: {formatDate(s.closed_at)}</span>
									{:else}
										<span class="dir-nulo">—</span>
									{/if}
								</div>
							{:else if columnaId === 'estado'}
								<div class="dir-celda">
									<EstadoPunto
										etiqueta={s.is_active ? 'Activa' : 'Cerrada'}
										color={s.is_active ? STATUS_COLOR.online : STATUS_COLOR.offline}
										apagado={!s.is_active}
									/>
									<small>Duración: {s.duracion_texto || '—'}</small>
									{#if s.remember_me}
										<small title="Sesión persistente (recordar sesión)">Persistente</small>
									{/if}
								</div>
							{:else if columnaId === 'acciones'}
								<AccionesFila
									acciones={[
										{
											id: 'cerrar',
											etiqueta: `Cerrar sesión de ${s.usuario?.nombre ?? 'este usuario'}`,
											icono: Power,
											peligrosa: true,
											oculta: !s.is_active,
											onClick: () => cerrarSesion(s.id)
										}
									]}
								/>
							{/if}
						{/snippet}

						{#snippet vacio()}
							{@const img = mascota('vacio')}
							<div class="dir-vacio">
								<img src={img.src} alt={img.alt} width="418" height="418" />
								<h3>Sin sesiones</h3>
								<p>
									{filtros.sesion === 'activas' && !hayFiltrosSesiones
										? 'No hay sesiones activas en este momento.'
										: 'No hay sesiones que coincidan con los filtros.'}
								</p>
								{#if hayFiltrosSesiones}
									<button class="btn-secondary" onclick={limpiarFiltrosSesiones}>
										Limpiar filtros
									</button>
								{/if}
							</div>
						{/snippet}
					</TablaLista>
				</div>

				{#if sesionesVisibles.length > 0}
					<PaginadorLista
						pagina={filtros.paginaSesiones}
						total={sesionesVisibles.length}
						porPagina={POR_PAGINA_SESIONES}
						onCambiar={(p) => (filtros.paginaSesiones = p)}
						cargando={loadingSesiones}
						nombreItems="sesiones"
					/>
				{/if}
			{/if}
		</section>
	{/if}

	{#if filtros.tab === 'app-movil' && soloAdmin}
		<section class="usr-seccion" in:fly={{ y: 8, duration: 300 }}>
			<div class="dir-filtros">
				<div class="dir-filtros-buscador">
					<BuscadorLista
						bind:valor={filtros.qMovil}
						onBuscar={(termino) => (filtros.qMovil = termino)}
						placeholder="Buscar por nombre, correo o tipo de acceso…"
						etiqueta="Buscar accesos móviles"
					/>
				</div>
				<SegmentosFiltro
					etiqueta="Presencia móvil"
					opciones={[
						{ valor: 'todos', etiqueta: 'Todos' },
						{ valor: 'en_linea', etiqueta: 'En línea', punto: STATUS_COLOR.online },
						{ valor: 'historial', etiqueta: 'Fuera de línea' }
					]}
					valor={filtros.estadoMovil}
					onCambiar={(v) => (filtros.estadoMovil = v as FiltroMovil)}
				/>
				<button class="btn-secondary usr-btn-sm" onclick={cargarActividadMovil} aria-label="Actualizar accesos móviles">
					<RefreshCw size={16} strokeWidth={2} aria-hidden="true" /> Actualizar
				</button>
			</div>
			<p class="tab-nota">En línea significa que la app está abierta y conectada. Último acceso indica la conexión móvil más reciente.</p>
			{#if loadingMovil}
				{@render bloqueCarga('Cargando accesos móviles…')}
			{:else if errorMovil}
				{@render bloqueError(errorMovil, cargarActividadMovil)}
			{:else}
				<div class="dir-lista">
					<TablaLista columnas={COLUMNAS_MOVIL} datos={actividadPaginada} claveFila={(a) => `${a.kind}:${a.id}`} etiqueta="Accesos a la app móvil">
						{#snippet celda({ columnaId, fila: a })}
							{#if columnaId === 'persona'}
								<CeldaIdentidad titulo={a.nombre} subtitulo={a.correo ?? undefined} iniciales={initials(a.nombre)} punto={a.en_linea ? STATUS_COLOR.online : STATUS_COLOR.offline} />
							{:else if columnaId === 'tipo'}
								<span class="dir-celda">{a.kind === 'conductor' ? 'Conductor' : 'Gestión'}</span>
							{:else if columnaId === 'dispositivo'}
								<span class="dir-celda">{a.platform === 'ios' ? 'iOS' : a.platform === 'android' ? 'Android' : 'Desconocido'}</span>
							{:else if columnaId === 'actividad'}
								<div class="dir-celda dir-celda--fecha">
									<span>Último: {formatDate(a.last_seen_at)}</span>
									<small>Primero: {formatDate(a.first_seen_at)}</small>
									<small>Conexiones: {a.sessions_count}</small>
								</div>
							{:else if columnaId === 'estado'}
								<EstadoPunto etiqueta={a.en_linea ? 'En línea' : 'Fuera de línea'} color={a.en_linea ? STATUS_COLOR.online : STATUS_COLOR.offline} apagado={!a.en_linea} />
							{/if}
						{/snippet}
						{#snippet vacio()}
							<div class="dir-vacio"><h3>Sin accesos móviles</h3><p>No hay personas que coincidan con el filtro.</p></div>
						{/snippet}
					</TablaLista>
				</div>
				{#if actividadVisible.length > 0}
					<PaginadorLista pagina={filtros.paginaMovil} total={actividadVisible.length} porPagina={POR_PAGINA_MOVIL} onCambiar={(p) => (filtros.paginaMovil = p)} cargando={loadingMovil} nombreItems="personas" />
				{/if}
			{/if}
		</section>
	{/if}

	{#if filtros.tab === 'permisos'}
		<section class="usr-seccion" in:fly={{ y: 8, duration: 300 }}>
			<p class="tab-nota">
				Otorga o revoca el permiso individual <strong>bonos-planilla</strong> a uno o varios
				usuarios. Solo quienes tengan este permiso activo pueden marcar y guardar bonos
				(alimentación, día doble, día trabajado) en el tab
				<em>Recorridos</em> de la página de Conductores. Los demás usuarios siguen pudiendo ver los bonos
				ya otorgados (modo solo lectura).
			</p>

			{#if !isAdminUser}
				<div class="alert-block" role="note">
					<Lock size={20} strokeWidth={1.8} aria-hidden="true" />
					<p>
						Esta sección solo es visible para administradores. Si necesitas gestionar este permiso,
						contacta a un administrador del sistema.
					</p>
				</div>
			{:else}
				<div class="dir-filtros">
					<div class="dir-filtros-buscador">
						<BuscadorLista
							bind:valor={filtros.qBonos}
							onBuscar={(termino) => (filtros.qBonos = termino)}
							placeholder="Buscar usuario por nombre, correo o cargo…"
							etiqueta="Buscar usuarios por permiso de bonos"
						/>
					</div>
					<SegmentosFiltro
						etiqueta="Permiso"
						opciones={SEGMENTOS_BONOS}
						valor={filtros.bonos}
						onCambiar={(v) => (filtros.bonos = v as FiltroBonos)}
					/>
				</div>

				<!-- Acciones masivas: siempre a la vista. Se aplican a la selección
				     o, si no hay, a todos los del filtro (previa confirmación). -->
				<div class="usr-bonos-barra">
					<div class="usr-bonos-seleccion">
						<label class="usr-bonos-todos">
							<input
								type="checkbox"
								checked={bonosSeleccionados.size > 0 &&
									bonosSeleccionados.size === usuariosBonos.length}
								indeterminate={bonosSeleccionados.size > 0 &&
									bonosSeleccionados.size < usuariosBonos.length}
								disabled={guardandoBonos || usuariosBonos.length === 0}
								onchange={seleccionarTodosBonos}
							/>
							Seleccionar todos los del filtro
						</label>
						<p class="usr-bonos-texto">
							{#if bonosSeleccionados.size > 0}
								<strong>
									{bonosSeleccionados.size} seleccionado{bonosSeleccionados.size !== 1 ? 's' : ''}
								</strong>
								·
								<button
									class="usr-enlace"
									disabled={guardandoBonos}
									onclick={() => (bonosSeleccionados = new Set())}
								>
									Limpiar selección
								</button>
							{:else}
								Marca usuarios en la lista o aplica el cambio a todos los del filtro.
							{/if}
						</p>
					</div>
					<div class="usr-bonos-acciones">
						<button
							type="button"
							class="btn-secondary usr-btn-sm usr-btn-revocar"
							disabled={guardandoBonos}
							onclick={() => setBonosPlanilla(false)}
						>
							<Ban strokeWidth={2} aria-hidden="true" />
							Revocar permiso
							{#if bonosSeleccionados.size > 0}
								<span class="usr-btn-cuenta">({bonosSeleccionados.size})</span>
							{:else if usuariosBonos.length > 0}
								<span class="usr-btn-cuenta">({usuariosBonos.length} del filtro)</span>
							{/if}
						</button>
						<button
							type="button"
							class="btn-primary usr-btn-sm"
							disabled={guardandoBonos}
							onclick={() => setBonosPlanilla(true)}
						>
							<CircleCheck strokeWidth={2} aria-hidden="true" />
							Otorgar permiso
							{#if bonosSeleccionados.size > 0}
								<span class="usr-btn-cuenta">({bonosSeleccionados.size})</span>
							{:else if usuariosBonos.length > 0}
								<span class="usr-btn-cuenta">({usuariosBonos.length} del filtro)</span>
							{/if}
						</button>
					</div>
				</div>

				{#if loading}
					{@render bloqueCarga('Cargando equipo…')}
				{:else if errorUsuarios}
					{@render bloqueError(errorUsuarios, cargarUsuarios)}
				{:else}
					<div class="dir-lista">
						<TablaLista
							columnas={COLUMNAS_BONOS}
							datos={usuariosBonos}
							claveFila={(u) => u.id}
							onFila={(u) => toggleSeleccionBonos(u.id)}
							etiqueta="Permiso de bonos de planilla por usuario"
							seleccion={bonosSeleccionados}
							onSeleccion={(ids) => (bonosSeleccionados = ids)}
						>
							{#snippet celda({ columnaId, fila: u })}
								{#if columnaId === 'usuario'}
									<div class="flex items-center gap-2">
										<CeldaIdentidad
											titulo={u.nombre}
											subtitulo={u.correo}
											iniciales={initials(u.nombre)}
											tono={u.activo === false ? '#94a3b8' : undefined}
										/>
										{#if u.id === currentUser?.id}<span class="badge-self">tú</span>{/if}
									</div>
								{:else if columnaId === 'cargo'}
									{#if u.cargo}
										<span class="dir-celda">{u.cargo}</span>
									{:else}
										<span class="dir-nulo">—</span>
									{/if}
								{:else if columnaId === 'permiso'}
									{@const tiene = hasBonosPlanilla(u)}
									<EstadoPunto
										etiqueta={tiene ? 'Con permiso' : 'Sin permiso'}
										color={tiene ? STATUS_COLOR.online : STATUS_COLOR.offline}
										apagado={!tiene}
									/>
								{/if}
							{/snippet}

							{#snippet vacio()}
								{@const img = mascota('vacio')}
								<div class="dir-vacio">
									<img src={img.src} alt={img.alt} width="418" height="418" />
									<h3>Sin usuarios</h3>
									<p>No hay usuarios que coincidan con los filtros.</p>
									{#if hayFiltrosBonos}
										<button class="btn-secondary" onclick={limpiarFiltrosBonos}>
											Limpiar filtros
										</button>
									{/if}
								</div>
							{/snippet}
						</TablaLista>
					</div>
				{/if}
			{/if}
		</section>
	{/if}

	{#if filtros.tab === 'invitaciones'}
		<section class="usr-seccion" in:fly={{ y: 8, duration: 300 }}>
			{#if loadingInv}
				{@render bloqueCarga('Cargando invitaciones…')}
			{:else if errorInv}
				{@render bloqueError(errorInv, cargarInvitaciones)}
			{:else}
				<div class="dir-lista">
					<TablaLista
						columnas={COLUMNAS_INVITACIONES}
						datos={invitaciones}
						claveFila={(inv) => inv.id}
						etiqueta="Invitaciones enviadas"
					>
						{#snippet celda({ columnaId, fila: inv })}
							{#if columnaId === 'correo'}
								<CeldaIdentidad
									titulo={inv.correo}
									subtitulo={inv.cargo ?? undefined}
									iniciales={initials(inv.correo)}
								/>
							{:else if columnaId === 'areas'}
								{#if inv.area?.length}
									<div class="dir-celda">
										<span>{inv.area.map((a) => AREA_LABELS[a as Area] ?? a).join(' · ')}</span>
									</div>
								{:else}
									<span class="dir-nulo">—</span>
								{/if}
							{:else if columnaId === 'vinculacion'}
								<span class="dir-celda">{etiquetaVinculacion(inv.tipo_vinculacion)}</span>
							{:else if columnaId === 'enviada'}
								<div class="dir-celda dir-celda--fecha">
									<span>{formatDate(inv.created_at)}</span>
									<small>por {inv.invitado_por?.nombre ?? '—'}</small>
								</div>
							{:else if columnaId === 'estado'}
								{@const e = estadoInv(inv.estado)}
								<EstadoPunto etiqueta={e.etiqueta} color={e.color} apagado={e.apagado} />
							{:else if columnaId === 'acciones'}
								<AccionesFila
									acciones={[
										{
											id: 'reenviar',
											etiqueta: 'Reenviar invitación',
											icono: RefreshCw,
											oculta: inv.estado !== 'pendiente',
											onClick: () => reenviarInvitacion(inv)
										},
										{
											id: 'revocar',
											etiqueta: 'Revocar invitación',
											icono: X,
											peligrosa: true,
											oculta: inv.estado !== 'pendiente',
											onClick: () => revocarInvitacion(inv.id)
										}
									]}
								/>
							{/if}
						{/snippet}

						{#snippet vacio()}
							{@const img = mascota('vacio')}
							<div class="dir-vacio">
								<img src={img.src} alt={img.alt} width="418" height="418" />
								<h3>Sin invitaciones enviadas</h3>
								<p>Invita a nuevos miembros por correo electrónico con sus áreas asignadas.</p>
								<button class="btn-primary" onclick={abrirModalInv}>
									<MailPlus strokeWidth={2} aria-hidden="true" />
									Enviar primera invitación
								</button>
							</div>
						{/snippet}
					</TablaLista>
				</div>
			{/if}
		</section>
	{/if}
</div>

<ModalEditarUsuario
	open={showEditModal}
	usuario={editUsuario}
	oncerrar={cerrarEditModal}
	onguardado={alGuardarUsuario}
/>

<!-- Habilitar / deshabilitar: la tarjeta de confirmación de la app, con
     su propio estado de carga. Sigue abierta hasta que responde el servidor,
     como el modal que reemplaza. -->
<ConfirmDialog
	open={showConfirmModal}
	tone={confirmAction === 'disable' ? 'danger' : 'success'}
	eyebrow={confirmAction === 'disable' ? 'DESHABILITAR ACCESO' : 'HABILITAR ACCESO'}
	title={confirmAction === 'disable' ? 'Deshabilitar usuario' : 'Habilitar usuario'}
	message={!confirmUsuario
		? ''
		: confirmAction === 'disable'
			? `¿Deshabilitar a ${confirmUsuario.nombre}? Se cerrarán todas sus sesiones activas y no podrá ingresar al sistema.`
			: `¿Habilitar nuevamente a ${confirmUsuario.nombre}? Volverá a tener acceso al sistema con sus permisos actuales.`}
	confirmText={confirmAction === 'disable' ? 'Sí, deshabilitar' : 'Sí, habilitar'}
	loading={savingToggle}
	loadingText={confirmAction === 'disable' ? 'Deshabilitando…' : 'Habilitando…'}
	onconfirm={confirmarToggle}
	oncancel={cerrarConfirmModal}
/>

<ModalPermisosModulos
	open={showPermisosModal}
	usuario={permisosUsuario}
	oncerrar={cerrarPermisosModal}
	onguardado={alGuardarUsuario}
/>

<ModalInvitarUsuario
	open={modalInvAbierto}
	oncerrar={() => (modalInvAbierto = false)}
	onenviada={cargarInvitaciones}
/>

<ModalNuevoUsuario
	open={modalNuevoAbierto}
	oncerrar={() => (modalNuevoAbierto = false)}
	oncreado={cargarUsuarios}
/>

<style>
	/* La página crece con su contenido: las listas no tienen scroll propio. */
	.usr-pagina {
		height: auto;
		min-height: 100%;
	}

	.usr-seccion {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Marco de la carga y del error: el mismo de `TablaLista`, para que el
	   cambio a la tabla no mueva nada. */
	.usr-marco {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 22px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}

	/* Desplegable con su etiqueta, como «Mes» en liquidaciones. */
	.usr-select {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.usr-select select {
		min-height: 40px;
		padding: 0.4rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 500;
	}

	/* Variante compacta de los botones globales, para barras de filtros. */
	.usr-btn-sm {
		min-height: 38px;
		padding: 0 0.85rem;
		border-radius: 12px;
		font-size: 0.78rem;
	}
	.usr-btn-cuenta {
		font-weight: 600;
		opacity: 0.85;
	}
	/* Revocar quita un permiso: rojo literal (semáforo), no el de la marca. */
	.usr-btn-revocar {
		color: #b42318;
		border-color: rgba(220, 38, 38, 0.3);
	}
	.usr-btn-revocar:hover:not(:disabled) {
		background: rgba(220, 38, 38, 0.06);
		border-color: #dc2626;
	}

	.usr-enlace {
		padding: 0.15rem 0.3rem;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--emerald-700);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	.usr-enlace:hover:not(:disabled) {
		background: var(--au-tint, #ddf7ea);
	}
	.usr-enlace:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.usr-mono {
		font-variant-numeric: tabular-nums;
	}

	.badge-self {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--emerald-800);
		background: var(--au-tint, #ddf7ea);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
	}

	/* Interruptor de habilitado en la lista del equipo. */
	.user-status-toggle {
		position: relative;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		width: 36px;
		height: 20px;
		padding: 0;
		background: #d1d5db;
		border: none;
		border-radius: 999px;
		cursor: pointer;
		transition: background 0.2s;
	}
	.user-status-toggle:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}
	.user-status-toggle:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.user-status-toggle--on {
		background: var(--accion);
	}
	.user-status-toggle--off {
		background: #d1d5db;
	}
	.user-status-knob {
		position: absolute;
		left: 2px;
		width: 16px;
		height: 16px;
		background: white;
		border-radius: 50%;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		transition: transform 0.2s;
	}
	.user-status-toggle--on .user-status-knob {
		transform: translateX(16px);
	}

	/* Nota de pestaña: es texto corrido, por eso sí lleva tope de ancho. */
	.tab-nota {
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--text-secondary);
		margin: 0;
		max-width: 44rem;
	}
	.tab-nota--aviso {
		padding: 0.6rem 0.85rem;
		border-radius: 12px;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.22);
		color: #92400e;
	}

	/* Barra de foco: aparece al llegar desde «ver sesiones» de una fila. */
	.foco-usuario {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0.85rem;
		border-radius: 14px;
		background: var(--au-tint, #ddf7ea);
		border: 1px solid var(--border-default);
	}
	.foco-usuario p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	/* Aviso de sección restringida: ámbar, es un semáforo. */
	.alert-block {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-radius: 14px;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.25);
		color: #92400e;
	}
	.alert-block :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.alert-block p {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	/* Acciones masivas del permiso de bonos. */
	.usr-bonos-barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem 1rem;
		padding: 0.6rem 0.75rem 0.6rem 1rem;
		border-radius: 16px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.usr-bonos-seleccion {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
		min-width: 0;
	}
	.usr-bonos-todos {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 38px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
		user-select: none;
	}
	.usr-bonos-todos input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--accion);
		cursor: pointer;
	}
	.usr-bonos-todos input:disabled {
		cursor: not-allowed;
	}
	.usr-bonos-texto {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.usr-bonos-texto strong {
		color: var(--text-primary);
	}
	.usr-bonos-acciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
