<script lang="ts">
	/**
	 * Qué días de la hoja salen en el desprendible y cuáles se pagan.
	 *
	 * Dos interruptores por día trabajado, independientes:
	 *   · NO MOSTRAR — el día desaparece de las tablas de recargos (las del
	 *     canvas por empresa y las páginas de detalle del PDF). No mueve dinero.
	 *   · NO SUMAR — el día sigue en las tablas, en gris, pero su valor no entra
	 *     en los recargos: baja el total, el neto y las filas de `recargos`.
	 *
	 * POR QUÉ UN MODAL Y NO UNA CASILLA SOBRE CADA DÍA: la cabecera de la matriz
	 * ya tiene cuatro filas por columna, la rejilla es común a todo el libro y
	 * una casilla más por día y por marca no cabe sin ensanchar treinta
	 * columnas. Aquí además se ve el VALOR de cada día antes de quitarlo.
	 *
	 * Una fila por FECHA Y CLIENTE, que es la clave con la que se guarda
	 * (`marcasDias.ts`): dos servicios del mismo cliente el mismo día van
	 * juntos, como en el desprendible.
	 *
	 * No guarda nada por su cuenta: `onGuardar` recibe el mapa entero.
	 */
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { claveMarcaDia, type MarcasDias } from '$lib/utils/marcasDias';
	import type { DiaHojaDTO } from '$lib/editor/builders/nomina.builder';

	interface Props {
		nombreHoja: string;
		dias: DiaHojaDTO[];
		bloqueada?: boolean;
		motivoBloqueo?: string;
		guardando?: boolean;
		onGuardar: (marcas: MarcasDias) => void;
		onClose: () => void;
	}

	let {
		nombreHoja,
		dias,
		bloqueada = false,
		motivoBloqueo = '',
		guardando = false,
		onGuardar,
		onClose
	}: Props = $props();

	interface FilaDia {
		clave: string;
		fecha: string;
		empresa: string;
		empresaColor: string | null;
		placa: string | null;
		horas: number;
		valor: number;
		disponibilidad: boolean;
		servicios: number;
	}

	/// Agrupa por fecha y cliente. `valor` es el de las horas de recargo a la
	/// tarifa de su cliente, calculado por el servidor.
	const filas = $derived.by<FilaDia[]>(() => {
		const porClave = new Map<string, FilaDia>();
		for (const d of dias) {
			const clave = claveMarcaDia(d.fecha, d.empresaId);
			const f = porClave.get(clave);
			if (f) {
				f.horas += d.totalHoras || 0;
				f.valor += d.valorRecargos ?? 0;
				f.servicios++;
				f.disponibilidad = f.disponibilidad && !!d.disponibilidad;
				continue;
			}
			porClave.set(clave, {
				clave,
				fecha: d.fecha,
				empresa: d.empresa ?? 'SIN EMPRESA',
				empresaColor: d.empresaColor ?? null,
				placa: d.placa ?? null,
				horas: d.totalHoras || 0,
				valor: d.valorRecargos ?? 0,
				disponibilidad: !!d.disponibilidad,
				servicios: 1
			});
		}
		return [...porClave.values()].sort(
			(a, b) => a.fecha.localeCompare(b.fecha) || a.empresa.localeCompare(b.empresa, 'es')
		);
	});

	/// Estado de trabajo, sembrado con lo que trae la hoja. Se edita aquí y solo
	/// sale al pulsar Guardar.
	let marcas = $state<MarcasDias>({});
	/// Lo que había al abrir, para saber si hay algo que guardar.
	let inicial_ = $state('');
	let sembrado = false;
	$effect(() => {
		if (sembrado) return;
		const inicial: MarcasDias = {};
		for (const d of dias) {
			if (!d.oculto && !d.noSuma) continue;
			inicial[claveMarcaDia(d.fecha, d.empresaId)] = {
				ocultar: !!d.oculto,
				noSumar: !!d.noSuma
			};
		}
		marcas = inicial;
		inicial_ = JSON.stringify(ordenar(inicial));
		sembrado = true;
	});

	const ordenar = (m: MarcasDias) =>
		Object.fromEntries(
			Object.entries(m)
				.filter(([, v]) => v.ocultar || v.noSumar)
				.sort(([a], [b]) => a.localeCompare(b))
		);

	const hayCambios = $derived(JSON.stringify(ordenar(marcas)) !== inicial_);

	function alternar(clave: string, campo: 'ocultar' | 'noSumar') {
		const actual = marcas[clave] ?? { ocultar: false, noSumar: false };
		marcas = { ...marcas, [clave]: { ...actual, [campo]: !actual[campo] } };
	}

	const noSumaTotal = $derived(
		filas
			.filter((f) => !f.disponibilidad && marcas[f.clave]?.noSumar)
			.reduce((s, f) => s + f.valor, 0)
	);
	const ocultos = $derived(filas.filter((f) => marcas[f.clave]?.ocultar).length);
	const noSuman = $derived(filas.filter((f) => marcas[f.clave]?.noSumar).length);

	const money = (v: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			maximumFractionDigits: 0
		}).format(v || 0);

	const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
	const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
	const fechaCorta = (iso: string) => {
		const d = new Date(`${iso}T12:00:00Z`);
		return `${DIAS_SEMANA[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MESES[d.getUTCMonth()]}`;
	};
	const horas = (h: number) => (Math.round(h * 100) / 100).toLocaleString('es-CO');

	function guardar() {
		if (bloqueada || guardando || !hayCambios) return;
		onGuardar(ordenar(marcas));
	}
</script>

<ModalBase
	open={true}
	eyebrow={nombreHoja}
	title="Días en el desprendible"
	subtitle="No mostrar quita el día de las tablas de recargos. No sumar lo deja en la tabla, en gris, pero su valor no se paga."
	tamano="lg"
	bloqueado={guardando}
	oncerrar={onClose}
>
	{#if bloqueada}
		<p class="bloqueo">{motivoBloqueo || 'Esta hoja no se puede editar.'}</p>
	{/if}

	<div class="tarjeta">
		{#if filas.length}
			<table class="tabla">
				<thead>
					<tr>
						<th>Día</th>
						<th>Empresa</th>
						<th class="num">Horas</th>
						<th class="num">Valor</th>
						<th class="toggle">No mostrar</th>
						<th class="toggle">No sumar</th>
					</tr>
				</thead>
				<tbody>
					{#each filas as f (f.clave)}
						{@const m = marcas[f.clave]}
						<tr class:oculta={m?.ocultar} class:nosuma={m?.noSumar}>
							<td class="fecha">
								{fechaCorta(f.fecha)}
								{#if f.servicios > 1}<span class="chip">{f.servicios} serv.</span>{/if}
							</td>
							<td class="empresa">
								<span class="punto" style:background={f.empresaColor ?? '#CBD5E1'}></span>
								<span class="nombre-empresa" title={f.empresa}>{f.empresa}</span>
								{#if f.disponibilidad}<span class="chip disp">Disponib.</span>{/if}
							</td>
							<td class="num">{horas(f.horas)}</td>
							<td class="num valor">{f.disponibilidad ? '—' : money(f.valor)}</td>
							<td class="toggle">
								<label class="switch" title="Quitar este día de las tablas de recargos">
									<input
										type="checkbox"
										checked={!!m?.ocultar}
										disabled={bloqueada || guardando}
										onchange={() => alternar(f.clave, 'ocultar')}
										aria-label="No mostrar el {fechaCorta(f.fecha)} de {f.empresa}"
									/>
									<span class="pista-switch"></span>
								</label>
							</td>
							<td class="toggle">
								<label
									class="switch"
									title={f.disponibilidad
										? 'Los días de disponibilidad ya no suman'
										: 'Mostrar el día pero no pagar su valor'}
								>
									<input
										type="checkbox"
										checked={!!m?.noSumar}
										disabled={bloqueada || guardando || f.disponibilidad}
										onchange={() => alternar(f.clave, 'noSumar')}
										aria-label="No sumar el {fechaCorta(f.fecha)} de {f.empresa}"
									/>
									<span class="pista-switch"></span>
								</label>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="vacio">Esta hoja no tiene días trabajados en el corte.</p>
		{/if}
	</div>

	{#snippet pie()}
		<div class="resumen">
			<span>{ocultos} {ocultos === 1 ? 'oculto' : 'ocultos'} · {noSuman} sin sumar</span>
			{#if noSumaTotal}
				<span class="resta">Deja de sumar <strong>{money(noSumaTotal)}</strong></span>
			{/if}
			<span class="nota">
				Si cambian los días que no suman, al guardar se rehacen los recargos de la hoja.
			</span>
		</div>
		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>
			Cancelar
		</button>
		<button
			type="button"
			class="btn-primary"
			onclick={guardar}
			disabled={bloqueada || guardando || !hayCambios}
		>
			{guardando ? 'Guardando…' : 'Guardar'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.tarjeta {
		padding: 4px 14px 8px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.bloqueo {
		margin: 0 0 12px;
		padding: 10px 12px;
		border-radius: 12px;
		background: rgba(217, 119, 6, 0.1);
		color: #92400e;
		font-size: 13px;
	}
	.tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		color: var(--text-primary);
	}
	.tabla thead th {
		position: sticky;
		top: 0;
		background: var(--bg-surface);
		text-align: left;
		font-size: 12px;
		color: var(--text-muted);
		font-weight: 700;
		padding: 10px 6px;
		border-bottom: 1px solid var(--border-subtle);
		z-index: 1;
	}
	.tabla td {
		padding: 8px 6px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: middle;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.valor {
		font-weight: 600;
		color: var(--text-primary);
	}
	.toggle {
		text-align: center;
		width: 5.5rem;
	}
	.fecha {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.empresa {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.nombre-empresa {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
	}
	.punto {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.chip {
		font-size: 0.62rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-muted);
		margin-left: 0.3rem;
		white-space: nowrap;
	}
	.chip.disp {
		background: #fee2e2;
		color: #b91c1c;
	}
	tr.nosuma .valor {
		color: var(--text-very-muted);
		text-decoration: line-through;
	}
	tr.oculta td:not(.toggle) {
		opacity: 0.45;
	}
	.switch {
		position: relative;
		display: inline-flex;
		cursor: pointer;
	}
	.switch input {
		position: absolute;
		opacity: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		cursor: pointer;
	}
	.pista-switch {
		width: 2.1rem;
		height: 1.2rem;
		border-radius: 999px;
		background: var(--border-default);
		position: relative;
		transition: background 0.15s ease;
	}
	.pista-switch::after {
		content: '';
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 999px;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: transform 0.15s ease;
	}
	.switch input:checked + .pista-switch {
		background: var(--accion);
	}
	.switch input:checked + .pista-switch::after {
		transform: translateX(0.9rem);
	}
	.switch input:focus-visible + .pista-switch {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}
	.switch input:disabled,
	.switch input:disabled + .pista-switch {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.vacio {
		margin: 0;
		padding: 1.2rem 0;
		text-align: center;
		font-size: 13px;
		color: var(--text-very-muted);
	}
	.resumen {
		flex: 1 1 220px;
		margin-right: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.resta strong {
		color: #b91c1c;
		font-variant-numeric: tabular-nums;
	}
	.nota {
		font-size: 11px;
		color: var(--text-very-muted);
	}
	@media (max-width: 36rem) {
		.nombre-empresa {
			max-width: 7rem;
		}
		.toggle {
			width: auto;
		}
	}
</style>
