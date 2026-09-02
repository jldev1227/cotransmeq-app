<!--
	Ruta propia de «Mis formularios».

	Existe además de la pestaña dentro de `/dashboard/formularios` porque es la
	única que alcanza a todo el mundo. `hooks.server.ts` deriva el `moduleId` del
	PRIMER segmento tras `/dashboard/`, así que la pestaña queda detrás del
	permiso `formularios` (`administracion`/`hseq`/`operaciones`) — y quien más
	necesita esta pantalla es precisamente quien no gestiona el módulo: alguien
	de contabilidad o mantenimiento a quien HSEQ le asignó un formato.

	Este segmento resuelve al módulo `mis-formularios`, que es `general: true`.
-->
<script lang="ts">
	import MisFormularios from '$lib/components/formularios/MisFormularios.svelte';
</script>

<svelte:head>
	<title>Mis formularios</title>
</svelte:head>

<div class="pagina">
	<header class="cabecera">
		<h1 class="titulo">Mis formularios</h1>
		<p class="sub">Los formatos que te asignaron y los que llevas a medias.</p>
	</header>

	<MisFormularios base="/dashboard/mis-formularios" />
</div>

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
	}

	.cabecera {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.titulo {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.sub {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted, #64748b);
	}
</style>
