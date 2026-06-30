<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Select from 'svelte-select';
	import { obtenerConductores } from '$lib/api/nomina';
	import type { Conductor, Prima, CreatePrimaPayload } from '$lib/types/nomina';
	import { X, Save, User, Sparkles, FileText, Calendar } from 'lucide-svelte';
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

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		on:click|self={close}
	>
		<div class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
				<div class="flex items-center gap-3">
					<div class="rounded-lg bg-emerald-100 p-2">
						<Sparkles class="h-5 w-5 text-emerald-600" />
					</div>
					<div>
						<h2 class="text-lg font-semibold text-gray-900">
							{prima ? 'Editar Prima' : 'Nueva Prima'}
						</h2>
						<p class="text-xs text-gray-500">
							{prima
								? 'Modifique los datos de la prima'
								: 'Registre una prima independiente del desprendible de nómina'}
						</p>
					</div>
				</div>
				<button
					on:click={close}
					class="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Body -->
			<div class="space-y-4 px-6 py-5">
				<!-- Conductor -->
				<div>
					<label
						for="conductor"
						class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
					>
						Conductor <span class="text-red-500">*</span>
					</label>
					<Select
						items={conductoresOptions}
						bind:value={conductorSelected}
						placeholder={loadingConductores ? 'Cargando conductores...' : 'Buscar conductor...'}
						searchable={true}
						clearable={false}
						disabled={loadingConductores}
						--border-radius="0.5rem"
						--border="1px solid #E5E7EB"
						--border-focused="1px solid #10b981"
						--padding="0.625rem 0.875rem"
						--height="40px"
					/>
					{#if errors.conductor}
						<p class="mt-1 text-xs text-red-500">{errors.conductor}</p>
					{/if}
				</div>

				<!-- Mes y Año -->
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label
							for="mes"
							class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
						>
							Mes <span class="text-red-500">*</span>
						</label>
						<select
							id="mes"
							bind:value={mes}
							class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						>
							<option value={null}>— Seleccione —</option>
							{#each MESES as m}
								<option value={m.valor}>{m.nombre}</option>
							{/each}
						</select>
						{#if errors.mes}
							<p class="mt-1 text-xs text-red-500">{errors.mes}</p>
						{/if}
					</div>
					<div>
						<label
							for="anio"
							class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
						>
							Año <span class="text-red-500">*</span>
						</label>
						<input
							id="anio"
							type="number"
							bind:value={anio}
							min="2000"
							max="2100"
							class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
						{#if errors.anio}
							<p class="mt-1 text-xs text-red-500">{errors.anio}</p>
						{/if}
					</div>
				</div>

				<!-- Prima y Prima Pendiente -->
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label
							for="prima-valor"
							class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
						>
							Valor Prima <span class="text-red-500">*</span>
						</label>
						<input
							id="prima-valor"
							type="text"
							inputmode="numeric"
							placeholder="$ 0"
							value={primaValor ? '$ ' + formatCOPInput(primaValor) : ''}
							on:focus={handleCOPFocus}
							on:blur={handleCOPBlur}
							on:input={(e) => (primaValor = parseCOPInput(e.currentTarget.value))}
							class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
						{#if errors.prima}
							<p class="mt-1 text-xs text-red-500">{errors.prima}</p>
						{/if}
					</div>
					<div>
						<label
							for="prima-pendiente"
							class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
						>
							Prima Pendiente (opcional)
						</label>
						<input
							id="prima-pendiente"
							type="text"
							inputmode="numeric"
							placeholder="$ 0"
							value={primaPendiente ? '$ ' + formatCOPInput(primaPendiente) : ''}
							on:focus={handleCOPFocus}
							on:blur={handleCOPBlur}
							on:input={(e) =>
								(primaPendiente = parseCOPInput(e.currentTarget.value) || null)}
							class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				</div>

				<!-- Estado -->
				<div>
					<label
						for="estado"
						class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
					>
						Estado <span class="text-red-500">*</span>
					</label>
					<select
						id="estado"
						bind:value={estado}
						class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
					>
						<option value="Pendiente">Pendiente</option>
						<option value="Pagado">Pagado</option>
					</select>
				</div>

				<!-- Observaciones -->
				<div>
					<label
						for="observaciones"
						class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
					>
						Observaciones
					</label>
					<textarea
						id="observaciones"
						bind:value={observaciones}
						rows="3"
						placeholder="Notas adicionales..."
						class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
				></textarea>
			</div>

			<!-- Campos manuales del desprendible -->
			<div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
				<h4 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
					Datos del Desprendible de Prima
				</h4>
				<div class="grid grid-cols-2 gap-4">
					<!-- Tiempo trabajado (días) -->
					<div>
						<label for="tiempo-dias" class="mb-1.5 block text-xs font-medium text-gray-700">
							Tiempo Trabajado (días)
						</label>
						<input
							id="tiempo-dias"
							type="number"
							bind:value={tiempo_trabajado_dias}
							min="0"
							max="365"
							placeholder="180"
							class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<!-- Sueldo Básico -->
					<div>
						<label for="sueldo-basico" class="mb-1.5 block text-xs font-medium text-gray-700">
							Sueldo Básico
						</label>
						<input
							id="sueldo-basico"
							type="text"
							inputmode="numeric"
							placeholder="$ 0"
							value={sueldo_basico ? '$ ' + formatCOPInput(sueldo_basico) : ''}
							on:focus={handleCOPFocus}
							on:blur={handleCOPBlur}
							on:input={(e) => (sueldo_basico = parseCOPInput(e.currentTarget.value) || null)}
							class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<!-- Auxilio de Transporte -->
					<div>
						<label for="auxilio-transporte" class="mb-1.5 block text-xs font-medium text-gray-700">
							Auxilio de Transporte
						</label>
						<input
							id="auxilio-transporte"
							type="text"
							inputmode="numeric"
							placeholder="$ 0"
							value={auxilio_transporte ? '$ ' + formatCOPInput(auxilio_transporte) : ''}
							on:focus={handleCOPFocus}
							on:blur={handleCOPBlur}
							on:input={(e) =>
								(auxilio_transporte = parseCOPInput(e.currentTarget.value) || null)}
							class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<!-- Sueldo Variable -->
					<div>
						<label for="sueldo-variable" class="mb-1.5 block text-xs font-medium text-gray-700">
							Sueldo Variable
						</label>
						<input
							id="sueldo-variable"
							type="text"
							inputmode="numeric"
							placeholder="$ 0"
							value={sueldo_variable ? '$ ' + formatCOPInput(sueldo_variable) : ''}
							on:focus={handleCOPFocus}
							on:blur={handleCOPBlur}
							on:input={(e) => (sueldo_variable = parseCOPInput(e.currentTarget.value) || null)}
							class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<!-- Total Base de Liquidación (span 2 columns) -->
					<div class="col-span-2">
						<label for="total-base" class="mb-1.5 block text-xs font-medium text-gray-700">
							Total Base de Liquidación
						</label>
						<input
							id="total-base"
							type="text"
							inputmode="numeric"
							placeholder="$ 0"
							value={total_base_liquidacion
								? '$ ' + formatCOPInput(total_base_liquidacion)
								: ''}
							on:focus={handleCOPFocus}
							on:blur={handleCOPBlur}
							on:input={(e) =>
								(total_base_liquidacion = parseCOPInput(e.currentTarget.value) || null)}
							class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				</div>
			</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
				<button
					on:click={close}
					disabled={loading}
					class="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
				>
					Cancelar
				</button>
				<button
					on:click={handleSubmit}
					disabled={loading}
					class="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
				>
					{#if loading}
						<div
							class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
						></div>
					{:else}
						<Save class="h-4 w-4" />
					{/if}
					{prima ? 'Guardar cambios' : 'Crear prima'}
				</button>
			</div>
		</div>
	</div>
{/if}
