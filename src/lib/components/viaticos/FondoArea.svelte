<script lang="ts">
	/**
	 * Saldo del área de operaciones para anticipos y gastos (lo mismo que la
	 * app móvil, más el corte): saldo, barra del 15 %, el corte en curso con lo
	 * que arrastró y lo que ha pasado, los cortes cerrados y los movimientos.
	 *
	 * Quien tiene permiso completo registra lo recibido, corrige con motivo,
	 * edita lo que registró a mano y cierra el corte. Un cierre no mueve plata:
	 * lo que queda arrastra al corte siguiente y se suma al próximo recibido.
	 */
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { ChevronDown, ChevronUp, Flag, Pencil, Plus, Wrench } from 'lucide-svelte';
	import {
		TIPO_MOVIMIENTO_LABELS,
		fechaCorta,
		moneda,
		viaticosFondoAPI,
		type CorteFondo,
		type FondoViaticos,
		type MovimientoFondo
	} from '$lib/api/viaticos';
	import ModalFondo, { type ModoFondo } from './ModalFondo.svelte';

	interface Props {
		puedeEscribir: boolean;
		/** Los anticipos y gastos cambian el saldo: la página avisa para releer. */
		version?: number;
		onCambio?: () => void;
	}
	let { puedeEscribir, version = 0, onCambio }: Props = $props();

	let fondo = $state<FondoViaticos | null>(null);
	let cargando = $state(true);
	let verMovimientos = $state(false);
	let verCortes = $state(false);
	let modal = $state<{ modo: ModoFondo; movimiento?: MovimientoFondo | null } | null>(null);

	async function cargar() {
		try {
			fondo = await viaticosFondoAPI.estado();
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo consultar el saldo del área');
		} finally {
			cargando = false;
		}
	}
	onMount(cargar);
	$effect(() => {
		void version;
		if (!cargando) void cargar();
	});

	const porcentaje = $derived(Math.max(0, Math.min(100, fondo?.porcentaje_restante ?? 0)));

	async function confirmar(datos: { valor: number; observaciones: string }) {
		if (!modal || !fondo) return;
		try {
			if (modal.modo === 'recarga')
				fondo = await viaticosFondoAPI.registrarSaldo({
					valor: datos.valor,
					observaciones: datos.observaciones || null
				});
			else if (modal.modo === 'ajuste')
				fondo = await viaticosFondoAPI.corregir({
					valor: datos.valor,
					observaciones: datos.observaciones
				});
			else if (modal.modo === 'editar' && modal.movimiento)
				fondo = await viaticosFondoAPI.editarMovimiento(modal.movimiento.id, {
					valor: datos.valor,
					observaciones: datos.observaciones || null
				});
			else if (modal.modo === 'cierre')
				fondo = await viaticosFondoAPI.cerrarCorte({ observaciones: datos.observaciones || null });
			const avisos: Record<ModoFondo, string> = {
				recarga: `Se sumaron ${moneda(Math.abs(datos.valor))} al saldo del área`,
				ajuste: `Saldo corregido: ${datos.valor < 0 ? 'se restaron' : 'se sumaron'} ${moneda(Math.abs(datos.valor))}`,
				editar: 'Movimiento actualizado; el saldo se recalculó',
				cierre: `Corte cerrado: ${moneda(fondo.saldo)} pasan al siguiente`
			};
			toast.success(avisos[modal.modo]);
			onCambio?.();
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo guardar');
			throw e;
		}
	}

	function signo(m: MovimientoFondo): string {
		if (m.tipo === 'CIERRE') return '';
		return `${m.valor < 0 ? '−' : '+'} ${moneda(Math.abs(m.valor))}`;
	}
	function detalle(m: MovimientoFondo): string {
		if (m.anticipo) return `${m.anticipo.conductor} · ${m.anticipo.placa} · ${m.anticipo.concepto}`;
		if (m.gasto_empresa) return `${m.gasto_empresa.categoria} · ${m.gasto_empresa.descripcion}`;
		return m.observaciones ?? '';
	}
	function rangoCorte(c: CorteFondo): string {
		const desde = c.desde ? fechaCorta(c.desde) : 'inicio';
		return c.cerrado ? `${desde} – ${fechaCorta(c.cerrado.fecha)}` : `desde ${desde}`;
	}
</script>

{#if cargando}
	<div class="fa page-card fa-cargando">Consultando el saldo del área…</div>
{:else if fondo}
	{@const c = fondo.corte_actual}
	<section
		class="fa page-card"
		class:fa--bajo={fondo.saldo_bajo && fondo.base_ultima_recarga > 0}
		class:fa--sin={fondo.sin_saldo}
	>
		<div class="fa-principal">
			<div class="fa-saldo">
				<span class="fa-etiqueta">Saldo del área de operaciones</span>
				<span class="fa-valor">{moneda(fondo.saldo)}</span>
				{#if fondo.base_ultima_recarga > 0}
					<div
						class="fa-barra"
						role="progressbar"
						aria-valuenow={porcentaje}
						aria-valuemin="0"
						aria-valuemax="100"
					>
						<span style="width: {porcentaje}%"></span>
					</div>
					<span class="fa-sub"
						>Queda el {porcentaje}% de {moneda(fondo.base_ultima_recarga)} · aviso al 15%</span
					>
				{/if}
				{#if fondo.ultima_recarga}
					<span class="fa-sub"
						>Último saldo recibido: {moneda(fondo.ultima_recarga.valor)} el {fechaCorta(
							fondo.ultima_recarga.fecha
						)}{fondo.ultima_recarga.por ? ` · registró ${fondo.ultima_recarga.por}` : ''}</span
					>
				{/if}
				{#if fondo.sin_saldo}
					<span class="fa-aviso"
						>El área no tiene saldo: registren lo que recibieron para poder dar anticipos.</span
					>
				{:else if fondo.saldo_bajo && fondo.base_ultima_recarga > 0}
					<span class="fa-aviso"
						>El saldo está en el 15% o menos. Pidan el siguiente desembolso a tiempo.</span
					>
				{/if}
				{#if !fondo.requiere_fondo}
					<span class="fa-sub">Lo que entregas como administración no descuenta de este saldo.</span
					>
				{/if}
			</div>

			<div class="fa-corte">
				<span class="fa-etiqueta">Corte en curso · {rangoCorte(c)}</span>
				<dl class="fa-cifras">
					<div>
						<dt>Arrastre</dt>
						<dd>{moneda(c.arrastre)}</dd>
					</div>
					<div>
						<dt>Recibido</dt>
						<dd class="fa-mas">+ {moneda(c.recibido)}</dd>
					</div>
					<div>
						<dt>Anticipos</dt>
						<dd class="fa-menos">− {moneda(c.anticipos)}</dd>
					</div>
					<div>
						<dt>Gastos</dt>
						<dd class="fa-menos">− {moneda(c.gastos)}</dd>
					</div>
					{#if c.ajustes || c.reversos}
						<div>
							<dt>Correcciones</dt>
							<dd>
								{c.ajustes + c.reversos < 0 ? '−' : '+'}
								{moneda(Math.abs(c.ajustes + c.reversos))}
							</dd>
						</div>
					{/if}
					<div>
						<dt>Queda</dt>
						<dd><strong>{moneda(c.restante)}</strong></dd>
					</div>
				</dl>
				<span class="fa-sub"
					>{c.movimientos}
					{c.movimientos === 1 ? 'movimiento' : 'movimientos'} en este corte. Al cerrarlo, lo que queda
					pasa al siguiente.</span
				>
			</div>

			{#if puedeEscribir}
				<div class="fa-acciones">
					<button type="button" class="btn-primary" onclick={() => (modal = { modo: 'recarga' })}
						><Plus size={15} strokeWidth={2.4} />
						{fondo.base_ultima_recarga > 0 ? 'Saldo recibido' : 'Saldo inicial'}</button
					>
					<button
						type="button"
						class="btn-secondary"
						onclick={() => (modal = { modo: 'ajuste' })}
						disabled={!fondo.movimientos.length}
						><Wrench size={15} strokeWidth={2.2} /> Corregir</button
					>
					<button
						type="button"
						class="btn-secondary"
						onclick={() => (modal = { modo: 'cierre' })}
						disabled={!c.movimientos}><Flag size={15} strokeWidth={2.2} /> Cerrar corte</button
					>
				</div>
			{/if}
		</div>

		<div class="fa-pie">
			<button
				type="button"
				class="btn-ghost"
				onclick={() => (verMovimientos = !verMovimientos)}
				aria-expanded={verMovimientos}
			>
				{#if verMovimientos}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
				Movimientos ({fondo.movimientos.length})
			</button>
			{#if fondo.cortes.length}
				<button
					type="button"
					class="btn-ghost"
					onclick={() => (verCortes = !verCortes)}
					aria-expanded={verCortes}
				>
					{#if verCortes}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
					Cortes cerrados ({fondo.cortes.length})
				</button>
			{/if}
		</div>

		{#if verCortes && fondo.cortes.length}
			<div class="fa-tabla" transition:slide={{ duration: 180 }}>
				<table>
					<thead
						><tr
							><th>Corte</th><th>Arrastre</th><th>Recibido</th><th>Anticipos</th><th>Gastos</th><th
								>Correcciones</th
							><th>Quedó</th><th>Cerró</th></tr
						></thead
					>
					<tbody>
						{#each fondo.cortes as k (k.cerrado?.id)}
							<tr>
								<td
									>{rangoCorte(k)}{k.cerrado?.observaciones
										? ` · ${k.cerrado.observaciones}`
										: ''}</td
								>
								<td>{moneda(k.arrastre)}</td>
								<td class="fa-mas">+ {moneda(k.recibido)}</td>
								<td class="fa-menos">− {moneda(k.anticipos)}</td>
								<td class="fa-menos">− {moneda(k.gastos)}</td>
								<td
									>{k.ajustes + k.reversos
										? `${k.ajustes + k.reversos < 0 ? '−' : '+'} ${moneda(Math.abs(k.ajustes + k.reversos))}`
										: '—'}</td
								>
								<td><strong>{moneda(k.restante)}</strong></td>
								<td>{k.cerrado?.por ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if verMovimientos}
			<ul class="fa-movs" transition:slide={{ duration: 180 }}>
				{#if fondo.movimientos.length === 0}
					<li class="fa-vacio">Todavía no hay movimientos.</li>
				{/if}
				{#each fondo.movimientos as m (m.id)}
					<li class="fa-mov" class:fa-mov--cierre={m.tipo === 'CIERRE'}>
						<span class="fa-mov-tipo fa-mov-tipo--{m.tipo.toLowerCase()}"
							>{TIPO_MOVIMIENTO_LABELS[m.tipo]}</span
						>
						<span class="fa-mov-detalle">
							<span class="fa-mov-texto">{detalle(m) || '—'}</span>
							<span class="fa-mov-meta"
								>{fechaCorta(m.fecha)}{m.registrado_por ? ` · ${m.registrado_por}` : ''}</span
							>
						</span>
						<span class="fa-mov-valor" class:fa-mas={m.valor > 0} class:fa-menos={m.valor < 0}
							>{signo(m)}</span
						>
						{#if puedeEscribir && m.editable}
							<button
								type="button"
								class="fa-mov-editar"
								title="Editar valor o concepto"
								aria-label="Editar movimiento"
								onclick={() => (modal = { modo: 'editar', movimiento: m })}
								><Pencil size={13} strokeWidth={2.2} /></button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if modal}
		<ModalFondo
			open={true}
			modo={modal.modo}
			{fondo}
			movimiento={modal.movimiento ?? null}
			oncerrar={() => (modal = null)}
			onconfirmar={confirmar}
		/>
	{/if}
{/if}

<style>
	.fa {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.1rem 1.4rem;
	}
	.fa-cargando {
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.fa--bajo {
		border-color: #f6d59a;
		background: linear-gradient(180deg, #fffaf0 0%, var(--bg-surface) 70%);
	}
	.fa--sin {
		border-color: #f4c7c3;
	}
	.fa-principal {
		display: grid;
		grid-template-columns: minmax(16rem, 1.2fr) minmax(18rem, 2fr) auto;
		gap: 1.25rem;
		align-items: start;
	}
	@media (max-width: 960px) {
		.fa-principal {
			grid-template-columns: 1fr;
		}
	}
	.fa-saldo,
	.fa-corte {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.fa-etiqueta {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.fa-valor {
		font-family: var(--font-display);
		font-size: 1.9rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		color: var(--au-dark);
		font-variant-numeric: tabular-nums;
	}
	.fa--bajo .fa-valor {
		color: #9a6700;
	}
	.fa--sin .fa-valor {
		color: #b42318;
	}
	.fa-barra {
		height: 7px;
		border-radius: 999px;
		background: var(--bg-base);
		overflow: hidden;
		margin-top: 0.2rem;
	}
	.fa-barra span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--au-primary);
	}
	.fa--bajo .fa-barra span {
		background: #f59e0b;
	}
	.fa-sub {
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.fa-aviso {
		font-size: 0.78rem;
		font-weight: 600;
		color: #9a6700;
	}
	.fa--sin .fa-aviso {
		color: #b42318;
	}
	.fa-cifras {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 0.4rem;
	}
	.fa-cifras div {
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		background: var(--bg-base);
		min-width: 0;
	}
	.fa-cifras dt {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.fa-cifras dd {
		margin: 0;
		font-size: 0.84rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.fa-mas {
		color: var(--au-dark);
	}
	.fa-menos {
		color: #b42318;
	}
	.fa-acciones {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 11rem;
	}
	.fa-acciones .btn-primary,
	.fa-acciones .btn-secondary {
		justify-content: center;
	}
	.fa-pie {
		display: flex;
		gap: 1rem;
		border-top: 1px dashed var(--border-subtle);
		padding-top: 0.5rem;
	}
	.fa-tabla {
		overflow-x: auto;
	}
	.fa-tabla table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}
	.fa-tabla th {
		text-align: left;
		font-size: 0.64rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.fa-tabla td {
		padding: 0.4rem 0.5rem;
		border-bottom: 1px dashed var(--border-subtle);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.fa-movs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		max-height: 420px;
		overflow-y: auto;
	}
	.fa-vacio {
		font-size: 0.8rem;
		color: var(--text-very-muted);
	}
	.fa-mov {
		display: grid;
		grid-template-columns: 9rem minmax(0, 1fr) auto auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.4rem 0;
		border-top: 1px dashed var(--border-subtle);
	}
	.fa-mov--cierre {
		background: var(--bg-base);
		border-radius: 8px;
		padding: 0.4rem 0.5rem;
	}
	.fa-mov-tipo {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-secondary);
		justify-self: start;
		white-space: nowrap;
	}
	.fa-mov-tipo--recarga {
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.fa-mov-tipo--cierre {
		background: var(--au-dark);
		color: #fff;
	}
	.fa-mov-tipo--anticipo,
	.fa-mov-tipo--gasto_empresa {
		background: #fde8e8;
		color: #b42318;
	}
	.fa-mov-tipo--ajuste {
		background: #fdf1d6;
		color: #9a6700;
	}
	.fa-mov-detalle {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.fa-mov-texto {
		font-size: 0.8rem;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fa-mov-meta {
		font-size: 0.68rem;
		color: var(--text-muted);
	}
	.fa-mov-valor {
		font-size: 0.8rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.fa-mov-editar {
		display: inline-flex;
		width: 26px;
		height: 26px;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		background: var(--bg-surface);
		color: var(--text-muted);
		cursor: pointer;
	}
	.fa-mov-editar:hover {
		color: var(--au-dark);
		border-color: var(--au-primary);
	}
	@media (max-width: 640px) {
		.fa-mov {
			grid-template-columns: minmax(0, 1fr) auto auto;
		}
		.fa-mov-tipo {
			grid-column: 1 / -1;
		}
	}
</style>
