<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { recargosStore } from '$lib/stores/recargos';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import { recargosApi } from '$lib/api/recargos';
	import {
		getDaysInMonth,
		getNombreMes,
		esDomingo,
		getEstadoLabel,
		getEstadoColor,
		getEstadoBgColor,
		formatearNumeroPlanilla,
		toNumber,
		getDia
	} from '$lib/utils/recargosHelpers';
	import { fade } from 'svelte/transition';
	import ModalVisualizarRecargo from '$lib/components/modals/ModalVisualizarRecargo.svelte';
	import ModalFormRecargo from '$lib/components/modals/ModalFormRecargo.svelte';
	import ModalConfirmarEliminar from '$lib/components/modals/ModalConfirmarEliminar.svelte';
	import ModalCambiarEstado from '$lib/components/modals/ModalCambiarEstado.svelte';
	import { toast } from 'svelte-sonner';
	import MultiSelectFilter from '$lib/components/ui/MultiSelectFilter.svelte';

	// State
	let searchTerm = '';
	let selectedRows = new Set<string>();
	let selectedMonth = new Date().getMonth() + 1;
	let selectedYear = new Date().getFullYear();
	let currentPage = 1;
	let itemsPerPageSelect: string = '20'; // selector de paginación ("all", "200", "150", "100", "50", "20")
	let itemsPerPage = 20;
	let sortField = '';
	let sortDirection: 'asc' | 'desc' = 'asc';

	// Tipado laxo para columnas en la tabla (evita problemas de unión de tipos en el template)
	let columns: any[] = [];

	// Highlight states - para resaltar recargos nuevos o actualizados
	let recentlyCreated = new Set<string>();
	let recentlyUpdated = new Set<string>();

	// Filters
	let conductorFilter: string[] = [];
	let vehiculoFilter: string[] = [];
	let empresaFilter: string[] = [];
	let estadoFilter: string[] = [];

	// Modal states
	let modalFormIsOpen = false;
	let modalViewIsOpen = false;
	let modalDeleteIsOpen = false;
	let modalEstadoIsOpen = false;
	let selectedRecargoId: string | null = null;
	let deleteLoading = false;
	let estadoLoading = false;
	let reporteLoading = false;

	// User role checks
	$: user = $authStore.user;
	$: isKilometrajeRole = user?.rol === 'kilometraje';
	$: isConsultaRole = user?.rol === 'consulta';
	$: isReadOnly = isConsultaRole;

	// Store data
	$: recargos = $recargosStore.recargos;
	$: loading = $recargosStore.loading;
	$: error = $recargosStore.error;
	$: pagination = $recargosStore.pagination;

	// Columns dinámicas según mes/año
	$: daysInMonth = getDaysInMonth(selectedMonth, selectedYear);
	$: uniqueEmpresas = [
		...new Set(
			recargos
				.map((r) => r.empresa?.nombre)
				.filter((v) => v != null)
				.map(String)
		)
	].sort();
	$: uniqueConductores = [
		...new Set(
			recargos
				.map((r) => `${r.conductor?.nombre || ''} ${r.conductor?.apellido || ''}`.trim())
				.filter((v) => v != null)
		)
	].sort();
	$: uniqueVehiculos = [
		...new Set(
			recargos
				.map((r) => r.vehiculo?.placa)
				.filter((v) => v != null)
				.map(String)
		)
	].sort();
	$: uniqueEstados = [
		...new Set(
			recargos
				.map((r) => r.estado)
				.filter((v) => v != null)
				.map(String)
		)
	];
	let planillaFilter: string = '';
	$: dayColumns = Array.from({ length: daysInMonth }, (_, i) => {
		const day = i + 1;
		const isSunday = esDomingo(day, selectedMonth, selectedYear);
		// TODO: Necesitarás una función para detectar festivos, por ahora false
		const isFestivo = false;

		return {
			key: `day_${day}`,
			label: day.toString(),
			day: day,
			isDayColumn: true,
			isSunday: isSunday,
			isFestivo: isFestivo,
			bgColor: isFestivo ? 'bg-orange-50' : isSunday ? 'bg-red-50' : '',
			width: '50px'
		};
	});

	// Columnas fijas
	const fixedColumns = [
		{ key: 'select', label: '', width: '40px', fixed: true },
		{ key: 'acciones', label: 'Acciones', width: '100px', fixed: true },
		{
			key: 'empresa',
			label: 'Empresa',
			width: '150px',
			fixed: true,
			sortable: true,
			bgColor: 'bg-gray-50'
		},
		{
			key: 'numero_planilla',
			label: 'N° Planilla',
			width: '120px',
			fixed: true,
			sortable: true,
			bgColor: 'bg-gray-50'
		},
		{
			key: 'vehiculo',
			label: 'Vehículo',
			width: '100px',
			fixed: true,
			sortable: true,
			bgColor: 'bg-gray-50'
		},
		{
			key: 'conductor',
			label: 'Conductor',
			width: '180px',
			fixed: true,
			sortable: true,
			bgColor: 'bg-gray-50'
		}
	];

	// Columnas de totales
	const totalColumns = [
		{ key: 'total_horas', label: 'Total H', width: '80px', sortable: true },
		{ key: 'promedio', label: 'Promedio', width: '80px' },
		{ key: 'total_hed', label: 'HED', width: '70px', sortable: true, bgColor: 'bg-orange-50' },
		{ key: 'total_hen', label: 'HEN', width: '70px', sortable: true, bgColor: 'bg-orange-50' },
		{ key: 'total_hefd', label: 'HEFD', width: '70px', sortable: true, bgColor: 'bg-orange-50' },
		{ key: 'total_hefn', label: 'HEFN', width: '70px', sortable: true, bgColor: 'bg-orange-50' },
		{ key: 'total_rndf', label: 'RNDF', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_rn', label: 'RN', width: '70px', sortable: true, bgColor: 'bg-orange-50' },
		{ key: 'total_rd', label: 'RD', width: '70px', sortable: true, bgColor: 'bg-orange-50' },
		{ key: 'estado', label: 'Estado', width: '100px' }
	];

	// Todas las columnas
	$: columns = [...fixedColumns, ...dayColumns, ...totalColumns];

	// Filtered data
	$: filteredRecargos = recargos.filter((recargo) => {
		// Search term
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			const conductor =
				`${recargo.conductor?.nombre || ''} ${recargo.conductor?.apellido || ''}`.toLowerCase();
			const vehiculo = recargo.vehiculo?.placa?.toLowerCase() || '';
			const empresa = recargo.empresa?.nombre?.toLowerCase() || '';
			const planilla = recargo.numero_planilla?.toLowerCase() || '';

			if (
				!conductor.includes(term) &&
				!vehiculo.includes(term) &&
				!empresa.includes(term) &&
				!planilla.includes(term)
			) {
				return false;
			}
		}

		// Filtros específicos
		if (conductorFilter.length > 0) {
			const nombre =
				`${recargo.conductor?.nombre || ''} ${recargo.conductor?.apellido || ''}`.trim();
			if (!conductorFilter.includes(nombre)) return false;
		}

		if (vehiculoFilter.length > 0) {
			if (!vehiculoFilter.includes(recargo.vehiculo?.placa ?? '')) return false;
		}

		if (empresaFilter.length > 0) {
			if (!empresaFilter.includes(recargo.empresa?.nombre ?? '')) return false;
		}

		if (estadoFilter.length > 0) {
			if (!estadoFilter.includes(recargo.estado)) return false;
		}

		if (planillaFilter && planillaFilter.trim() !== '') {
			const planilla = recargo.numero_planilla?.toLowerCase() || '';
			if (!planilla.includes(planillaFilter.toLowerCase())) return false;
		}

		return true;
	});

	// Paginated data
	$: itemsPerPage =
		itemsPerPageSelect === 'all' ? Number.MAX_SAFE_INTEGER : parseInt(itemsPerPageSelect);
	$: paginatedRecargos = filteredRecargos.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);

	// Totals row
	$: totalsRow = {
		id: 'TOTAL',
		empresa: { nombre: 'TOTAL' },
		numero_planilla: '',
		vehiculo: { placa: '' },
		conductor: { nombre: '', apellido: '' },
		total_horas: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_horas), 0),
		total_hed: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hed), 0),
		total_hen: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hen), 0),
		total_hefd: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hefd), 0),
		total_hefn: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hefn), 0),
		total_rndf: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rndf), 0),
		total_rn: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rn), 0),
		total_rd: filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rd), 0),
		dias_laborales: []
	};

	function calcularKmRecorridos(recargo: any): number {
		if (!recargo.dias_laborales || recargo.dias_laborales.length === 0) return 0;
		return recargo.dias_laborales.reduce((total: number, dia: any) => {
			const kmInicial = dia.kilometraje_inicial != null ? parseFloat(dia.kilometraje_inicial) : NaN;
			const kmFinal = dia.kilometraje_final != null ? parseFloat(dia.kilometraje_final) : NaN;
			if (isNaN(kmInicial) || isNaN(kmFinal)) return total;
			const diff = kmFinal - kmInicial;
			return total + (diff > 0 ? diff : 0);
		}, 0);
	}

	// Stats reactivos — se actualizan con búsqueda y filtros
	$: stats = (() => {
		const totalPlanillas = filteredRecargos.length;
		const totalDiasServicio = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_dias), 0);
		const totalHoras = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_horas), 0);

		const totalHED = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hed), 0);
		const totalHEN = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hen), 0);
		const totalHEFD = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hefd), 0);
		const totalHEFN = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hefn), 0);
		const totalRN = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rn), 0);
		const totalRD = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rd), 0);
		const totalRNDF = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rndf), 0);
		const totalKm = filteredRecargos.reduce((sum, r) => sum + calcularKmRecorridos(r), 0);

		const totalExtras = totalHED + totalHEN + totalHEFD + totalHEFN;
		const totalRecargos = totalRN + totalRD + totalRNDF;

		const totalOrdinarias = Math.max(0, totalHoras - totalExtras);

		return {
			totalPlanillas,
			totalDiasServicio,
			totalHoras,
			totalOrdinarias,
			totalHED,
			totalHEN,
			totalHEFD,
			totalHEFN,
			totalRNDF,
			totalRN,
			totalRD,
			totalKm,
			totalExtras,
			totalRecargos
		};
	})();

	// Handlers
	function handleMonthChange(increment: number) {
		selectedMonth += increment;
		if (selectedMonth > 12) {
			selectedMonth = 1;
			selectedYear++;
		} else if (selectedMonth < 1) {
			selectedMonth = 12;
			selectedYear--;
		}
		recargosStore.setMesYAño(selectedMonth, selectedYear);
	}

	function handleSelectAll() {
		if (selectedRows.size === paginatedRecargos.length) {
			selectedRows.clear();
		} else {
			selectedRows = new Set(paginatedRecargos.map((r) => r.id));
		}
		selectedRows = selectedRows; // Trigger reactivity
	}

	function handleSelectRow(id: string) {
		if (selectedRows.has(id)) {
			selectedRows.delete(id);
		} else {
			selectedRows.add(id);
		}
		console.log(paginatedRecargos)
		selectedRows = selectedRows; // Trigger reactivity
	}

	function handleUnselectRow() {
		selectedRows = new Set();
	}

	function handleViewRecargo(id: string) {
		selectedRecargoId = id;
		modalViewIsOpen = true;
	}

	function handleEditRecargo(id: string) {
		if (isReadOnly) return;
		selectedRecargoId = id;
		modalFormIsOpen = true;
	}

	async function handleDeleteSelected() {
		if (isKilometrajeRole || isReadOnly) return;
		if (selectedRows.size === 0) return;

		// Abrir modal de confirmación
		modalDeleteIsOpen = true;
	}

	async function handleConfirmDelete() {
		if (selectedRows.size === 0) return;

		deleteLoading = true;
		try {
			const idsToDelete = Array.from(selectedRows);

			if (idsToDelete.length === 1) {
				// Eliminar un solo recargo
				await recargosApi.eliminar(idsToDelete[0]);
				toast.success('Recargo eliminado correctamente');
			} else {
				// Eliminar múltiples recargos
				const result = await recargosApi.eliminarMultiple(idsToDelete);
				toast.success(`${result.eliminados} recargo(s) eliminado(s) correctamente`);
			}

			// Limpiar selección
			selectedRows.clear();
			selectedRows = selectedRows;

			// Recargar datos
			await recargosStore.fetchRecargos();

			// Cerrar modal
			modalDeleteIsOpen = false;
		} catch (error) {
			console.error('Error eliminando recargos:', error);
			toast.error('Error al eliminar recargos');
		} finally {
			deleteLoading = false;
		}
	}

	async function handleConfirmCambiarEstado(event: CustomEvent<{ estado: string }>) {
		if (selectedRows.size === 0) return;

		estadoLoading = true;
		try {
			const idsToUpdate = Array.from(selectedRows);
			const nuevoEstado = event.detail.estado;

			const result = await recargosApi.cambiarEstadoMultiple(idsToUpdate, nuevoEstado);
			toast.success(
				`${result.actualizados} recargo(s) actualizado(s) a "${getEstadoLabel(nuevoEstado)}"`
			);

			// Limpiar selección
			selectedRows.clear();
			selectedRows = selectedRows;

			// Recargar datos
			await recargosStore.fetchRecargos();

			// Cerrar modal
			modalEstadoIsOpen = false;
		} catch (error) {
			console.error('Error cambiando estado:', error);
			toast.error('Error al cambiar el estado de los recargos');
		} finally {
			estadoLoading = false;
		}
	}

	// --- Clipboard: Copiar filas seleccionadas ---
	function formatNumberWithComma(value: string | number): string {
		if (value === '' || value === '-' || value === null || value === undefined) {
			return value?.toString() || '';
		}
		const numValue = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(numValue)) {
			return (value as string).toString();
		}
		return numValue.toString().replace('.', ',');
	}

	function copyToClipboardFallback(text: string) {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.left = '-9999px';
		textarea.style.top = '-9999px';
		document.body.appendChild(textarea);

		textarea.focus();
		textarea.select();

		try {
			document.execCommand('copy');
		} finally {
			document.body.removeChild(textarea);
		}
	}

	function getCellCopyValue(item: any, key: string): string {
		switch (key) {
			case 'empresa':
				return item.empresa?.nombre || '';
			case 'numero_planilla': {
				let np = item.numero_planilla || '';
				// Si es solo números y no tiene prefijo, añadir CM-
				if (np && /^\d+$/.test(np) && !np.startsWith('CM-')) {
					np = `CM-${np}`;
				}
				return np;
			}
			case 'vehiculo':
				return item.vehiculo?.placa || '';
			case 'conductor':
				return `${item.conductor?.nombre || ''} ${item.conductor?.apellido || ''}`.trim();
			case 'total_horas':
				return toNumber(item.total_horas).toFixed(1);
			case 'promedio':
				return (toNumber(item.total_horas) / (item.total_dias || 1)).toFixed(1);
			case 'total_hed':
				return toNumber(item.total_hed).toFixed(1);
			case 'total_hen':
				return toNumber(item.total_hen).toFixed(1);
			case 'total_hefd':
				return toNumber(item.total_hefd).toFixed(1);
			case 'total_hefn':
				return toNumber(item.total_hefn).toFixed(1);
			case 'total_rndf':
				return toNumber(item.total_rndf).toFixed(1);
			case 'total_rn':
				return toNumber(item.total_rn).toFixed(1);
			case 'total_rd':
				return toNumber(item.total_rd).toFixed(1);
			default: {
				const dayMatch = key.match(/^day_(\d+)$/);
				if (dayMatch) {
					const day = parseInt(dayMatch[1], 10);
					const dia = item.dias_laborales?.find((d: any) => d.dia === day);
					// Siempre completar hasta 31 días; si no hay horas/dato, devolver vacío
					if (!dia) return '';
					const horas = toNumber(dia.total_horas);
					return horas > 0 ? horas.toFixed(1) : '';
				}
				return '';
			}
		}
	}

	async function handleCopySelectedRows() {
		try {
			// Campos numéricos que requieren coma decimal
			const numericFieldsWithComma = [
				...Array.from({ length: 31 }, (_, i) => `day_${i + 1}`),
				'total_horas',
				'promedio',
				'total_hed',
				'total_hen',
				'total_hefd',
				'total_hefn',
				'total_rndf',
				'total_rn',
				'total_rd'
			];

			// Orden exacto
			const orderedKeys = [
				'empresa',
				'numero_planilla',
				'vehiculo',
				'conductor',
				...Array.from({ length: 31 }, (_, i) => `day_${i + 1}`),
				'total_horas',
				'promedio',
				'total_hed',
				'total_hen',
				'total_hefd',
				'total_hefn',
				'total_rndf',
				'total_rn',
				'total_rd'
			];

			const selectedRowsData = filteredRecargos.filter((row) => selectedRows.has(row.id));
			if (selectedRowsData.length === 0) {
				toast.info('No hay filas seleccionadas para copiar');
				return;
			}

			const rowsToCopy = selectedRowsData.map((item) =>
				orderedKeys
					.map((key) => {
						let cellValue = getCellCopyValue(item, key);
						if (numericFieldsWithComma.includes(key)) {
							cellValue = formatNumberWithComma(cellValue);
						}
						return cellValue;
					})
					.join('\t')
			);

			const textToCopy = rowsToCopy.join('\n');

			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(textToCopy);
			} else {
				copyToClipboardFallback(textToCopy);
			}

			toast.success('Filas copiadas al portapapeles');
		} catch (e) {
			console.error('Error copiando filas:', e);
			toast.error('No se pudo copiar. Intenta de nuevo.');
		}
	}

	function handleOpenFormModal() {
		if (isKilometrajeRole || isReadOnly) return;
		selectedRecargoId = null;
		modalFormIsOpen = true;
	}

	function getCellValue(recargo: any, column: any): string | null {
		// Para columnas de días, retornamos null y manejamos el rendering en el template
		if (column.isDayColumn) {
			return null;
		}

		switch (column.key) {
			case 'empresa':
				return recargo.empresa?.nombre || '';
			case 'numero_planilla':
				return formatearNumeroPlanilla(recargo.numero_planilla);
			case 'vehiculo':
				return recargo.vehiculo?.placa || '';
			case 'conductor':
				return `${recargo.conductor?.nombre || ''} ${recargo.conductor?.apellido || ''}`.trim();
			case 'total_horas':
				const totalHoras = toNumber(recargo.total_horas);
				return totalHoras.toFixed(1);
			case 'promedio':
				return (toNumber(recargo.total_horas) / (recargo.total_dias || 1)).toFixed(1);
			case 'total_hed':
				return toNumber(recargo.total_hed).toFixed(1);
			case 'total_hen':
				return toNumber(recargo.total_hen).toFixed(1);
			case 'total_hefd':
				return toNumber(recargo.total_hefd).toFixed(1);
			case 'total_hefn':
				return toNumber(recargo.total_hefn).toFixed(1);
			case 'total_rndf':
				return toNumber(recargo.total_rndf).toFixed(1);
			case 'total_rn':
				return toNumber(recargo.total_rn).toFixed(1);
			case 'total_rd':
				return toNumber(recargo.total_rd).toFixed(1);
			case 'estado':
				return getEstadoLabel(recargo.estado);
			default:
				return '';
		}
	}

	function getDayChipColor(dia: any): string {
		if (dia.disponibilidad) {
			return 'bg-blue-100 text-blue-800 border-blue-300';
		}
		if (dia.es_festivo) {
			return 'bg-orange-100 text-orange-800 border-orange-300';
		}
		if (dia.es_domingo) {
			return 'bg-red-100 text-red-800 border-red-300';
		}
		return 'bg-gray-100 text-gray-800 border-gray-300';
	}

	async function getReportePdf() {
		reporteLoading = true;
		try {
			await recargosApi.reportePdf(selectedMonth, selectedYear);
		} catch (e) {
			console.error('Error obteniendo reporte:', e);
			toast.error('No se pudo obtener reporte. Intenta de nuevo.');
		} finally {
			reporteLoading = false;
		}
	}


	// Load data on mount
	onMount(async () => {
		setupSocketListeners();
	});

	// Cleanup socket listeners on destroy
	onDestroy(() => {
		socketUtils.off('recargo-creado', handleRecargoCreado);
		socketUtils.off('recargo-actualizado', handleRecargoActualizado);
		socketUtils.off('recargo-eliminado', handleRecargoEliminado);
		socketUtils.off('recargos-eliminados', handleRecargosEliminados);
		socketUtils.off('recargos-estado-actualizado', handleRecargosEstadoActualizado);
	});

	// Socket event handlers
	function setupSocketListeners() {
		socketUtils.on('recargo-creado', handleRecargoCreado);
		socketUtils.on('recargo-actualizado', handleRecargoActualizado);
		socketUtils.on('recargo-eliminado', handleRecargoEliminado);
		socketUtils.on('recargos-eliminados', handleRecargosEliminados);
		socketUtils.on('recargos-estado-actualizado', handleRecargosEstadoActualizado);
	}

	function handleRecargoCreado(data: any) {
		// Agregar a la lista de recientes
		recentlyCreated.add(data.recargoId);
		recentlyCreated = recentlyCreated;

		// Recargar datos
		recargosStore.fetchRecargos();

		// Remover el highlight después de 5 segundos
		setTimeout(() => {
			recentlyCreated.delete(data.recargoId);
			recentlyCreated = recentlyCreated;
		}, 5000);
	}

	function handleRecargoActualizado(data: any) {
		// Agregar a la lista de recientes
		recentlyUpdated.add(data.recargoId);
		recentlyUpdated = recentlyUpdated;

		// Recargar datos
		recargosStore.fetchRecargos();

		// Remover el highlight después de 5 segundos
		setTimeout(() => {
			recentlyUpdated.delete(data.recargoId);
			recentlyUpdated = recentlyUpdated;
		}, 5000);
	}

	function handleRecargoEliminado(data: any) {
		// Recargar datos
		recargosStore.fetchRecargos();

		// Mostrar notificación
		toast.info('Un recargo fue eliminado');
	}

	function handleRecargosEliminados(data: any) {
		// Recargar datos
		recargosStore.fetchRecargos();

		// Mostrar notificación
		toast.info(`${data.cantidad} recargo(s) fueron eliminados`);
	}

	function handleRecargosEstadoActualizado(data: any) {
		// Recargar datos
		recargosStore.fetchRecargos();

		// Mostrar notificación
		toast.info(`${data.cantidad} recargo(s) cambiaron a estado "${getEstadoLabel(data.estado)}"`);
	}

	// Reload when month/year changes
	$: if (selectedMonth && selectedYear) {
		recargosStore.setMesYAño(selectedMonth, selectedYear);
	}
</script>

<svelte:head>
	<title>Recargos - Cotransmeq</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4 md:p-6">
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900 md:text-3xl">Recargos de Planillas</h1>
			<p class="text-sm text-gray-600">Gestión de horas extras y recargos mensuales</p>
		</div>

		<div class="flex items-center gap-2">
			<!-- Navegación Mes/Año -->
			<div class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
				<button
					on:click={() => handleMonthChange(-1)}
					aria-label="Mes anterior"
					title="Mes anterior"
					class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 19l-7-7 7-7"
						/>
					</svg>
				</button>

				<div class="flex items-center gap-2">
					<select
						bind:value={selectedMonth}
						class="h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
					>
						{#each Array.from({ length: 12 }, (_, i) => i + 1) as mes}
							<option value={mes}>{getNombreMes(mes)}</option>
						{/each}
					</select>

					<input
						type="number"
						bind:value={selectedYear}
						class="h-10 w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
						min="2020"
						max="2030"
					/>
				</div>

				<button
					on:click={() => handleMonthChange(1)}
					aria-label="Mes siguiente"
					title="Mes siguiente"
					class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5l7 7-7 7"
						/>
					</svg>
				</button>
			</div>

			<!-- Botón Crear -->
			{#if !isKilometrajeRole && !isReadOnly}
				<button
					on:click={handleOpenFormModal}
					class="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-medium text-white hover:bg-orange-600"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Nuevo Recargoaa
				</button>

				<!-- svelte-ignore a11y_consider_explicit_label -->
				<button
					on:click={getReportePdf}
					class="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 text-sm font-medium text-white hover:bg-blue-600"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
						><path
							fill="currentColor"
							d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m9 16v-2H6v2zm3-4v-2H6v2z"
						/></svg
					>
				</button>
			{/if}
		</div>
	</div>

	<!-- Filtros y búsqueda -->
	<div class="mb-4 flex flex-col gap-4 md:flex-row">
		<!-- Search -->
		<div class="flex-1">
			<div class="relative">
				<input
					type="text"
					bind:value={searchTerm}
					placeholder="Buscar por conductor, vehículo, empresa o planilla..."
					class="h-10 w-full rounded-lg border border-gray-300 bg-white px-4 pr-4 pl-10 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				/>
				<svg
					class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
					/>
				</svg>
			</div>
		</div>

		<!-- Actions y paginación -->
		<div class="flex items-center gap-3">
			{#if selectedRows.size > 0}
				<button
					on:click={handleUnselectRow}
					class="rounded-lg bg-red-200 px-4 py-2 text-sm font-medium text-red-500 hover:cursor-pointer hover:opacity-85"
					>Deseleccionar</button
				>
				<button
					on:click={handleCopySelectedRows}
					class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
				>
					Copiar seleccionados
				</button>
			{/if}

			{#if selectedRows.size > 0 && !isReadOnly}
				<div class="flex items-center gap-2">
					<span class="text-sm text-gray-600">{selectedRows.size} seleccionado(s)</span>
					<button
						on:click={() => (modalEstadoIsOpen = true)}
						class="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
						Cambiar estado
					</button>
					<button
						on:click={handleDeleteSelected}
						class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
					>
						Eliminar
					</button>
				</div>
			{/if}

			<!-- Selector de tamaño de página -->
			<div class="flex items-center gap-2">
				<label class="text-xs text-gray-600" for="items-per-page-select">Mostrar</label>
				<select
					id="items-per-page-select"
					bind:value={itemsPerPageSelect}
					class="h-9 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
				>
					<option value="all">Todas</option>
					<option value="200">200</option>
					<option value="150">150</option>
					<option value="100">100</option>
					<option value="50">50</option>
					<option value="20">20</option>
				</select>
			</div>
		</div>
	</div>

	<!-- Stats Panel -->
	{#if !loading && filteredRecargos.length > 0}
		<div
			class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7"
			transition:fade={{ duration: 200 }}
		>
			<!-- Planillas -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
						<svg
							class="h-4 w-4 text-gray-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">Planillas</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalPlanillas}</p>
						<p class="text-[10px] text-gray-400">Registros del mes</p>
					</div>
				</div>
			</div>

			<!-- Días de servicio -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100">
						<svg
							class="h-4 w-4 text-orange-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">Días servicio</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalDiasServicio}</p>
						<p class="text-[10px] text-gray-400">Días laborados en total</p>
					</div>
				</div>
			</div>

			<!-- Horas totales -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
						<svg
							class="h-4 w-4 text-blue-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">Horas totales</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalHoras.toFixed(1)}</p>
						<p class="text-[10px] text-gray-400">Ordinarias + Extras</p>
					</div>
				</div>
			</div>

			<!-- Horas ordinarias -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
						<svg
							class="h-4 w-4 text-indigo-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">Ordinarias</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalOrdinarias.toFixed(1)}</p>
						<p class="text-[10px] text-gray-400">Dentro de jornada normal</p>
					</div>
				</div>
			</div>

			<!-- KM recorridos -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-100">
						<svg
							class="h-4 w-4 text-cyan-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">KM recorridos</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalKm.toFixed(1)}</p>
						<p class="text-[10px] text-gray-400">KM final - KM inicial</p>
					</div>
				</div>
			</div>

			<!-- Total Extras -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
						<svg
							class="h-4 w-4 text-amber-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">H. Extras</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalExtras.toFixed(1)}</p>
						<p class="text-[10px] text-gray-400">HED+HEN+HEFD+HEFN</p>
					</div>
				</div>
			</div>

			<!-- Total Recargos -->
			<div class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
						<svg
							class="h-4 w-4 text-purple-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
							/>
						</svg>
					</div>
					<div>
						<p class="text-xs text-gray-500">Recargos (RNDF+RN+RD)</p>
						<p class="text-lg font-bold text-gray-900">{stats.totalRecargos.toFixed(1)}</p>
						<p class="text-[10px] text-gray-400">Incluidas en horas totales</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Desglose detallado -->
		<div class="mb-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
			<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
				<span class="font-semibold text-gray-700">Desglose:</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-green-500"></span>
					HED <strong class="text-gray-900">{stats.totalHED.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-green-700"></span>
					HEN <strong class="text-gray-900">{stats.totalHEN.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-orange-500"></span>
					HEFD <strong class="text-gray-900">{stats.totalHEFD.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-orange-700"></span>
					HEFN <strong class="text-gray-900">{stats.totalHEFN.toFixed(1)}</strong>
				</span>
				<span class="text-gray-300">|</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
					RNDF <strong class="text-gray-900">{stats.totalRNDF.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-purple-500"></span>
					RN <strong class="text-gray-900">{stats.totalRN.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-red-500"></span>
					RD <strong class="text-gray-900">{stats.totalRD.toFixed(1)}</strong>
				</span>
				{#if searchTerm || conductorFilter.length > 0 || vehiculoFilter.length > 0 || empresaFilter.length > 0 || estadoFilter.length > 0}
					<span class="text-gray-300">|</span>
					<span class="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
						Filtrado: {filteredRecargos.length} de {recargos.length} planillas
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Canvas Table -->
	<div class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
		{#if loading}
			<div class="flex h-96 items-center justify-center">
				<div class="text-center">
					<div
						class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
					></div>
					<p class="text-gray-600">Cargando recargos...</p>
				</div>
			</div>
		{:else if error}
			<div class="flex h-96 items-center justify-center">
				<div class="text-center">
					<p class="text-red-600">{error}</p>
				</div>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse">
					<!-- Header -->
					<thead class="sticky top-0 z-20 bg-gray-50">
						<tr>
							{#each columns as column}
								<th
									class="border border-gray-200 px-2 py-2 {column.key === 'select' ||
									column.key === 'empresa' ||
									column.key === 'numero_planilla' ||
									column.key === 'vehiculo' ||
									column.key === 'conductor'
										? 'text-left'
										: 'text-center'} text-xs font-semibold text-gray-700 {column.bgColor || ''}"
									style="min-width: {column.width}; {column.fixed
										? 'position: sticky; left: 0; z-index: 21;'
										: ''} {column.fixed && column.bgColor ? `background: rgb(249 250 251);` : ''}"
								>
									{#if column.key === 'select'}
										<input
											type="checkbox"
											checked={selectedRows.size === paginatedRecargos.length &&
												paginatedRecargos.length > 0}
											on:change={handleSelectAll}
											class="rounded border-gray-300"
										/>
									{:else}
										{column.label}
									{/if}
									{#if column.key === 'empresa'}
										<MultiSelectFilter
											bind:selected={empresaFilter}
											options={uniqueEmpresas}
											placeholder="Todas"
											searchable
										/>
									{:else if column.key === 'conductor'}
										<MultiSelectFilter
											bind:selected={conductorFilter}
											options={uniqueConductores}
											placeholder="Todos"
											searchable
										/>
									{:else if column.key === 'vehiculo'}
										<MultiSelectFilter
											bind:selected={vehiculoFilter}
											options={uniqueVehiculos}
											placeholder="Todos"
											searchable
										/>
									{:else if column.key === 'numero_planilla'}
										<input
											type="text"
											bind:value={planillaFilter}
											placeholder="Filtrar..."
											class="w-full rounded border border-gray-300 px-1 py-0.5 text-[11px] focus:border-emerald-400 focus:outline-none"
										/>
									{:else if column.key === 'estado'}
										<MultiSelectFilter
											bind:selected={estadoFilter}
											options={uniqueEstados}
											placeholder="Todos"
											labelFn={getEstadoLabel}
										/>
									{:else}
										<span></span>
									{/if}
								</th>
							{/each}
						</tr>
					</thead>

					<!-- Body -->
					<tbody>
						{#each paginatedRecargos as recargo (recargo.id)}
							{@const isNew = recentlyCreated.has(recargo.id)}
							{@const isUpdated = recentlyUpdated.has(recargo.id)}
							{@const isSelected = selectedRows.has(recargo.id)}

							<tr
								class="border-b border-gray-100 hover:bg-gray-50 {getEstadoBgColor(
									recargo.estado
								)} {isNew ? 'border-l-4 border-l-orange-500 bg-orange-50/30' : ''} {isUpdated
									? 'border-l-4 border-l-blue-500 bg-blue-50/30'
									: ''} {isSelected ? 'border-l-4 border-l-orange-600' : ''}"
								transition:fade={{ duration: 200 }}
								on:click={() => handleSelectRow(recargo.id)}
							>
								{#each columns as column, index}
									<td
										class="border border-gray-200 px-2 py-2 {column.key === 'empresa' ||
										column.key === 'numero_planilla' ||
										column.key === 'vehiculo' ||
										column.key === 'conductor'
											? 'text-left'
											: 'text-center'} text-xs {column.fixed
											? 'sticky left-0 z-10'
											: ''} {column.bgColor || ''} {isSelected
											? 'shadow-[inset_0_0_0_9999px_rgba(200,80,10,0.18)]'
											: ''}"
										style="min-width: {column.width}; {column.fixed && column.bgColor
											? `background-color: rgb(249 250 251);`
											: ''}"
									>
										{#if column.key === 'select'}
											<!-- Badge indicador al inicio del row -->
											<div class="flex items-center gap-2">
												{#if isNew}
													<span
														class="inline-flex h-2 w-2 animate-pulse rounded-full bg-orange-500"
														title="Recién creado"
													></span>
												{:else if isUpdated}
													<span
														class="inline-flex h-2 w-2 animate-pulse rounded-full bg-blue-500"
														title="Recién actualizado"
													></span>
												{/if}
												<input
													type="checkbox"
													checked={selectedRows.has(recargo.id)}
													on:change={() => handleSelectRow(recargo.id)}
													class="rounded border-gray-300"
												/>
											</div>
										{:else if column.isDayColumn}
											{@const dia = recargo.dias_laborales?.find((d: any) => d.dia === column.day)}
											{@const horas = dia ? toNumber(dia.total_horas) : 0}

											{@const fechaBase = dia
												? recargo?.servicio?.fecha_realizacion
												: recargo?.servicio?.fecha_realizacion}

											{@const esDiaPendiente = fechaBase
												? getDia(fechaBase) === (column as any).day
												: false}
											{#if dia?.disponibilidad}
												<span
													class="inline-block rounded border border-blue-300 bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
													title="Día disponible"
												>
													D
												</span>
											{:else if horas > 0}
												<span
													class="inline-block rounded border px-2 py-0.5 text-xs font-medium {getDayChipColor(
														dia
													)}"
												>
													{horas.toFixed(1)}
												</span>
											{:else if esDiaPendiente}
												<span
													class="inline-block rounded border border-yellow-400 bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700"
													title="Pendiente"
												>
													P
												</span>
											{:else}
												<span class="text-gray-400">-</span>
											{/if}
										{:else if column.key === 'estado'}
											<span
												class="inline-block rounded px-2 py-1 text-xs font-medium text-white {getEstadoColor(
													recargo.estado
												)}"
											>
												{getCellValue(recargo, column)}
											</span>
										{:else if column.key === 'acciones'}
											<div class="flex gap-1">
												<button
													on:click={() => handleViewRecargo(recargo.id)}
													class="rounded p-1 hover:bg-gray-200"
													title="Ver detalles"
												>
													<svg
														class="h-4 w-4 text-gray-600"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
														/>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
														/>
													</svg>
												</button>
												{#if !isReadOnly}
													<button
														on:click={() => handleEditRecargo(recargo.id)}
														class="rounded p-1 hover:bg-gray-200"
														title="Editar"
													>
														<svg
															class="h-4 w-4 text-gray-600"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
															/>
														</svg>
													</button>
												{/if}
											</div>
										{:else}
											{getCellValue(recargo, column)}
										{/if}
									</td>
								{/each}
							</tr>
						{/each}

						<!-- Totals Row -->
						<tr class="sticky bottom-0 bg-orange-50 font-semibold">
							{#each columns as column}
								<td
									class="border border-gray-200 px-2 py-2 {column.key === 'empresa' ||
									column.key === 'numero_planilla' ||
									column.key === 'vehiculo' ||
									column.key === 'conductor'
										? 'text-left'
										: 'text-center'} text-xs {column.fixed
										? 'sticky left-0 z-10 bg-orange-50'
										: ''}"
									style="min-width: {column.width};"
								>
									{#if column.key !== 'select' && column.key !== 'acciones'}
										{getCellValue(totalsRow, column)}
									{/if}
								</td>
							{/each}
						</tr>
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- Pagination -->
	{#if !loading && filteredRecargos.length > itemsPerPage}
		<div class="mt-4 flex items-center justify-between">
			<div class="text-sm text-gray-600">
				Mostrando {(currentPage - 1) * itemsPerPage + 1} a {Math.min(
					currentPage * itemsPerPage,
					filteredRecargos.length
				)} de {filteredRecargos.length} recargos
			</div>

			<div class="flex gap-2">
				<button
					on:click={() => (currentPage = Math.max(1, currentPage - 1))}
					disabled={currentPage === 1}
					class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
				>
					Anterior
				</button>
				<button
					on:click={() =>
						(currentPage = Math.min(
							Math.ceil(filteredRecargos.length / itemsPerPage),
							currentPage + 1
						))}
					disabled={currentPage >= Math.ceil(filteredRecargos.length / itemsPerPage)}
					class="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
				>
					Siguiente
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Modales -->
{#if modalViewIsOpen}
	<ModalVisualizarRecargo bind:isOpen={modalViewIsOpen} recargoId={selectedRecargoId} />
{/if}

{#if modalFormIsOpen}
	<ModalFormRecargo
		bind:isOpen={modalFormIsOpen}
		recargoId={selectedRecargoId}
		currentMonth={selectedMonth}
		currentYear={selectedYear}
		on:close={() => {
			modalFormIsOpen = false;
			selectedRecargoId = null;
		}}
	/>
{/if}

{#if modalDeleteIsOpen}
	<ModalConfirmarEliminar
		bind:isOpen={modalDeleteIsOpen}
		title="¿Eliminar recargo(s)?"
		message="Esta acción marcará el recargo como eliminado. Los datos se conservarán en el sistema pero no serán visibles."
		itemCount={selectedRows.size}
		loading={deleteLoading}
		on:confirm={handleConfirmDelete}
		on:cancel={() => (modalDeleteIsOpen = false)}
	/>
{/if}

{#if modalEstadoIsOpen}
	<ModalCambiarEstado
		bind:isOpen={modalEstadoIsOpen}
		itemCount={selectedRows.size}
		loading={estadoLoading}
		on:confirm={handleConfirmCambiarEstado}
		on:cancel={() => (modalEstadoIsOpen = false)}
	/>
{/if}
