<script lang="ts">
	/**
	 * Conceptos adicionales de la hoja abierta, desde el canvas.
	 *
	 * QUÉ SON: el cajón de lo pactado a mano —`BONO ADICIONAL - NO SALARIAL`,
	 * un pernocte de un mes anterior que se paga tarde, el `AJUSTE A NETO
	 * PACTADO`—. Suman al devengado y no entran al IBC.
	 *
	 * POR QUÉ UN MODAL Y NO UNA CELDA: el canvas puede cambiar el IMPORTE de
	 * un concepto que ya existe (su celda está bindeada), pero no puede darlo
	 * de ALTA: eso añade una fila al desprendible, y una hoja de cálculo no
	 * tiene dónde teclear «una fila más» sin inventarse una zona de captura.
	 * El alta y la baja viven aquí; el retoque del importe, en la celda.
	 *
	 * Es el mismo par de campos que el formulario de la liquidación
	 * (`LiquidacionFormComplete`): importe con signo y descripción. Se respeta
	 * el signo porque un concepto en NEGATIVO resta del devengado, que es como
	 * se cuadra un neto pactado a la baja.
	 *
	 * No guarda nada por su cuenta: llama a `onAgregar` / `onEliminar` y es la
	 * página quien lo manda por el socket con su compare-and-swap.
	 */
	import { X } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	interface Props {
		/** Conductor de la hoja abierta, para que se vea sobre quién se actúa. */
		nombreHoja: string;
		conceptos: { nombre: string; valor: number }[];
		/** Sin liquidación o en un estado que no admite edición. */
		bloqueada?: boolean;
		motivoBloqueo?: string;
		/** Hay un cambio en vuelo: se apagan los botones para no duplicarlo. */
		guardando?: boolean;
		onAgregar: (nombre: string, valor: number) => void;
		onEliminar: (nombre: string) => void;
		onClose: () => void;
	}

	let {
		nombreHoja,
		conceptos,
		bloqueada = false,
		motivoBloqueo = '',
		guardando = false,
		onAgregar,
		onEliminar,
		onClose
	}: Props = $props();

	let nuevoValor = $state('');
	let nuevoNombre = $state('');
	let error = $state('');

	const money = (v: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			maximumFractionDigits: 0
		}).format(v || 0);

	const total = $derived(conceptos.reduce((s, c) => s + (c.valor || 0), 0));

	/** Comparación laxa: es la misma con la que el servidor localiza el concepto. */
	const normalizar = (v: string) => v.trim().toLowerCase();

	function agregar() {
		error = '';
		const nombre = nuevoNombre.trim();
		if (!nombre) {
			error = 'Ponle una descripción: es el rótulo que verá el conductor en su desprendible.';
			return;
		}
		if (nombre.length > 200) {
			error = 'La descripción es demasiado larga.';
			return;
		}
		/**
		 * Un nombre repetido NO se deja pasar. El concepto se direcciona por
		 * nombre, así que dos iguales serían la misma celda: editar uno movería
		 * el otro y borrar uno dejaría al gemelo sin forma de tocarlo.
		 */
		if (conceptos.some((c) => normalizar(c.nombre) === normalizar(nombre))) {
			error = `Ya hay un concepto «${nombre}». Cambia su importe en la celda o bórralo antes.`;
			return;
		}

		/// Se admite la coma decimal y los puntos de millar que se teclean sin
		/// pensar: `1.200.000` es lo que la persona lee en la celda de al lado.
		const crudo = nuevoValor.trim().replace(/\s|\$/g, '').replace(/\./g, '').replace(',', '.');
		const valor = Number(crudo);
		if (!crudo || !Number.isFinite(valor)) {
			error = 'El importe tiene que ser un número.';
			return;
		}
		if (valor === 0) {
			error = 'El importe no puede ser cero.';
			return;
		}

		onAgregar(nombre, valor);
		nuevoValor = '';
		nuevoNombre = '';
	}
</script>

<ModalBase
	open={true}
	eyebrow={nombreHoja}
	title="Conceptos adicionales"
	subtitle="Van al desprendible debajo de AUXILIO DE TRANSPORTE. Suman al devengado y no cotizan."
	tamano="md"
	bloqueado={guardando}
	oncerrar={onClose}
>
	<div class="cuerpo">
		{#if bloqueada}
			<p class="bloqueo">{motivoBloqueo || 'Esta hoja no se puede editar.'}</p>
		{/if}

		<div class="tarjeta">
			{#if conceptos.length}
				<ul class="lista">
					{#each conceptos as c (c.nombre)}
						<li class="fila">
							<span class="importe" class:negativo={c.valor < 0}>{money(c.valor)}</span>
							<span class="nombre">{c.nombre}</span>
							<button
								type="button"
								class="quitar"
								onclick={() => onEliminar(c.nombre)}
								disabled={bloqueada || guardando}
								aria-label="Quitar {c.nombre}"
								title="Quitar del desprendible"><X size={14} strokeWidth={2.5} /></button
							>
						</li>
					{/each}
				</ul>
				<p class="total">Total <strong>{money(total)}</strong></p>
			{:else}
				<p class="vacio">Esta liquidación no tiene conceptos adicionales.</p>
			{/if}
		</div>

		<div class="tarjeta">
			<div class="campos">
				<label>
					<span>Importe</span>
					<input
						class="ca-input"
						type="text"
						inputmode="decimal"
						bind:value={nuevoValor}
						placeholder="+Devengo / −Deducción"
						disabled={bloqueada || guardando}
						onkeydown={(e) => e.key === 'Enter' && agregar()}
					/>
				</label>
				<label>
					<span>Descripción</span>
					<input
						class="ca-input"
						type="text"
						bind:value={nuevoNombre}
						placeholder="BONO ADICIONAL - NO SALARIAL"
						disabled={bloqueada || guardando}
						onkeydown={(e) => e.key === 'Enter' && agregar()}
					/>
				</label>
			</div>
			{#if error}<p class="error">{error}</p>{/if}
			<button type="button" class="btn-primary agregar" onclick={agregar} disabled={bloqueada || guardando}>
				{guardando ? 'Guardando…' : 'Agregar al desprendible'}
			</button>
		</div>
	</div>

	{#snippet pie()}
		<p class="pista">El importe de un concepto que ya existe se cambia en su propia celda.</p>
		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>Cerrar</button>
	{/snippet}
</ModalBase>

<style>
	.cuerpo {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.tarjeta {
		padding: 16px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.bloqueo {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: rgba(217, 119, 6, 0.1);
		color: #92400e;
		font-size: 13px;
	}
	.lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fila {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px 8px 12px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-base);
	}
	.importe {
		font-weight: 700;
		font-size: 14px;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.importe.negativo {
		color: #b91c1c;
	}
	.nombre {
		font-size: 13px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.quitar {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		background: none;
		border: 1px solid transparent;
		cursor: pointer;
		color: var(--text-muted);
		border-radius: 999px;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}
	.quitar:hover:not(:disabled) {
		background: rgba(180, 35, 24, 0.08);
		color: #b42318;
	}
	.quitar:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.total {
		margin: 10px 0 0;
		text-align: right;
		font-size: 13px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.total strong {
		color: var(--text-primary);
	}
	.vacio {
		margin: 0;
		padding: 12px 0;
		text-align: center;
		font-size: 13px;
		color: var(--text-very-muted);
	}
	.campos {
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: 10px;
	}
	/* En pantalla estrecha los dos campos se apilan: a 1.4fr la descripción
	   se quedaba en dos palabras por línea. */
	@media (max-width: 30rem) {
		.campos {
			grid-template-columns: 1fr;
		}
	}
	.campos label {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.campos span {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ca-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 14px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.ca-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ca-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.error {
		margin: 10px 0 0;
		font-size: 13px;
		font-weight: 600;
		color: #b91c1c;
	}
	.agregar {
		margin-top: 12px;
		width: 100%;
	}
	.pista {
		margin: 0 auto 0 0;
		flex: 1 1 200px;
		font-size: 12px;
		color: var(--text-very-muted);
	}
</style>
