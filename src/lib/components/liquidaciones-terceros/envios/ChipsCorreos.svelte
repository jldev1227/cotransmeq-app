<script lang="ts">
	/**
	 * Casilla de destinatarios estilo Gmail.
	 *
	 * Las direcciones ya confirmadas viven en `value` (separadas por coma) y se
	 * pintan como chips con su "×"; lo que se está escribiendo sigue siendo
	 * texto suelto en `borrador`. Quien consume el componente arma el
	 * destinatario efectivo con las dos cosas, así el envío funciona aunque el
	 * usuario no haya confirmado lo último que escribió.
	 *
	 * Con UNA sola dirección no se hace chip: el caso corriente aquí es
	 * corregir el correo del tercero, y un chip obligaría a borrarlo para
	 * poder editarlo. El primer chip aparece al escribir la coma que separa
	 * la segunda dirección.
	 */
	interface Props {
		/** Direcciones confirmadas, separadas por coma. */
		value: string;
		/** Texto en curso, todavía sin confirmar. */
		borrador: string;
		placeholder?: string;
		/** Validador de UNA dirección; lo pone el padre para no duplicar el regex. */
		esValido: (correo: string) => boolean;
		/** Marca toda la casilla en rojo (lo decide el padre con su regla). */
		invalido?: boolean;
	}

	let {
		value = $bindable(''),
		borrador = $bindable(''),
		placeholder = '',
		esValido,
		invalido = false
	}: Props = $props();

	const chips = $derived(
		value
			.split(',')
			.map((c) => c.trim())
			.filter(Boolean)
	);

	let campo = $state<HTMLInputElement | null>(null);

	/** Vuelca una lista a `value` sin vacíos ni repetidos. */
	function escribir(lista: string[]) {
		const vistos = new Set<string>();
		value = lista
			.map((c) => c.trim())
			.filter((c) => {
				if (!c) return false;
				const k = c.toLowerCase();
				if (vistos.has(k)) return false;
				vistos.add(k);
				return true;
			})
			.join(', ');
	}

	/** Pasa a chips lo escrito. Admite pegar varias de una vez. */
	function confirmar(texto: string = borrador) {
		const nuevos = texto
			.split(/[,;\s]+/)
			.map((c) => c.trim())
			.filter(Boolean);
		if (nuevos.length === 0) return;
		escribir([...chips, ...nuevos]);
		borrador = '';
	}

	function quitar(i: number) {
		escribir(chips.filter((_, j) => j !== i));
		campo?.focus();
	}

	/** Devuelve el chip al campo para corregirlo, sin perder lo ya escrito. */
	function editar(i: number) {
		const objetivo = chips[i];
		const resto = chips.filter((_, j) => j !== i);
		const pendiente = borrador.trim();
		escribir(pendiente ? [...resto, pendiente] : resto);
		borrador = objetivo;
		campo?.focus();
	}

	function tecla(e: KeyboardEvent) {
		if (e.key === ',' || e.key === ';' || e.key === 'Enter') {
			e.preventDefault();
			confirmar();
			return;
		}
		// Borrar con el campo vacío recupera el último chip en vez de tirarlo:
		// casi siempre se retrocede para arreglar una letra.
		if (e.key === 'Backspace' && borrador === '' && chips.length > 0) {
			e.preventDefault();
			editar(chips.length - 1);
		}
	}

	function pegar(e: ClipboardEvent) {
		const texto = e.clipboardData?.getData('text') ?? '';
		// Una sola dirección se pega como texto normal; solo se trocea lo que
		// viene de una lista ("a@x.com, b@y.com" de otro correo o de Excel).
		if (!/[,;\s]/.test(texto.trim())) return;
		e.preventDefault();
		confirmar(`${borrador} ${texto}`);
	}
</script>

<!-- `label` y no `div`: el clic en cualquier hueco de la caja lleva el foco al
     campo sin necesidad de un manejador propio. -->
<label class="chips" class:invalido>
	{#each chips as c, i (`${c}-${i}`)}
		<span class="chip" class:mal={!esValido(c)}>
			<button
				type="button"
				class="chip-txt"
				title={esValido(c) ? `${c} — clic para editar` : `${c} — no es un correo válido`}
				onclick={() => editar(i)}
			>
				{c}
			</button>
			<button type="button" class="chip-x" aria-label={`Quitar ${c}`} onclick={() => quitar(i)}>
				×
			</button>
		</span>
	{/each}
	<input
		bind:this={campo}
		bind:value={borrador}
		type="text"
		autocomplete="off"
		spellcheck="false"
		placeholder={chips.length > 0 ? 'añadir otro…' : placeholder}
		onkeydown={tecla}
		onpaste={pegar}
		onblur={() => {
			if (chips.length > 0) confirmar();
		}}
	/>
</label>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		min-width: 0;
		padding: 3px 6px;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		background: #fff;
		cursor: text;
	}
	.chips:focus-within {
		border-color: #ea580c;
		box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.15);
	}
	.chips.invalido {
		border-color: #fca5a5;
		background: #fef2f2;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		background: #e2e8f0;
		color: #0f172a;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
	}
	.chip.mal {
		background: #fee2e2;
		color: #b91c1c;
	}

	.chip-txt {
		max-width: 190px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 4px 2px 4px 9px;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.chip-x {
		padding: 4px 8px 4px 4px;
		border: 0;
		background: none;
		color: inherit;
		font-size: 13px;
		line-height: 1;
		opacity: 0.55;
		cursor: pointer;
	}
	.chip-x:hover {
		opacity: 1;
	}

	input {
		flex: 1;
		min-width: 110px;
		padding: 3px 2px;
		border: 0;
		outline: none;
		background: none;
		font-size: 12px;
		color: #0f172a;
	}
	input::placeholder {
		color: #94a3b8;
	}
</style>
