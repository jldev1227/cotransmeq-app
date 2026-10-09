<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import {
		PORTAL_LOGIN,
		entradaDirectaAlLogin,
		esDispositivoDelPortal
	} from '$lib/stores/portalStore';
	import { fly } from 'svelte/transition';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import AuthLoading from '$lib/components/auth/AuthLoading.svelte';

	/** Tiempo mínimo en pantalla del loader de montaje: evita el parpadeo. */
	const MIN_BOOT_MS = 550;
	/**
	 * Techo para la hidratación de sesión. `authStore.init()` refresca el perfil
	 * contra la API; si esa llamada se cuelga no se puede dejar al usuario
	 * mirando el loader hasta el timeout de 30s de axios.
	 */
	const AUTH_CHECK_TIMEOUT_MS = 3000;

	let correo = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let remember = $state(false);

	/** false → loader de montaje; true → formulario. */
	let ready = $state(false);
	/** Sesión válida detectada: el loader se queda puesto durante el `goto`. */
	let redirecting = $state(false);
	/**
	 * Error mostrado en el formulario. Es estado LOCAL (no `$authStore.error`)
	 * a propósito: así el mensaje sobrevive a cualquier cambio posterior del
	 * store y solo se limpia cuando el usuario vuelve a enviar el formulario.
	 */
	let formError = $state<string | null>(null);
	let errorBox = $state<HTMLDivElement | null>(null);

	const isLoading = $derived($authStore.isLoading);
	/**
	 * El correo ya escrito viaja a la pantalla de recuperación: quien llega
	 * ahí acaba de fallar el login y no tiene por qué teclearlo otra vez.
	 */
	const enlaceRecuperacion = $derived(
		correo.trim()
			? `/recuperar-password?correo=${encodeURIComponent(correo.trim())}`
			: '/recuperar-password'
	);
	const redirectPath = $derived.by(() => {
		const raw = $page.url.searchParams.get('redirect');
		/// Solo rutas internas. `//otro.host` es una URL absoluta para el
		/// navegador aunque empiece por barra, así que un `redirect` fabricado
		/// podría sacar al usuario del sitio justo después de que se
		/// autentique. Ahora el destino lleva también la cadena de consulta,
		/// así que la comprobación importa más que antes.
		if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
		if (raw.startsWith('/dashboard/nomina')) return null;
		return raw;
	});

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	/** Destino post-login, ignorando siempre el módulo de nómina. */
	function resolveTarget(): string {
		let savedRedirect = localStorage.getItem('redirect_after_login');
		if (savedRedirect?.startsWith('/dashboard/nomina')) savedRedirect = null;
		const targetPath = redirectPath || savedRedirect || '/dashboard';
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
		await Promise.race([authStore.init().catch(() => undefined), sleep(AUTH_CHECK_TIMEOUT_MS)]);

		if (authStore.isAuthenticated()) {
			redirecting = true;
			await bootDelay;
			goto(resolveTarget());
			return;
		}

		/// `/login` es adonde acaba cualquier fallo de sesión, venga de donde venga.
		/// Un dispositivo de conductor sin sesión administrativa vuelve a SU login;
		/// `?admin=1` deja entrar a quien sí venga a administrar desde ese teléfono,
		/// y escribir la dirección en la barra, también: ver `entradaDirectaAlLogin`.
		if (
			esDispositivoDelPortal() &&
			$page.url.searchParams.get('admin') !== '1' &&
			!entradaDirectaAlLogin()
		) {
			redirecting = true;
			await goto(PORTAL_LOGIN, { replaceState: true });
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

	async function handleLogin(event?: SubmitEvent) {
		event?.preventDefault();
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
			formError = get(authStore).error ?? 'No se pudo iniciar sesión. Inténtalo de nuevo.';
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
	<meta name="description" content="Acceso al sistema de gestión integral de Cotransmeq S.A.S." />
</svelte:head>

{#if !ready}
	<!-- Loader de montaje: cubre la hidratación de sesión. -->
	<AuthLoading
		texto={redirecting ? 'Sesión activa · redirigiendo…' : 'Preparando el acceso seguro…'}
	/>
{:else}
	<AuthShell
		eyebrow="Acceso seguro"
		titulo="Ingresa a tu cuenta"
		subtitulo="Escribe tus credenciales para entrar al sistema."
		mascota={formError ? 'advertencia' : 'bienvenida'}
		marcaCodigo="Sistema de gestión"
		marcaTitulo="Bienvenido de vuelta"
		marcaDesc="Servicios, clientes, conductores y liquidaciones con trazabilidad completa, en un solo lugar."
		marcaPuntos={[
			'Control de servicios y trazabilidad',
			'Gestión de clientes y conductores',
			'Liquidaciones y reportes operativos'
		]}
	>
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
					onclick={dismissError}
					aria-label="Cerrar mensaje de error"
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		{/if}

		<form class="auth-form" onsubmit={handleLogin}>
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
						onkeydown={handleKeydown}
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
						onkeydown={handleKeydown}
						placeholder="••••••••"
						autocomplete="current-password"
						class="field-input field-input--with-action"
						required
						disabled={isLoading}
					/>
					<button
						type="button"
						class="field-action"
						onclick={togglePassword}
						disabled={isLoading}
						aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
					>
						{#if showPassword}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
								/>
							</svg>
						{:else}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
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
				<a class="auth-link" href={enlaceRecuperacion}>¿Olvidaste tu contraseña?</a>
			</div>

			<!-- Submit -->
			<button type="submit" class="btn-submit" disabled={isLoading || !correo || !password}>
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
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
						</svg>
					</span>
				{/if}
			</button>
		</form>
	</AuthShell>
{/if}
