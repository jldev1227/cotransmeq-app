<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import axios from 'axios';

	const API_URL: string = browser ? (import.meta.env.VITE_API_URL ?? '') : '';

	// ─── Estado ───────────────────────────────────────────────────────────────
	let token = '';
	let validando = true;
	let invitacion: {
		correo: string;
		area: string[];
		cargo?: string | null;
		invitadoPorNombre: string;
	} | null = null;
	let tokenInvalido = false;

	let nombre = '';
	let password = '';
	let confirmar = '';
	let enviando = false;
	let exito = false;
	let error = '';

	const AREA_LABELS: Record<string, string> = {
		administracion: 'Administración',
		operaciones: 'Operaciones',
		contabilidad: 'Contabilidad',
		facturacion: 'Facturación',
		talento_humano: 'Talento Humano',
		hseq: 'HSEQ',
	};

	// ─── Validar token al montar ──────────────────────────────────────────────
	onMount(async () => {
		token = $page.params.token ?? '';
		try {
			const res = await axios.get(`${API_URL}/api/invitaciones/validar/${token}`);
			invitacion = res.data;
		} catch {
			tokenInvalido = true;
		} finally {
			validando = false;
		}
	});

	// ─── Enviar formulario ────────────────────────────────────────────────────
	async function registrarse() {
		error = '';
		if (!nombre.trim()) { error = 'Ingresa tu nombre completo'; return; }
		if (password.length < 6) { error = 'La contraseña debe tener al menos 6 caracteres'; return; }
		if (password !== confirmar) { error = 'Las contraseñas no coinciden'; return; }

		try {
			enviando = true;
			await axios.post(`${API_URL}/api/invitaciones/aceptar`, {
				token,
				nombre: nombre.trim(),
				password,
			});
			exito = true;
			setTimeout(() => goto('/login'), 3000);
		} catch (e: any) {
			error = e?.response?.data?.error || 'Error al completar el registro';
		} finally {
			enviando = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') registrarse();
	}
</script>

<svelte:head><title>Aceptar invitación · Cotransmeq</title></svelte:head>

<div class="min-h-screen bg-gradient-to-br from-orange-50 to-teal-100 flex items-center justify-center p-4">
	<div class="w-full max-w-md">

		<!-- Logo / marca -->
		<div class="mb-8 text-center">
			<div class="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-600 shadow-lg mb-3">
				<svg class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
				</svg>
			</div>
			<h1 class="text-2xl font-bold text-gray-900">Cotransmeq</h1>
		</div>

		<div class="rounded-2xl bg-white shadow-xl overflow-hidden">

			<!-- ─── Validando ────────────────────────────────────────────── -->
			{#if validando}
				<div class="flex flex-col items-center justify-center py-16 px-8">
					<div class="h-10 w-10 animate-spin rounded-full border-2 border-orange-600 border-t-transparent mb-4"></div>
					<p class="text-sm text-gray-500">Validando invitación…</p>
				</div>

			<!-- ─── Token inválido ───────────────────────────────────────── -->
			{:else if tokenInvalido || !invitacion}
				<div class="flex flex-col items-center py-14 px-8 text-center">
					<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
						<svg class="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</div>
					<h2 class="mb-2 text-xl font-bold text-gray-900">Enlace inválido</h2>
					<p class="mb-6 text-sm text-gray-500">
						Esta invitación expiró, ya fue usada o fue revocada.<br />
						Contacta al administrador para obtener un nuevo enlace.
					</p>
					<a
						href="/login"
						class="rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors"
					>
						Ir al inicio de sesión
					</a>
				</div>

			<!-- ─── Éxito ─────────────────────────────────────────────────── -->
			{:else if exito}
				<div class="flex flex-col items-center py-14 px-8 text-center">
					<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-orange-100">
						<svg class="h-7 w-7 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
					</div>
					<h2 class="mb-2 text-xl font-bold text-gray-900">¡Registro completado!</h2>
					<p class="text-sm text-gray-500">
						Tu cuenta fue creada exitosamente.<br />
						Serás redirigido al inicio de sesión en unos segundos…
					</p>
				</div>

			<!-- ─── Formulario ───────────────────────────────────────────── -->
			{:else}
				<!-- Banner invitación -->
				<div class="bg-orange-600 px-6 py-5 text-white">
					<p class="text-sm font-medium opacity-80">
						{invitacion.invitadoPorNombre} te invita a unirte
					</p>
					<h2 class="mt-1 text-xl font-bold">Completa tu registro</h2>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each invitacion.area as a}
							<span class="rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold">
								{AREA_LABELS[a] ?? a}
							</span>
						{/each}
					</div>
				</div>

				<!-- Form -->
				<div class="space-y-4 px-6 py-6">
					<!-- Correo (solo lectura) -->
					<div>
						<p class="mb-1.5 block text-sm font-medium text-gray-700">Correo electrónico</p>
						<div class="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500">
							<svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
							{invitacion.correo}
						</div>
					</div>

					<!-- Nombre -->
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="reg-nombre">
							Nombre completo <span class="text-red-500">*</span>
						</label>
						<input
							id="reg-nombre"
							type="text"
							bind:value={nombre}
							placeholder="Tu nombre y apellido"
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 transition"
						/>
					</div>

					<!-- Contraseña -->
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="reg-pass">
							Contraseña <span class="text-red-500">*</span>
						</label>
						<input
							id="reg-pass"
							type="password"
							bind:value={password}
							placeholder="Mínimo 6 caracteres"
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 transition"
						/>
					</div>

					<!-- Confirmar -->
					<div>
						<label class="mb-1.5 block text-sm font-medium text-gray-700" for="reg-confirm">
							Confirmar contraseña <span class="text-red-500">*</span>
						</label>
						<input
							id="reg-confirm"
							type="password"
							bind:value={confirmar}
							placeholder="Repite la contraseña"
							on:keydown={handleKeydown}
							class="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 transition
								{confirmar && password !== confirmar ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : ''}"
						/>
						{#if confirmar && password !== confirmar}
							<p class="mt-1 text-xs text-red-500">Las contraseñas no coinciden</p>
						{/if}
					</div>

					{#if error}
						<div class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
							{error}
						</div>
					{/if}

					<button
						on:click={registrarse}
						disabled={enviando}
						class="mt-2 w-full rounded-xl bg-orange-600 py-3 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2"
					>
						{#if enviando}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
						{/if}
						Crear mi cuenta
					</button>
				</div>
			{/if}

		</div>

		<p class="mt-6 text-center text-xs text-gray-400">
			¿Ya tienes cuenta?
			<a href="/login" class="text-orange-600 hover:underline font-medium">Iniciar sesión</a>
		</p>
	</div>
</div>
