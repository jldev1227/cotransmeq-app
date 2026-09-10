<!--
	Configuración de los GASTOS CALCULADOS de un periodo, para el canvas de
	cierres finales de terceros.

	Papelería y gastos diversos eran constantes de código iguales para todos los
	meses. Son tarifas del negocio —el porcentaje de gastos diversos se negocia
	periodo a periodo— así que se editan mes a mes desde aquí.

	Solo afecta a lo que se genere DESPUÉS. Un cierre ya liquidado tiene que
	seguir diciendo lo que se pagó, así que guardar aquí no reescribe importes
	de cierres existentes: para esos está el botón de «Aplicar» del modal de
	filas, que los añade con la tarifa vigente.

	Mismo patrón que `ModalConfigLiquidador`: el canvas no tiene tabs —su
	navegación es la sheet bar de Univer— así que la configuración vive en un
	modal. El guard lo aplica la page al decidir si lo monta.
-->
<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConfigGastosPeriodoDetalle
	} from '$lib/api/liquidaciones-terceros-descuentos';

	interface Props {
		open: boolean;
		anio: number;
		/// Mes activo del canvas. La config es de ESTE periodo, no del año.
		mes: number;
		periodo: string;
		onClose: () => void;
		/// Tras guardar, por si la page quiere refrescar algo que dependa de esto.
		onGuardado?: () => void;
	}

	let { open, anio, mes, periodo, onClose, onGuardado }: Props = $props();

	let cargando = $state(false);
	let guardando = $state(false);
	/// `false` mientras el periodo no tenga fila propia: lo que se ve son los
	/// valores heredados, no algo que alguien haya revisado.
	let configurado = $state(false);
	let form = $state({
		pct_gastos_diversos: 0.4,
		fijo_gastos_diversos: 20000,
		papeleria_alta: 25000,
		papeleria_baja: 20000,
		papeleria_umbral: 1000000
	});

	const COP = (v: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(v || 0);

	/// Ejemplo vivo con un facturado redondo, para que se vea qué hace el
	/// porcentaje sin tener que calcularlo de cabeza.
	const EJEMPLO_BASE = 10_000_000;
	const ejemploDiversos = $derived(
		form.fijo_gastos_diversos +
			Math.round((EJEMPLO_BASE * form.pct_gastos_diversos) / 100)
	);

	/// Periodo ya cargado, como `anio-mes`. Evita releer en cada repintado y
	/// fuerza la relectura cuando la sheet bar cambia el mes con el modal
	/// abierto, que es la única forma de que el periodo se mueva debajo.
	let periodoCargado: string | null = null;

	$effect(() => {
		if (!open) {
			periodoCargado = null;
			return;
		}
		const clave = `${anio}-${mes}`;
		if (periodoCargado === clave) return;
		periodoCargado = clave;
		void cargar();
	});

	async function cargar() {
		cargando = true;
		try {
			const d = await liquidacionesTercerosDescuentosAPI.obtenerConfigGastos(anio, mes);
			aplicar(d);
		} catch (e: any) {
			toast.error('No se pudo leer la configuración', {
				description: e?.response?.data?.error || e?.message || ''
			});
		} finally {
			cargando = false;
		}
	}

	function aplicar(d: ConfigGastosPeriodoDetalle) {
		configurado = d.configurado;
		form = {
			pct_gastos_diversos: Number(d.pct_gastos_diversos) || 0,
			fijo_gastos_diversos: Number(d.fijo_gastos_diversos) || 0,
			papeleria_alta: Number(d.papeleria_alta) || 0,
			papeleria_baja: Number(d.papeleria_baja) || 0,
			papeleria_umbral: Number(d.papeleria_umbral) || 0
		};
	}

	async function guardar() {
		guardando = true;
		try {
			const d = await liquidacionesTercerosDescuentosAPI.guardarConfigGastos(anio, mes, form);
			aplicar(d);
			toast.success(`Configuración de ${periodo} guardada.`, {
				description: 'Se aplica a los borradores que se generen a partir de ahora.'
			});
			onGuardado?.();
			onClose();
		} catch (e: any) {
			toast.error('No se pudo guardar', {
				description: e?.response?.data?.error || e?.message || ''
			});
		} finally {
			guardando = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<!-- El fondo solo cierra al pulsar FUERA de la caja; no es un control, así
	     que va como `presentation` y el teclado sale por Escape. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="mcg-bg"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onClose()}
	>
		<div class="mcg-box" role="dialog" aria-modal="true" aria-label="Gastos calculados del periodo">
			<header class="mcg-hd">
				<div>
					<h2>Gastos calculados · {periodo}</h2>
					<p>
						Valores de partida de papelería y gastos diversos para este mes. Solo afectan a
						los borradores que se generen después.
					</p>
				</div>
				<button class="mcg-x" onclick={onClose} aria-label="Cerrar">✕</button>
			</header>

			{#if cargando}
				<p class="mcg-cargando">Cargando configuración…</p>
			{:else}
				{#if !configurado}
					<p class="mcg-heredado">
						Este mes no tiene configuración propia: lo que ves son los valores heredados.
						Guardar creará la del periodo.
					</p>
				{/if}

				<h3 class="mcg-sec">Gastos diversos</h3>
				<p class="mcg-formula">
					fijo + porcentaje × (total facturado de los items + adicionales)
				</p>
				<div class="mcg-grid">
					<label class="mcg-field">
						<span>Porcentaje <em>0,4 es 0,4 %</em></span>
						<input type="number" step="0.01" min="0" max="100" bind:value={form.pct_gastos_diversos} />
					</label>
					<label class="mcg-field">
						<span>Parte fija</span>
						<input type="number" min="0" bind:value={form.fijo_gastos_diversos} />
					</label>
				</div>
				<p class="mcg-ejemplo">
					Con {COP(EJEMPLO_BASE)} facturados: <strong>{COP(ejemploDiversos)}</strong>
				</p>

				<h3 class="mcg-sec">Papelería</h3>
				<p class="mcg-formula">
					Tarifa por tramo. El umbral se compara contra el <strong>valor a liquidar</strong> del
					cierre —la suma de los items, antes de descuentos—, no contra el total a pagar:
					papelería es ella misma un descuento y sobre el total oscilaría.
				</p>
				<div class="mcg-grid">
					<label class="mcg-field">
						<span>Umbral</span>
						<input type="number" min="0" bind:value={form.papeleria_umbral} />
					</label>
					<label class="mcg-field">
						<span>Por encima del umbral</span>
						<input type="number" min="0" bind:value={form.papeleria_alta} />
					</label>
					<label class="mcg-field">
						<span>Hasta el umbral</span>
						<input type="number" min="0" bind:value={form.papeleria_baja} />
					</label>
				</div>

				<footer class="mcg-ft">
					<button class="mcg-btn" onclick={onClose} disabled={guardando}>Cancelar</button>
					<button class="mcg-btn mcg-btn-ok" onclick={guardar} disabled={guardando}>
						{guardando ? 'Guardando…' : 'Guardar configuración'}
					</button>
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.mcg-bg {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(15, 23, 42, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.mcg-box {
		width: min(620px, 100%);
		max-height: 88vh;
		overflow-y: auto;
		background: #fff;
		border-radius: 14px;
		box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
		padding: 20px 22px 18px;
	}
	.mcg-hd {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 6px;
	}
	.mcg-hd h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
	}
	.mcg-hd p {
		margin: 4px 0 0;
		font-size: 12px;
		color: #64748b;
		max-width: 46ch;
	}
	.mcg-x {
		border: none;
		background: transparent;
		font-size: 16px;
		color: #64748b;
		cursor: pointer;
		padding: 2px 6px;
	}
	.mcg-cargando {
		margin: 20px 0;
		font-size: 13px;
		color: #64748b;
	}
	.mcg-heredado {
		margin: 10px 0 0;
		padding: 8px 10px;
		border: 1px solid #fcd34d;
		background: #fffbeb;
		border-radius: 8px;
		font-size: 12px;
		color: #92400e;
	}
	.mcg-sec {
		margin: 18px 0 2px;
		font-size: 13px;
		font-weight: 700;
		color: #0f172a;
	}
	.mcg-formula {
		margin: 0 0 10px;
		font-size: 11.5px;
		color: #64748b;
	}
	.mcg-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
	}
	.mcg-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mcg-field span {
		font-size: 11.5px;
		font-weight: 600;
		color: #334155;
	}
	.mcg-field em {
		font-style: normal;
		font-weight: 400;
		color: #94a3b8;
	}
	.mcg-field input {
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 7px 10px;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.mcg-field input:focus {
		outline: none;
		border-color: #ea580c;
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.15);
	}
	.mcg-ejemplo {
		margin: 8px 0 0;
		font-size: 12px;
		color: #475569;
	}
	.mcg-ft {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 20px;
	}
	/* Botones propios y no `univer-btn`: esas clases están pensadas para la
	   barra OSCURA del canvas —texto blanco sobre fondo casi transparente— y
	   dentro de un modal blanco el de guardar quedaba invisible. */
	.mcg-btn {
		border: 1px solid #cbd5e1;
		background: #fff;
		color: #334155;
		font-size: 13px;
		font-weight: 600;
		border-radius: 9px;
		padding: 8px 16px;
		cursor: pointer;
	}
	.mcg-btn:hover:not(:disabled) {
		background: #f8fafc;
	}
	.mcg-btn-ok {
		border-color: #ea580c;
		background: #ea580c;
		color: #fff;
	}
	.mcg-btn-ok:hover:not(:disabled) {
		background: #c2410c;
	}
	.mcg-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
