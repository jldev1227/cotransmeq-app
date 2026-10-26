<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import { mascota } from '$lib/mascot';
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Mail, Plus, Ban } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { apiClient } from '$lib/api/apiClient';
	import { usuariosAPI } from '$lib/api/usuarios';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from '$lib/stores/toast';
	import { AREA_LABELS, checkAccess, type AccessLevel, type Area } from '$lib/config/permissions';
	import PermisosRutasPicker from '$lib/components/permisos/PermisosRutasPicker.svelte';

	/// Pantalla huérfana: no está en el menú y `/dashboard/personal`
	/// cubre lo mismo —presencia, invitaciones y alta manual—. Se conserva con
	/// la cáscara actual mientras se decide retirarla; no le añadas funciones.

	// ─── Tipos ────────────────────────────────────────────────────────────────
	interface UsuarioPresencia {
		id: string;
		nombre: string;
		correo: string;
		area: string[];
		cargo?: string | null;
		role?: string | null;
		activo: boolean;
		ultimo_acceso?: string | null;
		en_linea: boolean;
		es_invitado?: boolean;
		invitado_por_id?: string | null;
	}

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

	// ─── Estado ───────────────────────────────────────────────────────────────
	let usuarios = $state<UsuarioPresencia[]>([]);
	let invitaciones = $state<Invitacion[]>([]);
	let onlineIds = $state(new Set<string>());
	let cargando = $state(true);
	let cargandoInv = $state(true);
	/// Sin estos dos, un fallo de red pintaba «No hay usuarios registrados»,
	/// que no es lo mismo que no poder leerlos.
	let errorUsuarios = $state<string | null>(null);
	let errorInv = $state<string | null>(null);
	let tabActiva = $state<'usuarios' | 'invitaciones'>('usuarios');

	// Modal invitar
	let modalAbierto = $state(false);
	let enviando = $state(false);
	let formCorreo = $state('');
	let formAreas = $state<string[]>([]);
	let formCargo = $state('');
	let errorModal = $state('');

	// Modal alta manual
	let modalCrearAbierto = $state(false);
	let creando = $state(false);
	let errorCrear = $state('');
	let nuevoNombre = $state('');
	let nuevoCorreo = $state('');
	let nuevoPassword = $state('');
	let nuevoPassword2 = $state('');
	let mostrarPassword = $state(false);
	let nuevoTelefono = $state('');
	let nuevoCargo = $state('');
	let nuevoRole = $state('usuario');
	let nuevoAreas = $state<string[]>([]);
	let nuevoPermisosRutas = $state<Record<string, AccessLevel> | null>(null);

	const AREAS = Object.entries(AREA_LABELS).map(([value, label]) => ({ value, label }));

	/// Valores del enum `enum_users_role` del backend. Si aquí apareciera uno que
	/// el enum no tiene, el POST revienta en la capa de base de datos, no en la
	/// validación, y el error que llega a pantalla no dice cuál es el problema.
	const ROLES = [
		{ value: 'usuario', label: 'Usuario' },
		{ value: 'consulta', label: 'Solo consulta' },
		{ value: 'admin', label: 'Administrador' },
		{ value: 'liquidador', label: 'Liquidador' },
		{ value: 'facturador', label: 'Facturador' },
		{ value: 'aprobador', label: 'Aprobador' },
		{ value: 'gestor_flota', label: 'Gestor de flota' },
		{ value: 'gestor_nomina', label: 'Gestor de nómina' },
		{ value: 'gestor_servicio', label: 'Gestor de servicios' },
		{ value: 'gestor_planillas', label: 'Gestor de planillas' },
		{ value: 'kilometraje', label: 'Kilometraje' }
	];

	/// Semáforos en hex: cotransmeq remapea `emerald-*` a naranja y «en línea»
	/// tiene que seguir leyéndose como verde.
	const COLOR_EN_LINEA = '#16a34a';
	const COLOR_DESCONECTADO = '#9ca3af';
	const COLOR_ERROR = '#dc2626';
	const COLOR_PENDIENTE = '#d97706';

	const COLUMNAS_USUARIOS: ColumnDef<UsuarioPresencia, any>[] = [
		{ id: 'usuario', header: 'Usuario' },
		{ id: 'areas', header: 'Área(s)' },
		{ id: 'cargo', header: 'Cargo' },
		{ id: 'acceso', header: 'Último acceso' },
		{ id: 'estado', header: 'Estado', size: 150 }
	];

	const COLUMNAS_INVITACIONES: ColumnDef<Invitacion, any>[] = [
		{ id: 'correo', header: 'Correo invitado' },
		{ id: 'areas', header: 'Área(s)' },
		{ id: 'invitador', header: 'Invitado por' },
		{ id: 'enviada', header: 'Enviada' },
		{ id: 'estado', header: 'Estado', size: 140 },
		{ id: 'acciones', header: '', size: 80 }
	];

	const pendientes = $derived(invitaciones.filter((i) => i.estado === 'pendiente').length);

	const conteos = $derived([
		{ clave: 'usuarios', etiqueta: 'Usuarios', valor: usuarios.length },
		{
			clave: 'en-linea',
			etiqueta: 'En línea',
			valor: usuarios.filter((u) => u.en_linea).length,
			color: COLOR_EN_LINEA
		},
		{
			clave: 'pendientes',
			etiqueta: 'Invitaciones pendientes',
			valor: pendientes,
			color: COLOR_PENDIENTE
		}
	]);

	const PESTANAS = $derived([
		{ valor: 'usuarios', etiqueta: `Usuarios${usuarios.length ? ` (${usuarios.length})` : ''}` },
		{ valor: 'invitaciones', etiqueta: `Invitaciones${pendientes ? ` (${pendientes})` : ''}` }
	]);

	// ─── Nivel de acceso propio ───────────────────────────────────────────────
	/// La página se pinta también para quien la tiene en `read` (vía lista blanca
	/// de rutas): en ese caso se ve el directorio, pero no las acciones que
	/// escriben. Ofrecer un botón que la API va a rechazar con 403 es peor que
	/// no tenerlo.
	const nivelDirectorio = $derived.by<AccessLevel | null>(() => {
		const u = $authStore.user;
		if (!u) return null;
		const { level } = checkAccess(u.role || u.rol, u.area, 'directorio', u.permisos_rutas);
		return level;
	});
	const puedeEscribir = $derived(nivelDirectorio === 'full');

	// ─── Carga de datos ───────────────────────────────────────────────────────
	async function cargarUsuarios() {
		try {
			cargando = true;
			const res = await apiClient.get('/api/usuarios/presencia');
			usuarios = res.data;
			onlineIds = new Set(usuarios.filter((u) => u.en_linea).map((u) => u.id));
			errorUsuarios = null;
		} catch (e) {
			toast.error('Error cargando usuarios');
			errorUsuarios = 'No se pudo cargar la lista de usuarios.';
		} finally {
			cargando = false;
		}
	}

	async function cargarInvitaciones() {
		try {
			cargandoInv = true;
			const res = await apiClient.get('/api/invitaciones');
			invitaciones = res.data;
			errorInv = null;
		} catch {
			toast.error('Error cargando invitaciones');
			errorInv = 'No se pudieron cargar las invitaciones.';
		} finally {
			cargandoInv = false;
		}
	}

	// ─── Socket: presencia en tiempo real ─────────────────────────────────────
	function onOnline(ids: string[]) {
		onlineIds = new Set(ids);
		usuarios = usuarios.map((u) => ({ ...u, en_linea: onlineIds.has(u.id) }));
	}

	onMount(() => {
		cargarUsuarios();
		cargarInvitaciones();

		// Anunciar presencia al servidor
		const user = $authStore.user;
		if (user?.id) socketUtils.emit('join-dashboard', user.id);

		socketUtils.on('usuarios-online', onOnline);
	});

	onDestroy(() => {
		socketUtils.emit('leave-dashboard');
		socketUtils.off('usuarios-online', onOnline);
	});

	// ─── Modal invitación ─────────────────────────────────────────────────────
	function abrirModal() {
		formCorreo = '';
		formAreas = [];
		formCargo = '';
		errorModal = '';
		modalAbierto = true;
	}

	function toggleArea(value: string) {
		if (formAreas.includes(value)) {
			formAreas = formAreas.filter((a) => a !== value);
		} else {
			formAreas = [...formAreas, value];
		}
	}

	async function enviarInvitacion() {
		errorModal = '';
		if (!formCorreo) {
			errorModal = 'Ingresa un correo';
			return;
		}
		if (formAreas.length === 0) {
			errorModal = 'Selecciona al menos un área';
			return;
		}
		try {
			enviando = true;
			await apiClient.post('/api/invitaciones', {
				correo: formCorreo,
				area: formAreas,
				cargo: formCargo || undefined
			});
			toast.success('Invitación enviada correctamente');
			modalAbierto = false;
			cargarInvitaciones();
		} catch (e: any) {
			errorModal = e?.response?.data?.error || 'Error enviando invitación';
		} finally {
			enviando = false;
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

	// ─── Modal alta manual ────────────────────────────────────────────────────
	function abrirModalCrear() {
		nuevoNombre = '';
		nuevoCorreo = '';
		nuevoPassword = '';
		nuevoPassword2 = '';
		mostrarPassword = false;
		nuevoTelefono = '';
		nuevoCargo = '';
		nuevoRole = 'usuario';
		nuevoAreas = [];
		nuevoPermisosRutas = null;
		errorCrear = '';
		modalCrearAbierto = true;
	}

	function toggleAreaNuevo(value: string) {
		if (nuevoAreas.includes(value)) {
			nuevoAreas = nuevoAreas.filter((a) => a !== value);
		} else {
			nuevoAreas = [...nuevoAreas, value];
		}
	}

	async function crearUsuario() {
		errorCrear = '';
		if (!nuevoNombre.trim()) {
			errorCrear = 'Ingresa el nombre completo';
			return;
		}
		if (!nuevoCorreo.trim()) {
			errorCrear = 'Ingresa un correo';
			return;
		}
		if (nuevoPassword.length < 8) {
			errorCrear = 'La contraseña debe tener al menos 8 caracteres';
			return;
		}
		if (nuevoPassword !== nuevoPassword2) {
			errorCrear = 'Las contraseñas no coinciden';
			return;
		}
		if (nuevoAreas.length === 0) {
			errorCrear = 'Selecciona al menos un área';
			return;
		}

		try {
			creando = true;
			await usuariosAPI.crear({
				nombre: nuevoNombre.trim(),
				correo: nuevoCorreo.trim().toLowerCase(),
				password: nuevoPassword,
				telefono: nuevoTelefono.trim() || undefined,
				cargo: nuevoCargo.trim() || undefined,
				role: nuevoRole,
				area: nuevoAreas,
				// `{}` y `null` significan lo mismo para el backend («manda el
				// área»); se normaliza aquí para no guardar objetos vacíos.
				permisos_rutas:
					nuevoPermisosRutas && Object.keys(nuevoPermisosRutas).length > 0
						? nuevoPermisosRutas
						: null
			});
			toast.success(`${nuevoNombre.trim()} creado correctamente`);
			modalCrearAbierto = false;
			cargarUsuarios();
		} catch (e: any) {
			errorCrear =
				e?.response?.status === 404
					? 'El endpoint POST /api/usuarios todavía no existe en el backend'
					: e?.response?.data?.error || e?.response?.data?.message || 'Error creando usuario';
		} finally {
			creando = false;
		}
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────
	function formatFecha(fecha?: string | null) {
		if (!fecha) return 'Nunca';
		return new Intl.DateTimeFormat('es-CO', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(fecha));
	}

	/// Mismo reparto de colores que tenían las pastillas: pendiente en ámbar,
	/// aceptada en verde, expirada en rojo y el resto apagado.
	function estadoInvitacion(estado: string): { color: string; apagado: boolean } {
		switch (estado) {
			case 'pendiente':
				return { color: COLOR_PENDIENTE, apagado: false };
			case 'aceptada':
				return { color: COLOR_EN_LINEA, apagado: false };
			case 'expirada':
				return { color: COLOR_ERROR, apagado: false };
			default:
				return { color: COLOR_DESCONECTADO, apagado: true };
		}
	}

	function etiquetaArea(a: string): string {
		return AREA_LABELS[a as Area] ?? a;
	}
</script>

<svelte:head><title>Equipo · Cotransmeq</title></svelte:head>

<div class="dir-pagina eq-pagina" in:fade={{ duration: 400 }}>
	<!-- ─── Cabecera ─────────────────────────────────────────────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Equipo</h1>
			<p class="dir-desc">Usuarios del sistema, áreas y estado de presencia.</p>
			{#if !cargando}
				<div class="dir-conteos">
					<ResumenConteos {conteos} />
				</div>
			{/if}
		</div>
		<div class="dir-cabecera-acciones">
			{#if puedeEscribir}
				<button onclick={abrirModal} class="btn-secondary">
					<Mail class="h-4 w-4" />
					Invitar por correo
				</button>
				<button onclick={abrirModalCrear} class="btn-primary">
					<Plus class="h-4 w-4" />
					Crear manualmente
				</button>
			{:else if nivelDirectorio}
				<span class="eq-solo-consulta">Solo consulta</span>
			{/if}
		</div>
	</header>

	<!-- Los dos caminos de alta se confunden con facilidad; que la diferencia
	     (quién pone la contraseña) esté escrita evita crear cuentas a mano
	     cuando lo que se quería era mandar una invitación. -->
	{#if puedeEscribir}
		<div class="page-card eq-caminos">
			<div>
				<p class="eq-camino-titulo">Invitar por correo</p>
				<p class="eq-camino-texto">
					Se envía un enlace y <strong>el propio usuario elige su contraseña</strong>. No existe
					cuenta hasta que acepte la invitación.
				</p>
			</div>
			<div>
				<p class="eq-camino-titulo">Crear manualmente</p>
				<p class="eq-camino-texto">
					<strong>Tú pones la contraseña</strong> y se la entregas. La cuenta queda activa al instante,
					con las áreas y los permisos por ruta que le definas.
				</p>
			</div>
		</div>
	{/if}

	<!-- ─── Pestañas ──────────────────────────────────────────────────────── -->
	<div class="dir-filtros">
		<SegmentosFiltro
			etiqueta="Ver"
			opciones={PESTANAS}
			valor={tabActiva}
			onCambiar={(v) => (tabActiva = v as 'usuarios' | 'invitaciones')}
		/>
	</div>

	<!-- ─── Tab Usuarios ──────────────────────────────────────────────────── -->
	<!-- `TablaLista` lleva el scroll horizontal dentro de su marco y en el
	     móvil apila cada fila como tarjeta: la tabla anterior, con
	     `overflow-hidden`, cortaba las columnas de la derecha en un teléfono. -->
	{#if tabActiva === 'usuarios'}
		{#if cargando}
			<div class="page-card eq-marco">
				<CargaMascota texto="Cargando usuarios…" />
			</div>
		{:else if errorUsuarios && usuarios.length === 0}
			{@const img = mascota('advertencia')}
			<div class="page-card dir-vacio">
				<img src={img.src} alt={img.alt} width="418" height="418" />
				<h3>No se pudo cargar el equipo</h3>
				<p>{errorUsuarios} Revisa la conexión e inténtalo de nuevo.</p>
				<button class="btn-secondary" onclick={cargarUsuarios}>Reintentar</button>
			</div>
		{:else}
			<div class="dir-lista">
				<TablaLista
					columnas={COLUMNAS_USUARIOS}
					datos={usuarios}
					claveFila={(u) => u.id}
					etiqueta="Usuarios del sistema"
				>
					{#snippet celda({ columnaId, fila: u })}
						{#if columnaId === 'usuario'}
							<CeldaIdentidad
								titulo={u.nombre}
								subtitulo={u.correo}
								punto={u.en_linea ? COLOR_EN_LINEA : COLOR_DESCONECTADO}
							/>
						{:else if columnaId === 'areas'}
							{#if u.area?.length}
								<div class="eq-areas">
									{#each u.area as a}<span class="eq-area-pill">{etiquetaArea(a)}</span>{/each}
								</div>
							{:else}
								<span class="dir-nulo">—</span>
							{/if}
						{:else if columnaId === 'cargo'}
							{#if u.cargo}<span>{u.cargo}</span>{:else}<span class="dir-nulo">—</span>{/if}
						{:else if columnaId === 'acceso'}
							<span class="dir-celda--fecha">{formatFecha(u.ultimo_acceso)}</span>
						{:else if columnaId === 'estado'}
							{#if u.en_linea}
								<EstadoPunto etiqueta="En línea" color={COLOR_EN_LINEA} />
							{:else if !u.activo}
								<EstadoPunto etiqueta="Inactivo" color={COLOR_ERROR} />
							{:else}
								<EstadoPunto etiqueta="Desconectado" color={COLOR_DESCONECTADO} apagado />
							{/if}
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>No hay usuarios registrados</h3>
							<p>Cuando alguien acepte una invitación o se cree a mano, aparecerá aquí.</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
		{/if}
	{/if}

	<!-- ─── Tab Invitaciones ──────────────────────────────────────────────── -->
	{#if tabActiva === 'invitaciones'}
		{#if cargandoInv}
			<div class="page-card eq-marco">
				<CargaMascota texto="Cargando invitaciones…" />
			</div>
		{:else if errorInv && invitaciones.length === 0}
			{@const img = mascota('advertencia')}
			<div class="page-card dir-vacio">
				<img src={img.src} alt={img.alt} width="418" height="418" />
				<h3>No se pudieron cargar las invitaciones</h3>
				<p>{errorInv} Revisa la conexión e inténtalo de nuevo.</p>
				<button class="btn-secondary" onclick={cargarInvitaciones}>Reintentar</button>
			</div>
		{:else}
			<div class="dir-lista">
				<TablaLista
					columnas={COLUMNAS_INVITACIONES}
					datos={invitaciones}
					claveFila={(i) => i.id}
					etiqueta="Invitaciones enviadas"
				>
					{#snippet celda({ columnaId, fila: inv })}
						{#if columnaId === 'correo'}
							<div class="dir-celda">
								<span class="eq-correo">{inv.correo}</span>
								{#if inv.cargo}<small>{inv.cargo}</small>{/if}
							</div>
						{:else if columnaId === 'areas'}
							<div class="eq-areas">
								{#each inv.area as a}<span class="eq-area-pill">{etiquetaArea(a)}</span>{/each}
							</div>
						{:else if columnaId === 'invitador'}
							{#if inv.invitado_por?.nombre}
								<span>{inv.invitado_por.nombre}</span>
							{:else}
								<span class="dir-nulo">—</span>
							{/if}
						{:else if columnaId === 'enviada'}
							<span class="dir-celda--fecha">{formatFecha(inv.created_at)}</span>
						{:else if columnaId === 'estado'}
							{@const est = estadoInvitacion(inv.estado)}
							<EstadoPunto
								etiqueta={inv.estado.charAt(0).toUpperCase() + inv.estado.slice(1)}
								color={est.color}
								apagado={est.apagado}
							/>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'revocar',
										etiqueta: 'Revocar',
										icono: Ban,
										onClick: () => revocarInvitacion(inv.id),
										peligrosa: true,
										oculta: !(inv.estado === 'pendiente' && puedeEscribir)
									}
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>No se han enviado invitaciones aún</h3>
							<p>Las invitaciones por correo aparecen aquí hasta que se aceptan o vencen.</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
		{/if}
	{/if}
</div>

<!-- ─── Modal Invitar ──────────────────────────────────────────────────────── -->
<ModalBase
	open={modalAbierto}
	eyebrow="Equipo"
	title="Invitar usuario"
	subtitle="Recibirá un enlace por correo y elegirá su propia contraseña."
	tamano="sm"
	cerrarAlFondo={false}
	bloqueado={enviando}
	oncerrar={() => (modalAbierto = false)}
>
	<div class="eq-form">
		<!-- Correo -->
		<div class="eq-campo">
			<label for="inv-correo">Correo electrónico <span class="eq-req">*</span></label>
			<input
				id="inv-correo"
				type="email"
				bind:value={formCorreo}
				placeholder="usuario@empresa.com"
				class="eq-input"
			/>
		</div>

		<!-- Áreas -->
		<div class="eq-campo">
			<p class="eq-etiqueta">Área(s) <span class="eq-req">*</span></p>
			<div class="eq-areas-opciones">
				{#each AREAS as area (area.value)}
					<button
						type="button"
						onclick={() => toggleArea(area.value)}
						class="eq-area"
						class:eq-area--activa={formAreas.includes(area.value)}
						aria-pressed={formAreas.includes(area.value)}
					>
						{area.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Cargo (opcional) -->
		<div class="eq-campo">
			<label for="inv-cargo">Cargo <span class="eq-opcional">(opcional)</span></label>
			<input
				id="inv-cargo"
				type="text"
				bind:value={formCargo}
				placeholder="Ej: Analista de operaciones"
				class="eq-input"
			/>
		</div>

		{#if errorModal}
			<p class="eq-error" role="alert">{errorModal}</p>
		{/if}
	</div>

	{#snippet pie()}
		<button onclick={() => (modalAbierto = false)} disabled={enviando} class="btn-secondary">
			Cancelar
		</button>
		<button onclick={enviarInvitacion} disabled={enviando} class="btn-primary">
			{#if enviando}
				<span class="spinner eq-spinner" aria-hidden="true"></span>
				Enviando…
			{:else}
				Enviar invitación
			{/if}
		</button>
	{/snippet}
</ModalBase>

<!-- ─── Modal Crear manualmente ────────────────────────────────────────────── -->
<ModalBase
	open={modalCrearAbierto}
	eyebrow="Equipo"
	title="Crear usuario manualmente"
	subtitle="Tú defines la contraseña y se la entregas. La cuenta queda activa de inmediato — no se envía ninguna invitación."
	tamano="lg"
	cerrarAlFondo={false}
	bloqueado={creando}
	oncerrar={() => (modalCrearAbierto = false)}
>
	<div class="eq-form">
		<div class="eq-rejilla">
			<div class="eq-campo">
				<label for="new-nombre">Nombre completo <span class="eq-req">*</span></label>
				<input
					id="new-nombre"
					type="text"
					bind:value={nuevoNombre}
					placeholder="Ej: Jeffrey Rodríguez"
					class="eq-input"
				/>
			</div>
			<div class="eq-campo">
				<label for="new-correo">Correo electrónico <span class="eq-req">*</span></label>
				<input
					id="new-correo"
					type="email"
					bind:value={nuevoCorreo}
					placeholder="usuario@empresa.com"
					class="eq-input"
				/>
			</div>
			<div class="eq-campo">
				<label for="new-telefono">Teléfono <span class="eq-opcional">(opcional)</span></label>
				<input
					id="new-telefono"
					type="tel"
					bind:value={nuevoTelefono}
					placeholder="3001234567"
					class="eq-input"
				/>
			</div>
			<div class="eq-campo">
				<label for="new-cargo">Cargo <span class="eq-opcional">(opcional)</span></label>
				<input
					id="new-cargo"
					type="text"
					bind:value={nuevoCargo}
					placeholder="Ej: Técnico de mantenimiento"
					class="eq-input"
				/>
			</div>
		</div>

		<!-- Contraseña -->
		<fieldset class="eq-grupo">
			<legend>Contraseña</legend>
			<div class="eq-rejilla">
				<div class="eq-campo">
					<label for="new-pass">Contraseña <span class="eq-req">*</span></label>
					<input
						id="new-pass"
						type={mostrarPassword ? 'text' : 'password'}
						bind:value={nuevoPassword}
						autocomplete="new-password"
						placeholder="Mínimo 8 caracteres"
						class="eq-input"
					/>
				</div>
				<div class="eq-campo">
					<label for="new-pass2">Confirmar contraseña <span class="eq-req">*</span></label>
					<input
						id="new-pass2"
						type={mostrarPassword ? 'text' : 'password'}
						bind:value={nuevoPassword2}
						autocomplete="new-password"
						placeholder="Repite la contraseña"
						class="eq-input"
						aria-invalid={!!nuevoPassword2 && nuevoPassword !== nuevoPassword2}
					/>
				</div>
			</div>
			<label class="eq-check">
				<input type="checkbox" bind:checked={mostrarPassword} />
				Mostrar contraseña
			</label>
			{#if nuevoPassword2 && nuevoPassword !== nuevoPassword2}
				<p class="eq-error-linea">Las contraseñas no coinciden.</p>
			{/if}
		</fieldset>

		<!-- Rol -->
		<!-- 20rem es la medida del propio control, no un tope de página. -->
		<div class="eq-campo" style="max-width: 20rem;">
			<label for="new-role">Rol</label>
			<select id="new-role" bind:value={nuevoRole} class="eq-input">
				{#each ROLES as rol (rol.value)}
					<option value={rol.value}>{rol.label}</option>
				{/each}
			</select>
			{#if nuevoRole === 'admin'}
				<p class="eq-ayuda">
					Los administradores conservan acceso total: los permisos por ruta no se les aplican.
				</p>
			{/if}
		</div>

		<!-- Áreas -->
		<div class="eq-campo">
			<p class="eq-etiqueta">Área(s) <span class="eq-req">*</span></p>
			<div class="eq-areas-opciones">
				{#each AREAS as area (area.value)}
					<button
						type="button"
						onclick={() => toggleAreaNuevo(area.value)}
						class="eq-area"
						class:eq-area--activa={nuevoAreas.includes(area.value)}
						aria-pressed={nuevoAreas.includes(area.value)}
					>
						{area.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Permisos por ruta -->
		<div class="eq-campo">
			<p class="eq-etiqueta">Permisos por ruta</p>
			<PermisosRutasPicker
				idPrefix="crear"
				areas={nuevoAreas}
				role={nuevoRole}
				valor={nuevoPermisosRutas}
				onchange={(v) => (nuevoPermisosRutas = v)}
			/>
		</div>

		{#if errorCrear}
			<p class="eq-error" role="alert">{errorCrear}</p>
		{/if}
	</div>

	{#snippet pie()}
		<button onclick={() => (modalCrearAbierto = false)} disabled={creando} class="btn-secondary">
			Cancelar
		</button>
		<button onclick={crearUsuario} disabled={creando} class="btn-primary">
			{#if creando}
				<span class="spinner eq-spinner" aria-hidden="true"></span>
				Creando…
			{:else}
				Crear usuario
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	/* La página crece con su contenido: no es una lista con scroll propio. */
	.eq-pagina {
		height: auto;
		min-height: 100%;
	}
	.eq-marco {
		padding: 0;
	}
	.eq-solo-consulta {
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		background: rgba(37, 99, 235, 0.08);
		color: #1d4ed8;
		font-size: 0.75rem;
		font-weight: 700;
	}

	/* Las dos formas de alta, lado a lado si caben. */
	.eq-caminos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: 0.75rem 1.5rem;
		padding: 1rem 1.25rem;
	}
	.eq-camino-titulo {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.eq-camino-texto {
		margin: 0.15rem 0 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	/* ── Celdas ── */
	.eq-areas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.eq-area-pill {
		padding: 0.1rem 0.5rem;
		border-radius: 6px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		font-size: 0.72rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.eq-correo {
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	/* ── Formularios de los modales (mismo control que `.de-input`) ── */
	.eq-form {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.eq-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 1rem;
	}
	.eq-campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.eq-campo > label,
	.eq-etiqueta {
		margin: 0;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.eq-req {
		color: #dc2626;
	}
	.eq-opcional {
		font-weight: 400;
		color: var(--text-very-muted);
	}
	.eq-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.eq-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.eq-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.eq-input[aria-invalid='true'] {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.eq-areas-opciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.eq-area {
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}
	.eq-area:hover {
		border-color: var(--text-very-muted);
	}
	.eq-area--activa,
	.eq-area--activa:hover {
		border-color: var(--accion);
		background: var(--au-tint);
		color: var(--emerald-800);
	}
	.eq-grupo {
		margin: 0;
		padding: 0.9rem 1rem 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
	}
	.eq-grupo legend {
		padding: 0 0.35rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.eq-check {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.eq-check input {
		width: 16px;
		height: 16px;
		accent-color: var(--accion);
	}
	.eq-ayuda {
		margin: 0;
		font-size: 12px;
		color: #1d4ed8;
	}
	.eq-error-linea {
		margin: 0.5rem 0 0;
		font-size: 12px;
		font-weight: 600;
		color: #b42318;
	}
	.eq-error {
		margin: 0;
		padding: 0.55rem 0.75rem;
		border-radius: 10px;
		background: #fef2f2;
		color: #b42318;
		font-size: 0.85rem;
	}

	/* Spinner del botón mientras se envía: el global, a tamaño de texto. */
	.eq-spinner {
		width: 14px;
		height: 14px;
		border-width: 2px;
		border-color: rgba(255, 255, 255, 0.35);
		border-top-color: white;
	}
</style>
