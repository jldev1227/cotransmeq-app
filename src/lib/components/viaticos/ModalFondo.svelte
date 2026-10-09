<script lang="ts">
	/**
	 * Formularios del saldo del área: registrar lo recibido, corregirlo con
	 * motivo, editar un movimiento hecho a mano, o cerrar el corte. Una sola
	 * pieza con cuatro modos, para que el valor y la nota se validen igual que
	 * en la app.
	 */
	import { untrack } from 'svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { fechaCorta, moneda, type FondoViaticos, type MovimientoFondo } from '$lib/api/viaticos';

	export type ModoFondo = 'recarga' | 'ajuste' | 'editar' | 'cierre';

	interface Props {
		open: boolean;
		modo: ModoFondo;
		fondo: FondoViaticos;
		/** Solo en `editar`. */
		movimiento?: MovimientoFondo | null;
		oncerrar: () => void;
		/** Lanza si falla: el modal se queda abierto con lo escrito. */
		onconfirmar: (datos: { valor: number; observaciones: string }) => Promise<void>;
	}
	let { open, modo, fondo, movimiento = null, oncerrar, onconfirmar }: Props = $props();

	let valor = $state('');
	let nota = $state('');
	let sentido = $state<'sumar' | 'restar'>('restar');
	let enviando = $state(false);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			if (modo === 'editar' && movimiento) {
				valor = String(Math.abs(Math.round(movimiento.valor)));
				nota = movimiento.observaciones ?? '';
				sentido = movimiento.valor < 0 ? 'restar' : 'sumar';
			} else {
				valor = '';
				nota = '';
				sentido = 'restar';
			}
		});
	});

	const esCorreccion = $derived(
		modo === 'ajuste' || (modo === 'editar' && movimiento?.tipo === 'AJUSTE')
	);
	const numero = $derived(Number(valor.replace(/\D/g, '')) || 0);
	const valido = $derived(
		modo === 'cierre' ? true : numero > 0 && (!esCorreccion || nota.trim().length >= 5)
	);

	const TITULO: Record<ModoFondo, string> = {
		recarga: fondo.base_ultima_recarga > 0 ? 'Registrar saldo recibido' : 'Registrar saldo inicial',
		ajuste: 'Corregir el saldo',
		editar: movimiento?.tipo === 'AJUSTE' ? 'Editar corrección' : 'Editar saldo recibido',
		cierre: 'Cerrar el corte'
	};

	async function confirmar() {
		if (!valido || enviando) return;
		enviando = true;
		try {
			const firmado = esCorreccion && sentido === 'restar' ? -numero : numero;
			await onconfirmar({ valor: firmado, observaciones: nota.trim() });
			oncerrar();
		} catch {
			/* quien llama ya avisó con un toast */
		} finally {
			enviando = false;
		}
	}

	function formatear(e: Event) {
		const t = e.currentTarget as HTMLInputElement;
		valor = t.value.replace(/\D/g, '');
	}
</script>

<ModalBase
	{open}
	title={TITULO[modo]}
	eyebrow="SALDO DEL ÁREA"
	tamano="sm"
	bloqueado={enviando}
	{oncerrar}
>
	<div class="mf">
		{#if modo === 'cierre'}
			<p class="mf-desc">
				Se cierra el corte que va desde {fondo.corte_actual.desde
					? fechaCorta(fondo.corte_actual.desde)
					: 'el inicio'}. No se mueve plata: los <strong>{moneda(fondo.saldo)}</strong> que quedan pasan
				como arrastre al corte siguiente y se suman al próximo saldo recibido.
			</p>
			<dl class="mf-resumen">
				<div>
					<dt>Arrastre inicial</dt>
					<dd>{moneda(fondo.corte_actual.arrastre)}</dd>
				</div>
				<div>
					<dt>Recibido</dt>
					<dd>{moneda(fondo.corte_actual.recibido)}</dd>
				</div>
				<div>
					<dt>Anticipos</dt>
					<dd>− {moneda(fondo.corte_actual.anticipos)}</dd>
				</div>
				<div>
					<dt>Gastos</dt>
					<dd>− {moneda(fondo.corte_actual.gastos)}</dd>
				</div>
				<div>
					<dt>Queda</dt>
					<dd><strong>{moneda(fondo.saldo)}</strong></dd>
				</div>
			</dl>
			<label for="mf-nota" class="mf-label">Nota (opcional)</label>
			<input
				id="mf-nota"
				class="de-input"
				placeholder="Ej. corte de septiembre"
				bind:value={nota}
				maxlength="500"
			/>
		{:else}
			{#if modo === 'recarga'}
				<p class="mf-desc">
					Lo que el área recibió para anticipos y gastos. Se suma al saldo actual de <strong
						>{moneda(fondo.saldo)}</strong
					>.
				</p>
			{:else if esCorreccion}
				<p class="mf-desc">
					Una corrección manual (plata devuelta en efectivo, un error al registrar…). Siempre con
					motivo: queda en el historial.
				</p>
			{:else}
				<p class="mf-desc">
					Cambia el valor o el concepto de este saldo recibido. El saldo del área se recalcula.
				</p>
			{/if}
			{#if esCorreccion}
				<div class="mf-sentido" role="radiogroup" aria-label="Sentido de la corrección">
					<button
						type="button"
						class:activo={sentido === 'restar'}
						aria-pressed={sentido === 'restar'}
						onclick={() => (sentido = 'restar')}>− Restar</button
					>
					<button
						type="button"
						class:activo={sentido === 'sumar'}
						aria-pressed={sentido === 'sumar'}
						onclick={() => (sentido = 'sumar')}>+ Sumar</button
					>
				</div>
			{/if}
			<label for="mf-valor" class="mf-label">Valor <span>*</span></label>
			<input
				id="mf-valor"
				class="de-input mf-valor"
				inputmode="numeric"
				placeholder="$ 0"
				value={numero ? numero.toLocaleString('es-CO') : ''}
				oninput={formatear}
			/>
			<label for="mf-nota" class="mf-label"
				>{esCorreccion ? 'Motivo' : 'Nota'}
				{#if esCorreccion}<span>*</span>{:else}(opcional){/if}</label
			>
			<textarea
				id="mf-nota"
				class="de-input"
				rows="2"
				placeholder={esCorreccion
					? 'Por qué se corrige (mínimo 5 letras)'
					: 'Quién lo entregó, para qué periodo…'}
				bind:value={nota}
				maxlength="500"
			></textarea>
		{/if}
	</div>
	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
			>Cancelar</button
		>
		<button type="button" class="btn-primary" onclick={confirmar} disabled={!valido || enviando}>
			{enviando
				? 'Guardando…'
				: modo === 'cierre'
					? 'Cerrar corte'
					: modo === 'recarga'
						? 'Registrar'
						: modo === 'ajuste'
							? 'Corregir'
							: 'Guardar'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mf {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mf-desc {
		margin: 0 0 4px;
		color: var(--text-secondary);
		font-size: 14px;
		line-height: 1.45;
	}
	.mf-label {
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.mf-label span {
		color: #dc2626;
	}
	.mf-valor {
		font-size: 1.1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.mf-sentido {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.mf-sentido button {
		padding: 0.5rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.mf-sentido button.activo {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.mf-resumen {
		margin: 0 0 6px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 6px;
	}
	.mf-resumen div {
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		background: var(--bg-base);
	}
	.mf-resumen dt {
		font-size: 0.64rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.mf-resumen dd {
		margin: 0;
		font-size: 0.84rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
</style>
