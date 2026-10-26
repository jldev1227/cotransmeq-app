<script lang="ts">
	import UniverAuthGuard from '$lib/components/univer/UniverAuthGuard.svelte';
	let { children } = $props();
</script>

<UniverAuthGuard moduleId="rastreo-servicios" redirectTo="/dashboard">
	{@render children()}
</UniverAuthGuard>
