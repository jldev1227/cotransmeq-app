<script lang="ts">
	import { page } from '$app/state';
	import { UserRound } from 'lucide-svelte';
	import FichaConductor from '$lib/components/personal/FichaConductor.svelte';
	import FichaAdministrativa from '$lib/components/personal/FichaAdministrativa.svelte';
	import { authStore } from '$lib/stores/auth';

	const tipo = $derived(page.url.searchParams.get('tipo'));
	const esAdmin = $derived($authStore.user?.role === 'admin' || $authStore.user?.rol === 'admin');
</script>

{#if tipo === 'conductor'}
	<FichaConductor />
{:else if tipo === 'administrativo' && esAdmin}
	<FichaAdministrativa id={page.params.id ?? ''} />
{:else}
	<section class="personal-ficha-error"><UserRound size={24} /><h1>Ficha de personal no disponible</h1><p>Selecciona una ficha desde el directorio de Personal.</p><a href="/dashboard/personal">Volver a Personal</a></section>
{/if}

<style>
	.personal-ficha-error { display: grid; justify-items: center; gap: .5rem; padding: 3rem 1rem; border: 1px solid var(--border-subtle); border-radius: 18px; background: var(--bg-surface); color: var(--text-muted); text-align: center; }
	.personal-ficha-error h1 { margin: 0; color: var(--text-primary); font-size: 1rem; }
	.personal-ficha-error p { margin: 0; font-size: .8rem; }
	.personal-ficha-error a { margin-top: .3rem; color: var(--au-primary-strong); font-size: .8rem; font-weight: 750; }
</style>
