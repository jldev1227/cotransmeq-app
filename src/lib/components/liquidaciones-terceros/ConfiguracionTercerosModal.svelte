<script lang="ts">
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConfiguracionDescuento,
		type ConfigGastosPeriodoDetalle,
		type ConfigValoresTercero
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import TabsVista, { type TabVista } from '$lib/components/ui/TabsVista.svelte';

	interface Props {
		open: boolean;
		anio: number;
		mes: number;
		onClose: () => void;
		onSaved?: () => void | Promise<void>;
	}

	let { open, anio, mes, onClose, onSaved }: Props = $props();

	type Seccion = 'impuestos' | 'prestaciones' | 'conductores' | 'gastos';
	const MESES = [
		'enero',
		'febrero',
		'marzo',
		'abril',
		'mayo',
		'junio',
		'julio',
		'agosto',
		'septiembre',
		'octubre',
		'noviembre',
		'diciembre'
	];
	const VALORES_INICIALES: ConfigValoresTercero = {
		valor_dia_conductor_nomina: 78629.9,
		valor_salario_manual: 69510,
		valor_auxilio_transporte_manual: 8303,
		valor_bonificacion_manual: 26061,
		valor_bonificacion_turno_doble_manual: 25000,
		valor_dotacion: 3985,
		valor_examen_medico: 2882
	};
	const GASTOS_INICIALES: ConfigGastosPeriodoDetalle = {
		anio: 2026,
		mes: 1,
		configurado: false,
		pct_gastos_diversos: 0.4,
		fijo_gastos_diversos: 20000,
		papeleria_alta: 25000,
		papeleria_baja: 20000,
		papeleria_umbral: 1000000
	};

	let seccion = $state<Seccion>('impuestos');
	let configuraciones = $state<ConfiguracionDescuento[]>([]);
	let valores = $state<ConfigValoresTercero>({ ...VALORES_INICIALES });
	let gastos = $state<ConfigGastosPeriodoDetalle>({ ...GASTOS_INICIALES });
	let cargando = $state(false);
	let guardando = $state(false);
	let error = $state('');
	let aviso = $state('');
	let turnoCarga = 0;

	const periodo = $derived(`${MESES[mes - 1] ?? mes} ${anio}`);
	const pestanas = $derived<TabVista[]>([
		{ id: 'impuestos', label: 'Impuestos' },
		{ id: 'prestaciones', label: 'Prestaciones y aportes' },
		{ id: 'conductores', label: 'Conductores' },
		{ id: 'gastos', label: 'Gastos del periodo' }
	]);
	const filasConfiguracion = $derived(
		configuraciones.filter((fila) =>
			seccion === 'impuestos'
				? fila.categoria === 'IMPUESTO'
				: fila.categoria === 'PRESTACION_SOCIAL' || fila.categoria === 'SEGURIDAD_SOCIAL'
		)
	);

	$effect(() => {
		if (open) void cargar();
		else turnoCarga++;
	});

	async function cargar() {
		const turno = ++turnoCarga;
		cargando = true;
		error = '';
		aviso = '';
		try {
			const [config, valoresRecibidos, gastosRecibidos] = await Promise.all([
				liquidacionesTercerosDescuentosAPI.obtenerConfiguracion(),
				liquidacionesTercerosDescuentosAPI.obtenerConfigValoresTercero(),
				liquidacionesTercerosDescuentosAPI.obtenerConfigGastos(anio, mes)
			]);
			if (turno !== turnoCarga) return;
			configuraciones = config.map((fila) => ({
				...fila,
				porcentaje: Number(fila.porcentaje) || 0
			}));
			valores = {
				valor_dia_conductor_nomina: Number(
					valoresRecibidos.valor_dia_conductor_nomina ??
						VALORES_INICIALES.valor_dia_conductor_nomina
				),
				valor_salario_manual: Number(
					valoresRecibidos.valor_salario_manual ?? VALORES_INICIALES.valor_salario_manual
				),
				valor_auxilio_transporte_manual: Number(
					valoresRecibidos.valor_auxilio_transporte_manual ??
						VALORES_INICIALES.valor_auxilio_transporte_manual
				),
				valor_bonificacion_manual: Number(
					valoresRecibidos.valor_bonificacion_manual ?? VALORES_INICIALES.valor_bonificacion_manual
				),
				valor_bonificacion_turno_doble_manual: Number(
					valoresRecibidos.valor_bonificacion_turno_doble_manual ??
						VALORES_INICIALES.valor_bonificacion_turno_doble_manual
				),
				valor_dotacion: Number(valoresRecibidos.valor_dotacion ?? VALORES_INICIALES.valor_dotacion),
				valor_examen_medico: Number(
					valoresRecibidos.valor_examen_medico ?? VALORES_INICIALES.valor_examen_medico
				)
			};
			gastos = {
				...gastosRecibidos,
				pct_gastos_diversos: Number(gastosRecibidos.pct_gastos_diversos),
				fijo_gastos_diversos: Number(gastosRecibidos.fijo_gastos_diversos),
				papeleria_alta: Number(gastosRecibidos.papeleria_alta),
				papeleria_baja: Number(gastosRecibidos.papeleria_baja),
				papeleria_umbral: Number(gastosRecibidos.papeleria_umbral)
			};
		} catch (e: any) {
			if (turno === turnoCarga) {
				error = e?.response?.data?.error || e?.message || 'No se pudo cargar la configuración.';
			}
		} finally {
			if (turno === turnoCarga) cargando = false;
		}
	}

	function valoresValidos() {
		return Object.values(valores).every(
			(valor) => Number.isFinite(Number(valor)) && Number(valor) >= 0
		);
	}

	function gastosValidos() {
		const campos = [
			gastos.pct_gastos_diversos,
			gastos.fijo_gastos_diversos,
			gastos.papeleria_alta,
			gastos.papeleria_baja,
			gastos.papeleria_umbral
		];
		return (
			campos.every((valor) => Number.isFinite(Number(valor)) && Number(valor) >= 0) &&
			gastos.pct_gastos_diversos <= 100
		);
	}

	async function guardar() {
		if (cargando || guardando) return;
		if (
			!valoresValidos() ||
			!gastosValidos() ||
			configuraciones.some(
				(fila) => !Number.isFinite(Number(fila.porcentaje)) || Number(fila.porcentaje) < 0
			)
		) {
			error =
				'Revisa los valores: deben ser números iguales o mayores que cero. El porcentaje de gastos diversos no puede superar 100.';
			return;
		}

		guardando = true;
		error = '';
		aviso = '';
		try {
			await Promise.all([
				liquidacionesTercerosDescuentosAPI.actualizarConfiguracion(
					configuraciones.map((fila) => ({
						concepto: fila.concepto,
						porcentaje: Number(fila.porcentaje),
						base_calculo: fila.base_calculo
					}))
				),
				liquidacionesTercerosDescuentosAPI.guardarConfigValoresTercero(valores),
				liquidacionesTercerosDescuentosAPI.guardarConfigGastos(anio, mes, {
					pct_gastos_diversos: Number(gastos.pct_gastos_diversos),
					fijo_gastos_diversos: Number(gastos.fijo_gastos_diversos),
					papeleria_alta: Number(gastos.papeleria_alta),
					papeleria_baja: Number(gastos.papeleria_baja),
					papeleria_umbral: Number(gastos.papeleria_umbral)
				})
			]);
			gastos = { ...gastos, configurado: true };
			aviso =
				'Configuración guardada. Se aplicará a los borradores nuevos y a los recálculos posteriores.';
			await onSaved?.();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'No se pudo guardar la configuración.';
		} finally {
			guardando = false;
		}
	}

	function formatoCOP(valor: number) {
		return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(valor);
	}
</script>

<ModalBase
	{open}
	eyebrow="Liquidaciones de terceros"
	title="Configuración de conceptos"
	subtitle="Tarifas, prestaciones e impuestos · gastos del periodo {periodo}"
	tamano="xl"
	cerrarAlFondo={false}
	bloqueado={guardando}
	oncerrar={onClose}
>
	{#snippet cabecera()}
		<TabsVista
			tabs={pestanas}
			activa={seccion}
			variante="oscuro"
			etiqueta="Configuración de liquidaciones de terceros"
			onCambiar={(id) => (seccion = id as Seccion)}
		/>
	{/snippet}

	<div class="ctm-cuerpo">
		{#if cargando}
			<p class="ctm-estado">Cargando la configuración…</p>
		{:else if seccion === 'impuestos' || seccion === 'prestaciones'}
			{#if seccion === 'prestaciones'}
				<p class="ctm-nota">
					Edita los porcentajes de prestaciones sociales y seguridad social. La base de cada
					concepto se muestra como referencia de la regla vigente.
				</p>
			{/if}
			<div class="ctm-tabla-wrap">
				<table class="ctm-tabla">
					<thead>
						<tr><th>Concepto</th><th>Base de cálculo</th><th class="ctm-num">Porcentaje</th></tr>
					</thead>
					<tbody>
						{#each filasConfiguracion as fila (fila.concepto)}
							<tr>
								<td
									><strong>{fila.nombre}</strong><small>{fila.concepto.replace(/_/g, ' ')}</small
									></td
								>
								<td
									><span class="ctm-base" title={fila.base_calculo}
										>{fila.base_calculo.replace(/_/g, ' ')}</span
									></td
								>
								<td class="ctm-num">
									<label class="ctm-porcentaje">
										<input
											type="number"
											min="0"
											step="0.0001"
											bind:value={fila.porcentaje}
											disabled={guardando}
											aria-label="Porcentaje de {fila.nombre}"
										/>
										<span>%</span>
									</label>
								</td>
							</tr>
						{:else}
							<tr
								><td colspan="3" class="ctm-vacio">No hay conceptos activos en esta sección.</td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if seccion === 'conductores'}
			<p class="ctm-nota">
				Valores unitarios usados al sincronizar conductores o al crear el bloque manual desde el
				cierre.
			</p>
			<div class="ctm-grid">
				<label
					><span>Salario diario desde nómina</span><small
						>Tarifa usada en la sincronización de nómina.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_dia_conductor_nomina}
						disabled={guardando}
					/></label
				>
				<label
					><span>Salario diario inicial manual</span><small
						>Tarifa del bloque creado manualmente.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_salario_manual}
						disabled={guardando}
					/></label
				>
				<label
					><span>Auxilio de transporte diario</span><small>Valor por día para altas manuales.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_auxilio_transporte_manual}
						disabled={guardando}
					/></label
				>
				<label
					><span>Bonificación unitaria</span><small>Tarifa inicial cuando nómina no trae una.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_bonificacion_manual}
						disabled={guardando}
					/></label
				>
				<label
					><span>Turno doble unitario</span><small>Tarifa inicial de la fila de turno doble.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_bonificacion_turno_doble_manual}
						disabled={guardando}
					/></label
				>
			</div>
		{:else}
			<div class="ctm-periodo">
				<strong>Gastos calculados para {periodo}</strong>
				<span class:ctm-etiqueta-nueva={!gastos.configurado}
					>{gastos.configurado ? 'Configurado' : 'Usa los valores de respaldo'}</span
				>
			</div>
			<p class="ctm-nota">
				El porcentaje de gastos diversos se expresa en puntos porcentuales: 0,4 equivale a 0,4%.
			</p>
			<div class="ctm-grid">
				<label
					><span>Dotación por día</span><small
						>Tarifa automática por día laborado no propietario.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_dotacion}
						disabled={guardando}
					/></label
				>
				<label
					><span>Examen médico por día</span><small
						>Tarifa automática por día laborado no propietario.</small
					><input
						type="number"
						min="0"
						step="0.01"
						bind:value={valores.valor_examen_medico}
						disabled={guardando}
					/></label
				>
				<label
					><span>Gastos diversos: porcentaje</span><small
						>Actualmente {gastos.pct_gastos_diversos}% de la base.</small
					><input
						type="number"
						min="0"
						max="100"
						step="0.0001"
						bind:value={gastos.pct_gastos_diversos}
						disabled={guardando}
					/></label
				>
				<label
					><span>Gastos diversos: fijo</span><small>Valor fijo sumado al porcentaje.</small><input
						type="number"
						min="0"
						step="100"
						bind:value={gastos.fijo_gastos_diversos}
						disabled={guardando}
					/></label
				>
				<label
					><span>Papelería: tarifa alta</span><small
						>Cuando el valor a liquidar supera el umbral.</small
					><input
						type="number"
						min="0"
						step="100"
						bind:value={gastos.papeleria_alta}
						disabled={guardando}
					/></label
				>
				<label
					><span>Papelería: tarifa baja</span><small
						>Cuando el valor a liquidar no supera el umbral.</small
					><input
						type="number"
						min="0"
						step="100"
						bind:value={gastos.papeleria_baja}
						disabled={guardando}
					/></label
				>
				<label
					><span>Umbral de papelería</span><small>El tramo alto aplica si el valor es mayor.</small
					><input
						type="number"
						min="0"
						step="1000"
						bind:value={gastos.papeleria_umbral}
						disabled={guardando}
					/></label
				>
			</div>
		{/if}

		{#if error}<p class="ctm-error" role="alert">{error}</p>{/if}
		{#if aviso}<p class="ctm-aviso" role="status">{aviso}</p>{/if}
	</div>

	{#snippet pie()}
		{#if seccion === 'gastos'}
			<small class="ctm-resumen"
				>Dotación {formatoCOP(valores.valor_dotacion)} · Examen {formatoCOP(
					valores.valor_examen_medico
				)}</small
			>
		{/if}
		<button class="btn-secondary" type="button" onclick={onClose} disabled={guardando}
			>Cerrar</button
		>
		<button class="btn-primary" type="button" onclick={guardar} disabled={cargando || guardando}>
			{guardando ? 'Guardando…' : 'Guardar configuración'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.ctm-cuerpo {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.ctm-estado,
	.ctm-vacio {
		padding: 24px;
		text-align: center;
		color: var(--text-secondary);
	}
	.ctm-nota {
		margin: 0;
		color: var(--text-secondary);
		font-size: 13px;
		line-height: 1.5;
	}
	.ctm-tabla-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
	}
	.ctm-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		color: var(--text-primary);
	}
	.ctm-tabla th {
		padding: 11px 14px;
		text-align: left;
		background: var(--bg-subtle, var(--bg-base));
		color: var(--text-secondary);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.ctm-tabla td {
		padding: 12px 14px;
		border-top: 1px solid var(--border-subtle);
	}
	.ctm-tabla td strong,
	.ctm-tabla td small {
		display: block;
	}
	.ctm-tabla td small {
		margin-top: 3px;
		color: var(--text-secondary);
		font-size: 11px;
	}
	.ctm-num {
		text-align: right !important;
	}
	.ctm-base {
		color: var(--text-secondary);
		font-size: 12px;
	}
	.ctm-porcentaje {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.ctm-porcentaje input {
		width: 120px;
		text-align: right;
	}
	.ctm-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 12px;
	}
	.ctm-grid label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		background: var(--bg-surface);
	}
	.ctm-grid label > span {
		font-size: 13px;
		font-weight: 750;
		color: var(--text-primary);
	}
	.ctm-grid label > small {
		min-height: 30px;
		color: var(--text-secondary);
		font-size: 11px;
		line-height: 1.4;
	}
	.ctm-grid input,
	.ctm-porcentaje input {
		min-height: 38px;
		padding: 8px 10px;
		border: 1px solid var(--border-default);
		border-radius: 9px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
	}
	.ctm-grid input:focus,
	.ctm-porcentaje input:focus {
		outline: 2px solid var(--accion);
		outline-offset: 1px;
	}
	.ctm-grid input:disabled,
	.ctm-porcentaje input:disabled {
		opacity: 0.6;
	}
	.ctm-periodo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: var(--text-primary);
	}
	.ctm-periodo span {
		padding: 5px 9px;
		border-radius: 999px;
		background: var(--bg-subtle, var(--bg-base));
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 700;
	}
	.ctm-periodo .ctm-etiqueta-nueva {
		color: var(--accion);
	}
	.ctm-error,
	.ctm-aviso {
		margin: 0;
		padding: 10px 12px;
		border-radius: 10px;
		font-size: 13px;
	}
	.ctm-error {
		background: #fef2f2;
		color: #b42318;
	}
	.ctm-aviso {
		background: color-mix(in srgb, var(--accion) 10%, white);
		color: var(--accion-hover);
	}
	.ctm-resumen {
		margin-right: auto;
		color: var(--text-secondary);
		font-size: 11px;
	}
	@media (max-width: 640px) {
		.ctm-tabla th,
		.ctm-tabla td {
			padding: 9px 10px;
		}
		.ctm-porcentaje input {
			width: 92px;
		}
		.ctm-resumen {
			display: none;
		}
	}
</style>
