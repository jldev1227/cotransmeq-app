<script lang="ts">
	import { page } from '$app/stores';
	import LiquidacionEditor from '$lib/components/LiquidacionEditor.svelte';

	$: editId = $page.params.id;
	$: viewMode = $page.url.searchParams.get('mode') === 'view';
</script>

<LiquidacionEditor {editId} {viewMode} />
