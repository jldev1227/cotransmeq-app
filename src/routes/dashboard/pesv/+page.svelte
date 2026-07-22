<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast';
	import { socketUtils } from '$lib/socket';
	import Select from 'svelte-select';
	import {
		obtenerDashboardPesv,
		obtenerOpcionesPesv,
		crearOActualizarExceso,
		eliminarExceso,
		obtenerExcesos,
		crearOActualizarPreoperacional,
		eliminarPreoperacional,
		obtenerPreoperacionales,
		obtenerRegistrosDiarios,
		actualizarRegistroDiaPesv
	} from '$lib/api/pesv';
	import {
		listarActividadesPesv,
		crearActividadPesv,
		actualizarActividadPesv,
		eliminarActividadPesv,
		obtenerSiguienteNumero,
		obtenerEstadisticasPesv
	} from '$lib/api/actividadesPesv';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import type {
		PesvDashboardData,
		PesvFilterOptions,
		ExcesoVelocidad,
		Preoperacional,
		ChartItem,
		RegistroDiarioPesv
	} from '$lib/types/pesv';
	import type {
		ActividadPesv,
		ActividadPesvFormData,
		ActividadPesvEstado,
		ActividadPesvPrioridad,
		ActividadPesvFrecuencia,
		ActividadPesvEstadisticas
	} from '$lib/types/actividadesPesv';

	// Chart.js
	import { Chart, registerables } from 'chart.js';
	import { Bar } from 'svelte-chartjs';
	Chart.register(...registerables);

	// ==================== STATE ====================
	let loading = true;
	let dashboardData: PesvDashboardData | null = null;
	let filterOptions: PesvFilterOptions | null = null;

	// View toggle: 'dashboard' | 'tabla' | 'actividades'
	let vistaActiva: 'dashboard' | 'tabla' | 'actividades' = 'dashboard';

	// Table state
	let registrosDiarios: RegistroDiarioPesv[] = [];
	let loadingRegistros = false;
	let tablaFiltros = { conductor_id: '', vehiculo_id: '', cliente_id: '' };
	let searchText = '';

	// Autocomplete search state
	let conductorSearch = '';
	let placaSearch = '';
	let clienteSearch = '';
	let conductorDropdownOpen = false;
	let placaDropdownOpen = false;
	let clienteDropdownOpen = false;
	let conductorLabel = '';
	let placaLabel = '';
	let clienteLabel = '';

	// Edit modal
	let mostrarModalEdicion = false;
	let editingRegistro: RegistroDiarioPesv | null = null;
	let editForm = {
		horas_sueno: null as number | null,
		excesos_velocidad_dia: 0,
		siniestros: 0,
		siniestros_detalle: '' as string
	};
	let savingEdit = false;

	// Pagination
	let currentPage = 1;
	const pageSize = 25;

	// Filters
	const currentDate = new Date();
	let selectedMes = currentDate.getMonth() + 1;
	let selectedAnio = currentDate.getFullYear();

	const meses = [
		{ value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' },
		{ value: 3, label: 'Marzo' }, { value: 4, label: 'Abril' },
		{ value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' },
		{ value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },
		{ value: 9, label: 'Septiembre' }, { value: 10, label: 'Octubre' },
		{ value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
	];
	const anios = Array.from({ length: 5 }, (_, i) => {
		const y = currentDate.getFullYear() - i;
		return { value: y, label: y.toString() };
	});

	// Modal states
	let mostrarModalExceso = false;
	let mostrarModalPreop = false;
	let excesosList: ExcesoVelocidad[] = [];
	let preopList: Preoperacional[] = [];

	// Exceso form
	let excesoForm = {
		conductor_id: '',
		vehiculo_id: '',
		mes: currentDate.getMonth() + 1,
		anio: currentDate.getFullYear(),
		cantidad: 0,
		observaciones: ''
	};

	// Preoperacional form
	let preopForm = {
		conductor_id: '',
		vehiculo_id: '',
		fecha: new Date().toISOString().split('T')[0],
		realizado: true,
		observaciones: ''
	};

	// ==================== CHART COLORS ====================
	const chartColors = [
		'#ea580c', '#f97316', '#34d399', '#6ee7b7', '#a7f3d0',
		'#047857', '#065f46', '#064e3b', '#0d9488', '#14b8a6'
	];
	const chartBorderColors = [
		'#047857', '#ea580c', '#f97316', '#34d399', '#6ee7b7',
		'#065f46', '#064e3b', '#022c22', '#0f766e', '#0d9488'
	];

	// ==================== ACTIVIDADES STATE ====================
	let actLoading = false;
	let actActividades: ActividadPesv[] = [];
	let actTotal = 0;
	let actTotalPages = 1;
	let actCurrentPage = 1;
	let actUsuarios: Usuario[] = [];
	let actEstadisticas: ActividadPesvEstadisticas | null = null;
	let actVistaInterna: 'listado' | 'calendario' = 'listado';
	let actFiltroAnio = new Date().getFullYear();
	let actFiltroEstado = '';
	let actFiltroPrioridad = '';
	let actFiltroFrecuencia = '';
	let actFiltroSearch = '';
	let actSearchTimeout: ReturnType<typeof setTimeout>;
	let actShowModal = false;
	let actModalMode: 'crear' | 'editar' | 'ver' = 'crear';
	let actEditingId: string | null = null;
	let actSaving = false;
	let actForm: ActividadPesvFormData = getEmptyActForm();
	let actShowDeleteModal = false;
	let actDeletingId: string | null = null;
	let actDeletingName = '';
	let actDeleting = false;
	let actCalMes = new Date().getMonth();
	let actCalAnio = new Date().getFullYear();
	let actDataLoaded = false;

	const ACT_ESTADOS: { value: ActividadPesvEstado; label: string; color: string; bg: string }[] = [
		{ value: 'PENDIENTE', label: 'Pendiente', color: 'text-yellow-700', bg: 'bg-yellow-100' },
		{ value: 'EN_PROGRESO', label: 'En Progreso', color: 'text-blue-700', bg: 'bg-blue-100' },
		{ value: 'COMPLETADA', label: 'Completada', color: 'text-orange-700', bg: 'bg-orange-100' },
		{ value: 'VENCIDA', label: 'Vencida', color: 'text-red-700', bg: 'bg-red-100' },
		{ value: 'CANCELADA', label: 'Cancelada', color: 'text-gray-700', bg: 'bg-gray-100' }
	];
	const ACT_PRIORIDADES: { value: ActividadPesvPrioridad; label: string; color: string; bg: string }[] = [
		{ value: 'BAJA', label: 'Baja', color: 'text-gray-600', bg: 'bg-gray-100' },
		{ value: 'MEDIA', label: 'Media', color: 'text-blue-600', bg: 'bg-blue-100' },
		{ value: 'ALTA', label: 'Alta', color: 'text-orange-600', bg: 'bg-orange-100' },
		{ value: 'CRITICA', label: 'Crítica', color: 'text-red-600', bg: 'bg-red-100' }
	];
	const ACT_FRECUENCIAS: { value: ActividadPesvFrecuencia; label: string }[] = [
		{ value: 'UNICA', label: 'Única' },
		{ value: 'DIARIA', label: 'Diaria' },
		{ value: 'SEMANAL', label: 'Semanal' },
		{ value: 'QUINCENAL', label: 'Quincenal' },
		{ value: 'MENSUAL', label: 'Mensual' },
		{ value: 'BIMESTRAL', label: 'Bimestral' },
		{ value: 'TRIMESTRAL', label: 'Trimestral' },
		{ value: 'SEMESTRAL', label: 'Semestral' },
		{ value: 'ANUAL', label: 'Anual' }
	];
	const ACT_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

	function getEmptyActForm(): ActividadPesvFormData {
		return {
			numero: 1,
			unidad_programa: '',
			actividad: '',
			alcance: '',
			recursos: '',
			responsable_planeacion: '',
			metodo_seguimiento: '',
			frecuencia: 'ANUAL',
			fecha_limite: '',
			responsable_ejecucion_id: '',
			estado: 'PENDIENTE',
			prioridad: 'BAJA',
			fecha_ejecucion: '',
			observacion: '',
			anio: new Date().getFullYear()
		};
	}

	// ==================== CHART DATA BUILDERS ====================
	function buildBarChartData(items: ChartItem[], label: string, maxItems = 8) {
		const sliced = items.slice(0, maxItems);
		return {
			labels: sliced.map(i => truncateLabel(i.label, 18)),
			datasets: [{
				label,
				data: sliced.map(i => i.value),
				backgroundColor: chartColors.slice(0, sliced.length),
				borderColor: chartBorderColors.slice(0, sliced.length),
				borderWidth: 1,
				borderRadius: 8,
				barPercentage: 0.7,
			}]
		};
	}

	function buildHorizontalBarData(items: ChartItem[], label: string, maxItems = 8) {
		const sliced = items.slice(0, maxItems);
		return {
			labels: sliced.map(i => truncateLabel(i.label, 22)),
			datasets: [{
				label,
				data: sliced.map(i => i.value),
				backgroundColor: chartColors.slice(0, sliced.length),
				borderColor: chartBorderColors.slice(0, sliced.length),
				borderWidth: 1,
				borderRadius: 6,
				barPercentage: 0.65,
			}]
		};
	}

	function truncateLabel(label: string, maxLen: number) {
		return label.length > maxLen ? label.substring(0, maxLen) + '…' : label;
	}

	// Chart options
	const barOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: { display: false },
			tooltip: {
				backgroundColor: 'rgba(0,0,0,0.8)',
				titleFont: { size: 13 },
				bodyFont: { size: 12 },
				padding: 12,
				cornerRadius: 8,
			}
		},
		scales: {
			y: {
				beginAtZero: true,
				ticks: { precision: 0, font: { size: 11 } },
				grid: { color: 'rgba(0,0,0,0.05)' }
			},
			x: {
				ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 0 },
				grid: { display: false }
			}
		}
	};

	const horizontalBarOptions = {
		responsive: true,
		maintainAspectRatio: false,
		indexAxis: 'y' as const,
		plugins: {
			legend: { display: false },
			tooltip: {
				backgroundColor: 'rgba(0,0,0,0.8)',
				titleFont: { size: 13 },
				bodyFont: { size: 12 },
				padding: 12,
				cornerRadius: 8,
			}
		},
		scales: {
			x: {
				beginAtZero: true,
				ticks: { precision: 0, font: { size: 11 } },
				grid: { color: 'rgba(0,0,0,0.05)' }
			},
			y: {
				ticks: { font: { size: 11 } },
				grid: { display: false }
			}
		}
	};

	// ==================== LIFECYCLE ====================
	onMount(async () => {
		await Promise.all([cargarDashboard(), cargarOpciones()]);

		// Socket listeners for actividades
		socketUtils.on('actividad-pesv-created', handleActSocketEvent);
		socketUtils.on('actividad-pesv-updated', handleActSocketEvent);
		socketUtils.on('actividad-pesv-deleted', handleActSocketEvent);
	});

	onDestroy(() => {
		socketUtils.off('actividad-pesv-created', handleActSocketEvent);
		socketUtils.off('actividad-pesv-updated', handleActSocketEvent);
		socketUtils.off('actividad-pesv-deleted', handleActSocketEvent);
	});

	function handleActSocketEvent() {
		cargarActActividades();
		cargarActEstadisticas();
	}

	async function cargarDashboard() {
		loading = true;
		try {
			const res = await obtenerDashboardPesv({ mes: selectedMes, anio: selectedAnio });
			dashboardData = res.data;
		} catch (error: any) {
			toast.error('Error cargando dashboard PESV');
			console.error(error);
		} finally {
			loading = false;
		}
	}

	async function cargarOpciones() {
		try {
			const res = await obtenerOpcionesPesv();
			filterOptions = res.data;
		} catch (error: any) {
			console.error('Error cargando opciones:', error);
		}
	}

	function handleFilterChange() {
		cargarDashboard();
		if (vistaActiva === 'tabla') {
			cargarRegistrosDiarios();
		}
	}

	// ==================== EXCESOS MODAL ====================
	async function abrirModalExcesos() {
		mostrarModalExceso = true;
		excesoForm.mes = selectedMes;
		excesoForm.anio = selectedAnio;
		await cargarExcesos();
	}

	async function cargarExcesos() {
		try {
			const res = await obtenerExcesos({ mes: excesoForm.mes, anio: excesoForm.anio });
			excesosList = res.data;
		} catch (e: any) {
			toast.error('Error cargando excesos');
		}
	}

	async function guardarExceso() {
		if (!excesoForm.conductor_id || !excesoForm.vehiculo_id || excesoForm.cantidad < 0) {
			toast.error('Completa todos los campos');
			return;
		}
		try {
			await crearOActualizarExceso(excesoForm);
			toast.success('Exceso guardado correctamente');
			await cargarExcesos();
			excesoForm.conductor_id = '';
			excesoForm.vehiculo_id = '';
			excesoForm.cantidad = 0;
			excesoForm.observaciones = '';
		} catch (e: any) {
			toast.error('Error guardando exceso');
		}
	}

	async function borrarExceso(id: string) {
		if (!confirm('¿Eliminar este registro de excesos?')) return;
		try {
			await eliminarExceso(id);
			toast.success('Exceso eliminado');
			await cargarExcesos();
		} catch (e: any) {
			toast.error('Error eliminando exceso');
		}
	}

	// ==================== PREOPERACIONALES MODAL ====================
	async function abrirModalPreop() {
		mostrarModalPreop = true;
		await cargarPreops();
	}

	async function cargarPreops() {
		try {
			const res = await obtenerPreoperacionales({ mes: selectedMes, anio: selectedAnio });
			preopList = res.data;
		} catch (e: any) {
			toast.error('Error cargando preoperacionales');
		}
	}

	async function guardarPreop() {
		if (!preopForm.conductor_id || !preopForm.vehiculo_id || !preopForm.fecha) {
			toast.error('Completa todos los campos');
			return;
		}
		try {
			await crearOActualizarPreoperacional(preopForm);
			toast.success('Preoperacional guardado');
			await cargarPreops();
			preopForm.conductor_id = '';
			preopForm.vehiculo_id = '';
			preopForm.fecha = new Date().toISOString().split('T')[0];
			preopForm.realizado = true;
			preopForm.observaciones = '';
		} catch (e: any) {
			toast.error('Error guardando preoperacional');
		}
	}

	async function borrarPreop(id: string) {
		if (!confirm('¿Eliminar este registro?')) return;
		try {
			await eliminarPreoperacional(id);
			toast.success('Preoperacional eliminado');
			await cargarPreops();
		} catch (e: any) {
			toast.error('Error eliminando preoperacional');
		}
	}

	// ==================== HELPERS ====================
	function getMesLabel(mes: number) {
		return meses.find(m => m.value === mes)?.label || '';
	}

	function formatFecha(fecha: string) {
		try {
			const d = new Date(fecha + 'T12:00:00');
			return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
		} catch { return fecha; }
	}

	function formatHoras(horas: number) {
		if (!horas) return '0h';
		const h = Math.floor(horas);
		const m = Math.round((horas - h) * 60);
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	// ==================== REGISTROS DIARIOS (TABLA) ====================
	async function cargarRegistrosDiarios() {
		loadingRegistros = true;
		try {
			const filters: any = { mes: selectedMes, anio: selectedAnio };
			if (tablaFiltros.conductor_id) filters.conductor_id = tablaFiltros.conductor_id;
			if (tablaFiltros.vehiculo_id) filters.vehiculo_id = tablaFiltros.vehiculo_id;
			if (tablaFiltros.cliente_id) filters.cliente_id = tablaFiltros.cliente_id;
			const res = await obtenerRegistrosDiarios(filters);
			registrosDiarios = res.data;
			currentPage = 1;
		} catch (error: any) {
			toast.error('Error cargando registros diarios');
			console.error(error);
		} finally {
			loadingRegistros = false;
		}
	}

	function cambiarVista(vista: 'dashboard' | 'tabla' | 'actividades') {
		vistaActiva = vista;
		if (vista === 'tabla' && registrosDiarios.length === 0) {
			cargarRegistrosDiarios();
		}
		if (vista === 'actividades' && !actDataLoaded) {
			actLoading = true;
			Promise.all([cargarActActividades(), cargarActUsuarios(), cargarActEstadisticas()]).then(() => {
				actLoading = false;
				actDataLoaded = true;
			});
		}
	}

	async function togglePreoperacional(registro: RegistroDiarioPesv) {
		const nuevoValor = !registro.preoperacional_realizado;
		try {
			await actualizarRegistroDiaPesv(registro.id, { preoperacional_realizado: nuevoValor });
			registro.preoperacional_realizado = nuevoValor;
			registrosDiarios = registrosDiarios;
			toast.success(nuevoValor ? 'Preoperacional marcado ✓' : 'Preoperacional desmarcado');
		} catch (e: any) {
			toast.error('Error actualizando preoperacional');
		}
	}

	function abrirModalEdicion(registro: RegistroDiarioPesv) {
		editingRegistro = registro;
		editForm = {
			horas_sueno: registro.horas_sueno,
			excesos_velocidad_dia: registro.excesos_velocidad_dia || 0,
			siniestros: registro.siniestros || 0,
			siniestros_detalle: registro.siniestros_detalle || ''
		};
		mostrarModalEdicion = true;
	}

	async function guardarEdicion() {
		if (!editingRegistro) return;
		savingEdit = true;
		try {
			await actualizarRegistroDiaPesv(editingRegistro.id, {
				horas_sueno: editForm.horas_sueno,
				excesos_velocidad_dia: editForm.excesos_velocidad_dia,
				siniestros: editForm.siniestros,
				siniestros_detalle: editForm.siniestros_detalle || null
			});
			// Update local data
			const idx = registrosDiarios.findIndex(r => r.id === editingRegistro!.id);
			if (idx >= 0) {
				registrosDiarios[idx].horas_sueno = editForm.horas_sueno;
				registrosDiarios[idx].excesos_velocidad_dia = editForm.excesos_velocidad_dia;
				registrosDiarios[idx].siniestros = editForm.siniestros;
				registrosDiarios[idx].siniestros_detalle = editForm.siniestros_detalle || null;
				registrosDiarios = registrosDiarios;
			}
			toast.success('Registro actualizado correctamente');
			mostrarModalEdicion = false;
			editingRegistro = null;
		} catch (e: any) {
			toast.error('Error guardando cambios');
		} finally {
			savingEdit = false;
		}
	}

	function handleTablaFilterChange() {
		cargarRegistrosDiarios();
	}

	function limpiarFiltrosTabla() {
		tablaFiltros = { conductor_id: '', vehiculo_id: '', cliente_id: '' };
		searchText = '';
		conductorSearch = '';
		placaSearch = '';
		clienteSearch = '';
		conductorLabel = '';
		placaLabel = '';
		clienteLabel = '';
		cargarRegistrosDiarios();
	}

	// ==================== ACTIVIDADES FUNCTIONS ====================
	async function cargarActActividades() {
		try {
			const res = await listarActividadesPesv({
				page: actCurrentPage,
				limit: 50,
				anio: actFiltroAnio || undefined,
				estado: actFiltroEstado || undefined,
				prioridad: actFiltroPrioridad || undefined,
				frecuencia: actFiltroFrecuencia || undefined,
				search: actFiltroSearch || undefined
			});
			actActividades = res.actividades;
			actTotal = res.total;
			actTotalPages = res.totalPages;
		} catch (e) {
			console.error(e);
			toast.error('Error al cargar actividades');
		}
	}

	async function cargarActUsuarios() {
		try {
			actUsuarios = await usuariosAPI.listar();
		} catch (e) {
			console.error(e);
		}
	}

	async function cargarActEstadisticas() {
		try {
			actEstadisticas = await obtenerEstadisticasPesv(actFiltroAnio || undefined);
		} catch (e) {
			console.error(e);
		}
	}

	function actAplicarFiltros() {
		actCurrentPage = 1;
		cargarActActividades();
		cargarActEstadisticas();
	}

	function actLimpiarFiltros() {
		actFiltroAnio = new Date().getFullYear();
		actFiltroEstado = '';
		actFiltroPrioridad = '';
		actFiltroFrecuencia = '';
		actFiltroSearch = '';
		actAplicarFiltros();
	}

	function actHandleSearch() {
		clearTimeout(actSearchTimeout);
		actSearchTimeout = setTimeout(() => actAplicarFiltros(), 400);
	}

	function actCambiarPagina(p: number) {
		if (p < 1 || p > actTotalPages) return;
		actCurrentPage = p;
		cargarActActividades();
	}

	async function actAbrirCrear() {
		actModalMode = 'crear';
		actForm = getEmptyActForm();
		try {
			actForm.numero = await obtenerSiguienteNumero(actFiltroAnio || undefined);
		} catch (e) { /* keep default */ }
		actForm.anio = actFiltroAnio || new Date().getFullYear();
		actEditingId = null;
		actShowModal = true;
	}

	function actAbrirEditar(act: ActividadPesv) {
		actModalMode = 'editar';
		actEditingId = act.id;
		actForm = {
			numero: act.numero,
			unidad_programa: act.unidad_programa,
			actividad: act.actividad,
			alcance: act.alcance || '',
			recursos: act.recursos || '',
			responsable_planeacion: act.responsable_planeacion || '',
			metodo_seguimiento: act.metodo_seguimiento || '',
			frecuencia: act.frecuencia,
			fecha_limite: act.fecha_limite ? act.fecha_limite.substring(0, 10) : '',
			responsable_ejecucion_id: act.responsable_ejecucion_id || '',
			estado: act.estado,
			prioridad: act.prioridad,
			fecha_ejecucion: act.fecha_ejecucion ? act.fecha_ejecucion.substring(0, 10) : '',
			observacion: act.observacion || '',
			anio: act.anio
		};
		actShowModal = true;
	}

	function actAbrirVer(act: ActividadPesv) {
		actAbrirEditar(act);
		actModalMode = 'ver';
	}

	async function actGuardar() {
		if (!actForm.actividad.trim()) {
			toast.error('El nombre de la actividad es requerido');
			return;
		}
		if (!actForm.unidad_programa.trim()) {
			toast.error('La unidad/programa es requerida');
			return;
		}
		actSaving = true;
		try {
			if (actModalMode === 'crear') {
				await crearActividadPesv(actForm);
				toast.success('Actividad creada exitosamente');
			} else {
				await actualizarActividadPesv(actEditingId!, actForm);
				toast.success('Actividad actualizada exitosamente');
			}
			actShowModal = false;
			await cargarActActividades();
			await cargarActEstadisticas();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'Error al guardar');
		} finally {
			actSaving = false;
		}
	}

	function actConfirmarEliminar(act: ActividadPesv) {
		actDeletingId = act.id;
		actDeletingName = act.actividad;
		actShowDeleteModal = true;
	}

	async function actEjecutarEliminar() {
		if (!actDeletingId) return;
		actDeleting = true;
		try {
			await eliminarActividadPesv(actDeletingId);
			toast.success('Actividad eliminada');
			actShowDeleteModal = false;
			actDeletingId = null;
			await cargarActActividades();
			await cargarActEstadisticas();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || 'Error al eliminar');
		} finally {
			actDeleting = false;
		}
	}

	function getActEstadoInfo(estado: string) {
		return ACT_ESTADOS.find(e => e.value === estado) || ACT_ESTADOS[0];
	}

	function getActPrioridadInfo(prioridad: string) {
		return ACT_PRIORIDADES.find(p => p.value === prioridad) || ACT_PRIORIDADES[0];
	}

	function getActFrecuenciaLabel(f: string) {
		return ACT_FRECUENCIAS.find(x => x.value === f)?.label || f;
	}

	function actFormatDate(d: string | null): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	// Calendar
	function getActCalendarDays(mes: number, anio: number): (number | null)[] {
		const firstDay = new Date(anio, mes, 1).getDay();
		const daysInMonth = new Date(anio, mes + 1, 0).getDate();
		const days: (number | null)[] = [];
		for (let i = 0; i < firstDay; i++) days.push(null);
		for (let i = 1; i <= daysInMonth; i++) days.push(i);
		return days;
	}

	function actividadAppearsOnDay(act: ActividadPesv, day: number): boolean {
		const targetDate = new Date(actCalAnio, actCalMes, day);
		const anchor = act.fecha_limite ? new Date(act.fecha_limite) : (act.fecha_ejecucion ? new Date(act.fecha_ejecucion) : null);
		if (!anchor) return false;
		const anchorDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
		const target = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
		if (target < anchorDate) return false;
		const diffMs = target.getTime() - anchorDate.getTime();
		const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
		switch (act.frecuencia) {
			case 'UNICA': return diffDays === 0;
			case 'DIARIA': return true;
			case 'SEMANAL': return diffDays % 7 === 0;
			case 'QUINCENAL': return diffDays % 14 === 0;
			case 'MENSUAL':
				if (target.getDate() !== anchorDate.getDate()) return false;
				return target >= anchorDate;
			case 'BIMESTRAL': {
				if (target.getDate() !== anchorDate.getDate()) return false;
				const mDiff = (target.getFullYear() - anchorDate.getFullYear()) * 12 + (target.getMonth() - anchorDate.getMonth());
				return mDiff >= 0 && mDiff % 2 === 0;
			}
			case 'TRIMESTRAL': {
				if (target.getDate() !== anchorDate.getDate()) return false;
				const mDiff = (target.getFullYear() - anchorDate.getFullYear()) * 12 + (target.getMonth() - anchorDate.getMonth());
				return mDiff >= 0 && mDiff % 3 === 0;
			}
			case 'SEMESTRAL': {
				if (target.getDate() !== anchorDate.getDate()) return false;
				const mDiff = (target.getFullYear() - anchorDate.getFullYear()) * 12 + (target.getMonth() - anchorDate.getMonth());
				return mDiff >= 0 && mDiff % 6 === 0;
			}
			case 'ANUAL':
				return target.getMonth() === anchorDate.getMonth() && target.getDate() === anchorDate.getDate();
			default: return false;
		}
	}

	function getActividadesForDay(day: number): ActividadPesv[] {
		return actActividades.filter(a => actividadAppearsOnDay(a, day));
	}

	function actPrevMonth() {
		if (actCalMes === 0) { actCalMes = 11; actCalAnio--; }
		else actCalMes--;
	}

	function actNextMonth() {
		if (actCalMes === 11) { actCalMes = 0; actCalAnio++; }
		else actCalMes++;
	}

	function actIrHoy() {
		actCalMes = new Date().getMonth();
		actCalAnio = new Date().getFullYear();
	}

	// ==================== REACTIVE (TABLE) ====================
	$: registrosFiltrados = searchText
		? registrosDiarios.filter(r =>
			r.conductor.nombre.toLowerCase().includes(searchText.toLowerCase()) ||
			r.vehiculo.placa.toLowerCase().includes(searchText.toLowerCase()) ||
			(r.cliente.nombre || '').toLowerCase().includes(searchText.toLowerCase()) ||
			(r.origen || '').toLowerCase().includes(searchText.toLowerCase()) ||
			(r.destino || '').toLowerCase().includes(searchText.toLowerCase())
		)
		: registrosDiarios;

	$: totalPages = Math.ceil(registrosFiltrados.length / pageSize) || 1;
	$: registrosPaginados = registrosFiltrados.slice((currentPage - 1) * pageSize, currentPage * pageSize);

	// Reactive autocomplete filtered lists
	$: conductoresFiltrados = filterOptions
		? filterOptions.conductores.filter(c => {
			if (!conductorSearch) return true;
			const q = conductorSearch.toLowerCase();
			return `${c.nombre} ${c.apellido}`.toLowerCase().includes(q) || (c.numero_identificacion || '').toLowerCase().includes(q);
		}).slice(0, 15)
		: [];

	$: vehiculosFiltrados = filterOptions
		? filterOptions.vehiculos.filter(v => {
			if (!placaSearch) return true;
			const q = placaSearch.toLowerCase();
			return v.placa.toLowerCase().includes(q) || (v.marca || '').toLowerCase().includes(q) || (v.modelo || '').toLowerCase().includes(q);
		}).slice(0, 15)
		: [];

	$: clientesFiltrados = filterOptions
		? filterOptions.clientes.filter(c => {
			if (!clienteSearch) return true;
			return c.nombre.toLowerCase().includes(clienteSearch.toLowerCase());
		}).slice(0, 15)
		: [];

	// Reactive chart data
	$: vehiculosDiasData = dashboardData ? buildBarChartData(dashboardData.charts.vehiculosMasDiasTrabajados, 'Días Trabajados') : null;
	$: conductoresDiasData = dashboardData ? buildHorizontalBarData(dashboardData.charts.conductoresMasDiasTrabajados, 'Días Trabajados') : null;
	$: clientesDiasData = dashboardData ? buildHorizontalBarData(dashboardData.charts.clientesMasDiasTrabajados, 'Días Trabajados') : null;
	$: preoperacionalesData = dashboardData ? buildBarChartData(dashboardData.charts.vehiculosMasPreoperacionales, 'Preoperacionales') : null;
	$: excesosData = dashboardData ? buildBarChartData(dashboardData.charts.excesosVelocidadPorConductor, 'Excesos') : null;

	// Actividades calendar reactive
	$: actCalDays = getActCalendarDays(actCalMes, actCalAnio);
</script>

<svelte:head>
	<title>PESV - Dashboard</title>
</svelte:head>

<div class="p-6 space-y-6 min-h-screen">
	<!-- Header -->
	<div class="mb-2" in:fade={{ duration: 600, delay: 100 }}>
		<h1 class="text-2xl font-bold text-gray-900 mb-1">Dashboard PESV</h1>
		<p class="text-gray-500 text-sm">Plan Estratégico de Seguridad Vial — Indicadores y análisis del periodo</p>
	</div>

	<!-- Filters Bar -->
	<div
		class="glass rounded-2xl p-4 border border-gray-200/50 flex flex-wrap items-center gap-4"
		in:fly={{ y: -10, duration: 500, delay: 150 }}
	>
		<div class="flex items-center gap-2">
			<svg class="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
			</svg>
			<span class="text-sm font-medium text-gray-700">Periodo:</span>
		</div>

		<select
			bind:value={selectedMes}
			on:change={handleFilterChange}
			class="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all"
		>
			{#each meses as m}
				<option value={m.value}>{m.label}</option>
			{/each}
		</select>

		<select
			bind:value={selectedAnio}
			on:change={handleFilterChange}
			class="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all"
		>
			{#each anios as a}
				<option value={a.value}>{a.label}</option>
			{/each}
		</select>

		<div class="flex-1"></div>

		<!-- Action buttons -->
		<button
			on:click={abrirModalExcesos}
			class="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl text-sm font-medium hover:from-red-600 hover:to-red-700 transition-all shadow-sm hover:shadow-md"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
			</svg>
			Excesos Velocidad
		</button>

		<button
			on:click={abrirModalPreop}
			class="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm hover:shadow-md"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
			</svg>
			Preoperacionales
		</button>
	</div>

	<!-- Tab Switcher -->
	<div class="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit" in:fade={{ duration: 400, delay: 200 }}>
		<button
			on:click={() => cambiarVista('dashboard')}
			class="px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 {vistaActiva === 'dashboard' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
		>
			<span class="flex items-center gap-2">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
				</svg>
				Dashboard
			</span>
		</button>
		<button
			on:click={() => cambiarVista('tabla')}
			class="px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 {vistaActiva === 'tabla' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
		>
			<span class="flex items-center gap-2">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
				Formato Diario
			</span>
		</button>
		<button
			on:click={() => cambiarVista('actividades')}
			class="px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 {vistaActiva === 'actividades' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
		>
			<span class="flex items-center gap-2">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
				</svg>
				Actividades
			</span>
		</button>
	</div>

	{#if vistaActiva === 'dashboard'}
	{#if loading}
		<!-- Loading state -->
		<div class="p-12 flex flex-col items-center justify-center" in:fade={{ duration: 300 }}>
			<div class="relative">
				<div class="w-16 h-16 border-4 border-orange-200 rounded-full animate-spin border-t-orange-600"></div>
				<div class="absolute inset-0 flex items-center justify-center">
					<svg class="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
					</svg>
				</div>
			</div>
			<p class="mt-4 text-gray-500 text-sm">Cargando indicadores PESV...</p>
		</div>
	{:else if dashboardData}
		<!-- KPI Cards -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" in:fade={{ duration: 600, delay: 200 }}>
			<!-- Conductores Activos -->
			<div class="glass rounded-2xl p-5 border border-blue-200/50 group cursor-default relative overflow-hidden hover:shadow-lg transition-all duration-300">
				<div class="absolute top-0 right-0 w-28 h-28 opacity-5">
					<div class="w-full h-full bg-gradient-to-br from-blue-400 to-blue-600 rounded-full transform translate-x-8 -translate-y-8"></div>
				</div>
				<div class="flex items-center space-x-3 mb-3 relative z-10">
					<div class="w-11 h-11 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a4 4 0 11-8 0 4 4 0 018 0z" />
						</svg>
					</div>
					<div>
						<h3 class="text-gray-900 font-semibold text-sm">Conductores</h3>
						<p class="text-gray-500 text-xs">{getMesLabel(selectedMes)} {selectedAnio}</p>
					</div>
				</div>
				<div class="text-3xl font-bold text-gray-900">{dashboardData.kpis.totalConductores.toLocaleString()}</div>
			</div>

			<!-- Vehículos -->
			<div class="glass rounded-2xl p-5 border border-orange-200/50 group cursor-default relative overflow-hidden hover:shadow-lg transition-all duration-300">
				<div class="absolute top-0 right-0 w-28 h-28 opacity-5">
					<div class="w-full h-full bg-gradient-to-br from-orange-400 to-orange-600 rounded-full transform translate-x-8 -translate-y-8"></div>
				</div>
				<div class="flex items-center space-x-3 mb-3 relative z-10">
					<div class="w-11 h-11 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
						</svg>
					</div>
					<div>
						<h3 class="text-gray-900 font-semibold text-sm">Vehículos</h3>
						<p class="text-gray-500 text-xs">{getMesLabel(selectedMes)} {selectedAnio}</p>
					</div>
				</div>
				<div class="text-3xl font-bold text-gray-900">{dashboardData.kpis.totalVehiculos.toLocaleString()}</div>
			</div>

			<!-- Servicios del mes -->
			<div class="glass rounded-2xl p-5 border border-purple-200/50 group cursor-default relative overflow-hidden hover:shadow-lg transition-all duration-300">
				<div class="absolute top-0 right-0 w-28 h-28 opacity-5">
					<div class="w-full h-full bg-gradient-to-br from-purple-400 to-purple-600 rounded-full transform translate-x-8 -translate-y-8"></div>
				</div>
				<div class="flex items-center space-x-3 mb-3 relative z-10">
					<div class="w-11 h-11 bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
						</svg>
					</div>
					<div>
						<h3 class="text-gray-900 font-semibold text-sm">Servicios</h3>
						<p class="text-gray-500 text-xs">{getMesLabel(selectedMes)} {selectedAnio}</p>
					</div>
				</div>
				<div class="text-3xl font-bold text-gray-900">
					{dashboardData.kpis.totalServicios.toLocaleString()}
					<span class="text-sm font-normal text-orange-600 ml-1">({dashboardData.kpis.totalServiciosRealizados} realizados)</span>
				</div>
			</div>

			<!-- Excesos de velocidad -->
			<div class="glass rounded-2xl p-5 border border-orange-200/50 group cursor-default relative overflow-hidden hover:shadow-lg transition-all duration-300">
				<div class="absolute top-0 right-0 w-28 h-28 opacity-5">
					<div class="w-full h-full bg-gradient-to-br from-orange-400 to-orange-600 rounded-full transform translate-x-8 -translate-y-8"></div>
				</div>
				<div class="flex items-center space-x-3 mb-3 relative z-10">
					<div class="w-11 h-11 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					</div>
					<div>
						<h3 class="text-gray-900 font-semibold text-sm">Excesos Velocidad</h3>
						<p class="text-gray-500 text-xs">Registrados</p>
					</div>
				</div>
				<div class="text-3xl font-bold text-gray-900">{dashboardData.kpis.totalExcesos}</div>
			</div>
		</div>

		<!-- Second row KPIs -->
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-5" in:fade={{ duration: 600, delay: 300 }}>
			<!-- Preoperacionales -->
			<div class="glass rounded-2xl p-5 border border-orange-200/50 group cursor-default relative overflow-hidden hover:shadow-lg transition-all duration-300">
				<div class="absolute top-0 right-0 w-28 h-28 opacity-5">
					<div class="w-full h-full bg-gradient-to-br from-orange-400 to-teal-600 rounded-full transform translate-x-8 -translate-y-8"></div>
				</div>
				<div class="flex items-center justify-between">
					<div class="flex items-center space-x-3 relative z-10">
						<div class="w-11 h-11 bg-gradient-to-br from-orange-400 to-teal-600 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
							<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
							</svg>
						</div>
						<div>
							<h3 class="text-gray-900 font-semibold text-sm">Preoperacionales Realizados</h3>
							<p class="text-gray-500 text-xs">Este mes</p>
						</div>
					</div>
					<div class="text-right">
						<div class="text-3xl font-bold text-gray-900">{dashboardData.kpis.totalPreoperacionales}</div>
					</div>
				</div>
			</div>

			<!-- Porcentaje preoperacional -->
			<div class="glass rounded-2xl p-5 border border-blue-200/50 group cursor-default relative overflow-hidden hover:shadow-lg transition-all duration-300">
				<div class="absolute top-0 right-0 w-28 h-28 opacity-5">
					<div class="w-full h-full bg-gradient-to-br from-blue-400 to-indigo-600 rounded-full transform translate-x-8 -translate-y-8"></div>
				</div>
				<div class="flex items-center justify-between">
					<div class="flex items-center space-x-3 relative z-10">
						<div class="w-11 h-11 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
							<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
							</svg>
						</div>
						<div>
							<h3 class="text-gray-900 font-semibold text-sm">Cumplimiento Preoperacional</h3>
							<p class="text-gray-500 text-xs">% estimado del mes</p>
						</div>
					</div>
					<div class="text-right">
						<div class="text-3xl font-bold" class:text-orange-600={dashboardData.kpis.porcentajePreoperacional >= 70} class:text-orange-500={dashboardData.kpis.porcentajePreoperacional >= 40 && dashboardData.kpis.porcentajePreoperacional < 70} class:text-red-500={dashboardData.kpis.porcentajePreoperacional < 40}>
							{dashboardData.kpis.porcentajePreoperacional}%
						</div>
					</div>
				</div>
				<!-- Progress bar -->
				<div class="mt-3 w-full bg-gray-200 rounded-full h-2">
					<div
						class="h-2 rounded-full transition-all duration-700"
						class:bg-orange-500={dashboardData.kpis.porcentajePreoperacional >= 70}
						class:bg-orange-400={dashboardData.kpis.porcentajePreoperacional >= 40 && dashboardData.kpis.porcentajePreoperacional < 70}
						class:bg-red-400={dashboardData.kpis.porcentajePreoperacional < 40}
						style="width: {dashboardData.kpis.porcentajePreoperacional}%"
					></div>
				</div>
			</div>
		</div>

		<!-- Charts Grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6" in:fly={{ y: 20, duration: 600, delay: 400 }}>
			<!-- Vehículos con más servicios -->
			<div class="glass rounded-2xl p-6 border border-gray-200/50">
				<div class="flex items-center gap-3 mb-5">
					<div class="w-9 h-9 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center">
						<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
						</svg>
					</div>
					<div>
						<h3 class="text-base font-semibold text-gray-900">Vehículos con más Días Trabajados</h3>
						<p class="text-xs text-gray-500">Top 8 del periodo (planillas)</p>
					</div>
				</div>
				<div class="h-72">
					{#if vehiculosDiasData && dashboardData.charts.vehiculosMasDiasTrabajados.length > 0}
						<Bar data={vehiculosDiasData} options={barOptions} />
					{:else}
						<div class="h-full flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100/50 rounded-xl">
							<p class="text-gray-400 text-sm">Sin datos para este periodo</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Conductores con más servicios -->
			<div class="glass rounded-2xl p-6 border border-gray-200/50">
				<div class="flex items-center gap-3 mb-5">
					<div class="w-9 h-9 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center">
						<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1z" />
						</svg>
					</div>
					<div>
						<h3 class="text-base font-semibold text-gray-900">Conductores con más Días Trabajados</h3>
						<p class="text-xs text-gray-500">Top 8 del periodo (planillas)</p>
					</div>
				</div>
				<div class="h-72">
					{#if conductoresDiasData && dashboardData.charts.conductoresMasDiasTrabajados.length > 0}
						<Bar data={conductoresDiasData} options={horizontalBarOptions} />
					{:else}
						<div class="h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl">
							<p class="text-gray-400 text-sm">Sin datos para este periodo</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Clientes con más servicios realizados -->
			<div class="glass rounded-2xl p-6 border border-gray-200/50">
				<div class="flex items-center gap-3 mb-5">
					<div class="w-9 h-9 bg-gradient-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center">
						<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
						</svg>
					</div>
					<div>
						<h3 class="text-base font-semibold text-gray-900">Clientes con más Días Trabajados</h3>
						<p class="text-xs text-gray-500">Top 8 del periodo (planillas)</p>
					</div>
				</div>
				<div class="h-72">
					{#if clientesDiasData && dashboardData.charts.clientesMasDiasTrabajados.length > 0}
						<Bar data={clientesDiasData} options={horizontalBarOptions} />
					{:else}
						<div class="h-full flex items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl">
							<p class="text-gray-400 text-sm">Sin datos para este periodo</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Vehículos con más preoperacionales -->
			<div class="glass rounded-2xl p-6 border border-gray-200/50">
				<div class="flex items-center gap-3 mb-5">
					<div class="w-9 h-9 bg-gradient-to-br from-teal-400 to-teal-600 rounded-lg flex items-center justify-center">
						<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
						</svg>
					</div>
					<div>
						<h3 class="text-base font-semibold text-gray-900">Vehículos con más Preoperacionales</h3>
						<p class="text-xs text-gray-500">Inspecciones realizadas</p>
					</div>
				</div>
				<div class="h-72">
					{#if preoperacionalesData && dashboardData.charts.vehiculosMasPreoperacionales.length > 0}
						<Bar data={preoperacionalesData} options={barOptions} />
					{:else}
						<div class="h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100/50 rounded-xl">
							<p class="text-gray-400 text-sm">Sin datos para este periodo</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Excesos de velocidad por conductor -->
			<div class="glass rounded-2xl p-6 border border-gray-200/50">
				<div class="flex items-center gap-3 mb-5">
					<div class="w-9 h-9 bg-gradient-to-br from-red-400 to-red-600 rounded-lg flex items-center justify-center">
						<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					</div>
					<div>
						<h3 class="text-base font-semibold text-gray-900">Excesos de Velocidad por Conductor</h3>
						<p class="text-xs text-gray-500">Registros del periodo</p>
					</div>
				</div>
				<div class="h-72">
					{#if excesosData && dashboardData.charts.excesosVelocidadPorConductor.length > 0}
						<Bar data={excesosData} options={barOptions} />
					{:else}
						<div class="h-full flex items-center justify-center bg-gradient-to-br from-red-50 to-red-100/50 rounded-xl">
							<p class="text-gray-400 text-sm">Sin excesos registrados este periodo</p>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
	<!-- end dashboard if/else -->

	{:else if vistaActiva === 'tabla'}
	<!-- ==================== TABLE VIEW ==================== -->
	<div class="space-y-4" in:fade={{ duration: 400 }}>
		<!-- Table Filters -->
		<div class="glass rounded-2xl p-4 border border-gray-200/50">
			<div class="space-y-3">
				<!-- Search -->
				<div class="relative w-full">
					<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="text"
						bind:value={searchText}
						placeholder="Buscar conductor, placa, cliente, origen..."
						class="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all"
					/>
				</div>

				<!-- Filter row -->
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">

				<!-- Conductor filter -->
				{#if filterOptions}
					<!-- Conductor autocomplete -->
					<div class="relative w-full">
						<div class="relative">
							<svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
							</svg>
							<input
								type="text"
								bind:value={conductorSearch}
								on:focus={() => { conductorDropdownOpen = true; }}
								on:blur={() => { setTimeout(() => { conductorDropdownOpen = false; conductorSearch = ''; }, 150); }}
								on:input={() => { conductorDropdownOpen = true; if (tablaFiltros.conductor_id) { tablaFiltros.conductor_id = ''; conductorLabel = ''; handleTablaFilterChange(); } }}
								placeholder={conductorLabel || 'Conductor...'}
								class="w-full pl-8 pr-7 py-2 bg-white border rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all {tablaFiltros.conductor_id ? 'border-orange-400 bg-orange-50/40' : 'border-gray-200'}"
							/>
							{#if tablaFiltros.conductor_id}
								<button
									on:click={() => { tablaFiltros.conductor_id = ''; conductorSearch = ''; conductorLabel = ''; handleTablaFilterChange(); }}
									class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
									title="Limpiar conductor"
								>✕</button>
							{/if}
						</div>
						{#if conductorDropdownOpen && conductoresFiltrados.length > 0}
							<div class="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
								{#each conductoresFiltrados as c}
									<button
										on:mousedown|preventDefault={() => {
											tablaFiltros.conductor_id = c.id;
											conductorLabel = `${c.nombre} ${c.apellido}`;
											conductorSearch = '';
											conductorDropdownOpen = false;
											handleTablaFilterChange();
										}}
										class="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 transition-colors flex items-center gap-2 {tablaFiltros.conductor_id === c.id ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-700'}"
									>
										<span class="truncate">{c.nombre} {c.apellido}</span>
										{#if c.numero_identificacion}
											<span class="text-xs text-gray-400 ml-auto flex-shrink-0">{c.numero_identificacion}</span>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Placa autocomplete -->
					<div class="relative w-full">
						<div class="relative">
							<svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0h4m-4 0H9m4 0a2 2 0 110 4 2 2 0 010-4z" />
							</svg>
							<input
								type="text"
								bind:value={placaSearch}
								on:focus={() => { placaDropdownOpen = true; }}
								on:blur={() => { setTimeout(() => { placaDropdownOpen = false; placaSearch = ''; }, 150); }}
								on:input={() => { placaDropdownOpen = true; if (tablaFiltros.vehiculo_id) { tablaFiltros.vehiculo_id = ''; placaLabel = ''; handleTablaFilterChange(); } }}
								placeholder={placaLabel || 'Placa...'}
								class="w-full pl-8 pr-7 py-2 bg-white border rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all {tablaFiltros.vehiculo_id ? 'border-orange-400 bg-orange-50/40' : 'border-gray-200'}"
							/>
							{#if tablaFiltros.vehiculo_id}
								<button
									on:click={() => { tablaFiltros.vehiculo_id = ''; placaSearch = ''; placaLabel = ''; handleTablaFilterChange(); }}
									class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
									title="Limpiar placa"
								>✕</button>
							{/if}
						</div>
						{#if placaDropdownOpen && vehiculosFiltrados.length > 0}
							<div class="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
								{#each vehiculosFiltrados as v}
									<button
										on:mousedown|preventDefault={() => {
											tablaFiltros.vehiculo_id = v.id;
											placaLabel = v.placa;
											placaSearch = '';
											placaDropdownOpen = false;
											handleTablaFilterChange();
										}}
										class="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 transition-colors {tablaFiltros.vehiculo_id === v.id ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-700'}"
									>
										<span class="font-mono">{v.placa}</span>
										{#if v.marca || v.modelo}
											<span class="text-xs text-gray-400 ml-2">{v.marca || ''} {v.modelo || ''}</span>
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Cliente autocomplete -->
					<div class="relative w-full">
						<div class="relative">
							<svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
							</svg>
							<input
								type="text"
								bind:value={clienteSearch}
								on:focus={() => { clienteDropdownOpen = true; }}
								on:blur={() => { setTimeout(() => { clienteDropdownOpen = false; clienteSearch = ''; }, 150); }}
								on:input={() => { clienteDropdownOpen = true; if (tablaFiltros.cliente_id) { tablaFiltros.cliente_id = ''; clienteLabel = ''; handleTablaFilterChange(); } }}
								placeholder={clienteLabel || 'Cliente...'}
								class="w-full pl-8 pr-7 py-2 bg-white border rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all {tablaFiltros.cliente_id ? 'border-orange-400 bg-orange-50/40' : 'border-gray-200'}"
							/>
							{#if tablaFiltros.cliente_id}
								<button
									on:click={() => { tablaFiltros.cliente_id = ''; clienteSearch = ''; clienteLabel = ''; handleTablaFilterChange(); }}
									class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
									title="Limpiar cliente"
								>✕</button>
							{/if}
						</div>
						{#if clienteDropdownOpen && clientesFiltrados.length > 0}
							<div class="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
								{#each clientesFiltrados as c}
									<button
										on:mousedown|preventDefault={() => {
											tablaFiltros.cliente_id = c.id;
											clienteLabel = c.nombre;
											clienteSearch = '';
											clienteDropdownOpen = false;
											handleTablaFilterChange();
										}}
										class="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 transition-colors truncate {tablaFiltros.cliente_id === c.id ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-700'}"
									>
										{c.nombre}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				</div>

				{#if tablaFiltros.conductor_id || tablaFiltros.vehiculo_id || tablaFiltros.cliente_id || searchText}
					<div class="flex justify-end">
						<button
							on:click={limpiarFiltrosTabla}
							class="px-3 py-2 text-xs text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
							title="Limpiar filtros"
						>
							✕ Limpiar filtros
						</button>
					</div>
				{/if}
			</div>
			<div class="mt-2 flex items-center justify-between">
				<p class="text-xs text-gray-400">{registrosFiltrados.length} registros · {getMesLabel(selectedMes)} {selectedAnio}</p>
			</div>
		</div>

		<!-- Table -->
		{#if loadingRegistros}
			<div class="p-12 flex flex-col items-center justify-center">
				<div class="w-12 h-12 border-4 border-orange-200 rounded-full animate-spin border-t-orange-600"></div>
				<p class="mt-3 text-gray-500 text-sm">Cargando registros diarios...</p>
			</div>
		{:else if registrosFiltrados.length === 0}
			<div class="glass rounded-2xl p-12 border border-gray-200/50 text-center">
				<svg class="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
				</svg>
				<p class="text-gray-400 text-sm">No hay registros diarios para este periodo</p>
				<p class="text-gray-300 text-xs mt-1">Ajusta los filtros o el periodo seleccionado</p>
			</div>
		{:else}
			<div class="glass rounded-2xl border border-gray-200/50 overflow-hidden">
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-gradient-to-r from-orange-50 to-teal-50 border-b border-gray-200">
								<th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Día</th>
								<th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Conductor</th>
								<th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Placa</th>
								<th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Cliente</th>
								<th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Origen / Destino</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Servicios</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">T. Conducción</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">T. Disponib.</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Horas Sueño</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Excesos Vel.</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Preop.</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Siniestros</th>
								<th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100">
							{#each registrosPaginados as registro, i}
								<tr class="hover:bg-orange-50/30 transition-colors {i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}">
									<!-- Día -->
									<td class="px-3 py-2.5">
										<div class="flex flex-col">
											<span class="font-semibold text-gray-900">{registro.dia}</span>
											<span class="text-[10px] text-gray-400">{formatFecha(registro.fecha)}</span>
										</div>
									</td>
									<!-- Conductor -->
									<td class="px-3 py-2.5">
										<div class="flex flex-col">
											<span class="font-medium text-gray-800 text-xs">{registro.conductor.nombre}</span>
											{#if registro.conductor.numero_identificacion}
												<span class="text-[10px] text-gray-400">{registro.conductor.numero_identificacion}</span>
											{/if}
										</div>
									</td>
									<!-- Placa -->
									<td class="px-3 py-2.5">
										<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-mono font-semibold">
											{registro.vehiculo.placa}
										</span>
									</td>
									<!-- Cliente -->
									<td class="px-3 py-2.5 max-w-[150px]">
										<span class="text-xs text-gray-700 truncate block">{registro.cliente.nombre || '—'}</span>
									</td>
									<!-- Origen / Destino -->
									<td class="px-3 py-2.5 max-w-[180px]">
										{#if registro.origen || registro.destino}
											<div class="flex flex-col text-xs">
												<span class="text-gray-600 truncate">{registro.origen || '—'}</span>
												<span class="text-[10px] text-gray-400">→ {registro.destino || '—'}</span>
											</div>
										{:else}
											<span class="text-gray-300 text-xs">—</span>
										{/if}
									</td>
									<!-- N° Servicios -->
									<td class="px-3 py-2.5 text-center">
										<span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-50 text-purple-700 text-xs font-bold">
											{registro.num_servicios}
										</span>
									</td>
									<!-- Tiempo Conducción -->
									<td class="px-3 py-2.5 text-center">
										<span class="text-xs text-gray-700">{formatHoras(registro.tiempo_conduccion)}</span>
									</td>
									<!-- Tiempo Disponibilidad -->
									<td class="px-3 py-2.5 text-center">
										<span class="text-xs text-gray-500">{formatHoras(registro.tiempo_disponibilidad)}</span>
									</td>
									<!-- Horas Sueño -->
									<td class="px-3 py-2.5 text-center">
										{#if registro.horas_sueno !== null && registro.horas_sueno !== undefined}
											<span class="text-xs font-medium {registro.horas_sueno < 6 ? 'text-red-600' : registro.horas_sueno < 8 ? 'text-orange-500' : 'text-orange-600'}">
												{registro.horas_sueno}h
											</span>
										{:else}
											<span class="text-gray-300 text-xs">—</span>
										{/if}
									</td>
									<!-- Excesos Velocidad -->
									<td class="px-3 py-2.5 text-center">
										{#if registro.excesos_velocidad_dia > 0}
											<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-bold">
												{registro.excesos_velocidad_dia}
											</span>
										{:else}
											<span class="text-orange-500 text-xs">0</span>
										{/if}
									</td>
									<!-- Preoperacional Toggle -->
									<td class="px-3 py-2.5 text-center">
										<button
											on:click={() => togglePreoperacional(registro)}
											class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 {registro.preoperacional_realizado ? 'bg-orange-500' : 'bg-gray-300'}"
											title={registro.preoperacional_realizado ? 'Preoperacional realizado' : 'Preoperacional no realizado'}
										>
											<span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 {registro.preoperacional_realizado ? 'translate-x-[18px]' : 'translate-x-[3px]'}"></span>
										</button>
									</td>
									<!-- Siniestros -->
									<td class="px-3 py-2.5 text-center">
										{#if registro.siniestros > 0}
											<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 text-xs font-bold" title={registro.siniestros_detalle || ''}>
												{registro.siniestros}
											</span>
										{:else}
											<span class="text-orange-500 text-xs">0</span>
										{/if}
									</td>
									<!-- Acciones -->
									<td class="px-3 py-2.5 text-center">
										<button
											on:click={() => abrirModalEdicion(registro)}
											class="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
											title="Editar registro PESV"
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
											</svg>
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Pagination -->
				{#if totalPages > 1}
					<div class="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
						<p class="text-xs text-gray-500">
							Mostrando {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, registrosFiltrados.length)} de {registrosFiltrados.length}
						</p>
						<div class="flex items-center gap-1">
							<button
								on:click={() => currentPage = Math.max(1, currentPage - 1)}
								disabled={currentPage === 1}
								class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 {currentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-white hover:shadow-sm'} transition-all"
							>
								← Ant
							</button>
							{#each Array.from({length: Math.min(totalPages, 7)}, (_, i) => {
								if (totalPages <= 7) return i + 1;
								if (currentPage <= 4) return i + 1;
								if (currentPage >= totalPages - 3) return totalPages - 6 + i;
								return currentPage - 3 + i;
							}) as page}
								<button
									on:click={() => currentPage = page}
									class="w-7 h-7 text-xs rounded-lg {currentPage === page ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:shadow-sm border border-gray-200'} transition-all"
								>
									{page}
								</button>
							{/each}
							<button
								on:click={() => currentPage = Math.min(totalPages, currentPage + 1)}
								disabled={currentPage === totalPages}
								class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 {currentPage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-white hover:shadow-sm'} transition-all"
							>
								Sig →
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
	{:else if vistaActiva === 'actividades'}
	<!-- ==================== ACTIVIDADES VIEW ==================== -->
	<div class="actividades-pesv-section" in:fade={{ duration: 300 }}>
		<!-- Header -->
		<div class="act-page-header">
			<div class="act-header-left">
				<div>
					<h2 class="act-title">📋 Actividades</h2>
					<p class="act-subtitle">Plan Estratégico de Seguridad Vial — {actFiltroAnio}</p>
				</div>
			</div>
			<div class="act-header-actions">
				<div class="act-vista-toggle">
					<button class:active={actVistaInterna === 'listado'} on:click={() => actVistaInterna = 'listado'}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
						Listado
					</button>
					<button class:active={actVistaInterna === 'calendario'} on:click={() => actVistaInterna = 'calendario'}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
						Calendario
					</button>
				</div>
				<button class="act-btn-primary" on:click={actAbrirCrear}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
					Nueva Actividad
				</button>
			</div>
		</div>

		<!-- KPIs -->
		{#if actEstadisticas}
			<div class="act-kpis-row" in:fly={{ y: 20, duration: 300, delay: 100 }}>
				<div class="act-kpi-card">
					<span class="act-kpi-icon">📊</span>
					<div class="act-kpi-info">
						<span class="act-kpi-value">{actEstadisticas.total}</span>
						<span class="act-kpi-label">Total</span>
					</div>
				</div>
				<div class="act-kpi-card">
					<span class="act-kpi-icon">⏳</span>
					<div class="act-kpi-info">
						<span class="act-kpi-value">{actEstadisticas.porEstado?.PENDIENTE || 0}</span>
						<span class="act-kpi-label">Pendientes</span>
					</div>
				</div>
				<div class="act-kpi-card">
					<span class="act-kpi-icon">🔄</span>
					<div class="act-kpi-info">
						<span class="act-kpi-value">{actEstadisticas.porEstado?.EN_PROGRESO || 0}</span>
						<span class="act-kpi-label">En Progreso</span>
					</div>
				</div>
				<div class="act-kpi-card">
					<span class="act-kpi-icon">✅</span>
					<div class="act-kpi-info">
						<span class="act-kpi-value">{actEstadisticas.porEstado?.COMPLETADA || 0}</span>
						<span class="act-kpi-label">Completadas</span>
					</div>
				</div>
				<div class="act-kpi-card">
					<span class="act-kpi-icon">⚠️</span>
					<div class="act-kpi-info">
						<span class="act-kpi-value">{actEstadisticas.porEstado?.VENCIDA || 0}</span>
						<span class="act-kpi-label">Vencidas</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- Filtros -->
		<div class="act-filtros-bar" in:fly={{ y: 20, duration: 300, delay: 150 }}>
			<div class="act-filtro-group">
				<input type="number" bind:value={actFiltroAnio} placeholder="Año" min="2020" max="2030" class="act-input-sm" on:change={actAplicarFiltros} />
			</div>
			<div class="act-filtro-group">
				<select bind:value={actFiltroEstado} class="act-input-sm" on:change={actAplicarFiltros}>
					<option value="">Todos los estados</option>
					{#each ACT_ESTADOS as e}
						<option value={e.value}>{e.label}</option>
					{/each}
				</select>
			</div>
			<div class="act-filtro-group">
				<select bind:value={actFiltroPrioridad} class="act-input-sm" on:change={actAplicarFiltros}>
					<option value="">Todas las prioridades</option>
					{#each ACT_PRIORIDADES as p}
						<option value={p.value}>{p.label}</option>
					{/each}
				</select>
			</div>
			<div class="act-filtro-group">
				<select bind:value={actFiltroFrecuencia} class="act-input-sm" on:change={actAplicarFiltros}>
					<option value="">Todas las frecuencias</option>
					{#each ACT_FRECUENCIAS as f}
						<option value={f.value}>{f.label}</option>
					{/each}
				</select>
			</div>
			<div class="act-filtro-group act-search-group">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
				<input type="text" bind:value={actFiltroSearch} placeholder="Buscar actividad..." class="act-input-sm" on:input={actHandleSearch} />
			</div>
			{#if actFiltroEstado || actFiltroPrioridad || actFiltroFrecuencia || actFiltroSearch}
				<button class="act-btn-clear" on:click={actLimpiarFiltros}>✕ Limpiar</button>
			{/if}
		</div>

		<!-- Content -->
		{#if actLoading}
			<div class="act-loading-state">
				<div class="act-spinner"></div>
				<p>Cargando actividades...</p>
			</div>
		{:else if actVistaInterna === 'listado'}
			<!-- TABLA -->
			<div class="act-table-container" in:fade={{ duration: 200 }}>
				{#if actActividades.length === 0}
					<div class="act-empty-state">
						<span class="act-empty-icon">📋</span>
						<p>No se encontraron actividades</p>
						<button class="act-btn-primary" on:click={actAbrirCrear}>Crear primera actividad</button>
					</div>
				{:else}
					<div class="act-table-scroll">
						<table class="act-table">
							<thead>
								<tr>
									<th class="act-w-16">#</th>
									<th>Actividad</th>
									<th>Unidad/Programa</th>
									<th>Frecuencia</th>
									<th>Responsable</th>
									<th>Estado</th>
									<th>Prioridad</th>
									<th>Fecha Límite</th>
									<th class="act-w-28">Acciones</th>
								</tr>
							</thead>
							<tbody>
								{#each actActividades as act (act.id)}
									<tr in:fade={{ duration: 150 }}>
										<td class="font-mono text-center">{act.numero}</td>
										<td class="font-medium act-max-w-xs act-truncate" title={act.actividad}>{act.actividad}</td>
										<td class="act-max-w-xs act-truncate" title={act.unidad_programa}>{act.unidad_programa}</td>
										<td><span class="act-badge act-badge-neutral">{getActFrecuenciaLabel(act.frecuencia)}</span></td>
										<td>{act.responsable_ejecucion?.nombre || '—'}</td>
										<td>
											<span class="act-badge {getActEstadoInfo(act.estado).bg} {getActEstadoInfo(act.estado).color}">{getActEstadoInfo(act.estado).label}</span>
										</td>
										<td>
											<span class="act-badge {getActPrioridadInfo(act.prioridad).bg} {getActPrioridadInfo(act.prioridad).color}">{getActPrioridadInfo(act.prioridad).label}</span>
										</td>
										<td class="text-sm">{actFormatDate(act.fecha_limite)}</td>
										<td>
											<div class="act-action-buttons">
												<button class="act-btn-icon" title="Ver" on:click={() => actAbrirVer(act)}>👁️</button>
												<button class="act-btn-icon" title="Editar" on:click={() => actAbrirEditar(act)}>✏️</button>
												<button class="act-btn-icon act-delete" title="Eliminar" on:click={() => actConfirmarEliminar(act)}>🗑️</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- Paginación -->
					{#if actTotalPages > 1}
						<div class="act-pagination">
							<span class="act-pagination-info">Mostrando {actActividades.length} de {actTotal}</span>
							<div class="act-pagination-controls">
								<button disabled={actCurrentPage === 1} on:click={() => actCambiarPagina(actCurrentPage - 1)}>←</button>
								{#each Array.from({ length: actTotalPages }, (_, i) => i + 1) as p}
									<button class:active={p === actCurrentPage} on:click={() => actCambiarPagina(p)}>{p}</button>
								{/each}
								<button disabled={actCurrentPage === actTotalPages} on:click={() => actCambiarPagina(actCurrentPage + 1)}>→</button>
							</div>
						</div>
					{/if}
				{/if}
			</div>

		{:else}
			<!-- CALENDARIO -->
			<div class="act-calendar-container" in:fade={{ duration: 200 }}>
				<div class="act-calendar-header">
					<button class="act-btn-cal-nav" on:click={actPrevMonth}>←</button>
					<h2>{ACT_MESES[actCalMes]} {actCalAnio}</h2>
					<button class="act-btn-cal-nav" on:click={actNextMonth}>→</button>
					<button class="act-btn-cal-today" on:click={actIrHoy}>Hoy</button>
				</div>
				<div class="act-calendar-grid">
					<div class="act-cal-day-header">Dom</div>
					<div class="act-cal-day-header">Lun</div>
					<div class="act-cal-day-header">Mar</div>
					<div class="act-cal-day-header">Mié</div>
					<div class="act-cal-day-header">Jue</div>
					<div class="act-cal-day-header">Vie</div>
					<div class="act-cal-day-header">Sáb</div>

					{#each actCalDays as day}
						{@const dayActs = day ? getActividadesForDay(day) : []}
						<div class="act-cal-cell" class:empty={!day} class:today={day === new Date().getDate() && actCalMes === new Date().getMonth() && actCalAnio === new Date().getFullYear()}>
							{#if day}
								<span class="act-cal-day-num">{day}</span>
								{#each dayActs.slice(0, 3) as act}
									<button
										class="act-cal-event {getActEstadoInfo(act.estado).bg}"
										title="{act.actividad} — {getActEstadoInfo(act.estado).label}"
										on:click={() => actAbrirVer(act)}
									>
										{act.actividad.substring(0, 18)}{act.actividad.length > 18 ? '…' : ''}
									</button>
								{/each}
								{#if dayActs.length > 3}
									<span class="act-cal-more">+{dayActs.length - 3} más</span>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
	{/if}
	<!-- end vistaActiva -->
</div>

<!-- ==================== MODAL EDICIÓN REGISTRO PESV ==================== -->
{#if mostrarModalEdicion && editingRegistro}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div
			class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
			in:fly={{ y: 30, duration: 300 }}
		>
			<!-- Header -->
			<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-teal-50">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
						</svg>
					</div>
					<div>
						<h2 class="text-lg font-bold text-gray-900">Editar Registro PESV</h2>
						<p class="text-xs text-gray-500">
							{editingRegistro.conductor.nombre} · {editingRegistro.vehiculo.placa} · Día {editingRegistro.dia}
						</p>
					</div>
				</div>
				<button on:click={() => { mostrarModalEdicion = false; editingRegistro = null; }} class="p-2 hover:bg-gray-100 rounded-xl transition-colors" title="Cerrar">
					<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="p-6 space-y-5">
				<!-- Horas de sueño -->
				<div>
					<label for="edit-horas-sueno" class="block text-sm font-medium text-gray-700 mb-1">
						Horas de sueño
					</label>
					<div class="flex items-center gap-3">
						<input
							id="edit-horas-sueno"
							type="number"
							bind:value={editForm.horas_sueno}
							min="0"
							max="24"
							step="0.5"
							class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
							placeholder="Ej: 7.5"
						/>
						<button
							on:click={() => editForm.horas_sueno = null}
							class="px-2 py-2 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
							title="Sin dato"
						>
							✕
						</button>
					</div>
					{#if editForm.horas_sueno !== null && editForm.horas_sueno !== undefined}
						<p class="text-xs mt-1 {editForm.horas_sueno < 6 ? 'text-red-500' : editForm.horas_sueno < 8 ? 'text-orange-500' : 'text-orange-600'}">
							{editForm.horas_sueno < 6 ? '⚠️ Menos de 6 horas — riesgo de fatiga' : editForm.horas_sueno < 8 ? '⚡ Aceptable pero mejorable' : '✓ Descanso adecuado'}
						</p>
					{/if}
				</div>

				<!-- Excesos de velocidad -->
				<div>
					<label for="edit-excesos" class="block text-sm font-medium text-gray-700 mb-1">
						Excesos de velocidad del día
					</label>
					<input
						id="edit-excesos"
						type="number"
						bind:value={editForm.excesos_velocidad_dia}
						min="0"
						class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400"
						placeholder="0"
					/>
				</div>

				<!-- Siniestros -->
				<div>
					<label for="edit-siniestros" class="block text-sm font-medium text-gray-700 mb-1">
						N° de siniestros
					</label>
					<input
						id="edit-siniestros"
						type="number"
						bind:value={editForm.siniestros}
						min="0"
						class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
						placeholder="0"
					/>
				</div>

				<!-- Detalle siniestros -->
				{#if editForm.siniestros > 0}
					<div in:fly={{ y: 10, duration: 200 }}>
						<label for="edit-siniestros-detalle" class="block text-sm font-medium text-gray-700 mb-1">
							Detalle del siniestro
						</label>
						<textarea
							id="edit-siniestros-detalle"
							bind:value={editForm.siniestros_detalle}
							rows="3"
							class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400 resize-none"
							placeholder="Describe brevemente lo ocurrido..."
						></textarea>
					</div>
				{/if}

				<!-- Actions -->
				<div class="flex justify-end gap-3 pt-2">
					<button
						on:click={() => { mostrarModalEdicion = false; editingRegistro = null; }}
						class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors"
					>
						Cancelar
					</button>
					<button
						on:click={guardarEdicion}
						disabled={savingEdit}
						class="px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{#if savingEdit}
							<span class="flex items-center gap-2">
								<svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
								</svg>
								Guardando...
							</span>
						{:else}
							Guardar Cambios
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
{#if mostrarModalExceso}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div
			class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
			in:fly={{ y: 30, duration: 300 }}
		>
			<!-- Header -->
			<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-red-50 to-orange-50">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 bg-gradient-to-br from-red-400 to-red-600 rounded-xl flex items-center justify-center">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
					</div>
					<div>
						<h2 class="text-lg font-bold text-gray-900">Excesos de Velocidad</h2>
						<p class="text-xs text-gray-500">Registrar excesos por conductor y vehículo</p>
					</div>
				</div>
				<button on:click={() => { mostrarModalExceso = false; cargarDashboard(); }} class="p-2 hover:bg-gray-100 rounded-xl transition-colors" aria-label="Cerrar modal">
					<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="flex-1 overflow-y-auto p-6 space-y-5">
				<!-- Form -->
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<p class="block text-sm font-medium text-gray-700 mb-1">Conductor</p>
						{#if filterOptions}
							<Select
								items={filterOptions.conductores.map(c => ({ value: c.id, label: `${c.nombre} ${c.apellido} - ${c.numero_identificacion}` }))}
								placeholder="Seleccionar conductor..."
								on:change={(e) => excesoForm.conductor_id = e.detail?.value || ''}
								on:clear={() => excesoForm.conductor_id = ''}
								--border-radius="0.75rem"
								--height="42px"
								--font-size="0.875rem"
							/>
						{/if}
					</div>
					<div>
						<p class="block text-sm font-medium text-gray-700 mb-1">Vehículo</p>
						{#if filterOptions}
							<Select
								items={filterOptions.vehiculos.map(v => ({ value: v.id, label: `${v.placa} - ${v.marca || ''} ${v.modelo || ''}`.trim() }))}
								placeholder="Seleccionar vehículo..."
								on:change={(e) => excesoForm.vehiculo_id = e.detail?.value || ''}
								on:clear={() => excesoForm.vehiculo_id = ''}
								--border-radius="0.75rem"
								--height="42px"
								--font-size="0.875rem"
							/>
						{/if}
					</div>
					<div>
						<label for="exceso-cantidad" class="block text-sm font-medium text-gray-700 mb-1">Cantidad de excesos</label>
						<input
							id="exceso-cantidad"
							type="number"
							bind:value={excesoForm.cantidad}
							min="0"
							class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400"
							placeholder="0"
						/>
					</div>
					<div>
						<label for="exceso-observaciones" class="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
						<input
							id="exceso-observaciones"
							type="text"
							bind:value={excesoForm.observaciones}
							class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-400 focus:border-red-400"
							placeholder="Opcional"
						/>
					</div>
				</div>
				<button
					on:click={guardarExceso}
					class="px-5 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl text-sm font-medium hover:from-red-600 hover:to-red-700 transition-all shadow-sm"
				>
					Guardar Exceso
				</button>

				<!-- List -->
				{#if excesosList.length > 0}
					<div class="border-t border-gray-100 pt-4">
						<h4 class="text-sm font-semibold text-gray-700 mb-3">Registros ({getMesLabel(excesoForm.mes)} {excesoForm.anio})</h4>
						<div class="space-y-2 max-h-60 overflow-y-auto">
							{#each excesosList as exceso}
								<div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
									<div class="flex-1">
										<p class="text-sm font-medium text-gray-900">
											{exceso.conductor ? `${exceso.conductor.nombre} ${exceso.conductor.apellido}` : 'N/A'}
											<span class="text-gray-400 mx-1">·</span>
											<span class="text-gray-600">{exceso.vehiculo?.placa || 'N/A'}</span>
										</p>
										<p class="text-xs text-gray-500">
											{exceso.cantidad} exceso(s)
											{#if exceso.observaciones} — {exceso.observaciones}{/if}
										</p>
									</div>
									<button
										on:click={() => borrarExceso(exceso.id)}
										class="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
										aria-label="Eliminar exceso"
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ==================== MODAL PREOPERACIONALES ==================== -->
{#if mostrarModalPreop}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" transition:fade={{ duration: 200 }}>
		<div
			class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
			in:fly={{ y: 30, duration: 300 }}
		>
			<!-- Header -->
			<div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-teal-50">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 bg-gradient-to-br from-orange-400 to-teal-600 rounded-xl flex items-center justify-center">
						<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
						</svg>
					</div>
					<div>
						<h2 class="text-lg font-bold text-gray-900">Inspecciones Preoperacionales</h2>
						<p class="text-xs text-gray-500">Registrar inspecciones diarias por vehículo</p>
					</div>
				</div>
				<button on:click={() => { mostrarModalPreop = false; cargarDashboard(); }} class="p-2 hover:bg-gray-100 rounded-xl transition-colors" aria-label="Cerrar modal">
					<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="flex-1 overflow-y-auto p-6 space-y-5">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<p class="block text-sm font-medium text-gray-700 mb-1">Conductor</p>
						{#if filterOptions}
							<Select
								items={filterOptions.conductores.map(c => ({ value: c.id, label: `${c.nombre} ${c.apellido} - ${c.numero_identificacion}` }))}
								placeholder="Seleccionar conductor..."
								on:change={(e) => preopForm.conductor_id = e.detail?.value || ''}
								on:clear={() => preopForm.conductor_id = ''}
								--border-radius="0.75rem"
								--height="42px"
								--font-size="0.875rem"
							/>
						{/if}
					</div>
					<div>
						<p class="block text-sm font-medium text-gray-700 mb-1">Vehículo</p>
						{#if filterOptions}
							<Select
								items={filterOptions.vehiculos.map(v => ({ value: v.id, label: `${v.placa} - ${v.marca || ''} ${v.modelo || ''}`.trim() }))}
								placeholder="Seleccionar vehículo..."
								on:change={(e) => preopForm.vehiculo_id = e.detail?.value || ''}
								on:clear={() => preopForm.vehiculo_id = ''}
								--border-radius="0.75rem"
								--height="42px"
								--font-size="0.875rem"
							/>
						{/if}
					</div>
					<div>
						<label for="preop-fecha" class="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
						<input
							id="preop-fecha"
							type="date"
							bind:value={preopForm.fecha}
							class="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
						/>
					</div>
					<div>
						<p class="block text-sm font-medium text-gray-700 mb-1">¿Realizado?</p>
						<label for="preop-realizado" class="inline-flex items-center gap-2 mt-1.5">
							<input id="preop-realizado" type="checkbox" bind:checked={preopForm.realizado} class="w-5 h-5 rounded-lg border-gray-300 text-orange-600 focus:ring-orange-500" />
							<span class="text-sm text-gray-700">{preopForm.realizado ? 'Sí, realizado' : 'No realizado'}</span>
						</label>
					</div>
				</div>
				<div>
					<label for="preop-observaciones" class="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
					<input
						id="preop-observaciones"
						type="text"
						bind:value={preopForm.observaciones}
						placeholder="Opcional"
						/>
					</div>
				<button
					on:click={guardarPreop}
					class="px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-sm font-medium hover:from-orange-600 hover:to-orange-700 transition-all shadow-sm"
				>
					Guardar Preoperacional
				</button>

				<!-- List -->
				{#if preopList.length > 0}
					<div class="border-t border-gray-100 pt-4">
						<h4 class="text-sm font-semibold text-gray-700 mb-3">Registros ({getMesLabel(selectedMes)} {selectedAnio})</h4>
						<div class="space-y-2 max-h-60 overflow-y-auto">
							{#each preopList as preop}
								<div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
									<div class="flex-1">
										<p class="text-sm font-medium text-gray-900">
											{preop.conductor ? `${preop.conductor.nombre} ${preop.conductor.apellido}` : 'N/A'}
											<span class="text-gray-400 mx-1">·</span>
											<span class="text-gray-600">{preop.vehiculo?.placa || 'N/A'}</span>
										</p>
								<p class="text-xs text-gray-500">
											{new Date(preop.fecha).toLocaleDateString('es-CO')}
											<span class="mx-1">—</span>
											{#if preop.realizado}
												<span class="text-orange-600 font-medium">✓ Realizado</span>
											{:else}
												<span class="text-red-500 font-medium">✗ No realizado</span>
											{/if}
											{#if preop.observaciones} — {preop.observaciones}{/if}
										</p>
									</div>
									<button
										on:click={() => borrarPreop(preop.id)}
										class="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
										aria-label="Eliminar preoperacional"
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ==================== MODAL CREAR/EDITAR ACTIVIDAD ==================== -->
{#if actShowModal}
	<div class="act-modal-overlay" role="dialog" aria-modal="true" tabindex="-1" on:click|self={() => actShowModal = false} on:keydown={e => e.key === 'Escape' && (actShowModal = false)} transition:fade={{ duration: 200 }}>
		<div class="act-modal-content act-modal-xl" in:fly={{ y: 30, duration: 300 }}>
			<div class="act-modal-header">
				<h2>{actModalMode === 'crear' ? '➕ Nueva Actividad' : actModalMode === 'editar' ? '✏️ Editar Actividad' : '👁️ Detalle Actividad'}</h2>
				<button class="act-btn-close" on:click={() => actShowModal = false}>✕</button>
			</div>

			<div class="act-modal-body">
				<div class="act-form-grid">
					<!-- Row 1 -->
					<div class="act-form-group act-fg-w-20">
						<label for="act-numero">Nº</label>
						<input id="act-numero" type="number" bind:value={actForm.numero} disabled={actModalMode === 'ver'} class="act-input" />
					</div>
					<div class="act-form-group act-fg-flex-1">
						<label for="act-actividad">Actividad *</label>
						<input id="act-actividad" type="text" bind:value={actForm.actividad} disabled={actModalMode === 'ver'} class="act-input" placeholder="Nombre de la actividad" />
					</div>
					<div class="act-form-group act-fg-w-28">
						<label for="act-anio">Año</label>
						<input id="act-anio" type="number" bind:value={actForm.anio} disabled={actModalMode === 'ver'} class="act-input" />
					</div>

					<!-- Row 2 -->
					<div class="act-form-group act-fg-flex-1">
						<label for="act-unidad-programa">Unidad/Programa *</label>
						<input id="act-unidad-programa" type="text" bind:value={actForm.unidad_programa} disabled={actModalMode === 'ver'} class="act-input" placeholder="Ej: Fortalecimiento en la gestión institucional" />
					</div>
					<div class="act-form-group act-fg-flex-1">
						<label for="act-alcance">Alcance</label>
						<input id="act-alcance" type="text" bind:value={actForm.alcance} disabled={actModalMode === 'ver'} class="act-input" placeholder="Alcance de la actividad" />
					</div>

					<!-- Row 3 -->
					<div class="act-form-group act-fg-flex-1">
						<label for="act-recursos">Recursos</label>
						<input id="act-recursos" type="text" bind:value={actForm.recursos} disabled={actModalMode === 'ver'} class="act-input" placeholder="Recursos necesarios" />
					</div>
					<div class="act-form-group act-fg-flex-1">
						<label for="act-responsable-planeacion">Responsable Planeación</label>
						<input id="act-responsable-planeacion" type="text" bind:value={actForm.responsable_planeacion} disabled={actModalMode === 'ver'} class="act-input" placeholder="Responsable de planeación" />
					</div>

					<!-- Row 4 -->
					<div class="act-form-group act-fg-flex-1">
						<label for="act-metodo-seguimiento">Método de Seguimiento</label>
						<input id="act-metodo-seguimiento" type="text" bind:value={actForm.metodo_seguimiento} disabled={actModalMode === 'ver'} class="act-input" placeholder="Método de seguimiento" />
					</div>
					<div class="act-form-group act-fg-w-40">
						<label for="act-frecuencia">Frecuencia</label>
						<select id="act-frecuencia" bind:value={actForm.frecuencia} disabled={actModalMode === 'ver'} class="act-input">
							{#each ACT_FRECUENCIAS as f}
								<option value={f.value}>{f.label}</option>
							{/each}
						</select>
					</div>

					<!-- Row 5 -->
					<div class="act-form-group act-fg-flex-1">
						<label for="act-responsable-ejecucion">Responsable Ejecución</label>
						<select id="act-responsable-ejecucion" bind:value={actForm.responsable_ejecucion_id} disabled={actModalMode === 'ver'} class="act-input">
							<option value="">— Sin asignar —</option>
							{#each actUsuarios as u}
								<option value={u.id}>{u.nombre}</option>
							{/each}
						</select>
					</div>
					<div class="act-form-group act-fg-w-36">
						<label for="act-fecha-limite">Fecha Límite</label>
						<input id="act-fecha-limite" type="date" bind:value={actForm.fecha_limite} disabled={actModalMode === 'ver'} class="act-input" />
					</div>
					<div class="act-form-group act-fg-w-36">
						<label for="act-fecha-ejecucion">Fecha Ejecución</label>
						<input id="act-fecha-ejecucion" type="date" bind:value={actForm.fecha_ejecucion} disabled={actModalMode === 'ver'} class="act-input" />
					</div>

					<!-- Row 6 -->
					<div class="act-form-group act-fg-w-32">
						<label for="act-estado">Estado</label>
						<select id="act-estado" bind:value={actForm.estado} disabled={actModalMode === 'ver'} class="act-input">
							{#each ACT_ESTADOS as e}
								<option value={e.value}>{e.label}</option>
							{/each}
						</select>
					</div>
					<div class="act-form-group act-fg-w-32">
						<label for="act-prioridad">Prioridad</label>
						<select id="act-prioridad" bind:value={actForm.prioridad} disabled={actModalMode === 'ver'} class="act-input">
							{#each ACT_PRIORIDADES as p}
								<option value={p.value}>{p.label}</option>
							{/each}
						</select>
					</div>

					<!-- Row 7 -->
					<div class="act-form-group act-fg-full-width">
						<label for="act-observacion">Observación</label>
						<textarea id="act-observacion" bind:value={actForm.observacion} disabled={actModalMode === 'ver'} class="act-input" rows="3" placeholder="Observaciones..."></textarea>
					</div>
				</div>
			</div>

			<div class="act-modal-footer">
				{#if actModalMode === 'ver'}
					<button class="act-btn-secondary" on:click={() => { actModalMode = 'editar' }}>✏️ Editar</button>
				{:else}
					<button class="act-btn-secondary" on:click={() => actShowModal = false}>Cancelar</button>
					<button class="act-btn-primary" on:click={actGuardar} disabled={actSaving}>
						{#if actSaving}
							<div class="act-spinner-sm"></div> Guardando...
						{:else}
							💾 {actModalMode === 'crear' ? 'Crear' : 'Guardar'}
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ==================== MODAL DELETE ACTIVIDAD ==================== -->
{#if actShowDeleteModal}
	<div class="act-modal-overlay" role="dialog" aria-modal="true" tabindex="-1" on:click|self={() => actShowDeleteModal = false} on:keydown={e => e.key === 'Escape' && (actShowDeleteModal = false)} transition:fade={{ duration: 150 }}>
		<div class="act-modal-content act-modal-sm" in:fly={{ y: 20, duration: 200 }}>
			<div class="act-modal-header act-delete-header">
				<h2>🗑️ Eliminar Actividad</h2>
				<button class="act-btn-close" on:click={() => actShowDeleteModal = false}>✕</button>
			</div>
			<div class="act-modal-body text-center">
				<p class="text-gray-700">¿Estás seguro de eliminar la actividad:</p>
				<p class="font-semibold text-lg mt-2">"{actDeletingName}"</p>
				<p class="text-sm text-gray-500 mt-2">Esta acción no se puede deshacer.</p>
			</div>
			<div class="act-modal-footer" style="justify-content: center; gap: 0.75rem;">
				<button class="act-btn-secondary" on:click={() => actShowDeleteModal = false}>Cancelar</button>
				<button class="act-btn-danger" on:click={actEjecutarEliminar} disabled={actDeleting}>
					{#if actDeleting}
						Eliminando...
					{:else}
						Sí, eliminar
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ==================== ACTIVIDADES STYLES ==================== */
	.actividades-pesv-section { margin-top: 0; }

	.act-page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.act-header-left { display: flex; align-items: center; gap: 0.75rem; }
	.act-title { font-size: 1.5rem; font-weight: 700; color: #111; margin: 0; }
	.act-subtitle { font-size: 0.85rem; color: #6b7280; margin: 0; }
	.act-header-actions { display: flex; align-items: center; gap: 0.75rem; }

	.act-vista-toggle {
		display: flex;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		overflow: hidden;
		background: white;
	}
	.act-vista-toggle button {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		font-size: 0.8rem;
		font-weight: 500;
		border: none;
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-vista-toggle button svg { width: 1rem; height: 1rem; }
	.act-vista-toggle button.active { background: #f97316; color: white; }

	.act-btn-primary {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: #f97316;
		color: white;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-btn-primary:hover { background: #ea580c; }
	.act-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
	.act-btn-primary svg { width: 1rem; height: 1rem; }

	.act-btn-secondary {
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		color: #374151;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-btn-secondary:hover { background: #e5e7eb; }

	.act-btn-danger {
		padding: 0.5rem 1rem;
		background: #ef4444;
		color: white;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-btn-danger:hover { background: #dc2626; }
	.act-btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

	.act-btn-clear {
		padding: 0.375rem 0.75rem;
		background: transparent;
		color: #ef4444;
		border: 1px solid #fecaca;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-btn-clear:hover { background: #fef2f2; }

	/* KPIs */
	.act-kpis-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.act-kpi-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		box-shadow: 0 1px 3px rgba(0,0,0,0.04);
	}
	.act-kpi-icon { font-size: 1.5rem; }
	.act-kpi-value { font-size: 1.5rem; font-weight: 700; color: #111; display: block; }
	.act-kpi-label { font-size: 0.75rem; color: #6b7280; }

	/* Filtros */
	.act-filtros-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
	}
	.act-filtro-group { position: relative; }
	.act-search-group {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 180px;
	}
	.act-search-group svg { width: 1rem; height: 1rem; color: #9ca3af; flex-shrink: 0; }
	.act-input-sm {
		padding: 0.375rem 0.625rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		background: white;
		outline: none;
		transition: border-color 0.2s;
	}
	.act-input-sm:focus { border-color: #f97316; }
	.act-search-group .act-input-sm { border: none; flex: 1; }

	/* Table */
	.act-table-container {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		overflow: hidden;
	}
	.act-table-scroll { overflow-x: auto; }
	.act-table { width: 100%; border-collapse: collapse; }
	.act-table thead { background: #f9fafb; }
	.act-table th {
		padding: 0.75rem 0.75rem;
		text-align: left;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid #e5e7eb;
		white-space: nowrap;
	}
	.act-table td {
		padding: 0.625rem 0.75rem;
		font-size: 0.8rem;
		color: #374151;
		border-bottom: 1px solid #f3f4f6;
		white-space: nowrap;
	}
	.act-table tr:hover { background: #f0fdf4; }
	.act-w-16 { width: 4rem; }
	.act-w-28 { width: 7rem; }
	.act-max-w-xs { max-width: 12rem; }
	.act-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Badges */
	.act-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.7rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.act-badge-neutral { background: #f3f4f6; color: #4b5563; }

	/* Action buttons */
	.act-action-buttons { display: flex; gap: 0.25rem; }
	.act-btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		cursor: pointer;
		font-size: 0.85rem;
		transition: background 0.2s;
	}
	.act-btn-icon:hover { background: #f3f4f6; }
	.act-btn-icon.act-delete:hover { background: #fef2f2; }

	/* Pagination */
	.act-pagination {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-top: 1px solid #e5e7eb;
	}
	.act-pagination-info { font-size: 0.8rem; color: #6b7280; }
	.act-pagination-controls { display: flex; gap: 0.25rem; }
	.act-pagination-controls button {
		padding: 0.375rem 0.625rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background: white;
		color: #374151;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-pagination-controls button.active { background: #f97316; color: white; border-color: #f97316; }
	.act-pagination-controls button:disabled { opacity: 0.4; cursor: not-allowed; }

	/* Calendar */
	.act-calendar-container {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		padding: 1.25rem;
	}
	.act-calendar-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.act-calendar-header h2 {
		font-size: 1.2rem;
		font-weight: 600;
		color: #111;
		min-width: 12rem;
		text-align: center;
		margin: 0;
	}
	.act-btn-cal-nav {
		padding: 0.375rem 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background: white;
		cursor: pointer;
		font-size: 1rem;
		transition: all 0.2s;
	}
	.act-btn-cal-nav:hover { background: #f3f4f6; }
	.act-btn-cal-today {
		padding: 0.375rem 0.75rem;
		border: 1px solid #f97316;
		border-radius: 0.5rem;
		background: #f0fdf4;
		color: #ea580c;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-btn-cal-today:hover { background: #d1fae5; }
	.act-calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		overflow: hidden;
	}
	.act-cal-day-header {
		padding: 0.5rem;
		text-align: center;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
	}
	.act-cal-cell {
		min-height: 6rem;
		padding: 0.375rem;
		border-right: 1px solid #f3f4f6;
		border-bottom: 1px solid #f3f4f6;
		position: relative;
	}
	.act-cal-cell.empty { background: #fafafa; }
	.act-cal-cell.today { background: #f0fdf4; }
	.act-cal-day-num {
		font-size: 0.75rem;
		font-weight: 600;
		color: #374151;
		display: block;
		margin-bottom: 2px;
	}
	.act-cal-event {
		display: block;
		width: 100%;
		padding: 1px 4px;
		border: none;
		border-radius: 3px;
		font-size: 0.6rem;
		text-align: left;
		cursor: pointer;
		margin-bottom: 1px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: opacity 0.2s;
	}
	.act-cal-event:hover { opacity: 0.8; }
	.act-cal-more {
		font-size: 0.6rem;
		color: #6b7280;
		display: block;
	}

	/* Modal (landing-cotransmeq) */
	.act-modal-overlay {
		position: fixed;
		inset: 0;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}
	.act-modal-content {
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 24px;
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 24px 64px rgba(0,0,0,0.18);
	}
	.act-modal-xl { max-width: 56rem; }
	.act-modal-sm { max-width: 28rem; }
	.act-modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		background: linear-gradient(180deg, #ffffff 0%, #fcfcfb 100%);
	}
	.act-modal-header h2 {
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 1.25rem;
		font-weight: 600;
		color: #0f172a;
		letter-spacing: -0.01em;
		margin: 0;
	}
	.act-delete-header { background: linear-gradient(135deg, rgba(220, 38, 38, 0.04), #ffffff 60%); }
	.act-btn-close {
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 10px;
		background: transparent;
		font-size: 1.1rem;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
	}
	.act-btn-close:hover {
		background: rgba(249, 115, 22, 0.06);
		border-color: rgba(249, 115, 22, 0.3);
		color: #ea580c;
		transform: rotate(90deg);
	}
	.act-modal-body {
		padding: 1.25rem 1.5rem;
		overflow-y: auto;
	}
	.act-modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid rgba(15, 23, 42, 0.08);
		background: #fcfcfb;
	}

	/* Form */
	.act-form-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.act-form-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.act-form-group label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
	}
	.act-fg-full-width { width: 100%; }
	.act-fg-flex-1 { flex: 1; min-width: 200px; }
	.act-fg-w-20 { width: 5rem; }
	.act-fg-w-28 { width: 7rem; }
	.act-fg-w-32 { width: 8rem; }
	.act-fg-w-36 { width: 9rem; }
	.act-fg-w-40 { width: 10rem; }

	.act-input {
		padding: 0.5rem 0.625rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		font-size: 0.85rem;
		background: white;
		outline: none;
		transition: border-color 0.2s;
		width: 100%;
	}
	.act-input:focus { border-color: #f97316; box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1); }
	.act-input:disabled { background: #f9fafb; color: #6b7280; }
	textarea.act-input { resize: vertical; }

	/* Empty / Loading */
	.act-loading-state, .act-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		color: #6b7280;
		gap: 0.75rem;
	}
	.act-empty-icon { font-size: 3rem; }
	.act-spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid #e5e7eb;
		border-top-color: #f97316;
		border-radius: 50%;
		animation: act-spin 0.7s linear infinite;
	}
	.act-spinner-sm {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: act-spin 0.6s linear infinite;
	}
	@keyframes act-spin { to { transform: rotate(360deg); } }

	/* Responsive */
	@media (max-width: 768px) {
		.act-page-header { flex-direction: column; align-items: flex-start; }
		.act-header-actions { width: 100%; justify-content: space-between; }
		.act-filtros-bar { flex-direction: column; }
		.act-filtro-group { width: 100%; }
		.act-search-group { width: 100%; }
		.act-input-sm { width: 100%; }
		.act-kpis-row { grid-template-columns: repeat(2, 1fr); }
		.act-fg-flex-1 { min-width: 100%; }
		.act-fg-w-20, .act-fg-w-28, .act-fg-w-32,
		.act-fg-w-36, .act-fg-w-40 { width: 100%; }
	}
</style>