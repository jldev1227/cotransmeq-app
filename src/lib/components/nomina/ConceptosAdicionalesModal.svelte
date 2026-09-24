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

<div class="fondo" role="presentation" onclick={() => !guardando && onClose()}>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label="Conceptos adicionales"
		onclick={(e) => e.stopPropagation()}
	>
		<header class="cabecera">
			<div>
				<span class="eyebrow">{nombreHoja}</span>
				<h2>Conceptos adicionales</h2>
				<p class="ayuda">
					Van al desprendible debajo de AUXILIO DE TRANSPORTE. Suman al devengado y no cotizan.
				</p>
			</div>
			<button class="cerrar" onclick={onClose} disabled={guardando} aria-label="Cerrar">✕</button>
		</header>

		<div class="cuerpo">
			{#if bloqueada}
				<p class="bloqueo">{motivoBloqueo || 'Esta hoja no se puede editar.'}</p>
			{/if}

			{#if conceptos.length}
				<ul class="lista">
					{#each conceptos as c (c.nombre)}
						<li class="fila">
							<span class="importe" class:negativo={c.valor < 0}>{money(c.valor)}</span>
							<span class="nombre">{c.nombre}</span>
							<button
								class="quitar"
								onclick={() => onEliminar(c.nombre)}
								disabled={bloqueada || guardando}
								aria-label="Quitar {c.nombre}"
								title="Quitar del desprendible">✕</button
							>
						</li>
					{/each}
				</ul>
				<p class="total">Total <strong>{money(total)}</strong></p>
			{:else}
				<p class="vacio">Esta liquidación no tiene conceptos adicionales.</p>
			{/if}

			<div class="alta">
				<div class="campos">
					<label>
						<span>Importe</span>
						<input
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
							type="text"
							bind:value={nuevoNombre}
							placeholder="BONO ADICIONAL - NO SALARIAL"
							disabled={bloqueada || guardando}
							onkeydown={(e) => e.key === 'Enter' && agregar()}
						/>
					</label>
				</div>
				{#if error}<p class="error">{error}</p>{/if}
				<button class="btn-primary" onclick={agregar} disabled={bloqueada || guardando}>
					{guardando ? 'Guardando…' : 'Agregar al desprendible'}
				</button>
			</div>
		</div>

		<footer class="pie">
			<p class="pista">El importe de un concepto que ya existe se cambia en su propia celda.</p>
			<button class="btn-secondary" onclick={onClose} disabled={guardando}>Cerrar</button>
		</footer>
	</div>
</div>

<style>
	.fondo {
		position: fixed;
		inset: 0;
		background: rgba(15, 31, 26, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 1rem;
	}
	.panel {
		background: var(--bg-surface, #fff);
		border-radius: 16px;
		width: 100%;
		max-width: 34rem;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
	}
	.cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.cabecera h2 {
		margin: 0.25rem 0 0;
		font-size: 1.3rem;
		font-weight: 500;
	}
	.eyebrow {
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-family: 'JetBrains Mono', monospace;
	}
	.ayuda {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: var(--text-muted);
		max-width: 26rem;
	}
	.cerrar {
		background: none;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		color: var(--text-muted);
	}
	.cuerpo {
		padding: 1rem 1.25rem;
		overflow-y: auto;
		flex: 1;
	}
	.bloqueo {
		margin: 0 0 0.9rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: rgba(217, 119, 6, 0.1);
		color: #92400e;
		font-size: 0.8rem;
	}
	.lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.fila {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		background: var(--bg-base, #fafafa);
	}
	.importe {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--emerald-700, #047857);
		font-variant-numeric: tabular-nums;
	}
	.importe.negativo {
		color: #dc2626;
	}
	.nombre {
		font-size: 0.78rem;
		color: var(--text-secondary, #444);
		overflow-wrap: anywhere;
	}
	.quitar {
		background: none;
		border: none;
		cursor: pointer;
		color: #dc2626;
		font-size: 0.85rem;
		padding: 0.15rem 0.3rem;
		border-radius: 6px;
	}
	.quitar:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.total {
		margin: 0.6rem 0 0;
		text-align: right;
		font-size: 0.8rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.vacio {
		margin: 0;
		padding: 1.2rem 0;
		text-align: center;
		font-size: 0.82rem;
		color: var(--text-very-muted, #999);
	}
	.alta {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px dashed var(--border-subtle);
	}
	.campos {
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: 0.6rem;
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
		gap: 0.25rem;
	}
	.campos span {
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-family: 'JetBrains Mono', monospace;
	}
	.campos input {
		border: 1px solid var(--border-default, #ddd);
		border-radius: 10px;
		padding: 0.45rem 0.6rem;
		font-size: 0.85rem;
		background: #fff;
	}
	.campos input:disabled {
		background: #f5f5f5;
		cursor: not-allowed;
	}
	.error {
		margin: 0.6rem 0 0;
		font-size: 0.78rem;
		color: #b91c1c;
	}
	.alta .btn-primary {
		margin-top: 0.75rem;
		width: 100%;
	}
	.pie {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1.25rem;
		border-top: 1px solid var(--border-subtle);
	}
	.pista {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-very-muted, #999);
	}
</style>
