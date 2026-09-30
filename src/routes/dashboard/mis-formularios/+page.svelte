<!--
	Ruta propia de «Mis formularios».

	Existe además de la pestaña dentro de `/dashboard/formularios` porque es la
	única que alcanza a todo el mundo. `hooks.server.ts` deriva el `moduleId` del
	PRIMER segmento tras `/dashboard/`, así que la pestaña queda detrás del
	permiso `formularios` (`administracion`/`hseq`/`operaciones`) — y quien más
	necesita esta pantalla es precisamente quien no gestiona el módulo: alguien
	de contabilidad o mantenimiento a quien HSEQ le asignó un formato.

	Este segmento resuelve al módulo `mis-formularios`, que es `general: true`.

	La lista, con su búsqueda y sus filtros, vive en `MisFormularios.svelte`
	porque la comparte con esa pestaña. Lo que sí es propio de esta ruta es
	`sincronizarUrl`: aquí la query string no la disputa nadie, así que los
	filtros pueden vivir en ella y la pantalla se comparte como enlace.
-->
<script lang="ts">
	import MisFormularios from '$lib/components/formularios/MisFormularios.svelte';
</script>

<svelte:head>
	<title>Mis formularios — Cotransmeq</title>
</svelte:head>

<!-- La cabecera con el saludo, la mascota y las cifras la pinta el propio
     componente (`conCabecera`): así la pestaña de /dashboard/formularios, que
     comparte la lista, no la duplica. -->
<div class="dir-pagina">
	<MisFormularios base="/dashboard/mis-formularios" sincronizarUrl conCabecera />
</div>
