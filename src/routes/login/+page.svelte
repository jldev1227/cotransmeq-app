<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	/** Tiempo mínimo en pantalla del loader de montaje: evita el parpadeo. */
	const MIN_BOOT_MS = 550;
	/**
	 * Techo para la hidratación de sesión. `authStore.init()` refresca el perfil
	 * contra la API; si esa llamada se cuelga no se puede dejar al usuario
	 * mirando el loader hasta el timeout de 30s de axios.
	 */
	const AUTH_CHECK_TIMEOUT_MS = 3000;

	let correo = '';
	let password = '';
	let showPassword = false;
	let remember = false;

	/** false → loader de montaje; true → formulario. */
	let ready = false;
	/** Sesión válida detectada: el loader se queda puesto durante el `goto`. */
	let redirecting = false;
	/**
	 * Error mostrado en el formulario. Es estado LOCAL (no `$authStore.error`)
	 * a propósito: así el mensaje sobrevive a cualquier cambio posterior del
	 * store y solo se limpia cuando el usuario vuelve a enviar el formulario.
	 */
	let formError: string | null = null;
	let errorBox: HTMLDivElement | null = null;

	$: isLoading = $authStore.isLoading;
	/**
	 * El correo ya escrito viaja a la pantalla de recuperación: quien llega
	 * ahí acaba de fallar el login y no tiene por qué teclearlo otra vez.
	 */
	$: enlaceRecuperacion = correo.trim()
		? `/recuperar-password?correo=${encodeURIComponent(correo.trim())}`
		: '/recuperar-password';
	$: redirectPath = (() => {
		const raw = $page.url.searchParams.get('redirect');
		if (raw && raw.startsWith('/dashboard/nomina')) return null;
		return raw;
	})();

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	/** Destino post-login, ignorando siempre el módulo de nómina. */
	function resolveTarget(): string {
		let savedRedirect = localStorage.getItem('redirect_after_login');
		if (savedRedirect?.startsWith('/dashboard/nomina')) savedRedirect = null;
		const targetPath = redirectPath || savedRedirect || '/dashboard/servicios';
		localStorage.removeItem('redirect_after_login');
		return targetPath;
	}

	onMount(async () => {
		// El loader corre mientras se hidrata la sesión. Ambas esperas van en
		// paralelo: la comprobación real y el mínimo visual del loader.
		const bootDelay = sleep(MIN_BOOT_MS);

		// `init()` es asíncrono: sin `await` la comprobación de sesión de abajo
		// se ejecutaba antes de que el store estuviera hidratado y nunca
		// redirigía a un usuario ya autenticado.
		await Promise.race([
			authStore.init().catch(() => undefined),
			sleep(AUTH_CHECK_TIMEOUT_MS)
		]);

		if (authStore.isAuthenticated()) {
			redirecting = true;
			await bootDelay;
			goto(resolveTarget());
			return;
		}

		remember = localStorage.getItem('remember_me') === 'true';
		if (remember) {
			const savedEmail = localStorage.getItem('remembered_email');
			if (savedEmail) correo = savedEmail;
		}

		await bootDelay;
		ready = true;
	});

	async function handleLogin() {
		if (isLoading) return;

		// El error anterior solo se limpia al reintentar, nunca por teclear.
		formError = null;

		const correoLimpio = correo.trim();
		if (!correoLimpio || !password) {
			formError = 'Ingresa tu correo y tu contraseña para continuar.';
			return;
		}

		if (remember) {
			localStorage.setItem('remember_me', 'true');
			localStorage.setItem('remembered_email', correoLimpio);
		} else {
			localStorage.removeItem('remember_me');
			localStorage.removeItem('remembered_email');
		}

		const success = await authStore.login(correoLimpio, password);

		if (!success) {
			// Se muestra el detalle que devolvió la API y el formulario queda
			// exactamente como estaba: ni se limpian `correo`/`password` ni se
			// recarga la página, para que el usuario corrija y reintente.
			formError =
				get(authStore).error ?? 'No se pudo iniciar sesión. Inténtalo de nuevo.';
			await tick();
			errorBox?.focus();
			return;
		}

		goto(resolveTarget());
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleLogin();
		}
	}

	function dismissError() {
		formError = null;
		authStore.clearError();
	}

	function togglePassword() {
		showPassword = !showPassword;
	}
</script>

<svelte:head>
	<title>Iniciar sesión — Cotransmeq S.A.S</title>
	<meta
		name="description"
		content="Acceso al sistema de gestión integral de Cotransmeq S.A.S."
	/>
</svelte:head>

{#if !ready}
	<!-- ═══ Loader de montaje: cubre la hidratación de sesión ═══ -->
	<div class="boot-screen" out:fade={{ duration: 250 }}>
		<div class="boot-inner" in:fade={{ duration: 400 }}>
			<!-- Logo en versión oscura: el fondo del loader ya no es verde. -->
			<img
				class="boot-logo"
				src="/assets/logo_transmeralda-264.webp"
				alt="Cotransmeq S.A.S"
				width="160"
				height="55"
			/>
			<div class="boot-track" aria-hidden="true">
				<span class="boot-fill"></span>
			</div>
			<p class="boot-text" role="status">
				{redirecting ? 'Sesión activa · redirigiendo…' : 'Preparando el acceso seguro…'}
			</p>
		</div>
	</div>
{/if}

{#if ready}
	<div class="login-page" in:fade={{ duration: 300, delay: 120 }}>
		<!-- Soft ambient orbs (sutiles, editorial) -->
		<div class="orbs" aria-hidden="true">
			<div class="orb orb-1"></div>
			<div class="orb orb-2"></div>
		</div>

		<div class="login-card" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
			<!-- ═══ LEFT: Brand panel (charcoal editorial) ═══ -->
			<aside class="brand-panel">
				<!-- Patrón decorativo de puntos -->
				<div class="brand-pattern" aria-hidden="true"></div>

				<div class="brand-head">
					<div class="brand-mark">
						<img
							class="brand-logo"
							src="/assets/logo_transmeralda_white-264.webp"
							alt="Cotransmeq S.A.S"
							width="132"
							height="45"
						/>
					</div>
				</div>

				<div class="brand-body">
					<span class="brand-code">Sistema de Gestión · v2.0</span>
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
						src="/assets/logo_transmeralda-264.webp"
						alt="Cotransmeq S.A.S"
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

				{#if formError}
					<div
						class="alert alert-error"
						role="alert"
						aria-live="assertive"
						tabindex="-1"
						bind:this={errorBox}
						in:fly={{ y: -8, duration: 250 }}
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
							/>
						</svg>
						<div class="alert-body">
							<strong>No pudimos iniciar sesión.</strong>
							<p>{formError}</p>
						</div>
						<button
							type="button"
							class="alert-close"
							on:click={dismissError}
							aria-label="Cerrar mensaje de error"
						>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
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
						<a class="forgot-link" href={enlaceRecuperacion}>
							¿Olvidaste tu contraseña?
						</a>
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
					© {new Date().getFullYear()} Cotransmeq S.A.S · Yopal, Casanare ·
					Colombia
				</p>
			</section>
		</div>
	</div>
{/if}

<style>
	/* ════════════════════════════════════════════════════════════
	   LOGIN PAGE — Aplicación del skill landing-transmeralda
	   Fondo crema editorial; el verde queda como acento (botón,
	   foco, panel de marca), nunca como lienzo.
	   ════════════════════════════════════════════════════════════ */

	/*
	 * Paleta del fondo, compartida por el loader de montaje y la página.
	 * Antes era un degradado verde esmeralda a pantalla completa. Se retiró:
	 * competía con el acento de la marca dentro de la tarjeta y cada pantalla
	 * de acceso nueva lo copiaba sin pensarlo. Las pantallas nuevas ya no lo
	 * duplican porque comparten `$lib/components/auth/AuthShell.svelte`.
	 */
	.boot-screen,
	.login-page {
		background-color: #fcfcfb;
		background-image:
			radial-gradient(ellipse at 15% -10%, rgba(249, 115, 22, 0.12) 0%, transparent 55%),
			radial-gradient(ellipse at 90% 110%, rgba(15, 31, 26, 0.07) 0%, transparent 55%);
	}

	.login-page {
		position: relative;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
		color: #1a1a1a;
		-webkit-font-smoothing: antialiased;
		overflow: hidden;
	}

	/* Orbes ambientales sutiles (editorial, no neón) */
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
		top: -10rem;
		right: -7rem;
		width: 28rem;
		height: 28rem;
		background: rgba(249, 115, 22, 0.12);
	}
	.orb-2 {
		bottom: -12rem;
		left: -9rem;
		width: 32rem;
		height: 32rem;
		background: rgba(15, 31, 26, 0.07);
	}

	/* ════════════════════════════════════════════════════════════
	   BOOT SCREEN — visible durante el montaje / hidratación
	   ════════════════════════════════════════════════════════════ */
	.boot-screen {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
	}

	.boot-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.boot-logo {
		height: 55px;
		width: auto;
		display: block;
		animation: boot-breathe 2.4s ease-in-out infinite;
	}

	.boot-track {
		position: relative;
		width: 190px;
		height: 3px;
		border-radius: 999px;
		background: rgba(15, 31, 26, 0.12);
		overflow: hidden;
	}
	.boot-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 40%;
		border-radius: 999px;
		background: linear-gradient(90deg, rgba(249, 115, 22, 0.35), #ea580c);
		animation: boot-slide 1.15s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	.boot-text {
		margin: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #6b6b6b;
	}

	@keyframes boot-slide {
		0% {
			transform: translateX(-110%);
		}
		100% {
			transform: translateX(360%);
		}
	}
	@keyframes boot-breathe {
		0%,
		100% {
			opacity: 0.75;
			transform: translateY(0);
		}
		50% {
			opacity: 1;
			transform: translateY(-3px);
		}
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
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 24px;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 24px 60px rgba(15, 31, 26, 0.12);
		overflow: hidden;
	}
	@media (min-width: 1024px) {
		.login-card {
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		}
	}

	/* ════════════════════════════════════════════════════════════
	   BRAND PANEL — Charcoal editorial
	   ════════════════════════════════════════════════════════════ */
	.brand-panel {
		position: relative;
		display: none;
		flex-direction: column;
		justify-content: space-between;
		padding: 2.75rem 2.5rem;
		background: #0f172a;
		color: #f0ede6;
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

	/* Detalle emerald tint superior derecho */
	.brand-panel::before {
		content: '';
		position: absolute;
		top: -6rem;
		right: -6rem;
		width: 18rem;
		height: 18rem;
		background: radial-gradient(circle, rgba(249, 115, 22, 0.25) 0%, transparent 70%);
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
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.1);
		padding: 0.3rem 0.7rem;
		border-radius: 6px;
		margin-bottom: 1.25rem;
	}

	.brand-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.6rem, 2.4vw, 1.95rem);
		font-weight: 400;
		line-height: 1.18;
		letter-spacing: -0.015em;
		color: #f0ede6;
		margin: 0 0 0.85rem;
	}

	.brand-desc {
		font-size: 0.875rem;
		line-height: 1.6;
		color: rgba(240, 237, 230, 0.7);
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
		color: rgba(240, 237, 230, 0.85);
	}
	.feature-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: rgba(249, 115, 22, 0.18);
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
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		color: rgba(240, 237, 230, 0.55);
	}
	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f97316;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.18);
		animation: pulse 2.5s ease-in-out infinite;
	}
	.status-text {
		font-weight: 600;
		color: rgba(240, 237, 230, 0.75);
	}
	.status-sep {
		opacity: 0.4;
	}
	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.18);
		}
		50% {
			box-shadow: 0 0 0 5px rgba(249, 115, 22, 0.06);
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
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		margin-bottom: 0.85rem;
	}

	.form-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: clamp(1.65rem, 3.6vw, 2rem);
		font-weight: 400;
		line-height: 1.15;
		letter-spacing: -0.015em;
		color: #0f172a;
		margin: 0 0 0.5rem;
	}

	.form-subtitle {
		font-size: 0.9rem;
		line-height: 1.55;
		color: #4a4a4a;
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
	.alert:focus {
		outline: none;
	}
	.alert-error {
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.22);
		color: #991b1b;
	}
	.alert-body {
		flex: 1;
		min-width: 0;
	}
	.alert-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		margin: -0.15rem -0.35rem 0 0;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: #b91c1c;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0.6;
		transition: opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.alert-close:hover {
		opacity: 1;
		background: rgba(220, 38, 38, 0.08);
	}
	.alert-close svg {
		width: 14px;
		height: 14px;
		margin: 0;
		color: currentColor;
	}
	.alert-error > svg {
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
		font-size: 0.78rem;
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
		color: #9a9a9a;
		pointer-events: none;
		transition: color 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}

	.field-input {
		width: 100%;
		padding: 0.7rem 0.95rem 0.7rem 2.55rem;
		font-size: 0.9rem;
		font-family: inherit;
		color: #1a1a1a;
		background: #ffffff;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 12px;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.field-input::placeholder {
		color: #9a9a9a;
	}
	.field-input--with-action {
		padding-right: 2.85rem;
	}
	.field-input:hover:not(:disabled) {
		border-color: rgba(0, 0, 0, 0.2);
	}
	.field-input:focus {
		outline: none;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
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
		color: #9a9a9a;
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
		border: 1.5px solid rgba(0, 0, 0, 0.24);
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
		font-size: 0.8rem;
		font-weight: 500;
		color: #4a4a4a;
		transition: color 0.2s;
	}
	.checkbox:hover .checkbox-label {
		color: #0f172a;
	}

	.forgot-link {
		font-size: 0.8rem;
		font-weight: 600;
		color: #f97316;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
		text-decoration: none;
		transition: color 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.forgot-link:hover {
		color: #ea580c;
		text-decoration: underline;
	}

	/* ═══ Submit button (gradiente emerald 135deg) ═══ */
	.btn-submit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 0.8rem 1.25rem;
		margin-top: 0.5rem;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		color: #ffffff;
		background: linear-gradient(135deg, #f97316, #ea580c);
		border: none;
		border-radius: 12px;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.btn-submit:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
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
		background: rgba(0, 0, 0, 0.08);
	}
	.secure-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #9a9a9a;
	}

	.footer-copy {
		font-size: 0.75rem;
		color: #9a9a9a;
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
		.alert-close,
		.btn-submit,
		.field-input,
		.field-icon,
		.field-action,
		.forgot-link,
		.boot-logo {
			transition: none !important;
			animation: none !important;
		}
		/* El loader conserva movimiento mínimo: pulso de opacidad en la barra. */
		.boot-fill {
			animation: boot-pulse 1.6s ease-in-out infinite;
			width: 100%;
		}
		@keyframes boot-pulse {
			0%,
			100% {
				opacity: 0.35;
			}
			50% {
				opacity: 1;
			}
		}
	}
</style>
