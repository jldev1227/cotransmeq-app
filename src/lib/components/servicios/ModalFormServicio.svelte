<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
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
	import { labelPropositoServicio } from '$lib/config/proposito-servicio';
	import { apiClient } from '$lib/api/apiClient';
	import type { ServicioConRelaciones } from '$lib/types/servicios';
	import ModalNuevaEmpresa from './ModalNuevaEmpresa.svelte';
	import ModalNuevoConductor from './ModalNuevoConductor.svelte';
	import ModalNuevoVehiculo from './ModalNuevoVehiculo.svelte';
	import ModalSelectCliente from '$lib/components/ui/ModalSelectCliente.svelte';
	import MapboxSearch from '$lib/components/ui/MapboxSearch.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import { formularioAbierto } from '$lib/stores/formularioAbierto';
	import {
		Building2,
		Check,
		ChevronDown,
		ChevronRight,
		CircleCheck,
		Info,
		LoaderCircle,
		MapPin,
		Package,
		Plus,
		Truck,
		UserRound,
		Users,
		X
	} from 'lucide-svelte';

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

	// Con un sub-modal encima, Escape y el fondo son de él: el formulario no se cierra.
	$: subModalAbierto =
		mostrarModalEmpresa ||
		mostrarModalConductor ||
		mostrarModalVehiculo ||
		mostrarModalSelectCliente ||
		mostrarModalSelectOrigen ||
		mostrarModalSelectDestino;

	// Escape dentro de un campo (buscador de direcciones, svelte-select) cierra su
	// lista, no el modal: se marca en captura, antes de que ModalBase lo vea.
	let escapeInterno = false;
	function marcarEscapeInterno(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !isOpen) return;
		const target = e.target as HTMLElement | null;
		if (!target?.closest?.('.fs-form input, .fs-form textarea, .fs-form .svelte-select')) return;
		escapeInterno = true;
		setTimeout(() => (escapeInterno = false));
	}

	// Avisa a ToastProvider para que los toasts no tapen el pie del modal.
	let avisandoToasts = false;
	$: if (isOpen !== avisandoToasts) {
		if (isOpen) formularioAbierto.entrar();
		else formularioAbierto.salir();
		avisandoToasts = isOpen;
	}
	onDestroy(() => {
		if (avisandoToasts) formularioAbierto.salir();
	});

	// Estado con el que quedará registrado el servicio (vista previa).
	$: mensajeEstado = (() => {
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
	})();
	$: estadoPrevisto = (() => {
		const now = new Date();
		const fechaReal = new Date(fechaRealizacion);
		if (fechaReal < now && conductorSelected && vehicleSelected) {
			return finalizarServicio ? 'REALIZADO' : 'EN CURSO';
		}
		return conductorSelected && vehicleSelected ? 'PLANIFICADO' : 'SOLICITADO';
	})();

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
		// Agregar al store y auto-seleccionar
		recursos.agregarConductor(conductor);
		conductorSelected = conductor.id;
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
		isReadOnly = false;

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
		purpose = proposito;
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
			if (isEditing && servicio?.estado) {
				// En edición, respetar el estado original del servicio.
				// Solo cambiar si el usuario marca explícitamente "finalizar".
				if (finalizarServicio && fechaFinalizacion) {
					estadoServicio = 'realizado';
				} else {
					estadoServicio = servicio.estado;
				}
			} else {
				if (finalizarServicio && fechaFinalizacion) {
					estadoServicio = 'realizado';
				} else if (conductorSelected && vehicleSelected) {
					estadoServicio = fechaReal < now ? 'en_curso' : 'planificado';
				} else {
					estadoServicio = 'solicitado';
				}
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

<svelte:window onkeydowncapture={marcarEscapeInterno} />

<ModalBase
	open={isOpen}
	eyebrow={isEditing ? (isReadOnly ? 'Detalle' : 'Edición') : 'Nuevo registro'}
	title={isEditing ? (isReadOnly ? 'Detalles del Servicio' : 'Editar Servicio') : 'Nuevo Servicio'}
	subtitle="Complete toda la información para registrar el servicio"
	tamano="lg"
	bloqueado={loading || subModalAbierto || escapeInterno}
	oncerrar={handleClose}
>
	{#snippet accionesCabecera()}
		{#if isEditing && servicio}
			<span class="fs-estado-hero">{servicio.estado.replace('_', ' ').toUpperCase()}</span>
		{/if}
	{/snippet}

	<div class="fs-form">
		{#if isReadOnly}
			<!-- Vista de solo lectura -->
			<section class="fs-seccion">
				<h3 class="fs-titulo">Información Básica</h3>
				<div class="fs-datos">
					<Dato
						etiqueta="Cliente"
						valor={empresas.find((e) => e.id === servicio?.cliente_id)?.nombre || 'No asignado'}
					/>
					<Dato etiqueta="Estado">
						<span class="capitalize">{servicio?.estado}</span>
					</Dato>
					<Dato
						etiqueta="Fecha de Solicitud"
						valor={servicio?.fecha_solicitud
							? new Date(servicio.fecha_solicitud).toLocaleString('es-CO')
							: 'No definida'}
					/>
					<Dato
						etiqueta="Fecha de Realización"
						valor={servicio?.fecha_realizacion
							? new Date(servicio.fecha_realizacion).toLocaleString('es-CO')
							: 'No definida'}
					/>
				</div>
			</section>

			<section class="fs-seccion">
				<h3 class="fs-titulo">Origen y Destino</h3>
				<div class="fs-datos">
					<Dato etiqueta="Origen">
						{servicio?.origen_especifico}
						<span class="fs-dato-sub">
							{municipiosData.find((m) => m.id === servicio?.origen_id)?.nombre_municipio ||
								'No especificado'}
						</span>
					</Dato>
					<Dato etiqueta="Destino">
						{servicio?.destino_especifico}
						<span class="fs-dato-sub">
							{municipiosData.find((m) => m.id === servicio?.destino_id)?.nombre_municipio ||
								'No especificado'}
						</span>
					</Dato>
					<Dato
						etiqueta="Propósito"
						valor={servicio?.proposito_servicio
							? labelPropositoServicio(servicio.proposito_servicio)
							: 'No especificado'}
					/>
				</div>
			</section>

			<section class="fs-seccion">
				<h3 class="fs-titulo">Asignaciones</h3>
				<div class="fs-datos">
					<Dato
						etiqueta="Conductor"
						valor={conductores.find((c) => c.id === servicio?.conductor_id)
							? `${conductores.find((c) => c.id === servicio?.conductor_id)?.nombre} ${conductores.find((c) => c.id === servicio?.conductor_id)?.apellido}`
							: 'No asignado'}
					/>
					<Dato
						etiqueta="Vehículo"
						valor={vehiculos.find((v) => v.id === servicio?.vehiculo_id)
							? `${vehiculos.find((v) => v.id === servicio?.vehiculo_id)?.placa} (${vehiculos.find((v) => v.id === servicio?.vehiculo_id)?.marca})`
							: 'No asignado'}
					/>
				</div>
			</section>

			{#if servicio?.observaciones}
				<section class="fs-seccion">
					<h3 class="fs-titulo">Observaciones</h3>
					<div class="fs-datos">
						<Dato etiqueta="Observaciones" valor={servicio.observaciones} completo />
					</div>
				</section>
			{/if}
		{:else}
			<!-- Formulario: todas las secciones en una sola vista con scroll -->
			<section class="fs-seccion">
				<h3 class="fs-titulo"><span class="fs-paso">1</span>Información Básica</h3>
				<div class="fs-card fs-grid">
					<Campo id="cliente" label="Cliente / Empresa" requerido error={errors.cliente} completo>
						<div class="fs-fila">
							<button
								type="button"
								id="cliente"
								class="fs-input fs-picker"
								class:fs-input--error={!!errors.cliente}
								onclick={() => (mostrarModalSelectCliente = true)}
							>
								<Building2 size={18} class="fs-picker-icono" />
								{#if clienteSelected}
									<span class="fs-picker-valor">
										{empresaOptions.find((o) => o.value === clienteSelected)?.label ||
											'Seleccionar empresa'}
									</span>
								{:else}
									<span class="fs-picker-vacio">Buscar o seleccionar empresa...</span>
								{/if}
								<ChevronRight size={16} class="fs-picker-flecha" />
							</button>
							<button
								type="button"
								class="fs-btn-crear"
								title="Crear nueva empresa"
								aria-label="Crear nueva empresa"
								onclick={() => (mostrarModalEmpresa = true)}
							>
								<Plus size={18} strokeWidth={2.5} />
							</button>
						</div>
					</Campo>

					<Campo
						id="fechaSolicitud"
						label="Fecha y hora de solicitud"
						requerido
						error={errors.fechaSolicitud}
					>
						<input
							type="datetime-local"
							id="fechaSolicitud"
							class="fs-input"
							aria-invalid={errors.fechaSolicitud ? 'true' : undefined}
							bind:value={fechaSolicitud}
						/>
					</Campo>
					<Campo
						id="fechaRealizacion"
						label="Fecha y hora de realización"
						requerido
						error={errors.fechaRealizacion}
					>
						<input
							type="datetime-local"
							id="fechaRealizacion"
							class="fs-input"
							aria-invalid={errors.fechaRealizacion ? 'true' : undefined}
							bind:value={fechaRealizacion}
						/>
					</Campo>
				</div>
			</section>

			<section class="fs-seccion">
				<h3 class="fs-titulo"><span class="fs-paso">2</span>Trayecto</h3>
				<div class="fs-card fs-grid">
					<!-- Origen -->
					<div class="fs-columna">
						<Campo id="origen" label="Municipio de Origen" requerido error={errors.origen}>
							<button
								type="button"
								id="origen"
								class="fs-input fs-picker"
								class:fs-input--error={!!errors.origen}
								onclick={() => (mostrarModalSelectOrigen = true)}
							>
								<MapPin size={18} class="fs-picker-icono" />
								{#if selectedOriginMun}
									<span class="fs-picker-valor">
										{municipioOptions.find((o) => o.value === selectedOriginMun)?.label ||
											'Seleccionado'}
									</span>
								{:else}
									<span class="fs-picker-vacio">Buscar municipio de origen...</span>
								{/if}
								<ChevronDown size={16} class="fs-picker-flecha" />
							</button>
						</Campo>

						<div class="fs-mapbox">
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
								<p class="fs-coords">
									<MapPin size={13} />
									Coordenadas: {originCoords.lat.toFixed(6)}, {originCoords.lng.toFixed(6)}
								</p>
							{/if}
						</div>
					</div>

					<!-- Destino -->
					<div class="fs-columna">
						<Campo id="destino" label="Municipio de Destino" requerido error={errors.destino}>
							<button
								type="button"
								id="destino"
								class="fs-input fs-picker"
								class:fs-input--error={!!errors.destino}
								onclick={() => (mostrarModalSelectDestino = true)}
							>
								<MapPin size={18} class="fs-picker-icono" />
								{#if selectedDestMun}
									<span class="fs-picker-valor">
										{municipioOptions.find((o) => o.value === selectedDestMun)?.label ||
											'Seleccionado'}
									</span>
								{:else}
									<span class="fs-picker-vacio">Buscar municipio de destino...</span>
								{/if}
								<ChevronDown size={16} class="fs-picker-flecha" />
							</button>
						</Campo>

						<div class="fs-mapbox">
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
								<p class="fs-coords">
									<MapPin size={13} />
									Coordenadas: {destCoords.lat.toFixed(6)}, {destCoords.lng.toFixed(6)}
								</p>
							{/if}
						</div>
					</div>

					<!-- Propósito -->
					<fieldset class="fs-grupo de-full">
						<legend class="fs-label">
							Propósito del Servicio <span class="fs-req" aria-hidden="true">*</span>
						</legend>
						<div class="fs-opciones">
							<label
								class="fs-opcion"
								class:fs-opcion--activa={purpose === 'personal'}
								class:fs-opcion--error={!!errors.purpose && purpose !== 'personal'}
							>
								<input
									type="radio"
									name="purpose"
									value="personal"
									class="sr-only"
									bind:group={purpose}
								/>
								<span class="fs-opcion-icono"><Users size={18} /></span>
								<span class="fs-opcion-texto">
									<span class="fs-opcion-titulo">Transporte de personal</span>
									<span class="fs-opcion-sub">Solo pasajeros</span>
								</span>
								<span class="fs-opcion-check" aria-hidden="true"
									><Check size={14} strokeWidth={3} /></span
								>
							</label>
							<label
								class="fs-opcion"
								class:fs-opcion--activa={purpose === 'personal y herramienta'}
								class:fs-opcion--error={!!errors.purpose && purpose !== 'personal y herramienta'}
							>
								<input
									type="radio"
									name="purpose"
									value="personal y herramienta"
									class="sr-only"
									bind:group={purpose}
								/>
								<span class="fs-opcion-icono"><Package size={18} /></span>
								<span class="fs-opcion-texto">
									<span class="fs-opcion-titulo">Personal y herramienta</span>
									<span class="fs-opcion-sub">Pasajeros y equipo</span>
								</span>
								<span class="fs-opcion-check" aria-hidden="true"
									><Check size={14} strokeWidth={3} /></span
								>
							</label>
						</div>
						{#if errors.purpose}
							<p class="fs-error" role="alert">{errors.purpose}</p>
						{/if}
					</fieldset>
				</div>
			</section>

			<section class="fs-seccion">
				<h3 class="fs-titulo"><span class="fs-paso">3</span>Recursos</h3>
				<div class="fs-card fs-grid">
					<Campo id="vehiculo" label="Vehículo Asignado">
						<div class="fs-fila">
							<div class="fs-select">
								<span class="fs-select-icono" aria-hidden="true"><Truck size={18} /></span>
								<Select
									id="vehiculo"
									items={vehiculoOptions}
									value={vehiculoOptions.find((o) => o.value === vehicleSelected)}
									on:change={(e) => (vehicleSelected = e.detail?.value || '')}
									on:clear={() => (vehicleSelected = '')}
									placeholder="Buscar o seleccionar vehículo..."
									--height="42px"
									--padding="0 0 0 40px"
									--border="1px solid var(--border-default)"
									--border-hover="1px solid var(--border-emphasis)"
									--border-focused="1px solid var(--accion)"
									--border-radius="12px"
									--border-radius-focused="12px"
									--background="var(--bg-surface)"
									--placeholder-color="var(--text-very-muted)"
									--font-size="14px"
									--item-is-active-bg="var(--accion)"
									--item-hover-bg="var(--bg-base)"
									--list-border-radius="12px"
								/>
							</div>
							<button
								type="button"
								class="fs-btn-crear"
								title="Crear nuevo vehículo"
								aria-label="Crear nuevo vehículo"
								onclick={() => (mostrarModalVehiculo = true)}
							>
								<Plus size={18} strokeWidth={2.5} />
							</button>
						</div>
					</Campo>
					<Campo id="conductor" label="Conductor Asignado">
						<div class="fs-fila">
							<div class="fs-select">
								<span class="fs-select-icono" aria-hidden="true"><UserRound size={18} /></span>
								<Select
									id="conductor"
									items={conductorOptions}
									value={conductorOptions.find((o) => o.value === conductorSelected)}
									on:change={(e) => (conductorSelected = e.detail?.value || '')}
									on:clear={() => (conductorSelected = '')}
									placeholder="Buscar o seleccionar conductor..."
									--height="42px"
									--padding="0 0 0 40px"
									--border="1px solid var(--border-default)"
									--border-hover="1px solid var(--border-emphasis)"
									--border-focused="1px solid var(--accion)"
									--border-radius="12px"
									--border-radius-focused="12px"
									--background="var(--bg-surface)"
									--placeholder-color="var(--text-very-muted)"
									--font-size="14px"
									--item-is-active-bg="var(--accion)"
									--item-hover-bg="var(--bg-base)"
									--list-border-radius="12px"
								/>
							</div>
							<button
								type="button"
								class="fs-btn-crear"
								title="Crear nuevo conductor"
								aria-label="Crear nuevo conductor"
								onclick={() => (mostrarModalConductor = true)}
							>
								<Plus size={18} strokeWidth={2.5} />
							</button>
						</div>
					</Campo>

					<Campo
						id="observaciones"
						label="Observaciones"
						ayuda="Visibles para el conductor en la app."
						completo
					>
						<textarea
							id="observaciones"
							class="fs-input"
							rows="4"
							placeholder="Indicaciones para el conductor: hora de recogida, contacto, recomendaciones de la ruta..."
							style="max-height: 300px;"
							bind:value={observaciones}
						></textarea>
					</Campo>
				</div>
			</section>

			<section class="fs-seccion">
				<h3 class="fs-titulo"><span class="fs-paso">4</span>Estado y Finalización</h3>
				<div class="fs-card fs-estado">
					<p class="fs-label">Estado del Servicio</p>
					<div class="fs-estado-aviso">
						<span class="fs-estado-icono"><Info size={18} /></span>
						<div class="fs-estado-copy">
							<p class="fs-estado-texto">{mensajeEstado}</p>
							<span class="fs-chip-estado">
								<span class="fs-chip-punto" aria-hidden="true"></span>
								{estadoPrevisto}
							</span>
						</div>
					</div>

					{#if conductorSelected && vehicleSelected && new Date(fechaRealizacion) < new Date()}
						<label class="fs-opcion" class:fs-opcion--activa={finalizarServicio}>
							<input type="checkbox" class="sr-only" bind:checked={finalizarServicio} />
							<span class="fs-opcion-icono"><CircleCheck size={18} /></span>
							<span class="fs-opcion-texto">
								<span class="fs-opcion-titulo">Marcar servicio como finalizado</span>
								<span class="fs-opcion-sub">El servicio pasará al estado "Realizado"</span>
							</span>
							<span class="fs-opcion-check" aria-hidden="true"
								><Check size={14} strokeWidth={3} /></span
							>
						</label>

						{#if finalizarServicio}
							<div in:fly={{ y: -10, duration: 200 }}>
								<Campo id="fechaFinalizacion" label="Fecha y hora de finalización" requerido>
									<input
										type="datetime-local"
										id="fechaFinalizacion"
										class="fs-input"
										bind:value={fechaFinalizacion}
									/>
								</Campo>
							</div>
						{/if}
					{/if}
				</div>
			</section>
		{/if}
	</div>

	{#snippet pie()}
		{#if isReadOnly}
			<button type="button" class="btn-secondary" onclick={handleClose}>
				<X size={16} />
				Cerrar
			</button>
		{:else}
			<button type="button" class="btn-secondary" onclick={handleClose} disabled={loading}>
				<X size={16} />
				Cancelar
			</button>
			<button type="button" class="btn-primary" onclick={handleSubmit} disabled={loading}>
				{#if loading}
					<LoaderCircle size={16} class="animate-spin" />
					Guardando...
				{:else}
					<Check size={16} />
					{isEditing ? 'Actualizar Servicio' : 'Crear Servicio'}
				{/if}
			</button>
		{/if}
	{/snippet}
</ModalBase>

<!-- Sub-modales: van en una capa sobre ModalBase (z-index 10040) y bajo los
     diálogos de confirmación (10050); sin ella quedarían tapados por el modal. -->
<div class="fs-capa-submodales">
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
</div>

<style>
	.fs-capa-submodales {
		position: relative;
		z-index: 10045;
	}

	/* Chip del estado actual, sobre el encabezado oscuro de la marca. */
	.fs-estado-hero {
		display: inline-flex;
		align-items: center;
		padding: 5px 10px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}

	.fs-form {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.fs-seccion {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.fs-titulo {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-primary);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.fs-paso {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accion) 12%, transparent);
		color: var(--color-emerald-600);
		font-size: 12px;
		font-weight: 800;
	}
	.fs-card {
		padding: 16px;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	/* Rejilla de campos: dos columnas, una en el teléfono (como `.de-grid`). */
	.fs-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.fs-form :global(.de-full) {
		grid-column: 1 / -1;
	}
	.fs-columna {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}
	.fs-fila {
		display: flex;
		align-items: stretch;
		gap: 8px;
	}

	/* Controles con el aspecto de `.de-input` de los formularios de directorio. */
	.fs-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.fs-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	textarea.fs-input {
		resize: vertical;
	}
	.fs-input:focus,
	.fs-input:focus-visible {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.fs-input[aria-invalid='true'],
	.fs-input--error {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.fs-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	/* Botón que abre el selector con buscador (cliente, municipios). */
	.fs-picker {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		text-align: left;
		cursor: pointer;
	}
	.fs-picker:hover:not(:disabled) {
		border-color: var(--border-emphasis);
	}
	.fs-picker :global(.fs-picker-icono) {
		flex-shrink: 0;
		color: var(--text-muted);
	}
	.fs-picker:hover :global(.fs-picker-icono) {
		color: var(--accion);
	}
	.fs-picker :global(.fs-picker-flecha) {
		flex-shrink: 0;
		color: var(--text-very-muted);
	}
	.fs-picker-valor {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text-primary);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fs-picker-vacio {
		flex: 1;
		min-width: 0;
		color: var(--text-very-muted);
	}

	.fs-btn-crear {
		width: 42px;
		min-height: 42px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--accion);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.fs-btn-crear:hover {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 8%, var(--bg-surface));
	}
	.fs-btn-crear:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}

	/* svelte-select con ícono a la izquierda. */
	.fs-select {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.fs-select-icono {
		position: absolute;
		z-index: 2;
		top: 50%;
		left: 12px;
		display: flex;
		color: var(--text-muted);
		pointer-events: none;
		transform: translateY(-50%);
	}

	/* MapboxSearch trae su propia etiqueta e input: se alinean con `Campo`. */
	.fs-mapbox :global(label[for='address-search-input']) {
		display: block;
		margin-bottom: 6px;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.fs-mapbox :global(#address-search-input) {
		border-radius: 12px;
		font-size: 14px;
	}
	.fs-mapbox :global(#address-search-input:not(.border-red-300)) {
		border-color: var(--border-default);
	}
	.fs-mapbox :global(#address-search-input:focus) {
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.fs-coords {
		margin: 8px 0 0;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	/* Grupos de opciones (propósito, finalizar): chips-tarjeta suaves. */
	.fs-grupo {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fs-label {
		margin: 0;
		padding: 0;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.fs-req {
		margin-left: 2px;
		color: #dc2626;
	}
	.fs-error {
		margin: 0;
		color: #b42318;
		font-size: 12px;
		font-weight: 600;
	}
	.fs-opciones {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.fs-opcion {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1.5px solid var(--border-default);
		border-radius: 16px;
		background: var(--bg-surface);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.fs-opcion:hover {
		border-color: var(--border-emphasis);
	}
	.fs-opcion:has(input:focus-visible) {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.fs-opcion--error {
		border-color: #f3b1aa;
	}
	.fs-opcion--activa,
	.fs-opcion--activa:hover {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}
	.fs-opcion-icono {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.fs-opcion--activa .fs-opcion-icono {
		background: color-mix(in srgb, var(--accion) 14%, transparent);
		color: var(--color-emerald-600);
	}
	.fs-opcion-texto {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.fs-opcion-titulo {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 800;
	}
	.fs-opcion-sub {
		color: var(--text-muted);
		font-size: 12px;
	}
	.fs-opcion-check {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		color: transparent;
	}
	.fs-opcion--activa .fs-opcion-check {
		border-color: var(--accion);
		background: var(--accion);
		color: #fff;
	}

	/* Estado previsto del servicio. */
	.fs-estado {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.fs-estado-aviso {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px;
		border-radius: 16px;
		background: var(--bg-base);
	}
	.fs-estado-icono {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accion) 12%, transparent);
		color: var(--color-emerald-600);
	}
	.fs-estado-copy {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
	}
	.fs-estado-texto {
		margin: 0;
		color: var(--text-secondary);
		font-size: 13.5px;
		line-height: 1.5;
	}
	.fs-chip-estado {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border: 1px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.06em;
	}
	.fs-chip-punto {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--accion);
	}

	/* Vista de solo lectura. */
	.fs-datos {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.fs-dato-sub {
		display: block;
		margin-top: 2px;
		color: var(--text-muted);
		font-size: 12.5px;
		font-weight: 600;
	}

	@media (max-width: 640px) {
		.fs-grid,
		.fs-opciones,
		.fs-datos {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* Estilos personalizados para el scrollbar */
	:global(.overflow-y-auto::-webkit-scrollbar) {
		width: 8px;
	}

	:global(.overflow-y-auto::-webkit-scrollbar-track) {
		background: #f1f5f9;
		border-radius: 10px;
	}

	:global(.overflow-y-auto::-webkit-scrollbar-thumb) {
		background: var(--accion);
		border-radius: 10px;
		transition: background 0.3s ease;
	}

	:global(.overflow-y-auto::-webkit-scrollbar-thumb:hover) {
		background: var(--accion-hover);
	}

	/* Para Firefox */
	:global(.overflow-y-auto) {
		scrollbar-width: thin;
		scrollbar-color: var(--accion) #f1f5f9;
	}
</style>
