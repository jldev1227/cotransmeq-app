<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	const estado = $derived($page.status);
	const esNoEncontrada = $derived(estado === 404);
	const rutaPedida = $derived($page.url.pathname);

	/**
	 * `+error.svelte` es el catch-all de SvelteKit: atiende el 404 y también
	 * cualquier error lanzado en un `load`. El 404 tiene copy propio porque es
	 * el único caso en que la culpa no es del sistema.
	 */
	const titulo = $derived(esNoEncontrada ? 'Esta página no existe' : 'Algo salió mal');

	const detalle = $derived(
		esNoEncontrada
			? 'La dirección que abriste no corresponde a ninguna pantalla del sistema. Puede que el enlace esté viejo o que la sección se haya movido.'
			: ($page.error?.message ??
					'El sistema no pudo completar la operación. Vuelve a intentarlo en unos segundos.')
	);

	/** `history.length > 1` evita ofrecer un «atrás» que no lleva a ningún lado. */
	let puedeVolver = $state(false);
	onMount(() => {
		puedeVolver = history.length > 1;
	});
</script>

<svelte:head>
	<title>{esNoEncontrada ? 'Página no encontrada' : 'Error'} · Cotransmeq</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
	<!-- Los mismos orbes difuminados del login: atan esta pantalla al resto. -->
	<div class="pointer-events-none absolute inset-0" aria-hidden="true">
		<div class="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-emerald-400/20 blur-3xl"></div>
		<div
			class="absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-emerald-600/10 blur-3xl"
		></div>
	</div>

	<div
		class="relative w-full max-w-lg text-center"
		in:fly={{ y: 20, duration: 500, easing: quintOut }}
	>
		<span
			class="inline-block rounded-md bg-emerald-500/10 px-3 py-1 font-mono text-[0.7rem] font-bold tracking-[0.12em] text-emerald-600 uppercase"
		>
			Error {estado}
		</span>

		<p
			class="mt-6 font-display text-8xl leading-none font-light tracking-tight text-emerald-600 tabular-nums sm:text-9xl"
			aria-hidden="true"
		>
			{estado}
		</p>

		<h1
			class="mt-6 font-display text-3xl leading-tight font-normal tracking-tight text-slate-900 sm:text-4xl"
		>
			{titulo}
		</h1>

		<p class="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-500">
			{detalle}
		</p>

		{#if esNoEncontrada}
			<p
				class="mx-auto mt-5 inline-block max-w-full rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 font-mono text-xs break-all text-slate-500"
				in:fade={{ duration: 300, delay: 150 }}
			>
				{rutaPedida}
			</p>
		{/if}

		<div class="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
			<!--
				El destino es `/` y no una ruta calculada aquí: `routes/+page.svelte`
				ya resuelve las tres ramas —sesión administrativa al panel,
				dispositivo marcado a SU portal, y el resto al login— y es la única
				copia de esa decisión. Repetirla en el 404 significaría mantener dos,
				y la de aquí llegaría con la respuesta equivocada: el `authStore` se
				hidrata de forma asíncrona, así que en el primer pintado todavía no
				sabe si hay sesión.
			-->
			<a
				href="/"
				class="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
			>
				Ir al inicio
			</a>

			{#if puedeVolver}
				<button
					type="button"
					onclick={() => history.back()}
					class="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto"
				>
					Volver atrás
				</button>
			{/if}
		</div>
	</div>
</div>
