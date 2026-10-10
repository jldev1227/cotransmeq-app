<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Cropper, { type OnCropCompleteEvent } from 'svelte-easy-crop';
	import { conductoresAPI } from '$lib/api/apiClient';
	import ModalFormConductor from '$lib/components/conductores/ModalFormConductor.svelte';
	import { socketUtils } from '$lib/socket';
	import { toast } from 'svelte-sonner';
	import ReadonlyField from '$lib/components/ReadonlyField.svelte';

	type TabType = 'personal' | 'laboral' | 'seguridad' | 'licencia';
	type EstadoType = 'ACTIVO' | 'INACTIVO' | 'VACACIONES' | 'INCAPACITADO' | 'RETIRADO' | 'servicio';
	type SedeType = '' | 'YOPAL' | 'VILLANUEVA' | 'TAURAMENA';
	type GeneroType = '' | 'M' | 'F' | 'MASCULINO' | 'FEMENINO' | 'OTRO';
	type SangreType =
		| ''
		| 'A_POSITIVO'
		| 'A_NEGATIVO'
		| 'B_POSITIVO'
		| 'B_NEGATIVO'
		| 'AB_POSITIVO'
		| 'AB_NEGATIVO'
		| 'O_POSITIVO'
		| 'O_NEGATIVO';

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
		salario_base: number | string;
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

	interface ConductorForm {
		nombre: string;
		apellido: string;
		tipo_identificacion: string;
		numero_identificacion: string;
		email: string;
		telefono: string;
		fecha_nacimiento: string;
		genero: GeneroType;
		direccion: string;
		cargo: string;
		fecha_ingreso: string;
		salario_base: string;
		estado: EstadoType;
		sede_trabajo: SedeType;
		tipo_contrato: string;
		eps: string;
		fondo_pension: string;
		arl: string;
		categoria_licencia: string;
		vencimiento_licencia: string;
		tipo_sangre: SangreType;
	}

	const TABS: { id: TabType; label: string; icon: string }[] = [
		{
			id: 'personal',
			label: 'Información Personal',
			icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
		},
		{
			id: 'laboral',
			label: 'Información Laboral',
			icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
		},
		{
			id: 'seguridad',
			label: 'Seguridad Social',
			icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
		},
		{
			id: 'licencia',
			label: 'Licencia',
			icon: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2'
		}
	];

	const ESTADOS: { value: EstadoType; label: string; tone: string }[] = [
		{ value: 'ACTIVO', label: 'Activo', tone: 'emerald' },
		{ value: 'INACTIVO', label: 'Inactivo', tone: 'slate' },
		{ value: 'VACACIONES', label: 'Vacaciones', tone: 'sky' },
		{ value: 'INCAPACITADO', label: 'Incapacitado', tone: 'amber' },
		{ value: 'RETIRADO', label: 'Retirado', tone: 'red' },
		{ value: 'servicio', label: 'En servicio', tone: 'teal' }
	];

	const SEDES = [
		{ value: '', label: 'Sin asignar' },
		{ value: 'YOPAL', label: 'Yopal' },
		{ value: 'VILLANUEVA', label: 'Villanueva' },
		{ value: 'TAURAMENA', label: 'Tauramena' }
	];

	const TIPOS_ID = [
		{ value: 'CC', label: 'Cédula de Ciudadanía' },
		{ value: 'CE', label: 'Cédula de Extranjería' },
		{ value: 'PA', label: 'Pasaporte' },
		{ value: 'TI', label: 'Tarjeta de Identidad' }
	];

	const GENEROS = [
		{ value: '', label: 'Sin especificar' },
		{ value: 'MASCULINO', label: 'Masculino' },
		{ value: 'FEMENINO', label: 'Femenino' },
		{ value: 'OTRO', label: 'Otro' }
	];

	const TIPOS_SANGRE = [
		{ value: '', label: 'Sin especificar' },
		{ value: 'A_POSITIVO', label: 'A+' },
		{ value: 'A_NEGATIVO', label: 'A−' },
		{ value: 'B_POSITIVO', label: 'B+' },
		{ value: 'B_NEGATIVO', label: 'B−' },
		{ value: 'AB_POSITIVO', label: 'AB+' },
		{ value: 'AB_NEGATIVO', label: 'AB−' },
		{ value: 'O_POSITIVO', label: 'O+' },
		{ value: 'O_NEGATIVO', label: 'O−' }
	];

	const TIPOS_CONTRATO = [
		{ value: '', label: 'Sin especificar' },
		{ value: 'INDEFINIDO', label: 'Término indefinido' },
		{ value: 'FIJO', label: 'Término fijo' },
		{ value: 'OBRA_LABOR', label: 'Obra o labor' },
		{ value: 'PRESTACION_SERVICIOS', label: 'Prestación de servicios' }
	];

	const CATEGORIAS_LICENCIA = [
		{ value: '', label: 'Sin categoría' },
		{ value: 'A1', label: 'A1' },
		{ value: 'A2', label: 'A2' },
		{ value: 'B1', label: 'B1' },
		{ value: 'B2', label: 'B2' },
		{ value: 'B3', label: 'B3' },
		{ value: 'C1', label: 'C1' },
		{ value: 'C2', label: 'C2' },
		{ value: 'C3', label: 'C3' }
	];

	const FIELD_GROUPS: { id: TabType; description: string }[] = [
		{
			id: 'personal',
			description: 'Identidad, contacto y datos biográficos del conductor.'
		},
		{
			id: 'laboral',
			description: 'Cargo, contrato, sede y estado operativo dentro de la empresa.'
		},
		{
			id: 'seguridad',
			description: 'Afiliaciones a salud, pensión y riesgos laborales.'
		},
		{
			id: 'licencia',
			description: 'Categoría y fecha de vencimiento de la licencia de conducción.'
		}
	];

	let conductor: Conductor | null = null;
	let isLoading = true;
	/// Editar abre el mismo modal que crear (listado de conductores).
	let modalAbierto = false;
	let error: string | null = null;
	let activeTab: TabType = 'personal';

	let formData: ConductorForm = emptyForm();

	let showCropModal = false;
	let imageFile: File | null = null;
	let imageSrc = '';
	let crop = { x: 0, y: 0 };
	let zoom = 1;
	let rotation = 0;
	let croppedAreaPixels: { x: number; y: number; width: number; height: number } | null = null;
	let isUploadingPhoto = false;
	let showPhotoMenu = false;
	let confirmDeletePhoto = false;
	let photoSuccess = false;

	$: conductorId = $page.params.id;
	$: fullName = conductor ? `${conductor.nombre ?? ''} ${conductor.apellido ?? ''}`.trim() : '';
	$: estadoInfo = (() => {
		const e = conductor?.estado?.toUpperCase();
		return (
			ESTADOS.find((x) => x.value.toUpperCase() === e) ?? {
				value: e ?? 'SIN ESTADO',
				label: conductor?.estado || 'Sin estado',
				tone: 'slate'
			}
		);
	})();
	$: tabCompletion = computeTabCompletion(formData);

	function emptyForm(): ConductorForm {
		return {
			nombre: '',
			apellido: '',
			tipo_identificacion: 'CC',
			numero_identificacion: '',
			email: '',
			telefono: '',
			fecha_nacimiento: '',
			genero: '',
			direccion: '',
			cargo: 'CONDUCTOR',
			fecha_ingreso: '',
			salario_base: '',
			estado: 'ACTIVO',
			sede_trabajo: '',
			tipo_contrato: '',
			eps: '',
			fondo_pension: '',
			arl: '',
			categoria_licencia: '',
			vencimiento_licencia: '',
			tipo_sangre: ''
		};
	}

	function toForm(c: Conductor): ConductorForm {
		return {
			nombre: c.nombre ?? '',
			apellido: c.apellido ?? '',
			tipo_identificacion: c.tipo_identificacion ?? 'CC',
			numero_identificacion: c.numero_identificacion ?? '',
			email: c.email ?? '',
			telefono: c.telefono ?? '',
			fecha_nacimiento: toDateInput(c.fecha_nacimiento),
			genero: normalizeGenero(c.genero),
			direccion: c.direccion ?? '',
			cargo: c.cargo ?? 'CONDUCTOR',
			fecha_ingreso: toDateInput(c.fecha_ingreso),
			salario_base: c.salario_base != null ? String(c.salario_base) : '',
			estado: (normalizeEstado(c.estado) ?? 'ACTIVO') as EstadoType,
			sede_trabajo: (normalizeSede(c.sede_trabajo) ?? '') as SedeType,
			tipo_contrato: c.tipo_contrato ?? '',
			eps: c.eps ?? '',
			fondo_pension: c.fondo_pension ?? '',
			arl: c.arl ?? '',
			categoria_licencia: c.categoria_licencia ?? '',
			vencimiento_licencia: toDateInput(c.vencimiento_licencia),
			tipo_sangre: (normalizeSangre(c.tipo_sangre) ?? '') as SangreType
		};
	}

	function toDateInput(value: string | undefined | null): string {
		if (!value) return '';
		const d = new Date(value);
		if (isNaN(d.getTime())) return '';
		return d.toISOString().split('T')[0];
	}

	function normalizeEstado(value: string | undefined | null): EstadoType | null {
		if (!value) return null;
		const v = value.toUpperCase();
		if (v === 'SERVICIO' || v === 'EN_SERVICIO') return 'servicio';
		return ESTADOS.find((e) => e.value === v)?.value ?? null;
	}

	function normalizeSede(value: string | undefined | null): SedeType | null {
		if (!value) return null;
		const v = value.toUpperCase();
		const found = SEDES.find((s) => s.value.toUpperCase() === v);
		return (found?.value ?? null) as SedeType | null;
	}

	function normalizeGenero(value: string | undefined | null): GeneroType {
		if (!value) return '';
		const v = value.toUpperCase();
		if (v === 'M' || v === 'MASCULINO') return 'MASCULINO';
		if (v === 'F' || v === 'FEMENINO') return 'FEMENINO';
		if (v === 'OTRO' || v === 'OTROS') return 'OTRO';
		return '';
	}

	function normalizeSangre(value: string | undefined | null): SangreType | null {
		if (!value) return null;
		const v = value.toUpperCase().replace(/\s+/g, '');
		if (v === 'A+' || v === 'A_POSITIVO') return 'A_POSITIVO';
		if (v === 'A-' || v === 'A_NEGATIVO') return 'A_NEGATIVO';
		if (v === 'B+' || v === 'B_POSITIVO') return 'B_POSITIVO';
		if (v === 'B-' || v === 'B_NEGATIVO') return 'B_NEGATIVO';
		if (v === 'AB+' || v === 'AB_POSITIVO') return 'AB_POSITIVO';
		if (v === 'AB-' || v === 'AB_NEGATIVO') return 'AB_NEGATIVO';
		if (v === 'O+' || v === 'O_POSITIVO') return 'O_POSITIVO';
		if (v === 'O-' || v === 'O_NEGATIVO') return 'O_NEGATIVO';
		return null;
	}

	function computeTabCompletion(
		form: ConductorForm
	): Record<TabType, { done: number; total: number }> {
		const count = (fields: (keyof ConductorForm)[]) => {
			const done = fields.filter((f) => String(form[f] ?? '').trim() !== '').length;
			return { done, total: fields.length };
		};
		return {
			personal: count(['nombre', 'apellido', 'numero_identificacion', 'email', 'telefono']),
			laboral: count(['cargo', 'fecha_ingreso', 'salario_base', 'estado', 'sede_trabajo']),
			seguridad: count(['eps', 'fondo_pension', 'arl']),
			licencia: count(['categoria_licencia', 'vencimiento_licencia'])
		};
	}

	function getInitials(nombre: string, apellido: string): string {
		const n = nombre?.trim().charAt(0) ?? '';
		const a = apellido?.trim().charAt(0) ?? '';
		return `${n}${a}`.toUpperCase() || 'TR';
	}

	function getEstadoPill(tone: string): string {
		const map: Record<string, string> = {
			emerald:
				'background: rgba(234, 88, 12,0.10); color: var(--orange-800); border: 1px solid rgba(234, 88, 12,0.25);',
			slate:
				'background: rgba(100,116,139,0.10); color: #334155; border: 1px solid rgba(100,116,139,0.22);',
			sky: 'background: rgba(14,165,233,0.10); color: #075985; border: 1px solid rgba(14,165,233,0.25);',
			amber:
				'background: rgba(245,158,11,0.10); color: #92400e; border: 1px solid rgba(245,158,11,0.28);',
			red: 'background: rgba(220,38,38,0.10); color: #991b1b; border: 1px solid rgba(220,38,38,0.25);',
			teal: 'background: rgba(13,148,136,0.10); color: #115e59; border: 1px solid rgba(13,148,136,0.25);'
		};
		return map[tone] ?? map.slate;
	}

	/// Color del punto de estado en la tarjeta oscura: los tonos de
	/// `getEstadoPill` son para fondo claro y ahí no se verían.
	function puntoTono(tone: string): string {
		const map: Record<string, string> = {
			emerald: '#34d399',
			slate: '#cbd5e1',
			sky: '#38bdf8',
			amber: '#fbbf24',
			red: '#f87171',
			teal: '#2dd4bf'
		};
		return map[tone] ?? map.slate;
	}

	function formatSalario(value: string | number | undefined | null): string {
		if (value === '' || value == null) return '—';
		const num = typeof value === 'string' ? parseFloat(value) : value;
		if (Number.isNaN(num)) return '—';
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			maximumFractionDigits: 0
		}).format(num);
	}

	function formatDate(value: string | undefined | null): string {
		if (!value) return '—';
		const d = new Date(value);
		if (isNaN(d.getTime())) return '—';
		return d.toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'long',
			year: 'numeric'
		});
	}

	function daysUntil(value: string | undefined | null): number | null {
		if (!value) return null;
		const target = new Date(value);
		if (isNaN(target.getTime())) return null;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return Math.round((target.getTime() - today.getTime()) / 86_400_000);
	}

	onMount(() => {
		loadConductor();

		const handleFotoActualizada = (data: { conductorId: string; fotoUrlFirmada: string }) => {
			if (data?.conductorId === conductorId && conductor) {
				conductor = { ...conductor, foto_signed_url: data.fotoUrlFirmada };
			}
		};
		socketUtils.on('conductor:foto-actualizada', handleFotoActualizada);

		const clickOutside = (e: MouseEvent) => {
			if (!(e.target as HTMLElement).closest('.photo-menu-wrapper')) {
				showPhotoMenu = false;
			}
		};
		document.addEventListener('click', clickOutside);

		const escListener = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (showCropModal) {
				e.preventDefault();
				handleCloseCropModal();
			} else if (confirmDeletePhoto) {
				e.preventDefault();
				confirmDeletePhoto = false;
			} else if (showPhotoMenu) {
				showPhotoMenu = false;
			}
		};
		document.addEventListener('keydown', escListener);

		return () => {
			socketUtils.off('conductor:foto-actualizada', handleFotoActualizada);
			document.removeEventListener('click', clickOutside);
			document.removeEventListener('keydown', escListener);
		};
	});

	onDestroy(() => {
		showCropModal = false;
		imageSrc = '';
	});

	async function loadConductor() {
		try {
			isLoading = true;
			error = null;
			if (!conductorId) return;
			const response = await conductoresAPI.getById(conductorId);
			conductor = response.data.data || response.data;
			if (conductor) {
				formData = toForm(conductor);
			}
		} catch (err: any) {
			const msg = err.response?.data?.message || err.message || 'No se pudo cargar el conductor';
			error = String(msg);
			toast.error(String(msg));
		} finally {
			isLoading = false;
		}
	}

	function requestTabChange(tab: TabType) {
		activeTab = tab;
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			toast.error('Selecciona una imagen válida');
			target.value = '';
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			toast.error('La imagen no debe superar 5MB');
			target.value = '';
			return;
		}

		imageFile = file;
		const reader = new FileReader();
		reader.onload = (e) => {
			imageSrc = (e.target?.result as string) ?? '';
			showCropModal = true;
			showPhotoMenu = false;
			crop = { x: 0, y: 0 };
			zoom = 1;
			rotation = 0;
			croppedAreaPixels = null;
		};
		reader.readAsDataURL(file);
		target.value = '';
	}

	function onCropComplete(e: OnCropCompleteEvent) {
		croppedAreaPixels = e.pixels ?? null;
	}

	async function createImage(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.addEventListener('load', () => resolve(image));
			image.addEventListener('error', (err) => reject(err));
			image.src = url;
		});
	}

	async function getCroppedImg(
		imageSrcValue: string,
		pixelCrop: { x: number; y: number; width: number; height: number },
		rotationDeg = 0
	): Promise<Blob | null> {
		const image = await createImage(imageSrcValue);
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;

		const maxSize = Math.max(image.width, image.height);
		const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));
		canvas.width = safeArea;
		canvas.height = safeArea;

		ctx.translate(safeArea / 2, safeArea / 2);
		ctx.rotate((rotationDeg * Math.PI) / 180);
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
			canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
		});
	}

	async function handleUploadCroppedImage() {
		try {
			if (!conductorId) return;
			isUploadingPhoto = true;
			photoSuccess = false;

			let pixelCrop = croppedAreaPixels;
			if (!pixelCrop) {
				const img = await createImage(imageSrc);
				pixelCrop = { x: 0, y: 0, width: img.width, height: img.height };
			}

			const croppedBlob = await getCroppedImg(imageSrc, pixelCrop, rotation);
			if (!croppedBlob) throw new Error('No se pudo procesar la imagen');

			const fileName = imageFile?.name?.replace(/\.[^.]+$/, '') || 'foto-conductor';
			const croppedFile = new File([croppedBlob], `${fileName}.jpg`, {
				type: 'image/jpeg'
			});
			const response = await conductoresAPI.uploadFoto(conductorId, croppedFile);

			if (conductor && response.data?.data?.foto_url_firmada) {
				conductor = {
					...conductor,
					foto_signed_url: response.data.data.foto_url_firmada
				};
			}

			photoSuccess = true;
			setTimeout(() => {
				photoSuccess = false;
			}, 1800);

			setTimeout(() => {
				showCropModal = false;
				imageSrc = '';
				imageFile = null;
			}, 700);

			toast.success('Foto actualizada');
		} catch (err: any) {
			toast.error(err.response?.data?.message || err.message || 'Error al subir la foto');
		} finally {
			isUploadingPhoto = false;
		}
	}

	function handleCloseCropModal() {
		if (isUploadingPhoto) return;
		showCropModal = false;
		imageSrc = '';
		imageFile = null;
	}

	async function handleDeletePhoto() {
		confirmDeletePhoto = false;
		try {
			if (!conductorId) return;
			isUploadingPhoto = true;
			await conductoresAPI.deleteFoto(conductorId);
			if (conductor) {
				conductor = { ...conductor, foto_signed_url: undefined, foto_url: undefined };
			}
			toast.success('Foto eliminada');
		} catch (err: any) {
			toast.error(err.response?.data?.message || 'No se pudo eliminar la foto');
		} finally {
			isUploadingPhoto = false;
		}
	}

	function getEstadoLabel(value: string | undefined): string {
		const v = value?.toUpperCase();
		return ESTADOS.find((e) => e.value.toUpperCase() === v)?.label ?? value ?? 'Sin estado';
	}

	function getSedeLabel(value: string | undefined | null): string {
		if (!value) return 'Sin sede';
		const v = value.toUpperCase();
		return SEDES.find((s) => s.value.toUpperCase() === v)?.label ?? value;
	}

	function getGeneroLabel(value: string | undefined | null): string {
		if (!value) return 'Sin especificar';
		const v = value.toUpperCase();
		if (v === 'M' || v === 'MASCULINO') return 'Masculino';
		if (v === 'F' || v === 'FEMENINO') return 'Femenino';
		if (v === 'OTRO' || v === 'OTROS') return 'Otro';
		return value;
	}

	function getSangreLabel(value: string | undefined | null): string {
		if (!value) return '—';
		const v = value.toUpperCase().replace(/\s+/g, '');
		return (
			TIPOS_SANGRE.find((s) => s.value === v || s.value.replace('_', '').toUpperCase() === v)
				?.label ?? value
		);
	}
</script>

<ModalFormConductor
	open={modalAbierto}
	{conductorId}
	onclose={() => (modalAbierto = false)}
	onguardado={() => loadConductor()}
/>

<svelte:head>
	<title>{fullName || 'Conductor'} · Perfil — Cotransmeq</title>
</svelte:head>

<div class="cond-pagina" style="background-color: var(--bg-base);">
	<!-- Regreso al listado. La identidad completa vive en la tarjeta lateral. -->
	<div class="cond-volver" in:fly={{ y: -10, duration: 400, easing: quintOut }}>
		<button
			type="button"
			class="btn-icon"
			aria-label="Volver al listado"
			on:click={() => goto('/dashboard/conductores')}
		>
			<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
		</button>
		<span class="cond-miga">
			<a href="/dashboard/conductores">Conductores</a>
			<span aria-hidden="true">/</span>
			<strong>{fullName || 'Cargando…'}</strong>
		</span>
	</div>

	{#if isLoading}
		<CargaMascota texto="Cargando conductor…" tamano="pantalla" />
	{:else if error && !conductor}
		<div
			class="page-card flex flex-col items-center gap-3 py-12 text-center"
			in:fade={{ duration: 320 }}
		>
			<div
				class="flex h-12 w-12 items-center justify-center rounded-2xl"
				style="background: rgba(220,38,38,0.10); color: #b91c1c;"
			>
				<svg
					class="h-6 w-6"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.8"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 9v3.5m0 3v.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
					/>
				</svg>
			</div>
			<h2 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 800;">
				No se pudo cargar el conductor
			</h2>
			<p class="max-w-md text-sm" style="color: var(--text-muted);">{error}</p>
			<button class="btn-secondary" on:click={loadConductor}>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.8"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				Reintentar
			</button>
		</div>
	{:else if conductor}
		<div class="cond-grid">
			<!-- ═══ TARJETA LATERAL: identidad, acciones y licencia ═══ -->
			<aside class="cond-aside" in:fly={{ y: 16, duration: 480, easing: quintOut, delay: 60 }}>
				<!-- Identidad sobre el verde de marca -->
				<section class="cond-hero">
					<div class="cond-hero-fondo" aria-hidden="true">
						<span class="cond-orbe cond-orbe--grande"></span>
						<span class="cond-orbe cond-orbe--chico"></span>
					</div>
					<div class="cond-hero-cuerpo">
						<div class="photo-menu-wrapper cond-foto-wrap">
							<button
								type="button"
								class="cond-foto group"
								aria-label="Cambiar foto de perfil"
								on:click={() => (showPhotoMenu = !showPhotoMenu)}
							>
								{#if conductor.foto_signed_url}
									<img src={conductor.foto_signed_url} alt={fullName} />
								{:else}
									<div class="cond-foto-iniciales">
										{getInitials(conductor.nombre, conductor.apellido)}
									</div>
								{/if}
								<div class="cond-foto-velo">
									<span class="cond-foto-cambiar">
										<svg
											class="h-3 w-3"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
											/>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
											/>
										</svg>
										Cambiar foto
									</span>
								</div>
							</button>

							{#if showPhotoMenu}
								<div class="cond-foto-menu" role="menu" transition:fly={{ y: -6, duration: 200 }}>
									<div class="cond-foto-menu-caja">
										<label class="cond-foto-menu-item">
											<svg
												class="h-4 w-4"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="1.8"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M4 16l4-4 3 3 5-5 4 4M4 6h16"
												/>
											</svg>
											{conductor.foto_signed_url ? 'Reemplazar foto' : 'Subir foto'}
											<input
												type="file"
												accept="image/*"
												class="hidden"
												on:change={handleFileSelect}
												disabled={isUploadingPhoto}
											/>
										</label>
										{#if conductor.foto_signed_url}
											<button
												type="button"
												class="cond-foto-menu-item cond-foto-menu-item--peligro"
												on:click={() => {
													confirmDeletePhoto = true;
													showPhotoMenu = false;
												}}
												disabled={isUploadingPhoto}
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/>
												</svg>
												Eliminar foto
											</button>
										{/if}
									</div>
								</div>
							{/if}
						</div>

						<div class="cond-identidad">
							<span class="cond-eyebrow">{conductor.cargo || 'Conductor'}</span>
							<h2 class="cond-nombre">{conductor.nombre} {conductor.apellido}</h2>
							<p class="cond-documento">
								{conductor.tipo_identificacion || 'ID'} · {conductor.numero_identificacion || '—'}
							</p>
							<div class="cond-pills">
								<span class="cond-pill">
									<span
										class="cond-pill-punto"
										style="background: {puntoTono(estadoInfo.tone)};"
										aria-hidden="true"
									></span>
									{estadoInfo.label}
								</span>
								<span class="cond-pill">
									{conductor.sede_trabajo ? getSedeLabel(conductor.sede_trabajo) : 'Sin sede'}
								</span>
							</div>
						</div>
					</div>

					<dl class="cond-cifras">
						<div class="cond-cifra">
							<dt>Salario</dt>
							<dd>{formatSalario(conductor.salario_base)}</dd>
						</div>
						<div class="cond-cifra">
							<dt>Ingreso</dt>
							<dd>
								{conductor.fecha_ingreso ? formatDate(conductor.fecha_ingreso).split(' de ')[2] : '—'}
							</dd>
						</div>
						<div class="cond-cifra">
							<dt>Sangre</dt>
							<dd>{getSangreLabel(conductor.tipo_sangre)}</dd>
						</div>
					</dl>
				</section>

				<!-- Acciones rápidas -->
				<section class="page-card cond-card">
					<p class="cond-card-titulo">Acciones rápidas</p>
					<div class="cond-acciones">
						<button
							type="button"
							class="cond-accion"
							on:click={() =>
								goto(`/dashboard/conductores/recorridos?conductor=${conductor!.id}`)}
						>
							<span class="cond-accion-icono">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
									/>
								</svg>
							</span>
							<span class="cond-accion-texto">Ver recorridos</span>
							<svg
								class="cond-accion-flecha"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</button>
						<button
							type="button"
							class="cond-accion"
							disabled={!conductor?.email}
							on:click={() =>
								conductor?.email && (window.location.href = `mailto:${conductor.email}`)}
						>
							<span class="cond-accion-icono">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
									/>
								</svg>
							</span>
							<span class="cond-accion-texto">Enviar correo</span>
							<span class="cond-accion-meta">{conductor.email || 'No registrado'}</span>
						</button>
						<button
							type="button"
							class="cond-accion"
							disabled={!conductor?.telefono}
							on:click={() =>
								conductor?.telefono && (window.location.href = `tel:${conductor.telefono}`)}
						>
							<span class="cond-accion-icono">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21L6.374 11.5l8.25 8.25 2.113-3.85a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V20.72a2 2 0 01-2 2h-1.28C10.5 22.72 1.28 13.5 1.28 2.72V1.44a2 2 0 012-2H6.5z"
									/>
								</svg>
							</span>
							<span class="cond-accion-texto">Llamar</span>
							<span class="cond-accion-meta">{conductor.telefono || 'No registrado'}</span>
						</button>
					</div>
				</section>

				<!-- Licencia -->
				{#if conductor.vencimiento_licencia}
					{@const dias = daysUntil(conductor.vencimiento_licencia)}
					<section
						class="page-card cond-card cond-licencia"
						class:cond-licencia--alerta={dias !== null && dias < 30}
						class:cond-licencia--vencida={dias !== null && dias < 0}
					>
						<div class="cond-licencia-fila">
							<span class="cond-licencia-icono">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</span>
							<div class="min-w-0 flex-1">
								<p class="cond-card-titulo" style="margin: 0;">
									Licencia {conductor.categoria_licencia || '—'}
								</p>
								<p class="cond-licencia-fecha">{formatDate(conductor.vencimiento_licencia)}</p>
								{#if dias !== null}
									{#if dias < 0}
										<p class="cond-licencia-nota">Vencida hace {Math.abs(dias)} días</p>
									{:else if dias < 30}
										<p class="cond-licencia-nota">
											Vence en {dias}
											{dias === 1 ? 'día' : 'días'}
										</p>
									{:else}
										<p class="cond-licencia-nota">Vigente · {dias} días restantes</p>
									{/if}
								{/if}
							</div>
						</div>
					</section>
				{/if}
			</aside>

			<!-- ═══ CONTENIDO PRINCIPAL (columna derecha) ═══ -->
			<section class="cond-main space-y-5" in:fly={{ y: 16, duration: 480, easing: quintOut, delay: 120 }}>
				<!-- Barra de acciones de edición -->
				<div
					class="page-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
					style="padding: 1rem 1.25rem;"
				>
					<div>
						<p class="font-display text-base" style="color: var(--bg-charcoal); font-weight: 800;">
							Expediente
						</p>
						<p class="text-xs" style="color: var(--text-muted);">
							Vista de solo lectura. «Editar» abre el formulario del conductor.
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						
							<button type="button" class="btn-primary" on:click={() => (modalAbierto = true)}>
								<svg
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
									/>
								</svg>
								Editar
							</button>
						
					</div>
				</div>

				<!-- Tabs -->
				<div class="page-card" style="padding: 0.65rem 0.65rem;">
					<div class="cond-tabs" role="tablist" aria-label="Secciones del conductor">
						{#each TABS as tab (tab.id)}
							{@const meta = FIELD_GROUPS.find((g) => g.id === tab.id)}
							{@const completion = tabCompletion[tab.id]}
							{@const pct =
								completion.total > 0 ? Math.round((completion.done / completion.total) * 100) : 0}
							{@const isActive = activeTab === tab.id}
							<button
								type="button"
								role="tab"
								aria-selected={isActive}
								class="cond-tab group inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all"
								style={`background: ${isActive ? 'linear-gradient(135deg, rgba(234, 88, 12,0.10), rgba(234, 88, 12,0.10))' : 'transparent'}; color: ${isActive ? 'var(--orange-800)' : 'var(--text-secondary)'}; border: 1px solid ${isActive ? 'rgba(234, 88, 12,0.25)' : 'transparent'};`}
								on:click={() => requestTabChange(tab.id)}
							>
								<span
									class="flex h-6 w-6 items-center justify-center rounded-md"
									style={`background: ${isActive ? 'linear-gradient(135deg, #ea580c, #c2410c)' : 'rgba(234, 88, 12,0.08)'}; color: ${isActive ? 'white' : 'var(--orange-700)'};`}
								>
									<svg
										class="h-3.5 w-3.5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d={tab.icon} />
									</svg>
								</span>
								<span class="whitespace-nowrap">{tab.label}</span>
								<span
									class="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
									style={`background: ${pct === 100 ? 'rgba(234, 88, 12,0.12)' : 'rgba(0,0,0,0.04)'}; color: ${pct === 100 ? 'var(--orange-800)' : 'var(--text-muted)'};`}
								>
									{completion.done}/{completion.total}
								</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Form -->
				<div class="page-card" style="padding: 1.5rem;">
					<div class="mb-5 flex flex-col gap-1">
						<p class="font-mono-meta" style="color: var(--orange-700); font-size: 0.6rem;">
							Sección activa
						</p>
						<h2 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 800;">
							{FIELD_GROUPS.find((g) => g.id === activeTab)?.id === 'personal'
								? 'Información Personal'
								: ''}
							{FIELD_GROUPS.find((g) => g.id === activeTab)?.id === 'laboral'
								? 'Información Laboral'
								: ''}
							{FIELD_GROUPS.find((g) => g.id === activeTab)?.id === 'seguridad'
								? 'Seguridad Social'
								: ''}
							{FIELD_GROUPS.find((g) => g.id === activeTab)?.id === 'licencia'
								? 'Licencia de Conducción'
								: ''}
						</h2>
						<p class="text-xs" style="color: var(--text-muted);">
							{FIELD_GROUPS.find((g) => g.id === activeTab)?.description}
						</p>
					</div>

					{#if activeTab === 'personal'}
						<div
							class="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2"
							in:fade={{ duration: 220 }}
						>
							<!-- Nombre -->
							<div class="space-y-1.5">
								<label for="nombre" class="filter-field-label">
									<span>Nombre <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">Requerido</span>
								</label>
								
									<ReadonlyField value={conductor.nombre} />
								
								
							</div>

							<!-- Apellido -->
							<div class="space-y-1.5">
								<label for="apellido" class="filter-field-label">
									<span>Apellido <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">Requerido</span>
								</label>
								
									<ReadonlyField value={conductor.apellido} />
								
								
							</div>

							<!-- Tipo ID -->
							<div class="space-y-1.5">
								<label for="tipo_identificacion" class="filter-field-label">
									<span>Tipo de identificación</span>
								</label>
								
									<ReadonlyField
										value={TIPOS_ID.find((t) => t.value === conductor?.tipo_identificacion)
											?.label ?? conductor?.tipo_identificacion}
									/>
								
							</div>

							<!-- Número ID -->
							<div class="space-y-1.5">
								<label for="numero_identificacion" class="filter-field-label">
									<span>Número de identificación <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">Único</span>
								</label>
								
									<ReadonlyField value={conductor.numero_identificacion} mono />
								
								
							</div>

							<!-- Email -->
							<div class="space-y-1.5">
								<label for="email" class="filter-field-label">
									<span>Email</span>
								</label>
								
									<ReadonlyField value={conductor.email} emptyText="Sin email" />
								
								
							</div>

							<!-- Teléfono -->
							<div class="space-y-1.5">
								<label for="telefono" class="filter-field-label">
									<span>Teléfono</span>
								</label>
								
									<ReadonlyField value={conductor.telefono} emptyText="Sin teléfono" />
								
							</div>

							<!-- Fecha nacimiento -->
							<div class="space-y-1.5">
								<label for="fecha_nacimiento" class="filter-field-label">
									<span>Fecha de nacimiento</span>
								</label>
								
									<ReadonlyField value={formatDate(conductor.fecha_nacimiento)} />
								
							</div>

							<!-- Género -->
							<div class="space-y-1.5">
								<label for="genero" class="filter-field-label">
									<span>Género</span>
								</label>
								
									<ReadonlyField value={getGeneroLabel(conductor.genero)} />
								
							</div>

							<!-- Tipo de sangre -->
							<div class="space-y-1.5">
								<label for="tipo_sangre" class="filter-field-label">
									<span>Tipo de sangre</span>
								</label>
								
									<ReadonlyField value={getSangreLabel(conductor.tipo_sangre)} />
								
							</div>

							<!-- Dirección -->
							<div class="space-y-1.5 md:col-span-2">
								<label for="direccion" class="filter-field-label">
									<span>Dirección</span>
								</label>
								
									<ReadonlyField value={conductor.direccion} emptyText="Sin dirección registrada" />
								
							</div>
						</div>
					{:else if activeTab === 'laboral'}
						<div
							class="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2"
							in:fade={{ duration: 220 }}
						>
							<div class="space-y-1.5">
								<label for="cargo" class="filter-field-label"><span>Cargo</span></label>
								
									<ReadonlyField value={conductor.cargo} emptyText="Conductor" />
								
							</div>

							<div class="space-y-1.5">
								<label for="fecha_ingreso" class="filter-field-label"
									><span>Fecha de ingreso</span></label
								>
								
									<ReadonlyField value={formatDate(conductor.fecha_ingreso)} />
								
							</div>

							<div class="space-y-1.5">
								<label for="salario_base" class="filter-field-label">
									<span>Salario base <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">COP / mensual</span>
								</label>
								
									<ReadonlyField value={formatSalario(conductor.salario_base)} />
								
								
							</div>

							<div class="space-y-1.5">
								<label for="estado" class="filter-field-label">
									<span>Estado <span style="color:#dc2626">*</span></span>
								</label>
								
									<ReadonlyField value={estadoInfo.label} />
								
							</div>

							<div class="space-y-1.5">
								<label for="sede_trabajo" class="filter-field-label"
									><span>Sede de trabajo</span></label
								>
								
									<ReadonlyField value={getSedeLabel(conductor.sede_trabajo)} />
								
							</div>

							<div class="space-y-1.5">
								<label for="tipo_contrato" class="filter-field-label"
									><span>Tipo de contrato</span></label
								>
								
									<ReadonlyField
										value={TIPOS_CONTRATO.find((t) => t.value === conductor?.tipo_contrato)
											?.label ?? conductor?.tipo_contrato}
										emptyText="Sin contrato definido"
									/>
								
							</div>
						</div>
					{:else if activeTab === 'seguridad'}
						<div
							class="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3"
							in:fade={{ duration: 220 }}
						>
							<div class="space-y-1.5">
								<label for="eps" class="filter-field-label">
									<span>EPS</span>
									<span class="filter-field-label-hint">Salud</span>
								</label>
								
									<ReadonlyField value={conductor.eps} emptyText="Sin EPS" />
								
							</div>

							<div class="space-y-1.5">
								<label for="fondo_pension" class="filter-field-label">
									<span>Fondo de pensión</span>
									<span class="filter-field-label-hint">Ahorro</span>
								</label>
								
									<ReadonlyField value={conductor.fondo_pension} emptyText="Sin fondo" />
								
							</div>

							<div class="space-y-1.5">
								<label for="arl" class="filter-field-label">
									<span>ARL</span>
									<span class="filter-field-label-hint">Riesgos</span>
								</label>
								
									<ReadonlyField value={conductor.arl} emptyText="Sin ARL" />
								
							</div>
						</div>
					{:else if activeTab === 'licencia'}
						<div
							class="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2"
							in:fade={{ duration: 220 }}
						>
							<div class="space-y-1.5">
								<label for="categoria_licencia" class="filter-field-label">
									<span>Categoría</span>
									<span class="filter-field-label-hint">C1, C2, C3…</span>
								</label>
								
									<ReadonlyField value={conductor.categoria_licencia} emptyText="Sin categoría" />
								
							</div>

							<div class="space-y-1.5">
								<label for="vencimiento_licencia" class="filter-field-label">
									<span>Fecha de vencimiento</span>
								</label>
								
									<ReadonlyField value={formatDate(conductor.vencimiento_licencia)} />
								
								
							</div>
						</div>
					{/if}

					
				</div>
			</section>
		</div>
	{/if}
</div>

<!-- ═══ CONFIRMACIÓN DE CAMBIO DE PESTAÑA CON CAMBIOS PENDIENTES ═══ -->


<!-- ═══ CONFIRMACIÓN DE ELIMINAR FOTO ═══ -->
{#if confirmDeletePhoto}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default border-0 p-0"
			style="background: linear-gradient(135deg, rgba(15, 23, 42,0.40), rgba(20, 83, 45,0.55)); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);"
			aria-label="Cerrar"
			on:click={() => (confirmDeletePhoto = false)}
			transition:fade={{ duration: 180 }}
		></button>
		<div
			class="relative w-full max-w-sm"
			style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 20px; box-shadow: 0 24px 64px rgba(0,0,0,0.18);"
			transition:fly={{ y: 12, duration: 240, easing: quintOut }}
		>
			<div class="px-6 pt-5 pb-2">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl"
						style="background: rgba(220,38,38,0.10); color: #b91c1c;"
					>
						<svg
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
					</div>
					<div>
						<h3 class="font-display text-base" style="color: var(--bg-charcoal); font-weight: 800;">
							¿Eliminar la foto?
						</h3>
						<p class="text-xs" style="color: var(--text-muted);">No se puede deshacer.</p>
					</div>
				</div>
			</div>
			<div class="px-6 py-3 text-sm" style="color: var(--text-secondary);">
				Se eliminará la foto de perfil del conductor. Quedará solo con sus iniciales.
			</div>
			<div
				class="flex flex-col-reverse gap-2 px-6 pt-3 pb-5 sm:flex-row sm:justify-end"
				style="border-top: 1px solid var(--border-subtle);"
			>
				<button type="button" class="btn-secondary" on:click={() => (confirmDeletePhoto = false)}>
					Cancelar
				</button>
				<button
					type="button"
					class="btn-danger"
					on:click={handleDeletePhoto}
				>
					Sí, eliminar
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ CROP MODAL ═══ -->
{#if showCropModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="crop-title"
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default border-0 p-0"
			style="background: linear-gradient(135deg, rgba(15, 23, 42,0.55), rgba(20, 83, 45,0.65)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);"
			aria-label="Cerrar"
			on:click={handleCloseCropModal}
			transition:fade={{ duration: 200 }}
		></button>
		<div
			class="relative w-full max-w-2xl overflow-hidden"
			style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 24px 64px rgba(0,0,0,0.20);"
			transition:fly={{ y: 16, duration: 320, easing: quintOut }}
		>
			<div
				class="flex items-center justify-between px-6 pt-5 pb-4"
				style="border-bottom: 1px solid var(--border-subtle);"
			>
				<div>
					<p class="font-mono-meta" style="color: var(--orange-700); font-size: 0.6rem;">
						Foto de perfil
					</p>
					<h3
						id="crop-title"
						class="font-display text-lg"
						style="color: var(--bg-charcoal); font-weight: 800;"
					>
						Recortar imagen
					</h3>
				</div>
				<button
					type="button"
					class="btn-icon"
					aria-label="Cerrar"
					on:click={handleCloseCropModal}
					disabled={isUploadingPhoto}
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div
				class="relative mx-6 mt-5 overflow-hidden rounded-2xl"
				style="height: 360px; background: #0f172a;"
			>
				<Cropper
					image={imageSrc}
					bind:crop
					bind:zoom
					aspect={1}
					cropShape="round"
					showGrid={false}
					oncropcomplete={onCropComplete}
				/>
				{#if photoSuccess}
					<div
						class="pointer-events-none absolute inset-0 flex items-center justify-center"
						style="background: rgba(234, 88, 12,0.45); backdrop-filter: blur(2px);"
						transition:fade={{ duration: 220 }}
					>
						<div
							class="flex h-16 w-16 items-center justify-center rounded-full"
							style="background: white; box-shadow: 0 12px 32px rgba(0,0,0,0.20);"
						>
							<svg
								class="h-8 w-8"
								style="color: var(--orange-600);"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2.4"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</div>
					</div>
				{/if}
			</div>
			<div class="space-y-3 px-6 py-4">
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4 flex-shrink-0"
						style="color: var(--text-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
						/>
					</svg>
					<input
						type="range"
						min="1"
						max="3"
						step="0.1"
						bind:value={zoom}
						class="crop-range w-full"
						aria-label="Zoom"
					/>
					<span class="font-mono-meta" style="color: var(--text-muted); font-size: 0.6rem;">
						{(zoom * 100).toFixed(0)}%
					</span>
				</div>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4 flex-shrink-0"
						style="color: var(--text-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
					<input
						type="range"
						min="0"
						max="360"
						step="1"
						bind:value={rotation}
						class="crop-range w-full"
						aria-label="Rotación"
					/>
					<span class="font-mono-meta" style="color: var(--text-muted); font-size: 0.6rem;">
						{rotation}°
					</span>
				</div>
			</div>
			<div
				class="flex flex-col-reverse gap-2 px-6 pt-3 pb-5 sm:flex-row sm:justify-end"
				style="border-top: 1px solid var(--border-subtle);"
			>
				<button
					type="button"
					class="btn-secondary"
					on:click={handleCloseCropModal}
					disabled={isUploadingPhoto}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="btn-primary"
					on:click={handleUploadCroppedImage}
					disabled={isUploadingPhoto}
				>
					{#if isUploadingPhoto}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
							></path>
						</svg>
						Subiendo…
					{:else}
						<svg
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
							/>
						</svg>
						Subir foto
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Página del conductor ── */
	.cond-pagina {
		width: 100%;
		padding: 1.25rem 1rem 2rem;
	}
	@media (min-width: 640px) {
		.cond-pagina {
			padding: 1.5rem 1.5rem 2.5rem;
		}
	}
	@media (min-width: 1024px) {
		.cond-pagina {
			padding: 1.5rem 2rem 3rem;
		}
	}
	.cond-volver {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.cond-miga {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.cond-miga a {
		color: var(--text-muted);
		text-decoration: none;
	}
	.cond-miga a:hover {
		color: var(--text-primary);
	}
	.cond-miga strong {
		font-weight: 700;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Rejilla: el lateral gana ancho a medida que hay sitio y se queda
	   pegado mientras el expediente hace scroll. */
	.cond-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}
	@media (min-width: 1024px) {
		.cond-grid {
			grid-template-columns: 320px minmax(0, 1fr);
		}
		.cond-aside {
			position: sticky;
			top: 1rem;
			max-height: calc(100dvh - 4rem - 2rem);
			overflow-y: auto;
			scrollbar-width: none;
		}
		.cond-aside::-webkit-scrollbar {
			display: none;
		}
	}
	@media (min-width: 1280px) {
		.cond-grid {
			grid-template-columns: 380px minmax(0, 1fr);
		}
	}
	@media (min-width: 1536px) {
		.cond-grid {
			grid-template-columns: 420px minmax(0, 1fr);
		}
	}
	.cond-aside {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	/* En tableta el lateral va arriba: identidad a lo ancho y las otras dos
	   tarjetas lado a lado. */
	@media (min-width: 768px) and (max-width: 1023.98px) {
		.cond-aside {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.cond-hero {
			grid-column: 1 / -1;
		}
		.cond-hero-cuerpo {
			flex-direction: row;
			text-align: left;
		}
		.cond-identidad {
			align-items: flex-start;
		}
		.cond-pills {
			justify-content: flex-start;
		}
	}
	.cond-main {
		min-width: 0;
	}

	/* ── Tarjeta de identidad ── */
	.cond-hero {
		position: relative;
		border-radius: 24px;
		padding: 1.5rem;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 70%);
		color: #fff;
	}
	.cond-hero-fondo {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border-radius: inherit;
		pointer-events: none;
	}
	.cond-orbe {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.07);
	}
	.cond-orbe--grande {
		width: 240px;
		height: 240px;
		right: -80px;
		top: -110px;
	}
	.cond-orbe--chico {
		width: 110px;
		height: 110px;
		left: -40px;
		bottom: 30px;
	}
	.cond-hero-cuerpo {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
	}
	.cond-foto-wrap {
		position: relative;
		flex-shrink: 0;
	}
	.cond-foto {
		position: relative;
		display: block;
		width: 8.5rem;
		height: 8.5rem;
		overflow: hidden;
		border-radius: 24px;
		border: 3px solid rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.1);
		padding: 0;
		cursor: pointer;
	}
	@media (min-width: 1280px) {
		.cond-foto {
			width: 10rem;
			height: 10rem;
		}
	}
	.cond-foto img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.cond-foto-iniciales {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		font-family: var(--font-display);
		font-size: 2.4rem;
		font-weight: 800;
		color: #fff;
		background: rgba(255, 255, 255, 0.12);
	}
	.cond-foto-velo {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		background: linear-gradient(180deg, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.5) 100%);
		pointer-events: none;
	}
	.cond-foto-cambiar {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.95);
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--au-dark);
	}
	.cond-foto-menu {
		position: absolute;
		top: 100%;
		left: 50%;
		z-index: 30;
		width: 14rem;
		margin-top: 0.5rem;
		transform: translateX(-50%);
	}
	.cond-foto-menu-caja {
		overflow: hidden;
		border-radius: 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14);
		text-align: left;
	}
	.cond-foto-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.65rem 0.85rem;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		cursor: pointer;
	}
	.cond-foto-menu-item:hover {
		background: var(--bg-base);
	}
	.cond-foto-menu-item--peligro {
		color: #b91c1c;
		border-top: 1px solid var(--border-subtle);
	}
	.cond-identidad {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		min-width: 0;
	}
	.cond-eyebrow {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}
	.cond-nombre {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: #fff;
	}
	@media (min-width: 1280px) {
		.cond-nombre {
			font-size: 1.5rem;
		}
	}
	.cond-documento {
		margin: 0;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.72);
	}
	.cond-pills {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.3rem;
		margin-top: 0.5rem;
	}
	.cond-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.22rem 0.65rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		font-size: 0.68rem;
		font-weight: 700;
		color: #fff;
		white-space: nowrap;
	}
	.cond-pill-punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.cond-cifras {
		position: relative;
		z-index: 1;
		display: grid;
		/* El salario es la cifra larga: se lleva más columna para no cortarse. */
		grid-template-columns: 1.45fr 1fr 1fr;
		margin: 1.25rem 0 0;
		padding-top: 1rem;
		border-top: 1px solid rgba(255, 255, 255, 0.14);
	}
	.cond-cifra {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0 0.15rem;
		text-align: center;
	}
	.cond-cifra + .cond-cifra {
		border-left: 1px solid rgba(255, 255, 255, 0.14);
	}
	.cond-cifra dt {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.65);
	}
	.cond-cifra dd {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 800;
		color: #fff;
		white-space: nowrap;
		max-width: 100%;
	}

	/* ── Tarjetas del lateral ── */
	.cond-card {
		padding: 1rem 1.1rem;
	}
	.cond-card-titulo {
		margin: 0 0 0.6rem;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.cond-acciones {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.cond-accion {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.5rem 0.6rem;
		border-radius: 12px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.cond-accion:hover:not(:disabled) {
		border-color: var(--emerald-500);
		background: var(--bg-base);
	}
	.cond-accion:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.cond-accion-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		border-radius: 9px;
		background: var(--au-tint);
		color: var(--emerald-800);
	}
	.cond-accion-icono svg {
		width: 15px;
		height: 15px;
	}
	.cond-accion-texto {
		flex: 1;
		min-width: 0;
	}
	.cond-accion-meta {
		max-width: 45%;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-very-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cond-accion-flecha {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--text-very-muted);
	}
	.cond-licencia {
		border-left: 4px solid var(--emerald-500);
	}
	.cond-licencia--alerta {
		border-left-color: #f59e0b;
	}
	.cond-licencia--vencida {
		border-left-color: #dc2626;
	}
	.cond-licencia-fila {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.cond-licencia-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		border-radius: 10px;
		background: var(--au-tint);
		color: var(--emerald-800);
	}
	.cond-licencia--alerta .cond-licencia-icono {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
	}
	.cond-licencia--vencida .cond-licencia-icono {
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
	}
	.cond-licencia-icono svg {
		width: 16px;
		height: 16px;
	}
	.cond-licencia-fecha {
		margin: 0.15rem 0 0;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.cond-licencia-nota {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--emerald-800);
	}
	.cond-licencia--alerta .cond-licencia-nota {
		color: #b45309;
	}
	.cond-licencia--vencida .cond-licencia-nota {
		color: #b91c1c;
	}

	/* ── Pestañas: en pantallas medias se desplazan en vez de apilarse ── */
	.cond-tabs {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.375rem;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.cond-tabs::-webkit-scrollbar {
		display: none;
	}
	.cond-tab {
		flex-shrink: 0;
	}
	@media (min-width: 1280px) {
		.cond-tabs {
			flex-wrap: wrap;
		}
	}

	.block-input {
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		padding: 0.6rem 0.85rem;
		font-size: 0.875rem;
		font-family: inherit;
		color: var(--text-primary);
		background-color: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		transition: all 0.2s var(--ease-apple);
		box-sizing: border-box;
	}
	.block-input:focus {
		outline: none;
		border-color: var(--orange-500);
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.12);
	}
	.block-input::placeholder {
		color: var(--text-very-muted);
	}
	.block-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.block-input.input-error {
		border-color: rgba(220, 38, 38, 0.45);
		background-color: rgba(220, 38, 38, 0.04);
	}
	.block-input.input-error:focus {
		box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
	}

	select.block-input {
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' fill='none' stroke='%231a1a1a' stroke-width='1.8' viewBox='0 0 24 24'><path stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/></svg>");
		background-repeat: no-repeat;
		background-position: right 0.65rem center;
		background-size: 14px;
		padding-right: 2.1rem;
	}

	.crop-range {
		appearance: none;
		-webkit-appearance: none;
		height: 4px;
		background: rgba(0, 0, 0, 0.08);
		border-radius: 999px;
		outline: none;
	}
	.crop-range::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: linear-gradient(135deg, #ea580c, #c2410c);
		cursor: pointer;
		border: 2px solid white;
		box-shadow: 0 2px 6px rgba(234, 88, 12, 0.4);
	}
	.crop-range::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: linear-gradient(135deg, #ea580c, #c2410c);
		cursor: pointer;
		border: 2px solid white;
		box-shadow: 0 2px 6px rgba(234, 88, 12, 0.4);
	}
</style>
