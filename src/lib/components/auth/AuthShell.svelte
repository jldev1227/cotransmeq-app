<script lang="ts">
	/**
	 * Marco de las pantallas de acceso: login, recuperar contraseña,
	 * restablecerla e invitación.
	 *
	 * Sigue el diseño de la app móvil de conductores: un bloque de marca oscuro
	 * con la mascota y el formulario sobre el fondo claro de la marca, sin
	 * tarjeta flotante. En escritorio el bloque oscuro es la mitad izquierda de
	 * la pantalla; en móvil es la cabecera, como en la app.
	 *
	 * La mascota la elige cada pantalla por INTENCIÓN (`mascota="correoEnviado"`)
	 * y cambia con el estado: así la pantalla reacciona sin que cada página
	 * tenga que dibujar su propio icono.
	 *
	 * Las primitivas de formulario (`.field`, `.btn-submit`, `.alert`…) van con
	 * `:global()` dentro del panel porque el contenido llega como snippet desde
	 * la página y, sin eso, el estilo con ámbito de este componente no lo
	 * alcanzaría. La página pone la estructura, este componente el aspecto.
	 */
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { mascota as mascotaDe, type MascotIntent } from '$lib/mascot';

	interface Props {
		/** Etiqueta pequeña sobre el título del formulario. */
		eyebrow: string;
		titulo: string;
		subtitulo?: string;
		/** Contenido del panel: el formulario o el estado de la pantalla. */
		children: Snippet;
		/** Pie opcional bajo el separador (enlaces de vuelta, ayuda…). */
		pie?: Snippet;
		/** Reacción de la mascota en el bloque de marca. */
		mascota?: MascotIntent;
		/**
		 * Texto del bloque de marca. Tiene valores por defecto pensados para el
		 * acceso a la cuenta; cualquier otra pantalla (invitación, alta…) debe
		 * pasar los suyos, o el bloque hablará de otra cosa.
		 */
		marcaCodigo?: string;
		marcaTitulo?: string;
		marcaDesc?: string;
		marcaPuntos?: string[];
	}

	let {
		eyebrow,
		titulo,
		subtitulo,
		children,
		pie,
		mascota = 'bienvenida',
		marcaCodigo = 'Sistema de gestión',
		marcaTitulo = 'Tu cuenta, bajo tu control',
		marcaDesc = 'La contraseña se restablece con un enlace que solo llega a tu correo corporativo y caduca a los 30 minutos.',
		marcaPuntos = [
			'Enlace de un solo uso',
			'Válido durante 30 minutos',
			'Tu contraseña anterior sigue activa hasta que la cambies'
		]
	}: Props = $props();

	const imagen = $derived(mascotaDe(mascota));
</script>

<div class="auth-page" in:fade={{ duration: 300 }}>
	<!-- ═══ Bloque de marca: oscuro, con la mascota ═══ -->
	<aside class="hero">
		<div class="hero-glow" aria-hidden="true"></div>

		<div class="hero-head">
			<img
				class="hero-logo"
				src="/assets/logo_nombre_white.webp"
				alt="Cotransmeq S.A.S"
				width="132"
				height="45"
			/>
		</div>

		<div class="hero-body">
			<span class="hero-eyebrow">{marcaCodigo}</span>
			<h2 class="hero-title">{marcaTitulo}</h2>
			<p class="hero-desc">{marcaDesc}</p>

			{#if marcaPuntos.length}
				<ul class="hero-points">
					{#each marcaPuntos as punto (punto)}
						<li>
							<span class="point-mark" aria-hidden="true">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								</svg>
							</span>
							{punto}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- La mascota cambia con el estado; `key` reinicia la entrada. -->
		{#key imagen.src}
			<img
				class="hero-mascot"
				src={imagen.src}
				alt={imagen.alt}
				width="418"
				height="418"
				in:fly={{ y: 24, duration: 450, easing: quintOut }}
			/>
		{/key}

		<div class="hero-foot">
			<span class="status-dot" aria-hidden="true"></span>
			<span>Canal seguro</span>
			<span class="status-sep">·</span>
			<span>Cotransmeq S.A.S</span>
		</div>
	</aside>

	<!-- ═══ Panel de contenido ═══ -->
	<section class="form-panel">
		<div class="form-inner" in:fly={{ y: 16, duration: 450, delay: 80, easing: quintOut }}>
			<div class="form-head">
				<span class="eyebrow">{eyebrow}</span>
				<h1 class="form-title">{titulo}</h1>
				{#if subtitulo}
					<p class="form-subtitle">{subtitulo}</p>
				{/if}
			</div>

			{@render children()}

			<div class="secure-row">
				<span class="secure-sep"></span>
				<span class="secure-text">Acceso cifrado · TLS 1.3</span>
				<span class="secure-sep"></span>
			</div>

			{#if pie}
				<div class="form-foot">{@render pie()}</div>
			{/if}

			<p class="footer-copy">
				© {new Date().getFullYear()} Cotransmeq S.A.S · Yopal, Casanare · Colombia
			</p>
		</div>
	</section>
</div>

<style>
	/* ════════════════════════════════════════════════════════════
	   AUTH SHELL — el lenguaje de la app móvil llevado a la web:
	   fondo suave de marca, bloque oscuro con mascota, sin tarjeta.
	   Los colores salen de `--au-*` (app.css).
	   ════════════════════════════════════════════════════════════ */
	.auth-page {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: auto 1fr;
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--au-bg);
		color: var(--au-text);
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
	}
	@media (min-width: 1024px) {
		.auth-page {
			grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
			grid-template-rows: 1fr;
		}
	}

	/* ═══ Bloque de marca ═══ */
	.hero {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.5rem 1.5rem 1.75rem;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 70%);
		color: #ffffff;
		border-radius: 0 0 30px 30px;
		overflow: hidden;
		isolation: isolate;
	}
	@media (min-width: 1024px) {
		.hero {
			justify-content: space-between;
			gap: 2.5rem;
			padding: 3rem 3.25rem;
			border-radius: 0;
			min-height: 100vh;
			min-height: 100dvh;
			position: sticky;
			top: 0;
		}
	}

	/* Mancha de luz de marca, como el círculo del hero de la app. */
	.hero-glow {
		position: absolute;
		right: -18%;
		top: -25%;
		width: 70%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.06);
		pointer-events: none;
		z-index: -1;
	}

	.hero-head,
	.hero-body,
	.hero-foot {
		position: relative;
		z-index: 2;
	}

	.hero-logo {
		height: 40px;
		width: auto;
		display: block;
	}
	@media (min-width: 1024px) {
		.hero-logo {
			height: 60px;
		}
	}

	.hero-body {
		max-width: 62%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	@media (min-width: 1024px) {
		.hero-body {
			max-width: 26rem;
			gap: 0.75rem;
			/* Deja sitio a la mascota, que en escritorio ocupa la esquina inferior. */
			margin-bottom: min(28vh, 16rem);
		}
	}

	.hero-eyebrow {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}

	.hero-title {
		font-size: clamp(1.6rem, 4.5vw, 2.4rem);
		font-weight: 800;
		line-height: 1.1;
		letter-spacing: -0.03em;
		color: #ffffff;
		margin: 0;
	}

	.hero-desc {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--au-hero-text);
		margin: 0;
	}

	/* En móvil el bloque es una cabecera corta: la lista solo cabe en escritorio. */
	.hero-points {
		display: none;
		list-style: none;
		padding: 0;
		margin: 0.75rem 0 0;
		flex-direction: column;
		gap: 0.6rem;
	}
	@media (min-width: 1024px) {
		.hero-points {
			display: flex;
		}
	}
	.hero-points li {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.85);
	}
	.point-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.14);
		color: var(--au-eyebrow);
		flex-shrink: 0;
	}
	.point-mark svg {
		width: 12px;
		height: 12px;
	}

	.hero-mascot {
		position: absolute;
		right: -0.5rem;
		bottom: -0.75rem;
		width: 11.5rem;
		height: 11.5rem;
		object-fit: contain;
		z-index: 1;
		pointer-events: none;
		user-select: none;
		filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.25));
	}
	@media (min-width: 640px) {
		.hero-mascot {
			width: 13rem;
			height: 13rem;
		}
	}
	@media (min-width: 1024px) {
		.hero-mascot {
			right: 1.5rem;
			bottom: 3.5rem;
			width: min(26rem, 38vh);
			height: min(26rem, 38vh);
		}
	}

	.hero-foot {
		display: none;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.65);
	}
	@media (min-width: 1024px) {
		.hero-foot {
			display: flex;
		}
	}
	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--au-eyebrow);
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
		animation: pulse 2.5s ease-in-out infinite;
	}
	.status-sep {
		opacity: 0.4;
	}
	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
		}
		50% {
			box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.04);
		}
	}

	/* ═══ Panel de contenido ═══ */
	.form-panel {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1.75rem 1.25rem 2rem;
	}
	@media (min-width: 640px) {
		.form-panel {
			padding: 2.5rem 2rem;
		}
	}
	@media (min-width: 1024px) {
		.form-panel {
			align-items: center;
			padding: 3rem 4rem;
		}
	}

	.form-inner {
		width: 100%;
		max-width: 27rem;
	}

	.form-head {
		margin-bottom: 1.5rem;
	}

	.eyebrow {
		display: inline-block;
		font-size: 0.72rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--au-primary-strong);
		background: var(--au-tint);
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		margin-bottom: 0.85rem;
	}

	.form-title {
		font-size: clamp(1.5rem, 3.4vw, 1.9rem);
		font-weight: 800;
		line-height: 1.15;
		letter-spacing: -0.025em;
		color: var(--au-text);
		margin: 0 0 0.5rem;
	}

	.form-subtitle {
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--au-muted);
		margin: 0;
	}

	.secure-row {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		margin-top: 1.75rem;
	}
	.secure-sep {
		flex: 1;
		height: 1px;
		background: var(--au-border);
	}
	.secure-text {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--au-muted);
	}

	.form-foot {
		margin-top: 1.25rem;
		text-align: center;
	}

	.footer-copy {
		font-size: 0.75rem;
		color: var(--au-muted);
		text-align: center;
		margin: 1rem 0 0;
		line-height: 1.5;
	}

	/* ════════════════════════════════════════════════════════════
	   PRIMITIVAS DE FORMULARIO — las usan las páginas que se montan
	   dentro del panel. Globales por el ámbito de los snippets.
	   Medidas de la app: campos de 56px, radio 14, peso 600.
	   ════════════════════════════════════════════════════════════ */
	.form-panel :global(.auth-form) {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.form-panel :global(.field) {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.form-panel :global(.field-label) {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--au-text);
	}

	.form-panel :global(.field-control) {
		position: relative;
	}

	.form-panel :global(.field-icon) {
		position: absolute;
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		width: 18px;
		height: 18px;
		color: var(--au-muted);
		pointer-events: none;
		transition: color 0.2s ease;
	}

	.form-panel :global(.field-input) {
		width: 100%;
		min-height: 3.25rem;
		padding: 0.8rem 1rem 0.8rem 2.85rem;
		font-size: 1rem;
		font-weight: 600;
		font-family: inherit;
		color: var(--au-text);
		background: var(--au-surface);
		border: 1.5px solid var(--au-border);
		border-radius: 14px;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}
	.form-panel :global(.field-input::placeholder) {
		color: var(--au-muted);
		font-weight: 500;
	}
	.form-panel :global(.field-input--with-action) {
		padding-right: 3rem;
	}
	.form-panel :global(.field-input:hover:not(:disabled)) {
		border-color: var(--au-primary);
	}
	.form-panel :global(.field-input:focus) {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb), 0.14);
	}
	.form-panel :global(.field-control:focus-within .field-icon) {
		color: var(--au-primary);
	}
	.form-panel :global(.field-input:disabled) {
		opacity: 0.7;
		cursor: not-allowed;
		background: var(--au-bg);
	}

	.form-panel :global(.field-action) {
		position: absolute;
		right: 0.65rem;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 10px;
		color: var(--au-muted);
		cursor: pointer;
		transition:
			color 0.2s ease,
			background-color 0.2s ease;
	}
	.form-panel :global(.field-action:hover:not(:disabled)) {
		color: var(--au-primary-strong);
		background: var(--au-tint);
	}
	.form-panel :global(.field-action:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.form-panel :global(.field-action svg) {
		width: 18px;
		height: 18px;
	}

	.form-panel :global(.field-hint) {
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--au-muted);
		margin: 0;
	}

	/* ═══ Fila «recordarme» + enlace ═══ */
	.form-panel :global(.form-row) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.form-panel :global(.checkbox) {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		cursor: pointer;
		user-select: none;
	}
	.form-panel :global(.checkbox-input) {
		width: 18px;
		height: 18px;
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
		border: 1.5px solid var(--au-border);
		border-radius: 5px;
		background: var(--au-surface);
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
		transition:
			border-color 0.2s ease,
			background-color 0.2s ease;
	}
	.form-panel :global(.checkbox-input:hover:not(:disabled)) {
		border-color: var(--au-primary);
	}
	.form-panel :global(.checkbox-input:checked) {
		background: var(--au-primary);
		border-color: var(--au-primary);
	}
	.form-panel :global(.checkbox-input:checked::after) {
		content: '';
		position: absolute;
		top: 2px;
		left: 5px;
		width: 5px;
		height: 9px;
		border: solid #ffffff;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	.form-panel :global(.checkbox-input:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.form-panel :global(.checkbox-label) {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--au-muted);
	}
	.form-panel :global(.checkbox:hover .checkbox-label) {
		color: var(--au-text);
	}

	/* ═══ Avisos ═══ */
	.form-panel :global(.alert) {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.9rem 1.1rem;
		border-radius: 14px;
		margin-bottom: 1.4rem;
	}
	.form-panel :global(.alert:focus) {
		outline: none;
	}
	.form-panel :global(.alert > svg) {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		margin-top: 0.1rem;
	}
	.form-panel :global(.alert strong) {
		display: block;
		font-size: 0.88rem;
		font-weight: 700;
		margin-bottom: 0.15rem;
	}
	.form-panel :global(.alert p) {
		font-size: 0.82rem;
		line-height: 1.45;
		margin: 0;
	}
	.form-panel :global(.alert-body) {
		flex: 1;
		min-width: 0;
	}
	.form-panel :global(.alert-close) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		margin: -0.15rem -0.35rem 0 0;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: currentColor;
		cursor: pointer;
		flex-shrink: 0;
		opacity: 0.6;
	}
	.form-panel :global(.alert-close:hover) {
		opacity: 1;
	}
	.form-panel :global(.alert-close svg) {
		width: 14px;
		height: 14px;
	}

	.form-panel :global(.alert-error) {
		background: var(--au-danger-soft);
		border: 1.5px solid rgba(180, 35, 24, 0.25);
		color: var(--au-danger);
	}
	.form-panel :global(.alert-error > svg) {
		color: var(--au-danger);
	}
	.form-panel :global(.alert-error p) {
		color: var(--au-danger);
	}

	.form-panel :global(.alert-success) {
		background: var(--au-tint);
		border: 1.5px solid rgba(var(--au-primary-rgb), 0.3);
		color: var(--au-dark);
	}
	.form-panel :global(.alert-success > svg) {
		color: var(--au-primary-strong);
	}
	.form-panel :global(.alert-success p) {
		color: var(--au-primary-strong);
	}

	/* ═══ Botón principal ═══ */
	.form-panel :global(.btn-submit) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 3.25rem;
		padding: 0.85rem 1.25rem;
		margin-top: 0.25rem;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 800;
		color: #ffffff;
		background: var(--accion);
		border: none;
		border-radius: 16px;
		cursor: pointer;
		text-decoration: none;
		box-shadow: var(--shadow-btn);
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease,
			background-color 0.2s ease;
	}
	.form-panel :global(.btn-submit:hover:not(:disabled)) {
		background: var(--accion-hover);
		box-shadow: var(--shadow-btn-hover);
	}
	.form-panel :global(.btn-submit:active:not(:disabled)) {
		transform: scale(0.99);
	}
	.form-panel :global(.btn-submit:disabled) {
		opacity: 0.55;
		cursor: not-allowed;
		box-shadow: none;
	}
	.form-panel :global(.btn-content) {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.form-panel :global(.btn-content svg) {
		width: 18px;
		height: 18px;
	}

	/* Botón secundario, con borde: «usar otra cédula», «volver»… */
	.form-panel :global(.btn-secondary) {
		width: 100%;
		min-height: 3rem;
		padding: 0.75rem 1.25rem;
		font-size: 0.95rem;
	}

	.form-panel :global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ═══ Enlaces de apoyo ═══ */
	.form-panel :global(.auth-link) {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--au-primary-strong);
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
		text-decoration: none;
		transition: color 0.2s ease;
	}
	.form-panel :global(.auth-link:hover:not(:disabled)) {
		color: var(--au-dark);
		text-decoration: underline;
	}
	.form-panel :global(.auth-link:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ═══ Estados (validando, éxito, enlace inválido) ═══ */
	.form-panel :global(.estado) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.9rem;
		padding: 0.25rem 0 0.5rem;
	}
	.form-panel :global(.estado-badge) {
		display: inline-block;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--au-dark);
		background: var(--au-tint);
	}
	.form-panel :global(.estado-badge--error) {
		color: var(--au-danger);
		background: var(--au-danger-soft);
	}
	.form-panel :global(.estado-titulo) {
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--au-text);
		margin: 0;
	}
	.form-panel :global(.estado-texto) {
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--au-muted);
		margin: 0;
	}
	.form-panel :global(.estado-texto strong) {
		color: var(--au-dark);
		font-weight: 800;
	}
	.form-panel :global(.estado .btn-submit),
	.form-panel :global(.estado .btn-secondary) {
		margin-top: 0.35rem;
	}
	.form-panel :global(.spinner) {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 3px solid var(--au-tint);
		border-top-color: var(--au-primary);
		animation: spin 0.8s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.status-dot,
		.form-panel :global(.spin),
		.form-panel :global(.spinner) {
			animation: none !important;
		}
		.form-panel :global(.btn-submit),
		.form-panel :global(.field-input),
		.form-panel :global(.field-icon),
		.form-panel :global(.field-action),
		.form-panel :global(.auth-link) {
			transition: none !important;
		}
	}
</style>
