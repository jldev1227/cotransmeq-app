<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { authAPI } from '$lib/api/apiClient';
	import { toast } from '$lib/stores/toast';
	import { AREA_LABELS, type Area } from '$lib/config/permissions';
	import ConexionesClaude from '$lib/components/asistente/ConexionesClaude.svelte';

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

<div class="dir-pagina perfil">
	{#if loading}
		<div class="perfil-cargando">
			<div class="perfil-spinner" aria-hidden="true"></div>
			<p>Cargando perfil…</p>
		</div>
	{:else if user}
		<!-- Cabecera: la identidad sobre el verde de marca, como el menú lateral -->
		<header class="perfil-hero" in:fade={{ duration: 300 }}>
			<span class="perfil-orbe perfil-orbe--grande" aria-hidden="true"></span>
			<span class="perfil-orbe perfil-orbe--chico" aria-hidden="true"></span>
			<div class="perfil-avatar" aria-hidden="true">{user.nombre.charAt(0).toUpperCase()}</div>
			<div class="perfil-identidad">
				<span class="perfil-eyebrow">Mi perfil</span>
				<h1 class="perfil-nombre">{user.nombre}</h1>
				<p class="perfil-correo">{user.correo}</p>
				<div class="perfil-chips">
					<span class="perfil-chip perfil-chip--rol">{getRolLabel(user.role || user.rol)}</span>
					{#if user.area && Array.isArray(user.area) && user.area.length > 0}
						{#each user.area as a}
							<span class="perfil-chip">{AREA_LABELS[a as Area] || a}</span>
						{/each}
					{/if}
					{#if user.cargo}
						<span class="perfil-chip">{user.cargo}</span>
					{/if}
				</div>
			</div>
			<div class="perfil-hero-acciones">
				{#if editingProfile}
					<button type="button" class="perfil-btn-hero" on:click={cancelEditProfile}>Cancelar</button>
					<button
						type="button"
						class="perfil-btn-hero perfil-btn-hero--solido"
						disabled={savingProfile}
						on:click={saveProfile}
					>
						{#if savingProfile}<span class="perfil-spinner perfil-spinner--mini" aria-hidden="true"
							></span>{/if}
						Guardar
					</button>
				{:else}
					<button type="button" class="perfil-btn-hero" on:click={startEditProfile}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
						Editar perfil
					</button>
				{/if}
			</div>
		</header>

		<div class="perfil-grid" in:fade={{ duration: 300, delay: 80 }}>
			<div class="perfil-columna">
				<!-- Contacto -->
				<section class="perfil-card">
					<header class="perfil-card-cabecera">
						<span class="perfil-card-icono">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
								/>
							</svg>
						</span>
						<h2>Datos de contacto</h2>
					</header>
					<dl class="perfil-datos">
						<div class="perfil-dato">
							<dt>Teléfono</dt>
							<dd>
								{#if editingProfile}
									<input
										type="tel"
										bind:value={editTelefono}
										placeholder="Ej: 3001234567"
										class="input-glow perfil-input"
									/>
								{:else}
									{user.telefono || 'No registrado'}
								{/if}
							</dd>
						</div>
						<div class="perfil-dato">
							<dt>Correo</dt>
							<dd class="perfil-dato-cortar">{user.correo}</dd>
						</div>
						<div class="perfil-dato">
							<dt>Rol</dt>
							<dd>{getRolLabel(user.role || user.rol)}</dd>
						</div>
					</dl>
				</section>

				<!-- Firma -->
				<section class="perfil-card">
					<header class="perfil-card-cabecera">
						<span class="perfil-card-icono">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
								/>
							</svg>
						</span>
						<h2>Mi firma</h2>
					</header>

					<input
						type="file"
						accept="image/*"
						class="hidden"
						bind:this={fileInput}
						on:change={handleFirmaUpload}
					/>

					{#if firmaLoading}
						<div class="perfil-cargando perfil-cargando--corto">
							<div class="perfil-spinner" aria-hidden="true"></div>
						</div>
					{:else if firmaSignedUrl}
						<div class="perfil-firma">
							<div class="perfil-firma-marco">
								<img src={firmaSignedUrl} alt="Mi firma" />
							</div>
							<div class="perfil-firma-acciones">
								<button
									type="button"
									class="btn-secondary"
									on:click={() => fileInput?.click()}
									disabled={uploadingFirma}
								>
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
										/></svg
									>
									Cambiar
								</button>
								<button
									type="button"
									class="btn-secondary perfil-btn-peligro"
									on:click={handleDeleteFirma}
								>
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/></svg
									>
									Eliminar
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							class="perfil-subir"
							on:click={() => fileInput?.click()}
							disabled={uploadingFirma}
						>
							{#if uploadingFirma}
								<span class="perfil-spinner" aria-hidden="true"></span>
								<span class="perfil-subir-titulo">Subiendo…</span>
							{:else}
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
									/></svg
								>
								<span class="perfil-subir-titulo">Subir firma</span>
								<span class="perfil-subir-sub">PNG, JPG o WEBP</span>
							{/if}
						</button>
					{/if}
				</section>
			</div>

			<div class="perfil-columna">
				<!-- Sesión -->
				<section class="perfil-card">
					<header class="perfil-card-cabecera">
						<span class="perfil-card-icono">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/>
							</svg>
						</span>
						<h2>Sesión actual</h2>
						{#if sesion}
							<span class="perfil-estado perfil-estado--activa">
								<span class="perfil-estado-punto" aria-hidden="true"></span>
								Activa
							</span>
						{:else}
							<span class="perfil-estado">Sin sesión registrada</span>
						{/if}
					</header>

					{#if sesion}
						{@const ua = parseUserAgent(sesion.user_agent)}
						<dl class="perfil-datos perfil-datos--dos">
							<div class="perfil-dato">
								<dt>Dirección IP</dt>
								<dd class="perfil-mono">{sesion.ip || 'N/A'}</dd>
							</div>
							<div class="perfil-dato">
								<dt>Navegador / SO</dt>
								<dd>{ua.browser} · {ua.os}</dd>
							</div>
							<div class="perfil-dato">
								<dt>Duración</dt>
								<dd>{sesion.duracion_texto}</dd>
							</div>
							<div class="perfil-dato">
								<dt>Inicio de sesión</dt>
								<dd>{formatDate(sesion.created_at)}</dd>
							</div>
							<div class="perfil-dato">
								<dt>Última actividad</dt>
								<dd>{formatDate(sesion.last_activity)}</dd>
							</div>
							<div class="perfil-dato">
								<dt>Expiración del token</dt>
								<dd>
									{formatDate(sesion.token_expiry)}
									{#if sesion.remember_me}
										<span class="perfil-chip perfil-chip--nota">Recordar sesión</span>
									{/if}
								</dd>
							</div>
						</dl>
					{:else}
						<p class="perfil-vacio">
							No se encontró una sesión activa registrada. Las sesiones se registran desde el próximo
							inicio de sesión.
						</p>
					{/if}
				</section>

				<!-- Seguridad -->
				<section class="perfil-card">
					<header class="perfil-card-cabecera">
						<span class="perfil-card-icono">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
								/>
							</svg>
						</span>
						<h2>Seguridad</h2>
					</header>

					{#if !showPasswordForm}
						<button type="button" class="btn-secondary" on:click={() => (showPasswordForm = true)}>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
								/>
							</svg>
							Cambiar contraseña
						</button>
					{:else}
						<div class="perfil-form" in:fly={{ y: 10, duration: 200 }}>
							<div class="perfil-campo">
								<label for="current-pw">Contraseña actual</label>
								<div class="perfil-campo-ojo">
									<input
										id="current-pw"
										type={showCurrentPw ? 'text' : 'password'}
										bind:value={currentPassword}
										placeholder="Ingresa tu contraseña actual"
										class="input-glow perfil-input"
									/>
									<button
										type="button"
										class="perfil-ojo"
										on:click={() => (showCurrentPw = !showCurrentPw)}
										aria-label={showCurrentPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
									>
										{#if showCurrentPw}
											<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
												/></svg
											>
										{:else}
											<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
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
										{/if}
									</button>
								</div>
							</div>

							<div class="perfil-campo">
								<label for="new-pw">Nueva contraseña</label>
								<div class="perfil-campo-ojo">
									<input
										id="new-pw"
										type={showNewPw ? 'text' : 'password'}
										bind:value={newPassword}
										placeholder="Mínimo 6 caracteres"
										class="input-glow perfil-input"
									/>
									<button
										type="button"
										class="perfil-ojo"
										on:click={() => (showNewPw = !showNewPw)}
										aria-label={showNewPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
									>
										{#if showNewPw}
											<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
												><path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
												/></svg
											>
										{:else}
											<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
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
										{/if}
									</button>
								</div>
							</div>

							<div class="perfil-campo">
								<label for="confirm-pw">Confirmar nueva contraseña</label>
								<input
									id="confirm-pw"
									type="password"
									bind:value={confirmPassword}
									placeholder="Repite la nueva contraseña"
									class="input-glow perfil-input"
									class:perfil-input--error={confirmPassword && confirmPassword !== newPassword}
								/>
								{#if confirmPassword && confirmPassword !== newPassword}
									<p class="perfil-error">Las contraseñas no coinciden</p>
								{/if}
							</div>

							<div class="perfil-form-acciones">
								<button
									type="button"
									class="btn-secondary"
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
									type="button"
									class="btn-primary"
									disabled={savingPassword ||
										!currentPassword ||
										!newPassword ||
										newPassword !== confirmPassword}
									on:click={handleChangePassword}
								>
									{#if savingPassword}<span
											class="perfil-spinner perfil-spinner--mini"
											aria-hidden="true"
										></span>{/if}
									Cambiar contraseña
								</button>
							</div>
						</div>
					{/if}
				</section>

				<!-- Conectar con Claude: tokens personales para consultar la app por MCP -->
				<section class="perfil-card">
					<header class="perfil-card-cabecera">
						<span class="perfil-card-icono">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13 10V3L4 14h7v7l9-11h-7z"
								/>
							</svg>
						</span>
						<h2>Conectar con Claude</h2>
					</header>
					<ConexionesClaude />
				</section>
			</div>
		</div>
	{/if}
</div>

<style>
	.perfil {
		gap: 1.25rem;
	}

	/* ── Cabecera ── */
	.perfil-hero {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.25rem;
		padding: 1.5rem;
		border-radius: 24px;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 70%);
		color: #fff;
		overflow: hidden;
		isolation: isolate;
	}
	.perfil-orbe {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.07);
		z-index: -1;
	}
	.perfil-orbe--grande {
		width: 260px;
		height: 260px;
		right: -70px;
		top: -140px;
	}
	.perfil-orbe--chico {
		width: 110px;
		height: 110px;
		left: 38%;
		bottom: -70px;
	}
	.perfil-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 4.5rem;
		height: 4.5rem;
		flex-shrink: 0;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.14);
		border: 2px solid rgba(255, 255, 255, 0.28);
		font-family: var(--font-display);
		font-size: 1.9rem;
		font-weight: 800;
		color: #fff;
	}
	.perfil-identidad {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		flex: 1;
		min-width: 0;
	}
	.perfil-eyebrow {
		white-space: nowrap;
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}
	.perfil-nombre {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 3vw, 1.9rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		color: #fff;
	}
	.perfil-correo {
		margin: 0;
		font-size: 0.88rem;
		color: rgba(255, 255, 255, 0.75);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.perfil-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.45rem;
	}
	.perfil-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		font-size: 0.68rem;
		font-weight: 700;
		color: #fff;
	}
	.perfil-chip--rol {
		background: rgba(255, 255, 255, 0.9);
		color: var(--au-dark);
	}
	.perfil-chip--nota {
		background: var(--au-tint);
		color: var(--emerald-800);
		margin-left: 0.4rem;
	}
	.perfil-hero-acciones {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	/* En móvil las acciones bajan a su propia línea: en la misma fila que la
	   identidad dejaban el nombre en tres líneas y el correo cortado. */
	@media (max-width: 639.98px) {
		.perfil-hero {
			padding: 1.25rem;
		}
		.perfil-avatar {
			width: 3.5rem;
			height: 3.5rem;
			font-size: 1.5rem;
		}
		.perfil-hero-acciones {
			flex-basis: 100%;
		}
		.perfil-hero-acciones .perfil-btn-hero {
			flex: 1;
			justify-content: center;
		}
	}
	.perfil-btn-hero {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.6rem 1.1rem;
		border-radius: 14px;
		border: 1.5px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.1);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		color: #fff;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.perfil-btn-hero:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.18);
		border-color: rgba(255, 255, 255, 0.4);
	}
	.perfil-btn-hero--solido {
		background: #fff;
		border-color: #fff;
		color: var(--au-dark);
	}
	.perfil-btn-hero--solido:hover:not(:disabled) {
		background: var(--au-tint);
		border-color: var(--au-tint);
	}
	.perfil-btn-hero:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.perfil-btn-hero svg {
		width: 16px;
		height: 16px;
	}

	/* ── Rejilla de tarjetas ── */
	.perfil-grid {
		display: grid;
		gap: 1.25rem;
		align-items: start;
	}
	@media (min-width: 1024px) {
		.perfil-grid {
			grid-template-columns: 5fr 7fr;
		}
	}
	.perfil-columna {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}
	.perfil-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 20px;
		padding: 1.25rem;
		box-shadow: var(--shadow-card);
	}
	.perfil-card-cabecera {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-bottom: 1rem;
	}
	.perfil-card-cabecera h2 {
		margin: 0;
		flex: 1;
		font-family: var(--font-display);
		font-size: 1.02rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--text-primary);
	}
	.perfil-card-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		border-radius: 10px;
		background: var(--au-tint);
		color: var(--emerald-800);
	}
	.perfil-card-icono svg {
		width: 17px;
		height: 17px;
	}

	/* ── Datos etiqueta / valor ── */
	.perfil-datos {
		display: grid;
		gap: 0.6rem;
		margin: 0;
	}
	.perfil-datos--dos {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@media (max-width: 480px) {
		.perfil-datos--dos {
			grid-template-columns: 1fr;
		}
	}
	.perfil-dato {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.7rem 0.85rem;
		border-radius: 12px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		min-width: 0;
	}
	.perfil-dato dt {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.perfil-dato dd {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.perfil-dato-cortar {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.perfil-mono {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}
	.perfil-vacio {
		margin: 0;
		padding: 1.5rem 1rem;
		border-radius: 12px;
		border: 1px dashed var(--border-default);
		text-align: center;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	/* ── Estado de sesión ── */
	.perfil-estado {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.perfil-estado--activa {
		background: var(--au-tint);
		border-color: transparent;
		color: var(--emerald-800);
	}
	.perfil-estado-punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--emerald-500);
		animation: perfil-latido 1.6s ease-in-out infinite;
	}
	@keyframes perfil-latido {
		50% {
			opacity: 0.35;
		}
	}

	/* ── Firma ── */
	.perfil-firma {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.85rem;
	}
	.perfil-firma-marco {
		padding: 0.75rem 1rem;
		border-radius: 14px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
	}
	.perfil-firma-marco img {
		max-height: 8rem;
		width: auto;
		object-fit: contain;
	}
	.perfil-firma-acciones {
		display: flex;
		gap: 0.5rem;
	}
	.perfil-firma-acciones svg {
		width: 16px;
		height: 16px;
	}
	.perfil-btn-peligro {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
	}
	.perfil-btn-peligro:hover:not(:disabled) {
		background: rgba(220, 38, 38, 0.06);
		border-color: rgba(220, 38, 38, 0.5);
	}
	.perfil-subir {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		padding: 1.75rem 1rem;
		border-radius: 14px;
		border: 2px dashed var(--border-default);
		background: transparent;
		font-family: inherit;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.perfil-subir:hover:not(:disabled) {
		border-color: var(--emerald-500);
		background: var(--au-tint);
		color: var(--emerald-800);
	}
	.perfil-subir:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.perfil-subir svg {
		width: 28px;
		height: 28px;
	}
	.perfil-subir-titulo {
		font-size: 0.88rem;
		font-weight: 700;
	}
	.perfil-subir-sub {
		font-size: 0.72rem;
	}

	/* ── Formulario de contraseña ── */
	.perfil-form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		max-width: 28rem;
	}
	.perfil-campo {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.perfil-campo label {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.perfil-campo-ojo {
		position: relative;
	}
	.perfil-campo-ojo .perfil-input {
		padding-right: 2.5rem;
	}
	.perfil-input {
		width: 100%;
		padding: 0.6rem 0.85rem;
		border-radius: 12px;
		border: 1.5px solid var(--border-default);
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.9rem;
		color: var(--text-primary);
	}
	.perfil-input--error {
		border-color: #f87171;
	}
	.perfil-ojo {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.perfil-ojo:hover {
		color: var(--text-primary);
		background: var(--bg-base);
	}
	.perfil-ojo svg {
		width: 16px;
		height: 16px;
	}
	.perfil-error {
		margin: 0;
		font-size: 0.75rem;
		color: #dc2626;
	}
	.perfil-form-acciones {
		display: flex;
		gap: 0.6rem;
		padding-top: 0.25rem;
	}

	/* ── Carga ── */
	.perfil-cargando {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 5rem 1rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.perfil-cargando--corto {
		padding: 1.5rem;
	}
	.perfil-cargando p {
		margin: 0;
	}
	.perfil-spinner {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		border: 3px solid var(--au-tint);
		border-top-color: var(--emerald-500);
		animation: perfil-girar 0.8s linear infinite;
	}
	.perfil-spinner--mini {
		width: 1rem;
		height: 1rem;
		border-width: 2px;
		border-color: rgba(255, 255, 255, 0.35);
		border-top-color: currentColor;
	}
	@keyframes perfil-girar {
		to {
			transform: rotate(360deg);
		}
	}
</style>
