<script lang="ts">
	import UniverAuthGuard from '$lib/components/univer/UniverAuthGuard.svelte';
	let { children } = $props();
</script>

<UniverAuthGuard moduleId="rastreo_servicios" redirectTo="/dashboard">
	{@render children()}
</UniverAuthGuard>
