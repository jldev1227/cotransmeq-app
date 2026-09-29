<script lang="ts">
	/**
	 * El PERIODO DEL DESPRENDIBLE de una hoja: las dos fechas que imprime el
	 * comprobante del conductor.
	 *
	 * Hasta ahora todas salían del generador —el corte 21→20— y no había forma
	 * de liquidar un retiro del 21 al 30. Aquí se fijan a mano, por hoja.
	 *
	 * POR QUÉ UN MODAL Y NO DOS CELDAS: mover las fechas rehace los recargos y
	 * el neto. Con dos celdas sueltas habría un estado intermedio —la inicial ya
	 * movida y la final todavía no— que el servidor tendría que recalcular, y
	 * posiblemente con las fechas al revés.
	 *
	 * No guarda por su cuenta: `onGuardar` recibe las fechas y la página llama
	 * al servidor y reabre el libro con ese rango.
	 */
	interface Props {
		nombreHoja: string;
		desde: string;
		hasta: string;
		diasLaboradosActuales: number | null;
		bloqueada?: boolean;
		motivoBloqueo?: string;
		guardando?: boolean;
		onGuardar: (p: { inicio: string; fin: string; ajustarDias: boolean }) => void;
		onClose: () => void;
	}

	let {
		nombreHoja,
		desde,
		hasta,
		diasLaboradosActuales,
		bloqueada = false,
		motivoBloqueo = '',
		guardando = false,
		onGuardar,
		onClose
	}: Props = $props();

	// Copias editables: los props son las fechas guardadas.
	let inicio = $state('');
	let fin = $state('');
	let ajustarDias = $state(true);
	let sembrado = false;
	$effect(() => {
		if (sembrado) return;
		inicio = desde;
		fin = hasta;
		sembrado = true;
	});

	const MAX_DIAS = 62;
	const FECHA = /^\d{4}-\d{2}-\d{2}$/;

	/// Días de calendario, con los dos extremos.
	const diasCalendario = $derived(
		FECHA.test(inicio) && FECHA.test(fin) && inicio <= fin
			? (Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000 + 1
			: 0
	);

	/**
	 * Días COMERCIALES (30/360), igual que el servidor: el 31 no suma y el
	 * último día de febrero vale 30. Del 21 al 30 y del 21 al 31 son 10.
	 */
	const diasComerciales = $derived.by(() => {
		if (!diasCalendario) return 0;
		const partes = (f: string) => {
			const [a, m, d] = f.split('-').map(Number);
			const ultimoFeb = m === 2 && new Date(Date.UTC(a, 2, 0)).getUTCDate() === d;
			return { a, m, d: ultimoFeb ? 30 : Math.min(d, 30) };
		};
		const x = partes(inicio);
		const y = partes(fin);
		return Math.max(0, Math.min(30, (y.a - x.a) * 360 + (y.m - x.m) * 30 + (y.d - x.d) + 1));
	});

	const error = $derived(
		!FECHA.test(inicio) || !FECHA.test(fin)
			? 'Pon las dos fechas.'
			: inicio > fin
				? 'La fecha inicial tiene que ser anterior a la final.'
				: diasCalendario > MAX_DIAS
					? `Como mucho ${MAX_DIAS} días.`
					: ''
	);
	const sinCambios = $derived(inicio === desde && fin === hasta && !ajustarDiasCambia());
	function ajustarDiasCambia() {
		return ajustarDias && diasLaboradosActuales !== diasComerciales;
	}

	const fmt = (iso: string) => {
		if (!FECHA.test(iso)) return '—';
		const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
		const [a, m, d] = iso.split('-').map(Number);
		return `${d} ${MESES[m - 1]} ${a}`;
	};

	function guardar() {
		if (bloqueada || guardando || error || sinCambios) return;
		onGuardar({ inicio, fin, ajustarDias });
	}
</script>

<div class="fondo" role="presentation" onclick={() => !guardando && onClose()}>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label="Periodo del desprendible"
		onclick={(e) => e.stopPropagation()}
	>
		<header class="cabecera">
			<div>
				<span class="eyebrow">{nombreHoja}</span>
				<h2>Periodo del desprendible</h2>
				<p class="ayuda">
					Las fechas que imprime el comprobante. Al guardar se rehacen los recargos con estas
					fechas y se recalcula el neto.
				</p>
			</div>
			<button class="cerrar" onclick={onClose} disabled={guardando} aria-label="Cerrar">✕</button>
		</header>

		<div class="cuerpo">
			{#if bloqueada}
				<p class="bloqueo">{motivoBloqueo || 'Esta hoja no se puede editar.'}</p>
			{/if}

			<div class="campos">
				<label>
					<span>Desde</span>
					<input
						type="date"
						bind:value={inicio}
						max={fin || undefined}
						disabled={bloqueada || guardando}
					/>
				</label>
				<label>
					<span>Hasta</span>
					<input
						type="date"
						bind:value={fin}
						min={inicio || undefined}
						disabled={bloqueada || guardando}
					/>
				</label>
			</div>

			<p class="actual">Ahora: {fmt(desde)} — {fmt(hasta)}</p>

			{#if error}
				<p class="error">{error}</p>
			{:else}
				<p class="resumen">
					{diasCalendario}
					{diasCalendario === 1 ? 'día' : 'días'} de calendario ·
					<strong>{diasComerciales} comerciales</strong>
				</p>
				<label class="casilla">
					<input type="checkbox" bind:checked={ajustarDias} disabled={bloqueada || guardando} />
					<span>
						Poner los días laborados en <strong>{diasComerciales}</strong>
						{#if diasLaboradosActuales != null}
							<em>(ahora {diasLaboradosActuales})</em>
						{/if}
					</span>
				</label>
			{/if}
		</div>

		<footer class="pie">
			<p class="pista">La copia de días no se toca; si el rango crece, usa «Actualizar días».</p>
			<div class="acciones">
				<button class="btn-secondary" onclick={onClose} disabled={guardando}>Cancelar</button>
				<button
					class="btn-primary"
					onclick={guardar}
					disabled={bloqueada || guardando || !!error || sinCambios}
				>
					{guardando ? 'Guardando…' : 'Guardar'}
				</button>
			</div>
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
		max-width: 30rem;
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
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.bloqueo {
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: rgba(217, 119, 6, 0.1);
		color: #92400e;
		font-size: 0.8rem;
	}
	.campos {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}
	@media (max-width: 26rem) {
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
	.actual {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-very-muted, #999);
	}
	.resumen {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary, #444);
		font-variant-numeric: tabular-nums;
	}
	.casilla {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #444);
		cursor: pointer;
	}
	.casilla em {
		color: var(--text-muted);
		font-style: normal;
	}
	.error {
		margin: 0;
		font-size: 0.78rem;
		color: #b91c1c;
	}
	.pie {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1.25rem;
		border-top: 1px solid var(--border-subtle);
		flex-wrap: wrap;
	}
	.pista {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-very-muted, #999);
		max-width: 16rem;
	}
	.acciones {
		display: flex;
		gap: 0.5rem;
	}
</style>
