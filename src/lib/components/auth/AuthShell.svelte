<script lang="ts">
	/**
	 * Marco de las pantallas de acceso (recuperar contraseña, restablecerla, y
	 * cualquiera que venga después).
	 *
	 * Existe para que ninguna pantalla nueva tenga que copiar el fondo, la
	 * tarjeta y el panel de marca del login: copiarlos fue justo lo que
	 * arrastró el fondo verde de una pantalla a otra. Aquí el fondo es el crema
	 * editorial `#fcfcfb` del sistema; el verde solo queda como acento.
	 *
	 * Las primitivas de formulario (`.field`, `.btn-submit`, `.alert`…) se
	 * declaran con `:global()` dentro del panel porque el contenido llega como
	 * snippet desde la página y, sin eso, el estilo con ámbito de este
	 * componente no lo alcanzaría. Son la contraparte del contrato: la página
	 * pone la estructura, este componente el aspecto.
	 */
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	interface Props {
		/** Etiqueta monoespaciada sobre el título. */
		eyebrow: string;
		titulo: string;
		subtitulo?: string;
		/** Contenido del panel derecho: el formulario o el estado de la pantalla. */
		children: Snippet;
		/** Pie opcional bajo el separador (enlaces de vuelta, ayuda…). */
		pie?: Snippet;
	}

	let { eyebrow, titulo, subtitulo, children, pie }: Props = $props();
</script>

<div class="auth-page" in:fade={{ duration: 300 }}>
	<!-- Ambiente sutil: dos manchas difusas, sin neón y sin fondo saturado. -->
	<div class="orbs" aria-hidden="true">
		<div class="orb orb-1"></div>
		<div class="orb orb-2"></div>
	</div>

	<div class="auth-card" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
		<!-- ═══ IZQUIERDA: panel de marca (carbón editorial) ═══ -->
		<aside class="brand-panel">
			<div class="brand-pattern" aria-hidden="true"></div>

			<div class="brand-head">
				<img
					class="brand-logo"
					src="/assets/logo_nombre_white.webp"
					alt="Cotransmeq S.A.S"
					width="177"
					height="113"
				/>
			</div>

			<div class="brand-body">
				<span class="brand-code">Acceso · Cuenta</span>
				<h2 class="brand-title">Tu cuenta, bajo tu control</h2>
				<p class="brand-desc">
					La contraseña se restablece con un enlace que solo llega a tu correo
					corporativo y caduca a los 30 minutos.
				</p>

				<ul class="brand-features">
					<li>
						<span class="feature-mark">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</span>
						Enlace de un solo uso
					</li>
					<li>
						<span class="feature-mark">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</span>
						Válido durante 30 minutos
					</li>
					<li>
						<span class="feature-mark">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</span>
						Tu contraseña anterior sigue activa hasta que la cambies
					</li>
				</ul>
			</div>

			<div class="brand-foot">
				<span class="status-dot"></span>
				<span class="status-text">Canal seguro</span>
				<span class="status-sep">·</span>
				<span class="status-meta">Cotransmeq S.A.S</span>
			</div>
		</aside>

		<!-- ═══ DERECHA: panel de contenido ═══ -->
		<section class="form-panel">
			<div class="mobile-brand">
				<img
					class="mobile-logo"
					src="/assets/logo_nombre.webp"
					alt="Cotransmeq S.A.S"
					width="177"
					height="113"
				/>
			</div>

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
		</section>
	</div>
</div>

<style>
	/* ════════════════════════════════════════════════════════════
	   AUTH SHELL — mismo lenguaje que el login: crema de fondo,
	   panel de marca carbón, acento esmeralda. Sin fondo verde.
	   ════════════════════════════════════════════════════════════ */
	.auth-page {
		position: relative;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
		color: #1a1a1a;
		background-color: #fcfcfb;
		-webkit-font-smoothing: antialiased;
		overflow: hidden;
	}

	.orbs {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}
	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(90px);
	}
	.orb-1 {
		top: -10rem;
		right: -7rem;
		width: 28rem;
		height: 28rem;
		background: rgba(16, 185, 129, 0.12);
	}
	.orb-2 {
		bottom: -12rem;
		left: -9rem;
		width: 32rem;
		height: 32rem;
		background: rgba(15, 31, 26, 0.07);
	}

	.auth-card {
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
		.auth-card {
			grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		}
	}
	@media (max-width: 1023.98px) {
		.auth-card {
			max-width: 480px;
		}
	}

	/* ═══ Panel de marca ═══ */
	.brand-panel {
		position: relative;
		display: none;
		flex-direction: column;
		justify-content: space-between;
		gap: 2rem;
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

	.brand-panel::before {
		content: '';
		position: absolute;
		top: -6rem;
		right: -6rem;
		width: 18rem;
		height: 18rem;
		background: radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, transparent 70%);
		pointer-events: none;
		z-index: -1;
	}

	.brand-head,
	.brand-body,
	.brand-foot {
		position: relative;
		z-index: 1;
	}

	.brand-logo {
		height: 70px;
		width: auto;
		display: block;
	}

	.brand-code {
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(16, 185, 129, 0.1);
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
		background: rgba(16, 185, 129, 0.18);
		color: #f97316;
		flex-shrink: 0;
	}
	.feature-mark svg {
		width: 12px;
		height: 12px;
	}

	.brand-foot {
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
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
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
			box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
		}
		50% {
			box-shadow: 0 0 0 5px rgba(16, 185, 129, 0.06);
		}
	}

	/* ═══ Panel de contenido ═══ */
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
		background: rgba(16, 185, 129, 0.08);
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

	.form-foot {
		margin-top: 1.25rem;
		text-align: center;
	}

	.footer-copy {
		font-size: 0.75rem;
		color: #9a9a9a;
		text-align: center;
		margin: 1rem 0 0;
		line-height: 1.5;
	}

	/* ════════════════════════════════════════════════════════════
	   PRIMITIVAS DE FORMULARIO — las usan las páginas que se montan
	   dentro del panel. Globales por el ámbito de los snippets.
	   ════════════════════════════════════════════════════════════ */
	.form-panel :global(.auth-form) {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.form-panel :global(.field) {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.form-panel :global(.field-label) {
		font-size: 0.78rem;
		font-weight: 600;
		color: #0f172a;
		letter-spacing: -0.005em;
	}

	.form-panel :global(.field-control) {
		position: relative;
	}

	.form-panel :global(.field-icon) {
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

	.form-panel :global(.field-input) {
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
	.form-panel :global(.field-input::placeholder) {
		color: #9a9a9a;
	}
	.form-panel :global(.field-input--with-action) {
		padding-right: 2.85rem;
	}
	.form-panel :global(.field-input:hover:not(:disabled)) {
		border-color: rgba(0, 0, 0, 0.2);
	}
	.form-panel :global(.field-input:focus) {
		outline: none;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
	}
	.form-panel :global(.field-control:focus-within .field-icon) {
		color: #f97316;
	}
	.form-panel :global(.field-input:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
		background: #fcfcfb;
	}

	.form-panel :global(.field-action) {
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
	.form-panel :global(.field-action:hover:not(:disabled)) {
		color: #ea580c;
		background: rgba(16, 185, 129, 0.06);
	}
	.form-panel :global(.field-action:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.form-panel :global(.field-action svg) {
		width: 16px;
		height: 16px;
	}

	.form-panel :global(.field-hint) {
		font-size: 0.75rem;
		line-height: 1.45;
		color: #6b6b6b;
		margin: 0;
	}

	/* ═══ Avisos ═══ */
	.form-panel :global(.alert) {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.85rem 1.1rem;
		border-radius: 12px;
		margin-bottom: 1.5rem;
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
		font-size: 0.85rem;
		font-weight: 700;
		margin-bottom: 0.15rem;
	}
	.form-panel :global(.alert p) {
		font-size: 0.8rem;
		line-height: 1.45;
		margin: 0;
	}
	.form-panel :global(.alert-body) {
		flex: 1;
		min-width: 0;
	}

	.form-panel :global(.alert-error) {
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.22);
		color: #991b1b;
	}
	.form-panel :global(.alert-error > svg) {
		color: #dc2626;
	}
	.form-panel :global(.alert-error p) {
		color: #b91c1c;
	}

	.form-panel :global(.alert-success) {
		background: rgba(16, 185, 129, 0.07);
		border: 1px solid rgba(5, 150, 105, 0.24);
		color: #166534;
	}
	.form-panel :global(.alert-success > svg) {
		color: #ea580c;
	}
	.form-panel :global(.alert-success p) {
		color: #c2410c;
	}

	/* ═══ Botón principal ═══ */
	.form-panel :global(.btn-submit) {
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
		text-decoration: none;
		box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.form-panel :global(.btn-submit:hover:not(:disabled)) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
	}
	.form-panel :global(.btn-submit:active:not(:disabled)) {
		transform: translateY(0);
	}
	.form-panel :global(.btn-submit:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
		box-shadow: none;
	}
	.form-panel :global(.btn-content) {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.form-panel :global(.btn-content svg) {
		width: 16px;
		height: 16px;
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
	.form-panel :global(.auth-link:hover:not(:disabled)) {
		color: #ea580c;
	}
	.form-panel :global(.auth-link:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ═══ Estados centrados (validando, éxito, enlace inválido) ═══ */
	.form-panel :global(.estado) {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.75rem;
		padding: 1rem 0 0.5rem;
	}
	.form-panel :global(.estado-icono) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		margin-bottom: 0.25rem;
	}
	.form-panel :global(.estado-icono svg) {
		width: 26px;
		height: 26px;
	}
	.form-panel :global(.estado-icono--ok) {
		background: rgba(16, 185, 129, 0.1);
		color: #ea580c;
	}
	.form-panel :global(.estado-icono--error) {
		background: rgba(239, 68, 68, 0.08);
		color: #dc2626;
	}
	.form-panel :global(.estado-titulo) {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.3rem;
		font-weight: 400;
		color: #0f172a;
		margin: 0;
	}
	.form-panel :global(.estado-texto) {
		font-size: 0.875rem;
		line-height: 1.6;
		color: #4a4a4a;
		margin: 0;
		max-width: 34rem;
	}
	.form-panel :global(.spinner) {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 2px solid rgba(16, 185, 129, 0.2);
		border-top-color: #f97316;
		animation: spin 0.8s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.auth-card,
		.status-dot {
			transition: none !important;
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
