<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast';
	import { sesionesAPI, type Sesion } from '$lib/api/sesiones';
	import { AREA_LABELS } from '$lib/config/permissions';

	let sesiones: Sesion[] = [];
	let loading = true;
	let filtroActivas: 'todas' | 'activas' | 'cerradas' = 'activas';
	let searchTerm = '';

	$: filteredSesiones = sesiones.filter((s) => {
		if (filtroActivas === 'activas' && !s.is_active) return false;
		if (filtroActivas === 'cerradas' && s.is_active) return false;
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			return (
				s.usuario?.nombre?.toLowerCase().includes(term) ||
				s.usuario?.correo?.toLowerCase().includes(term) ||
				s.ip?.includes(term)
			);
		}
		return true;
	});

	$: activasCount = sesiones.filter((s) => s.is_active).length;

	onMount(async () => {
		await cargarSesiones();
	});

	async function cargarSesiones() {
		loading = true;
		try {
			sesiones = await sesionesAPI.listar({ limit: 200 });
		} catch (error) {
			console.error('Error al cargar sesiones:', error);
			toast.error('Error al cargar las sesiones');
		} finally {
			loading = false;
		}
	}

	async function cerrarSesion(id: string) {
		try {
			await sesionesAPI.cerrar(id);
			toast.success('Sesión cerrada correctamente');
			sesiones = sesiones.map((s) =>
				s.id === id ? { ...s, is_active: false, closed_at: new Date().toISOString() } : s
			);
		} catch (error) {
			toast.error('Error al cerrar la sesión');
		}
	}

	async function cerrarTodasUsuario(usuarioId: string, nombre: string) {
		if (!confirm(`¿Cerrar todas las sesiones de ${nombre}?`)) return;
		try {
			await sesionesAPI.cerrarTodasUsuario(usuarioId);
			toast.success(`Sesiones de ${nombre} cerradas`);
			sesiones = sesiones.map((s) =>
				s.usuario_id === usuarioId
					? { ...s, is_active: false, closed_at: new Date().toISOString() }
					: s
			);
		} catch (error) {
			toast.error('Error al cerrar las sesiones');
		}
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

	function formatDate(d: string | null): string {
		if (!d) return '-';
		return new Date(d).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getAreaLabel(area: string | null | undefined): string {
		if (!area) return '-';
		return AREA_LABELS[area as keyof typeof AREA_LABELS] || area;
	}
</script>

<svelte:head>
	<title>Sesiones de Usuarios - Transmeralda</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4 lg:p-6">
	<!-- Header -->
	<div class="mb-6" in:fly={{ y: -20, duration: 400 }}>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h1 class="text-2xl font-bold text-gray-900">Sesiones de Usuarios</h1>
				<p class="mt-1 text-sm text-gray-500">
					Monitoreo de sesiones activas, IPs y duración
				</p>
			</div>
			<div class="flex items-center gap-3">
				<div class="rounded-lg bg-emerald-50 px-4 py-2">
					<span class="text-sm font-semibold text-emerald-700">
						{activasCount} activas
					</span>
				</div>
				<button
					on:click={cargarSesiones}
					class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50"
				>
					↻ Actualizar
				</button>
			</div>
		</div>
	</div>

	<!-- Filtros -->
	<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center" in:fly={{ y: -10, duration: 400, delay: 100 }}>
		<div class="relative max-w-xs">
			<svg class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			<input
				type="text"
				bind:value={searchTerm}
				placeholder="Buscar usuario o IP..."
				class="w-full rounded-xl border border-gray-200 bg-white py-2.5 pr-4 pl-10 text-sm shadow-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
			/>
		</div>

		<div class="flex rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
			{#each [{ key: 'todas', label: 'Todas' }, { key: 'activas', label: 'Activas' }, { key: 'cerradas', label: 'Cerradas' }] as tab}
				<button
					class="px-4 py-2 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg
						{filtroActivas === tab.key
						? 'bg-emerald-600 text-white'
						: 'text-gray-600 hover:bg-gray-50'}"
					on:click={() => (filtroActivas = tab.key as typeof filtroActivas)}
				>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Loading -->
	{#if loading}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"></div>
				<p class="text-sm text-gray-500">Cargando sesiones...</p>
			</div>
		</div>
	{:else}
		<!-- Tabla -->
		<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" in:fade={{ duration: 300 }}>
			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="border-b border-gray-100 bg-gray-50/80">
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 uppercase">Usuario</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 uppercase">Área</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 uppercase">IP</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 uppercase">Navegador</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 uppercase">Inicio</th>
							<th class="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-600 uppercase">Última actividad</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-600 uppercase">Duración</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-600 uppercase">Recordar</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-600 uppercase">Expira</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-600 uppercase">Estado</th>
							<th class="px-4 py-3 text-center text-xs font-semibold tracking-wider text-gray-600 uppercase">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-50">
						{#each filteredSesiones as sesion, index (sesion.id)}
							<tr
								class="transition-colors hover:bg-gray-50/50"
								in:fly={{ y: 10, duration: 200, delay: Math.min(index * 20, 500) }}
							>
								<!-- Usuario -->
								<td class="px-4 py-3">
									<div class="flex items-center gap-2.5">
										<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-xs font-bold text-white">
											{sesion.usuario?.nombre?.charAt(0)?.toUpperCase() || '?'}
										</div>
										<div>
											<p class="text-sm font-semibold text-gray-900">{sesion.usuario?.nombre || '-'}</p>
											<p class="text-xs text-gray-500">{sesion.usuario?.correo || '-'}</p>
										</div>
									</div>
								</td>

								<!-- Área -->
								<td class="px-4 py-3">
									<span class="inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
										{getAreaLabel(sesion.usuario?.area)}
									</span>
								</td>

								<!-- IP -->
								<td class="px-4 py-3">
									<code class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{sesion.ip || '-'}</code>
								</td>

								<!-- Navegador -->
								<td class="px-4 py-3">
									<div class="text-sm text-gray-700">{parseBrowser(sesion.user_agent)}</div>
									<div class="text-xs text-gray-400">{parseOS(sesion.user_agent)}</div>
								</td>

								<!-- Inicio -->
								<td class="px-4 py-3 text-xs text-gray-600">{formatDate(sesion.created_at)}</td>

								<!-- Última actividad -->
								<td class="px-4 py-3 text-xs text-gray-600">{formatDate(sesion.last_activity)}</td>

								<!-- Duración -->
								<td class="px-4 py-3 text-center">
									<span class="text-sm font-medium text-gray-700">{sesion.duracion_texto}</span>
								</td>

								<!-- Recordar -->
								<td class="px-4 py-3 text-center">
									{#if sesion.remember_me}
										<span class="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Sí</span>
									{:else}
										<span class="text-xs text-gray-400">No</span>
									{/if}
								</td>

								<!-- Expira -->
								<td class="px-4 py-3 text-center text-xs text-gray-600">
									{formatDate(sesion.token_expiry)}
								</td>

								<!-- Estado -->
								<td class="px-4 py-3 text-center">
									{#if sesion.is_active}
										<span class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
											<span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
											Activa
										</span>
									{:else}
										<span class="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
											Cerrada
										</span>
									{/if}
								</td>

								<!-- Acciones -->
								<td class="px-4 py-3 text-center">
									{#if sesion.is_active}
										<button
											on:click={() => cerrarSesion(sesion.id)}
											class="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
										>
											Cerrar
										</button>
									{:else}
										<span class="text-xs text-gray-400">-</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if filteredSesiones.length === 0}
				<div class="py-12 text-center">
					<svg class="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
					</svg>
					<p class="mt-3 text-sm text-gray-500">No se encontraron sesiones</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
