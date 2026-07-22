<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	let correo = '';
	let password = '';
	let showPassword = false;
	let mounted = false;
	let remember = false;

	$: error = $authStore.error;
	$: isLoading = $authStore.isLoading;
	$: redirectPath = (() => {
		const raw = $page.url.searchParams.get('redirect');
		if (raw && raw.startsWith('/dashboard/nomina')) return null;
		return raw;
	})();

	onMount(() => {
		authStore.init();

		if (authStore.isAuthenticated()) {
			let savedRedirect = localStorage.getItem('redirect_after_login');
			if (savedRedirect?.startsWith('/dashboard/nomina')) savedRedirect = null;
			const targetPath = redirectPath || savedRedirect || '/dashboard/servicios';

			localStorage.removeItem('redirect_after_login');
			goto(targetPath);
			return;
		}

		remember = localStorage.getItem('remember_me') === 'true';
		if (remember) {
			const savedEmail = localStorage.getItem('remembered_email');
			if (savedEmail) correo = savedEmail;
		}

		mounted = true;
	});

	async function handleLogin() {
		if (!correo || !password) return;

		if (remember) {
			localStorage.setItem('remember_me', 'true');
			localStorage.setItem('remembered_email', correo);
		} else {
			localStorage.removeItem('remember_me');
			localStorage.removeItem('remembered_email');
		}

		const success = await authStore.login(correo, password);

		if (success) {
			let savedRedirect = localStorage.getItem('redirect_after_login');
			if (savedRedirect?.startsWith('/dashboard/nomina')) savedRedirect = null;
			const targetPath = redirectPath || savedRedirect || '/dashboard/servicios';
			localStorage.removeItem('redirect_after_login');
			goto(targetPath);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleLogin();
		}
	}

	function togglePassword() {
		showPassword = !showPassword;
	}
</script>

<svelte:head>
	<title>Iniciar sesión — Cotransmeq (NIT 901983227)</title>
	<meta
		name="description"
		content="Acceso al sistema de gestión integral de Cotransmeq — Transporte especial de personal petrolero (NIT 901983227)."
	/>
</svelte:head>

{#if mounted}
	<div class="login-page" in:fade={{ duration: 300 }}>
		<!-- Ambient orbs (naranja + verde, sutiles) -->
		<div class="orbs" aria-hidden="true">
			<div class="orb orb-1"></div>
			<div class="orb orb-2"></div>
		</div>

		<div class="login-card" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
			<!-- ═══ LEFT: Brand panel (slate editorial con tinte naranja) ═══ -->
			<aside class="brand-panel">
				<!-- Patrón decorativo de puntos -->
				<div class="brand-pattern" aria-hidden="true"></div>

				<div class="brand-head">
					<div class="brand-mark">
						<img
							class="brand-logo"
							src="/assets/logo_nombre.webp"
							alt="Cotransmeq"
							width="132"
							height="45"
						/>
					</div>
				</div>

				<div class="brand-body">
					<span class="brand-code">Sistema de Gestión · NIT 901983227</span>
					<h2 class="brand-title">
						Plataforma centralizada para la operación logística
					</h2>
					<p class="brand-desc">
						Administración de servicios de transporte, clientes, conductores y
						liquidaciones con trazabilidad completa.
					</p>

					<ul class="brand-features">
						<li>
							<span class="feature-mark">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							</span>
							Control de servicios y trazabilidad
						</li>
						<li>
							<span class="feature-mark">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							</span>
							Gestión de clientes y conductores
						</li>
						<li>
							<span class="feature-mark">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							</span>
							Liquidaciones y reportes operativos
						</li>
					</ul>
				</div>

				<div class="brand-foot">
					<span class="status-dot"></span>
					<span class="status-text">Sistema operativo</span>
					<span class="status-sep">·</span>
					<span class="status-meta">Habilitación nacional vigente</span>
				</div>
			</aside>

			<!-- ═══ RIGHT: Form panel (white card) ═══ -->
			<section class="form-panel">
				<!-- Mobile brand (visible solo <lg) -->
				<div class="mobile-brand">
					<img
						class="mobile-logo"
						src="/assets/logo_cotransmeq-264.webp"
						alt="Cotransmeq"
						width="120"
						height="40"
					/>
				</div>

				<div class="form-head">
					<span class="eyebrow">Acceso seguro</span>
					<h1 class="form-title">Bienvenido de vuelta</h1>
					<p class="form-subtitle">
						Ingresa tus credenciales para acceder al sistema.
					</p>
				</div>

				{#if error}
					<div class="alert alert-error" in:fly={{ y: -8, duration: 250 }}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
							/>
						</svg>
						<div>
							<strong>No pudimos iniciar sesión.</strong>
							<p>{error}</p>
						</div>
					</div>
				{/if}

				<form class="login-form" on:submit|preventDefault={handleLogin}>
					<!-- Email -->
					<div class="field">
						<label for="correo" class="field-label">Correo electrónico</label>
						<div class="field-control">
							<svg
								class="field-icon"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
								/>
							</svg>
							<input
								type="email"
								id="correo"
								bind:value={correo}
								on:keydown={handleKeydown}
								placeholder="usuario@cotransmeq.com"
								autocomplete="email"
								class="field-input"
								required
								disabled={isLoading}
							/>
						</div>
					</div>

					<!-- Password -->
					<div class="field">
						<label for="password" class="field-label">Contraseña</label>
						<div class="field-control">
							<svg
								class="field-icon"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
								/>
							</svg>
							<input
								type={showPassword ? 'text' : 'password'}
								id="password"
								bind:value={password}
								on:keydown={handleKeydown}
								placeholder="••••••••"
								autocomplete="current-password"
								class="field-input field-input--with-action"
								required
								disabled={isLoading}
							/>
							<button
								type="button"
								class="field-action"
								on:click={togglePassword}
								disabled={isLoading}
								aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
							>
								{#if showPassword}
									<svg
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
										/>
									</svg>
								{:else}
									<svg
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
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
								{/if}
							</button>
						</div>
					</div>

					<!-- Remember + forgot -->
					<div class="form-row">
						<label class="checkbox">
							<input
								type="checkbox"
								bind:checked={remember}
								class="checkbox-input"
								disabled={isLoading}
							/>
							<span class="checkbox-label">Recordarme en este dispositivo</span>
						</label>
						<button
							type="button"
							class="forgot-link"
							disabled={isLoading}
						>
							¿Olvidaste tu contraseña?
						</button>
					</div>

					<!-- Submit -->
					<button
						type="submit"
						class="btn-submit"
						disabled={isLoading || !correo || !password}
					>
						{#if isLoading}
							<span class="btn-content">
								<svg class="spin" viewBox="0 0 24 24" fill="none">
									<circle
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="3"
										opacity="0.25"
									/>
									<path
										d="M4 12a8 8 0 018-8v0"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
									/>
								</svg>
								Verificando credenciales…
							</span>
						{:else}
							<span class="btn-content">
								Iniciar sesión
								<svg
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M14 5l7 7m0 0l-7 7m7-7H3"
									/>
								</svg>
							</span>
						{/if}
					</button>
				</form>

				<div class="secure-row">
					<span class="secure-sep"></span>
					<span class="secure-text">Acceso cifrado · TLS 1.3</span>
					<span class="secure-sep"></span>
				</div>

				<p class="footer-copy">
					© {new Date().getFullYear()} Cotransmeq · Puerto Gaitán, Meta · Colombia · NIT 901983227
				</p>
			</section>
		</div>
	</div>
{/if}

<style>
	/* ════════════════════════════════════════════════════════════
	   LOGIN PAGE — Aplicación del skill landing-cotransmeq-design-system
	   Base off-white #fcfcfb + naranja (#f97316) acento principal +
	   verde bosque (#166534) acento secundario. Geist única. Sin serif.
	   ════════════════════════════════════════════════════════════ */
	.login-page {
		position: relative;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background-color: #fcfcfb;
		font-family: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
		color: #0f172a;
		-webkit-font-smoothing: antialiased;
		overflow: hidden;
	}

	/* Orbes ambientales (naranja + verde, sutiles) */
	.orbs {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}
	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(80px);
	}
	.orb-1 {
		top: -8rem;
		right: -6rem;
		width: 28rem;
		height: 28rem;
		background: rgba(249, 115, 22, 0.18);
	}
	.orb-2 {
		bottom: -10rem;
		left: -8rem;
		width: 32rem;
		height: 32rem;
		background: rgba(22, 101, 52, 0.12);
	}

	/* ═══ Card principal (2 columnas) ═══ */
	.login-card {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: 1fr;
		width: 100%;
		max-width: 980px;
		background: #ffffff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 24px;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.04),
			0 20px 60px rgba(15, 23, 42, 0.08);
		overflow: hidden;
	}
	@media (min-width: 1024px) {
		.login-card {
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		}
	}

	/* ════════════════════════════════════════════════════════════
	   BRAND PANEL — Slate editorial (#0f172a) con tinte naranja
	   ════════════════════════════════════════════════════════════ */
	.brand-panel {
		position: relative;
		display: none;
		flex-direction: column;
		justify-content: space-between;
		padding: 2.75rem 2.5rem;
		background: #0f172a;
		color: #fcfcfb;
		overflow: hidden;
		isolation: isolate;
	}
	@media (min-width: 1024px) {
		.brand-panel {
			display: flex;
		}
	}

	.brand-pattern {
		position: absolute;
		inset: 0;
		pointer-events: none;
		opacity: 0.06;
		background-image:
			radial-gradient(circle at 20% 30%, white 1px, transparent 1px),
			radial-gradient(circle at 70% 60%, white 1px, transparent 1px);
		background-size: 28px 28px, 32px 32px;
		mask-image: radial-gradient(ellipse at top left, black 0%, transparent 75%);
		-webkit-mask-image: radial-gradient(ellipse at top left, black 0%, transparent 75%);
	}

	/* Detalle naranja tint superior derecho */
	.brand-panel::before {
		content: '';
		position: absolute;
		top: -6rem;
		right: -6rem;
		width: 18rem;
		height: 18rem;
		background: radial-gradient(circle, rgba(249, 115, 22, 0.30) 0%, transparent 70%);
		pointer-events: none;
		z-index: -1;
	}

	.brand-head {
		position: relative;
		z-index: 1;
	}

	.brand-mark {
		display: flex;
		align-items: center;
	}

	.brand-logo {
		height: 70px;
		width: auto;
		display: block;
	}

	.brand-body {
		position: relative;
		z-index: 1;
	}

	.brand-code {
		display: inline-block;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.12);
		padding: 0.35rem 0.8rem;
		border-radius: 9999px;
		margin-bottom: 1.25rem;
		font-variant-numeric: tabular-nums;
	}

	.brand-title {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: clamp(1.6rem, 2.4vw, 1.95rem);
		font-weight: 600;
		line-height: 1.18;
		letter-spacing: -0.015em;
		color: #fcfcfb;
		margin: 0 0 0.85rem;
	}

	.brand-desc {
		font-size: 0.875rem;
		line-height: 1.6;
		color: rgba(252, 252, 251, 0.7);
		margin: 0 0 1.75rem;
	}

	.brand-features {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.brand-features li {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-size: 0.8125rem;
		color: rgba(252, 252, 251, 0.85);
	}
	.feature-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: rgba(249, 115, 22, 0.20);
		color: #f97316;
		flex-shrink: 0;
	}
	.feature-mark svg {
		width: 12px;
		height: 12px;
	}

	.brand-foot {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.7rem;
		color: rgba(252, 252, 251, 0.55);
	}
	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #22c55e;
		box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
		animation: pulse 2.5s ease-in-out infinite;
	}
	.status-text {
		font-weight: 600;
		color: rgba(252, 252, 251, 0.75);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.status-sep {
		opacity: 0.4;
	}
	.status-meta {
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
		}
		50% {
			box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.06);
		}
	}

	/* ════════════════════════════════════════════════════════════
	   FORM PANEL — White card
	   ════════════════════════════════════════════════════════════ */
	.form-panel {
		padding: 2.25rem 1.75rem 1.75rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	@media (min-width: 640px) {
		.form-panel {
			padding: 3rem 2.5rem 2.25rem;
		}
	}
	@media (min-width: 1024px) {
		.form-panel {
			padding: 3.5rem 3rem;
		}
	}

	.mobile-brand {
		display: flex;
		align-items: center;
		margin-bottom: 2rem;
	}
	.mobile-logo {
		height: 32px;
		width: auto;
		display: block;
	}
	@media (min-width: 1024px) {
		.mobile-brand {
			display: none;
		}
	}

	.form-head {
		margin-bottom: 1.75rem;
	}

	.eyebrow {
		display: inline-block;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.35rem 0.8rem;
		border-radius: 9999px;
		margin-bottom: 0.85rem;
	}

	.form-title {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: clamp(1.65rem, 3.6vw, 2rem);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.02em;
		color: #0f172a;
		margin: 0 0 0.5rem;
	}

	.form-subtitle {
		font-size: 0.9rem;
		line-height: 1.55;
		color: #64748b;
		margin: 0;
	}

	/* ═══ Alert de error (estilo skill) ═══ */
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.85rem 1.1rem;
		border-radius: 12px;
		margin-bottom: 1.5rem;
	}
	.alert-error {
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.22);
		color: #991b1b;
	}
	.alert-error svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: #dc2626;
		margin-top: 0.1rem;
	}
	.alert-error strong {
		display: block;
		font-size: 0.85rem;
		font-weight: 700;
		margin-bottom: 0.15rem;
	}
	.alert-error p {
		font-size: 0.8rem;
		line-height: 1.45;
		margin: 0;
		color: #b91c1c;
	}

	/* ═══ Form ═══ */
	.login-form {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.field-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #0f172a;
		letter-spacing: -0.005em;
	}

	.field-control {
		position: relative;
	}

	.field-icon {
		position: absolute;
		left: 0.95rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: #94a3b8;
		pointer-events: none;
		transition: color 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}

	.field-input {
		width: 100%;
		padding: 0.7rem 0.95rem 0.7rem 2.55rem;
		font-size: 0.9rem;
		font-family: inherit;
		color: #0f172a;
		background: #ffffff;
		border: 1px solid rgba(15, 23, 42, 0.12);
		border-radius: 12px;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.field-input::placeholder {
		color: #94a3b8;
	}
	.field-input--with-action {
		padding-right: 2.85rem;
	}
	.field-input:hover:not(:disabled) {
		border-color: rgba(15, 23, 42, 0.20);
	}
	.field-input:focus {
		outline: none;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.10);
	}
	.field-input:focus + .field-action,
	.field-control:focus-within .field-icon {
		color: #f97316;
	}
	.field-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		background: #fcfcfb;
	}

	.field-action {
		position: absolute;
		right: 0.6rem;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: #94a3b8;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.field-action:hover:not(:disabled) {
		color: #ea580c;
		background: rgba(249, 115, 22, 0.06);
	}
	.field-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.field-action svg {
		width: 16px;
		height: 16px;
	}

	/* ═══ Remember + forgot ═══ */
	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding-top: 0.15rem;
	}

	.checkbox {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		user-select: none;
	}
	.checkbox-input {
		width: 16px;
		height: 16px;
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
		border: 1.5px solid rgba(15, 23, 42, 0.24);
		border-radius: 4px;
		background: #ffffff;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		position: relative;
		flex-shrink: 0;
	}
	.checkbox-input:hover:not(:disabled) {
		border-color: #f97316;
	}
	.checkbox-input:checked {
		background: linear-gradient(135deg, #f97316, #ea580c);
		border-color: transparent;
	}
	.checkbox-input:checked::after {
		content: '';
		position: absolute;
		top: 1px;
		left: 4px;
		width: 5px;
		height: 9px;
		border: solid #ffffff;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	.checkbox-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.checkbox-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: #64748b;
		transition: color 0.2s;
	}
	.checkbox:hover .checkbox-label {
		color: #0f172a;
	}

	.forgot-link {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #f97316;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
		transition: color 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.forgot-link:hover:not(:disabled) {
		color: #ea580c;
	}
	.forgot-link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ═══ Submit button (gradiente naranja 135deg) ═══ */
	.btn-submit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.85rem 1.25rem;
		margin-top: 0.5rem;
		font-family: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: #ffffff;
		background: linear-gradient(135deg, #f97316, #ea580c);
		border: none;
		border-radius: 12px;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.btn-submit:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.40);
	}
	.btn-submit:active:not(:disabled) {
		transform: translateY(0);
	}
	.btn-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		box-shadow: none;
	}
	.btn-content {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.btn-content svg {
		width: 16px;
		height: 16px;
	}

	.spin {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ═══ Secure row (separador con texto) ═══ */
	.secure-row {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		margin-top: 1.75rem;
	}
	.secure-sep {
		flex: 1;
		height: 1px;
		background: rgba(15, 23, 42, 0.08);
	}
	.secure-text {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #94a3b8;
	}

	.footer-copy {
		font-size: 0.75rem;
		color: #94a3b8;
		text-align: center;
		margin: 1rem 0 0;
		line-height: 1.5;
	}

	/* ═══ Responsive fino ═══ */
	@media (max-width: 1023.98px) {
		.login-card {
			max-width: 480px;
		}
		.brand-panel {
			padding: 2rem 1.75rem 1.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.login-card,
		.alert,
		.btn-submit,
		.field-input,
		.field-icon,
		.field-action,
		.forgot-link,
		.status-dot {
			transition: none !important;
			animation: none !important;
		}
	}
</style>
