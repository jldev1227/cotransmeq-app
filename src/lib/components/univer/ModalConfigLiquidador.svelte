<!--
	Modal de CONFIGURACIÓN DEL LIQUIDADOR para el canvas de historial.

	Es el tab «Configuración» del listado clásico convertido en modal: mismos
	ocho campos contra GET/PUT /liquidaciones-servicios/config-liquidador.
	Vive como modal porque el canvas no tiene tabs — su navegación es la sheet
	bar de Univer, y la configuración no es una hoja de datos.

	El guard (admin u operaciones) lo aplica la page al decidir si monta el
	modal; aquí no se re-verifica porque el backend es quien manda de verdad.
-->
<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		liquidacionesServiciosAPI,
		type ConfigLiquidadorServicio
	} from '$lib/api/liquidaciones-servicios';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let cargando = $state(false);
	let guardando = $state(false);
	let form = $state({
		salario_basico: 0,
		cargo: '',
		valor_hora_override: 0,
		conductor_adicional: 0,
		pct_seg_social: 0,
		pct_prestaciones: 0,
		pct_admin: 0,
		prueba_covid: 0
	});

	const COP = (v: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(v || 0);

	/// 235 horas/mes: la misma convención del tab clásico para derivar el
	/// valor hora cuando no hay override.
	const valorHoraAuto = $derived(
		form.salario_basico > 0 ? +(form.salario_basico / 235).toFixed(4) : 0
	);

	let cargadoParaSesion = false;

	$effect(() => {
		if (open && !cargadoParaSesion) {
			cargadoParaSesion = true;
			cargar();
		}
		if (!open) cargadoParaSesion = false;
	});

	async function cargar() {
		cargando = true;
		try {
			const d = await liquidacionesServiciosAPI.obtenerConfigLiquidador();
			form = {
				salario_basico: Number(d.salario_basico) || 0,
				cargo: d.cargo ?? '',
				valor_hora_override: Number(d.valor_hora_override) || 0,
				conductor_adicional: Number(d.conductor_adicional) || 0,
				pct_seg_social: Number(d.pct_seg_social) || 0,
				pct_prestaciones: Number(d.pct_prestaciones) || 0,
				pct_admin: Number(d.pct_admin) || 0,
				prueba_covid: Number(d.prueba_covid) || 0
			};
		} catch (e: any) {
			toast.error('No se pudo cargar la configuración: ' + (e?.message || ''));
		} finally {
			cargando = false;
		}
	}

	async function guardar() {
		if (guardando) return;
		guardando = true;
		try {
			await liquidacionesServiciosAPI.actualizarConfigLiquidador(
				form as Partial<Omit<ConfigLiquidadorServicio, 'id'>>
			);
			toast.success('Configuración guardada');
			onClose();
		} catch (e: any) {
			toast.error('No se pudo guardar: ' + (e?.message || ''));
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
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="mcl-bg" onclick={(e) => e.target === e.currentTarget && onClose()}>
		<div class="mcl-box" role="dialog" aria-modal="true" aria-label="Configuración del liquidador">
			<header class="mcl-hd">
				<div>
					<h2>Configuración del liquidador</h2>
					<p>Parámetros base para el cálculo de servicios de transporte.</p>
				</div>
				<button class="mcl-x" onclick={onClose} aria-label="Cerrar">✕</button>
			</header>

			{#if cargando}
				<p class="mcl-cargando">Cargando configuración…</p>
			{:else}
				<div class="mcl-grid">
					<label class="mcl-field">
						<span>Salario básico <em>SMLV vigente</em></span>
						<input type="number" min="0" bind:value={form.salario_basico} />
					</label>
					<label class="mcl-field">
						<span>Cargo</span>
						<input type="text" bind:value={form.cargo} placeholder="Ej. Conductor" />
					</label>
					<label class="mcl-field">
						<span>Valor hora override <em>0 = auto ({COP(valorHoraAuto)})</em></span>
						<input type="number" min="0" bind:value={form.valor_hora_override} />
					</label>
					<label class="mcl-field">
						<span>Conductor adicional</span>
						<input type="number" min="0" bind:value={form.conductor_adicional} />
					</label>
					<label class="mcl-field">
						<span>% Seguridad social</span>
						<input type="number" step="0.01" bind:value={form.pct_seg_social} />
					</label>
					<label class="mcl-field">
						<span>% Prestaciones</span>
						<input type="number" step="0.01" bind:value={form.pct_prestaciones} />
					</label>
					<label class="mcl-field">
						<span>% Admin</span>
						<input type="number" step="0.01" bind:value={form.pct_admin} />
					</label>
					<label class="mcl-field">
						<span>Prueba covid <em>0 = sin cobro</em></span>
						<input type="number" min="0" bind:value={form.prueba_covid} />
					</label>
				</div>

				<footer class="mcl-ft">
					<button class="univer-btn" onclick={onClose} disabled={guardando}>Cancelar</button>
					<button class="univer-btn univer-btn-dark" onclick={guardar} disabled={guardando}>
						{guardando ? 'Guardando…' : 'Guardar configuración'}
					</button>
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.mcl-bg {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(15, 23, 42, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.mcl-box {
		width: min(680px, 100%);
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(2, 6, 23, 0.35);
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.mcl-hd {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.mcl-hd h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
	}
	.mcl-hd p {
		margin: 2px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.mcl-x {
		border: none;
		background: transparent;
		font-size: 14px;
		color: #64748b;
		cursor: pointer;
		padding: 4px;
	}
	.mcl-cargando {
		margin: 0;
		padding: 24px 0;
		text-align: center;
		font-size: 13px;
		color: #64748b;
	}
	.mcl-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 10px 14px;
	}
	.mcl-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mcl-field span {
		font-size: 11px;
		font-weight: 600;
		color: #334155;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.mcl-field em {
		font-style: normal;
		font-weight: 400;
		text-transform: none;
		color: #94a3b8;
	}
	.mcl-field input {
		height: 32px;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 0 8px;
		font-size: 13px;
	}
	.mcl-ft {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		border-top: 1px dashed #e2e8f0;
		padding-top: 12px;
	}
</style>
