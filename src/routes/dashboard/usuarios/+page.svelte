<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import { authStore } from '$lib/stores/auth';
	import { AREA_LABELS, type Area } from '$lib/config/permissions';
	import { socketManager } from '$lib/socket';

	let usuarios: Usuario[] = [];
	let loading = true;
	let searchTerm = '';
	let filterArea = '';

	// Edit modal
	let showEditModal = false;
	let editUsuario: Usuario | null = null;
	let editNombre = '';
	let editCorreo = '';
	let editTelefono = '';
	let editAreas: string[] = [];
	let savingEdit = false;

	// Confirm disable modal
	let showConfirmModal = false;
	let confirmUsuario: Usuario | null = null;
	let confirmAction: 'disable' | 'enable' = 'disable';
	let savingToggle = false;

	// Permisos modal
	let showPermisosModal = false;
	let permisosUsuario: Usuario | null = null;
	let savingPermisos = false;

	const modulosDisponibles = [
		{ id: 'flota', label: 'Flota', icon: '🚛' },
		{ id: 'conductores', label: 'Conductores', icon: '👥' },
		{ id: 'servicios', label: 'Servicios', icon: '🕐' },
		{ id: 'recargos', label: 'Recargos', icon: '📅' },
		{ id: 'clientes', label: 'Clientes', icon: '🏢' },
		{ id: 'asistencias', label: 'Asistencias', icon: '📋' },
		{ id: 'acciones-correctivas', label: 'Acciones C/P', icon: '🛡️' },
		{ id: 'evaluaciones', label: 'Evaluaciones', icon: '✅' },
		{ id: 'nomina', label: 'Nómina', icon: '💰' },
		{ id: 'usuarios', label: 'Usuarios', icon: '⚙️' }
	];

	$: filteredUsuarios = usuarios.filter((u) => {
		const matchSearch =
			u.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
			u.correo.toLowerCase().includes(searchTerm.toLowerCase());
		const matchArea = !filterArea || (Array.isArray(u.area) && u.area.includes(filterArea));
		return matchSearch && matchArea;
	});

	$: currentUser = $authStore.user;

	onMount(async () => {
		await cargarUsuarios();
		socketManager.on('usuario-deshabilitado', (data: any) => {
			if (data?.usuarioId === currentUser?.id) {
				toast.error('Tu cuenta ha sido deshabilitada');
				setTimeout(() => authStore.logout(), 1500);
			}
		});
	});

	onDestroy(() => {
		socketManager.off('usuario-deshabilitado');
	});

	async function cargarUsuarios() {
		loading = true;
		try {
			usuarios = await usuariosAPI.listar();
		} catch (error) {
			toast.error('Error al cargar la lista de usuarios');
		} finally {
			loading = false;
		}
	}

	function abrirEditModal(usuario: Usuario) {
		editUsuario = usuario;
		editNombre = usuario.nombre;
		editCorreo = usuario.correo;
		editTelefono = usuario.telefono || '';
		editAreas = Array.isArray(usuario.area) ? [...usuario.area] : usuario.area ? [usuario.area] : [];
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
			toast.success(editNombre + ' actualizado correctamente');
			cerrarEditModal();
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al actualizar usuario');
		} finally {
			savingEdit = false;
		}
	}

	function abrirConfirmToggle(usuario: Usuario) {
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
			toast.success(
				nuevoEstado
					? confirmUsuario.nombre + ' habilitado'
					: confirmUsuario.nombre + ' deshabilitado'
			);
			cerrarConfirmModal();
		} catch (err: any) {
			toast.error('Error al cambiar estado del usuario');
		} finally {
			savingToggle = false;
		}
	}

	function abrirPermisos(usuario: Usuario) {
		const permisosCompletos: Record<string, boolean> = {};
		for (const modulo of modulosDisponibles) {
			permisosCompletos[modulo.id] = usuario.permisos?.[modulo.id] ?? false;
		}
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
		for (const modulo of modulosDisponibles) {
			nuevosPermisos[modulo.id] = valor;
		}
		permisosUsuario = { ...permisosUsuario, permisos: nuevosPermisos };
	}

	async function guardarPermisos() {
		if (!permisosUsuario?.permisos) return;
		savingPermisos = true;
		try {
			const updated = await usuariosAPI.actualizarPermisos(permisosUsuario.id, permisosUsuario.permisos);
			usuarios = usuarios.map((u) => (u.id === updated.id ? updated : u));
			if (currentUser && permisosUsuario.id === currentUser.id) {
				authStore.updateUserPermisos(permisosUsuario.permisos as any);
			}
			toast.success('Permisos de ' + permisosUsuario.nombre + ' actualizados');
			cerrarPermisosModal();
		} catch {
			toast.error('Error al guardar permisos');
		} finally {
			savingPermisos = false;
		}
	}
</script>

<svelte:head>
	<title>Usuarios - Transmeralda</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-3 lg:p-5">
	<!-- Header -->
	<div class="mb-4" in:fly={{ y: -20, duration: 400 }}>
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-xl font-bold text-gray-900">Usuarios</h1>
				<p class="text-xs text-gray-500">{usuarios.length} registrados</p>
			</div>
		</div>
	</div>

	<!-- Filtros -->
	<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center" in:fly={{ y: -10, duration: 400, delay: 100 }}>
		<div class="relative flex-1 max-w-sm">
			<svg class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input type="text" bind:value={searchTerm} placeholder="Buscar..." class="w-full rounded-lg border border-gray-200 bg-white py-2 pr-3 pl-9 text-sm shadow-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none" />
		</div>
		<select bind:value={filterArea} class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none">
			<option value="">Todas las áreas</option>
			{#each Object.entries(AREA_LABELS) as [key, label]}
				<option value={key}>{label}</option>
			{/each}
		</select>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-16">
			<div class="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"></div>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" in:fade={{ duration: 300 }}>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 bg-gray-50/80">
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">Usuario</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase hidden sm:table-cell">Correo</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase hidden md:table-cell">Teléfono</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">Área</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-500 uppercase">Estado</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-500 uppercase">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-50">
						{#each filteredUsuarios as usuario, index (usuario.id)}
							<tr class="transition-colors hover:bg-gray-50/50" class:opacity-50={usuario.activo === false} in:fly={{ y: 10, duration: 200, delay: Math.min(index * 20, 300) }}>
								<td class="px-4 py-3">
									<div class="flex items-center gap-2.5">
										<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" class:bg-gradient-to-br={usuario.activo !== false} class:from-emerald-400={usuario.activo !== false} class:to-emerald-600={usuario.activo !== false} class:bg-gray-400={usuario.activo === false}>
											{usuario.nombre.charAt(0).toUpperCase()}
										</div>
										<div class="min-w-0">
											<p class="truncate font-medium text-gray-900 text-sm">{usuario.nombre}</p>
											<p class="truncate text-xs text-gray-400 sm:hidden">{usuario.correo}</p>
										</div>
									</div>
								</td>
								<td class="px-4 py-3 hidden sm:table-cell">
									<span class="text-gray-600 text-xs">{usuario.correo}</span>
								</td>
								<td class="px-4 py-3 hidden md:table-cell">
									<span class="text-gray-600 text-xs">{usuario.telefono || '—'}</span>
								</td>
								<td class="px-4 py-3">
									{#if Array.isArray(usuario.area) && usuario.area.length > 0}
										<div class="flex flex-wrap gap-1">
											{#each usuario.area as a}
												<span class="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
													{AREA_LABELS[a as Area] || a}
												</span>
											{/each}
										</div>
									{:else}
										<span class="text-xs text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-center">
									<button type="button" class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1" class:bg-emerald-500={usuario.activo !== false} class:bg-gray-300={usuario.activo === false} on:click={() => abrirConfirmToggle(usuario)} disabled={usuario.id === currentUser?.id} title={usuario.id === currentUser?.id ? 'No puedes deshabilitarte' : usuario.activo !== false ? 'Deshabilitar' : 'Habilitar'}>
										<span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" class:translate-x-4={usuario.activo !== false} class:translate-x-0={usuario.activo === false}></span>
									</button>
								</td>
								<td class="px-4 py-3 text-center">
									<div class="flex items-center justify-center gap-1">
										<button class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" title="Editar" on:click={() => abrirEditModal(usuario)}>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
										</button>
										<button class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600" title="Permisos" on:click={() => abrirPermisos(usuario)}>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if filteredUsuarios.length === 0}
				<div class="py-10 text-center">
					<p class="text-sm text-gray-400">No se encontraron usuarios</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal Editar -->
{#if showEditModal && editUsuario}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
		<button type="button" class="absolute inset-0 bg-black/50 backdrop-blur-sm" on:click={cerrarEditModal} aria-label="Cerrar"></button>
		<div class="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl" in:fly={{ y: 30, duration: 250 }}>
			<div class="flex items-center justify-between border-b border-gray-100 p-5">
				<h3 class="text-lg font-bold text-gray-900">Editar usuario</h3>
				<button type="button" class="rounded-lg p-1 text-gray-400 hover:bg-gray-100" on:click={cerrarEditModal} aria-label="Cerrar">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="space-y-4 p-5">
				<div>
					<label for="edit-nombre" class="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
					<input id="edit-nombre" type="text" bind:value={editNombre} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none" />
				</div>
				<div>
					<label for="edit-correo" class="mb-1 block text-sm font-medium text-gray-700">Correo</label>
					<input id="edit-correo" type="email" bind:value={editCorreo} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none" />
				</div>
				<div>
					<label for="edit-telefono" class="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
					<input id="edit-telefono" type="tel" bind:value={editTelefono} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none" />
				</div>
				<div>
					<span class="mb-1 block text-sm font-medium text-gray-700">Áreas</span>
					<div class="grid grid-cols-2 gap-2">
						{#each Object.entries(AREA_LABELS) as [key, label]}
							<label class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors" class:border-emerald-400={editAreas.includes(key)} class:bg-emerald-50={editAreas.includes(key)} class:border-gray-200={!editAreas.includes(key)}>
								<input type="checkbox" class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" checked={editAreas.includes(key)} on:change={() => { editAreas = editAreas.includes(key) ? editAreas.filter(a => a !== key) : [...editAreas, key]; }} />
								{label}
							</label>
						{/each}
					</div>
				</div>
			</div>
			<div class="flex items-center justify-end gap-3 border-t border-gray-100 p-5">
				<button class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" on:click={cerrarEditModal}>Cancelar</button>
				<button class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" disabled={savingEdit} on:click={guardarEdit}>
					{#if savingEdit}<div class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>{/if}
					Guardar
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Confirmar Toggle -->
{#if showConfirmModal && confirmUsuario}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
		<button type="button" class="absolute inset-0 bg-black/50 backdrop-blur-sm" on:click={cerrarConfirmModal} aria-label="Cerrar"></button>
		<div class="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" in:fly={{ y: 30, duration: 250 }}>
			<div class="mb-4 flex items-center justify-center">
				{#if confirmAction === 'disable'}
					<div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
						<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
					</div>
				{:else}
					<div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
						<svg class="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
					</div>
				{/if}
			</div>
			<h3 class="mb-2 text-center text-lg font-bold text-gray-900">
				{confirmAction === 'disable' ? 'Deshabilitar' : 'Habilitar'} usuario
			</h3>
			<p class="mb-6 text-center text-sm text-gray-500">
				{#if confirmAction === 'disable'}
					¿Estás seguro de deshabilitar a <strong>{confirmUsuario.nombre}</strong>? Se cerrarán todas sus sesiones activas.
				{:else}
					¿Quieres habilitar nuevamente a <strong>{confirmUsuario.nombre}</strong>?
				{/if}
			</p>
			<div class="flex gap-3">
				<button class="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" on:click={cerrarConfirmModal}>Cancelar</button>
				<button class="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50" class:bg-red-600={confirmAction === 'disable'} class:hover:bg-red-700={confirmAction === 'disable'} class:bg-emerald-600={confirmAction === 'enable'} class:hover:bg-emerald-700={confirmAction === 'enable'} disabled={savingToggle} on:click={confirmarToggle}>
					{#if savingToggle}<div class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>{/if}
					{confirmAction === 'disable' ? 'Deshabilitar' : 'Habilitar'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Permisos -->
{#if showPermisosModal && permisosUsuario}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
		<button type="button" class="absolute inset-0 bg-black/50 backdrop-blur-sm" on:click={cerrarPermisosModal} aria-label="Cerrar"></button>
		<div class="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl" in:fly={{ y: 30, duration: 250 }}>
			<div class="flex items-center justify-between border-b border-gray-100 p-5">
				<div>
					<h3 class="text-lg font-bold text-gray-900">Permisos</h3>
					<p class="text-xs text-gray-500">{permisosUsuario.nombre}</p>
				</div>
				<button type="button" class="rounded-lg p-1 text-gray-400 hover:bg-gray-100" on:click={cerrarPermisosModal} aria-label="Cerrar">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="flex items-center justify-end gap-2 border-b border-gray-100 px-5 py-2">
				<button class="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50" on:click={() => toggleTodos(true)}>Todos</button>
				<button class="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50" on:click={() => toggleTodos(false)}>Ninguno</button>
			</div>
			<div class="max-h-[380px] overflow-y-auto p-5">
				<div class="space-y-2">
					{#each modulosDisponibles as modulo}
						{@const activo = permisosUsuario.permisos?.[modulo.id] === true}
						<button type="button" class="flex w-full items-center justify-between rounded-xl border p-3 transition-all {activo ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-white hover:bg-gray-50'}" on:click={() => togglePermiso(modulo.id)}>
							<div class="flex items-center gap-2.5">
								<span class="text-lg">{modulo.icon}</span>
								<span class="text-sm font-medium text-gray-900">{modulo.label}</span>
							</div>
							<div class="relative h-5 w-9 rounded-full transition-colors duration-200 {activo ? 'bg-emerald-500' : 'bg-gray-300'}">
								<div class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 {activo ? 'translate-x-4' : 'translate-x-0.5'}"></div>
							</div>
						</button>
					{/each}
				</div>
			</div>
			<div class="flex items-center justify-end gap-3 border-t border-gray-100 p-5">
				<button class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" on:click={cerrarPermisosModal}>Cancelar</button>
				<button class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" disabled={savingPermisos} on:click={guardarPermisos}>
					{#if savingPermisos}<div class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>{/if}
					Guardar
				</button>
			</div>
		</div>
	</div>
{/if}
