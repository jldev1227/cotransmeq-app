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
		<div>
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
	.personal-route__header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: 1.15rem 1.3rem; border: 1px solid var(--border-subtle); border-radius: 18px; background: var(--bg-surface); }
	.personal-route__header > div { display: grid; gap: .2rem; }
	.personal-route__header p { margin: 0; color: var(--au-primary-strong); font-size: .64rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
	.personal-route__header h1 { margin: 0; color: var(--text-primary); font-family: var(--font-display); font-size: 1.35rem; font-weight: 850; }
	.personal-route__header span { color: var(--text-muted); font-size: .76rem; }
	.personal-route__tabs { display: flex; gap: .35rem; padding: .25rem; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-base); }
	.personal-route__tabs button { display: inline-flex; align-items: center; gap: .45rem; padding: .55rem .75rem; border: 1px solid transparent; border-radius: 9px; color: var(--text-muted); background: transparent; font: inherit; font-size: .73rem; font-weight: 750; cursor: pointer; }
	.personal-route__tabs button.active { border-color: var(--border-subtle); color: var(--au-primary-strong); background: var(--bg-surface); box-shadow: 0 1px 2px rgba(15,23,42,.06); }
	@media (max-width: 760px) { .personal-route__header { align-items: stretch; flex-direction: column; } .personal-route__tabs { width: max-content; max-width: 100%; } .personal-route__tabs button { flex: 1; justify-content: center; } }
</style>
