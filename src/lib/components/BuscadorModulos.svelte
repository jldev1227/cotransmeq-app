<script lang="ts">
	/**
	 * «Ir a…»: buscador de módulos en la cabecera.
	 *
	 * En la barra queda solo el disparador, con aspecto de campo; al pulsarlo
	 * (o con ⌘K / Ctrl K) se abre una paleta en el centro de la pantalla con
	 * el campo y la lista. Escribe dos letras y salta al módulo. Lista los
	 * mismos módulos que el menú lateral y con los mismos permisos, porque los
	 * dos leen `MENU_ITEMS`.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import { MENU_ITEMS, type MenuItem } from '$lib/config/menu';
	import { Search, CornerDownLeft } from 'lucide-svelte';

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
		return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	}

	const resultados = $derived.by(() => {
		const q = normalizar(texto.trim());
		if (!q) return permitidos;
		return permitidos.filter((m) => normalizar(m.label).includes(q));
	});

	const actual = $derived(
		permitidos.find((m) => $page.url.pathname.startsWith(m.href))?.id ?? null
	);

	function abrir() {
		texto = '';
		indice = 0;
		abierto = true;
	}

	function cerrar() {
		abierto = false;
	}

	function ir(m: MenuItem) {
		cerrar();
		goto(m.href);
	}

	function teclas(e: KeyboardEvent) {
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
			e.preventDefault();
			cerrar();
		}
	}

	function atajo(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			if (abierto) cerrar();
			else abrir();
		}
	}

	$effect(() => {
		void resultados;
		indice = 0;
	});

	$effect(() => {
		if (abierto) campo?.focus();
	});
</script>

<svelte:window onkeydown={atajo} />

<button type="button" class="ir-a" onclick={abrir} aria-haspopup="dialog" aria-expanded={abierto}>
	<Search size={16} strokeWidth={1.8} class="ir-a-lupa" aria-hidden="true" />
	<span class="ir-a-texto">Ir a un módulo…</span>
	<kbd class="ir-a-atajo" aria-hidden="true">{esMac ? '⌘' : 'Ctrl'} K</kbd>
</button>

{#if abierto}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ir-a-fondo fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && cerrar()}
		onkeydown={(e) => e.key === 'Escape' && cerrar()}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="ir-a-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Ir a un módulo"
			in:fly={{ y: -14, duration: 220 }}
			out:fade={{ duration: 120 }}
		>
			<div class="ir-a-campo-fila">
				<Search size={18} strokeWidth={1.8} aria-hidden="true" />
				<input
					bind:this={campo}
					bind:value={texto}
					type="text"
					class="ir-a-campo"
					placeholder="Escribe el nombre de un módulo…"
					aria-label="Buscar módulo"
					autocomplete="off"
					spellcheck="false"
					onkeydown={teclas}
				/>
				<kbd class="ir-a-atajo" aria-hidden="true">Esc</kbd>
			</div>

			{#if resultados.length}
				<ul class="ir-a-lista" role="listbox">
					{#each resultados as m, i (m.id)}
						<li>
							<button
								type="button"
								class="ir-a-item"
								class:ir-a-item--activo={i === indice}
								role="option"
								aria-selected={i === indice}
								onmouseenter={() => (indice = i)}
								onclick={() => ir(m)}
							>
								<span class="ir-a-icono"><m.icon size={17} strokeWidth={1.8} /></span>
								<span class="ir-a-etiqueta">{m.label}</span>
								{#if m.id === actual}<small>Aquí</small>{/if}
								{#if i === indice}<CornerDownLeft size={14} strokeWidth={2} class="ir-a-enter" />{/if}
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="ir-a-vacio">Ningún módulo se llama así.</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ── Disparador en la barra ── */
	.ir-a {
		display: flex;
		align-items: center;
		width: 100%;
		max-width: 26rem;
		height: 40px;
		padding: 0 0.75rem 0 0.85rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1.5px solid transparent;
		border-radius: 12px;
		color: rgba(255, 255, 255, 0.6);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.ir-a:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.18);
	}
	.ir-a :global(.ir-a-lupa) {
		flex-shrink: 0;
	}
	.ir-a-texto {
		flex: 1;
		min-width: 0;
		margin: 0 0.6rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.55);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ir-a .ir-a-atajo {
		border-color: rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.6);
	}
	.ir-a-atajo {
		flex-shrink: 0;
		padding: 0.15rem 0.45rem;
		border-radius: 6px;
		border: 1px solid var(--border-default);
		background: var(--bg-base);
		font-family: inherit;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--text-very-muted);
		letter-spacing: 0.04em;
	}

	/* ── Paleta ── */
	.ir-a-modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 34rem;
		max-height: min(70vh, 34rem);
		overflow: hidden;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 18px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
	}
	.ir-a-campo-fila {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-muted);
	}
	.ir-a-campo {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 500;
		color: var(--text-primary);
	}
	.ir-a-campo:focus {
		outline: none;
	}
	.ir-a-campo::placeholder {
		color: var(--text-very-muted);
	}
	.ir-a-lista {
		flex: 1;
		margin: 0;
		padding: 0.4rem;
		list-style: none;
		overflow-y: auto;
	}
	.ir-a-vacio {
		padding: 1.25rem 1rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.ir-a-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: none;
		border-radius: 12px;
		background: transparent;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
	}
	.ir-a-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: 10px;
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.ir-a-etiqueta {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ir-a-item--activo {
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
	}
	.ir-a-item--activo .ir-a-icono {
		background: rgba(255, 255, 255, 0.7);
		color: var(--emerald-800);
	}
	.ir-a-item small {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-very-muted);
	}
	.ir-a-item :global(.ir-a-enter) {
		flex-shrink: 0;
		color: var(--emerald-800);
		opacity: 0.7;
	}
</style>
