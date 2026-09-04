<script lang="ts">
	/**
	 * Campo de búsqueda con retardo.
	 *
	 * Existe porque el retardo estaba escrito a mano en unos veinticinco sitios
	 * con siete valores distintos —150, 200, 250, 300, 350, 400 y 500 ms—, de
	 * modo que la misma acción respondía distinto según la página. Y había un
	 * `utils/debounce.ts` completo, con `cancel()` y `flush()`, que no importaba
	 * NADIE.
	 *
	 * El valor unificado es 300 ms: por debajo se lanzan peticiones a medio
	 * escribir, y por encima se nota el retraso al terminar de teclear.
	 */
	import { onDestroy, untrack } from 'svelte';
	import { debounce } from '$lib/utils/debounce';

	interface Props {
		/** Valor actual. Lo controla quien usa el componente. */
		valor: string;
		/** Se llama con el término ya reposado. */
		onBuscar: (termino: string) => void;
		placeholder?: string;
		/** Milisegundos de espera. Cámbialo solo con un motivo. */
		retardo?: number;
		/** Deshabilita el campo mientras se carga, si así se quiere. */
		deshabilitado?: boolean;
		etiqueta?: string;
	}

	let {
		valor = $bindable(),
		onBuscar,
		placeholder = 'Buscar…',
		retardo = 300,
		deshabilitado = false,
		etiqueta = 'Buscar en la lista'
	}: Props = $props();

	/// El retardo se fija al montar y no se sigue después: `untrack` lo deja
	/// explícito y evita el aviso de Svelte sobre capturar solo el valor
	/// inicial. Cambiar el retardo de un buscador ya montado no tiene sentido.
	const buscarConRetardo = debounce(
		(termino: string) => onBuscar(termino),
		untrack(() => retardo)
	);

	function alEscribir(evento: Event) {
		valor = (evento.target as HTMLInputElement).value;
		buscarConRetardo(valor);
	}

	function alEnviar(evento: KeyboardEvent) {
		if (evento.key !== 'Enter') return;
		// Quien pulsa Enter ya terminó de escribir: no tiene sentido hacerle
		// esperar el retardo.
		buscarConRetardo.cancel();
		onBuscar(valor);
	}

	function limpiar() {
		valor = '';
		buscarConRetardo.cancel();
		onBuscar('');
	}

	/// Sin esto, salir de la página con una búsqueda a medio reposar dispara la
	/// petición sobre un componente ya desmontado.
	onDestroy(() => buscarConRetardo.cancel());
</script>

<div class="buscador">
	<svg
		class="icono"
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		aria-hidden="true"
	>
		<circle cx="11" cy="11" r="8" />
		<path d="m21 21-4.35-4.35" />
	</svg>

	<input
		type="search"
		value={valor}
		{placeholder}
		disabled={deshabilitado}
		aria-label={etiqueta}
		oninput={alEscribir}
		onkeydown={alEnviar}
	/>

	{#if valor}
		<button type="button" class="limpiar" onclick={limpiar} aria-label="Limpiar búsqueda">
			×
		</button>
	{/if}
</div>

<style>
	.buscador {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}

	.icono {
		position: absolute;
		left: 0.75rem;
		color: var(--text-muted);
		pointer-events: none;
	}

	input {
		width: 100%;
		padding: 0.5rem 2rem 0.5rem 2.25rem;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 0.875rem;
		transition: border-color 0.2s ease;
	}

	input:focus {
		outline: none;
		border-color: var(--accent, var(--emerald-500));
	}

	input:disabled {
		opacity: 0.6;
	}

	/* La X nativa del type="search" descuadra el nuestro. */
	input::-webkit-search-cancel-button {
		display: none;
	}

	.limpiar {
		position: absolute;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--text-muted);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}

	.limpiar:hover {
		background: rgba(0, 0, 0, 0.06);
		color: var(--text-primary);
	}
</style>
