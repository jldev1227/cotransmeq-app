<script lang="ts">
	/**
	 * Pantalla del magic link: se abre desde el correo y aquí se elige la
	 * contraseña nueva.
	 *
	 * El token se valida en el servidor ANTES de pintar el formulario. Si no
	 * sirve —caducado, alterado o ya usado— no se muestra ningún campo: pedirle
	 * una contraseña a alguien cuyo enlace ya no vale es hacerle perder el
	 * tiempo dos veces.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { REQUISITOS, validarPassword } from '$lib/recuperacion/password';

	type Estado = 'validando' | 'invalido' | 'formulario' | 'exito';

	const token = $page.params.token ?? '';

	let estado = $state<Estado>('validando');
	/** Motivo por el que el enlace no sirve; lo redacta el servidor. */
	let motivoInvalidez = $state('');
	let correoEnmascarado = $state('');

	let password = $state('');
	let confirmacion = $state('');
	let verPassword = $state(false);
	let guardando = $state(false);
	let error = $state<string | null>(null);

	let salida: ReturnType<typeof setTimeout> | null = null;

	/** Aviso en vivo, solo cuando ya hay algo escrito en los dos campos. */
	const problemaLocal = $derived(
		password && confirmacion ? validarPassword(password, confirmacion) : null
	);

	onMount(async () => {
		try {
			const respuesta = await fetch(`/api/auth/recuperar-password/${encodeURIComponent(token)}`);
			const datos = await respuesta.json().catch(() => null);

			if (respuesta.ok && datos?.valido) {
				correoEnmascarado = datos.correo ?? '';
				estado = 'formulario';
				return;
			}

			motivoInvalidez =
				datos?.error ?? 'El enlace de recuperación no es válido. Solicita uno nuevo para continuar.';
			estado = 'invalido';
		} catch {
			motivoInvalidez =
				'No se pudo verificar el enlace porque no hubo conexión con el servidor. Inténtalo de nuevo en unos minutos.';
			estado = 'invalido';
		}
	});

	onDestroy(() => {
		if (salida) clearTimeout(salida);
	});

	async function guardar(event?: SubmitEvent) {
		event?.preventDefault();
		if (guardando) return;

		error = validarPassword(password, confirmacion);
		if (error) return;

		guardando = true;
		try {
			const respuesta = await fetch(`/api/auth/recuperar-password/${encodeURIComponent(token)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password, confirmacion })
			});
			const datos = await respuesta.json().catch(() => null);

			if (!respuesta.ok) {
				// El enlace pudo caducar mientras se llenaba el formulario: en ese
				// caso se cambia de pantalla en vez de dejar un error sobre unos
				// campos que ya no llevan a ninguna parte.
				if (datos?.enlaceInvalido) {
					motivoInvalidez = datos.error;
					estado = 'invalido';
					return;
				}
				error = datos?.error ?? 'No pudimos guardar la contraseña. Inténtalo de nuevo.';
				return;
			}

			estado = 'exito';
			// La contraseña ya no se necesita en memoria.
			password = '';
			confirmacion = '';
			salida = setTimeout(() => goto('/login'), 5000);
		} catch {
			error = 'No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.';
		} finally {
			guardando = false;
		}
	}
</script>

<svelte:head>
	<title>Nueva contraseña — Cotransmeq S.A.S</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<AuthShell
	eyebrow="Recuperar acceso"
	titulo={estado === 'exito'
		? 'Contraseña actualizada'
		: estado === 'invalido'
			? 'Enlace no válido'
			: 'Crea tu nueva contraseña'}
	subtitulo={estado === 'formulario' && correoEnmascarado
		? `Vas a cambiar la contraseña de ${correoEnmascarado}.`
		: undefined}
>
	{#if estado === 'validando'}
		<div class="estado">
			<span class="spinner" aria-hidden="true"></span>
			<p class="estado-texto" role="status">Verificando el enlace…</p>
		</div>
	{:else if estado === 'invalido'}
		<div class="estado" in:fly={{ y: 12, duration: 280 }}>
			<span class="estado-icono estado-icono--error">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<circle cx="12" cy="12" r="9" />
					<path stroke-linecap="round" d="M12 7.75v5" />
					<path stroke-linecap="round" d="M12 16.25h.01" />
				</svg>
			</span>
			<p class="estado-texto" role="alert">{motivoInvalidez}</p>
			<a class="btn-submit" href="/recuperar-password">
				<span class="btn-content">
					Solicitar un enlace nuevo
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
					</svg>
				</span>
			</a>
		</div>
	{:else if estado === 'exito'}
		<div class="estado" in:fly={{ y: 12, duration: 280 }}>
			<span class="estado-icono estado-icono--ok">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75" />
					<circle cx="12" cy="12" r="9" />
				</svg>
			</span>
			<p class="estado-texto" role="status">
				Tu contraseña quedó actualizada. Ya puedes entrar con ella; te llevamos al inicio de
				sesión en unos segundos.
			</p>
			<a class="btn-submit" href="/login">
				<span class="btn-content">
					Ir a iniciar sesión
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
					</svg>
				</span>
			</a>
		</div>
	{:else}
		{#if error}
			<div
				class="alert alert-error"
				role="alert"
				aria-live="assertive"
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
					<strong>No pudimos guardar la contraseña.</strong>
					<p>{error}</p>
				</div>
			</div>
		{/if}

		<form class="auth-form" onsubmit={guardar}>
			<div class="field">
				<label for="password" class="field-label">Nueva contraseña</label>
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
						type={verPassword ? 'text' : 'password'}
						id="password"
						bind:value={password}
						placeholder="••••••••"
						autocomplete="new-password"
						class="field-input field-input--with-action"
						required
						disabled={guardando}
					/>
					<button
						type="button"
						class="field-action"
						onclick={() => (verPassword = !verPassword)}
						disabled={guardando}
						aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
					>
						{#if verPassword}
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
				<p class="field-hint">{REQUISITOS.join(' · ')}</p>
			</div>

			<div class="field">
				<label for="confirmacion" class="field-label">Repite la contraseña</label>
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
							d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<input
						type={verPassword ? 'text' : 'password'}
						id="confirmacion"
						bind:value={confirmacion}
						placeholder="••••••••"
						autocomplete="new-password"
						class="field-input"
						required
						disabled={guardando}
					/>
				</div>
				{#if problemaLocal}
					<p class="field-hint" style="color:#b91c1c">{problemaLocal}</p>
				{/if}
			</div>

			<button
				type="submit"
				class="btn-submit"
				disabled={guardando || !password || !confirmacion || !!problemaLocal}
			>
				{#if guardando}
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
						Guardando…
					</span>
				{:else}
					<span class="btn-content">
						Guardar contraseña
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
						</svg>
					</span>
				{/if}
			</button>
		</form>
	{/if}

	{#snippet pie()}
		<a class="auth-link" href="/login">← Volver a iniciar sesión</a>
	{/snippet}
</AuthShell>
