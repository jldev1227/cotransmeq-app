<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { IdCard, UserCog } from 'lucide-svelte';
	import ListadoConductores from '$lib/components/personal/ListadoConductores.svelte';
	import ListadoAdministrativos from '$lib/components/personal/ListadoAdministrativos.svelte';
	import { authStore } from '$lib/stores/auth';

	type TipoPersonal = 'conductor' | 'administrativo';
	let tipoActivo = $state<TipoPersonal>('conductor');
	function tieneAreaAdministracion() {
		const area = $authStore.user?.area;
		return Array.isArray(area) ? area.includes('administracion') : area === 'administracion';
	}
	const esAdmin = $derived(tieneAreaAdministracion());

	$effect(() => {
		const tipo = page.url.searchParams.get('tipo');
		tipoActivo = tipo === 'administrativo' && esAdmin ? 'administrativo' : 'conductor';
	});

	function cambiarTipo(tipo: TipoPersonal) {
		if (tipo === 'administrativo' && !esAdmin) return;
		tipoActivo = tipo;
		const url = new URL(page.url);
		url.searchParams.set('tipo', tipo);
		void goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
	}
</script>

<svelte:head>
	<title>Personal | Cotransmeq</title>
	<meta name="description" content="Directorio de conductores y personal administrativo." />
</svelte:head>

<section class="personal-route" aria-label="Personal">
	<header class="personal-route__header">
		<div class="personal-route__intro">
			<p>Directorio de la empresa</p>
			<h1>Personal</h1>
			<span>Conductores y equipo administrativo en un solo lugar.</span>
		</div>
		<nav class="personal-route__tabs" aria-label="Tipo de personal">
			<button type="button" class:active={tipoActivo === 'conductor'} aria-pressed={tipoActivo === 'conductor'} onclick={() => cambiarTipo('conductor')}>
				<IdCard size={16} /> Conductores
			</button>
			{#if esAdmin}
				<button type="button" class:active={tipoActivo === 'administrativo'} aria-pressed={tipoActivo === 'administrativo'} onclick={() => cambiarTipo('administrativo')}>
					<UserCog size={16} /> Administrativos
				</button>
			{/if}
		</nav>
	</header>

	{#if tipoActivo === 'administrativo' && esAdmin}
		<ListadoAdministrativos />
	{:else}
		<ListadoConductores />
	{/if}
</section>

<style>
	.personal-route { display: grid; gap: 1rem; }
	.personal-route__header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: clamp(1rem, 2vw, 1.75rem);
		padding: clamp(1rem, 2vw, 1.4rem) clamp(1rem, 2.4vw, 1.6rem);
		border: 1px solid var(--border-subtle);
		border-radius: 18px;
		background: var(--bg-surface);
	}
	.personal-route__intro { display: grid; justify-items: start; gap: .38rem; min-width: 0; }
	.personal-route__intro p {
		width: fit-content;
		margin: 0;
		padding: .28rem .55rem;
		border: 1px solid color-mix(in srgb, var(--au-primary-strong) 16%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--au-primary-strong) 7%, transparent);
		color: var(--au-primary-strong);
		font-size: .62rem;
		font-weight: 800;
		letter-spacing: .08em;
		line-height: 1.2;
		text-transform: uppercase;
	}
	.personal-route__intro h1 {
		margin: 0;
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: clamp(1.55rem, 2.4vw, 2rem);
		font-weight: 850;
		letter-spacing: -.035em;
		line-height: 1.05;
	}
	.personal-route__intro span {
		max-width: 38rem;
		color: var(--text-muted);
		font-size: .82rem;
		line-height: 1.45;
	}
	.personal-route__tabs {
		display: flex;
		flex: 0 0 auto;
		gap: .3rem;
		padding: .25rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-base);
	}
	.personal-route__tabs button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: .45rem;
		min-height: 42px;
		padding: .55rem .8rem;
		border: 1px solid transparent;
		border-radius: 9px;
		color: var(--text-muted);
		background: transparent;
		font: inherit;
		font-size: .75rem;
		font-weight: 750;
		white-space: nowrap;
		cursor: pointer;
		transition: color .16s ease, background-color .16s ease, border-color .16s ease;
	}
	.personal-route__tabs button:hover { color: var(--text-primary); }
	.personal-route__tabs button:focus-visible {
		outline: 2px solid var(--au-primary-strong);
		outline-offset: 2px;
	}
	.personal-route__tabs button.active {
		border-color: var(--border-subtle);
		color: var(--au-primary-strong);
		background: var(--bg-surface);
		box-shadow: 0 1px 2px rgba(15, 23, 42, .06);
	}
	@media (max-width: 720px) {
		.personal-route__header { grid-template-columns: minmax(0, 1fr); gap: .9rem; padding: 1rem; }
		.personal-route__intro { gap: .32rem; }
		.personal-route__intro span { max-width: 32rem; }
		.personal-route__tabs {
			width: 100%;
			min-width: 0;
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.personal-route__tabs button { min-width: 0; min-height: 44px; padding-inline: .45rem; }
	}
	@media (max-width: 380px) {
		.personal-route__header { padding: .85rem; border-radius: 15px; }
		.personal-route__intro h1 { font-size: 1.45rem; }
		.personal-route__intro span { font-size: .76rem; }
		.personal-route__tabs { gap: .2rem; padding: .2rem; }
		.personal-route__tabs button { gap: .3rem; font-size: .69rem; }
	}
</style>
