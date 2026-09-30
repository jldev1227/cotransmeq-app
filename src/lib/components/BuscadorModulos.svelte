<script lang="ts">
	/**
	 * «Ir a…»: buscador de módulos en la cabecera.
	 *
	 * Ocupa la franja que quedaba vacía entre el título de la sección y el
	 * usuario. Escribe dos letras y salta al módulo; se abre también con ⌘K
	 * (Ctrl K en Windows). Lista los mismos módulos que el menú lateral y con
	 * los mismos permisos, porque los dos leen `MENU_ITEMS`.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import { MENU_ITEMS, type MenuItem } from '$lib/config/menu';
	import { Search } from 'lucide-svelte';

	let texto = $state('');
	let abierto = $state(false);
	let indice = $state(0);
	let campo = $state<HTMLInputElement | null>(null);

	const esMac =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

	const usuario = $derived($authStore.user);

	/** Módulos a los que este usuario puede entrar. */
	const permitidos = $derived(
		usuario
			? MENU_ITEMS.filter(
					(m) =>
						checkAccess(usuario.role || usuario.rol, usuario.area, m.id, usuario.permisos_rutas)
							.allowed
				)
			: []
	);

	function normalizar(s: string) {
		return s
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase();
	}

	const resultados = $derived.by(() => {
		const q = normalizar(texto.trim());
		if (!q) return permitidos.slice(0, 8);
		return permitidos.filter((m) => normalizar(m.label).includes(q)).slice(0, 8);
	});

	const actual = $derived(
		permitidos.find((m) => $page.url.pathname.startsWith(m.href))?.id ?? null
	);

	function ir(m: MenuItem) {
		abierto = false;
		texto = '';
		campo?.blur();
		goto(m.href);
	}

	function teclas(e: KeyboardEvent) {
		if (!abierto) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			indice = Math.min(indice + 1, resultados.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			indice = Math.max(indice - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const m = resultados[indice];
			if (m) ir(m);
		} else if (e.key === 'Escape') {
			abierto = false;
			campo?.blur();
		}
	}

	function atajo(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			campo?.focus();
			abierto = true;
		}
	}

	$effect(() => {
		void resultados;
		indice = 0;
	});
</script>

<svelte:window onkeydown={atajo} />

<div class="ir-a" class:ir-a--abierto={abierto}>
	<Search size={16} strokeWidth={1.8} class="ir-a-lupa" aria-hidden="true" />
	<input
		bind:this={campo}
		bind:value={texto}
		type="text"
		class="ir-a-campo"
		placeholder="Ir a un módulo…"
		aria-label="Ir a un módulo"
		autocomplete="off"
		spellcheck="false"
		onfocus={() => (abierto = true)}
		onblur={() => setTimeout(() => (abierto = false), 120)}
		onkeydown={teclas}
	/>
	<kbd class="ir-a-atajo" aria-hidden="true">{esMac ? '⌘' : 'Ctrl'} K</kbd>

	{#if abierto && resultados.length}
		<ul class="ir-a-lista" role="listbox">
			{#each resultados as m, i (m.id)}
				<li>
					<button
						type="button"
						class="ir-a-item"
						class:ir-a-item--activo={i === indice}
						class:ir-a-item--actual={m.id === actual}
						role="option"
						aria-selected={i === indice}
						onmousedown={(e) => e.preventDefault()}
						onmouseenter={() => (indice = i)}
						onclick={() => ir(m)}
					>
						<m.icon size={16} strokeWidth={1.8} />
						<span>{m.label}</span>
						{#if m.id === actual}<small>Aquí</small>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if abierto && texto.trim()}
		<div class="ir-a-lista ir-a-vacio">Ningún módulo se llama así.</div>
	{/if}
</div>

<style>
	.ir-a {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		max-width: 26rem;
		height: 40px;
		padding: 0 0.75rem 0 0.85rem;
		background: var(--bg-base);
		border: 1.5px solid transparent;
		border-radius: 12px;
		color: var(--text-muted);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.ir-a:hover {
		border-color: var(--border-default);
	}
	.ir-a--abierto {
		background: var(--bg-surface);
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb), 0.12);
	}
	.ir-a :global(.ir-a-lupa) {
		flex-shrink: 0;
	}
	.ir-a-campo {
		flex: 1;
		min-width: 0;
		height: 100%;
		margin: 0 0.6rem;
		padding: 0;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.ir-a-campo:focus {
		outline: none;
	}
	.ir-a-campo::placeholder {
		color: var(--text-very-muted);
	}
	.ir-a-atajo {
		flex-shrink: 0;
		padding: 0.15rem 0.45rem;
		border-radius: 6px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--text-very-muted);
		letter-spacing: 0.04em;
	}

	.ir-a-lista {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 6px);
		z-index: 60;
		margin: 0;
		padding: 0.35rem;
		list-style: none;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 14px;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12);
	}
	.ir-a-vacio {
		padding: 0.85rem 1rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.ir-a-item {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.55rem 0.7rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
	}
	.ir-a-item :global(svg) {
		color: var(--text-muted);
		flex-shrink: 0;
	}
	.ir-a-item--activo {
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
	}
	.ir-a-item--activo :global(svg) {
		color: var(--emerald-800);
	}
	.ir-a-item small {
		margin-left: auto;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-very-muted);
	}
</style>
