<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { apiClient } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { authStore } from '$lib/stores/auth';
	import { toast } from '$lib/stores/toast';

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
	let usuarios: UsuarioPresencia[] = [];
	let invitaciones: Invitacion[] = [];
	let onlineIds = new Set<string>();
	let cargando = true;
	let cargandoInv = true;
	let tabActiva: 'usuarios' | 'invitaciones' = 'usuarios';

	// Modal invitar
	let modalAbierto = false;
	let enviando = false;
	let formCorreo = '';
	let formAreas: string[] = [];
	let formCargo = '';
	let errorModal = '';

	const AREAS = [
		{ value: 'administracion', label: 'Administración' },
		{ value: 'operaciones', label: 'Operaciones' },
		{ value: 'contabilidad', label: 'Contabilidad' },
		{ value: 'facturacion', label: 'Facturación' },
		{ value: 'talento_humano', label: 'Talento Humano' },
		{ value: 'hseq', label: 'HSEQ' },
	];

	const AREA_LABELS: Record<string, string> = {
		administracion: 'Administración',
		operaciones: 'Operaciones',
		contabilidad: 'Contabilidad',
		facturacion: 'Facturación',
		talento_humano: 'Talento Humano',
		hseq: 'HSEQ',
	};

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
		if (!formCorreo) { errorModal = 'Ingresa un correo'; return; }
		if (formAreas.length === 0) { errorModal = 'Selecciona al menos un área'; return; }
		try {
			enviando = true;
			await apiClient.post('/api/invitaciones', {
				correo: formCorreo,
				area: formAreas,
				cargo: formCargo || undefined,
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

	// ─── Helpers ──────────────────────────────────────────────────────────────
	function formatFecha(fecha?: string | null) {
		if (!fecha) return 'Nunca';
		return new Intl.DateTimeFormat('es-CO', {
			dateStyle: 'medium',
			timeStyle: 'short',
		}).format(new Date(fecha));
	}

	function estadoInvBadge(estado: string) {
		const map: Record<string, string> = {
			pendiente: 'bg-yellow-100 text-yellow-700',
			aceptada: 'bg-orange-100 text-orange-700',
			expirada: 'bg-red-100 text-red-700',
			revocada: 'bg-gray-100 text-gray-500',
			reemplazada: 'bg-gray-100 text-gray-500',
		};
		return map[estado] ?? 'bg-gray-100 text-gray-500';
	}
</script>

<svelte:head><title>Equipo · Cotransmeq</title></svelte:head>

<!-- ─── Encabezado ─────────────────────────────────────────────────────── -->
<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Equipo</h1>
			<p class="mt-1 text-sm text-gray-500">Usuarios del sistema, áreas y estado de presencia</p>
		</div>
		<button
			on:click={abrirModal}
			class="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 transition-colors"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			Invitar usuario
		</button>
	</div>

	<!-- ─── Tabs ──────────────────────────────────────────────────────────── -->
	<div class="border-b border-gray-200">
		<nav class="-mb-px flex gap-6">
			{#each [{ id: 'usuarios', label: 'Usuarios', count: usuarios.length }, { id: 'invitaciones', label: 'Invitaciones', count: invitaciones.filter(i => i.estado === 'pendiente').length }] as tab}
				<button
					on:click={() => (tabActiva = tab.id as any)}
					class="flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors
						{tabActiva === tab.id
							? 'border-orange-600 text-orange-600'
							: 'border-transparent text-gray-500 hover:text-gray-700'}"
				>
					{tab.label}
					{#if tab.count > 0}
						<span class="rounded-full px-2 py-0.5 text-xs
							{tabActiva === tab.id ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}">
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
				<div class="h-8 w-8 animate-spin rounded-full border-2 border-orange-600 border-t-transparent"></div>
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
							<tr class="hover:bg-gray-50 transition-colors">
								<td class="px-4 py-3">
									<div class="flex items-center gap-3">
										<div class="relative flex-shrink-0">
											<div class="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700">
												{u.nombre.charAt(0).toUpperCase()}
											</div>
											<span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white
												{u.en_linea ? 'bg-orange-500' : 'bg-gray-300'}">
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
												<span class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
													{AREA_LABELS[a] ?? a}
												</span>
											{/each}
										</div>
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-gray-600">{u.cargo ?? '—'}</td>
								<td class="px-4 py-3 text-gray-500 text-xs">{formatFecha(u.ultimo_acceso)}</td>
								<td class="px-4 py-3">
									{#if u.en_linea}
										<span class="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
											<span class="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse"></span>
											En línea
										</span>
									{:else if !u.activo}
										<span class="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
											Inactivo
										</span>
									{:else}
										<span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
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
				<div class="h-8 w-8 animate-spin rounded-full border-2 border-orange-600 border-t-transparent"></div>
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
							<tr class="hover:bg-gray-50 transition-colors">
								<td class="px-4 py-3 font-medium text-gray-800">{inv.correo}</td>
								<td class="px-4 py-3">
									<div class="flex flex-wrap gap-1">
										{#each inv.area as a}
											<span class="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
												{AREA_LABELS[a] ?? a}
											</span>
										{/each}
									</div>
								</td>
								<td class="px-4 py-3 text-gray-600">{inv.invitado_por?.nombre ?? '—'}</td>
								<td class="px-4 py-3 text-xs text-gray-500">{formatFecha(inv.created_at)}</td>
								<td class="px-4 py-3">
									<span class="rounded-full px-2.5 py-1 text-xs font-semibold capitalize {estadoInvBadge(inv.estado)}">
										{inv.estado}
									</span>
								</td>
								<td class="px-4 py-3 text-right">
									{#if inv.estado === 'pendiente'}
										<button
											on:click={() => revocarInvitacion(inv.id)}
											class="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
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
		on:click|self={() => (modalAbierto = false)}
		on:keydown={(e) => e.key === 'Escape' && (modalAbierto = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="w-full max-w-md rounded-2xl bg-white shadow-xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-100 px-6 py-4">
				<h2 class="text-lg font-bold text-gray-900">Invitar usuario</h2>
				<button
					on:click={() => (modalAbierto = false)}
					aria-label="Cerrar modal"
					class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
				>
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
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
						class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 transition"
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
								on:click={() => toggleArea(area.value)}
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
						Cargo <span class="text-gray-400 font-normal">(opcional)</span>
					</label>
					<input
						id="inv-cargo"
						type="text"
						bind:value={formCargo}
						placeholder="Ej: Analista de operaciones"
						class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 transition"
					/>
				</div>

				{#if errorModal}
					<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errorModal}</p>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
				<button
					on:click={() => (modalAbierto = false)}
					class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
				>
					Cancelar
				</button>
				<button
					on:click={enviarInvitacion}
					disabled={enviando}
					class="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60 transition-colors"
				>
					{#if enviando}
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
					{/if}
					Enviar invitación
				</button>
			</div>
		</div>
	</div>
{/if}
