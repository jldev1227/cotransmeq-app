<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Select from 'svelte-select';
	import { obtenerConductores } from '$lib/api/nomina';
	import type { Conductor, Prima, CreatePrimaPayload } from '$lib/types/nomina';
	import { Save, User, FileText, Calendar } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { toast } from 'svelte-sonner';

	// Props
	export let show = false;
	export let prima: Prima | null = null;
	export let onClose: () => void = () => {};
	export let onSubmit: (payload: CreatePrimaPayload) => Promise<void>;
	export let loading = false;

	// Catálogo
	let conductores: Conductor[] = [];
	let loadingConductores = true;

	// Estado del formulario
	let conductorSelected: { value: string; label: string } | null = null;
	let mes: number | null = null;
	let anio: number = new Date().getFullYear();
	let primaValor: number = 0;
	let primaPendiente: number | null = null;
	let estado: 'Pendiente' | 'Pagado' = 'Pendiente';
	let observaciones = '';

	// Campos manuales del desprendible
	let tiempo_trabajado_dias: number | null = null;
	let sueldo_basico: number | null = null;
	let auxilio_transporte: number | null = null;
	let sueldo_variable: number | null = null;
	let total_base_liquidacion: number | null = null;

	// Errores
	let errors: Record<string, string> = {};

	const MESES = [
		{ valor: 1, nombre: 'Enero' },
		{ valor: 2, nombre: 'Febrero' },
		{ valor: 3, nombre: 'Marzo' },
		{ valor: 4, nombre: 'Abril' },
		{ valor: 5, nombre: 'Mayo' },
		{ valor: 6, nombre: 'Junio' },
		{ valor: 7, nombre: 'Julio' },
		{ valor: 8, nombre: 'Agosto' },
		{ valor: 9, nombre: 'Septiembre' },
		{ valor: 10, nombre: 'Octubre' },
		{ valor: 11, nombre: 'Noviembre' },
		{ valor: 12, nombre: 'Diciembre' }
	];

	$: conductoresOptions = [...conductores]
		.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
		.map((c) => ({
			value: c.id,
			label: `${c.nombre || ''} ${c.apellido || ''}`.trim()
		}));

	$: if (show) {
		loadConductores();
		if (prima) {
			cargarDatosIniciales();
		} else {
			resetForm();
		}
	}

	async function loadConductores() {
		try {
			loadingConductores = true;
			const res = await obtenerConductores();
			conductores = res.data || [];
		} catch (e) {
			console.error('Error cargando conductores', e);
			toast.error('Error al cargar conductores');
		} finally {
			loadingConductores = false;
		}
	}

	function cargarDatosIniciales() {
		if (!prima) return;
		conductorSelected =
			conductoresOptions.find((c) => c.value === prima!.conductor_id) || null;
		mes = prima.mes;
		anio = prima.anio;
		primaValor = Number(prima.prima) || 0;
		primaPendiente = prima.prima_pendiente ?? null;
		estado = prima.estado || 'Pendiente';
		observaciones = prima.observaciones || '';
		tiempo_trabajado_dias = prima.tiempo_trabajado_dias ?? null;
		sueldo_basico = prima.sueldo_basico ? Number(prima.sueldo_basico) : null;
		auxilio_transporte = prima.auxilio_transporte ? Number(prima.auxilio_transporte) : null;
		sueldo_variable = prima.sueldo_variable ? Number(prima.sueldo_variable) : null;
		total_base_liquidacion = prima.total_base_liquidacion
			? Number(prima.total_base_liquidacion)
			: null;
	}

	function resetForm() {
		conductorSelected = null;
		mes = null;
		anio = new Date().getFullYear();
		primaValor = 0;
		primaPendiente = null;
		estado = 'Pendiente';
		observaciones = '';
		tiempo_trabajado_dias = null;
		sueldo_basico = null;
		auxilio_transporte = null;
		sueldo_variable = null;
		total_base_liquidacion = null;
		errors = {};
	}

	function validar(): boolean {
		const errs: Record<string, string> = {};
		if (!conductorSelected) errs.conductor = 'Seleccione un conductor';
		if (!mes) errs.mes = 'Seleccione un mes';
		if (!anio || anio < 2000 || anio > 2100) errs.anio = 'Año inválido';
		if (!primaValor || primaValor <= 0) errs.prima = 'El valor de la prima debe ser mayor a 0';
		errors = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleSubmit() {
		if (!validar()) {
			toast.error('Complete los campos requeridos');
			return;
		}
		const payload: CreatePrimaPayload = {
			conductor_id: conductorSelected!.value,
			mes: mes!,
			anio: anio,
			prima: primaValor,
			prima_pendiente: primaPendiente,
			estado,
			observaciones: observaciones.trim() || null,
			tiempo_trabajado_dias,
			sueldo_basico,
			auxilio_transporte,
			sueldo_variable,
			total_base_liquidacion
		};
		await onSubmit(payload);
	}

	function close() {
		resetForm();
		onClose();
	}

	function formatCOPInput(value: number | null | undefined): string {
		if (!value && value !== 0) return '';
		return new Intl.NumberFormat('es-CO').format(Math.round(value));
	}

	function parseCOPInput(text: string): number {
		const cleaned = text.replace(/[^\d-]/g, '');
		return parseInt(cleaned) || 0;
	}

	function handleCOPFocus(e: FocusEvent) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = parseCOPInput(input.value);
		input.value = raw ? raw.toString() : '';
		input.select();
	}

	function handleCOPBlur(e: FocusEvent) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = parseCOPInput(input.value);
		input.value = raw ? '$ ' + formatCOPInput(raw) : '';
	}
</script>

<ModalBase
	open={show}
	eyebrow="Primas"
	title={prima ? 'Editar Prima' : 'Nueva Prima'}
	subtitle={prima
		? 'Modifique los datos de la prima'
		: 'Registre una prima independiente del desprendible de nómina'}
	tamano="md"
	bloqueado={loading}
	oncerrar={close}
>
	<div class="pf-cuerpo">
		<div class="pf-tarjeta">
			<!-- Conductor -->
			<div class="pf-campo">
				<label for="conductor" class="pf-label">
					Conductor <span class="pf-req">*</span>
				</label>
				<Select
					items={conductoresOptions}
					bind:value={conductorSelected}
					placeholder={loadingConductores ? 'Cargando conductores...' : 'Buscar conductor...'}
					searchable={true}
					clearable={false}
					disabled={loadingConductores}
					--border-radius="12px"
					--border="1px solid var(--border-default)"
					--border-focused="1px solid var(--accion)"
					--border-hover="1px solid var(--border-default)"
					--padding="0 12px"
					--height="42px"
					--font-size="14px"
					--item-is-active-bg="var(--accion)"
				/>
				{#if errors.conductor}
					<p class="pf-error">{errors.conductor}</p>
				{/if}
			</div>

			<!-- Mes y Año -->
			<div class="pf-grid">
				<div class="pf-campo">
					<label for="mes" class="pf-label">Mes <span class="pf-req">*</span></label>
					<select id="mes" class="pf-input" bind:value={mes}>
						<option value={null}>— Seleccione —</option>
						{#each MESES as m}
							<option value={m.valor}>{m.nombre}</option>
						{/each}
					</select>
					{#if errors.mes}
						<p class="pf-error">{errors.mes}</p>
					{/if}
				</div>
				<div class="pf-campo">
					<label for="anio" class="pf-label">Año <span class="pf-req">*</span></label>
					<input id="anio" class="pf-input" type="number" bind:value={anio} min="2000" max="2100" />
					{#if errors.anio}
						<p class="pf-error">{errors.anio}</p>
					{/if}
				</div>
			</div>

			<!-- Prima y Prima Pendiente -->
			<div class="pf-grid">
				<div class="pf-campo">
					<label for="prima-valor" class="pf-label">
						Valor Prima <span class="pf-req">*</span>
					</label>
					<input
						id="prima-valor"
						class="pf-input"
						type="text"
						inputmode="numeric"
						placeholder="$ 0"
						value={primaValor ? '$ ' + formatCOPInput(primaValor) : ''}
						on:focus={handleCOPFocus}
						on:blur={handleCOPBlur}
						on:input={(e) => (primaValor = parseCOPInput(e.currentTarget.value))}
					/>
					{#if errors.prima}
						<p class="pf-error">{errors.prima}</p>
					{/if}
				</div>
				<div class="pf-campo">
					<label for="prima-pendiente" class="pf-label">Prima Pendiente (opcional)</label>
					<input
						id="prima-pendiente"
						class="pf-input"
						type="text"
						inputmode="numeric"
						placeholder="$ 0"
						value={primaPendiente ? '$ ' + formatCOPInput(primaPendiente) : ''}
						on:focus={handleCOPFocus}
						on:blur={handleCOPBlur}
						on:input={(e) => (primaPendiente = parseCOPInput(e.currentTarget.value) || null)}
					/>
				</div>
			</div>

			<!-- Estado -->
			<div class="pf-campo">
				<label for="estado" class="pf-label">Estado <span class="pf-req">*</span></label>
				<select id="estado" class="pf-input" bind:value={estado}>
					<option value="Pendiente">Pendiente</option>
					<option value="Pagado">Pagado</option>
				</select>
			</div>

			<!-- Observaciones -->
			<div class="pf-campo">
				<label for="observaciones" class="pf-label">Observaciones</label>
				<textarea
					id="observaciones"
					class="pf-input"
					bind:value={observaciones}
					rows="3"
					placeholder="Notas adicionales..."
				></textarea>
			</div>
		</div>

		<!-- Campos manuales del desprendible -->
		<div class="pf-tarjeta">
			<h4 class="pf-seccion">Datos del Desprendible de Prima</h4>
			<div class="pf-grid">
				<!-- Tiempo trabajado (días) -->
				<div class="pf-campo">
					<label for="tiempo-dias" class="pf-label">Tiempo Trabajado (días)</label>
					<input
						id="tiempo-dias"
						class="pf-input"
						type="number"
						bind:value={tiempo_trabajado_dias}
						min="0"
						max="365"
						placeholder="180"
					/>
				</div>

				<!-- Sueldo Básico -->
				<div class="pf-campo">
					<label for="sueldo-basico" class="pf-label">Sueldo Básico</label>
					<input
						id="sueldo-basico"
						class="pf-input"
						type="text"
						inputmode="numeric"
						placeholder="$ 0"
						value={sueldo_basico ? '$ ' + formatCOPInput(sueldo_basico) : ''}
						on:focus={handleCOPFocus}
						on:blur={handleCOPBlur}
						on:input={(e) => (sueldo_basico = parseCOPInput(e.currentTarget.value) || null)}
					/>
				</div>

				<!-- Auxilio de Transporte -->
				<div class="pf-campo">
					<label for="auxilio-transporte" class="pf-label">Auxilio de Transporte</label>
					<input
						id="auxilio-transporte"
						class="pf-input"
						type="text"
						inputmode="numeric"
						placeholder="$ 0"
						value={auxilio_transporte ? '$ ' + formatCOPInput(auxilio_transporte) : ''}
						on:focus={handleCOPFocus}
						on:blur={handleCOPBlur}
						on:input={(e) => (auxilio_transporte = parseCOPInput(e.currentTarget.value) || null)}
					/>
				</div>

				<!-- Sueldo Variable -->
				<div class="pf-campo">
					<label for="sueldo-variable" class="pf-label">Sueldo Variable</label>
					<input
						id="sueldo-variable"
						class="pf-input"
						type="text"
						inputmode="numeric"
						placeholder="$ 0"
						value={sueldo_variable ? '$ ' + formatCOPInput(sueldo_variable) : ''}
						on:focus={handleCOPFocus}
						on:blur={handleCOPBlur}
						on:input={(e) => (sueldo_variable = parseCOPInput(e.currentTarget.value) || null)}
					/>
				</div>

				<!-- Total Base de Liquidación (ocupa las dos columnas) -->
				<div class="pf-campo pf-ancho">
					<label for="total-base" class="pf-label">Total Base de Liquidación</label>
					<input
						id="total-base"
						class="pf-input"
						type="text"
						inputmode="numeric"
						placeholder="$ 0"
						value={total_base_liquidacion ? '$ ' + formatCOPInput(total_base_liquidacion) : ''}
						on:focus={handleCOPFocus}
						on:blur={handleCOPBlur}
						on:input={(e) => (total_base_liquidacion = parseCOPInput(e.currentTarget.value) || null)}
					/>
				</div>
			</div>
		</div>
	</div>

	{#snippet pie()}
		<button type="button" on:click={close} disabled={loading} class="btn-secondary">
			Cancelar
		</button>
		<button type="button" on:click={handleSubmit} disabled={loading} class="btn-primary">
			{#if loading}
				<span class="pf-spinner"></span>
			{:else}
				<Save />
			{/if}
			{prima ? 'Guardar cambios' : 'Crear prima'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.pf-cuerpo {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.pf-tarjeta {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.pf-seccion {
		margin: 0;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-primary);
	}
	.pf-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px 14px;
	}
	@media (max-width: 30rem) {
		.pf-grid {
			grid-template-columns: 1fr;
		}
	}
	.pf-campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.pf-ancho {
		grid-column: 1 / -1;
	}
	.pf-label {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.pf-req {
		color: #b91c1c;
	}
	.pf-input {
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
	textarea.pf-input {
		resize: vertical;
	}
	.pf-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.pf-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.pf-error {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		color: #b91c1c;
	}
	.pf-spinner {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		border: 2px solid #fff;
		border-top-color: transparent;
		animation: pf-giro 0.8s linear infinite;
	}
	@keyframes pf-giro {
		to {
			transform: rotate(360deg);
		}
	}
</style>
