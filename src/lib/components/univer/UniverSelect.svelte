<script lang="ts" module>
	export type UniverSelectValue = string | number;

	export interface UniverSelectOption {
		value: UniverSelectValue;
		label: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	interface Props {
		value: UniverSelectValue;
		options: UniverSelectOption[];
		onchange: (value: UniverSelectValue) => void | Promise<void>;
		ariaLabel: string;
		title?: string;
		placeholder?: string;
		disabled?: boolean;
		class?: string;
	}

	let {
		value,
		options,
		onchange,
		ariaLabel,
		title,
		placeholder = 'Seleccionar',
		disabled = false,
		class: className = ''
	}: Props = $props();

	let abierto = $state(false);
	let cursor = $state(0);
	let trigger = $state<HTMLButtonElement | null>(null);

	const indiceSeleccionado = $derived(options.findIndex((o) => String(o.value) === String(value)));
	const seleccionada = $derived(indiceSeleccionado >= 0 ? options[indiceSeleccionado] : null);

	function indiceDisponible(desde: number, direccion: 1 | -1): number {
		if (!options.length) return -1;
		let indice = desde;
		for (let intento = 0; intento < options.length; intento += 1) {
			indice = (indice + direccion + options.length) % options.length;
			if (!options[indice]?.disabled) return indice;
		}
		return -1;
	}

	function abrir() {
		if (disabled) return;
		abierto = true;
		cursor =
			indiceSeleccionado >= 0 && !options[indiceSeleccionado]?.disabled
				? indiceSeleccionado
				: indiceDisponible(-1, 1);
	}

	function cerrar(devolverFoco = false) {
		abierto = false;
		if (devolverFoco) queueMicrotask(() => trigger?.focus());
	}

	function elegir(opcion: UniverSelectOption) {
		if (opcion.disabled) return;
		cerrar(true);
		void onchange(opcion.value);
	}

	function teclas(e: KeyboardEvent) {
		if (disabled) return;
		if (!abierto && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
			e.preventDefault();
			abrir();
			return;
		}
		if (!abierto) return;

		if (e.key === 'Escape' || e.key === 'Tab') {
			cerrar(e.key === 'Escape');
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const siguiente = indiceDisponible(cursor, e.key === 'ArrowDown' ? 1 : -1);
			if (siguiente >= 0) cursor = siguiente;
			return;
		}
		if (e.key === 'Home' || e.key === 'End') {
			e.preventDefault();
			cursor = indiceDisponible(e.key === 'Home' ? -1 : 0, e.key === 'Home' ? 1 : -1);
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			const opcion = options[cursor];
			if (opcion) elegir(opcion);
		}
	}
</script>

<div class="univer-select {className}" class:univer-select--open={abierto}>
	<button
		bind:this={trigger}
		type="button"
		class="univer-select__trigger"
		{disabled}
		aria-label={ariaLabel}
		aria-haspopup="listbox"
		aria-expanded={abierto}
		{title}
		onclick={() => (abierto ? cerrar() : abrir())}
		onkeydown={teclas}
	>
		<span class:univer-select__placeholder={!seleccionada}
			>{seleccionada?.label ?? placeholder}</span
		>
		<svg viewBox="0 0 20 20" aria-hidden="true">
			<path d="m5.5 7.5 4.5 4 4.5-4" />
		</svg>
	</button>

	{#if abierto}
		<div class="univer-select__outside" role="presentation" onclick={() => cerrar()}></div>
		<div class="univer-select__menu" role="listbox" aria-label={ariaLabel}>
			{#each options as opcion, i (`${opcion.value}-${i}`)}
				<button
					type="button"
					role="option"
					aria-selected={String(opcion.value) === String(value)}
					class="univer-select__option"
					class:univer-select__option--cursor={i === cursor}
					disabled={opcion.disabled}
					onmouseenter={() => {
						if (!opcion.disabled) cursor = i;
					}}
					onclick={() => elegir(opcion)}
				>
					<span>{opcion.label}</span>
					{#if String(opcion.value) === String(value)}
						<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.5 3.5 7.5-8" /></svg>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.univer-select {
		position: relative;
		display: inline-flex;
		min-width: 0;
		font: inherit;
	}

	.univer-select--open {
		z-index: 62;
	}

	.univer-select__trigger {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.55rem;
		min-width: 5.25rem;
		min-height: 34px;
		padding: 0.35rem 0.55rem 0.35rem 0.7rem;
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.1);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
		color: #fff;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.univer-select__trigger:hover:not(:disabled),
	.univer-select--open .univer-select__trigger {
		background: rgba(255, 255, 255, 0.17);
		border-color: rgba(255, 255, 255, 0.36);
	}

	.univer-select__trigger:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.92);
		outline-offset: 2px;
	}

	.univer-select__trigger:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}

	.univer-select__trigger > svg {
		width: 14px;
		height: 14px;
		flex: 0 0 auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.72;
		transition: transform 0.15s;
	}

	.univer-select--open .univer-select__trigger > svg {
		transform: rotate(180deg);
	}

	.univer-select__placeholder {
		color: rgba(255, 255, 255, 0.72);
	}

	.univer-select__outside {
		position: fixed;
		inset: 0;
		z-index: 60;
	}

	.univer-select__menu {
		position: absolute;
		top: calc(100% + 7px);
		right: 0;
		z-index: 61;
		width: max-content;
		min-width: max(100%, 11rem);
		max-width: min(19rem, calc(100vw - 24px));
		max-height: min(22rem, calc(100vh - 96px));
		overflow-y: auto;
		padding: 5px;
		border: 1px solid #dbe4e1;
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 16px 42px rgba(0, 29, 23, 0.3);
		color: #17342d;
	}

	.univer-select__option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		min-height: 34px;
		padding: 0.45rem 0.65rem;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.79rem;
		font-weight: 650;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}

	.univer-select__option--cursor {
		background: #edf7f3;
		color: #075f48;
	}

	.univer-select__option[aria-selected='true'] {
		background: #e3f4ed;
		color: #075f48;
		font-weight: 800;
	}

	.univer-select__option:disabled {
		opacity: 0.42;
		cursor: not-allowed;
	}

	.univer-select__option svg {
		width: 14px;
		height: 14px;
		flex: 0 0 auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (prefers-reduced-motion: reduce) {
		.univer-select__trigger,
		.univer-select__trigger > svg {
			transition: none;
		}
	}
</style>
