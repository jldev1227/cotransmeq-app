<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { conductoresAPI } from '$lib/api/apiClient';
	import { fade, fly } from 'svelte/transition';
	import Cropper from 'svelte-easy-crop';
	import { socketUtils } from '$lib/socket';
	import { toast } from '$lib/stores/toast';

	type TabType = 'personal' | 'laboral' | 'seguridad' | 'licencia';

	interface Conductor {
		id: string;
		nombre: string;
		apellido: string;
		tipo_identificacion: string;
		numero_identificacion: string;
		email?: string;
		telefono?: string;
		fecha_nacimiento?: string;
		genero?: string;
		direccion?: string;
		ciudad?: string;
		departamento?: string;
		cargo?: string;
		fecha_ingreso: string;
		salario_base: number;
		estado: string;
		eps?: string;
		fondo_pension?: string;
		arl?: string;
		tipo_contrato?: string;
		categoria_licencia?: string;
		vencimiento_licencia?: string;
		sede_trabajo?: string;
		foto_url?: string;
		foto_signed_url?: string;
		tipo_sangre?: string;
	}

	let conductor: Conductor | null = null;
	let isLoading = true;
	let isSaving = false;
	let error: string | null = null;
	let successMessage: string | null = null;
	let isEditing = false;
	let activeTab: TabType = 'personal';

	// Form data
	let formData: Partial<Conductor> = {};

	// Photo crop
	let showCropModal = false;
	let imageFile: File | null = null;
	let imageSrc = '';
	let crop = { x: 0, y: 0 };
	let zoom = 1;
	let rotation = 0;
	let croppedAreaPixels: any = null;
	let isUploadingPhoto = false;

	$: conductorId = $page.params.id;

	onMount(() => {
		loadConductor();

		// Escuchar evento de foto actualizada
		const handleFotoActualizada = (data: any) => {
			console.log('📸 Foto actualizada via socket:', data);
			if (data.conductorId === conductorId && conductor) {
				conductor.foto_signed_url = data.fotoUrlFirmada;
				// Forzar reactualización
				conductor = { ...conductor };
			}
		};

		socketUtils.on('conductor:foto-actualizada', handleFotoActualizada);

		// Cleanup
		return () => {
			socketUtils.off('conductor:foto-actualizada', handleFotoActualizada);
		};
	});

	async function loadConductor() {
		try {
			isLoading = true;
			error = null;
			const response = await conductoresAPI.getById(conductorId);
			conductor = response.data.data || response.data;
			formData = { ...conductor };
		} catch (err: any) {
			error = err.response?.data?.message || 'Error al cargar conductor';
			console.error('Error loading conductor:', err);
		} finally {
			isLoading = false;
		}
	}

	async function handleSubmit() {
		try {
			isSaving = true;
			error = null;

			await conductoresAPI.update(conductorId, formData);

			toast.success('Conductor actualizado exitosamente');
			isEditing = false;
			await loadConductor();
		} catch (err: any) {
			toast.error(err.response?.data?.message || 'Error al actualizar conductor');
			console.error('Error updating conductor:', err);
		} finally {
			isSaving = false;
		}
	}

	function handleCancel() {
		formData = { ...conductor };
		isEditing = false;
		error = null;
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];

		if (file) {
			if (!file.type.startsWith('image/')) {
				alert('Por favor selecciona una imagen válida');
				return;
			}

			if (file.size > 5 * 1024 * 1024) {
				alert('La imagen no debe superar los 5MB');
				return;
			}

			imageFile = file;
			const reader = new FileReader();
			reader.onload = (e) => {
				imageSrc = e.target?.result as string;
				showCropModal = true;
				// Resetear valores del crop
				crop = { x: 0, y: 0 };
				zoom = 1;
				rotation = 0;
				croppedAreaPixels = null;
			};
			reader.readAsDataURL(file);
		}

		// Reset input
		target.value = '';
	}

	function onCropComplete(e: CustomEvent) {
		console.log('✂️ Crop completado:', e.detail);
		croppedAreaPixels = e.detail.pixels;
		console.log('📐 Área de recorte actualizada:', croppedAreaPixels);
	}

	async function createImage(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.addEventListener('load', () => resolve(image));
			image.addEventListener('error', (error) => reject(error));
			image.src = url;
		});
	}

	async function getCroppedImg(
		imageSrc: string,
		pixelCrop: any,
		rotation = 0
	): Promise<Blob | null> {
		const image = await createImage(imageSrc);
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');

		if (!ctx) return null;

		const maxSize = Math.max(image.width, image.height);
		const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));

		canvas.width = safeArea;
		canvas.height = safeArea;

		ctx.translate(safeArea / 2, safeArea / 2);
		ctx.rotate((rotation * Math.PI) / 180);
		ctx.translate(-safeArea / 2, -safeArea / 2);

		ctx.drawImage(image, safeArea / 2 - image.width * 0.5, safeArea / 2 - image.height * 0.5);

		const data = ctx.getImageData(0, 0, safeArea, safeArea);

		canvas.width = pixelCrop.width;
		canvas.height = pixelCrop.height;

		ctx.putImageData(
			data,
			Math.round(0 - safeArea / 2 + image.width * 0.5 - pixelCrop.x),
			Math.round(0 - safeArea / 2 + image.height * 0.5 - pixelCrop.y)
		);

		return new Promise((resolve) => {
			canvas.toBlob((blob) => {
				resolve(blob);
			}, 'image/jpeg');
		});
	}

	async function handleUploadCroppedImage() {
		console.log('🚀 Iniciando subida de foto...');
		console.log('croppedAreaPixels:', croppedAreaPixels);
		console.log('crop:', crop);
		console.log('zoom:', zoom);
		console.log('imageSrc length:', imageSrc?.length);

		try {
			// Si croppedAreaPixels es null, crear un área por defecto (toda la imagen)
			if (!croppedAreaPixels) {
				console.warn('⚠️ No hay área de recorte definida, usando imagen completa');
				// Intentar cargar la imagen para obtener sus dimensiones
				const img = await createImage(imageSrc);
				croppedAreaPixels = {
					x: 0,
					y: 0,
					width: img.width,
					height: img.height
				};
				console.log('📐 Área de recorte creada automáticamente:', croppedAreaPixels);
			}

			isUploadingPhoto = true;
			error = null;
			console.log('📸 Recortando imagen...');

			const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);

			if (!croppedBlob) {
				throw new Error('Error al procesar la imagen');
			}

			console.log('✅ Imagen recortada:', {
				size: croppedBlob.size,
				type: croppedBlob.type
			});

			const croppedFile = new File([croppedBlob], imageFile?.name || 'photo.jpg', {
				type: 'image/jpeg'
			});

			console.log('📤 Subiendo a servidor...', {
				conductorId,
				fileName: croppedFile.name,
				fileSize: croppedFile.size
			});

			const response = await conductoresAPI.uploadFoto(conductorId, croppedFile);
			console.log('✅ Respuesta del servidor:', response.data);

			// Actualizar la foto con la URL firmada
			if (conductor && response.data?.data?.foto_url_firmada) {
				conductor.foto_signed_url = response.data.data.foto_url_firmada;
				conductor = { ...conductor };
			}

			toast.success('Foto actualizada exitosamente');
			showCropModal = false;
			imageSrc = '';
			imageFile = null;
		} catch (err: any) {
			console.error('❌ Error completo:', err);
			console.error('Respuesta del servidor:', err.response?.data);
			toast.error(err.response?.data?.message || err.message || 'Error al subir la foto');
		} finally {
			isUploadingPhoto = false;
		}
	}

	function handleCloseCropModal() {
		showCropModal = false;
		imageSrc = '';
		imageFile = null;
		crop = { x: 0, y: 0 };
		zoom = 1;
		rotation = 0;
		croppedAreaPixels = null;
	}

	async function handleDeletePhoto() {
		if (!confirm('¿Estás seguro de que deseas eliminar la foto de perfil?')) return;

		try {
			isUploadingPhoto = true;
			error = null;

			await conductoresAPI.deleteFoto(conductorId);

			toast.success('Foto eliminada exitosamente');
			await loadConductor();
		} catch (err: any) {
			toast.error(err.response?.data?.message || 'Error al eliminar la foto');
			console.error('Error deleting photo:', err);
		} finally {
			isUploadingPhoto = false;
		}
	}

	function getInitials(nombre: string, apellido: string): string {
		return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase();
	}

	function getEstadoBadgeClass(estado: string): string {
		switch (estado.toUpperCase()) {
			case 'ACTIVO':
				return 'bg-orange-100 text-orange-800 border border-orange-200';
			case 'INACTIVO':
				return 'bg-gray-100 text-gray-800 border border-gray-200';
			case 'VACACIONES':
				return 'bg-blue-100 text-blue-800 border border-blue-200';
			case 'INCAPACITADO':
				return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
			case 'RETIRADO':
				return 'bg-red-100 text-red-800 border border-red-200';
			default:
				return 'bg-gray-100 text-gray-800 border border-gray-200';
		}
	}

	function formatTipoSangre(tipo?: string | null): string {
		if (!tipo) return '';
		// Convertir O_POSITIVO a O+, AB_NEGATIVO a AB-, etc.
		return tipo
			.replace('_POSITIVO', '+')
			.replace('_NEGATIVO', '-')
			.replace('_', '');
	}

	function goBack() {
		goto('/dashboard/conductores');
	}

	const tabs = [
		{
			id: 'personal' as TabType,
			label: 'Información Personal',
			icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
		},
		{
			id: 'laboral' as TabType,
			label: 'Información Laboral',
			icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
		},
		{
			id: 'seguridad' as TabType,
			label: 'Seguridad Social',
			icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
		},
		{
			id: 'licencia' as TabType,
			label: 'Licencia',
			icon: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2'
		}
	];
</script>

<div class="min-h-screen bg-gray-50">
	<div class="w-full px-4 py-6 sm:px-6 lg:px-8">
		<!-- Header -->
		<div class="mb-6">
			<button
				on:click={goBack}
				class="mb-4 inline-flex items-center text-sm text-gray-600 transition-colors hover:text-gray-900"
			>
				<svg class="mr-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 19l-7-7 7-7"
					/>
				</svg>
				Volver a conductores
			</button>
		</div>

		<!-- Loading State -->
		{#if isLoading}{:else if conductor}
			<!-- Main Content -->
			<div class="rounded-lg border border-gray-200 bg-white shadow-sm">
				<!-- Photo Header Section -->
				<div class="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8">
					<div class="flex flex-col items-center gap-6 md:flex-row md:items-start">
						<!-- Photo -->
						<div class="flex-shrink-0">
							{#if conductor.foto_signed_url}
								<img
									src={conductor.foto_signed_url}
									alt={`${conductor.nombre} ${conductor.apellido}`}
									class="h-32 w-32 rounded-xl border-4 border-white object-cover shadow-lg"
								/>
							{:else}
								<div
									class="flex h-32 w-32 items-center justify-center rounded-xl border-4 border-white bg-orange-700 text-4xl font-bold text-white shadow-lg"
								>
									{getInitials(conductor.nombre, conductor.apellido)}
								</div>
							{/if}
						</div>

						<!-- Info -->
						<div class="flex-1 text-center md:text-left">
							<h2 class="text-2xl font-bold text-white">
								{conductor.nombre}
								{conductor.apellido}
							</h2>
							<p class="mt-1 text-orange-50">{conductor.cargo || 'Conductor'}</p>
							<div class="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
								<span
									class={`rounded-full px-3 py-1 text-xs font-medium ${getEstadoBadgeClass(conductor.estado)} bg-white`}
								>
									{conductor.estado}
								</span>
								{#if conductor.sede_trabajo}
									<span
										class="rounded-full border border-white/30 bg-white/20 px-3 py-1 text-xs font-medium text-white"
									>
										{conductor.sede_trabajo}
									</span>
								{/if}
							</div>

							<div class="mt-4 flex flex-wrap justify-center gap-2 md:justify-start">
								<label
									class="inline-flex cursor-pointer items-center rounded-lg border border-white bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20"
								>
									<svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
										/>
									</svg>
									{conductor.foto_signed_url ? 'Cambiar foto' : 'Subir foto'}
									<input
										type="file"
										accept="image/*"
										on:change={handleFileSelect}
										class="hidden"
										disabled={isUploadingPhoto}
									/>
								</label>

								{#if conductor.foto_signed_url}
									<button
										on:click={handleDeletePhoto}
										disabled={isUploadingPhoto}
										class="inline-flex items-center rounded-lg border border-white/50 bg-red-500/80 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:border-red-400 disabled:opacity-50"
									>
										<svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
										Eliminar
									</button>
								{/if}

								{#if !isLoading && conductor && !isEditing}
									<button
										on:click={() => (isEditing = true)}
										class="inline-flex items-center rounded-lg border border-transparent bg-white px-4 py-2 text-sm font-medium text-orange-600 shadow-sm transition-colors hover:bg-orange-700 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none"
									>
										<svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
											/>
										</svg>
										Editar
									</button>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Tabs Navigation -->
				<div class="border-b border-gray-200 bg-white">
					<nav class="-mb-px flex overflow-x-auto" aria-label="Tabs">
						{#each tabs as tab}
							<button
								type="button"
								on:click={() => (activeTab = tab.id)}
								class={`
									group inline-flex items-center border-b-2 px-6 py-4 text-sm font-medium whitespace-nowrap transition-all
									${
										activeTab === tab.id
											? 'border-orange-500 text-orange-600'
											: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
									}
								`}
							>
								<svg
									class={`
										mr-2 -ml-0.5 h-5 w-5
										${activeTab === tab.id ? 'text-orange-500' : 'text-gray-400 group-hover:text-gray-500'}
									`}
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={tab.icon}
									/>
								</svg>
								{tab.label}
							</button>
						{/each}
					</nav>
				</div>

				<!-- Form -->
				<form on:submit|preventDefault={handleSubmit} class="p-6">
					<!-- Tab Personal -->
					{#if activeTab === 'personal'}
						<div transition:fade={{ duration: 200 }} class="space-y-6">
							<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
								<div>
									<label for="nombre" class="mb-1 block text-sm font-medium text-gray-700">
										Nombre <span class="text-red-500">*</span>
									</label>
									<input
										id="nombre"
										type="text"
										bind:value={formData.nombre}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="apellido" class="mb-1 block text-sm font-medium text-gray-700">
										Apellido <span class="text-red-500">*</span>
									</label>
									<input
										id="apellido"
										type="text"
										bind:value={formData.apellido}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label
										for="tipo_identificacion"
										class="mb-1 block text-sm font-medium text-gray-700"
									>
										Tipo de Identificación <span class="text-red-500">*</span>
									</label>
									<select
										id="tipo_identificacion"
										bind:value={formData.tipo_identificacion}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									>
										<option value="CC">Cédula de Ciudadanía</option>
										<option value="CE">Cédula de Extranjería</option>
										<option value="PA">Pasaporte</option>
									</select>
								</div>

								<div>
									<label
										for="numero_identificacion"
										class="mb-1 block text-sm font-medium text-gray-700"
									>
										Número de Identificación <span class="text-red-500">*</span>
									</label>
									<input
										id="numero_identificacion"
										type="text"
										bind:value={formData.numero_identificacion}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="email" class="mb-1 block text-sm font-medium text-gray-700">
										Email
									</label>
									<input
										id="email"
										type="email"
										bind:value={formData.email}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="telefono" class="mb-1 block text-sm font-medium text-gray-700">
										Teléfono
									</label>
									<input
										id="telefono"
										type="tel"
										bind:value={formData.telefono}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label
										for="fecha_nacimiento"
										class="mb-1 block text-sm font-medium text-gray-700"
									>
										Fecha de Nacimiento
									</label>
									<input
										id="fecha_nacimiento"
										type="date"
										bind:value={formData.fecha_nacimiento}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="genero" class="mb-1 block text-sm font-medium text-gray-700">
										Género
									</label>
									<select
										id="genero"
										bind:value={formData.genero}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									>
										<option value="">Seleccionar</option>
										<option value="M">Masculino</option>
										<option value="F">Femenino</option>
										<option value="Otro">Otro</option>
									</select>
								</div>

								<div>
									<label for="tipo_sangre" class="mb-1 block text-sm font-medium text-gray-700">
										Tipo de Sangre
									</label>
									<select
										id="tipo_sangre"
										bind:value={formData.tipo_sangre}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									>
										<option value="">Seleccionar</option>
										<option value="A+">A+</option>
										<option value="A-">A-</option>
										<option value="B+">B+</option>
										<option value="B-">B-</option>
										<option value="AB+">AB+</option>
										<option value="AB-">AB-</option>
										<option value="O+">O+</option>
										<option value="O-">O-</option>
									</select>
								</div>

								<div class="md:col-span-2">
									<label for="direccion" class="mb-1 block text-sm font-medium text-gray-700">
										Dirección
									</label>
									<input
										id="direccion"
										type="text"
										bind:value={formData.direccion}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>
							</div>
						</div>

						<!-- Tab Laboral -->
					{:else if activeTab === 'laboral'}
						<div transition:fade={{ duration: 200 }} class="space-y-6">
							<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
								<div>
									<label for="cargo" class="mb-1 block text-sm font-medium text-gray-700">
										Cargo
									</label>
									<input
										id="cargo"
										type="text"
										bind:value={formData.cargo}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="fecha_ingreso" class="mb-1 block text-sm font-medium text-gray-700">
										Fecha de Ingreso <span class="text-red-500">*</span>
									</label>
									<input
										id="fecha_ingreso"
										type="date"
										bind:value={formData.fecha_ingreso}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="salario_base" class="mb-1 block text-sm font-medium text-gray-700">
										Salario Base <span class="text-red-500">*</span>
									</label>
									<input
										id="salario_base"
										type="number"
										step="0.01"
										bind:value={formData.salario_base}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="estado" class="mb-1 block text-sm font-medium text-gray-700">
										Estado <span class="text-red-500">*</span>
									</label>
									<select
										id="estado"
										bind:value={formData.estado}
										disabled={!isEditing}
										required
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									>
										<option value="ACTIVO">Activo</option>
										<option value="INACTIVO">Inactivo</option>
										<option value="VACACIONES">Vacaciones</option>
										<option value="INCAPACITADO">Incapacitado</option>
										<option value="RETIRADO">Retirado</option>
									</select>
								</div>

								<div>
									<label for="sede_trabajo" class="mb-1 block text-sm font-medium text-gray-700">
										Sede de Trabajo
									</label>
									<select
										id="sede_trabajo"
										bind:value={formData.sede_trabajo}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									>
										<option value="">Seleccionar</option>
										<option value="YOPAL">Yopal</option>
										<option value="VILLANUEVA">Villanueva</option>
									</select>
								</div>

								<div>
									<label for="tipo_contrato" class="mb-1 block text-sm font-medium text-gray-700">
										Tipo de Contrato
									</label>
									<input
										id="tipo_contrato"
										type="text"
										bind:value={formData.tipo_contrato}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>
							</div>
						</div>

						<!-- Tab Seguridad Social -->
					{:else if activeTab === 'seguridad'}
						<div transition:fade={{ duration: 200 }} class="space-y-6">
							<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
								<div>
									<label for="eps" class="mb-1 block text-sm font-medium text-gray-700">
										EPS
									</label>
									<input
										id="eps"
										type="text"
										bind:value={formData.eps}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="fondo_pension" class="mb-1 block text-sm font-medium text-gray-700">
										Fondo de Pensión
									</label>
									<input
										id="fondo_pension"
										type="text"
										bind:value={formData.fondo_pension}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label for="arl" class="mb-1 block text-sm font-medium text-gray-700">
										ARL
									</label>
									<input
										id="arl"
										type="text"
										bind:value={formData.arl}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>
							</div>
						</div>

						<!-- Tab Licencia -->
					{:else if activeTab === 'licencia'}
						<div transition:fade={{ duration: 200 }} class="space-y-6">
							<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
								<div>
									<label
										for="categoria_licencia"
										class="mb-1 block text-sm font-medium text-gray-700"
									>
										Categoría de Licencia
									</label>
									<input
										id="categoria_licencia"
										type="text"
										bind:value={formData.categoria_licencia}
										disabled={!isEditing}
										placeholder="Ej: C2"
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>

								<div>
									<label
										for="vencimiento_licencia"
										class="mb-1 block text-sm font-medium text-gray-700"
									>
										Fecha de Vencimiento
									</label>
									<input
										id="vencimiento_licencia"
										type="date"
										bind:value={formData.vencimiento_licencia}
										disabled={!isEditing}
										class="block w-full rounded-lg border border-gray-300 px-3 py-2 transition-colors focus:border-orange-500 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Form Actions -->
					{#if isEditing}
						<div class="mt-6 flex justify-end space-x-3 border-t border-gray-200 pt-6">
							<button
								type="button"
								on:click={handleCancel}
								disabled={isSaving}
								class="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
							>
								Cancelar
							</button>
							<button
								type="submit"
								disabled={isSaving}
								class="inline-flex items-center rounded-lg border border-transparent bg-orange-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
							>
								{#if isSaving}
									<svg
										class="mr-2 -ml-1 h-4 w-4 animate-spin text-white"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										/>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
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
									Guardar Cambios
								{/if}
							</button>
						</div>
					{/if}
				</form>
			</div>
		{/if}
	</div>
</div>

<!-- Crop Modal -->
{#if showCropModal}
	<div
		class="fixed inset-0 z-50 overflow-y-auto"
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
	>
		<div class="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:p-0">
			<!-- Backdrop -->
			<div class="bg-opacity-75 fixed inset-0 bg-gray-500 transition-opacity"></div>

			<!-- Modal -->
			<div
				class="relative inline-block transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl sm:align-middle"
				transition:fly={{ y: 50, duration: 300 }}
			>
				<!-- Header -->
				<div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
					<div class="mb-4 flex items-center justify-between">
						<h3 class="text-lg leading-6 font-medium text-gray-900">Recortar Foto de Perfil</h3>
						<button
							type="button"
							on:click={handleCloseCropModal}
							class="text-gray-400 hover:text-gray-500"
						>
							<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>

					<!-- Cropper -->
					<div class="relative h-96 w-full overflow-hidden rounded-lg bg-gray-900">
						<Cropper
							image={imageSrc}
							bind:crop
							bind:zoom
							bind:rotation
							aspect={undefined}
							on:cropcomplete={onCropComplete}
						/>
					</div>

					<!-- Controls -->
					<div class="mt-4 space-y-4">
						<div>
							<label for="zoom" class="mb-2 block text-sm font-medium text-gray-700"> Zoom </label>
							<input
								id="zoom"
								type="range"
								min="1"
								max="3"
								step="0.1"
								bind:value={zoom}
								class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200"
							/>
						</div>

						<div>
							<label for="rotation" class="mb-2 block text-sm font-medium text-gray-700">
								Rotación
							</label>
							<input
								id="rotation"
								type="range"
								min="0"
								max="360"
								step="1"
								bind:value={rotation}
								class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200"
							/>
						</div>
					</div>
				</div>

				<!-- Footer -->
				<div class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
					<button
						type="button"
						on:click={handleUploadCroppedImage}
						disabled={isUploadingPhoto}
						class="inline-flex w-full justify-center rounded-md border border-transparent bg-orange-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-orange-700 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50 sm:ml-3 sm:w-auto sm:text-sm"
					>
						{#if isUploadingPhoto}
							<svg
								class="mr-2 -ml-1 h-4 w-4 animate-spin text-white"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								/>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							Subiendo...
						{:else}
							Subir Foto
						{/if}
					</button>
					<button
						type="button"
						on:click={handleCloseCropModal}
						disabled={isUploadingPhoto}
						class="mt-3 inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
					>
						Cancelar
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
