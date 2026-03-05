<script lang="ts">
	import { onMount } from 'svelte';
	import { obtenerConductores, obtenerVehiculos, obtenerEmpresas, obtenerConfiguracion } from '$lib/api/nomina';
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
	let tiene_prima = false;
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
	let prima = 0;
	let prima_pendiente: number | null = null;

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
				obtenerConfiguracion()
			]);

			conductores = conductoresRes.data || [];
			vehiculos = vehiculosRes.data || [];
			empresas = empresasRes.data || [];
			configuracion = configRes.data || null;

			// Calcular salarios base
			if (configuracion) {
				salario_base = configuracion.salario_minimo;
				salario_villanueva = configuracion.salario_minimo;
				salario_anual = configuracion.salario_minimo;
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
		tiene_prima = initialData.tiene_prima || false;
		tiene_ajuste = initialData.tiene_ajuste || false;
		ajuste_por_dia_flag = initialData.ajuste_por_dia_flag || false;
		ajuste_parex = initialData.ajuste_parex || false;
		no_descontar_salud = initialData.no_descontar_salud || false;
		no_descontar_pension = initialData.no_descontar_pension || false;
		descontar_transporte = initialData.descontar_transporte || false;

		anticipos = initialData.anticipos || [];
		conceptos_adicionales = initialData.conceptos_adicionales || [];
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
			tiene_prima,
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
			prima: tiene_prima ? prima : undefined,
			prima_pendiente: tiene_prima && prima_pendiente ? prima_pendiente : undefined,
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
	<div class="flex items-center justify-center min-h-screen">
		<div class="text-center">
			<div class="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
			<p class="mt-4 text-gray-600">Cargando datos...</p>
		</div>
	</div>
{:else}
	<div class="max-w-7xl mx-auto">
		<!-- Header -->
		<div class="mb-6">
			<button
				on:click={() => window.history.back()}
				class="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
			>
				<ChevronLeft class="h-5 w-5" />
				Volver
			</button>
			<h1 class="text-3xl font-bold text-gray-900">
				{mode === 'create' ? 'Nueva Liquidación' : 'Editar Liquidación'}
			</h1>
		</div>

		<!-- Stepper -->
		<div class="mb-8">
			<div class="flex items-center justify-between">
				{#each Array(totalSteps) as _, i}
					<div class="flex items-center {i < totalSteps - 1 ? 'flex-1' : ''}">
						<div
							class="flex items-center justify-center w-10 h-10 rounded-full {currentStep > i + 1
								? 'bg-orange-600'
								: currentStep === i + 1
									? 'bg-orange-500'
									: 'bg-gray-300'} text-white font-semibold"
						>
							{i + 1}
						</div>
						{#if i < totalSteps - 1}
							<div
								class="flex-1 h-1 mx-2 {currentStep > i + 1 ? 'bg-orange-600' : 'bg-gray-300'}"
							></div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="flex justify-between mt-2">
				<span class="text-sm {currentStep === 1 ? 'text-orange-600 font-medium' : 'text-gray-500'}"
					>Datos Básicos</span
				>
				<span class="text-sm {currentStep === 2 ? 'text-orange-600 font-medium' : 'text-gray-500'}"
					>Salarios</span
				>
				<span class="text-sm {currentStep === 3 ? 'text-orange-600 font-medium' : 'text-gray-500'}"
					>Opciones</span
				>
			</div>
		</div>

		<!-- Formulario -->
		<div class="bg-white rounded-xl shadow-lg p-6">
			{#if currentStep === 1}
				<!-- PASO 1: Datos básicos -->
				<div class="space-y-6">
					<div class="flex items-center gap-2 mb-4">
						<Users class="h-6 w-6 text-orange-600" />
						<h2 class="text-xl font-semibold">Información del Conductor y Período</h2>
					</div>

					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">
							Conductor <span class="text-red-500">*</span>
						</label>
						<select
							bind:value={conductor_id}
							required
							class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
						>
							<option value="">Seleccione un conductor</option>
							{#each conductores as conductor}
								<option value={conductor.id}>{conductor.nombre}</option>
							{/each}
						</select>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">
								Fecha Inicio <span class="text-red-500">*</span>
							</label>
							<input
								type="date"
								bind:value={periodo_inicio}
								required
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
							/>
						</div>
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">
								Fecha Fin <span class="text-red-500">*</span>
							</label>
							<input
								type="date"
								bind:value={periodo_fin}
								required
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
							/>
						</div>
					</div>

					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">
							Vehículos <span class="text-red-500">*</span>
						</label>
						<select
							bind:value={vehiculosSeleccionados}
							multiple
							size="5"
							class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
						>
							{#each vehiculos as vehiculo}
								<option value={vehiculo.id}>{vehiculo.placa}</option>
							{/each}
						</select>
						<p class="text-sm text-gray-500 mt-1">
							Mantén Cmd/Ctrl presionado para seleccionar múltiples vehículos
						</p>
					</div>
				</div>
			{:else if currentStep === 2}
				<!-- PASO 2: Salarios y días laborados -->
				<div class="space-y-6">
					<div class="flex items-center gap-2 mb-4">
						<Calendar class="h-6 w-6 text-orange-600" />
						<h2 class="text-xl font-semibold">Días Laborados y Salarios</h2>
					</div>

					<div class="grid grid-cols-3 gap-4">
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Días Laborados</label>
							<input
								type="number"
								bind:value={dias_laborados}
								min="0"
								max="31"
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
							/>
						</div>
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Días Villanueva</label>
							<input
								type="number"
								bind:value={dias_laborados_villanueva}
								min="0"
								max="31"
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
							/>
						</div>
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Días Anuales</label>
							<input
								type="number"
								bind:value={dias_laborados_anual}
								min="0"
								max="365"
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
							/>
						</div>
					</div>

					<div class="grid grid-cols-3 gap-4">
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Salario Base</label>
							<input
								type="number"
								bind:value={salario_base}
								min="0"
								step="1000"
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
							/>
							<p class="text-sm text-gray-500 mt-1">{formatCurrency(salario_base)}</p>
						</div>
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Salario Villanueva</label>
							<input
								type="number"
								bind:value={salario_villanueva}
								min="0"
								step="1000"
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
							/>
							<p class="text-sm text-gray-500 mt-1">{formatCurrency(salario_villanueva)}</p>
						</div>
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Salario Anual</label>
							<input
								type="number"
								bind:value={salario_anual}
								min="0"
								step="1000"
								class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
							/>
							<p class="text-sm text-gray-500 mt-1">{formatCurrency(salario_anual)}</p>
						</div>
					</div>

					<!-- Anticipos -->
					<div class="border-t pt-6">
						<div class="flex items-center justify-between mb-4">
							<h3 class="text-lg font-semibold">Anticipos</h3>
							<button
								on:click={() => (showAnticipoForm = !showAnticipoForm)}
								class="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200"
							>
								<Plus class="h-4 w-4" />
								Agregar Anticipo
							</button>
						</div>

						{#if showAnticipoForm}
							<div class="bg-gray-50 p-4 rounded-lg mb-4">
								<div class="grid grid-cols-3 gap-4">
									<div>
										<label class="block text-sm font-medium text-gray-700 mb-2">Valor</label>
										<input
											type="number"
											bind:value={nuevoAnticipo.valor}
											min="0"
											class="w-full px-4 py-2 border border-gray-300 rounded-lg"
										/>
									</div>
									<div>
										<label class="block text-sm font-medium text-gray-700 mb-2">Fecha</label>
										<input
											type="date"
											bind:value={nuevoAnticipo.fecha}
											class="w-full px-4 py-2 border border-gray-300 rounded-lg"
										/>
									</div>
									<div>
										<label class="block text-sm font-medium text-gray-700 mb-2">Concepto</label>
										<input
											type="text"
											bind:value={nuevoAnticipo.concepto}
											class="w-full px-4 py-2 border border-gray-300 rounded-lg"
										/>
									</div>
								</div>
								<div class="flex gap-2 mt-4">
									<button
										on:click={agregarAnticipo}
										class="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
									>
										Agregar
									</button>
									<button
										on:click={() => (showAnticipoForm = false)}
										class="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if anticipos.length > 0}
							<div class="space-y-2">
								{#each anticipos as anticipo, i}
									<div class="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
										<div>
											<p class="font-medium">{formatCurrency(anticipo.valor)}</p>
											<p class="text-sm text-gray-500">{anticipo.fecha} - {anticipo.concepto}</p>
										</div>
										<button
											on:click={() => eliminarAnticipo(i)}
											class="text-red-600 hover:text-red-800"
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
					<h2 class="text-xl font-semibold mb-4">Opciones Adicionales</h2>

					<div class="grid grid-cols-2 gap-4">
						<label class="flex items-center space-x-2 cursor-pointer">
							<input type="checkbox" bind:checked={tiene_vacaciones} class="w-4 h-4 rounded text-orange-600" />
							<span>Tiene Vacaciones</span>
						</label>
						<label class="flex items-center space-x-2 cursor-pointer">
							<input type="checkbox" bind:checked={tiene_incapacidad} class="w-4 h-4 rounded text-orange-600" />
							<span>Tiene Incapacidad</span>
						</label>
						<label class="flex items-center space-x-2 cursor-pointer">
							<input type="checkbox" bind:checked={tiene_cesantias} class="w-4 h-4 rounded text-orange-600" />
							<span>Pagar Cesantías</span>
						</label>
						<label class="flex items-center space-x-2 cursor-pointer">
							<input type="checkbox" bind:checked={tiene_prima} class="w-4 h-4 rounded text-orange-600" />
							<span>Pagar Prima</span>
						</label>
						<label class="flex items-center space-x-2 cursor-pointer">
							<input type="checkbox" bind:checked={no_descontar_salud} class="w-4 h-4 rounded text-orange-600" />
							<span>No Descontar Salud</span>
						</label>
						<label class="flex items-center space-x-2 cursor-pointer">
							<input type="checkbox" bind:checked={no_descontar_pension} class="w-4 h-4 rounded text-orange-600" />
							<span>No Descontar Pensión</span>
						</label>
					</div>

					{#if tiene_cesantias}
						<div class="grid grid-cols-2 gap-4 bg-blue-50 p-4 rounded-lg">
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-2">Cesantías</label>
								<input
									type="number"
									bind:value={cesantias}
									min="0"
									class="w-full px-4 py-2 border border-gray-300 rounded-lg"
								/>
							</div>
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-2">Interés Cesantías</label>
								<input
									type="number"
									bind:value={interes_cesantias}
									min="0"
									class="w-full px-4 py-2 border border-gray-300 rounded-lg"
								/>
							</div>
						</div>
					{/if}

					{#if tiene_prima}
						<div class="grid grid-cols-2 gap-4 bg-purple-50 p-4 rounded-lg">
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-2">Prima</label>
								<input
									type="number"
									bind:value={prima}
									min="0"
									class="w-full px-4 py-2 border border-gray-300 rounded-lg"
								/>
							</div>
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-2">Prima Pendiente (opcional)</label>
								<input
									type="number"
									bind:value={prima_pendiente}
									min="0"
									class="w-full px-4 py-2 border border-gray-300 rounded-lg"
								/>
							</div>
						</div>
					{/if}

					<!-- Conceptos Adicionales -->
					<div class="border-t pt-6">
						<div class="flex items-center justify-between mb-4">
							<h3 class="text-lg font-semibold">Conceptos Adicionales</h3>
							<button
								on:click={() => (showConceptoForm = !showConceptoForm)}
								class="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200"
							>
								<Plus class="h-4 w-4" />
								Agregar Concepto
							</button>
						</div>

						{#if showConceptoForm}
							<div class="bg-gray-50 p-4 rounded-lg mb-4">
								<div class="grid grid-cols-3 gap-4">
									<div>
										<label class="block text-sm font-medium text-gray-700 mb-2">Concepto</label>
										<input
											type="text"
											bind:value={nuevoConcepto.concepto}
											class="w-full px-4 py-2 border border-gray-300 rounded-lg"
										/>
									</div>
									<div>
										<label class="block text-sm font-medium text-gray-700 mb-2">Valor</label>
										<input
											type="number"
											bind:value={nuevoConcepto.valor}
											min="0"
											class="w-full px-4 py-2 border border-gray-300 rounded-lg"
										/>
									</div>
									<div>
										<label class="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
										<select
											bind:value={nuevoConcepto.tipo}
											class="w-full px-4 py-2 border border-gray-300 rounded-lg"
										>
											<option value="devengado">Devengado</option>
											<option value="deduccion">Deducción</option>
										</select>
									</div>
								</div>
								<div class="flex gap-2 mt-4">
									<button
										on:click={agregarConcepto}
										class="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
									>
										Agregar
									</button>
									<button
										on:click={() => (showConceptoForm = false)}
										class="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if conceptos_adicionales.length > 0}
							<div class="space-y-2">
								{#each conceptos_adicionales as concepto, i}
									<div class="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
										<div>
											<p class="font-medium">{concepto.concepto}</p>
											<p class="text-sm text-gray-500">
												{formatCurrency(concepto.valor)} - {concepto.tipo === 'devengado' ? 'Devengado' : 'Deducción'}
											</p>
										</div>
										<button
											on:click={() => eliminarConcepto(i)}
											class="text-red-600 hover:text-red-800"
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
			<div class="flex items-center justify-between mt-8 pt-6 border-t">
				<button
					on:click={prevStep}
					disabled={currentStep === 1}
					class="flex items-center gap-2 px-6 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<ChevronLeft class="h-5 w-5" />
					Anterior
				</button>

				{#if currentStep === totalSteps}
					<button
						on:click={handleFormSubmit}
						disabled={loading}
						class="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-lg hover:shadow-lg disabled:opacity-50"
					>
						{#if loading}
							<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
							Guardando...
						{:else}
							<Save class="h-5 w-5" />
							Guardar Liquidación
						{/if}
					</button>
				{:else}
					<button
						on:click={nextStep}
						class="flex items-center gap-2 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
					>
						Siguiente
						<ChevronRight class="h-5 w-5" />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
