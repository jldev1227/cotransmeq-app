<script lang="ts">
	import { page } from '$app/state';
	import PerfilEntidad from '$lib/components/directorio/PerfilEntidad.svelte';
	const entidadId = $derived(page.params.id ?? '');
</script>

<PerfilEntidad tipo="vehiculo" {entidadId} />
