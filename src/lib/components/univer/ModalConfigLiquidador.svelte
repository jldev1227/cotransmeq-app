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
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
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
</script>

<ModalBase
	{open}
	title="Configuración del liquidador"
	eyebrow="Liquidación de servicios"
	subtitle="Parámetros base para el cálculo de servicios de transporte."
	tamano="md"
	bloqueado={guardando}
	oncerrar={onClose}
>
	{#if cargando}
		<p class="mcl-cargando">Cargando configuración…</p>
	{:else}
		<div class="mcl-card">
			<div class="mcl-grid">
				<label class="mcl-field">
					<span>Salario básico <em>SMLV vigente</em></span>
					<input class="mcl-input" type="number" min="0" bind:value={form.salario_basico} />
				</label>
				<label class="mcl-field">
					<span>Cargo</span>
					<input class="mcl-input" type="text" bind:value={form.cargo} placeholder="Ej. Conductor" />
				</label>
				<label class="mcl-field">
					<span>Valor hora override <em>0 = auto ({COP(valorHoraAuto)})</em></span>
					<input class="mcl-input" type="number" min="0" bind:value={form.valor_hora_override} />
				</label>
				<label class="mcl-field">
					<span>Conductor adicional</span>
					<input class="mcl-input" type="number" min="0" bind:value={form.conductor_adicional} />
				</label>
				<label class="mcl-field">
					<span>% Seguridad social</span>
					<input class="mcl-input" type="number" step="0.01" bind:value={form.pct_seg_social} />
				</label>
				<label class="mcl-field">
					<span>% Prestaciones</span>
					<input class="mcl-input" type="number" step="0.01" bind:value={form.pct_prestaciones} />
				</label>
				<label class="mcl-field">
					<span>% Admin</span>
					<input class="mcl-input" type="number" step="0.01" bind:value={form.pct_admin} />
				</label>
				<label class="mcl-field">
					<span>Prueba covid <em>0 = sin cobro</em></span>
					<input class="mcl-input" type="number" min="0" bind:value={form.prueba_covid} />
				</label>
			</div>
		</div>
	{/if}

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>Cancelar</button>
		<button type="button" class="btn-primary" onclick={guardar} disabled={guardando || cargando}>
			{guardando ? 'Guardando…' : 'Guardar configuración'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mcl-cargando {
		margin: 0;
		padding: 24px 0;
		text-align: center;
		font-size: 13px;
		color: var(--text-muted);
	}
	.mcl-card {
		padding: 18px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.mcl-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 14px 16px;
	}
	.mcl-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mcl-field span {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mcl-field em {
		font-style: normal;
		font-weight: 500;
		color: var(--text-muted);
	}
	.mcl-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 14px;
	}
	.mcl-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mcl-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}
</style>
