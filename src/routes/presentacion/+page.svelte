<script lang="ts">
	import Icon from '@iconify/svelte';

	const recorrido = [
		{ icono: 'ph:steering-wheel', titulo: 'Conductores', copy: 'Portal móvil y documentación.' },
		{ icono: 'ph:truck', titulo: 'Servicios', copy: 'Planeación, ruta y seguimiento.' },
		{ icono: 'ph:clipboard-text', titulo: 'Evidencia', copy: 'Formatos, firmas y trazabilidad.' },
		{ icono: 'ph:calculator', titulo: 'Liquidación', copy: 'Control operativo y financiero.' }
	];
</script>

<svelte:head>
	<title>Cotransmeq · Operación de transporte conectada</title>
	<meta
		name="description"
		content="Presentación pública de la plataforma operativa de Cotransmeq."
	/>
</svelte:head>

<main class="presentation-page">
	<nav>
		<img src="/assets/logo_nombre_white.webp" alt="Cotransmeq" />
		<div class="nav-meta">
			<span>PLATAFORMA OPERATIVA</span>
			<span class="status"><i></i> Ecosistema conectado</span>
		</div>
	</nav>

	<section class="hero">
		<div class="hero-copy">
			<p class="eyebrow">MOVILIDAD · SEGURIDAD · TRAZABILIDAD</p>
			<h1>La operación en carretera,<br /><em>visible de principio a fin.</em></h1>
			<p class="lede">
				Una plataforma que conecta servicios, conductores, flota, formularios y liquidaciones sin
				separar el trabajo de campo de la gestión administrativa.
			</p>
			<div class="chips">
				<span>PESV</span><span>Flota</span><span>Formularios</span><span>Servicios</span><span
					>Liquidaciones</span
				>
			</div>
		</div>

		<div class="product-view">
			<header>
				<div><small>VISTA DE PRODUCTO</small><strong>Centro de operación</strong></div>
				<span class="live"><i></i> Flujo activo</span>
			</header>
			<div class="route-line">
				<div class="line"></div>
				{#each recorrido as paso, i}
					<article>
						<span class="step">0{i + 1}</span>
						<div class="icon"><Icon icon={paso.icono} /></div>
						<h2>{paso.titulo}</h2>
						<p>{paso.copy}</p>
					</article>
				{/each}
			</div>
			<div class="product-footer">
				<span><Icon icon="ph:cloud-check" /> Sincronización operativa</span>
				<span><Icon icon="ph:shield-check" /> Evidencia protegida</span>
				<span><Icon icon="ph:broadcast" /> Eventos en tiempo real</span>
			</div>
		</div>
	</section>

	<section class="capabilities" aria-label="Capacidades principales">
		<div><strong>Una sola cadena operativa</strong><span>Del despacho a la evidencia</span></div>
		<div><strong>Dos experiencias coordinadas</strong><span>Administración y conductor</span></div>
		<div><strong>Decisiones con contexto</strong><span>Información lista para actuar</span></div>
	</section>
</main>

<style>
	.presentation-page {
		min-height: 100vh;
		overflow: hidden;
		background:
			radial-gradient(circle at 72% 24%, rgba(34, 197, 94, 0.2), transparent 30rem),
			linear-gradient(135deg, #07130f 0%, #0f1f1a 56%, #052e16 100%);
		color: #f0ede6;
	}
	nav,
	.hero,
	.capabilities {
		padding-inline: clamp(24px, 5vw, 76px);
	}
	nav {
		display: flex;
		height: 98px;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	nav img {
		width: auto;
		height: 54px;
		object-fit: contain;
	}
	.nav-meta {
		display: flex;
		align-items: center;
		gap: 18px;
		font:
			700 11px/1 'JetBrains Mono',
			monospace;
		letter-spacing: 0.12em;
		color: #9caea7;
	}
	.status,
	.live {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 1px solid rgba(52, 211, 153, 0.22);
		border-radius: 999px;
		background: rgba(16, 185, 129, 0.1);
		padding: 8px 12px;
		color: #a7f3d0;
	}
	.status i,
	.live i {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: #34d399;
		box-shadow: 0 0 12px rgba(52, 211, 153, 0.8);
	}
	.hero {
		display: grid;
		min-height: 680px;
		grid-template-columns: minmax(0, 0.85fr) minmax(620px, 1.15fr);
		align-items: center;
		gap: clamp(46px, 6vw, 96px);
		padding-block: 52px;
	}
	.eyebrow {
		margin: 0 0 20px;
		font:
			700 11px/1.4 'JetBrains Mono',
			monospace;
		letter-spacing: 0.16em;
		color: #6ee7b7;
	}
	h1 {
		margin: 0;
		font:
			500 clamp(44px, 5.4vw, 76px) / 1.02 'Fraunces',
			Georgia,
			serif;
		letter-spacing: -0.045em;
		text-wrap: balance;
	}
	h1 em {
		font-style: normal;
		color: #6ee7b7;
	}
	.lede {
		max-width: 42rem;
		margin: 28px 0 0;
		font-size: 17px;
		line-height: 1.7;
		color: #b8c4bf;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 30px;
	}
	.chips span {
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.045);
		padding: 8px 12px;
		font-size: 12px;
		font-weight: 650;
		color: #d2dbd7;
	}
	.product-view {
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 24px;
		background: rgba(255, 255, 255, 0.055);
		box-shadow: 0 28px 80px rgba(0, 0, 0, 0.32);
		backdrop-filter: blur(20px);
	}
	.product-view header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		padding: 18px 22px;
	}
	.product-view header div {
		display: grid;
		gap: 5px;
	}
	.product-view header small {
		font:
			700 9px/1 'JetBrains Mono',
			monospace;
		letter-spacing: 0.15em;
		color: #789087;
	}
	.product-view header strong {
		font-size: 14px;
	}
	.live {
		padding: 7px 10px;
		font-size: 11px;
		font-weight: 650;
	}
	.route-line {
		position: relative;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
		padding: 34px 20px 30px;
	}
	.line {
		position: absolute;
		top: 73px;
		right: 10%;
		left: 10%;
		height: 1px;
		background: linear-gradient(90deg, transparent, #34d399 15% 85%, transparent);
		opacity: 0.55;
	}
	.route-line article {
		position: relative;
		z-index: 1;
		min-width: 0;
		border: 1px solid rgba(255, 255, 255, 0.09);
		border-radius: 16px;
		background: rgba(7, 19, 15, 0.86);
		padding: 14px;
	}
	.step {
		font:
			700 9px/1 'JetBrains Mono',
			monospace;
		color: #5d756c;
	}
	.icon {
		display: grid;
		width: 42px;
		height: 42px;
		margin-top: 12px;
		place-items: center;
		border: 1px solid rgba(52, 211, 153, 0.22);
		border-radius: 12px;
		background: #166534;
		color: white;
	}
	.icon :global(svg) {
		width: 21px;
		height: 21px;
	}
	.route-line h2 {
		margin: 16px 0 0;
		font-size: 13px;
		font-weight: 700;
	}
	.route-line p {
		margin: 6px 0 0;
		font-size: 11px;
		line-height: 1.5;
		color: #8fa199;
	}
	.product-footer {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		padding: 15px 20px;
	}
	.product-footer span {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 10px;
		color: #9caea7;
	}
	.product-footer :global(svg) {
		width: 15px;
		height: 15px;
		color: #34d399;
	}
	.capabilities {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}
	.capabilities div {
		display: grid;
		gap: 5px;
		padding: 24px 0 30px;
	}
	.capabilities div + div {
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		padding-left: 28px;
	}
	.capabilities strong {
		font:
			500 20px/1.2 'Fraunces',
			Georgia,
			serif;
	}
	.capabilities span {
		font-size: 12px;
		color: #82968d;
	}
	@media (max-width: 980px) {
		.hero {
			grid-template-columns: 1fr;
		}
		.nav-meta > span:first-child {
			display: none;
		}
	}
	@media (max-width: 640px) {
		nav img {
			height: 42px;
		}
		.status {
			display: none;
		}
		.route-line,
		.product-footer,
		.capabilities {
			grid-template-columns: 1fr;
		}
		.line {
			display: none;
		}
		.capabilities div + div {
			border-top: 1px solid rgba(255, 255, 255, 0.1);
			border-left: 0;
			padding-left: 0;
		}
	}
</style>
