<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { authAPI } from '$lib/api/apiClient';
	import { toast } from '$lib/stores/toast';
	import { AREA_LABELS, type Area } from '$lib/config/permissions';

	let user = $authStore.user;
	let sesion: any = null;
	let loading = true;

	// Edición de perfil
	let editingProfile = false;
	let editTelefono = '';
	let savingProfile = false;

	// Cambio de contraseña
	let showPasswordForm = false;
	let currentPassword = '';
	let newPassword = '';
	let confirmPassword = '';
	let savingPassword = false;
	let showCurrentPw = false;
	let showNewPw = false;

	// Firma
	let firmaSignedUrl: string | null = null;
	let firmaLoading = false;
	let uploadingFirma = false;
	let fileInput: HTMLInputElement;

	$: user = $authStore.user;

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		loading = true;
		try {
			const [profileRes, sessionRes, firmaRes] = await Promise.all([
				authAPI.getProfile(),
				authAPI.getMySession(),
				authAPI.getMyFirma()
			]);
			if (profileRes.data?.id) {
				user = profileRes.data;
			}
			sesion = sessionRes.data?.sesion || null;
			firmaSignedUrl = firmaRes.data?.firma_signed_url || null;
		} catch (err: any) {
			console.error('Error cargando perfil:', err);
			if (err?.response?.status === 401) {
				authStore.logout();
			}
		} finally {
			loading = false;
		}
	}

	function startEditProfile() {
		editTelefono = user?.telefono || '';
		editingProfile = true;
	}

	function cancelEditProfile() {
		editingProfile = false;
	}

	async function saveProfile() {
		savingProfile = true;
		try {
			const res = await authAPI.updateProfile({
				telefono: editTelefono
			});
			if (res.data) {
				user = { ...user!, ...res.data };
				// Actualizar localStorage
				localStorage.setItem('transmeralda_user', JSON.stringify(user));
			}
			editingProfile = false;
			toast.success('Perfil actualizado correctamente');
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al actualizar perfil');
		} finally {
			savingProfile = false;
		}
	}

	async function handleChangePassword() {
		if (newPassword !== confirmPassword) {
			toast.error('Las contraseñas no coinciden');
			return;
		}
		if (newPassword.length < 6) {
			toast.error('La contraseña debe tener al menos 6 caracteres');
			return;
		}

		savingPassword = true;
		try {
			await authAPI.changePassword(currentPassword, newPassword);
			toast.success('Contraseña actualizada correctamente');
			showPasswordForm = false;
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al cambiar contraseña');
		} finally {
			savingPassword = false;
		}
	}

	async function handleFirmaUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input?.files?.[0];
		if (!file) return;
		uploadingFirma = true;
		try {
			await authAPI.uploadMyFirma(file);
			const res = await authAPI.getMyFirma();
			firmaSignedUrl = res.data?.url || null;
			toast.success('Firma subida correctamente');
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al subir firma');
		} finally {
			uploadingFirma = false;
			input.value = '';
		}
	}

	async function handleDeleteFirma() {
		try {
			await authAPI.deleteMyFirma();
			firmaSignedUrl = null;
			toast.success('Firma eliminada');
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'Error al eliminar firma');
		}
	}

	function getRolLabel(role: string | undefined): string {
		const map: Record<string, string> = {
			admin: 'Administrador',
			liquidador: 'Liquidador',
			facturador: 'Facturador',
			aprobador: 'Aprobador',
			gestor_flota: 'Gestor de Flota',
			gestor_nomina: 'Gestor de Nómina',
			consulta: 'Consulta',
			usuario: 'Usuario',
			gestor_servicio: 'Gestor de Servicio',
			gestor_planillas: 'Gestor de Planillas',
			kilometraje: 'Kilometraje'
		};
		return map[role || ''] || role || 'Sin rol';
	}

	function parseUserAgent(ua: string | null): { browser: string; os: string } {
		if (!ua) return { browser: 'Desconocido', os: 'Desconocido' };
		let browser = 'Desconocido';
		let os = 'Desconocido';
		if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
		else if (ua.includes('Firefox')) browser = 'Firefox';
		else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
		else if (ua.includes('Edg')) browser = 'Edge';
		if (ua.includes('Windows')) os = 'Windows';
		else if (ua.includes('Mac')) os = 'macOS';
		else if (ua.includes('Linux')) os = 'Linux';
		else if (ua.includes('Android')) os = 'Android';
		else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
		return { browser, os };
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Mi Perfil - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4 lg:p-6">
	<!-- Header -->
	<div class="mb-6" in:fly={{ y: -20, duration: 400 }}>
		<h1 class="text-2xl font-bold text-gray-900">Mi Perfil</h1>
		<p class="mt-1 text-sm text-gray-500">Información de tu cuenta y sesión actual</p>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-20">
			<div class="text-center">
				<div class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"></div>
				<p class="text-sm text-gray-500">Cargando perfil...</p>
			</div>
		</div>
	{:else if user}
		<div class="space-y-6" in:fade={{ duration: 300 }}>

			<!-- Card: Info del usuario -->
			<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
				<!-- Banner -->
				<div class="relative h-32 bg-gradient-to-r from-orange-500 to-orange-700">
					<div class="absolute -bottom-12 left-6">
						<div class="flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-white bg-gradient-to-br from-orange-400 to-orange-600 text-3xl font-bold text-white shadow-lg">
							{user.nombre.charAt(0).toUpperCase()}
						</div>
					</div>
				</div>

				<div class="px-6 pt-16 pb-6">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h2 class="text-xl font-bold text-gray-900">{user.nombre}</h2>
							<p class="text-sm text-gray-500">{user.correo}</p>
							<div class="mt-2 flex flex-wrap gap-2">
								{#if user.area && Array.isArray(user.area) && user.area.length > 0}
									{#each user.area as a}
										<span class="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
											{AREA_LABELS[a as Area] || a}
										</span>
									{/each}
								{/if}
								{#if user.cargo}
									<span class="inline-flex rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
										{user.cargo}
									</span>
								{/if}
							</div>
						</div>
						<div>
							{#if editingProfile}
								<div class="flex gap-2">
									<button
										class="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
										on:click={cancelEditProfile}
									>
										Cancelar
									</button>
									<button
										class="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
										disabled={savingProfile}
										on:click={saveProfile}
									>
										{#if savingProfile}
											<div class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
										{/if}
										Guardar
									</button>
								</div>
							{:else}
								<button
									class="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
									on:click={startEditProfile}
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
									</svg>
									Editar perfil
								</button>
							{/if}
						</div>
					</div>

					<!-- Datos editables -->
					<div class="mt-6 grid gap-4 sm:grid-cols-2">
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<p class="text-xs font-medium text-gray-400 uppercase">Teléfono</p>
							{#if editingProfile}
								<input
									type="tel"
									bind:value={editTelefono}
									placeholder="Ej: 3001234567"
									class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 focus:outline-none"
								/>
							{:else}
								<p class="mt-1 text-sm font-medium text-gray-900">{user.telefono || 'No registrado'}</p>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Card: Firma -->
			<div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" in:fly={{ y: 20, duration: 400, delay: 50 }}>
				<h3 class="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100">
						<svg class="h-4 w-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
						</svg>
					</div>
					Mi Firma
				</h3>

				<input type="file" accept="image/*" class="hidden" bind:this={fileInput} on:change={handleFirmaUpload} />

				{#if firmaLoading}
					<div class="flex items-center justify-center py-8">
						<div class="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"></div>
					</div>
				{:else if firmaSignedUrl}
					<div class="flex flex-col items-center gap-4">
						<div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
							<img src={firmaSignedUrl} alt="Mi firma" class="max-h-32 w-auto object-contain" />
						</div>
						<div class="flex gap-2">
							<button
								on:click={() => fileInput?.click()}
								disabled={uploadingFirma}
								class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
								Cambiar
							</button>
							<button
								on:click={handleDeleteFirma}
								class="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
								Eliminar
							</button>
						</div>
					</div>
				{:else}
					<button
						on:click={() => fileInput?.click()}
						disabled={uploadingFirma}
						class="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-8 text-gray-400 hover:border-violet-400 hover:text-violet-500 transition-colors disabled:opacity-50"
					>
						{#if uploadingFirma}
							<div class="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent"></div>
							<span class="text-sm">Subiendo...</span>
						{:else}
							<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
							<span class="text-sm font-medium">Subir firma</span>
							<span class="text-xs">PNG, JPG o WEBP</span>
						{/if}
					</button>
				{/if}
			</div>

			<!-- Card: Sesión actual -->
			<div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" in:fly={{ y: 20, duration: 400, delay: 100 }}>
				<div class="mb-4 flex items-center justify-between">
					<h3 class="flex items-center gap-2 text-lg font-semibold text-gray-900">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100">
							<svg class="h-4 w-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
						</div>
						Sesión Actual
					</h3>
					{#if sesion}
						<span class="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
							<span class="h-2 w-2 animate-pulse rounded-full bg-orange-500"></span>
							Activa
						</span>
					{:else}
						<span class="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
							Sin sesión registrada
						</span>
					{/if}
				</div>

				{#if sesion}
					{@const ua = parseUserAgent(sesion.user_agent)}
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<div class="flex items-center gap-2">
								<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
								</svg>
								<p class="text-xs font-medium text-gray-400 uppercase">Dirección IP</p>
							</div>
							<p class="mt-2 font-mono text-sm font-semibold text-gray-900">{sesion.ip || 'N/A'}</p>
						</div>
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<div class="flex items-center gap-2">
								<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
								</svg>
								<p class="text-xs font-medium text-gray-400 uppercase">Navegador / SO</p>
							</div>
							<p class="mt-2 text-sm font-semibold text-gray-900">{ua.browser} · {ua.os}</p>
						</div>
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<div class="flex items-center gap-2">
								<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<p class="text-xs font-medium text-gray-400 uppercase">Duración</p>
							</div>
							<p class="mt-2 text-sm font-semibold text-gray-900">{sesion.duracion_texto}</p>
						</div>
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<div class="flex items-center gap-2">
								<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
								</svg>
								<p class="text-xs font-medium text-gray-400 uppercase">Inicio de sesión</p>
							</div>
							<p class="mt-2 text-sm font-semibold text-gray-900">{formatDate(sesion.created_at)}</p>
						</div>
					</div>

					<div class="mt-4 grid gap-4 sm:grid-cols-2">
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<p class="text-xs font-medium text-gray-400 uppercase">Última actividad</p>
							<p class="mt-1 text-sm font-medium text-gray-900">{formatDate(sesion.last_activity)}</p>
						</div>
						<div class="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
							<p class="text-xs font-medium text-gray-400 uppercase">Expiración del token</p>
							<div class="mt-1 flex items-center gap-2">
								<p class="text-sm font-medium text-gray-900">{formatDate(sesion.token_expiry)}</p>
								{#if sesion.remember_me}
									<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Recordar sesión</span>
								{/if}
							</div>
						</div>
					</div>
				{:else}
					<div class="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
						<p class="text-sm text-gray-500">
							No se encontró una sesión activa registrada. Las sesiones se registran desde el próximo inicio de sesión.
						</p>
					</div>
				{/if}
			</div>

			<!-- Card: Seguridad -->
			<div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" in:fly={{ y: 20, duration: 400, delay: 200 }}>
				<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100">
						<svg class="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
						</svg>
					</div>
					Seguridad
				</h3>

				{#if !showPasswordForm}
					<button
						class="flex items-center gap-3 rounded-xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
						on:click={() => (showPasswordForm = true)}
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
						</svg>
						Cambiar contraseña
					</button>
				{:else}
					<div class="max-w-md space-y-4" in:fly={{ y: 10, duration: 200 }}>
						<!-- Contraseña actual -->
						<div>
							<label for="current-pw" class="mb-1 block text-sm font-medium text-gray-700">Contraseña actual</label>
							<div class="relative">
								<input
									id="current-pw"
									type={showCurrentPw ? 'text' : 'password'}
									bind:value={currentPassword}
									placeholder="Ingresa tu contraseña actual"
									class="w-full rounded-xl border border-gray-300 px-4 py-2.5 pr-10 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 focus:outline-none"
								/>
								<button
									type="button"
									class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
									on:click={() => (showCurrentPw = !showCurrentPw)}
								>
									{#if showCurrentPw}
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
									{:else}
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
									{/if}
								</button>
							</div>
						</div>

						<!-- Nueva contraseña -->
						<div>
							<label for="new-pw" class="mb-1 block text-sm font-medium text-gray-700">Nueva contraseña</label>
							<div class="relative">
								<input
									id="new-pw"
									type={showNewPw ? 'text' : 'password'}
									bind:value={newPassword}
									placeholder="Mínimo 6 caracteres"
									class="w-full rounded-xl border border-gray-300 px-4 py-2.5 pr-10 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 focus:outline-none"
								/>
								<button
									type="button"
									class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
									on:click={() => (showNewPw = !showNewPw)}
								>
									{#if showNewPw}
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
									{:else}
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
									{/if}
								</button>
							</div>
						</div>

						<!-- Confirmar contraseña -->
						<div>
							<label for="confirm-pw" class="mb-1 block text-sm font-medium text-gray-700">Confirmar nueva contraseña</label>
							<input
								id="confirm-pw"
								type="password"
								bind:value={confirmPassword}
								placeholder="Repite la nueva contraseña"
								class="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 focus:outline-none
									{confirmPassword && confirmPassword !== newPassword ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}"
							/>
							{#if confirmPassword && confirmPassword !== newPassword}
								<p class="mt-1 text-xs text-red-500">Las contraseñas no coinciden</p>
							{/if}
						</div>

						<!-- Botones -->
						<div class="flex gap-3 pt-2">
							<button
								class="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
								on:click={() => {
									showPasswordForm = false;
									currentPassword = '';
									newPassword = '';
									confirmPassword = '';
								}}
							>
								Cancelar
							</button>
							<button
								class="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
								disabled={savingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword}
								on:click={handleChangePassword}
							>
								{#if savingPassword}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
								{/if}
								Cambiar contraseña
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
