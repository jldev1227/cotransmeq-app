<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Cropper, { type OnCropCompleteEvent } from 'svelte-easy-crop';
	import { conductoresAPI } from '$lib/api/apiClient';
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
	let isSaving = false;
	let showSuccessAnim = false;
	let error: string | null = null;
	let isEditing = false;
	let activeTab: TabType = 'personal';
	let formErrors: Partial<Record<keyof ConductorForm, string>> = {};
	let attemptedSubmit = false;

	let formData: ConductorForm = emptyForm();
	let savedSnapshot: ConductorForm = emptyForm();

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
	let showDirtyConfirm = false;
	let pendingTab: TabType | null = null;

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
	$: isDirty = JSON.stringify(formData) !== JSON.stringify(savedSnapshot);

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

	function validateForm(data: ConductorForm): Partial<Record<keyof ConductorForm, string>> {
		const errors: Partial<Record<keyof ConductorForm, string>> = {};
		if (!data.nombre.trim()) errors.nombre = 'El nombre es obligatorio';
		if (!data.apellido.trim()) errors.apellido = 'El apellido es obligatorio';
		if (!data.numero_identificacion.trim()) {
			errors.numero_identificacion = 'La identificación es obligatoria';
		}
		if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
			errors.email = 'Formato de email no válido';
		}
		if (data.salario_base && Number.isNaN(parseFloat(data.salario_base))) {
			errors.salario_base = 'Salario no válido';
		}
		if (data.vencimiento_licencia && data.fecha_ingreso) {
			if (new Date(data.vencimiento_licencia) < new Date(data.fecha_ingreso)) {
				errors.vencimiento_licencia = 'Debe ser posterior al ingreso';
			}
		}
		return errors;
	}

	function getInitials(nombre: string, apellido: string): string {
		const n = nombre?.trim().charAt(0) ?? '';
		const a = apellido?.trim().charAt(0) ?? '';
		return `${n}${a}`.toUpperCase() || 'TR';
	}

	function getEstadoPill(tone: string): string {
		const map: Record<string, string> = {
			emerald:
				'background: rgba(249, 115, 22,0.10); color: var(--orange-800); border: 1px solid rgba(249, 115, 22,0.25);',
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
			} else if (showDirtyConfirm) {
				showDirtyConfirm = false;
				pendingTab = null;
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
				savedSnapshot = { ...formData };
			}
		} catch (err: any) {
			const msg = err.response?.data?.message || err.message || 'No se pudo cargar el conductor';
			error = String(msg);
			toast.error(String(msg));
		} finally {
			isLoading = false;
		}
	}

	async function handleSubmit() {
		attemptedSubmit = true;
		formErrors = validateForm(formData);
		if (Object.keys(formErrors).length > 0) {
			const firstTabWithError = firstTabWithErrors(formErrors);
			if (firstTabWithError) activeTab = firstTabWithError;
			toast.error('Revisa los campos marcados antes de guardar');
			return;
		}

		try {
			isSaving = true;
			error = null;
			if (!conductorId) return;

			const payload: Record<string, unknown> = {
				...formData,
				salario_base: formData.salario_base ? parseFloat(formData.salario_base) : null,
				email: formData.email.trim() || null,
				telefono: formData.telefono.trim() || null,
				direccion: formData.direccion.trim() || null,
				eps: formData.eps.trim() || null,
				fondo_pension: formData.fondo_pension.trim() || null,
				arl: formData.arl.trim() || null,
				cargo: formData.cargo.trim() || 'CONDUCTOR',
				fecha_nacimiento: formData.fecha_nacimiento || null,
				fecha_ingreso: formData.fecha_ingreso || null,
				vencimiento_licencia: formData.vencimiento_licencia || null,
				tipo_sangre: formData.tipo_sangre || null,
				genero: formData.genero || null,
				sede_trabajo: formData.sede_trabajo || null,
				tipo_contrato: formData.tipo_contrato || null,
				categoria_licencia: formData.categoria_licencia || null
			};

			await conductoresAPI.update(conductorId, payload);

			showSuccessAnim = true;
			setTimeout(() => {
				showSuccessAnim = false;
			}, 2200);

			isEditing = false;
			attemptedSubmit = false;
			await loadConductor();
			toast.success('Conductor actualizado');
		} catch (err: any) {
			const message = err.response?.data?.message || 'No se pudo actualizar el conductor';
			toast.error(message);
		} finally {
			isSaving = false;
		}
	}

	function firstTabWithErrors(
		errors: Partial<Record<keyof ConductorForm, string>>
	): TabType | null {
		const map: Record<TabType, (keyof ConductorForm)[]> = {
			personal: [
				'nombre',
				'apellido',
				'numero_identificacion',
				'email',
				'telefono',
				'genero',
				'fecha_nacimiento'
			],
			laboral: [
				'cargo',
				'fecha_ingreso',
				'salario_base',
				'estado',
				'sede_trabajo',
				'tipo_contrato'
			],
			seguridad: ['eps', 'fondo_pension', 'arl'],
			licencia: ['categoria_licencia', 'vencimiento_licencia']
		};
		for (const tab of Object.keys(map) as TabType[]) {
			if (map[tab].some((f) => errors[f])) return tab;
		}
		return null;
	}

	function handleCancel() {
		if (isDirty) {
			formData = { ...savedSnapshot };
		}
		formErrors = {};
		attemptedSubmit = false;
		isEditing = false;
	}

	function handleEdit() {
		isEditing = true;
	}

	function requestTabChange(tab: TabType) {
		if (tab === activeTab) return;
		if (isEditing && isDirty && !showDirtyConfirm) {
			pendingTab = tab;
			showDirtyConfirm = true;
			return;
		}
		activeTab = tab;
	}

	function confirmTabChange() {
		if (pendingTab) {
			formData = { ...savedSnapshot };
			formErrors = {};
			attemptedSubmit = false;
			isEditing = false;
			activeTab = pendingTab;
		}
		showDirtyConfirm = false;
		pendingTab = null;
	}

	function cancelTabChange() {
		showDirtyConfirm = false;
		pendingTab = null;
	}

	function fieldError(field: keyof ConductorForm): string | undefined {
		return attemptedSubmit ? formErrors[field] : undefined;
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

<svelte:head>
	<title>{fullName || 'Conductor'} · Perfil — Cotransmeq</title>
</svelte:head>

<div
	class="w-full px-4 py-6 sm:px-6 lg:px-8"
	style="background-color: var(--bg-base);"
>
	<!-- Header -->
	<div
		class="page-card mb-6"
		style="padding: 1.1rem 1.5rem;"
		in:fly={{ y: -16, duration: 480, easing: quintOut }}
	>
		<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex items-center gap-3">
				<button
					type="button"
					class="btn-icon"
					aria-label="Volver al listado"
					on:click={() => goto('/dashboard/conductores')}
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
					</svg>
				</button>
				<div>
					<p class="eyebrow mb-1">Perfil del conductor</p>
					<h1 class="font-display text-2xl" style="color: var(--bg-charcoal); font-weight: 500;">
						{fullName || 'Cargando…'}
					</h1>
					<p class="mt-0.5 text-sm" style="color: var(--text-muted);">
						Expediente individual, fotografía y datos del conductor.
					</p>
				</div>
			</div>

			{#if conductor}
				<div class="flex flex-wrap items-center gap-2">
					<span class="code-badge">ID · {conductor.numero_identificacion || '—'}</span>
					<span class="status-pill" style={getEstadoPill(estadoInfo.tone)}>
						<span
							class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
							style="background: currentColor;"
						></span>
						{estadoInfo.label}
					</span>
				</div>
			{/if}
		</div>
	</div>

	{#if isLoading}
		<div class="page-card flex items-center justify-center gap-3 py-16" in:fade={{ duration: 320 }}>
			<div class="spinner"></div>
			<p class="text-sm" style="color: var(--text-muted);">Cargando conductor…</p>
		</div>
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
			<h2 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
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
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
			<!-- ═══ PERFIL RESUMEN (columna izquierda) ═══ -->
			<aside class="space-y-4" in:fly={{ y: 16, duration: 480, easing: quintOut, delay: 60 }}>
				<!-- Tarjeta identidad -->
				<section class="page-card" style="padding: 1.5rem;">
					<div class="flex flex-col items-center text-center">
						<div class="photo-menu-wrapper relative">
							<button
								type="button"
								class="group relative overflow-hidden rounded-2xl"
								style="width: 128px; height: 128px;"
								aria-label="Cambiar foto de perfil"
								on:click={() => (showPhotoMenu = !showPhotoMenu)}
							>
								{#if conductor.foto_signed_url}
									<img
										src={conductor.foto_signed_url}
										alt={fullName}
										class="h-full w-full object-cover"
									/>
								{:else}
									<div
										class="brand-gradient flex h-full w-full items-center justify-center font-display text-3xl text-white"
										style="font-weight: 500;"
									>
										{getInitials(conductor.nombre, conductor.apellido)}
									</div>
								{/if}
								<div
									class="pointer-events-none absolute inset-0 flex items-end justify-center"
									style="background: linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.45) 100%);"
								>
									<span
										class="mb-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold"
										style="color: var(--orange-700);"
									>
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
								<div
									class="absolute top-full left-1/2 z-30 mt-2 w-56 -translate-x-1/2"
									role="menu"
									transition:fly={{ y: -6, duration: 200 }}
								>
									<div
										class="overflow-hidden rounded-xl"
										style="background: var(--bg-surface); border: 1px solid var(--border-subtle); box-shadow: 0 12px 32px rgba(0,0,0,0.10);"
									>
										<label
											class="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-medium hover:bg-orange-50/40"
											style="color: var(--text-primary);"
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
												class="flex w-full items-center gap-2 border-t px-3 py-2.5 text-sm font-medium"
												style="color: #b91c1c; border-color: var(--border-subtle);"
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

						<h2
							class="mt-4 font-display text-xl"
							style="color: var(--bg-charcoal); font-weight: 500;"
						>
							{conductor.nombre}
							{conductor.apellido}
						</h2>
						<p class="mt-0.5 text-sm" style="color: var(--text-muted);">
							{conductor.cargo || 'Conductor'}
						</p>

						<div class="mt-3 flex flex-wrap items-center justify-center gap-1.5">
							<span class="status-pill" style={getEstadoPill(estadoInfo.tone)}>
								<span
									class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
									style="background: currentColor;"
								></span>
								{estadoInfo.label}
							</span>
							<span
								class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold"
								style="background: rgba(249, 115, 22,0.08); color: var(--orange-800);"
							>
								{conductor.sede_trabajo ? getSedeLabel(conductor.sede_trabajo) : 'Sin sede'}
							</span>
						</div>

						<div
							class="mt-5 grid w-full grid-cols-3 gap-2"
							style="border-top: 1px solid var(--border-subtle); padding-top: 1rem;"
						>
							<div class="text-center">
								<p class="font-mono-meta" style="color: var(--text-muted); font-size: 0.6rem;">
									Salario
								</p>
								<p
									class="mt-0.5 font-display text-base"
									style="color: var(--bg-charcoal); font-weight: 500;"
								>
									{formatSalario(conductor.salario_base)}
								</p>
							</div>
							<div
								class="text-center"
								style="border-left: 1px solid var(--border-subtle); border-right: 1px solid var(--border-subtle);"
							>
								<p class="font-mono-meta" style="color: var(--text-muted); font-size: 0.6rem;">
									Ingreso
								</p>
								<p
									class="mt-0.5 font-display text-sm"
									style="color: var(--bg-charcoal); font-weight: 500;"
								>
									{conductor.fecha_ingreso
										? formatDate(conductor.fecha_ingreso).split(' de ')[2]
										: '—'}
								</p>
							</div>
							<div class="text-center">
								<p class="font-mono-meta" style="color: var(--text-muted); font-size: 0.6rem;">
									Sangre
								</p>
								<p
									class="mt-0.5 font-display text-base"
									style="color: var(--bg-charcoal); font-weight: 500;"
								>
									{getSangreLabel(conductor.tipo_sangre)}
								</p>
							</div>
						</div>
					</div>
				</section>

				<!-- Tarjeta acciones rápidas -->
				<section class="page-card" style="padding: 1.1rem 1.25rem;">
					<p class="font-mono-meta mb-3" style="color: var(--text-muted); font-size: 0.6rem;">
						Acciones rápidas
					</p>
					<div class="grid grid-cols-1 gap-2">
						<button
							type="button"
							class="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium"
							style="background: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary);"
							on:click={() =>
								goto(`/dashboard/conductores?vista=calendario&conductor=${conductor!.id}`)}
						>
							<span class="flex items-center gap-2">
								<svg
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									style="color: var(--orange-500);"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
									/>
								</svg>
								Ver recorridos
							</span>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
								style="color: var(--text-very-muted);"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</button>
						<button
							type="button"
							class="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium"
							style="background: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary);"
							disabled={!conductor?.email}
							on:click={() =>
								conductor?.email && (window.location.href = `mailto:${conductor.email}`)}
						>
							<span class="flex items-center gap-2">
								<svg
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									style="color: var(--orange-500);"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
									/>
								</svg>
								Enviar correo
							</span>
							<span
								class="font-mono-meta"
								style="color: var(--text-very-muted); font-size: 0.6rem;"
							>
								{conductor.email ? 'Listo' : 'No registrado'}
							</span>
						</button>
						<button
							type="button"
							class="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium"
							style="background: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary);"
							disabled={!conductor?.telefono}
							on:click={() =>
								conductor?.telefono && (window.location.href = `tel:${conductor.telefono}`)}
						>
							<span class="flex items-center gap-2">
								<svg
									class="h-4 w-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="1.8"
									style="color: var(--orange-500);"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21L6.374 11.5l8.25 8.25 2.113-3.85a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V20.72a2 2 0 01-2 2h-1.28C10.5 22.72 1.28 13.5 1.28 2.72V1.44a2 2 0 012-2H6.5z"
									/>
								</svg>
								Llamar
							</span>
							<span
								class="font-mono-meta"
								style="color: var(--text-very-muted); font-size: 0.6rem;"
							>
								{conductor.telefono || 'No registrado'}
							</span>
						</button>
					</div>
				</section>

				<!-- Tarjeta licencia -->
				{#if conductor.vencimiento_licencia}
					{@const dias = daysUntil(conductor.vencimiento_licencia)}
					<section
						class="page-card"
						style={`padding: 1rem 1.25rem; border-left: 4px solid ${dias !== null && dias < 30 ? '#f59e0b' : 'var(--orange-500)'};`}
					>
						<div class="flex items-start gap-3">
							<div
								class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
								style={`background: ${dias !== null && dias < 30 ? 'rgba(245,158,11,0.10)' : 'rgba(249, 115, 22,0.08)'}; color: ${dias !== null && dias < 30 ? '#b45309' : 'var(--orange-700)'};`}
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
										d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<p class="font-mono-meta" style="color: var(--text-muted); font-size: 0.6rem;">
									Licencia {conductor.categoria_licencia || '—'}
								</p>
								<p class="mt-0.5 text-sm font-semibold" style="color: var(--bg-charcoal);">
									{formatDate(conductor.vencimiento_licencia)}
								</p>
								{#if dias !== null}
									{#if dias < 0}
										<p class="mt-1 text-xs" style="color: #b91c1c;">
											Vencida hace {Math.abs(dias)} días
										</p>
									{:else if dias < 30}
										<p class="mt-1 text-xs" style="color: #b45309;">
											Vence en {dias}
											{dias === 1 ? 'día' : 'días'}
										</p>
									{:else}
										<p class="mt-1 text-xs" style="color: var(--orange-700);">
											Vigente · {dias} días restantes
										</p>
									{/if}
								{/if}
							</div>
						</div>
					</section>
				{/if}
			</aside>

			<!-- ═══ CONTENIDO PRINCIPAL (columna derecha) ═══ -->
			<section class="space-y-5" in:fly={{ y: 16, duration: 480, easing: quintOut, delay: 120 }}>
				<!-- Barra de acciones de edición -->
				<div
					class="page-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
					style="padding: 1rem 1.25rem;"
				>
					<div>
						<p class="font-display text-base" style="color: var(--bg-charcoal); font-weight: 500;">
							Expediente
						</p>
						<p class="text-xs" style="color: var(--text-muted);">
							{isEditing
								? 'Editando — recuerda guardar al terminar.'
								: 'Vista de solo lectura. Activa la edición para modificar los datos.'}
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						{#if isEditing}
							{#if isDirty}
								<span
									class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold"
									style="background: rgba(245,158,11,0.10); color: #b45309; border: 1px solid rgba(245,158,11,0.25);"
								>
									<span class="h-1.5 w-1.5 rounded-full" style="background: #f59e0b;"></span>
									Cambios sin guardar
								</span>
							{/if}
							<button
								type="button"
								class="btn-secondary"
								on:click={handleCancel}
								disabled={isSaving}
							>
								Cancelar
							</button>
							<button type="button" class="btn-primary" on:click={handleSubmit} disabled={isSaving}>
								{#if isSaving}
									<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
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
											d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
										></path>
									</svg>
									Guardando…
								{:else}
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="1.8"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
									</svg>
									Guardar cambios
								{/if}
							</button>
						{:else}
							<button type="button" class="btn-primary" on:click={handleEdit}>
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
						{/if}
					</div>
				</div>

				<!-- Tabs -->
				<div class="page-card" style="padding: 0.65rem 0.65rem;">
					<div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Secciones del conductor">
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
								class="group inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all"
								style={`background: ${isActive ? 'linear-gradient(135deg, rgba(249, 115, 22,0.10), rgba(234, 88, 12,0.10))' : 'transparent'}; color: ${isActive ? 'var(--orange-800)' : 'var(--text-secondary)'}; border: 1px solid ${isActive ? 'rgba(249, 115, 22,0.25)' : 'transparent'};`}
								on:click={() => requestTabChange(tab.id)}
							>
								<span
									class="flex h-6 w-6 items-center justify-center rounded-md"
									style={`background: ${isActive ? 'linear-gradient(135deg, #f97316, #ea580c)' : 'rgba(249, 115, 22,0.08)'}; color: ${isActive ? 'white' : 'var(--orange-700)'};`}
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
									style={`background: ${pct === 100 ? 'rgba(249, 115, 22,0.12)' : 'rgba(0,0,0,0.04)'}; color: ${pct === 100 ? 'var(--orange-800)' : 'var(--text-muted)'};`}
								>
									{completion.done}/{completion.total}
								</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Form -->
				<form class="page-card" style="padding: 1.5rem;" on:submit|preventDefault={handleSubmit}>
					<div class="mb-5 flex flex-col gap-1">
						<p class="font-mono-meta" style="color: var(--orange-700); font-size: 0.6rem;">
							Sección activa
						</p>
						<h2 class="font-display text-lg" style="color: var(--bg-charcoal); font-weight: 500;">
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
								{#if isEditing}
									<input
										id="nombre"
										type="text"
										bind:value={formData.nombre}
										placeholder="Juan"
										class="block-input"
										class:input-error={fieldError('nombre')}
									/>
								{:else}
									<ReadonlyField value={conductor.nombre} />
								{/if}
								{#if fieldError('nombre')}
									<p class="text-xs" style="color:#b91c1c">{fieldError('nombre')}</p>
								{/if}
							</div>

							<!-- Apellido -->
							<div class="space-y-1.5">
								<label for="apellido" class="filter-field-label">
									<span>Apellido <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">Requerido</span>
								</label>
								{#if isEditing}
									<input
										id="apellido"
										type="text"
										bind:value={formData.apellido}
										placeholder="Pérez"
										class="block-input"
										class:input-error={fieldError('apellido')}
									/>
								{:else}
									<ReadonlyField value={conductor.apellido} />
								{/if}
								{#if fieldError('apellido')}
									<p class="text-xs" style="color:#b91c1c">{fieldError('apellido')}</p>
								{/if}
							</div>

							<!-- Tipo ID -->
							<div class="space-y-1.5">
								<label for="tipo_identificacion" class="filter-field-label">
									<span>Tipo de identificación</span>
								</label>
								{#if isEditing}
									<select
										id="tipo_identificacion"
										bind:value={formData.tipo_identificacion}
										class="block-input"
									>
										{#each TIPOS_ID as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField
										value={TIPOS_ID.find((t) => t.value === conductor?.tipo_identificacion)
											?.label ?? conductor?.tipo_identificacion}
									/>
								{/if}
							</div>

							<!-- Número ID -->
							<div class="space-y-1.5">
								<label for="numero_identificacion" class="filter-field-label">
									<span>Número de identificación <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">Único</span>
								</label>
								{#if isEditing}
									<input
										id="numero_identificacion"
										type="text"
										bind:value={formData.numero_identificacion}
										placeholder="1234567890"
										class="block-input font-mono-meta"
										style="letter-spacing: 0.04em;"
										class:input-error={fieldError('numero_identificacion')}
									/>
								{:else}
									<ReadonlyField value={conductor.numero_identificacion} mono />
								{/if}
								{#if fieldError('numero_identificacion')}
									<p class="text-xs" style="color:#b91c1c">{fieldError('numero_identificacion')}</p>
								{/if}
							</div>

							<!-- Email -->
							<div class="space-y-1.5">
								<label for="email" class="filter-field-label">
									<span>Email</span>
								</label>
								{#if isEditing}
									<input
										id="email"
										type="email"
										bind:value={formData.email}
										placeholder="juan.perez@email.com"
										class="block-input"
										class:input-error={fieldError('email')}
									/>
								{:else}
									<ReadonlyField value={conductor.email} emptyText="Sin email" />
								{/if}
								{#if fieldError('email')}
									<p class="text-xs" style="color:#b91c1c">{fieldError('email')}</p>
								{/if}
							</div>

							<!-- Teléfono -->
							<div class="space-y-1.5">
								<label for="telefono" class="filter-field-label">
									<span>Teléfono</span>
								</label>
								{#if isEditing}
									<input
										id="telefono"
										type="tel"
										bind:value={formData.telefono}
										placeholder="310 123 4567"
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={conductor.telefono} emptyText="Sin teléfono" />
								{/if}
							</div>

							<!-- Fecha nacimiento -->
							<div class="space-y-1.5">
								<label for="fecha_nacimiento" class="filter-field-label">
									<span>Fecha de nacimiento</span>
								</label>
								{#if isEditing}
									<input
										id="fecha_nacimiento"
										type="date"
										bind:value={formData.fecha_nacimiento}
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={formatDate(conductor.fecha_nacimiento)} />
								{/if}
							</div>

							<!-- Género -->
							<div class="space-y-1.5">
								<label for="genero" class="filter-field-label">
									<span>Género</span>
								</label>
								{#if isEditing}
									<select id="genero" bind:value={formData.genero} class="block-input">
										{#each GENEROS as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField value={getGeneroLabel(conductor.genero)} />
								{/if}
							</div>

							<!-- Tipo de sangre -->
							<div class="space-y-1.5">
								<label for="tipo_sangre" class="filter-field-label">
									<span>Tipo de sangre</span>
								</label>
								{#if isEditing}
									<select id="tipo_sangre" bind:value={formData.tipo_sangre} class="block-input">
										{#each TIPOS_SANGRE as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField value={getSangreLabel(conductor.tipo_sangre)} />
								{/if}
							</div>

							<!-- Dirección -->
							<div class="space-y-1.5 md:col-span-2">
								<label for="direccion" class="filter-field-label">
									<span>Dirección</span>
								</label>
								{#if isEditing}
									<input
										id="direccion"
										type="text"
										bind:value={formData.direccion}
										placeholder="Calle 123 # 45-67"
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={conductor.direccion} emptyText="Sin dirección registrada" />
								{/if}
							</div>
						</div>
					{:else if activeTab === 'laboral'}
						<div
							class="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2"
							in:fade={{ duration: 220 }}
						>
							<div class="space-y-1.5">
								<label for="cargo" class="filter-field-label"><span>Cargo</span></label>
								{#if isEditing}
									<input
										id="cargo"
										type="text"
										bind:value={formData.cargo}
										placeholder="CONDUCTOR"
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={conductor.cargo} emptyText="Conductor" />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="fecha_ingreso" class="filter-field-label"
									><span>Fecha de ingreso</span></label
								>
								{#if isEditing}
									<input
										id="fecha_ingreso"
										type="date"
										bind:value={formData.fecha_ingreso}
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={formatDate(conductor.fecha_ingreso)} />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="salario_base" class="filter-field-label">
									<span>Salario base <span style="color:#dc2626">*</span></span>
									<span class="filter-field-label-hint">COP / mensual</span>
								</label>
								{#if isEditing}
									<input
										id="salario_base"
										type="number"
										step="0.01"
										bind:value={formData.salario_base}
										placeholder="1500000"
										class="block-input"
										class:input-error={fieldError('salario_base')}
									/>
								{:else}
									<ReadonlyField value={formatSalario(conductor.salario_base)} />
								{/if}
								{#if fieldError('salario_base')}
									<p class="text-xs" style="color:#b91c1c">{fieldError('salario_base')}</p>
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="estado" class="filter-field-label">
									<span>Estado <span style="color:#dc2626">*</span></span>
								</label>
								{#if isEditing}
									<select id="estado" bind:value={formData.estado} class="block-input">
										{#each ESTADOS as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField value={estadoInfo.label} />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="sede_trabajo" class="filter-field-label"
									><span>Sede de trabajo</span></label
								>
								{#if isEditing}
									<select id="sede_trabajo" bind:value={formData.sede_trabajo} class="block-input">
										{#each SEDES as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField value={getSedeLabel(conductor.sede_trabajo)} />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="tipo_contrato" class="filter-field-label"
									><span>Tipo de contrato</span></label
								>
								{#if isEditing}
									<select
										id="tipo_contrato"
										bind:value={formData.tipo_contrato}
										class="block-input"
									>
										{#each TIPOS_CONTRATO as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField
										value={TIPOS_CONTRATO.find((t) => t.value === conductor?.tipo_contrato)
											?.label ?? conductor?.tipo_contrato}
										emptyText="Sin contrato definido"
									/>
								{/if}
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
								{#if isEditing}
									<input
										id="eps"
										type="text"
										bind:value={formData.eps}
										placeholder="Sanitas"
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={conductor.eps} emptyText="Sin EPS" />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="fondo_pension" class="filter-field-label">
									<span>Fondo de pensión</span>
									<span class="filter-field-label-hint">Ahorro</span>
								</label>
								{#if isEditing}
									<input
										id="fondo_pension"
										type="text"
										bind:value={formData.fondo_pension}
										placeholder="Porvenir"
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={conductor.fondo_pension} emptyText="Sin fondo" />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="arl" class="filter-field-label">
									<span>ARL</span>
									<span class="filter-field-label-hint">Riesgos</span>
								</label>
								{#if isEditing}
									<input
										id="arl"
										type="text"
										bind:value={formData.arl}
										placeholder="Sura"
										class="block-input"
									/>
								{:else}
									<ReadonlyField value={conductor.arl} emptyText="Sin ARL" />
								{/if}
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
								{#if isEditing}
									<select
										id="categoria_licencia"
										bind:value={formData.categoria_licencia}
										class="block-input"
									>
										{#each CATEGORIAS_LICENCIA as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<ReadonlyField value={conductor.categoria_licencia} emptyText="Sin categoría" />
								{/if}
							</div>

							<div class="space-y-1.5">
								<label for="vencimiento_licencia" class="filter-field-label">
									<span>Fecha de vencimiento</span>
								</label>
								{#if isEditing}
									<input
										id="vencimiento_licencia"
										type="date"
										bind:value={formData.vencimiento_licencia}
										class="block-input"
										class:input-error={fieldError('vencimiento_licencia')}
									/>
								{:else}
									<ReadonlyField value={formatDate(conductor.vencimiento_licencia)} />
								{/if}
								{#if fieldError('vencimiento_licencia')}
									<p class="text-xs" style="color:#b91c1c">{fieldError('vencimiento_licencia')}</p>
								{/if}
							</div>
						</div>
					{/if}

					{#if isEditing}
						<div
							class="mt-6 flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between"
							style="border-top: 1px solid var(--border-subtle);"
						>
							<p class="text-xs" style="color: var(--text-muted);">
								Los cambios se aplicarán al guardar. Puedes cancelar en cualquier momento.
							</p>
							<div class="flex gap-2 sm:justify-end">
								<button
									type="button"
									class="btn-secondary"
									on:click={handleCancel}
									disabled={isSaving}
								>
									Cancelar
								</button>
								<button type="submit" class="btn-primary" disabled={isSaving}>
									{#if isSaving}
										<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
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
												d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
											></path>
										</svg>
										Guardando…
									{:else}
										<svg
											class="h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="1.8"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
										Guardar cambios
									{/if}
								</button>
							</div>
						</div>
					{/if}
				</form>
			</section>
		</div>
	{/if}
</div>

<!-- ═══ CONFIRMACIÓN DE CAMBIO DE PESTAÑA CON CAMBIOS PENDIENTES ═══ -->
{#if showDirtyConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default border-0 p-0"
			style="background: linear-gradient(135deg, rgba(15,31,26,0.40), rgba(10,20,16,0.55)); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);"
			aria-label="Cerrar"
			on:click={cancelTabChange}
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
						style="background: rgba(245,158,11,0.10); color: #b45309;"
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
								d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
							/>
						</svg>
					</div>
					<div>
						<h3 class="font-display text-base" style="color: var(--bg-charcoal); font-weight: 500;">
							Cambios sin guardar
						</h3>
						<p class="text-xs" style="color: var(--text-muted);">
							Perderás los cambios en esta sección.
						</p>
					</div>
				</div>
			</div>
			<div class="px-6 py-3 text-sm" style="color: var(--text-secondary);">
				¿Deseas continuar y descartar los cambios pendientes?
			</div>
			<div
				class="flex flex-col-reverse gap-2 px-6 pt-3 pb-5 sm:flex-row sm:justify-end"
				style="border-top: 1px solid var(--border-subtle);"
			>
				<button type="button" class="btn-secondary" on:click={cancelTabChange}
					>Seguir editando</button
				>
				<button
					type="button"
					class="btn-primary"
					style="background: linear-gradient(135deg, #d97706, #b45309); box-shadow: 0 4px 16px rgba(245,158,11,0.30);"
					on:click={confirmTabChange}
				>
					Descartar y cambiar
				</button>
			</div>
		</div>
	</div>
{/if}

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
			style="background: linear-gradient(135deg, rgba(15,31,26,0.40), rgba(10,20,16,0.55)); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);"
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
						<h3 class="font-display text-base" style="color: var(--bg-charcoal); font-weight: 500;">
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
					class="btn-primary"
					style="background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 4px 16px rgba(220,38,38,0.30);"
					on:click={handleDeletePhoto}
				>
					Sí, eliminar
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ OVERLAY ÉXITO ═══ -->
{#if showSuccessAnim}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center"
		style="background: linear-gradient(135deg, rgba(234, 88, 12,0.92), rgba(249, 115, 22,0.92)); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);"
		role="status"
		aria-live="polite"
		transition:fade={{ duration: 200 }}
	>
		<div class="text-center" in:fly={{ y: 12, duration: 380, easing: quintOut }}>
			<div
				class="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full"
				style="background: rgba(255,255,255,0.20); box-shadow: 0 0 60px rgba(255,255,255,0.25);"
			>
				<svg
					class="h-12 w-12 text-white"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2.4"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			</div>
			<h2
				class="font-display text-3xl text-white"
				style="font-weight: 500; letter-spacing: -0.01em;"
			>
				¡Actualizado!
			</h2>
			<p class="mt-1 text-base text-orange-50" style="opacity: 0.92;">
				Los cambios se guardaron correctamente
			</p>
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
			style="background: linear-gradient(135deg, rgba(15,31,26,0.55), rgba(10,20,16,0.65)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);"
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
						style="color: var(--bg-charcoal); font-weight: 500;"
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
						style="background: rgba(249, 115, 22,0.45); backdrop-filter: blur(2px);"
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
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12);
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
		background: linear-gradient(135deg, #f97316, #ea580c);
		cursor: pointer;
		border: 2px solid white;
		box-shadow: 0 2px 6px rgba(249, 115, 22, 0.4);
	}
	.crop-range::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: linear-gradient(135deg, #f97316, #ea580c);
		cursor: pointer;
		border: 2px solid white;
		box-shadow: 0 2px 6px rgba(249, 115, 22, 0.4);
	}
</style>
