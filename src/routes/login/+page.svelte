<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { fade, fly } from 'svelte/transition';

	let correo = '';
	let password = '';
	let isLoading = false;
	let showPassword = false;
	let mounted = false;

	// Reactive declarations
	$: error = $authStore.error;
	$: redirectPath = $page.url.searchParams.get('redirect');

	onMount(() => {
		console.log('🔐 [LOGIN] onMount ejecutándose...');
		console.log('📍 [LOGIN] Redirect path desde URL:', redirectPath || 'NINGUNO');

		// Inicializar el store de auth
		authStore.init();

		// Si ya está autenticado, redirigir
		if (authStore.isAuthenticated()) {
			console.log('✅ [LOGIN] Usuario ya autenticado');
			const targetPath =
				redirectPath || localStorage.getItem('redirect_after_login') || '/dashboard';
			console.log('➡️ [LOGIN] Redirigiendo a:', targetPath);

			localStorage.removeItem('redirect_after_login');
			goto(targetPath);
			return;
		}

		console.log('⚠️ [LOGIN] Usuario NO autenticado, mostrando form');
		mounted = true;
	});

	async function handleLogin() {
		if (!correo || !password) return;

		console.log('🔑 [LOGIN] Intentando login con:', correo);
		const success = await authStore.login(correo, password);

		if (success) {
			console.log('✅ [LOGIN] Login exitoso');
			// Redirigir a la página guardada o al dashboard
			const targetPath =
				redirectPath || localStorage.getItem('redirect_after_login') || '/dashboard';
			console.log('➡️ [LOGIN] Redirigiendo después del login a:', targetPath);
			localStorage.removeItem('redirect_after_login');
			goto(targetPath);
		} else {
			console.log('❌ [LOGIN] Login fallido');
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
	<title>Login - Cotransmeq</title>
	<meta name="description" content="Iniciar sesión en el sistema de gestión Cotransmeq" />
</svelte:head>

{#if mounted}
	<div
		class="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-orange-900 via-orange-800 to-slate-900 p-4"
	>
		<!-- Animated background elements -->
		<div class="absolute inset-0 overflow-hidden">
			<div
				class="absolute -top-40 -right-40 h-80 w-80 animate-pulse rounded-full bg-orange-500 opacity-20 mix-blend-multiply blur-xl filter"
			></div>
			<div
				class="absolute -bottom-40 -left-40 h-80 w-80 animate-pulse rounded-full bg-orange-600 opacity-20 mix-blend-multiply blur-xl filter"
				style="animation-delay: 2s;"
			></div>
		</div>

		<div
			class="glass-dark soft-shadow relative z-10 w-full max-w-md rounded-2xl p-8"
			in:fly={{ y: 30, duration: 600, delay: 200 }}
		>
			<!-- Logo -->
			<div class="mb-8 text-center" in:fade={{ duration: 800, delay: 400 }}>
				<div
					class="soft-shadow mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600"
				>
					<span class="text-3xl font-bold text-white">T</span>
				</div>
				<h1 class="mb-1 text-2xl font-semibold text-white">Cotransmeq</h1>
				<p class="text-sm font-medium text-orange-200">Sistema de Gestión</p>
			</div>

			<!-- Error Message -->
			{#if error}
				<div class="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4" in:fade>
					<p class="text-sm text-red-400">{error}</p>
				</div>
			{/if}

			<!-- Login Form -->
			<form
				on:submit|preventDefault={handleLogin}
				class="space-y-6"
				in:fade={{ duration: 800, delay: 600 }}
			>
				<!-- Email Input -->
				<div class="space-y-2">
					<label for="correo" class="block text-sm font-medium text-orange-100">
						Correo electrónico
					</label>
					<div class="relative">
						<input
							type="email"
							id="correo"
							bind:value={correo}
							on:keydown={handleKeydown}
							placeholder="usuario@cotransmeq.com"
							class="input-glow apple-transition w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder-orange-300/50 focus:border-orange-400 focus:bg-black/30"
							required
							disabled={$authStore.isLoading}
						/>
					</div>
				</div>

				<!-- Password Input -->
				<div class="space-y-2">
					<label for="password" class="block text-sm font-medium text-orange-100">
						Contraseña
					</label>
					<div class="relative">
						<input
							type={showPassword ? 'text' : 'password'}
							id="password"
							bind:value={password}
							on:keydown={handleKeydown}
							placeholder="••••••••"
							class="input-glow apple-transition w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-12 text-white placeholder-orange-300/50 focus:border-orange-400 focus:bg-black/30"
							required
							disabled={$authStore.isLoading}
						/>
						<button
							type="button"
							class="apple-transition absolute top-1/2 right-3 -translate-y-1/2 text-orange-300/70 hover:text-orange-300"
							on:click={togglePassword}
							disabled={$authStore.isLoading}
						>
							{#if showPassword}
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"
									/>
								</svg>
							{:else}
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<!-- Remember me -->
				<div class="flex items-center justify-between">
					<label class="flex items-center">
						<input
							type="checkbox"
							class="apple-transition h-4 w-4 rounded border-white/20 bg-black/20 text-orange-500 focus:ring-2 focus:ring-orange-400"
							disabled={$authStore.isLoading}
						/>
						<span class="ml-2 text-sm text-orange-200">Recordarme</span>
					</label>
					<button
						type="button"
						class="apple-transition text-sm text-orange-400 hover:text-orange-300"
						disabled={$authStore.isLoading}
					>
						¿Olvidaste tu contraseña?
					</button>
				</div>

				<!-- Login Button -->
				<button
					type="submit"
					disabled={$authStore.isLoading || !correo || !password}
					class="apple-hover apple-transition orange-glow relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if $authStore.isLoading}
						<div class="flex items-center justify-center">
							<svg
								class="mr-3 -ml-1 h-5 w-5 animate-spin text-white"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							Iniciando sesión...
						</div>
					{:else}
						Iniciar Sesión
					{/if}
				</button>
			</form>

			<!-- Footer -->
			<div class="mt-8 text-center" in:fade={{ duration: 800, delay: 800 }}>
				<p class="text-sm text-orange-300/60">
					© 2025 Cotransmeq. Todos los derechos reservados.
				</p>
			</div>
		</div>
	</div>
{/if}
