<script lang="ts">
	/**
	 * Selector del periodo del panel: Mes · Semana · Rango, con flechas para
	 * moverse un mes o una semana sin abrir el calendario.
	 */
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import {
		hoyLocal,
		mesActual,
		moverMes,
		moverSemana,
		rangoDe,
		semanaActual,
		type FiltrosPeriodo,
		type TipoPeriodo
	} from '$lib/dashboard/periodo';

	interface Props {
		valor: FiltrosPeriodo;
		onCambiar: (cambios: Partial<FiltrosPeriodo>) => void;
	}
	let { valor, onCambiar }: Props = $props();

	const OPCIONES = [
		{ valor: 'mes', etiqueta: 'Mes' },
		{ valor: 'semana', etiqueta: 'Semana' },
		{ valor: 'rango', etiqueta: 'Rango' }
	];

	const rango = $derived(rangoDe(valor));

	/// Al cambiar de modo sin valor se arranca en el periodo en curso: un modo
	/// activo sin fechas no filtraría nada y parecería roto.
	function elegirTipo(t: string) {
		const tipo = t as TipoPeriodo;
		if (tipo === 'mes') onCambiar({ tipo, mes: valor.mes || mesActual() });
		else if (tipo === 'semana') onCambiar({ tipo, semana: valor.semana || semanaActual() });
		else
			onCambiar({
				tipo,
				desde: valor.desde || `${mesActual()}-01`,
				hasta: valor.hasta || hoyLocal()
			});
	}
</script>

<div class="fp">
	<SegmentosFiltro
		etiqueta="Periodo"
		opciones={OPCIONES}
		valor={valor.tipo}
		onCambiar={elegirTipo}
	/>

	{#if valor.tipo === 'mes'}
		<div class="fp-paso">
			<button
				type="button"
				class="fp-flecha"
				aria-label="Mes anterior"
				onclick={() => onCambiar({ mes: moverMes(valor.mes || mesActual(), -1) })}
			>
				<ChevronLeft size={16} strokeWidth={2.4} />
			</button>
			<input
				type="month"
				class="fp-input"
				aria-label="Mes"
				value={valor.mes || mesActual()}
				max={mesActual()}
				onchange={(e) => e.currentTarget.value && onCambiar({ mes: e.currentTarget.value })}
			/>
			<button
				type="button"
				class="fp-flecha"
				aria-label="Mes siguiente"
				disabled={(valor.mes || mesActual()) >= mesActual()}
				onclick={() => onCambiar({ mes: moverMes(valor.mes || mesActual(), 1) })}
			>
				<ChevronRight size={16} strokeWidth={2.4} />
			</button>
		</div>
	{:else if valor.tipo === 'semana'}
		<div class="fp-paso">
			<button
				type="button"
				class="fp-flecha"
				aria-label="Semana anterior"
				onclick={() => onCambiar({ semana: moverSemana(valor.semana || semanaActual(), -1) })}
			>
				<ChevronLeft size={16} strokeWidth={2.4} />
			</button>
			<input
				type="week"
				class="fp-input"
				aria-label="Semana"
				value={valor.semana || semanaActual()}
				max={semanaActual()}
				onchange={(e) => e.currentTarget.value && onCambiar({ semana: e.currentTarget.value })}
			/>
			<button
				type="button"
				class="fp-flecha"
				aria-label="Semana siguiente"
				disabled={(valor.semana || semanaActual()) >= semanaActual()}
				onclick={() => onCambiar({ semana: moverSemana(valor.semana || semanaActual(), 1) })}
			>
				<ChevronRight size={16} strokeWidth={2.4} />
			</button>
		</div>
	{:else}
		<div class="fp-paso">
			<input
				type="date"
				class="fp-input"
				aria-label="Desde"
				value={rango.desde}
				max={rango.hasta}
				onchange={(e) => onCambiar({ desde: e.currentTarget.value })}
			/>
			<span class="fp-sep" aria-hidden="true">–</span>
			<input
				type="date"
				class="fp-input"
				aria-label="Hasta"
				value={rango.hasta}
				min={rango.desde}
				onchange={(e) => onCambiar({ hasta: e.currentTarget.value })}
			/>
		</div>
	{/if}

	<span class="fp-etiqueta">{rango.etiqueta}</span>
</div>

<style>
	.fp {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}
	.fp-paso {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.fp-flecha {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 36px;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			border-color 0.15s var(--ease-apple),
			color 0.15s var(--ease-apple);
	}
	.fp-flecha:hover:not(:disabled) {
		border-color: var(--au-primary);
		color: var(--au-dark);
	}
	.fp-flecha:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.fp-input {
		min-height: 36px;
		padding: 0 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.82rem;
		color: var(--text-primary);
	}
	.fp-input:focus-visible {
		outline: none;
		border-color: var(--au-primary);
	}
	.fp-sep {
		color: var(--text-very-muted);
	}
	.fp-etiqueta {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--au-dark);
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: var(--au-tint);
	}
</style>
