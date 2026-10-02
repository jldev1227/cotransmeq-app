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
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
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
</script>

<ModalBase
	{open}
	title="Gastos calculados · {periodo}"
	eyebrow="Configuración del periodo"
	subtitle="Valores de partida de papelería y gastos diversos para este mes. Solo afectan a los borradores que se generen después."
	tamano="md"
	bloqueado={guardando}
	oncerrar={onClose}
>
	{#if cargando}
		<p class="mcg-cargando">Cargando configuración…</p>
	{:else}
		{#if !configurado}
			<p class="mcg-heredado">
				Este mes no tiene configuración propia: lo que ves son los valores heredados. Guardar
				creará la del periodo.
			</p>
		{/if}

		<section class="mcg-card">
			<h3 class="mcg-sec">Gastos diversos</h3>
			<p class="mcg-formula">fijo + porcentaje × (total facturado de los items + adicionales)</p>
			<div class="mcg-grid">
				<label class="mcg-field">
					<span>Porcentaje <em>0,4 es 0,4 %</em></span>
					<input
						class="mcg-input"
						type="number"
						step="0.01"
						min="0"
						max="100"
						bind:value={form.pct_gastos_diversos}
					/>
				</label>
				<label class="mcg-field">
					<span>Parte fija</span>
					<input class="mcg-input" type="number" min="0" bind:value={form.fijo_gastos_diversos} />
				</label>
			</div>
			<p class="mcg-ejemplo">
				Con {COP(EJEMPLO_BASE)} facturados: <strong>{COP(ejemploDiversos)}</strong>
			</p>
		</section>

		<section class="mcg-card">
			<h3 class="mcg-sec">Papelería</h3>
			<p class="mcg-formula">
				Tarifa por tramo. El umbral se compara contra el <strong>valor a liquidar</strong> del cierre
				—la suma de los items, antes de descuentos—, no contra el total a pagar: papelería es ella
				misma un descuento y sobre el total oscilaría.
			</p>
			<div class="mcg-grid">
				<label class="mcg-field">
					<span>Umbral</span>
					<input class="mcg-input" type="number" min="0" bind:value={form.papeleria_umbral} />
				</label>
				<label class="mcg-field">
					<span>Por encima del umbral</span>
					<input class="mcg-input" type="number" min="0" bind:value={form.papeleria_alta} />
				</label>
				<label class="mcg-field">
					<span>Hasta el umbral</span>
					<input class="mcg-input" type="number" min="0" bind:value={form.papeleria_baja} />
				</label>
			</div>
		</section>
	{/if}

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>Cancelar</button>
		<button type="button" class="btn-primary" onclick={guardar} disabled={guardando || cargando}>
			{guardando ? 'Guardando…' : 'Guardar configuración'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mcg-cargando {
		margin: 20px 0;
		text-align: center;
		font-size: 13px;
		color: var(--text-muted);
	}
	/* Aviso de estado (valores heredados): ámbar de estado, no de marca. */
	.mcg-heredado {
		margin: 0 0 14px;
		padding: 10px 12px;
		border: 1px solid #fcd34d;
		background: #fffbeb;
		border-radius: 12px;
		font-size: 12.5px;
		color: #92400e;
	}
	.mcg-card {
		padding: 16px 18px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.mcg-card + .mcg-card {
		margin-top: 14px;
	}
	.mcg-sec {
		margin: 0 0 4px;
		font-size: 14px;
		font-weight: 800;
		color: var(--text-primary);
	}
	.mcg-formula {
		margin: 0 0 12px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
	}
	.mcg-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
	}
	.mcg-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mcg-field span {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mcg-field em {
		font-style: normal;
		font-weight: 500;
		color: var(--text-muted);
	}
	.mcg-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}
	.mcg-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mcg-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.mcg-ejemplo {
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--text-secondary);
	}
	.mcg-ejemplo strong {
		color: var(--text-primary);
	}
</style>
