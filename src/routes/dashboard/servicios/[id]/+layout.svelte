<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { socketStore, socketManager } from '$lib/socket';
	import { fade } from 'svelte/transition';

	onMount(() => {
		// Inicializar auth store
		authStore.init();

		// Conectar socket si no está conectado
		if (!$socketStore.connected) {
			socketManager.connect();
		}
	});
</script>

<!--
	Layout del detalle de servicio (sistema landing cotransmeq).
	Wrapper editorial cálido sobre base off-white. El header sticky
	y el chrome del mapa los renderiza la propia +page.svelte.
-->
<div
	class="servicio-layout flex h-full w-full flex-col"
	style="background-color: var(--bg-base, #fcfcfb); color: var(--text-primary, #0f172a);"
	in:fade={{ duration: 400 }}
>
	<slot />
</div>
