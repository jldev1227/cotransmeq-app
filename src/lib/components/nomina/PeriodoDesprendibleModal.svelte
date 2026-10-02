<script lang="ts">
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

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
		/// Fechas con las que arranca el formulario, si no son las guardadas
		/// (el rango de la barra). `desde`/`hasta` siguen siendo «Ahora».
		propuesto?: { desde: string; hasta: string } | null;
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
		propuesto = null,
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
		inicio = propuesto?.desde ?? desde;
		fin = propuesto?.hasta ?? hasta;
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

<ModalBase
	open={true}
	eyebrow={nombreHoja}
	title="Periodo del desprendible"
	subtitle="Las fechas que imprime el comprobante. Al guardar se rehacen los recargos con estas fechas y se recalcula el neto."
	tamano="sm"
	bloqueado={guardando}
	oncerrar={onClose}
>
	<div class="cuerpo">
		{#if bloqueada}
			<p class="bloqueo">{motivoBloqueo || 'Esta hoja no se puede editar.'}</p>
		{/if}

		<div class="tarjeta">
			<div class="campos">
				<label>
					<span>Desde</span>
					<input
						class="pd-input"
						type="date"
						bind:value={inicio}
						max={fin || undefined}
						disabled={bloqueada || guardando}
					/>
				</label>
				<label>
					<span>Hasta</span>
					<input
						class="pd-input"
						type="date"
						bind:value={fin}
						min={inicio || undefined}
						disabled={bloqueada || guardando}
					/>
				</label>
			</div>

			<p class="actual">Ahora: {fmt(desde)} — {fmt(hasta)}</p>
		</div>

		{#if error}
			<p class="error">{error}</p>
		{:else}
			<div class="tarjeta">
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
			</div>
		{/if}

		<p class="pista">La copia de días no se toca; si el rango crece, usa «Actualizar días».</p>
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>
			Cancelar
		</button>
		<button
			type="button"
			class="btn-primary"
			onclick={guardar}
			disabled={bloqueada || guardando || !!error || sinCambios}
		>
			{guardando ? 'Guardando…' : 'Guardar'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.cuerpo {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 12px;
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
	.campos {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	@media (max-width: 26rem) {
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
	.pd-input {
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
	.pd-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.pd-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.actual {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}
	.resumen {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.casilla {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.casilla input {
		accent-color: var(--accion);
		margin-top: 2px;
	}
	.casilla em {
		color: var(--text-muted);
		font-style: normal;
	}
	.error {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: #b91c1c;
	}
	.pista {
		margin: 0;
		font-size: 12px;
		color: var(--text-very-muted);
	}
</style>
