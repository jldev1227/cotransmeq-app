<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import { usuariosAPI, type Usuario, hasBonosPlanilla } from '$lib/api/usuarios';
	import { sesionesAPI, type Sesion } from '$lib/api/sesiones';
	import { apiClient } from '$lib/api/apiClient';
	import { authStore } from '$lib/stores/auth';
	import { AREA_LABELS, type Area } from '$lib/config/permissions';
	import { socketManager, socketUtils } from '$lib/socket';

	// ─── Estado unificado ────────────────────────────────────────────────
	let usuarios: Usuario[] = [];
	let loading = true;
	let onlineIds = new Set<string>();
	let searchTerm = '';
	let filterArea = '';
	let filterStatus: 'TODOS' | 'ACTIVOS' | 'INACTIVOS' | 'EN_LINEA' = 'TODOS';
	let searchTimeout: ReturnType<typeof setTimeout>;

	$: filteredUsuarios = usuarios.filter((u) => {
		if (searchTerm) {
			const t = searchTerm.toLowerCase();
			if (
				!u.nombre.toLowerCase().includes(t) &&
				!u.correo.toLowerCase().includes(t) &&
				!(u.cargo ?? '').toLowerCase().includes(t)
			)
				return false;
		}
		if (filterArea && !(Array.isArray(u.area) && u.area.includes(filterArea))) return false;
		if (filterStatus === 'ACTIVOS' && u.activo === false) return false;
		if (filterStatus === 'INACTIVOS' && u.activo !== false) return false;
		if (filterStatus === 'EN_LINEA' && !onlineIds.has(u.id)) return false;
		return true;
	});

	$: currentUser = $authStore.user;
	$: enLineaCount = usuarios.filter((u) => onlineIds.has(u.id)).length;
	$: activosCount = usuarios.filter((u) => u.activo !== false).length;
	$: inactivosCount = usuarios.filter((u) => u.activo === false).length;

	// ─── Sesiones ────────────────────────────────────────────────────────
	let sesiones: Sesion[] = [];
	let loadingSesiones = true;
	let filtroSesion: 'activas' | 'cerradas' | 'todas' = 'activas';
	let searchSesion = '';
	let sesionSectionOpen = true;
	let sesionesFocusUsuarioId: string | null = null;

	$: sesionesVisibles = sesiones.filter((s) => {
		if (filtroSesion === 'activas' && !s.is_active) return false;
		if (filtroSesion === 'cerradas' && s.is_active) return false;
		if (sesionesFocusUsuarioId && s.usuario_id !== sesionesFocusUsuarioId) return false;
		if (searchSesion) {
			const t = searchSesion.toLowerCase();
			if (
				!s.usuario?.nombre?.toLowerCase().includes(t) &&
				!s.usuario?.correo?.toLowerCase().includes(t) &&
				!(s.ip ?? '').includes(t)
			)
				return false;
		}
		return true;
	});
	$: activasCount = sesiones.filter((s) => s.is_active).length;

	// ─── Invitaciones ────────────────────────────────────────────────────
	interface Invitacion {
		id: string;
		correo: string;
		area: string[];
		cargo?: string | null;
		estado: string;
		expires_at: string;
		created_at: string;
		invitado_por: { id: string; nombre: string };
	}
	let invitaciones: Invitacion[] = [];
	let loadingInv = true;
	let modalInvAbierto = false;
	let enviandoInv = false;
	let formCorreo = '';
	let formAreas: string[] = [];
	let formCargo = '';
	let errorInv = '';
	let invSectionOpen = true;

	$: invitacionesPendientes = invitaciones.filter((i) => i.estado === 'pendiente');

	// ─── Modales CRUD ───────────────────────────────────────────────────
	let showEditModal = false;
	let editUsuario: Usuario | null = null;
	let editNombre = '';
	let editCorreo = '';
	let editTelefono = '';
	let editAreas: string[] = [];
	let savingEdit = false;

	let showConfirmModal = false;
	let confirmUsuario: Usuario | null = null;
	let confirmAction: 'disable' | 'enable' = 'disable';
	let savingToggle = false;

	let showPermisosModal = false;
	let permisosUsuario: Usuario | null = null;
	let savingPermisos = false;

	let detailUsuario: Usuario | null = null;
	let detailSesiones: Sesion[] = [];

	const modulosDisponibles = [
		{ id: 'flota', label: 'Flota' },
		{ id: 'conductores', label: 'Conductores' },
		{ id: 'servicios', label: 'Servicios' },
		{ id: 'recargos', label: 'Recargos' },
		{ id: 'clientes', label: 'Clientes' },
		{ id: 'asistencias', label: 'Asistencias' },
		{ id: 'acciones-correctivas', label: 'Acciones C/P' },
		{ id: 'evaluaciones', label: 'Evaluaciones' },
		{ id: 'nomina', label: 'Nómina' },
		{ id: 'usuarios', label: 'Usuarios' }
	];

	// ─── Carga inicial ───────────────────────────────────────────────────
	onMount(async () => {
		await Promise.all([cargarUsuarios(), cargarSesiones(), cargarInvitaciones()]);
		const user = $authStore.user;
		if (user?.id) socketUtils.emit('join-dashboard', user.id);
		socketUtils.on('usuarios-online', onOnline);
		socketManager.on('usuario-deshabilitado', (data: any) => {
			if (data?.usuarioId === currentUser?.id) {
				toast.error('Tu cuenta ha sido deshabilitada');
				setTimeout(() => authStore.logout(), 1500);
			}
		});
	});

	onDestroy(() => {
		socketUtils.emit('leave-dashboard');
		socketUtils.off('usuarios-online', onOnline);
		socketManager.off('usuario-deshabilitado');
	});

	function onOnline(ids: string[]) {
		onlineIds = new Set(ids);
	}

	async function cargarUsuarios() {
		try {
			loading = true;
			usuarios = await usuariosAPI.listar();
		} catch {
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

	function estadoInvBadge(estado: string) {
		const m: Record<string, string> = {
			pendiente: 'estado-pill--amber',
			aceptada: 'estado-pill--emerald',
			expirada: 'estado-pill--red',
			revocada: 'estado-pill--gray',
			reemplazada: 'estado-pill--gray'
		};
		return m[estado] ?? 'estado-pill--gray';
	}

	// ─── Gestión usuarios ───────────────────────────────────────────────
	function abrirEditModal(usuario: Usuario, e?: Event) {
		e?.stopPropagation();
		editUsuario = usuario;
		editNombre = usuario.nombre;
		editCorreo = usuario.correo;
		editTelefono = usuario.telefono || '';
		editAreas = Array.isArray(usuario.area) ? [...usuario.area] : usuario.area ? [usuario.area as string] : [];
		showEditModal = true;
	}
	function cerrarEditModal() {
		showEditModal = false;
		editUsuario = null;
	}

	async function guardarEdit() {
		if (!editUsuario) return;
		savingEdit = true;
		try {
			const updated = await usuariosAPI.actualizar(editUsuario.id, {
				nombre: editNombre,
				correo: editCorreo,
				telefono: editTelefono,
				area: editAreas
			});
			usuarios = usuarios.map((u) => (u.id === updated.id ? updated : u));
			toast.success(`${editNombre} actualizado correctamente`);
			cerrarEditModal();
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al actualizar usuario');
		} finally {
			savingEdit = false;
		}
	}

	function abrirConfirmToggle(usuario: Usuario, e?: Event) {
		e?.stopPropagation();
		confirmUsuario = usuario;
		confirmAction = usuario.activo !== false ? 'disable' : 'enable';
		showConfirmModal = true;
	}
	function cerrarConfirmModal() {
		showConfirmModal = false;
		confirmUsuario = null;
	}

	async function confirmarToggle() {
		if (!confirmUsuario) return;
		savingToggle = true;
		const nuevoEstado = confirmAction === 'enable';
		try {
			const updated = await usuariosAPI.toggleActivo(confirmUsuario.id, nuevoEstado);
			usuarios = usuarios.map((u) => (u.id === updated.id ? updated : u));
			if (!nuevoEstado) {
				// Cerrar las sesiones activas del usuario deshabilitado
				sesiones = sesiones.map((s) =>
					s.usuario_id === confirmUsuario!.id && s.is_active
						? { ...s, is_active: false, closed_at: new Date().toISOString() }
						: s
				);
			}
			toast.success(
				`${confirmUsuario.nombre} ${nuevoEstado ? 'habilitado' : 'deshabilitado'}`
			);
			cerrarConfirmModal();
		} catch {
			toast.error('Error al cambiar estado del usuario');
		} finally {
			savingToggle = false;
		}
	}

	function abrirPermisos(usuario: Usuario, e?: Event) {
		e?.stopPropagation();
		const permisosCompletos: Record<string, boolean> = {};
		for (const modulo of modulosDisponibles)
			permisosCompletos[modulo.id] = usuario.permisos?.[modulo.id] ?? false;
		permisosUsuario = { ...usuario, permisos: permisosCompletos };
		showPermisosModal = true;
	}
	function cerrarPermisosModal() {
		showPermisosModal = false;
		permisosUsuario = null;
	}
	function togglePermiso(moduloId: string) {
		if (!permisosUsuario?.permisos) return;
		permisosUsuario = {
			...permisosUsuario,
			permisos: { ...permisosUsuario.permisos, [moduloId]: !permisosUsuario.permisos[moduloId] }
		};
	}
	function toggleTodos(valor: boolean) {
		if (!permisosUsuario) return;
		const nuevosPermisos: Record<string, boolean> = {};
		for (const modulo of modulosDisponibles) nuevosPermisos[modulo.id] = valor;
		permisosUsuario = { ...permisosUsuario, permisos: nuevosPermisos };
	}
	async function guardarPermisos() {
		if (!permisosUsuario?.permisos) return;
		savingPermisos = true;
		try {
			const updated = await usuariosAPI.actualizarPermisos(permisosUsuario.id, permisosUsuario.permisos);
			usuarios = usuarios.map((u) => (u.id === updated.id ? updated : u));
			if (currentUser && permisosUsuario.id === currentUser.id)
				authStore.updateUserPermisos(permisosUsuario.permisos as any);
			toast.success(`Permisos de ${permisosUsuario.nombre} actualizados`);
			cerrarPermisosModal();
		} catch {
			toast.error('Error al guardar permisos');
		} finally {
			savingPermisos = false;
		}
	}

	// ─── Detalle lateral de usuario ─────────────────────────────────────
	function verDetalleUsuario(usuario: Usuario) {
		detailUsuario = usuario;
		detailSesiones = sesiones.filter((s) => s.usuario_id === usuario.id);
		sesionesFocusUsuarioId = usuario.id;
		setTimeout(() => {
			const el = document.getElementById('sesiones-section');
			if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}, 80);
	}
	function limpiarFocoSesiones() {
		sesionesFocusUsuarioId = null;
		detailUsuario = null;
	}

	// ─── Sesiones ───────────────────────────────────────────────────────
	async function cargarSesiones() {
		try {
			loadingSesiones = true;
			sesiones = await sesionesAPI.listar({ limit: 200 });
		} catch {
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
		if (!confirm(`¿Cerrar todas las sesiones activas de ${nombre}?`)) return;
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
			const res = await apiClient.get('/api/invitaciones');
			invitaciones = res.data;
		} catch {
			toast.error('Error cargando invitaciones');
		} finally {
			loadingInv = false;
		}
	}
	function abrirModalInv() {
		formCorreo = '';
		formAreas = [];
		formCargo = '';
		errorInv = '';
		modalInvAbierto = true;
	}
	function toggleAreaInv(v: string) {
		formAreas = formAreas.includes(v) ? formAreas.filter((a) => a !== v) : [...formAreas, v];
	}
	async function enviarInvitacion() {
		errorInv = '';
		if (!formCorreo) {
			errorInv = 'Ingresa un correo';
			return;
		}
		if (formAreas.length === 0) {
			errorInv = 'Selecciona al menos un área';
			return;
		}
		try {
			enviandoInv = true;
			await apiClient.post('/api/invitaciones', {
				correo: formCorreo,
				area: formAreas,
				cargo: formCargo || undefined
			});
			toast.success('Invitación enviada');
			modalInvAbierto = false;
			cargarInvitaciones();
		} catch (e: any) {
			errorInv = e?.response?.data?.error || 'Error enviando invitación';
		} finally {
			enviandoInv = false;
		}
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
			await apiClient.post('/api/invitaciones', { correo: inv.correo, area: inv.area, cargo: inv.cargo });
			toast.success(`Invitación reenviada a ${inv.correo}`);
			cargarInvitaciones();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'Error reenviando invitación');
		}
	}

	// ─── Permiso individual: bonos de planilla ───────────────────
	// Estado: lista de usuarios con el permiso otorgado (o no)
	let bonosSearch = '';
	let bonosFilter: 'TODOS' | 'CON_PERMISO' | 'SIN_PERMISO' = 'TODOS';
	let bonosSeleccionados = new Set<string>();
	let guardandoBonos = false;

	$: isAdminUser =
		$authStore.user?.role === 'admin' ||
		$authStore.user?.rol === 'admin' ||
		((Array.isArray($authStore.user?.area)
			? ($authStore.user!.area as string[])
			: []
		) as string[]).includes('administracion');

	$: usuariosBonos = usuarios
		.filter((u) => {
			if (bonosSearch) {
				const t = bonosSearch.toLowerCase();
				if (
					!u.nombre.toLowerCase().includes(t) &&
					!u.correo.toLowerCase().includes(t) &&
					!(u.cargo ?? '').toLowerCase().includes(t)
				)
					return false;
			}
			const has = hasBonosPlanilla(u);
			if (bonosFilter === 'CON_PERMISO' && !has) return false;
			if (bonosFilter === 'SIN_PERMISO' && has) return false;
			return true;
		})
		.sort((a, b) => {
			// Los que tienen permiso van primero
			const ha = hasBonosPlanilla(a) ? 1 : 0;
			const hb = hasBonosPlanilla(b) ? 1 : 0;
			if (hb !== ha) return hb - ha;
			return a.nombre.localeCompare(b.nombre);
		});

	$: totalConPermiso = usuarios.filter((u) => hasBonosPlanilla(u)).length;
	$: totalSinPermiso = usuarios.length - totalConPermiso;

	function toggleSeleccionBonos(userId: string) {
		if (bonosSeleccionados.has(userId)) bonosSeleccionados.delete(userId);
		else bonosSeleccionados.add(userId);
		bonosSeleccionados = bonosSeleccionados;
	}

	function seleccionarTodosBonos() {
		if (bonosSeleccionados.size === usuariosBonos.length) {
			bonosSeleccionados.clear();
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
			const ok = confirm(
				granted
					? `No has seleccionado usuarios. ¿Deseas OTORGAR el permiso a TODOS los ${usuariosBonos.length} usuarios del filtro actual?`
					: `No has seleccionado usuarios. ¿Deseas REVOCAR el permiso a TODOS los ${usuariosBonos.length} usuarios del filtro actual?`
			);
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
			bonosSeleccionados.clear();
			bonosSeleccionados = bonosSeleccionados;
		} catch (err: any) {
			const msg = err?.response?.data?.error || 'Error al actualizar el permiso';
			toast.error(msg);
		} finally {
			guardandoBonos = false;
		}
	}
</script>

<svelte:head><title>Equipo · Transmeralda</title></svelte:head>

<div class="usuarios-page" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
	<!-- ═══ HERO ═══ -->
	<header class="page-hero" in:fade={{ duration: 400 }}>
		<div class="hero-inner">
			<div class="hero-left">
				<div class="card-icon hero-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
					</svg>
				</div>
				<div class="hero-text">
					<span class="eyebrow">Equipo · Transmeralda</span>
					<h1>Personas y accesos</h1>
					<p>
						Gestiona los miembros del equipo, sus áreas, permisos, sesiones activas e invitaciones
						pendientes desde un solo lugar.
					</p>
				</div>
			</div>
			<div class="hero-actions">
				<button class="btn-secondary" on:click={cargarUsuarios}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
					</svg>
					Recargar
				</button>
				<button class="btn-primary" on:click={abrirModalInv}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
					</svg>
					Invitar usuario
				</button>
			</div>
		</div>

		<div class="hero-stats">
			<div class="stat-item">
				<span class="stat-label">Total</span>
				<span class="stat-value">{usuarios.length}</span>
			</div>
			<span class="stat-sep">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--emerald" aria-hidden="true"></span>
				<span class="stat-label">En línea</span>
				<span class="stat-value">{enLineaCount}</span>
			</div>
			<span class="stat-sep">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--amber" aria-hidden="true"></span>
				<span class="stat-label">Activos</span>
				<span class="stat-value">{activosCount}</span>
			</div>
			<span class="stat-sep">·</span>
			<div class="stat-item">
				<span class="stat-dot stat-dot--red" aria-hidden="true"></span>
				<span class="stat-label">Inactivos</span>
				<span class="stat-value">{inactivosCount}</span>
			</div>
			<span class="stat-sep">·</span>
			<div class="stat-item">
				<svg class="h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span class="stat-label">Sesiones</span>
				<span class="stat-value">{activasCount}</span>
			</div>
			<span class="stat-sep">·</span>
			<div class="stat-item" class:stat-item--active={invitacionesPendientes.length > 0}>
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
				</svg>
				<span class="stat-label">Invitaciones</span>
				<span class="stat-value">{invitacionesPendientes.length}</span>
			</div>
		</div>
	</header>

	<!-- ═══ FILTROS / EQUIPO ═══ -->
	<section class="section">
		<header class="section-head">
			<div>
				<span class="eyebrow">01 · Equipo</span>
				<h2>Miembros del equipo</h2>
				<p>Listado completo con estado, áreas y acciones rápidas. Haz clic en una tarjeta para ver sus sesiones.</p>
			</div>
		</header>

		<div class="filters-bar">
			<div class="search-wrap">
				<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
				</svg>
				<input
					type="text"
					bind:value={searchTerm}
					placeholder="Buscar por nombre, correo o cargo…"
					class="search-input"
				/>
			</div>

			<div class="filter-group">
				{#each [{ k: 'TODOS', l: 'Todos' }, { k: 'EN_LINEA', l: 'En línea' }, { k: 'ACTIVOS', l: 'Activos' }, { k: 'INACTIVOS', l: 'Inactivos' }] as f}
					<button
						class="chip"
						class:chip--active={filterStatus === f.k}
						on:click={() => (filterStatus = f.k as typeof filterStatus)}
					>
						{#if f.k === 'EN_LINEA'}<span class="chip-dot chip-dot--emerald" aria-hidden="true"></span>{/if}
						{f.l}
					</button>
				{/each}
			</div>

			<select bind:value={filterArea} class="select">
				<option value="">Todas las áreas</option>
				{#each Object.entries(AREA_LABELS) as [key, label]}
					<option value={key}>{label}</option>
				{/each}
			</select>

			{#if searchTerm || filterArea || filterStatus !== 'TODOS'}
				<button
					class="clear-btn"
					on:click={() => {
						searchTerm = '';
						filterArea = '';
						filterStatus = 'TODOS';
					}}
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
					Limpiar
				</button>
			{/if}
		</div>

		{#if loading}
			<div class="state-block">
				<div class="spin-ring" aria-hidden="true"></div>
				<p>Cargando equipo…</p>
			</div>
		{:else if filteredUsuarios.length === 0}
			<div class="empty-state" in:fade>
				<div class="empty-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.4">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
					</svg>
				</div>
				<h3>Sin resultados</h3>
				<p>Ajusta los filtros o invita a un nuevo miembro al equipo.</p>
				<button class="btn-primary" on:click={abrirModalInv}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Invitar usuario
				</button>
			</div>
		{:else}
			<div class="users-grid">
				{#each filteredUsuarios as u, idx (u.id)}
					{@const status = statusOf(u)}
					<article
						class="user-card status-{status}"
						class:user-card--focus={detailUsuario?.id === u.id}
						in:fly={{ y: 12, duration: 300, delay: Math.min(idx * 25, 350), easing: quintOut }}
					>
						<header class="user-head">
							<div class="avatar avatar--{status}">
								<span>{initials(u.nombre)}</span>
								<span class="avatar-dot avatar-dot--{status}" aria-hidden="true"></span>
							</div>
							<div class="user-head-text">
								<h3>
									{u.nombre}
									{#if u.id === currentUser?.id}<span class="badge-self">tú</span>{/if}
								</h3>
								<span class="user-email">{u.correo}</span>
							</div>
							<button
								type="button"
								class="user-status-toggle"
								class:user-status-toggle--on={u.activo !== false}
								class:user-status-toggle--off={u.activo === false}
								title={u.activo !== false ? 'Deshabilitar usuario' : 'Habilitar usuario'}
								aria-label={u.activo !== false ? 'Deshabilitar' : 'Habilitar'}
								disabled={u.id === currentUser?.id}
								on:click={(e) => abrirConfirmToggle(u, e)}
							>
								<span class="user-status-knob"></span>
							</button>
						</header>

						{#if u.area && u.area.length}
							<div class="user-areas">
								{#each u.area as a}
									<span class="area-chip">{AREA_LABELS[a as Area] ?? a}</span>
								{/each}
							</div>
						{:else}
							<div class="user-areas"><span class="muted">Sin área asignada</span></div>
						{/if}

						<dl class="user-data">
							<div>
								<dt>Cargo</dt>
								<dd>{u.cargo ?? '—'}</dd>
							</div>
							<div>
								<dt>Último acceso</dt>
								<dd class="last-access last-access--{status}">{lastAccess(u)}</dd>
							</div>
						</dl>

						<footer class="user-foot">
							<button class="user-link" on:click={() => verDetalleUsuario(u)}>
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								Ver sesiones
							</button>
							<div class="user-actions">
								<button
									type="button"
									class="icon-btn"
									title="Editar"
									aria-label="Editar {u.nombre}"
									on:click={(e) => abrirEditModal(u, e)}
								>
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
										<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
									</svg>
								</button>
								<button
									type="button"
									class="icon-btn"
									title="Permisos"
									aria-label="Permisos de {u.nombre}"
									on:click={(e) => abrirPermisos(u, e)}
								>
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
									</svg>
								</button>
							</div>
						</footer>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	<!-- ═══ SESIONES ═══ -->
	<section class="section" id="sesiones-section">
		<header class="section-head">
			<div class="section-head-left">
				<div>
					<span class="eyebrow">02 · Sesiones</span>
					<h2>
						{#if detailUsuario}Sesiones de {detailUsuario.nombre}{:else}Sesiones{/if}
					</h2>
					<p>
						{#if detailUsuario}
							Vista filtrada por usuario. <button class="link-btn" on:click={limpiarFocoSesiones}>Ver todas</button>
						{:else}
							Monitorea y cierra sesiones activas. Cambia entre activas, cerradas o todas.
						{/if}
					</p>
				</div>
			</div>
			<div class="section-head-right">
				{#if detailUsuario}
					<button
						class="btn-secondary btn-secondary--sm"
						on:click={() => cerrarTodasUsuario(detailUsuario!.id, detailUsuario!.nombre)}
						disabled={!detailSesiones.some((s) => s.is_active)}
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
						</svg>
						Cerrar todas
					</button>
				{/if}
			</div>
		</header>

		<div class="filters-bar">
			<div class="search-wrap">
				<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
				</svg>
				<input
					type="text"
					bind:value={searchSesion}
					placeholder="Buscar por usuario, correo o IP…"
					class="search-input"
				/>
			</div>

			<div class="filter-group">
				{#each [{ k: 'activas', l: 'Activas', n: activasCount }, { k: 'cerradas', l: 'Cerradas', n: sesiones.length - activasCount }, { k: 'todas', l: 'Todas', n: sesiones.length }] as f}
					<button
						class="chip"
						class:chip--active={filtroSesion === f.k}
						on:click={() => (filtroSesion = f.k as typeof filtroSesion)}
					>
						{f.l}
						<span class="chip-count">{f.n}</span>
					</button>
				{/each}
			</div>
		</div>

		{#if loadingSesiones}
			<div class="state-block">
				<div class="spin-ring" aria-hidden="true"></div>
				<p>Cargando sesiones…</p>
			</div>
		{:else if sesionesVisibles.length === 0}
			<div class="state-block" in:fade>
				<p>
					{filtroSesion === 'activas'
						? 'No hay sesiones activas en este momento.'
						: 'No hay sesiones que coincidan con los filtros.'}
				</p>
			</div>
		{:else}
			<div class="sessions-list">
				{#each sesionesVisibles as s, i (s.id)}
					<div
						class="session-card session-card--{s.is_active ? 'active' : 'closed'}"
						in:fly={{ y: 8, duration: 220, delay: Math.min(i * 18, 280), easing: quintOut }}
					>
						<div class="session-main">
							<div class="session-avatar">
								{initials(s.usuario?.nombre || '?')}
								<span class="session-dot session-dot--{s.is_active ? 'active' : 'closed'}" aria-hidden="true"></span>
							</div>
							<div class="session-text">
								<div class="session-row">
									<strong>{s.usuario?.nombre || '—'}</strong>
									<span class="session-mail">{s.usuario?.correo ?? ''}</span>
								</div>
								<div class="session-meta">
									<span class="meta-item">
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
										</svg>
										{parseBrowser(s.user_agent)}
									</span>
									{#if parseOS(s.user_agent)}
										<span class="meta-item">
											<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21" />
											</svg>
											{parseOS(s.user_agent)}
										</span>
									{/if}
									{#if s.ip}
										<span class="meta-item">
											<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
											</svg>
											<span class="mono">{s.ip}</span>
										</span>
									{/if}
									{#if s.remember_me}
										<span class="meta-item meta-item--emerald" title="Sesión persistente (recordar sesión)">
											<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
											</svg>
											persistente
										</span>
									{/if}
								</div>
							</div>
						</div>

						<div class="session-side">
							<div class="session-time">
								{#if s.is_active}
									<span class="estado-pill estado-pill--emerald">
										<span class="pulse-dot" aria-hidden="true"></span>Activa
									</span>
									<small>Inicio: {formatDate(s.created_at)}</small>
									<small>Última act.: {formatDate(s.last_activity)}</small>
								{:else}
									<span class="estado-pill estado-pill--gray">Cerrada</span>
									<small>Duración: {s.duracion_texto || '—'}</small>
									{#if s.closed_at}<small>Cerrada: {formatDate(s.closed_at)}</small>{/if}
								{/if}
							</div>
							{#if s.is_active}
								<button
									class="icon-btn icon-btn--danger"
									title="Cerrar esta sesión"
									aria-label="Cerrar sesión de {s.usuario?.nombre}"
									on:click={() => cerrarSesion(s.id)}
								>
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
										<path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
									</svg>
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- ═══ PERMISO DE BONOS — Planilla de días laborados ═══ -->
	<section class="section">
		<header class="section-head">
			<div>
				<span class="eyebrow">04 · Permiso especial</span>
				<h2>Permiso de bonos — planilla de días laborados</h2>
				<p>
					Otorga o revoca el permiso individual <strong>bonos-planilla</strong> a uno o
					varios usuarios. Solo quienes tengan este permiso activo pueden marcar y
					guardar bonos (alimentación, día doble, día trabajado) en el tab
					<em>Recorridos</em> de la página de Conductores. Los demás usuarios siguen
					pudiendo ver los bonos ya otorgados (modo solo lectura).
				</p>
			</div>
		</header>

		{#if !isAdminUser}
			<div class="alert-block">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
				</svg>
				<p>
					Esta sección solo es visible para administradores. Si necesitas gestionar
					este permiso, contacta a un administrador del sistema.
				</p>
			</div>
		{:else}
			<!-- Resumen -->
			<div class="bonos-stats">
				<div class="bonos-stat">
					<span class="bonos-stat-dot bonos-stat-dot--emerald"></span>
					<div>
						<span class="bonos-stat-label">Con permiso</span>
						<span class="bonos-stat-value">{totalConPermiso}</span>
					</div>
				</div>
				<span class="bonos-stat-sep">·</span>
				<div class="bonos-stat">
					<span class="bonos-stat-dot bonos-stat-dot--gray"></span>
					<div>
						<span class="bonos-stat-label">Sin permiso</span>
						<span class="bonos-stat-value">{totalSinPermiso}</span>
					</div>
				</div>
				<span class="bonos-stat-sep">·</span>
				<div class="bonos-stat">
					<div>
						<span class="bonos-stat-label">Total equipo</span>
						<span class="bonos-stat-value">{usuarios.length}</span>
					</div>
				</div>
			</div>

			<!-- Filtros y acciones masivas -->
			<div class="filters-bar">
				<div class="search-wrap">
					<svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
					</svg>
					<input
						type="text"
						bind:value={bonosSearch}
						placeholder="Buscar usuario por nombre, correo o cargo…"
						class="search-input"
					/>
				</div>

				<div class="filter-group">
					{#each [{ k: 'TODOS', l: 'Todos' }, { k: 'CON_PERMISO', l: 'Con permiso' }, { k: 'SIN_PERMISO', l: 'Sin permiso' }] as f}
						<button
							class="chip"
							class:chip--active={bonosFilter === f.k}
							on:click={() => (bonosFilter = f.k as typeof bonosFilter)}
						>
							{#if f.k === 'CON_PERMISO'}<span class="chip-dot chip-dot--emerald" aria-hidden="true"></span>{/if}
							{f.l}
						</button>
					{/each}
				</div>

				{#if bonosSeleccionados.size > 0}
					<span class="bonos-selected-count">
						{bonosSeleccionados.size} seleccionado{bonosSeleccionados.size !== 1 ? 's' : ''}
					</span>
					<button
						class="btn-secondary btn-secondary--sm"
						disabled={guardandoBonos}
						on:click={() => (bonosSeleccionados = new Set())}
					>
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
						Limpiar selección
					</button>
				{/if}
			</div>

			<!-- Acciones masivas (siempre visibles, pero se aplican a la selección o al filtro) -->
			<div class="bonos-bulk-actions">
				<button
					type="button"
					class="btn-bonos-grant"
					disabled={guardandoBonos}
					on:click={() => setBonosPlanilla(true)}
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Otorgar permiso
					{#if bonosSeleccionados.size > 0}
						<span class="bonos-btn-count">({bonosSeleccionados.size})</span>
					{:else if usuariosBonos.length > 0}
						<span class="bonos-btn-count">({usuariosBonos.length} del filtro)</span>
					{/if}
				</button>
				<button
					type="button"
					class="btn-bonos-revoke"
					disabled={guardandoBonos}
					on:click={() => setBonosPlanilla(false)}
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
					</svg>
					Revocar permiso
					{#if bonosSeleccionados.size > 0}
						<span class="bonos-btn-count">({bonosSeleccionados.size})</span>
					{:else if usuariosBonos.length > 0}
						<span class="bonos-btn-count">({usuariosBonos.length} del filtro)</span>
					{/if}
				</button>

				<label class="bonos-select-all">
					<input
						type="checkbox"
						checked={bonosSeleccionados.size > 0 && bonosSeleccionados.size === usuariosBonos.length}
						indeterminate={bonosSeleccionados.size > 0 && bonosSeleccionados.size < usuariosBonos.length}
						on:change={seleccionarTodosBonos}
					/>
					<span>Seleccionar todos los del filtro</span>
				</label>
			</div>

			<!-- Lista de usuarios con su estado de permiso -->
			{#if loading}
				<div class="state-block">
					<div class="spin-ring" aria-hidden="true"></div>
					<p>Cargando equipo…</p>
				</div>
			{:else if usuariosBonos.length === 0}
				<div class="state-block" in:fade>
					<p>No hay usuarios que coincidan con los filtros.</p>
				</div>
			{:else}
				<div class="bonos-grid">
					{#each usuariosBonos as u, i (u.id)}
						{@const hasPerm = hasBonosPlanilla(u)}
						{@const isSel = bonosSeleccionados.has(u.id)}
						<label
							class="bonos-card"
							class:bonos-card--active={hasPerm}
							class:bonos-card--selected={isSel}
							in:fly={{ y: 6, duration: 220, delay: Math.min(i * 18, 240), easing: quintOut }}
						>
							<input
								type="checkbox"
								checked={isSel}
								on:change={() => toggleSeleccionBonos(u.id)}
								class="bonos-card-check"
							/>
							<div class="bonos-card-avatar avatar avatar--{u.activo === false ? 'inactive' : 'online'}">
								<span>{initials(u.nombre)}</span>
							</div>
							<div class="bonos-card-text">
								<div class="bonos-card-row">
									<strong>{u.nombre}</strong>
									{#if u.id === currentUser?.id}<span class="badge-self">tú</span>{/if}
								</div>
								<span class="bonos-card-mail">{u.correo}</span>
								{#if u.cargo}<span class="bonos-card-cargo">{u.cargo}</span>{/if}
							</div>
							<div class="bonos-card-state">
								{#if hasPerm}
									<span class="bonos-pill bonos-pill--emerald">
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
										</svg>
										Con permiso
									</span>
								{:else}
									<span class="bonos-pill bonos-pill--gray">Sin permiso</span>
								{/if}
							</div>
						</label>
					{/each}
				</div>
			{/if}
		{/if}
	</section>

	<!-- ═══ INVITACIONES ═══ -->
	<section class="section">
		<header class="section-head">
			<div>
				<span class="eyebrow">03 · Invitaciones</span>
				<h2>Invitaciones enviadas</h2>
				<p>
					{invitacionesPendientes.length} pendiente{invitacionesPendientes.length !== 1 ? 's' : ''}.
					Reenvía o revoca según sea necesario.
				</p>
			</div>
			<div class="section-head-right">
				<button class="btn-primary" on:click={abrirModalInv}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Nueva invitación
				</button>
			</div>
		</header>

		{#if loadingInv}
			<div class="state-block">
				<div class="spin-ring" aria-hidden="true"></div>
				<p>Cargando invitaciones…</p>
			</div>
		{:else if invitaciones.length === 0}
			<div class="empty-state" in:fade>
				<div class="empty-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.4">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
					</svg>
				</div>
				<h3>Sin invitaciones enviadas</h3>
				<p>Invita a nuevos miembros por correo electrónico con sus áreas asignadas.</p>
				<button class="btn-primary" on:click={abrirModalInv}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Enviar primera invitación
				</button>
			</div>
		{:else}
			<div class="inv-list">
				{#each invitaciones as inv, i (inv.id)}
					<div
						class="inv-card inv-card--{inv.estado}"
						in:fly={{ y: 8, duration: 220, delay: Math.min(i * 20, 300), easing: quintOut }}
					>
						<div class="inv-main">
							<div class="inv-icon" aria-hidden="true">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
								</svg>
							</div>
							<div class="inv-text">
								<strong class="inv-correo">{inv.correo}</strong>
								{#if inv.cargo}<span class="inv-cargo">{inv.cargo}</span>{/if}
								<div class="inv-areas">
									{#each inv.area as a}
										<span class="area-chip area-chip--sm">{AREA_LABELS[a as Area] ?? a}</span>
									{/each}
								</div>
								<small class="inv-by">
									Enviada por {inv.invitado_por?.nombre ?? '—'} · {formatDate(inv.created_at)}
								</small>
							</div>
						</div>
						<div class="inv-side">
							<span class="estado-pill {estadoInvBadge(inv.estado)}">{inv.estado}</span>
							{#if inv.estado === 'pendiente'}
								<div class="inv-actions">
									<button
										class="link-btn"
										title="Reenviar invitación"
										on:click={() => reenviarInvitacion(inv)}
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
										</svg>
										Reenviar
									</button>
									<button
										class="link-btn link-btn--danger"
										title="Revocar invitación"
										on:click={() => revocarInvitacion(inv.id)}
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
										Revocar
									</button>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Editar usuario
     ══════════════════════════════════════════════════════════════════════ -->
{#if showEditModal && editUsuario}
	<div
		class="modal-backdrop"
		on:click={cerrarEditModal}
		on:keydown={(e) => e.key === 'Escape' && cerrarEditModal()}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--md"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="edit-user-title"
			transition:fly={{ y: 24, duration: 280, easing: quintOut }}
		>
			<header class="modal-head">
				<div>
					<span class="eyebrow">Editar miembro</span>
					<h2 id="edit-user-title">Editar usuario</h2>
				</div>
				<button class="modal-close" on:click={cerrarEditModal} aria-label="Cerrar">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<form on:submit|preventDefault={guardarEdit} class="modal-form">
				<div class="field">
					<label for="edit-nombre" class="field-label">Nombre completo</label>
					<input id="edit-nombre" type="text" bind:value={editNombre} required class="input" />
				</div>
				<div class="field-grid">
					<div class="field">
						<label for="edit-correo" class="field-label">Correo</label>
						<input id="edit-correo" type="email" bind:value={editCorreo} required class="input" />
					</div>
					<div class="field">
						<label for="edit-telefono" class="field-label">Teléfono</label>
						<input id="edit-telefono" type="tel" bind:value={editTelefono} class="input" placeholder="3001234567" />
					</div>
				</div>
				<div class="field">
					<span class="field-label">Áreas</span>
					<div class="area-picker">
						{#each Object.entries(AREA_LABELS) as [key, label]}
							<button
								type="button"
								class="area-pill"
								class:area-pill--active={editAreas.includes(key)}
								on:click={() =>
									(editAreas = editAreas.includes(key)
										? editAreas.filter((a) => a !== key)
										: [...editAreas, key])}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>
				<footer class="modal-foot">
					<button type="button" class="btn-secondary" on:click={cerrarEditModal}>Cancelar</button>
					<button type="submit" class="btn-primary" disabled={savingEdit}>
						{#if savingEdit}
							<svg class="spin" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
								<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							Guardando…
						{:else}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							Guardar cambios
						{/if}
					</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Confirmar enable/disable
     ══════════════════════════════════════════════════════════════════════ -->
{#if showConfirmModal && confirmUsuario}
	<div
		class="modal-backdrop"
		on:click={cerrarConfirmModal}
		on:keydown={(e) => e.key === 'Escape' && cerrarConfirmModal()}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--sm"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="alertdialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="confirm-toggle-title"
			transition:fly={{ y: 20, duration: 240, easing: quintOut }}
		>
			<div
				class="modal-icon"
				class:modal-icon--danger={confirmAction === 'disable'}
				class:modal-icon--emerald={confirmAction === 'enable'}
				aria-hidden="true"
			>
				{#if confirmAction === 'disable'}
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
					</svg>
				{:else}
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				{/if}
			</div>
			<span class="eyebrow eyebrow--center">
				{confirmAction === 'disable' ? 'Deshabilitar acceso' : 'Habilitar acceso'}
			</span>
			<h3 id="confirm-toggle-title" class="modal-title">
				{confirmAction === 'disable' ? 'Deshabilitar usuario' : 'Habilitar usuario'}
			</h3>
			<p class="modal-desc">
				{#if confirmAction === 'disable'}
					¿Deshabilitar a <strong>{confirmUsuario.nombre}</strong>? Se cerrarán todas sus sesiones
					activas y no podrá ingresar al sistema.
				{:else}
					¿Habilitar nuevamente a <strong>{confirmUsuario.nombre}</strong>? Volverá a tener acceso
					al sistema con sus permisos actuales.
				{/if}
			</p>
			<footer class="modal-foot">
				<button class="btn-secondary" on:click={cerrarConfirmModal}>Cancelar</button>
				<button
					class={confirmAction === 'disable' ? 'btn-danger' : 'btn-primary'}
					disabled={savingToggle}
					on:click={confirmarToggle}
				>
					{#if savingToggle}
						<svg class="spin" viewBox="0 0 24 24" fill="none">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
							<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
						</svg>
					{/if}
					{confirmAction === 'disable' ? 'Sí, deshabilitar' : 'Sí, habilitar'}
				</button>
			</footer>
		</div>
	</div>
{/if}

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Permisos
     ══════════════════════════════════════════════════════════════════════ -->
{#if showPermisosModal && permisosUsuario}
	<div
		class="modal-backdrop"
		on:click={cerrarPermisosModal}
		on:keydown={(e) => e.key === 'Escape' && cerrarPermisosModal()}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--md"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="permisos-title"
			transition:fly={{ y: 24, duration: 280, easing: quintOut }}
		>
			<header class="modal-head">
				<div>
					<span class="eyebrow">Permisos por módulo</span>
					<h2 id="permisos-title">{permisosUsuario.nombre}</h2>
				</div>
				<button class="modal-close" on:click={cerrarPermisosModal} aria-label="Cerrar">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<div class="perm-bulk">
				<span class="perm-bulk-label">Acciones rápidas</span>
				<div class="perm-bulk-btns">
					<button type="button" class="chip chip--sm" on:click={() => toggleTodos(true)}>Habilitar todos</button>
					<button type="button" class="chip chip--sm" on:click={() => toggleTodos(false)}>Deshabilitar todos</button>
				</div>
			</div>

			<div class="perm-grid">
				{#each modulosDisponibles as modulo}
					{@const activo = permisosUsuario.permisos?.[modulo.id] === true}
					<button
						type="button"
						class="perm-row"
						class:perm-row--active={activo}
						on:click={() => togglePermiso(modulo.id)}
					>
						<span class="perm-row-label">{modulo.label}</span>
						<span class="user-status-toggle" class:user-status-toggle--on={activo} class:user-status-toggle--off={!activo} aria-hidden="true">
							<span class="user-status-knob"></span>
						</span>
					</button>
				{/each}
			</div>

			<footer class="modal-foot">
				<button class="btn-secondary" on:click={cerrarPermisosModal}>Cancelar</button>
				<button class="btn-primary" disabled={savingPermisos} on:click={guardarPermisos}>
					{#if savingPermisos}
						<svg class="spin" viewBox="0 0 24 24" fill="none">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
							<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
						</svg>
					{/if}
					Guardar permisos
				</button>
			</footer>
		</div>
	</div>
{/if}

<!-- ══════════════════════════════════════════════════════════════════════
     MODAL: Invitar usuario
     ══════════════════════════════════════════════════════════════════════ -->
{#if modalInvAbierto}
	<div
		class="modal-backdrop"
		on:click={() => (modalInvAbierto = false)}
		on:keydown={(e) => e.key === 'Escape' && (modalInvAbierto = false)}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--md"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="invite-title"
			transition:fly={{ y: 24, duration: 280, easing: quintOut }}
		>
			<header class="modal-head">
				<div>
					<span class="eyebrow">Nueva invitación</span>
					<h2 id="invite-title">Invitar usuario</h2>
				</div>
				<button class="modal-close" on:click={() => (modalInvAbierto = false)} aria-label="Cerrar">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<form on:submit|preventDefault={enviarInvitacion} class="modal-form">
				<div class="field">
					<label for="inv-correo" class="field-label">
						Correo electrónico <span class="field-required">*</span>
					</label>
					<input
						id="inv-correo"
						type="email"
						bind:value={formCorreo}
						class="input"
						placeholder="usuario@empresa.com"
					/>
				</div>
				<div class="field">
					<label for="inv-cargo" class="field-label">Cargo <span class="muted-inline">(opcional)</span></label>
					<input
						id="inv-cargo"
						type="text"
						bind:value={formCargo}
						class="input"
						placeholder="Ej: Coordinador de operaciones"
					/>
				</div>
				<div class="field">
					<span class="field-label">
						Áreas <span class="field-required">*</span>
					</span>
					<div class="area-picker">
						{#each Object.entries(AREA_LABELS) as [key, label]}
							<button
								type="button"
								class="area-pill"
								class:area-pill--active={formAreas.includes(key)}
								on:click={() => toggleAreaInv(key)}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>

				{#if errorInv}
					<div class="alert alert-error" in:fly={{ y: -8, duration: 200 }}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
						</svg>
						<strong>{errorInv}</strong>
					</div>
				{/if}

				<footer class="modal-foot">
					<button type="button" class="btn-secondary" on:click={() => (modalInvAbierto = false)}>Cancelar</button>
					<button type="submit" class="btn-primary" disabled={enviandoInv}>
						{#if enviandoInv}
							<svg class="spin" viewBox="0 0 24 24" fill="none">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
								<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
							</svg>
							Enviando…
						{:else}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
							</svg>
							Enviar invitación
						{/if}
					</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

<style>
	/* ═══════════════════════════════════════════════════════════════
	   PAGE BASE
	   ═══════════════════════════════════════════════════════════════ */
	.usuarios-page {
		min-height: 100vh;
		background: #faf7f2;
		font-family: 'Inter Tight', system-ui, sans-serif;
		color: #1a1a1a;
		padding: 1.5rem 1.25rem 3rem;
		max-width: 1400px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   TYPOGRAPHY
	   ═══════════════════════════════════════════════════════════════ */
	.eyebrow {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #10b981;
		background: rgba(16, 185, 129, 0.08);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		font-family: 'JetBrains Mono', monospace;
	}
	.eyebrow--center {
		display: block;
		text-align: center;
		margin: 0 auto 0.5rem;
		width: fit-content;
	}
	h1,
	h2,
	h3 {
		font-family: 'Fraunces', Georgia, serif;
		color: #0f1f1a;
		letter-spacing: -0.01em;
	}
	.mono {
		font-family: 'JetBrains Mono', monospace;
	}
	.muted {
		color: #9a9a9a;
		font-size: 0.82rem;
	}
	.muted-inline {
		color: #9a9a9a;
		font-weight: 400;
		font-size: 0.78rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   HERO
	   ═══════════════════════════════════════════════════════════════ */
	.page-hero {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 24px;
		padding: 1.75rem 1.75rem 1.25rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.hero-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}
	.hero-left {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		flex: 1;
		min-width: 280px;
	}
	.hero-text {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.hero-text h1 {
		font-size: clamp(1.6rem, 3.5vw, 2.1rem);
		font-weight: 500;
		line-height: 1.15;
		margin: 0;
	}
	.hero-text p {
		font-size: 0.92rem;
		line-height: 1.6;
		color: #4a4a4a;
		margin: 0;
		max-width: 540px;
	}
	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		flex-shrink: 0;
	}
	.hero-stats {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
		padding-top: 1.1rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		font-family: 'JetBrains Mono', monospace;
	}
	.stat-item {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.stat-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6b6b6b;
	}
	.stat-value {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f1f1a;
	}
	.stat-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.stat-dot--emerald {
		background: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}
	.stat-dot--amber {
		background: #f59e0b;
	}
	.stat-dot--red {
		background: #ef4444;
	}
	.stat-sep {
		color: #c9c4ba;
	}
	.stat-item--active {
		color: #10b981;
	}
	.stat-item--active .stat-label {
		color: #10b981;
	}
	.stat-item--active .stat-value {
		color: #10b981;
	}

	/* ═══════════════════════════════════════════════════════════════
	   SECTION HEAD (numbered)
	   ═══════════════════════════════════════════════════════════════ */
	.section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.section-head h2 {
		font-size: 1.4rem;
		font-weight: 500;
		margin: 0.35rem 0 0.25rem;
	}
	.section-head p {
		font-size: 0.85rem;
		color: #4a4a4a;
		margin: 0;
		max-width: 540px;
		line-height: 1.5;
	}
	.section-head-right {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	/* ═══════════════════════════════════════════════════════════════
	   FILTERS BAR
	   ═══════════════════════════════════════════════════════════════ */
	.filters-bar {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 16px;
		padding: 0.85rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 240px;
	}
	.search-icon {
		position: absolute;
		left: 0.9rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: #9a9a9a;
		pointer-events: none;
	}
	.search-input {
		width: 100%;
		padding: 0.6rem 0.9rem 0.6rem 2.5rem;
		font-family: inherit;
		font-size: 0.88rem;
		color: #1a1a1a;
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.search-input::placeholder {
		color: #9a9a9a;
	}
	.search-input:focus {
		background: white;
		border-color: rgba(16, 185, 129, 0.4);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
	}

	.filter-group {
		display: flex;
		gap: 0.35rem;
		padding: 0.25rem;
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 12px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.8rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #4a4a4a;
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.chip:hover {
		color: #0f1f1a;
	}
	.chip--active {
		background: white;
		color: #065f46;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}
	.chip--sm {
		padding: 0.35rem 0.7rem;
		font-size: 0.75rem;
	}
	.chip-count {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0 0.4rem;
		min-width: 1.4rem;
		text-align: center;
		background: rgba(0, 0, 0, 0.06);
		border-radius: 4px;
		color: #6b6b6b;
	}
	.chip--active .chip-count {
		background: rgba(16, 185, 129, 0.12);
		color: #047857;
	}
	.chip-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.chip-dot--emerald {
		background: #10b981;
	}

	.select {
		padding: 0.55rem 0.85rem;
		font-family: inherit;
		font-size: 0.82rem;
		color: #1a1a1a;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
		min-width: 160px;
	}
	.select:focus {
		border-color: rgba(16, 185, 129, 0.4);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
	}

	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #6b6b6b;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.clear-btn:hover {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.04);
	}

	/* ═══════════════════════════════════════════════════════════════
	   USERS GRID
	   ═══════════════════════════════════════════════════════════════ */
	.users-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.1rem;
	}
	@media (min-width: 640px) {
		.users-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (min-width: 1024px) {
		.users-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.user-card {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 20px;
		padding: 1.25rem;
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.user-card:hover,
	.user-card--focus {
		transform: translateY(-3px);
		border-color: rgba(16, 185, 129, 0.3);
		box-shadow: 0 12px 32px rgba(16, 185, 129, 0.12);
	}
	.user-card.status-inactive {
		opacity: 0.78;
	}

	.user-head {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.user-head-text {
		flex: 1;
		min-width: 0;
	}
	.user-head-text h3 {
		font-size: 1.02rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
		color: #0f1f1a;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.badge-self {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #047857;
		background: rgba(16, 185, 129, 0.1);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
	}
	.user-email {
		display: block;
		font-size: 0.78rem;
		color: #6b6b6b;
		margin-top: 0.2rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Avatar */
	.avatar {
		position: relative;
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		border-radius: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.avatar--online {
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(5, 150, 105, 0.2));
		color: #065f46;
	}
	.avatar--offline {
		background: linear-gradient(135deg, rgba(75, 85, 99, 0.12), rgba(55, 65, 81, 0.16));
		color: #374151;
	}
	.avatar--inactive {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(220, 38, 38, 0.14));
		color: #b91c1c;
	}
	.avatar-dot {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2.5px solid white;
	}
	.avatar-dot--online {
		background: #10b981;
		box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
		animation: pulse-online 2s ease-in-out infinite;
	}
	.avatar-dot--offline {
		background: #9ca3af;
	}
	.avatar-dot--inactive {
		background: #ef4444;
	}
	@keyframes pulse-online {
		0%, 100% {
			box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
		}
		50% {
			box-shadow: 0 0 0 4px rgba(16, 185, 129, 0);
		}
	}

	/* Status toggle (enable/disable) */
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
	.user-status-toggle:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.user-status-toggle--on {
		background: linear-gradient(135deg, #10b981, #059669);
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

	/* Areas */
	.user-areas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.area-chip {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #1e40af;
		background: rgba(59, 130, 246, 0.08);
		padding: 0.18rem 0.5rem;
		border-radius: 5px;
	}
	.area-chip--sm {
		font-size: 0.62rem;
		padding: 0.15rem 0.4rem;
	}

	/* Data */
	.user-data {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin: 0;
		padding: 0.7rem 0;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.user-data > div {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
	}
	.user-data dt {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
		margin: 0;
	}
	.user-data dd {
		margin: 0;
		font-size: 0.85rem;
		color: #0f1f1a;
		font-weight: 500;
	}
	.last-access--online {
		color: #047857;
		font-weight: 600;
	}
	.last-access--inactive {
		color: #b91c1c;
	}

	/* Footer */
	.user-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.user-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #10b981;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: gap 0.2s;
	}
	.user-link svg {
		width: 14px;
		height: 14px;
	}
	.user-card:hover .user-link {
		gap: 0.6rem;
	}
	.user-actions {
		display: flex;
		gap: 0.25rem;
	}
	.icon-btn {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 8px;
		color: #6b6b6b;
		cursor: pointer;
		transition: all 0.2s;
	}
	.icon-btn svg {
		width: 14px;
		height: 14px;
	}
	.icon-btn:hover {
		color: #10b981;
		border-color: rgba(16, 185, 129, 0.3);
		background: rgba(16, 185, 129, 0.06);
	}
	.icon-btn--danger:hover {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.06);
	}

	/* ═══════════════════════════════════════════════════════════════
	   SESSIONS LIST
	   ═══════════════════════════════════════════════════════════════ */
	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.session-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 0.9rem 1.1rem;
		transition: all 0.2s;
	}
	.session-card:hover {
		border-color: rgba(16, 185, 129, 0.2);
	}
	.session-card--closed {
		opacity: 0.7;
	}
	.session-main {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex: 1;
		min-width: 0;
	}
	.session-avatar {
		position: relative;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(5, 150, 105, 0.18));
		color: #065f46;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.78rem;
		font-weight: 700;
	}
	.session-dot {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2.5px solid white;
	}
	.session-dot--active {
		background: #10b981;
	}
	.session-dot--closed {
		background: #9ca3af;
	}
	.session-text {
		flex: 1;
		min-width: 0;
	}
	.session-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.session-row strong {
		font-size: 0.92rem;
		color: #0f1f1a;
		font-weight: 600;
	}
	.session-mail {
		font-size: 0.78rem;
		color: #6b6b6b;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.session-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 0.25rem;
	}
	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.74rem;
		color: #6b6b6b;
	}
	.meta-item svg {
		color: #9a9a9a;
		flex-shrink: 0;
	}
	.meta-item--emerald {
		color: #047857;
	}
	.meta-item--emerald svg {
		color: #10b981;
	}
	.session-side {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex-shrink: 0;
	}
	.session-time {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.15rem;
	}
	.session-time small {
		font-size: 0.7rem;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
	}

	/* Pulse para sesiones activas */
	.pulse-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #10b981;
		display: inline-block;
		margin-right: 0.35rem;
		animation: pulse 1.5s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	/* ═══════════════════════════════════════════════════════════════
	   INVITATIONS LIST
	   ═══════════════════════════════════════════════════════════════ */
	.inv-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.inv-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 1rem 1.1rem;
		transition: all 0.2s;
	}
	.inv-card:hover {
		border-color: rgba(16, 185, 129, 0.2);
	}
	.inv-card--expirada,
	.inv-card--revocada,
	.inv-card--reemplazada {
		opacity: 0.65;
	}
	.inv-main {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		flex: 1;
		min-width: 0;
	}
	.inv-icon {
		flex-shrink: 0;
		width: 38px;
		height: 38px;
		border-radius: 12px;
		background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(217, 119, 6, 0.18));
		color: #92400e;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.inv-icon svg {
		width: 18px;
		height: 18px;
	}
	.inv-text {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.inv-correo {
		font-size: 0.92rem;
		color: #0f1f1a;
		font-weight: 600;
	}
	.inv-cargo {
		font-size: 0.78rem;
		color: #4a4a4a;
	}
	.inv-areas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.15rem;
	}
	.inv-by {
		font-size: 0.72rem;
		color: #9a9a9a;
		margin-top: 0.15rem;
	}
	.inv-side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.inv-actions {
		display: flex;
		gap: 0.4rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ESTADO PILLS
	   ═══════════════════════════════════════════════════════════════ */
	.estado-pill {
		display: inline-flex;
		align-items: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.25rem 0.55rem;
		border-radius: 5px;
		white-space: nowrap;
	}
	.estado-pill--emerald {
		color: #047857;
		background: rgba(16, 185, 129, 0.1);
	}
	.estado-pill--amber {
		color: #b45309;
		background: rgba(245, 158, 11, 0.1);
	}
	.estado-pill--red {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.1);
	}
	.estado-pill--gray {
		color: #6b6b6b;
		background: rgba(0, 0, 0, 0.06);
	}

	/* ═══════════════════════════════════════════════════════════════
	   ESTADOS GENERALES
	   ═══════════════════════════════════════════════════════════════ */
	.state-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 3rem 1.5rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 20px;
		color: #6b6b6b;
		font-size: 0.88rem;
	}
	.spin-ring {
		width: 30px;
		height: 30px;
		border: 2.5px solid rgba(16, 185, 129, 0.15);
		border-top-color: #10b981;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 3rem 1.5rem;
		background: white;
		border: 1px dashed rgba(0, 0, 0, 0.12);
		border-radius: 24px;
		text-align: center;
	}
	.empty-state h3 {
		font-size: 1.3rem;
		font-weight: 500;
		margin: 0.25rem 0 0;
	}
	.empty-state p {
		font-size: 0.88rem;
		color: #4a4a4a;
		max-width: 420px;
		margin: 0 0 1rem;
		line-height: 1.55;
	}
	.empty-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(5, 150, 105, 0.12));
		color: #10b981;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.4rem;
		box-shadow: 0 6px 20px rgba(16, 185, 129, 0.12);
	}
	.empty-icon svg {
		width: 28px;
		height: 28px;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ALERT
	   ═══════════════════════════════════════════════════════════════ */
	.alert {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.8rem 1rem;
		border-radius: 12px;
		font-size: 0.85rem;
	}
	.alert-error {
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.2);
		color: #991b1b;
	}
	.alert-error svg {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		color: #dc2626;
	}
	.alert strong {
		font-weight: 600;
	}

	/* ═══════════════════════════════════════════════════════════════
	   BOTONES
	   ═══════════════════════════════════════════════════════════════ */
	.btn-primary,
	.btn-secondary,
	.btn-danger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.65rem 1.15rem;
		font-family: 'Inter Tight', system-ui, sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 11px;
		cursor: pointer;
		transition: all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.btn-primary {
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		box-shadow: 0 4px 16px rgba(16, 185, 129, 0.28);
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
	}
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.btn-secondary {
		background: white;
		color: #1a1a1a;
		border-color: rgba(0, 0, 0, 0.12);
	}
	.btn-secondary:hover:not(:disabled) {
		background: #faf7f2;
		border-color: rgba(0, 0, 0, 0.2);
	}
	.btn-secondary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.btn-secondary--sm {
		padding: 0.45rem 0.85rem;
		font-size: 0.78rem;
	}
	.btn-danger {
		background: linear-gradient(135deg, #dc2626, #b91c1c);
		color: white;
		box-shadow: 0 4px 16px rgba(220, 38, 38, 0.28);
	}
	.btn-danger:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(220, 38, 38, 0.4);
	}
	.btn-primary svg,
	.btn-secondary svg,
	.btn-danger svg {
		width: 15px;
		height: 15px;
	}
	.spin {
		width: 14px;
		height: 14px;
		animation: spin 0.8s linear infinite;
	}

	/* ═══════════════════════════════════════════════════════════════
	   LINK BUTTONS (reenviar, revocar, ver todas)
	   ═══════════════════════════════════════════════════════════════ */
	.link-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #10b981;
		background: none;
		border: none;
		padding: 0.25rem 0.4rem;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.link-btn:hover {
		background: rgba(16, 185, 129, 0.08);
	}
	.link-btn--danger {
		color: #dc2626;
	}
	.link-btn--danger:hover {
		background: rgba(220, 38, 38, 0.06);
	}

	/* ═══════════════════════════════════════════════════════════════
	   MODALES
	   ═══════════════════════════════════════════════════════════════ */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: linear-gradient(135deg, rgba(15, 31, 26, 0.4), rgba(10, 20, 16, 0.55));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		overflow-y: auto;
	}
	.modal {
		width: 100%;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 24px;
		padding: 1.5rem 1.5rem 1.25rem;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.modal--sm {
		max-width: 420px;
	}
	.modal--md {
		max-width: 560px;
	}
	.modal-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.modal-head h2 {
		font-size: 1.4rem;
		font-weight: 500;
		margin: 0.35rem 0 0;
		color: #0f1f1a;
	}
	.modal-title {
		font-size: 1.3rem;
		font-weight: 500;
		margin: 0.35rem 0 0;
		color: #0f1f1a;
		font-family: 'Fraunces', Georgia, serif;
	}
	.modal-desc {
		font-size: 0.9rem;
		line-height: 1.6;
		color: #4a4a4a;
		margin: 0;
	}
	.modal-desc strong {
		color: #0f1f1a;
		font-weight: 600;
	}
	.modal-close {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 8px;
		color: #6b6b6b;
		cursor: pointer;
		transition: all 0.2s;
	}
	.modal-close svg {
		width: 16px;
		height: 16px;
	}
	.modal-close:hover {
		color: #0f1f1a;
		border-color: rgba(0, 0, 0, 0.2);
	}
	.modal-icon {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.5rem;
	}
	.modal-icon svg {
		width: 26px;
		height: 26px;
	}
	.modal-icon--danger {
		background: rgba(220, 38, 38, 0.08);
		color: #dc2626;
		border: 1px solid rgba(220, 38, 38, 0.15);
	}
	.modal-icon--emerald {
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
	}
	.modal-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.modal-foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: flex-end;
		padding-top: 1rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		margin-top: 0.25rem;
	}

	/* Form fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	@media (min-width: 540px) {
		.field-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.field-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #0f1f1a;
	}
	.field-required {
		color: #dc2626;
		margin-left: 0.1rem;
	}
	.input {
		width: 100%;
		padding: 0.6rem 0.85rem;
		font-family: inherit;
		font-size: 0.88rem;
		color: #1a1a1a;
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.input::placeholder {
		color: #9a9a9a;
	}
	.input:focus {
		background: white;
		border-color: rgba(16, 185, 129, 0.4);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
	}

	/* Area picker (chips) */
	.area-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.area-pill {
		font-family: 'Inter Tight', system-ui, sans-serif;
		font-size: 0.78rem;
		font-weight: 600;
		color: #4a4a4a;
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.08);
		padding: 0.45rem 0.85rem;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.area-pill:hover {
		border-color: rgba(0, 0, 0, 0.15);
		color: #0f1f1a;
	}
	.area-pill--active {
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.14));
		color: #065f46;
		border-color: rgba(16, 185, 129, 0.35);
	}

	/* Permisos */
	.perm-bulk {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1rem;
		background: #faf7f2;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.06);
	}
	.perm-bulk-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6b6b6b;
	}
	.perm-bulk-btns {
		display: flex;
		gap: 0.4rem;
	}
	.perm-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		max-height: 360px;
		overflow-y: auto;
		padding: 0.25rem;
	}
	.perm-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.7rem 0.9rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		font-family: inherit;
	}
	.perm-row:hover {
		border-color: rgba(0, 0, 0, 0.15);
	}
	.perm-row--active {
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(5, 150, 105, 0.1));
		border-color: rgba(16, 185, 129, 0.25);
	}
	.perm-row-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: #0f1f1a;
	}

	/* Card icon (hero) */
	.card-icon {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: linear-gradient(135deg, #10b981, #059669);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
	}
	.card-icon svg {
		width: 24px;
		height: 24px;
	}

	/* ═══════════════════════════════════════════════════════════════
	   PERMISO DE BONOS — sección de otorgamiento individual
	   ═══════════════════════════════════════════════════════════════ */
	.alert-block {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-radius: 14px;
		background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.03));
		border: 1px solid rgba(245, 158, 11, 0.25);
		color: #92400e;
	}
	.alert-block svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		margin-top: 2px;
	}
	.alert-block p {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.bonos-stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1.25rem;
		border-radius: 12px;
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(16, 185, 129, 0.01));
		border: 1px solid rgba(16, 185, 129, 0.15);
		margin-bottom: 1rem;
	}
	.bonos-stat {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.bonos-stat-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.bonos-stat-dot--emerald {
		background: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
	}
	.bonos-stat-dot--gray {
		background: #9ca3af;
	}
	.bonos-stat-label {
		display: block;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted, #6b7280);
	}
	.bonos-stat-value {
		display: block;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--bg-charcoal, #1a1a1a);
		line-height: 1.1;
	}
	.bonos-stat-sep {
		color: var(--text-very-muted, #d1d5db);
		font-size: 0.875rem;
	}

	.bonos-bulk-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1.25rem;
		border-radius: 12px;
		background: var(--bg-base, #fafaf9);
		border: 1px solid var(--border-subtle, #f0f0ee);
		margin: 0 0 1rem 0;
	}

	.btn-bonos-grant,
	.btn-bonos-revoke {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.875rem;
		border-radius: 10px;
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.btn-bonos-grant {
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
	}
	.btn-bonos-grant:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
	}
	.btn-bonos-revoke {
		background: white;
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.3);
	}
	.btn-bonos-revoke:hover:not(:disabled) {
		background: rgba(220, 38, 38, 0.06);
		border-color: #dc2626;
	}
	.btn-bonos-grant:disabled,
	.btn-bonos-revoke:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.bonos-btn-count {
		opacity: 0.85;
		font-weight: 500;
	}

	.bonos-select-all {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: var(--text-secondary, #4b5563);
		cursor: pointer;
		user-select: none;
	}
	.bonos-select-all input {
		accent-color: #10b981;
	}

	.bonos-selected-count {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		background: rgba(16, 185, 129, 0.08);
		color: #047857;
		font-size: 0.6875rem;
		font-weight: 600;
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.bonos-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.625rem;
	}

	.bonos-card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: 14px;
		background: var(--bg-surface, #ffffff);
		border: 1.5px solid var(--border-subtle, #f0f0ee);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.bonos-card:hover {
		border-color: rgba(16, 185, 129, 0.35);
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
	}
	.bonos-card--active {
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.04), rgba(16, 185, 129, 0.01));
		border-color: rgba(16, 185, 129, 0.35);
	}
	.bonos-card--selected {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.06), rgba(59, 130, 246, 0.02));
		border-color: #3b82f6;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}
	.bonos-card-check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		accent-color: #3b82f6;
		cursor: pointer;
	}
	.bonos-card-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		position: relative;
	}
	.bonos-card-avatar.avatar--online {
		background: linear-gradient(135deg, #10b981, #059669);
	}
	.bonos-card-avatar.avatar--inactive {
		background: linear-gradient(135deg, #9ca3af, #6b7280);
		opacity: 0.7;
	}
	.bonos-card-text {
		flex: 1;
		min-width: 0;
	}
	.bonos-card-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.bonos-card-row strong {
		font-size: 0.8125rem;
		color: var(--text-primary, #1a1a1a);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bonos-card-mail {
		display: block;
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9ca3af);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.bonos-card-cargo {
		display: block;
		font-size: 0.6875rem;
		color: var(--text-muted, #6b7280);
		font-style: italic;
	}
	.bonos-card-state {
		flex-shrink: 0;
	}
	.bonos-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.bonos-pill--emerald {
		background: rgba(16, 185, 129, 0.1);
		color: #047857;
		border: 1px solid rgba(16, 185, 129, 0.3);
	}
	.bonos-pill--gray {
		background: rgba(156, 163, 175, 0.1);
		color: #6b7280;
		border: 1px solid rgba(156, 163, 175, 0.25);
	}
	.bonos-pill--emerald svg {
		color: #059669;
	}
</style>
