<script lang="ts">
	/**
	 * PUENTE DEL CORREO A LA APP MÓVIL.
	 *
	 * El enlace de acceso que pide la app llegaba como `cotransmeq://portal?token=…`,
	 * y Gmail le quita el destino a todo enlace que no sea http(s): el botón del
	 * correo no hacía nada. Ahora el correo trae este https, y esta página abre
	 * la app instalada con el mismo deep link de siempre —la app publicada no
	 * cambia—. En Android va por `intent://`, que si la app no está cae solo en
	 * el portal web; en iOS se intenta el esquema y quedan los botones.
	 */
	import { onMount } from 'svelte';

	const APP = {
		nombre: 'Cotransmeq',
		esquema: 'cotransmeq',
		paquete: 'com.cotransmeq.conductores',
		logo: '/assets/logo_nombre.webp'
	};

	let sinToken = false;
	let enlaceApp = '';
	let enlaceWeb = '';
	let esUsuario = false;

	onMount(() => {
		const url = new URL(window.location.href);
		/// Enlace de un usuario administrativo (generado en su perfil): no tiene portal web al que
		/// caer, así que en Android el intent sin `browser_fallback_url` lleva a la tienda si la app
		/// no está instalada.
		if (url.searchParams.get('tipo') === 'usuario') {
			const codigo = url.searchParams.get('codigo') ?? '';
			if (!codigo) {
				sinToken = true;
				return;
			}
			window.history.replaceState(null, '', url.pathname);
			const c = encodeURIComponent(codigo);
			esUsuario = true;
			enlaceApp = /android/i.test(navigator.userAgent)
				? `intent://admin?codigo=${c}#Intent;scheme=${APP.esquema};package=${APP.paquete};end`
				: `${APP.esquema}://admin?codigo=${c}`;
			window.location.href = enlaceApp;
			return;
		}

		const token = url.searchParams.get('token') ?? '';
		if (!token) {
			sinToken = true;
			return;
		}
		/// El token da acceso al portal: fuera de la barra y del historial.
		window.history.replaceState(null, '', url.pathname);

		const t = encodeURIComponent(token);
		enlaceWeb = `${window.location.origin}/public/portal?token=${t}`;
		enlaceApp = /android/i.test(navigator.userAgent)
			? `intent://portal?token=${t}#Intent;scheme=${APP.esquema};package=${APP.paquete};` +
				`S.browser_fallback_url=${encodeURIComponent(enlaceWeb)};end`
			: `${APP.esquema}://portal?token=${t}`;

		window.location.href = enlaceApp;
	});
</script>

<svelte:head>
	<title>Abrir la app · {APP.nombre}</title>
</svelte:head>

<main class="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
	<img src={APP.logo} alt={APP.nombre} class="h-12 w-auto" />

	{#if sinToken}
		<div class="space-y-2">
			<h1 class="text-lg font-semibold text-gray-900">Este enlace no está completo</h1>
			<p class="text-sm text-gray-600">Pide un enlace nuevo desde la app o entra al portal web.</p>
		</div>
		<a
			href="/public/portal"
			class="btn-primary w-full"
		>
			Ir al portal
		</a>
	{:else}
		<div class="space-y-2">
			<h1 class="text-lg font-semibold text-gray-900">Abriendo la app…</h1>
			<p class="text-sm text-gray-600">Si no se abre sola, tócala abajo.</p>
		</div>
		{#if enlaceApp}
			<div class="flex w-full flex-col gap-3">
				<a
					href={enlaceApp}
					class="btn-primary w-full"
				>
					Abrir la app
				</a>
				{#if esUsuario}
					<p class="text-xs text-gray-500">
						Necesitas la app de {APP.nombre} instalada en este teléfono.
					</p>
				{:else}
					<a
						href={enlaceWeb}
						class="btn-secondary w-full"
					>
						Seguir en el navegador
					</a>
				{/if}
			</div>
		{/if}
	{/if}
</main>
