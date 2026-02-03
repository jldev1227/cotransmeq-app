<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva,
		type CreateAccionInput,
		type CausaAccion,
		type TipoHallazgo,
		type ValoracionRiesgo,
		type TipoAccion,
		type EstadoSeguimiento,
		type EvaluacionCierre
	} from '$lib/api/acciones-correctivas';

	export let accion: AccionCorrectivaPreventiva | null = null;
	export let modoEdicion = false;

	const dispatch = createEventDispatcher();

	let isSubmitting = false;
	let seccionActiva = 1; // 1-4 para las 4 secciones

	// Form fields - Sección 1: Identificación del Hallazgo
	let accion_numero = accion?.accion_numero || '';
	let lugar_sede = accion?.lugar_sede || '';
	let proceso_origen_hallazgo = accion?.proceso_origen_hallazgo || '';
	let componente_elemento_referencia = accion?.componente_elemento_referencia || '';
	let fuente_genero_hallazgo = accion?.fuente_genero_hallazgo || '';
	let marco_legal_normativo = accion?.marco_legal_normativo || '';
	let fecha_identificacion_hallazgo = accion?.fecha_identificacion_hallazgo?.split('T')[0] || '';
	let descripcion_hallazgo = accion?.descripcion_hallazgo || '';
	let tipo_hallazgo_detectado: TipoHallazgo | '' = accion?.tipo_hallazgo_detectado || '';
	let variable_categoria_analisis = accion?.variable_categoria_analisis || '';

	// Sección 2: Corrección Inmediata
	let correccion_solucion_inmediata = accion?.correccion_solucion_inmediata || '';
	let fecha_implementacion = accion?.fecha_implementacion?.split('T')[0] || '';
	let valoracion_riesgo: ValoracionRiesgo | '' = accion?.valoracion_riesgo || '';
	let requiere_actualizar_matriz = accion?.requiere_actualizar_matriz || false;

	// Sección 3: Análisis y Plan de Acción
	let tipo_accion_ejecutar: TipoAccion | '' = accion?.tipo_accion_ejecutar || '';

	// Causas: Array de objetos con todos los campos de seguimiento
	let causas: CausaAccion[] =
		accion?.causas && accion.causas.length > 0
			? accion.causas.map((c) => ({
					...c,
					fecha_limite_implementacion: c.fecha_limite_implementacion?.split('T')[0],
					fecha_seguimiento: c.fecha_seguimiento?.split('T')[0]
				}))
			: [
					{
						orden: 1,
						analisis_causa: '',
						descripcion_plan_accion: '',
						fecha_limite_implementacion: '',
						responsable_ejecucion: '',
						fecha_seguimiento: '',
						estado_seguimiento: undefined,
						descripcion_observaciones: ''
					}
				];

	// Sección 4: Evaluación de Eficacia
	let fecha_evaluacion_eficacia = accion?.fecha_evaluacion_eficacia?.split('T')[0] || '';
	let criterio_evaluacion_eficacia = accion?.criterio_evaluacion_eficacia || '';
	let analisis_evidencias_cierre = accion?.analisis_evidencias_cierre || '';
	let evaluacion_cierre_eficaz: EvaluacionCierre | '' = accion?.evaluacion_cierre_eficaz || '';
	let soporte_cierre_eficaz = accion?.soporte_cierre_eficaz || '';
	let fecha_cierre_definitivo = accion?.fecha_cierre_definitivo?.split('T')[0] || '';
	let responsable_cierre = accion?.responsable_cierre || '';

	// Errors
	let errors: { [key: string]: string } = {};

	function validateSeccion1(): boolean {
		// Limpiar errores de la sección 1
		delete errors.accion_numero;
		delete errors.descripcion_hallazgo;

		let isValid = true;

		if (!accion_numero.trim()) {
			errors.accion_numero = 'El número de acción es requerido';
			isValid = false;
		}

		if (!descripcion_hallazgo.trim()) {
			errors.descripcion_hallazgo = 'La descripción del hallazgo es requerida';
			isValid = false;
		}

		errors = errors; // Reactivity
		return isValid;
	}

	function validateSeccion3(): boolean {
		// Limpiar errores de la sección 3
		delete errors.tipo_accion_ejecutar;
		delete errors.causas;

		let isValid = true;

		if (!tipo_accion_ejecutar) {
			errors.tipo_accion_ejecutar = 'El tipo de acción es requerido';
			isValid = false;
		}

		// Validar que haya al menos una causa con análisis completo
		const causasCompletas = causas.filter((causa) => causa.analisis_causa.trim()).length;
		if (causasCompletas === 0) {
			errors.causas = 'Debe completar al menos un análisis de causa';
			isValid = false;
		}

		errors = errors; // Reactivity
		return isValid;
	}

	function agregarCausa() {
		if (causas.length < 5) {
			causas = [
				...causas,
				{
					orden: causas.length + 1,
					analisis_causa: '',
					descripcion_plan_accion: '',
					fecha_limite_implementacion: '',
					responsable_ejecucion: '',
					fecha_seguimiento: '',
					estado_seguimiento: undefined,
					descripcion_observaciones: ''
				}
			];
		} else {
			toast.warning('Máximo 5 causas permitidas');
		}
	}

	function eliminarCausa(index: number) {
		if (causas.length > 1) {
			causas = causas.filter((_, i) => i !== index);
			// Reordenar
			causas = causas.map((causa, i) => ({ ...causa, orden: i + 1 }));
		}
	}

	function validateForm(): boolean {
		errors = {};

		if (!accion_numero.trim()) {
			errors.accion_numero = 'El número de acción es requerido';
		}

		if (!descripcion_hallazgo.trim()) {
			errors.descripcion_hallazgo = 'La descripción del hallazgo es requerida';
		}

		if (!tipo_accion_ejecutar) {
			errors.tipo_accion_ejecutar = 'El tipo de acción es requerido';
		}

		return Object.keys(errors).length === 0;
	}

	async function handleSubmit() {
		if (!validateForm()) {
			toast.error('Por favor complete los campos requeridos');
			return;
		}

		isSubmitting = true;

		try {
			// Filtrar y preparar causas válidas
			const causasValidas = causas
				.filter((causa) => causa.analisis_causa.trim())
				.map((causa) => ({
					orden: causa.orden,
					analisis_causa: causa.analisis_causa.trim(),
					descripcion_plan_accion: causa.descripcion_plan_accion?.trim() || undefined,
					fecha_limite_implementacion: causa.fecha_limite_implementacion || undefined,
					responsable_ejecucion: causa.responsable_ejecucion?.trim() || undefined,
					fecha_seguimiento: causa.fecha_seguimiento || undefined,
					estado_seguimiento: causa.estado_seguimiento || undefined,
					descripcion_observaciones: causa.descripcion_observaciones?.trim() || undefined
				}));

			const data: CreateAccionInput = {
				accion_numero: accion_numero.trim(),
				lugar_sede: lugar_sede.trim() || undefined,
				proceso_origen_hallazgo: proceso_origen_hallazgo.trim() || undefined,
				componente_elemento_referencia: componente_elemento_referencia.trim() || undefined,
				fuente_genero_hallazgo: fuente_genero_hallazgo.trim() || undefined,
				marco_legal_normativo: marco_legal_normativo.trim() || undefined,
				fecha_identificacion_hallazgo: fecha_identificacion_hallazgo || undefined,
				descripcion_hallazgo: descripcion_hallazgo.trim() || undefined,
				tipo_hallazgo_detectado: tipo_hallazgo_detectado || undefined,
				variable_categoria_analisis: variable_categoria_analisis.trim() || undefined,
				correccion_solucion_inmediata: correccion_solucion_inmediata.trim() || undefined,
				fecha_implementacion: fecha_implementacion || undefined,
				valoracion_riesgo: valoracion_riesgo || undefined,
				requiere_actualizar_matriz,
				tipo_accion_ejecutar: tipo_accion_ejecutar || undefined,
				causas: causasValidas.length > 0 ? causasValidas : undefined,
				fecha_evaluacion_eficacia: fecha_evaluacion_eficacia || undefined,
				criterio_evaluacion_eficacia: criterio_evaluacion_eficacia.trim() || undefined,
				analisis_evidencias_cierre: analisis_evidencias_cierre.trim() || undefined,
				evaluacion_cierre_eficaz: evaluacion_cierre_eficaz || undefined,
				soporte_cierre_eficaz: soporte_cierre_eficaz.trim() || undefined,
				fecha_cierre_definitivo: fecha_cierre_definitivo || undefined,
				responsable_cierre: responsable_cierre.trim() || undefined
			};

			if (modoEdicion && accion) {
				await accionesCorrectivasAPI.actualizar(accion.id, data);
				toast.success('Acción actualizada exitosamente');
			} else {
				await accionesCorrectivasAPI.crear(data);
				toast.success('Acción creada exitosamente');
			}

			dispatch('guardado');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al guardar la acción';
			toast.error(message);
		} finally {
			isSubmitting = false;
		}
	}
	function cerrarModal() {
		dispatch('close');
	}

	function cambiarSeccion(numero: number) {
		// Validar sección actual antes de cambiar
		if (numero > seccionActiva) {
			// Solo validar si va hacia adelante
			if (seccionActiva === 1 && !validateSeccion1()) {
				toast.error('Por favor complete los campos requeridos de Identificación del Hallazgo');
				return;
			}
			if (seccionActiva === 3 && !validateSeccion3()) {
				toast.error('Por favor complete los campos requeridos del Plan de Acción');
				return;
			}
		}
		seccionActiva = numero;
	}

	function avanzarSeccion() {
		if (seccionActiva < 4) {
			// Validar sección actual antes de avanzar
			if (seccionActiva === 1 && !validateSeccion1()) {
				toast.error('Por favor complete los campos requeridos de Identificación del Hallazgo');
				return;
			}
			if (seccionActiva === 3 && !validateSeccion3()) {
				toast.error('Por favor complete los campos requeridos del Plan de Acción');
				return;
			}
			seccionActiva++;
		}
	}

	function retrocederSeccion() {
		if (seccionActiva > 1) {
			seccionActiva--;
		}
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
	transition:fade={{ duration: 200 }}
	on:click={cerrarModal}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<!-- Modal -->
	<div
		class="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
		transition:fly={{ y: 20, duration: 300 }}
		on:click={(e) => e.stopPropagation()}
		role="document"
	>
		<!-- Header -->
		<div class="bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3">
			<div class="mb-3 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
							/>
						</svg>
					</div>
					<div>
						<h2 class="text-base font-bold text-white">
							{modoEdicion ? 'Editar Acción' : 'Nueva Acción'}
						</h2>
						<p class="text-[10px] text-orange-100">Correctiva / Preventiva</p>
					</div>
				</div>
				<button
					on:click={cerrarModal}
					class="apple-transition rounded-lg bg-white/20 p-1.5 hover:bg-white/30"
					title="Cerrar"
				>
					<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Navegación de secciones -->
			<div class="flex items-center justify-between gap-2">
				{#each [{ num: 1, nombre: 'Identificación' }, { num: 2, nombre: 'Corrección' }, { num: 3, nombre: 'Causas' }, { num: 4, nombre: 'Evaluación' }] as seccion (seccion.num)}
					<button
						on:click={() => cambiarSeccion(seccion.num)}
						class="apple-transition flex-1 rounded-lg px-2 py-2.5 text-center text-sm font-medium {seccionActiva ===
						seccion.num
							? 'bg-white text-orange-600'
							: 'text-white/60 hover:bg-white/10 hover:text-white'}"
					>
						<span class="hidden sm:inline">{seccion.num}. {seccion.nombre}</span>
						<span class="sm:hidden">{seccion.num}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Form -->
		<form on:submit|preventDefault={handleSubmit} class="bg-white">
			<div class="max-h-[45vh] overflow-y-auto px-4 py-4">
				<!-- Sección 1: Identificación del Hallazgo -->
				{#if seccionActiva === 1}
					<div transition:fly={{ x: -20, duration: 200 }}>
						<h4 class="mb-4 text-lg font-semibold text-gray-900">1. Identificación del Hallazgo</h4>
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									ACCIÓN No. <span class="text-red-600">*</span>
								</label>
								<input
									type="text"
									bind:value={accion_numero}
									placeholder="Ej: A25_01, A25_02"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50 {errors.accion_numero
										? 'border-red-300'
										: ''}"
									disabled={modoEdicion}
								/>
								<p class="mt-1 text-xs text-gray-500">
									Digite el código único: A + últimos 2 dígitos del año + consecutivo
								</p>
								{#if errors.accion_numero}
									<p class="mt-1 text-sm text-red-600">{errors.accion_numero}</p>
								{/if}
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">LUGAR / SEDE</label>
								<input
									type="text"
									bind:value={lugar_sede}
									placeholder="Ej: Sede Principal, Instalación del cliente"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Enuncie claramente el lugar, sede, instalación del cliente o sitio donde se
									originó el hallazgo
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>PROCESO DONDE SE ORIGINA EL HALLAZGO</label
								>
								<input
									type="text"
									bind:value={proceso_origen_hallazgo}
									placeholder="Ej: Gestión de Calidad, Operaciones"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Indique el proceso del mapa de procesos donde se detectó el hallazgo
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>COMPONENTE / ELEMENTO / DE ENTRADA DE REFERENCIA</label
								>
								<input
									type="text"
									bind:value={componente_elemento_referencia}
									placeholder="Ej: Procedimiento, Registro, Programa"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Indique el documento, registro, programa, actividad o elemento específico donde se
									evidenció
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>FUENTE QUE GENERÓ O IDENTIFICÓ EL HALLAZGO</label
								>
								<select
									bind:value={fuente_genero_hallazgo}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
								>
									<option value="">Seleccione...</option>
									<option value="Auditoría Interna">Auditoría Interna</option>
									<option value="Auditoría Externa">Auditoría Externa</option>
									<option value="Inspección HSEQ">Inspección HSEQ</option>
									<option value="Revisión por la Dirección">Revisión por la Dirección</option>
									<option value="Queja o Reclamo Cliente">Queja o Reclamo Cliente</option>
									<option value="Investigación de Incidente/Accidente"
										>Investigación de Incidente/Accidente</option
									>
									<option value="Análisis de Indicadores">Análisis de Indicadores</option>
									<option value="Sugerencia del Personal">Sugerencia del Personal</option>
									<option value="Evaluación de Proveedores">Evaluación de Proveedores</option>
									<option value="Cambio Normativo">Cambio Normativo</option>
									<option value="Otro">Otro</option>
								</select>
								<p class="mt-1 text-xs text-gray-500">
									Resultados de Auditorías Internas o Externas, inspecciones, quejas, etc.
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>MARCO LEGAL / NORMATIVO / CONTRACTUAL</label
								>
								<input
									type="text"
									bind:value={marco_legal_normativo}
									placeholder="Ej: ISO 9001:2015, Decreto 1072/2015"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Enuncie la norma, requisito legal, contractual o interno que se incumple o aplica
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>FECHA DE IDENTIFICACIÓN DEL HALLAZGO</label
								>
								<input
									type="date"
									bind:value={fecha_identificacion_hallazgo}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Digite la fecha real en la que se identificó el hallazgo (dd/mm/aaaa)
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>TIPO DE HALLAZGO DETECTADO</label
								>
								<select
									bind:value={tipo_hallazgo_detectado}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
								>
									<option value="">Seleccione...</option>
									<option value="NC Mayor">NC Mayor</option>
									<option value="NC Menor">NC Menor</option>
									<option value="Observación">Observación</option>
									<option value="Oportunidad de Mejora">Oportunidad de Mejora</option>
								</select>
							</div>

							<div class="md:col-span-2">
								<label class="mb-2 block text-sm font-medium text-gray-700">
									DESCRIPCIÓN DEL HALLAZGO / RIESGO POTENCIAL / NO CONFORMIDAD / OPORTUNIDAD DE
									MEJORA
									<span class="text-red-600">*</span>
								</label>
								<textarea
									bind:value={descripcion_hallazgo}
									rows="3"
									placeholder="Describa: ¿Qué ocurrió? ¿Dónde ocurrió? ¿Qué requisito se incumple?"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50 {errors.descripcion_hallazgo
										? 'border-red-300'
										: ''}"
								></textarea>
								<p class="mt-1 text-xs text-gray-500">
									Describa el hallazgo de forma clara, objetiva y verificable
								</p>
								{#if errors.descripcion_hallazgo}
									<p class="mt-1 text-sm text-red-600">{errors.descripcion_hallazgo}</p>
								{/if}
							</div>

							<div class="md:col-span-2">
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>VARIABLE / CATEGORÍA PARA ANÁLISIS DE TENDENCIAS</label
								>
								<select
									bind:value={variable_categoria_analisis}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
								>
									<option value="">Seleccione...</option>
									<optgroup label="SST (Seguridad y Salud en el Trabajo)">
										<option value="SST_Condiciones_Inseguras">Condiciones Inseguras</option>
										<option value="SST_Actos_Inseguros">Actos Inseguros</option>
										<option value="SST_EPP">Uso de EPP</option>
										<option value="SST_Capacitacion">Capacitación SST</option>
										<option value="SST_Vigilancia_Salud">Vigilancia de la Salud</option>
										<option value="SST_Investigacion_Incidentes">Investigación de Incidentes</option
										>
									</optgroup>
									<optgroup label="PESV (Plan Estratégico de Seguridad Vial)">
										<option value="PESV_Documentos_Conductor">Documentos del Conductor</option>
										<option value="PESV_Documentos_Vehiculo">Documentos del Vehículo</option>
										<option value="PESV_Mantenimiento_Vehiculo">Mantenimiento de Vehículos</option>
										<option value="PESV_Capacitacion_Vial">Capacitación Vial</option>
										<option value="PESV_Investigacion_Accidente"
											>Investigación de Accidentes Viales</option
										>
									</optgroup>
									<optgroup label="Ambiental">
										<option value="Ambiental_Gestion_Residuos">Gestión de Residuos</option>
										<option value="Ambiental_Consumo_Recursos">Consumo de Recursos</option>
										<option value="Ambiental_Emisiones">Emisiones</option>
										<option value="Ambiental_Vertimientos">Vertimientos</option>
										<option value="Ambiental_Cumplimiento_Legal"
											>Cumplimiento Legal Ambiental</option
										>
									</optgroup>
									<optgroup label="Calidad / Servicio">
										<option value="Calidad_No_Conformidad_Producto">No Conformidad Producto</option>
										<option value="Calidad_Queja_Cliente">Queja Cliente</option>
										<option value="Calidad_Incumplimiento_Contrato"
											>Incumplimiento Contractual</option
										>
										<option value="Calidad_Satisfaccion_Cliente">Satisfacción del Cliente</option>
										<option value="Calidad_Control_Documentos">Control de Documentos</option>
									</optgroup>
									<optgroup label="Gestión">
										<option value="Gestion_Recursos_Humanos">Recursos Humanos</option>
										<option value="Gestion_Infraestructura">Infraestructura</option>
										<option value="Gestion_Proveedores">Proveedores</option>
										<option value="Gestion_Comunicacion">Comunicación Interna/Externa</option>
										<option value="Gestion_Objetivos_Metas">Objetivos y Metas</option>
									</optgroup>
									<option value="Otra">Otra</option>
								</select>
								<p class="mt-1 text-xs text-gray-500">
									Seleccione la categoría que mejor represente la naturaleza del hallazgo
								</p>
							</div>
						</div>
					</div>
				{/if}

				<!-- Sección 2: Corrección Inmediata -->
				{#if seccionActiva === 2}
					<div transition:fly={{ x: -20, duration: 200 }}>
						<h4 class="mb-4 text-lg font-semibold text-gray-900">2. Corrección Inmediata</h4>
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div class="md:col-span-2">
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>CORRECCIÓN O SOLUCIÓN INMEDIATA PROPUESTA</label
								>
								<textarea
									bind:value={correccion_solucion_inmediata}
									rows="4"
									placeholder="Ej: Suspensión temporal del servicio / Notificación inmediata al proveedor"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								></textarea>
								<p class="mt-1 text-xs text-gray-500">
									Describa la acción inmediata tomada para contener el problema. Importante: La
									corrección NO elimina la causa raíz
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>FECHA DE IMPLEMENTACIÓN</label
								>
								<input
									type="date"
									bind:value={fecha_implementacion}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Fecha en que se ejecutó la corrección inmediata
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>VALORACIÓN DEL RIESGO DEL HALLAZGO</label
								>
								<select
									bind:value={valoracion_riesgo}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
								>
									<option value="">Seleccione...</option>
									<option value="ALTO">ALTO</option>
									<option value="MEDIO">MEDIO</option>
									<option value="BAJO">BAJO</option>
								</select>
								<p class="mt-1 text-xs text-gray-500">
									ALTO: Impacto crítico, respuesta inmediata / MEDIO: Impacto moderado / BAJO:
									Impacto menor
								</p>
							</div>

							<div class="md:col-span-2">
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>¿REQUIERE ACTUALIZAR MATRIZ?</label
								>
								<div class="space-y-2">
									<label class="flex items-center space-x-2">
										<input
											type="checkbox"
											bind:checked={requiere_actualizar_matriz}
											class="apple-transition h-4 w-4 rounded border-gray-200 bg-white/80 text-orange-500 focus:ring-orange-500/50"
										/>
										<span class="text-sm text-gray-700"
											>Requiere actualizar Matriz de Riesgos / Peligros / Impactos / Riesgos Viales</span
										>
									</label>
									<p class="ml-6 text-xs text-gray-500">
										Indique o especifique cuál: Matriz de Riesgos y Oportunidades / Matriz de
										peligros / Matriz ambiental / Matriz de riesgos viales / Otra
									</p>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- Sección 3: Análisis y Plan de Acción -->
				{#if seccionActiva === 3}
					<div transition:fly={{ x: -20, duration: 200 }}>
						<h4 class="mb-4 text-lg font-semibold text-gray-900">3. Análisis y Plan de Acción</h4>
						<div class="grid grid-cols-1 gap-4">
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">
									TIPO DE ACCIÓN A EJECUTAR <span class="text-red-600">*</span>
								</label>
								<select
									bind:value={tipo_accion_ejecutar}
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50 {errors.tipo_accion_ejecutar
										? 'border-red-300'
										: ''}"
								>
									<option value="">Seleccione...</option>
									<option value="CORRECTIVA">CORRECTIVA</option>
									<option value="PREVENTIVA">PREVENTIVA</option>
									<option value="MEJORA">MEJORA</option>
								</select>
								<p class="mt-1 text-xs text-gray-500">
									Correctiva: NC Mayor/Menor | Preventiva: NC potencial/riesgo | Mejora:
									Observación/oportunidad
								</p>
								{#if errors.tipo_accion_ejecutar}
									<p class="mt-1 text-sm text-red-600">{errors.tipo_accion_ejecutar}</p>
								{/if}
							</div>

							<div>
								<div class="mb-2 flex items-center justify-between">
									<label class="block text-sm font-medium text-gray-700">
										CAUSAS Y PLAN DE ACCIÓN <span class="text-red-600">*</span>
									</label>
									{#if causas.length < 5}
										<button
											type="button"
											on:click={agregarCausa}
											class="apple-transition flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 4v16m8-8H4"
												/>
											</svg>
											Agregar Causa
										</button>
									{/if}
								</div>
								<p class="mb-3 text-xs text-gray-500">
									Aplique metodología de causas raíz (mínimo 1, máximo 5). Cada causa tiene
									seguimiento independiente.
								</p>

								<div class="space-y-4">
									{#each causas as causa, index}
										<div
											class="apple-transition rounded-lg border border-gray-200 bg-white/80 p-4 shadow-sm"
										>
											<div
												class="mb-3 flex items-center justify-between border-b border-gray-100 pb-3"
											>
												<h5 class="text-sm font-semibold text-gray-900">
													Causa #{causa.orden} - Análisis de Causa Raíz
												</h5>
												{#if causas.length > 1}
													<button
														type="button"
														on:click={() => eliminarCausa(index)}
														class="apple-transition flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
														title="Eliminar causa"
													>
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
															/>
														</svg>
													</button>
												{/if}
											</div>

											<div class="space-y-3">
												<!-- Análisis de Causa -->
												<div>
													<label class="mb-1 block text-xs font-medium text-gray-700">
														¿Por qué? (Análisis de Causa) <span class="text-red-600">*</span>
													</label>
													<textarea
														bind:value={causa.analisis_causa}
														placeholder="Describa el análisis de la causa raíz (Metodología 5 Por Qué)"
														rows="2"
														class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
													/>
												</div>

												<!-- Plan de Acción -->
												<div>
													<label class="mb-1 block text-xs font-medium text-gray-700">
														Descripción de la Acción / Plan de Acción
													</label>
													<textarea
														bind:value={causa.descripcion_plan_accion}
														placeholder="Describa el plan de acción para eliminar la causa"
														rows="2"
														class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
													/>
												</div>

												<!-- Grid para Fecha Límite y Responsable -->
												<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
													<div>
														<label class="mb-1 block text-xs font-medium text-gray-700">
															Fecha Límite Implementación
														</label>
														<input
															bind:value={causa.fecha_limite_implementacion}
															type="date"
															class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
														/>
														<p class="mt-0.5 text-xs text-gray-500">Entre 1 y 90 días</p>
													</div>

													<div>
														<label class="mb-1 block text-xs font-medium text-gray-700">
															Responsable Ejecución
														</label>
														<input
															bind:value={causa.responsable_ejecucion}
															type="text"
															placeholder="Nombre y cargo del responsable"
															class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
														/>
													</div>
												</div>

												<!-- Sección de Seguimiento -->
												<div class="rounded-lg bg-orange-50/50 p-3">
													<h6 class="mb-2 text-xs font-semibold text-orange-900">
														Seguimiento de la Causa
													</h6>
													<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
														<div>
															<label class="mb-1 block text-xs font-medium text-gray-700">
																Fecha Seguimiento
															</label>
															<input
																bind:value={causa.fecha_seguimiento}
																type="date"
																class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
															/>
														</div>

														<div>
															<label class="mb-1 block text-xs font-medium text-gray-700">
																Estado del Seguimiento
															</label>
															<select
																bind:value={causa.estado_seguimiento}
																class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
															>
																<option value="">Seleccione...</option>
																<option value="En Proceso">En Proceso</option>
																<option value="Cumplida">Cumplida</option>
																<option value="Vencida">Vencida</option>
															</select>
														</div>
													</div>

													<div class="mt-3">
														<label class="mb-1 block text-xs font-medium text-gray-700">
															Observaciones del Seguimiento
														</label>
														<textarea
															bind:value={causa.descripcion_observaciones}
															placeholder="Registre observaciones, avances o novedades del seguimiento"
															rows="2"
															class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
														/>
													</div>
												</div>
											</div>
										</div>
									{/each}
								</div>
								{#if errors.causas}
									<p class="mt-1 text-sm text-red-600">{errors.causas}</p>
								{/if}
							</div>
						</div>
					</div>
				{/if}

				<!-- Sección 4: Evaluación de Eficacia -->
				{#if seccionActiva === 4}
					<div transition:fly={{ x: -20, duration: 200 }}>
						<h4 class="mb-4 text-lg font-semibold text-gray-900">4. Evaluación de Eficacia</h4>
						<div class="grid grid-cols-1 gap-4">
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700"
										>FECHA DE EVALUACIÓN DE EFICACIA</label
									>
									<input
										type="date"
										bind:value={fecha_evaluacion_eficacia}
										class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
									/>
									<p class="mt-1 text-xs text-gray-500">
										ALTO: 30 días | MEDIO: 60 días | BAJO: 90 días (desde cierre del plan)
									</p>
								</div>

								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700"
										>EVALUACIÓN DEL CIERRE</label
									>
									<select
										bind:value={evaluacion_cierre_eficaz}
										class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
									>
										<option value="">Seleccione...</option>
										<option value="EFICAZ">EFICAZ</option>
										<option value="NO EFICAZ">NO EFICAZ</option>
									</select>
								</div>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>CRITERIO DE EVALUACIÓN DE EFICACIA</label
								>
								<textarea
									bind:value={criterio_evaluacion_eficacia}
									rows="3"
									placeholder="Ej: No reincidencia, cumplimiento del indicador, evidencia comparativa"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								></textarea>
								<p class="mt-1 text-xs text-gray-500">
									Defina cómo se medirá: ausencia de reincidencia / mejora del indicador /
									cumplimiento del requisito
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>ANÁLISIS DE EVIDENCIAS DE CIERRE</label
								>
								<textarea
									bind:value={analisis_evidencias_cierre}
									rows="3"
									placeholder="Explique qué se verificó y qué evidencia lo soporta..."
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								></textarea>
								<p class="mt-1 text-xs text-gray-500">
									Explique qué se verificó y qué evidencia lo soporta (inspección, auditoría,
									registros)
								</p>
							</div>

							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700"
									>SOPORTE DEL CIERRE EFICAZ</label
								>
								<input
									type="text"
									bind:value={soporte_cierre_eficaz}
									placeholder="Ej: Acta de reunión, registro fotográfico, informe de auditoría, lista de chequeo"
									class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
								/>
								<p class="mt-1 text-xs text-gray-500">
									Indique los documentos o registros que evidencian la eficacia
								</p>
							</div>

							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700"
										>FECHA DE CIERRE DEFINITIVO</label
									>
									<input
										type="date"
										bind:value={fecha_cierre_definitivo}
										class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-orange-500/50"
									/>
									<p class="mt-1 text-xs text-gray-500">
										Solo se diligencia cuando la evaluación fue EFICAZ
									</p>
								</div>

								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700"
										>RESPONSABLE DEL CIERRE</label
									>
									<input
										type="text"
										bind:value={responsable_cierre}
										placeholder="Ej: Coordinador HSEQ, Gerente"
										class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/50"
									/>
									<p class="mt-1 text-xs text-gray-500">
										Indique el cargo del responsable del cierre
									</p>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer con navegación -->
			<div class="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3">
				<div class="flex gap-2">
					{#if seccionActiva > 1}
						<button
							type="button"
							on:click={retrocederSeccion}
							class="apple-transition rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-600 hover:bg-gray-50"
						>
							← Anterior
						</button>
					{/if}
				</div>

				<div class="flex gap-2">
					<button
						type="button"
						on:click={cerrarModal}
						class="apple-transition rounded-lg border border-gray-200 bg-white/80 px-6 py-2.5 text-gray-600 hover:bg-gray-50"
						disabled={isSubmitting}
					>
						Cancelar
					</button>

					{#if seccionActiva < 4}
						<button
							type="button"
							on:click={avanzarSeccion}
							class="apple-transition rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2.5 text-white shadow-lg shadow-orange-500/30 hover:from-orange-600 hover:to-orange-700"
						>
							Siguiente →
						</button>
					{:else}
						<button
							type="submit"
							class="apple-transition flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2.5 text-white shadow-lg shadow-orange-500/30 hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={isSubmitting}
						>
							{#if isSubmitting}
								<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
								{modoEdicion ? 'Actualizar' : 'Guardar'}
							{/if}
						</button>
					{/if}
				</div>
			</div>
		</form>
	</div>
</div>
