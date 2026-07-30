<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { recargosStore, valoresPagarByRecargoStore, bulkRecalcStore } from '$lib/stores/recargos';
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
	import { obtenerFestivosCompletos } from '$lib/utils/festivosColombia';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { CanvasRecargo } from '$lib/types/recargos';
	import ModalVisualizarRecargo from '$lib/components/modals/ModalVisualizarRecargo.svelte';
	import ModalFormRecargo from '$lib/components/modals/ModalFormRecargo.svelte';
	import ModalConfirmarEliminar from '$lib/components/modals/ModalConfirmarEliminar.svelte';
	import ModalCambiarEstado from '$lib/components/modals/ModalCambiarEstado.svelte';
	import ModalImportarTransmeralda from '$lib/components/modals/ModalImportarTransmeralda.svelte';
	import { toast } from 'svelte-sonner';
	import MultiSelectFilter from '$lib/components/ui/MultiSelectFilter.svelte';
	import ModalConfirmarRestaurar from '$lib/components/modals/ModalConfirmarRestaurar.svelte';

	// State
	let searchTerm = '';
	let selectedRows = new Set<string>();
	let selectedMonth = new Date().getMonth() + 1;
	let selectedYear = new Date().getFullYear();
	let currentPage = 1;
	// Máximo 200: el backend limita a 200 por query. No hay opción "Todas"
	// porque pedir miles de registros al backend era el origen de los
	// requests de 7-23s que veías en consola.
	let itemsPerPageSelect: string = '50';
	let itemsPerPage = 50;
	let sortField = '';
	let sortDirection: 'asc' | 'desc' = 'asc';

	let columns: any[] = [];

	// Highlight states - para resaltar recargos nuevos o actualizados
	let recentlyCreated = new Set<string>();
	let recentlyUpdated = new Set<string>();

	// Filters
	let conductorFilter: string[] = [];
	let vehiculoFilter: string[] = [];
	let empresaFilter: string[] = [];
	let estadoFilter: string[] = [];
	let planillaFilter: string[] = []; // ← solo agregar esta
	let importedFilter: 'all' | 'si' | 'no' = 'all';

	// Modal states
	let modalFormIsOpen = false;
	let modalViewIsOpen = false;
	let modalDeleteIsOpen = false;
	let modalEstadoIsOpen = false;
	let modalRestaurarIsOpen = false;
	let modalImportarTransmeraldaIsOpen = false;
	let selectedRecargoId: string | null = null;
	let deleteLoading = false;
	let restoredLoading = false;
	let estadoLoading = false;
	let reporteLoading = false;

	// ═══ Popover TM (badge "TM" en columna numero_planilla) ═══
	// El popover NO puede vivir dentro del `overflow-x-auto` de la tabla
	// con `position: absolute`: queda clippeado. Se renderiza con
	// `position: fixed` y se posiciona desde el `getBoundingClientRect`
	// del trigger en el momento del hover. Un solo popover global
	// (singleton) que se reposiciona según el row hovereado.
	type TmPopoverState = {
		visible: boolean;
		top: number;
		left: number;
		recargo: any | null;
	};
	let tmPopover: TmPopoverState = { visible: false, top: 0, left: 0, recargo: null };

	function showTmPopover(e: MouseEvent, recargo: any) {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		tmPopover = {
			visible: true,
			// top = borde superior del trigger en viewport. El popover
			// usa `-translate-y-full mb-2` así que el borde inferior del
			// popover queda en `rect.top - 8` (mb-2 = 8px de gap).
			top: rect.top,
			left: rect.left + rect.width / 2,
			recargo
		};
	}

	function hideTmPopover() {
		tmPopover = { ...tmPopover, visible: false };
	}

	// ═══ Cálculo "Valor a Pagar" (replica la lógica de /api/liquidaciones/preview-recargos) ═══
	// Cache por (conductor_id, mes, año) para no repetir la misma request cuando varios
	// recargos visibles comparten el mismo conductor/mes. La respuesta del endpoint
	// contiene el total_valor por planilla — basta con mapear por planilla_id.
	type PreviewPlanillaResumen = { planilla_id: string; total_valor: number };
	type PreviewCacheEntry = { planillas: PreviewPlanillaResumen[]; loaded: boolean };
	const previewCache: Map<string, PreviewCacheEntry> = new Map();
	// Set de keys de preview actualmente en vuelo (control de concurrencia).
	const previewLoadingKeys: Set<string> = new Set();

	function previewCacheKey(conductorId: string, mes: number, año: number): string {
		return `${conductorId}__${mes}__${año}`;
	}

	// Mapa recargoId → total_valor monetario. Fuente única: el writable
	// `valoresPagarByRecargoStore` del módulo `recargos.ts`. El store se
	// actualiza desde 3 lugares: la respuesta HTTP de create/update, el
	// payload de los sockets `recargo-creado` / `recargo-actualizado` /
	// `recargo-recalculado`, y el preview endpoint (vía `cargarPreviewParaRecargos`).
	$: valoresPagarByRecargo = $valoresPagarByRecargoStore;
	// Conjunto de recargos cuya petición de preview está en vuelo (para mostrar spinner).
	let recargosCargandoValor: Set<string> = new Set();
	// Conjunto de recargos para los que ya se intentó cargar y no aparecieron
	// en el preview (sin recargos monetizables en el período).
	let recargosSinValor: Set<string> = new Set();

	function fmtCOP(v: number | null | undefined): string {
		const n = Number(v) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
	}

	function fmtCOPPlain(v: number | null | undefined): string {
		const n = Number(v) || 0;
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
	}

	/**
	 * Carga el preview monetario para un (conductor, mes, año) y actualiza el mapa
	 * `valoresPagarByRecargo` con los totales por planilla. Reutiliza la cache cuando
	 * varios recargos comparten el mismo (conductor, mes, año).
	 */
	async function cargarPreviewParaRecargos(
		conductorId: string,
		mes: number,
		año: number,
		recargoIds: string[]
	) {
		if (!conductorId || !mes || !año) return;
		const key = previewCacheKey(conductorId, mes, año);
		if (previewLoadingKeys.has(key)) return;
		if (previewCache.has(key)) {
			aplicarPreviewEnMapa(key, recargoIds);
			return;
		}
		previewLoadingKeys.add(key);
		recargosCargandoValor = new Set([...recargosCargandoValor, ...recargoIds]);
		try {
			const data = await recargosApi.obtenerPreviewValorRecargo(conductorId, mes, año);
			const planillas: PreviewPlanillaResumen[] = (data?.planillas || []).map((p) => ({
				planilla_id: p.planilla_id,
				total_valor: Number(p.total_valor) || 0
			}));
			previewCache.set(key, { planillas, loaded: true });
			aplicarPreviewEnMapa(key, recargoIds);
		} catch (err) {
			console.warn('[recargos] No se pudo obtener preview-recargos:', err);
			previewCache.set(key, { planillas: [], loaded: true });
			recargosSinValor = new Set([...recargosSinValor, ...recargoIds]);
		} finally {
			previewLoadingKeys.delete(key);
			const next = new Set(recargosCargandoValor);
			for (const id of recargoIds) next.delete(id);
			recargosCargandoValor = next;
		}
	}

	function aplicarPreviewEnMapa(key: string, recargoIds: string[]) {
		const entry = previewCache.get(key);
		if (!entry) return;
		const sinValor = new Set(recargosSinValor);
		const planillaTotales = new Map<string, number>(
			entry.planillas.map((p) => [p.planilla_id, p.total_valor])
		);
		const updates: Record<string, number> = {};
		for (const id of recargoIds) {
			if (planillaTotales.has(id)) {
				updates[id] = planillaTotales.get(id) || 0;
				sinValor.delete(id);
			} else if (!(id in valoresPagarByRecargo)) {
				sinValor.add(id);
			}
		}
		if (Object.keys(updates).length > 0) {
			valoresPagarByRecargoStore.apply(updates);
		}
		recargosSinValor = sinValor;
	}

	// listado de eliminados
	let verEliminados = false;

	// User role checks
	$: user = $authStore.user;
	$: isKilometrajeRole = user?.role === 'kilometraje';
	$: isConsultaRole = user?.role === 'consulta';
	$: isReadOnly = isConsultaRole;

	// Store data
	$: recargos = $recargosStore.recargos;
	$: loading = $recargosStore.loading;
	$: error = $recargosStore.error;
	$: pagination = $recargosStore.pagination;

	// Columns dinámicas según mes/año
	$: daysInMonth = getDaysInMonth(selectedMonth, selectedYear);
	// Días festivos del mes/año seleccionado (array de números: ej. [1, 6, 19, ...])
	$: diasFestivosMes = obtenerFestivosCompletos(selectedYear)
		.filter((f) => f.mes === selectedMonth)
		.map((f) => f.dia);
	$: uniqueEmpresas = [
		...new Set(recargos.map((r) => r.empresa?.nombre).filter((n): n is string => Boolean(n)))
	].sort();
	$: uniqueConductores = [
		...new Set(
			recargos
				.map((r) => `${r.conductor?.nombre || ''} ${r.conductor?.apellido || ''}`.trim())
				.filter(Boolean)
		)
	].sort();
	$: uniqueVehiculos = [
		...new Set(recargos.map((r) => r.vehiculo?.placa).filter((v): v is string => Boolean(v)))
	].sort();
	$: uniqueEstados = [...new Set(recargos.map((r) => r.estado).filter(Boolean))];
	$: uniquePlanillas = [
		...new Set(recargos.map((r) => r.numero_planilla).filter((p): p is string => Boolean(p)))
	].sort();

	$: dayColumns = Array.from({ length: daysInMonth }, (_, i) => {
		const day = i + 1;
		const isSunday = esDomingo(day, selectedMonth, selectedYear);
		const isFestivo = diasFestivosMes.includes(day);

		return {
			key: `day_${day}`,
			label: day.toString(),
			day: day,
			isDayColumn: true,
			isSunday: isSunday,
			isFestivo: isFestivo,
			bgColor: isFestivo ? 'bg-orange-50' : isSunday ? 'bg-red-50' : '',
			width: '60px'
		};
	});

	// Columnas fijas
	// `stickyLeft` = offset acumulado desde el borde izquierdo para que
	// las columnas sticky se apilen correctamente al hacer scroll horizontal
	// (sin esto, todas quedarían en `left: 0` y se solaparían).
	// Si cambiás un width, actualizá también el stickyLeft de las siguientes.
	// Acumulado actual: select 40 + acciones 100 + empresa 200 + planilla 120 + vehiculo 100 + conductor 200 = 760
	const fixedColumns = [
		{
			key: 'select',
			label: '',
			width: '40px',
			fixed: true,
			stickyLeft: '0px',
			bgColor: 'bg-gray-200'
		},
		{
			key: 'acciones',
			label: 'Acciones',
			width: '100px',
			fixed: true,
			stickyLeft: '40px',
			bgColor: 'bg-gray-50'
		},
		{
			key: 'empresa',
			label: 'Empresa',
			width: '200px',
			fixed: true,
			stickyLeft: '140px',
			sortable: true,
			bgColor: 'bg-gray-50'
		},
		{
			key: 'numero_planilla',
			label: 'N° Planilla',
			width: '190px',
			fixed: true,
			stickyLeft: '340px',
			sortable: true,
			bgColor: 'bg-gray-50'
		},
		{
			key: 'vehiculo',
			label: 'Vehículo',
			width: '100px',
			fixed: true,
			stickyLeft: '530px',
			sortable: true,
			bgColor: 'bg-gray-50'
		},
		{
			key: 'conductor',
			label: 'Conductor',
			width: '200px',
			fixed: true,
			stickyLeft: '630px',
			sortable: true,
			bgColor: 'bg-gray-50'
		}
	];

	// Función auxiliar para calcular KM recorridos de un recargo
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

	// Columnas de totales
	const totalColumns = [
		{ key: 'total_horas', label: 'Total H', width: '80px', sortable: true },
		{ key: 'promedio', label: 'Promedio', width: '80px' },
		{ key: 'total_km', label: 'KM Rec.', width: '80px', sortable: true, bgColor: 'bg-blue-50' },
		{ key: 'total_hed', label: 'HED', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_hen', label: 'HEN', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_hefd', label: 'HEFD', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_hefn', label: 'HEFN', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_rndf', label: 'RNDF', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_rn', label: 'RN', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{ key: 'total_rd', label: 'RD', width: '70px', sortable: true, bgColor: 'bg-green-50' },
		{
			key: 'valor_pagar',
			label: 'Valor a Pagar',
			width: '120px',
			bgColor: 'bg-emerald-700',
			txtColor: 'text-white'
		},
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

		if (planillaFilter.length > 0) {
			if (!planillaFilter.includes(recargo?.numero_planilla ?? '')) return false;
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

		if (
			planillaFilter.length > 0 &&
			recargo.numero_planilla != null &&
			!planillaFilter.includes(recargo.numero_planilla)
		)
			return false;

		return true;
	});

	// Paginated data
	$: itemsPerPage = parseInt(itemsPerPageSelect);
	$: totalPages = Math.max(1, Math.ceil(filteredRecargos.length / itemsPerPage));
	$: paginatedRecargos = filteredRecargos.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);

	// Reset a página 1 cuando cambian los filtros, el tamaño de página o el mes/año.
	// (el reactive "if (currentPage > totalPages)" es el seguro secundario
	// por si la página actual ya no existe tras reducir filtros).
	let lastItemsPerPage = itemsPerPage;
	let lastSearchKey = '';
	let lastMesAnio = '';
	$: searchKey = `${searchTerm}|${conductorFilter.join(',')}|${vehiculoFilter.join(',')}|${empresaFilter.join(',')}|${estadoFilter.join(',')}|${planillaFilter.join(',')}|${importedFilter}`;
	$: mesAnioKey = `${selectedMonth}-${selectedYear}`;
	$: {
		const filtersChanged = searchKey !== lastSearchKey;
		const pageSizeChanged = itemsPerPage !== lastItemsPerPage;
		const monthChanged = mesAnioKey !== lastMesAnio;
		if (filtersChanged || pageSizeChanged || monthChanged) {
			lastSearchKey = searchKey;
			lastItemsPerPage = itemsPerPage;
			lastMesAnio = mesAnioKey;
			currentPage = 1;
		}
	}

	// Si el filtro reduce los resultados y la página actual queda fuera de rango,
	// saltar a la última página disponible. Evita "página vacía" al filtrar.
	$: if (currentPage > totalPages) currentPage = totalPages;

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
		dias_laborales: filteredRecargos.flatMap((r) => r.dias_laborales || [])
	};

	// Stats reactivos — se actualizan con búsqueda y filtros
	$: stats = (() => {
		const totalPlanillas = filteredRecargos.length;
		const totalDiasServicio = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_dias), 0);
		const totalHoras = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_horas), 0);

		const totalHED = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hed), 0);
		const totalHEN = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hen), 0);
		const totalHEFD = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hefd), 0);
		const totalHEFN = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_hefn), 0);
		const totalRNDF = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rndf), 0);
		const totalRN = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rn), 0);
		const totalRD = filteredRecargos.reduce((sum, r) => sum + toNumber(r.total_rd), 0);
		const totalKm = filteredRecargos.reduce((sum, r) => sum + calcularKmRecorridos(r), 0);

		const totalExtras = totalHED + totalHEN + totalHEFD + totalHEFN;
		const totalRecargos = totalRNDF + totalRN + totalRD;

		// Horas ordinarias = total_horas - extras (RN/RD son recargos sobre horas ya contadas, no extras adicionales)
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

	// Total a Pagar (stat card). Se toma de `meta.total_valor_pagar` que
	// el backend calcula en el mismo `list` agregándo TODOS los recargos
	// que matchean el filtro (no solo la página actual limitada a 50/100/200).
	// Esto es coherente con el resto de stat cards que también se
	// derivan del filtro: el backend lo recalcula cada vez que cambia
	// mes/año o cualquier filtro del query.
	$: totalValorPagar = $recargosStore.meta?.total_valor_pagar ?? 0;

	// Dispara la carga del preview monetario para cada (conductor, mes, año)
	// presente en `paginatedRecargos`. Agrupa por la cache key para no repetir
	// requests cuando varios recargos visibles comparten conductor y período.
	let lastPreviewSig = '';
	$: {
		const grupos = new Map<string, string[]>();
		for (const r of paginatedRecargos) {
			if (!r?.conductor?.id) continue;
			const key = previewCacheKey(r.conductor.id, Number(r.mes), Number(r.año));
			if (!grupos.has(key)) grupos.set(key, []);
			grupos.get(key)!.push(r.id);
		}
		const sig = Array.from(grupos.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.join('|');
		if (sig !== lastPreviewSig) {
			lastPreviewSig = sig;
			for (const [key, ids] of grupos.entries()) {
				const [conductorId, mesStr, añoStr] = key.split('__');
				if (previewCache.has(key)) {
					aplicarPreviewEnMapa(key, ids);
				} else if (!previewLoadingKeys.has(key)) {
					cargarPreviewParaRecargos(conductorId, Number(mesStr), Number(añoStr), ids);
				}
			}
		}
	}

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
		// El fetch lo dispara la reactiva `selectedMonth/Year → setMesYAño`
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

	async function handleConfirmRestored() {
		if (selectedRows.size === 0) return;

		restoredLoading = true;
		try {
			const idsToRestored = Array.from(selectedRows);

			if (idsToRestored.length === 1) {
				// Eliminar un solo recargo
				await recargosApi.restaurar(idsToRestored[0]);
				toast.success('Recargo eliminado correctamente');
			} else {
				// Eliminar múltiples recargos
				const result = await recargosApi.restaurarMultiple(idsToRestored);
				toast.success(`${result.eliminados} recargo(s) restaurado(s) correctamente`);
			}

			// Limpiar selección
			selectedRows.clear();
			selectedRows = selectedRows;

			// Recargar datos
			await recargosStore.fetchRecargos();

			// Cerrar modal
			modalRestaurarIsOpen = false;
		} catch (error) {
			console.error('Error restaurando recargos:', error);
			toast.error('Error al restaurar recargos');
		} finally {
			restoredLoading = false;
		}
	}

	function handleOpenFormModal() {
		if (isKilometrajeRole || isReadOnly) return;
		selectedRecargoId = null;
		modalFormIsOpen = true;
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

	/**
	 * Handler del modal de importación desde Transmeralda.
	 * Recibe el resultado del POST y refresca el canvas de recargos
	 * para que los importados aparezcan al instante.
	 */
	async function handleTransmeraldaImported(
		event: CustomEvent<{
			importadas: number;
			omitidas: number;
			errores: number;
			vehiculos_creados: number;
			empresas_creadas: number;
			recalculoBatchId: string | null;
			newRecargoIds: string[];
		}>
	) {
		const {
			importadas,
			omitidas,
			errores,
			vehiculos_creados,
			empresas_creadas,
			recalculoBatchId,
			newRecargoIds
		} = event.detail;
		if (importadas > 0) {
			const entidades =
				vehiculos_creados || empresas_creadas
					? ` (${vehiculos_creados} placa(s) y ${empresas_creadas} empresa(s) creadas)`
					: '';
			toast.success(
				`${importadas} planilla(s) importadas de Transmeralda${entidades}` +
					(omitidas ? ` · ${omitidas} omitidas` : '') +
					(errores ? ` · ${errores} con error` : '')
			);
			await recargosStore.fetchRecargos();

			// El server ya arrancó el recálculo bulk en background y nos
			// devolvió el batchId. Alimentamos el store global para que
			// la barra de progreso aparezca y el socket listener (que ya
			// está conectado) reciba los `recargos-bulk-recalc:progress`
			// y `:done` para ir actualizándola.
			//
			// Usamos el batchId real directamente (no el placeholder
			// `__pending__` que se usa en el flujo manual de
			// "recalcular seleccionadas") porque acá el server ya
			// devolvió el ID real en la misma respuesta.
			if (recalculoBatchId && newRecargoIds.length > 0) {
				const ok = bulkRecalcStore.iniciar(recalculoBatchId, newRecargoIds);
				if (ok) {
					toast.info(
						`Recalculando ${newRecargoIds.length} planilla(s) en segundo plano.`
					);
				}
			}
		} else if (omitidas || errores) {
			toast.warning(
				`Importación sin nuevos registros: ${omitidas} omitidas, ${errores} con error`
			);
		} else {
			toast.info('No se importaron planillas');
		}
	}

	async function handleListDeleted() {
		verEliminados = true;
		await recargosStore.fetchEliminados();
	}

	async function handleListActivos() {
		verEliminados = false;
		await recargosStore.fetchActivos();
	}

	// --- Clipboard: Copiar filas seleccionadas ---
	// Sanitize text for TSV: strip newlines, carriage returns, and tabs
	function sanitizeTsvCell(value: string): string {
		return value
			.replace(/[\r\n\t]/g, ' ')
			.replace(/\s{2,}/g, ' ')
			.trim();
	}

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
			case 'numero_planilla':
				return formatearNumeroPlanilla(item.numero_planilla);
			case 'vehiculo':
				return item.vehiculo?.placa || '';
			case 'conductor':
				return `${item.conductor?.nombre || ''} ${item.conductor?.apellido || ''}`.trim();
			case 'total_horas':
				return toNumber(item.total_horas).toFixed(1);
			case 'promedio':
				return (toNumber(item.total_horas) / (item.total_dias || 1)).toFixed(1);
			case 'total_km':
				return calcularKmRecorridos(item).toFixed(1);
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
			case 'valor_pagar':
				return item.id in valoresPagarByRecargo ? fmtCOPPlain(valoresPagarByRecargo[item.id]) : '';
			default: {
				const dayMatch = key.match(/^day_(\d+)$/);
				if (dayMatch) {
					const day = parseInt(dayMatch[1], 10);
					const dia = item.dias_laborales?.find((d: any) => d.dia === day);
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
				'total_rd',
				'valor_pagar'
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
						// Sanitize text cells to prevent line breaks in TSV
						cellValue = sanitizeTsvCell(cellValue);
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
				return toNumber(recargo.total_horas).toFixed(2);
			case 'promedio':
				return (toNumber(recargo.total_horas) / (recargo.total_dias || 1)).toFixed(2);
			case 'total_km':
				return calcularKmRecorridos(recargo).toFixed(2);
			case 'total_hed':
				return toNumber(recargo.total_hed).toFixed(2);
			case 'total_hen':
				return toNumber(recargo.total_hen).toFixed(2);
			case 'total_hefd':
				return toNumber(recargo.total_hefd).toFixed(2);
			case 'total_hefn':
				return toNumber(recargo.total_hefn).toFixed(2);
			case 'total_rndf':
				return toNumber(recargo.total_rndf).toFixed(2);
			case 'total_rn':
				return toNumber(recargo.total_rn).toFixed(2);
			case 'total_rd':
				return toNumber(recargo.total_rd).toFixed(2);
			case 'valor_pagar':
				return recargo.id in valoresPagarByRecargo
					? fmtCOP(valoresPagarByRecargo[recargo.id])
					: '—';
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

	/**
	 * Aplica el filtro de "Solo importados de Transmeralda" (o sus
	 * variantes). Dispara un nuevo fetch con el filtro pasado al
	 * backend (no es filtro local: el backend lo aplica en el WHERE).
	 */
	async function handleImportedFilterChange() {
		await recargosStore.aplicarFiltros({
			imported_from_transmeralda: importedFilter
		});
	}

	// Load data on mount
	onMount(async () => {
		setupSocketListeners();

		// Si hay un batch bulk activo en localStorage (de una sesión
		// previa o una recarga de página), re-consultar el estado al
		// server para reanudar la UI de progreso.
		// NO await: que el resto del onMount siga en paralelo.
		void reanudarBulkRecalc();

		// Hidratar estado desde URL search params
		// (permite deep-link desde el canvas de servicios, ej. /recargos?search=PL-001&mes=1&anio=2024)
		if (browser) {
			const params = $page.url.searchParams;
			const searchParam = params.get('search');
			const mesParam = params.get('mes');
			const anioParam = params.get('anio') ?? params.get('año');

			if (searchParam) searchTerm = searchParam;
			if (mesParam) {
				const m = parseInt(mesParam, 10);
				if (Number.isFinite(m) && m >= 1 && m <= 12) selectedMonth = m;
			}
			if (anioParam) {
				const y = parseInt(anioParam, 10);
				if (Number.isFinite(y) && y >= 2020 && y <= 2100) selectedYear = y;
			}
		}

		// Habilitar la reactiva (dispara URL sync + fetch inicial con los valores finales)
		mesAnioInicializado = true;
	});

	// Cleanup socket listeners on destroy
	onDestroy(() => {
		socketUtils.off('recargo-creado', handleRecargoCreado);
		socketUtils.off('recargo-actualizado', handleRecargoActualizado);
		socketUtils.off('recargo-recalculado', handleRecargoRecalculado);
		socketUtils.off('recargo-eliminado', handleRecargoEliminado);
		socketUtils.off('recargos-eliminados', handleRecargosEliminados);
		socketUtils.off('recargos-estado-actualizado', handleRecargosEstadoActualizado);
		socketUtils.off('recargos-bulk-recalc:progress', handleBulkRecalcProgress);
		socketUtils.off('recargos-bulk-recalc:done', handleBulkRecalcDone);

		// Limpiar timers pendientes y abortar fetch en vuelo para no leakear
		if (urlSyncTimer) clearTimeout(urlSyncTimer);
		if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
		if (bulkRecalcWatchdog) clearInterval(bulkRecalcWatchdog);
		recargosStore.abortInflight();
	});

	// Socket event handlers
	function setupSocketListeners() {
		socketUtils.on('recargo-creado', handleRecargoCreado);
		socketUtils.on('recargo-actualizado', handleRecargoActualizado);
		socketUtils.on('recargo-recalculado', handleRecargoRecalculado);
		socketUtils.on('recargo-eliminado', handleRecargoEliminado);
		socketUtils.on('recargos-eliminados', handleRecargosEliminados);
		socketUtils.on('recargos-estado-actualizado', handleRecargosEstadoActualizado);
		socketUtils.on('recargos-bulk-recalc:progress', handleBulkRecalcProgress);
		socketUtils.on('recargos-bulk-recalc:done', handleBulkRecalcDone);
	}

	/**
	 * Inyecta el `valor_pagar` que viene en el payload del socket
	 * (emitido por el backend en `recargo-creado` / `recargo-actualizado`
	 * / `recargo-recalculado`) directo en el store `valoresPagarByRecargoStore`.
	 * Así la columna "Valor a Pagar" se actualiza al instante, sin esperar
	 * al endpoint de preview ni al re-fetch del listado.
	 *
	 * Limpia el flag `recargosSinValor` para que la celda deje de mostrar
	 * el placeholder `—` y pinte el valor formateado.
	 */
	function aplicarValorPagarDelSocket(recargoId: string, valorPagar: unknown) {
		if (typeof valorPagar !== 'number' || !Number.isFinite(valorPagar)) return;
		valoresPagarByRecargoStore.set(recargoId, valorPagar);
		if (recargosSinValor.has(recargoId)) {
			const next = new Set(recargosSinValor);
			next.delete(recargoId);
			recargosSinValor = next;
		}
	}

	function handleRecargoCreado(data: any) {
		// Agregar a la lista de recientes
		recentlyCreated.add(data.recargoId);
		recentlyCreated = recentlyCreated;

		// Si el backend envió el valor a pagar, inyectarlo directo al mapa.
		aplicarValorPagarDelSocket(data.recargoId, data.valor_pagar);

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

		// Si el backend envió el valor a pagar, inyectarlo directo al mapa.
		aplicarValorPagarDelSocket(data.recargoId, data.valor_pagar);

		// Recargar datos
		recargosStore.fetchRecargos();

		// Remover el highlight después de 5 segundos
		setTimeout(() => {
			recentlyUpdated.delete(data.recargoId);
			recentlyUpdated = recentlyUpdated;
		}, 5000);
	}

	function handleRecargoRecalculado(data: any) {
		// El payload del controller de `recalcular` envuelve la planilla en
		// `data.recargo.planilla` y el id en `data.recargoId`. Aceptar
		// ambos formatos por si en el futuro el payload se aplana.
		const recargoId = data.recargoId || data.recargo?.planilla?.id;
		if (!recargoId) return;
		aplicarValorPagarDelSocket(recargoId, data.valor_pagar);
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

	// ═══════════════════════════════════════════════════════════
	// BULK RECALCULAR — Lanza el recalc bulk de los recargos
	// seleccionados, escucha progress + done por socket, y maneja
	// resume tras recarga de página vía localStorage + GET status.
	// ═══════════════════════════════════════════════════════════

	$: bulkRecalc = $bulkRecalcStore;
	$: bulkRecalcRunning = bulkRecalc?.status === 'running';
	$: bulkRecalcProgress =
		bulkRecalc && bulkRecalc.total > 0
			? Math.round((bulkRecalc.processed / bulkRecalc.total) * 100)
			: 0;

	// Si hay un bulk activo, deshabilitar el resto de acciones
	// sensibles: cambio de mes/año, búsqueda, y creación de nuevo
	// recargo (no queremos que el usuario navegue y pierda la cola).
	$: bloqueoPorRecalc = bulkRecalcRunning;

	// Pulse sobre las filas seleccionadas: el backend emite el id
	// procesado en cada progress event, así que el pulse se apaga
	// para ese id y se mantiene en los que aún están pendientes.
	$: idsEnPulso = (() => {
		if (!bulkRecalc) return new Set<string>();
		if (!bulkRecalcRunning) return new Set<string>();
		// Todos los que aún no terminaron (no están en completedIds)
		const enProgreso = new Set(bulkRecalc.ids);
		for (const done of bulkRecalc.completedIds) enProgreso.delete(done);
		return enProgreso;
	})();

	/**
	 * Handler del botón "Recalcular" del header. Lanza el bulk en el
	 * server, persiste el batchId en localStorage y deja que los
	 * handlers de socket actualicen el progreso.
	 */
	async function handleRecalcularSeleccionados() {
		if (selectedRows.size === 0) return;
		if (bulkRecalcRunning) {
			toast.warning('Ya hay un recálculo en curso. Esperá a que termine.');
			return;
		}
		const ids = Array.from(selectedRows);
		// Marcamos el batch como "iniciando" con un batchId tentativo
		// para que la UI muestre el spinner. Cuando llegue el batchId
		// real del server, lo reemplazamos con `setBatchId` (NO
		// `iniciar` de nuevo, porque eso rechazaría por batch activo).
		const ok = bulkRecalcStore.iniciar('__pending__', ids);
		if (!ok) return;

		try {
			const { batchId, total } = await recargosApi.recalcularBulk(ids);
			console.log('[bulkRecalc] Real batchId del server:', batchId);
			const replaced = bulkRecalcStore.setBatchId(batchId);
			if (!replaced) {
				console.warn(
					'[bulkRecalc] setBatchId no actualizó el store — el batch ' +
						'pudo haber sido limpiado entre el POST y la respuesta'
				);
			}
			toast.info(`Recálculo bulk iniciado: ${total} planilla(s) en proceso.`);
		} catch (err: any) {
			console.error('[bulkRecalc] Error al lanzar:', err);
			bulkRecalcStore.limpiar();
			toast.error(err?.response?.data?.message || 'No se pudo iniciar el recálculo bulk.');
		}
	}

	/**
	 * Resume el estado de un batch activo tras recarga de página.
	 * Se llama una vez en `onMount` (si localStorage tiene un batchId).
	 */
	async function reanudarBulkRecalc() {
		const local = $bulkRecalcStore;
		if (!local || local.status !== 'running') return;
		// No tiene sentido re-consultar un batchId placeholder.
		if (local.batchId === '__pending__') {
			console.log(
				'[bulkRecalc] reanudarBulkRecalc: batchId es placeholder, ' +
					'saltando (probablemente la página recargó justo entre el ' +
					`iniciar('__pending__') y el setBatchId(real))`
			);
			return;
		}
		try {
			const status = await recargosApi.obtenerEstadoBatchBulk(local.batchId);
			if (!status) {
				// Server ya no tiene el batch (purga 1h o restart). Limpiar.
				toast.info('El recálculo bulk previo ya no se puede reanudar (purga de 1h).');
				bulkRecalcStore.limpiar();
				return;
			}
			// Hidratar el store con el estado real del server.
			bulkRecalcStore.hidratarDesdeStatus(status);

			if (status.status === 'completed' || status.status === 'failed') {
				// Ya terminó mientras la página recargaba: mostrar el toast
				// final y limpiar.
				const okCount = status.okCount;
				const errCount = status.errCount;
				if (errCount === 0) {
					toast.success(`${okCount} recargo(s) recalculado(s) (reanudado)`);
				} else {
					toast.warning(`${okCount} ok, ${errCount} con error (reanudado)`);
				}
				// Limpiar selección: la página recargó con esos rows
				// seleccionados pero el batch ya terminó.
				selectedRows = new Set();
				bulkRecalcStore.limpiar();
			} else {
				toast.info(`Recálculo bulk reanudado: ${status.processed}/${status.total}`);
			}
		} catch (err) {
			console.warn('[bulkRecalc] No se pudo reanudar:', err);
		}
	}

	function handleBulkRecalcProgress(data: any) {
		console.log('[bulkRecalc] 🎯 handleBulkRecalcProgress', data);
		// Filtrar por batchId por si hay otro batch activo de otro
		// componente o una race condition.
		const local = $bulkRecalcStore;
		if (!local || local.batchId !== data.batchId) {
			console.warn(
				`[bulkRecalc] Ignorando progress: data.batchId=${data.batchId} ` +
					`pero local.batchId=${local?.batchId}`
			);
			return;
		}
		bulkRecalcStore.aplicarProgress(data);
		// Si el socket vuelve a entregar eventos, apagar el polling
		// fallback (si estaba activo).
		if (bulkRecalcPolling) {
			console.log('[bulkRecalc] ✓ Socket reconnected — apagando polling fallback');
			stopBulkRecalcPolling();
		}
	}

	function handleBulkRecalcDone(data: any) {
		console.log('[bulkRecalc] 🎯 handleBulkRecalcDone', data);
		const local = $bulkRecalcStore;
		if (!local || local.batchId !== data.batchId) {
			console.warn(
				`[bulkRecalc] Ignorando done: data.batchId=${data.batchId} ` +
					`pero local.batchId=${local?.batchId}`
			);
			return;
		}
		bulkRecalcStore.aplicarDone(data);
		// Apagar polling si estaba activo
		stopBulkRecalcPolling();
		// Toast final según resultado
		if (data.status === 'completed') {
			toast.success(
				`${data.okCount ?? data.results?.filter((r: any) => r.ok).length ?? '?'} recargo(s) recalculado(s)`
			);
		} else {
			toast.warning(`${data.okCount ?? 0} ok, ${data.errCount ?? 0} con error`);
		}
		// Limpiar la selección de filas: el bulk recalc consumió
		// los recargos seleccionados y el usuario espera que la UI
		// vuelva al estado "nada seleccionado" (sino el botón
		// "Recalcular N" sigue mostrando el count aunque los rows
		// ya no estén marcados).
		selectedRows = new Set();
		// Limpiar tras un breve delay para que la UI pinte el 100%
		// y se vea el toast antes de quitar el pulse de las filas.
		setTimeout(() => {
			bulkRecalcStore.limpiar();
		}, 1500);
	}

	// Watchdog: si pasan 60s sin progress event y el batch sigue
	// 'running', marcar como 'failed' (conexión perdida). El server
	// puede seguir procesando en background; el usuario puede ver
	// el resultado al recargar (consulta el status) o al ver la
	// columna "Valor a Pagar" actualizarse por los eventos
	// `recargo-recalculado` que el server sigue emitiendo.
	let bulkRecalcWatchdog: ReturnType<typeof setInterval> | null = null;
	// Polling fallback: si pasan 15s sin progress por socket, hacer
	// polling a `GET /recalcular-bulk/:batchId` cada 2s. Esto cubre
	// el caso en que el socket se rompió o el cliente nunca llegó
	// a unirse al room `user-${userId}`. Cuando el socket vuelve a
	// recibir eventos, el polling se apaga solo.
	let bulkRecalcPolling: ReturnType<typeof setInterval> | null = null;
	function stopBulkRecalcPolling() {
		if (bulkRecalcPolling) {
			clearInterval(bulkRecalcPolling);
			bulkRecalcPolling = null;
		}
	}
	$: {
		if (bulkRecalcRunning && !bulkRecalcWatchdog) {
			bulkRecalcWatchdog = setInterval(() => {
				const local = $bulkRecalcStore;
				if (!local || local.status !== 'running') {
					if (bulkRecalcWatchdog) {
						clearInterval(bulkRecalcWatchdog);
						bulkRecalcWatchdog = null;
					}
					return;
				}
				const silenceMs = Date.now() - local.lastUpdateAt;

				// A los 15s sin updates por socket, arrancar polling
				// como fallback. No marcamos como fallido hasta los
				// 60s para darle tiempo al polling a hacer su trabajo.
				if (silenceMs > 15_000 && !bulkRecalcPolling) {
					console.warn(
						'[bulkRecalc] Sin updates por socket hace',
						silenceMs,
						'ms — arrancando polling fallback cada 2s'
					);
					toast.info('Conexión lenta. Usando polling de respaldo.');
					bulkRecalcPolling = setInterval(async () => {
						const curr = $bulkRecalcStore;
						if (!curr || curr.status !== 'running') {
							stopBulkRecalcPolling();
							return;
						}
						// Si aún estamos en el placeholder, esperar al
						// batchId real antes de hacer polling (el
						// endpoint devolvería 404 con `__pending__`).
						if (curr.batchId === '__pending__') {
							console.log(
								'[bulkRecalc] Polling esperando batchId real ' + '(aún en placeholder)...'
							);
							return;
						}
						try {
							const status = await recargosApi.obtenerEstadoBatchBulk(curr.batchId);
							if (!status) {
								console.warn('[bulkRecalc] Polling: batch no encontrado (purga)');
								stopBulkRecalcPolling();
								return;
							}
							console.log(
								`[bulkRecalc] 📊 Polling fallback: ${status.processed}/${status.total} ` +
									`(status=${status.status})`
							);
							// Reutilizar el mismo path que el socket progress
							bulkRecalcStore.aplicarProgress({
								batchId: status.batchId,
								processed: status.processed,
								total: status.total,
								currentId: '',
								ok: true
							});
							// Si el status indica que ya terminó, finalizar
							if (status.status === 'completed' || status.status === 'failed') {
								bulkRecalcStore.aplicarDone({
									batchId: status.batchId,
									status: status.status
								});
								stopBulkRecalcPolling();
								const okCount = status.okCount;
								const errCount = status.errCount;
								if (errCount === 0) {
									toast.success(`${okCount} recargo(s) recalculado(s)`);
								} else {
									toast.warning(`${okCount} ok, ${errCount} con error`);
								}
								setTimeout(() => bulkRecalcStore.limpiar(), 1500);
							}
						} catch (err) {
							console.warn('[bulkRecalc] Polling error:', err);
						}
					}, 2_000);
				}

				// A los 60s sin updates (ni por socket ni por polling),
				// marcar como fallido.
				if (silenceMs > 60_000) {
					console.warn('[bulkRecalc] Sin updates hace', silenceMs, 'ms — marcando como fallido');
					bulkRecalcStore.marcarConexionPerdida();
					stopBulkRecalcPolling();
					toast.warning('Conexión perdida. El recálculo puede seguir en background.');
				}
			}, 10_000);
		} else if (!bulkRecalcRunning && bulkRecalcWatchdog) {
			clearInterval(bulkRecalcWatchdog);
			bulkRecalcWatchdog = null;
			stopBulkRecalcPolling();
		}
	}

	// Reactivo: sincroniza la URL con el estado del filtro y luego dispara el fetch
	// (orden garantizado: primero URL → luego request, como pediste)
	// (el flag mesAnioInicializado evita un doble fetch al hidratar desde URL en onMount)
	let mesAnioInicializado = false;
	let urlSyncTimer: ReturnType<typeof setTimeout> | null = null;
	// Debounce del fetch: evita disparar 1 request por mes cuando el usuario
	// navega rápido con prev/next (ej. julio→enero = 1 request, no 6).
	// El store también aborta el request anterior cuando llega uno nuevo.
	let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	const FETCH_DEBOUNCE_MS = 350;
	// Debounce de la URL (más corto que el fetch para que la URL refleje
	// lo que el usuario está tipeando casi en tiempo real sin martillar goto).
	const URL_SYNC_DEBOUNCE_MS = 200;

	// Track del último mes/año que disparó fetch. El `search` es local
	// (filtra `recargos` en cliente) → no necesita fetch al backend. Solo
	// `selectedMonth` / `selectedYear` cambian el query string del server.
	// Sin este guard, cada keystroke del search disparaba un setMesYAño
	// → abort del fetch anterior → "se queda cargando infinitamente"
	// combinado con el retry del apiClient.
	let lastFetchedMesAnio = '';

	function syncUrl() {
		if (!browser) return;
		const params = new URLSearchParams();
		const s = searchTerm.trim();
		if (s) params.set('search', s);
		if (selectedMonth) params.set('mes', String(selectedMonth));
		if (selectedYear) params.set('anio', String(selectedYear));
		const qs = params.toString();
		const target = qs ? `/dashboard/recargos?${qs}` : '/dashboard/recargos';
		goto(target, { replaceState: true, noScroll: true, keepFocus: true });
	}

	// 1) URL sync: se dispara con CUALQUIER cambio de searchTerm/mes/año
	// (debounced 200ms para no martillar goto en cada tecla). El search
	// es local → el URL refleja la intención del usuario sin fetches extra.
	$: if (browser && mesAnioInicializado) {
		// Svelte 4 dep tracking: referenciar las vars para que el bloque
		// se re-ejecute cuando cambien.
		void searchTerm;
		void selectedMonth;
		void selectedYear;

		if (urlSyncTimer) clearTimeout(urlSyncTimer);
		urlSyncTimer = setTimeout(syncUrl, URL_SYNC_DEBOUNCE_MS);
	}

	// 2) Fetch: SOLO se dispara cuando cambia mes/año (no en cada keystroke
	// del search). El `lastFetchedMesAnio` evita fetches redundantes cuando
	// el usuario ya está en el mismo mes/año y solo está tipeando el search.
	$: {
		if (browser && mesAnioInicializado && selectedMonth && selectedYear) {
			const currentKey = `${selectedMonth}-${selectedYear}`;
			if (currentKey !== lastFetchedMesAnio) {
				if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
				fetchDebounceTimer = setTimeout(() => {
					// Guard: si justo antes de disparar el timer cambió
					// de nuevo el mes/año, el currentKey ya no coincidirá
					// con la key que disparó este timer, así que lo
					// dejamos pasar y el siguiente timer (si lo hay) se
					// encargará. Pero marcamos `lastFetchedMesAnio` solo
					// cuando realmente se dispara el fetch, para no
					// "comer" un cambio legítimo.
					if (currentKey === `${selectedMonth}-${selectedYear}`) {
						lastFetchedMesAnio = currentKey;
						recargosStore.setMesYAño(selectedMonth, selectedYear);
					}
				}, FETCH_DEBOUNCE_MS);
			}
		}
	}
</script>

<svelte:head>
	<title>Recargos - Transmeralda</title>
</svelte:head>

<div
	class="min-h-screen p-4 md:p-6"
	style="background-color: var(--bg-base);"
	in:fly={{ y: 20, duration: 500, easing: quintOut }}
>
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<span class="eyebrow mb-2.5">DASHBOARD / RECARGOS</span>
			<h1
				class="font-display text-2xl font-normal tracking-tight text-[var(--bg-charcoal)] md:text-3xl"
			>
				Recargos de Planillas
			</h1>
			<p class="mt-1 text-sm text-[var(--text-secondary)]">
				Gestión de horas extras y recargos mensuales
			</p>
		</div>

		<div class="flex items-center gap-2">
			<!-- Botón Recalcular (bulk de los seleccionados) -->
			{#if !isKilometrajeRole && !isReadOnly && selectedRows.size > 0}
				{#if bulkRecalcRunning}
					<div
						class="flex items-center gap-2 rounded-xl border border-[rgba(99,102,241,0.25)] bg-gradient-to-r from-[rgba(99,102,241,0.08)] to-[rgba(79,70,229,0.06)] px-3 py-1.5"
						title="Recálculo bulk en curso. No se puede cambiar de mes ni crear nuevos recargos hasta que termine."
					>
						<svg
							class="h-3.5 w-3.5 animate-spin"
							style="color: #4F46E5;"
							xmlns="http://www.w3.org/2000/svg"
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
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
						<div class="flex min-w-[120px] flex-col">
							<div
								class="font-mono-meta flex items-center justify-between gap-2"
								style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #4338CA;"
							>
								<span>Recalculando</span>
								<span>{bulkRecalc?.processed ?? 0}/{bulkRecalc?.total ?? 0}</span>
							</div>
							<div
								class="mt-1 h-1 w-full overflow-hidden rounded-full"
								style="background-color: rgba(99, 102, 241, 0.12);"
							>
								<div
									class="h-full rounded-full transition-all duration-300"
									style="width: {bulkRecalcProgress}%; background: linear-gradient(90deg, #6366F1, #4F46E5);"
								></div>
							</div>
						</div>
					</div>
				{:else}
					<button
						on:click={handleRecalcularSeleccionados}
						class="apple-transition flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white"
						style="background: linear-gradient(135deg, #4F46E5, #4338CA); box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);"
						title="Recalcula los {selectedRows.size} recargo(s) seleccionado(s) con la config salarial y los % de tipos vigentes por día"
					>
						<svg
							class="h-3.5 w-3.5"
							xmlns="http://www.w3.org/2000/svg"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
						Recalcular {selectedRows.size}
					</button>
				{/if}
			{/if}

			<!-- Navegación Mes/Año -->
			<div
				class="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-white p-1.5"
				class:opacity-50={bloqueoPorRecalc}
				class:pointer-events-none={bloqueoPorRecalc}
			>
				<button
					on:click={() => handleMonthChange(-1)}
					aria-label="Mes anterior"
					class="apple-transition flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--emerald-500)]"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
						class="input-glow h-9 rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm font-medium"
					>
						{#each Array.from({ length: 12 }, (_, i) => i + 1) as mes}
							<option value={mes}>{getNombreMes(mes)}</option>
						{/each}
					</select>

					<input
						type="number"
						bind:value={selectedYear}
						class="input-glow h-9 w-20 rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm font-medium"
						min="2020"
						max="2030"
					/>
				</div>
				<button
					on:click={() => !bloqueoPorRecalc && handleMonthChange(1)}
					disabled={bloqueoPorRecalc}
					aria-label="Mes siguiente"
					class="apple-transition flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--emerald-500)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5l7 7-7 7"
						/>
					</svg>
				</button>
			</div>

			<!-- Botón Configuración -->
			<a href="/dashboard/recargos/configuracion" class="btn-secondary apple-transition">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
					/>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
					/>
				</svg>
				Configuración
			</a>

			<!-- Botón Crear -->
			{#if !isKilometrajeRole && !isReadOnly}
				<button
					on:click={handleOpenFormModal}
					disabled={bloqueoPorRecalc}
					class="btn-primary apple-transition disabled:cursor-not-allowed disabled:opacity-40"
					title={bloqueoPorRecalc
						? 'Esperá a que termine el recálculo bulk'
						: 'Crear nuevo recargo'}
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Nuevo Recargo
				</button>
				<!-- svelte-ignore a11y_consider_explicit_label -->
				<button
					on:click={getReportePdf}
					class="btn-icon apple-transition"
					title="Descargar reporte PDF"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
						><path
							fill="currentColor"
							d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m9 16v-2H6v2zm3-4v-2H6v2z"
						/></svg
					>
				</button>
				<!-- Botón Importar desde Transmeralda (después del PDF) -->
				<button
					on:click={() => (modalImportarTransmeraldaIsOpen = true)}
					disabled={bloqueoPorRecalc}
					class="apple-transition flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
					style="background: linear-gradient(135deg, #047857, #065F46); box-shadow: 0 2px 6px rgba(6, 95, 70, 0.25);"
					title="Importar recargos desde Transmeralda (mismo schema, otra base de datos) para {getNombreMes(selectedMonth)} {selectedYear}"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
						/>
					</svg>
					Importar de TM
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
					class="input-glow h-10 w-full rounded-xl border border-[var(--border-default)] bg-white px-4 pl-10 pr-10 text-sm"
				/>
				<svg
					class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-very-muted)]"
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
				<!-- Indicador de carga inline: el usuario puede seguir
				     tipeando mientras el server responde. El filtrado es
				     local e instantáneo. -->
				{#if loading}
					<div
						class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
						title="Cargando datos del servidor…"
					>
						<svg
							class="h-4 w-4 animate-spin"
							style="color: var(--emerald-500);"
							xmlns="http://www.w3.org/2000/svg"
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
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
					</div>
				{/if}
			</div>
		</div>

		<!-- Filtro: Solo importados de Transmeralda (después del search) -->
		<select
			bind:value={importedFilter}
			on:change={handleImportedFilterChange}
			disabled={bloqueoPorRecalc}
			class="input-glow h-10 rounded-xl border border-[var(--border-default)] bg-white px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
			style="min-width: 200px;"
			title="Filtrar por origen de la planilla"
		>
			<option value="all">🌐 Todas las planillas</option>
			<option value="si">📥 Solo importados de TM</option>
			<option value="no">📤 Solo nativas de Cotransmeq</option>
		</select>

		{#if !verEliminados}
			<!-- Listar eliminadas -->
			<button
				on:click={handleListDeleted}
				class="apple-transition flex items-center gap-2 rounded-xl border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.06)] px-4 py-2.5 text-sm font-semibold text-[#991B1B] hover:bg-[rgba(239,68,68,0.12)]"
			>
				Ver eliminados
			</button>
		{:else}
			<!-- Ver activos -->
			<button on:click={handleListActivos} class="btn-primary apple-transition">
				Ver Activos
			</button>
		{/if}

		<!-- Actions y paginación -->
		<div class="flex items-center gap-3">
			{#if !verEliminados}
				{#if selectedRows.size > 0}
					<button
						on:click={handleUnselectRow}
						class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
						>Deseleccionar</button
					>
					<button
						on:click={handleCopySelectedRows}
						class="apple-transition rounded-xl bg-[var(--bg-charcoal)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--bg-charcoal-deep)]"
					>
						Copiar seleccionados
					</button>
				{/if}

				{#if selectedRows.size > 0 && !isReadOnly}
					<div class="flex items-center gap-2">
						<span class="font-mono-meta text-xs text-[var(--text-muted)]"
							>{selectedRows.size} sel.</span
						>
						<button
							on:click={() => (modalEstadoIsOpen = true)}
							class="btn-primary apple-transition"
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
							class="apple-transition rounded-xl bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#B91C1C]"
						>
							Eliminar
						</button>
					</div>
				{/if}
			{:else if selectedRows.size > 0}
				<button
					on:click={() => (modalRestaurarIsOpen = true)}
					class="apple-transition flex cursor-pointer items-center gap-1.5 rounded-xl border border-[rgba(16,185,129,0.3)] bg-[var(--emerald-500)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--emerald-600)]"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
					Restaurar
				</button>
			{/if}

			<!-- Selector de tamaño de página (sin "Todas": el backend limita a 200 máx) -->
			<div class="flex items-center gap-2">
				<label
					class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
					for="items-per-page-select">Mostrar</label
				>
				<select
					id="items-per-page-select"
					bind:value={itemsPerPageSelect}
					class="input-glow h-9 rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm font-semibold"
				>
					<option value="200">200</option>
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
			class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-8"
			transition:fade={{ duration: 200 }}
		>
			<!-- Planillas -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-base)]"
					>
						<svg
							class="h-4 w-4 text-[var(--text-secondary)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">Planillas</p>
						<p class="stat-value">{stats.totalPlanillas}</p>
					</div>
				</div>
			</div>

			<!-- Días de servicio -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(16,185,129,0.10)]"
					>
						<svg
							class="h-4 w-4 text-[var(--emerald-600)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">Días servicio</p>
						<p class="stat-value">{stats.totalDiasServicio}</p>
					</div>
				</div>
			</div>

			<!-- Horas totales -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(59,130,246,0.10)]"
					>
						<svg
							class="h-4 w-4 text-[#2563EB]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">Horas totales</p>
						<p class="stat-value">{stats.totalHoras.toFixed(1)}</p>
					</div>
				</div>
			</div>

			<!-- Horas ordinarias -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(99,102,241,0.10)]"
					>
						<svg
							class="h-4 w-4 text-[#4F46E5]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">Ordinarias</p>
						<p class="stat-value">{stats.totalOrdinarias.toFixed(1)}</p>
					</div>
				</div>
			</div>

			<!-- KM recorridos -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.10)]"
					>
						<svg
							class="h-4 w-4 text-[#0891B2]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">KM recorridos</p>
						<p class="stat-value">{stats.totalKm.toFixed(1)}</p>
					</div>
				</div>
			</div>

			<!-- Total Extras -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.10)]"
					>
						<svg
							class="h-4 w-4 text-[#D97706]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">H. Extras</p>
						<p class="stat-value">{stats.totalExtras.toFixed(1)}</p>
					</div>
				</div>
			</div>

			<!-- Total Recargos -->
			<div class="stat-card">
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(168,85,247,0.10)]"
					>
						<svg
							class="h-4 w-4 text-[#9333EA]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.8"
								d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">Recargos (RN+RD)</p>
						<p class="stat-value">{stats.totalRecargos.toFixed(1)}</p>
					</div>
				</div>
			</div>

			<!-- Total a Pagar (suma del valor monetario de los recargos visibles) -->
			<div
				class="stat-card"
				style="background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.04)); border-color: rgba(16,185,129,0.25);"
			>
				<div class="flex items-center gap-2">
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
						style="background: linear-gradient(135deg, #10B981, #059669); box-shadow: 0 2px 6px rgba(16,185,129,0.25);"
					>
						<svg
							class="h-4 w-4 text-white"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<p class="stat-label">Total a Pagar</p>
						<p class="stat-value" style="color: #047857; font-size: 1.1rem;">
							{fmtCOP(totalValorPagar)}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Desglose detallado -->
		<div class="hint-card mb-4">
			<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
				<span class="font-mono-meta text-[var(--emerald-700)]">DESGLOSE</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#10B981]"></span>
					HED <strong class="text-[var(--text-primary)]">{stats.totalHED.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#047857]"></span>
					HEN <strong class="text-[var(--text-primary)]">{stats.totalHEN.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#F97316]"></span>
					HEFD <strong class="text-[var(--text-primary)]">{stats.totalHEFD.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#C2410C]"></span>
					HEFN <strong class="text-[var(--text-primary)]">{stats.totalHEFN.toFixed(1)}</strong>
				</span>
				<span class="text-[var(--text-very-muted)]">|</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#6366F1]"></span>
					RNDF <strong class="text-[var(--text-primary)]">{stats.totalRNDF.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#A855F7]"></span>
					RN <strong class="text-[var(--text-primary)]">{stats.totalRN.toFixed(1)}</strong>
				</span>
				<span class="flex items-center gap-1.5 text-[var(--text-secondary)]">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-[#EF4444]"></span>
					RD <strong class="text-[var(--text-primary)]">{stats.totalRD.toFixed(1)}</strong>
				</span>
				{#if searchTerm || conductorFilter.length > 0 || vehiculoFilter.length > 0 || planillaFilter.length > 0 || empresaFilter.length > 0 || estadoFilter.length > 0}
					<span class="text-[var(--text-very-muted)]">|</span>
					<span
						class="font-mono-meta rounded-md bg-[rgba(245,158,11,0.10)] px-2 py-0.5 text-[0.65rem] text-[#92400E]"
					>
						Filtrado: {filteredRecargos.length} / {recargos.length}
					</span>
				{/if}
			</div>
		</div>
	{/if}

	{#if verEliminados}
		<!-- TOAST PERSISTENTE — Modo "Ver eliminados" (top-center, sin SVG grande) -->
		<div
			class="pointer-events-none fixed top-[80px] left-1/2 z-[9998] -translate-x-1/2 px-4"
			role="status"
			aria-live="polite"
			in:fly={{ y: -16, duration: 320, easing: quintOut }}
			out:fade={{ duration: 200 }}
		>
			<div
				class="apple-transition pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-full px-4 py-2 backdrop-blur-md"
				style="background:rgba(254,243,199,0.92); border:1px solid rgba(245,158,11,0.35); box-shadow:0 8px 28px rgba(245,158,11,0.18), 0 2px 8px rgba(0,0,0,0.04);"
			>
				<span class="relative flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
						style="background:#f59e0b"
					></span>
					<span class="relative inline-flex h-2.5 w-2.5 rounded-full" style="background:#d97706"
					></span>
				</span>

				<span
					class="font-mono text-[10px] font-bold tracking-[0.12em] uppercase"
					style="color:#92400e"
				>
					Viendo eliminados
				</span>
				<span
					class="hidden h-3 w-px sm:inline-block"
					style="background:rgba(146,64,14,0.25)"
					aria-hidden="true"
				></span>
				<span class="hidden text-[12.5px] font-medium sm:inline" style="color:#78350f">
					Estás viendo recargos eliminados — vuelve a activos para ver los registros actuales
				</span>
				<span class="text-[12.5px] font-medium sm:hidden" style="color:#78350f">
					Solo recargos eliminados
				</span>

				<button
					on:click={handleListActivos}
					class="apple-transition ml-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
					style="background:#92400e; color:#fef3c7;"
					title="Volver a ver activos"
				>
					Activos
				</button>
			</div>
		</div>
	{/if}

	<!-- Canvas Table -->
	<div class="table-card relative">
		<!-- Indicador flotante de "actualizando" cuando ya hay datos
		     previos en pantalla. NO bloquea la interacción: el usuario
		     puede seguir scrolleando, seleccionando, etc. mientras el
		     server responde. Solo se ve cuando loading=true y ya hay
		     al menos un recargo cargado. -->
		{#if loading && recargos.length > 0}
			<div
				class="pointer-events-none absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
				style="background: rgba(255,255,255,0.92); border: 1px solid var(--border-subtle); box-shadow: 0 2px 8px rgba(0,0,0,0.06); color: var(--emerald-700);"
				role="status"
				aria-live="polite"
			>
				<svg
					class="h-3 w-3 animate-spin"
					xmlns="http://www.w3.org/2000/svg"
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
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				Actualizando…
			</div>
		{/if}
		{#if loading && recargos.length === 0}
			<div class="flex h-96 items-center justify-center">
				<div class="text-center">
					<div class="spinner mx-auto mb-4"></div>
					<p class="text-[var(--text-muted)]">Cargando recargos...</p>
				</div>
			</div>
		{:else if error && recargos.length === 0}
			<div class="flex h-96 flex-col items-center justify-center gap-3">
				<p class="text-[#991B1B]">{error}</p>
				<button
					on:click={() => recargosStore.fetchRecargos()}
					class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
				>
					Reintentar
				</button>
			</div>
		{:else}
			<div
				class="overflow-x-auto transition-opacity duration-200"
				class:opacity-60={loading}
				class:pointer-events-none={loading}
			>
				<table class="w-full border-collapse" style="table-layout: fixed;">
					<!-- Header -->
					<thead class="table-header sticky top-0 z-20">
						<tr>
							{#each columns as column}
								<th
									class="border border-[var(--border-subtle)] px-2 py-2 {column.key === 'select' ||
									column.key === 'empresa' ||
									column.key === 'numero_planilla' ||
									column.key === 'vehiculo' ||
									column.key === 'conductor'
										? 'text-left'
										: 'text-center'} {column.txtColor
										? column.txtColor
										: 'text-[var(--text-secondary)]'} {column.bgColor || ''}"
									style="width: {column.width}; min-width: {column.width}; {(column as any).fixed
										? `position: sticky; left: ${(column as any).stickyLeft}; z-index: 21;`
										: ''} {(column as any).fixed && column.bgColor
										? `background: var(--bg-base);`
										: ''}"
								>
									{#if column.key === 'select'}
										<input
											type="checkbox"
											checked={selectedRows.size === paginatedRecargos.length &&
												paginatedRecargos.length > 0}
											on:change={handleSelectAll}
											class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
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
									{:else if column.key === 'numero_planilla'}
										<MultiSelectFilter
											bind:selected={planillaFilter}
											options={uniquePlanillas}
											placeholder="Todos"
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
											class="input-glow mt-1 w-full rounded border border-[var(--border-default)] bg-white px-1.5 py-0.5 text-[11px]"
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
							{@const isRecalcing = idsEnPulso.has(recargo.id)}

							{@const isDeleted = !!recargo?.deleted_at}

							<tr
								class="table-row cursor-pointer border-b border-[var(--border-subtle)]
								{getEstadoBgColor(recargo.estado)}
								{isNew ? 'border-l-4 border-l-[var(--emerald-500)] bg-[rgba(16,185,129,0.06)]' : ''}
								{isUpdated ? 'border-l-4 border-l-[#2563EB] bg-[rgba(37,99,235,0.06)]' : ''}
								{isSelected ? 'border-l-4 border-l-[var(--emerald-600)]' : ''}
								{isDeleted ? 'border-l-4 border-l-[#EF4444] bg-[rgba(239,68,68,0.04)] opacity-75' : ''}
								{isRecalcing ? 'bulk-recalc-pulse' : ''}"
								transition:fade={{ duration: 200 }}
								on:click={() => handleSelectRow(recargo.id)}
							>
								{#each columns as column, index}
									<td
										class="border border-[var(--border-subtle)] px-2 py-2 {column.key ===
											'empresa' ||
										column.key === 'numero_planilla' ||
										column.key === 'vehiculo' ||
										column.key === 'conductor'
											? 'text-left'
											: 'text-center'} text-xs text-[var(--text-primary)] {column.bgColor ||
											''} {isSelected
											? 'shadow-[inset_0_0_0_9999px_rgba(16,120,19,0.10)]'
											: ''} {isDeleted ? 'shadow-[inset_0_0_0_9999px_rgba(239,68,68,0.04)]' : ''}"
										style="width: {column.width}; min-width: {column.width}; {(column as any).fixed
											? `position: sticky; left: ${(column as any).stickyLeft}; z-index: 10;`
											: ''} {(column as any).fixed && column.bgColor
											? `background-color: var(--bg-base);`
											: ''}"
									>
										{#if column.key === 'select'}
											<div class="flex items-center gap-2">
												{#if isNew}
													<span
														class="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--emerald-500)]"
														title="Recién creado"
													></span>
												{:else if isUpdated}
													<span
														class="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#2563EB]"
														title="Recién actualizado"
													></span>
												{/if}
												<input
													type="checkbox"
													checked={selectedRows.has(recargo.id)}
													on:click|stopPropagation
													on:change={() => handleSelectRow(recargo.id)}
													class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
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
													class="status-pill"
													style="background: rgba(59,130,246,0.10); color: #1D4ED8;"
													title="Día disponible"
												>
													D
												</span>
											{:else if horas > 0}
												<span class="status-pill {getDayChipColor(dia)}">
													{horas.toFixed(1)}
												</span>
											{:else if esDiaPendiente}
												<span
													class="status-pill"
													style="background: rgba(245,158,11,0.10); color: #92400E;"
													title="Pendiente"
												>
													P
												</span>
											{:else}
												<span class="text-[var(--text-very-muted)]">-</span>
											{/if}
										{:else if column.key === 'estado'}
											<span class="status-pill {getEstadoColor(recargo.estado)}">
												{getCellValue(recargo, column)}
											</span>
										{:else if column.key === 'valor_pagar'}
											{#if recargosCargandoValor.has(recargo.id)}
												<div
													class="flex items-center justify-center gap-1.5 text-[var(--text-very-muted)]"
												>
													<svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
															d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
														/>
													</svg>
													<span class="text-[10px]">···</span>
												</div>
											{:else if recargo.id in valoresPagarByRecargo}
												<span
													class="font-mono-meta font-bold text-white"
													title="Total monetario a pagar por este recargo"
												>
													{fmtCOP(valoresPagarByRecargo[recargo.id])}
												</span>
											{:else}
												<span
													class="text-[var(--text-very-muted)]"
													title="Sin recargos monetizables en el período">—</span
												>
											{/if}
										{:else if column.key === 'acciones'}
											<div class="flex gap-1">
												<button
													on:click|stopPropagation={() => handleViewRecargo(recargo.id)}
													class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--emerald-600)]"
													title="Ver detalles"
												>
													<svg
														class="h-3.5 w-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="1.8"
															d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
														/>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="1.8"
															d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
														/>
													</svg>
												</button>
												{#if !isReadOnly}
													<button
														on:click|stopPropagation={() => handleEditRecargo(recargo.id)}
														class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--emerald-600)]"
														title="Editar"
													>
														<svg
															class="h-3.5 w-3.5"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="1.8"
																d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
															/>
														</svg>
													</button>
												{/if}
											</div>
										{:else if column.key === 'numero_planilla'}
											<div class="flex items-center gap-1.5">
												<span class="font-mono-meta text-[0.7rem] text-[var(--emerald-700)]"
													>{getCellValue(recargo, column)}</span
												>
											{#if recargo.imported_from_transmeralda}
												<span
													on:mouseenter={(e) => showTmPopover(e, recargo)}
													on:mouseleave={hideTmPopover}
													class="inline-flex cursor-help items-center gap-0.5 rounded-md px-1.5 py-0.5"
													style="font-size: 0.55rem; font-weight: 700; color: #FFFFFF; background: linear-gradient(135deg, #047857, #065F46); border: 1px solid #065F46; letter-spacing: 0.05em; line-height: 1.3;"
													aria-label="Planilla trasladada desde Transmeralda"
												>
													<svg
														class="h-2.5 w-2.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="3"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
														/>
													</svg>
													TM
												</span>
											{/if}
												{#if recargo.tiene_documento}
													<span
														title="Documento cargado"
														class="inline-flex items-center text-[var(--emerald-500)]"
													>
														<svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
															<path
																d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z"
															/>
															<path d="M8 12h8v2H8zm0 4h8v2H8z" />
														</svg>
													</span>
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
						<tr class="sticky bottom-0 font-semibold" style="background: rgba(16, 185, 129, 0.08);">
							{#each columns as column}
								<td
									class="border border-[var(--border-subtle)] px-2 py-2 text-[var(--text-primary)] {column.key ===
										'empresa' ||
									column.key === 'numero_planilla' ||
									column.key === 'vehiculo' ||
									column.key === 'conductor'
										? 'text-left'
										: 'text-center'} text-xs"
									style="width: {column.width}; min-width: {column.width}; {(column as any).fixed
										? `position: sticky; left: ${(column as any).stickyLeft}; z-index: 10; background: rgba(16, 185, 129, 0.08);`
										: 'background: rgba(16, 185, 129, 0.08);'}"
								>
									{#if column.key === 'valor_pagar'}
										<span class="font-mono-meta font-bold text-[var(--emerald-700)]">
											{fmtCOP(totalValorPagar)}
										</span>
									{:else if column.key !== 'select' && column.key !== 'acciones'}
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

	<!-- Pagination — siempre se muestra cuando hay datos, incluso si cabe en 1 página,
	     para que el usuario sepa el total y pueda ajustar itemsPerPage -->
	{#if !loading && filteredRecargos.length > 0}
		<div
			class="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="text-xs text-[var(--text-secondary)]">
				{#if filteredRecargos.length > itemsPerPage}
					Mostrando
					<span class="font-semibold text-[var(--text-primary)]"
						>{(currentPage - 1) * itemsPerPage + 1}</span
					>
					a
					<span class="font-semibold text-[var(--text-primary)]"
						>{Math.min(currentPage * itemsPerPage, filteredRecargos.length)}</span
					>
					de
				{:else}
					Mostrando
				{/if}
				<span class="font-semibold text-[var(--text-primary)]">{filteredRecargos.length}</span>
				recargos
				{#if totalPages > 1}
					· página {currentPage} de {totalPages}
				{/if}
			</div>

			{#if totalPages > 1}
				<div class="flex flex-wrap items-center gap-1.5">
					<button
						on:click={() => (currentPage = Math.max(1, currentPage - 1))}
						disabled={currentPage === 1}
						class="apple-transition rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
					>
						‹ Anterior
					</button>
					{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
						<button
							on:click={() => (currentPage = p)}
							class="apple-transition min-w-[2rem] rounded-lg border px-2.5 py-1.5 text-sm font-semibold"
							style="border-color: {currentPage === p
								? 'var(--emerald-500)'
								: 'var(--border-default)'};
								background-color: {currentPage === p ? 'var(--emerald-500)' : 'white'};
								color: {currentPage === p ? 'white' : 'var(--text-secondary)'};"
						>
							{p}
						</button>
					{/each}
					<button
						on:click={() => (currentPage = Math.min(totalPages, currentPage + 1))}
						disabled={currentPage >= totalPages}
						class="apple-transition rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-40"
					>
						Siguiente ›
					</button>
				</div>
			{/if}
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

{#if modalRestaurarIsOpen}
	<ModalConfirmarRestaurar
		bind:isOpen={modalRestaurarIsOpen}
		title="Restaurar recargo(s)?"
		message="Esta acción marcará el recargo como restaurado. Los datos se mostraran en el sistema como activos."
		itemCount={selectedRows.size}
		loading={deleteLoading}
		on:confirm={handleConfirmRestored}
		on:cancel={() => (modalRestaurarIsOpen = false)}
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

{#if modalImportarTransmeraldaIsOpen}
	<ModalImportarTransmeralda
		bind:isOpen={modalImportarTransmeraldaIsOpen}
		mes={selectedMonth}
		año={selectedYear}
		on:imported={handleTransmeraldaImported}
		on:cancel={() => (modalImportarTransmeraldaIsOpen = false)}
	/>
{/if}

<!-- Popover TM global — se renderiza con position: fixed para escapar
     el overflow-x-auto + sticky cells de la tabla que lo clippeaban. -->
{#if tmPopover.visible && tmPopover.recargo}
	<div
		class="pointer-events-none fixed z-[9999] w-64 -translate-x-1/2 -translate-y-full rounded-lg p-2.5 text-left shadow-xl"
		style="top: {tmPopover.top}px; left: {tmPopover.left}px; margin-top: -8px; background-color: #1F2937; color: #F9FAFB; font-size: 0.7rem; font-weight: 500; line-height: 1.4; letter-spacing: 0;"
	>
		<div class="flex items-start gap-2">
			<svg
				class="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
				style="color: #10B981;"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<div>
				<strong style="color: #6EE7B7; display: block; margin-bottom: 2px;">
					Trasladado de Transmeralda
				</strong>
				Esta planilla fue importada desde la base de datos de
				Transmeralda{#if tmPopover.recargo.imported_from_transmeralda_at}
					el{' '}
					<strong>
						{new Date(
							tmPopover.recargo.imported_from_transmeralda_at
						).toLocaleDateString('es-CO', {
							day: '2-digit',
							month: 'short',
							year: 'numeric',
							hour: '2-digit',
							minute: '2-digit'
						})}
					</strong>{/if}.
			</div>
		</div>
		<!-- Flechita del popover -->
		<span
			class="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45"
			style="background-color: #1F2937;"
		></span>
	</div>
{/if}

<style>
	/* Pulse para filas que están siendo recalculadas en bulk.
	 * El tinte indigo matchea el color del botón "Recalcular" y de
	 * la barra de progreso para que sea consistente con el flujo. */
	:global(.bulk-recalc-pulse) {
		animation: bulk-recalc-pulse 1.4s ease-in-out infinite;
		box-shadow: inset 0 0 0 2px rgba(99, 102, 241, 0.55);
		background-color: rgba(99, 102, 241, 0.08) !important;
	}
	@keyframes bulk-recalc-pulse {
		0%,
		100% {
			background-color: rgba(99, 102, 241, 0.06) !important;
		}
		50% {
			background-color: rgba(99, 102, 241, 0.18) !important;
		}
	}
</style>
