<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import {
		PORTAL_LOGIN,
		entradaDirectaAlLogin,
		esDispositivoDelPortal
	} from '$lib/stores/portalStore';
	import AuthLoading from '$lib/components/auth/AuthLoading.svelte';

	let mounted = false;

	onMount(() => {
		// Inicializar el store de auth
		authStore.init();

		// Verificar autenticación y redirigir apropiadamente
		if (authStore.isAuthenticated()) {
			goto('/dashboard');
		} else if (esDispositivoDelPortal() && !entradaDirectaAlLogin()) {
			/// El acceso directo de la PWA cae aquí: un conductor no tiene por qué
			/// ver el login administrativo. Quien escribe el dominio, sí lo ve.
			goto(PORTAL_LOGIN);
		} else {
			goto('/login');
		}

		mounted = true;
	});
</script>

<svelte:head>
	<title>Cotransmeq - Sistema de Gestión</title>
	<meta name="description" content="Sistema de gestión para empresa de transporte Cotransmeq" />
</svelte:head>

{#if mounted}
	<AuthLoading texto="Redirigiendo…" />
{/if}
