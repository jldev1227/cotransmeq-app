<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	const dispatch = createEventDispatcher();

	let email = '';
	let password = '';
	let isLoading = false;
	let showPassword = false;

	async function handleLogin() {
		if (!email || !password) return;

		isLoading = true;

		// Simular autenticación
		await new Promise((resolve) => setTimeout(resolve, 1500));

		isLoading = false;
		dispatch('login', { email, password });
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleLogin();
		}
	}
</script>

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

		<!-- Login Form -->
		<form
			on:submit|preventDefault={handleLogin}
			class="space-y-6"
			in:fade={{ duration: 800, delay: 600 }}
		>
			<!-- Email Input -->
			<div class="space-y-2">
				<label for="email" class="block text-sm font-medium text-orange-100">
					Correo electrónico
				</label>
				<div class="relative">
					<input
						type="email"
						id="email"
						bind:value={email}
						on:keydown={handleKeydown}
						placeholder="usuario@cotransmeq.com"
						class="input-glow apple-transition w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder-orange-300/50 focus:border-orange-400 focus:bg-black/30"
						required
					/>
					<div
						class="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-orange-400 to-transparent opacity-0 transition-opacity duration-200 focus-within:opacity-100"
					></div>
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
					/>
					<button
						type="button"
						class="apple-transition absolute top-1/2 right-3 -translate-y-1/2 text-orange-300/70 hover:text-orange-300"
						on:click={() => (showPassword = !showPassword)}
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
					/>
					<span class="ml-2 text-sm text-orange-200">Recordarme</span>
				</label>
				<button
					type="button"
					class="apple-transition text-sm text-orange-400 hover:text-orange-300"
				>
					¿Olvidaste tu contraseña?
				</button>
			</div>

			<!-- Login Button -->
			<button
				type="submit"
				disabled={isLoading || !email || !password}
				class="apple-hover apple-transition orange-glow relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 font-semibold text-white disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if isLoading}
					<div class="flex items-center justify-center">
						<svg class="mr-3 -ml-1 h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
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

				<!-- Button shine effect -->
				<div
					class="absolute inset-0 -translate-x-full -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
				></div>
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

<style>
	/* Animación personalizada para el pulso */
	@keyframes pulse-soft {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.2;
		}
		50% {
			transform: scale(1.05);
			opacity: 0.3;
		}
	}

	.animate-pulse {
		animation: pulse-soft 4s ease-in-out infinite;
	}
</style>
