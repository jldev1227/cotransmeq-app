<script lang="ts">
	/**
	 * Aceptar una invitación: la persona llega desde el enlace del correo y
	 * elige su contraseña.
	 *
	 * La pantalla se montaba con utilidades de Tailwind y un degradado propio
	 * («from-orange-50 to-teal-100») que no existe en ninguna otra parte de la
	 * app: era la única pantalla de acceso que no se parecía al login. Ahora usa
	 * `AuthShell`, el mismo marco que el login y la recuperación de contraseña,
	 * y sus primitivas (`.field`, `.btn-submit`, `.alert`, `.estado`).
	 *
	 * El correo NO se pide ni se puede cambiar: viene fijado por la invitación.
	 * Se muestra en un campo bloqueado para que quien registra vea de qué cuenta
	 * se trata antes de elegir contraseña.
	 */
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { fly } from 'svelte/transition';
	import axios from 'axios';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import { describirErrorApi } from '$lib/utils/mensajesError';
	import { AREA_LABELS } from '$lib/config/permissions';

	const API_URL: string = browser ? (import.meta.env.VITE_API_URL ?? '') : '';

	/** Espera antes de mandar al login tras registrarse. */
	const REDIRECCION_MS = 2500;

	interface Invitacion {
		correo: string;
		area: string[];
		cargo?: string | null;
		invitadoPorNombre: string;
	}

	let token = $state('');
	let validando = $state(true);
	let invitacion = $state<Invitacion | null>(null);
	let tokenInvalido = $state(false);

	let nombre = $state('');
	let password = $state('');
	let confirmar = $state('');
	let verPassword = $state(false);
	let enviando = $state(false);
	let exito = $state(false);
	let error = $state('');

	/** Mismo mínimo que `aceptarInvitacionSchema` en el backend. */
	const LARGO_MINIMO = 6;

	function etiquetaArea(a: string): string {
		return (AREA_LABELS as Record<string, string>)[a] ?? a;
	}

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

	async function registrarse(e?: SubmitEvent) {
		e?.preventDefault();
		error = '';

		if (nombre.trim().length < 2) {
			error = 'Escribe tu nombre completo (al menos 2 caracteres).';
			return;
		}
		if (password.length < LARGO_MINIMO) {
			error = `La contraseña debe tener al menos ${LARGO_MINIMO} caracteres.`;
			return;
		}
		if (password !== confirmar) {
			error = 'Las contraseñas no coinciden.';
			return;
		}

		try {
			enviando = true;
			await axios.post(`${API_URL}/api/invitaciones/aceptar`, {
				token,
				nombre: nombre.trim(),
				password
			});
			exito = true;
			setTimeout(() => goto('/login'), REDIRECCION_MS);
		} catch (err: any) {
			// El texto del backend solo se muestra si es legible en español; si
			// no, se cae al mensaje por estado. Mismo filtro que el login.
			error = describirErrorApi(err, {
				porEstado: {
					400: 'Revisa los datos del formulario e inténtalo de nuevo.',
					404: 'La invitación ya no existe o el enlace no es válido.',
					409: 'Ya existe una cuenta registrada con ese correo.',
					410: 'La invitación expiró o ya se usó. Pide una nueva al administrador.'
				},
				generico: 'No se pudo completar el registro. Inténtalo de nuevo.'
			});
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head><title>Aceptar invitación · Cotransmeq</title></svelte:head>

<AuthShell
	eyebrow={exito ? 'Cuenta creada' : tokenInvalido ? 'Enlace no válido' : 'Invitación'}
	titulo={exito ? 'Ya puedes entrar' : tokenInvalido ? 'Este enlace no sirve' : 'Crea tu cuenta'}
	subtitulo={validando || exito || tokenInvalido
		? undefined
		: invitacion
			? `${invitacion.invitadoPorNombre} te invitó al sistema. Elige una contraseña para terminar.`
			: undefined}
	marcaCodigo="Acceso · Invitación"
	marcaTitulo="Bienvenido al equipo"
	marcaDesc="Tu cuenta la abre una invitación del administrador. El correo y las áreas ya vienen definidos; lo único que eliges es tu contraseña."
	marcaPuntos={[
		'El enlace caduca a las 72 horas',
		'Solo puede usarse una vez',
		'Nadie más conoce tu contraseña'
	]}
>
	{#if validando}
		<div class="estado" in:fly={{ y: 12, duration: 280 }}>
			<div class="spinner" aria-hidden="true"></div>
			<p class="estado-texto">Comprobando la invitación…</p>
		</div>
	{:else if tokenInvalido}
		<div class="estado" in:fly={{ y: 12, duration: 280 }}>
			<span class="estado-icono estado-icono--error">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
					/>
				</svg>
			</span>
			<h2 class="estado-titulo">Invitación no válida</h2>
			<p class="estado-texto">
				El enlace ya se usó, fue reemplazado por uno más nuevo o pasaron las 72 horas de
				vigencia. Pide al administrador que te envíe otra invitación.
			</p>
			<a class="btn-submit" href="/login">
				<span class="btn-content">Ir a iniciar sesión</span>
			</a>
		</div>
	{:else if exito}
		<div class="estado" in:fly={{ y: 12, duration: 280 }}>
			<span class="estado-icono estado-icono--ok">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
				</svg>
			</span>
			<h2 class="estado-titulo">Cuenta creada</h2>
			<p class="estado-texto">
				Ya puedes entrar con <strong>{invitacion?.correo}</strong> y la contraseña que acabas de
				elegir. Te llevamos al inicio de sesión…
			</p>
			<a class="auth-link" href="/login">Ir ahora</a>
		</div>
	{:else}
		{#if error}
			<div class="alert alert-error" in:fly={{ y: -8, duration: 200 }}>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
					/>
				</svg>
				<div class="alert-body"><strong>{error}</strong></div>
			</div>
		{/if}

		{#if invitacion}
			<!-- Resumen de lo que la invitación ya decidió. Va antes del
			     formulario para que nadie elija contraseña sin ver a qué
			     cuenta y a qué áreas le está dando acceso. -->
			<div class="invitacion-resumen">
				<dl>
					<div class="resumen-fila">
						<dt>Áreas</dt>
						<dd>
							<span class="chips">
								{#each invitacion.area as a (a)}
									<span class="chip">{etiquetaArea(a)}</span>
								{/each}
							</span>
						</dd>
					</div>
					{#if invitacion.cargo}
						<div class="resumen-fila">
							<dt>Cargo</dt>
							<dd>{invitacion.cargo}</dd>
						</div>
					{/if}
				</dl>
			</div>
		{/if}

		<form class="auth-form" onsubmit={registrarse}>
			<div class="field">
				<label for="inv-correo" class="field-label">Correo electrónico</label>
				<div class="field-control">
					<svg
						class="field-icon"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
						/>
					</svg>
					<input
						id="inv-correo"
						class="field-input"
						type="email"
						value={invitacion?.correo ?? ''}
						readonly
						disabled
					/>
				</div>
				<p class="field-hint">Lo fija la invitación; no se puede cambiar aquí.</p>
			</div>

			<div class="field">
				<label for="inv-nombre" class="field-label">Nombre completo</label>
				<div class="field-control">
					<svg
						class="field-icon"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
						/>
					</svg>
					<input
						id="inv-nombre"
						class="field-input"
						type="text"
						bind:value={nombre}
						placeholder="Ej: María Fernanda Ríos"
						autocomplete="name"
						disabled={enviando}
					/>
				</div>
			</div>

			<div class="field">
				<label for="inv-password" class="field-label">Contraseña</label>
				<div class="field-control">
					<svg
						class="field-icon"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
						/>
					</svg>
					<input
						id="inv-password"
						class="field-input field-input--with-action"
						type={verPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="Mínimo {LARGO_MINIMO} caracteres"
						autocomplete="new-password"
						disabled={enviando}
					/>
					<button
						type="button"
						class="field-action"
						onclick={() => (verPassword = !verPassword)}
						disabled={enviando}
						aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
					>
						{#if verPassword}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243"
								/>
							</svg>
						{:else}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
								/>
							</svg>
						{/if}
					</button>
				</div>
			</div>

			<div class="field">
				<label for="inv-confirmar" class="field-label">Confirmar contraseña</label>
				<div class="field-control">
					<svg
						class="field-icon"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<input
						id="inv-confirmar"
						class="field-input"
						type={verPassword ? 'text' : 'password'}
						bind:value={confirmar}
						placeholder="Repite la contraseña"
						autocomplete="new-password"
						disabled={enviando}
					/>
				</div>
			</div>

			<button type="submit" class="btn-submit" disabled={enviando}>
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
						Creando la cuenta…
					</span>
				{:else}
					<span class="btn-content">
						Crear mi cuenta
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
							/>
						</svg>
					</span>
				{/if}
			</button>
		</form>
	{/if}

	{#snippet pie()}
		{#if !exito && !tokenInvalido}
			<span class="pie-texto">¿Ya tienes cuenta?</span>
			<a class="auth-link" href="/login">Iniciar sesión</a>
		{/if}
	{/snippet}
</AuthShell>

<style>
	/* Resumen de lo que la invitación trae decidido. Usa los mismos tonos
	   editoriales del marco: crema, carbón y el naranja solo como acento. */
	.invitacion-resumen {
		padding: 0.9rem 1.05rem;
		margin-bottom: 1.4rem;
		background: rgba(249, 115, 22, 0.05);
		border: 1px solid rgba(249, 115, 22, 0.18);
		border-radius: 12px;
	}
	.invitacion-resumen dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.resumen-fila {
		display: flex;
		align-items: baseline;
		gap: 0.85rem;
	}
	.resumen-fila dt {
		flex-shrink: 0;
		width: 3.6rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6b6b6b;
	}
	.resumen-fila dd {
		margin: 0;
		font-size: 0.83rem;
		line-height: 1.5;
		color: #0f1f1a;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		display: inline-block;
		padding: 0.15rem 0.55rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: #c2410c;
		background: rgba(249, 115, 22, 0.12);
		border-radius: 999px;
	}

	.pie-texto {
		font-size: 0.8rem;
		color: #6b6b6b;
		margin-right: 0.35rem;
	}
</style>
