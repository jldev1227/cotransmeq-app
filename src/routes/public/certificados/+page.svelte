<script lang="ts">
	/**
	 * Portal de certificados tributarios para terceros.
	 *
	 * Usa el mismo marco que las pantallas de acceso (`AuthShell`): bloque de
	 * marca oscuro con la mascota y el contenido sobre el fondo claro. La
	 * mascota reacciona al paso (bienvenida → correo enviado → validando →
	 * listo / sin certificados), así que la pantalla cuenta en qué va sin
	 * iconos propios.
	 *
	 * El layout público deja el `body` sin scroll (lo necesita el mapa de
	 * servicios), así que esta página es su propio contenedor de scroll: sin
	 * eso, la lista de certificados en un teléfono quedaba cortada.
	 */
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import type { MascotIntent } from '$lib/mascot';
	import { certificadosPublicTerceroAPI } from '$lib/api/certificadosTercero';

	const EMPRESA = 'Cotransmeq S.A.S';
	const TOKEN_DAYS = 90;
	const STORAGE_KEY = 'certificados_access_token';

	type Paso = 'identificacion' | 'email_sent' | 'verificando' | 'portal';

	let paso = $state<Paso>('identificacion');
	let identificacion = $state('');
	let error = $state('');
	let emailOculto = $state('');
	let cargando = $state(false);
	let montado = $state(false);

	let tercero: any = $state(null);
	let certificados: any[] = $state([]);
	let expiraEl = $state('');

	const mascota: MascotIntent = $derived(
		paso === 'email_sent'
			? 'correoEnviado'
			: paso === 'verificando'
				? 'procesando'
				: paso === 'portal'
					? certificados.length > 0
						? 'exito'
						: 'vacio'
					: error
						? 'advertencia'
						: 'bienvenida'
	);

	const cabecera = $derived.by(() => {
		switch (paso) {
			case 'verificando':
				return {
					eyebrow: 'Un momento',
					titulo: 'Validando tu acceso',
					subtitulo: 'Estamos comprobando el enlace que abriste desde tu correo.'
				};
			case 'email_sent':
				return {
					eyebrow: 'Revisa tu correo',
					titulo: 'Te enviamos el enlace',
					subtitulo: undefined
				};
			case 'portal':
				return {
					eyebrow: 'Certificados tributarios',
					titulo: tercero?.nombre_completo ?? 'Tus certificados',
					subtitulo: `CC ${tercero?.identificacion ?? ''} · acceso válido hasta el ${formatearFecha(expiraEl)}.`
				};
			default:
				return {
					eyebrow: 'Acceso seguro',
					titulo: 'Portal de certificados',
					subtitulo: 'Escribe tu número de identificación y te enviamos un enlace de acceso a tu correo registrado.'
				};
		}
	});

	function validar(v: string) {
		if (!v.trim()) return 'Escribe tu número de identificación.';
		if (!/^\d{5,15}$/.test(v.trim())) return 'La identificación debe tener entre 5 y 15 dígitos, sin puntos.';
		return '';
	}

	async function solicitar(e?: SubmitEvent) {
		e?.preventDefault();
		error = validar(identificacion);
		if (error) return;
		cargando = true;
		try {
			const res = await certificadosPublicTerceroAPI.solicitarAcceso(identificacion.trim());
			emailOculto = res.data.email || '';
			paso = 'email_sent';
		} catch (err: any) {
			error = err?.response?.data?.error || err?.message || 'No pudimos enviar el enlace. Intenta de nuevo.';
		} finally {
			cargando = false;
		}
	}

	async function verificarToken(token: string) {
		paso = 'verificando';
		cargando = true;
		try {
			const res = await certificadosPublicTerceroAPI.verificarToken(token);
			tercero = res.data.tercero;
			certificados = res.data.certificados;
			expiraEl = res.data.expires_at;
			paso = 'portal';
			if (browser) localStorage.setItem(STORAGE_KEY, token);
		} catch (err: any) {
			error = err?.response?.data?.error || 'El enlace no es válido o ya venció. Solicita un nuevo acceso.';
			paso = 'identificacion';
		} finally {
			cargando = false;
		}
	}

	function volverAEmpezar() {
		paso = 'identificacion';
		error = '';
	}

	function cerrarSesion() {
		if (browser) localStorage.removeItem(STORAGE_KEY);
		tercero = null;
		certificados = [];
		expiraEl = '';
		identificacion = '';
		volverAEmpezar();
	}

	const TIPOS: Record<string, string> = {
		RETEFUENTE: 'Retefuente',
		RETEICA: 'Reteica',
		RETEIVA: 'Reteiva',
		ICA: 'ICA',
		IVA: 'IVA',
		RETENCIONES: 'Retenciones',
		OTROS: 'Otros'
	};
	const formatearTipo = (codigo: string) => TIPOS[codigo] || codigo;

	function inicial(nombre: string | null | undefined) {
		return nombre?.trim().charAt(0).toUpperCase() || '?';
	}

	/** «ju••••@dominio.com»: confirma a qué correo salió sin exponerlo entero. */
	function ocultarCorreo(email: string) {
		if (!email) return '';
		const [usuario, dominio] = email.split('@');
		if (!usuario || !dominio) return email;
		return `${usuario.slice(0, 2)}${'•'.repeat(Math.max(usuario.length - 2, 3))}@${dominio}`;
	}

	function formatearFecha(iso?: string) {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
		} catch {
			return '—';
		}
	}

	onMount(async () => {
		const token = browser ? new URLSearchParams(window.location.search).get('token') : null;
		if (token) await verificarToken(token);
		montado = true;
	});
</script>

<svelte:head>
	<title>Portal de certificados · {EMPRESA}</title>
	<meta name="description" content="Acceso al portal de certificados tributarios de {EMPRESA}" />
</svelte:head>

{#snippet pieSalir()}
	<button type="button" class="auth-link" onclick={cerrarSesion}>Cerrar sesión</button>
{/snippet}

{#if montado}
	<div class="certificados-scroll">
		<AuthShell
			eyebrow={cabecera.eyebrow}
			titulo={cabecera.titulo}
			subtitulo={cabecera.subtitulo}
			{mascota}
			pie={paso === 'portal' ? pieSalir : undefined}
			marcaCodigo="Certificados tributarios"
			marcaTitulo="Tus certificados, siempre a mano"
			marcaDesc="Retefuente, Reteica, Reteiva y los demás certificados de cada año, listos para descargar en PDF."
			marcaPuntos={[
				'Enlace de acceso a tu correo registrado',
				'Descarga directa en PDF',
				`Sesión válida durante ${TOKEN_DAYS} días`
			]}
		>
			{#if paso === 'verificando'}
				<div class="estado" aria-live="polite">
					<span class="spinner" aria-hidden="true"></span>
					<p class="estado-texto">Si el enlace es válido, en un instante verás tus certificados.</p>
				</div>
			{:else if paso === 'email_sent'}
				<div class="estado" in:fly={{ y: 12, duration: 280, easing: quintOut }}>
					<span class="estado-badge">✓ Enlace enviado</span>
					<p class="estado-texto">
						Enviamos un enlace de acceso a <strong>{ocultarCorreo(emailOculto)}</strong>.
					</p>
					<p class="estado-texto">
						Revisa la bandeja de entrada y la carpeta de spam. El enlace es válido durante
						<strong>{TOKEN_DAYS} días</strong>.
					</p>
					<button type="button" class="btn-secondary" onclick={volverAEmpezar}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
						Usar otra identificación
					</button>
				</div>
			{:else if paso === 'portal' && tercero}
				<div class="portal" in:fly={{ y: 12, duration: 280, easing: quintOut }}>
					{#if certificados.length === 0}
						<div class="estado">
							<span class="estado-badge">Sin certificados</span>
							<p class="estado-texto">
								Todavía no hay certificados cargados para <strong>{tercero.nombre_completo}</strong>.
								Cuando contabilidad los publique, aparecerán aquí con este mismo enlace.
							</p>
						</div>
					{:else}
						<div class="portal-cabecera">
							<span class="portal-avatar" aria-hidden="true">{inicial(tercero.nombre_completo)}</span>
							<p class="portal-conteo">
								<strong>{certificados.length}</strong>
								{certificados.length === 1 ? 'certificado disponible' : 'certificados disponibles'}
							</p>
						</div>
						<ul class="certs">
							{#each certificados as cert (cert.id)}
								<li class="cert">
									<span class="cert-icono" aria-hidden="true">
										<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
											/>
										</svg>
									</span>
									<span class="cert-info">
										<span class="cert-tipo">
											{formatearTipo(cert.tipo_certificado?.codigo || cert.tipo || 'Certificado')}
										</span>
										<span class="cert-anio">Año {cert.anio}</span>
									</span>
									{#if cert.url}
										<a
											class="cert-descargar"
											href={cert.url}
											target="_blank"
											rel="noopener noreferrer"
											aria-label="Descargar {formatearTipo(cert.tipo_certificado?.codigo || cert.tipo || 'certificado')} {cert.anio}"
										>
											<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
												/>
											</svg>
											<span>PDF</span>
										</a>
									{:else}
										<span class="cert-sin-archivo">Sin archivo</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{:else}
				{#if error}
					<div class="alert alert-error" role="alert" aria-live="assertive" in:fly={{ y: -8, duration: 250 }}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
							/>
						</svg>
						<div class="alert-body">
							<strong>No pudimos continuar.</strong>
							<p>{error}</p>
						</div>
						<button type="button" class="alert-close" onclick={() => (error = '')} aria-label="Cerrar mensaje">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				{/if}

				<form class="auth-form" onsubmit={solicitar}>
					<div class="field">
						<label for="identificacion" class="field-label">Número de identificación</label>
						<div class="field-control">
							<svg class="field-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 012-2h0a2 2 0 012 2v1m-4 0h4m-6 7a2 2 0 100-4 2 2 0 000 4zm-3 4a3 3 0 016 0m3-5h4m-4 3h4"
								/>
							</svg>
							<input
								id="identificacion"
								type="tel"
								inputmode="numeric"
								class="field-input"
								bind:value={identificacion}
								placeholder="Solo números, sin puntos"
								maxlength="15"
								autocomplete="off"
								required
								disabled={cargando}
							/>
						</div>
						<p class="field-hint">
							El enlace llega al correo que tienes registrado y la sesión queda activa durante {TOKEN_DAYS} días.
						</p>
					</div>

					<button type="submit" class="btn-submit" disabled={cargando || !identificacion.trim()}>
						{#if cargando}
							<span class="btn-content">
								<svg class="spin" viewBox="0 0 24 24" fill="none">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
									<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
								</svg>
								Enviando enlace…
							</span>
						{:else}
							<span class="btn-content">
								Solicitar acceso
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
								</svg>
							</span>
						{/if}
					</button>
				</form>
			{/if}
		</AuthShell>
	</div>
{/if}

<style>
	/* El body no hace scroll bajo /public: la página es su propio contenedor. */
	.certificados-scroll {
		height: 100vh;
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
		background: var(--au-bg);
	}

	/* ═══ Lista de certificados dentro del panel del AuthShell ═══ */
	.portal {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.portal-cabecera {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.portal-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: var(--au-tint);
		color: var(--au-dark);
		font-weight: 800;
		font-size: 1rem;
		flex-shrink: 0;
	}
	.portal-conteo {
		margin: 0;
		font-size: 0.9rem;
		color: var(--au-muted);
	}
	.portal-conteo strong {
		color: var(--au-text);
		font-weight: 800;
	}

	.certs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.cert {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.8rem 0.9rem;
		background: var(--au-surface);
		border: 1.5px solid var(--au-border);
		border-radius: 16px;
		transition: border-color 0.2s ease;
	}
	.cert:hover {
		border-color: var(--au-primary);
	}
	.cert-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: var(--au-tint);
		color: var(--au-primary-strong);
		flex-shrink: 0;
	}
	.cert-icono svg {
		width: 20px;
		height: 20px;
	}
	.cert-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}
	.cert-tipo {
		font-size: 0.95rem;
		font-weight: 800;
		color: var(--au-text);
		letter-spacing: -0.01em;
	}
	.cert-anio {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--au-muted);
	}

	.cert-descargar {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.5rem;
		padding: 0 0.95rem;
		border-radius: 12px;
		background: var(--au-primary);
		color: #ffffff;
		font-size: 0.8rem;
		font-weight: 800;
		text-decoration: none;
		box-shadow: var(--shadow-btn);
		flex-shrink: 0;
		transition:
			background-color 0.2s ease,
			transform 0.15s ease;
	}
	.cert-descargar:hover {
		background: var(--au-primary-strong);
	}
	.cert-descargar:active {
		transform: scale(0.985);
	}
	.cert-descargar svg {
		width: 16px;
		height: 16px;
	}
	.cert-sin-archivo {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--au-muted);
		padding: 0 0.4rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.cert,
		.cert-descargar {
			transition: none !important;
		}
	}
</style>
