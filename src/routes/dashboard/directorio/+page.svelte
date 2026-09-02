<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { apiClient } from '$lib/api/apiClient';
	import { usuariosAPI } from '$lib/api/usuarios';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from '$lib/stores/toast';
	import { AREA_LABELS, checkAccess, type AccessLevel, type Area } from '$lib/config/permissions';
	import PermisosRutasPicker from '$lib/components/permisos/PermisosRutasPicker.svelte';

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
		} catch (e) {
			toast.error('Error cargando usuarios');
		} finally {
			cargando = false;
		}
	}

	async function cargarInvitaciones() {
		try {
			cargandoInv = true;
			const res = await apiClient.get('/api/invitaciones');
			invitaciones = res.data;
		} catch {
			toast.error('Error cargando invitaciones');
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

	function estadoInvBadge(estado: string) {
		const map: Record<string, string> = {
			pendiente: 'bg-yellow-100 text-yellow-700',
			aceptada: 'bg-green-100 text-green-700',
			expirada: 'bg-red-100 text-red-700',
			revocada: 'bg-gray-100 text-gray-500',
			reemplazada: 'bg-gray-100 text-gray-500'
		};
		return map[estado] ?? 'bg-gray-100 text-gray-500';
	}

	/** Cierra el modal solo si el clic cayó en el backdrop, no dentro de la caja. */
	function cerrarSiBackdrop(e: MouseEvent, cerrar: () => void) {
		if (e.target === e.currentTarget) cerrar();
	}
</script>

<svelte:head><title>Equipo · Cotransmeq</title></svelte:head>

<!-- ─── Encabezado ─────────────────────────────────────────────────────── -->
<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Equipo</h1>
			<p class="mt-1 text-sm text-gray-500">Usuarios del sistema, áreas y estado de presencia</p>
		</div>
		{#if puedeEscribir}
			<div class="flex flex-wrap items-center gap-2">
				<button
					onclick={abrirModal}
					class="inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-white px-4 py-2.5 text-sm font-semibold text-orange-700 shadow-sm transition-colors hover:bg-orange-50"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
						/>
					</svg>
					Invitar por correo
				</button>
				<button
					onclick={abrirModalCrear}
					class="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Crear manualmente
				</button>
			</div>
		{:else if nivelDirectorio}
			<span class="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
				Solo consulta
			</span>
		{/if}
	</div>

	<!-- Los dos caminos de alta se confunden con facilidad; que la diferencia
	     (quién pone la contraseña) esté escrita evita crear cuentas a mano
	     cuando lo que se quería era mandar una invitación. -->
	{#if puedeEscribir}
		<div class="flex flex-wrap gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm">
			<div class="min-w-[16rem] flex-1">
				<p class="font-semibold text-gray-800">Invitar por correo</p>
				<p class="mt-0.5 text-xs leading-relaxed text-gray-500">
					Se envía un enlace y <strong>el propio usuario elige su contraseña</strong>. No existe
					cuenta hasta que acepte la invitación.
				</p>
			</div>
			<div class="hidden w-px bg-gray-200 sm:block"></div>
			<div class="min-w-[16rem] flex-1">
				<p class="font-semibold text-gray-800">Crear manualmente</p>
				<p class="mt-0.5 text-xs leading-relaxed text-gray-500">
					<strong>Tú pones la contraseña</strong> y se la entregas. La cuenta queda activa al instante,
					con las áreas y los permisos por ruta que le definas.
				</p>
			</div>
		</div>
	{/if}

	<!-- ─── Tabs ──────────────────────────────────────────────────────────── -->
	<div class="border-b border-gray-200">
		<nav class="-mb-px flex gap-6">
			{#each [{ id: 'usuarios', label: 'Usuarios', count: usuarios.length }, { id: 'invitaciones', label: 'Invitaciones', count: invitaciones.filter((i) => i.estado === 'pendiente').length }] as tab}
				<button
					onclick={() => (tabActiva = tab.id as 'usuarios' | 'invitaciones')}
					class="flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors
						{tabActiva === tab.id
						? 'border-orange-600 text-orange-600'
						: 'border-transparent text-gray-500 hover:text-gray-700'}"
				>
					{tab.label}
					{#if tab.count > 0}
						<span
							class="rounded-full px-2 py-0.5 text-xs
							{tabActiva === tab.id ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}"
						>
							{tab.count}
						</span>
					{/if}
				</button>
			{/each}
		</nav>
	</div>

	<!-- ─── Tab Usuarios ──────────────────────────────────────────────────── -->
	{#if tabActiva === 'usuarios'}
		{#if cargando}
			<div class="flex justify-center py-16">
				<div
					class="h-8 w-8 animate-spin rounded-full border-2 border-orange-600 border-t-transparent"
				></div>
			</div>
		{:else}
			<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
				<table class="w-full text-sm">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Usuario</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Área(s)</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Cargo</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Último acceso</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Estado</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each usuarios as u (u.id)}
							<tr class="transition-colors hover:bg-gray-50">
								<td class="px-4 py-3">
									<div class="flex items-center gap-3">
										<div class="relative flex-shrink-0">
											<div
												class="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700"
											>
												{u.nombre.charAt(0).toUpperCase()}
											</div>
											<span
												class="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white
												{u.en_linea ? 'bg-orange-500' : 'bg-gray-300'}"
											>
											</span>
										</div>
										<div>
											<p class="font-medium text-gray-900">{u.nombre}</p>
											<p class="text-xs text-gray-400">{u.correo}</p>
										</div>
									</div>
								</td>
								<td class="px-4 py-3">
									{#if u.area?.length}
										<div class="flex flex-wrap gap-1">
											{#each u.area as a}
												<span
													class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
												>
													{AREA_LABELS[a as Area] ?? a}
												</span>
											{/each}
										</div>
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-gray-600">{u.cargo ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-gray-500">{formatFecha(u.ultimo_acceso)}</td>
								<td class="px-4 py-3">
									{#if u.en_linea}
										<span
											class="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700"
										>
											<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500"></span>
											En línea
										</span>
									{:else if !u.activo}
										<span
											class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600"
										>
											Inactivo
										</span>
									{:else}
										<span
											class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500"
										>
											<span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
											Desconectado
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if usuarios.length === 0}
					<div class="py-12 text-center text-gray-400">No hay usuarios registrados</div>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- ─── Tab Invitaciones ──────────────────────────────────────────────── -->
	{#if tabActiva === 'invitaciones'}
		{#if cargandoInv}
			<div class="flex justify-center py-16">
				<div
					class="h-8 w-8 animate-spin rounded-full border-2 border-orange-600 border-t-transparent"
				></div>
			</div>
		{:else}
			<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
				<table class="w-full text-sm">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Correo invitado</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Área(s)</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Invitado por</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Enviada</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-600">Estado</th>
							<th class="px-4 py-3"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each invitaciones as inv (inv.id)}
							<tr class="transition-colors hover:bg-gray-50">
								<td class="px-4 py-3 font-medium text-gray-800">{inv.correo}</td>
								<td class="px-4 py-3">
									<div class="flex flex-wrap gap-1">
										{#each inv.area as a}
											<span
												class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
											>
												{AREA_LABELS[a as Area] ?? a}
											</span>
										{/each}
									</div>
								</td>
								<td class="px-4 py-3 text-gray-600">{inv.invitado_por?.nombre ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-gray-500">{formatFecha(inv.created_at)}</td>
								<td class="px-4 py-3">
									<span
										class="rounded-full px-2.5 py-1 text-xs font-semibold capitalize {estadoInvBadge(
											inv.estado
										)}"
									>
										{inv.estado}
									</span>
								</td>
								<td class="px-4 py-3 text-right">
									{#if inv.estado === 'pendiente' && puedeEscribir}
										<button
											onclick={() => revocarInvitacion(inv.id)}
											class="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
										>
											Revocar
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if invitaciones.length === 0}
					<div class="py-12 text-center text-gray-400">No se han enviado invitaciones aún</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- ─── Modal Invitar ──────────────────────────────────────────────────────── -->
{#if modalAbierto}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		onclick={(e) => cerrarSiBackdrop(e, () => (modalAbierto = false))}
		onkeydown={(e) => e.key === 'Escape' && (modalAbierto = false)}
		role="dialog"
		aria-modal="true"
		aria-label="Invitar usuario"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl bg-white shadow-xl">
			<!-- Header -->
			<div class="flex items-start justify-between border-b border-gray-100 px-6 py-4">
				<div>
					<h2 class="text-lg font-bold text-gray-900">Invitar usuario</h2>
					<p class="mt-0.5 text-xs text-gray-500">
						Recibirá un enlace por correo y <strong>elegirá su propia contraseña</strong>.
					</p>
				</div>
				<button
					onclick={() => (modalAbierto = false)}
					aria-label="Cerrar modal"
					class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
				>
					<svg
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body -->
			<div class="space-y-4 px-6 py-5">
				<!-- Correo -->
				<div>
					<label class="mb-1.5 block text-sm font-medium text-gray-700" for="inv-correo">
						Correo electrónico <span class="text-red-500">*</span>
					</label>
					<input
						id="inv-correo"
						type="email"
						bind:value={formCorreo}
						placeholder="usuario@empresa.com"
						class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
					/>
				</div>

				<!-- Áreas -->
				<div>
					<p class="mb-2 text-sm font-medium text-gray-700">
						Área(s) <span class="text-red-500">*</span>
					</p>
					<div class="flex flex-wrap gap-2">
						{#each AREAS as area}
							<button
								type="button"
								onclick={() => toggleArea(area.value)}
								class="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors
									{formAreas.includes(area.value)
									? 'border-orange-500 bg-orange-50 text-orange-700'
									: 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}"
							>
								{area.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Cargo (opcional) -->
				<div>
					<label class="mb-1.5 block text-sm font-medium text-gray-700" for="inv-cargo">
						Cargo <span class="font-normal text-gray-400">(opcional)</span>
					</label>
					<input
						id="inv-cargo"
						type="text"
						bind:value={formCargo}
						placeholder="Ej: Analista de operaciones"
						class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
					/>
				</div>

				{#if errorModal}
					<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorModal}</p>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
				<button
					onclick={() => (modalAbierto = false)}
					class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
				>
					Cancelar
				</button>
				<button
					onclick={enviarInvitacion}
					disabled={enviando}
					class="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
				>
					{#if enviando}
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
						></div>
					{/if}
					Enviar invitación
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ─── Modal Crear manualmente ────────────────────────────────────────────── -->
{#if modalCrearAbierto}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
		onclick={(e) => cerrarSiBackdrop(e, () => (modalCrearAbierto = false))}
		onkeydown={(e) => e.key === 'Escape' && (modalCrearAbierto = false)}
		role="dialog"
		aria-modal="true"
		aria-label="Crear usuario manualmente"
		tabindex="-1"
	>
		<div class="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-xl">
			<!-- Header -->
			<div class="flex items-start justify-between border-b border-gray-100 px-6 py-4">
				<div>
					<h2 class="text-lg font-bold text-gray-900">Crear usuario manualmente</h2>
					<p class="mt-0.5 text-xs text-gray-500">
						<strong>Tú defines la contraseña</strong> y se la entregas. La cuenta queda activa de inmediato
						— no se envía ninguna invitación.
					</p>
				</div>
				<button
					onclick={() => (modalCrearAbierto = false)}
					aria-label="Cerrar modal"
					class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
				>
					<svg
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body -->
			<div class="space-y-5 px-6 py-5">
				<div
					class="grid gap-4"
					style="grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));"
				>
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-nombre">
							Nombre completo <span class="text-red-500">*</span>
						</label>
						<input
							id="new-nombre"
							type="text"
							bind:value={nuevoNombre}
							placeholder="Ej: Jeffrey Rodríguez"
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
						/>
					</div>
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-correo">
							Correo electrónico <span class="text-red-500">*</span>
						</label>
						<input
							id="new-correo"
							type="email"
							bind:value={nuevoCorreo}
							placeholder="usuario@empresa.com"
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
						/>
					</div>
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-telefono">
							Teléfono <span class="font-normal text-gray-400">(opcional)</span>
						</label>
						<input
							id="new-telefono"
							type="tel"
							bind:value={nuevoTelefono}
							placeholder="3001234567"
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
						/>
					</div>
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-cargo">
							Cargo <span class="font-normal text-gray-400">(opcional)</span>
						</label>
						<input
							id="new-cargo"
							type="text"
							bind:value={nuevoCargo}
							placeholder="Ej: Técnico de mantenimiento"
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
						/>
					</div>
				</div>

				<!-- Contraseña -->
				<fieldset class="rounded-xl border border-gray-200 p-4">
					<legend class="px-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
						Contraseña
					</legend>
					<div
						class="grid gap-4"
						style="grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));"
					>
						<div>
							<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-pass">
								Contraseña <span class="text-red-500">*</span>
							</label>
							<input
								id="new-pass"
								type={mostrarPassword ? 'text' : 'password'}
								bind:value={nuevoPassword}
								autocomplete="new-password"
								placeholder="Mínimo 8 caracteres"
								class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
							/>
						</div>
						<div>
							<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-pass2">
								Confirmar contraseña <span class="text-red-500">*</span>
							</label>
							<input
								id="new-pass2"
								type={mostrarPassword ? 'text' : 'password'}
								bind:value={nuevoPassword2}
								autocomplete="new-password"
								placeholder="Repite la contraseña"
								class="w-full rounded-xl border px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:ring-2 focus:ring-orange-100
									{nuevoPassword2 && nuevoPassword !== nuevoPassword2
									? 'border-red-300'
									: 'border-gray-300 focus:border-orange-500'}"
							/>
						</div>
					</div>
					<label class="mt-3 flex items-center gap-2 text-sm text-gray-600">
						<input type="checkbox" bind:checked={mostrarPassword} class="rounded border-gray-300" />
						Mostrar contraseña
					</label>
					{#if nuevoPassword2 && nuevoPassword !== nuevoPassword2}
						<p class="mt-2 text-xs font-medium text-red-600">Las contraseñas no coinciden.</p>
					{/if}
				</fieldset>

				<!-- Rol -->
				<div style="max-width: 20rem;">
					<label class="mb-1.5 block text-sm font-medium text-gray-700" for="new-role">Rol</label>
					<select
						id="new-role"
						bind:value={nuevoRole}
						class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 transition outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
					>
						{#each ROLES as rol}
							<option value={rol.value}>{rol.label}</option>
						{/each}
					</select>
					{#if nuevoRole === 'admin'}
						<p class="mt-1.5 text-xs text-blue-700">
							Los administradores conservan acceso total: los permisos por ruta no se les aplican.
						</p>
					{/if}
				</div>

				<!-- Áreas -->
				<div>
					<p class="mb-2 text-sm font-medium text-gray-700">
						Área(s) <span class="text-red-500">*</span>
					</p>
					<div class="flex flex-wrap gap-2">
						{#each AREAS as area}
							<button
								type="button"
								onclick={() => toggleAreaNuevo(area.value)}
								class="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors
									{nuevoAreas.includes(area.value)
									? 'border-orange-500 bg-orange-50 text-orange-700'
									: 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}"
							>
								{area.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Permisos por ruta -->
				<div>
					<p class="mb-2 text-sm font-medium text-gray-700">Permisos por ruta</p>
					<PermisosRutasPicker
						idPrefix="crear"
						areas={nuevoAreas}
						role={nuevoRole}
						valor={nuevoPermisosRutas}
						onchange={(v) => (nuevoPermisosRutas = v)}
					/>
				</div>

				{#if errorCrear}
					<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorCrear}</p>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
				<button
					onclick={() => (modalCrearAbierto = false)}
					class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
				>
					Cancelar
				</button>
				<button
					onclick={crearUsuario}
					disabled={creando}
					class="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
				>
					{#if creando}
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
						></div>
					{/if}
					Crear usuario
				</button>
			</div>
		</div>
	</div>
{/if}
