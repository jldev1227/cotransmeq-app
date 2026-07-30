<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { socketStore, socketManager } from '$lib/socket';

	onMount(() => {
		// Inicializar auth store
		authStore.init();

		// Conectar socket si no está conectado
		if (!$socketStore.connected) {
			socketManager.connect();
		}

		// Comentado: No ocultar overflow del body para permitir scroll
		// document.body.style.overflow = 'hidden';
	});

	onDestroy(() => {
		// Ya no es necesario restaurar overflow del body
		// document.body.style.overflow = '';
	});
</script>

<!-- Sin layout, solo el contenido de la página -->
<slot />
