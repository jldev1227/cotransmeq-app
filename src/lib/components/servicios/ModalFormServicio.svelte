<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Select from 'svelte-select';
	import { serviciosStore } from '$lib/stores/servicios';
	import {
		recursos,
		conductoresOptions,
		vehiculosOptions,
		clientesOptions
	} from '$lib/stores/recursos';
	import { municipios, municipiosOptions, municipiosArray } from '$lib/stores/municipios';
	import { toast } from '$lib/stores/toast';
	import { apiClient } from '$lib/api/apiClient';
	import type { ServicioConRelaciones } from '$lib/types/servicios';
	import ModalNuevaEmpresa from './ModalNuevaEmpresa.svelte';
	import ModalNuevoConductor from './ModalNuevoConductor.svelte';
	import ModalNuevoVehiculo from './ModalNuevoVehiculo.svelte';
	import ModalSelectCliente from '$lib/components/ui/ModalSelectCliente.svelte';
	import MapboxSearch from '$lib/components/ui/MapboxSearch.svelte';

	// Props
	export let isOpen = false;
	export let servicio: ServicioConRelaciones | null = null;
	export let onClose: () => void;
	export let onSuccess: () => void;

	// State
	let currentStep = 1;
	const totalSteps = 4;
	let loading = false;
	let isEditing = servicio !== null;
	let isReadOnly = false;

	// Form fields
	let clienteSelected = '';
	let conductorSelected = '';
	let vehicleSelected = '';
	let fechaSolicitud = '';
	let fechaRealizacion = '';
	let selectedOriginMun = '';
	let selectedDestMun = '';
	let originSpecific = '';
	let destSpecific = '';
	let originCoords = { lat: 0, lng: 0 };
	let destCoords = { lat: 0, lng: 0 };
	let purpose = 'personal'; // Valor por defecto: transporte de personal
	let observaciones = '';
	let finalizarServicio = false;
	let fechaFinalizacion = '';

	// Validation errors
	let errors = {
		cliente: '',
		fechaSolicitud: '',
		fechaRealizacion: '',
		origen: '',
		destino: '',
		purpose: ''
	};

	// Sub-modal states
	let mostrarModalEmpresa = false;
	let mostrarModalConductor = false;
	let mostrarModalVehiculo = false;
	let mostrarModalSelectCliente = false;
	let mostrarModalSelectConductor = false;
	let mostrarModalSelectVehiculo = false;
	let mostrarModalSelectOrigen = false;
	let mostrarModalSelectDestino = false;

	// Computed - Usar los stores reactivos
	$: municipioOptions = $municipiosOptions;
	$: municipiosData = $municipiosArray;
	$: empresaOptions = $clientesOptions;
	$: conductorOptions = $conductoresOptions;
	$: vehiculoOptions = $vehiculosOptions;

	// Data arrays from store (para referencias en la vista de resumen)
	$: empresas = $recursos.clientes;
	$: conductores = $recursos.conductores;
	$: vehiculos = $recursos.vehiculos;

	// Icon components
	function UserIcon() {
		return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
		</svg>`;
	}

	function LocationMarkerIcon() {
		return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
			<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
		</svg>`;
	}

	function TruckIcon() {
		return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
		</svg>`;
	}

	function UsersIcon() {
		return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
		</svg>`;
	}

	function CheckCircleIcon() {
		return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
		</svg>`;
	}

	function BuildingIcon() {
		return `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
		</svg>`;
	}

	// Initialize form with current date/time
	function initializeDates() {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');

		const dateTimeStr = `${year}-${month}-${day}T${hours}:${minutes}`;
		fechaSolicitud = dateTimeStr;
		fechaRealizacion = dateTimeStr;
		fechaFinalizacion = dateTimeStr;
	}

	// Reset form
	function resetForm() {
		currentStep = 1;
		clienteSelected = '';
		conductorSelected = '';
		vehicleSelected = '';
		initializeDates();
		selectedOriginMun = '';
		selectedDestMun = '';
		originSpecific = '';
		destSpecific = '';
		originCoords = { lat: 0, lng: 0 };
		destCoords = { lat: 0, lng: 0 };
		purpose = 'personal'; // Restablecer al valor por defecto
		observaciones = '';
		finalizarServicio = false;
		isReadOnly = false;
		// Limpiar errores
		errors = {
			cliente: '',
			fechaSolicitud: '',
			fechaRealizacion: '',
			origen: '',
			destino: '',
			origenEspecifico: '',
			destinoEspecifico: '',
			purpose: ''
		};
	}

	// Load data
	async function loadData() {
		// Cargar todos los recursos desde los stores
		await Promise.all([recursos.cargarTodos(), municipios.cargarTodos()]);
	}

	// Handlers for sub-modals
	async function handleEmpresaCreada(empresa: any) {
		// Agregar al store y auto-seleccionar
		recursos.agregarCliente(empresa);
		clienteSelected = empresa.id;
	}

	async function handleConductorCreado(conductor: any) {
		console.log('🎯 [ModalFormServicio] handleConductorCreado recibió:', conductor);
		console.log('🔍 [ModalFormServicio] Tipo de dato:', typeof conductor);
		console.log('📋 [ModalFormServicio] Propiedades del objeto:', Object.keys(conductor || {}));
		console.log('🆔 [ModalFormServicio] conductor.id:', conductor?.id);
		console.log('👤 [ModalFormServicio] conductor.nombre:', conductor?.nombre);
		console.log('👤 [ModalFormServicio] conductor.apellido:', conductor?.apellido);

		// Agregar al store y auto-seleccionar
		console.log('📦 [ModalFormServicio] Agregando al store...');
		recursos.agregarConductor(conductor);

		console.log('✅ [ModalFormServicio] Estableciendo conductorSelected =', conductor?.id);
		conductorSelected = conductor.id;

		console.log('📊 [ModalFormServicio] Estado actual de conductorOptions:', $conductoresOptions);
	}

	async function handleVehiculoCreado(vehiculo: any) {
		// Agregar al store y auto-seleccionar
		recursos.agregarVehiculo(vehiculo);
		vehicleSelected = vehiculo.id;
	}

	// Load service for editing
	function loadServiceData() {
		if (!servicio) return;

		isEditing = true;
		isReadOnly = servicio.estado === 'realizado' || servicio.estado === 'cancelado';

		clienteSelected = servicio.cliente_id || '';
		conductorSelected = servicio.conductor_id || '';
		vehicleSelected = servicio.vehiculo_id || '';

		if (servicio.fecha_solicitud) {
			const date = new Date(servicio.fecha_solicitud);
			fechaSolicitud = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		}

		if (servicio.fecha_realizacion) {
			const date = new Date(servicio.fecha_realizacion);
			fechaRealizacion = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		}

		selectedOriginMun = servicio.origen_id || '';
		selectedDestMun = servicio.destino_id || '';
		originSpecific = servicio.origen_especifico || '';
		destSpecific = servicio.destino_especifico || '';

		if (servicio.origen_latitud && servicio.origen_longitud) {
			originCoords = {
				lat: servicio.origen_latitud,
				lng: servicio.origen_longitud
			};
		}

		if (servicio.destino_latitud && servicio.destino_longitud) {
			destCoords = {
				lat: servicio.destino_latitud,
				lng: servicio.destino_longitud
			};
		}

		// Normalizar propósito del servicio (de guion bajo a espacio para el frontend)
		const proposito = servicio.proposito_servicio || '';
		purpose = proposito === 'personal_y_herramienta' ? 'personal y herramienta' : proposito;
		observaciones = servicio.observaciones || '';
	}

	// Step navigation
	function nextStep() {
		// Validation based on current step
		if (currentStep === 1) {
			if (!clienteSelected) {
				toast.warning('Por favor seleccione un cliente');
				return;
			}
			if (!fechaSolicitud) {
				toast.warning('Por favor seleccione una fecha de solicitud');
				return;
			}
			if (!fechaRealizacion) {
				toast.warning('Por favor seleccione una fecha de realización');
				return;
			}
			if (new Date(fechaRealizacion) < new Date(fechaSolicitud)) {
				toast.error('La fecha de realización no puede ser anterior a la fecha de solicitud');
				return;
			}
		} else if (currentStep === 2) {
			if (!selectedOriginMun) {
				toast.warning('Por favor seleccione un origen');
				return;
			}
			if (!selectedDestMun) {
				toast.warning('Por favor seleccione un destino');
				return;
			}
			if (!purpose) {
				toast.warning('Por favor seleccione un propósito para el servicio');
				return;
			}
		}

		if (currentStep < totalSteps) {
			currentStep++;
		}
	}

	function prevStep() {
		if (currentStep > 1) {
			currentStep--;
		}
	}

	// Validate form
	function validateForm(): boolean {
		let isValid = true;

		// Limpiar errores previos
		errors = {
			cliente: '',
			fechaSolicitud: '',
			fechaRealizacion: '',
			origen: '',
			destino: '',
			purpose: ''
		};

		// Validar cliente
		if (!clienteSelected || clienteSelected.trim() === '') {
			errors.cliente = 'Debe seleccionar un cliente';
			isValid = false;
		}

		// Validar fecha de solicitud
		if (!fechaSolicitud || fechaSolicitud.trim() === '') {
			errors.fechaSolicitud = 'La fecha de solicitud es obligatoria';
			isValid = false;
		}

		// Validar fecha de realización
		if (!fechaRealizacion || fechaRealizacion.trim() === '') {
			errors.fechaRealizacion = 'La fecha de realización es obligatoria';
			isValid = false;
		}

		// Validar origen
		if (!selectedOriginMun || selectedOriginMun.trim() === '') {
			errors.origen = 'Debe seleccionar un municipio de origen';
			isValid = false;
		}

		// Validar destino
		if (!selectedDestMun || selectedDestMun.trim() === '') {
			errors.destino = 'Debe seleccionar un municipio de destino';
			isValid = false;
		}

		// Validar propósito
		if (!purpose || purpose.trim() === '') {
			errors.purpose = 'Debe seleccionar un propósito del servicio';
			isValid = false;
		}

		return isValid;
	}

	// Submit form
	async function handleSubmit() {
		// Validar formulario antes de enviar
		if (!validateForm()) {
			toast.error('Por favor complete todos los campos obligatorios');
			return;
		}

		loading = true;

		try {
			// Determine state automatically
			const now = new Date();
			const fechaReal = new Date(fechaRealizacion);

			let estadoServicio: string;
			if (finalizarServicio && fechaFinalizacion) {
				estadoServicio = 'realizado';
			} else if (conductorSelected && vehicleSelected) {
				estadoServicio = fechaReal < now ? 'en_curso' : 'planificado';
			} else {
				estadoServicio = 'solicitado';
			}

			const servicioData: any = {
				origen_id: selectedOriginMun,
				destino_id: selectedDestMun,
				origen_especifico: originSpecific,
				destino_especifico: destSpecific.trim(),
				conductor_id: conductorSelected || null,
				vehiculo_id: vehicleSelected || null,
				cliente_id: clienteSelected,
				proposito_servicio: purpose,
				fecha_solicitud: new Date(fechaSolicitud).toISOString(),
				fecha_realizacion: new Date(fechaRealizacion).toISOString(),
				estado: estadoServicio,
				observaciones: observaciones
			};

			// Agregar coordenadas solo si tienen valores válidos (no ceros)
			if (originCoords.lat !== 0 && originCoords.lng !== 0) {
				servicioData.origen_latitud = originCoords.lat;
				servicioData.origen_longitud = originCoords.lng;
			}

			if (destCoords.lat !== 0 && destCoords.lng !== 0) {
				servicioData.destino_latitud = destCoords.lat;
				servicioData.destino_longitud = destCoords.lng;
			}

			// Solo incluir fecha_finalizacion si tiene valor
			if (finalizarServicio && fechaFinalizacion) {
				servicioData.fecha_finalizacion = new Date(fechaFinalizacion).toISOString();
			}
			console.log('🔍 DEBUG - Datos a enviar:', {
				finalizarServicio,
				fechaFinalizacion,
				fecha_finalizacion: servicioData.fecha_finalizacion,
				estado: servicioData.estado
			});

			if (isEditing && servicio?.id) {
				await apiClient.put(`/api/servicios/${servicio.id}`, servicioData);
				toast.success('Servicio actualizado correctamente');
			} else {
				await apiClient.post('/api/servicios', servicioData);
				toast.success('Servicio registrado correctamente');
			}

			onSuccess();
			handleClose();
		} catch (error: any) {
			console.error('Error al procesar el servicio:', error);
			toast.error(error?.response?.data?.message || 'Error al procesar el servicio');
		} finally {
			loading = false;
		}
	}
	function handleClose() {
		resetForm();
		onClose();
	}

	// Initialize on mount
	onMount(() => {
		loadData();
		initializeDates();
		if (servicio) {
			loadServiceData();
		}
	});

	// Reactively update when servicio changes
	$: if (isOpen && servicio) {
		loadServiceData();
	} else if (isOpen && !servicio) {
		resetForm();
	}
</script>

{#if isOpen}
	<!-- Modal backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-md"
		role="dialog"
		aria-modal="true"
		transition:fade={{ duration: 250, easing: cubicOut }}
		tabindex="-1"
	>
		<!-- Modal content -->
		<div
			class="relative w-full max-w-5xl transition-all duration-300"
			role="document"
			in:scale={{ start: 0.95, opacity: 0, duration: 300, easing: cubicOut }}
			out:scale={{ start: 0.98, opacity: 0, duration: 200, easing: cubicOut }}
		>
			<!-- Modal card -->
			<div
				class="relative overflow-hidden rounded-3xl bg-white shadow-2xl transition-all duration-300"
			>
				<!-- Header with gradient -->
				<div
					class="relative overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-amber-600 px-8 py-6"
				>
					<!-- Background pattern -->
					<div class="absolute inset-0 opacity-10">
						<div
							class="absolute inset-0"
							style="background-image: radial-gradient(circle at 2px 2px, white 1px, transparent 0); background-size: 24px 24px;"
						></div>
					</div>

					<div class="relative flex items-center justify-between">
						<div>
							<h2 class="text-2xl font-bold text-white">
								{#if isEditing}
									{isReadOnly ? 'Detalles del Servicio' : 'Editar Servicio'}
								{:else}
									Nuevo Servicio
								{/if}
							</h2>
							{#if isEditing && servicio}
								<p class="mt-1 text-sm text-orange-50">
									<span
										class="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
									>
										{servicio.estado.replace('_', ' ').toUpperCase()}
									</span>
								</p>
							{/if}
						</div>

						<button
							on:click={handleClose}
							class="group flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur-sm transition-all hover:rotate-90 hover:bg-white/20"
							aria-label="Cerrar modal"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>
				</div>

				<!-- Step Progress Bar (Hidden - Showing all content in one view) -->

				<!-- Form content -->
				<div class="h-[25rem] overflow-y-auto px-8 py-6">
					{#if isReadOnly}
						<!-- Read-only view -->
						<div class="space-y-6">
							<div class="space-y-4">
								<h3 class="border-b border-gray-200 pb-2 text-lg font-medium text-gray-900">
									Información Básica
								</h3>
								<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Cliente</p>
										<p class="text-md">
											{empresas.find((e) => e.id === servicio?.cliente_id)?.nombre || 'No asignado'}
										</p>
									</div>
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Estado</p>
										<p class="text-md capitalize">{servicio?.estado}</p>
									</div>
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Fecha de Solicitud</p>
										<p class="text-md">
											{servicio?.fecha_solicitud
												? new Date(servicio.fecha_solicitud).toLocaleString('es-CO')
												: 'No definida'}
										</p>
									</div>
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Fecha de Realización</p>
										<p class="text-md">
											{servicio?.fecha_realizacion
												? new Date(servicio.fecha_realizacion).toLocaleString('es-CO')
												: 'No definida'}
										</p>
									</div>
								</div>

								<h3 class="border-b border-gray-200 pt-4 pb-2 text-lg font-medium text-gray-900">
									Origen y Destino
								</h3>
								<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Origen</p>
										<p class="text-md">{servicio?.origen_especifico}</p>
										<p class="text-sm text-gray-500">
											{municipiosData.find((m) => m.id === servicio?.origen_id)?.nombre_municipio ||
												'No especificado'}
										</p>
									</div>
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Destino</p>
										<p class="text-md">{servicio?.destino_especifico}</p>
										<p class="text-sm text-gray-500">
											{municipiosData.find((m) => m.id === servicio?.destino_id)
												?.nombre_municipio || 'No especificado'}
										</p>
									</div>
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Propósito</p>
										<p class="text-md capitalize">
											{servicio?.proposito_servicio || 'No especificado'}
										</p>
									</div>
								</div>

								<h3 class="border-b border-gray-200 pt-4 pb-2 text-lg font-medium text-gray-900">
									Asignaciones
								</h3>
								<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Conductor</p>
										<p class="text-md">
											{conductores.find((c) => c.id === servicio?.conductor_id)
												? `${conductores.find((c) => c.id === servicio?.conductor_id)?.nombre} ${conductores.find((c) => c.id === servicio?.conductor_id)?.apellido}`
												: 'No asignado'}
										</p>
									</div>
									<div class="space-y-1">
										<p class="text-sm font-medium text-gray-500">Vehículo</p>
										<p class="text-md">
											{vehiculos.find((v) => v.id === servicio?.vehiculo_id)
												? `${vehiculos.find((v) => v.id === servicio?.vehiculo_id)?.placa} (${vehiculos.find((v) => v.id === servicio?.vehiculo_id)?.marca})`
												: 'No asignado'}
										</p>
									</div>
								</div>

								{#if servicio?.observaciones}
									<h3 class="border-b border-gray-200 pt-4 pb-2 text-lg font-medium text-gray-900">
										Observaciones
									</h3>
									<p class="text-md">{servicio.observaciones}</p>
								{/if}
							</div>
						</div>
					{:else}
						<!-- Unified Form View - All Steps in One Scrollable View -->
						<div class="space-y-8">
							<!-- Section 1: Información Básica -->
							<div class="space-y-5">
								<h3
									class="flex items-center gap-2 border-b-2 border-orange-100 pb-2 text-lg font-bold text-gray-900"
								>
									<div
										class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white"
									>
										<span class="text-sm font-bold">1</span>
									</div>
									Información Básica
								</h3>
								<!-- Cliente -->
								<div>
									<label for="cliente" class="mb-2 block text-sm font-semibold text-gray-700">
										Cliente / Empresa <span class="text-red-500">*</span>
									</label>
									<div class="flex items-stretch gap-2">
										<!-- Input display (read-only) -->
										<button
											type="button"
											on:click={() => (mostrarModalSelectCliente = true)}
											class="group relative flex flex-1 items-center gap-3 rounded-xl border {errors.cliente
												? 'border-red-300'
												: 'border-gray-200'} bg-white px-4 py-2.5 text-left transition-all hover:border-gray-300 hover:bg-gray-50"
										>
											<div class="text-gray-400 transition-colors group-hover:text-orange-600">
												{@html BuildingIcon()}
											</div>
											<div class="flex-1">
												{#if clienteSelected}
													<span class="text-sm font-medium text-gray-900">
														{empresaOptions.find((o) => o.value === clienteSelected)?.label ||
															'Seleccionar empresa'}
													</span>
												{:else}
													<span class="text-sm text-gray-400">Buscar o seleccionar empresa...</span>
												{/if}
											</div>
											<svg
												class="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-1"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 5l7 7-7 7"
												/>
											</svg>
										</button>

										<button
											type="button"
											on:click={() => (mostrarModalEmpresa = true)}
											class="group flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-orange-300 bg-orange-50/50 text-orange-600 transition-all hover:scale-105 hover:border-orange-400 hover:bg-orange-50"
											title="Crear nueva empresa"
										>
											<svg
												class="h-5 w-5 transition-transform group-hover:rotate-90"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												viewBox="0 0 24 24"
											>
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
											</svg>
										</button>
									</div>
									{#if errors.cliente}
										<p class="mt-1 text-sm text-red-600">{errors.cliente}</p>
									{/if}
								</div>

								<!-- Dates -->
								<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
									<div>
										<label
											for="fechaSolicitud"
											class="mb-2 block text-sm font-semibold text-gray-700"
										>
											Fecha y hora de solicitud <span class="text-red-500">*</span>
										</label>
										<div class="relative">
											<input
												type="datetime-local"
												id="fechaSolicitud"
												bind:value={fechaSolicitud}
												class="w-full rounded-xl border {errors.fechaSolicitud
													? 'border-red-300'
													: 'border-gray-200'} bg-white px-4 py-2.5 text-sm text-gray-900 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
											/>
										</div>
										{#if errors.fechaSolicitud}
											<p class="mt-1 text-sm text-red-600">{errors.fechaSolicitud}</p>
										{/if}
									</div>
									<div>
										<label
											for="fechaRealizacion"
											class="mb-2 block text-sm font-semibold text-gray-700"
										>
											Fecha y hora de realización <span class="text-red-500">*</span>
										</label>
										<div class="relative">
											<input
												type="datetime-local"
												id="fechaRealizacion"
												bind:value={fechaRealizacion}
												class="w-full rounded-xl border {errors.fechaRealizacion
													? 'border-red-300'
													: 'border-gray-200'} bg-white px-4 py-2.5 text-sm text-gray-900 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
											/>
										</div>
										{#if errors.fechaRealizacion}
											<p class="mt-1 text-sm text-red-600">{errors.fechaRealizacion}</p>
										{/if}
									</div>
								</div>
							</div>

							<!-- Section 2: Trayecto -->
							<div class="space-y-5">
								<h3
									class="flex items-center gap-2 border-b-2 border-orange-100 pb-2 text-lg font-bold text-gray-900"
								>
									<div
										class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white"
									>
										<span class="text-sm font-bold">2</span>
									</div>
									Trayecto
								</h3>
								<!-- Municipios y Direcciones Específicas -->
								<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
									<!-- Origen -->
									<div class="space-y-4">
										<div>
											<label for="origen" class="mb-2 block text-sm font-semibold text-gray-700">
												Municipio de Origen <span class="text-red-500">*</span>
											</label>
											<button
												type="button"
												on:click={() => (mostrarModalSelectOrigen = true)}
												class="relative flex h-12 w-full items-center gap-3 rounded-lg border {errors.origen
													? 'border-red-300'
													: 'border-gray-300'} bg-white px-4 text-left text-sm transition-all hover:border-orange-300 hover:bg-orange-50/30 focus:border-orange-400 focus:outline-none"
											>
												<div class="flex-shrink-0 text-gray-400">
													<svg
														class="h-5 w-5"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
														/>
													</svg>
												</div>
												{#if selectedOriginMun}
													<span class="flex-1 text-gray-900">
														{municipioOptions.find((o) => o.value === selectedOriginMun)?.label ||
															'Seleccionado'}
													</span>
												{:else}
													<span class="flex-1 text-gray-400">Buscar municipio de origen...</span>
												{/if}
												<svg
													class="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-hover:translate-x-1"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													viewBox="0 0 24 24"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
												</svg>
											</button>
											{#if errors.origen}
												<p class="mt-1 text-sm text-red-600">{errors.origen}</p>
											{/if}
										</div>

										<div>
											<MapboxSearch
												bind:value={originSpecific}
												label="Dirección específica de origen"
												placeholder="Buscar dirección, pozo, campamento..."
												onSelect={(data) => {
													originSpecific = data.address;
													originCoords = { lat: data.coordinates[1], lng: data.coordinates[0] };
												}}
											/>
											{#if originCoords.lat !== 0 && originCoords.lng !== 0}
												<p class="mt-2 text-xs text-gray-500">
													📍 Coordenadas: {originCoords.lat.toFixed(6)}, {originCoords.lng.toFixed(
														6
													)}
												</p>
											{/if}
										</div>
									</div>

									<!-- Destino -->
									<div class="space-y-4">
										<div>
											<label for="destino" class="mb-2 block text-sm font-semibold text-gray-700">
												Municipio de Destino <span class="text-red-500">*</span>
											</label>
											<button
												type="button"
												on:click={() => (mostrarModalSelectDestino = true)}
												class="relative flex h-12 w-full items-center gap-3 rounded-lg border {errors.destino
													? 'border-red-300'
													: 'border-gray-300'} bg-white px-4 text-left text-sm transition-all hover:border-orange-300 hover:bg-orange-50/30 focus:border-orange-400 focus:outline-none"
											>
												<div class="flex-shrink-0 text-gray-400">
													<svg
														class="h-5 w-5"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
														/>
													</svg>
												</div>
												{#if selectedDestMun}
													<span class="flex-1 text-gray-900">
														{municipioOptions.find((o) => o.value === selectedDestMun)?.label ||
															'Seleccionado'}
													</span>
												{:else}
													<span class="flex-1 text-gray-400">Buscar municipio de destino...</span>
												{/if}
												<svg
													class="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-hover:translate-x-1"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													viewBox="0 0 24 24"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
												</svg>
											</button>
											{#if errors.destino}
												<p class="mt-1 text-sm text-red-600">{errors.destino}</p>
											{/if}
										</div>

										<div>
											<MapboxSearch
												bind:value={destSpecific}
												label="Dirección específica de destino"
												placeholder="Buscar dirección, pozo, campamento..."
												onSelect={(data) => {
													destSpecific = data.address;
													destCoords = { lat: data.coordinates[1], lng: data.coordinates[0] };
												}}
											/>
											{#if destCoords.lat !== 0 && destCoords.lng !== 0}
												<p class="mt-2 text-xs text-gray-500">
													📍 Coordenadas: {destCoords.lat.toFixed(6)}, {destCoords.lng.toFixed(6)}
												</p>
											{/if}
										</div>
									</div>
								</div>

								<!-- Purpose -->
								<div>
									<label class="mb-3 block text-sm font-semibold text-gray-700">
										Propósito del Servicio <span class="text-red-500">*</span>
									</label>
									<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
										<label
											class="group relative flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all {purpose ===
											'personal'
												? 'border-orange-500 bg-orange-50/50'
												: errors.purpose
													? 'border-red-300 bg-white hover:border-red-400 hover:bg-red-50/30'
													: 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}"
										>
											<input
												type="radio"
												name="purpose"
												value="personal"
												bind:group={purpose}
												class="h-5 w-5 border-gray-300 text-orange-600 focus:ring-2 focus:ring-orange-500 focus:ring-offset-0"
											/>
											<div class="flex flex-1 items-center gap-3">
												<div class="rounded-lg bg-orange-100 p-2 text-orange-600">
													<svg
														class="h-5 w-5"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
														/>
													</svg>
												</div>
												<div>
													<p class="font-semibold text-gray-900">Transporte de personal</p>
													<p class="text-xs text-gray-500">Solo pasajeros</p>
												</div>
											</div>
										</label>
										<label
											class="group relative flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all {purpose ===
											'personal y herramienta'
												? 'border-orange-500 bg-orange-50/50'
												: errors.purpose
													? 'border-red-300 bg-white hover:border-red-400 hover:bg-red-50/30'
													: 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}"
										>
											<input
												type="radio"
												name="purpose"
												value="personal y herramienta"
												bind:group={purpose}
												class="h-5 w-5 border-gray-300 text-orange-600 focus:ring-2 focus:ring-orange-500 focus:ring-offset-0"
											/>
											<div class="flex flex-1 items-center gap-3">
												<div class="rounded-lg bg-orange-100 p-2 text-orange-600">
													<svg
														class="h-5 w-5"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
														/>
													</svg>
												</div>
												<div>
													<p class="font-semibold text-gray-900">Personal y herramienta</p>
													<p class="text-xs text-gray-500">Pasajeros y equipo</p>
												</div>
											</div>
										</label>
									</div>
								</div>
								{#if errors.purpose}
									<p class="mt-1 text-sm text-red-600">{errors.purpose}</p>
								{/if}
							</div>

							<!-- Section 3: Recursos -->
							<div class="space-y-5">
								<h3
									class="flex items-center gap-2 border-b-2 border-orange-100 pb-2 text-lg font-bold text-gray-900"
								>
									<div
										class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white"
									>
										<span class="text-sm font-bold">3</span>
									</div>
									Recursos
								</h3>
								<!-- Vehicle and Conductor -->
								<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
									<div>
										<label for="vehiculo" class="mb-2 block text-sm font-semibold text-gray-700">
											Vehículo Asignado
										</label>
										<div class="flex items-stretch gap-2">
											<div class="glass relative flex-1">
												<div
													class="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-gray-400"
												>
													<svg
														class="h-5 w-5"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
														/>
													</svg>
												</div>
												<Select
													items={vehiculoOptions}
													value={vehiculoOptions.find((o) => o.value === vehicleSelected)}
													on:change={(e) => (vehicleSelected = e.detail?.value || '')}
													on:clear={() => (vehicleSelected = '')}
													placeholder="Buscar o seleccionar vehículo..."
													--border-radius="0.75rem"
													--padding="1.25rem 1rem 1.25rem 2.75rem"
													--border-focused="1px solid rgb(16 185 129)"
													--border-hover="1px solid rgb(209 213 219)"
													--font-size="0.875rem"
													--item-font-size="0.875rem"
												/>
											</div>
											<button
												type="button"
												on:click={() => (mostrarModalVehiculo = true)}
												class="group flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-orange-300 bg-orange-50/50 text-orange-600 transition-all hover:scale-105 hover:border-orange-400 hover:bg-orange-50"
												title="Crear nuevo vehículo"
											>
												<svg
													class="h-5 w-5 transition-transform group-hover:rotate-90"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													viewBox="0 0 24 24"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
												</svg>
											</button>
										</div>
									</div>
									<div>
										<label for="conductor" class="mb-2 block text-sm font-semibold text-gray-700">
											Conductor Asignado
										</label>
										<div class="flex items-stretch gap-2">
											<div class="glass relative flex-1">
												<div
													class="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-gray-400"
												>
													<svg
														class="h-5 w-5"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
														/>
													</svg>
												</div>
												<Select
													items={conductorOptions}
													value={conductorOptions.find((o) => o.value === conductorSelected)}
													on:change={(e) => (conductorSelected = e.detail?.value || '')}
													on:clear={() => (conductorSelected = '')}
													placeholder="Buscar o seleccionar conductor..."
													--border-radius="0.75rem"
													--padding="1.25rem 1rem 1.25rem 2.75rem"
													--border-focused="1px solid rgb(16 185 129)"
													--border-hover="1px solid rgb(209 213 219)"
													--font-size="0.875rem"
													--item-font-size="0.875rem"
												/>
											</div>
											<button
												type="button"
												on:click={() => (mostrarModalConductor = true)}
												class="group flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-orange-300 bg-orange-50/50 text-orange-600 transition-all hover:scale-105 hover:border-orange-400 hover:bg-orange-50"
												title="Crear nuevo conductor"
											>
												<svg
													class="h-5 w-5 transition-transform group-hover:rotate-90"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													viewBox="0 0 24 24"
												>
													<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
												</svg>
											</button>
										</div>
									</div>
								</div>

								<!-- Observaciones -->
								<div>
									<label for="observaciones" class="mb-2 block text-sm font-semibold text-gray-700">
										Observaciones
									</label>
									<textarea
										id="observaciones"
										bind:value={observaciones}
										rows="4"
										placeholder="Escribe cualquier observación relevante del servicio..."
										class="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
										style="max-height: 300px;"
									></textarea>
								</div>
							</div>

							<!-- Section 4: Estado y Finalización -->
							<div class="space-y-5">
								<h3
									class="flex items-center gap-2 border-b-2 border-orange-100 pb-2 text-lg font-bold text-gray-900"
								>
									<div
										class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white"
									>
										<span class="text-sm font-bold">4</span>
									</div>
									Estado y Finalización
								</h3>
								<div>
									<label class="mb-3 block text-sm font-semibold text-gray-700">
										Estado del Servicio
									</label>
									<div
										class="rounded-2xl border-2 border-orange-100 bg-gradient-to-br from-orange-50/50 to-amber-50/50 p-5"
									>
										<div class="flex items-start gap-3">
											<div class="rounded-lg bg-orange-100 p-2 text-orange-600">
												<svg
													class="h-5 w-5"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
													/>
												</svg>
											</div>
											<div class="flex-1">
												<p class="text-sm leading-relaxed font-medium text-gray-700">
													{(() => {
														const now = new Date();
														const fechaReal = new Date(fechaRealizacion);

														if (fechaReal < now) {
															if (!conductorSelected || !vehicleSelected) {
																return 'La fecha de realización es anterior a la actual. Para registrar o actualizar este servicio, debe asignar un conductor y un vehículo.';
															}
															return 'El servicio será registrado como EN CURSO ya que la fecha de realización es anterior a la actual; a menos que marque el servicio como finalizado.';
														}

														return conductorSelected && vehicleSelected
															? 'El servicio será registrado como PLANIFICADO ya que tiene conductor y vehículo asignados.'
															: 'El servicio será registrado como SOLICITADO ya que no tiene conductor o vehículo asignados.';
													})()}
												</p>
												<div
													class="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm"
												>
													<div class="h-2 w-2 animate-pulse rounded-full bg-orange-500"></div>
													{(() => {
														const now = new Date();
														const fechaReal = new Date(fechaRealizacion);
														if (fechaReal < now && conductorSelected && vehicleSelected) {
															return finalizarServicio ? 'REALIZADO' : 'EN CURSO';
														}
														return conductorSelected && vehicleSelected
															? 'PLANIFICADO'
															: 'SOLICITADO';
													})()}
												</div>
											</div>
										</div>
									</div>

									{#if conductorSelected && vehicleSelected && new Date(fechaRealizacion) < new Date()}
										<div class="mt-5 space-y-4">
											<label
												class="flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all {finalizarServicio
													? 'border-orange-500 bg-orange-50/50'
													: 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}"
											>
												<input
													type="checkbox"
													bind:checked={finalizarServicio}
													class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-2 focus:ring-orange-500 focus:ring-offset-0"
												/>
												<div class="flex items-center gap-3">
													<div class="rounded-lg bg-orange-100 p-2 text-orange-600">
														<svg
															class="h-5 w-5"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
															/>
														</svg>
													</div>
													<div>
														<p class="font-semibold text-gray-900">
															Marcar servicio como finalizado
														</p>
														<p class="text-xs text-gray-500">
															El servicio pasará al estado "Realizado"
														</p>
													</div>
												</div>
											</label>

											{#if finalizarServicio}
												<div in:fly={{ y: -10, duration: 200 }}>
													<label
														for="fechaFinalizacion"
														class="mb-2 block text-sm font-semibold text-gray-700"
													>
														Fecha y hora de finalización <span class="text-red-500">*</span>
													</label>
													<input
														type="datetime-local"
														id="fechaFinalizacion"
														bind:value={fechaFinalizacion}
														class="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 transition-all focus:border-orange-400 focus:ring-4 focus:ring-orange-400/10 focus:outline-none"
													/>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Footer buttons -->
				<div class="border-t border-gray-100 bg-gray-50/30 px-8 py-5">
					{#if isReadOnly}
						<div class="flex justify-end">
							<button
								on:click={handleClose}
								class="group flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
								Cerrar
							</button>
						</div>
					{:else}
						<div class="flex items-center justify-between">
							<button
								on:click={handleClose}
								class="flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
								Cancelar
							</button>

							<button
								on:click={handleSubmit}
								disabled={loading}
								class="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-8 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-105 hover:shadow-xl hover:shadow-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
							>
								{#if loading}
									<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									Guardando...
								{:else}
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M5 13l4 4L19 7"
										/>
									</svg>
									{isEditing ? 'Actualizar Servicio' : 'Crear Servicio'}
								{/if}
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Sub-modals -->
<ModalSelectCliente
	isOpen={mostrarModalSelectCliente}
	items={empresaOptions}
	selectedValue={clienteSelected}
	title="Seleccionar Cliente / Empresa"
	icon="building"
	searchPlaceholder="Buscar por nombre de empresa..."
	emptyMessage="No se encontraron empresas"
	onClose={() => (mostrarModalSelectCliente = false)}
	onSelect={(value) => (clienteSelected = value)}
/>

<ModalSelectCliente
	isOpen={mostrarModalSelectOrigen}
	items={municipioOptions}
	selectedValue={selectedOriginMun}
	title="Seleccionar Municipio de Origen"
	icon="location"
	searchPlaceholder="Buscar municipio..."
	emptyMessage="No se encontraron municipios"
	onClose={() => (mostrarModalSelectOrigen = false)}
	onSelect={(value) => (selectedOriginMun = value)}
/>

<ModalSelectCliente
	isOpen={mostrarModalSelectDestino}
	items={municipioOptions}
	selectedValue={selectedDestMun}
	title="Seleccionar Municipio de Destino"
	icon="location"
	searchPlaceholder="Buscar municipio..."
	emptyMessage="No se encontraron municipios"
	onClose={() => (mostrarModalSelectDestino = false)}
	onSelect={(value) => (selectedDestMun = value)}
/>

<ModalNuevaEmpresa
	isOpen={mostrarModalEmpresa}
	onClose={() => (mostrarModalEmpresa = false)}
	onSuccess={handleEmpresaCreada}
/>

<ModalNuevoConductor
	isOpen={mostrarModalConductor}
	onClose={() => (mostrarModalConductor = false)}
	onSuccess={handleConductorCreado}
/>

<ModalNuevoVehiculo
	isOpen={mostrarModalVehiculo}
	onClose={() => (mostrarModalVehiculo = false)}
	onSuccess={handleVehiculoCreado}
/>

<style>
	/* Estilos personalizados para el scrollbar */
	:global(.overflow-y-auto::-webkit-scrollbar) {
		width: 8px;
	}

	:global(.overflow-y-auto::-webkit-scrollbar-track) {
		background: #f1f5f9;
		border-radius: 10px;
	}

	:global(.overflow-y-auto::-webkit-scrollbar-thumb) {
		background: linear-gradient(to bottom, #dd5e28, #bc441b);
		border-radius: 10px;
		transition: background 0.3s ease;
	}

	:global(.overflow-y-auto::-webkit-scrollbar-thumb:hover) {
		background: linear-gradient(to bottom, #c9551b, #b4461e);
	}

	/* Para Firefox */
	:global(.overflow-y-auto) {
		scrollbar-width: thin;
		scrollbar-color: #cb4c26 #f1f5f9;
	}
</style>
