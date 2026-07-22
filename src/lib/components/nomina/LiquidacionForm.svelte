<script lang="ts">
	import { onMount } from 'svelte';
	import { obtenerConductores, obtenerVehiculos, obtenerEmpresas, obtenerConfiguraciones } from '$lib/api/nomina';
	import type { Conductor, Vehiculo, Empresa, ConfiguracionLiquidacion, CreateLiquidacionPayload } from '$lib/types/nomina';
	import { ChevronLeft, ChevronRight, Save, Plus, Trash2, Calendar, Users, Truck } from 'lucide-svelte';

	export let mode: 'create' | 'edit' = 'create';
	export let initialData: any = null;
	export let onSubmit: (data: CreateLiquidacionPayload) => Promise<void>;
	export let loading = false;

	// Datos de catálogos
	let conductores: Conductor[] = [];
	let vehiculos: Vehiculo[] = [];
	let empresas: Empresa[] = [];
	let configuracion: ConfiguracionLiquidacion | null = null;
	let loadingData = true;

	// Paso actual del formulario
	let currentStep = 1;
	const totalSteps = 3;

	// PASO 1: Datos básicos
	let conductor_id = '';
	let periodo_inicio = '';
	let periodo_fin = '';
	let vehiculosSeleccionados: string[] = [];

	// PASO 2: Días laborados y salarios
	let dias_laborados = 0;
	let dias_laborados_villanueva = 0;
	let dias_laborados_anual = 0;
	let salario_base = 0;
	let salario_villanueva = 0;
	let salario_anual = 0;

	// PASO 3: Opciones adicionales
	let tiene_vacaciones = false;
	let tiene_incapacidad = false;
	let tiene_cesantias = false;
	let tiene_ajuste = false;
	let ajuste_por_dia_flag = false;
	let ajuste_parex = false;
	let no_descontar_salud = false;
	let no_descontar_pension = false;
	let descontar_transporte = false;

	// Períodos especiales
	let periodo_vacaciones_inicio = '';
	let periodo_vacaciones_fin = '';
	let periodo_incapacidad_inicio = '';
	let periodo_incapacidad_fin = '';

	// Valores calculados/adicionales
	let ajuste_valor = 0;
	let ajuste_por_dia = 0;
	let cesantias = 0;
	let interes_cesantias = 0;

	// Detalles de vehículos (simplificado)
	let detallesVehiculos: any[] = [];

	// Anticipos
	let anticipos: any[] = [];
	let showAnticipoForm = false;
	let nuevoAnticipo = { valor: 0, fecha: '', concepto: '' };

	// Conceptos adicionales
	let conceptos_adicionales: any[] = [];
	let showConceptoForm = false;
	let nuevoConcepto = { concepto: '', valor: 0, tipo: 'devengado' as 'devengado' | 'deduccion' };

	onMount(async () => {
		await cargarDatos();
		if (mode === 'edit' && initialData) {
			cargarDatosIniciales();
		}
	});

	async function cargarDatos() {
		try {
			loadingData = true;
			const [conductoresRes, vehiculosRes, empresasRes, configRes] = await Promise.all([
					obtenerConductores(),
					obtenerVehiculos(),
					obtenerEmpresas(),
					obtenerConfiguraciones()
				]);

			conductores = conductoresRes.data || [];
			vehiculos = vehiculosRes.data || [];
			empresas = empresasRes.data || [];
			configuracion = (configRes.data && configRes.data.length > 0) ? configRes.data[0] : null;

			// Calcular salarios base
			if (configuracion) {
				const salarioMinimo = (configuracion as any).salario_minimo ?? (configuracion as any).smmlv ?? (configuracion as any).salario_base ?? 0;
				salario_base = salarioMinimo;
				salario_villanueva = salarioMinimo;
				salario_anual = salarioMinimo;
			}
		} catch (error) {
			console.error('Error cargando datos:', error);
		} finally {
			loadingData = false;
		}
	}

	function cargarDatosIniciales() {
		// Cargar datos cuando se edita
		conductor_id = initialData.conductor_id || '';
		periodo_inicio = initialData.periodo_inicio?.split('T')[0] || '';
		periodo_fin = initialData.periodo_fin?.split('T')[0] || '';
		vehiculosSeleccionados = initialData.vehiculos?.map((v: any) => v.id) || [];
		
		dias_laborados = initialData.dias_laborados || 0;
		dias_laborados_villanueva = initialData.dias_laborados_villanueva || 0;
		dias_laborados_anual = initialData.dias_laborados_anual || 0;
		salario_base = initialData.salario_base || 0;
		salario_villanueva = initialData.salario_villanueva || 0;
		salario_anual = initialData.salario_anual || 0;

		tiene_vacaciones = initialData.tiene_vacaciones || false;
		tiene_incapacidad = initialData.tiene_incapacidad || false;
		tiene_cesantias = initialData.tiene_cesantias || false;
		tiene_ajuste = initialData.tiene_ajuste || false;
		ajuste_por_dia_flag = initialData.ajuste_por_dia_flag || false;
		ajuste_parex = initialData.ajuste_parex || false;
		no_descontar_salud = initialData.no_descontar_salud || false;
		no_descontar_pension = initialData.no_descontar_pension || false;
		descontar_transporte = initialData.descontar_transporte || false;

		anticipos = initialData.anticipos || [];
		conceptos_adicionales = initialData.conceptos_adicionales || [];
	}

	// Calcular días laborados automáticamente
	$: if (periodo_inicio && periodo_fin) {
		const inicio = new Date(periodo_inicio);
		const fin = new Date(periodo_fin);
		const diff = Math.ceil((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
		if (diff > 0 && dias_laborados === 0) {
			dias_laborados = diff;
			dias_laborados_villanueva = diff;
			dias_laborados_anual = diff;
		}
	}

	// Inicializar detalles de vehículos cuando se seleccionan
	$: if (vehiculosSeleccionados.length > 0) {
		inicializarDetallesVehiculos();
	}

	function inicializarDetallesVehiculos() {
		// Crear estructura básica para cada vehículo
		detallesVehiculos = vehiculosSeleccionados.map(vehiculoId => {
			const vehiculo = vehiculos.find(v => v.id === vehiculoId);
			const detalleExistente = detallesVehiculos.find(d => d.vehiculo_id === vehiculoId);
			
			return detalleExistente || {
				vehiculo_id: vehiculoId,
				vehiculo_label: vehiculo?.placa || '',
				bonos: [],
				mantenimientos: [],
				pernotes: [],
				recargos: []
			};
		});
	}

	function agregarAnticipo() {
		if (nuevoAnticipo.valor > 0 && nuevoAnticipo.fecha) {
			anticipos = [...anticipos, { ...nuevoAnticipo, id: Date.now().toString() }];
			nuevoAnticipo = { valor: 0, fecha: '', concepto: '' };
			showAnticipoForm = false;
		}
	}

	function eliminarAnticipo(index: number) {
		anticipos = anticipos.filter((_, i) => i !== index);
	}

	function agregarConcepto() {
		if (nuevoConcepto.concepto && nuevoConcepto.valor > 0) {
			conceptos_adicionales = [...conceptos_adicionales, { ...nuevoConcepto }];
			nuevoConcepto = { concepto: '', valor: 0, tipo: 'devengado' };
			showConceptoForm = false;
		}
	}

	function eliminarConcepto(index: number) {
		conceptos_adicionales = conceptos_adicionales.filter((_, i) => i !== index);
	}

	function nextStep() {
		if (currentStep < totalSteps) {
			currentStep++;
		}
	}

	function prevStep() {
		if (currentStep > 1) {
			currentStep--;
		}
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(amount);
	}

	async function handleFormSubmit() {
		// Preparar payload
		const payload: CreateLiquidacionPayload = {
			conductor_id,
			periodo_inicio,
			periodo_fin,
			salario_base,
			salario_villanueva,
			salario_anual,
			dias_laborados,
			dias_laborados_villanueva,
			dias_laborados_anual,
			tiene_vacaciones,
			tiene_incapacidad,
			tiene_cesantias,
			tiene_ajuste,
			ajuste_por_dia_flag,
			ajuste_parex,
			no_descontar_salud,
			no_descontar_pension,
			descontar_transporte,
			periodo_vacaciones_inicio: tiene_vacaciones ? periodo_vacaciones_inicio : undefined,
			periodo_vacaciones_fin: tiene_vacaciones ? periodo_vacaciones_fin : undefined,
			periodo_incapacidad_inicio: tiene_incapacidad ? periodo_incapacidad_inicio : undefined,
			periodo_incapacidad_fin: tiene_incapacidad ? periodo_incapacidad_fin : undefined,
			ajuste_valor: tiene_ajuste ? ajuste_valor : undefined,
			ajuste_por_dia: ajuste_por_dia_flag ? ajuste_por_dia : undefined,
			cesantias: tiene_cesantias ? cesantias : undefined,
			interes_cesantias: tiene_cesantias ? interes_cesantias : undefined,
			conceptos_adicionales,
			vehiculos: vehiculosSeleccionados,
			detalles_vehiculos: detallesVehiculos.map(d => ({
				vehiculo: { value: d.vehiculo_id, label: d.vehiculo_label },
				bonos: d.bonos || [],
				mantenimientos: d.mantenimientos || [],
				pernotes: d.pernotes || [],
				recargos: d.recargos || []
			})),
			anticipos
		};

		await onSubmit(payload);
	}
</script>

{#if loadingData}
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="spinner mx-auto mb-4"></div>
			<p class="text-sm text-[var(--text-muted)]">Cargando datos...</p>
		</div>
	</div>
{:else}
	<div class="mx-auto max-w-7xl">
		<!-- Header -->
		<div class="mb-6">
			<button
				on:click={() => window.history.back()}
				class="btn-ghost apple-transition mb-4"
			>
				<ChevronLeft class="h-5 w-5" />
				Volver
			</button>
			<h1 class="font-display text-3xl font-normal tracking-tight text-[var(--text-primary)]">
				{mode === 'create' ? 'Nueva Liquidación' : 'Editar Liquidación'}
			</h1>
		</div>

		<!-- Stepper -->
		<div class="mb-8">
			<div class="flex items-center justify-between">
				{#each Array(totalSteps) as _, i}
					<div class="flex items-center {i < totalSteps - 1 ? 'flex-1' : ''}">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full font-semibold text-white
								{currentStep > i + 1
								? 'bg-[var(--emerald-600)]'
								: currentStep === i + 1
									? 'bg-[var(--emerald-500)] shadow-[var(--shadow-btn)]'
									: 'bg-[var(--border-default)]'}"
						>
							{i + 1}
						</div>
						{#if i < totalSteps - 1}
							<div
								class="mx-2 h-1 flex-1 rounded {currentStep > i + 1 ? 'bg-[var(--emerald-600)]' : 'bg-[var(--border-default)]'}"
							></div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="mt-2 flex justify-between">
				<span class="text-sm {currentStep === 1 ? 'font-medium text-[var(--emerald-600)]' : 'text-[var(--text-muted)]'}">Datos Básicos</span>
				<span class="text-sm {currentStep === 2 ? 'font-medium text-[var(--emerald-600)]' : 'text-[var(--text-muted)]'}">Salarios</span>
				<span class="text-sm {currentStep === 3 ? 'font-medium text-[var(--emerald-600)]' : 'text-[var(--text-muted)]'}">Opciones</span>
			</div>
		</div>

		<!-- Formulario -->
		<div class="rounded-xl bg-white p-6 shadow-[var(--shadow-card)]">
			{#if currentStep === 1}
				<!-- PASO 1: Datos básicos -->
				<div class="space-y-6">
					<div class="mb-4 flex items-center gap-2">
						<Users class="h-6 w-6 text-[var(--emerald-600)]" />
						<h2 class="font-display text-xl font-medium text-[var(--text-primary)]">Información del Conductor y Período</h2>
					</div>

					<div>
						<label for="conductor_id" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
							Conductor <span class="text-[#DC2626]">*</span>
						</label>
						<select
							id="conductor_id"
							bind:value={conductor_id}
							required
							class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
						>
							<option value="">Seleccione un conductor</option>
							{#each conductores as conductor}
								<option value={conductor.id}>{conductor.nombre}</option>
							{/each}
						</select>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="periodo_inicio" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
								Fecha Inicio <span class="text-[#DC2626]">*</span>
							</label>
							<input
								id="periodo_inicio"
								type="date"
								bind:value={periodo_inicio}
								required
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
						</div>
						<div>
							<label for="periodo_fin" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
								Fecha Fin <span class="text-[#DC2626]">*</span>
							</label>
							<input
								id="periodo_fin"
								type="date"
								bind:value={periodo_fin}
								required
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
						</div>
					</div>

					<div>
						<label for="vehiculos_seleccionados" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
							Vehículos <span class="text-[#DC2626]">*</span>
						</label>
						<select
							id="vehiculos_seleccionados"
							bind:value={vehiculosSeleccionados}
							multiple
							size="5"
							class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
						>
							{#each vehiculos as vehiculo}
								<option value={vehiculo.id}>{vehiculo.placa}</option>
							{/each}
						</select>
						<p class="mt-1 text-xs text-[var(--text-muted)]">
							Mantén Cmd/Ctrl presionado para seleccionar múltiples vehículos
						</p>
					</div>
				</div>
			{:else if currentStep === 2}
				<!-- PASO 2: Salarios y días laborados -->
				<div class="space-y-6">
					<div class="mb-4 flex items-center gap-2">
						<Calendar class="h-6 w-6 text-[var(--emerald-600)]" />
						<h2 class="font-display text-xl font-medium text-[var(--text-primary)]">Días Laborados y Salarios</h2>
					</div>

					<div class="grid grid-cols-3 gap-4">
						<div>
							<label for="dias_laborados" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Días Laborados</label>
							<input
								id="dias_laborados"
								type="number"
								bind:value={dias_laborados}
								min="0"
								max="31"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
						</div>
						<div>
							<label for="dias_laborados_villanueva" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Días Villanueva</label>
							<input
								id="dias_laborados_villanueva"
								type="number"
								bind:value={dias_laborados_villanueva}
								min="0"
								max="31"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
						</div>
						<div>
							<label for="dias_laborados_anual" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Días Anuales</label>
							<input
								id="dias_laborados_anual"
								type="number"
								bind:value={dias_laborados_anual}
								min="0"
								max="365"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
						</div>
					</div>

					<div class="grid grid-cols-3 gap-4">
						<div>
							<label for="salario_base" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Salario Base</label>
							<input
								id="salario_base"
								type="number"
								bind:value={salario_base}
								min="0"
								step="1000"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
							<p class="mt-1 text-xs text-[var(--text-muted)]">{formatCurrency(salario_base)}</p>
						</div>
						<div>
							<label for="salario_villanueva" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Salario Villanueva</label>
							<input
								id="salario_villanueva"
								type="number"
								bind:value={salario_villanueva}
								min="0"
								step="1000"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
							<p class="mt-1 text-xs text-[var(--text-muted)]">{formatCurrency(salario_villanueva)}</p>
						</div>
						<div>
							<label for="salario_anual" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Salario Anual</label>
							<input
								id="salario_anual"
								type="number"
								bind:value={salario_anual}
								min="0"
								step="1000"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
							/>
							<p class="mt-1 text-xs text-[var(--text-muted)]">{formatCurrency(salario_anual)}</p>
						</div>
					</div>

					<!-- Anticipos -->
					<div class="border-t border-[var(--border-subtle)] pt-6">
						<div class="mb-4 flex items-center justify-between">
							<h3 class="font-display text-lg font-medium text-[var(--text-primary)]">Anticipos</h3>
							<button
								on:click={() => (showAnticipoForm = !showAnticipoForm)}
								class="help-btn apple-transition"
							>
								<Plus class="h-4 w-4" />
								Agregar Anticipo
							</button>
						</div>

						{#if showAnticipoForm}
							<div class="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
								<div class="grid grid-cols-3 gap-4">
									<div>
										<label for="anticipo_valor" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Valor</label>
										<input
											id="anticipo_valor"
											type="number"
											bind:value={nuevoAnticipo.valor}
											min="0"
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
										/>
									</div>
									<div>
										<label for="anticipo_fecha" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Fecha</label>
										<input
											id="anticipo_fecha"
											type="date"
											bind:value={nuevoAnticipo.fecha}
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
										/>
									</div>
									<div>
										<label for="anticipo_concepto" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Concepto</label>
										<input
											id="anticipo_concepto"
											type="text"
											bind:value={nuevoAnticipo.concepto}
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
										/>
									</div>
								</div>
								<div class="mt-4 flex gap-2">
									<button
										on:click={agregarAnticipo}
										class="btn-primary apple-transition"
									>
										Agregar
									</button>
									<button
										on:click={() => (showAnticipoForm = false)}
										class="btn-secondary apple-transition"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if anticipos.length > 0}
							<div class="space-y-2">
								{#each anticipos as anticipo, i}
									<div class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
										<div>
											<p class="font-semibold text-[var(--text-primary)]">{formatCurrency(anticipo.valor)}</p>
											<p class="text-xs text-[var(--text-muted)]">{anticipo.fecha} - {anticipo.concepto}</p>
										</div>
										<button
											on:click={() => eliminarAnticipo(i)}
											class="apple-transition rounded-lg p-1.5 text-[#DC2626] hover:bg-[rgba(220,38,38,0.08)]"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{:else if currentStep === 3}
				<!-- PASO 3: Opciones adicionales -->
				<div class="space-y-6">
					<h2 class="font-display mb-4 text-xl font-medium text-[var(--text-primary)]">Opciones Adicionales</h2>

					<div class="grid grid-cols-2 gap-4">
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={tiene_vacaciones} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Tiene Vacaciones</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={tiene_incapacidad} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Tiene Incapacidad</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={tiene_cesantias} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Pagar Cesantías</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={tiene_ajuste} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Tiene Ajuste</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={ajuste_por_dia_flag} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Ajuste por Día</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={ajuste_parex} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Ajuste Parex</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={no_descontar_salud} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">No Descontar Salud</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={no_descontar_pension} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">No Descontar Pensión</span>
						</label>
						<label class="flex cursor-pointer items-center space-x-2">
							<input type="checkbox" bind:checked={descontar_transporte} class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]" />
							<span class="text-sm text-[var(--text-primary)]">Descontar Transporte</span>
						</label>
					</div>

					{#if tiene_cesantias}
						<div class="grid grid-cols-2 gap-4 rounded-xl border border-[rgba(59,130,246,0.20)] bg-[rgba(59,130,246,0.06)] p-4">
							<div>
								<label for="cesantias" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Cesantías</label>
								<input
									id="cesantias"
									type="number"
									bind:value={cesantias}
									min="0"
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
								/>
							</div>
							<div>
								<label for="interes_cesantias" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Interés Cesantías</label>
								<input
									id="interes_cesantias"
									type="number"
									bind:value={interes_cesantias}
									min="0"
									class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
								/>
							</div>
						</div>
					{/if}

					<!-- Conceptos Adicionales -->
					<div class="border-t border-[var(--border-subtle)] pt-6">
						<div class="mb-4 flex items-center justify-between">
							<h3 class="font-display text-lg font-medium text-[var(--text-primary)]">Conceptos Adicionales</h3>
							<button
								on:click={() => (showConceptoForm = !showConceptoForm)}
								class="help-btn apple-transition"
							>
								<Plus class="h-4 w-4" />
								Agregar Concepto
							</button>
						</div>

						{#if showConceptoForm}
							<div class="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
								<div class="grid grid-cols-3 gap-4">
									<div>
										<label for="concepto_nombre" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Concepto</label>
										<input
											id="concepto_nombre"
											type="text"
											bind:value={nuevoConcepto.concepto}
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
										/>
									</div>
									<div>
										<label for="concepto_valor" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Valor</label>
										<input
											id="concepto_valor"
											type="number"
											bind:value={nuevoConcepto.valor}
											min="0"
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
										/>
									</div>
									<div>
										<label for="concepto_tipo" class="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Tipo</label>
										<select
											id="concepto_tipo"
											bind:value={nuevoConcepto.tipo}
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-4 py-2"
										>
											<option value="devengado">Devengado</option>
											<option value="deduccion">Deducción</option>
										</select>
									</div>
								</div>
								<div class="mt-4 flex gap-2">
									<button
										on:click={agregarConcepto}
										class="btn-primary apple-transition"
									>
										Agregar
									</button>
									<button
										on:click={() => (showConceptoForm = false)}
										class="btn-secondary apple-transition"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if conceptos_adicionales.length > 0}
							<div class="space-y-2">
								{#each conceptos_adicionales as concepto, i}
									<div class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
										<div>
											<p class="font-semibold text-[var(--text-primary)]">{concepto.concepto}</p>
											<p class="text-xs text-[var(--text-muted)]">
												{formatCurrency(concepto.valor)} - {concepto.tipo === 'devengado' ? 'Devengado' : 'Deducción'}
											</p>
										</div>
										<button
											on:click={() => eliminarConcepto(i)}
											class="apple-transition rounded-lg p-1.5 text-[#DC2626] hover:bg-[rgba(220,38,38,0.08)]"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Botones de navegación -->
			<div class="mt-8 flex items-center justify-between border-t border-[var(--border-subtle)] pt-6">
				<button
					on:click={prevStep}
					disabled={currentStep === 1}
					class="btn-secondary apple-transition disabled:opacity-50"
				>
					<ChevronLeft class="h-4 w-4" />
					Anterior
				</button>

				{#if currentStep === totalSteps}
					<button
						on:click={handleFormSubmit}
						disabled={loading}
						class="btn-primary apple-transition disabled:opacity-50"
					>
						{#if loading}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
							Guardando...
						{:else}
							<Save class="h-4 w-4" />
							Guardar Liquidación
						{/if}
					</button>
				{:else}
					<button
						on:click={nextStep}
						class="btn-primary apple-transition"
					>
						Siguiente
						<ChevronRight class="h-4 w-4" />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
