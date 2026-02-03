<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly, scale, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { conductoresAPI } from '$lib/api/apiClient';
	import { toast } from 'svelte-sonner';

	// Estados posibles del conductor
	const EstadoConductor = {
		ACTIVO: 'ACTIVO',
		INACTIVO: 'INACTIVO',
		VACACIONES: 'VACACIONES',
		INCAPACITADO: 'INCAPACITADO',
		RETIRADO: 'RETIRADO'
	} as const;

	type EstadoConductorType = (typeof EstadoConductor)[keyof typeof EstadoConductor];

	// Tipos de identificación
	const tiposIdentificacion = ['CC', 'CE', 'PA', 'TI'];

	// Categorías de licencia
	const categoriasLicencia = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

	// Tipos de sangre
	const tiposSangre = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

	// Sedes de trabajo
	const sedes = ['YOPAL', 'VILLANUEVA'];

	// Estado del formulario
	let formData = {
		nombre: '',
		apellido: '',
		tipo_identificacion: 'CC',
		numero_identificacion: '',
		email: '',
		telefono: '',
		direccion: '',
		fecha_nacimiento: '',
		genero: 'MASCULINO',
		cargo: 'CONDUCTOR',
		fecha_ingreso: new Date().toISOString().split('T')[0],
		salario_base: '',
		estado: EstadoConductor.ACTIVO as EstadoConductorType,
		eps: '',
		fondo_pension: '',
		arl: '',
		tipo_contrato: 'INDEFINIDO',
		categoria_licencia: '',
		vencimiento_licencia: '',
		sede_trabajo: 'YOPAL',
		tipo_sangre: ''
	};

	let isSubmitting = false;
	let errors: Record<string, string> = {};

	// Función para validar el formulario
	function validateForm() {
		errors = {};

		if (!formData.nombre.trim()) {
			errors.nombre = 'El nombre es requerido';
		}

		if (!formData.apellido.trim()) {
			errors.apellido = 'El apellido es requerido';
		}

		if (!formData.numero_identificacion.trim()) {
			errors.numero_identificacion = 'El número de identificación es requerido';
		}

		// Validaciones opcionales
		if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
			errors.email = 'El email no es válido';
		}

		if (formData.salario_base && isNaN(Number(formData.salario_base))) {
			errors.salario_base = 'El salario debe ser un número válido';
		}

		return Object.keys(errors).length === 0;
	}

	// Función para enviar el formulario
	async function handleSubmit() {
		if (!validateForm()) {
			const firstError = Object.values(errors)[0];
			toast.error(firstError, {
				duration: 4000,
				style: 'background: white; color: black; border: 1px solid #e5e7eb;'
			});
			return;
		}

		isSubmitting = true;
		errors = {};

		try {
			const conductorData = {
				...formData,
				salario_base: formData.salario_base ? parseFloat(formData.salario_base) : null,
				email: formData.email.trim() || null,
				eps: formData.eps.trim() || null,
				fondo_pension: formData.fondo_pension.trim() || null,
				arl: formData.arl.trim() || null,
				direccion: formData.direccion.trim() || null,
				fecha_nacimiento: formData.fecha_nacimiento || null,
				tipo_sangre: formData.tipo_sangre || null
			};

			console.log('📤 Enviando nuevo conductor:', conductorData);

			const response = await conductoresAPI.create(conductorData);

			console.log('✅ Conductor creado exitosamente:', response.data);

			toast.success('Conductor creado exitosamente', {
				duration: 3000,
				style: 'background: white; color: black; border: 1px solid #10b981;'
			});

			// Redirigir a la lista después de 1.5 segundos
			setTimeout(() => {
				goto('/dashboard/conductores');
			}, 1500);
		} catch (err: any) {
			console.error('❌ Error creando conductor:', err);
			console.error('❌ Detalle completo del error:', {
				response: err.response,
				data: err.response?.data,
				message: err.message,
				status: err.response?.status
			});

			// Extraer mensaje de error específico
			let errorMessage = 'Error desconocido al crear el conductor';

			if (err.response?.data?.message) {
				errorMessage = err.response.data.message;
			} else if (err.response?.data?.error) {
				errorMessage = err.response.data.error;
			} else if (err.response?.data) {
				// Si hay un objeto de errores de validación
				if (typeof err.response.data === 'object') {
					const firstError = Object.values(err.response.data)[0];
					if (typeof firstError === 'string') {
						errorMessage = firstError;
					}
				} else if (typeof err.response.data === 'string') {
					errorMessage = err.response.data;
				}
			} else if (err.message) {
				errorMessage = err.message;
			}

			toast.error(errorMessage, {
				duration: 5000,
				style: 'background: white; color: black; border: 1px solid #e5e7eb;'
			});
		} finally {
			isSubmitting = false;
		}
	}

	function handleCancel() {
		goto('/dashboard/conductores');
	}
</script>

<svelte:head>
	<title>Nuevo Conductor - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen p-6">
	<!-- Header -->
	<div
		class="glass mb-6 rounded-2xl border border-gray-200/50 p-6"
		in:fly={{ y: -20, duration: 600, easing: quintOut }}
	>
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">Nuevo Conductor</h1>
				<p class="mt-1 text-sm text-gray-600">Registra un nuevo conductor en el sistema</p>
			</div>
			<button
				on:click={handleCancel}
				class="apple-transition rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
			>
				Cancelar
			</button>
		</div>
	</div>

	<!-- Formulario -->
	<form
		on:submit|preventDefault={handleSubmit}
		class="glass rounded-2xl border border-gray-200/50 p-6"
		in:fly={{ y: 20, duration: 600, delay: 100, easing: quintOut }}
	>
		<!-- Información Personal -->
		<div class="mb-8">
			<h2 class="mb-4 text-xl font-semibold text-gray-900">Información Personal</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				<!-- Nombre -->
				<div>
					<label for="nombre" class="mb-2 block text-sm font-medium text-gray-700">
						Nombre <span class="text-red-500">*</span>
					</label>
					<input
						id="nombre"
						type="text"
						bind:value={formData.nombre}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.nombre
							? 'border-red-500'
							: ''}"
						placeholder="Juan"
					/>
					{#if errors.nombre}
						<p class="mt-1 text-xs text-red-600">{errors.nombre}</p>
					{/if}
				</div>

				<!-- Apellido -->
				<div>
					<label for="apellido" class="mb-2 block text-sm font-medium text-gray-700">
						Apellido <span class="text-red-500">*</span>
					</label>
					<input
						id="apellido"
						type="text"
						bind:value={formData.apellido}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.apellido
							? 'border-red-500'
							: ''}"
						placeholder="Pérez"
					/>
					{#if errors.apellido}
						<p class="mt-1 text-xs text-red-600">{errors.apellido}</p>
					{/if}
				</div>

				<!-- Tipo de Identificación -->
				<div>
					<label for="tipo_identificacion" class="mb-2 block text-sm font-medium text-gray-700">
						Tipo ID
					</label>
					<select
						id="tipo_identificacion"
						bind:value={formData.tipo_identificacion}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						{#each tiposIdentificacion as tipo}
							<option value={tipo}>{tipo}</option>
						{/each}
					</select>
				</div>

				<!-- Número de Identificación -->
				<div>
					<label for="numero_identificacion" class="mb-2 block text-sm font-medium text-gray-700">
						Número ID <span class="text-red-500">*</span>
					</label>
					<input
						id="numero_identificacion"
						type="text"
						bind:value={formData.numero_identificacion}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.numero_identificacion
							? 'border-red-500'
							: ''}"
						placeholder="1234567890"
					/>
					{#if errors.numero_identificacion}
						<p class="mt-1 text-xs text-red-600">{errors.numero_identificacion}</p>
					{/if}
				</div>

				<!-- Fecha de Nacimiento -->
				<div>
					<label for="fecha_nacimiento" class="mb-2 block text-sm font-medium text-gray-700">
						Fecha de Nacimiento
					</label>
					<input
						id="fecha_nacimiento"
						type="date"
						bind:value={formData.fecha_nacimiento}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					/>
				</div>

				<!-- Género -->
				<div>
					<label for="genero" class="mb-2 block text-sm font-medium text-gray-700">Género</label>
					<select
						id="genero"
						bind:value={formData.genero}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						<option value="MASCULINO">Masculino</option>
						<option value="FEMENINO">Femenino</option>
						<option value="OTRO">Otro</option>
					</select>
				</div>

				<!-- Tipo de Sangre -->
				<div>
					<label for="tipo_sangre" class="mb-2 block text-sm font-medium text-gray-700">
						Tipo de Sangre
					</label>
					<select
						id="tipo_sangre"
						bind:value={formData.tipo_sangre}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						<option value="">Seleccionar...</option>
						{#each tiposSangre as tipo}
							<option value={tipo}>{tipo}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>

		<!-- Información de Contacto -->
		<div class="mb-8">
			<h2 class="mb-4 text-xl font-semibold text-gray-900">Información de Contacto</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				<!-- Teléfono -->
				<div>
					<label for="telefono" class="mb-2 block text-sm font-medium text-gray-700">
						Teléfono
					</label>
					<input
						id="telefono"
						type="text"
						bind:value={formData.telefono}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.telefono
							? 'border-red-500'
							: ''}"
						placeholder="3001234567"
					/>
					{#if errors.telefono}
						<p class="mt-1 text-xs text-red-600">{errors.telefono}</p>
					{/if}
				</div>

				<!-- Email -->
				<div>
					<label for="email" class="mb-2 block text-sm font-medium text-gray-700">Email</label>
					<input
						id="email"
						type="email"
						bind:value={formData.email}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.email
							? 'border-red-500'
							: ''}"
						placeholder="conductor@ejemplo.com"
					/>
					{#if errors.email}
						<p class="mt-1 text-xs text-red-600">{errors.email}</p>
					{/if}
				</div>

				<!-- Dirección -->
				<div class="md:col-span-2 lg:col-span-1">
					<label for="direccion" class="mb-2 block text-sm font-medium text-gray-700">
						Dirección
					</label>
					<input
						id="direccion"
						type="text"
						bind:value={formData.direccion}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
						placeholder="Calle 123 # 45-67"
					/>
				</div>
			</div>
		</div>

		<!-- Información Laboral -->
		<div class="mb-8">
			<h2 class="mb-4 text-xl font-semibold text-gray-900">Información Laboral</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				<!-- Cargo -->
				<div>
					<label for="cargo" class="mb-2 block text-sm font-medium text-gray-700">Cargo</label>
					<input
						id="cargo"
						type="text"
						bind:value={formData.cargo}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
						placeholder="Conductor"
					/>
				</div>

				<!-- Fecha de Ingreso -->
				<div>
					<label for="fecha_ingreso" class="mb-2 block text-sm font-medium text-gray-700">
						Fecha de Ingreso
					</label>
					<input
						id="fecha_ingreso"
						type="date"
						bind:value={formData.fecha_ingreso}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					/>
				</div>

				<!-- Salario Base -->
				<div>
					<label for="salario_base" class="mb-2 block text-sm font-medium text-gray-700">
						Salario Base
					</label>
					<input
						id="salario_base"
						type="number"
						bind:value={formData.salario_base}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.salario_base
							? 'border-red-500'
							: ''}"
						placeholder="1500000"
					/>
					{#if errors.salario_base}
						<p class="mt-1 text-xs text-red-600">{errors.salario_base}</p>
					{/if}
				</div>

				<!-- Estado -->
				<div>
					<label for="estado" class="mb-2 block text-sm font-medium text-gray-700">Estado</label>
					<select
						id="estado"
						bind:value={formData.estado}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						<option value={EstadoConductor.ACTIVO}>Activo</option>
						<option value={EstadoConductor.INACTIVO}>Inactivo</option>
						<option value={EstadoConductor.VACACIONES}>Vacaciones</option>
						<option value={EstadoConductor.INCAPACITADO}>Incapacitado</option>
						<option value={EstadoConductor.RETIRADO}>Retirado</option>
					</select>
				</div>

				<!-- Tipo de Contrato -->
				<div>
					<label for="tipo_contrato" class="mb-2 block text-sm font-medium text-gray-700">
						Tipo de Contrato
					</label>
					<select
						id="tipo_contrato"
						bind:value={formData.tipo_contrato}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						<option value="INDEFINIDO">Indefinido</option>
						<option value="FIJO">Fijo</option>
						<option value="OBRA_LABOR">Obra o Labor</option>
						<option value="PRESTACION_SERVICIOS">Prestación de Servicios</option>
					</select>
				</div>

				<!-- Sede de Trabajo -->
				<div>
					<label for="sede_trabajo" class="mb-2 block text-sm font-medium text-gray-700">
						Sede de Trabajo
					</label>
					<select
						id="sede_trabajo"
						bind:value={formData.sede_trabajo}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						{#each sedes as sede}
							<option value={sede}>{sede}</option>
						{/each}
					</select>
				</div>

				<!-- EPS -->
				<div>
					<label for="eps" class="mb-2 block text-sm font-medium text-gray-700">EPS</label>
					<input
						id="eps"
						type="text"
						bind:value={formData.eps}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
						placeholder="Nueva EPS"
					/>
				</div>

				<!-- Fondo de Pensión -->
				<div>
					<label for="fondo_pension" class="mb-2 block text-sm font-medium text-gray-700">
						Fondo de Pensión
					</label>
					<input
						id="fondo_pension"
						type="text"
						bind:value={formData.fondo_pension}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
						placeholder="Porvenir"
					/>
				</div>

				<!-- ARL -->
				<div>
					<label for="arl" class="mb-2 block text-sm font-medium text-gray-700">ARL</label>
					<input
						id="arl"
						type="text"
						bind:value={formData.arl}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
						placeholder="Sura"
					/>
				</div>
			</div>
		</div>

		<!-- Información de Licencia -->
		<div class="mb-8">
			<h2 class="mb-4 text-xl font-semibold text-gray-900">Información de Licencia</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<!-- Categoría de Licencia -->
				<div>
					<label for="categoria_licencia" class="mb-2 block text-sm font-medium text-gray-700">
						Categoría de Licencia
					</label>
					<select
						id="categoria_licencia"
						bind:value={formData.categoria_licencia}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.categoria_licencia
							? 'border-red-500'
							: ''}"
					>
						<option value="">Seleccionar...</option>
						{#each categoriasLicencia as categoria}
							<option value={categoria}>{categoria}</option>
						{/each}
					</select>
					{#if errors.categoria_licencia}
						<p class="mt-1 text-xs text-red-600">{errors.categoria_licencia}</p>
					{/if}
				</div>

				<!-- Vencimiento de Licencia -->
				<div>
					<label for="vencimiento_licencia" class="mb-2 block text-sm font-medium text-gray-700">
						Vencimiento de Licencia
					</label>
					<input
						id="vencimiento_licencia"
						type="date"
						bind:value={formData.vencimiento_licencia}
						class="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 {errors.vencimiento_licencia
							? 'border-red-500'
							: ''}"
					/>
					{#if errors.vencimiento_licencia}
						<p class="mt-1 text-xs text-red-600">{errors.vencimiento_licencia}</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Botones de acción -->
		<div class="flex justify-end gap-3 border-t border-gray-200 pt-6">
			<button
				type="button"
				on:click={handleCancel}
				class="apple-transition rounded-xl bg-gray-100 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
				disabled={isSubmitting}
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="apple-transition inline-flex items-center rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
				disabled={isSubmitting}
			>
				{#if isSubmitting}
					<svg
						class="mr-2 h-4 w-4 animate-spin"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
					Guardando...
				{:else}
					<svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5 13l4 4L19 7"
						/>
					</svg>
					Crear Conductor
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	.glass {
		background: rgba(255, 255, 255, 0.7);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}

	.apple-transition {
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}
</style>
