<script lang="ts">
	/**
	 * «Olvidé mi contraseña»: se pide el correo y se manda el magic link.
	 *
	 * La respuesta del servidor es la misma exista o no la cuenta, y esta
	 * pantalla no intenta adivinar más: decir «ese correo no está registrado»
	 * convertiría el formulario en un directorio de quién trabaja aquí.
	 */
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';

	/** Espera antes de dejar pedir otro enlace: el correo puede tardar. */
	const REENVIO_MS = 45_000;

	/** El login pasa el correo ya escrito para no hacerlo teclear otra vez. */
	let correo = $state($page.url.searchParams.get('correo') ?? '');
	let enviando = $state(false);
	let enviado = $state(false);
	let correoEnviado = $state('');
	let error = $state<string | null>(null);
	let segundosRestantes = $state(0);

	let cuenta: ReturnType<typeof setInterval> | null = null;

	onDestroy(() => {
		if (cuenta) clearInterval(cuenta);
	});

	function arrancarEspera() {
		segundosRestantes = Math.round(REENVIO_MS / 1000);
		if (cuenta) clearInterval(cuenta);
		cuenta = setInterval(() => {
			segundosRestantes -= 1;
			if (segundosRestantes <= 0 && cuenta) {
				clearInterval(cuenta);
				cuenta = null;
			}
		}, 1000);
	}

	async function solicitar(event?: SubmitEvent) {
		event?.preventDefault();
		if (enviando || segundosRestantes > 0) return;

		error = null;
		const limpio = correo.trim();
		if (!limpio) {
			error = 'Ingresa el correo con el que accedes al sistema.';
			return;
		}

		enviando = true;
		try {
			const respuesta = await fetch('/api/auth/recuperar-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ correo: limpio })
			});
			const datos = await respuesta.json().catch(() => null);

			if (!respuesta.ok) {
				error = datos?.error ?? 'No pudimos procesar la solicitud. Inténtalo de nuevo.';
				return;
			}

			correoEnviado = limpio;
			enviado = true;
			arrancarEspera();
		} catch {
			error = 'No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.';
		} finally {
			enviando = false;
		}
	}

	/** Vuelve al formulario conservando el correo, por si lo escribió mal. */
	function corregirCorreo() {
		enviado = false;
		error = null;
		// La espera era para el envío anterior. Sin limpiarla, escribir otro
		// correo y darle a enviar no haría nada: el botón queda habilitado pero
		// `solicitar` sale de largo mientras el contador siga corriendo. El
		// freno de verdad está en el servidor, que limita por dirección.
		if (cuenta) {
			clearInterval(cuenta);
			cuenta = null;
		}
		segundosRestantes = 0;
	}
</script>

<svelte:head>
	<title>Recuperar contraseña — Cotransmeq S.A.S</title>
	<meta
		name="description"
		content="Solicita un enlace para restablecer la contraseña de tu cuenta en el sistema de Cotransmeq S.A.S."
	/>
	<meta name="robots" content="noindex" />
</svelte:head>

<AuthShell
	eyebrow="Recuperar acceso"
	titulo={enviado ? 'Revisa tu correo' : '¿Olvidaste tu contraseña?'}
	subtitulo={enviado
		? undefined
		: 'Escribe el correo con el que ingresas y te enviaremos un enlace para crear una nueva.'}
>
	{#if enviado}
		<div class="estado" in:fly={{ y: 12, duration: 280 }}>
			<span class="estado-icono estado-icono--ok">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
					/>
				</svg>
			</span>
			<p class="estado-texto">
				Si <strong>{correoEnviado}</strong> corresponde a una cuenta activa, ya salió un
				enlace para restablecer la contraseña.
			</p>
			<p class="estado-texto">
				El enlace vence en <strong>30 minutos</strong> y solo puede usarse una vez. Si no
				aparece, revisa la carpeta de spam o correo no deseado.
			</p>

			<button
				type="button"
				class="btn-submit"
				onclick={() => solicitar()}
				disabled={enviando || segundosRestantes > 0}
			>
				{#if enviando}
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
						Enviando…
					</span>
				{:else if segundosRestantes > 0}
					<span class="btn-content">Reenviar enlace en {segundosRestantes}s</span>
				{:else}
					<span class="btn-content">Reenviar el enlace</span>
				{/if}
			</button>

			<button type="button" class="auth-link" onclick={corregirCorreo}>
				Usar otro correo
			</button>
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
					<strong>No pudimos enviar el enlace.</strong>
					<p>{error}</p>
				</div>
			</div>
		{/if}

		<form class="auth-form" onsubmit={solicitar}>
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
						placeholder="usuario@cotransmeq.com"
						autocomplete="email"
						class="field-input"
						required
						disabled={enviando}
					/>
				</div>
				<p class="field-hint">
					Debe ser el mismo correo con el que inicias sesión. El enlace llega solo a esa dirección.
				</p>
			</div>

			<button type="submit" class="btn-submit" disabled={enviando || !correo.trim()}>
				{#if enviando}
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
						Enviando el enlace…
					</span>
				{:else}
					<span class="btn-content">
						Enviar enlace de recuperación
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
