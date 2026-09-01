<!--
	UniverAuthGuard — sustituye al guard de `dashboard/+layout.svelte`
	para las pages que se montan vía `+layout@.svelte` (layout reset).

	Razón de existir: al usar `+layout@.svelte` la page ya NO hereda el
	guard del dashboard layout (authStore.init, checkAccess por módulo,
	intervalo de expiración de token, modal de sesión cerrada). Este
	componente replica el guard justo para que las pages Univer sigan
	protegidas.

	IMPORTANTE: gatea los hijos con `{#if ready}` porque en Svelte el
	`onMount` del hijo corre antes que el del padre. Sin ese gate,
	$authStore.user sería null cuando la page intente leerlo en su
	propio onMount y el socket de collab no podría joinRoom.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { authStore } from '$lib/stores/auth';
	import { socketStore, socketManager } from '$lib/socket';
	import { checkAccess } from '$lib/config/permissions';
	import { isTokenExpired, getTimeUntilExpiration } from '$lib/utils/jwt';
	import { toast } from 'svelte-sonner';

	interface Props {
		moduleId: string;
		redirectTo?: string;
		children?: import('svelte').Snippet;
	}

	let { moduleId, redirectTo = '/dashboard/servicios', children }: Props = $props();

	let mounted = $state(false);
	let ready = $state(false);
	let tokenCheckInterval: ReturnType<typeof setInterval> | null = null;

	let user = $derived($authStore.user);
	let token = $derived($authStore.token);

	// Permiso reactivo: si cambia la ruta o el user, revalidar
	$effect(() => {
		if (mounted && user) {
			const { allowed } = checkAccess(user.role || user.rol, user.area, moduleId);
			if (!allowed) {
				toast.error('No tienes permiso para acceder a esta sección');
				goto(redirectTo);
			}
		}
	});

	function checkTokenExpiration() {
		if (!token) return;
		const expired = isTokenExpired(token);
		if (expired) {
			toast.error('Tu sesión ha expirado. Por favor, inicia sesión nuevamente.');
			authStore.logout();
			return;
		}
		const timeRemaining = getTimeUntilExpiration(token);
		const minutesRemaining = Math.floor(timeRemaining / 1000 / 60);
		if (minutesRemaining <= 5 && minutesRemaining > 0) {
			toast.warning(`Tu sesión expirará en ${minutesRemaining} minutos. Guarda tu trabajo.`);
		}
	}

	onMount(async () => {
		if (!browser) return;
		await authStore.init();
		mounted = true;
		checkTokenExpiration();
		tokenCheckInterval = setInterval(checkTokenExpiration, 60000);
		// Listo: el padre tiene el store hidratado, los hijos ya pueden leerlo
		ready = true;
	});

	onDestroy(() => {
		if (tokenCheckInterval) clearInterval(tokenCheckInterval);
	});
</script>

{#if ready && user}
	{@render children?.()}
{:else}
	<div class="univer-guard-loading">
		<div class="univer-guard-logo">
			<img src="/android-chrome-192x192.png" alt="Cotransmeq" width="64" height="64" />
		</div>
		<h1>Cotransmeq</h1>
		<p>{ready ? 'Verificando permisos…' : 'Cargando sesión…'}</p>
	</div>
{/if}

<style>
	.univer-guard-loading {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: #f8fafc;
		color: #0f172a;
	}
	.univer-guard-logo {
		width: 64px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 16px;
		box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
	}
	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 600;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #64748b;
	}
</style>